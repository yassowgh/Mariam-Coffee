import { useEffect, useState } from 'react';
import { api, distFmt, dowOf, getLocation, hoursFmt, shiftHours, toLocal } from '../lib/api.js';
import { longDate } from '../format.js';

/** Barista page: clock in / out (only inside the café) and see your shifts and hours. */
export default function Clock() {
  const [st, setSt] = useState(null);
  const [swaps, setSwaps] = useState(null); // { swaps, me }
  const loadSwaps = () => api('swaps').then(setSwaps).catch(() => setSwaps({ swaps: [], me: null }));
  useEffect(() => { loadSwaps(); }, []);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const [, tick] = useState(0);

  async function load() {
    try { setSt(await api('clock')); setError(''); } catch (e) { setError(e.message); }
  }
  useEffect(() => {
    load();
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  async function act(kind) {
    setMsg(null);
    setBusy('Finding your location…');
    try {
      const pos = await getLocation();
      setBusy(kind === 'in' ? 'Clocking in…' : 'Clocking out…');
      const r = await api('clock/' + kind, { method: 'POST', body: pos });
      setMsg({ ok: true, text: `${kind === 'in' ? 'Clocked in' : 'Clocked out'} at ${toLocal(r.at).time} (${distFmt(r.dist)} from the café).` });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally { setBusy(''); }
  }

  if (error) return <div className="card"><div className="error" role="alert" style={{ marginTop: 0 }}>{error}</div><button className="btn" style={{ marginTop: 12 }} onClick={load}>Try again</button></div>;
  if (!st) return <div className="card"><p className="muted" style={{ margin: 0 }}>Loading…</p></div>;

  const open = st.open;
  const since = open ? (Date.now() - Date.parse(open.in_at)) / 3600000 : 0;
  const today = st.today;
  const todayShifts = st.upcoming.filter((s) => s.date === today);
  const later = st.upcoming.filter((s) => s.date > today);
  const done = st.recent.filter((r) => r.out_at);
  const weekHours = done.filter((r) => Date.now() - Date.parse(r.in_at) < 7 * 86400000).reduce((t, r) => t + (Date.parse(r.out_at) - Date.parse(r.in_at)) / 3600000, 0);

  return (
    <div className="stack clock-page">
      <div className={'card clock-card' + (open ? ' on' : '')}>
        <div className="clock-state">
          <span className={'pill ' + (open ? 'ok' : '')}>{open ? 'Clocked in' : 'Not clocked in'}</span>
          {open && <div className="clock-big">{hoursFmt(since)}</div>}
          <div className="muted">{open ? `since ${toLocal(open.in_at).time}, ${longDate(toLocal(open.in_at).date)}` : todayShifts.length ? `Today: ${todayShifts.map((s) => `${s.start}–${s.end}`).join(', ')}` : 'No shift today'}</div>
        </div>
        {!st.site.set ? (
          <div className="notice">The owner has not set the café location yet, so clocking in is not possible. Please tell the owner.</div>
        ) : (
          <button className={'btn big clock-btn ' + (open ? '' : 'primary')} disabled={!!busy} onClick={() => act(open ? 'out' : 'in')}>
            {busy || (open ? 'Clock out' : 'Clock in')}
          </button>
        )}
        <p className="faint" style={{ fontSize: 12.5, margin: 0 }}>📍 Your phone’s location is checked once when you tap. You must be inside {st.site.name || 'the café'} (within {st.site.radius || 100} m). The time comes from the server.</p>
        {msg && <div className={'banner ' + (msg.ok ? 'ok' : 'bad')} role="status" style={{ margin: 0 }}><span>{msg.text}</span></div>}
        {st.forgotten && (
          <div className="banner bad" style={{ margin: 0 }}><span>You did not clock out after your shift on {longDate(toLocal(st.forgotten.in_at).date)} (in at {toLocal(st.forgotten.in_at).time}). Tell the manager the time you left so it can be corrected.</span></div>
        )}
      </div>

      <div className="card">
        <div className="card-head"><div><h2>My next shifts</h2><p>Next 2 weeks.</p></div></div>
        {[...todayShifts, ...later].length ? (
          <ul className="shift-list">
            {[...todayShifts, ...later].map((s) => (
              <li key={s.id} className={s.date === today ? 'today' : ''}>
                <span><b>{s.date === today ? 'Today' : dowOf(s.date)}</b> {longDate(s.date)}</span>
                <span className="num">{s.start}–{s.end} <span className="faint">({hoursFmt(shiftHours(s))})</span></span>
                {s.note && !s.note.startsWith('auto ·') && <small className="muted">{s.note}</small>}
                <SwapForShift shift={s} swaps={swaps} onChange={loadSwaps} />
              </li>
            ))}
          </ul>
        ) : <p className="muted" style={{ margin: 0 }}>No shifts planned yet.</p>}
      </div>
      {swaps && <SwapInbox swaps={swaps} onChange={() => { loadSwaps(); load(); }} />}

      <div className="card">
        <div className="card-head"><div><h2>My recent hours</h2><p>Last 7 days: <b>{hoursFmt(weekHours)}</b></p></div></div>
        {st.recent.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>In</th><th>Out</th><th className="r">Worked</th><th /></tr></thead>
              <tbody>
                {st.recent.map((r) => (
                  <tr key={r.id}>
                    <td>{dowOf(toLocal(r.in_at).date)} {longDate(toLocal(r.in_at).date)}</td>
                    <td className="num">{toLocal(r.in_at).time}</td>
                    <td className="num">{r.out_at ? toLocal(r.out_at).time : <span className="faint">–</span>}</td>
                    <td className="r num">{r.out_at ? hoursFmt((Date.parse(r.out_at) - Date.parse(r.in_at)) / 3600000) : '–'}</td>
                    <td>{r.edited_by ? <span className="pill" title={r.note || ''}>corrected</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted" style={{ margin: 0 }}>No clock-ins yet.</p>}
      </div>
    </div>
  );
}

const SWAP_STATUS = { asked: 'Asked', accepted: 'Accepted, waiting for the manager', approved: 'Approved', declined: 'Declined', rejected: 'Not approved', cancelled: 'Cancelled' };

/** On each of my shifts: ask a colleague (or anyone) to take it, or see the open request. */
function SwapForShift({ shift, swaps, onChange }) {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState([]);
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const req = swaps?.swaps.find((w) => w.shift_id === shift.id && ['asked', 'accepted'].includes(w.status) && w.from_user === swaps.me);
  useEffect(() => { if (open && !people.length) api('swaps/colleagues').then((r) => setPeople(r.people)).catch(() => {}); }, [open]);
  async function ask() {
    setErr('');
    try { await api('swaps', { method: 'POST', body: { shift_id: shift.id, to_user: to ? Number(to) : null, note } }); setOpen(false); onChange(); } catch (e) { setErr(e.message); }
  }
  async function cancel() { try { await api('swaps/' + req.id, { method: 'PATCH', body: { action: 'cancel' } }); onChange(); } catch (e) { setErr(e.message); } }
  if (req) {
    return (
      <span className="swap-line">
        <span className="pill warn">⇄ {SWAP_STATUS[req.status]}{req.to_name ? ` · ${req.to_name}` : req.accepted_name ? ` · ${req.accepted_name}` : ' · anyone'}</span>
        <button className="btn small ghost" onClick={cancel}>Cancel swap</button>
      </span>
    );
  }
  if (!open) return <span className="swap-line"><button className="btn small ghost" onClick={() => setOpen(true)}>⇄ Ask to swap</button></span>;
  return (
    <div className="swap-form">
      <label className="field"><span>Who should take it?</span>
        <select value={to} onChange={(e) => setTo(e.target.value)}><option value="">Anyone</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="field"><span>Note (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></label>
      {err && <span style={{ color: 'var(--bad-text)', fontSize: 13 }}>{err}</span>}
      <div style={{ display: 'flex', gap: 8 }}><button className="btn small primary" onClick={ask}>Send request</button><button className="btn small ghost" onClick={() => setOpen(false)}>Cancel</button></div>
    </div>
  );
}

/** Requests from colleagues: to me, or to anyone. */
function SwapInbox({ swaps, onChange }) {
  const [err, setErr] = useState('');
  const mine = swaps.swaps.filter((w) => w.status === 'asked' && w.from_user !== swaps.me && (w.to_user === swaps.me || !w.to_user));
  const waiting = swaps.swaps.filter((w) => w.status === 'accepted' && w.accepted_by === swaps.me);
  const recent = swaps.swaps.filter((w) => ['approved', 'rejected', 'declined'].includes(w.status) && (w.from_user === swaps.me || w.accepted_by === swaps.me)).slice(0, 5);
  if (!mine.length && !waiting.length && !recent.length) return null;
  async function act(w, action) { setErr(''); try { await api('swaps/' + w.id, { method: 'PATCH', body: { action } }); onChange(); } catch (e) { setErr(e.message); } }
  const when = (w) => `${dowOf(w.date)} ${longDate(w.date)} · ${w.start}–${w.end}`;
  return (
    <div className="card">
      <div className="card-head"><div><h2>Shift swaps</h2><p>Colleagues asking you to take a shift. After you accept, a manager approves it.</p></div></div>
      {err && <div className="banner bad"><span>{err}</span></div>}
      <ul className="shift-list">
        {mine.map((w) => (
          <li key={w.id}>
            <span><b>{w.from_name}</b> {w.to_user ? 'asks you to take' : 'asks anyone to take'}</span>
            <span className="num">{when(w)}</span>
            {w.note && <small className="muted">“{w.note}”</small>}
            <span className="swap-line"><button className="btn small primary" onClick={() => act(w, 'accept')}>Accept</button>{w.to_user && <button className="btn small ghost" onClick={() => act(w, 'decline')}>Decline</button>}</span>
          </li>
        ))}
        {waiting.map((w) => <li key={w.id}><span>You take <b>{w.from_name}</b>’s shift</span><span className="num">{when(w)}</span><small className="muted">Waiting for the manager.</small></li>)}
        {recent.map((w) => <li key={w.id}><span>{w.from_name} → {w.accepted_name || w.to_name || '–'}</span><span className="num">{when(w)}</span><small className="muted">{SWAP_STATUS[w.status]}</small></li>)}
      </ul>
    </div>
  );
}
