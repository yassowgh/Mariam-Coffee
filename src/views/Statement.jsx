import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { BarLineChart } from '../components/charts.jsx';
import AskAI from '../components/AskAI.jsx';
import { FIXED, GROUPS, addMonths, monthsBetween } from '../lib/finGroups.js';
import { GROUP_NOTES, aiContext, buildFigures, dayName, explain, monthName, monthShort, pc, tl } from '../lib/finReport.js';
import { addDays } from '../lib/aggregate.js';

const T = {
  title: { en: 'Financial statement', ar: 'كشف مالي' },
  sub: { en: 'Sales, costs and profit, month by month', ar: 'المبيعات والمصاريف والأرباح شهراً بشهر' },
  from: { en: 'From', ar: 'من' }, to: { en: 'To', ar: 'إلى' },
  last6: { en: 'Last 6 months', ar: 'آخر 6 أشهر' },
  pdf: { en: 'Full statement PDF', ar: 'الكشف كاملاً PDF' },
  plPdf: { en: 'P&L report PDF', ar: 'تقرير الأرباح والخسائر PDF' },
  plTitle: { en: 'Profit and loss report', ar: 'تقرير الأرباح والخسائر' },
  sales: { en: 'Sales (incl. VAT)', ar: 'المبيعات (شاملة الضريبة)' },
  salesEx: { en: 'Sales without VAT', ar: 'المبيعات بدون الضريبة' },
  vat: { en: 'VAT (10%)', ar: 'ضريبة القيمة المضافة (10%)' },
  costs: { en: 'Running costs', ar: 'المصاريف التشغيلية' },
  opProfit: { en: 'Operating profit', ar: 'الربح التشغيلي' },
  oneoff: { en: 'One-off / setup costs', ar: 'مصاريف التأسيس / لمرة واحدة' },
  net: { en: 'Net profit / loss', ar: 'صافي الربح / الخسارة' },
  explain: { en: 'What the figures say', ar: 'ماذا تقول الأرقام' },
  monthly: { en: '1. Sales per month', ar: '1. المبيعات الشهرية' },
  daily: { en: '2. Sales per day', ar: '2. المبيعات اليومية' },
  pl: { en: '3. Profit and loss', ar: '3. الأرباح والخسائر' },
  fixed: { en: '4. Fixed monthly costs', ar: '4. المصاريف الشهرية الثابتة' },
  groups: { en: '5. All costs by group', ar: '5. كل المصاريف حسب المجموعة' },
  month: { en: 'Month', ar: 'الشهر' }, total: { en: 'Total', ar: 'المجموع' }, orders: { en: 'Orders', ar: 'الطلبات' },
  days: { en: 'Days open', ar: 'أيام العمل' }, perDay: { en: 'Average / day', ar: 'المتوسط اليومي' }, day: { en: 'Day', ar: 'اليوم' },
  partial: { en: 'so far', ar: 'حتى الآن' }, showDays: { en: 'Show every day', ar: 'عرض كل الأيام' },
  avg7: { en: '7-day average', ar: 'متوسط 7 أيام' },
  share: { en: 'Share of the period', ar: 'النسبة من الفترة' },
  how: { en: 'How this statement is calculated', ar: 'كيف يُحسب هذا الكشف' },
  loading: { en: 'Loading expenses…', ar: 'جارٍ تحميل المصاريف…' },
  made: { en: 'Prepared on', ar: 'أُعدّ في' },
};

