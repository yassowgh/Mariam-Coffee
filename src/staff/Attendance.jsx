import { useEffect, useMemo, useState } from 'react';
import { addDaysLocal, api, distFmt, dowOf, hoursFmt, shiftHours, shiftRange, toLocal, todayLocal, weekStart } from '../lib/api.js';
import DataTable from '../components/DataTable.jsx';
import { int, longDate, money } from '../format.js';

const GRACE_MIN = 5; // minutes late / early that still count as on time
const STALE_H = 16;
const H = 3600000;

/** Match clock records to shifts: each shift takes the nearest unused clock-in from 3 h before its start to its end. */
export function matchAttendance({ records, shifts, now }) {
  const nowMs = Date.parse(now);
  const used = new Set();
  const rows = [];
  const sorted = [...shifts].sort((a, b) => shiftRange(a)[0] - shiftRange(b)[0]);
  for (const s of sorted) {
    const [s0, s1] = shiftRange(s);
    let best = null;
    for (const r of records) {
      if (used.has(r.id) || r.user_id !== s.user_id) continue;
      const t = Date.parse(r.in_at);
      if (t < s0 - 3 * H || t >= s1) continue;
      if (!best || Math.abs(t - s0) < Math.abs(Date.parse(best.in_at) - s0)) best = r;
    }
    if (best) used.add(best.id);
    rows.push(build(s, best, s0, s1, nowMs));
  }
  for (const r of records) if (!used.has(r.id)) rows.push(build(null, r, null, null, nowMs));
  return rows;
}

function build(s, r, s0, s1, nowMs) {
  const inMs = r ? Date.parse(r.in_at) : null;
  const outMs = r?.out_at ? Date.parse(r.out_at) : null;
  const stale = r && !outMs && nowMs - inMs > STALE_H * H;
  const late = s && r ? Math.max(0, Math.round((inMs - s0) / 60000)) : null;
  const early = s && outMs ? Math.max(0, Math.round((s1 - outMs) / 60000)) : null;
  const flags = [];
  if (!s) flags.push(['Not scheduled', 'warn']);
  if (s && !r) {
    if (s1 < nowMs) flags.push(['No-show', 'bad']);
    else if (s0 > nowMs) flags.push(['Upcoming', '']);
    else flags.push([nowMs - s0 > GRACE_MIN * 60000 ? 'Not in yet' : 'Starting', nowMs - s0 > GRACE_MIN * 60000 ? 'bad' : '']);
  }
  if (late > GRACE_MIN) flags.push([`Late ${late} min`, 'bad']);
  if (early > GRACE_MIN) flags.push([`Left ${early} min early`, 'warn']);
  if (stale) flags.push(['No clock-out', 'bad']);
  else if (r && !outMs) flags.push(['In the café now', 'ok']);
  if (r?.edited_by) flags.push(['Corrected', '']);
  if (s && r && outMs && late <= GRACE_MIN && early <= GRACE_MIN) flags.unshift(['On time', 'ok']);
  const date = s ? s.date : toLocal(r.in_at).date;
  return {
    key: (s ? 's' + s.id : '') + (r ? 'r' + r.id : ''),
    shift: s, rec: r, date, user_id: s ? s.user_id : r.user_id, user_name: s ? s.user_name : r.user_name,
    sched: s ? `${s.start}–${s.end}` : '', schedH: s ? shiftHours(s) : 0,
    inT: r ? toLocal(r.in_at).time : '', outT: outMs ? toLocal(r.out_at).time : '',
    worked: inMs && outMs ? (outMs - inMs) / H : 0, late: late ?? 0, early: early ?? 0,
    stale, noShow: flags.some(([f]) => f === 'No-show'), flags,
    sortKey: s0 ?? inMs,
  };
}

