import { useEffect, useMemo, useState } from 'react';
import { daysBetween, monthDays, monthlyRows } from '../lib/aggregate.js';
import { api } from '../lib/api.js';
import DataTable from '../components/DataTable.jsx';
import { BarLineChart } from '../components/charts.jsx';
import { int, longDate, money, monthLabel, pct } from '../format.js';
import { marginFmt } from './common.jsx';

/**
 * Net profit = sales − cost of goods − expenses (rent, salaries, bills… from Accounting).
 * Expenses count on their expense date, paid or not; loan repayments are not costs.
 */
export default function NetProfit({ ctx }) {
  const { invs, filters, model } = ctx;
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState(model.hasCosts ? 'recipe' : 'cash');
  const [estimate, setEstimate] = useState(false);

  useEffect(() => {
    let off = false;
    api('cost-summary').then((d) => !off && setData(d)).catch((e) => !off && setError(e.message));
    return () => { off = true; };
  }, []);

  const result = useMemo(() => {
    if (!data) return null;
    const sales = new Map(monthlyRows(invs, 'net').map((r) => [r.key, r]));
    const months = [];
    for (let m = filters.from.slice(0, 7); m <= filters.to.slice(0, 7);) {
      months.push(m);
      const [y, mo] = m.split('-').map(Number);
      m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
    }
    const expCats = new Map();
    const rows = months.map((m) => {
      const first = m + '-01', last = `${m}-${String(monthDays(m)).padStart(2, '0')}`;
      const a = filters.from > first ? filters.from : first, b = filters.to < last ? filters.to : last;
      const days = daysBetween(a, b) + 1;
      const share = days / monthDays(m);
      const s = sales.get(m);
      const fixed = 0;
      let other = 0, stock = 0;
      for (const e of data.expenses) if (e.date >= a && e.date <= b) {
        if (e.stock) stock += e.amount; else other += e.amount;
        const c = expCats.get(e.category) || { name: e.category, stock: !!e.stock, amount: 0, n: 0, open: 0 };
        c.amount += e.amount; c.n += e.n; c.open += e.open || 0;
        expCats.set(e.category, c);
      }
      const net = s?.net || 0;
      const margin = s?.costedNet ? s.profit / s.costedNet : null;
      const gp = (s?.profit || 0) + (estimate && margin != null ? (net - (s?.costedNet || 0)) * margin : 0);
      const cogs = net - gp;
      const netProfit = mode === 'recipe' ? gp - fixed - other : net - stock - other - fixed;
      const overhead = mode === 'recipe' ? fixed + other : fixed + other;
      const gmRate = mode === 'recipe' ? (net ? gp / net : null) : (net ? (net - stock) / net : null);
      return {
        key: m, label: monthLabel(m), partial: share < 1, days, share, net, cogs, gp, coverage: s?.coverage ?? 0,
        fixed, other, stock, netProfit, netMargin: net ? netProfit / net : null,
        breakEven: gmRate && gmRate > 0 ? overhead / gmRate / days : null, orders: s?.orders || 0,
      };
    });
    const sum = (k) => rows.reduce((t, r) => t + r[k], 0);
    const tot = { net: sum('net'), gp: sum('gp'), cogs: sum('cogs'), fixed: sum('fixed'), other: sum('other'), stock: sum('stock'), netProfit: sum('netProfit'), days: sum('days') };
    const costed = invs.reduce((t, i) => t + (i.costedNet || 0), 0);
    tot.coverage = tot.net ? costed / tot.net : 0;
    const gmRate = mode === 'recipe' ? (tot.net ? tot.gp / tot.net : 0) : (tot.net ? (tot.net - tot.stock) / tot.net : 0);
    tot.breakEven = gmRate > 0 ? (tot.fixed + tot.other) / gmRate / tot.days : null;
    return {
      rows, tot, hasExpenses: data.expenses.length > 0,
      expCats: [...expCats.values()].map((c) => ({ ...c, key: c.name })),
    };
  }, [data, invs, filters.from, filters.to, mode, estimate]);

  if (error) return <div className="card"><div className="error" role="alert">{error}</div></div>;
  if (!result) return <div className="card"><p className="muted">Loading expenses…</p></div>;
  const { rows, tot } = result;
  const recipe = mode === 'recipe';

  const columns = [
    { key: 'key', label: 'Month', render: (r) => <>{r.label}{r.partial && <span className="pill warn" style={{ marginLeft: 6 }} title={`${r.days} of ${monthDays(r.key)} days selected`}>{r.days} days</span>}</>, csv: (r) => r.key },
    { key: 'net', label: 'Sales (after discount)', align: 'r', fmt: money, total: 'sum', csv: (r) => r.net.toFixed(2) },
    ...(recipe ? [
      { key: 'cogs', label: 'Cost of goods', align: 'r', fmt: money, total: 'sum', csv: (r) => r.cogs.toFixed(2) },
      { key: 'gp', label: 'Gross profit', align: 'r', fmt: money, total: 'sum', csv: (r) => r.gp.toFixed(2) },
    ] : [
      { key: 'stock', label: 'Stock purchases', align: 'r', fmt: money, total: 'sum', csv: (r) => r.stock.toFixed(2) },
    ]),
    { key: 'other', label: recipe ? 'Expenses (not stock)' : 'Other expenses', align: 'r', fmt: money, total: 'sum', csv: (r) => r.other.toFixed(2) },
    { key: 'netProfit', label: 'Net profit', align: 'r', fmt: money, total: 'sum', cls: (r) => (r.netProfit < 0 ? 'down' : ''), csv: (r) => r.netProfit.toFixed(2) },
    { key: 'netMargin', label: 'Net margin', align: 'r', fmt: marginFmt, csv: (r) => (r.netMargin == null ? '' : (r.netMargin * 100).toFixed(2)) },
    { key: 'breakEven', label: 'Break-even sales / day', align: 'r', fmt: (v) => (v == null ? '–' : money(v)), title: 'Daily sales needed to cover the expenses at this month’s margin', csv: (r) => (r.breakEven == null ? '' : r.breakEven.toFixed(2)) },
  ];

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Net profit</h2>
            <p>{longDate(filters.from)} – {longDate(filters.to)} · after discounts. Rent, salaries, bills and every other cost come from <b>Accounting</b> (menu at the top).</p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="seg" role="group" aria-label="How to count the cost of goods">
              <button aria-pressed={recipe} disabled={!model.hasCosts} onClick={() => setMode('recipe')} title="Cost of goods from the recipe cost sheet; ingredient purchases in Expenses are not counted again">Recipe costs</button>
              <button aria-pressed={!recipe} onClick={() => setMode('cash')} title="Everything actually spent, as entered in Expenses, instead of recipe costs">Money spent</button>
            </div>
            {recipe && tot.coverage < 0.995 && (
              <label className="check-inline" title="Items without a cost in the cost sheet are counted at the average margin">
                <input type="checkbox" checked={estimate} onChange={(e) => setEstimate(e.target.checked)} />Estimate items without a cost
              </label>
            )}
          </div>
        </div>
        <p className="notice" style={{ margin: '0 0 12px' }}>
          {recipe
            ? <>Sales − cost of goods (recipe cost sheet) − expenses. Categories marked <b>stock</b> (bar materials, packaging…) are left out, because the recipe costs already include them. Unpaid and planned bills count on their expense date.{tot.coverage < 0.995 && !estimate && <> {pct(1 - tot.coverage)} of sales have no cost in the sheet and are counted with no cost of goods.</>}</>
            : <>Sales − everything in Accounting (including stock purchases). Good when every purchase is recorded.</>}
        </p>
        <div className="kpis" style={{ marginBottom: 0 }}>
          <Tile label="Sales (after discount)" value={money(tot.net)} sub={`${int(tot.days)} days`} />
          {recipe ? <Tile label="Gross profit" value={money(tot.gp)} sub={tot.net ? pct(tot.gp / tot.net) + ' of sales' : ''} />
            : <Tile label="Stock purchases" value={money(tot.stock)} sub="from Expenses" />}
          <Tile label={recipe ? 'Expenses (not stock)' : 'Other expenses'} value={money(tot.other)} sub={result.hasExpenses ? 'rent, salaries, bills…' : 'none entered yet'} warn={!result.hasExpenses} />
          <Tile label="Net profit" value={money(tot.netProfit)} sub={tot.net ? pct(tot.netProfit / tot.net) + ' of sales' : ''} bad={tot.netProfit < 0} />
          <Tile label="Break-even sales / day" value={tot.breakEven == null ? '–' : money(tot.breakEven)} sub={`now ${money(tot.net / Math.max(1, tot.days))} / day`} />
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div><h2>Net profit per month</h2><p>Bars: net profit (red = loss). Line: {recipe ? 'gross profit' : 'sales minus stock purchases'}.</p></div></div>
        <BarLineChart height={240} barLabel="Net profit" lines={[{ key: 'line', label: recipe ? 'Gross profit' : 'Sales − stock purchases', color: 'var(--series-7)', markers: true }]}
          data={rows.map((r) => ({
            key: r.key, label: r.label.slice(0, 3) + ' ' + r.key.slice(2, 4), value: r.netProfit, line: recipe ? r.gp : r.net - r.stock,
            title: r.label + (r.partial ? ` (${r.days} days)` : ''),
            rows: [['Sales', money(r.net)], ...(recipe ? [['Gross profit', money(r.gp)]] : [['Stock purchases', money(r.stock)]]), ['Expenses', money(r.other)], ['Net profit', money(r.netProfit)]],
          }))} />
      </div>

      <div className="card">
        <DataTable columns={columns} rows={rows} defaultSort={{ key: 'key', dir: 'desc' }} exportName="net-profit-per-month" pageSize={60} />
      </div>

      <div>
        <div className="card">
          <div className="card-head"><div><h2>Expenses in this period</h2><p>By category, from Accounting. Stock categories count only in “Money spent”.</p></div></div>
          {result.expCats.length
            ? <DataTable columns={[
              { key: 'name', label: 'Item', name: true, render: (r) => <>{r.name}{r.stock && <span className="pill" style={{ marginLeft: 6 }}>stock</span>}</> },
              { key: 'n', label: 'Entries', align: 'r', fmt: int, total: 'sum' },
              { key: 'amount', label: 'Amount', align: 'r', fmt: money, total: 'sum', csv: (r) => r.amount.toFixed(2) },
              { key: 'open', label: 'Not paid yet', align: 'r', fmt: (v) => (v ? money(v) : '–'), total: 'sum' },
            ]} rows={result.expCats} defaultSort={{ key: 'amount', dir: 'desc' }} exportName="expenses-period" />
            : <p className="muted">No accounting records for these dates.</p>}
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, warn, bad }) {
  return (
    <div className="card kpi" style={warn ? { borderColor: 'var(--warn)' } : undefined}>
      <div className="label">{label}</div>
      <div className={'value' + (bad ? ' down' : '')}>{value}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}
