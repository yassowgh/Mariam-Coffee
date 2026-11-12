import { useEffect, useMemo, useState } from 'react';
import { addDaysLocal, api, dowOf, hoursFmt, shiftHours, shiftRange, todayLocal, weekStart } from '../lib/api.js';
import { int, longDate, shortDate } from '../format.js';
import AutoPlanner, { useDemand } from './AutoPlanner.jsx';
import { ordersBetween } from '../lib/autoSchedule.js';

export default function Schedule({ go }) {
  const [week, setWeek] = useState(weekStart(todayLocal()));
  const [people, setPeople] = useState(null);
  const [shifts, setShifts] = useState(null);
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState('');
  const [auto, setAuto] = useState(false);
  const [mailing, setMailing] = useState(false);
  const [mailMsg, setMailMsg] = useState(null);
  async function emailWeek() {
    if (!confirm(`Email every barista their shifts for the week of ${longDate(week)}?`)) return;
    setMailing(true); setMailMsg(null);
    try {
      const r = await api('schedule-email', { method: 'POST', body: { week } });
      const parts = [];
      if (r.sent.length) parts.push(`Sent to ${r.sent.join(', ')}.`);
      if (r.noEmail.length) parts.push(`No email address for ${r.noEmail.join(', ')} (add it in Team).`);
      if (r.failed.length) parts.push(`Failed: ${r.failed.map((f) => `${f.name} (${f.error})`).join('; ')}.`);
      setMailMsg({ ok: !r.failed.length && r.sent.length > 0, text: parts.join(' ') || 'Nobody to send to.' });
    } catch (e) { setMailMsg({ ok: false, text: e.message }); } finally { setMailing(false); }
  }
  const demandState = useDemand(auto);
  const demand = demandState.demand;
  const dayOrders = (d) => (demand ? demand.days[new Date(d + 'T00:00:00Z').getUTCDay()].orders : null);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysLocal(week, i)), [week]);
  const end = days[6];

  async function load() {
    setError('');
    try {
      const [u, s] = await Promise.all([api('users'), api(`shifts?from=${week}&to=${end}`)]);
      setPeople(u.users.filter((p) => p.active && p.roles.includes('barista')));
      setShifts(s.shifts);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, [week]);

  // the start/end pairs used most, as one-tap choices
  const templates = useMemo(() => {
    const m = new Map();
    for (const s of shifts || []) m.set(`${s.start}-${s.end}`, (m.get(`${s.start}-${s.end}`) || 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k.split('-'));
  }, [shifts]);

  async function copyLastWeek() {
    try {
      const prev = (await api(`shifts?from=${addDaysLocal(week, -7)}&to=${addDaysLocal(week, -1)}`)).shifts;
      if (!prev.length) { alert('Last week has no shifts to copy.'); return; }
      let replace = false;
      if (shifts.length) {
        replace = confirm(`This week already has ${shifts.length} shifts.\n\nOK = replace them with last week's ${prev.length} shifts\nCancel = keep them and add last week's on top`);
      }
      const activeIds = new Set(people.map((p) => p.id));
      const list = prev.filter((s) => activeIds.has(s.user_id)).map((s) => ({ user_id: s.user_id, date: addDaysLocal(s.date, 7), start: s.start, end: s.end, note: s.note }));
      await api('shifts', { method: 'POST', body: { shifts: list, ...(replace ? { replaceRange: { from: week, to: end } } : {}) } });
      load();
    } catch (e) { alert(e.message); }
  }
  async function clearWeek() {
    if (!confirm(`Remove all ${shifts.length} shifts from ${longDate(week)} to ${longDate(end)}?`)) return;
    try { await api(`shifts?from=${week}&to=${end}`, { method: 'DELETE' }); load(); } catch (e) { alert(e.message); }
  }

  const byCell = useMemo(() => {
    const m = new Map();
    for (const s of shifts || []) {
      const k = s.user_id + '|' + s.date;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(s);
    }
    return m;
  }, [shifts]);
  const today = todayLocal();

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div><h2>Week of {longDate(week)}</h2><p>Tap a shift to change or remove it, or ＋ to add one. Baristas see their own shifts when they sign in.</p></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} className="no-print">
            <div className="seg" role="group" aria-label="Week">
              <button onClick={() => setWeek(addDaysLocal(week, -7))} aria-label="Previous week">‹ Prev</button>
              <button onClick={() => setWeek(weekStart(today))} aria-pressed={week === weekStart(today)}>This week</button>
              <button onClick={() => setWeek(addDaysLocal(week, 7))} aria-label="Next week">Next ›</button>
            </div>
            <button className="btn primary" onClick={() => setAuto(true)} disabled={!people}>✨ Create automatically</button>
            <button className="btn" onClick={emailWeek} disabled={!shifts?.length || mailing}>{mailing ? 'Sending…' : '✉ Email each barista their shifts'}</button>
            <button className="btn" onClick={copyLastWeek} disabled={!shifts}>Copy last week</button>
            <button className="btn ghost" onClick={clearWeek} disabled={!shifts?.length}>Clear week</button>
            <button className="btn ghost" onClick={() => window.print()}>Print</button>
          </div>
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        {mailMsg && <div className={'banner ' + (mailMsg.ok ? 'ok' : 'bad')} role="status"><span>{mailMsg.text}</span><button className="btn small ghost" onClick={() => setMailMsg(null)} aria-label="Dismiss">✕</button></div>}
        {people && !people.length && (
          <div className="notice">No baristas yet. Add them in <button className="linklike" style={{ textDecoration: 'underline' }} onClick={() => go('team')}>Team</button> first.</div>
        )}
        {people && shifts && people.length > 0 && (
          <div className="table-wrap">
            <table className="schedule">
              <thead>
                <tr>
                  <th>Barista</th>
                  {days.map((d) => <th key={d} className={d === today ? 'today' : ''}>{dowOf(d)} {shortDate(d)}{demand && <small className="faint" style={{ display: 'block', fontWeight: 500 }}>~{int(dayOrders(d))} orders</small>}</th>)}
                  <th className="r">Hours</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => {
                  const hours = (shifts || []).filter((s) => s.user_id === p.id).reduce((t, s) => t + shiftHours(s), 0);
                  return (
                    <tr key={p.id}>
                      <td className="who"><i className="dot" style={{ background: p.color || 'var(--series-1)' }} />{p.name}</td>
                      {days.map((d) => (
                        <td key={d} className={'cell' + (d === today ? ' today' : '')}>
                          {(byCell.get(p.id + '|' + d) || []).map((s) => (
                            <button key={s.id} className="shift" style={{ borderLeftColor: p.color || 'var(--series-1)' }} onClick={() => setEdit({ ...s })} title={s.note || ''}>
                              {s.start}–{s.end}
                              {demand && <small>~{ordersBetween(demand, new Date(s.date + 'T00:00:00Z').getUTCDay(), s.start, s.end)} orders</small>}
                              {s.note && !s.note.startsWith('auto ·') ? <small>{s.note}</small> : null}
                            </button>
                          ))}
                          <button className="add no-print" onClick={() => setEdit({ user_id: p.id, date: d, start: templates[0]?.[0] || '', end: templates[0]?.[1] || '', note: '', repeat: [] })} aria-label={`Add a shift for ${p.name} on ${longDate(d)}`}>＋</button>
                        </td>
                      ))}
                      <td className="r num">{hoursFmt(hours)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td>On shift</td>
                  {days.map((d) => {
                    const list = (shifts || []).filter((s) => s.date === d);
                    return <td key={d} className="num">{new Set(list.map((s) => s.user_id)).size} people · {hoursFmt(list.reduce((t, s) => t + shiftHours(s), 0))}</td>;
                  })}
                  <td className="r num">{hoursFmt((shifts || []).reduce((t, s) => t + shiftHours(s), 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
      {auto && people && (
        <AutoPlanner week={week} people={people} demandState={demandState} existing={shifts?.length || 0}
          onClose={() => setAuto(false)} onSaved={() => { setAuto(false); load(); window.scrollTo(0, 0); }} />
      )}
      {edit && <ShiftEditor edit={edit} setEdit={setEdit} people={people} days={days} shifts={shifts} templates={templates} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

function ShiftEditor({ edit, setEdit, people, days, shifts, templates, onSaved }) {
  const [err, setErr] = useState('');
  const isNew = !edit.id;
  const repeat = edit.repeat || [];
  const targets = isNew ? [...new Set([edit.date, ...repeat])] : [edit.date];
  const overlaps = targets.filter((d) => {
    if (!edit.start || !edit.end) return false;
    const [a, b] = shiftRange({ date: d, start: edit.start, end: edit.end });
    return shifts.some((s) => s.id !== edit.id && s.user_id === Number(edit.user_id) && (() => { const [c, e] = shiftRange(s); return a < e && c < b; })());
  });
  async function save(e) {
    e.preventDefault();
    setErr('');
    try {
      const base = { user_id: Number(edit.user_id), start: edit.start, end: edit.end, note: edit.note };
      if (isNew) await api('shifts', { method: 'POST', body: { shifts: targets.map((date) => ({ ...base, date })) } });
      else await api('shifts/' + edit.id, { method: 'PATCH', body: { ...base, date: edit.date } });
      onSaved();
    } catch (x) { setErr(x.message); }
  }
  async function remove() {
    if (!confirm('Remove this shift?')) return;
    try { await api('shifts/' + edit.id, { method: 'DELETE' }); onSaved(); } catch (x) { setErr(x.message); }
  }
  const set = (patch) => setEdit({ ...edit, ...patch });
  return (
    <form ref={scrollOnce} className="card form-card editor" onSubmit={save}>
      <div className="card-head"><div><h2>{isNew ? 'Add a shift' : 'Change shift'}</h2>
        <p>{edit.start && edit.end && isTime(edit.start) && isTime(edit.end) ? `${hoursFmt(shiftHours(edit))}${edit.end <= edit.start ? ', ends after midnight' : ''}` : 'Times in 24-hour format.'}</p></div>
        <button type="button" className="btn small ghost" onClick={() => setEdit(null)}>Close</button>
      </div>
      <div className="form-grid">
        <label className="field"><span>Barista</span>
          <select value={edit.user_id} onChange={(e) => set({ user_id: e.target.value })}>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="field"><span>Date</span><input type="date" value={edit.date} onChange={(e) => e.target.value && set({ date: e.target.value })} required /></label>
        <label className="field"><span>Start</span><input type="time" value={edit.start} onChange={(e) => set({ start: e.target.value })} required /></label>
        <label className="field"><span>End</span><input type="time" value={edit.end} onChange={(e) => set({ end: e.target.value })} required /></label>
        {templates.length > 0 && (
          <div className="field wide"><span>Quick times</span>
            <div className="chips">{templates.map(([a, b]) => <button type="button" key={a + b} className="chip" aria-pressed={edit.start === a && edit.end === b} onClick={() => set({ start: a, end: b })}>{a}–{b}</button>)}</div></div>
        )}
        {isNew && (
          <div className="field wide"><span>Same shift on other days this week</span>
            <div className="chips">{days.filter((d) => d !== edit.date).map((d) => (
              <button type="button" key={d} className="chip" aria-pressed={repeat.includes(d)} onClick={() => set({ repeat: repeat.includes(d) ? repeat.filter((x) => x !== d) : [...repeat, d] })}>{dowOf(d)} {shortDate(d)}</button>
            ))}</div></div>
        )}
        <label className="field wide"><span>Note (optional)</span><input value={edit.note || ''} onChange={(e) => set({ note: e.target.value })} maxLength={120} placeholder="e.g. opening, training" /></label>
      </div>
      {overlaps.length > 0 && <div className="banner bad" style={{ marginTop: 12 }}><span>⚠ This overlaps another shift of the same barista on {overlaps.map((d) => shortDate(d)).join(', ')}.</span></div>}
      {err && <div className="error" role="alert">{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn primary big" type="submit">{isNew ? (targets.length > 1 ? `Add ${targets.length} shifts` : 'Add shift') : 'Save'}</button>
        {!isNew && <button type="button" className="btn big" onClick={remove}>Remove shift</button>}
      </div>
    </form>
  );
}
const isTime = (s) => /^\d{2}:\d{2}$/.test(s || '');

const scrollOnce = (el) => { if (el && !el.dataset.shown) { el.dataset.shown = '1'; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } };
