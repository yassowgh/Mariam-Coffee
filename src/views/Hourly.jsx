import { useMemo, useState } from 'react';
import { DOW, heatmap, hourOrder, hourlyRows } from '../lib/aggregate.js';
import DataTable from '../components/DataTable.jsx';
import { BarLineChart, Heatmap } from '../components/charts.jsx';
import { dec1, hourRange, int, money, pct } from '../format.js';
import { amountFilter, amountLabel, basisWord, salesColumns } from './common.jsx';

export default function Hourly({ ctx }) {
  const { invs, basis } = ctx;
  const [dow, setDow] = useState('all');
  const sel = useMemo(() => (dow === 'all' ? invs : invs.filter((i) => i.dow === Number(dow))), [invs, dow]);
  const rows = useMemo(() => hourlyRows(sel, basis), [sel, basis]);
  const heat = useMemo(() => heatmap(invs, basis), [invs, basis]);
  const active = rows.map((r) => r.key);
  const hours = active.length
    ? Array.from({ length: hourOrder(active[active.length - 1]) - hourOrder(active[0]) + 1 }, (_, i) => (active[0] + i) % 24)
    : [];
  const dows = [1, 2, 3, 4, 5, 6, 0];

  const columns = [
    { key: 'key', label: 'Hour', fmt: (v) => hourRange(v), sortValue: (r) => hourOrder(r.key), csv: (r) => hourRange(r.key) },
    { key: 'amount', label: amountLabel(basis), align: 'r', fmt: money, total: 'sum', csv: (r) => r.amount.toFixed(2) },
    { key: 'share', label: 'Share', align: 'r', fmt: (v) => pct(v), total: 'sum', csv: (r) => (r.share * 100).toFixed(2) },
    { key: 'avgPerDay', label: 'Avg sales / day', align: 'r', fmt: money, csv: (r) => r.avgPerDay.toFixed(2), title: 'Hour total ÷ number of trading days in the selection' },
    { key: 'ordersPerDay', label: 'Orders / day', align: 'r', fmt: dec1, csv: (r) => r.ordersPerDay.toFixed(2) },
    ...salesColumns(basis, ctx.model.hasCosts),
  ];
  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div><h2>Sales distribution per hour</h2><p>{amountLabel(basis)} by clock hour of the order.</p></div>
          <label className="field">
            <span>Weekday</span>
            <select value={dow} onChange={(e) => setDow(e.target.value)}>
              <option value="all">All days</option>
              {dows.map((d) => <option key={d} value={d}>{DOW[d]}</option>)}
            </select>
          </label>
        </div>
        <BarLineChart height={240} data={rows.map((r) => ({
          key: r.key, label: String(r.key).padStart(2, '0'), value: r.amount, title: hourRange(r.key),
          rows: [['Sales', money(r.amount)], ['Share', pct(r.share)], ['Orders', int(r.orders)], ['Avg / day', money(r.avgPerDay)]],
        }))} />
      </div>
      <div className="card">
        <DataTable columns={columns} rows={rows} defaultSort={{ key: 'key', dir: 'asc' }} filters={amountFilter(basis)} exportName="sales-per-hour" />
      </div>
      <div className="card">
        <div className="card-head"><div><h2>Weekday × hour</h2><p>Average {basisWord(basis)} {basis === 'profit' ? '' : 'sales '}per occurrence of each weekday and hour.</p></div></div>
        <Heatmap cells={heat} dows={dows} dowLabels={dows.map((d) => DOW[d])} hours={hours} fmt={money} subFmt={dec1} />
      </div>
    </div>
  );
}
