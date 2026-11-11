import { useState } from 'react';
import { api } from '../lib/api.js';

/** Change your own password (inside the account menu). */
export default function Account() {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState(null);
  if (!open) return <button className="btn" onClick={() => setOpen(true)}>Change my password</button>;
  async function save(e) {
    e.preventDefault();
    try {
      await api('me/password', { method: 'POST', body: { current: cur, next } });
      setMsg({ ok: true, text: 'Password changed.' });
      setCur(''); setNext('');
    } catch (err) { setMsg({ ok: false, text: err.message }); }
  }
  return (
    <form onSubmit={save} className="stack" style={{ gap: 8 }}>
      <label className="field"><span>Current password</span><input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required /></label>
      <label className="field"><span>New password (6+ characters)</span><input type="password" autoComplete="new-password" minLength={6} value={next} onChange={(e) => setNext(e.target.value)} required /></label>
      {msg && <span style={{ color: msg.ok ? 'var(--good-text)' : 'var(--bad-text)', fontSize: 13 }}>{msg.text}</span>}
      <button className="btn primary" type="submit">Save new password</button>
    </form>
  );
}
