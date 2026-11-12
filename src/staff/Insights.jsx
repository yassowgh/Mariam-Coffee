import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { money, monthLabel } from '../format.js';
import { getLang } from '../lib/i18n.js';

const pctTxt = (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;
const prevMonth = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
};
const cost = (r) => r.amount + (r.fees || 0);

/** Key takeaways for a month's spending, and 5 recommendations (rules first, AI on request). */
export default function Insights({ records, month, today }) {
  const [lang, setLang] = useState(getLang());
  useEffect(() => { const f = () => setLang(getLang()); window.addEventListener('mc-lang', f); return () => window.removeEventListener('mc-lang', f); }, []);
  const [sales, setSales] = useState(null);
  const [ai, setAi] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { api('demand').then((r) => setSales(r.demand?.salesMonths || [])).catch(() => setSales([])); }, []);
  useEffect(() => { setAi(null); setErr(''); }, [month, lang]);

  const v = useMemo(() => {
    const spend = (m) => records.filter((r) => r.date && r.date.slice(0, 7) === m && r.kind !== 'loan_repayment');
    const cur = spend(month), prev = spend(prevMonth(month));
    const sum = (l) => l.reduce((t, r) => t + cost(r), 0);
    const total = sum(cur), prevTotal = sum(prev);
    const byCat = (l) => { const m = new Map(); for (const r of l) m.set(r.category, (m.get(r.category) || 0) + cost(r)); return m; };
    const c1 = byCat(cur), c0 = byCat(prev);
    const cats = [...c1].map(([name, amt]) => ({ name, amt, prev: c0.get(name) || 0 })).sort((a, b) => b.amt - a.amt);
    const rises = cats.filter((c) => c.prev > 0 && c.amt - c.prev > 1000).map((c) => ({ ...c, diff: c.amt - c.prev, rate: (c.amt - c.prev) / c.prev })).sort((a, b) => b.diff - a.diff);
    const newCats = cats.filter((c) => !c.prev && c.amt > 2000);
    const big = [...cur].sort((a, b) => cost(b) - cost(a)).slice(0, 3);
    const payees = new Map();
    for (const r of cur) if (r.payee) { const p = payees.get(r.payee) || { name: r.payee, n: 0, amt: 0 }; p.n++; p.amt += cost(r); payees.set(r.payee, p); }
    const topPayee = [...payees.values()].sort((a, b) => b.amt - a.amt)[0];
    const frequent = [...payees.values()].filter((p) => p.n >= 8).sort((a, b) => b.n - a.n)[0];
    const fixed = cur.filter((r) => /salar|rent|kira/i.test(r.category)).reduce((t, r) => t + cost(r), 0);
    const paid = cur.filter((r) => r.status === 'paid');
    const cash = paid.filter((r) => r.account_type === 'cash').reduce((t, r) => t + cost(r), 0);
    const noAccount = paid.filter((r) => !r.account_id).length;
    const noReceipt = cur.filter((r) => !r.receipt && cost(r) >= 1000).length;
    const late = records.filter((r) => r.status === 'scheduled' && r.due_date && r.due_date < today);
    const lateTotal = sum(late);
    const open = cur.filter((r) => r.status !== 'paid');
    const s = (sales || []).find((x) => x.month === month);
    const sp = (sales || []).find((x) => x.month === prevMonth(month));
    return { cur, total, prevTotal, cats, rises, newCats, big, topPayee, frequent, fixed, cash, paidTotal: sum(paid), noAccount, noReceipt, late, lateTotal, open, openTotal: sum(open), s, sp };
  }, [records, month, today, sales]);

  if (!v.cur.length) return (
    <div className="card"><div className="card-head"><div><h2>Key takeaways · {monthLabel(month)}</h2></div></div><p className="muted" style={{ margin: 0 }}>No spending recorded for this month yet.</p></div>
  );

  // ---- takeaways (English / Arabic)
  const T = (en, ar) => (lang === 'ar' ? ar : en);
  const pc = (x) => `${Math.round(x * 100)}%`;
  const take = [];
  take.push(T(<>Spent <b>{money(v.total)}</b> in {v.cur.length} payments{v.prevTotal ? <> ({pctTxt((v.total - v.prevTotal) / v.prevTotal)} vs {monthLabel(prevMonth(month))}, {money(v.prevTotal)})</> : ''}.</>,
    <>تم صرف <b>{money(v.total)}</b> في {v.cur.length} دفعة{v.prevTotal ? <> ({pctTxt((v.total - v.prevTotal) / v.prevTotal)} مقارنة بـ {monthLabel(prevMonth(month))}، {money(v.prevTotal)})</> : ''}.</>));
  if (v.s) take.push(T(<>Sales were <b>{money(v.s.net)}</b>: spending equals <b>{pc(v.total / v.s.net)}</b> of sales{v.s.days < 28 ? ` (sales data covers ${v.s.days} days)` : ''}.</>,
    <>بلغت المبيعات <b>{money(v.s.net)}</b>، والمصاريف تعادل <b>{pc(v.total / v.s.net)}</b> منها{v.s.days < 28 ? ` (بيانات المبيعات تغطي ${v.s.days} يوماً)` : ''}.</>));
  take.push(T(<>Biggest categories: {v.cats.slice(0, 3).map((c, i) => <span key={c.name}>{i ? ', ' : ''}<b>{c.name}</b> {money(c.amt)} ({pc(c.amt / v.total)})</span>)}.</>,
    <>أكبر الفئات: {v.cats.slice(0, 3).map((c, i) => <span key={c.name}>{i ? '، ' : ''}<b>{c.name}</b> {money(c.amt)} ({pc(c.amt / v.total)})</span>)}.</>));
  if (v.rises[0]) take.push(T(<>Largest increase: <b>{v.rises[0].name}</b> up {money(v.rises[0].diff)} ({pctTxt(v.rises[0].rate)}) from last month.</>,
    <>أكبر زيادة: <b>{v.rises[0].name}</b> بمقدار {money(v.rises[0].diff)} ({pctTxt(v.rises[0].rate)}) عن الشهر الماضي.</>));
  if (v.fixed) take.push(T(<>Salaries and rent: <b>{money(v.fixed)}</b>, {pc(v.fixed / v.total)} of the month’s spending.</>,
    <>الرواتب والإيجار: <b>{money(v.fixed)}</b>، أي {pc(v.fixed / v.total)} من مصاريف الشهر.</>));
  if (v.big[0]) take.push(T(<>Largest payments: {v.big.map((r, i) => <span key={r.id}>{i ? '; ' : ''}{r.name} {money(cost(r))}</span>)}.</>,
    <>أكبر الدفعات: {v.big.map((r, i) => <span key={r.id}>{i ? '؛ ' : ''}{r.name} {money(cost(r))}</span>)}.</>));
  if (v.topPayee) take.push(T(<>Paid most to <b>{v.topPayee.name}</b>: {money(v.topPayee.amt)} in {v.topPayee.n} payments.</>,
    <>أكثر جهة تم الدفع لها: <b>{v.topPayee.name}</b>: {money(v.topPayee.amt)} في {v.topPayee.n} دفعة.</>));
  if (v.paidTotal) take.push(T(<>{pc(v.cash / v.paidTotal)} of the money paid out was cash.</>, <>{pc(v.cash / v.paidTotal)} من المبالغ المدفوعة كانت نقداً.</>));
  if (v.openTotal) take.push(T(<><b>{money(v.openTotal)}</b> of this month’s costs are not paid yet ({v.open.length} bills).</>,
    <><b>{money(v.openTotal)}</b> من تكاليف هذا الشهر لم تُدفع بعد ({v.open.length} فواتير).</>));

  // ---- 5 recommendations from rules, most important first
  const rec = [];
  if (v.late.length) rec.push(T(`Pay or reschedule the ${v.late.length} late bills (${money(v.lateTotal)}), starting with the oldest, so suppliers and staff are not kept waiting.`,
    `ادفع أو أعد جدولة ${v.late.length} فواتير متأخرة (${money(v.lateTotal)})، بدءاً بالأقدم، حتى لا ينتظر الموردون والموظفون.`));
  if (v.rises[0]) rec.push(T(`Look into ${v.rises[0].name}: it rose by ${money(v.rises[0].diff)} (${pctTxt(v.rises[0].rate)}). Compare prices or quantities with last month.`,
    `راجع ${v.rises[0].name}: ارتفعت بمقدار ${money(v.rises[0].diff)} (${pctTxt(v.rises[0].rate)}). قارن الأسعار أو الكميات مع الشهر الماضي.`));
  if (v.s && v.total / v.s.net > 0.9) rec.push(T(`Spending is ${pc(v.total / v.s.net)} of sales. Set a monthly budget for the biggest categories and check it every week.`,
    `المصاريف تعادل ${pc(v.total / v.s.net)} من المبيعات. ضع ميزانية شهرية لأكبر الفئات وراجعها كل أسبوع.`));
  if (v.frequent) rec.push(T(`${v.frequent.n} separate purchases at ${v.frequent.name} this month. Buying weekly in bulk (e.g. from a wholesaler) usually costs less and saves time.`,
    `${v.frequent.n} عملية شراء منفصلة من ${v.frequent.name} هذا الشهر. الشراء أسبوعياً بالجملة غالباً أرخص ويوفر الوقت.`));
  if (v.newCats[0]) rec.push(T(`New this month: ${v.newCats[0].name} (${money(v.newCats[0].amt)}). Check whether it was a one-off or will come back every month, and plan for it.`,
    `جديد هذا الشهر: ${v.newCats[0].name} (${money(v.newCats[0].amt)}). تحقق إن كان لمرة واحدة أم سيتكرر شهرياً، وخطط له.`));
  if (v.noReceipt > 3) rec.push(T(`${v.noReceipt} payments of 1,000 TL or more have no receipt photo. Add photos so the accountant can check them.`,
    `${v.noReceipt} دفعات بقيمة 1,000 ليرة أو أكثر بدون صورة إيصال. أضف الصور ليتمكن المحاسب من مراجعتها.`));
  if (v.noAccount > 0) rec.push(T(`${v.noAccount} paid records do not say where they were paid from. Fill it in so cash and bank balances can be checked.`,
    `${v.noAccount} سجلات مدفوعة لا تذكر مصدر الدفع. أكملها لتتمكن من مراجعة النقد وأرصدة البنوك.`));
  if (v.paidTotal && v.cash / v.paidTotal > 0.6) rec.push(T('Most payments are in cash. Paying suppliers by bank transfer leaves a clear record and makes the monthly check easier.',
    'معظم الدفعات نقدية. الدفع للموردين بالتحويل البنكي يترك سجلاً واضحاً ويسهّل المراجعة الشهرية.'));
  if (v.fixed && v.s && v.fixed / v.s.net > 0.35) rec.push(T(`Salaries and rent take ${pc(v.fixed / v.s.net)} of sales. Use the sales-per-hour report to match staff hours to busy times.`,
    `الرواتب والإيجار تستهلك ${pc(v.fixed / v.s.net)} من المبيعات. استخدم تقرير المبيعات بالساعة لمطابقة ساعات الموظفين مع أوقات الذروة.`));
  const generic = [
    T('Plan next month’s fixed bills (rent, salaries, utilities) in Finance with “Plan next month like this month”, so nothing is forgotten.', 'خطط فواتير الشهر القادم الثابتة (الإيجار، الرواتب، الخدمات) من صفحة المالية حتى لا يُنسى شيء.'),
    T('Compare the stock purchases with the cost of goods in Net profit; a big gap can mean waste or missing records.', 'قارن مشتريات المخزون مع تكلفة البضاعة في صافي الربح؛ الفرق الكبير قد يعني هدراً أو سجلات ناقصة.'),
    T('Check the top 3 suppliers’ prices every quarter and ask for a better price for regular orders.', 'راجع أسعار أكبر 3 موردين كل ثلاثة أشهر واطلب سعراً أفضل للطلبات المنتظمة.'),
    T('Record every expense on the day it happens (phone + receipt photo); late records are often forgotten.', 'سجّل كل مصروف في يومه (بالهاتف مع صورة الإيصال)؛ السجلات المتأخرة تُنسى غالباً.'),
    T('Review this page with the accountant at the start of each month.', 'راجع هذه الصفحة مع المحاسب في بداية كل شهر.'),
  ];
  for (const g of generic) if (rec.length < 5) rec.push(g);

  async function askAi(refresh) {
    setBusy(true); setErr('');
    const summary = {
      month, total: Math.round(v.total), previousMonthTotal: Math.round(v.prevTotal), sales: v.s?.net ?? null, previousMonthSales: v.sp?.net ?? null,
      categories: v.cats.slice(0, 10).map((c) => ({ name: c.name, amount: Math.round(c.amt), previousMonth: Math.round(c.prev) })),
      biggestPayments: v.big.map((r) => ({ name: r.name, amount: Math.round(cost(r)), category: r.category })),
      topPayee: v.topPayee ? { name: v.topPayee.name, amount: Math.round(v.topPayee.amt), payments: v.topPayee.n } : null,
      salariesAndRent: Math.round(v.fixed), cashShareOfPaid: v.paidTotal ? Math.round((v.cash / v.paidTotal) * 100) : null,
      lateBills: { count: v.late.length, amount: Math.round(v.lateTotal) }, unpaidThisMonth: Math.round(v.openTotal),
    };
    try { setAi(await api('finance-advice', { method: 'POST', body: { month, summary, lang, refresh } })); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="grid two">
      <div className="card">
        <div className="card-head"><div><h2>{T('Key takeaways', 'أهم الملاحظات')} · {monthLabel(month)}</h2><p>{T('Spending by expense date (loan repayments left out).', 'المصاريف حسب تاريخها (دون سداد القروض).')}</p></div></div>
        <ul className="insights">{take.map((t, i) => <li key={i}><span className="ic" aria-hidden="true">{['💰', '📈', '🏷️', '⚠️', '👥', '🧾', '🏪', '💵', '⏳'][i] || '•'}</span><span>{t}</span></li>)}</ul>
      </div>
      <div className="card">
        <div className="card-head">
          <div><h2>{T('5 recommendations', '5 توصيات')}</h2><p>{ai ? T(`Written by ${ai.by} from this month’s figures. Check before acting.`, `كتبها ${ai.by} من أرقام هذا الشهر. تحقق منها قبل التنفيذ.`) : T('From this month’s figures.', 'من أرقام هذا الشهر.')}</p></div>
          <button className="btn small" onClick={() => askAi(!!ai)} disabled={busy}>{busy ? 'Thinking…' : ai ? '↻ Ask AI again' : '✨ Ask AI'}</button>
        </div>
        {err && <div className="banner bad" role="status"><span>{err}</span></div>}
        <ol className="recs">{(ai?.recommendations || rec.slice(0, 5)).map((r, i) => <li key={i}>{r}</li>)}</ol>
      </div>
    </div>
  );
}
