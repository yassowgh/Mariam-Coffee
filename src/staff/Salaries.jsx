import { useEffect, useMemo, useState } from 'react';
import { api, hoursFmt, shiftHours, toLocal, todayLocal } from '../lib/api.js';
import DataTable from '../components/DataTable.jsx';
import { int, longDate, money, money2, monthLabel } from '../format.js';

const STALE_H = 16;
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').trim();

/** Which staff member a payment belongs to: the linked account, else the full name, else a unique first name. */
function matcher(people) {
  const firsts = new Map();
  for (const p of people) { const f = norm(p.name).split(/\s+/)[0]; firsts.set(f, firsts.has(f) ? null : p); }
  return (pay) => {
    if (pay.employee_user_id) return people.find((p) => p.id === pay.employee_user_id) || null;
    const e = norm(pay.employee);
    if (!e) return null;
    return people.find((p) => norm(p.name) === e) || firsts.get(e.split(/[\s-]+/)[0]) || null;
  };
}

export default function Salaries({ user }) {
  const [month, setMonth] = useState(todayLocal().slice(0, 7));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const [closed, setClosed] = useState(null); // the locked figures of a closed month
  const [pmsg, setPmsg] = useState(null);
  const owner = !!user?.roles.includes('owner');
  const loadClosed = () => api('payroll?month=' + month).then(setClosed).catch(() => setClosed({ closed: false }));
  useEffect(() => {
    setData(null); setClosed(null); setPmsg(null);
    api('salaries?month=' + month).then((d) => { setData(d); if (d.finance) loadClosed(); }).catch((e) => setError(e.message));
  }, [month]);

  const result = useMemo(() => {
    if (!data) return null;
    const people = data.people;
    const who = matcher(people);
    const now = Date.now();
    const rows = new Map();
    const row = (p) => {
      if (!rows.has(p.id)) rows.set(p.id, { key: p.id, p, name: p.name, payType: p.pay_type, hours: 0, schedH: 0, days: new Set(), missing: 0, advances: 0, paid: 0, planned: 0, records: [], payments: [] });
      return rows.get(p.id);
    };
    for (const p of people) if (p.pay_type && p.active) row(p);
    for (const a of data.attendance) {
      const p = people.find((x) => x.id === a.user_id);
      if (!p) continue;
      const r = row(p);
      r.records.push(a);
      if (a.out_at) { r.hours += (Date.parse(a.out_at) - Date.parse(a.in_at)) / 3600000; r.days.add(toLocal(a.in_at).date); } else if (now - Date.parse(a.in_at) > STALE_H * 3600000) r.missing++;
    }
    for (const s of data.shifts) { const p = people.find((x) => x.id === s.user_id); if (p) row(p).schedH += shiftHours(s); }
    const others = new Map();
    for (const pay of data.payments) {
      const amt = pay.amount + (pay.fees || 0);
      const p = who(pay);
      const isAdvance = pay.kind === 'advance';
      if (!p) {
        if (!pay.employee) continue;
        const o = others.get(pay.employee) || { key: pay.employee, name: pay.employee, advances: 0, paid: 0, planned: 0, n: 0 };
        if (pay.status !== 'paid') o.planned += amt; else if (isAdvance) o.advances += amt; else o.paid += amt;
        o.n++;
        others.set(pay.employee, o);
        continue;
      }
      const r = row(p);
      r.payments.push(pay);
      if (pay.status !== 'paid') r.planned += amt; else if (isAdvance) r.advances += amt; else r.paid += amt;
    }
    const list = [...rows.values()].map((r) => {
      const gross = r.payType === 'hourly' ? r.hours * (r.p.rate || 0) : r.payType === 'monthly' ? (r.p.monthly_salary || 0) : null;
      return { ...r, dayCount: r.days.size, gross, balance: gross == null ? null : gross - r.advances - r.paid };
    });
    return { list, others: [...others.values()] };
  }, [data]);

  const months = useMemo(() => {
    const out = [];
    const [y, m] = todayLocal().slice(0, 7).split('-').map(Number);
    for (let i = 0; i < 12; i++) { const d = new Date(Date.UTC(y, m - 1 - i, 1)); out.push(d.toISOString().slice(0, 7)); }
    return out;
  }, []);

  const finance = !!data?.finance; // a manager sees hours only
  const money_ = (cols) => (finance ? cols : []);
  const columns = [
    { key: 'name', label: 'Employee', render: (r) => <button className="linklike" onClick={() => setOpen(open === r.key ? null : r.key)}>{r.name}</button>, csv: (r) => r.name },
    ...money_([{ key: 'payType', label: 'Paid', fmt: (v, r) => (v === 'hourly' ? `${money(r.p.rate)} / hour` : v === 'monthly' ? `${money(r.p.monthly_salary)} / month` : 'not set') }]),
    { key: 'dayCount', label: 'Days', align: 'r', fmt: int, total: 'sum' },
    { key: 'schedH', label: 'Scheduled', align: 'r', fmt: hoursFmt, total: 'sum', csv: (r) => r.schedH.toFixed(2) },
    { key: 'hours', label: 'Worked', align: 'r', fmt: hoursFmt, total: 'sum', csv: (r) => r.hours.toFixed(2) },
    { key: 'missing', label: 'No clock-out', align: 'r', fmt: (v) => (v ? int(v) : '–'), cls: (r) => (r.missing ? 'down' : '') },
    ...money_([{ key: 'gross', label: 'Salary earned', align: 'r', fmt: (v) => (v == null ? '–' : money2(v)), total: 'sum', csv: (r) => (r.gross == null ? '' : r.gross.toFixed(2)) },
    { key: 'advances', label: 'Advances', align: 'r', fmt: money2, total: 'sum', csv: (r) => r.advances.toFixed(2) },
    { key: 'paid', label: 'Salary paid', align: 'r', fmt: money2, total: 'sum', csv: (r) => r.paid.toFixed(2) },
    { key: 'balance', label: 'Still to pay', align: 'r', fmt: (v) => (v == null ? '–' : money2(v)), total: 'sum', cls: (r) => (r.balance > 0.5 ? 'down' : r.balance < -0.5 ? 'up' : ''), csv: (r) => (r.balance == null ? '' : r.balance.toFixed(2)) },
    { key: 'planned', label: 'Planned payments', align: 'r', fmt: (v) => (v ? money2(v) : '–'), total: 'sum' },
    { key: 'slip', label: 'Payslip', render: (r) => (r.gross == null ? null : (
      <span style={{ display: 'flex', gap: 2 }}>
        <button className="btn small ghost" onClick={() => printSlip(r, month, closed)} title="Open the payslip to print or save as PDF">🖨 PDF</button>
        <button className="btn small ghost" onClick={() => emailSlip(r)} title="Email the payslip to the employee">✉</button>
      </span>)), csv: () => '' }]),
  ];
  // a closed month shows the figures as they were when it was closed
  const rows = closed?.closed ? closed.rows : result?.list;
  const detail = rows?.find((r) => r.key === open);
  const plain = (r) => ({ key: r.key, name: r.name, payType: r.payType, p: { id: r.p.id, rate: r.p.rate, monthly_salary: r.p.monthly_salary }, dayCount: r.dayCount, schedH: r.schedH,
    hours: r.hours, missing: r.missing, gross: r.gross, advances: r.advances, paid: r.paid, balance: r.balance, planned: r.planned,
    records: r.records.map((a) => ({ in_at: a.in_at, out_at: a.out_at, edited_by: a.edited_by })),
    payments: r.payments.map((x) => ({ id: x.id, date: x.date, name: x.name, kind: x.kind, status: x.status, due_date: x.due_date, amount: x.amount, fees: x.fees })) });
  async function closeMonth() {
    if (!confirm(`Close the payroll of ${monthLabel(month)}? The figures are kept exactly as they are now. Only the owner can reopen it.`)) return;
    try { await api('payroll', { method: 'POST', body: { month, rows: result.list.map(plain) } }); loadClosed(); setPmsg({ ok: true, text: `${monthLabel(month)} is closed.` }); } catch (e) { setPmsg({ ok: false, text: e.message }); }
  }
  async function reopen() {
    if (!confirm(`Reopen ${monthLabel(month)}? The figures will follow the timesheets and Accounting again.`)) return;
    try { await api('payroll?month=' + month, { method: 'DELETE' }); loadClosed(); } catch (e) { setPmsg({ ok: false, text: e.message }); }
  }
  async function emailSlip(r) {
    try {
      const { html, text } = payslip(r, month, closed);
      const res = await api('payroll/email', { method: 'POST', body: { month, user_id: r.p.id, html, text } });
      setPmsg({ ok: true, text: `Payslip sent to ${r.name} (${res.to}).` });
    } catch (e) { setPmsg({ ok: false, text: e.message }); }
  }
  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div><h2>{finance ? 'Salaries' : 'Monthly hours'} · {monthLabel(month)}</h2>
            <p>{!finance ? 'Days and hours worked per employee, from the timesheets.' : <>Hourly staff: worked hours from the timesheets × hourly rate. Monthly staff: their monthly salary. Advances and salary payments come from Accounting (records with the employee’s name). Set pay in <b>Team</b>.</>}</p></div>
          <label className="field"><span>Month</span><select value={month} onChange={(e) => setMonth(e.target.value)}>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select></label>
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        {finance && closed && (
          <div className={'banner ' + (closed.closed ? 'ok' : 'info')} style={{ alignItems: 'center' }}>
            <span>{closed.closed ? <>🔒 <b>Closed</b> by {closed.closed_by || '–'} on {longDate(closed.closed_at.slice(0, 10))}. These figures are locked.</> : <>This month is open: figures follow the timesheets and Accounting. Close it when salaries are settled.</>}</span>
            {closed.closed ? owner && <button className="btn small" onClick={reopen}>Reopen</button> : <button className="btn small primary" onClick={closeMonth} disabled={!result?.list.length}>🔒 Close {monthLabel(month)}</button>}
          </div>
        )}
        {pmsg && <div className={'banner ' + (pmsg.ok ? 'ok' : 'bad')} role="status"><span>{pmsg.text}</span><button className="btn small ghost" onClick={() => setPmsg(null)} aria-label="Dismiss">✕</button></div>}
        {!rows ? <p className="muted">Loading…</p> : rows.length ? (
          <DataTable columns={columns} rows={rows} defaultSort={{ key: 'name', dir: 'asc' }} exportName={`salaries-${month}`} footerNote={finance ? 'click a name for the details; “Still to pay” in red = the café still owes, green = paid more than earned' : 'click a name for the days worked'} />
        ) : <p className="muted">Nobody is on the payroll yet. In <b>Team</b>, edit a person and choose “Per hour” or “Monthly salary”.</p>}
      </div>
      {detail && (
        <div className="grid two">
          <div className="card">
            <div className="card-head"><div><h2>{detail.name}: worked</h2><p>{hoursFmt(detail.hours)} on {detail.dayCount} days</p></div><button className="btn small ghost" onClick={() => setOpen(null)}>Close</button></div>
            {detail.records.length ? (
              <div className="table-wrap"><table>
                <thead><tr><th>Date</th><th>In</th><th>Out</th><th className="r">Hours</th></tr></thead>
                <tbody>{[...detail.records].sort((a, b) => (a.in_at < b.in_at ? -1 : 1)).map((a) => (
                  <tr key={a.in_at}><td>{longDate(toLocal(a.in_at).date)}</td><td>{toLocal(a.in_at).time}</td><td>{a.out_at ? toLocal(a.out_at).time : <span className="down">missing</span>}</td>
                    <td className="r num">{a.out_at ? hoursFmt((Date.parse(a.out_at) - Date.parse(a.in_at)) / 3600000) : '–'}{a.edited_by ? ' ✎' : ''}</td></tr>))}</tbody>
              </table></div>
            ) : <p className="muted">No clock-ins this month.</p>}
          </div>
          {finance && <div className="card">
            <div className="card-head"><div><h2>{detail.name}: payments</h2><p>From Accounting</p></div></div>
            {detail.payments.length ? (
              <div className="table-wrap"><table>
                <thead><tr><th>Date</th><th>What</th><th>Status</th><th className="r">Amount</th></tr></thead>
                <tbody>{detail.payments.map((p) => (
                  <tr key={p.id}><td>{p.date ? longDate(p.date) : '–'}</td><td>{p.name}{p.kind === 'advance' && <span className="pill" style={{ marginLeft: 6 }}>advance</span>}</td>
                    <td>{p.status === 'paid' ? 'paid' : p.status === 'scheduled' ? `due ${longDate(p.due_date)}` : 'unpaid'}</td><td className="r num">{money2(p.amount + (p.fees || 0))}</td></tr>))}</tbody>
              </table></div>
            ) : <p className="muted">No salary payments or advances recorded for this month.</p>}
          </div>}
        </div>
      )}
      {finance && result?.others.length > 0 && (
        <div className="card">
          <div className="card-head"><div><h2>Other people paid this month</h2><p>Names in Accounting that are not a website account (so no timesheet). Give them an account in Team to link them.</p></div></div>
          <DataTable rows={result.others} exportName={`other-payments-${month}`} defaultSort={{ key: 'paid', dir: 'desc' }}
            columns={[
              { key: 'name', label: 'Name' },
              { key: 'n', label: 'Records', align: 'r', fmt: int, total: 'sum' },
              { key: 'advances', label: 'Advances', align: 'r', fmt: money2, total: 'sum' },
              { key: 'paid', label: 'Paid', align: 'r', fmt: money2, total: 'sum' },
              { key: 'planned', label: 'Planned', align: 'r', fmt: (v) => (v ? money2(v) : '–'), total: 'sum' },
            ]} />
        </div>
      )}
    </div>
  );
}

