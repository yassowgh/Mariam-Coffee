import { useMemo } from 'react';
import { monthDays, monthlyRows } from '../lib/aggregate.js';
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
    return r;
  }), [invs, basis, filters.from, filters.to]);

  const columns = [
    { key: 'key', label: 'Month', render: (r) => <>{r.label}{r.partial && <span className="pill warn" style={{ marginLeft: 6 }} title="Only part of this month is inside the selected dates">partial</span>}</>, csv: (r) => r.key },
    { key: 'dayCount', label: 'Days traded', align: 'r', fmt: int, total: 'sum' },
    { key: 'amount', label: amountLabel(basis), align: 'r', fmt: money, total: 'sum', csv: (r) => r.amount.toFixed(2) },
    { key: 'avgPerDay', label: 'Avg per day', align: 'r', fmt: money, csv: (r) => r.avgPerDay.toFixed(2) },
    { key: 'change', label: 'vs prev month', align: 'r', render: (r) => <ChangeCell v={r.change} />, csv: (r) => (r.change == null ? '' : (r.change * 100).toFixed(2)) },
    ...salesColumns(basis),
  ];
  return (
    <div className="stack">
      <div className="card">
        <div className="card-head"><div><h2>Sales per month</h2><p>{amountLabel(basis)} per month inside the selected dates.</p></div></div>
        <BarLineChart height={240} data={rows.map((r) => ({
          key: r.key, label: r.label.slice(0, 3) + ' ' + r.key.slice(2, 4), value: r.amount, title: r.label + (r.partial ? ' (partial)' : ''),
          rows: [['Sales', money(r.amount)], ['Orders', int(r.orders)], ['vs prev month', signedPct(r.change)]],
        }))} />
      </div>
      <div className="card">
        <DataTable columns={columns} rows={rows} defaultSort={{ key: 'key', dir: 'desc' }} filters={amountFilter(basis)} exportName="sales-per-month" />
      </div>
    </div>
  );
}
