import { useEffect, useMemo, useRef, useState } from 'react';
import { addDaysLocal, api, compressPhoto, hasRole, toLocal, todayLocal } from '../lib/api.js';
import DataTable from '../components/DataTable.jsx';
import { longDate, money, money2 } from '../format.js';

const NEW = '__new';
const PAY = { cash: 'Cash', card: 'Card', transfer: 'Bank transfer' };

export default function Expenses({ user }) {
  const owner = hasRole(user) && user.roles.includes('owner');
  const [cats, setCats] = useState([]);
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const today = todayLocal();
  const [range, setRange] = useState({ from: today.slice(0, 8) + '01', to: today });

  async function loadCats() {
    try { setCats((await api('categories')).categories); } catch (e) { setError(e.message); }
  }
  async function loadList() {
    try {
      const q = owner ? `?from=${range.from}&to=${range.to}` : `?from=${addDaysLocal(today, -90)}`;
      setList((await api('expenses' + q)).expenses);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { loadCats(); }, []);
  useEffect(() => { loadList(); }, [range.from, range.to]);

  async function remove(r) {
    if (!confirm(`Remove ${money2(r.amount)} for ${r.category} (${longDate(r.date)})?`)) return;
    try {
      await api('expenses/' + r.id, { method: 'DELETE' });
      setList((l) => l.filter((x) => x.id !== r.id));
    } catch (e) { alert(e.message); }
  }

  return (
    <div className="stack">
      <ExpenseForm cats={cats} owner={owner} onCats={setCats}
        onSaved={(row) => setList((l) => (owner && (row.date < range.from || row.date > range.to) ? l : [row, ...(l || [])]))} />
      {error && <div className="error" role="alert">{error}</div>}
      <ExpenseList list={list} owner={owner} user={user} range={range} setRange={setRange} onRemove={remove} />
      {owner && <ManageItems cats={cats} reload={loadCats} />}
    </div>
  );
}

function ExpenseForm({ cats, owner, onCats, onSaved }) {
  const [cat, setCat] = useState('');
  const [newName, setNewName] = useState('');
  const [amount, setAmount] = useState('');
  const [payment, setPayment] = useState('');
  const [reason, setReason] = useState('');
  const [photo, setPhoto] = useState(null); // { blob, url }
  const [date, setDate] = useState(todayLocal());
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const camRef = useRef(null), fileRef = useRef(null);
  const active = cats.filter((c) => c.active);

  async function pickPhoto(file) {
    if (!file) return;
    try {
      const blob = await compressPhoto(file);
      if (photo) URL.revokeObjectURL(photo.url);
      setPhoto({ blob, url: URL.createObjectURL(blob) });
    } catch (e) { setMsg({ ok: false, text: e.message }); }
  }
  async function addCategory() {
    if (!newName.trim()) return;
    try {
      const { category } = await api('categories', { method: 'POST', body: { name: newName } });
      onCats((cs) => (cs.some((c) => c.id === category.id) ? cs.map((c) => (c.id === category.id ? category : c)) : [...cs, category].sort((a, b) => a.name.localeCompare(b.name))));
      setCat(String(category.id));
      setNewName('');
    } catch (e) { setMsg({ ok: false, text: e.message }); }
  }
  async function submit(e) {
    e.preventDefault();
    setMsg(null);
    if (!cat || cat === NEW) { setMsg({ ok: false, text: 'Choose what the money was spent on, or add a new item.' }); return; }
    setBusy(true);
    try {
      let receipt = null;
      if (photo) receipt = (await api('receipts', { method: 'POST', raw: photo.blob, type: 'image/jpeg' })).receipt;
      const { expense } = await api('expenses', { method: 'POST', body: { category_id: Number(cat), amount, payment: payment || null, reason, receipt, ...(owner ? { date } : {}) } });
      onSaved(expense);
      setMsg({ ok: true, text: `Saved: ${money2(expense.amount)} for ${expense.category}, ${longDate(expense.date)}.` });
      setAmount(''); setReason(''); setPayment('');
      if (photo) URL.revokeObjectURL(photo.url);
      setPhoto(null);
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally { setBusy(false); }
  }

  return (
    <form className="card form-card" onSubmit={submit}>
      <div className="card-head"><div><h2>Record an expense</h2><p>{owner ? 'The date is today unless you change it.' : <>Date: <b>today, {longDate(todayLocal())}</b> (added automatically).</>}</p></div></div>
      <div className="form-grid">
        <label className="field"><span>Spent on</span>
          <select value={cat} onChange={(e) => setCat(e.target.value)} required>
            <option value="">Choose…</option>
            {active.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value={NEW}>＋ Add a new item…</option>
          </select>
        </label>
        {cat === NEW && (
          <div className="field"><span>New item name</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Ice" maxLength={60} style={{ flex: 1 }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCategory(); } }} />
              <button type="button" className="btn" onClick={addCategory}>Add</button>
            </div>
          </div>
        )}
        <label className="field"><span>Amount (TL)</span>
          <input className="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" required /></label>
        {owner && <label className="field"><span>Date</span><input type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} /></label>}
        <div className="field"><span>Paid by (optional)</span>
          <div className="seg" role="group" aria-label="Paid by">
            {Object.entries(PAY).map(([k, l]) => <button type="button" key={k} aria-pressed={payment === k} onClick={() => setPayment(payment === k ? '' : k)}>{l}</button>)}
          </div>
        </div>
        <label className="field wide"><span>Reason / details (optional)</span>
          <textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. 10 kg milk from Metro" /></label>
        <div className="field wide"><span>Receipt photo (optional)</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" className="btn" onClick={() => camRef.current.click()}>📷 Take photo</button>
            <button type="button" className="btn" onClick={() => fileRef.current.click()}>Choose photo</button>
            {photo && (<>
              <img src={photo.url} alt="Receipt preview" className="thumb" />
              <button type="button" className="btn small ghost" onClick={() => { URL.revokeObjectURL(photo.url); setPhoto(null); }}>Remove</button>
            </>)}
          </div>
          <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { pickPhoto(e.target.files[0]); e.target.value = ''; }} />
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { pickPhoto(e.target.files[0]); e.target.value = ''; }} />
        </div>
      </div>
      {msg && <div className={'banner ' + (msg.ok ? 'ok' : 'bad')} role="status" style={{ marginTop: 12 }}><span>{msg.text}</span></div>}
      <button className="btn primary big" type="submit" disabled={busy} style={{ marginTop: 12 }}>{busy ? 'Saving…' : 'Save expense'}</button>
    </form>
  );
}