/** The payslip as an HTML page (English and Arabic labels); printed or saved as PDF from the browser, or emailed. */
function payslip(r, month, closed) {
  const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const m2 = (v) => (v == null ? '–' : money2(v));
  const pay = r.payType === 'hourly' ? `${m2(r.p.rate)} per hour / بالساعة` : r.payType === 'monthly' ? `${m2(r.p.monthly_salary)} per month / شهرياً` : '–';
  const line = (en, ar, v, strong) => `<tr><td>${en}<br><span class="ar">${ar}</span></td><td class="v">${strong ? `<b>${v}</b>` : v}</td></tr>`;
  const pays = (r.payments || []).map((p) => `<tr><td>${esc(p.date || '')}</td><td>${esc(p.name)}${p.kind === 'advance' ? ' (advance / سلفة)' : ''}</td><td>${p.status === 'paid' ? 'paid / مدفوع' : 'planned / مخطط'}</td><td class="v">${m2(p.amount + (p.fees || 0))}</td></tr>`).join('');
  const status = closed?.closed ? `Closed ${esc((closed.closed_at || '').slice(0, 10))} / مغلق` : 'Not closed yet / غير مغلق بعد';
  const body = `<div class="slip">
<div class="top"><div><div class="brand">MARIAM COFFEE</div><h1>Payslip <span class="ar">قسيمة الراتب</span></h1></div><div class="meta">${esc(monthLabel(month))}<br>${status}</div></div>
<table class="who"><tr><td>Employee / الموظف</td><td class="v"><b>${esc(r.name)}</b></td></tr><tr><td>Pay / الأجر</td><td class="v">${pay}</td></tr></table>
<table class="sum">
${line('Days worked', 'أيام العمل', r.dayCount ?? 0)}
${line('Hours worked', 'ساعات العمل', hoursFmt(r.hours || 0))}
${line('Salary earned', 'الراتب المستحق', m2(r.gross))}
${line('Advances', 'السلف', m2(r.advances))}
${line('Salary already paid', 'الراتب المدفوع', m2(r.paid))}
${line(r.balance > 0.5 ? 'Still to pay' : r.balance < -0.5 ? 'Paid more than earned' : 'Balance', r.balance > 0.5 ? 'المتبقي للدفع' : r.balance < -0.5 ? 'مدفوع أكثر من المستحق' : 'الرصيد', m2(Math.abs(r.balance || 0)), true)}
</table>
${pays ? `<h2>Payments this month <span class="ar">دفعات هذا الشهر</span></h2><table class="pays"><tr><th>Date</th><th>What</th><th>Status</th><th class="v">Amount</th></tr>${pays}</table>` : ''}
<div class="sign"><div>Employee signature / توقيع الموظف</div><div>Mariam Coffee</div></div>
</div>`;
  const css = `body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;background:#fff}.slip{max-width:720px;margin:24px auto;padding:24px;border:1px solid #ddd;border-radius:10px}
.top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #6b4226;padding-bottom:10px;margin-bottom:14px}.brand{color:#6b4226;font-weight:bold;letter-spacing:.05em;font-size:12px}
h1{font-size:22px;margin:4px 0 0}h2{font-size:15px;margin:18px 0 6px}.meta{text-align:right;font-size:13px;color:#444}.ar{font-family:Tahoma,Arial,sans-serif;color:#555;font-weight:normal;font-size:.9em}
table{width:100%;border-collapse:collapse;font-size:14px}td,th{padding:7px 6px;border-bottom:1px solid #eee;text-align:left;vertical-align:top}.v{text-align:right;white-space:nowrap}
.who td{border:0;padding:3px 6px}.sum tr:last-child td{border-top:2px solid #111;font-size:16px}.sign{display:flex;justify-content:space-between;margin-top:48px;font-size:13px;color:#444}
.sign div{border-top:1px solid #999;padding-top:6px;width:42%}@media print{.slip{border:0;margin:0}}`;
  const text = `Payslip ${monthLabel(month)} - ${r.name}\nDays worked: ${r.dayCount ?? 0}\nHours worked: ${hoursFmt(r.hours || 0)}\nSalary earned: ${m2(r.gross)}\nAdvances: ${m2(r.advances)}\nSalary already paid: ${m2(r.paid)}\nBalance: ${m2(r.balance)}`;
  return { html: `<!doctype html><html><head><meta charset="utf-8"><title>Payslip ${esc(r.name)} ${esc(month)}</title><style>${css}</style></head><body>${body}</body></html>`, text };
}

function printSlip(r, month, closed) {
  const { html } = payslip(r, month, closed);
  const w = window.open('', '_blank');
  if (!w) { alert('Allow pop-ups for this site to open the payslip.'); return; }
  w.document.write(html);
  w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch { /* window closed */ } }, 300);
}
