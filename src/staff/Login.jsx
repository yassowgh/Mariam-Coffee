import { useState } from 'react';
import { api } from '../lib/api.js';

export default function Login({ firstRun, error: initialError, onDone }) {
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
    </form>
  );
}
