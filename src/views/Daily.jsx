import { useMemo } from 'react';
import { DOW, addDays, dailyRows, filterInvoices } from '../lib/aggregate.js';
import DataTable from '../components/DataTable.jsx';
import { BarLineChart } from '../components/charts.jsx';
import { ChangeCell, ChartLineToggles, PAY_SERIES, amountFilter, amountLabel, chartLineFlags, chartLines, payParts, payRows, profitRows, salesColumns, weekdayAverages } from './common.jsx';
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
    ...salesColumns(basis, ctx.model.hasCosts),
    { key: 'first', label: 'First order', align: 'r', fmt: (v) => (v == null ? '–' : timeLabel(v)), csv: (r) => timeLabel(r.first) },
    { key: 'last', label: 'Last order', align: 'r', fmt: (v) => (v == null ? '–' : timeLabel(v)), csv: (r) => timeLabel(r.last), title: 'Times after midnight belong to this business day' },
  ];
  const lf = chartLineFlags(ctx, false);
  const profitOn = lf.profit;
  const chart = useMemo(() => {
    // 7-day average needs the 6 days before the period too
    const lead = new Map(dailyRows(filterInvoices(ctx.model, { from: addDays(ctx.filters.from, -6), to: ctx.filters.to, channel: ctx.filters.channel }), basis).map((r) => [r.key, r.amount]));
    const dowAvg = weekdayAverages(rows);
    return rows.map((r) => {
      const pp = payParts(r);
      let sum = 0;
      for (let i = 0; i < 7; i++) sum += lead.get(addDays(r.key, -i)) || 0;
      const ma = sum / 7;
      const da = dowAvg[r.dow];
      return {
        key: r.key, label: shortDate(r.key), value: r.amount, parts: pp,
        line: lf.ma ? ma : undefined,
        dowAvg: lf.dow && da != null ? da : undefined,
        line2: profitOn ? r.profit : undefined,
        title: `${DOW[r.dow]} ${longDate(r.key)}`,
        rows: [['Sales', money(r.amount)], ...payRows(pp, r.amount), ...(profitOn ? profitRows(r) : []), ['Orders', int(r.orders)], ['Avg ticket', money2(r.avgTicket)], ['vs last week', signedPct(r.vsLastWeek)],
          ...(lf.ma ? [['7-day avg', money(ma), 'var(--text)']] : []),
          ...(lf.dow && da != null ? [[`Avg ${DOW[r.dow]}`, money(da), 'var(--text-3)']] : [])],
      };
    });
  }, [rows, lf.ma, lf.dow, profitOn, ctx.model, ctx.filters.from, ctx.filters.to, ctx.filters.channel, basis]);
  return (
    <div className="stack">
      <div className="card">
        <div className="card-head"><div><h2>Sales per day</h2><p>{amountLabel(basis)} per business day. Sales after midnight count toward the previous day.</p></div><ChartLineToggles ctx={ctx} /></div>
        <BarLineChart height={240} data={chart} series={PAY_SERIES} lines={chartLines(lf)} />
      </div>
      <div className="card">
        <DataTable columns={columns} rows={rows} defaultSort={{ key: 'key', dir: 'desc' }} filters={amountFilter(basis)} exportName="sales-per-day" />
      </div>
    </div>
  );
}
