import { useMemo } from 'react';
import { DOW, dailyRows } from '../lib/aggregate.js';
import DataTable from '../components/DataTable.jsx';
import { BarLineChart } from '../components/charts.jsx';
import { ChangeCell, PAY_SERIES, amountFilter, amountLabel, payParts, payRows, salesColumns } from './common.jsx';
import { int, longDate, money, money2, shortDate, signedPct, timeLabel } from '../format.js';

export default function Daily({ ctx }) {
  const { invs, basis } = ctx;
  const rows = useMemo(() => {
    const r = dailyRows(invs, basis);
    const first = new Map(), last = new Map();
    for (const i of invs) {
      if (!first.has(i.date)) first.set(i.date, i.minute);
      last.set(i.date, i.minute);
    }
    for (const d of r) { d.first = first.get(d.key); d.last = last.get(d.key); d.dowName = DOW[d.dow]; }
    return r;
  }, [invs, basis]);

  const columns = [
    { key: 'key', label: 'Date', fmt: (v) => longDate(v) },
    { key: 'dow', label: 'Day', fmt: (v) => DOW[v], sortValue: (r) => (r.dow + 6) % 7, csv: (r) => DOW[r.dow] },
    { key: 'amount', label: amountLabel(basis), align: 'r', fmt: money, total: 'sum', csv: (r) => r.amount.toFixed(2) },
    { key: 'vsLastWeek', label: 'vs same day last week', align: 'r', render: (r) => <ChangeCell v={r.vsLastWeek} />, csv: (r) => (r.vsLastWeek == null ? '' : (r.vsLastWeek * 100).toFixed(2)) },
    ...salesColumns(basis),
    { key: 'first', label: 'First order', align: 'r', fmt: (v) => (v == null ? '–' : timeLabel(v)), csv: (r) => timeLabel(r.first) },
    { key: 'last', label: 'Last order', align: 'r', fmt: (v) => (v == null ? '–' : timeLabel(v)), csv: (r) => timeLabel(r.last), title: 'Times after midnight belong to this business day' },
  ];
  const chart = [...rows].map((r) => {
    const pp = payParts(r);
    return {
      key: r.key, label: shortDate(r.key), value: r.amount, parts: pp, title: `${DOW[r.dow]} ${longDate(r.key)}`,
      rows: [['Sales', money(r.amount)], ...payRows(pp, r.amount), ['Orders', int(r.orders)], ['Avg ticket', money2(r.avgTicket)], ['vs last week', signedPct(r.vsLastWeek)]],
    };
  });
  return (
    <div className="stack">
      <div className="card">
        <div className="card-head"><div><h2>Sales per day</h2><p>{amountLabel(basis)} per business day. Sales after midnight count toward the previous day.</p></div></div>
        <BarLineChart height={240} data={chart} series={PAY_SERIES} />
      </div>
      <div className="card">
        <DataTable columns={columns} rows={rows} defaultSort={{ key: 'key', dir: 'desc' }} filters={amountFilter(basis)} exportName="sales-per-day" />
      </div>
    </div>
  );
}