export default function Attendance() {
  const today = todayLocal();
  const ws = weekStart(today);
  const presets = [
    ['This week', ws, addDaysLocal(ws, 6)],
    ['Last week', addDaysLocal(ws, -7), addDaysLocal(ws, -1)],
    ['This month', today.slice(0, 8) + '01', today],
    ['Last month', prevMonthStart(today), addDaysLocal(today.slice(0, 8) + '01', -1)],
  ];
  const [range, setRange] = useState({ from: presets[0][1], to: presets[0][2] });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [fix, setFix] = useState(null);

  async function load() {
    try { setData(await api(`attendance?from=${range.from}&to=${range.to}`)); setError(''); } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, [range.from, range.to]);

  const rows = useMemo(() => (data ? matchAttendance(data).filter((r) => r.date >= range.from && r.date <= range.to) : []), [data]);
  const people = useMemo(() => {
    if (!data) return [];
    const m = new Map();
    for (const r of rows) {
      const p = m.get(r.user_id) || { key: r.user_id, name: r.user_name, schedH: 0, worked: 0, shifts: 0, lates: 0, lateMin: 0, noShows: 0, missing: 0, extra: 0 };
      p.schedH += r.schedH; p.worked += r.worked;
      if (r.shift) p.shifts++;
      if (r.late > GRACE_MIN) { p.lates++; p.lateMin += r.late; }
      if (r.noShow) p.noShows++;
      if (r.stale) p.missing++;
      if (!r.shift) p.extra++;
      m.set(r.user_id, p);
    }
    const rate = new Map(data.people.map((p) => [p.id, p.rate]));
    return [...m.values()].map((p) => ({ ...p, rate: rate.get(p.key), pay: rate.get(p.key) != null ? p.worked * rate.get(p.key) : null }));
  }, [rows, data]);
  const inNow = (data?.records || []).filter((r) => !r.out_at && Date.parse(data.now) - Date.parse(r.in_at) < STALE_H * H);

  const columns = [
    { key: 'date', label: 'Date', render: (r) => `${dowOf(r.date)} ${longDate(r.date)}`, sortValue: (r) => r.sortKey, csv: (r) => r.date },
    { key: 'user_name', label: 'Barista' },
    { key: 'sched', label: 'Shift', fmt: (v) => v || '–' },
    { key: 'inT', label: 'In', fmt: (v) => v || '–' },
    { key: 'outT', label: 'Out', fmt: (v) => v || '–' },
    { key: 'worked', label: 'Worked', align: 'r', fmt: (v) => (v ? hoursFmt(v) : '–'), total: 'sum', csv: (r) => r.worked.toFixed(2) },
    { key: 'late', label: 'Late (min)', align: 'r', fmt: (v) => (v > GRACE_MIN ? int(v) : '–'), csv: (r) => r.late },
    { key: 'status', label: 'Status', render: (r) => <span className="flags">{r.flags.map(([t, k]) => <span key={t} className={'pill ' + k}>{t}</span>)}</span>, csv: (r) => r.flags.map(([t]) => t).join('; '), sortValue: (r) => r.flags[0]?.[0] || '' },
    { key: 'dist', label: 'Distance in / out', render: (r) => (r.rec ? `${distFmt(r.rec.in_dist)} / ${r.rec.out_at ? distFmt(r.rec.out_dist) : '–'}` : '–'), csv: (r) => (r.rec ? `${r.rec.in_dist ?? ''}/${r.rec.out_dist ?? ''}` : '') },
    { key: 'note', label: 'Correction note', render: (r) => <span className="wrap-cell">{r.rec?.note || ''}</span>, csv: (r) => r.rec?.note || '' },
    { key: 'act', label: '', render: (r) => <button className="btn small ghost" onClick={() => setFix(r)}>{r.rec ? 'Correct' : 'Add times'}</button>, csv: () => '' },
  ];

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div><h2>Attendance</h2><p>Scheduled shifts compared with clock-in and clock-out. On time = within {GRACE_MIN} minutes.</p></div>
          <div className="table-tools" style={{ margin: 0 }}>
            <div className="chips">{presets.map(([l, f, t]) => <button key={l} className="chip" aria-pressed={range.from === f && range.to === t} onClick={() => setRange({ from: f, to: t })}>{l}</button>)}</div>
            <label className="field"><span>From</span><input type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} /></label>
            <label className="field"><span>To</span><input type="date" value={range.to} min={range.from} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} /></label>
          </div>
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        {data && (
          <p className="notice" style={{ margin: 0 }}>
            <b>In the café now:</b> {inNow.length ? inNow.map((r) => `${r.user_name} (since ${toLocal(r.in_at).time})`).join(', ') : 'nobody is clocked in'}
          </p>
        )}
      </div>

      {data && (
        <div className="card">
          <div className="card-head"><div><h2>Per barista</h2><p>{longDate(range.from)} – {longDate(range.to)}. Pay = worked hours × hourly rate (set the rate in Team).</p></div></div>
          <DataTable rows={people} exportName="attendance-summary" defaultSort={{ key: 'worked', dir: 'desc' }}
            columns={[
              { key: 'name', label: 'Barista' },
              { key: 'shifts', label: 'Shifts', align: 'r', fmt: int, total: 'sum' },
              { key: 'schedH', label: 'Scheduled', align: 'r', fmt: hoursFmt, total: 'sum', csv: (r) => r.schedH.toFixed(2) },
              { key: 'worked', label: 'Worked', align: 'r', fmt: hoursFmt, total: 'sum', csv: (r) => r.worked.toFixed(2) },
              { key: 'lates', label: 'Times late', align: 'r', fmt: int, total: 'sum' },
              { key: 'lateMin', label: 'Late minutes', align: 'r', fmt: int, total: 'sum' },
              { key: 'noShows', label: 'No-shows', align: 'r', fmt: int, total: 'sum', cls: (r) => (r.noShows ? 'down' : '') },
              { key: 'missing', label: 'No clock-out', align: 'r', fmt: int, total: 'sum', cls: (r) => (r.missing ? 'down' : '') },
              { key: 'extra', label: 'Unscheduled', align: 'r', fmt: int, total: 'sum' },
              { key: 'rate', label: 'Rate / hour', align: 'r', fmt: (v) => (v == null ? '–' : money(v)) },
              { key: 'pay', label: 'Pay', align: 'r', fmt: (v) => (v == null ? '–' : money(v)), total: 'sum', csv: (r) => (r.pay == null ? '' : r.pay.toFixed(2)) },
            ]} />
        </div>
      )}

      {fix && <Fix row={fix} people={data.people} onClose={() => setFix(null)} onSaved={() => { setFix(null); load(); }} />}

      {data && (
        <div className="card">
          <div className="card-head">
            <div><h2>Shifts and clock-ins</h2><p>“Correct” fixes a forgotten clock-out or a wrong time; a reason is required and kept.</p></div>
            <button className="btn small" onClick={() => setFix({ manual: true, date: today })}>＋ Add a record by hand</button>
          </div>
          <DataTable rows={rows} columns={columns} defaultSort={{ key: 'date', dir: 'desc' }} exportName="attendance" pageSize={200}
            filters={{ search: 'user_name' }} />
        </div>
      )}
    </div>
  );
}

