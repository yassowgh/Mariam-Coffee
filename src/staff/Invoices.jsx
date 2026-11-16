import { Fragment, useEffect, useMemo, useState } from 'react';
import { Tile } from './Accounting.jsx';
import { api, todayLocal } from '../lib/api.js';
import { longDate, money2 } from '../format.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const numIn = (v) => { const s = String(v ?? '').replace(/\s/g, ''); const t = s.includes(',') && !s.includes('.') ? s.replace(',', '.') : s.replace(/,/g, ''); const n = Number(t); return Number.isFinite(n) ? n : 0; };

/** Photo -> JPEG data URL, long side at most `max` px (sharp enough for the AI to read small print). */
async function photoToDataUrl(file, max = 2000) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That file is not a photo this browser can open.')); i.src = url; });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  } finally { URL.revokeObjectURL(url); }
}
/** PDF: its text when it has real text, otherwise up to 3 pages as images. */
async function readPdf(file) {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  let text = '';
  for (let p = 1; p <= Math.min(doc.numPages, 10); p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const rows = new Map();
    for (const it of tc.items) { const y = Math.round(it.transform[5]); const k = [...rows.keys()].find((q) => Math.abs(q - y) <= 2) ?? y; if (!rows.has(k)) rows.set(k, []); rows.get(k).push({ x: it.transform[4], s: it.str }); }
    text += [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, r]) => r.sort((a, b) => a.x - b.x).map((x) => x.s).join('  ')).join('\n') + '\n';
  }
  if (text.replace(/\s/g, '').length > 60) return { text, images: [] };
  const images = [];
  for (let p = 1; p <= Math.min(doc.numPages, 3); p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 2 });
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    images.push(c.toDataURL('image/jpeg', 0.85));
  }
  return { text: '', images };
}
const dataUrlToBlob = (u) => fetch(u).then((r) => r.blob());

