import { useMemo } from 'react';
import { DOW } from '../lib/aggregate.js';
import DataTable from '../components/DataTable.jsx';
import { dec1, longDate, money2, timeLabel } from '../format.js';

export default function Orders({ ctx }) {
  const { invs, basis } = ctx;
  const rows = useMemo(() => invs.map((i) => ({
    key: i.key, date: i.date, minute: i.minute, dow: i.dow, receipt: i.receipt, channel: i.channel,
    src: i.src === 'ACC' ? 'Accounting' : 'POS history', dealer: i.dealer, qty: i.qty, gross: i.gross, disc: i.disc, net: i.net,
    amount: basis === 'net' ? i.net : i.gross, card: i.card, cash: i.cash, account: i.account, type: i.sign > 0 ? 'Sale' : 'Return',
    one: 1,
  })), [invs, basis]);
  const columns = [
    { key: 'date', label: 'Business day', fmt: (v, r) => `${DOW[r.dow]} ${longDate(v)}`, sortValue: (r) => r.date + String(r.minute).padStart(5, '0'), csv: (r) => r.date },
    { key: 'minute', label: 'Time', fmt: timeLabel, csv: (r) => timeLabel(r.minute) },
    { key: 'receipt', label: 'Receipt', align: 'r' },
    { key: 'type', label: 'Type', render: (r) => (r.type === 'Return' ? <span className="pill bad">Return</span> : 'Sale') },
    { key: 'channel', label: 'Channel', fmt: (v) => (v === 'POS' ? 'POS' : 'On account') },
    { key: 'dealer', label: 'Customer / note', name: true },
    { key: 'qty', label: 'Items', align: 'r', fmt: dec1, total: 'sum' },
    { key: 'gross', label: 'Gross', align: 'r', fmt: money2, total: 'sum' },
    { key: 'disc', label: 'Discount', align: 'r', fmt: money2, total: 'sum' },
    { key: 'net', label: 'Net', align: 'r', fmt: money2, total: 'sum' },
    { key: 'card', label: 'Card', align: 'r', fmt: money2, total: 'sum' },
    { key: 'cash', label: 'Cash', align: 'r', fmt: money2, total: 'sum' },
    { key: 'account', label: 'On account', align: 'r', fmt: money2, total: 'sum' },
    { key: 'src', label: 'Source' },
  ];
  return (
    <div className="card">
      <div className="card-head"><div><h2>Orders</h2><p>Every invoice in the selected period. Filter by items per order or order value to find large or unusual tickets.</p></div></div>
      <DataTable columns={columns} rows={rows} defaultSort={{ key: 'date', dir: 'desc' }}
        filters={{ search: 'dealer', orders: 'qty', ordersLabel: 'Items', amount: 'amount', amountLabel: basis === 'net' ? 'Net value' : 'Gross value' }}
        exportName="orders" />
    </div>
  );
}
