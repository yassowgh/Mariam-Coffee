import { addDays } from '../lib/aggregate.js';

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
      <label className="field">
        <span>Sales channel</span>
        <select value={filters.channel} onChange={(e) => set({ channel: e.target.value })}>
          <option value="all">All sales</option>
          <option value="POS">Cash register (POS)</option>
          <option value="Account">On-account invoices</option>
        </select>
      </label>
      <div className="field">
        <span>Amounts</span>
        <div className="seg" role="group" aria-label="Amount basis">
          <button aria-pressed={filters.basis === 'net'} onClick={() => set({ basis: 'net' })} title="After invoice discounts: the money actually charged">Net</button>
          <button aria-pressed={filters.basis === 'gross'} onClick={() => set({ basis: 'gross' })} title="Menu price before invoice discounts">Gross</button>
        </div>
      </div>
    </section>
  );
}
