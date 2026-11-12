import { useEffect, useMemo, useState } from 'react';
import { addDaysLocal, api, hoursFmt, shiftHours } from '../lib/api.js';
import { DAY_NAMES, DAY_SHORT, DEFAULT_SETTINGS, buildSchedule, describeRule, fromSlot, hoursFromDemand } from '../lib/autoSchedule.js';
import { loadSaved } from '../lib/remote.js';
import { PARSER_EXAMPLES, parseConditions } from '../lib/ruleParser.js';
import { collectTables } from '../lib/archive.js';
import { buildModel } from '../lib/model.js';
import { computeDemand } from '../lib/demand.js';
import { int, longDate, shortDate } from '../format.js';

const RULE_TYPES = [
  ['off', 'Day off'],
  ['available', 'Can only work between'],
  ['fixed', 'Must work (fixed shift)'],
  ['maxHours', 'At most N hours this week'],
  ['minHours', 'At least N hours this week'],
  ['maxDays', 'At most N days this week'],
  ['minStaff', 'At least N baristas at the café'],
];
const EXAMPLE = 'Jawad can work on Tuesday after 8\nAbrar is off on Friday\nAt least 2 baristas on Friday from 17:00\nEssa at most 30 hours this week';

/** Loads the sales pattern: saved by the owner, or worked out here from the saved sales data. */
export function useDemand(compute) {
  const [state, setState] = useState({ demand: null, msg: 'Loading the sales pattern…', frac: 0 });
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const { demand } = await api('demand');
        if (!off) setState({ demand });
        return;
      } catch (e) {
        if (e.status !== 404) { if (!off) setState({ error: e.message }); return; }
      }
      if (!compute) { if (!off) setState({ missing: true }); return; }
      try {
        const got = await loadSaved((msg, frac) => !off && setState({ msg, frac: frac * 0.3 }));
        if (!got.file) throw new Error('No sales data has been uploaded yet, so the busy times are unknown.');
        const entries = await collectTables([got.file], () => {});
        const m = await buildModel(entries, (msg, frac) => !off && setState({ msg: 'Reading sales: ' + msg, frac: 0.3 + frac * 0.7 }));
        const demand = computeDemand(m);
        fetch('/api/demand', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(demand) }).catch(() => {});
        if (!off) setState({ demand });
      } catch (e) {
        if (!off) setState({ error: e.message });
      }
    })();
    return () => { off = true; };
  }, [compute]);
  return state;
}

