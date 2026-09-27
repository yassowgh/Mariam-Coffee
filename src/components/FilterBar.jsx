import { useMemo } from 'react';
import { MIN_ORDERS_FOR_OPTION, addDays, discountRates } from '../lib/aggregate.js';

export function presetRange(key, maxDate, minDate) {
  const m = maxDate.slice(0, 7);
  switch (key) {
    case '7': return [addDays(maxDate, -6), maxDate];
    case '30': return [addDays(maxDate, -29), maxDate];
    case '90': return [addDays(maxDate, -89), maxDate];
    case 'mtd': return [m + '-01', maxDate];
    case 'lm': {
      const first = addDays(m + '-01', -1).slice(0, 7) + '-01';
      return [first, addDays(m + '-01', -1)];
    }
    case 'ytd': return [maxDate.slice(0, 4) + '-01-01', maxDate];
    case '365': return [addDays(maxDate, -364), maxDate];
    case 'all': return [minDate, maxDate];
    default: return null;
  }
}

const PRESETS = [
  ['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['mtd', 'This month'],
  ['lm', 'Last month'], ['ytd', 'This year'], ['365', '12 months'], ['all', 'All'],
];

export default function FilterBar({ model, filters, onChange }) {
  const rates = useMemo(() => discountRates(model.allInvoices || model.invoices), [model.allInvoices, model.invoices]);
  const main = rates.filter((r) => r.orders >= MIN_ORDERS_FOR_OPTION);
  const otherOrders = rates.filter((r) => r.orders < MIN_ORDERS_FOR_OPTION).reduce((s2, r) => s2 + r.orders, 0);
  const set = (patch) => onChange({ ...filters, ...patch });
  const clamp = (d) => (d < model.minDate ? model.minDate : d > model.maxDate ? model.maxDate : d);
  return (
    <section className="filterbar" aria-label="Filters">
      <div className="field" style={{ flexBasis: '100%' }}>
        <span>Period</span>
        <div className="chips">
          {PRESETS.map(([k, label]) => (
            <button key={k} className="chip" aria-pressed={filters.preset === k}
              onClick={() => { const [from, to] = presetRange(k, model.maxDate, model.minDate); set({ from: clamp(from), to, preset: k }); }}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span>Start date</span>
        <input type="date" value={filters.from} min={model.minDate} max={filters.to}
          onChange={(e) => e.target.value && set({ from: e.target.value, preset: '' })} />
      </label>
      <label className="field">
        <span>End date</span>
        <input type="date" value={filters.to} min={filters.from} max={model.maxDate}
          onChange={(e) => e.target.value && set({ to: e.target.value, preset: '' })} />
      </label>
      <div className="field">
        <span>On-account invoices <span className="faint">(YemekSepeti, staff, loyalty…)</span></span>
        <div className="seg" role="group" aria-label="On-account invoices">
          <button aria-pressed={filters.channel === 'all'} onClick={() => set({ channel: 'all' })} title="Cash-register sales plus on-account invoices">Include</button>
          <button aria-pressed={filters.channel === 'POS'} onClick={() => set({ channel: 'POS' })} title="Cash-register sales only">Exclude</button>
          <button aria-pressed={filters.channel === 'Account'} onClick={() => set({ channel: 'Account' })} title="Show on-account invoices only">Only these</button>
        </div>
      </div>
      {model.hasAcc && model.hasPos && (
        <div className="field">
          <span>Data source</span>
          <div className="seg" role="group" aria-label="Data source">
            <button aria-pressed={filters.source === 'acc'} onClick={() => set({ source: 'acc' })}
              title="Accounting books (Invoices.DB). Most complete. Cash-register history fills dates before the books start.">Accounting</button>
            <button aria-pressed={filters.source === 'pos'} onClick={() => set({ source: 'pos' })}
              title="Cash-register history only (CROldInvoices.DB), as the POS reports show it">Cash register</button>
          </div>
        </div>
      )}
      <div className="field">
        <span>Day ends at</span>
        <div className="seg" role="group" aria-label="Day ends at">
          <button aria-pressed={filters.day === 'business'} onClick={() => set({ day: 'business' })}
            title="Sales after midnight (until 05:00) count toward the previous working day">Closing</button>
          <button aria-pressed={filters.day === 'calendar'} onClick={() => set({ day: 'calendar' })}
            title="Each day runs midnight to midnight">Midnight</button>
        </div>
      </div>
      <label className="field">
        <span>Discount</span>
        <select id="promo-filter" value={filters.promo || 'all'} onChange={(e) => set({ promo: e.target.value })}>
          <option value="all">All orders</option>
          <option value="disc">Discounted orders only</option>
          <option value="full">Full-price orders only</option>
          <optgroup label="By discount type">
            {main.map((r) => (
              <option key={r.kind} value={r.kind}>{r.label} · {r.orders.toLocaleString()} orders</option>
            ))}
            {otherOrders > 0 && <option value="other">Other rates · {otherOrders.toLocaleString()} orders</option>}
          </optgroup>
        </select>
      </label>
      <div className="field">
        <span>Sales amounts</span>
        <div className="seg" role="group" aria-label="Sales amounts">
          <button aria-pressed={filters.basis === 'net'} onClick={() => set({ basis: 'net' })} title="Net: the money actually charged, after invoice discounts">After discount</button>
          <button aria-pressed={filters.basis === 'gross'} onClick={() => set({ basis: 'gross' })} title="Gross: menu price × quantity, before invoice discounts (same as your Excel report)">Before discount</button>
        </div>
      </div>
    </section>
  );
}