/** كشف مالي: sales per day and month, profit and loss, fixed costs and all cost groups; printable as PDF. */
export default function Statement({ ctx }) {
  const model = ctx.model;
  const invoices = model.allInvoices || model.invoices;
  const [lang, setLang] = useState(() => { try { return localStorage.getItem('mc-stmt-lang') || 'ar'; } catch { return 'ar'; } });
  useEffect(() => { try { localStorage.setItem('mc-stmt-lang', lang); } catch { /* private mode */ } }, [lang]);
  const t = (k) => T[k][lang];
  const ar = lang === 'ar';
  const [records, setRecords] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('expenses').then((r) => setRecords(r.records || [])).catch((e) => setError(e.message)); }, []);

  const lastMonth = model.maxDate.slice(0, 7);
  const firstMonth = model.minDate.slice(0, 7);
  const [range, setRange] = useState(() => ({ from: addMonths(lastMonth, -5) < firstMonth ? firstMonth : addMonths(lastMonth, -5), to: lastMonth }));
  const [showDays, setShowDays] = useState(false);
  const [printMode, setPrintMode] = useState('all');
  const allMonths = useMemo(() => monthsBetween(firstMonth, lastMonth), [firstMonth, lastMonth]);
  const months = useMemo(() => monthsBetween(range.from, range.to), [range]);

  const data = useMemo(() => {
    if (!records) return null;
    const want = new Set(months);
    const sales = {}, daily = new Map();
    for (const i of invoices) {
      if (!want.has(i.month)) continue;
      const s = sales[i.month] || (sales[i.month] = { sales: 0, orders: 0, days: 0, set: new Set() });
      s.sales += i.net; if (i.sign > 0) s.orders++; s.set.add(i.date);
      const d = daily.get(i.date) || { date: i.date, sales: 0, orders: 0 };
      d.sales += i.net; if (i.sign > 0) d.orders++;
      daily.set(i.date, d);
    }
    for (const s of Object.values(sales)) { s.days = s.set.size; delete s.set; }
    const fig = buildFigures({ sales, records, months, lastSalesDate: model.maxDate });
    // every calendar day of the period (closed days show 0)
    const days = [];
    const end = months[months.length - 1] === lastMonth ? model.maxDate : `${months[months.length - 1]}-31`;
    for (let d = months[0] + '-01'; d <= end && d.slice(0, 7) <= months[months.length - 1]; d = addDays(d, 1)) days.push(daily.get(d) || { date: d, sales: 0, orders: 0 });
    days.forEach((d, i) => { const w = days.slice(Math.max(0, i - 6), i + 1); d.avg7 = w.reduce((a, b) => a + b.sales, 0) / w.length; });
    const firstExpense = records.filter((r) => r.date && !/^Cafe Rent - .* Debt$/i.test(r.name || '')).map((r) => r.date).sort()[0];
    const notes = [];
    if (firstExpense && firstExpense > months[0] + '-01') notes.push(ar ? `أول مصروف مسجّل (غير الإيجار) بتاريخ ${dayName(firstExpense, lang)}: الأيام قبله تظهر بمصاريف أقل من الحقيقة.` : `The first recorded expense (other than rent) is on ${dayName(firstExpense, lang)}: days before it show fewer costs than there really were.`);
    if (fig.rows.some((r) => r.partial)) notes.push(ar ? `${monthName(lastMonth, lang)} حتى ${dayName(model.maxDate, lang)} فقط (آخر بيانات من الكاشير).` : `${monthName(lastMonth, lang)} only up to ${dayName(model.maxDate, lang)} (the latest till data).`);
    if (fig.tot.notCost) notes.push(ar ? `سداد القروض (${tl(fig.tot.notCost)}) ليس مصروفاً ولم يُحسب.` : `Loan repayments (${tl(fig.tot.notCost)}) are not costs and are not counted.`);
    return { ...fig, days, notes, text: explain(fig, lang, { notes }) };
  }, [records, months, invoices, lang]);

  function printPdf(mode = 'all') {
    setPrintMode(mode);
    const root = document.documentElement;
    const theme = root.getAttribute('data-theme');
    root.classList.add('print-stmt');
    if (mode === 'pl') root.classList.add('print-pl');
    root.setAttribute('data-theme', 'light');
    const done = () => { root.classList.remove('print-stmt', 'print-pl'); setPrintMode('all'); if (theme == null) root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    const prevTitle = document.title;
    document.title = `Mariam Coffee - ${mode === 'pl' ? T.plTitle.en : T.title.en} ${range.from} to ${range.to}`;
    setTimeout(() => { window.print(); document.title = prevTitle; setTimeout(done, 1500); }, 150);
  }

  if (error) return <div className="card"><div className="error" role="alert">{error}</div></div>;
  if (!data) return <div className="card"><p className="muted">{t('loading')}</p></div>;
  const { rows, tot, days } = data;
  const label = (m) => monthShort(m, lang);
  const opts = allMonths.map((m) => <option key={m} value={m}>{monthName(m, lang)}</option>);

  return (
    <div className="stack stmt" dir={ar ? 'rtl' : 'ltr'} lang={lang}>
      <div className="card pl-part">
        <div className="print-only" style={{ marginBottom: 8 }}>
          <b style={{ fontSize: 20 }}>Mariam Coffee · {printMode === 'pl' ? t('plTitle') : t('title')}</b><br />
          <span>{monthName(range.from, lang)} – {monthName(range.to, lang)} · {t('made')} {dayName(new Date().toISOString().slice(0, 10), lang)}</span>
        </div>
        <div className="card-head no-print">
          <div><h2>{t('title')}</h2><p>{t('sub')} · {monthName(range.from, lang)} – {monthName(range.to, lang)}</p></div>
          <div className="stmt-controls">
            <label>{t('from')} <select value={range.from} onChange={(e) => setRange((r) => ({ from: e.target.value, to: r.to < e.target.value ? e.target.value : r.to }))}>{opts}</select></label>
            <label>{t('to')} <select value={range.to} onChange={(e) => setRange((r) => ({ to: e.target.value, from: r.from > e.target.value ? e.target.value : r.from }))}>{opts}</select></label>
            <button className="btn small" onClick={() => setRange({ from: addMonths(lastMonth, -5) < firstMonth ? firstMonth : addMonths(lastMonth, -5), to: lastMonth })}>{t('last6')}</button>
            <div className="seg" role="group" aria-label="Language">
              <button aria-pressed={ar} onClick={() => setLang('ar')}>العربية</button>
              <button aria-pressed={!ar} onClick={() => setLang('en')}>English</button>
            </div>
            <button className="btn primary" onClick={() => printPdf('pl')}>⬇ {t('plPdf')}</button>
            <button className="btn" onClick={() => printPdf('all')}>⬇ {t('pdf')}</button>
          </div>
        </div>
        <div className="kpis" style={{ marginBottom: 0 }}>
          <Kpi label={t('sales')} value={tl(tot.sales)} sub={`${tl(tot.avgDay)} / ${ar ? 'يوم' : 'day'}`} />
          <Kpi label={t('salesEx')} value={tl(tot.salesEx)} sub={`${t('vat')}: ${tl(tot.vat)}`} />
          <Kpi label={t('costs')} value={tl(tot.operating)} sub={tot.salesEx ? pc(tot.operating / tot.salesEx) : ''} />
          <Kpi label={t('opProfit')} value={tl(tot.opProfit)} bad={tot.opProfit < 0} />
          <Kpi label={t('oneoff')} value={tl(tot.groups.oneoff)} />
          <Kpi label={t('net')} value={tl(tot.net)} bad={tot.net < 0} sub={tot.salesEx ? pc(tot.net / tot.salesEx) : ''} />
        </div>
      </div>

      <div className="card pl-part">
        <div className="card-head"><div><h2>{t('explain')}</h2></div></div>
        <Explain parts={data.text} />
      </div>

      <AskAI lang={lang} context={aiContext(data, { daily: days.map((d) => ({ date: d.date, sales: Math.round(d.sales), orders: d.orders })) })} notes={GROUP_NOTES}
        suggestions={ar ? ['لماذا كان الربح أقل في أحد الأشهر؟', 'ما المصاريف التي يمكن تخفيضها؟', 'كم أحتاج من المبيعات اليومية لأحقق ربحاً؟', 'قارن الرواتب بالمبيعات كل شهر'] : ['Why was one month weaker?', 'Which costs could I cut?', 'What daily sales do I need to make a profit?', 'Compare salaries with sales each month']} />

      <div className="card">
        <div className="card-head"><div><h2>{t('monthly')}</h2></div></div>
        <BarLineChart height={230} barLabel={t('sales')} lines={[{ key: 'line', label: t('costs'), color: 'var(--series-2)', markers: true }]}
          data={rows.map((r) => ({ key: r.m, label: label(r.m), value: r.sales, line: r.costs.operatingTotal, title: monthName(r.m, lang),
            rows: [[t('sales'), tl(r.sales)], [t('salesEx'), tl(r.salesEx)], [t('costs'), tl(r.costs.operatingTotal)], [t('orders'), r.orders.toLocaleString('en-US')]] }))} />
        <div className="table-wrap"><table className="pl">
          <thead><tr><th>{t('month')}</th><th>{t('sales')}</th><th>{t('vat')}</th><th>{t('salesEx')}</th><th>{t('orders')}</th><th>{t('days')}</th><th>{t('perDay')}</th></tr></thead>
          <tbody>
            {rows.map((r) => <tr key={r.m}><td>{monthName(r.m, lang)}{r.partial && <small className="muted"> ({t('partial')})</small>}</td><td>{tl(r.sales)}</td><td>{tl(r.vat)}</td><td>{tl(r.salesEx)}</td><td>{r.orders.toLocaleString('en-US')}</td><td>{r.days}</td><td>{tl(r.avgDay)}</td></tr>)}
            <tr className="sum"><td>{t('total')}</td><td>{tl(tot.sales)}</td><td>{tl(tot.vat)}</td><td>{tl(tot.salesEx)}</td><td>{tot.orders.toLocaleString('en-US')}</td><td>{tot.days}</td><td>{tl(tot.avgDay)}</td></tr>
          </tbody>
        </table></div>
      </div>

      <div className="card long">
        <div className="card-head"><div><h2>{t('daily')}</h2></div>
          <label className="check-inline no-print"><input type="checkbox" checked={showDays} onChange={(e) => setShowDays(e.target.checked)} /> {t('showDays')}</label></div>
        <BarLineChart height={220} barLabel={t('sales')} lines={[{ key: 'line', label: t('avg7'), color: 'var(--series-7)' }]}
          data={days.map((d) => ({ key: d.date, label: `${Number(d.date.slice(8))}/${Number(d.date.slice(5, 7))}`, value: d.sales, line: d.avg7, title: dayName(d.date, lang),
            rows: [[t('sales'), tl(d.sales)], [t('orders'), String(d.orders)], [t('avg7'), tl(d.avg7)]] }))} />
        <div className={showDays ? '' : 'print-only'}>
          <div className="table-wrap"><table className="pl">
            <thead><tr><th>{t('day')}</th><th>{t('sales')}</th><th>{t('salesEx')}</th><th>{t('orders')}</th></tr></thead>
            <tbody>{days.map((d) => <tr key={d.date}><td>{dayName(d.date, lang)}</td><td>{tl(d.sales)}</td><td>{tl(d.sales / 1.1)}</td><td>{d.orders}</td></tr>)}</tbody>
          </table></div>
        </div>
      </div>

      <div className="card pl-part">
        <div className="card-head"><div><h2>{t('pl')}</h2></div></div>
        <BarLineChart height={230} barLabel={t('net')} lines={[{ key: 'line', label: t('salesEx'), color: 'var(--series-7)', markers: true }]}
          data={rows.map((r) => ({ key: r.m, label: label(r.m), value: r.net, line: r.salesEx, title: monthName(r.m, lang),
            rows: [[t('salesEx'), tl(r.salesEx)], [t('costs'), tl(r.costs.operatingTotal)], [t('opProfit'), tl(r.opProfit)], [t('oneoff'), tl(r.costs.groups.oneoff)], [t('net'), tl(r.net)]] }))} />
        <div className="table-wrap"><table className="pl">
          <thead><tr><th />{rows.map((r) => <th key={r.m}>{label(r.m)}</th>)}<th>{t('total')}</th></tr></thead>
          <tbody>
            <PlRow label={t('sales')} rows={rows} get={(r) => r.sales} total={tot.sales} />
            <PlRow label={'− ' + t('vat')} rows={rows} get={(r) => -r.vat} total={-tot.vat} cls="sub" />
            <PlRow label={t('salesEx')} rows={rows} get={(r) => r.salesEx} total={tot.salesEx} cls="head" />
            {GROUPS.filter((g) => g.key !== 'oneoff').map((g) => <PlRow key={g.key} label={'− ' + g[lang]} rows={rows} get={(r) => -r.costs.groups[g.key]} total={-tot.groups[g.key]} cls="sub" />)}
            <PlRow label={t('opProfit')} rows={rows} get={(r) => r.opProfit} total={tot.opProfit} cls="sum" />
            <PlRow label={'− ' + t('oneoff')} rows={rows} get={(r) => -r.costs.groups.oneoff} total={-tot.groups.oneoff} cls="sub" />
            <PlRow label={t('net')} rows={rows} get={(r) => r.net} total={tot.net} cls="sum" />
            <tr><td>{ar ? 'هامش الربح' : 'Net margin'}</td>{rows.map((r) => <td key={r.m}>{r.salesEx ? pc(r.net / r.salesEx) : '–'}</td>)}<td>{tot.salesEx ? pc(tot.net / tot.salesEx) : '–'}</td></tr>
          </tbody>
        </table></div>
      </div>

      <div className="card">
        <div className="card-head"><div><h2>{t('fixed')}</h2></div></div>
        <BarLineChart height={230} series={FIXED.map((f, i) => ({ key: f.key, label: f[lang], color: i < 7 ? `var(--cat-${i + 1})` : 'var(--cat-other)' }))}
          data={rows.map((r) => ({ key: r.m, label: label(r.m), value: r.costs.groups.fixed, parts: r.costs.fixed, title: monthName(r.m, lang),
            rows: FIXED.filter((f) => r.costs.fixed[f.key]).map((f, i) => [f[lang], tl(r.costs.fixed[f.key])]) }))} />
        <div className="table-wrap"><table className="pl">
          <thead><tr><th />{rows.map((r) => <th key={r.m}>{label(r.m)}</th>)}<th>{t('total')}</th></tr></thead>
          <tbody>
            {FIXED.map((f) => <PlRow key={f.key} label={f[lang]} rows={rows} get={(r) => r.costs.fixed[f.key]} total={tot.fixed[f.key]} />)}
            <PlRow label={t('total')} rows={rows} get={(r) => r.costs.groups.fixed} total={tot.groups.fixed} cls="sum" />
          </tbody>
        </table></div>
      </div>

      <div className="card">
        <div className="card-head"><div><h2>{t('groups')}</h2></div></div>
        <BarLineChart height={230} series={GROUPS.map((g) => ({ key: g.key, label: g[lang], color: g.color }))}
          data={rows.map((r) => ({ key: r.m, label: label(r.m), value: r.costs.total, parts: r.costs.groups, title: monthName(r.m, lang),
            rows: GROUPS.map((g) => [g[lang], tl(r.costs.groups[g.key]), g.color]) }))} />
        <h3 style={{ fontSize: 14, margin: '12px 0 8px' }}>{t('share')}</h3>
        <ShareBars items={GROUPS.map((g) => ({ key: g.key, label: g[lang], value: tot.groups[g.key], color: g.color }))} />
        <div className="table-wrap" style={{ marginTop: 12 }}><table className="pl">
          <thead><tr><th />{rows.map((r) => <th key={r.m}>{label(r.m)}</th>)}<th>{t('total')}</th></tr></thead>
          <tbody>
            {GROUPS.map((g) => <PlRow key={g.key} label={g[lang]} rows={rows} get={(r) => r.costs.groups[g.key]} total={tot.groups[g.key]} />)}
            <PlRow label={t('total')} rows={rows} get={(r) => r.costs.total} total={tot.costs} cls="sum" />
          </tbody>
        </table></div>
      </div>

      <div className="card pl-part">
        <details open>
          <summary style={{ fontWeight: 650, cursor: 'pointer' }}>{t('how')}</summary>
          <div className="explain" style={{ marginTop: 8 }}>
            {ar ? <ul>
              <li>المبيعات من الكاشير بعد الخصومات، وتشمل ضريبة القيمة المضافة 10%. الربح يُحسب من المبيعات بدون الضريبة.</li>
              <li>المصاريف من قسم المحاسبة، وكل مصروف يُحسب في تاريخه (تاريخ الدفع، أو التاريخ المحدد للفواتير المخططة). إيجار المقهى من مارس إلى أغسطس مسجّل في أول كل شهر.</li>
              <li>الثابتة: الإيجار، الرواتب، الكهرباء، المياه، الغاز، الإنترنت، فواتير أخرى، خدمات دورية. المواد الخام: مواد البار والفطور والحلويات والتغليف. المشتريات: أدوات البار والمطبخ ومواد التنظيف. التشغيلية: كل ما عدا ذلك (أكل الفريق، المواصلات، الوقود، الصيانة، التسويق، الضرائب والرسوم…).</li>
              <li>مصاريف التأسيس (الرسوم القانونية وتأسيس الشركة، التجديد، جهاز الكاشير الجديد) في سطر منفصل تحت الربح التشغيلي. سداد القروض ليس مصروفاً.</li>
            </ul> : <ul>
              <li>Sales come from the till, after discounts, and include 10% VAT. Profit is calculated from sales without VAT.</li>
              <li>Expenses come from Accounting; each counts on its date (the date it was paid, or the date set for planned bills). Café rent for March–August is recorded on the 1st of each month.</li>
              <li>Fixed: rent, salaries, electricity, water, gas, internet, other bills, recurring services. Raw materials: bar, breakfast, sweets and packaging materials. Purchases: bar/kitchen tools and cleaning materials. Operating: everything else (team food, transport, fuel, repairs, marketing, taxes & fees…).</li>
              <li>One-off / setup costs (legal and company set-up fees, renovation, the new POS machine) are a separate line below the operating profit. Loan repayments are not costs.</li>
            </ul>}
          </div>
        </details>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, bad }) {
  return <div className="card kpi"><div className="label">{label}</div><div className={'value' + (bad ? ' down' : '')}>{value}</div>{sub && <div className="sub">{sub}</div>}</div>;
}
function PlRow({ label, rows, get, total, cls = '' }) {
  return <tr className={cls}><td>{label}</td>{rows.map((r) => { const v = get(r); return <td key={r.m} className={v < 0 && /sum/.test(cls) ? 'neg' : ''}>{v ? tl(v) : '–'}</td>; })}<td className={total < 0 && /sum/.test(cls) ? 'neg' : ''}>{total ? tl(total) : '–'}</td></tr>;
}
export function ShareBars({ items }) {
  const all = items.reduce((t, i) => t + Math.max(0, i.value), 0) || 1;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="share-list">
      {items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value).map((i) => (
        <div className="share-row" key={i.key}>
          <span>{i.label}</span>
          <span className="track"><i style={{ width: `${(i.value / max) * 100}%`, background: i.color }} /></span>
          <b>{tl(i.value)} · {pc(i.value / all)}</b>
        </div>
      ))}
    </div>
  );
}
export function Explain({ parts }) {
  return (
    <div className="explain" dir="auto">
      {parts.map((p, i) => (typeof p === 'string'
        ? <p key={i}>{p}</p>
        : <div key={i}><p style={{ marginBottom: 2 }}><b>{p.title}</b></p><ul>{p.list.map((x, j) => <li key={j}>{x}</li>)}</ul></div>))}
    </div>
  );
}
