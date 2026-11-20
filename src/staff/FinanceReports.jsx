import { Fragment, useEffect, useMemo, useState } from 'react';
import { BarLineChart } from '../components/charts.jsx';
import AskAI from '../components/AskAI.jsx';
import Statement, { ShareBars } from '../views/Statement.jsx';
import { FIXED, GROUPS, addMonths, groupOf, monthsBetween } from '../lib/finGroups.js';
import { GROUP_NOTES, aiContext, buildFigures, dayName, monthName, monthShort, tl } from '../lib/finReport.js';
import { loadSalesModel, salesByMonth } from '../lib/salesData.js';
import { todayLocal } from '../lib/api.js';

const amt = (r) => (Number(r.amount) || 0) + (Number(r.fees) || 0);
const UTIL = ['electricity', 'water', 'gas', 'internet', 'bills'];

function useLang() {
  const [lang, setLang] = useState(() => { try { return localStorage.getItem('mc-stmt-lang') || 'en'; } catch { return 'en'; } });
  useEffect(() => { try { localStorage.setItem('mc-stmt-lang', lang); } catch { /* private mode */ } }, [lang]);
  return [lang, setLang];
}
function LangSwitch({ lang, setLang }) {
  return (
    <div className="seg" role="group" aria-label="Language">
      <button aria-pressed={lang === 'ar'} onClick={() => setLang('ar')}>العربية</button>
      <button aria-pressed={lang === 'en'} onClick={() => setLang('en')}>English</button>
    </div>
  );
}
/** Print the current report (the Finance tabs and menus are hidden); light colours for paper. */
function printReport(title) {
  const root = document.documentElement;
  const theme = root.getAttribute('data-theme');
  root.classList.add('print-rep');
  root.setAttribute('data-theme', 'light');
  const prev = document.title;
  document.title = title;
  const done = () => { root.classList.remove('print-rep'); if (theme == null) root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { window.print(); document.title = prev; setTimeout(done, 1500); }, 150);
}
function MonthRange({ range, setRange, months, lang }) {
  const opts = months.map((m) => <option key={m} value={m}>{monthName(m, lang)}</option>);
  const ar = lang === 'ar';
  return (
    <>
      <label>{ar ? 'من' : 'From'} <select value={range.from} onChange={(e) => setRange((r) => ({ from: e.target.value, to: r.to < e.target.value ? e.target.value : r.to }))}>{opts}</select></label>
      <label>{ar ? 'إلى' : 'To'} <select value={range.to} onChange={(e) => setRange((r) => ({ to: e.target.value, from: r.from > e.target.value ? e.target.value : r.from }))}>{opts}</select></label>
    </>
  );
}
function useRange(records) {
  const thisMonth = todayLocal().slice(0, 7);
  const first = records.map((r) => (r.date || '').slice(0, 7)).filter(Boolean).sort()[0] || addMonths(thisMonth, -5);
  const all = monthsBetween(first < addMonths(thisMonth, -23) ? addMonths(thisMonth, -23) : first, thisMonth);
  const [range, setRange] = useState({ from: addMonths(thisMonth, -5) < all[0] ? all[0] : addMonths(thisMonth, -5), to: thisMonth });
  return { range, setRange, all, months: monthsBetween(range.from, range.to) };
}

/** Sales from the till, loaded once (a few seconds the first time). */
function useSales() {
  const [state, setState] = useState({ model: null, error: '', msg: 'Loading the till sales…' });
  useEffect(() => {
    let off = false;
    loadSalesModel((msg) => !off && setState((s) => ({ ...s, msg })))
      .then((model) => !off && setState({ model, error: model ? '' : 'No till sales are saved on the website yet.', msg: '' }))
      .catch((e) => !off && setState({ model: null, error: e.message, msg: '' }));
    return () => { off = true; };
  }, []);
  return state;
}

// ---------------------------------------------------------------- P&L

export function PLReport() {
  const { model, error, msg } = useSales();
  if (error) return <div className="card"><div className="error" role="alert">{error}</div></div>;
  if (!model) return <div className="card"><p className="muted" style={{ margin: 0 }}>{msg}</p></div>;
  return <Statement ctx={{ model }} />;
}

// ---------------------------------------------------------------- salaries per person

const personKey = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
function personOf(r) {
  return r.employee || (r.payee_type !== 'company' && r.payee) || r.payee || '';
}

