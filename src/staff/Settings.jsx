import { useEffect, useState } from 'react';
import { strToU8, zipSync } from 'fflate';
import ps1 from '../../pos-uploader/MariamCoffeeUploader.ps1?raw';
import readme from '../../pos-uploader/README.txt?raw';
import vbs from '../../pos-uploader/run-hidden.vbs?raw';
import installBat from '../../pos-uploader/install.bat?raw';
import nowBat from '../../pos-uploader/upload-now.bat?raw';
import uninstallBat from '../../pos-uploader/uninstall.bat?raw';
import { api, distFmt, getLocation, toLocal } from '../lib/api.js';
import DataTable from '../components/DataTable.jsx';
import { longDate } from '../format.js';

/** "41.0082, 28.9784" or a Google Maps link -> { lat, lng } */
function parseCoords(text) {
  const s = String(text || '');
  // the place pin (!3d…!4d…) first: the "@" numbers are only where the map view is centred
  const m = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/.exec(s) || /[?&](?:q|query|ll)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/.exec(s)
    || /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(s) || /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(s);
  return m ? { lat: Number(m[1]), lng: Number(m[2]) } : null;
}

export default function Settings({ go }) {
  return (
    <div className="stack">
      <div className="card" style={{ borderColor: 'var(--accent)' }}>
        <div className="card-head">
          <div><h2>Website texts, menu and photos</h2><p>Change the texts, the menu (items, descriptions, photos) and the photos of mariamcoffeeshop.com and of the table QR page.</p></div>
          <button className="btn primary" onClick={() => go?.('website')}>Open the website editor →</button>
        </div>
      </div>
      <Site />
      <EmailSetup />
      <PosUploader />
      <Activity />
    </div>
  );
}

function Site() {
  const [site, setSite] = useState(null);
  const [f, setF] = useState({ name: 'Mariam Coffee', coords: '', radius: 100 });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('site').then(({ site }) => {
      setSite(site);
      if (site) setF({ name: site.name, coords: `${site.lat}, ${site.lng}`, radius: site.radius });
    }).catch((e) => setMsg({ ok: false, text: e.message }));
  }, []);
  async function here() {
    setBusy(true);
    setMsg(null);
    try {
      const p = await getLocation();
      setF((x) => ({ ...x, coords: `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}` }));
      setMsg({ ok: true, text: `Location found (accuracy ±${Math.round(p.accuracy)} m). Check it on the map, then save.` });
    } catch (e) { setMsg({ ok: false, text: e.message }); } finally { setBusy(false); }
  }
  async function save(e) {
    e.preventDefault();
    const c = parseCoords(f.coords);
    if (!c) { setMsg({ ok: false, text: 'Paste coordinates like “41.0082, 28.9784” or a Google Maps link with the location in it.' }); return; }
    try {
      const r = await api('site', { method: 'PUT', body: { ...c, name: f.name, radius: Number(f.radius) } });
      setSite(r.site);
      setF((x) => ({ ...x, coords: `${r.site.lat}, ${r.site.lng}` }));
      setMsg({ ok: true, text: 'Saved. Baristas can now clock in only within this distance.' });
    } catch (x) { setMsg({ ok: false, text: x.message }); }
  }
  const c = parseCoords(f.coords);
  return (
    <form className="card form-card" onSubmit={save}>
      <div className="card-head">
        <div><h2>Café location for clock-in</h2>
          <p>Baristas can clock in and out only when their phone is within the allowed distance of this point. {site?.isDefault ? <>Now using <b>Mariam Coffee Shop’s pin on Google Maps</b>. Save here to change it.</> : site ? <>Saved {longDate(site.updatedAt.slice(0, 10))}.</> : null}</p></div>
      </div>
      <p className="notice" style={{ margin: '0 0 12px' }}>To change it: stand inside the café with your phone and tap <b>Use my current location</b>. Or, in Google Maps, long-press the café, copy the numbers shown (like 41.0082, 28.9784) and paste them here.</p>
      <div className="form-grid">
        <label className="field"><span>Name</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} /></label>
        <label className="field wide"><span>Coordinates or Google Maps link</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input value={f.coords} onChange={(e) => setF({ ...f, coords: e.target.value })} placeholder="41.0082, 28.9784" style={{ flex: 1, minWidth: 200 }} />
            <button type="button" className="btn" onClick={here} disabled={busy}>{busy ? 'Finding…' : '📍 Use my current location'}</button>
          </div></label>
        <label className="field"><span>Allowed distance (metres)</span>
          <input type="number" min={20} max={2000} step={10} value={f.radius} onChange={(e) => setF({ ...f, radius: e.target.value })} /></label>
        <div className="field"><span>Check</span>
          {c ? <a className="btn" href={`https://www.google.com/maps?q=${c.lat},${c.lng}`} target="_blank" rel="noreferrer">Open in Google Maps ↗</a> : <span className="faint">–</span>}</div>
      </div>
      <p className="faint" style={{ fontSize: 12.5 }}>Phone GPS indoors is often 10–50 m off, so 100 m is a sensible start. Clock-ins with poorer accuracy than ±150 m are refused. A refused attempt is recorded in the activity log with the distance.</p>
      {msg && <div className={'banner ' + (msg.ok ? 'ok' : 'bad')} role="status"><span>{msg.text}</span></div>}
      <button className="btn primary big" type="submit">Save location</button>
    </form>
  );
}