export default function AutoPlanner({ week, people, demandState, existing, onClose, onSaved }) {
  const { demand } = demandState;
  const dates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysLocal(week, i)), [week]);
  const [text, setText] = useState('');
  const [rules, setRules] = useState([]);
  const [unclear, setUnclear] = useState([]);
  const [copied, setCopied] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const [plan, setPlan] = useState(null);

  useEffect(() => {
    api('plan-rules?week=' + week).then((r) => { setText(r.text || ''); setRules(r.rules || []); setCopied(r.copied); }).catch(() => {});
    api('plan-settings').then((r) => r.settings && setSettings({ ...DEFAULT_SETTINGS, ...r.settings })).catch(() => {});
  }, [week]);

  const hours = settings.hours || (demand ? hoursFromDemand(demand) : null);

  // 1) the built-in reader (free, instant); 2) only the sentences it could not read go to the AI on the server
  async function readText() {
    setMsg(null);
    const local = parseConditions(text, people);
    let found = local.rules, left = local.unclear, aiNote = '';
    if (left.length) {
      setBusy('Asking the AI about ' + left.length + ' sentence' + (left.length === 1 ? '' : 's') + '…');
      try {
        const sentencesLeft = left.map((u) => u.slice(0, u.lastIndexOf(': ')));
        const r = await api('plan-parse', { method: 'POST', body: { text: sentencesLeft.join('\n'), week, hours } });
        found = [...found, ...r.rules];
        // a sentence the AI neither turned into a rule nor listed as unclear must not disappear
        const said = (x) => x.toLowerCase().replace(/\s+/g, ' ').trim();
        const covered = (sen) => r.rules.some((q) => q.text && (said(q.text).includes(said(sen)) || said(sen).includes(said(q.text))))
          || r.unclear.some((u) => said(u).includes(said(sen).slice(0, 25)));
        left = [...r.unclear, ...sentencesLeft.filter((sen) => !covered(sen)).map((sen) => `${sen}: not understood`)];
        if (r.rules.length) aiNote = ` ${r.rules.length} read by ${r.by}: please check those.`;
      } catch (e) {
        aiNote = ` (${e.message})`;
      } finally { setBusy(''); }
    }
    setRules(found);
    setUnclear(left);
    setMsg({ ok: !left.length, text: `Understood ${found.length} condition${found.length === 1 ? '' : 's'}.${aiNote}${left.length ? ' Some sentences were not understood (see below).' : ''}` });
  }
  function create() {
    if (!demand) return;
    const r = buildSchedule({ dates, people, demand, settings, rules });
    setPlan(r);
    api('plan-rules?week=' + week, { method: 'PUT', body: { text, rules } }).catch(() => {});
    api('plan-settings', { method: 'PUT', body: settings }).catch(() => {});
    setTimeout(() => document.getElementById('plan-preview')?.scrollIntoView({ behavior: 'smooth' }), 50);
  }
  async function save() {
    if (existing > 0 && !confirm(`This week already has ${existing} shifts. Replace them with the new schedule?`)) return;
    try {
      await api('shifts', { method: 'POST', body: { shifts: plan.shifts.map(({ user_id, date, start, end, note }) => ({ user_id, date, start, end, note })), replaceRange: { from: dates[0], to: dates[6] } } });
      onSaved();
    } catch (e) { setMsg({ ok: false, text: e.message }); }
  }

  return (
    <div className="card form-card planner" style={{ borderColor: 'var(--accent)' }}>
      <div className="card-head">
        <div><h2>✨ Automatic schedule · week of {longDate(week)}</h2>
          <p>Write the conditions in your own words. The schedule follows the café’s busy times from the sales, with a short overlap at every hand-over.</p></div>
        <button className="btn small ghost" onClick={onClose}>Close</button>
      </div>

      {demandState.error && <div className="error" role="alert">{demandState.error}</div>}
      {!demand && !demandState.error && (
        <div className="notice">{demandState.msg}<div className="progress"><div style={{ width: Math.round((demandState.frac || 0) * 100) + '%' }} /></div></div>
      )}
      {demand && (
        <p className="faint" style={{ fontSize: 12.5, margin: '0 0 12px' }}>
          Busy times: average orders per hour, {longDate(demand.from)} – {longDate(demand.to)} ({demand.weeks} weeks).
          {' '}Per day: {[1, 2, 3, 4, 5, 6, 0].map((i) => `${DAY_SHORT[i]} ~${Math.round(demand.days[i].orders)}`).join(' · ')} orders.
        </p>
      )}

      <label className="field"><span>Conditions for this week{copied ? ` (copied from the week of ${longDate(copied)})` : ''}</span>
        <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLE} /></label>
      <details className="faint" style={{ fontSize: 12.5, marginTop: 4 }}>
        <summary style={{ cursor: 'pointer' }}>How to write conditions</summary>
        <p style={{ margin: '4px 0' }}>One condition per line. Use the barista’s name, the day and the time. Times without am/pm: 7–11 = morning, 1–6 = afternoon; write 01:00 or 1am for after midnight. Examples:</p>
        <ul style={{ margin: 0, paddingLeft: 18 }}>{PARSER_EXAMPLES.map((x) => <li key={x}>{x}</li>)}</ul>
        <p style={{ margin: '4px 0 0' }}>Sentences the website cannot read are passed to an AI; the conditions it reads are marked “AI”.</p>
      </details>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <button className="btn" onClick={readText} disabled={!!busy || !text.trim()}>{busy || 'Read conditions'}</button>
        <AddRule people={people} onAdd={(r) => setRules([...rules, r])} />
      </div>
      {msg && <div className={'banner ' + (msg.ok ? 'ok' : 'bad')} role="status" style={{ marginTop: 10 }}><span>{msg.text}</span></div>}
      {unclear.length > 0 && (
        <div className="banner bad" style={{ marginTop: 10, display: 'block' }}>
          <b>Not understood (rephrase or add by hand):</b>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{unclear.map((u) => <li key={u}>{u}</li>)}</ul>
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <b style={{ fontSize: 13 }}>Conditions used ({rules.length})</b>
        {rules.length ? (
          <ul className="rule-list">
            {rules.map((r, i) => (
              <li key={i}><span>{describeRule(r, people)}{r.source && r.source !== 'built-in' && <span className="pill warn" style={{ marginLeft: 6 }} title="Read by AI: check it is right">AI</span>}</span>{r.text && <small className="faint">“{r.text}”</small>}
                <button className="btn small ghost" onClick={() => setRules(rules.filter((_, j) => j !== i))} aria-label="Remove this condition">✕</button></li>
            ))}
          </ul>
        ) : <p className="faint" style={{ margin: '4px 0 0', fontSize: 13 }}>None: everyone can work any time, up to the limits below.</p>}
      </div>

      <details className="plan-settings">
        <summary>Settings: orders per barista, overlap, shift length, opening hours</summary>
        <div className="form-grid" style={{ marginTop: 10 }}>
          <Num label="Orders one barista handles per hour" v={settings.perBarista} set={(v) => setSettings({ ...settings, perBarista: v })} min={1} />
          <Num label="Minimum baristas while open" v={settings.minStaff} set={(v) => setSettings({ ...settings, minStaff: v })} min={1} />
          <Num label="Overlap at hand-over (minutes)" v={settings.overlap} set={(v) => setSettings({ ...settings, overlap: v })} min={0} step={15} />
          <Num label="Shortest shift (hours)" v={settings.minShift} set={(v) => setSettings({ ...settings, minShift: v })} min={2} />
          <Num label="Longest shift (hours)" v={settings.maxShift} set={(v) => setSettings({ ...settings, maxShift: v })} min={3} />
          <Num label="Most hours per barista per week" v={settings.maxWeekHours} set={(v) => setSettings({ ...settings, maxWeekHours: v })} min={4} />
          <Num label="Most days per barista per week" v={settings.maxDays} set={(v) => setSettings({ ...settings, maxDays: v })} min={1} />
        </div>
        {hours && (
          <div style={{ marginTop: 12 }}>
            <b style={{ fontSize: 13 }}>Opening hours</b> <span className="faint" style={{ fontSize: 12.5 }}>{settings.hours ? '(set by you)' : '(from the sales: first to last busy hour)'}</span>
            <div className="hours-grid">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                const h = hours[d];
                const setH = (val) => { const next = [...hours]; next[d] = val; setSettings({ ...settings, hours: next }); };
                return (
                  <div key={d} className="hours-row">
                    <span>{DAY_SHORT[d]}</span>
                    <label className="check-inline"><input type="checkbox" checked={!!h} onChange={(e) => setH(e.target.checked ? { open: '08:00', close: '23:00' } : null)} />Open</label>
                    {h && <><input type="time" value={h.open} onChange={(e) => setH({ ...h, open: e.target.value })} aria-label={`${DAY_NAMES[d]} opens`} />–
                      <input type="time" value={h.close} onChange={(e) => setH({ ...h, close: e.target.value })} aria-label={`${DAY_NAMES[d]} closes`} /></>}
                  </div>
                );
              })}
            </div>
            {settings.hours && <button className="btn small ghost" onClick={() => setSettings({ ...settings, hours: null })}>Use the hours from the sales again</button>}
          </div>
        )}
      </details>

      <button className="btn primary big" style={{ marginTop: 14 }} onClick={create} disabled={!demand || !people.length}>Create schedule</button>
      {!people.length && <p className="faint">Add baristas in Team first.</p>}

      {plan && <Preview plan={plan} people={people} dates={dates} onSave={save} />}
    </div>
  );
}

