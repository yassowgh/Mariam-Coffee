import { useMemo, useState } from 'react';
import { api, todayLocal } from '../lib/api.js';
import { ACCOUNT_TYPES, Loans, MarkPaid, RecordForm, Tile, total, useAccountingData } from './Accounting.jsx';
import DataTable from '../components/DataTable.jsx';
import Insights from './Insights.jsx';
import { BarLineChart } from '../components/charts.jsx';
import { longDate, money, money2, monthLabel } from '../format.js';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const shiftMonth = (m, n) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const inMonth = (date, m) => !!date && date.slice(0, 7) === m;
/** The month a record belongs to in Finance: its due month, else the month it was paid. */
const financeMonth = (r) => (r.due_date || (r.status === 'paid' ? r.paid_date || r.date : '') || '').slice(0, 7);

/** Finance: each month's payments that are due, what is late, what was paid out, and loans. */
export default function Finance({ user, go }) {
  const { loaded, error, ctx: base } = useAccountingData(user);
  const [month, setMonth] = useState(todayLocal().slice(0, 7));
  const [payFor, setPayFor] = useState(null);
  const [editing, setEditing] = useState(null);
  const [msg, setMsg] = useState(null);
  const ctx = { ...base, edit: (r) => { setEditing(r); window.scrollTo(0, 0); } };
  const { records, today } = base;

  const v = useMemo(() => {
    const start = month + '-01';
    const due = records.filter((r) => inMonth(r.due_date, month)).map((r) => ({ ...r, key: r.id, total: total(r) }));
    const late = records.filter((r) => r.status === 'scheduled' && r.due_date && r.due_date < start).map((r) => ({ ...r, key: r.id, total: total(r) }));
    const nodate = records.filter((r) => r.status === 'unpaid').map((r) => ({ ...r, key: r.id, total: total(r) }));
    const paidOut = records.filter((r) => r.status === 'paid' && inMonth(r.paid_date || r.date, month)).map((r) => ({ ...r, key: r.id, total: total(r) }));
    const sum = (l) => l.reduce((t, r) => t + r.total, 0);
    const byAccount = new Map(), byCat = new Map();
    for (const r of paidOut) {
      const k = r.account ? `${r.account}` : 'Not recorded';
      byAccount.set(k, (byAccount.get(k) || 0) + r.total);
      byCat.set(r.category, (byCat.get(r.category) || 0) + r.total);
    }
    // 6 months back, 5 ahead: paid vs still to pay, by the month each payment belongs to
    const chart = [];
    for (let i = -6; i <= 5; i++) {
      const m = shiftMonth(month, i);
      const list = records.filter((r) => financeMonth(r) === m);
      const paid = list.filter((r) => r.status === 'paid').reduce((t, r) => t + total(r), 0);
      const open = list.filter((r) => r.status !== 'paid').reduce((t, r) => t + total(r), 0);
      chart.push({ key: m, label: monthLabel(m).slice(0, 3) + ' ' + m.slice(2, 4), value: paid + open, parts: { paid, open },
        title: monthLabel(m), rows: [['Paid', money(paid), 'var(--series-1)'], ['Still to pay', money(open), 'var(--series-2)']] });
    }
    return {
      due, late, nodate, paidOut, chart,
      dueTotal: sum(due), duePaid: sum(due.filter((r) => r.status === 'paid')), dueOpen: sum(due.filter((r) => r.status !== 'paid')),
      lateTotal: sum(late), nodateTotal: sum(nodate), paidTotal: sum(paidOut),
      byAccount: [...byAccount].sort((a, b) => b[1] - a[1]), byCat: [...byCat].sort((a, b) => b[1] - a[1]),
    };
  }, [records, month]);

  // copy this month's planned payments (rent, salaries, bills…) to the next month
  async function planNext() {
    const next = shiftMonth(month, 1);
    const already = new Set(records.filter((r) => inMonth(r.due_date, next)).map((r) => (r.name || '').toLowerCase()));
    const rename = (name) => {
      const [y, mo] = month.split('-').map(Number), [ny, nmo] = next.split('-').map(Number);
      return name.replace(new RegExp(`${MONTH_NAMES[mo - 1]}(\\s+${y})?`, 'i'), (_, yr) => MONTH_NAMES[nmo - 1] + (yr ? ' ' + ny : ''));
    };
    const list = v.due.map((r) => ({ ...r, name: rename(r.name) })).filter((r) => !already.has((r.name || '').toLowerCase()));
    if (!list.length) { setMsg({ ok: false, text: `Nothing to copy: ${monthLabel(next)} already has these payments, or ${monthLabel(month)} has none planned.` }); return; }
    if (!confirm(`Plan ${list.length} payments for ${monthLabel(next)} (${money(list.reduce((t, r) => t + r.total, 0))}), on the same day of the month?`)) return;
    const lastDay = new Date(Date.UTC(Number(next.slice(0, 4)), Number(next.slice(5, 7)), 0)).getUTCDate();
    try {
      for (const r of list) {
        const day = Math.min(Number(r.due_date.slice(8, 10)), lastDay);
        const due = `${next}-${String(day).padStart(2, '0')}`;
        await api('expenses', { method: 'POST', body: {
          name: r.name, category_id: r.category_id, amount: r.amount, fees: r.fees, date: due, status: 'scheduled', due_date: due,
          kind: r.kind === 'loan_repayment' ? 'loan_repayment' : 'regular', loan_account_id: r.loan_account_id, payee: r.payee, payee_type: r.payee_type,
          employee: r.employee, employee_user_id: r.employee_user_id, paid_by: r.paid_by, reason: r.reason,
        } });
      }
      setMsg({ ok: true, text: `Planned ${list.length} payments for ${monthLabel(next)}.` });
      base.reload();
    } catch (e) { setMsg({ ok: false, text: e.message }); }
  }

  const status = (r) => (r.status === 'paid'
    ? <span className="pill ok">Paid {r.paid_date ? longDate(r.paid_date) : ''}{r.account ? ` · ${r.account}` : ''}</span>
    : r.status === 'scheduled' && r.due_date < today ? <span className="pill bad">Late</span> : <span className="pill warn">To pay</span>);
  const actions = (r) => (
    <span style={{ display: 'flex', gap: 2 }}>
      {r.status !== 'paid' && <button className="btn small" onClick={() => setPayFor(r)}>Mark paid</button>}
      {(base.owner || r.user_id === user.id) && <button className="btn small ghost" onClick={() => ctx.edit(r)}>Edit</button>}
    </span>
  );
  const cols = (dateKey, dateLabel) => [
    { key: dateKey, label: dateLabel, fmt: (d) => (d ? longDate(d) : '–'), sortValue: (r) => r[dateKey] || '' },
    { key: 'name', label: 'What', render: (r) => <span className="wrap-cell">{r.name}</span> },
    { key: 'category', label: 'Category' },
    { key: 'payee', label: 'To', fmt: (x, r) => x || r.employee || '–' },
    { key: 'total', label: 'Amount', align: 'r', fmt: money2, total: 'sum', csv: (r) => r.total.toFixed(2) },
    { key: 'status', label: 'Status', render: status, csv: (r) => r.status },
    { key: 'act', label: '', render: actions, csv: () => '' },
  ];

  if (error) return <div className="error" role="alert">{error}</div>;
  if (!loaded) return <div className="card"><p className="muted" style={{ margin: 0 }}>Loading…</p></div>;
  return (
    <div className="stack">
      {editing && <RecordForm ctx={ctx} initial={editing} onDone={() => { setEditing(null); base.reload(); }} onCancel={() => setEditing(null)} />}
      {payFor && <MarkPaid ctx={base} record={payFor} onClose={() => setPayFor(null)} />}

      <div className="card">
        <div className="card-head">
          <div><h2>Finance · {monthLabel(month)}</h2><p>Payments due this month, what is late, and what was paid out. Add or correct records in <button className="linklike" style={{ textDecoration: 'underline' }} onClick={() => go?.('accounting')}>Accounting</button>.</p></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div className="seg" role="group" aria-label="Month">
              <button onClick={() => setMonth(shiftMonth(month, -1))}>‹ Prev</button>
              <button aria-pressed={month === today.slice(0, 7)} onClick={() => setMonth(today.slice(0, 7))}>This month</button>
              <button onClick={() => setMonth(shiftMonth(month, 1))}>Next ›</button>
            </div>
            <button className="btn" onClick={planNext} disabled={!v.due.length} title="Copy this month’s planned payments to next month">Plan {monthLabel(shiftMonth(month, 1))} like this month</button>
          </div>
        </div>
        {msg && <div className={'banner ' + (msg.ok ? 'ok' : 'bad')} role="status"><span>{msg.text}</span><button className="btn small ghost" onClick={() => setMsg(null)} aria-label="Dismiss">✕</button></div>}
        <div className="kpis" style={{ marginBottom: 0 }}>
          <Tile label={`Due in ${monthLabel(month)}`} value={money(v.dueTotal)} sub={`${money(v.duePaid)} paid · ${money(v.dueOpen)} to pay`} />
          <Tile label="Late from earlier months" value={money(v.lateTotal)} sub={`${v.late.length} bills`} bad={v.late.length > 0} />
          <Tile label="Unpaid, no date" value={money(v.nodateTotal)} sub={`${v.nodate.length} bills`} />
          <Tile label={`Paid out in ${monthLabel(month)}`} value={money(v.paidTotal)} sub={`${v.paidOut.length} payments`} />
        </div>
      </div>

      <Insights records={records} month={month} today={today} />

      <div className="card">
        <div className="card-head"><div><h2>Month by month</h2><p>Each payment counts in the month it is due (or, if it had no due date, the month it was paid).</p></div></div>
        <BarLineChart height={220} data={v.chart} series={[{ key: 'paid', label: 'Paid', color: 'var(--series-1)' }, { key: 'open', label: 'Still to pay', color: 'var(--series-2)' }]}
          onBarClick={(d) => setMonth(d.key)} highlightKey={month} />
        <p className="faint" style={{ fontSize: 12.5, margin: '6px 0 0' }}>Tap a month to open it.</p>
      </div>

      <div className="card">
        <div className="card-head"><div><h2>Due in {monthLabel(month)}</h2><p>Planned payments with a due date in this month, paid or not.</p></div></div>
        {v.due.length ? <DataTable columns={cols('due_date', 'Due')} rows={v.due} defaultSort={{ key: 'due_date', dir: 'asc' }} exportName={`due-${month}`} filters={{ search: 'name' }} />
          : <p className="muted">No payments planned for this month. Add them in Accounting with “To be paid on a date”, or use “Plan … like this month” from the month before.</p>}
      </div>

      {v.late.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--bad)' }}>
          <div className="card-head"><div><h2>Late, from before {monthLabel(month)}</h2><p>Due earlier and still not paid.</p></div></div>
          <DataTable columns={cols('due_date', 'Was due')} rows={v.late} defaultSort={{ key: 'due_date', dir: 'asc' }} exportName={`late-before-${month}`} />
        </div>
      )}

      {v.nodate.length > 0 && (
        <details className="card">
          <summary style={{ cursor: 'pointer', fontWeight: 650 }}>Unpaid, no date yet · {v.nodate.length} bills · {money(v.nodateTotal)}</summary>
          <div style={{ marginTop: 12 }}><DataTable columns={cols('date', 'Expense date')} rows={v.nodate} defaultSort={{ key: 'total', dir: 'desc' }} exportName="unpaid-no-date" /></div>
        </details>
      )}

      <div className="grid two">
        <div className="card">
          <div className="card-head"><div><h2>Paid out in {monthLabel(month)}, by account</h2><p>Cash, banks and loans used.</p></div></div>
          {v.byAccount.length ? <Bars list={v.byAccount} /> : <p className="muted">Nothing paid this month yet.</p>}
        </div>
        <div className="card">
          <div className="card-head"><div><h2>Paid out in {monthLabel(month)}, by category</h2><p>All payments made this month.</p></div></div>
          {v.byCat.length ? <Bars list={v.byCat} /> : <p className="muted">Nothing paid this month yet.</p>}
        </div>
      </div>

      <Loans ctx={base} onRepay={(acc) => setEditing({ kind: 'loan_repayment', loan_account_id: acc.id, name: `Paying back ${acc.name}`, status: 'paid' })} />
      <p className="faint" style={{ fontSize: 12.5 }}>Account kinds: {Object.values(ACCOUNT_TYPES).join(' · ')}.</p>
    </div>
  );
}

function Bars({ list }) {
  return (
    <ul className="barlist">{list.slice(0, 12).map(([n, val]) => (
      <li key={n}><span className="name">{n}</span><span className="val">{money(val)}</span><div className="track"><div className="fill" style={{ width: `${(val / list[0][1]) * 100}%` }} /></div></li>
    ))}</ul>
  );
}
