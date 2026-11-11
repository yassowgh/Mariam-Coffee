import { useEffect, useState } from 'react';
import { api, ROLE_LABELS } from '../lib/api.js';
import { money, longDate } from '../format.js';

const ROLE_HELP = {
  owner: 'everything, including sales reports and fixed costs',
  expenses: 'records spending',
  scheduler: 'manages baristas, shifts and attendance',
  barista: 'sees own shifts, clocks in and out',
};
/** A ready-to-send email (opens the phone's or computer's email app). */
export function loginMail({ name, email, username, password }) {
  const body = `Hi ${name.split(' ')[0]},\n\nYour account for Mariam Coffee is ready. Use it to see your shifts and to clock in and out at the café.\n\nWebsite: ${location.origin}\nUsername: ${username}\nPassword: ${password}\n\nOn your phone: open the website, tap "Staff sign-in" and sign in. The first time, you will be asked to choose your own password.\nWhen you clock in or out, allow the website to use your location. It only works inside the café.\n\nThank you,\nMariam Coffee`;
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent('Your Mariam Coffee account')}&body=${encodeURIComponent(body)}`;
}

const COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#4a3aa7', '#d03b3b', '#b07d12', '#0f8fa3', '#8a4f9e'];

export default function Team({ user }) {
  const owner = user.roles.includes('owner');
  const [list, setList] = useState(null);
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState('');
  const [showOld, setShowOld] = useState(false);
  async function load() {
    try { setList((await api('users')).users); } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);
  const roleChoices = owner ? Object.keys(ROLE_LABELS) : ['barista'];

  async function toggleActive(p) {
    const text = p.active
      ? `Remove ${p.name}? They can no longer sign in and their future shifts are deleted. Their past hours are kept.`
      : `Bring back ${p.name}? They can sign in again.`;
    if (!confirm(text)) return;
    try { await api('users/' + p.id, { method: 'PATCH', body: { active: !p.active } }); load(); } catch (e) { alert(e.message); }
  }
  const shown = (list || []).filter((p) => showOld || p.active);

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div><h2>{owner ? 'Team and accounts' : 'Baristas'}</h2><p>Each person signs in with their own username and password. {owner ? 'One person can have several roles.' : 'You can add and remove baristas.'}</p></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <label className="check-inline"><input type="checkbox" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} />Show removed</label>
            <button className="btn primary" onClick={() => setEdit({ name: '', username: '', password: '', roles: owner ? [] : ['barista'], rate: '', phone: '', color: COLORS[(list?.length || 0) % COLORS.length] })}>＋ Add a person</button>
          </div>
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        {edit && <Editor edit={edit} setEdit={setEdit} roleChoices={roleChoices} self={user} onSaved={() => { setEdit(null); load(); }} />}
        {list == null ? <p className="muted">Loading…</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Username</th><th>Roles</th><th className="r">Rate / hour</th><th>Email</th><th>Phone</th><th>Since</th><th /></tr></thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id} style={p.active ? undefined : { opacity: 0.55 }}>
                    <td><i className="dot" style={{ background: p.color || 'var(--series-1)' }} />{p.name}{!p.active && <span className="pill" style={{ marginLeft: 6 }}>removed</span>}</td>
                    <td>@{p.username}</td>
                    <td>{p.roles.map((r) => ROLE_LABELS[r]).join(', ')}</td>
                    <td className="r num">{p.rate == null ? '–' : money(p.rate)}</td>
                    <td>{p.email ? <a href={`mailto:${p.email}`}>{p.email}</a> : '–'}{p.mustChange && <span className="pill warn" style={{ marginLeft: 6 }} title="Has not chosen their own password yet">not signed in yet</span>}</td>
                    <td>{p.phone ? <a href={`tel:${p.phone}`}>{p.phone}</a> : '–'}</td>
                    <td>{longDate(p.created_at.slice(0, 10))}</td>
                    <td style={{ display: 'flex', gap: 4 }}>
                      <button className="btn small ghost" onClick={() => setEdit({ ...p, password: '', rate: p.rate ?? '' })}>Edit</button>
                      {p.id !== user.id && <button className="btn small ghost" onClick={() => toggleActive(p)}>{p.active ? 'Remove' : 'Bring back'}</button>}
                    </td>
                  </tr>
                ))}
                {!shown.length && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 20 }}>Nobody yet. Add the first person.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Editor({ edit, setEdit, roleChoices, self, onSaved }) {
  const isNew = !edit.id;
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);
  const set = (patch) => setEdit({ ...edit, ...patch });
  async function save(e) {
    e.preventDefault();
    setErr('');
    try {
      const body = { name: edit.name, roles: edit.roles, rate: edit.rate, phone: edit.phone, color: edit.color, email: edit.email };
      if (isNew) await api('users', { method: 'POST', body: { ...body, username: edit.username, password: edit.password } });
      else await api('users/' + edit.id, { method: 'PATCH', body: { ...body, ...(edit.password ? { password: edit.password } : {}) } });
      if (isNew || edit.password) setDone({ username: edit.username, password: edit.password, name: edit.name, email: edit.email });
      else onSaved();
    } catch (x) { setErr(x.message); }
  }
  if (done) {
    return (
      <div className="card" style={{ borderColor: 'var(--good)', marginBottom: 16 }}>
        <h2 style={{ fontSize: 15 }}>Account ready for {done.name}</h2>
        <p>Send these to {done.name} (they can change the password after signing in):</p>
        <p className="notice" style={{ fontSize: 14 }}>Website: <b>{location.origin}</b><br />Username: <b>{done.username}</b><br />Password: <b>{done.password}</b></p>
        <p className="faint" style={{ fontSize: 12.5 }}>They will be asked to choose their own password the first time they sign in.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {done.email && <a className="btn" href={loginMail(done)}>✉ Email the login details</a>}
          <button className="btn primary" onClick={onSaved}>Done</button>
        </div>
      </div>
    );
  }
  return (
    <form className="card form-card" onSubmit={save} style={{ marginBottom: 16, borderColor: 'var(--series-1)' }}>
      <div className="card-head"><div><h2>{isNew ? 'Add a person' : `Edit ${edit.name}`}</h2></div><button type="button" className="btn small ghost" onClick={() => setEdit(null)}>Close</button></div>
      <div className="form-grid">
        <label className="field"><span>Name</span><input value={edit.name} onChange={(e) => set({ name: e.target.value })} required maxLength={80} /></label>
        <label className="field"><span>Username</span>
          <input value={edit.username} onChange={(e) => set({ username: e.target.value.toLowerCase().replace(/\s/g, '') })} required disabled={!isNew} autoCapitalize="none" pattern="[a-z0-9._\-]{3,40}" title="3–40 letters, numbers, dots or dashes" /></label>
        <label className="field"><span>{isNew ? 'Password (6+ characters)' : 'New password (leave empty to keep)'}</span>
          <input type="text" autoComplete="new-password" value={edit.password} onChange={(e) => set({ password: e.target.value })} required={isNew} minLength={6} /></label>
        <label className="field"><span>Hourly rate (TL, optional)</span><input inputMode="decimal" value={edit.rate} onChange={(e) => set({ rate: e.target.value })} /></label>
        <label className="field"><span>Email (optional)</span><input type="email" value={edit.email || ''} onChange={(e) => set({ email: e.target.value.trim() })} maxLength={120} /></label>
        <label className="field"><span>Phone (optional)</span><input type="tel" value={edit.phone} onChange={(e) => set({ phone: e.target.value })} maxLength={30} /></label>
        <div className="field"><span>Colour on the schedule</span>
          <div className="chips">{COLORS.map((c) => <button type="button" key={c} className="swatch" aria-pressed={edit.color === c} aria-label={c} style={{ background: c }} onClick={() => set({ color: c })} />)}</div></div>
        <div className="field wide"><span>Roles</span>
          <div className="role-list">
            {roleChoices.map((r) => (
              <label key={r} className="check-inline">
                <input type="checkbox" checked={edit.roles.includes(r)} disabled={edit.id === self.id && r === 'owner'}
                  onChange={(e) => set({ roles: e.target.checked ? [...edit.roles, r] : edit.roles.filter((x) => x !== r) })} />
                <b>{ROLE_LABELS[r]}</b><span className="faint">: {ROLE_HELP[r]}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
      {err && <div className="error" role="alert">{err}</div>}
      <button className="btn primary big" type="submit" style={{ marginTop: 12 }}>{isNew ? 'Create account' : 'Save'}</button>
    </form>
  );
}
