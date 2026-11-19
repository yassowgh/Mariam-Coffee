import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { BarLineChart } from '../components/charts.jsx';
import AskAI from '../components/AskAI.jsx';
import { FIXED, GROUPS, addMonths, monthsBetween } from '../lib/finGroups.js';
import { GROUP_NOTES, aiContext, buildFigures, explain, monthName, monthShort, tl } from '../lib/finReport.js';
import { Explain, ShareBars } from '../views/Statement.jsx';

/**
 * Finance: the last 6 months up to the chosen month, explained in words and charts, with AI questions.
 * Sales per month come from the figures saved when the sales reports were last opened.
 */
export default function FinanceExplained({ records, month }) {
  const [lang, setLang] = useState(() => { try { return localStorage.getItem('mc-stmt-lang') || 'en'; } catch { return 'en'; } });
  useEffect(() => { try { localStorage.setItem('mc-stmt-lang', lang); } catch { /* private mode */ } }, [lang]);
  const ar = lang === 'ar';
  const [demand, setDemand] = useState(null);
  useEffect(() => { api('demand').then((r) => setDemand(r.demand || {})).catch(() => setDemand({})); }, []);
  const months = useMemo(() => monthsBetween(addMonths(month, -5), month), [month]);

  const data = useMemo(() => {
    if (!demand) return null;
    const sales = {};
    for (const s of demand.salesMonths || []) sales[s.month] = { sales: s.net, orders: s.orders, days: s.days };
    const fig = buildFigures({ sales, records, months, lastSalesDate: demand.to });
    const notes = [];
    const lastSales = (demand.salesMonths || []).map((s) => s.month).sort().pop();
    if (!lastSales) notes.push(ar ? 'لا توجد أرقام مبيعات محفوظة بعد: افتح تقارير المبيعات مرة واحدة لتظهر هنا.' : 'No sales figures saved yet: open the sales reports once and they appear here.');
    else if (demand.to) notes.push(ar ? `المبيعات حتى ${demand.to} (تتحدّث عند فتح تقارير المبيعات). للتفاصيل اليومية وتصدير PDF: تقارير المبيعات ← كشف مالي.` : `Sales up to ${demand.to} (updated each time the sales reports are opened). For day-by-day figures and a PDF: Sales reports → Financial statement.`);
    return { ...fig, text: explain(fig, lang, { notes }) };
  }, [demand, records, months, lang]);

  if (!data) return null;
  const { rows, tot } = data;
  const label = (m) => monthShort(m, lang);
  return (
    <>
      <div className="card" dir={ar ? 'rtl' : 'ltr'}>
        <div className="card-head">
          <div><h2>{ar ? 'الشرح: آخر 6 أشهر' : 'Explained: the last 6 months'}</h2><p>{monthName(months[0], lang)} – {monthName(month, lang)}</p></div>
          <div className="seg" role="group" aria-label="Language">
            <button aria-pressed={ar} onClick={() => setLang('ar')}>العربية</button>
            <button aria-pressed={!ar} onClick={() => setLang('en')}>English</button>
          </div>
        </div>
        <Explain parts={data.text} />
        <h3 style={{ fontSize: 14, margin: '14px 0 6px' }}>{ar ? 'المبيعات والمصاريف وصافي الربح' : 'Sales, costs and net profit'}</h3>
        <BarLineChart height={220} barLabel={ar ? 'صافي الربح / الخسارة' : 'Net profit / loss'}
          lines={[{ key: 'line', label: ar ? 'المبيعات بدون الضريبة' : 'Sales without VAT', color: 'var(--series-7)', markers: true }, { key: 'c', label: ar ? 'المصاريف' : 'Costs', color: 'var(--series-2)', markers: true }]}
          data={rows.map((r) => ({ key: r.m, label: label(r.m), value: r.net, line: r.salesEx, c: r.costs.total, title: monthName(r.m, lang),
            rows: [[ar ? 'المبيعات بدون الضريبة' : 'Sales without VAT', tl(r.salesEx)], [ar ? 'المصاريف' : 'Costs', tl(r.costs.total)], [ar ? 'صافي الربح' : 'Net profit', tl(r.net)]] }))} />
        <h3 style={{ fontSize: 14, margin: '14px 0 6px' }}>{ar ? 'المصاريف حسب المجموعة' : 'Costs by group'}</h3>
        <BarLineChart height={220} series={GROUPS.map((g) => ({ key: g.key, label: g[lang], color: g.color }))}
          data={rows.map((r) => ({ key: r.m, label: label(r.m), value: r.costs.total, parts: r.costs.groups, title: monthName(r.m, lang), rows: GROUPS.map((g) => [g[lang], tl(r.costs.groups[g.key]), g.color]) }))} />
        <div style={{ marginTop: 10 }}><ShareBars items={GROUPS.map((g) => ({ key: g.key, label: g[lang], value: tot.groups[g.key], color: g.color }))} /></div>
        <h3 style={{ fontSize: 14, margin: '14px 0 6px' }}>{ar ? 'المصاريف الثابتة' : 'Fixed costs'}</h3>
        <BarLineChart height={220} series={FIXED.map((f, i) => ({ key: f.key, label: f[lang], color: i < 7 ? `var(--cat-${i + 1})` : 'var(--cat-other)' }))}
          data={rows.map((r) => ({ key: r.m, label: label(r.m), value: r.costs.groups.fixed, parts: r.costs.fixed, title: monthName(r.m, lang), rows: FIXED.filter((f) => r.costs.fixed[f.key]).map((f) => [f[lang], tl(r.costs.fixed[f.key])]) }))} />
      </div>
      <AskAI lang={lang} context={aiContext(data, { salesSavedUpTo: demand.to || null })} notes={GROUP_NOTES}
        suggestions={ar ? ['أين يذهب معظم المال؟', 'هل الرواتب مرتفعة مقارنة بالمبيعات؟', 'ما الشهر الأسوأ ولماذا؟', 'ما الذي تغيّر بين الشهرين الأخيرين؟'] : ['Where does most of the money go?', 'Are salaries high compared with sales?', 'Which month was worst, and why?', 'What changed between the last two months?']} />
    </>
  );
}
