import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { collectTables } from './lib/archive.js';
import { buildModel } from './lib/model.js';
import { checkPassword, loadCosts, loadSaved, saveCosts, saveRemote } from './lib/remote.js';
import { applyCosts, makeCostConfig, parseCostWorkbook, withDefaults } from './lib/costs.js';
import costSheet from './data/costSheet.json';
import { addDays, daysBetween, filterInvoices, mainDiscountKinds, promoTest } from './lib/aggregate.js';
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
import Profit from './views/Profit.jsx';

const TABS = [
  ['dashboard', 'Dashboard'],
  ['monthly', 'Sales per month'],
  ['daily', 'Sales per day'],
  ['hourly', 'Sales per hour'],
  ['products', 'Products'],
  ['orders', 'Orders'],
  ['profit', 'Profit & costs'],
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

  const [saved, setSaved] = useState(null); // metadata of the dataset stored on the server
  const [notice, setNotice] = useState(null); // { kind: 'ok' | 'bad' | 'info', text }
  const [serverOk, setServerOk] = useState(false); // the site has server storage
  const [costCfg, setCostCfg] = useState(null); // product cost settings (see lib/costs.js)
  const [costVersion, setCostVersion] = useState(0);

  function updateCosts(cfg) {
    setCostCfg(cfg);
    try { localStorage.setItem('mc-costs', JSON.stringify(cfg)); } catch { /* storage unavailable */ }
  }

  // Put unit costs on every sold line whenever the data or the cost settings change.
  useEffect(() => {
    if (!model) return;
    if (costCfg) {
      model.costInfo = { ...applyCosts(model.baseSets, costCfg), cfg: costCfg };
      model.hasCosts = true;
    } else {
      model.hasCosts = false;
      model.costInfo = null;
    }
    model.clearViews();
    setCostVersion((v) => v + 1);
  }, [model, costCfg]);

  // On first open: load the dataset saved on the server, if there is one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStage('loading');
      setProgress({ msg: 'Looking for saved data…', frac: 0 });
      const [got, costs] = await Promise.all([
        loadSaved((msg, frac) => !cancelled && setProgress({ msg, frac: frac * 0.1 })),
        loadCosts(),
      ]);
      if (cancelled) return;
      let localCosts = null;
      try { localCosts = JSON.parse(localStorage.getItem('mc-costs') || 'null'); } catch { /* ignore */ }
      // saved settings first, then this browser's copy, then the cost sheet bundled with the app
      setCostCfg(withDefaults(costs || localCosts) || makeCostConfig(costSheet));
      setServerOk(got.available);
      if (!got.file) { setStage('upload'); return; }
      setSaved(got.meta);
      await load([got.file], { fromServer: got.meta });
    })();
    return () => { cancelled = true; };
  }, []);

  /**
   * opts.save + opts.password: replace the saved dataset after a successful load.
   * opts.fromServer: metadata when the files came from the server.
   */
  async function load(files, opts = {}) {
    setError('');
    setNotice(null);
    setStage('loading');
    setProgress({ msg: 'Reading files…', frac: 0.1 });
    const t0 = performance.now();
    try {
      if (opts.save) {
        setProgress({ msg: 'Checking password…', frac: 0.1 });
        await checkPassword(opts.password);
      }
      // a cost sheet (.xlsx) can be dropped together with the database files, or on its own
      const sheets = files.filter((f) => /\.xlsx$/i.test(f.name));
      files = files.filter((f) => !/\.xlsx$/i.test(f.name));
      let costMsg = '';
      if (sheets.length) {
        setProgress({ msg: 'Reading cost sheet…', frac: 0.1 });
        const cfg = makeCostConfig(parseCostWorkbook(new Uint8Array(await sheets[0].arrayBuffer()), sheets[0].name), costCfg);
        updateCosts(cfg);
        costMsg = `Costs loaded from ${sheets[0].name} (${cfg.recipes.length} recipes).`;
        if (opts.save) {
          try { await saveCosts(cfg, opts.password); costMsg += ' Saved for everyone.'; } catch (e) { costMsg += ` NOT saved: ${e.message}`; }
        }
        if (!files.length && model) {
          setNotice({ kind: 'ok', text: costMsg + ' Open “Profit & costs” to review which products are linked.' });
          setStage('ready');
          return;
        }
      }
      const entries = await collectTables(files, (msg, frac) => setProgress({ msg, frac: 0.1 + frac * 0.1 }));
      if (!entries.length) {
        throw new Error('None of the expected tables (Invoices.DB, StockTransDetails.DB, CROldInvoices.DB, CROldDetails.DB) were found in what you uploaded.');
      }
      const m = await buildModel(entries, (msg, frac) => setProgress({ msg, frac: 0.2 + frac * (opts.save ? 0.7 : 0.8) }));
      if (!m.view().invoices.length) throw new Error('The tables were read but contain no sales invoices.');
      const label = opts.fromServer?.name || (files.length === 1 ? files[0].name : `${files.length} files`);
      if (opts.save) {
        setProgress({ msg: 'Saving for everyone…', frac: 0.92 });
        try {
          const meta = await saveRemote(entries, { name: label, from: m.minDate, to: m.maxDate }, opts.password);
          setSaved(meta);
          setNotice({ kind: 'ok', text: `Saved. Everyone opening this site now sees this data (${longDate(m.minDate)} – ${longDate(m.maxDate)}).` });
        } catch (e) {
          setNotice({ kind: 'bad', text: `Shown here but NOT saved: ${e.message}` });
        }
      } else if (!opts.fromServer) {
        setNotice({ kind: 'info', text: 'Viewing these files only in this browser. They were not saved.' });
      }
      if (costMsg) setNotice((n) => ({ kind: n?.kind || 'ok', text: [n?.text, costMsg].filter(Boolean).join(' ') }));
      m.loadMs = Math.round(performance.now() - t0);
      setModel(m);
      setFilters({ from: addDays(m.maxDate, -29), to: m.maxDate, channel: 'all', basis: 'net', preset: '30', source: m.hasAcc ? 'acc' : 'pos', day: 'business', promo: 'all' });
      setFileLabel(label);
      setTab('dashboard');
      setStage('ready');
    } catch (e) {
      console.error(e);
      setError(e.message || String(e));
      setStage('upload');
    }
  }

  const deferred = useDeferredValue(filters);

  // the model as seen through the chosen source / day boundary
  const vm = useMemo(() => {
    if (!model || !filters) return null;
    const v = model.view(filters.source, filters.day);
    const mainKinds = mainDiscountKinds(v.invoices);
    const invoices = v.invoices.filter(promoTest(filters.promo, mainKinds));
    return { ...model, invoices, allInvoices: v.invoices, mainKinds, minDate: v.minDate, maxDate: v.maxDate, source: v.source, day: v.day };
  }, [model, filters?.source, filters?.day, filters?.promo, costVersion]);
  const deferredVm = useDeferredValue(vm);
  const busy = deferred !== filters || deferredVm !== vm;

  const ctx = useMemo(() => {
    if (!deferredVm || !deferred) return null;
    const model = deferredVm;
    const invs = filterInvoices(model, deferred);
    const len = daysBetween(deferred.from, deferred.to) + 1;
    const prevTo = addDays(deferred.from, -1);
    const prevFrom = addDays(prevTo, -(len - 1));
    const prevInvs = filterInvoices(model, { ...deferred, from: prevFrom, to: prevTo });
    // "Gross profit" needs costs; fall back to sales after discount without them
    const basis = deferred.basis === 'profit' && !model.hasCosts ? 'net' : deferred.basis;
    const f = basis === deferred.basis ? deferred : { ...deferred, basis };
    return {
      model, filters: f, basis, invs, prevInvs, prevFrom, prevTo, len, openProduct: setProduct,
      costs: { cfg: costCfg, update: updateCosts, save: (pw) => saveCosts(costCfg, pw), canSave: serverOk, info: model.costInfo },
    };
  }, [deferredVm, deferred, costCfg, serverOk]);

  if (stage !== 'ready') {
    return (
      <>
        <Header />
        <main>
          {stage === 'loading'
            ? <LoadingCard progress={progress} />
            : <Upload onFiles={load} error={error} saved={saved} canSave={serverOk} onCancel={model ? () => setStage('ready') : null} />}
        </main>
      </>
    );
  }

  const View = { dashboard: Dashboard, monthly: Monthly, daily: Daily, hourly: Hourly, products: Products, orders: Orders, profit: Profit, recon: Reconciliation }[tab];
  return (
    <>
      <Header
        subtitle={`${fileLabel} · ${longDate(model.minDate)} – ${longDate(model.maxDate)}${saved ? ` · saved ${new Date(saved.uploadedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}`}
        onReset={() => { setError(''); setStage('upload'); }}
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
        {notice && (
          <div className={'banner ' + notice.kind} role="status">
            <span>{notice.text}</span>
            <button className="btn small ghost" onClick={() => setNotice(null)} aria-label="Dismiss">✕</button>
          </div>
        )}
        <FilterBar model={vm} filters={filters} onChange={setFilters} />
        {filters.promo && filters.promo !== 'all' && (
          <div className="banner info" role="status">
            <span>
              Showing <b>{filters.promo === 'disc' ? 'discounted orders only' : filters.promo === 'full' ? 'full-price orders only' : filters.promo === 'fixed' ? 'orders with a fixed-amount discount only' : filters.promo === 'other' ? 'orders with other (rarely used) discount rates only' : filters.promo === 'p100' ? 'free (100% discount) orders only' : `orders with a ${filters.promo.slice(1)}% discount only`}</b>
              {' '}({vm.invoices.length.toLocaleString()} of {vm.allInvoices.length.toLocaleString()} orders in all loaded data). All reports follow this filter.
            </span>
            <button className="btn small" onClick={() => setFilters({ ...filters, promo: 'all' })}>Show all orders</button>
          </div>
        )}
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
        {onReset && <button className="btn small" onClick={onReset} title="Upload new database files">⤒ Update data</button>}
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
