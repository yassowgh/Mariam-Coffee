import { useEffect, useState } from 'react';
import { api, distFmt, dowOf, getLocation, hoursFmt, shiftHours, toLocal } from '../lib/api.js';
import { longDate } from '../format.js';

/** Barista page: clock in / out (only inside the café) and see your shifts and hours. */
export default function Clock() {
  const [st, setSt] = useState(null);
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
          <div className="banner bad" style={{ margin: 0 }}><span>You did not clock out after your shift on {longDate(toLocal(st.forgotten.in_at).date)} (in at {toLocal(st.forgotten.in_at).time}). Tell the admin the time you left so it can be corrected.</span></div>
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
                {s.note && <small className="muted">{s.note}</small>}
              </li>
            ))}
          </ul>
        ) : <p className="muted" style={{ margin: 0 }}>No shifts planned yet.</p>}
      </div>

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
