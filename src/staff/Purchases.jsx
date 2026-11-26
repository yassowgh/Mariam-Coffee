import { useEffect, useMemo, useState } from 'react';
import { api, compressPhoto } from '../lib/api.js';
import { longDate, money2 } from '../format.js';
import { InvoiceScan } from './Invoices.jsx';

// Purchases: anyone asks → the owner approves (amount, how and when it is paid) → the requester sends the invoice →
// an accountant / manager checks it (it becomes the accounting record and goes into the inventory).

const STATUS = {
  pending: ['', 'Waiting for the owner'],
  approved: ['ok', 'Approved · send the invoice'],
  invoice_submitted: ['', 'Invoice sent · being checked'],
  reapproval: ['bad', 'Over the approved amount · waiting for the owner'],
  done: ['ok', 'Done'],
  rejected: ['bad', 'Not approved'],
  cancelled: ['', 'Cancelled'],
};
const todayStr = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 10);
const num = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round(n * 100) / 100;

export default function Purchases() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('new');
  const [msg, setMsg] = useState('');
  const [checking, setChecking] = useState(null);
  const load = () => api('purchases').then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  if (error) return <div className="banner bad" role="alert"><span>{error}</span></div>;
  if (!data) return <p className="muted">Loading…</p>;
  const { roles } = data;
  const toApprove = (data.all || []).filter((r) => ['pending', 'reapproval'].includes(r.status));
  const toCheck = (data.all || []).filter((r) => r.status === 'invoice_submitted');
  const waitingMine = data.mine.filter((r) => r.status === 'approved');
  const tabs = [
    ['new', 'New request'],
    ['mine', `My requests${waitingMine.length ? ` (${waitingMine.length} to send)` : ''}`],
    ...(roles.owner ? [['approve', `To approve${toApprove.length ? ` (${toApprove.length})` : ''}`]] : []),
    ...(roles.checker ? [['check', `Check invoices${toCheck.length ? ` (${toCheck.length})` : ''}`]] : []),
    ...(roles.viewer ? [['all', 'All requests'], ['tracker', 'Spend tracker'], ['budgets', 'Budgets']] : []),
  ];
  const done = (t, nextTab) => { setMsg(t); load(); if (nextTab) setTab(nextTab); window.scrollTo(0, 0); };
  if (checking) {
    return (
      <div className="stack">
        <div><button className="btn" onClick={() => { setChecking(null); load(); }}>← Back to purchases</button></div>
        <InvoiceScan purchase={checking} ctx={{ cats: data.categories.map((c) => ({ ...c, active: 1 })), accounts: data.accounts.map((a) => ({ ...a, active: 1 })) }}
          onDone={(t, o) => { if (o?.reapproval) return; setChecking(null); done(`${t} The purchase “${checking.title}” is done.`, 'check'); }} />
      </div>
    );
  }
  return (
    <div className="stack">
      <nav className="fin-tabs" role="tablist" aria-label="Purchases">
        {tabs.map(([k, l]) => <button key={k} role="tab" className={'btn' + (tab === k ? ' primary' : '')} aria-selected={tab === k} onClick={() => { setTab(k); setMsg(''); }}>{l}</button>)}
      </nav>
      {msg && <div className="banner ok" role="status"><span>{msg}</span><button className="btn small ghost" onClick={() => setMsg('')} aria-label="Close">✕</button></div>}
      {tab === 'new' && <NewRequest data={data} onDone={(t) => done(t, 'mine')} />}
      {tab === 'mine' && <List rows={data.mine} data={data} empty="You have no purchase requests yet." onDone={done} onCheck={setChecking} />}
      {tab === 'approve' && <List rows={toApprove} data={data} empty="Nothing waiting for your approval." onDone={done} onCheck={setChecking} open />}
      {tab === 'check' && <List rows={toCheck} data={data} empty="No invoices waiting to be checked." onDone={done} onCheck={setChecking} open />}
      {tab === 'all' && <AllRequests data={data} onDone={done} onCheck={setChecking} />}
      {tab === 'tracker' && <Tracker />}
      {tab === 'budgets' && <Budgets data={data} onDone={(t) => done(t)} />}
    </div>
  );
}

