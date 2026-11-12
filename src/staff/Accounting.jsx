import { useEffect, useMemo, useRef, useState } from 'react';
import { addDaysLocal, api, compressPhoto, todayLocal } from '../lib/api.js';
import { isNotionExport, notionRecords } from '../lib/notionImport.js';
import FileImport from './FileImport.jsx';
import DataTable from '../components/DataTable.jsx';
import { int, longDate, money, money2, monthLabel } from '../format.js';

export const ACCOUNT_TYPES = { cash: 'Cash', bank: 'Bank', person_loan: 'Loan from a person', bank_loan: 'Bank loan / credit' };
const KINDS = { regular: 'Regular', old_debt: 'Paying an old debt', advance: 'Advance (avans) to an employee', loan_repayment: 'Paying back a loan' };
const KIND_SHORT = { old_debt: 'old debt', advance: 'advance', loan_repayment: 'loan repayment' };
const PAYEE_TYPES = ['Vendor', 'Service Provider', 'Restaurant', 'Landlord', 'Gov', 'Hospital', 'Partner', 'Employee'];
const NEW = '__new';
export const total = (r) => r.amount + (r.fees || 0);
export const statusText = (r) => (r.status === 'paid' ? `Paid${r.account ? ' · ' + r.account : ''}` : r.status === 'scheduled' ? `Due ${longDate(r.due_date)}` : 'Unpaid, no date');

