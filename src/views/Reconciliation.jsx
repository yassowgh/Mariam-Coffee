import { useMemo, useState } from 'react';
import DataTable from '../components/DataTable.jsx';
import { DOW } from '../lib/aggregate.js';
import { dailyProductCheck } from '../lib/model.js';
import { int, longDate, money2, monthLabel } from '../format.js';

const ok = (b) => <span className={'pill ' + (b ? 'ok' : 'bad')}>{b ? '✓ matches' : '✗ differs'}</span>;
const dow = (iso) => DOW[new Date(iso + 'T00:00:00Z').getUTCDay()];

export default function Reconciliation({ ctx }) {
  const { model, filters } = ctx;
  const { sources } = model;
  // run the products-vs-invoices check on the data as currently viewed (source + day boundary)
  const check = useMemo(() => dailyProductCheck(model.invoices), [model.invoices]);
  const recon = { ...model.recon, dailyCheck: check };
  const [onlyDiff, setOnlyDiff] = useState(true);
  const [mFrom, setMFrom] = useState(filters.from.slice(0, 7));
  const [mTo, setMTo] = useState(filters.to.slice(0, 7));

  const daily = useMemo(() => recon.dailyCheck.rows
    .filter((r) => r.date >= filters.from && r.date <= filters.to)
    .map((r) => ({ ...r, key: r.date, diff: Math.round((r.invGross - r.lineGross) * 100) / 100 })), [check, filters.from, filters.to]);

  const monthly = useMemo(() => {
    const m = new Map();
    for (const r of check.rows) {
      const k = r.date.slice(0, 7);
      if (k < mFrom || k > mTo) continue;
      const x = m.get(k) || { key: k, invGross: 0, lineGross: 0, invNet: 0, lineNet: 0 };
      x.invGross += r.invGross; x.lineGross += r.lineGross; x.invNet += r.invNet; x.lineNet += r.lineNet;
      m.set(k, x);
    }
    return [...m.values()].map((x) => ({ ...x, ok: Math.abs(x.invGross - x.lineGross) < 0.05 && Math.abs(x.invNet - x.lineNet) < 0.05 }));
  }, [check, mFrom, mTo]);
  const allMonths = useMemo(() => [...new Set(check.rows.map((r) => r.date.slice(0, 7)))].sort(), [check]);

  const posAcc = useMemo(() => recon.posVsAcc
    .filter((r) => r.date >= filters.from && r.date <= filters.to)
    .filter((r) => !onlyDiff || Math.abs(r.diff) > 0.01)
    .map((r) => ({ ...r, key: r.date, absDiff: Math.abs(r.diff) })), [recon, filters.from, filters.to, onlyDiff]);
  const posAccAll = recon.posVsAcc;
  const posAccDiffDays = posAccAll.filter((r) => Math.abs(r.diff) > 0.01).length;
  const posAccTotal = posAccAll.reduce((s, r) => s + r.accGross, 0);
  const posAccDiffSum = posAccAll.reduce((s, r) => s + r.diff, 0);
  const openTotal = recon.openTickets.reduce((s, t) => s + t.total, 0);
  const mismatchSum = recon.headerLineMismatches.reduce((s, r) => s + r.gap, 0);
  const allOk = recon.dailyCheck.failed === 0;

  return (
    <div className="stack">
      <div className="kpis" style={{ marginBottom: 0 }}>
        <div className="card kpi">
          <div className="label">Products sold = invoice totals, every day</div>
          <div className="value">{allOk ? '✓ All match' : `${recon.dailyCheck.failed} days differ`}</div>
          <div className="sub">{int(recon.dailyCheck.days)} business days checked, gross and net</div>
        </div>
        <div className="card kpi">
          <div className="label">Invoices whose lines ≠ header</div>
          <div className="value">{int(recon.headerLineMismatches.length)}</div>
          <div className="sub">{money2(mismatchSum)} kept as "Unallocated"</div>
        </div>
        <div className="card kpi">
          <div className="label">Lines without an invoice</div>
          <div className="value">{int(recon.orphanLines.count)}</div>
          <div className="sub">{money2(recon.orphanLines.amount)} (not counted)</div>
        </div>
        <div className="card kpi">
          <div className="label">Cash register vs accounting</div>
          <div className="value">{posAccAll.length ? `${posAccDiffDays} of ${posAccAll.length} days` : '–'}</div>
          <div className="sub">{posAccAll.length ? <>differ; net gap {money2(posAccDiffSum)} ({((posAccDiffSum / (posAccTotal || 1)) * 100).toFixed(2)}%)</> : 'only one source loaded'}</div>
        </div>
        <div className="card kpi">
          <div className="label">Open tables (not closed)</div>
          <div className="value">{int(recon.openTickets.length)}</div>
          <div className="sub">{money2(openTotal)}, not included in sales</div>
        </div>
        <div className="card kpi">
          <div className="label">Load time</div>
          <div className="value">{(model.loadMs / 1000).toFixed(1)}s</div>
          <div className="sub">{int(model.invoices.length)} invoices · {int(model.lineCount)} lines</div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div><h2>How the numbers are built</h2></div></div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, display: 'grid', gap: 6 }}>
          {sources.acc && <li><b>Accounting books</b> (Invoices + StockTransDetails) are the main source for {longDate(sources.acc.from)} – {longDate(sources.acc.to)}: {int(sources.acc.invoices)} invoices, including on-account invoices.</li>}
          {sources.pos && <li><b>Cash-register history</b> (CROldInvoices + CROldDetails) covers {longDate(sources.pos.from)} – {longDate(sources.pos.to)}. {sources.acc ? `${int(sources.pos.used)} tickets outside the accounting period are used; the rest are only compared below.` : 'It is the only source loaded.'}</li>}
          <li><b>Data source</b> (switch at the top): <b>Accounting</b> uses the books above. <b>Cash register</b> uses only the cash-register history, which matches the POS reports but misses receipts that exist only in the books.</li>
          <li><b>Day ends at</b>: <b>Closing</b> counts sales after midnight (until 05:00) toward the previous working day, the way the system books them. <b>Midnight</b> uses the calendar date.</li>
          <li><b>Gross</b> = sum of product lines (menu price × quantity). <b>Net</b> = gross − invoice discounts. Returns are subtracted.</li>
          <li>Every invoice is checked against its product lines. Any gap is booked on the product <b>“Unallocated (no line detail)”</b>, so product totals always equal invoice totals and nothing is silently dropped.</li>
          <li>Invoice discounts are shared across the invoice's lines in proportion to their value, so product <b>Net</b> also adds up exactly.</li>
          <li>Cancelled invoices and open (unclosed) tables are excluded.</li>
        </ul>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Monthly check: products sold vs invoice totals</h2>
            <p>Two ways of adding up the same sales. <b>Invoice totals</b> adds the total printed on each receipt/invoice. <b>Products sold</b> adds every product line (quantity × price) on those invoices. If the database is consistent the two are equal, which is what “✓ matches” means. It proves the product reports and the sales reports cover exactly the same money.</p>
          </div>
        </div>
        <DataTable exportName="reconciliation-monthly" rows={monthly} defaultSort={{ key: 'key', dir: 'desc' }}
          extraTools={<>
            <label className="field"><span>From month</span>
              <select value={mFrom} onChange={(e) => setMFrom(e.target.value)}>{allMonths.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select></label>
            <label className="field"><span>To month</span>
              <select value={mTo} onChange={(e) => setMTo(e.target.value)}>{allMonths.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select></label>
            <button className="btn small ghost" onClick={() => { setMFrom(allMonths[0]); setMTo(allMonths[allMonths.length - 1]); }}>All months</button>
          </>}
          columns={[
          { key: 'key', label: 'Month', fmt: monthLabel },
          { key: 'invGross', label: 'Invoice totals, before discount', align: 'r', fmt: money2, total: 'sum' },
          { key: 'lineGross', label: 'Products sold, before discount', align: 'r', fmt: money2, total: 'sum' },
          { key: 'invNet', label: 'Invoice totals, after discount', align: 'r', fmt: money2, total: 'sum' },
          { key: 'lineNet', label: 'Products sold, after discount', align: 'r', fmt: money2, total: 'sum' },
          { key: 'ok', label: 'Status', render: (r) => ok(r.ok), csv: (r) => (r.ok ? 'OK' : 'DIFF') },
        ]} />
      </div>

      <div className="card">
        <div className="card-head"><div><h2>Daily check: products sold vs invoice totals</h2><p>Same check per day, for the period selected at the top. Sort by “Status” or “Difference” to see problems first.</p></div></div>
        <DataTable exportName="reconciliation-daily" rows={daily} defaultSort={{ key: 'key', dir: 'desc' }} columns={[
          { key: 'key', label: 'Business day', fmt: (v) => `${dow(v)} ${longDate(v)}` },
          { key: 'invGross', label: 'Invoice totals, before discount', align: 'r', fmt: money2, total: 'sum' },
          { key: 'lineGross', label: 'Products sold, before discount', align: 'r', fmt: money2, total: 'sum' },
          { key: 'invNet', label: 'Invoice totals, after discount', align: 'r', fmt: money2, total: 'sum' },
          { key: 'lineNet', label: 'Products sold, after discount', align: 'r', fmt: money2, total: 'sum' },
          { key: 'diff', label: 'Difference', align: 'r', fmt: money2 },
          { key: 'ok', label: 'Status', render: (r) => ok(r.ok), sortValue: (r) => (r.ok ? 1 : 0), csv: (r) => (r.ok ? 'OK' : 'DIFF') },
        ]} />
      </div>

      <div className="card">
        <div className="card-head"><div><h2>Invoices whose product lines do not add up</h2><p>Found in the database as-is. The gap is shown as “Unallocated”.</p></div></div>
        {recon.headerLineMismatches.length ? (
          <DataTable exportName="invoice-line-mismatches" rows={recon.headerLineMismatches.map((r, i) => ({ ...r, key: i }))} defaultSort={{ key: 'date', dir: 'desc' }} columns={[
            { key: 'date', label: 'Business day', fmt: longDate },
            { key: 'source', label: 'Source' },
            { key: 'ref', label: 'Reference' },
            { key: 'invoiceGross', label: 'Invoice total', align: 'r', fmt: money2, total: 'sum' },
            { key: 'linesGross', label: 'Lines total', align: 'r', fmt: money2, total: 'sum' },
            { key: 'gap', label: 'Gap', align: 'r', fmt: money2, total: 'sum' },
          ]} />
        ) : <p className="muted">None. Every invoice equals the sum of its lines.</p>}
      </div>

      {posAccAll.length > 0 && (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Cash register vs accounting books</h2>
              <p>Your system keeps every sale in two places. The <b>cash register</b> (POS) writes a receipt when a table is closed (CROldInvoices.DB). Each receipt is then <b>posted to the accounting books</b> (Invoices.DB), which is what the accountant and the “Accounting” data source use. Normally both hold the same receipts. This table compares them per day (before discount, cash-register receipts only, on-account invoices excluded). A difference means receipts were edited, deleted or re-posted in one place and not the other. Positive = accounting has more.</p>
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, minHeight: 44 }}>
              <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} style={{ width: 18, height: 18 }} />
              Only days with a difference
            </label>
          </div>
          <DataTable exportName="pos-vs-accounting" rows={posAcc} defaultSort={{ key: 'absDiff', dir: 'desc' }} columns={[
            { key: 'key', label: 'Business day', fmt: (v) => `${dow(v)} ${longDate(v)}` },
            { key: 'posOrders', label: 'POS receipts', align: 'r', fmt: int, total: 'sum' },
            { key: 'accOrders', label: 'Posted receipts', align: 'r', fmt: int, total: 'sum' },
            { key: 'posGross', label: 'POS gross', align: 'r', fmt: money2, total: 'sum' },
            { key: 'accGross', label: 'Accounting gross', align: 'r', fmt: money2, total: 'sum' },
            { key: 'diff', label: 'Accounting − POS', align: 'r', fmt: money2, total: 'sum', cls: (r) => (r.diff > 0 ? 'up' : r.diff < 0 ? 'down' : '') },
            { key: 'absDiff', label: '|Diff|', align: 'r', fmt: money2 },
          ]} />
        </div>
      )}

      {recon.openTickets.length > 0 && (
        <div className="card">
          <div className="card-head"><div><h2>Open tables at the time of the backup</h2><p>From CRInvoices.DB. These are not closed yet, so they are not counted as sales.</p></div></div>
          <DataTable exportName="open-tables" rows={recon.openTickets.map((t, i) => ({ ...t, key: i }))} defaultSort={{ key: 'total', dir: 'desc' }} columns={[
            { key: 'table', label: 'Table' },
            { key: 'total', label: 'Total', align: 'r', fmt: money2, total: 'sum' },
            { key: 'net', label: 'Net', align: 'r', fmt: money2, total: 'sum' },
          ]} />
        </div>
      )}
    </div>
  );
}
