// Figures and the written explanation for the financial statement (sales app) and Finance (staff app).
import { FIXED, GROUP, GROUPS, costsByMonth, exVat, VAT_RATE } from './finGroups.js';

const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
// amounts are wrapped in left-to-right isolates so they read correctly inside Arabic text
const iso = (x) => '\u2066' + x + '\u2069';
export const tl = (v) => (v == null || !Number.isFinite(v) ? '–' : iso((v < 0 ? '−' : '') + nf.format(Math.abs(Math.round(v))) + ' TL'));
export const pc = (v) => (v == null || !Number.isFinite(v) ? '–' : iso((v * 100).toFixed(1) + '%'));

const mf = { en: new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }), ar: new Intl.DateTimeFormat('ar-u-nu-latn', { month: 'long', year: 'numeric', timeZone: 'UTC' }) };
const ms = { en: new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }), ar: new Intl.DateTimeFormat('ar-u-nu-latn', { month: 'short', timeZone: 'UTC' }) };
const df = { en: new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }), ar: new Intl.DateTimeFormat('ar-u-nu-latn', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) };
export const monthName = (m, lang) => mf[lang].format(new Date(m + '-01T00:00:00Z'));
export const monthShort = (m, lang) => ms[lang].format(new Date(m + '-01T00:00:00Z')) + ' ' + m.slice(2, 4);
export const dayName = (d, lang) => df[lang].format(new Date(d + 'T00:00:00Z'));
export const daysIn = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };

/**
 * sales: { [month]: { sales (incl. VAT, after discount), orders, days } }
 * records: accounting records; months: ['2026-06', …]; lastSalesDate: last day with sales data
 */
export function buildFigures({ sales, records, months, lastSalesDate }) {
  const costs = costsByMonth(records, months);
  const rows = months.map((m) => {
    const s = sales[m] || { sales: 0, orders: 0, days: 0 };
    const c = costs[m];
    const salesEx = exVat(s.sales);
    const opProfit = salesEx - c.operatingTotal;
    const net = opProfit - c.groups.oneoff;
    const partial = lastSalesDate && lastSalesDate.slice(0, 7) === m && Number(lastSalesDate.slice(8, 10)) < daysIn(m);
    return { m, ...s, vat: s.sales - salesEx, salesEx, costs: c, opProfit, net, partial, avgDay: s.days ? s.sales / s.days : 0 };
  });
  const sum = (f) => rows.reduce((t, r) => t + f(r), 0);
  const tot = {
    sales: sum((r) => r.sales), salesEx: sum((r) => r.salesEx), vat: sum((r) => r.vat), orders: sum((r) => r.orders), days: sum((r) => r.days),
    operating: sum((r) => r.costs.operatingTotal), costs: sum((r) => r.costs.total), opProfit: sum((r) => r.opProfit), net: sum((r) => r.net),
    groups: Object.fromEntries(GROUPS.map((g) => [g.key, sum((r) => r.costs.groups[g.key])])),
    fixed: Object.fromEntries(FIXED.map((f) => [f.key, sum((r) => r.costs.fixed[f.key])])),
    cats: {}, notCost: sum((r) => r.costs.notCost),
  };
  for (const r of rows) for (const [k, v] of Object.entries(r.costs.cats)) tot.cats[k] = (tot.cats[k] || 0) + v;
  // break-even: sales needed per day to cover all running costs, at this period's raw-material ratio
  const rawRatio = tot.salesEx ? tot.groups.raw / tot.salesEx : 0;
  const nonRaw = tot.operating - tot.groups.raw;
  const fullMonths = rows.filter((r) => r.days > 0).length || 1;
  const calDays = rows.reduce((t, r) => t + (r.partial ? Number(lastSalesDate.slice(8, 10)) : daysIn(r.m)), 0) || 1;
  tot.breakEvenDay = rawRatio < 1 ? (nonRaw / (1 - rawRatio)) * (1 + VAT_RATE) / calDays : null;
  tot.avgDay = tot.days ? tot.sales / tot.days : 0;
  tot.months = fullMonths;
  return { rows, tot };
}

