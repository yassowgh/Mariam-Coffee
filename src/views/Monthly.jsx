import { useMemo } from 'react';
import { monthDays, monthlyRows, runRateFor } from '../lib/aggregate.js';
import DataTable from '../components/DataTable.jsx';
import { BarLineChart } from '../components/charts.jsx';
import { int, money, monthLabel, signedPct } from '../format.js';
import { ChangeCell, amountFilter, amountLabel, salesColumns } from './common.jsx';

export default function Monthly({ ctx }) {
  const { invs, basis, filters } = ctx;
  const rows = useMemo(() => monthlyRows(invs, basis).map((r) => {
    const full = monthDays(r.key);
    const first = r.key + '-01', last = `${r.key}-${String(full).padStart(2, '0')}`;
    r.partial = filters.from > first || filters.to < last;
    r.label = monthLabel(r.key);
    const rr = runRateFor(r.key, r.amount, ctx.model.maxDate);
    r.runRate = rr && filters.from <= first && filters.to >= ctx.model.maxDate ? rr.value : null;
    r.rrDays = rr ? `${rr.elapsed} of ${rr.days} days` : '';
    return r;
  }).map((r, i, all) => {
    // month-on-month only between complete months; an unfinished month compares its run rate
    const prev = all[i - 1];
    const cur = r.runRate ?? (r.partial ? null : r.amount);
    r.change = prev && !prev.partial && prev.amount && cur != null ? (cur - prev.amount) / prev.amount : null;
    r.changeIsRunRate = r.runRate != null;
    return r;
  }), [invs, basis, filters.from, filters.to, ctx.model.maxDate]);

  const columns = [
    { key: 'key', label: 'Month', render: (r) => <>{r.label}{r.partial && <span className="pill warn" style={{ marginLeft: 6 }} title="Only part of this month is inside the selected dates">partial</span>}</>, csv: (r) => r.key },
    { key: 'dayCount', label: 'Days traded', align: 'r', fmt: int, total: 'sum' },
    { key: 'amount', label: amountLabel(basis), align: 'r', fmt: money, total: 'sum', csv: (r) => r.amount.toFixed(2) },
    { key: 'runRate', label: 'Run rate', align: 'r', title: 'Unfinished month: sales so far ÷ days elapsed × days in month',
      render: (r) => (r.runRate == null ? <span className="faint">–</span> : <span title={r.rrDays}>{money(r.runRate)}</span>), csv: (r) => (r.runRate == null ? '' : r.runRate.toFixed(2)) },
    { key: 'avgPerDay', label: 'Avg per day', align: 'r', fmt: money, csv: (r) => r.avgPerDay.toFixed(2) },
    { key: 'change', label: 'vs prev month', align: 'r', title: 'Only between complete months. An unfinished month uses its run rate.', render: (r) => <><ChangeCell v={r.change} />{r.changeIsRunRate && r.change != null && <span className="faint"> (run rate)</span>}</>, csv: (r) => (r.change == null ? '' : (r.change * 100).toFixed(2)) },
    ...salesColumns(basis),
  ];
  return (
    <div className="stack">
      <div className="card">
        <div className="card-head"><div><h2>Sales per month</h2><p>{amountLabel(basis)} per month inside the selected dates.</p></div></div>
        <BarLineChart height={240} barLabel={amountLabel(basis)} ghostLabel={rows.some((r) => r.runRate != null) ? 'Run rate (unfinished month)' : null} data={rows.map((r) => ({
          key: r.key, label: r.label.slice(0, 3) + ' ' + r.key.slice(2, 4), value: r.amount, ghost: r.runRate ?? undefined, title: r.label + (r.partial ? ' (partial)' : ''),
          rows: [['Sales', money(r.amount)], ...(r.runRate != null ? [['Run rate', money(r.runRate)], ['Days', r.rrDays]] : []), ['Orders', int(r.orders)], ['vs prev month', signedPct(r.change)]],
        }))} />
      </div>
      <div className="card">
        <DataTable columns={columns} rows={rows} defaultSort={{ key: 'key', dir: 'desc' }} filters={amountFilter(basis)} exportName="sales-per-month" />
      </div>
    </div>
  );
}