// ---------------------------------------------------------------- scan an invoice
export function InvoiceScan({ ctx, onDone }) {
  const { cats, accounts } = ctx;
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [pages, setPages] = useState([]); // data URLs (to show and keep a photo)
  const [inv, setInv] = useState(null);
  const [meta, setMeta] = useState(null); // { by, duplicate }
  const [pay, setPay] = useState({ category_id: '', status: 'unpaid', account_id: '', paid_date: '', due_date: '' });
  const [items, setItems] = useState([]); // known item names, for consistent naming
  useEffect(() => { api('invoices').then((r) => setItems([...new Set(r.invoices.flatMap((i) => i.lines.map((l) => l.item)))].sort())).catch(() => {}); }, []);

  async function pick(e) {
    const files = [...e.target.files]; e.target.value = '';
    if (!files.length) return;
    setErr(''); setInv(null); setMeta(null);
    try {
      setBusy('Preparing the file…');
      let images = [], text = '';
      for (const f of files.slice(0, 4)) {
        if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) { const r = await readPdf(f); text += r.text; images.push(...r.images); } else images.push(await photoToDataUrl(f));
      }
      setPages(images);
      setBusy('The AI is reading the invoice… (10–30 seconds)');
      const r = await api('invoices/read', { method: 'POST', body: text.trim() ? { text } : { images: images.slice(0, 4) } });
      setInv({ ...r.invoice, lines: r.invoice.lines.map((l, i) => ({ ...l, key: i })) });
      setMeta({ by: r.by, duplicate: r.duplicate });
      setPay((p) => ({ ...p, due_date: p.due_date || r.invoice.date || todayLocal(), paid_date: p.paid_date || r.invoice.date || todayLocal() }));
    } catch (x) { setErr(x.message); } finally { setBusy(''); }
  }
  const set = (patch) => setInv((v) => ({ ...v, ...patch }));
  const setLine = (k, patch) => setInv((v) => ({ ...v, lines: v.lines.map((l) => {
    if (l.key !== k) return l;
    const n = { ...l, ...patch };
    if ('qty' in patch || 'unit_price' in patch) n.total = r2(numIn(n.qty) * numIn(n.unit_price));
    return n;
  }) }));
  const linesSum = inv ? r2(inv.lines.reduce((t, l) => t + numIn(l.total), 0)) : 0;
  const expected = inv ? r2(numIn(inv.total) - numIn(inv.tax)) : 0;
  const mismatch = inv && Math.abs(linesSum - expected) > 0.05 && Math.abs(linesSum - numIn(inv.total)) > 0.05;

  async function save() {
    setErr(''); setBusy('Saving…');
    try {
      let receipt = null;
      if (pages[0]) receipt = (await api('receipts', { method: 'POST', raw: await dataUrlToBlob(pages[0]), type: 'image/jpeg' })).receipt;
      const body = {
        invoice: { ...inv, total: numIn(inv.total), tax: numIn(inv.tax), subtotal: numIn(inv.subtotal), lines: inv.lines.map((l) => ({ ...l, qty: numIn(l.qty), unit_price: numIn(l.unit_price), total: numIn(l.total) })) },
        ...pay, category_id: Number(pay.category_id) || null, account_id: Number(pay.account_id) || null, receipt, raw: { by: meta?.by },
      };
      await api('invoices', { method: 'POST', body });
      setInv(null); setPages([]); setMeta(null);
      onDone?.(`Saved: ${inv.supplier || 'invoice'} · ${money2(numIn(inv.total))} · ${inv.lines.length} items.`);
    } catch (x) { setErr(x.message); } finally { setBusy(''); }
  }

  return (
    <div className="card">
      <div className="card-head"><div><h2>📷 Scan an invoice</h2><p>Take a photo of a supplier invoice or receipt (or upload a PDF). The AI reads the supplier, date, every line, the amounts and VAT, in Turkish, Arabic or English, and writes the items in English. Check it, then save.</p></div></div>
      {!inv && (
        <label className="scan-drop">
          <input type="file" accept="image/*,application/pdf" multiple onChange={pick} disabled={!!busy} />
          <span className="scan-ic" aria-hidden="true">📷</span>
          <b>{busy || 'Take a photo or choose a file'}</b>
          <small>Photo (JPG/PNG) or PDF · up to 4 pages · flat, straight and well lit</small>
        </label>
      )}
      {err && <div className="banner bad" role="alert"><span>{err}</span></div>}
      {inv && (
        <div className="stack" style={{ gap: 14 }}>
          {meta?.duplicate && <div className="banner bad"><span>⚠ This looks like an invoice already saved: {inv.supplier} {meta.duplicate.invoice_no ? `#${meta.duplicate.invoice_no}` : ''} on {longDate(meta.duplicate.date)} for {money2(meta.duplicate.total)}. Check before saving it twice.</span></div>}
          <div className="scan-grid">
            {pages.length > 0 && <div className="scan-pages">{pages.map((p, i) => <a key={i} href={p} target="_blank" rel="noreferrer"><img src={p} alt={`Page ${i + 1}`} /></a>)}</div>}
            <div className="form-grid">
              <label className="field"><span>Supplier</span><input value={inv.supplier} onChange={(e) => set({ supplier: e.target.value })} /></label>
              <label className="field"><span>Invoice number</span><input value={inv.invoice_no} onChange={(e) => set({ invoice_no: e.target.value })} /></label>
              <label className="field"><span>Invoice date</span><input type="date" value={inv.date} onChange={(e) => set({ date: e.target.value })} /></label>
              <label className="field"><span>Currency</span><input value={inv.currency} onChange={(e) => set({ currency: e.target.value.toUpperCase().slice(0, 3) })} /></label>
            </div>
          </div>
          <div className="table-wrap"><table className="inv-lines">
            <thead><tr><th>Item (English)</th><th>On the invoice</th><th className="r">Qty</th><th>Unit</th><th className="r">Unit price</th><th className="r">Line total</th><th /></tr></thead>
            <tbody>{inv.lines.map((l) => (
              <tr key={l.key}>
                <td><input className="cell-input" list="inv-items" value={l.item} onChange={(e) => setLine(l.key, { item: e.target.value })} /></td>
                <td className="orig" dir="auto">{l.desc_orig}</td>
                <td className="r"><input className="cell-input num" inputMode="decimal" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} style={{ width: 70 }} /></td>
                <td><input className="cell-input" value={l.unit} onChange={(e) => setLine(l.key, { unit: e.target.value })} style={{ width: 70 }} /></td>
                <td className="r"><input className="cell-input num" inputMode="decimal" value={l.unit_price} onChange={(e) => setLine(l.key, { unit_price: e.target.value })} style={{ width: 90 }} /></td>
                <td className="r"><input className="cell-input num" inputMode="decimal" value={l.total} onChange={(e) => setLine(l.key, { total: e.target.value })} style={{ width: 100 }} /></td>
                <td><button className="btn small ghost" onClick={() => setInv((v) => ({ ...v, lines: v.lines.filter((x) => x.key !== l.key) }))} aria-label="Remove line">✕</button></td>
              </tr>
            ))}</tbody>
          </table></div>
          <datalist id="inv-items">{items.map((n) => <option key={n} value={n} />)}</datalist>
          <div><button className="btn small" onClick={() => setInv((v) => ({ ...v, lines: [...v.lines, { key: Date.now(), item: '', desc_orig: '', qty: 1, unit: '', unit_price: 0, total: 0 }] }))}>＋ Add a line</button></div>
          <div className="form-grid">
            <label className="field"><span>VAT (KDV)</span><input inputMode="decimal" value={inv.tax} onChange={(e) => set({ tax: e.target.value })} /></label>
            <label className="field"><span>Invoice total (to pay)</span><input inputMode="decimal" value={inv.total} onChange={(e) => set({ total: e.target.value })} /></label>
          </div>
          <p className={'banner ' + (mismatch ? 'bad' : 'ok')} style={{ margin: 0 }}><span>Lines add up to <b>{money2(linesSum)}</b>{numIn(inv.tax) ? ` + VAT ${money2(numIn(inv.tax))} = ${money2(r2(linesSum + numIn(inv.tax)))}` : ''}. Invoice total: <b>{money2(numIn(inv.total))}</b>. {mismatch ? 'They do not match: check the lines against the photo.' : 'They match ✓'}</span></p>
          {inv.notes && <p className="muted" style={{ margin: 0 }}>AI note: {inv.notes}</p>}
          <div className="form-grid">
            <label className="field"><span>Category</span><select value={pay.category_id} onChange={(e) => setPay({ ...pay, category_id: e.target.value })}><option value="">Choose…</option>{cats.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label className="field"><span>Payment</span><select value={pay.status} onChange={(e) => setPay({ ...pay, status: e.target.value })}><option value="paid">Paid</option><option value="scheduled">To be paid on a date</option><option value="unpaid">Unpaid, no date yet</option></select></label>
            {pay.status === 'paid' && <label className="field"><span>Paid from</span><select value={pay.account_id} onChange={(e) => setPay({ ...pay, account_id: e.target.value })}><option value="">Choose…</option>{accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
            {pay.status === 'paid' && <label className="field"><span>Payment date</span><input type="date" value={pay.paid_date} onChange={(e) => setPay({ ...pay, paid_date: e.target.value })} /></label>}
            {pay.status === 'scheduled' && <label className="field"><span>Due date</span><input type="date" value={pay.due_date} onChange={(e) => setPay({ ...pay, due_date: e.target.value })} /></label>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn primary" onClick={save} disabled={!!busy}>{busy || 'Save invoice'}</button>
            <button className="btn ghost" onClick={() => { setInv(null); setPages([]); setMeta(null); }}>Cancel</button>
            <span className="faint" style={{ fontSize: 12.5 }}>Read by {meta?.by}. It becomes one accounting record (the total) with its lines kept for Item costs.</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- item costs
const PERIODS = [['3m', 'Last 3 months', 92], ['month', 'This month', 0], ['year', 'This year', -1], ['all', 'All time', null]];

export function ItemCosts() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [period, setPeriod] = useState('3m');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const load = () => api('invoices').then((r) => setData(r.invoices)).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const today = todayLocal();
  const from = (() => {
    const p = PERIODS.find((x) => x[0] === period);
    if (p[2] === null) return '0000';
    if (p[2] === 0) return today.slice(0, 8) + '01';
    if (p[2] === -1) return today.slice(0, 5) + '01-01';
    return new Date(Date.parse(today) - p[2] * 86400000).toISOString().slice(0, 10);
  })();

  const rows = useMemo(() => {
    if (!data) return [];
    const by = new Map();
    for (const inv of data) for (const l of inv.lines) {
      const k = l.item.trim().toLowerCase();
      if (!by.has(k)) by.set(k, { item: l.item, buys: [] });
      by.get(k).buys.push({ ...l, date: inv.date, supplier: inv.supplier, invoice_no: inv.invoice_no, currency: inv.currency, unitPrice: l.unit_price || (l.qty ? l.total / l.qty : 0) });
    }
    return [...by.values()].map((x) => {
      const all = x.buys.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.invoice_id - a.invoice_id));
      const inP = all.filter((b) => b.date >= from);
      const last = all[0], prev = all.find((b) => b.date < last.date || (b !== last && b.invoice_id !== last.invoice_id));
      const prices = inP.map((b) => b.unitPrice).filter((v) => v > 0);
      const qty = inP.reduce((t, b) => t + (b.qty || 0), 0);
      const spent = inP.reduce((t, b) => t + (b.total || 0), 0);
      const change = prev && prev.unitPrice > 0 ? (last.unitPrice - prev.unitPrice) / prev.unitPrice : null;
      // cheapest supplier by their latest price
      const sup = new Map();
      for (const b of all) if (b.supplier && !sup.has(b.supplier)) sup.set(b.supplier, b.unitPrice);
      const cheapest = [...sup].sort((a, b) => a[1] - b[1])[0];
      return { ...x, all, inP, last, prev, change, qty, spent, avg: qty ? spent / qty : null, min: prices.length ? Math.min(...prices) : null, max: prices.length ? Math.max(...prices) : null, cheapest, suppliers: sup.size };
    }).filter((x) => (!q || x.item.toLowerCase().includes(q.toLowerCase())) && (period === 'all' || x.inP.length))
      .sort((a, b) => b.spent - a.spent);
  }, [data, from, q, period]);

  const total = rows.reduce((t, x) => t + x.spent, 0);
  const rises = rows.filter((x) => x.change != null && x.change >= 0.1).sort((a, b) => b.change - a.change);

  async function rename(x) {
    const name = prompt(`New name for “${x.item}” (use the same name as another item to merge them):`, x.item);
    if (!name || name.trim() === x.item) return;
    try { await api('invoice-lines/merge', { method: 'PATCH', body: { item: name.trim(), all_named: x.item } }); load(); } catch (e) { setErr(e.message); }
  }

  if (err) return <div className="error">{err}</div>;
  if (!data) return <div className="card"><p className="muted" style={{ margin: 0 }}>Loading…</p></div>;
  return (
    <div className="stack">
      <div className="card">
        <div className="card-head"><div><h2>Item costs</h2><p>What every item from your scanned invoices cost you: the last price, the change since the previous purchase, the average and the total spent. Unit prices are before VAT, as printed on the line.</p></div>
          <div className="seg" role="group" aria-label="Period">{PERIODS.map(([k, l]) => <button key={k} aria-pressed={period === k} onClick={() => setPeriod(k)}>{l}</button>)}</div>
        </div>
        {!data.length ? <p className="muted" style={{ margin: 0 }}>No invoices scanned yet. Use “📷 Scan invoice” and the items appear here.</p> : (
          <>
            <div className="kpis" style={{ marginBottom: 12 }}>
              <Tile label="Spent on items" value={money2(total)} sub={PERIODS.find((p) => p[0] === period)[1]} />
              <Tile label="Different items" value={rows.length} sub={`from ${data.length} invoices`} />
              <Tile label="Price went up 10% or more" value={rises.length} sub="since the previous purchase" bad={rises.length > 0} />
            </div>
            {rises.length > 0 && <div className="banner bad" style={{ marginBottom: 12 }}><span>Price rises: {rises.slice(0, 6).map((x) => `${x.item} +${Math.round(x.change * 100)}% (${money2(x.prev.unitPrice)} → ${money2(x.last.unitPrice)})`).join(' · ')}</span></div>}
            <label className="field" style={{ maxWidth: 320, marginBottom: 10 }}><span>Find an item</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. milk, cups" /></label>
            <div className="table-wrap"><table>
              <thead><tr><th>Item</th><th className="r">Last price</th><th className="r">Change</th><th className="r">Average</th><th className="r">Lowest–highest</th><th className="r">Qty</th><th className="r">Spent</th><th>Last bought</th><th /></tr></thead>
              <tbody>{rows.map((x) => (
                <Fragment key={x.item}>
                  <tr className={open === x.item ? 'row-open' : ''}>
                    <td><button className="linklike" onClick={() => setOpen(open === x.item ? null : x.item)}><b>{x.item}</b></button>{x.last.unit && <span className="faint"> / {x.last.unit}</span>}</td>
                    <td className="r num">{money2(x.last.unitPrice)}</td>
                    <td className="r num">{x.change == null ? <span className="faint">–</span> : <span className={'pill ' + (x.change >= 0.1 ? 'bad' : x.change <= -0.05 ? 'ok' : '')}>{x.change > 0 ? '+' : ''}{Math.round(x.change * 100)}%</span>}</td>
                    <td className="r num">{x.avg != null ? money2(x.avg) : '–'}</td>
                    <td className="r num">{x.min != null ? `${money2(x.min)} – ${money2(x.max)}` : '–'}</td>
                    <td className="r num">{Math.round(x.qty * 100) / 100}</td>
                    <td className="r num"><b>{money2(x.spent)}</b></td>
                    <td>{longDate(x.last.date)}<br /><small className="muted">{x.last.supplier}</small></td>
                    <td><button className="btn small ghost" onClick={() => rename(x)}>Rename / merge</button></td>
                  </tr>
                  {open === x.item && (
                    <tr><td colSpan={9} className="hist">
                      {x.suppliers > 1 && x.cheapest && <p style={{ margin: '0 0 6px' }}>Cheapest supplier now: <b>{x.cheapest[0]}</b> at {money2(x.cheapest[1])}{x.last.unit ? ` / ${x.last.unit}` : ''}.</p>}
                      <table className="inner"><thead><tr><th>Date</th><th>Supplier</th><th>On the invoice</th><th className="r">Qty</th><th className="r">Unit price</th><th className="r">Line total</th></tr></thead>
                        <tbody>{x.all.map((b) => <tr key={b.id}><td>{longDate(b.date)}</td><td>{b.supplier}{b.invoice_no ? ` #${b.invoice_no}` : ''}</td><td dir="auto">{b.desc_orig}</td><td className="r num">{b.qty} {b.unit}</td><td className="r num">{money2(b.unitPrice)}{b.currency !== 'TRY' ? ' ' + b.currency : ''}</td><td className="r num">{money2(b.total)}</td></tr>)}</tbody>
                      </table>
                    </td></tr>
                  )}
                </Fragment>
              ))}</tbody>
            </table></div>
          </>
        )}
      </div>
    </div>
  );
}