/** Records, categories, accounts and name suggestions, shared by Accounting and Finance. */
export function useAccountingData(user) {
  const owner = user.roles.includes('owner');
  const [data, setData] = useState(null); // { records, today }
  const [cats, setCats] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [names, setNames] = useState({ payees: [], employees: [], paidBy: [] });
  const [staff, setStaff] = useState([]);
  const [error, setError] = useState('');

  async function load() {
    try {
      const [r, c, a, n, u] = await Promise.all([api('expenses'), api('categories'), api('money-accounts'), api('expenses/payees'), api('users').catch(() => ({ users: [] }))]);
      setData(r); setCats(c.categories); setAccounts(a.accounts); setNames(n); setStaff(u.users);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);
  const records = data?.records || [];
  const today = data?.today || todayLocal();
  return { loaded: !!data, error, ctx: { user, owner, records, today, cats, setCats, accounts, setAccounts, names, staff, reload: load } };
}

/** Bookkeeping: add and correct records, categories and accounts, import. */
export default function Accounting({ user, go }) {
  const [view, setView] = useState('add');
  const [editing, setEditing] = useState(null); // a record being edited, or a prefilled new one
  const { loaded, error, ctx: base } = useAccountingData(user);
  const records = base.records;
  const open = records.filter((r) => r.status !== 'paid');
  const overdue = open.filter((r) => r.status === 'scheduled' && r.due_date < base.today);
  const ctx = { ...base, edit: (r) => { setEditing(r); setView('add'); window.scrollTo(0, 0); } };
  const tabs = [
    ['add', editing?.id ? 'Edit record' : '＋ New record'],
    ['records', `Records${records.length ? ` (${records.length})` : ''}`],
    ['accounts', 'Accounts & categories'],
    ['import', 'Upload files'],
  ];
  return (
    <div className="stack">
      <nav className="chips sub-tabs" aria-label="Accounting">
        {tabs.map(([k, l]) => <button key={k} className="chip" aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>)}
        {open.length > 0 && go && <button className="chip" onClick={() => go('finance')}>Finance: {open.length} to pay{overdue.length ? `, ${overdue.length} late` : ''} →</button>}
      </nav>
      {error && <div className="error" role="alert">{error}</div>}
      {!loaded ? <div className="card"><p className="muted" style={{ margin: 0 }}>Loading…</p></div> : (
        <>
          {view === 'add' && <RecordForm ctx={ctx} initial={editing} onDone={(rec) => { setEditing(null); base.reload(); if (rec) setView('records'); }} onCancel={editing ? () => { setEditing(null); setView('records'); } : null} />}
          {view === 'records' && <Records ctx={ctx} />}
          {view === 'accounts' && <AccountsSetup ctx={ctx} />}
          {view === 'import' && <><FileImport ctx={ctx} onDone={() => base.reload()} /><Import ctx={ctx} onDone={() => { base.reload(); setView('records'); }} /></>}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- form
function emptyForm(user) {
  return { name: '', category_id: '', amount: '', fees: '', date: todayLocal(), status: 'paid', account_id: '', paid_date: '', due_date: addDaysLocal(todayLocal(), 7), kind: 'regular', loan_account_id: '', payee: '', payee_type: '', employee: '', employee_user_id: '', paid_by: user.name, reason: '', receipt: null };
}

export function RecordForm({ ctx, initial, onDone, onCancel }) {
  const { user, cats, setCats, accounts, setAccounts, names, staff } = ctx;
  const isEdit = !!initial?.id;
  const [f, setF] = useState(() => ({ ...emptyForm(user), ...(initial ? clean(initial) : {}) }));
  const [newCat, setNewCat] = useState('');
  const [newAcc, setNewAcc] = useState({ name: '', type: 'person_loan' });
  const [photo, setPhoto] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const camRef = useRef(null), fileRef = useRef(null);
  useEffect(() => { setF({ ...emptyForm(user), ...(initial ? clean(initial) : {}) }); setMsg(null); }, [initial]);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const loans = accounts.filter((a) => a.active && (a.type === 'person_loan' || a.type === 'bank_loan'));

  async function addCategory() {
    if (!newCat.trim()) return;
    try {
      const { category } = await api('categories', { method: 'POST', body: { name: newCat } });
      setCats((cs) => (cs.some((c) => c.id === category.id) ? cs : [...cs, category].sort((a, b) => a.name.localeCompare(b.name))));
      set({ category_id: String(category.id) }); setNewCat('');
    } catch (e) { setMsg({ ok: false, text: e.message }); }
  }
  async function addAccount() {
    if (!newAcc.name.trim()) return;
    try {
      const { account } = await api('money-accounts', { method: 'POST', body: newAcc });
      setAccounts((as) => (as.some((x) => x.id === account.id) ? as : [...as, account]));
      set({ account_id: String(account.id) }); setNewAcc({ name: '', type: 'person_loan' });
    } catch (e) { setMsg({ ok: false, text: e.message }); }
  }
  async function pickPhoto(file) {
    if (!file) return;
    try {
      const blob = await compressPhoto(file);
      if (photo) URL.revokeObjectURL(photo.url);
      setPhoto({ blob, url: URL.createObjectURL(blob) });
    } catch (e) { setMsg({ ok: false, text: e.message }); }
  }
  async function submit(e) {
    e.preventDefault();
    setMsg(null);
    if (!f.category_id || f.category_id === NEW) { setMsg({ ok: false, text: 'Choose a category, or add a new one.' }); return; }
    if (f.account_id === NEW) { setMsg({ ok: false, text: 'Finish adding the new account first.' }); return; }
    setBusy(true);
    try {
      let receipt = f.receipt;
      if (photo) receipt = (await api('receipts', { method: 'POST', raw: photo.blob, type: 'image/jpeg' })).receipt;
      const body = { ...f, receipt, category_id: Number(f.category_id), account_id: f.account_id ? Number(f.account_id) : null,
        loan_account_id: f.loan_account_id ? Number(f.loan_account_id) : null, employee_user_id: f.employee_user_id ? Number(f.employee_user_id) : null,
        paid_date: f.paid_date || f.date,
        // a bill that was planned keeps its due date after it is paid (Finance shows it in that month)
        due_date: f.status === 'scheduled' ? f.due_date : initial?.due_date || null };
      const { record } = isEdit ? await api('expenses/' + initial.id, { method: 'PATCH', body }) : await api('expenses', { method: 'POST', body });
      setMsg({ ok: true, text: `${isEdit ? 'Saved' : 'Added'}: ${record.name}, ${money2(total(record))}, ${statusText(record).toLowerCase()}.` });
      if (photo) URL.revokeObjectURL(photo.url);
      setPhoto(null);
      if (isEdit) onDone(record);
      else { setF({ ...emptyForm(user), date: f.date, paid_by: f.paid_by }); onDone(null); }
    } catch (x) { setMsg({ ok: false, text: x.message }); } finally { setBusy(false); }
  }

  const groups = Object.entries(ACCOUNT_TYPES).map(([t, label]) => [label, accounts.filter((a) => a.active && a.type === t)]).filter(([, l]) => l.length);
  return (
    <form className="card form-card" onSubmit={submit}>
      <div className="card-head">
        <div><h2>{isEdit ? `Edit: ${initial.name}` : 'New accounting record'}</h2><p>Bills, purchases, salaries and advances. Paid now, to be paid on a date, or unpaid.</p></div>
        {onCancel && <button type="button" className="btn small ghost" onClick={onCancel}>Cancel</button>}
      </div>
      <div className="form-grid">
        <label className="field wide"><span>What is it for?</span>
          <input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Milk, October rent, Gönül salary" required maxLength={160} /></label>
        <label className="field"><span>Category</span>
          <select value={f.category_id} onChange={(e) => set({ category_id: e.target.value })} required>
            <option value="">Choose…</option>
            {cats.filter((c) => c.active || String(c.id) === String(f.category_id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value={NEW}>＋ New category…</option>
          </select></label>
        {f.category_id === NEW && (
          <div className="field"><span>New category</span>
            <div style={{ display: 'flex', gap: 8 }}><input value={newCat} onChange={(e) => setNewCat(e.target.value)} maxLength={60} style={{ flex: 1 }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCategory(); } }} />
              <button type="button" className="btn" onClick={addCategory}>Add</button></div></div>
        )}
        <label className="field"><span>Amount (TL)</span><input className="amount" inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="0.00" required /></label>
        <label className="field"><span>Transfer fees (TL, optional)</span><input inputMode="decimal" value={f.fees} onChange={(e) => set({ fees: e.target.value })} placeholder="0" /></label>
        <label className="field"><span>Expense date</span><input type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} /></label>

        <div className="field wide"><span>Payment</span>
          <div className="seg" role="group" aria-label="Payment status">
            <button type="button" aria-pressed={f.status === 'paid'} onClick={() => set({ status: 'paid' })}>Paid</button>
            <button type="button" aria-pressed={f.status === 'scheduled'} onClick={() => set({ status: 'scheduled' })}>To be paid on a date</button>
            <button type="button" aria-pressed={f.status === 'unpaid'} onClick={() => set({ status: 'unpaid' })}>Unpaid, no date yet</button>
          </div></div>
        {f.status === 'paid' && (
          <>
            <label className="field"><span>Paid from</span>
              <select value={f.account_id} onChange={(e) => set({ account_id: e.target.value })}>
                <option value="">Choose…</option>
                {groups.map(([label, list]) => <optgroup key={label} label={label}>{list.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>)}
                <option value={NEW}>＋ New account or loan…</option>
              </select></label>
            <label className="field"><span>Payment date</span><input type="date" value={f.paid_date || f.date} onChange={(e) => set({ paid_date: e.target.value })} /></label>
            {f.account_id === NEW && (
              <div className="field wide"><span>New account</span>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input value={newAcc.name} onChange={(e) => setNewAcc({ ...newAcc, name: e.target.value })} placeholder="e.g. Loan from Yaman, Garanti credit card" maxLength={60} style={{ flex: 1, minWidth: 180 }} />
                  <select value={newAcc.type} onChange={(e) => setNewAcc({ ...newAcc, type: e.target.value })}>{Object.entries(ACCOUNT_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                  <button type="button" className="btn" onClick={addAccount}>Add</button>
                </div></div>
            )}
          </>
        )}
        {f.status === 'scheduled' && <label className="field"><span>To be paid on</span><input type="date" value={f.due_date || ''} onChange={(e) => set({ due_date: e.target.value })} required /></label>}

        <label className="field"><span>Type</span>
          <select value={f.kind} onChange={(e) => set({ kind: e.target.value })}>{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        {f.kind === 'loan_repayment' && (
          <label className="field"><span>Which loan is paid back?</span>
            <select value={f.loan_account_id} onChange={(e) => set({ loan_account_id: e.target.value })} required>
              <option value="">Choose…</option>{loans.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select></label>
        )}
        <label className="field"><span>Paid to (company or person)</span>
          <input list="payees" value={f.payee} onChange={(e) => { const v = e.target.value; const known = names.payees.find((p) => p.name === v); set({ payee: v, ...(known?.type && !f.payee_type ? { payee_type: known.type } : {}) }); }} maxLength={120} />
          <datalist id="payees">{names.payees.map((p) => <option key={p.name} value={p.name} />)}</datalist></label>
        <label className="field"><span>Kind of payee</span>
          <select value={f.payee_type} onChange={(e) => set({ payee_type: e.target.value })}><option value="">–</option>{PAYEE_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
        <label className="field"><span>Employee (salary or advance)</span>
          <input list="employees" value={f.employee} onChange={(e) => { const v = e.target.value; const u = staff.find((s) => s.name.toLowerCase() === v.toLowerCase()); set({ employee: v, employee_user_id: u ? u.id : '' }); }} maxLength={80} />
          <datalist id="employees">{[...new Set([...staff.map((s) => s.name), ...names.employees.map((e) => e.name)])].map((n) => <option key={n} value={n} />)}</datalist></label>
        <label className="field"><span>Paid by (who handled it)</span>
          <input list="paidby" value={f.paid_by} onChange={(e) => set({ paid_by: e.target.value })} maxLength={60} />
          <datalist id="paidby">{names.paidBy.map((p) => <option key={p.name} value={p.name} />)}</datalist></label>
        <label className="field wide"><span>Notes (optional)</span><textarea rows={2} value={f.reason || ''} onChange={(e) => set({ reason: e.target.value })} maxLength={1000} /></label>
        <div className="field wide"><span>Receipt or invoice photo (optional)</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" className="btn" onClick={() => camRef.current.click()}>📷 Take photo</button>
            <button type="button" className="btn" onClick={() => fileRef.current.click()}>Choose photo</button>
            {photo && <img src={photo.url} alt="Receipt preview" className="thumb" />}
            {!photo && f.receipt && <a href={`/api/receipts/${f.receipt}`} target="_blank" rel="noreferrer">Current photo</a>}
          </div>
          <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { pickPhoto(e.target.files[0]); e.target.value = ''; }} />
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { pickPhoto(e.target.files[0]); e.target.value = ''; }} />
        </div>
      </div>
      {msg && <div className={'banner ' + (msg.ok ? 'ok' : 'bad')} role="status" style={{ marginTop: 12 }}><span>{msg.text}</span></div>}
      <button className="btn primary big" type="submit" disabled={busy} style={{ marginTop: 12 }}>{busy ? 'Saving…' : isEdit ? 'Save changes' : 'Add record'}</button>
    </form>
  );
}
const clean = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v == null ? '' : typeof v === 'number' && k.endsWith('_id') ? String(v) : v]));

// ---------------------------------------------------------------- records
function Records({ ctx }) {
  const { records, today, owner, user, cats, accounts } = ctx;
  const presets = [
    ['This month', today.slice(0, 8) + '01', today],
    ['Last month', prevMonthStart(today), addDaysLocal(today.slice(0, 8) + '01', -1)],
    ['Last 90 days', addDaysLocal(today, -89), today],
    ['All', '', ''],
  ];
  const [range, setRange] = useState({ from: '', to: '' });
  const [status, setStatus] = useState('');
  const [cat, setCat] = useState('');
  const [acc, setAcc] = useState('');
  const [payFor, setPayFor] = useState(null);
  const rows = useMemo(() => records.filter((r) =>
    (!range.from || (r.date || r.due_date || '') >= range.from) && (!range.to || (r.date || r.due_date || '') <= range.to)
    && (!status || r.status === status) && (!cat || String(r.category_id) === cat) && (!acc || String(r.account_id) === acc)
  ).map((r) => ({ ...r, key: r.id, total: total(r) })), [records, range, status, cat, acc]);
  const sum = (list) => list.reduce((t, r) => t + r.total, 0);
  const byMonth = useMemo(() => {
    const m = new Map();
    for (const r of rows) { if (!r.date) continue; const k = r.date.slice(0, 7); m.set(k, (m.get(k) || 0) + r.total); }
    return [...m].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 6);
  }, [rows]);
  const canEdit = (r) => owner || r.user_id === user.id;
  async function remove(r) {
    if (!confirm(`Delete “${r.name}” (${money2(r.total)})?`)) return;
    try { await api('expenses/' + r.id, { method: 'DELETE' }); ctx.reload(); } catch (e) { alert(e.message); }
  }
  const columns = [
    { key: 'date', label: 'Date', fmt: (v, r) => (v ? longDate(v) : <span className="faint">no date</span>), sortValue: (r) => r.date || r.due_date || '' },
    { key: 'name', label: 'What', render: (r) => <span className="wrap-cell" title={r.reason || ''}>{r.name}{r.kind !== 'regular' && <span className="pill" style={{ marginLeft: 6 }}>{KIND_SHORT[r.kind]}</span>}</span> },
    { key: 'category', label: 'Category' },
    { key: 'total', label: 'Amount', align: 'r', fmt: money2, total: 'sum', csv: (r) => r.total.toFixed(2) },
    { key: 'status', label: 'Status', render: (r) => <span className={'pill ' + (r.status === 'paid' ? 'ok' : r.status === 'scheduled' && r.due_date < today ? 'bad' : 'warn')}>{statusText(r)}</span>, csv: statusText },
    { key: 'payee', label: 'Paid to', fmt: (v) => v || '–' },
    { key: 'employee', label: 'Employee', fmt: (v) => v || '–' },
    { key: 'paid_by', label: 'Paid by', fmt: (v) => v || '–' },
    { key: 'receipt', label: 'Receipt', render: (r) => (r.receipt ? <a href={`/api/receipts/${r.receipt}`} target="_blank" rel="noreferrer">View</a> : <span className="faint">–</span>), csv: (r) => (r.receipt ? 'yes' : '') },
    { key: 'act', label: '', render: (r) => (canEdit(r) ? (
      <span style={{ display: 'flex', gap: 2 }}>
        {r.status !== 'paid' && <button className="btn small" onClick={() => setPayFor(r)}>Mark paid</button>}
        <button className="btn small ghost" onClick={() => ctx.edit(r)}>Edit</button>
        <button className="btn small ghost" onClick={() => remove(r)} aria-label="Delete">✕</button>
      </span>) : null), csv: () => '' },
  ];
  return (
    <>
      {payFor && <MarkPaid ctx={ctx} record={payFor} onClose={() => setPayFor(null)} />}
      <div className="card">
        <div className="card-head">
          <div><h2>Records</h2><p>{range.from ? `${longDate(range.from)} – ${longDate(range.to)}` : 'All dates'} · {int(rows.length)} records · {money(sum(rows))}</p></div>
          <div className="table-tools" style={{ margin: 0 }}>
            <div className="chips">{presets.map(([l, a, b]) => <button key={l} className="chip" aria-pressed={range.from === a && range.to === b} onClick={() => setRange({ from: a, to: b })}>{l}</button>)}</div>
          </div>
        </div>
        <div className="table-tools">
          <label className="field"><span>From</span><input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value, to: range.to || today })} /></label>
          <label className="field"><span>To</span><input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
          <label className="field"><span>Status</span><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="paid">Paid</option><option value="scheduled">To be paid on a date</option><option value="unpaid">Unpaid, no date</option></select></label>
          <label className="field"><span>Category</span><select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="field"><span>Paid from</span><select value={acc} onChange={(e) => setAcc(e.target.value)}><option value="">All</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        </div>
        {byMonth.length > 1 && (
          <div className="month-strip">{byMonth.map(([m, v]) => <span key={m}><b>{monthLabel(m)}</b> {money(v)}</span>)}</div>
        )}
        <DataTable columns={columns} rows={rows} defaultSort={{ key: 'date', dir: 'desc' }} exportName="accounting-records" pageSize={100}
          filters={{ search: 'name', amount: 'total', amountLabel: 'Amount' }} />
      </div>
      <Breakdown rows={rows} />
    </>
  );
}

function Breakdown({ rows }) {
  const by = (key) => {
    const m = new Map();
    for (const r of rows) { const k = r[key] || '–'; m.set(k, (m.get(k) || 0) + r.total); }
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  const block = (title, list) => (
    <div className="card">
      <div className="card-head"><div><h2>{title}</h2></div></div>
      <ul className="barlist">{list.slice(0, 10).map(([n, v]) => (
        <li key={n}><span className="name">{n}</span><span className="val">{money(v)}</span><div className="track"><div className="fill" style={{ width: `${(v / list[0][1]) * 100}%` }} /></div></li>
      ))}</ul>
    </div>
  );
  if (!rows.length) return null;
  return <div className="grid three-even">{block('By category', by('category'))}{block('By paid from', by('account'))}{block('By paid to', by('payee'))}</div>;
}

export function MarkPaid({ ctx, record, onClose }) {
  const [acc, setAcc] = useState('');
  const [date, setDate] = useState(ctx.today);
  const [err, setErr] = useState('');
  async function save() {
    try {
      await api('expenses/' + record.id, { method: 'PATCH', body: { status: 'paid', account_id: acc ? Number(acc) : null, paid_date: date } });
      onClose(); ctx.reload();
    } catch (e) { setErr(e.message); }
  }
  return (
    <div className="card" style={{ borderColor: 'var(--good)' }}>
      <div className="card-head"><div><h2>Mark as paid: {record.name}</h2><p>{money2(total(record))}{record.due_date ? ` · was due ${longDate(record.due_date)}` : ''}</p></div>
        <button className="btn small ghost" onClick={onClose}>Cancel</button></div>
      <div className="table-tools" style={{ marginBottom: 0 }}>
        <label className="field"><span>Paid from</span><select value={acc} onChange={(e) => setAcc(e.target.value)}><option value="">Choose…</option>
          {ctx.accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name} ({ACCOUNT_TYPES[a.type]})</option>)}</select></label>
        <label className="field"><span>Payment date</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <button className="btn primary" onClick={save} disabled={!acc}>Mark paid</button>
      </div>
      {err && <div className="error" role="alert">{err}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- loans
export function Loans({ ctx, onRepay }) {
  const { records, accounts } = ctx;
  const loans = accounts.filter((a) => a.type === 'person_loan' || a.type === 'bank_loan').map((a) => {
    const borrowed = records.filter((r) => r.status === 'paid' && r.account_id === a.id);
    const repaid = records.filter((r) => r.kind === 'loan_repayment' && r.loan_account_id === a.id && r.status === 'paid');
    const b = borrowed.reduce((t, r) => t + total(r), 0), p = repaid.reduce((t, r) => t + total(r), 0);
    return { ...a, key: a.id, borrowed: b, repaid: p, owed: b - p, n: borrowed.length };
  });
  return (
    <div className="card">
      <div className="card-head"><div><h2>Loans</h2>
        <p>When something is paid from a loan (a person’s own money or a bank loan / credit card), the café owes that amount. Paying it back: record a payment with type “Paying back a loan”.</p></div></div>
      {loans.length ? (
        <DataTable rows={loans} exportName="loans" defaultSort={{ key: 'owed', dir: 'desc' }}
          columns={[
            { key: 'name', label: 'Loan' },
            { key: 'type', label: 'Kind', fmt: (v) => ACCOUNT_TYPES[v] },
            { key: 'n', label: 'Payments made with it', align: 'r', fmt: int },
            { key: 'borrowed', label: 'Borrowed', align: 'r', fmt: money2, total: 'sum' },
            { key: 'repaid', label: 'Paid back', align: 'r', fmt: money2, total: 'sum' },
            { key: 'owed', label: 'Still owed', align: 'r', fmt: money2, total: 'sum', cls: (r) => (r.owed > 0 ? 'down' : '') },
            { key: 'act', label: '', render: (r) => <button className="btn small" onClick={() => onRepay(r)}>Record a repayment</button>, csv: () => '' },
          ]} />
      ) : <p className="muted">No loan accounts yet. Add one in “Accounts & categories”, e.g. “Loan from Yaman” (loan from a person).</p>}
    </div>
  );
}

// ---------------------------------------------------------------- accounts & categories
function AccountsSetup({ ctx }) {
  const { accounts, cats, owner, records, today } = ctx;
  const [n, setN] = useState({ name: '', type: 'bank' });
  const monthStart = today.slice(0, 8) + '01';
  async function add() {
    try { await api('money-accounts', { method: 'POST', body: n }); setN({ name: '', type: 'bank' }); ctx.reload(); } catch (e) { alert(e.message); }
  }
  async function patchAcc(a, body) { try { await api('money-accounts/' + a.id, { method: 'PATCH', body }); ctx.reload(); } catch (e) { alert(e.message); } }
  async function patchCat(c, body) { try { await api('categories/' + c.id, { method: 'PATCH', body }); ctx.reload(); } catch (e) { alert(e.message); } }
  const spent = (a) => records.filter((r) => r.status === 'paid' && r.account_id === a.id && (r.paid_date || r.date) >= monthStart).reduce((t, r) => t + total(r), 0);
  return (
    <div className="grid two">
      <div className="card">
        <div className="card-head"><div><h2>Paid from (money accounts)</h2><p>Cash, bank accounts and loans. {owner ? '' : 'Only the owner can rename or change them.'}</p></div></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Account</th><th>Kind</th><th className="r">Paid this month</th><th /></tr></thead>
          <tbody>{accounts.map((a) => (
            <tr key={a.id} style={a.active ? undefined : { opacity: 0.5 }}>
              <td>{a.name}</td>
              <td>{owner ? <select value={a.type} onChange={(e) => patchAcc(a, { type: e.target.value })}>{Object.entries(ACCOUNT_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select> : ACCOUNT_TYPES[a.type]}</td>
              <td className="r num">{money(spent(a))}</td>
              <td>{owner && <span style={{ display: 'flex', gap: 2 }}>
                <button className="btn small ghost" onClick={() => { const v = prompt('New name', a.name); if (v && v.trim()) patchAcc(a, { name: v.trim() }); }}>Rename</button>
                <button className="btn small ghost" onClick={() => patchAcc(a, { active: !a.active })}>{a.active ? 'Hide' : 'Show'}</button></span>}</td>
            </tr>))}</tbody>
        </table></div>
        <div className="table-tools" style={{ marginTop: 12, marginBottom: 0 }}>
          <label className="field"><span>New account</span><input value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} placeholder="e.g. Loan from Yaman" /></label>
          <label className="field"><span>Kind</span><select value={n.type} onChange={(e) => setN({ ...n, type: e.target.value })}>{Object.entries(ACCOUNT_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <button className="btn" onClick={add} disabled={!n.name.trim()}>Add</button>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><div><h2>Categories</h2><p><b>Stock</b> = ingredients and goods for sale. The net-profit report (recipe costs) leaves them out, because the recipe costs already count them.</p></div></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Category</th><th>Stock</th><th>Shown</th><th /></tr></thead>
          <tbody>{cats.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td><input type="checkbox" checked={!!c.stock} disabled={!owner} onChange={(e) => patchCat(c, { stock: e.target.checked })} aria-label={`${c.name} is stock`} /></td>
              <td><input type="checkbox" checked={!!c.active} onChange={(e) => patchCat(c, { active: e.target.checked })} aria-label={`Show ${c.name}`} /></td>
              <td><button className="btn small ghost" onClick={() => { const v = prompt('New name', c.name); if (v && v.trim()) patchCat(c, { name: v.trim() }); }}>Rename</button></td>
            </tr>))}</tbody>
        </table></div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- import
function Import({ onDone }) {
  const [prev, setPrev] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  async function pick(file) {
    setMsg(null);
    const text = await file.text();
    if (!isNotionExport(text)) { setMsg({ ok: false, text: 'This is not the Notion expenses export (it needs the columns “Expense Date”, “Expense Category” and “From Account”).' }); return; }
    setPrev({ file: file.name, ...notionRecords(text) });
  }
  async function go() {
    setBusy(true);
    try {
      const r = await api('expenses/import', { method: 'POST', body: { rows: prev.records, source: prev.file } });
      setMsg({ ok: true, text: `Imported ${r.added} records${r.skipped ? `; ${r.skipped} were already in and were skipped` : ''}.` });
      setPrev(null);
      onDone();
    } catch (e) { setMsg({ ok: false, text: e.message }); } finally { setBusy(false); }
  }
  const cnt = (s) => prev.records.filter((r) => r.status === s).length;
  return (
    <div className="card">
      <div className="card-head"><div><h2>Import from Notion</h2><p>Export the “MC-expenses” database from Notion as CSV and choose the file. Records already imported are skipped, so you can import a newer export again.</p></div>
        <button className="btn primary" onClick={() => ref.current.click()}>Choose CSV file</button>
        <input ref={ref} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) pick(f); }} /></div>
      {prev && (
        <div className="notice">
          <b>{prev.file}</b>: {prev.records.length} records ({cnt('paid')} paid, {cnt('scheduled')} planned with a date, {cnt('unpaid')} pending without a date) · {money(prev.records.reduce((t, r) => t + r.amount + (r.fees || 0), 0))}.
          {prev.skipped.length > 0 && <> {prev.skipped.length} empty rows left out.</>}
          <div style={{ marginTop: 8 }}><button className="btn primary" onClick={go} disabled={busy}>{busy ? 'Importing…' : 'Import'}</button></div>
        </div>
      )}
      {msg && <div className={'banner ' + (msg.ok ? 'ok' : 'bad')} role="status" style={{ marginTop: 12 }}><span>{msg.text}</span></div>}
    </div>
  );
}

export function Tile({ label, value, sub, bad }) {
  return (
    <div className="card kpi" style={bad ? { borderColor: 'var(--bad)' } : undefined}>
      <div className="label">{label}</div>
      <div className={'value' + (bad ? ' down' : '')}>{value}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}
const prevMonthStart = (d) => {
  const [y, m] = d.split('-').map(Number);
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`;
};