// ---------------------------------------------------------------- new request
function NewRequest({ data, onDone }) {
  const [f, setF] = useState({ title: '', supplier: '', category_id: '', needed_by: '', pay_account_id: '', pay_date: todayStr(), pay_note: '', note: '', amount: '' });
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const stockCats = [...new Set(data.stock.map((x) => x.category))];
  const low = data.stock.filter((x) => x.low);
  const linesSum = r2(lines.reduce((t, l) => t + num(l.qty) * num(l.price), 0));
  const amount = f.amount !== '' ? num(f.amount) : linesSum;
  const bud = data.budgets.find((b) => String(b.id) === String(f.category_id));
  const addStock = (id) => { const it = data.stock.find((x) => x.id === Number(id)); if (it && !lines.some((l) => l.inv_item === it.id)) setLines([...lines, { key: Date.now(), inv_item: it.id, item: it.name, qty: it.need || '', unit: it.unit, price: '' }]); };
  const addLow = () => setLines([...lines, ...low.filter((it) => !lines.some((l) => l.inv_item === it.id)).map((it, i) => ({ key: Date.now() + i, inv_item: it.id, item: it.name, qty: it.need || '', unit: it.unit, price: '' }))]);
  const setLine = (k, patch) => setLines(lines.map((l) => (l.key === k ? { ...l, ...patch } : l)));
  async function submit(e) {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      await api('purchases', { method: 'POST', body: { ...f, amount: f.amount !== '' ? num(f.amount) : linesSum, lines: lines.map((l) => ({ inv_item: l.inv_item, item: l.item, qty: num(l.qty) || null, unit: l.unit, price: l.price === '' ? null : num(l.price) })) } });
      onDone(`Sent to the owner for approval: ${f.title} (${money2(amount)}). You will get an email when it is answered.`);
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <form className="card stack" onSubmit={submit}>
      <div className="card-head"><div><h2>Ask to buy something</h2><p>The owner approves it (you get an email). After you buy it, send the invoice from “My requests”.</p></div></div>
      <div className="form-grid">
        <label className="field"><span>What do you want to buy?</span><input value={f.title} onChange={set('title')} maxLength={160} required placeholder="e.g. Milk and cups for next week" /></label>
        <label className="field"><span>Supplier (if known)</span><input value={f.supplier} onChange={set('supplier')} maxLength={160} /></label>
        <label className="field"><span>Category</span><select value={f.category_id} onChange={set('category_id')} required><option value="">Choose…</option>{data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="field"><span>Needed by</span><input type="date" value={f.needed_by} onChange={set('needed_by')} /></label>
      </div>
      {bud?.budget > 0 && <div className={'banner ' + (bud.left - amount < 0 ? 'bad' : 'ok')}><span>Budget for {bud.name} this month: {money2(bud.budget)} · used {money2(bud.spent)} · approved, not invoiced yet {money2(bud.committed)} · left {money2(bud.left)}{amount ? ` → after this request ${money2(r2(bud.left - amount))}` : ''}{bud.left - amount < 0 ? ' (over budget)' : ''}</span></div>}

      <div>
        <b>Items</b> <span className="muted">(optional; pick from the stock list so the inventory knows what is coming)</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '6px 0' }}>
          <select className="cell-input" style={{ maxWidth: 280 }} value="" onChange={(e) => addStock(e.target.value)} aria-label="Add a stock item">
            <option value="">＋ Add a stock item…</option>
            {stockCats.map((c) => <optgroup key={c} label={c}>{data.stock.filter((x) => x.category === c).map((x) => <option key={x.id} value={x.id}>{x.name} ({x.unit}){x.low ? ' · to order' : ''}</option>)}</optgroup>)}
          </select>
          {low.length > 0 && <button type="button" className="btn small" onClick={addLow}>＋ All “to order” items ({low.length})</button>}
          <button type="button" className="btn small ghost" onClick={() => setLines([...lines, { key: Date.now(), inv_item: null, item: '', qty: '', unit: '', price: '' }])}>＋ Other item</button>
        </div>
        {lines.length > 0 && <div className="table-wrap"><table>
          <thead><tr><th>Item</th><th className="r">Qty</th><th>Unit</th><th className="r">Price each (TL)</th><th className="r">Total</th><th /></tr></thead>
          <tbody>{lines.map((l) => (
            <tr key={l.key}>
              <td>{l.inv_item ? <>{l.item} <span className="pill">stock</span></> : <input className="cell-input" value={l.item} onChange={(e) => setLine(l.key, { item: e.target.value })} maxLength={120} placeholder="Item" />}</td>
              <td className="r"><input className="cell-input num" inputMode="decimal" style={{ width: 70 }} value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} /></td>
              <td>{l.inv_item ? l.unit : <input className="cell-input" style={{ width: 70 }} value={l.unit} onChange={(e) => setLine(l.key, { unit: e.target.value })} />}</td>
              <td className="r"><input className="cell-input num" inputMode="decimal" style={{ width: 90 }} value={l.price} onChange={(e) => setLine(l.key, { price: e.target.value })} /></td>
              <td className="r num">{num(l.qty) && num(l.price) ? money2(r2(num(l.qty) * num(l.price))) : '–'}</td>
              <td><button type="button" className="btn small ghost" onClick={() => setLines(lines.filter((x) => x.key !== l.key))} aria-label="Remove">✕</button></td>
            </tr>
          ))}</tbody>
        </table></div>}
      </div>

      <div className="form-grid">
        <label className="field"><span>Expected amount (TL){linesSum ? ` · items add up to ${money2(linesSum)}` : ''}</span><input inputMode="decimal" value={f.amount} onChange={set('amount')} placeholder={linesSum ? String(linesSum) : ''} required={!linesSum} /></label>
        <label className="field"><span>How will it be paid? (from)</span><select value={f.pay_account_id} onChange={set('pay_account_id')} required><option value="">Choose…</option>{data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label className="field"><span>When will it be paid?</span><input type="date" value={f.pay_date} onChange={set('pay_date')} required /></label>
        <label className="field"><span>Payment note (optional)</span><input value={f.pay_note} onChange={set('pay_note')} maxLength={200} placeholder="e.g. 50% now, rest on delivery" /></label>
      </div>
      <label className="field"><span>Why is it needed? (optional)</span><textarea rows={2} value={f.note} onChange={set('note')} maxLength={800} /></label>
      {err && <div className="banner bad" role="alert"><span>{err}</span></div>}
      <div><button className="btn primary" disabled={busy || !amount}>{busy ? 'Sending…' : `Send for approval${amount ? ` · ${money2(amount)}` : ''}`}</button></div>
    </form>
  );
}