function ExpenseList({ list, owner, user, range, setRange, onRemove }) {
  const today = todayLocal();
  const presets = [
    ['This month', today.slice(0, 8) + '01', today],
    ['Last month', prevMonthStart(today), addDaysLocal(today.slice(0, 8) + '01', -1)],
    ['Last 30 days', addDaysLocal(today, -29), today],
    ['This year', today.slice(0, 5) + '01-01', today],
  ];
  const byCat = useMemo(() => {
    const m = new Map();
    for (const r of list || []) m.set(r.category, (m.get(r.category) || 0) + r.amount);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [list]);
  const total = byCat.reduce((s, [, v]) => s + v, 0);
  const columns = [
    { key: 'date', label: 'Date', fmt: (v) => longDate(v), sortValue: (r) => r.created_at },
    { key: 'time', label: 'Entered', render: (r) => toLocal(r.created_at).time, csv: (r) => toLocal(r.created_at).time },
    { key: 'category', label: 'Spent on' },
    { key: 'amount', label: 'Amount', align: 'r', fmt: money2, total: 'sum', csv: (r) => r.amount.toFixed(2) },
    { key: 'payment', label: 'Paid by', fmt: (v) => PAY[v] || '–' },
    { key: 'reason', label: 'Reason', render: (r) => <span title={r.reason} className="wrap-cell">{r.reason || '–'}</span> },
    ...(owner ? [{ key: 'user_name', label: 'Entered by' }] : []),
    { key: 'receipt', label: 'Receipt', render: (r) => (r.receipt ? <a href={`/api/receipts/${r.receipt}`} target="_blank" rel="noreferrer">View</a> : <span className="faint">–</span>), csv: (r) => (r.receipt ? 'yes' : '') },
    { key: 'del', label: '', render: (r) => ((owner || (r.user_id === user.id && r.date === today))
      ? <button className="btn small ghost" onClick={() => onRemove(r)} aria-label="Remove this expense">Remove</button> : null), csv: () => '' },
  ];
  return (
    <div className="card">
      <div className="card-head">
        <div><h2>{owner ? 'Expenses' : 'Your expenses (last 90 days)'}</h2>
          <p>{owner ? `${longDate(range.from)} – ${longDate(range.to)}` : 'You can remove an entry on the day you made it. After that, ask the owner.'}</p></div>
        {owner && (
          <div className="table-tools" style={{ margin: 0 }}>
            <div className="chips">{presets.map(([l, f, t]) => <button key={l} className="chip" aria-pressed={range.from === f && range.to === t} onClick={() => setRange({ from: f, to: t })}>{l}</button>)}</div>
            <label className="field"><span>From</span><input type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} /></label>
            <label className="field"><span>To</span><input type="date" value={range.to} min={range.from} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} /></label>
          </div>
        )}
      </div>
      {list == null ? <p className="muted">Loading…</p> : (
        <>
          {byCat.length > 0 && (
            <ul className="barlist" style={{ marginBottom: 16 }}>
              {byCat.slice(0, 8).map(([name, v]) => (
                <li key={name}><span className="name">{name}</span><span className="val">{money(v)} · {Math.round((v / total) * 100)}%</span>
                  <div className="track"><div className="fill" style={{ width: `${(v / byCat[0][1]) * 100}%` }} /></div></li>
              ))}
            </ul>
          )}
          <DataTable columns={columns} rows={list.map((r) => ({ ...r, key: r.id }))} defaultSort={{ key: 'date', dir: 'desc' }}
            filters={{ search: 'category', amount: 'amount', amountLabel: 'Amount' }} exportName="expenses" footerNote={`total ${money2(total)}`} />
        </>
      )}
    </div>
  );
}
const prevMonthStart = (d) => {
  const [y, m] = d.split('-').map(Number);
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`;
};

function ManageItems({ cats, reload }) {
  const [open, setOpen] = useState(false);
  async function patch(c, body) {
    try { await api('categories/' + c.id, { method: 'PATCH', body }); reload(); } catch (e) { alert(e.message); }
  }
  return (
    <div className="card">
      <div className="card-head">
        <div><h2>Expense items</h2><p>Items marked <b>stock</b> are ingredients or goods for sale. The net-profit report leaves them out when it uses recipe costs, so they are not counted twice.</p></div>
        <button className="btn small" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Hide' : 'Manage items'}</button>
      </div>
      {open && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Item</th><th>Stock (in recipe costs)</th><th>In the list</th><th /></tr></thead>
            <tbody>
              {cats.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td><label className="check-inline"><input type="checkbox" checked={!!c.stock} onChange={(e) => patch(c, { stock: e.target.checked })} />Stock</label></td>
                  <td><label className="check-inline"><input type="checkbox" checked={!!c.active} onChange={(e) => patch(c, { active: e.target.checked })} />Shown</label></td>
                  <td><button className="btn small ghost" onClick={() => { const n = prompt('New name', c.name); if (n && n.trim() && n !== c.name) patch(c, { name: n.trim() }); }}>Rename</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
