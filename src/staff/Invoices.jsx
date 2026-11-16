import { Fragment, useEffect, useMemo, useState } from 'react';
import { Tile } from './Accounting.jsx';
import { ocrImages } from '../lib/ocr.js';
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
/** data: URL -> Blob without fetch() (the site's CSP does not allow fetching data: URLs) */
const dataUrlToBlob = async (u) => {
  const [head, b64] = u.split(',');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: head.slice(5, head.indexOf(';')) || 'image/jpeg' });
};

// ---------------------------------------------------------------- scan invoices (one or many)
const STATUS = { waiting: ['', 'Waiting'], reading: ['warn', 'Reading…'], ready: ['ok', 'Ready'], error: ['bad', 'Could not read'], saving: ['warn', 'Saving…'], saved: ['ok', 'Saved ✓'] };
const linesSumOf = (inv) => r2(inv.lines.reduce((t, l) => t + numIn(l.total), 0));
const mismatchOf = (inv) => {
  if (!inv.lines.length) return false; // a bank / payment slip has no item lines, only the amount
  const s = linesSumOf(inv);
  return Math.abs(s - r2(numIn(inv.total) - numIn(inv.tax))) > 0.05 && Math.abs(s - numIn(inv.total)) > 0.05;
};

/** Accounting: scan one invoice or upload many (photos or PDFs); the AI reads each, you check, then save. */
export function InvoiceScan({ ctx, onDone }) {
  const { cats, accounts } = ctx;
  const [queue, setQueue] = useState([]); // [{ id, name, status, pages, text, invoice, meta, error, pay, checked }]
  const [open, setOpen] = useState(null); // id of the invoice being reviewed
  const [pagesOfOne, setPagesOfOne] = useState(false);
  const [useOcr, setUseOcr] = useState(() => { try { return localStorage.getItem('mc-ocr') !== '0'; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem('mc-ocr', useOcr ? '1' : '0'); } catch { /* ignore */ } }, [useOcr]);
  const [defaults, setDefaults] = useState({ category_id: '', status: 'unpaid', account_id: '' });
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [items, setItems] = useState([]);
  useEffect(() => { api('invoices').then((r) => setItems([...new Set(r.invoices.flatMap((i) => i.lines.map((l) => l.item)))].sort())).catch(() => {}); }, []);
  const upd = (id, patch) => setQueue((q) => q.map((x) => (x.id === id ? { ...x, ...(typeof patch === 'function' ? patch(x) : patch) } : x)));

  async function pick(e) {
    const files = [...e.target.files]; e.target.value = '';
    if (!files.length) return;
    setErr('');
    // several photos of ONE invoice, or one invoice per file
    const groups = pagesOfOne ? [files.slice(0, 4)] : files.slice(0, 50).map((f) => [f]);
    const added = groups.map((g, i) => ({ id: Date.now() + i, name: g.map((f) => f.name).join(' + '), files: g, status: 'waiting', pages: [], checked: true, pay: null }));
    setQueue((q) => [...q, ...added]);
    if (files.length > 50 && !pagesOfOne) setErr('Only the first 50 files were added. Add the rest after these are saved.');
    // read two at a time (the AI takes 10–30 seconds per invoice)
    let next = 0;
    const worker = async () => {
      while (next < added.length) {
        const it = added[next++];
        upd(it.id, { status: 'reading' });
        try {
          let images = [], text = '';
          for (const f of it.files) {
            if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) { const r = await readPdf(f); text += r.text; images.push(...r.images); } else images.push(await photoToDataUrl(f));
          }
          upd(it.id, { pages: images });
          let body = text.trim() ? { text } : null;
          // built-in OCR first: free and unlimited; the AI then only sorts the text (uses far less allowance)
          if (!body && useOcr && images.length) {
            upd(it.id, { step: 'Reading the text on this device…' });
            try {
              const o = await ocrImages(images.slice(0, 4), (m) => { if (m.status === 'loading language traineddata' || m.status === 'initializing api') upd(it.id, { step: 'Loading the text reader (first time only)…' }); });
              // Arabic printed text is read less reliably by the built-in reader: those go to the AI photo reading
              const arabic = (o.text.match(/[\u0600-\u06FF]/g) || []).length > 15;
              if (!arabic && o.confidence >= 60 && o.text.replace(/\s/g, '').length >= 60) body = { text: o.text, ocr: true };
            } catch { /* fall back to the AI reading the photo */ }
          }
          upd(it.id, { step: body?.ocr ? 'Sorting the lines (AI)…' : 'The AI is reading the photo…' });
          let r = await api('invoices/read', { method: 'POST', body: body || { images: images.slice(0, 4) } });
          // OCR misread only the VAT (e.g. 3 read as 8): lines are fine, so VAT = total − lines
          if (body?.ocr && r.invoice.lines.length && mismatchOf(r.invoice)) {
            const sum = linesSumOf(r.invoice), t = r2(numIn(r.invoice.total) - sum);
            if (t >= 0 && t <= sum * 0.3) r = { ...r, invoice: { ...r.invoice, tax: t, notes: [r.invoice.notes, `VAT set to ${t} (total − lines); please check it on the photo.`].filter(Boolean).join(' ') } };
          }
          // the text route did not give a clean result (no lines, or lines ≠ total): read the photo instead
          if (body?.ocr && ((!r.invoice.lines.length && r.invoice.doc_type !== 'payment') || mismatchOf(r.invoice))) {
            upd(it.id, { step: 'Checking again from the photo (AI)…' });
            try { r = await api('invoices/read', { method: 'POST', body: { images: images.slice(0, 4) } }); body = null; } catch { /* keep the text result; the checks show the problem */ }
          }
          const inv = { ...r.invoice, lines: r.invoice.lines.map((l, i) => ({ ...l, key: i })) };
          const sg = r.suggest || {};
          const pay = { ...(sg.category_id ? { category_id: String(sg.category_id) } : {}), ...(sg.status ? { status: sg.status } : {}), ...(sg.account_id ? { account_id: String(sg.account_id) } : {}) };
          setQueue((q) => {
            // the same document twice in this batch (same supplier and number, or same supplier, date and amount)
            const key = (v) => (v.supplier || '').trim().toLowerCase();
            const twin = q.find((o) => o.id !== it.id && o.invoice && key(o.invoice) === key(inv) && (
              (inv.invoice_no && o.invoice.invoice_no === inv.invoice_no) || (o.invoice.date === inv.date && Math.abs(numIn(o.invoice.total) - numIn(inv.total)) < 0.01)));
            return q.map((x) => (x.id !== it.id ? x : { ...x, status: 'ready', step: '', invoice: inv, pay, catFrom: sg.category_from,
              meta: { by: (body?.ocr ? 'built-in OCR + ' : '') + r.by, duplicate: r.duplicate, ocr: !!body?.ocr, twin: twin ? twin.name : null },
              checked: !r.duplicate && !twin }));
          });
        } catch (x) {
          upd(it.id, { status: 'error', step: '', error: x.message });
          if (/allowance/i.test(x.message)) { next = added.length; added.forEach((a) => setQueue((q) => q.map((y) => (y.id === a.id && y.status === 'waiting' ? { ...y, status: 'error', error: x.message } : y)))); }
        }
      }
    };
    await Promise.all([worker(), worker()]);
    if (added.length === 1) setOpen(added[0].id);
  }

  async function rereadVision(it) {
    upd(it.id, { status: 'reading', step: 'The AI is reading the photo…', error: '' });
    try {
      const r = await api('invoices/read', { method: 'POST', body: { images: it.pages.slice(0, 4) } });
      upd(it.id, { status: 'ready', step: '', invoice: { ...r.invoice, lines: r.invoice.lines.map((l, i) => ({ ...l, key: i })) }, meta: { by: r.by, duplicate: r.duplicate, ocr: false } });
    } catch (x) { upd(it.id, { status: 'ready', step: '', error: x.message }); }
  }

  async function saveOne(it) {
    const pay = { ...defaults, ...(it.pay || {}) };
    const inv = it.invoice;
    let receipt = null;
    if (it.pages[0]) receipt = (await api('receipts', { method: 'POST', raw: await dataUrlToBlob(it.pages[0]), type: 'image/jpeg' })).receipt;
    await api('invoices', { method: 'POST', body: {
      invoice: { ...inv, total: numIn(inv.total), tax: numIn(inv.tax), subtotal: numIn(inv.subtotal), lines: inv.lines.map((l) => ({ ...l, qty: numIn(l.qty), unit_price: numIn(l.unit_price), total: numIn(l.total) })) },
      category_id: Number(pay.category_id) || null, status: pay.status, account_id: Number(pay.account_id) || null,
      paid_date: pay.paid_date || inv.date, due_date: pay.due_date || inv.date, receipt, raw: { by: it.meta?.by }, allow_no_lines: !inv.lines.length,
    } });
  }
  async function saveChecked(list) {
    setErr(''); setBusy('Saving…');
    let ok = 0, total = 0;
    for (const it of list) {
      upd(it.id, { status: 'saving' });
      try { await saveOne(it); upd(it.id, { status: 'saved', checked: false }); ok++; total += numIn(it.invoice.total); } catch (x) { upd(it.id, { status: 'ready', error: x.message }); }
    }
    setBusy(''); setOpen(null);
    if (ok) onDone?.(`Saved ${ok} invoice${ok === 1 ? '' : 's'} · ${money2(total)}.`);
  }

  const ready = queue.filter((x) => x.status === 'ready');
  const toSave = ready.filter((x) => x.checked);
  const missingCat = toSave.some((x) => !(x.pay?.category_id || defaults.category_id));
  const missingAcc = toSave.some((x) => { const p = { ...defaults, ...(x.pay || {}) }; return p.status === 'paid' && !p.account_id; });
  const current = queue.find((x) => x.id === open);
  const reading = queue.some((x) => x.status === 'reading' || x.status === 'waiting');

  return (
    <div className="card">
      <div className="card-head"><div><h2>📷 Scan invoices</h2><p>Photos or PDFs of supplier invoices or receipts, one or many at once. The AI reads the supplier, date, every line, the amounts and VAT (Turkish, Arabic or English) and writes the items in English. Check, then save.</p></div></div>
      <label className="scan-drop">
        <input type="file" accept="image/*,application/pdf" multiple onChange={pick} />
        <span className="scan-ic" aria-hidden="true">📷</span>
        <b>{reading ? 'Reading… you can add more' : 'Take a photo or choose files'}</b>
        <small>{pagesOfOne ? 'The photos you choose now are pages of ONE invoice (up to 4)' : 'Each file is a separate invoice · JPG, PNG or PDF · up to 50 at once'}</small>
      </label>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 8 }}>
        <label className="check" style={{ display: 'inline-flex', gap: 6, fontSize: 14 }}><input type="checkbox" checked={pagesOfOne} onChange={(e) => setPagesOfOne(e.target.checked)} /> The next photos are pages of one invoice</label>
        <label className="check" style={{ display: 'inline-flex', gap: 6, fontSize: 14 }} title="Reads the text on this device (free, no limit); the AI only sorts it into lines. Uses much less of the free AI allowance."><input type="checkbox" checked={useOcr} onChange={(e) => setUseOcr(e.target.checked)} /> Read the text on this device first (saves AI allowance)</label>
      </div>
      {err && <div className="banner bad" role="alert"><span>{err}</span></div>}

      {queue.length > 0 && (
        <>
          <div className="table-wrap" style={{ marginTop: 12 }}><table>
            <thead><tr><th><input type="checkbox" aria-label="Select all ready" checked={ready.length > 0 && ready.every((x) => x.checked)} onChange={(e) => setQueue((q) => q.map((x) => (x.status === 'ready' ? { ...x, checked: e.target.checked } : x)))} /></th><th>File</th><th>Status</th><th>Supplier / paid to</th><th>Date</th><th className="r">Lines</th><th className="r">Total</th><th>Category</th><th>Check</th><th /></tr></thead>
            <tbody>{queue.map((x) => {
              const inv = x.invoice;
              return (
                <tr key={x.id} className={open === x.id ? 'row-open' : ''}>
                  <td>{x.status === 'ready' && <input type="checkbox" checked={!!x.checked} onChange={(e) => upd(x.id, { checked: e.target.checked })} aria-label="Save this one" />}</td>
                  <td className="wrap-cell" style={{ maxWidth: 200 }}>{x.name}</td>
                  <td><span className={'pill ' + STATUS[x.status][0]}>{STATUS[x.status][1]}</span>{x.step && <><br /><small className="muted">{x.step}</small></>}{x.error && <><br /><small style={{ color: 'var(--bad-text)' }}>{x.error}</small></>}</td>
                  <td>{inv?.supplier || '–'}</td>
                  <td>{inv?.date ? longDate(inv.date) : '–'}</td>
                  <td className="r num">{inv ? (inv.lines.length || '–') : '–'}</td>
                  <td className="r num">{inv ? money2(numIn(inv.total)) : '–'}</td>
                  <td>{inv && x.status !== 'saved' ? (
                    <><select className="cell-input" style={{ minWidth: 150 }} value={x.pay?.category_id || defaults.category_id || ''} onChange={(e) => upd(x.id, (y) => ({ pay: { ...(y.pay || {}), category_id: e.target.value }, catFrom: 'you' }))} aria-label="Category">
                      <option value="">Choose…</option>{cats.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                      {x.catFrom && x.catFrom !== 'you' && <><br /><small className="muted">{x.catFrom === 'last time' ? 'as last time' : 'AI suggestion'}</small></>}</>
                  ) : '–'}</td>
                  <td>{inv && <>{!inv.lines.length ? <span className="pill">payment slip</span> : mismatchOf(inv) ? <span className="pill bad">totals differ</span> : <span className="pill ok">totals ✓</span>}{x.meta?.duplicate && <span className="pill bad">already saved?</span>}{x.meta?.twin && <span className="pill bad">same as {x.meta.twin}?</span>}{!inv.date && <span className="pill bad">no date</span>}</>}</td>
                  <td>{(x.status === 'ready' || x.status === 'saved') && <button className="btn small" onClick={() => setOpen(open === x.id ? null : x.id)}>{open === x.id ? 'Close' : x.status === 'saved' ? 'View' : 'Check'}</button>}
                    {x.status !== 'saving' && x.status !== 'reading' && <button className="btn small ghost" onClick={() => { setQueue((q) => q.filter((y) => y.id !== x.id)); if (open === x.id) setOpen(null); }} aria-label="Remove from the list">✕</button>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>

          {current?.invoice && current.meta?.ocr && current.status === 'ready' && (
            <div style={{ marginTop: 10 }}><button className="btn small" onClick={() => rereadVision(current)}>Something wrong? Read again from the photo (AI)</button></div>
          )}
          {current?.invoice && <Review it={current} cats={cats} accounts={accounts} items={items} defaults={defaults} upd={upd} readOnly={current.status === 'saved'}
            onSave={() => saveChecked([current])} busy={busy} />}

          {ready.length > 0 && (
            <div className="bulk-bar">
              <b>Save {toSave.length} of {ready.length} ready invoice{ready.length === 1 ? '' : 's'}</b>
              <label className="field"><span>Category for rows without one</span><select value={defaults.category_id} onChange={(e) => setDefaults({ ...defaults, category_id: e.target.value })}><option value="">Choose…</option>{cats.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <label className="field"><span>Payment</span><select value={defaults.status} onChange={(e) => setDefaults({ ...defaults, status: e.target.value })}><option value="paid">Paid (on the invoice date)</option><option value="scheduled">To be paid (on the invoice date)</option><option value="unpaid">Unpaid, no date yet</option></select></label>
              {defaults.status === 'paid' && <label className="field"><span>Paid from</span><select value={defaults.account_id} onChange={(e) => setDefaults({ ...defaults, account_id: e.target.value })}><option value="">Choose…</option>{accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
              <button className="btn primary" disabled={!toSave.length || !!busy || missingCat || missingAcc} onClick={() => saveChecked(toSave)}>{busy || `Save ${toSave.length} invoice${toSave.length === 1 ? '' : 's'}`}</button>
              {missingCat && <small className="muted">Choose a category for every ticked row.</small>}
              {missingAcc && <small className="muted">Choose “Paid from” for the paid ones (in Check, or here).</small>}
              {toSave.some((x) => mismatchOf(x.invoice)) && <small style={{ color: 'var(--bad-text)' }}>Some invoices’ lines don’t add up to their total: check them first.</small>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Review and correct one read invoice. */
function Review({ it, cats, accounts, items, defaults, upd, onSave, busy, readOnly }) {
  const inv = it.invoice;
  const pay = { ...defaults, ...(it.pay || {}) };
  const set = (patch) => upd(it.id, (x) => ({ invoice: { ...x.invoice, ...patch } }));
  const setPay = (patch) => upd(it.id, (x) => ({ pay: { ...(x.pay || {}), ...patch } }));
  const setLine = (k, patch) => upd(it.id, (x) => ({ invoice: { ...x.invoice, lines: x.invoice.lines.map((l) => {
    if (l.key !== k) return l;
    const n = { ...l, ...patch };
    if ('qty' in patch || 'unit_price' in patch) n.total = r2(numIn(n.qty) * numIn(n.unit_price));
    return n;
  }) } }));
  const linesSum = linesSumOf(inv);
  const mismatch = mismatchOf(inv);
  return (
    <fieldset className="review" disabled={readOnly}>
      <legend>{inv.supplier || it.name}</legend>
      {it.meta?.duplicate && <div className="banner bad"><span>⚠ This looks like an invoice already saved: {inv.supplier} {it.meta.duplicate.invoice_no ? `#${it.meta.duplicate.invoice_no}` : ''} on {longDate(it.meta.duplicate.date)} for {money2(it.meta.duplicate.total)}. It is unticked so it is not saved twice.</span></div>}
      <div className="scan-grid">
        {it.pages.length > 0 && <div className="scan-pages">{it.pages.map((p, i) => <a key={i} href={p} target="_blank" rel="noreferrer"><img src={p} alt={`Page ${i + 1}`} /></a>)}</div>}
        <div className="form-grid">
          <label className="field"><span>{inv.doc_type === 'payment' ? 'Paid to' : 'Supplier'}</span><input value={inv.supplier} onChange={(e) => set({ supplier: e.target.value })} /></label>
          {inv.doc_type === 'payment' && <label className="field"><span>What for</span><input value={inv.description || ''} onChange={(e) => set({ description: e.target.value })} /></label>}
          <label className="field"><span>{inv.doc_type === 'payment' ? 'Reference' : 'Invoice number'}</span><input value={inv.invoice_no} onChange={(e) => set({ invoice_no: e.target.value })} /></label>
          <label className="field"><span>Invoice date</span><input type="date" value={inv.date} onChange={(e) => set({ date: e.target.value })} /></label>
          <label className="field"><span>Currency</span><input value={inv.currency} onChange={(e) => set({ currency: e.target.value.toUpperCase().slice(0, 3) })} /></label>
        </div>
      </div>
      {inv.doc_type === 'payment' && !inv.lines.length && <p className="muted" style={{ margin: 0 }}>Bank / payment slip{inv.paid_from ? ` from ${inv.paid_from}` : ''}: no item lines, only the amount. It is saved as a paid record.</p>}
      <div className="table-wrap" hidden={inv.doc_type === 'payment' && !inv.lines.length}><table className="inv-lines">
        <thead><tr><th>Item (English)</th><th>On the invoice</th><th className="r">Qty</th><th>Unit</th><th className="r">Unit price</th><th className="r">Line total</th><th /></tr></thead>
        <tbody>{inv.lines.map((l) => (
          <tr key={l.key}>
            <td><input className="cell-input" list="inv-items" value={l.item} onChange={(e) => setLine(l.key, { item: e.target.value })} /></td>
            <td className="orig" dir="auto">{l.desc_orig}</td>
            <td className="r"><input className="cell-input num" inputMode="decimal" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} style={{ width: 70 }} /></td>
            <td><input className="cell-input" value={l.unit} onChange={(e) => setLine(l.key, { unit: e.target.value })} style={{ width: 70 }} /></td>
            <td className="r"><input className="cell-input num" inputMode="decimal" value={l.unit_price} onChange={(e) => setLine(l.key, { unit_price: e.target.value })} style={{ width: 90 }} /></td>
            <td className="r"><input className="cell-input num" inputMode="decimal" value={l.total} onChange={(e) => setLine(l.key, { total: e.target.value })} style={{ width: 100 }} /></td>
            <td><button className="btn small ghost" onClick={() => set({ lines: inv.lines.filter((x) => x.key !== l.key) })} aria-label="Remove line">✕</button></td>
          </tr>
        ))}</tbody>
      </table></div>
      <datalist id="inv-items">{items.map((n) => <option key={n} value={n} />)}</datalist>
      <div><button className="btn small" onClick={() => set({ lines: [...inv.lines, { key: Date.now(), item: '', desc_orig: '', qty: 1, unit: '', unit_price: 0, total: 0 }] })}>＋ Add a line</button></div>
      <div className="form-grid">
        <label className="field"><span>VAT (KDV)</span><input inputMode="decimal" value={inv.tax} onChange={(e) => set({ tax: e.target.value })} /></label>
        <label className="field"><span>Invoice total (to pay)</span><input inputMode="decimal" value={inv.total} onChange={(e) => set({ total: e.target.value })} /></label>
      </div>
      <p className={'banner ' + (mismatch ? 'bad' : 'ok')} style={{ margin: 0 }}><span>Lines add up to <b>{money2(linesSum)}</b>{numIn(inv.tax) ? ` + VAT ${money2(numIn(inv.tax))} = ${money2(r2(linesSum + numIn(inv.tax)))}` : ''}. Invoice total: <b>{money2(numIn(inv.total))}</b>. {mismatch ? 'They do not match: check the lines against the photo.' : 'They match ✓'}</span></p>
      {inv.notes && <p className="muted" style={{ margin: 0 }}>AI note: {inv.notes}</p>}
      <div className="form-grid">
        <label className="field"><span>Category</span><select value={pay.category_id} onChange={(e) => setPay({ category_id: e.target.value })}><option value="">Choose…</option>{cats.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="field"><span>Payment</span><select value={pay.status} onChange={(e) => setPay({ status: e.target.value })}><option value="paid">Paid</option><option value="scheduled">To be paid on a date</option><option value="unpaid">Unpaid, no date yet</option></select></label>
        {pay.status === 'paid' && <label className="field"><span>Paid from</span><select value={pay.account_id} onChange={(e) => setPay({ account_id: e.target.value })}><option value="">Choose…</option>{accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
        {pay.status === 'paid' && <label className="field"><span>Payment date</span><input type="date" value={pay.paid_date || inv.date} onChange={(e) => setPay({ paid_date: e.target.value })} /></label>}
        {pay.status === 'scheduled' && <label className="field"><span>Due date</span><input type="date" value={pay.due_date || inv.date} onChange={(e) => setPay({ due_date: e.target.value })} /></label>}
      </div>
      {!readOnly && <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn primary" onClick={onSave} disabled={!!busy || !pay.category_id}>{busy || 'Save this invoice'}</button>
        <span className="faint" style={{ fontSize: 12.5 }}>Read by {it.meta?.by}. Saved as one accounting record (the total, with the photo) plus its lines for Item costs.</span>
      </div>}
    </fieldset>
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
