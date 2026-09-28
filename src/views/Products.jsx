import { useMemo, useState } from 'react';
import { monthDays, productMonthPivot, productRows } from '../lib/aggregate.js';
import DataTable from '../components/DataTable.jsx';
import ItemPicker from '../components/ItemPicker.jsx';
import { dec1, int, longDate, money, money2, monthLabel, pct, shortDate, signedMoney } from '../format.js';
import { ChangeCell, amountLabel, marginFmt } from './common.jsx';

export default function Products({ ctx }) {
  const [mode, setMode] = useState('summary');
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Product sales</h2>
          <p>Every product total adds up exactly to the invoice totals. Invoice discounts are shared across the lines of each invoice for the Net figure. Click a product, or search for one, to track it month by month.</p>
        </div>
        <ItemPicker model={ctx.model} onPick={ctx.openProduct} label="Track an item" />
        <div className="seg" role="group" aria-label="View">
          <button aria-pressed={mode === 'summary'} onClick={() => setMode('summary')}>Summary</button>
          <button aria-pressed={mode === 'amount'} onClick={() => setMode('amount')}>Amount by month</button>
          <button aria-pressed={mode === 'qty'} onClick={() => setMode('qty')}>Quantity by month</button>
        </div>
      </div>
      {mode === 'summary' ? <Summary ctx={ctx} /> : <Pivot ctx={ctx} qty={mode === 'qty'} />}
    </div>
  );
}

function Summary({ ctx }) {
  const { model, invs, prevInvs, basis, prevFrom, prevTo, openProduct } = ctx;
  const rows = useMemo(() => productRows(model, invs, prevInvs, basis), [model, invs, prevInvs, basis]);
  const columns = [
    { key: 'rank', label: '#', align: 'r' },
    { key: 'name', label: 'Product', name: true, render: (r) => <span title={r.name}>{r.name}{r.unallocated && <span className="pill warn" style={{ marginLeft: 6 }}>see Reconciliation</span>}</span> },
    { key: 'qty', label: 'Qty', align: 'r', fmt: dec1, total: 'sum' },
    { key: 'orderCount', label: 'Orders', align: 'r', fmt: int, title: 'Orders containing this product' },
    { key: 'amount', label: amountLabel(basis), align: 'r', fmt: money, total: 'sum', csv: (r) => r.amount.toFixed(2) },
    { key: 'share', label: 'Share', align: 'r', fmt: (v) => pct(v), total: 'sum', csv: (r) => (r.share * 100).toFixed(2) },
    { key: 'gross', label: 'Gross', align: 'r', fmt: money, total: 'sum', csv: (r) => r.gross.toFixed(2) },
    { key: 'disc', label: 'Discount share', align: 'r', fmt: money, total: 'sum', csv: (r) => r.disc.toFixed(2) },
    { key: 'net', label: 'Net', align: 'r', fmt: money, total: 'sum', csv: (r) => r.net.toFixed(2) },
    { key: 'avgPrice', label: 'Avg price', align: 'r', fmt: money2, csv: (r) => r.avgPrice.toFixed(2) },
    ...(model.hasCosts ? [
      { key: 'unitCost', label: 'Unit cost', align: 'r', fmt: (v) => (v == null ? '–' : money2(v)), title: 'From the cost sheet or your own entry' },
      { key: 'profit', label: 'Gross profit', align: 'r', fmt: (v) => (v == null ? '–' : money(v)), total: 'sum', csv: (r) => (r.profit == null ? '' : r.profit.toFixed(2)) },
      { key: 'margin', label: 'Margin %', align: 'r', fmt: marginFmt, csv: (r) => (r.margin == null ? '' : (r.margin * 100).toFixed(2)) },
    ] : []),
    { key: 'prevAmount', label: `Prev (${shortDate(prevFrom)}–${shortDate(prevTo)})`, align: 'r', fmt: money, total: 'sum', csv: (r) => (r.prevAmount ?? 0).toFixed(2) },
    { key: 'delta', label: 'Change TL', align: 'r', fmt: signedMoney, total: 'sum', cls: (r) => (r.delta > 0 ? 'up' : r.delta < 0 ? 'down' : ''), csv: (r) => (r.delta ?? 0).toFixed(2) },
    { key: 'change', label: 'Change %', align: 'r', render: (r) => (r.prevAmount ? <ChangeCell v={r.change} /> : <span className="faint">new</span>), csv: (r) => (r.change == null ? '' : (r.change * 100).toFixed(2)) },
    { key: 'lastDate', label: 'Last sold', fmt: (v) => (v ? longDate(v) : '–') },
  ];
  return (
    <DataTable columns={columns} rows={rows} defaultSort={{ key: 'amount', dir: 'desc' }}
      filters={{ search: 'name', orders: 'orderCount', amount: 'amount', amountLabel: amountLabel(basis) }}
      exportName="product-sales" onRowClick={(r) => openProduct(r.key)} footerNote="click a product for details" />
  );
}

