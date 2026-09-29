import { useMemo, useState } from 'react';
import { DOW, addDays, hourOrder, lineValue, runRateFor } from '../lib/aggregate.js';
import { BarLineChart } from './charts.jsx';
import DataTable from './DataTable.jsx';
import ItemPicker from './ItemPicker.jsx';
import { dec1, hourRange, int, longDate, money, money2, monthLabel, pct, shortDate, signedPct } from '../format.js';
import { ChangeCell, amountLabel, marginFmt } from '../views/common.jsx';

const nextMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};
const change = (a, b) => (b ? (a - b) / Math.abs(b) : null);

/** Everything about one product, as a full page. Period = the dates chosen in the filter bar. */
export default function ProductPage({ ctx, id, onBack, backLabel }) {
  const { model, filters, basis, invs, prevInvs, openProduct } = ctx;
  const [metric, setMetric] = useState('qty'); // month tracker chart: 'qty' | 'value' | 'profit'
  const hasCosts = model.hasCosts;

  const d = useMemo(() => {
    const inRange = new Set(invs);
    const inPrev = new Set(prevInvs);
    const val = (l) => lineValue(l, basis);
    const months = new Map(), days = new Map(), hours = new Map(), wd = new Map(), monthTotal = new Map();
    const cur = { amount: 0, gross: 0, net: 0, qty: 0, cogs: 0, profit: 0, costedNet: 0, orders: new Set(), days: new Set() };
    const prev = { amount: 0, qty: 0, profit: 0 };
    let totalAmount = 0, totalProfit = 0;
    for (const inv of model.invoices) {
      if (filters.channel !== 'all' && inv.channel !== filters.channel) continue;
      const here = inRange.has(inv);
      if (here) totalProfit += inv.profit || 0;
      for (const l of inv.lines) {
        if (here) totalAmount += val(l);
        monthTotal.set(inv.month, (monthTotal.get(inv.month) || 0) + val(l));
        if (l.item !== id) continue;
        const lp = l.cost != null ? l.net - l.cost : null;
        const m = months.get(inv.month) || { amount: 0, qty: 0, gross: 0, profit: 0, costedNet: 0, orderKeys: new Set() };
        m.amount += val(l); m.qty += l.qty; m.gross += l.gross; if (inv.sign > 0) m.orderKeys.add(inv.key);
        if (lp != null) { m.profit += lp; m.costedNet += l.net; }
        months.set(inv.month, m);
        if (inPrev.has(inv)) { prev.amount += val(l); prev.qty += l.qty; if (lp != null) prev.profit += lp; }
        if (!here) continue;
        cur.amount += val(l); cur.gross += l.gross; cur.net += l.net; cur.qty += l.qty;
        if (lp != null) { cur.cogs += l.cost; cur.profit += lp; cur.costedNet += l.net; }
        if (inv.sign > 0) cur.orders.add(inv.key);
        cur.days.add(inv.date);
        const dd = days.get(inv.date) || { amount: 0, qty: 0, profit: 0, costedNet: 0 };
        dd.amount += val(l); dd.qty += l.qty; if (lp != null) { dd.profit += lp; dd.costedNet += l.net; }
        days.set(inv.date, dd);
        const h = hours.get(inv.hour) || { amount: 0, qty: 0 };
        h.amount += val(l); h.qty += l.qty; hours.set(inv.hour, h);
        const w = wd.get(inv.dow) || { amount: 0, qty: 0 };
        w.amount += val(l); w.qty += l.qty; wd.set(inv.dow, w);
      }
    }
    const periodDays = new Set(invs.map((i) => i.date)).size || 1;
    const costed = cur.costedNet !== 0 || cur.cogs !== 0;
    const showProfitLine = hasCosts && costed && basis !== 'profit';
    const dayList = [];
    for (let x = filters.from; x <= filters.to; x = addDays(x, 1)) {
      const r = days.get(x) || { amount: 0, qty: 0, profit: 0, costedNet: 0 };
      dayList.push({
        key: x, label: shortDate(x), value: r.amount, line2: showProfitLine ? r.profit : undefined,
        title: `${DOW[new Date(x + 'T00:00:00Z').getUTCDay()]} ${longDate(x)}`,
        rows: [['Sales', money(r.amount)], ['Qty', dec1(r.qty)], ...(showProfitLine ? [['Gross profit', money(r.profit), 'var(--series-7)']] : [])],
      });
    }

    // month-by-month tracker: every month from the first sale to the last month in the data (gaps = 0)
    const track = [];
    const lastMonth = model.maxDate.slice(0, 7);
    const firstMonth = [...months.keys()].sort()[0];
    if (firstMonth) {
      for (let m = firstMonth; m <= lastMonth; m = nextMonth(m)) {
        const v = months.get(m) || { amount: 0, qty: 0, gross: 0, profit: 0, costedNet: 0, orderKeys: new Set() };
        const p = track[track.length - 1];
        const rrV = runRateFor(m, v.amount, model.maxDate);
        const rrQ = runRateFor(m, v.qty, model.maxDate);
        const rrP = v.costedNet ? runRateFor(m, v.profit, model.maxDate) : null;
        const r = {
          key: m, qty: v.qty, value: v.amount, orders: v.orderKeys.size,
          profit: v.costedNet ? v.profit : null, margin: v.costedNet ? v.profit / v.costedNet : null,
          avgPrice: v.qty ? v.gross / v.qty : null,
          share: monthTotal.get(m) ? v.amount / monthTotal.get(m) : 0,
          rrQty: rrQ ? rrQ.value : null, rrValue: rrV ? rrV.value : null, rrProfit: rrP ? rrP.value : null,
          rrDays: rrV ? `${rrV.elapsed} of ${rrV.days} days` : '',
        };
        // an unfinished month compares its run rate with the previous month
        const cq = r.rrQty ?? r.qty, cv = r.rrValue ?? r.value, cp = r.rrProfit ?? r.profit;
        r.qtyChange = p && p.qty ? (cq - p.qty) / p.qty : null;
        r.valueChange = p && p.value ? (cv - p.value) / p.value : null;
        r.profitChange = p && p.profit && cp != null ? (cp - p.profit) / Math.abs(p.profit) : null;
        track.push(r);
      }
    }

    return {
      cur: {
        ...cur, orders: cur.orders.size, tradingDays: cur.days.size, costed,
        margin: cur.costedNet ? cur.profit / cur.costedNet : null,
        unitCost: costed && cur.qty ? cur.cogs / cur.qty : null,
        avgPrice: cur.qty ? cur.gross / cur.qty : null,
        perDay: cur.amount / periodDays, profitPerDay: cur.profit / periodDays, qtyPerDay: cur.qty / periodDays,
        share: totalAmount ? cur.amount / totalAmount : 0,
        profitShare: totalProfit ? cur.profit / totalProfit : 0,
      },
      prev, periodDays, showProfitLine, track,
      days: dayList,
      hours: [...hours].sort((a, b) => hourOrder(a[0]) - hourOrder(b[0])).map(([k, v]) => ({ key: k, label: String(k).padStart(2, '0'), value: v.qty, title: hourRange(k), rows: [['Qty', dec1(v.qty)], ['Sales', money(v.amount)]] })),
      wd: [1, 2, 3, 4, 5, 6, 0].map((k) => { const v = wd.get(k) || { amount: 0, qty: 0 }; return { key: k, label: DOW[k], value: v.qty, title: DOW[k], rows: [['Qty', dec1(v.qty)], ['Sales', money(v.amount)]] }; }),
    };
  }, [model, invs, prevInvs, filters.channel, filters.from, filters.to, basis, id, hasCosts]);

  const name = model.products.get(id)?.name ?? `Item ${id}`;
  const long = d.days.length > 190;
  const { cur, prev } = d;
  const metricKey = metric === 'qty' ? 'qty' : metric === 'profit' ? 'profit' : 'value';
  const rrKey = metric === 'qty' ? 'rrQty' : metric === 'profit' ? 'rrProfit' : 'rrValue';
  const hasRunRate = d.track.some((r) => r[rrKey] != null);

  return (
    <div className="stack product-page">
      <div className="product-head">
        <div style={{ minWidth: 0 }}>
          <button className="btn small" onClick={onBack}>← Back to {backLabel}</button>
          <h2 style={{ fontSize: 22, margin: '10px 0 2px' }}>{name}</h2>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Selected period {longDate(filters.from)} – {longDate(filters.to)} ({d.periodDays} trading days) · item #{id}. Change the dates in the filters above.
          </p>
        </div>
        <ItemPicker model={model} onPick={openProduct} label="Track another item" compact />
      </div>

      <div className="kpis" style={{ marginBottom: 0 }}>
        <Tile label={amountLabel(basis)} value={money(cur.amount)} delta={change(cur.amount, prev.amount)} sub={`${money(cur.perDay)} per day · ${pct(cur.share)} of all sales`} />
        <Tile label="Quantity sold" value={dec1(cur.qty)} delta={change(cur.qty, prev.qty)} sub={`${dec1(cur.qtyPerDay)} per day · ${int(cur.orders)} orders`} />
        {hasCosts && (
          cur.costed ? (
            <>
              <Tile label="Gross profit (period)" value={money(cur.profit)} delta={change(cur.profit, prev.profit)}
                sub={`sales after discount − cost of goods · ${pct(cur.profitShare)} of all profit`} strong />
              <Tile label="Margin" value={marginFmt(cur.margin)} sub={`${money(cur.profitPerDay)} profit per day`} />
              <Tile label="Unit cost / avg price" value={money2(cur.unitCost)} sub={`avg price ${money2(cur.avgPrice)} · profit ${money2(cur.qty ? cur.profit / cur.qty : null)}/item`} />
            </>
          ) : (
            <Tile label="Gross profit (period)" value="–" sub="No cost for this product yet. Add it in Profit & costs." />
          )
        )}
        <Tile label="Discounts on this item" value={money(cur.gross - cur.net)} sub={`${pct(cur.gross ? (cur.gross - cur.net) / cur.gross : 0)} of its menu value`} />
      </div>
      {hasCosts && cur.costed && (
        <p className="faint" style={{ margin: '-6px 0 0', fontSize: 12.5 }}>
          Gross profit = sales after discount minus the cost of goods from the cost sheet. Rent, staff and other running costs are not in the data, so this is not the final net profit.
        </p>
      )}

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Month-by-month tracking</h2>
            <p>All months in the data, not only the selected period. Value = {amountLabel(basis).toLowerCase()}.</p>
          </div>
          <div className="seg" role="group" aria-label="Chart shows">
            <button aria-pressed={metric === 'qty'} onClick={() => setMetric('qty')}>Quantity</button>
            <button aria-pressed={metric === 'value'} onClick={() => setMetric('value')}>Value</button>
            {hasCosts && cur.costed && <button aria-pressed={metric === 'profit'} onClick={() => setMetric('profit')}>Gross profit</button>}
          </div>
        </div>
        <BarLineChart height={240}
          barLabel={metric === 'qty' ? 'Quantity sold' : metric === 'profit' ? 'Gross profit' : 'Sales value'}
          ghostLabel={hasRunRate ? 'Run rate (unfinished month)' : null}
          yFmt={metric === 'qty' ? (v) => dec1(v) : undefined}
          data={d.track.map((r) => ({
            key: r.key,
            label: monthLabel(r.key).slice(0, 3) + ' ' + r.key.slice(2, 4),
            value: r[metricKey] ?? 0,
            ghost: r[rrKey] ?? undefined,
            title: monthLabel(r.key) + (r.rrDays ? ` (${r.rrDays})` : ''),
            rows: [
              ['Quantity', dec1(r.qty)], ['Value', money(r.value)],
              ...(r.margin != null ? [['Gross profit', money(r.profit)], ['Margin', marginFmt(r.margin)]] : []),
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
              ...(hasCosts ? [
                { key: 'profit', label: 'Gross profit', align: 'r', fmt: (v) => (v == null ? '–' : money(v)), total: 'sum', csv: (r) => (r.profit == null ? '' : r.profit.toFixed(2)) },
                { key: 'profitChange', label: 'Profit vs prev', align: 'r', render: (r) => <ChangeCell v={r.profitChange} />, csv: (r) => (r.profitChange == null ? '' : (r.profitChange * 100).toFixed(2)) },
                { key: 'margin', label: 'Margin %', align: 'r', fmt: marginFmt, csv: (r) => (r.margin == null ? '' : (r.margin * 100).toFixed(2)) },
              ] : []),
              { key: 'avgPrice', label: 'Avg price', align: 'r', fmt: (v) => (v == null ? '–' : money2(v)), title: 'Menu price per unit (before discount)' },
              { key: 'orders', label: 'Orders', align: 'r', fmt: int, total: 'sum' },
              { key: 'share', label: 'Share of month', align: 'r', fmt: (v) => pct(v), title: 'Share of all sales that month', csv: (r) => (r.share * 100).toFixed(2) },
              { key: 'rrQty', label: 'Run rate qty', align: 'r', fmt: (v) => (v == null ? '–' : dec1(v)), title: 'Unfinished month: so far ÷ days elapsed × days in month' },
              { key: 'rrValue', label: 'Run rate value', align: 'r', fmt: (v) => (v == null ? '–' : money(v)) },
              ...(hasCosts ? [{ key: 'rrProfit', label: 'Run rate profit', align: 'r', fmt: (v) => (v == null ? '–' : money(v)) }] : []),
            ]} />
          <p className="faint" style={{ fontSize: 12, margin: '6px 0 0' }}>“vs prev” for an unfinished month uses its run rate.</p>
        </div>
      </div>

      {!long && (
        <div className="card">
          <div className="card-head"><div><h2>Daily sales · selected period</h2><p>{amountLabel(basis)} per day{d.showProfitLine ? ', with gross profit as a line' : ''}.</p></div></div>
          <BarLineChart data={d.days} height={220} barLabel={amountLabel(basis)}
            lines={d.showProfitLine ? [{ key: 'line2', label: 'Gross profit', color: 'var(--series-7)', markers: true }] : []} />
        </div>
      )}
      <div className="grid two">
        <div className="card"><div className="card-head"><h2>Quantity by hour</h2></div><BarLineChart data={d.hours} height={200} yFmt={(v) => dec1(v)} /></div>
        <div className="card"><div className="card-head"><h2>Quantity by weekday</h2></div><BarLineChart data={d.wd} height={200} yFmt={(v) => dec1(v)} /></div>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, delta, strong }) {
  return (
    <div className="card kpi" style={strong ? { borderColor: 'var(--series-7)' } : undefined}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className="sub">
        {delta != null && Number.isFinite(delta) && (
          <span className={'delta ' + (delta > 0 ? 'up' : delta < 0 ? 'down' : 'faint')}>{delta > 0 ? '▲' : delta < 0 ? '▼' : ''} {signedPct(delta)} </span>
        )}
        {sub}
      </div>
    </div>
  );
}
