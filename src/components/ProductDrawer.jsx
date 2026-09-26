import { useEffect, useMemo } from 'react';
import { DOW, addDays, hourOrder } from '../lib/aggregate.js';
import { BarLineChart } from './charts.jsx';
import { dec1, hourRange, int, longDate, money, money2, monthLabel, pct, shortDate } from '../format.js';

export default function ProductDrawer({ ctx, id, onClose }) {
  const { model, filters, basis, invs } = ctx;
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const d = useMemo(() => {
    const inRange = new Set(invs);
    const val = (l) => (basis === 'net' ? l.net : l.gross);
    const months = new Map(), days = new Map(), hours = new Map(), wd = new Map();
    let amount = 0, qty = 0, orders = 0, totalPeriod = 0;
    for (const l of model.lines) {
      const inv = l.inv;
      if (filters.channel !== 'all' && inv.channel !== filters.channel) continue;
      if (inRange.has(inv)) totalPeriod += val(l);
      if (l.item !== id) continue;
      const m = months.get(inv.month) || { amount: 0, qty: 0 };
      m.amount += val(l); m.qty += l.qty; months.set(inv.month, m);
      if (!inRange.has(inv)) continue;
      amount += val(l); qty += l.qty; if (inv.sign > 0) orders++;
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
    return {
      amount, qty, orders, share: totalPeriod ? amount / totalPeriod : 0,
      months: [...months].sort().map(([k, v]) => ({ key: k, label: monthLabel(k).slice(0, 3) + ' ' + k.slice(2, 4), value: v.amount, title: monthLabel(k), rows: [['Sales', money(v.amount)], ['Qty', dec1(v.qty)]] })),
      days: dayList,
      hours: [...hours].sort((a, b) => hourOrder(a[0]) - hourOrder(b[0])).map(([k, v]) => ({ key: k, label: String(k).padStart(2, '0'), value: v.qty, title: hourRange(k), rows: [['Qty', dec1(v.qty)], ['Sales', money(v.amount)]] })),
      wd: [1, 2, 3, 4, 5, 6, 0].map((k) => { const v = wd.get(k) || { amount: 0, qty: 0 }; return { key: k, label: DOW[k], value: v.qty, title: DOW[k], rows: [['Qty', dec1(v.qty)], ['Sales', money(v.amount)]] }; }),
    };
  }, [model, invs, filters, basis, id]);

  const name = model.products.get(id)?.name ?? `Item ${id}`;
  const long = d.days.length > 190;
  return (
    <>
      <div className="drawer-back" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={name}>
        <div className="drawer-head">
          <div>
            <h2 style={{ fontSize: 18 }}>{name}</h2>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>{longDate(filters.from)} – {longDate(filters.to)} · item #{id}</p>
          </div>
          <button className="btn icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="kpis" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
          <div className="card kpi"><div className="label">{basis === 'net' ? 'Net' : 'Gross'} sales</div><div className="value">{money(d.amount)}</div><div className="sub">{pct(d.share)} of all sales</div></div>
          <div className="card kpi"><div className="label">Quantity</div><div className="value">{dec1(d.qty)}</div><div className="sub">{int(d.orders)} order lines · avg {money2(d.qty ? d.amount / d.qty : 0)}</div></div>
        </div>
        <div className="stack">
          <div className="card"><div className="card-head"><h2>Monthly sales (all data)</h2></div><BarLineChart data={d.months} height={200} /></div>
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