function Pivot({ ctx, qty }) {
  const { model, invs, basis, filters, openProduct } = ctx;
  const { months, rows } = useMemo(() => productMonthPivot(model, invs, basis), [model, invs, basis]);
  // forecast for a month that is still running at the end of the data (same idea as the owner's Excel)
  const lastM = months[months.length - 1];
  const lastDay = model.maxDate;
  const running = lastM && lastDay.startsWith(lastM) && filters.to >= lastDay && Number(lastDay.slice(8)) < monthDays(lastM);
  const factor = running ? monthDays(lastM) / Number(lastDay.slice(8)) : null;
  const data = useMemo(() => rows.map((r) => {
    const o = { key: r.key, name: r.name, total: qty ? r.totalQty : r.total };
    for (const m of months) o[m] = (qty ? r['q' + m] : r[m]) || 0;
    if (running) o.forecast = o[lastM] * factor;
    if (months.length >= 2) {
      const a = o[months[months.length - 2]], b = running ? o.forecast : o[lastM];
      o.trend = a ? (b - a) / a : null;
    }
    return o;
  }), [rows, months, qty, running, factor, lastM]);
  const fmt = qty ? dec1 : money;
  const columns = [
    { key: 'name', label: 'Product', name: true, render: (r) => <span title={r.name}>{r.name}</span> },
    ...months.map((m) => ({ key: m, label: monthLabel(m), align: 'r', fmt, total: 'sum', csv: (r) => r[m].toFixed(2) })),
    ...(running ? [{ key: 'forecast', label: `${monthLabel(lastM).slice(0, 3)} forecast`, align: 'r', fmt, total: 'sum', title: `Month-to-date × ${monthDays(lastM)} / ${Number(lastDay.slice(8))} days`, csv: (r) => r.forecast.toFixed(2) }] : []),
    ...(months.length >= 2 ? [{ key: 'trend', label: 'Last vs prev month', align: 'r', render: (r) => <ChangeCell v={r.trend} />, csv: (r) => (r.trend == null ? '' : (r.trend * 100).toFixed(2)), title: running ? 'Forecast of the running month vs the previous month' : 'Last month vs the one before' }] : []),
    { key: 'total', label: 'Total', align: 'r', fmt, total: 'sum', csv: (r) => r.total.toFixed(2) },
  ];
  return (
    <DataTable columns={columns} rows={data} defaultSort={{ key: 'total', dir: 'desc' }}
      filters={{ search: 'name', amount: 'total', amountLabel: qty ? 'Total qty' : 'Total' }}
      exportName={qty ? 'product-quantity-by-month' : 'product-sales-by-month'}
      onRowClick={(r) => openProduct(r.key)} pageSize={400}
      footerNote={`${qty ? 'quantities' : amountLabel(basis).toLowerCase()} per month`} />
  );
}
