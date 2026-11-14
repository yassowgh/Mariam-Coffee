import { useEffect, useState } from 'react';
import { chooseLang, getLang } from '../lib/i18n.js';
import { DEFAULT_TZ, deviceTz, getTz, setTz, tzOffsetLabel } from '../lib/api.js';

/** English / العربية switch (shown on every page). */
function LangSwitch() {
  const [lang, setLang] = useState(getLang());
  useEffect(() => { const f = () => setLang(getLang()); window.addEventListener('mc-lang', f); return () => window.removeEventListener('mc-lang', f); }, []);
  return (
    <div className="seg lang-switch" role="group" aria-label="Language" data-no-i18n>
      <button aria-pressed={lang === 'en'} onClick={() => chooseLang('en')}>EN</button>
      <button aria-pressed={lang === 'ar'} onClick={() => chooseLang('ar')} lang="ar">عربي</button>
    </div>
  );
}

const ZONES = [
  [DEFAULT_TZ, 'Türkiye (Istanbul)'], ['Europe/London', 'London'], ['Europe/Berlin', 'Berlin / Paris'], ['Africa/Cairo', 'Cairo'],
  ['Asia/Amman', 'Amman'], ['Asia/Riyadh', 'Riyadh'], ['Asia/Dubai', 'Dubai'], ['America/New_York', 'New York'],
];
/** Time zone of the times shown (Türkiye unless this person picks another one on this device). */
function TzSwitch() {
  const tz = getTz();
  const dev = deviceTz();
  const list = [...ZONES];
  if (dev && !list.some(([z]) => z === dev)) list.push([dev, `This device (${dev.split('/').pop().replace(/_/g, ' ')})`]);
  if (!list.some(([z]) => z === tz)) list.push([tz, tz]);
  const off = tz !== DEFAULT_TZ;
  return (
    <label className={'tz-switch' + (off ? ' tz-off' : '')} title="Time zone of the times shown">
      <span aria-hidden="true">🕒</span>
      <span className="sr-only">Time zone</span>
      <select value={tz} onChange={(e) => { setTz(e.target.value); window.location.reload(); }} data-no-i18n>
        {list.map(([z, label]) => <option key={z} value={z}>{label} · {tzOffsetLabel(z)}</option>)}
      </select>
    </label>
  );
}

/** Top bar: brand, optional actions, the signed-in person, the area switcher and the report tabs. */
export default function Header({ title = 'Mariam Coffee · Sales', subtitle, onReset, tabs, areas, account }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 32 32"><path d="M6 11h16v7a7 7 0 0 1-7 7h-2a7 7 0 0 1-7-7z" fill="currentColor" /><path d="M22 13h2.5a3.5 3.5 0 0 1 0 7H22" stroke="currentColor" strokeWidth="2.4" fill="none" /></svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <h1>{title}</h1>
            <small>{subtitle || 'Sales analytics from your ASEAL database'}</small>
          </div>
        </div>
        <span className="spacer" />
        <LangSwitch />
        {areas && <TzSwitch />}
        {onReset && <button className="btn small" onClick={onReset} title="Upload new database files">⤒ Update data</button>}
        {account}
      </div>
      {areas}
      {tabs}
    </header>
  );
}
