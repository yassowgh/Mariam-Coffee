import { useEffect, useState } from 'react';
import App from './App.jsx';
import Header from './components/Header.jsx';
import { api, hasRole, ROLE_LABELS } from './lib/api.js';
import { applyLang, chosenHere, getLang, setLangSaver } from './lib/i18n.js';
import Login, { SetPassword } from './staff/Login.jsx';
import Accounting from './staff/Accounting.jsx';
import Finance from './staff/Finance.jsx';
import Salaries from './staff/Salaries.jsx';
import Schedule from './staff/Schedule.jsx';
import Clock from './staff/Clock.jsx';
import Attendance from './staff/Attendance.jsx';
import Team from './staff/Team.jsx';
import Settings from './staff/Settings.jsx';
import Account from './staff/Account.jsx';

// [key, label, roles allowed (owner always)]
const AREAS = [
  ['reports', 'Sales reports', ['accountant']],
  ['clock', 'Clock in / out', ['barista']],
  ['accounting', 'Accounting', ['accountant']],
  ['finance', 'Finance', ['accountant']],
  ['schedule', 'Schedule', ['manager']],
  ['attendance', 'Timesheets', ['manager']],
  ['team', 'Team', ['manager', 'accountant']],
  ['salaries', 'Salaries', ['manager', 'accountant']],
  ['settings', 'Settings', []],
];
// owner: everything; accountant: sales, accounting, salaries; manager: schedule, timesheets, team, salaries; barista: clock
// a manager who is not an accountant sees hours, not salaries
const allowed = (user) => AREAS.filter(([, , roles]) => hasRole(user, ...roles))
  .map(([k, label, roles]) => [k, k === 'salaries' && !hasRole(user, 'accountant') ? 'Monthly hours' : label, roles]);

/** Signs people in and shows only the parts of the site their role allows. */
export default function Root() {
  const [state, setState] = useState({ status: 'checking' });
  // link from an invitation or password email: /staff?set=TOKEN or ?reset=TOKEN
  const [linkToken, setLinkToken] = useState(() => { const q = new URLSearchParams(location.search); return q.get('set') || q.get('reset'); });
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
    // the language saved on the account wins; the switch saves new choices to the account
    const save = (lang) => api('me/lang', { method: 'POST', body: { lang } }).catch(() => {});
    if (chosenHere()) { if (getLang() !== user.lang) save(getLang()); } // chosen on this device: keep it, remember it on the account
    else if (user.lang && user.lang !== getLang()) applyLang(user.lang, false);
    setLangSaver(save);
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
    setLangSaver(null);
    setState({ status: 'login' });
    setShowAccount(false);
  }

  if (state.status === 'offline') return <App />;
  if (state.status === 'checking') {
    return (<><Header title="Mariam Coffee" subtitle=" " /><main><div className="card progress-card"><p className="muted" style={{ margin: 0 }}>Loading…</p></div></main></>);
  }
  // /staff = the staff link: straight to sign-in, never the sales
  const staffLink = location.pathname.replace(/\/+$/, '') === import.meta.env.BASE_URL + 'staff';
  if (linkToken) {
    return (<><Header title="Mariam Coffee" subtitle="Staff" /><main><SetPassword token={linkToken} onDone={() => {
      setLinkToken(null);
      try { history.replaceState(null, '', import.meta.env.BASE_URL + 'staff'); } catch { /* ignore */ }
      setState({ status: 'login' });
    }} /></main></>);
  }
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
  const View = { clock: Clock, accounting: Accounting, finance: Finance, salaries: Salaries, schedule: Schedule, attendance: Attendance, team: Team, settings: Settings }[area];
  return (
    <>
      <Header title={`Mariam Coffee · ${title}`} subtitle={`Signed in as ${user.name}`} areas={areas} account={account} />
      <main>{View ? <View user={user} go={go} /> : null}</main>
    </>
  );
}
