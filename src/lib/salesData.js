// The till sales saved on the server, read once per page load and shared by the Finance reports.
import { loadSaved } from './remote.js';
import { collectTables } from './archive.js';
import { buildModel } from './model.js';
import { saveBestSellers, saveDemand } from './demand.js';

let cache = null;

/** { invoices, allInvoices, minDate, maxDate, meta } or null when no sales data is saved. */
export function loadSalesModel(progress = () => {}) {
  if (!cache) {
    cache = (async () => {
      const got = await loadSaved((msg, f) => progress(msg, f * 0.3));
      if (!got.file) return null;
      const entries = await collectTables([got.file], () => {});
      const m = await buildModel(entries, (msg, f) => progress(msg, 0.3 + f * 0.7));
      const v = m.view(m.hasAcc ? 'acc' : 'pos', 'business');
      saveDemand(m); // keeps the monthly sales used elsewhere in Finance up to date
      saveBestSellers(m); // best-seller badges on the website menu
      return { invoices: v.invoices, allInvoices: v.invoices, minDate: v.minDate, maxDate: v.maxDate, meta: got.meta };
    })().catch((e) => { cache = null; throw e; });
  }
  return cache;
}

/** { [month]: { sales, orders, days } } and per-day totals, from the till invoices. */
export function salesByMonth(invoices, months) {
  const want = months ? new Set(months) : null;
  const sales = {}, daily = new Map();
  for (const i of invoices) {
    if (want && !want.has(i.month)) continue;
    const s = sales[i.month] || (sales[i.month] = { sales: 0, orders: 0, days: 0, set: new Set() });
    s.sales += i.net; if (i.sign > 0) s.orders++; s.set.add(i.date);
    const d = daily.get(i.date) || { date: i.date, sales: 0, orders: 0 };
    d.sales += i.net; if (i.sign > 0) d.orders++;
    daily.set(i.date, d);
  }
  for (const s of Object.values(sales)) { s.days = s.set.size; delete s.set; }
  return { sales, daily };
}
