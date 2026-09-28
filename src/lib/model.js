// Builds one clean, reconciled sales dataset from the raw Paradox tables.
//
// Sources
//  - ACC  : Invoices.DB + StockTransDetails.DB (the accounting books; every POS
//           receipt and every on-account invoice is posted here). Primary source.
//  - POS  : CROldInvoices.DB + CROldDetails.DB (cash-register history). Used only
//           for business days outside the range covered by ACC (older history).
//
// Rules
//  - Business day = the date the system books the sale on (after-midnight sales
//    belong to the previous working day).
//  - Gross = invoice Total (sum of product lines, before invoice discount).
//  - Net   = Gross - invoice discounts (= NetTotal).
//  - Returns (type 11) are kept as negative invoices.
//  - Every invoice is reconciled against its lines. If they differ, the gap is
//    booked on an "Unallocated (no line detail)" product so product totals
//    always equal invoice totals, and the invoice is listed on the
//    Reconciliation page.
//  - Invoice discount is allocated to lines pro-rata, so product Net also sums
//    exactly to invoice Net.

import { readTable } from './paradox.js';

const EPS = 0.005;
export const UNALLOCATED = -1;
const round2 = (v) => Math.round(v * 100) / 100;

const INV_FIELDS = ['IUNo', 'Type', 'MIOType', 'Date', 'Time', 'No', 'Dealer', 'Total',
  'DiscountValue', 'DiscountPercent', 'CalculatedDiscountValue', 'NetTotal', 'CashPayment', 'ChequePayment',
  'AccountAmount', 'Canceled'];
const STD_FIELDS = ['IUNo', 'ItemNo', 'Quantity', 'EntryUnitPrice', 'Name', 'Source'];
const CRI_FIELDS = ['UNo', 'Type', 'Date', 'Time', 'WorkingDate', 'No', 'Dealer', 'Total',
  'DiscountValue', 'DiscountPercent', 'CalculatedDiscountValue', 'NetTotal', 'CashPayment', 'CreditCardPayment',
  'ChequePayment', 'AmountOnDealer', 'CashBack'];
const CRD_FIELDS = ['UNo', 'ItemNo', 'Quantity', 'UnitPrice', 'QuantityPrice', 'Name'];
const OPEN_FIELDS = ['UNo', 'TableName', 'Total', 'NetTotal'];
const ITEM_FIELDS = ['ItemNo', 'Name', 'EnglishName', 'FatherNo'];

const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * @param {{folder:string,name:string,data:Uint8Array}[]} entries
 * @param {(msg:string, frac:number)=>void} progress  frac in [0,1]
 */
