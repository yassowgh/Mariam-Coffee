import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { linesToRecords, readExpenseFile } from '../lib/expenseFiles.js';
import { longDate, money } from '../format.js';

const ACCEPT = '.xlsx,.xls,.xlsm,.ods,.csv,.tsv,.txt,.pdf,.docx,.doc';

/** Accountants upload an expenses file; rows are checked here, then imported as records. The file itself is kept. */
export default function FileImport({ ctx, onDone }) {
  const { cats, accounts, today } = ctx;
  const [docs, setDocs] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const [prev, setPrev] = useState(null); // { doc, rows: [{...record, on}] , how }
  const ref = useRef(null);
  const loadDocs = () => api('documents').then((r) => setDocs(r.documents)).catch(() => setDocs([]));
  useEffect(() => { loadDocs(); }, []);

  // best guess of a category from the words, using categories already in use
  const guessCat = (r) => {
    if (r.category) { const c = cats.find((x) => x.name.toLowerCase() === r.category.toLowerCase()); if (c) return c.name; }
    const words = `${r.name || ''} ${r.payee || ''}`.toLowerCase();
    const past = ctx.records.find((x) => (x.name || '').toLowerCase() === (r.name || '').toLowerCase() || (r.payee && (x.payee || '').toLowerCase() === r.payee.toLowerCase()));
    if (past) return past.category;
    const rules = [[/milk|süt|sut|coffee|kahve|beans|syrup|şurup|ice|buz|redbull|water|su\b|nestle|cream|krema|cheese/, 'Bar Materials'], [/cup|bardak|ambalaj|packag|lid|kapak/, 'Ambalaj - Packaging'],
      [/clean|temiz|deterjan|soap/, 'Cleaning Materials'], [/taxi|taksi|uber|transport|nakliy/, 'Transport Fees'], [/fuel|benzin|shell|opet|petrol/, 'Fuel'],
      [/rent|kira/, 'Rents'], [/salar|maaş|maas|avans/, 'Salaries'], [/elektrik|electric|fatura|su fatur|internet|gas|doğalgaz/, 'Utilities Bills'], [/repair|tamir|fix/, 'Fix & Repair'], [/cake|sweet|tatlı|pastry/, 'Sweets Orders']];
    const hit = rules.find(([re, name]) => re.test(words) && cats.some((c) => c.name === name));
    return hit ? hit[1] : '';
  };

  async function pick(file) {
    setMsg(null); setPrev(null);
    try {
      setBusy('Reading the file…');
      const { table, text } = await readExpenseFile(file);
      let rows = table, how = 'columns of the table';
      if (!rows) {
        setBusy('Asking the AI to find the expenses in the text…');
        try { rows = (await api('expenses/extract', { method: 'POST', body: { text } })).records; how = 'AI (please check every line)'; } catch (e) {
          rows = linesToRecords(text); how = `line by line (${e.message})`;
        }
      }
      if (!rows.length) throw new Error('No expenses with an amount were found in this file.');
      setBusy('Saving a copy of the file…');
      const { document } = await api('documents', { method: 'POST', raw: file, type: file.type || 'application/octet-stream', headers: { 'x-filename': encodeURIComponent(file.name) } });
      setPrev({ doc: document, how, rows: rows.map((r, i) => ({ ...r, i, on: true, category: guessCat(r), date: r.date || today, account: r.account || '' })) });
      loadDocs();
    } catch (e) { setMsg({ ok: false, text: e.message }); } finally { setBusy(''); }
  }
  const setRow = (i, patch) => setPrev((p) => ({ ...p, rows: p.rows.map((r) => (r.i === i ? { ...r, ...patch } : r)) }));
  const setAll = (patch) => setPrev((p) => ({ ...p, rows: p.rows.map((r) => (r.on ? { ...r, ...patch } : r)) }));
  async function doImport() {
    const rows = prev.rows.filter((r) => r.on);
    const missing = rows.filter((r) => !r.category);
    if (missing.length) { setMsg({ ok: false, text: `Choose a category for ${missing.length} line${missing.length === 1 ? '' : 's'} (or untick them).` }); return; }
    setBusy('Importing…');
    try {
      const r = await api('expenses/import', { method: 'POST', body: { source: prev.doc.name, rows: rows.map((x) => ({
        import_ref: `${prev.doc.id}:${x.i}`, name: x.name, amount: x.amount, category: x.category, date: x.date, status: x.status,
        due_date: null, account: x.status === 'paid' ? x.account || null : null, payee: x.payee || null,
        reason: [x.notes, `From file: ${prev.doc.name}`].filter(Boolean).join(' · '), kind: 'regular',
      })) } });
      await api('documents/' + prev.doc.id, { method: 'PATCH', body: { records: r.added } }).catch(() => {});
      setMsg({ ok: true, text: `Imported ${r.added} records from ${prev.doc.name}${r.skipped ? ` (${r.skipped} were already imported)` : ''}.` });
      setPrev(null); loadDocs(); onDone?.();
    } catch (e) { setMsg({ ok: false, text: e.message }); } finally { setBusy(''); }
  }

  const on = prev?.rows.filter((r) => r.on) || [];
  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div><h2>Upload an expenses file</h2><p>Excel (.xlsx, .xls), CSV, TXT, PDF or Word (.docx). You check every line before anything is added. A copy of the file is kept below.</p></div>
          <button className="btn primary" onClick={() => ref.current.click()} disabled={!!busy}>⤒ Choose a file</button>
          <input ref={ref} type="file" accept={ACCEPT} hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) pick(f); }} />
        </div>
        {busy && <div className="notice">{busy}<div className="progress"><div style={{ width: '40%', animation: 'indet 1s ease-in-out infinite' }} /></div></div>}
        {msg && <div className={'banner ' + (msg.ok ? 'ok' : 'bad')} role="status"><span>{msg.text}</span></div>}
        {prev && (
          <>
            <p className="notice" style={{ margin: '0 0 10px' }}><b>{prev.doc.name}</b>: {prev.rows.length} lines found, read by {prev.how}. Ticked: {on.length} · {money(on.reduce((t, r) => t + r.amount, 0))}.</p>
            <div className="table-tools">
              <label className="field"><span>Set ticked lines: category</span><select defaultValue="" onChange={(e) => e.target.value && setAll({ category: e.target.value })}><option value="">–</option>{cats.filter((c) => c.active).map((c) => <option key={c.id}>{c.name}</option>)}</select></label>
              <label className="field"><span>Status</span><select defaultValue="" onChange={(e) => e.target.value && setAll({ status: e.target.value })}><option value="">–</option><option value="paid">Paid</option><option value="unpaid">Unpaid</option></select></label>
              <label className="field"><span>Paid from</span><select defaultValue="" onChange={(e) => setAll({ account: e.target.value })}><option value="">–</option>{accounts.filter((a) => a.active).map((a) => <option key={a.id}>{a.name}</option>)}</select></label>
              <label className="field"><span>Date</span><input type="date" onChange={(e) => e.target.value && setAll({ date: e.target.value })} /></label>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th><input type="checkbox" checked={on.length === prev.rows.length} onChange={(e) => setPrev((p) => ({ ...p, rows: p.rows.map((r) => ({ ...r, on: e.target.checked })) }))} aria-label="Tick all" /></th>
                  <th>Date</th><th>What</th><th className="r">Amount (TL)</th><th>Category</th><th>Paid to</th><th>Status</th><th>Paid from</th></tr></thead>
                <tbody>{prev.rows.map((r) => (
                  <tr key={r.i} style={r.on ? undefined : { opacity: 0.45 }}>
                    <td><input type="checkbox" checked={r.on} onChange={(e) => setRow(r.i, { on: e.target.checked })} aria-label="Include" /></td>
                    <td><input type="date" value={r.date} onChange={(e) => setRow(r.i, { date: e.target.value })} className="cell-input" /></td>
                    <td><input value={r.name} onChange={(e) => setRow(r.i, { name: e.target.value })} className="cell-input" style={{ minWidth: 180 }} /></td>
                    <td className="r"><input inputMode="decimal" value={r.amount} onChange={(e) => setRow(r.i, { amount: Number(e.target.value.replace(',', '.')) || 0 })} className="cell-input num" style={{ width: 100, textAlign: 'right' }} /></td>
                    <td><select value={r.category} onChange={(e) => setRow(r.i, { category: e.target.value })} className="cell-input" style={!r.category && r.on ? { borderColor: 'var(--bad)' } : undefined}>
                      <option value="">Choose…</option>{cats.filter((c) => c.active).map((c) => <option key={c.id}>{c.name}</option>)}</select></td>
                    <td><input value={r.payee} onChange={(e) => setRow(r.i, { payee: e.target.value })} className="cell-input" /></td>
                    <td><select value={r.status} onChange={(e) => setRow(r.i, { status: e.target.value })} className="cell-input"><option value="paid">Paid</option><option value="unpaid">Unpaid</option></select></td>
                    <td>{r.status === 'paid' ? <select value={r.account} onChange={(e) => setRow(r.i, { account: e.target.value })} className="cell-input"><option value="">–</option>{accounts.filter((a) => a.active).map((a) => <option key={a.id}>{a.name}</option>)}</select> : <span className="faint">–</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button className="btn primary big" onClick={doImport} disabled={!on.length || !!busy}>Import {on.length} records</button>
              <button className="btn big ghost" onClick={() => setPrev(null)}>Cancel</button>
            </div>
          </>
        )}
      </div>
      <div className="card">
        <div className="card-head"><div><h2>Uploaded files</h2><p>Every expenses file uploaded, kept for the records.</p></div></div>
        {docs == null ? <p className="muted">Loading…</p> : docs.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>File</th><th>Uploaded</th><th>By</th><th className="r">Records imported</th><th /></tr></thead>
            <tbody>{docs.map((d) => (
              <tr key={d.id}><td><a href={`/api/documents/${d.id}`}>{d.name}</a> <span className="faint">({Math.max(1, Math.round((d.size || 0) / 1024))} KB)</span></td>
                <td>{d.at ? longDate(d.at.slice(0, 10)) : '–'}</td><td>{d.by || '–'}</td><td className="r num">{d.records || 0}</td>
                <td>{ctx.owner && <button className="btn small ghost" onClick={async () => { if (confirm(`Delete the stored file ${d.name}? Records already imported stay.`)) { await api('documents/' + d.id, { method: 'DELETE' }).catch((e) => alert(e.message)); loadDocs(); } }}>Delete</button>}</td></tr>
            ))}</tbody>
          </table></div>
        ) : <p className="muted">No files uploaded yet.</p>}
      </div>
    </div>
  );
}