/** The program for the POS computer: uploads the ASEAL sales tables every 30 minutes. */
function PosUploader() {
  const [st, setSt] = useState(null);
  const [msg, setMsg] = useState(null);
  const load = () => api('upload-token').then(setSt).catch((e) => setMsg({ ok: false, text: e.message }));
  useEffect(() => { load(); }, []);
  async function download() {
    if (st?.exists && !confirm('This makes a new key. A POS computer that uses the old key stops uploading until you install the new download there. Continue?')) return;
    try {
      const { token } = await api('upload-token', { method: 'POST' });
      const crlf = (t) => t.replace(/\r?\n/g, '\r\n');
      const config = JSON.stringify({ site: location.origin + import.meta.env.BASE_URL.replace(/\/$/, ''), token, everyMinutes: 30, dbFolder: '' }, null, 2);
      const zip = zipSync({ MariamCoffeeUploader: {
        'MariamCoffeeUploader.ps1': strToU8(crlf(ps1)), 'run-hidden.vbs': strToU8(crlf(vbs)), 'install.bat': strToU8(crlf(installBat)),
        'upload-now.bat': strToU8(crlf(nowBat)), 'uninstall.bat': strToU8(crlf(uninstallBat)), 'README.txt': strToU8(crlf(readme)), 'config.json': strToU8(config),
      } });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
      a.download = 'MariamCoffee-POS-uploader.zip';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      setMsg({ ok: true, text: 'Downloaded. Copy the zip to the POS computer, unzip it and double-click install.bat.' });
      load();
    } catch (e) { setMsg({ ok: false, text: e.message }); }
  }
  async function remove() {
    if (!confirm('Remove the key? The POS computer stops uploading.')) return;
    try { await api('upload-token', { method: 'DELETE' }); load(); } catch (e) { setMsg({ ok: false, text: e.message }); }
  }
  const last = st?.lastUpload;
  return (
    <div className="card">
      <div className="card-head"><div><h2>POS automatic upload</h2>
        <p>A small Windows program for the POS computer. Every 30 minutes it copies the ASEAL sales tables and uploads them here, so the reports update by themselves. It only reads the ASEAL files.</p></div></div>
      {st && (
        <p className="notice" style={{ margin: '0 0 12px' }}>
          {st.exists ? <>Upload key made {longDate(st.createdAt.slice(0, 10))}. </> : <b>No POS computer set up yet. </b>}
          {last?.uploadedAt && <>Last sales upload: <b>{longDate(toLocal(last.uploadedAt).date)} {toLocal(last.uploadedAt).time}</b>{last.auto ? ' (automatic, from the POS)' : ' (by hand)'}.</>}
        </p>
      )}
      <ol style={{ margin: '0 0 12px', paddingLeft: 20, fontSize: 13.5, display: 'grid', gap: 4 }}>
        <li>Tap <b>Download the POS program</b> (it includes this café’s upload key).</li>
        <li>Copy the zip to the POS computer (USB stick or email), unzip it, e.g. to <code>C:\MariamCoffeeUploader</code>.</li>
        <li>Double-click <b>install.bat</b>. It finds the ASEAL database, uploads once and then every 30 minutes.</li>
      </ol>
      {msg && <div className={'banner ' + (msg.ok ? 'ok' : 'bad')} role="status"><span>{msg.text}</span></div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn primary" onClick={download}>⬇ Download the POS program</button>
        {st?.exists && <button className="btn ghost" onClick={remove}>Remove the key</button>}
      </div>
    </div>
  );
}

function EmailSetup() {
  const [st, setSt] = useState(null);
  const [key, setKey] = useState('');
  const [from, setFrom] = useState('');
  const [msg, setMsg] = useState(null);
  const load = () => api('email-settings').then((r) => { setSt(r); setFrom(r.from || ''); }).catch((e) => setMsg({ ok: false, text: e.message }));
  useEffect(() => { load(); }, []);
  async function save(e) {
    e.preventDefault();
    try {
      await api('email-settings', { method: 'PUT', body: { ...(key ? { key } : {}), from } });
      setKey(''); setMsg({ ok: true, text: 'Saved.' }); load();
    } catch (x) { setMsg({ ok: false, text: x.message }); }
  }
  async function test() {
    setMsg(null);
    try { const r = await api('email-test', { method: 'POST' }); setMsg({ ok: true, text: `Test email sent to ${r.to}. Check the inbox (and spam).` }); } catch (x) { setMsg({ ok: false, text: x.message }); }
  }
  const verified = (st?.domains || []).filter((d) => d.status === 'verified');
  return (
    <form className="card form-card" onSubmit={save}>
      <div className="card-head"><div><h2>Email</h2><p>Emails to staff (schedules, sign-in details) are sent through Resend.</p></div></div>
      {st && (
        <p className="notice" style={{ margin: '0 0 12px' }}>
          {st.configured ? <>API key saved (ending …{st.keyEnd}). </> : <b>No API key yet. </b>}
          {st.domains ? (verified.length ? <>Verified domain: <b>{verified.map((d) => d.name).join(', ')}</b>. Use an address at it as “from”.</>
            : <><b>No verified domain in Resend yet</b>: Resend only delivers to your own Resend account address until you add and verify a domain (resend.com → Domains).{st.domains.length ? ` Waiting: ${st.domains.map((d) => `${d.name} (${d.status})`).join(', ')}.` : ''}</>)
            : st.domainsError ? <>Could not check domains ({st.domainsError}).</> : null}
        </p>
      )}
      <div className="form-grid">
        <label className="field"><span>{st?.configured ? 'Replace the API key' : 'Resend API key'}</span><input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="re_…" autoComplete="off" /></label>
        <label className="field"><span>From</span><input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Mariam Coffee <team@yourdomain.com>" /></label>
      </div>
      {msg && <div className={'banner ' + (msg.ok ? 'ok' : 'bad')} role="status" style={{ marginTop: 12 }}><span>{msg.text}</span></div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn primary" type="submit">Save</button>
        <button className="btn" type="button" onClick={test} disabled={!st?.configured}>Send a test email to me</button>
      </div>
    </form>
  );
}

const ACTIONS = {
  'clock.in': 'Clocked in', 'clock.out': 'Clocked out', 'clock.in.refused': 'Clock-in refused (too far)', 'clock.out.refused': 'Clock-out refused (too far)',
  'expense.create': 'Expense added', 'expense.delete': 'Expense removed', 'fixed.import': 'Fixed costs imported', 'fixed.update': 'Fixed cost changed',
  'fixed.delete': 'Fixed cost removed', 'fixed.delete-month': 'Fixed costs of a month removed', 'shift.create': 'Shifts added', 'shift.update': 'Shift changed',
  'shift.delete': 'Shift removed', 'shift.clear': 'Shifts cleared', 'attendance.create': 'Clock record added by hand', 'attendance.update': 'Clock record corrected',
  'attendance.delete': 'Clock record deleted', 'account.create': 'Account created', 'account.update': 'Account changed', 'account.password': 'Password changed',
  'account.bootstrap': 'Owner account created', 'settings.site': 'Café location changed', 'settings.email': 'Email settings changed', 'schedule.email': 'Schedules emailed', 'account.email': 'Sign-in details emailed', 'plan.parse': 'Conditions read by AI', 'expense.import': 'Records imported', 'expense.update': 'Record changed', 'expense.paid': 'Record marked paid', 'category.create': 'Expense item added', 'category.update': 'Expense item changed',
};

function Activity() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('activity').then((d) => setRows(d.activity)).catch((e) => setError(e.message)); }, []);
  const detail = (r) => {
    try {
      const d = JSON.parse(r.detail);
      if (d && typeof d === 'object') {
        if ('dist' in d) return `distance ${distFmt(d.dist)}${d.acc ? `, GPS ±${d.acc} m` : ''}`;
        return Object.entries(d).filter(([k]) => !['lat', 'lng', 'updatedAt'].includes(k)).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ');
      }
    } catch { /* plain text */ }
    return r.detail;
  };
  return (
    <div className="card">
      <div className="card-head"><div><h2>Activity log</h2><p>The last 300 changes and clock-ins, newest first.</p></div></div>
      {error && <div className="error" role="alert">{error}</div>}
      {rows == null ? <p className="muted">Loading…</p> : (
        <DataTable rows={rows.map((r) => ({ ...r, key: r.id, what: ACTIONS[r.action] || r.action, info: detail(r) }))} exportName="activity" defaultSort={{ key: 'at', dir: 'desc' }} pageSize={50}
          filters={{ search: 'what' }}
          columns={[
            { key: 'at', label: 'When', render: (r) => `${longDate(toLocal(r.at).date)} ${toLocal(r.at).time}`, csv: (r) => r.at },
            { key: 'user_name', label: 'Who', fmt: (v) => v || '–' },
            { key: 'what', label: 'What', cls: (r) => (/refused/.test(r.action) ? 'down' : '') },
            { key: 'info', label: 'Details', render: (r) => <span className="wrap-cell">{r.info}</span> },
          ]} />
      )}
    </div>
  );
}
