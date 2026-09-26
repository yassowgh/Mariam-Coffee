// Aggregations over the reconciled model. All amounts use the chosen basis
// ('net' = after discount, 'gross' = before discount).

import { UNALLOCATED } from './model.js';

export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_START_HOUR = 5; // hours 0–4 belong to the previous business day

export function addDays(iso, d) {
  const t = new Date(iso + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
}
export function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}
export function monthDays(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
export const hourOrder = (h) => (h - DAY_START_HOUR + 24) % 24;

export function filterInvoices(model, { from, to, channel }) {
  return model.invoices.filter((i) =>
    (!from || i.date >= from) && (!to || i.date <= to) && (channel === 'all' || !channel || i.channel === channel));
}

function empty() {
  return { orders: 0, returns: 0, gross: 0, disc: 0, net: 0, qty: 0, cash: 0, card: 0, account: 0, days: new Set() };
}
function add(s, i) {
  if (i.sign > 0) s.orders++; else s.returns++;
  s.gross += i.gross; s.disc += i.disc; s.net += i.net; s.qty += i.qty;
  s.cash += i.cash; s.card += i.card; s.account += i.account;
  s.days.add(i.date);
}
function finish(s, basis) {
  s.amount = basis === 'gross' ? s.gross : s.net;
  s.avgTicket = s.orders ? s.amount / s.orders : 0;
  s.dayCount = s.days.size;
  s.avgPerDay = s.dayCount ? s.amount / s.dayCount : 0;
  s.itemsPerOrder = s.orders ? s.qty / s.orders : 0;
  s.discPct = s.gross ? s.disc / s.gross : 0;
  return s;
}

export function summarize(invs, basis) {
  const s = empty();
  for (const i of invs) add(s, i);
  return finish(s, basis);
}

export function groupInvoices(invs, keyFn, basis) {
  const m = new Map();
  for (const i of invs) {
    const k = keyFn(i);
    let s = m.get(k);
    if (!s) { s = empty(); s.key = k; m.set(k, s); }
    add(s, i);
  }
  for (const s of m.values()) finish(s, basis);
  return m;
}

export function monthlyRows(invs, basis) {
  const rows = [...groupInvoices(invs, (i) => i.month, basis).values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  rows.forEach((r, idx) => {
    const prev = rows[idx - 1];
    r.change = prev && prev.amount ? (r.amount - prev.amount) / prev.amount : null;
  });
  return rows;
}

export function dailyRows(invs, basis) {
  const m = groupInvoices(invs, (i) => i.date, basis);
  const rows = [...m.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  for (const r of rows) {
    r.dow = new Date(r.key + 'T00:00:00Z').getUTCDay();
    const lw = m.get(addDays(r.key, -7));
    r.vsLastWeek = lw && lw.amount ? (r.amount - lw.amount) / lw.amount : null;
    r.lastWeekAmount = lw ? lw.amount : null;
  }
  return rows;
}

export function hourlyRows(invs, basis) {
  const m = groupInvoices(invs, (i) => i.hour, basis);
  const total = [...m.values()].reduce((s, r) => s + r.amount, 0);
  const allDays = new Set(invs.map((i) => i.date)).size || 1;
  const rows = [...m.values()].sort((a, b) => hourOrder(a.key) - hourOrder(b.key));
  for (const r of rows) {
    r.share = total ? r.amount / total : 0;
    r.avgPerDay = r.amount / allDays;
    r.ordersPerDay = r.orders / allDays;
  }
  return rows;
}

// weekday x hour average amount per occurrence of that weekday
export function heatmap(invs, basis) {
  const cells = new Map();
  const dowDays = Array.from({ length: 7 }, () => new Set());
  for (const i of invs) {
    dowDays[i.dow].add(i.date);
    const k = i.dow * 24 + i.hour;
    const c = cells.get(k) || { amount: 0, orders: 0 };
    c.amount += basis === 'gross' ? i.gross : i.net;
    if (i.sign > 0) c.orders++;
    cells.set(k, c);
  }
  const out = [];
  for (let d = 0; d < 7; d++) {
    const n = dowDays[d].size || 1;
    for (let h = 0; h < 24; h++) {
      const c = cells.get(d * 24 + h);
      out.push({ dow: d, hour: h, amount: c ? c.amount / n : 0, orders: c ? c.orders / n : 0, weeks: dowDays[d].size });
    }
  }
  return out;
}

export function weekdayRows(invs, basis) {
  const m = groupInvoices(invs, (i) => i.dow, basis);
  return [1, 2, 3, 4, 5, 6, 0].map((d) => {
    const s = m.get(d) || finish(empty(), basis);
    return { key: d, label: DOW[d], avgPerDay: s.avgPerDay, avgOrders: s.dayCount ? s.orders / s.dayCount : 0, days: s.dayCount, amount: s.amount };
  });
}

/** Product stats for invoices passing `test`. */
export function productStats(model, invSet, basis) {
  const m = new Map();
  let total = 0;
  for (const l of model.lines) {
    if (!invSet.has(l.inv)) continue;
    let p = m.get(l.item);
    if (!p) {
      p = { key: l.item, name: model.products.get(l.item)?.name ?? `Item ${l.item}`, qty: 0, gross: 0, net: 0, orders: new Set(), lastDate: '' };
      m.set(l.item, p);
    }
    p.qty += l.qty; p.gross += l.gross; p.net += l.net;
    if (l.inv.sign > 0) p.orders.add(l.inv);
    if (l.inv.date > p.lastDate) p.lastDate = l.inv.date;
    total += basis === 'gross' ? l.gross : l.net;
  }
  for (const p of m.values()) {
    p.amount = basis === 'gross' ? p.gross : p.net;
    p.disc = p.gross - p.net;
    p.orderCount = p.orders.size;
    p.share = total ? p.amount / total : 0;
    p.avgPrice = p.qty ? p.gross / p.qty : 0;
    p.unallocated = p.key === UNALLOCATED;
  }
  return { map: m, total };
}

export function productRows(model, invs, prevInvs, basis) {
  const cur = productStats(model, new Set(invs), basis);
  const prev = prevInvs ? productStats(model, new Set(prevInvs), basis) : null;
  const rows = [...cur.map.values()];
  if (prev) {
    for (const p of rows) {
      const q = prev.map.get(p.key);
      p.prevAmount = q ? q.amount : 0;
      p.prevQty = q ? q.qty : 0;
      p.delta = p.amount - p.prevAmount;
      p.change = p.prevAmount ? p.delta / p.prevAmount : null;
    }
    // products sold before but not now
    for (const q of prev.map.values()) {
      if (!cur.map.has(q.key)) {
        rows.push({ key: q.key, name: q.name, qty: 0, gross: 0, net: 0, amount: 0, disc: 0, orderCount: 0, share: 0, avgPrice: 0,
          prevAmount: q.amount, prevQty: q.qty, delta: -q.amount, change: -1, lastDate: q.lastDate, unallocated: q.unallocated });
      }
    }
  }
  rows.sort((a, b) => b.amount - a.amount);
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

/** Product x month pivot (like the owner's Excel). */
export function productMonthPivot(model, invs, basis) {
  const set = new Set(invs);
  const months = [...new Set(invs.map((i) => i.month))].sort();
  const m = new Map();
  for (const l of model.lines) {
    if (!set.has(l.inv)) continue;
    let p = m.get(l.item);
    if (!p) { p = { key: l.item, name: model.products.get(l.item)?.name ?? `Item ${l.item}`, total: 0, totalQty: 0 }; m.set(l.item, p); }
    const v = basis === 'gross' ? l.gross : l.net;
    p[l.inv.month] = (p[l.inv.month] || 0) + v;
    p['q' + l.inv.month] = (p['q' + l.inv.month] || 0) + l.qty;
    p.total += v; p.totalQty += l.qty;
  }
  return { months, rows: [...m.values()].sort((a, b) => b.total - a.total) };
}

/**
 * Projection of the month containing `lastDate`: actual so far plus, for each
 * remaining day, the average of that weekday over the previous 28 days.
 */
export function monthProjection(model, lastDate, basis, channel) {
  const month = lastDate.slice(0, 7);
  const invs = filterInvoices(model, { from: addDays(lastDate, -27), to: lastDate, channel });
  const byDow = weekdayRows(invs, basis);
  const avg = new Map(byDow.map((r) => [r.key, r.avgPerDay]));
  const mtd = summarize(filterInvoices(model, { from: month + '-01', to: lastDate, channel }), basis).amount;
  let rest = 0;
  const dim = monthDays(month);
  for (let d = Number(lastDate.slice(8, 10)) + 1; d <= dim; d++) {
    const iso = `${month}-${String(d).padStart(2, '0')}`;
    rest += avg.get(new Date(iso + 'T00:00:00Z').getUTCDay()) || 0;
  }
  return { month, mtd, projected: mtd + rest, remainingDays: dim - Number(lastDate.slice(8, 10)) };
}
