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

export default function Salaries() {
  const [month, setMonth] = useState(todayLocal().slice(0, 7));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  useEffect(() => {
    setData(null);
    api('salaries?month=' + month).then(setData).catch((e) => setError(e.message));
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
    { key: 'planned', label: 'Planned payments', align: 'r', fmt: (v) => (v ? money2(v) : '–'), total: 'sum' }]),
  ];
  const detail = result?.list.find((r) => r.key === open);
  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div><h2>{finance ? 'Salaries' : 'Monthly hours'} · {monthLabel(month)}</h2>
            <p>{!finance ? 'Days and hours worked per employee, from the timesheets.' : <>Hourly staff: worked hours from the timesheets × hourly rate. Monthly staff: their monthly salary. Advances and salary payments come from Accounting (records with the employee’s name). Set pay in <b>Team</b>.</>}</p></div>
          <label className="field"><span>Month</span><select value={month} onChange={(e) => setMonth(e.target.value)}>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select></label>
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        {!result ? <p className="muted">Loading…</p> : result.list.length ? (
          <DataTable columns={columns} rows={result.list} defaultSort={{ key: 'name', dir: 'asc' }} exportName={`salaries-${month}`} footerNote={finance ? 'click a name for the details; “Still to pay” in red = the café still owes, green = paid more than earned' : 'click a name for the days worked'} />
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
