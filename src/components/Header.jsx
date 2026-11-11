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
        {onReset && <button className="btn small" onClick={onReset} title="Upload new database files">⤒ Update data</button>}
        {account}
      </div>
      {areas}
      {tabs}
    </header>
  );
}