function Num({ label, v, set, min, step = 1 }) {
  return (
    <label className="field"><span>{label}</span>
      <input type="number" min={min} step={step} value={v} onChange={(e) => e.target.value !== '' && set(Number(e.target.value))} /></label>
  );
}

function AddRule({ people, onAdd }) {
  const [open, setOpen] = useState(false);
  const [r, setR] = useState({ type: 'off', person: people[0]?.username || '', days: [], from: '', to: '', number: '' });
  if (!open) return <button className="btn" onClick={() => setOpen(true)}>＋ Add a condition</button>;
  const needsTime = ['available', 'fixed', 'minStaff'].includes(r.type);
  const needsNum = ['maxHours', 'minHours', 'maxDays', 'minStaff'].includes(r.type);
  const needsDays = !['maxHours', 'minHours', 'maxDays'].includes(r.type);
  function add() {
    if (needsNum && !r.number) { alert('Enter the number.'); return; }
    if (r.type === 'fixed' && (!r.from || !r.to)) { alert('Enter the start and end time.'); return; }
    onAdd({ type: r.type, person: r.type === 'minStaff' ? null : r.person, days: needsDays ? r.days : [], from: needsTime ? r.from || null : null, to: needsTime ? r.to || null : null, number: needsNum ? Number(r.number) : null, text: '' });
    setOpen(false);
    setR({ ...r, days: [], from: '', to: '', number: '' });
  }
  return (
    <div className="add-rule">
      <select value={r.type} onChange={(e) => setR({ ...r, type: e.target.value })} aria-label="Kind of condition">{RULE_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      {r.type !== 'minStaff' && <select value={r.person} onChange={(e) => setR({ ...r, person: e.target.value })} aria-label="Barista">{people.map((p) => <option key={p.id} value={p.username}>{p.name}</option>)}</select>}
      {needsNum && <input type="number" min={1} value={r.number} onChange={(e) => setR({ ...r, number: e.target.value })} placeholder="N" style={{ width: 70 }} aria-label="Number" />}
      {needsTime && <><input type="time" value={r.from} onChange={(e) => setR({ ...r, from: e.target.value })} aria-label="From" />–<input type="time" value={r.to} onChange={(e) => setR({ ...r, to: e.target.value })} aria-label="To" /></>}
      {needsDays && (
        <div className="chips">{[1, 2, 3, 4, 5, 6, 0].map((d) => (
          <button key={d} type="button" className="chip" aria-pressed={r.days.includes(d)} onClick={() => setR({ ...r, days: r.days.includes(d) ? r.days.filter((x) => x !== d) : [...r.days, d] })}>{DAY_SHORT[d]}</button>
        ))}</div>
      )}
      <span className="faint" style={{ fontSize: 12 }}>{needsDays && !r.days.length ? 'no day chosen = every day' : ''}</span>
      <button className="btn small primary" onClick={add}>Add</button>
      <button className="btn small ghost" onClick={() => setOpen(false)}>Cancel</button>
    </div>
  );
}

function Preview({ plan, people, dates, onSave }) {
  const name = (id) => people.find((p) => p.id === id)?.name || '?';
  const color = (id) => people.find((p) => p.id === id)?.color || 'var(--series-1)';
  return (
    <div id="plan-preview" style={{ marginTop: 18 }}>
      <h3 style={{ fontSize: 15, marginBottom: 8 }}>Proposed schedule</h3>
      {plan.warnings.length > 0 && (
        <div className="banner bad" style={{ display: 'block' }}>
          <b>Check:</b>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{plan.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
      <div className="table-wrap">
        <table className="schedule">
          <thead><tr><th>Barista</th>{plan.days.map((d) => <th key={d.date}>{DAY_SHORT[d.dow]} {shortDate(d.date)}<br /><small className="faint">~{int(d.dayOrders)} orders</small></th>)}<th className="r">Hours</th><th className="r">Orders</th></tr></thead>
          <tbody>
            {people.map((p) => {
              const sum = plan.people.find((x) => x.id === p.id);
              return (
                <tr key={p.id}>
                  <td className="who"><i className="dot" style={{ background: color(p.id) }} />{p.name}</td>
                  {plan.days.map((d) => (
                    <td key={d.date} className="cell">
                      {plan.shifts.filter((s) => s.user_id === p.id && s.date === d.date).map((s) => (
                        <div key={s.start} className="shift" style={{ borderLeftColor: color(p.id), cursor: 'default' }} title={`${name(s.user_id)}: about ${s.orders} café orders during this shift, ~${s.share} of them per barista`}>
                          {s.start}–{s.end}<small>~{s.orders} orders{s.kind === 'fixed' ? ' · fixed' : ''}</small>
                        </div>
                      ))}
                    </td>
                  ))}
                  <td className="r num">{hoursFmt(sum?.hours || 0)}</td>
                  <td className="r num">~{int(sum?.orders || 0)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr><td>Staff hours</td>{plan.days.map((d) => {
              const h = plan.shifts.filter((s) => s.date === d.date).reduce((t, s) => t + shiftHours(s), 0);
              return <td key={d.date} className="num">{hoursFmt(h)}{h > 0 && <small className="faint" style={{ display: 'block' }}>{(d.dayOrders / h).toFixed(1)} orders / staff-hour</small>}</td>;
            })}<td className="r num">{hoursFmt(plan.shifts.reduce((t, s) => t + shiftHours(s), 0))}</td><td /></tr>
          </tfoot>
        </table>
      </div>
      <Coverage days={plan.days} />
      <p className="faint" style={{ fontSize: 12.5 }}>“Orders” = average café orders during the shift on that weekday; the Orders column shares each half hour between the baristas on duty.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn primary big" onClick={onSave}>Save as this week’s schedule</button>
        <span className="faint" style={{ alignSelf: 'center', fontSize: 12.5 }}>You can still change single shifts afterwards.</span>
      </div>
    </div>
  );
}

/** Half-hour strip per day: green = enough baristas, red = short, grey = closed. Number = baristas on duty. */
function Coverage({ days }) {
  return (
    <div className="coverage" aria-label="Baristas on duty compared with what the orders need">
      <div className="legend" style={{ margin: '12px 0 6px' }}>
        <span><i className="bar" style={{ background: 'color-mix(in srgb, var(--good) 45%, transparent)' }} />enough baristas</span>
        <span><i className="bar" style={{ background: 'color-mix(in srgb, var(--bad) 55%, transparent)' }} />short</span>
        <span><i className="bar" style={{ background: 'color-mix(in srgb, var(--series-1) 30%, transparent)' }} />more than needed</span>
      </div>
      {days.map((d) => d.open == null ? null : (
        <div key={d.date} className="cov-row">
          <span className="cov-day">{DAY_SHORT[d.dow]}</span>
          <div className="cov-cells">
            {Array.from({ length: d.close - d.open }, (_, i) => {
              const k = d.open + i;
              const c = d.cover[k], n = d.need[k];
              const cls = c < n ? 'short' : c > n ? 'over' : 'ok';
              return <span key={k} className={'cov ' + cls} title={`${fromSlot(k)}: ${c} on duty, ${n} needed, ~${Math.round(d.orders[k] * 2)} orders/hour`}>{k % 2 === 0 ? c : ''}</span>;
            })}
          </div>
          <span className="cov-time faint">{fromSlot(d.open)}–{fromSlot(d.close % 48)}</span>
        </div>
      ))}
    </div>
  );
}
