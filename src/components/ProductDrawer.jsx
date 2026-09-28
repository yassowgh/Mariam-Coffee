import { useEffect, useMemo, useState } from 'react';
import { DOW, addDays, hourOrder, runRateFor } from '../lib/aggregate.js';
import { BarLineChart } from './charts.jsx';
import DataTable from './DataTable.jsx';
import ItemPicker from './ItemPicker.jsx';
import { dec1, hourRange, int, longDate, money, money2, monthLabel, pct, shortDate, signedPct } from '../format.js';
import { ChangeCell } from '../views/common.jsx';

const nextMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

export default function ProductDrawer({ ctx, id, onClose }) {
  const { model, filters, basis, invs, openProduct } = ctx;
  const [metric, setMetric] = useState('qty'); // month tracker chart: 'qty' | 'value'
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const d = useMemo(() => {
    const inRange = new Set(invs);
    const val = (l) => (basis === 'net' ? l.net : l.gross);
    const months = new Map(), days = new Map(), hours = new Map(), wd = new Map(), monthTotal = new Map();
    let amount = 0, qty = 0, totalPeriod = 0;
    const orderSet = new Set();
    for (const inv of model.invoices) for (const l of inv.lines) {
      if (filters.channel !== 'all' && inv.channel !== filters.channel) continue;
      if (inRange.has(inv)) totalPeriod += val(l);
      monthTotal.set(inv.month, (monthTotal.get(inv.month) || 0) + val(l));
      if (l.item !== id) continue;
      const m = months.get(inv.month) || { amount: 0, qty: 0, gross: 0, orderKeys: new Set() };
      m.amount += val(l); m.qty += l.qty; m.gross += l.gross; if (inv.sign > 0) m.orderKeys.add(inv.key);
      months.set(inv.month, m);
      if (!inRange.has(inv)) continue;
      amount += val(l); qty += l.qty; if (inv.sign > 0) orderSet.add(inv.key);
      const dd = days.get(inv.date) || { amount: 0, qty: 0 };
      dd.amount += val(l); dd.qty += l.qty; days.set(inv.date, dd);
      const h = hours.get(inv.hour) || { amount: 0, qty: 0 };
      h.amount += val(l); h.qty += l.qty; hours.set(inv.hour, h);
      const w = wd.get(inv.dow) || { amount: 0, qty: 0 };
      w.amount += val(l); w.qty += l.qty; wd.set(inv.dow, w);
    }
    const dayList = [];
    for (let x = filters.from; x <= filters.to; x = addDays(x, 1)) {
      const r = days.get(x) || { amount: 0, qty: 0 };
      dayList.push({ key: x, label: shortDate(x), value: r.amount, title: `${DOW[new Date(x + 'T00:00:00Z').getUTCDay()]} ${longDate(x)}`, rows: [['Sales', money(r.amount)], ['Qty', dec1(r.qty)]] });
    }

    // month-by-month tracker: every month from the first sale to the last month in the data (gaps = 0)
    const track = [];
    const lastMonth = model.maxDate.slice(0, 7);
    const firstMonth = [...months.keys()].sort()[0];
    if (firstMonth) {
      for (let m = firstMonth; m <= lastMonth; m = nextMonth(m)) {
        const v = months.get(m) || { amount: 0, qty: 0, gross: 0, orderKeys: new Set() };
        v.orders = v.orderKeys.size;
        const prev = track[track.length - 1];
        const rrV = runRateFor(m, v.amount, model.maxDate);
        const rrQ = runRateFor(m, v.qty, model.maxDate);
        const r = {
          key: m, qty: v.qty, value: v.amount, orders: v.orders,
          avgPrice: v.qty ? v.gross / v.qty : null,
          share: monthTotal.get(m) ? v.amount / monthTotal.get(m) : 0,
          rrQty: rrQ ? rrQ.value : null, rrValue: rrV ? rrV.value : null,
          rrDays: rrV ? `${rrV.elapsed} of ${rrV.days} days` : '',
        };
        // an unfinished month compares its run rate with the previous month
        const cq = r.rrQty ?? r.qty, cv = r.rrValue ?? r.value;
        r.qtyChange = prev && prev.qty ? (cq - prev.qty) / prev.qty : null;
        r.valueChange = prev && prev.value ? (cv - prev.value) / prev.value : null;
        track.push(r);
      }
    }

    return {
      amount, qty, orders: orderSet.size, share: totalPeriod ? amount / totalPeriod : 0, track,
      days: dayList,
      hours: [...hours].sort((a, b) => hourOrder(a[0]) - hourOrder(b[0])).map(([k, v]) => ({ key: k, label: String(k).padStart(2, '0'), value: v.qty, title: hourRange(k), rows: [['Qty', dec1(v.qty)], ['Sales', money(v.amount)]] })),
      wd: [1, 2, 3, 4, 5, 6, 0].map((k) => { const v = wd.get(k) || { amount: 0, qty: 0 }; return { key: k, label: DOW[k], value: v.qty, title: DOW[k], rows: [['Qty', dec1(v.qty)], ['Sales', money(v.amount)]] }; }),
    };
  }, [model, invs, filters, basis, id]);

  const name = model.products.get(id)?.name ?? `Item ${id}`;
  const long = d.days.length > 190;
  const hasRunRate = d.track.some((r) => r.rrQty != null);
  return (
    <>
      <div className="drawer-back" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={name}>
        <div className="drawer-head">
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 18 }}>{name}</h2>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>{longDate(filters.from)} – {longDate(filters.to)} · item #{id}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <ItemPicker model={model} onPick={openProduct} label="Track another item" compact />
            <button className="btn icon-btn" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>
        <div className="kpis" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
          <div className="card kpi"><div className="label">Sales ({basis === 'net' ? 'after' : 'before'} discount)</div><div className="value">{money(d.amount)}</div><div className="sub">{pct(d.share)} of all sales</div></div>
          <div className="card kpi"><div className="label">Quantity</div><div className="value">{dec1(d.qty)}</div><div className="sub">{int(d.orders)} orders · avg {money2(d.qty ? d.amount / d.qty : 0)}</div></div>
        </div>
        <div className="stack">
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Month-by-month tracking</h2>
                <p>All months in the data, not only the selected period. Value = sales {basis === 'net' ? 'after' : 'before'} discount.</p>
              </div>
              <div className="seg" role="group" aria-label="Chart shows">
                <button aria-pressed={metric === 'qty'} onClick={() => setMetric('qty')}>Quantity</button>
                <button aria-pressed={metric === 'value'} onClick={() => setMetric('value')}>Value</button>
              </div>
            </div>
            <BarLineChart height={200}
              barLabel={metric === 'qty' ? 'Quantity sold' : 'Sales value'}
              ghostLabel={hasRunRate ? 'Run rate (unfinished month)' : null}
              yFmt={metric === 'qty' ? (v) => dec1(v) : undefined}
              data={d.track.map((r) => ({
                key: r.key,
                label: monthLabel(r.key).slice(0, 3) + ' ' + r.key.slice(2, 4),
                value: metric === 'qty' ? r.qty : r.value,
                ghost: (metric === 'qty' ? r.rrQty : r.rrValue) ?? undefined,
                title: monthLabel(r.key) + (r.rrDays ? ` (${r.rrDays})` : ''),
                rows: [
                  ['Quantity', dec1(r.qty)], ['Value', money(r.value)],
                  ...(r.rrQty != null ? [['Run rate qty', dec1(r.rrQty)], ['Run rate value', money(r.rrValue)]] : []),
                  ['Avg price', r.avgPrice == null ? '–' : money2(r.avgPrice)],
                  ['Qty vs prev', signedPct(r.qtyChange)], ['Value vs prev', signedPct(r.valueChange)],
                ],
              }))} />
            <div style={{ marginTop: 14 }}>
              <DataTable exportName={`item-${id}-by-month`} rows={d.track} defaultSort={{ key: 'key', dir: 'desc' }} pageSize={60}
                columns={[
                  { key: 'key', label: 'Month', fmt: monthLabel },
                  { key: 'qty', label: 'Qty', align: 'r', fmt: dec1, total: 'sum' },
                  { key: 'qtyChange', label: 'Qty vs prev', align: 'r', render: (r) => <ChangeCell v={r.qtyChange} />, csv: (r) => (r.qtyChange == null ? '' : (r.qtyChange * 100).toFixed(2)) },
                  { key: 'value', label: 'Value', align: 'r', fmt: money, total: 'sum', csv: (r) => r.value.toFixed(2) },
                  { key: 'valueChange', label: 'Value vs prev', align: 'r', render: (r) => <ChangeCell v={r.valueChange} />, csv: (r) => (r.valueChange == null ? '' : (r.valueChange * 100).toFixed(2)) },
                  { key: 'avgPrice', label: 'Avg price', align: 'r', fmt: (v) => (v == null ? '–' : money2(v)), title: 'Menu price per unit (before discount)' },
                  { key: 'orders', label: 'Orders', align: 'r', fmt: int, total: 'sum' },
                  { key: 'share', label: 'Share of month', align: 'r', fmt: (v) => pct(v), title: 'Share of all sales that month', csv: (r) => (r.share * 100).toFixed(2) },
                  { key: 'rrQty', label: 'Run rate qty', align: 'r', fmt: (v) => (v == null ? '–' : dec1(v)), title: 'Unfinished month: so far ÷ days elapsed × days in month' },
                  { key: 'rrValue', label: 'Run rate value', align: 'r', fmt: (v) => (v == null ? '–' : money(v)) },
                ]} />
              <p className="faint" style={{ fontSize: 12, margin: '6px 0 0' }}>“vs prev” for an unfinished month uses its run rate.</p>
            </div>
          </div>
          {!long && <div className="card"><div className="card-head"><h2>Daily sales (selected period)</h2></div><BarLineChart data={d.days} height={180} /></div>}
          <div className="grid two">
            <div className="card"><div className="card-head"><h2>Qty by hour</h2></div><BarLineChart data={d.hours} height={170} yFmt={(v) => dec1(v)} /></div>
            <div className="card"><div className="card-head"><h2>Qty by weekday</h2></div><BarLineChart data={d.wd} height={170} yFmt={(v) => dec1(v)} /></div>
          </div>
        </div>
      </aside>
    </>
  );
}
