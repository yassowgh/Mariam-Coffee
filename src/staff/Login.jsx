import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function Login({ firstRun, error: initialError, onDone }) {
  const [forgot, setForgot] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError || '');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { user } = await api('login', { method: 'POST', body: { username, password } });
      onDone(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="card login" onSubmit={submit}>
      <h2>Sign in</h2>
      <p className="muted" style={{ margin: '4px 0 16px' }}>Use the username and password you were given.</p>
      {firstRun && (
        <p className="notice" style={{ margin: '0 0 14px' }}>
          First time: sign in with username <b>owner</b> and the upload password. You can then add accounts for the team and change the password.
        </p>
      )}
      <label className="field"><span>Username</span>
        <input autoComplete="username" autoCapitalize="none" autoCorrect="off" value={username} onChange={(e) => setUsername(e.target.value)} required /></label>
      <label className="field"><span>Password</span>
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
      {error && <div className="error" role="alert" style={{ marginTop: 0 }}>{error}</div>}
      <button className="btn primary big" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      <button type="button" className="linklike" style={{ alignSelf: 'center', textDecoration: 'underline', fontSize: 13.5, minHeight: 36 }} onClick={() => setForgot(true)}>Forgot your password?</button>
      {forgot && <Forgot initial={username} onClose={() => setForgot(false)} />}
    </form>
  );
}

/** Ask for a link to choose a new password (sent to the email on the account). */
function Forgot({ initial, onClose }) {
  const [who, setWho] = useState(initial || '');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true); setMsg(null);
    try { const r = await api('password-forgot', { method: 'POST', body: { who } }); setMsg({ ok: true, text: r.message }); } catch (e) { setMsg({ ok: false, text: e.message }); } finally { setBusy(false); }
  }
  return (
    <div className="notice" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <b>Reset your password</b>
      <span>Enter your username or email address. We email you a link to choose a new password.</span>
      <input value={who} onChange={(e) => setWho(e.target.value)} autoCapitalize="none" style={{ minHeight: 44, border: '1px solid var(--border)', borderRadius: 8, padding: '0 10px', fontSize: 16 }} aria-label="Username or email" />
      {msg && <span style={{ color: msg.ok ? 'var(--good-text)' : 'var(--bad-text)' }}>{msg.text}</span>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn primary" onClick={send} disabled={busy || !who.trim()}>{busy ? 'Sending…' : 'Send the link'}</button>
        <button type="button" className="btn ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

/** Opened from an invitation (?set=) or reset (?reset=) email: choose a password. */
export function SetPassword({ token, onDone }) {
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => { api('password-reset', { method: 'POST', body: { token, check: true } }).then(setInfo).catch((e) => setErr(e.message)); }, [token]);
  async function save(e) {
    e.preventDefault();
    setErr('');
    if (pw !== pw2) { setErr('The two passwords are not the same.'); return; }
    try { await api('password-reset', { method: 'POST', body: { token, password: pw } }); setDone(true); } catch (x) { setErr(x.message); }
  }
  if (done) return (
    <div className="card login"><h2>Password saved</h2><p className="muted" style={{ margin: 0 }}>Sign in with your username <b>{info?.username}</b> and the new password.</p>
      <button className="btn primary big" onClick={onDone}>Go to sign-in</button></div>
  );
  return (
    <form className="card login" onSubmit={save}>
      <h2>{info?.kind === 'invite' ? 'Welcome! Choose your password' : 'Choose a new password'}</h2>
      {info && <p className="muted" style={{ margin: 0 }}>Account: <b>{info.name}</b> (username <b>{info.username}</b>)</p>}
      {err && <div className="error" role="alert" style={{ marginTop: 0 }}>{err}</div>}
      {info && (<>
        <label className="field"><span>New password (6+ characters)</span><input type="password" autoComplete="new-password" minLength={6} value={pw} onChange={(e) => setPw(e.target.value)} required /></label>
        <label className="field"><span>The same password again</span><input type="password" autoComplete="new-password" minLength={6} value={pw2} onChange={(e) => setPw2(e.target.value)} required /></label>
        <button className="btn primary big" type="submit">Save password</button>
      </>)}
      {!info && !err && <p className="muted">Checking the link…</p>}
      {err && !info && <button type="button" className="btn" onClick={onDone}>Go to sign-in</button>}
    </form>
  );
}
