import { dec1, int, money, money2, pct, signedPct } from '../format.js';

/** Labels for the amount basis: 'net' | 'gross' | 'profit'. */
export const amountLabel = (basis) => (basis === 'profit' ? 'Gross profit' : basis === 'net' ? 'Sales (after discount)' : 'Sales (before discount)');
export const basisWord = (basis) => (basis === 'profit' ? 'gross-profit' : basis === 'net' ? 'after-discount' : 'before-discount');
export const marginFmt = (v) => (v == null ? '–' : pct(v));

// Columns shared by the month / day / hour tables.
export function salesColumns(basis, hasCosts) {
  const amtLabel = amountLabel(basis);
  return [
    { key: 'orders', label: 'Orders', align: 'r', fmt: int, total: 'sum' },
    { key: 'qty', label: 'Items', align: 'r', fmt: int, total: 'sum', title: 'Number of items sold' },
    { key: 'gross', label: 'Gross', align: 'r', fmt: money, total: 'sum', csv: (r) => r.gross.toFixed(2), title: 'Before invoice discounts' },
    { key: 'disc', label: 'Discounts', align: 'r', fmt: money, total: 'sum', csv: (r) => r.disc.toFixed(2) },
    { key: 'net', label: 'Net', align: 'r', fmt: money, total: 'sum', csv: (r) => r.net.toFixed(2), title: 'After invoice discounts' },
    {
      key: 'avgTicket', label: 'Avg ticket', align: 'r', fmt: money2, csv: (r) => r.avgTicket.toFixed(2),
      title: `${amtLabel} ÷ orders`,
      total: (rows) => { const o = rows.reduce((s, r) => s + r.orders, 0); return o ? rows.reduce((s, r) => s + r.amount, 0) / o : 0; },
    },
    { key: 'itemsPerOrder', label: 'Items/order', align: 'r', fmt: dec1, csv: (r) => r.itemsPerOrder.toFixed(2) },
    { key: 'discPct', label: 'Disc %', align: 'r', fmt: (v) => pct(v), csv: (r) => (r.discPct * 100).toFixed(2) },
    { key: 'card', label: 'Card', align: 'r', fmt: money, total: 'sum', csv: (r) => r.card.toFixed(2) },
    { key: 'cash', label: 'Cash', align: 'r', fmt: money, total: 'sum', csv: (r) => r.cash.toFixed(2) },
    { key: 'account', label: 'On account', align: 'r', fmt: money, total: 'sum', csv: (r) => r.account.toFixed(2) },
    ...(hasCosts ? profitColumns() : []),
  ];
}

// Cost / profit columns for grouped rows (month, day, hour). Margin uses only sales with a known cost.
export function profitColumns() {
  return [
    { key: 'cogs', label: 'COGS', align: 'r', fmt: money, total: 'sum', csv: (r) => r.cogs.toFixed(2), title: 'Cost of goods sold, for items with a known cost' },
    { key: 'profit', label: 'Gross profit', align: 'r', fmt: money, total: 'sum', csv: (r) => r.profit.toFixed(2), title: 'Sales after discount − COGS, for items with a known cost' },
    {
      key: 'margin', label: 'Margin %', align: 'r', fmt: marginFmt, csv: (r) => (r.margin == null ? '' : (r.margin * 100).toFixed(2)),
      title: 'Gross profit ÷ sales of items with a known cost',
      total: (rows) => { const c = rows.reduce((s, r) => s + r.costedNet, 0); return c ? rows.reduce((s, r) => s + r.profit, 0) / c : null; },
    },
    {
      key: 'coverage', label: 'Cost known', align: 'r', fmt: (v) => pct(v, 0), csv: (r) => (r.coverage * 100).toFixed(2),
      title: 'Share of sales whose cost is known',
      total: (rows) => { const n = rows.reduce((s, r) => s + r.net, 0); return n ? rows.reduce((s, r) => s + r.costedNet, 0) / n : 0; },
    },
  ];
}

export function ChangeCell({ v }) {
  if (v == null || !Number.isFinite(v)) return <span className="faint">–</span>;
  return <span className={v > 0 ? 'up' : v < 0 ? 'down' : 'faint'}>{v > 0 ? '▲' : v < 0 ? '▼' : ''} {signedPct(v)}</span>;
}

export const amountFilter = (basis) => ({ orders: 'orders', amount: 'amount', amountLabel: amountLabel(basis) });
export { money };

export const PAY_SERIES = [
  { key: 'card', label: 'Credit card', color: 'var(--series-1)' },
  { key: 'cash', label: 'Cash', color: 'var(--series-2)' },
  { key: 'account', label: 'On account', color: 'var(--series-3)' },
];
// split the bar amount by how it was paid (payments are after discount; scaled to the chosen basis)
export function payParts(r) {
  if (!r || !r.net) return { card: 0, cash: 0, account: 0 };
  const f = r.amount / r.net;
  return { card: Math.max(0, r.card * f), cash: Math.max(0, r.cash * f), account: Math.max(0, r.account * f) };
}
export function payRows(pp, total) {
  return PAY_SERIES.filter((sr) => pp[sr.key] > 0.5).map((sr) => [sr.label, `${money(pp[sr.key])} · ${pct(total ? pp[sr.key] / total : 0, 0)}`, sr.color]);
}
