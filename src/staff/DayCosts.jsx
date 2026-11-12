import { useEffect, useState } from 'react';
import { api, compressPhoto } from '../lib/api.js';
import { longDate, money2 } from '../format.js';

const STATUS = { pending: ['warn', 'Waiting for approval'], approved: ['ok', 'Approved'], rejected: ['bad', 'Not approved'], cancelled: ['', 'Cancelled'] };
const Pill = ({ s }) => <span className={'pill ' + STATUS[s][0]}>{STATUS[s][1]}</span>;

/** Barista: add a small cost paid for the café (up to the limit per purchase); accounting approves it. */
export function BaristaCosts() {
  const [data, setData] = useState(null);
  const [f, setF] = useState({ name: '', amount: '', category_id: '', date: '', note: '' });
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const load = () => api('cost-requests').then((d) => { setData(d); setF((x) => ({ ...x, date: x.date || d.today })); }).catch((e) => setMsg({ ok: false, text: e.message }));
  useEffect(() => { load(); }, []);
  const set = (p) => setF((x) => ({ ...x, ...p }));
  const amount = Number(String(f.amount).replace(',', '.'));
  const over = data && amount > data.limit;

  async function pickPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try { const blob = await compressPhoto(file); setPhoto({ blob, url: URL.createObjectURL(blob) }); } catch (err) { setMsg({ ok: false, text: err.message }); }
  }
  async function submit(e) {
    e.preventDefault();
    setMsg(null); setBusy(true);
    try {
      let receipt = null;
      if (photo) receipt = (await api('cost-requests/receipt', { method: 'POST', raw: photo.blob, type: 'image/jpeg' })).receipt;
      const r = await api('cost-requests', { method: 'POST', body: { ...f, receipt } });
      setMsg({ ok: true, text: `Sent. The accountant was told${r.mail?.sent ? ' by email' : ''} and will approve it.` });
      setF({ name: '', amount: '', category_id: '', date: data.today, note: '' }); setPhoto(null);
      load();
    } catch (err) { setMsg({ ok: false, text: err.message }); } finally { setBusy(false); }
  }
  async function cancel(id) {
    if (!confirm('Cancel this request?')) return;
    try { await api('cost-requests/' + id, { method: 'DELETE' }); load(); } catch (err) { setMsg({ ok: false, text: err.message }); }
  }

  return (
    <div className="card">
      <div className="card-head"><div><h2>Day-to-day costs</h2>
        <p>Paid for something for the café (milk, ice, cleaning things…)? Add it here, up to {data ? data.limit : 400} TL per purchase. The accountant approves it.</p></div></div>
      {msg && <div className={'banner ' + (msg.ok ? 'ok' : 'bad')} role="status"><span>{msg.text}</span></div>}
      <form onSubmit={submit} className="form-grid">
        <label className="field"><span>What did you buy?</span><input value={f.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} placeholder="e.g. Milk, 6 litres" required /></label>
        <label className="field"><span>Amount (TL)</span><input inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} placeholder={`up to ${data?.limit ?? 400}`} required aria-invalid={over || undefined} />
          {over && <small style={{ color: 'var(--bad-text)' }}>The most is {data.limit} TL per purchase.</small>}</label>
        <label className="field"><span>Category (optional)</span><select value={f.category_id} onChange={(e) => set({ category_id: e.target.value })}><option value="">Not sure</option>{data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="field"><span>Date</span><input type="date" value={f.date} max={data?.today} onChange={(e) => set({ date: e.target.value })} /></label>
        <label className="field"><span>Receipt photo (optional)</span><input type="file" accept="image/*" capture="environment" onChange={pickPhoto} />
          {photo && <img src={photo.url} alt="Receipt" style={{ maxWidth: 140, marginTop: 6, borderRadius: 6 }} />}</label>
        <label className="field"><span>Note (optional)</span><input value={f.note} onChange={(e) => set({ note: e.target.value })} maxLength={500} /></label>
        <div><button className="btn primary" disabled={busy || over}>{busy ? 'Sending…' : 'Send for approval'}</button></div>
      </form>
      {data?.mine.length > 0 && (
        <ul className="shift-list" style={{ marginTop: 16 }}>
          {data.mine.slice(0, 10).map((q) => (
            <li key={q.id}>
              <span><b>{q.name}</b> · <span className="num">{money2(q.amount)}</span></span>
              <span className="muted">{longDate(q.date)}</span>
              <span className="swap-line"><Pill s={q.status} />{q.status === 'pending' && <button className="btn small ghost" onClick={() => cancel(q.id)}>Cancel</button>}</span>
              {q.status === 'rejected' && q.reason && <small className="muted">Reason: {q.reason}</small>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Accountant / owner: approve or reject the baristas' day-to-day costs. Approved ones become paid records. */
export function CostApprovals({ ctx, onChange, compact }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [pick, setPick] = useState({}); // id -> { category_id, account_id }
  const load = () => api('cost-requests').then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  if (!data?.all) return err ? <div className="error">{err}</div> : null;
  const cash = ctx.accounts.find((a) => a.type === 'cash' && a.active);
  const pending = data.all.filter((q) => q.status === 'pending');
  const done = data.all.filter((q) => q.status !== 'pending').slice(0, 15);
  const val = (q, k) => pick[q.id]?.[k] ?? (k === 'account_id' ? cash?.id ?? '' : q.category_id ?? '');
  const setVal = (q, k, v) => setPick((p) => ({ ...p, [q.id]: { ...p[q.id], [k]: v } }));
  if (compact && !pending.length) return null; // on the other tabs: only when something is waiting

  async function decide(q, action) {
    setErr('');
    let reason;
    if (action === 'reject') { reason = prompt('Why is it not approved? (the barista sees this)'); if (reason === null) return; }
    try {
      await api('cost-requests/' + q.id, { method: 'PATCH', body: { action, reason, category_id: Number(val(q, 'category_id')) || null, account_id: Number(val(q, 'account_id')) || null } });
      load(); onChange?.();
    } catch (e) { setErr(e.message); }
  }

  return (
    <div className="card" style={pending.length ? { borderColor: 'var(--warn)' } : undefined}>
      <div className="card-head"><div><h2>Barista costs{pending.length ? ` · ${pending.length} waiting` : ''}</h2>
        <p>Small purchases baristas paid for (up to {data.limit} TL each). Approving adds a paid record to Accounting.</p></div></div>
      {err && <div className="banner bad"><span>{err}</span></div>}
      {pending.length ? (
        <div className="table-wrap"><table>
          <thead><tr><th>Date</th><th>Who</th><th>What</th><th className="r">Amount</th><th>Category</th><th>Paid from</th><th>Receipt</th><th /></tr></thead>
          <tbody>{pending.map((q) => (
            <tr key={q.id}>
              <td>{longDate(q.date)}</td><td>{q.user_name}</td>
              <td className="wrap-cell">{q.name}{q.note && <><br /><small className="muted">{q.note}</small></>}</td>
              <td className="r num">{money2(q.amount)}</td>
              <td><select className="cell-input" value={val(q, 'category_id')} onChange={(e) => setVal(q, 'category_id', e.target.value)}><option value="">Choose…</option>{ctx.cats.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></td>
              <td><select className="cell-input" value={val(q, 'account_id')} onChange={(e) => setVal(q, 'account_id', e.target.value)}><option value="">Choose…</option>{ctx.accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></td>
              <td>{q.receipt ? <a href={`${import.meta.env.BASE_URL}api/receipts/${q.receipt}`} target="_blank" rel="noreferrer">View</a> : <span className="faint">–</span>}</td>
              <td><span style={{ display: 'flex', gap: 4 }}><button className="btn small primary" onClick={() => decide(q, 'approve')}>Approve</button><button className="btn small ghost" onClick={() => decide(q, 'reject')}>Reject</button></span></td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <p className="muted" style={{ margin: 0 }}>Nothing waiting.</p>}
      {!compact && done.length > 0 && (
        <details style={{ marginTop: 12 }}><summary style={{ cursor: 'pointer' }}>Recently answered ({done.length})</summary>
          <ul className="shift-list" style={{ marginTop: 8 }}>{done.map((q) => (
            <li key={q.id}><span><b>{q.user_name}</b> · {q.name} · <span className="num">{money2(q.amount)}</span></span><span className="muted">{longDate(q.date)}{q.decided_name ? ` · ${q.decided_name}` : ''}</span><span><Pill s={q.status} /></span></li>
          ))}</ul>
        </details>
      )}
    </div>
  );
}