export async function buildModel(entries, progress = () => {}) {
  const folders = new Map();
  for (const e of entries) {
    if (!folders.has(e.folder)) folders.set(e.folder, {});
    folders.get(e.folder)[e.name] = e.data;
  }

  // plan the parsing work so the progress bar is proportional to bytes
  const jobs = [];
  for (const [folder, t] of folders) {
    if (t.Invoices && t.StockTransDetails) {
      jobs.push([folder, 'Invoices', INV_FIELDS], [folder, 'StockTransDetails', STD_FIELDS]);
    }
    if (t.CROldInvoices && t.CROldDetails) {
      jobs.push([folder, 'CROldInvoices', CRI_FIELDS], [folder, 'CROldDetails', CRD_FIELDS]);
    }
    if (t.CRInvoices) jobs.push([folder, 'CRInvoices', OPEN_FIELDS]);
    if (t.Items) jobs.push([folder, 'Items', ITEM_FIELDS]);
  }
  if (!jobs.some(([, name]) => name === 'Invoices' || name === 'CROldInvoices')) {
    throw new Error(
      'No sales tables found. Upload Invoices.DB + StockTransDetails.DB and/or ' +
      'CROldInvoices.DB + CROldDetails.DB (or a ZIP/RAR that contains them).',
    );
  }
  const totalBytes = jobs.reduce((s, [f, name]) => s + folders.get(f)[name].byteLength, 0);
  let doneBytes = 0;
  const parsed = new Map(); // folder -> {table: rows}
  for (const [folder, name, fields] of jobs) {
    const data = folders.get(folder)[name];
    const { rows } = await readTable(data, {
      fields,
      onProgress: (d, t) => progress(`Reading ${name}…`, 0.85 * (doneBytes + (data.byteLength * d) / t) / totalBytes),
    });
    doneBytes += data.byteLength;
    if (!parsed.has(folder)) parsed.set(folder, {});
    parsed.get(folder)[name] = rows;
  }

  progress('Building invoices and product lines…', 0.87);
  await tick();

  // ---- item names (from Items.DB, fall back to line names) ----
  const itemNames = new Map();
  for (const t of parsed.values()) {
    for (const it of t.Items || []) {
      if (it.ItemNo != null) itemNames.set(it.ItemNo, it.Name || it.EnglishName || `Item ${it.ItemNo}`);
    }
  }

  const acc = { invoices: [] };
  const pos = { invoices: [] };
  const recon = { headerLineMismatches: [], orphanLines: { count: 0, amount: 0 }, openTickets: [] };
  const accSeen = new Set();
  const posSeen = new Set();

  for (const [folder, t] of parsed) {
    if (t.Invoices) buildAcc(t, folder, acc, accSeen, recon);
    if (t.CROldInvoices) buildPos(t, folder, pos, posSeen, recon);
    for (const o of t.CRInvoices || []) {
      if (n(o.Total)) recon.openTickets.push({ table: o.TableName || `#${o.UNo}`, total: n(o.Total), net: n(o.NetTotal) });
    }
  }

  progress('Merging sources…', 0.92);
  await tick();

  // ACC covers [min,max] business day. POS fills the days outside it.
  let accMin = null, accMax = null;
  for (const inv of acc.invoices) {
    if (!accMin || inv.date < accMin) accMin = inv.date;
    if (!accMax || inv.date > accMax) accMax = inv.date;
  }
  const merged = [...acc.invoices];
  const posUsed = new Set();
  for (const inv of pos.invoices) {
    if (!accMin || inv.date < accMin || inv.date > accMax) { merged.push(inv); posUsed.add(inv.key); }
  }
  const byTime = (a, b) => (a.date === b.date ? a.minute - b.minute : a.date < b.date ? -1 : 1);
  merged.sort(byTime);
  const posAll = [...pos.invoices].sort(byTime);

  // product dictionary
  const products = new Map();
  for (const inv of [...acc.invoices, ...pos.invoices]) {
    for (const l of inv.lines) {
      let p = products.get(l.item);
      if (!p) {
        p = { id: l.item, name: l.item === UNALLOCATED ? 'Unallocated (no line detail)' : itemNames.get(l.item) || l.name || `Item ${l.item}` };
        products.set(l.item, p);
      }
      // prefer latest line name if Items.DB is missing
      if (!itemNames.has(l.item) && l.name && l.item !== UNALLOCATED) p.name = l.name;
    }
  }

  progress('Reconciling…', 0.96);
  await tick();

  // cross-check POS vs ACC per business day for the overlap period
  const posVsAcc = [];
  if (accMin && pos.invoices.length) {
    const byDay = new Map();
    const get = (d) => byDay.get(d) || byDay.set(d, { date: d, posOrders: 0, posGross: 0, accOrders: 0, accGross: 0 }).get(d);
    for (const inv of pos.invoices) {
      if (inv.date >= accMin && inv.date <= accMax) { const r = get(inv.date); r.posOrders += inv.sign > 0 ? 1 : 0; r.posGross += inv.gross; }
    }
    for (const inv of acc.invoices) {
      if (inv.channel === 'POS') { const r = get(inv.date); r.accOrders += inv.sign > 0 ? 1 : 0; r.accGross += inv.gross; }
    }
    for (const r of byDay.values()) {
      r.posGross = round2(r.posGross); r.accGross = round2(r.accGross);
      r.diff = round2(r.accGross - r.posGross);
      posVsAcc.push(r);
    }
    posVsAcc.sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  const sets = { acc: merged, pos: posAll };
  const views = new Map();
  const result = {
    products,
    /** Every invoice list, for applying costs. */
    baseSets: [merged, posAll],
    /** Forget cached views (e.g. after costs change, so calendar copies pick up new figures). */
    clearViews() { views.clear(); },
    hasAcc: acc.invoices.length > 0,
    hasPos: pos.invoices.length > 0,
    /**
     * source: 'acc' (accounting books, POS history for other dates) | 'pos' (cash register only)
     * day: 'business' (after-midnight sales belong to the previous day) | 'calendar' (midnight to midnight)
     */
    view(source = 'acc', day = 'business') {
      if (!sets[source]?.length) source = sets.acc.length ? 'acc' : 'pos';
      const k = source + '|' + day;
      if (!views.has(k)) {
        let list = sets[source];
        if (day === 'calendar') {
          list = list.map((i) => (i.calDate === i.date ? i : withDate(i, i.calDate))).sort(byTime);
        }
        views.set(k, { invoices: list, minDate: list.length ? list[0].date : null, maxDate: list.length ? list[list.length - 1].date : null, source, day });
      }
      return views.get(k);
    },
    sources: {
      acc: acc.invoices.length ? { from: accMin, to: accMax, invoices: acc.invoices.length } : null,
      pos: pos.invoices.length ? {
        from: pos.invoices.reduce((m, i) => (i.date < m ? i.date : m), '9999'),
        to: pos.invoices.reduce((m, i) => (i.date > m ? i.date : m), '0000'),
        invoices: pos.invoices.length,
        used: posUsed.size,
      } : null,
    },
    recon: { ...recon, posVsAcc },
  };
  const def = result.view();
  result.minDate = def.minDate;
  result.maxDate = def.maxDate;
  result.lineCount = merged.reduce((s2, i) => s2 + i.lines.length, 0);
  result.recon.dailyCheck = dailyProductCheck(def.invoices);
  progress('Done', 1);
  return result;
}

function tick() { return new Promise((r) => setTimeout(r, 0)); }

const DAY_START_MIN = 5 * 60; // orders before 05:00 belong to the previous business day

function nextDay(iso) {
  const t = new Date(iso + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

function withDate(inv, date) {
  return { ...inv, date, month: date.slice(0, 7), dow: new Date(date + 'T00:00:00Z').getUTCDay() };
}

// How the discount was given on the till: 'p15' = 15 %, 'fixed' = an amount, '' = none.
function discountKind(r, gross, net) {
  if (Math.abs(gross - net) < 0.005) return '';
  const p = n(r.DiscountPercent);
  if (p >= 99) return 'p100'; // 99.99 % is used on the till as "free"
  if (p > 0) return 'p' + Math.round(p * 100) / 100;
  return 'fixed';
}

function makeInvoice(o) {
  const minute = o.time != null ? Math.floor(o.time / 60000) : 0;
  // calendar date: the system's own date when known, else derived from the business day
  const calDate = o.calDate || (minute < DAY_START_MIN ? nextDay(o.date) : o.date);
  return { ...withDate(o, o.date), minute, hour: Math.floor(minute / 60) % 24, calDate };
}

// Attach lines to invoice, add Unallocated gap line, allocate discount.
function finishInvoice(inv, rawLines, out, recon, sourceLabel, ref) {
  let linesGross = 0;
  for (const l of rawLines) linesGross += l.gross;
  const gap = round2(inv.gross - linesGross);
  if (Math.abs(gap) > EPS) {
    recon.headerLineMismatches.push({
      source: sourceLabel, ref, date: inv.date, invoiceGross: inv.gross, linesGross: round2(linesGross), gap,
    });
    rawLines.push({ item: UNALLOCATED, name: null, qty: 0, gross: gap });
  }
  const disc = inv.gross - inv.net;
  let allocated = 0;
  rawLines.forEach((l, i) => {
    const share = inv.gross ? l.gross / inv.gross : 0;
    let net = i === rawLines.length - 1 ? l.gross - (disc - allocated) : round2(l.gross - disc * share);
    if (i !== rawLines.length - 1) allocated += l.gross - net;
    l.net = round2(net);
  });
  inv.lines = rawLines;
  inv.qty = rawLines.reduce((s, l) => s + (l.item === UNALLOCATED ? 0 : l.qty), 0);
  inv.lineCount = rawLines.length;
  out.invoices.push(inv);
}

function buildAcc(t, folder, out, seen, recon) {
  const linesByInv = new Map();
  for (const l of t.StockTransDetails || []) {
    if (l.Source !== 10 && l.Source !== 11) continue;
    if (!linesByInv.has(l.IUNo)) linesByInv.set(l.IUNo, []);
    linesByInv.get(l.IUNo).push(l);
  }
  const used = new Set();
  for (const r of t.Invoices) {
    if (r.Type !== 10 && r.Type !== 11) continue;
    if (!r.Date || r.Date < '1990') continue;
    if (r.Canceled) continue;
    const key = `A|${r.Date}|${r.Time}|${r.No}|${r.Total}|${r.MIOType}`;
    if (seen.has(key)) continue; // same book uploaded twice
    seen.add(key);
    used.add(r.IUNo);
    const sign = r.Type === 11 ? -1 : 1;
    const gross = sign * round2(n(r.Total));
    const net = sign * round2(n(r.NetTotal));
    const card = sign * n(r.ChequePayment);
    const account = sign * n(r.AccountAmount);
    const inv = makeInvoice({
      key, src: 'ACC', ref: r.IUNo, receipt: r.No, date: r.Date, time: r.Time, sign,
      channel: r.MIOType === 0 ? 'Account' : 'POS', dealer: r.Dealer || '',
      gross, net, disc: round2(gross - net), discKind: discountKind(r, gross, net),
      card: round2(card), account: round2(account), cash: round2(net - card - account),
    });
    const raw = (linesByInv.get(r.IUNo) || []).map((l) => ({
      item: l.ItemNo ?? 0, name: l.Name, qty: sign * n(l.Quantity),
      gross: sign * round2(n(l.Quantity) * n(l.EntryUnitPrice)),
    }));
    finishInvoice(inv, raw, out, recon, 'Accounting', `Invoice ${r.IUNo} / receipt ${r.No ?? '-'}`);
  }
  for (const [iu, ls] of linesByInv) {
    if (!used.has(iu)) {
      recon.orphanLines.count += ls.length;
      recon.orphanLines.amount += ls.reduce((s, l) => s + n(l.Quantity) * n(l.EntryUnitPrice), 0);
    }
  }
}

function buildPos(t, folder, out, seen, recon) {
  const linesByInv = new Map();
  for (const l of t.CROldDetails || []) {
    if (!linesByInv.has(l.UNo)) linesByInv.set(l.UNo, []);
    linesByInv.get(l.UNo).push(l);
  }
  for (const r of t.CROldInvoices) {
    if (r.Type !== 10 && r.Type !== 11) continue;
    const date = r.WorkingDate || r.Date;
    if (!date || date < '1990') continue;
    const key = `P|${date}|${r.Time}|${r.No}|${r.Total}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const sign = r.Type === 11 ? -1 : 1;
    const gross = sign * round2(n(r.Total));
    const net = sign * round2(n(r.NetTotal));
    const card = sign * (n(r.CreditCardPayment) + n(r.ChequePayment));
    const account = sign * n(r.AmountOnDealer);
    const inv = makeInvoice({
      key, src: 'POS', ref: r.UNo, receipt: r.No, date, calDate: r.Date || date, time: r.Time, sign,
      channel: account && Math.abs(account) >= Math.abs(net) - EPS && net ? 'Account' : 'POS',
      dealer: r.Dealer || '',
      gross, net, disc: round2(gross - net), discKind: discountKind(r, gross, net),
      card: round2(Math.min(Math.abs(card), Math.abs(net)) * sign),
      account: round2(account),
      cash: 0,
    });
    inv.cash = round2(net - inv.card - inv.account);
    const raw = (linesByInv.get(r.UNo) || []).map((l) => ({
      item: l.ItemNo ?? 0, name: l.Name, qty: sign * n(l.Quantity),
      gross: sign * round2(l.QuantityPrice != null ? n(l.QuantityPrice) : n(l.Quantity) * n(l.UnitPrice)),
    }));
    finishInvoice(inv, raw, out, recon, 'POS history', `POS ticket ${r.UNo} / receipt ${r.No ?? '-'}`);
  }
}

// Per business day: sum of product lines must equal sum of invoices (gross and net).
export function dailyProductCheck(invoices) {
  const days = new Map();
  const get = (d) => days.get(d) || days.set(d, { date: d, invGross: 0, invNet: 0, lineGross: 0, lineNet: 0 }).get(d);
  for (const inv of invoices) {
    const r = get(inv.date);
    r.invGross += inv.gross; r.invNet += inv.net;
    for (const l of inv.lines) { r.lineGross += l.gross; r.lineNet += l.net; }
  }
  let failed = 0;
  const rows = [];
  for (const r of days.values()) {
    for (const k of ['invGross', 'invNet', 'lineGross', 'lineNet']) r[k] = round2(r[k]);
    r.ok = Math.abs(r.invGross - r.lineGross) < 0.02 && Math.abs(r.invNet - r.lineNet) < 0.02;
    if (!r.ok) failed++;
    rows.push(r);
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { days: rows.length, failed, rows };
}