export function SalariesReport({ records }) {
  const [lang, setLang] = useLang();
  const ar = lang === 'ar';
  const { range, setRange, all, months } = useRange(records);
  const [open, setOpen] = useState(null);

  const data = useMemo(() => {
    const want = new Set(months);
    const people = new Map();
    for (const r of records) {
      if (!/^salar/i.test(r.category || '') || r.kind === 'loan_repayment') continue;
      const m = (r.date || '').slice(0, 7);
      if (!want.has(m)) continue;
      const name = personOf(r) || (ar ? 'غير مرتبط بشخص' : 'Not linked to a person');
      const k = personKey(name);
      const p = people.get(k) || { key: k, names: new Map(), months: {}, total: 0, advances: 0, n: 0, list: [] };
      p.names.set(name, (p.names.get(name) || 0) + 1);
      p.months[m] = (p.months[m] || 0) + amt(r);
      p.total += amt(r); p.n++;
      if (r.kind === 'advance' || /avans|advance/i.test(r.name || '')) p.advances += amt(r);
      p.list.push(r);
      people.set(k, p);
    }
    const rows = [...people.values()].map((p) => ({ ...p, name: [...p.names].sort((a, b) => b[1] - a[1])[0][0], list: p.list.sort((a, b) => (a.date < b.date ? -1 : 1)) }))
      .sort((a, b) => b.total - a.total);
    const monthTot = Object.fromEntries(months.map((m) => [m, rows.reduce((t, p) => t + (p.months[m] || 0), 0)]));
    return { rows, monthTot, total: rows.reduce((t, p) => t + p.total, 0), advances: rows.reduce((t, p) => t + p.advances, 0) };
  }, [records, months, ar]);

  const label = (m) => monthShort(m, lang);
  const title = ar ? 'تقرير الرواتب لكل شخص' : 'Salaries per person';
  return (
    <div className="stack stmt rep" dir={ar ? 'rtl' : 'ltr'} lang={lang}>
      <div className="card">
        <div className="print-only" style={{ marginBottom: 8 }}><b style={{ fontSize: 20 }}>Mariam Coffee · {title}</b><br />{monthName(range.from, lang)} – {monthName(range.to, lang)}</div>
        <div className="card-head no-print">
          <div><h2>{title}</h2><p>{ar ? 'كل الدفعات في فئة الرواتب (رواتب وسلف) حسب الشخص والشهر.' : 'Every payment in the Salaries category (salaries and advances), per person and month.'}</p></div>
          <div className="stmt-controls">
            <MonthRange range={range} setRange={setRange} months={all} lang={lang} />
            <LangSwitch lang={lang} setLang={setLang} />
            <button className="btn primary" onClick={() => printReport(`Mariam Coffee - Salaries ${range.from} to ${range.to}`)}>⬇ PDF</button>
          </div>
        </div>
        <div className="kpis" style={{ marginBottom: 0 }}>
          <Kpi label={ar ? 'مجموع الرواتب والسلف' : 'Salaries and advances paid'} value={tl(data.total)} />
          <Kpi label={ar ? 'منها سلف' : 'Of which advances'} value={tl(data.advances)} />
          <Kpi label={ar ? 'عدد الأشخاص' : 'People paid'} value={String(data.rows.length)} />
          <Kpi label={ar ? 'المتوسط الشهري' : 'Average per month'} value={tl(data.total / Math.max(1, months.length))} />
        </div>
      </div>
      <div className="card">
        <div className="card-head"><div><h2>{ar ? 'الرواتب كل شهر' : 'Salaries each month'}</h2></div></div>
        <BarLineChart height={220} barLabel={ar ? 'الرواتب' : 'Salaries'}
          data={months.map((m) => ({ key: m, label: label(m), value: data.monthTot[m], title: monthName(m, lang),
            rows: data.rows.filter((p) => p.months[m]).slice(0, 8).map((p) => [p.name, tl(p.months[m])]) }))} />
        <h3 style={{ fontSize: 14, margin: '12px 0 8px' }}>{ar ? 'حسب الشخص' : 'Per person'}</h3>
        <ShareBars items={data.rows.slice(0, 15).map((p, i) => ({ key: p.key, label: p.name, value: p.total, color: i < 7 ? `var(--cat-${i + 1})` : 'var(--cat-other)' }))} />
      </div>
      <div className="card long">
        <div className="card-head"><div><h2>{ar ? 'التفاصيل' : 'Details'}</h2><p className="no-print">{ar ? 'اضغط على اسم لرؤية كل دفعاته.' : 'Tap a name to see every payment.'}</p></div></div>
        <div className="table-wrap"><table className="pl">
          <thead><tr><th>{ar ? 'الشخص' : 'Person'}</th>{months.map((m) => <th key={m}>{label(m)}</th>)}<th>{ar ? 'المجموع' : 'Total'}</th><th>{ar ? 'منها سلف' : 'Advances'}</th></tr></thead>
          <tbody>
            {data.rows.map((p) => (
              <Fragment key={p.key}>
                <tr className="rep-person" onClick={() => setOpen(open === p.key ? null : p.key)}>
                  <td><span className="no-print">{open === p.key ? '▾ ' : '▸ '}</span>{p.name} <small className="muted">({p.n})</small></td>
                  {months.map((m) => <td key={m}>{p.months[m] ? tl(p.months[m]) : '–'}</td>)}
                  <td><b>{tl(p.total)}</b></td><td>{p.advances ? tl(p.advances) : '–'}</td>
                </tr>
                {open === p.key && p.list.map((r) => (
                  <tr key={r.id} className="detail">
                    <td>{dayName(r.date, lang)}</td>
                    <td colSpan={months.length} style={{ textAlign: 'start', whiteSpace: 'normal' }}>{r.name}{r.account ? ` · ${r.account}` : ''}{r.status !== 'paid' ? ` · ${ar ? 'غير مدفوع' : 'not paid'}` : ''}</td>
                    <td>{tl(amt(r))}</td><td>{r.kind === 'advance' || /avans|advance/i.test(r.name || '') ? (ar ? 'سلفة' : 'advance') : ''}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
            <tr className="sum"><td>{ar ? 'المجموع' : 'Total'}</td>{months.map((m) => <td key={m}>{tl(data.monthTot[m])}</td>)}<td>{tl(data.total)}</td><td>{tl(data.advances)}</td></tr>
          </tbody>
        </table></div>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>{ar
          ? 'الشخص هو "الموظف" في السجل، أو "المدفوع له" إذا لم يُحدَّد موظف. إذا ظهر نفس الشخص باسمين (مثلاً من إيصال بنكي)، صحّح الاسم في المحاسبة.'
          : 'The person is the record’s “employee”, or “paid to” when no employee is set. If one person shows under two names (e.g. from a bank slip), correct the name in Accounting.'}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- utilities

export function UtilitiesReport({ records }) {
  const [lang, setLang] = useLang();
  const ar = lang === 'ar';
  const { range, setRange, all, months } = useRange(records);
  const today = todayLocal();
  const SUBS = FIXED.filter((f) => UTIL.includes(f.key));

  const data = useMemo(() => {
    const want = new Set(months);
    const bills = [];
    const byMonth = Object.fromEntries(months.map((m) => [m, Object.fromEntries(UTIL.map((k) => [k, 0]))]));
    for (const r of records) {
      const g = groupOf(r);
      if (!g || g.group !== 'fixed' || !UTIL.includes(g.sub)) continue;
      const m = (r.date || '').slice(0, 7);
      if (!want.has(m)) continue;
      byMonth[m][g.sub] += amt(r);
      bills.push({ ...r, sub: g.sub, total: amt(r) });
    }
    bills.sort((a, b) => (a.date < b.date ? 1 : -1));
    const tot = Object.fromEntries(UTIL.map((k) => [k, months.reduce((t, m) => t + byMonth[m][k], 0)]));
    const open = bills.filter((b) => b.status !== 'paid');
    return { bills, byMonth, tot, total: Object.values(tot).reduce((a, b) => a + b, 0), open, openTotal: open.reduce((t, b) => t + b.total, 0) };
  }, [records, months]);

  const label = (m) => monthShort(m, lang);
  const subName = (k) => SUBS.find((s) => s.key === k)?.[lang] || k;
  const color = (k) => `var(--cat-${UTIL.indexOf(k) + 1})`;
  const title = ar ? 'تقرير الفواتير (الكهرباء والمياه والغاز والإنترنت)' : 'Utilities (electricity, water, gas, internet)';
  const statusOf = (b) => (b.status === 'paid' ? (ar ? 'مدفوعة' : 'Paid') + (b.paid_date ? ` ${dayName(b.paid_date, lang)}` : '')
    : (b.due_date || b.date) < today ? (ar ? 'متأخرة' : 'Late') : (ar ? 'غير مدفوعة' : 'To pay'));
  return (
    <div className="stack stmt rep" dir={ar ? 'rtl' : 'ltr'} lang={lang}>
      <div className="card">
        <div className="print-only" style={{ marginBottom: 8 }}><b style={{ fontSize: 20 }}>Mariam Coffee · {title}</b><br />{monthName(range.from, lang)} – {monthName(range.to, lang)}</div>
        <div className="card-head no-print">
          <div><h2>{title}</h2><p>{ar ? 'من فئة "Utilities Bills" في المحاسبة، مقسّمة حسب اسم الفاتورة.' : 'From the “Utilities Bills” category in Accounting, split by the bill’s name.'}</p></div>
          <div className="stmt-controls">
            <MonthRange range={range} setRange={setRange} months={all} lang={lang} />
            <LangSwitch lang={lang} setLang={setLang} />
            <button className="btn primary" onClick={() => printReport(`Mariam Coffee - Utilities ${range.from} to ${range.to}`)}>⬇ PDF</button>
          </div>
        </div>
        <div className="kpis" style={{ marginBottom: 0 }}>
          <Kpi label={ar ? 'مجموع الفواتير' : 'All utility bills'} value={tl(data.total)} sub={`${data.bills.length} ${ar ? 'فاتورة' : 'bills'}`} />
          {SUBS.filter((s) => data.tot[s.key]).map((s) => <Kpi key={s.key} label={s[lang]} value={tl(data.tot[s.key])} />)}
          <Kpi label={ar ? 'غير مدفوع' : 'Not paid yet'} value={tl(data.openTotal)} sub={`${data.open.length} ${ar ? 'فاتورة' : 'bills'}`} bad={data.open.length > 0} />
        </div>
      </div>
      <div className="card">
        <div className="card-head"><div><h2>{ar ? 'كل شهر' : 'Each month'}</h2><p>{ar ? 'كل فاتورة في شهر تاريخها (تاريخ الدفع، أو تاريخ الاستحقاق إذا لم تُدفع).' : 'Each bill counts in the month of its date (the date paid, or the due date if not paid yet).'}</p></div></div>
        <BarLineChart height={220} series={UTIL.map((k) => ({ key: k, label: subName(k), color: color(k) }))}
          data={months.map((m) => ({ key: m, label: label(m), value: UTIL.reduce((t, k) => t + data.byMonth[m][k], 0), parts: data.byMonth[m], title: monthName(m, lang),
            rows: UTIL.filter((k) => data.byMonth[m][k]).map((k) => [subName(k), tl(data.byMonth[m][k]), color(k)]) }))} />
        <div className="table-wrap"><table className="pl">
          <thead><tr><th />{months.map((m) => <th key={m}>{label(m)}</th>)}<th>{ar ? 'المجموع' : 'Total'}</th></tr></thead>
          <tbody>
            {UTIL.map((k) => <tr key={k}><td>{subName(k)}</td>{months.map((m) => <td key={m}>{data.byMonth[m][k] ? tl(data.byMonth[m][k]) : '–'}</td>)}<td>{data.tot[k] ? tl(data.tot[k]) : '–'}</td></tr>)}
            <tr className="sum"><td>{ar ? 'المجموع' : 'Total'}</td>{months.map((m) => <td key={m}>{tl(UTIL.reduce((t, k) => t + data.byMonth[m][k], 0))}</td>)}<td>{tl(data.total)}</td></tr>
          </tbody>
        </table></div>
      </div>
      <div className="card long">
        <div className="card-head"><div><h2>{ar ? 'كل الفواتير' : 'Every bill'}</h2></div></div>
        <div className="table-wrap"><table className="pl">
          <thead><tr><th>{ar ? 'التاريخ' : 'Date'}</th><th>{ar ? 'النوع' : 'Type'}</th><th>{ar ? 'الفاتورة' : 'Bill'}</th><th>{ar ? 'الشركة' : 'Company'}</th><th>{ar ? 'المبلغ' : 'Amount'}</th><th>{ar ? 'الحالة' : 'Status'}</th><th>{ar ? 'دُفعت من' : 'Paid from'}</th></tr></thead>
          <tbody>
            {data.bills.map((b) => (
              <tr key={b.id}>
                <td>{dayName(b.date, lang)}</td><td>{subName(b.sub)}</td><td style={{ textAlign: 'start', whiteSpace: 'normal' }}>{b.name}</td><td style={{ textAlign: 'start' }}>{b.payee || '–'}</td>
                <td>{tl(b.total)}</td><td className={b.status !== 'paid' ? 'neg' : ''}>{statusOf(b)}</td><td style={{ textAlign: 'start' }}>{b.account || '–'}</td>
              </tr>
            ))}
            {!data.bills.length && <tr><td colSpan={7} className="muted">{ar ? 'لا توجد فواتير في هذه الأشهر.' : 'No bills in these months.'}</td></tr>}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- AI chat

/** Everything about the café's money, compact, for the AI. */
function chatContext(model, records) {
  const r0 = Math.round;
  const thisMonth = todayLocal().slice(0, 7);
  const firstRec = records.map((r) => (r.date || '').slice(0, 7)).filter(Boolean).sort()[0] || thisMonth;
  const firstSale = model ? model.minDate.slice(0, 7) : thisMonth;
  const months = monthsBetween(firstRec < firstSale ? firstRec : firstSale, thisMonth);
  const { sales, daily } = model ? salesByMonth(model.allInvoices, months) : { sales: {}, daily: new Map() };
  const fig = buildFigures({ sales, records, months, lastSalesDate: model?.maxDate });
  const base = aiContext(fig);
  const since = addMonths(thisMonth, -2) + '-01'; // every record of the last 3 months (older months: totals only)
  // salaries per person per month
  const sal = {};
  for (const r of records) {
    if (!/^salar/i.test(r.category || '') || !r.date) continue;
    const p = personOf(r) || 'not linked';
    const m = r.date.slice(0, 7);
    sal[p] = sal[p] || {}; sal[p][m] = r0((sal[p][m] || 0) + amt(r));
  }
  return {
    today: todayLocal(),
    salesDataUpTo: model?.maxDate || null,
    ...base,
    dailySalesInclVat: [...daily.values()].filter((d) => d.date >= addMonths(thisMonth, -1) + '-01').sort((a, b) => (a.date < b.date ? -1 : 1)).map((d) => [d.date, r0(d.sales), d.orders]),
    salariesPerPersonPerMonth: sal,
    unpaidOrPlanned: records.filter((r) => r.status !== 'paid').map((r) => [r.date || '', r.name, r0(amt(r)), r.category, r.status, r.due_date || '']),
    paidOutByAccount: Object.entries(records.reduce((o, r) => { if (r.status === 'paid' && r.date >= since) o[r.account || 'not recorded'] = (o[r.account || 'not recorded'] || 0) + amt(r); return o; }, {})).map(([k, v]) => [k, r0(v)]),
    // every record of the last 6 months: [date, what, amount, category, status, paid to / employee, account]
    records: records.filter((r) => (r.date || '') >= since).sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((r) => [r.date.slice(5), String(r.name || '').slice(0, 45), r0(amt(r)), r.category, r.status === 'paid' ? '' : r.status, String(r.employee || r.payee || '').slice(0, 24)]),
  };
}

export function AIChat({ records }) {
  const [lang, setLang] = useLang();
  const ar = lang === 'ar';
  const { model, error, msg } = useSales();
  const ctx = useMemo(() => (model || error ? chatContext(model, records) : null), [model, error, records]);
  if (!ctx) return <div className="card"><p className="muted" style={{ margin: 0 }}>{msg}</p></div>;
  return (
    <div className="stack" dir={ar ? 'rtl' : 'ltr'}>
      <div className="card">
        <div className="card-head">
          <div><h2>{ar ? '🤖 محادثة الذكاء الاصطناعي' : '🤖 AI chat'}</h2>
            <p>{ar ? 'اسأل أي سؤال عن أموال المقهى: المبيعات، المصاريف، الرواتب، الفواتير، الأرباح. يعرف كل الأرقام في المحاسبة ومبيعات الكاشير' : 'Ask anything about the café’s money: sales, expenses, salaries, bills, profit. It knows every figure in Accounting and the till sales'}{model ? ` (${ar ? 'حتى' : 'up to'} ${dayName(model.maxDate, lang)})` : ''}.</p>
            {error && <p className="muted">{error}</p>}</div>
          <LangSwitch lang={lang} setLang={setLang} />
        </div>
      </div>
      <AskAI lang={lang} context={ctx} notes={GROUP_NOTES + ' The "records" list holds every accounting record of the last 3 months as [MM-DD (this year), what, amount TL, category, status (empty = paid), paid to / employee]; older months are in "months" as totals. paidOutByAccount covers the last 3 months.'}
        title={ar ? 'اسأل' : 'Ask'}
        suggestions={ar
          ? ['كم كان صافي الربح في كل شهر؟', 'كم دفعنا لكل موظف في أكتوبر؟', 'ما الفواتير غير المدفوعة؟', 'ما أكبر 10 مصاريف في آخر 3 أشهر؟', 'كيف تغيّرت المبيعات اليومية في نوفمبر؟']
          : ['What was the net profit each month?', 'How much did we pay each employee in October?', 'Which bills are not paid?', 'What were the 10 biggest expenses in the last 3 months?', 'How did daily sales change in November?']} />
    </div>
  );
}

function Kpi({ label, value, sub, bad }) {
  return <div className="card kpi"><div className="label">{label}</div><div className={'value' + (bad ? ' down' : '')}>{value}</div>{sub && <div className="sub">{sub}</div>}</div>;
}
export { GROUPS };
