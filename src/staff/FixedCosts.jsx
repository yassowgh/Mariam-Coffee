import { useEffect, useMemo, useRef, useState } from 'react';
import { api, todayLocal } from '../lib/api.js';
import { readFixedCostFile, templateCsv } from '../lib/fixedImport.js';
import DataTable from '../components/DataTable.jsx';
import { money, money2, monthLabel } from '../format.js';

const nextMonth = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
};
const prevMonth = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
};

export default function FixedCosts() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null); // { file, layout, rows, needsMonth, month, skipped }
  const [msg, setMsg] = useState(null);
  const fileRef = useRef(null);
  const thisMonth = todayLocal().slice(0, 7);

  async function load() {
    try { setRows((await api('fixed-costs')).fixed); } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function pick(file) {
    setMsg(null);
    try {
      const r = await readFixedCostFile(file);
      setPreview({ ...r, file: file.name, month: thisMonth });
    } catch (e) { setMsg({ ok: false, text: `${file.name}: ${e.message}` }); }
  }
  async function importRows() {
    const list = preview.rows.map((r) => ({ ...r, month: r.month || preview.month }));
    const months = [...new Set(list.map((r) => r.month))].sort();
    const existing = months.filter((m) => rows?.some((r) => r.month === m));
    if (existing.length && !confirm(`This replaces the fixed costs already saved for ${existing.map(monthLabel).join(', ')}. Continue?`)) return;
    try {
      await api('fixed-costs', { method: 'POST', body: { rows: list, replaceMonths: true, source: preview.file } });
      setMsg({ ok: true, text: `Imported ${list.length} costs for ${months.map(monthLabel).join(', ')}.` });
      setPreview(null);
      load();
    } catch (e) { setMsg({ ok: false, text: e.message }); }
  }
  function downloadTemplate() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([templateCsv(thisMonth)], { type: 'text/csv;charset=utf-8' }));
    a.download = 'fixed-costs-template.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Fixed costs</h2>
            <p>Monthly costs such as rent, salaries and bills. They are taken off the gross profit in <b>Sales reports → Net profit</b>. Only you (the owner) can see this page.</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn primary" onClick={() => fileRef.current.click()}>⤒ Upload a file (.xlsx / .csv)</button>
            <button className="btn" onClick={downloadTemplate}>⬇ Template</button>
            <input ref={fileRef} type="file" accept=".xlsx,.csv,text/csv" hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) pick(f); }} />
          </div>
        </div>
        <p className="notice" style={{ margin: 0 }}>
          The file can have one row per cost with <b>Month</b>, <b>Item</b> and <b>Amount</b> columns, or one row per item with a column for each month (e.g. “Jan 2026”, “Feb 2026”). With only Item and Amount, you choose the month. Uploading a month again replaces it.
        </p>
        {msg && <div className={'banner ' + (msg.ok ? 'ok' : 'bad')} role="status" style={{ marginTop: 12, marginBottom: 0 }}><span>{msg.text}</span><button className="btn small ghost" onClick={() => setMsg(null)} aria-label="Dismiss">✕</button></div>}
      </div>

      {preview && <Preview preview={preview} setPreview={setPreview} onImport={importRows} />}
      {error && <div className="error" role="alert">{error}</div>}
      {rows && <Saved rows={rows} reload={load} thisMonth={thisMonth} />}
      <AddRow reload={load} thisMonth={thisMonth} />
    </div>
  );
}

function Preview({ preview, setPreview, onImport }) {
  const total = preview.rows.reduce((s, r) => s + r.amount, 0);
  const months = [...new Set(preview.rows.map((r) => r.month || preview.month))].sort();
  return (
    <div className="card" style={{ borderColor: 'var(--series-1)' }}>
      <div className="card-head">
        <div><h2>Check before importing: {preview.file}</h2>
          <p>{preview.rows.length} costs · {money2(total)} · {preview.layout === 'wide' ? 'one column per month' : preview.layout === 'long' ? 'one row per cost' : 'no month in the file'}
            {preview.skipped ? ` · ${preview.skipped} rows skipped (no amount or month)` : ''}</p></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {preview.needsMonth && <label className="field"><span>These costs are for</span>
            <input type="month" value={preview.month} onChange={(e) => e.target.value && setPreview({ ...preview, month: e.target.value })} /></label>}
          <button className="btn primary" onClick={onImport}>Import for {months.map(monthLabel).join(', ')}</button>
          <button className="btn ghost" onClick={() => setPreview(null)}>Cancel</button>
        </div>
      </div>
      <DataTable rows={preview.rows.map((r, i) => ({ ...r, key: i, month: r.month || preview.month }))} pageSize={50} exportName="fixed-costs-preview"
        columns={[
          { key: 'month', label: 'Month', fmt: monthLabel },
          { key: 'item', label: 'Item' },
          { key: 'amount', label: 'Amount', align: 'r', fmt: money2, total: 'sum' },
          { key: 'note', label: 'Note' },
        ]} />
    </div>
  );
}

