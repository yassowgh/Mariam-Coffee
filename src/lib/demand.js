// Sales pattern for the automatic schedule: average orders (and sales) per weekday and hour
// over the last few weeks of data. Saved on the server so the admin can use it
// without opening the sales data.
import { addDays } from './aggregate.js';

export const DEMAND_WEEKS = 8;

export function computeDemand(model, weeks = DEMAND_WEEKS) {
  const v = model.view(model.hasAcc ? 'acc' : 'pos', 'business');
  const to = v.maxDate;
  const from = addDays(to, -(weeks * 7 - 1));
  const days = Array.from({ length: 7 }, (_, dow) => ({ dow, n: 0, orders: 0, sales: 0, hours: Array.from({ length: 24 }, (_, h) => ({ h, orders: 0, sales: 0 })) }));
  for (let d = from; d <= to; d = addDays(d, 1)) days[new Date(d + 'T00:00:00Z').getUTCDay()].n++;
  for (const i of v.invoices) {
    if (i.date < from || i.date > to || i.sign <= 0) continue;
    const day = days[i.dow];
    day.orders++; day.sales += i.net;
    day.hours[i.hour].orders++; day.hours[i.hour].sales += i.net;
  }
  for (const day of days) {
    const n = Math.max(1, day.n);
    day.orders /= n; day.sales /= n;
    for (const h of day.hours) { h.orders = +(h.orders / n).toFixed(2); h.sales = Math.round(h.sales / n); }
    day.orders = +day.orders.toFixed(1); day.sales = Math.round(day.sales);
  }
  return { from, to, weeks, days };
}

/** Save the pattern (owner signed in, or with the upload password). Errors are ignored. */
export async function saveDemand(model, password) {
  try {
    const demand = computeDemand(model);
    await fetch('/api/demand', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...(password ? { 'x-upload-password': password } : {}) },
      body: JSON.stringify(demand),
    });
  } catch { /* not important enough to bother the user */ }
}
