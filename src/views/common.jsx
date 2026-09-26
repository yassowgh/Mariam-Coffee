import { dec1, int, money, money2, pct, signedPct } from '../format.js';

// Columns shared by the month / day / hour tables.
export function salesColumns(basis) {
  const amtLabel = basis === 'net' ? 'Sales (after discount)' : 'Sales (before discount)';
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
  ];
}

export function ChangeCell({ v }) {
  if (v == null || !Number.isFinite(v)) return <span className="faint">–</span>;
  return <span className={v > 0 ? 'up' : v < 0 ? 'down' : 'faint'}>{v > 0 ? '▲' : v < 0 ? '▼' : ''} {signedPct(v)}</span>;
}

export const amountFilter = (basis) => ({ orders: 'orders', amount: 'amount', amountLabel: basis === 'net' ? 'Sales (after discount)' : 'Sales (before discount)' });
export const amountLabel = (basis) => (basis === 'net' ? 'Sales (after discount)' : 'Sales (before discount)');
export { money };