function Saved({ rows, reload, thisMonth }) {
  const months = useMemo(() => [...new Set(rows.map((r) => r.month))].sort().reverse(), [rows]);
  const [month, setMonth] = useState(months[0] || thisMonth);
  useEffect(() => { if (!months.includes(month) && months.length) setMonth(months[0]); }, [months]);
  const shown = rows.filter((r) => r.month === month);
  // pivot: item x last 12 months
  const pivotMonths = months.slice(0, 12).reverse();
  const pivot = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      if (!pivotMonths.includes(r.month)) continue;
      const o = m.get(r.item) || { key: r.item, item: r.item };
      o[r.month] = (o[r.month] || 0) + r.amount;
      m.set(r.item, o);
    }
    return [...m.values()].map((o) => ({ ...o, total: pivotMonths.reduce((s, k) => s + (o[k] || 0), 0) }));
  }, [rows, pivotMonths.join()]);

  async function edit(r) {
    const v = prompt(`New amount for ${r.item} (${monthLabel(r.month)}), TL`, r.amount);
    if (v == null) return;
    try { await api('fixed-costs/' + r.id, { method: 'PATCH', body: { amount: v } }); reload(); } catch (e) { alert(e.message); }
  }
  async function remove(r) {
    if (!confirm(`Remove ${r.item} (${money2(r.amount)}) from ${monthLabel(r.month)}?`)) return;
    try { await api('fixed-costs/' + r.id, { method: 'DELETE' }); reload(); } catch (e) { alert(e.message); }
  }
  async function copyTo() {
    const target = prompt(`Copy the ${shown.length} costs of ${monthLabel(month)} to which month? (YYYY-MM)`, nextMonth(month));
    if (!target) return;
    if (!/^\d{4}-\d{2}$/.test(target)) { alert('Write the month like 2026-12.'); return; }
    if (rows.some((r) => r.month === target) && !confirm(`${monthLabel(target)} already has fixed costs. Replace them?`)) return;
    try {
      await api('fixed-costs', { method: 'POST', body: { rows: shown.map((r) => ({ month: target, item: r.item, amount: r.amount, note: r.note })), replaceMonths: true, source: `copy of ${month}` } });
      reload();
      setMonth(target);
    } catch (e) { alert(e.message); }
  }
  async function clearMonth() {
    if (!confirm(`Remove all fixed costs of ${monthLabel(month)}?`)) return;
    try { await api('fixed-costs?month=' + month, { method: 'DELETE' }); reload(); } catch (e) { alert(e.message); }
  }

  if (!rows.length) return <div className="card"><p className="muted" style={{ margin: 0 }}>No fixed costs saved yet. Upload a file or add them one by one below.</p></div>;
  return (
    <>
      <div className="card">
        <div className="card-head">
          <div><h2>{monthLabel(month)}</h2><p>{shown.length} items · total {money2(shown.reduce((s, r) => s + r.amount, 0))}</p></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="field"><span>Month</span>
              <select value={month} onChange={(e) => setMonth(e.target.value)}>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select></label>
            <button className="btn" onClick={copyTo} disabled={!shown.length}>Copy to another month</button>
            <button className="btn ghost" onClick={clearMonth} disabled={!shown.length}>Remove month</button>
          </div>
        </div>
        <DataTable rows={shown.map((r) => ({ ...r, key: r.id }))} exportName={`fixed-costs-${month}`} defaultSort={{ key: 'amount', dir: 'desc' }}
          columns={[
            { key: 'item', label: 'Item' },
            { key: 'amount', label: 'Amount', align: 'r', fmt: money2, total: 'sum', csv: (r) => r.amount.toFixed(2) },
            { key: 'note', label: 'Note', fmt: (v) => v || '–' },
            { key: 'source', label: 'From', fmt: (v) => v || '–' },
            { key: 'act', label: '', render: (r) => <span style={{ display: 'flex', gap: 4 }}><button className="btn small ghost" onClick={() => edit(r)}>Change</button><button className="btn small ghost" onClick={() => remove(r)}>Remove</button></span>, csv: () => '' },
          ]} />
      </div>
      {pivotMonths.length > 1 && (
        <div className="card">
          <div className="card-head"><div><h2>Month by month</h2><p>Last {pivotMonths.length} months with fixed costs.</p></div></div>
          <DataTable rows={pivot} exportName="fixed-costs-by-month" defaultSort={{ key: 'total', dir: 'desc' }} pageSize={200}
            columns={[
              { key: 'item', label: 'Item', name: true },
              ...pivotMonths.map((m) => ({ key: m, label: monthLabel(m), align: 'r', fmt: (v) => (v ? money(v) : '–'), total: 'sum', csv: (r) => (r[m] || 0).toFixed(2) })),
              { key: 'total', label: 'Total', align: 'r', fmt: money, total: 'sum', csv: (r) => r.total.toFixed(2) },
            ]} />
        </div>
      )}
    </>
  );
}

function AddRow({ reload, thisMonth }) {
  const [f, setF] = useState({ month: thisMonth, item: '', amount: '', note: '' });
  const [err, setErr] = useState('');
  async function add(e) {
    e.preventDefault();
    setErr('');
    try {
      await api('fixed-costs', { method: 'POST', body: f });
      setF({ ...f, item: '', amount: '', note: '' });
      reload();
    } catch (x) { setErr(x.message); }
  }
  return (
    <form className="card" onSubmit={add}>
      <div className="card-head"><div><h2>Add one cost</h2><p>Adds to the month; it does not replace what is there.</p></div></div>
      <div className="table-tools" style={{ marginBottom: 0 }}>
        <label className="field"><span>Month</span><input type="month" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} required /></label>
        <label className="field"><span>Item</span><input value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })} placeholder="e.g. Rent" required maxLength={80} /></label>
        <label className="field"><span>Amount (TL)</span><input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required style={{ width: 130 }} /></label>
        <label className="field"><span>Note</span><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={200} /></label>
        <button className="btn primary" type="submit">Add</button>
      </div>
      {err && <div className="error" role="alert">{err}</div>}
    </form>
  );
}

export { prevMonth };