/** Plain-language explanation (array of paragraphs / bullet lists). */
export function explain({ rows, tot }, lang, extra = {}) {
  const ar = lang === 'ar';
  const withSales = rows.filter((r) => r.sales > 0);
  const out = [];
  const name = (m) => monthName(m, lang);
  if (!rows.length) return out;
  const groupsSorted = GROUPS.filter((g) => g.key !== 'oneoff').map((g) => [g, tot.groups[g.key]]).sort((a, b) => b[1] - a[1]);
  const fixedTot = tot.groups.fixed;
  const fixedParts = FIXED.map((f) => [f, tot.fixed[f.key]]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const cats = Object.entries(tot.cats).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const loss = rows.filter((r) => r.net < 0), profit = rows.filter((r) => r.net >= 0);

  if (withSales.length) {
    const best = withSales.reduce((a, b) => (b.sales > a.sales ? b : a));
    const worst = withSales.reduce((a, b) => (b.sales < a.sales ? b : a));
    out.push(ar
      ? `بلغت المبيعات ${tl(tot.sales)} شاملة ضريبة القيمة المضافة (${tl(tot.salesEx)} بدون الضريبة) من ${tot.orders.toLocaleString('en-US')} طلباً، بمتوسط ${tl(tot.avgDay)} في اليوم. أفضل شهر ${name(best.m)} (${tl(best.sales)})، وأضعف شهر ${name(worst.m)} (${tl(worst.sales)}).`
      : `Sales were ${tl(tot.sales)} including VAT (${tl(tot.salesEx)} without VAT) from ${tot.orders.toLocaleString('en-US')} orders, on average ${tl(tot.avgDay)} a day. The best month was ${name(best.m)} (${tl(best.sales)}), the weakest ${name(worst.m)} (${tl(worst.sales)}).`);
  } else {
    out.push(ar ? 'لا توجد بيانات مبيعات لهذه الأشهر.' : 'There are no sales figures for these months.');
  }
  out.push(ar
    ? `المصاريف التشغيلية ${tl(tot.operating)}${tot.salesEx ? ` أي ${pc(tot.operating / tot.salesEx)} من المبيعات بدون الضريبة` : ''}. أكبرها: ${groupsSorted.slice(0, 3).map(([g, v]) => `${g.ar} ${tl(v)}`).join('، ')}.`
    : `Running costs were ${tl(tot.operating)}${tot.salesEx ? `, ${pc(tot.operating / tot.salesEx)} of sales without VAT` : ''}. The largest: ${groupsSorted.slice(0, 3).map(([g, v]) => `${g.en.toLowerCase()} ${tl(v)}`).join(', ')}.`);
  if (fixedTot > 0) out.push(ar
    ? `المصاريف الثابتة ${tl(fixedTot)} (${tl(fixedTot / rows.length)} في الشهر في المتوسط): ${fixedParts.map(([f, v]) => `${f.ar} ${tl(v)}`).join('، ')}.`
    : `Fixed costs were ${tl(fixedTot)} (${tl(fixedTot / rows.length)} a month on average): ${fixedParts.map(([f, v]) => `${f.en.toLowerCase()} ${tl(v)}`).join(', ')}.`);
  out.push(ar
    ? `${tot.opProfit >= 0 ? 'الربح التشغيلي' : 'الخسارة التشغيلية'} ${tl(Math.abs(tot.opProfit))}${tot.groups.oneoff ? `، وبعد مصاريف التأسيس (${tl(tot.groups.oneoff)}) صافي ${tot.net >= 0 ? 'الربح' : 'الخسارة'} ${tl(Math.abs(tot.net))}` : ''}. ${profit.length ? `أشهر بربح: ${profit.map((r) => name(r.m)).join('، ')}.` : ''} ${loss.length ? `أشهر بخسارة: ${loss.map((r) => name(r.m)).join('، ')}.` : ''}`
    : `Operating ${tot.opProfit >= 0 ? 'profit' : 'loss'}: ${tl(Math.abs(tot.opProfit))}${tot.groups.oneoff ? `; after one-off / setup costs (${tl(tot.groups.oneoff)}) the net ${tot.net >= 0 ? 'profit' : 'loss'} is ${tl(Math.abs(tot.net))}` : ''}. ${profit.length ? `Months with a profit: ${profit.map((r) => name(r.m)).join(', ')}.` : ''} ${loss.length ? `Months with a loss: ${loss.map((r) => name(r.m)).join(', ')}.` : ''}`);
  if (tot.breakEvenDay) out.push(ar
    ? `لتغطية كل المصاريف التشغيلية تحتاج مبيعات بحوالي ${tl(tot.breakEvenDay)} في اليوم (شاملة الضريبة)، والمتوسط الحالي ${tl(tot.avgDay)} في اليوم.`
    : `To cover all running costs the café needs about ${tl(tot.breakEvenDay)} of sales a day (incl. VAT); it now makes ${tl(tot.avgDay)} a day on average.`);
  if (cats.length) out.push({ list: cats.map(([c, v]) => `${c}: ${tl(v)}${tot.operating ? ` (${pc(v / (tot.costs || 1))})` : ''}`), title: ar ? 'أكبر بنود المصاريف:' : 'Largest expense categories:' });
  if (extra.notes?.length) out.push({ list: extra.notes, title: ar ? 'ملاحظات على البيانات:' : 'Notes on the data:' });
  return out;
}

/** Compact JSON for the AI questions. */
export function aiContext({ rows, tot }, extra = {}) {
  const r0 = (v) => Math.round(v);
  return {
    currency: 'TL', vatRate: VAT_RATE,
    months: rows.map((r) => ({
      month: r.m, partialMonth: !!r.partial, salesInclVat: r0(r.sales), salesExVat: r0(r.salesEx), orders: r.orders, daysWithSales: r.days,
      costs: Object.fromEntries(GROUPS.map((g) => [g.key, r0(r.costs.groups[g.key])])),
      fixedCosts: Object.fromEntries(FIXED.map((f) => [f.key, r0(r.costs.fixed[f.key])])),
      byCategory: Object.fromEntries(Object.entries(r.costs.cats).map(([k, v]) => [k, r0(v)])),
      operatingProfit: r0(r.opProfit), netProfitAfterOneOff: r0(r.net), loanRepaymentsNotCounted: r0(r.costs.notCost),
    })),
    totals: { salesInclVat: r0(tot.sales), salesExVat: r0(tot.salesEx), operatingCosts: r0(tot.operating), oneOff: r0(tot.groups.oneoff), operatingProfit: r0(tot.opProfit), netProfit: r0(tot.net), breakEvenSalesPerDayInclVat: tot.breakEvenDay ? r0(tot.breakEvenDay) : null },
    groups: Object.fromEntries(GROUPS.map((g) => [g.key, g.en])),
    ...extra,
  };
}

export const GROUP_NOTES = 'Sales = till sales after discounts, including 10% VAT; profit uses sales without VAT. Expenses = Accounting records counted on their date (paid date, or the date set for planned bills); loan repayments are not costs. Groups: fixed = rent, salaries, electricity, water, gas, internet, other bills, recurring services; raw materials = bar materials, breakfast materials, sweets, packaging; purchases = bar/kitchen tools and cleaning materials; operating = everything else (team food, transport, fuel, repairs, marketing, taxes & finance, ...); one-off / setup = legal fees, renovation and the new POS machine, shown below the operating profit.';
export { GROUP };
