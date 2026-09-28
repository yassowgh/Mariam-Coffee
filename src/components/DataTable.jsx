import { useMemo, useState } from 'react';

/**
 * columns: [{ key, label, fmt?, align?: 'r', sortValue?(row), csv?(row), total?: 'sum' | (rows)=>any, title? }]
 * filters: { orders?: key, amount?: key } -> shows min/max inputs for those fields
 */
export default function DataTable({
  columns, rows, defaultSort, filters, exportName, onRowClick, pageSize = 100, footerNote, extraTools,
}) {
  const [sort, setSort] = useState(defaultSort || { key: columns[0].key, dir: 'asc' });
  const [f, setF] = useState({ oMin: '', oMax: '', aMin: '', aMax: '', q: '' });
  const [limit, setLimit] = useState(pageSize);

  const filtered = useMemo(() => {
    const num = (s) => (s === '' || s == null ? null : Number(s));
    const oMin = num(f.oMin), oMax = num(f.oMax), aMin = num(f.aMin), aMax = num(f.aMax);
    const q = f.q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filters?.orders) {
        const v = r[filters.orders];
        if (oMin != null && v < oMin) return false;
        if (oMax != null && v > oMax) return false;
      }
      if (filters?.amount) {
        const v = r[filters.amount];
        if (aMin != null && v < aMin) return false;
        if (aMax != null && v > aMax) return false;
      }
      if (filters?.search && q) {
        if (!String(r[filters.search] ?? '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [rows, f, filters]);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key) || columns[0];
    const get = col.sortValue || ((r) => r[col.key]);
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const x = get(a), y = get(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir;
    });
  }, [filtered, sort, columns]);

  function toggle(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  }

  function exportCsv() {
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = columns.map((c) => esc(c.label)).join(',');
    const body = sorted.map((r) => columns.map((c) => esc(c.csv ? c.csv(r) : r[c.key])).join(',')).join('\n');
    const blob = new Blob(['﻿' + head + '\n' + body], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${exportName || 'report'}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  const hasTotals = columns.some((c) => c.total);
  const totals = hasTotals ? Object.fromEntries(columns.map((c) => {
    if (!c.total) return [c.key, null];
    if (c.total === 'sum') return [c.key, sorted.reduce((s, r) => s + (Number(r[c.key]) || 0), 0)];
    return [c.key, c.total(sorted)];
  })) : null;

  const shown = sorted.slice(0, limit);
  const active = f.oMin || f.oMax || f.aMin || f.aMax || f.q;

  return (
    <div>
      <div className="table-tools">
        {filters?.search && (
          <label className="field">
            <span>Search</span>
            <input type="search" value={f.q} placeholder="Name…" onChange={(e) => setF({ ...f, q: e.target.value })} />
          </label>
        )}
        {filters?.orders && (
          <>
            <label className="field"><span>{filters.ordersLabel || 'Orders'} ≥</span>
              <input type="number" inputMode="numeric" value={f.oMin} onChange={(e) => setF({ ...f, oMin: e.target.value })} /></label>
            <label className="field"><span>{filters.ordersLabel || 'Orders'} ≤</span>
              <input type="number" inputMode="numeric" value={f.oMax} onChange={(e) => setF({ ...f, oMax: e.target.value })} /></label>
          </>
        )}
        {filters?.amount && (
          <>
            <label className="field"><span>{filters.amountLabel || 'Amount'} ≥ (TL)</span>
              <input type="number" inputMode="decimal" value={f.aMin} onChange={(e) => setF({ ...f, aMin: e.target.value })} /></label>
            <label className="field"><span>{filters.amountLabel || 'Amount'} ≤ (TL)</span>
              <input type="number" inputMode="decimal" value={f.aMax} onChange={(e) => setF({ ...f, aMax: e.target.value })} /></label>
          </>
        )}
        {active && <button className="btn small ghost" onClick={() => setF({ oMin: '', oMax: '', aMin: '', aMax: '', q: '' })}>Clear filters</button>}
        {extraTools}
        <span style={{ flex: 1 }} />
        <button className="btn small" onClick={exportCsv} title="Download the rows below as CSV (opens in Excel)">⬇ Export CSV</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.align === 'r' ? 'r' : ''} title={c.title}
                  aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button onClick={() => toggle(c.key)}>
                    {c.label}
                    <span aria-hidden="true" style={{ opacity: sort.key === c.key ? 1 : 0.25 }}>
                      {sort.key === c.key && sort.dir === 'asc' ? '▲' : '▼'}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={r.key ?? i} className={onRowClick ? 'clickable' : ''} onClick={onRowClick ? () => onRowClick(r) : undefined}>
                {columns.map((c) => (
                  <td key={c.key} className={(c.align === 'r' ? 'r num ' : '') + (c.cls ? c.cls(r) : '') + (c.name ? ' name' : '')}>
                    {c.render ? c.render(r) : c.fmt ? c.fmt(r[c.key], r) : r[c.key]}
                  </td>
                ))}
              </tr>
            ))}
            {!shown.length && (
              <tr><td colSpan={columns.length} className="muted" style={{ textAlign: 'center', padding: 24 }}>No rows match these filters.</td></tr>
            )}
          </tbody>
          {totals && shown.length > 0 && (
            <tfoot>
              <tr>
                {columns.map((c, i) => (
                  <td key={c.key} className={c.align === 'r' ? 'r num' : ''}>
                    {i === 0 ? 'Total' : totals[c.key] == null ? '' : c.fmt ? c.fmt(totals[c.key], totals) : totals[c.key]}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <div className="table-foot">
        <span>{sorted.length.toLocaleString()} rows{sorted.length !== rows.length ? ` (of ${rows.length.toLocaleString()})` : ''}{footerNote ? ` · ${footerNote}` : ''}</span>
        {sorted.length > limit && (
          <button className="btn small" onClick={() => setLimit(limit + pageSize * 5)}>Show more ({(sorted.length - limit).toLocaleString()} left)</button>
        )}
      </div>
    </div>
  );
}
