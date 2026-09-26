import { useDeferredValue, useMemo, useState } from 'react';
import { collectTables } from './lib/archive.js';
import { buildModel } from './lib/model.js';
import { addDays, daysBetween, filterInvoices } from './lib/aggregate.js';
import { longDate } from './format.js';
import Upload from './components/Upload.jsx';
import FilterBar from './components/FilterBar.jsx';
import ProductDrawer from './components/ProductDrawer.jsx';
import Dashboard from './views/Dashboard.jsx';
import Monthly from './views/Monthly.jsx';
import Daily from './views/Daily.jsx';
import Hourly from './views/Hourly.jsx';
import Products from './views/Products.jsx';
import Orders from './views/Orders.jsx';
import Reconciliation from './views/Reconciliation.jsx';

const TABS = [
  ['dashboard', 'Dashboard'],
  ['monthly', 'Sales per month'],
  ['daily', 'Sales per day'],
  ['hourly', 'Sales per hour'],
  ['products', 'Products'],
  ['orders', 'Orders'],
  ['recon', 'Reconciliation'],
];

export default function App() {
  const [stage, setStage] = useState('upload');
  const [progress, setProgress] = useState({ msg: '', frac: 0 });
  const [error, setError] = useState('');
  const [model, setModel] = useState(null);
  const [fileLabel, setFileLabel] = useState('');
  const [tab, setTab] = useState('dashboard');
  const [filters, setFilters] = useState(null);
  const [product, setProduct] = useState(null);

  async function load(files) {
    setError('');
    setStage('loading');
    setProgress({ msg: 'Reading files…', frac: 0 });
    const t0 = performance.now();
    try {
      const entries = await collectTables(files, (msg, frac) => setProgress({ msg, frac: frac * 0.15 }));
      if (!entries.length) {
        throw new Error('None of the expected tables (Invoices.DB, StockTransDetails.DB, CROldInvoices.DB, CROldDetails.DB) were found in what you uploaded.');
      }
      const m = await buildModel(entries, (msg, frac) => setProgress({ msg, frac: 0.15 + frac * 0.85 }));
      if (!m.invoices.length) throw new Error('The tables were read but contain no sales invoices.');
      m.loadMs = Math.round(performance.now() - t0);
      setModel(m);
      setFilters({ from: addDays(m.maxDate, -29), to: m.maxDate, channel: 'all', basis: 'net', preset: '30' });
      setFileLabel(files.length === 1 ? files[0].name : `${files.length} files`);
      setTab('dashboard');
      setStage('ready');
    } catch (e) {
      console.error(e);
      setError(e.message || String(e));
      setStage('upload');
    }
  }

  const deferred = useDeferredValue(filters);
  const busy = deferred !== filters;

  const ctx = useMemo(() => {
    if (!model || !deferred) return null;
    const invs = filterInvoices(model, deferred);
    const len = daysBetween(deferred.from, deferred.to) + 1;
    const prevTo = addDays(deferred.from, -1);
    const prevFrom = addDays(prevTo, -(len - 1));
    const prevInvs = filterInvoices(model, { ...deferred, from: prevFrom, to: prevTo });
    return { model, filters: deferred, basis: deferred.basis, invs, prevInvs, prevFrom, prevTo, len, openProduct: setProduct };
  }, [model, deferred]);

  if (stage !== 'ready') {
    return (
      <>
        <Header />
        <main>
          {stage === 'loading'
            ? <LoadingCard progress={progress} />
            : <Upload onFiles={load} error={error} />}
        </main>
      </>
    );
  }

  const View = { dashboard: Dashboard, monthly: Monthly, daily: Daily, hourly: Hourly, products: Products, orders: Orders, recon: Reconciliation }[tab];
  return (
    <>
      <Header
        subtitle={`${fileLabel} · ${longDate(model.minDate)} – ${longDate(model.maxDate)}`}
        onReset={() => { setModel(null); setStage('upload'); }}
        tabs={
          <nav className="tabs" role="tablist" aria-label="Reports">
            {TABS.map(([k, label]) => (
              <button key={k} role="tab" className="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
                {label}
                {k === 'recon' && <ReconBadge model={model} />}
              </button>
            ))}
          </nav>
        }
      />
      <main>
        <FilterBar model={model} filters={filters} onChange={setFilters} />
        {ctx && <View ctx={ctx} />}
      </main>
      {product != null && ctx && <ProductDrawer ctx={ctx} id={product} onClose={() => setProduct(null)} />}
      {busy && (
        <div className="busy" role="status" aria-live="polite">
          Recalculating reports…
          <div className="progress"><div /></div>
        </div>
      )}
    </>
  );
}

function ReconBadge({ model }) {
  const ok = model.recon.dailyCheck.failed === 0;
  return <span className={'pill ' + (ok ? 'ok' : 'bad')} style={{ marginLeft: 6 }}>{ok ? '✓' : '!'}</span>;
}

function Header({ subtitle, onReset, tabs }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 32 32"><path d="M6 11h16v7a7 7 0 0 1-7 7h-2a7 7 0 0 1-7-7z" fill="currentColor" /><path d="M22 13h2.5a3.5 3.5 0 0 1 0 7H22" stroke="currentColor" strokeWidth="2.4" fill="none" /></svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <h1>Mariam Coffee · Sales</h1>
            <small>{subtitle || 'Sales analytics from your ASEAL database'}</small>
          </div>
        </div>
        <span className="spacer" />
        {onReset && <button className="btn small" onClick={onReset} title="Load other files">↺ New files</button>}
      </div>
      {tabs}
    </header>
  );
}

function LoadingCard({ progress }) {
  const pctv = Math.round(progress.frac * 100);
  return (
    <div className="card progress-card" role="status" aria-live="polite">
      <h2 style={{ fontSize: 17 }}>Processing your data…</h2>
      <p className="muted" style={{ margin: '6px 0 0' }}>Everything runs in your browser. Nothing is uploaded or stored.</p>
      <div className="progress" role="progressbar" aria-valuenow={pctv} aria-valuemin={0} aria-valuemax={100}>
        <div style={{ width: pctv + '%' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
        <span className="muted">{progress.msg}</span>
        <span className="num">{pctv}%</span>
      </div>
    </div>
  );
}