// ---------------------------------------------------------------- lists and one request
function List({ rows, data, empty, onDone, onCheck, open }) {
  if (!rows.length) return <div className="card"><p className="muted" style={{ margin: 0 }}>{empty}</p></div>;
  return <div className="stack">{rows.map((r) => <RequestCard key={r.id} r={r} data={data} onDone={onDone} onCheck={onCheck} startOpen={open} />)}</div>;
}

function AllRequests({ data, onDone, onCheck }) {
  const [filter, setFilter] = useState('open');
  const [q, setQ] = useState('');
  const rows = data.all.filter((r) => (filter === 'all' || (filter === 'open' ? !['done', 'rejected', 'cancelled'].includes(r.status) : r.status === filter))
    && (!q || `${r.title} ${r.supplier || ''} ${r.user_name}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="stack">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <div className="seg" role="group" aria-label="Filter">{[['open', 'Open'], ['done', 'Done'], ['rejected', 'Not approved'], ['all', 'All']].map(([k, l]) => <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}</div>
        <input className="inv-search" style={{ margin: 0 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" />
      </div>
      <List rows={rows} data={data} empty="No requests." onDone={onDone} onCheck={onCheck} />
    </div>
  );
}

function RequestCard({ r, data, onDone, onCheck, startOpen }) {
  const [openCard, setOpen] = useState(!!startOpen);
  const { roles } = data;
  const mine = data.mine.some((x) => x.id === r.id);
  const approved = r.approved_amount ?? r.amount;
  const over = r.invoice_total != null && r.invoice_total > approved;
  return (
    <div className="card">
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', cursor: 'pointer' }} onClick={() => setOpen(!openCard)}>
        <b style={{ fontSize: 16 }}>{r.title}</b>
        <span className={'pill ' + STATUS[r.status][0]}>{STATUS[r.status][1]}</span>
        <span className="num">{money2(r.approved_amount ?? r.amount)}{r.invoice_total != null && <> · invoice {money2(r.invoice_total)}</>}</span>
        {over && <span className="pill bad">+{money2(r2(r.invoice_total - approved))}</span>}
        <span className="muted" style={{ marginLeft: 'auto' }}>#{r.id} · {r.user_name} · {longDate(r.created_at.slice(0, 10))}</span>
      </div>
      {openCard && <div className="stack" style={{ marginTop: 10 }}>
        <div className="form-grid">
          <Info label="Supplier" v={r.supplier || '–'} />
          <Info label="Category" v={r.category || '–'} />
          <Info label="Requested" v={money2(r.amount)} />
          {r.approved_amount != null && <Info label="Approved" v={money2(r.approved_amount)} />}
          <Info label="Paid from" v={r.pay_account || '–'} />
          <Info label="Pay date" v={r.pay_date ? longDate(r.pay_date) : '–'} />
          {r.needed_by && <Info label="Needed by" v={longDate(r.needed_by)} />}
          {r.expense_status && <Info label="Payment now" v={r.expense_status === 'paid' ? `Paid${r.expense_paid_date ? ' ' + longDate(r.expense_paid_date) : ''}${r.expense_account ? ' · ' + r.expense_account : ''}` : `To pay${r.expense_due_date ? ' on ' + longDate(r.expense_due_date) : ''}`} />}
        </div>
        {r.pay_note && <p style={{ margin: 0 }}><b>Payment note:</b> {r.pay_note}</p>}
        {r.note && <p style={{ margin: 0 }}><b>Why:</b> {r.note}</p>}
        {r.decision_note && <p style={{ margin: 0 }}><b>Owner:</b> {r.decision_note}</p>}
        {r.lines?.length > 0 && <div className="table-wrap"><table>
          <thead><tr><th>Item</th><th className="r">Qty</th><th>Unit</th><th className="r">Price each</th></tr></thead>
          <tbody>{r.lines.map((l) => <tr key={l.id}><td>{l.item}{l.inv_item && <> <span className="pill">stock</span></>}</td><td className="r num">{l.qty ?? '–'}</td><td>{l.unit || ''}</td><td className="r num">{l.price != null ? money2(l.price) : '–'}</td></tr>)}</tbody>
        </table></div>}
        {r.photos?.length > 0 && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{r.photos.map((p) => <a key={p} href={import.meta.env.BASE_URL + 'api/purchases/photo/' + p} target="_blank" rel="noreferrer"><img src={import.meta.env.BASE_URL + 'api/purchases/photo/' + p} alt="Invoice" style={{ height: 90, borderRadius: 6, border: '1px solid var(--line)' }} /></a>)}{r.invoice_note && <span className="muted">{r.invoice_note}</span>}</div>}

        {roles.owner && ['pending', 'reapproval'].includes(r.status) && <Approve r={r} data={data} onDone={onDone} />}
        {roles.checker && r.status === 'invoice_submitted' && <div><button className="btn primary" onClick={() => onCheck(r)}>Check and save the invoice →</button> <span className="muted">The AI reads it; you check the lines, stock and payment.</span></div>}
        {mine && r.status === 'approved' && <SendInvoice r={r} onDone={onDone} />}
        {(mine || roles.owner) && !['done', 'rejected', 'cancelled'].includes(r.status) && <Cancel r={r} onDone={onDone} />}

        {r.history?.length > 0 && <details><summary className="muted">History</summary>
          <ul style={{ margin: '6px 0', paddingInlineStart: 18 }}>{r.history.map((x, i) => <li key={i}><span className="muted">{longDate(x.at.slice(0, 10))} {new Date(x.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · {x.by}:</span> {x.what}</li>)}</ul></details>}
      </div>}
    </div>
  );
}
const Info = ({ label, v }) => <div className="field"><span>{label}</span><b>{v}</b></div>;

function Approve({ r, data, onDone }) {
  const re = r.status === 'reapproval';
  const [f, setF] = useState({ amount: String(re ? r.invoice_total : r.amount), account_id: String(r.pay_account_id || ''), pay_date: r.pay_date || todayStr(), note: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const bud = data.budgets.find((b) => b.id === r.category_id);
  const go = async (action) => {
    setErr(''); setBusy(true);
    try {
      await api(`purchases/${r.id}/${action}`, { method: 'POST', body: action === 'approve' ? { amount: num(f.amount), account_id: Number(f.account_id), pay_date: f.pay_date, note: f.note } : { reason: f.reason } });
      onDone(action === 'approve' ? `Approved: ${r.title} (${money2(num(f.amount))}). ${re ? 'The checkers were told.' : 'The requester was emailed to send the invoice.'}` : `Rejected: ${r.title}. The requester was emailed.`);
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      {re && <div className="banner bad"><span>The invoice is {money2(r.invoice_total)}, but {money2(r.approved_amount)} was approved ({Math.round(((r.invoice_total - r.approved_amount) / r.approved_amount) * 100)}% more). Approve the new amount or reject it.</span></div>}
      {bud?.budget > 0 && <p className="muted" style={{ margin: 0 }}>Budget {bud.name} this month: {money2(bud.budget)} · left {money2(bud.left)}{bud.left < 0 ? ' (over budget)' : ''}</p>}
      <div className="form-grid">
        <label className="field"><span>Approved amount (TL)</span><input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
        <label className="field"><span>Paid from</span><select value={f.account_id} onChange={(e) => setF({ ...f, account_id: e.target.value })}><option value="">Choose…</option>{data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label className="field"><span>Pay date</span><input type="date" value={f.pay_date} onChange={(e) => setF({ ...f, pay_date: e.target.value })} /></label>
        <label className="field"><span>Note to the requester (optional)</span><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={300} /></label>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
        <button className="btn primary" disabled={busy || !num(f.amount) || !f.account_id} onClick={() => go('approve')}>✓ Approve {num(f.amount) ? money2(num(f.amount)) : ''}</button>
        <label className="field" style={{ marginLeft: 'auto' }}><span>Reason (if rejecting)</span><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={300} /></label>
        <button className="btn" disabled={busy} onClick={() => go('reject')}>✕ Reject</button>
      </div>
      {err && <div className="banner bad" role="alert"><span>{err}</span></div>}
    </div>
  );
}

function SendInvoice({ r, onDone }) {
  const [photos, setPhotos] = useState([]);
  const [total, setTotal] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const approved = r.approved_amount ?? r.amount;
  const t = num(total);
  async function addPhotos(e) {
    const files = [...e.target.files].slice(0, 4 - photos.length); e.target.value = '';
    setErr(''); setBusy('Uploading the photo…');
    try {
      const ids = [];
      for (const f of files) ids.push((await api('purchases/photo', { method: 'POST', raw: await compressPhoto(f), type: 'image/jpeg' })).photo);
      setPhotos([...photos, ...ids]);
    } catch (x) { setErr(x.message); } finally { setBusy(''); }
  }
  async function send() {
    setErr(''); setBusy('Sending…');
    try {
      const res = await api(`purchases/${r.id}/invoice`, { method: 'POST', body: { photos, total: t, note } });
      onDone(`Invoice sent for ${r.title}. The accountant / manager will check it.${res.over ? ' It is more than the approved amount, so the owner will be asked again.' : ''}`);
    } catch (x) { setErr(x.message); } finally { setBusy(''); }
  }
  return (
    <div className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      <b>Send the invoice</b>
      <label className="scan-drop" style={{ padding: 14 }}><input type="file" accept="image/*" capture="environment" multiple onChange={addPhotos} disabled={photos.length >= 4} /><b>📷 {photos.length ? `Add another page (${photos.length}/4)` : 'Take a photo of the invoice'}</b></label>
      {photos.length > 0 && <div style={{ display: 'flex', gap: 8 }}>{photos.map((p) => <img key={p} src={import.meta.env.BASE_URL + 'api/purchases/photo/' + p} alt="Invoice" style={{ height: 80, borderRadius: 6 }} />)}</div>}
      <div className="form-grid">
        <label className="field"><span>Invoice total (TL)</span><input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} /></label>
        <label className="field"><span>Note (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></label>
      </div>
      {t > approved && <div className={'banner ' + (t > approved * 1.1 ? 'bad' : '')}><span>{money2(r2(t - approved))} above the approved {money2(approved)}{t > approved * 1.1 ? ': more than 10%, the owner will be asked to approve it again.' : ' (within 10%, accepted with a note).'}</span></div>}
      {err && <div className="banner bad" role="alert"><span>{err}</span></div>}
      <div><button className="btn primary" disabled={!!busy || !photos.length || !(t > 0)} onClick={send}>{busy || 'Send the invoice'}</button></div>
    </div>
  );
}

function Cancel({ r, onDone }) {
  const [busy, setBusy] = useState(false);
  return <div><button className="btn small ghost" disabled={busy} onClick={async () => {
    if (!confirm(`Cancel the request “${r.title}”?`)) return;
    setBusy(true);
    try { await api(`purchases/${r.id}/cancel`, { method: 'POST', body: {} }); onDone(`Cancelled: ${r.title}.`); } catch (x) { alert(x.message); } finally { setBusy(false); }
  }}>Cancel this request</button></div>;
}

// ---------------------------------------------------------------- spend tracker
function Tracker() {
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const [t, setT] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { setT(null); api('purchases/tracker?month=' + month).then(setT).catch((e) => setErr(e.message)); }, [month]);
  if (err) return <div className="banner bad"><span>{err}</span></div>;
  return (
    <div className="stack">
      <div className="card" style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
        <label className="field"><span>Month</span><input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></label>
        <span className="muted">Approved = what the owner agreed to spend · Invoiced = checked invoices · Paid = their payments made.</span>
      </div>
      {!t ? <p className="muted">Loading…</p> : <>
        <div className="kpis">
          {[['Requested', t.totals.requested], ['Approved', t.totals.approved], ['Not approved', t.totals.rejected], ['Invoiced', t.totals.invoiced], ['Paid', t.totals.paid], ['Above approved', t.totals.over]].map(([l, v]) => (
            <div key={l} className="card kpi"><div className="label">{l}</div><div className="value">{money2(v.amount)}</div><div className="muted" style={{ fontSize: 12.5 }}>{v.n} request{v.n === 1 ? '' : 's'}</div></div>
          ))}
        </div>
        <div className="card">
          <div className="card-head"><div><h2>Budgets · {t.month}</h2><p>Used = all expense records of the category this month; committed = approved purchases not invoiced yet.</p></div></div>
          {!t.budgets.some((b) => b.budget) ? <p className="muted" style={{ margin: 0 }}>No budgets set. The owner sets them in Budgets.</p> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Category</th><th className="r">Budget</th><th className="r">Used</th><th className="r">Committed</th><th className="r">Left</th><th style={{ width: '30%' }} /></tr></thead>
              <tbody>{t.budgets.filter((b) => b.budget).map((b) => {
                const pu = Math.min(100, (b.spent / b.budget) * 100), pc = Math.min(100 - pu, (b.committed / b.budget) * 100);
                return (<tr key={b.id}><td>{b.name}</td><td className="r num">{money2(b.budget)}</td><td className="r num">{money2(b.spent)}</td><td className="r num">{money2(b.committed)}</td>
                  <td className="r num" style={b.left < 0 ? { color: 'var(--bad-text)', fontWeight: 600 } : null}>{money2(b.left)}</td>
                  <td><div style={{ display: 'flex', height: 10, borderRadius: 5, background: 'var(--line)', overflow: 'hidden' }} title={`${Math.round(((b.spent + b.committed) / b.budget) * 100)}% used or committed`}>
                    <div style={{ width: pu + '%', background: b.left < 0 ? 'var(--bad-text)' : 'var(--accent, #6b4226)' }} /><div style={{ width: pc + '%', background: 'var(--accent, #6b4226)', opacity: 0.4 }} /></div></td></tr>);
              })}</tbody>
            </table></div>
          )}
        </div>
        <div className="card">
          <div className="card-head"><div><h2>Open purchases</h2><p>Approved but not finished: waiting for the invoice, its check, or the owner.</p></div></div>
          {!t.open.length && !t.pending.length ? <p className="muted" style={{ margin: 0 }}>Nothing open.</p> : (
            <div className="table-wrap"><table>
              <thead><tr><th>#</th><th>What</th><th>Requested by</th><th>Status</th><th className="r">Amount</th><th className="r">Days</th><th>Pay date</th></tr></thead>
              <tbody>
                {t.pending.map((r) => <tr key={'p' + r.id}><td>{r.id}</td><td>{r.title}</td><td>{r.user_name}</td><td><span className="pill">{STATUS.pending[1]}</span></td><td className="r num">{money2(r.amount)}</td><td className="r num">{r.days}</td><td>–</td></tr>)}
                {t.open.map((r) => <tr key={r.id}><td>{r.id}</td><td>{r.title}</td><td>{r.user_name}</td><td><span className={'pill ' + STATUS[r.status][0]}>{STATUS[r.status][1]}</span></td><td className="r num">{money2(r.approved_amount)}</td>
                  <td className="r num" style={r.status === 'approved' && r.days >= 3 ? { color: 'var(--bad-text)', fontWeight: 600 } : null}>{r.days}</td><td>{r.pay_date ? longDate(r.pay_date) : '–'}</td></tr>)}
              </tbody>
            </table></div>
          )}
        </div>
        <div className="card">
          <div className="card-head"><div><h2>To pay</h2><p>Checked purchase invoices not paid yet, by due date.</p></div></div>
          {!t.toPay.length ? <p className="muted" style={{ margin: 0 }}>Nothing to pay.</p> : (
            <div className="table-wrap"><table><thead><tr><th>#</th><th>What</th><th className="r">Amount</th><th>Due</th><th>From</th></tr></thead>
              <tbody>{t.toPay.map((r) => <tr key={r.id}><td>{r.id}</td><td>{r.title}</td><td className="r num">{money2(r.amount)}</td><td style={r.due_date && r.due_date < t.today ? { color: 'var(--bad-text)', fontWeight: 600 } : null}>{r.due_date ? longDate(r.due_date) : 'no date'}</td><td>{r.account || '–'}</td></tr>)}</tbody></table></div>
          )}
        </div>
        {[['By category', t.byCategory], ['By supplier', t.bySupplier], ['By requester', t.byRequester]].map(([title, rows]) => (
          <div key={title} className="card">
            <div className="card-head"><div><h2>{title}</h2></div></div>
            {!rows.length ? <p className="muted" style={{ margin: 0 }}>No purchases this month.</p> : (
              <div className="table-wrap"><table><thead><tr><th>Name</th><th className="r">Requests</th><th className="r">Requested</th><th className="r">Approved</th><th className="r">Invoiced</th></tr></thead>
                <tbody>{rows.map((r) => <tr key={r.name}><td>{r.name}</td><td className="r num">{r.n}</td><td className="r num">{money2(r.requested)}</td><td className="r num">{money2(r.approved)}</td><td className="r num">{money2(r.invoiced)}</td></tr>)}</tbody></table></div>
            )}
          </div>
        ))}
      </>}
    </div>
  );
}

// ---------------------------------------------------------------- budgets
function Budgets({ data, onDone }) {
  const [b, setB] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { api('purchase-budgets').then((r) => setB(Object.fromEntries(Object.entries(r.budgets).map(([k, v]) => [k, String(v)])))).catch((e) => setErr(e.message)); }, []);
  const total = useMemo(() => (b ? Object.values(b).reduce((t, v) => t + num(v), 0) : 0), [b]);
  if (!b) return <p className="muted">{err || 'Loading…'}</p>;
  const owner = data.roles.owner;
  return (
    <div className="card stack">
      <div className="card-head"><div><h2>Monthly budgets</h2><p>A monthly limit per category (TL). Requests show how much is left; the tracker shows used and committed. Leave empty for no budget.{owner ? '' : ' Only the owner can change them.'}</p></div></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Category</th><th className="r">Monthly budget (TL)</th><th className="r">Used this month</th></tr></thead>
        <tbody>{data.categories.map((c) => {
          const s = data.budgets.find((x) => x.id === c.id);
          return <tr key={c.id}><td>{c.name}</td><td className="r"><input className="cell-input num" inputMode="decimal" style={{ width: 120 }} value={b[c.id] || ''} disabled={!owner} onChange={(e) => setB({ ...b, [c.id]: e.target.value })} /></td><td className="r num">{s ? money2(s.spent) : '–'}</td></tr>;
        })}</tbody>
        <tfoot><tr><th>Total</th><th className="r num">{money2(total)}</th><th /></tr></tfoot>
      </table></div>
      {err && <div className="banner bad"><span>{err}</span></div>}
      {owner && <div><button className="btn primary" disabled={busy} onClick={async () => {
        setBusy(true); setErr('');
        try { await api('purchase-budgets', { method: 'PUT', body: { budgets: Object.fromEntries(Object.entries(b).map(([k, v]) => [k, num(v)])) } }); onDone('Budgets saved.'); } catch (x) { setErr(x.message); } finally { setBusy(false); }
      }}>Save budgets</button></div>}
    </div>
  );
}
