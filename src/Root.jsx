import { useEffect, useState } from 'react';
import App from './App.jsx';
import Header from './components/Header.jsx';
import { api, hasRole, ROLE_LABELS } from './lib/api.js';
import Login from './staff/Login.jsx';
import Expenses from './staff/Expenses.jsx';
import FixedCosts from './staff/FixedCosts.jsx';
import Schedule from './staff/Schedule.jsx';
import Clock from './staff/Clock.jsx';
import Attendance from './staff/Attendance.jsx';
import Team from './staff/Team.jsx';
import Settings from './staff/Settings.jsx';
import Account from './staff/Account.jsx';

// [key, label, roles allowed (owner always)]
const AREAS = [
  ['reports', 'Sales reports', []],
  ['clock', 'Clock in / out', ['barista']],
  ['expenses', 'Expenses', ['expenses']],
  ['fixed', 'Fixed costs', []],
  ['schedule', 'Schedule', ['scheduler']],
  ['attendance', 'Attendance', ['scheduler']],
  ['team', 'Team', ['scheduler']],
  ['settings', 'Settings', []],
];
// only the owner sees the sales (and net profit) inside the staff menu
const allowed = (user) => AREAS.filter(([, , roles]) => hasRole(user, ...roles));

/** Signs people in and shows only the parts of the site their role allows. */
export default function Root() {
  const [state, setState] = useState({ status: 'checking' });
  const [area, setArea] = useState(null);
  const [showAccount, setShowAccount] = useState(false);
  const [wantLogin, setWantLogin] = useState(false);

  async function check() {
    try {
      const me = await api('me');
      if (me.user) signedIn(me.user);
      else setState({ status: 'login', firstRun: me.firstRun });
    } catch (e) {
      // no server (local preview): show the reports on their own, as before
      setState(e.status === 0 || e.status === 404 || e.status === 503 || /published website/.test(e.message) ? { status: 'offline' } : { status: 'login', error: e.message });
    }
  }
  function signedIn(user) {
    setState({ status: 'ready', user });
    setWantLogin(false);
    const list = allowed(user).map(([k]) => k);
    let saved = null;
    try { saved = localStorage.getItem('mc-area'); } catch { /* storage unavailable */ }
    // owner starts on the reports; staff start on their own page
    setArea(list.includes(saved) ? saved : list.find((k) => k !== 'reports' || user.roles.includes('owner')) || list[0]);
  }
  useEffect(() => {
    check();
    const out = () => setState((s) => (s.status === 'ready' ? { status: 'login', error: 'You were signed out. Please sign in again.' } : s));
    window.addEventListener('mc-signed-out', out);
    return () => window.removeEventListener('mc-signed-out', out);
  }, []);

  function go(k) {
    setArea(k);
    window.scrollTo(0, 0);
    try { localStorage.setItem('mc-area', k); } catch { /* storage unavailable */ }
  }
  async function logout() {
    try { await api('logout', { method: 'POST' }); } catch { /* ignore */ }
    setState({ status: 'login' });
    setShowAccount(false);
  }

  if (state.status === 'offline') return <App />;
  if (state.status === 'checking') {
    return (<><Header title="Mariam Coffee" subtitle=" " /><main><div className="card progress-card"><p className="muted" style={{ margin: 0 }}>Loading…</p></div></main></>);
  }
  // /staff = the staff link: straight to sign-in, never the sales
  const staffLink = /^\/staff\/?$/.test(location.pathname);
  if (state.status === 'login') {
    if (staffLink) {
      return (<><Header title="Mariam Coffee" subtitle="Staff sign-in" /><main><Login firstRun={state.firstRun} error={state.error} onDone={signedIn} /></main></>);
    }
    // the sales reports are open to everyone with the main link; staff sign in for their own pages
    if (!wantLogin && !state.error) {
      const signInBtn = <button className="btn small" onClick={() => setWantLogin(true)} title="Staff and owner sign-in">👤 Staff sign-in</button>;
      return <App shell={{ user: null, areas: null, account: signInBtn }} />;
    }
    return (<><Header title="Mariam Coffee" subtitle="Staff and owner sign-in"
      account={<button className="btn small" onClick={() => { setWantLogin(false); setState({ status: 'login', firstRun: state.firstRun }); }}>← Sales reports</button>} />
      <main><Login firstRun={state.firstRun} error={state.error} onDone={signedIn} /></main></>);
  }

  const { user } = state;
  if (user.mustChange) {
    return (
      <>
        <Header title="Mariam Coffee" subtitle={`Signed in as ${user.name}`} account={<button className="btn small" onClick={logout}>Sign out</button>} />
        <main>
          <div className="card login">
            <h2>Welcome, {user.name.split(' ')[0]}</h2>
            <p className="muted" style={{ margin: 0 }}>Before you start, please choose your own password. Only you will know it.</p>
            <Account forced onDone={() => signedIn({ ...user, mustChange: false })} />
          </div>
        </main>
      </>
    );
  }
  const list = allowed(user);
  const areas = list.length > 1 ? (
    <nav className="areas" aria-label="Sections">
      {list.map(([k, label]) => (
        <button key={k} className="area" aria-current={area === k ? 'page' : undefined} onClick={() => go(k)}>{label}</button>
      ))}
    </nav>
  ) : null;
  const account = (
    <div className="account">
      <button className="btn small" onClick={() => setShowAccount((v) => !v)} aria-expanded={showAccount} title="Your account">
        <span aria-hidden="true">👤</span><span className="account-name">{user.name}</span>
      </button>
      {showAccount && (
        <div className="account-menu" role="dialog" aria-label="Your account">
          <b>{user.name}</b>
          <span className="faint" style={{ fontSize: 12.5 }}>@{user.username} · {user.roles.map((r) => ROLE_LABELS[r]).join(', ')}</span>
          <Account onClose={() => setShowAccount(false)} />
          <button className="btn" onClick={logout}>Sign out</button>
        </div>
      )}
    </div>
  );
  const shell = { user, areas, account };
  const title = list.find(([k]) => k === area)?.[1] || 'Mariam Coffee';
  if (area === 'reports') return <App shell={shell} />;
  const View = { clock: Clock, expenses: Expenses, fixed: FixedCosts, schedule: Schedule, attendance: Attendance, team: Team, settings: Settings }[area];
  return (
    <>
      <Header title={`Mariam Coffee · ${title}`} subtitle={`Signed in as ${user.name}`} areas={areas} account={account} />
      <main>{View ? <View user={user} go={go} /> : null}</main>
    </>
  );
}