function Fix({ row, people, onClose, onSaved }) {
  const r = row.rec;
  const s = row.shift;
  const inL = r ? toLocal(r.in_at) : { date: row.date, time: s?.start || '' };
  const outL = r?.out_at ? toLocal(r.out_at) : { date: s && s.end <= s.start ? addDaysLocal(row.date, 1) : (r ? inL.date : row.date), time: s?.end || '' };
  const [f, setF] = useState({ user_id: s?.user_id || r?.user_id || people[0]?.id, in_date: inL.date, in_time: inL.time, out_date: outL.date, out_time: outL.time, note: '' });
  const [err, setErr] = useState('');
  async function save(e) {
    e.preventDefault();
    setErr('');
    try {
      if (r) await api('attendance/' + r.id, { method: 'PATCH', body: f });
      else await api('attendance', { method: 'POST', body: f });
      onSaved();
    } catch (x) { setErr(x.message); }
  }
  async function remove() {
    if (!confirm('Delete this clock record?')) return;
    try { await api('attendance/' + r.id, { method: 'DELETE' }); onSaved(); } catch (x) { setErr(x.message); }
  }
  return (
    <form ref={scrollOnce} className="card form-card editor" onSubmit={save} style={{ borderColor: 'var(--series-1)' }}>
      <div className="card-head"><div><h2>{r ? `Correct ${row.user_name}, ${longDate(row.date)}` : 'Add clock times by hand'}</h2><p>{s ? `Shift ${s.start}–${s.end}` : 'Not linked to a shift'}</p></div>
        <button type="button" className="btn small ghost" onClick={onClose}>Close</button></div>
      <div className="form-grid">
        {!r && <label className="field"><span>Barista</span>
          <select value={f.user_id} onChange={(e) => setF({ ...f, user_id: e.target.value })} disabled={!!s}>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
        <label className="field"><span>In – date</span><input type="date" value={f.in_date} onChange={(e) => setF({ ...f, in_date: e.target.value })} required /></label>
        <label className="field"><span>In – time</span><input type="time" value={f.in_time} onChange={(e) => setF({ ...f, in_time: e.target.value })} required /></label>
        <label className="field"><span>Out – date</span><input type="date" value={f.out_date} onChange={(e) => setF({ ...f, out_date: e.target.value })} /></label>
        <label className="field"><span>Out – time</span><input type="time" value={f.out_time} onChange={(e) => setF({ ...f, out_time: e.target.value })} /></label>
        <label className="field wide"><span>Reason (required)</span><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} required maxLength={200} placeholder="e.g. forgot to clock out, left at 16:05" /></label>
      </div>
      {err && <div className="error" role="alert">{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn primary big" type="submit">Save</button>
        {r && <button type="button" className="btn big" onClick={remove}>Delete record</button>}
      </div>
    </form>
  );
}
const prevMonthStart = (d) => {
  const [y, m] = d.split('-').map(Number);
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`;
};

const scrollOnce = (el) => { if (el && !el.dataset.shown) { el.dataset.shown = '1'; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } };
