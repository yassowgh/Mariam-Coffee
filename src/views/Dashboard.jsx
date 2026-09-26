import { useMemo } from 'react';
import {
  DOW, addDays, dailyRows, filterInvoices, heatmap, hourOrder, hourlyRows, monthProjection,
  monthlyRows, productRows, summarize, weekdayRows, DAY_START_HOUR,
} from '../lib/aggregate.js';
import { BarLineChart, Heatmap } from '../components/charts.jsx';
import {
  compact, dec1, hourRange, timeLabel, int, longDate, money, money2, monthLabel, pct, shortDate, signedMoney, signedPct,
} from '../format.js';

function Delta({ v, invert }) {
  if (v == null || !Number.isFinite(v)) return <span className="delta faint">–</span>;
  const good = invert ? v < 0 : v > 0;
  return <span className={'delta ' + (v === 0 ? 'faint' : good ? 'up' : 'down')}>{v > 0 ? '▲' : v < 0 ? '▼' : ''} {signedPct(v)}</span>;
}
const change = (a, b) => (b ? (a - b) / b : null);

function Kpi({ label, value, delta, sub, invert }) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className="sub">{delta !== undefined && <Delta v={delta} invert={invert} />} {sub}</div>
    </div>
  );
}

export default function Dashboard({ ctx }) {
  const { model, filters, basis, invs, prevInvs, prevFrom, prevTo, openProduct } = ctx;
  const L = model.maxDate;
  const ch = filters.channel;

  const d = useMemo(() => {
    const last7 = summarize(filterInvoices(model, { from: addDays(L, -6), to: L, channel: ch }), basis);
    const prev7 = summarize(filterInvoices(model, { from: addDays(L, -13), to: addDays(L, -7), channel: ch }), basis);
    const lastDay = summarize(filterInvoices(model, { from: L, to: L, channel: ch }), basis);
    const lastWeekSameDay = summarize(filterInvoices(model, { from: addDays(L, -7), to: addDays(L, -7), channel: ch }), basis);
    const proj = monthProjection(model, L, basis, ch);
    const lmFirst = addDays(L.slice(0, 7) + '-01', -1).slice(0, 7);
    const lastMonth = summarize(model.invoices.filter((i) => i.month === lmFirst && (ch === 'all' || i.channel === ch)), basis);

    const cur = summarize(invs, basis);
    const prev = summarize(prevInvs, basis);

    // trend: daily (or weekly for long ranges) with 7-day moving average
    const len = ctx.len;
    const withLead = filterInvoices(model, { from: addDays(filters.from, -6), to: filters.to, channel: ch });
    const daily = new Map(dailyRows(withLead, basis).map((r) => [r.key, r]));
    const trend = [];
    if (len <= 190) {
      const vals = [];
      for (let day = addDays(filters.from, -6); day <= filters.to; day = addDays(day, 1)) {
        const r = daily.get(day);
        vals.push(r ? r.amount : 0);
        if (day < filters.from) continue;
        const win = vals.slice(-7);
        const ma = win.reduce((s, v) => s + v, 0) / win.length;
        trend.push({
          key: day, label: shortDate(day), value: r ? r.amount : 0, line: ma,
          title: `${DOW[new Date(day + 'T00:00:00Z').getUTCDay()]} ${longDate(day)}`,
          rows: [['Sales', money(r ? r.amount : 0)], ['Orders', int(r ? r.orders : 0)], ['Avg ticket', money2(r ? r.avgTicket : 0)], ['7-day avg', money(ma)]],
        });
      }
    } else {
      const weeks = new Map();
      for (const r of daily.values()) {
        if (r.key < filters.from) continue;
        const dow = (new Date(r.key + 'T00:00:00Z').getUTCDay() + 6) % 7;
        const wk = addDays(r.key, -dow);
        const w = weeks.get(wk) || { amount: 0, orders: 0, days: 0 };
        w.amount += r.amount; w.orders += r.orders; w.days++;
        weeks.set(wk, w);
      }
      for (const [wk, w] of [...weeks].sort()) {
        trend.push({ key: wk, label: shortDate(wk), value: w.amount, title: `Week of ${longDate(wk)}`,
          rows: [['Sales', money(w.amount)], ['Orders', int(w.orders)], ['Trading days', w.days]] });
      }
    }

    const products = productRows(model, invs, prevInvs, basis).filter((p) => !p.unallocated);
    const movers = products.filter((p) => p.prevAmount > 0 || p.amount > 0);
    const rising = [...movers].filter((p) => p.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 8);
    const falling = [...movers].filter((p) => p.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 8);
    const top = products.filter((p) => p.amount > 0).slice(0, 10);

    // pareto
    let acc = 0, pareto = 0;
    const sold = products.filter((p) => p.amount > 0);
    const tot = sold.reduce((s, p) => s + p.amount, 0);
    for (const p of sold) { acc += p.amount; pareto++; if (acc >= tot * 0.8) break; }
    const dormant = products.filter((p) => p.amount === 0 && p.prevAmount > 0).sort((a, b) => b.prevAmount - a.prevAmount);

    const hours = hourlyRows(invs, basis);
    const wd = weekdayRows(invs, basis);
    const heat = heatmap(invs, basis);
    const dayRows = dailyRows(invs, basis);
    const months = monthlyRows(model.invoices.filter((i) => ch === 'all' || i.channel === ch), basis).slice(-13);

    // is the latest day complete? compare its last order with the usual closing time
    const bizMin = (i) => ((i.minute - DAY_START_HOUR * 60 + 1440) % 1440);
    const lastByDay = new Map();
    for (const i of model.invoices) {
      if (i.date >= addDays(L, -28)) lastByDay.set(i.date, Math.max(lastByDay.get(i.date) ?? 0, bizMin(i)));
    }
    const closes = [...lastByDay].filter(([k]) => k !== L).map(([, v]) => v).sort((a, b) => a - b);
    const usualClose = closes.length ? closes[Math.floor(closes.length / 2)] : null;
    const lastOrder = lastByDay.get(L);
    const partial = usualClose != null && lastOrder != null && lastOrder < usualClose - 60;
    const toClock = (m) => timeLabel((m + DAY_START_HOUR * 60) % 1440);

    return { partial, lastOrderClock: lastOrder != null ? toClock(lastOrder) : null, usualCloseClock: usualClose != null ? toClock(usualClose) : null, last7, prev7, lastDay, lastWeekSameDay, proj, lastMonth, cur, prev, trend, rising, falling, top, pareto, soldCount: sold.length, dormant, hours, wd, heat, dayRows, months };
  }, [model, invs, prevInvs, basis, ch, L, filters.from, filters.to, ctx.len]);

  const activeHours = d.hours.filter((h) => h.orders > 0).map((h) => h.key).sort((a, b) => hourOrder(a) - hourOrder(b));
  const hoursRange = activeHours.length
    ? Array.from({ length: hourOrder(activeHours[activeHours.length - 1]) - hourOrder(activeHours[0]) + 1 }, (_, i) => (activeHours[0] + i) % 24)
    : [];
  const dowOrder = [1, 2, 3, 4, 5, 6, 0];
  const insights = buildInsights(d, ctx);
  const basisWord = basis === 'net' ? 'after-discount' : 'before-discount';

  return (
    <div className="stack">
      <section aria-label="Key indicators">
        <p className="faint" style={{ margin: '0 0 8px', fontSize: 12.5 }}>
          Headline figures up to the latest day in the data ({longDate(L)}), {basisWord} amounts.
          {d.partial && <> <span className="pill warn">⚠ {shortDate(L)} looks incomplete</span> last order at {d.lastOrderClock}, the shop usually closes around {d.usualCloseClock}. The backup was probably taken during the day.</>}
        </p>
        <div className="kpis">
          <Kpi label="Last 7 days" value={money(d.last7.amount)} delta={change(d.last7.amount, d.prev7.amount)} sub="vs previous 7 days" />
          <Kpi label="Orders · last 7 days" value={int(d.last7.orders)} delta={change(d.last7.orders, d.prev7.orders)} sub={`${dec1(d.last7.orders / 7)} per day`} />
          <Kpi label="Avg ticket · last 7 days" value={money2(d.last7.avgTicket)} delta={change(d.last7.avgTicket, d.prev7.avgTicket)} sub={`${dec1(d.last7.itemsPerOrder)} items / order`} />
          <Kpi label={`Latest day · ${DOW[new Date(L + 'T00:00:00Z').getUTCDay()]} ${shortDate(L)}`} value={money(d.lastDay.amount)} delta={change(d.lastDay.amount, d.lastWeekSameDay.amount)} sub={d.partial ? `vs same day last week · partial day (to ${d.lastOrderClock})` : 'vs same day last week'} />
          <Kpi label={`Month to date · ${monthLabel(d.proj.month)}`} value={money(d.proj.mtd)}
            sub={<>Projected <b>{compact(d.proj.projected)}</b> · last month {compact(d.lastMonth.amount)} <Delta v={change(d.proj.projected, d.lastMonth.amount)} /></>} />
          <Kpi label="Discounts · selected period" value={pct(d.cur.discPct)} delta={d.prev.discPct ? d.cur.discPct - d.prev.discPct : null} invert
            sub={`${money(d.cur.disc)} given`} />
        </div>
      </section>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>{ctx.len > 190 ? 'Weekly' : 'Daily'} sales · {longDate(filters.from)} – {longDate(filters.to)}</h2>
            <p>
              {money(d.cur.amount)} from {int(d.cur.orders)} orders · avg ticket {money2(d.cur.avgTicket)} · vs previous period ({shortDate(prevFrom)} – {shortDate(prevTo)}):{' '}
              <Delta v={change(d.cur.amount, d.prev.amount)} />
            </p>
          </div>
        </div>
        <BarLineChart data={d.trend} height={260} barLabel={ctx.len > 190 ? 'Weekly sales' : 'Daily sales'} lineLabel={ctx.len > 190 ? null : '7-day average'} />
      </div>

      <div className="grid two">
        <MoverCard title="Top increasing products" subtitle={`Change in ${basisWord} sales vs ${shortDate(prevFrom)} – ${shortDate(prevTo)}`} items={d.rising} up openProduct={openProduct} />
        <MoverCard title="Top declining products" subtitle={`Change in ${basisWord} sales vs ${shortDate(prevFrom)} – ${shortDate(prevTo)}`} items={d.falling} openProduct={openProduct} />
      </div>

      <div className="grid three">
        <div className="card">
          <div className="card-head"><div><h2>Insights for this period</h2><p>Generated from the selected dates and channel.</p></div></div>
          <ul className="insights">
            {insights.map((x, i) => (
              <li key={i}><span className="ic" aria-hidden="true">{x.icon}</span><span>{x.text}</span></li>
            ))}
          </ul>
        </div>
        <div className="card">
          <div className="card-head"><div><h2>Best-selling products</h2><p>Share of {basisWord} sales in the period</p></div></div>
          <ul className="barlist">
            {d.top.map((p) => (
              <li key={p.key}>
                <button className="name" onClick={() => openProduct(p.key)} title={p.name}>{p.rank}. {p.name}</button>
                <span className="val">{money(p.amount)} <span className="faint">{pct(p.share, 0)}</span></span>
                <div className="track"><div className="fill" style={{ width: (p.amount / d.top[0].amount) * 100 + '%' }} /></div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>When are you busy? Average sales by weekday and hour</h2>
            <p>Average {basisWord} sales per occurrence of each weekday/hour in the period. Hours after midnight count toward the previous business day.</p>
          </div>
        </div>
        <Heatmap cells={d.heat} dows={dowOrder} dowLabels={dowOrder.map((x) => DOW[x])} hours={hoursRange} fmt={money} subFmt={dec1} />
      </div>

      <div className="grid two">
        <div className="card">
          <div className="card-head"><div><h2>Average sales by weekday</h2><p>Average {basisWord} sales per trading day</p></div></div>
          <BarLineChart height={200}
            data={d.wd.map((w) => ({ key: w.key, label: w.label, value: w.avgPerDay, title: `${w.label} (${w.days} days)`,
              rows: [['Avg sales', money(w.avgPerDay)], ['Avg orders', dec1(w.avgOrders)]] }))} />
        </div>
        <div className="card">
          <div className="card-head"><div><h2>Sales by hour</h2><p>Average {basisWord} sales per day in each hour</p></div></div>
          <BarLineChart height={200}
            data={d.hours.map((h) => ({ key: h.key, label: String(h.key).padStart(2, '0'), value: h.avgPerDay, title: hourRange(h.key),
              rows: [['Avg sales/day', money(h.avgPerDay)], ['Orders/day', dec1(h.ordersPerDay)], ['Share', pct(h.share)]] }))} />
        </div>
      </div>

      <div className="grid two">
        <div className="card">
          <div className="card-head"><div><h2>Monthly trend</h2><p>Last 13 months, {basisWord} sales. The current month is partial.</p></div></div>
          <BarLineChart height={220}
            data={d.months.map((m) => ({ key: m.key, label: monthLabel(m.key).slice(0, 3) + ' ' + m.key.slice(2, 4), value: m.amount, title: monthLabel(m.key),
              rows: [['Sales', money(m.amount)], ['Orders', int(m.orders)], ['Avg per day', money(m.avgPerDay)], ['vs prev month', signedPct(m.change)]] }))} />
        </div>
        <div className="card">
          <div className="card-head"><div><h2>How customers pay</h2><p>Selected period, share of net sales</p></div></div>
          <PaymentMix s={d.cur} />
        </div>
      </div>
    </div>
  );
}

function MoverCard({ title, subtitle, items, up, openProduct }) {
  const max = Math.max(1, ...items.map((p) => Math.abs(p.delta)));
  return (
    <div className="card">
      <div className="card-head"><div><h2>{up ? '▲' : '▼'} {title}</h2><p>{subtitle}</p></div></div>
      {!items.length && <p className="muted">No products {up ? 'increased' : 'declined'} in this period.</p>}
      <ul className="barlist">
        {items.map((p) => (
          <li key={p.key}>
            <button className="name" onClick={() => openProduct(p.key)} title={p.name}>{p.name}</button>
            <span className="val">
              <span className={up ? 'up' : 'down'}>{signedMoney(p.delta)}</span>{' '}
              <span className="faint">{p.change == null ? 'new' : signedPct(p.change)}</span>
            </span>
            <div className="track"><div className="fill" style={{ width: (Math.abs(p.delta) / max) * 100 + '%', background: up ? 'var(--good)' : 'var(--bad)' }} /></div>
            <span className="faint" style={{ gridColumn: '1 / -1', fontSize: 11.5 }}>
              {money(p.prevAmount)} → {money(p.amount)} · qty {int(p.prevQty)} → {int(p.qty)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PaymentMix({ s }) {
  const total = s.net || 1;
  const rows = [
    ['Card', s.card], ['Cash', s.cash], ['On account', s.account],
  ];
  return (
    <ul className="barlist">
      {rows.map(([k, v]) => (
        <li key={k}>
          <span className="name">{k}</span>
          <span className="val">{money(v)} <span className="faint">{pct(v / total)}</span></span>
          <div className="track"><div className="fill" style={{ width: Math.max(0, (v / total) * 100) + '%' }} /></div>
        </li>
      ))}
      <li><span className="faint" style={{ gridColumn: '1 / -1', fontSize: 12 }}>
        Gross {money(s.gross)} − discounts {money(s.disc)} = net {money(s.net)}{s.returns ? ` · ${s.returns} returns included` : ''}
      </span></li>
    </ul>
  );
}

function buildInsights(d, ctx) {
  const out = [];
  const days = d.dayRows.filter((r) => r.orders > 0);
  if (days.length) {
    const best = days.reduce((a, b) => (b.amount > a.amount ? b : a));
    const worst = days.reduce((a, b) => (b.amount < a.amount ? b : a));
    out.push({ icon: '🏆', text: <>Best day: <b>{DOW[best.dow]} {longDate(best.key)}</b> with {money(best.amount)} ({int(best.orders)} orders). Weakest: {DOW[worst.dow]} {longDate(worst.key)} with {money(worst.amount)}.</> });
  }
  const hrs = d.hours.filter((h) => h.orders > 0);
  if (hrs.length) {
    const peak = hrs.reduce((a, b) => (b.amount > a.amount ? b : a));
    const top3 = [...hrs].sort((a, b) => b.amount - a.amount).slice(0, 3);
    const share3 = top3.reduce((s, h) => s + h.share, 0);
    out.push({ icon: '⏰', text: <>Peak hour is <b>{hourRange(peak.key)}</b> ({pct(peak.share)} of sales). The 3 busiest hours ({top3.map((h) => String(h.key).padStart(2, '0')).join(', ')}h) bring {pct(share3)}. Plan staff around them.</> });
    const quiet = hrs.filter((h) => h.ordersPerDay < 1 && hourOrder(h.key) > hourOrder(DAY_START_HOUR));
    if (quiet.length) out.push({ icon: '💤', text: <>Quiet hours with less than 1 order per day: {quiet.map((h) => hourRange(h.key)).join(', ')}. Consider shorter hours or a promotion.</> });
  }
  const wd = d.wd.filter((w) => w.days > 0);
  if (wd.length > 1) {
    const b = wd.reduce((a, c) => (c.avgPerDay > a.avgPerDay ? c : a));
    const w = wd.reduce((a, c) => (c.avgPerDay < a.avgPerDay ? c : a));
    out.push({ icon: '📅', text: <><b>{b.label}</b> is the strongest weekday (avg {money(b.avgPerDay)}), <b>{w.label}</b> the weakest (avg {money(w.avgPerDay)}, {pct(1 - w.avgPerDay / b.avgPerDay, 0)} lower).</> });
  }
  if (d.prev.orders) {
    const tc = (d.cur.avgTicket - d.prev.avgTicket) / (d.prev.avgTicket || 1);
    const oc = (d.cur.orders - d.prev.orders) / d.prev.orders;
    out.push({ icon: '🧾', text: <>Compared with the previous period, orders changed <b className={oc >= 0 ? 'up' : 'down'}>{signedPct(oc)}</b> and the average ticket <b className={tc >= 0 ? 'up' : 'down'}>{signedPct(tc)}</b>. {Math.abs(oc) > Math.abs(tc) ? 'Customer traffic is driving the change.' : 'Spend per order is driving the change.'}</> });
  }
  if (d.soldCount) {
    out.push({ icon: '🎯', text: <><b>{d.pareto}</b> of {d.soldCount} products ({pct(d.pareto / d.soldCount, 0)}) make 80% of sales. Keep them always in stock and consider trimming the long tail.</> });
  }
  if (d.cur.gross) {
    const diff = d.prev.gross ? d.cur.discPct - d.prev.discPct : null;
    out.push({ icon: '🏷️', text: <>Discounts were {pct(d.cur.discPct)} of gross sales ({money(d.cur.disc)}){diff != null ? <>, {diff >= 0 ? 'up' : 'down'} {Math.abs(diff * 100).toFixed(1)} pts vs the previous period</> : ''}.</> });
  }
  if (d.dormant.length) {
    out.push({ icon: '⚠️', text: <>{d.dormant.length} product{d.dormant.length > 1 ? 's' : ''} sold in the previous period but not at all in this one, e.g. {d.dormant.slice(0, 3).map((p) => `${p.name} (${money(p.prevAmount)} before)`).join(', ')}.</> });
  }
  out.push({ icon: '📈', text: <>At the current pace, {monthLabel(d.proj.month)} is projected to close at <b>{money(d.proj.projected)}</b> vs {money(d.lastMonth.amount)} last month (projection = actual so far + each remaining day at its weekday average over the last 4 weeks).</> });
  if (ctx.filters.channel === 'all' && d.cur.net) {
    out.push({ icon: '💳', text: <>{pct(d.cur.card / d.cur.net, 0)} of sales were paid by card, {pct(d.cur.cash / d.cur.net, 0)} in cash and {pct(d.cur.account / d.cur.net, 0)} on account.</> });
  }
  return out;
}
