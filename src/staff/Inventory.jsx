import { Fragment, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { longDate } from '../format.js';

const UNITS = ['L', 'ml', 'g', 'kg', 'bottles', 'cans', 'pieces', 'packs', 'boxes', 'bunches', 'bags'];
const TABS = [['stock', 'Stock'], ['count', 'Count'], ['delivery', 'Delivery / waste'], ['order', 'To order'], ['history', 'History']];
const n2 = (v) => (v == null || !Number.isFinite(Number(v)) ? '–' : (Math.round(Number(v) * 100) / 100).toLocaleString('en-US'));
const numIn = (s) => { const t = String(s ?? '').trim().replace(',', '.'); return t === '' ? null : Number(t); };

/** Inventory: what is in stock, counts, deliveries, waste and the list of what to order. */
export default function Inventory() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('stock');
  const [msg, setMsg] = useState(null);
  const [edit, setEdit] = useState(null); // item or {} for new
  const [historyOf, setHistoryOf] = useState(null);
  const load = () => api('inventory').then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const groups = useMemo(() => {
    if (!data) return [];
    const order = [...data.categories, ...new Set(data.items.map((x) => x.category).filter((c) => !data.categories.includes(c)))];
    return order.map((c) => ({ cat: c, items: data.items.filter((x) => x.category === c && x.active) })).filter((g) => g.items.length);
  }, [data]);

  if (error) return <div className="card"><div className="error" role="alert">{error}</div></div>;
  if (!data) return <div className="card"><p className="muted" style={{ margin: 0 }}>Loading…</p></div>;
  const lowItems = data.items.filter((x) => x.low);
  const done = (text) => { setMsg({ ok: true, text }); load(); window.scrollTo(0, 0); };

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div><h2>Inventory</h2><p>{data.items.filter((x) => x.active).length} items · {lowItems.length ? <b style={{ color: 'var(--bad-text)' }}>{lowItems.length} to order</b> : 'nothing to order'}. Stock changes with counts, deliveries and waste.</p></div>
          <button className="btn primary" onClick={() => setEdit({})}>＋ Add item</button>
        </div>
        <nav className="fin-tabs" role="tablist" aria-label="Inventory">
          {TABS.map(([k, l]) => <button key={k} role="tab" className={'btn' + (tab === k ? ' primary' : '')} aria-selected={tab === k} onClick={() => { setTab(k); setMsg(null); }}>{l}{k === 'order' && lowItems.length ? ` (${lowItems.length})` : ''}</button>)}
        </nav>
        {msg && <div className={'banner ' + (msg.ok ? 'ok' : 'bad')} role="status" style={{ marginTop: 10 }}><span>{msg.text}</span><button className="btn small ghost" onClick={() => setMsg(null)} aria-label="Dismiss">✕</button></div>}
      </div>

      {edit && <ItemForm item={edit} categories={[...new Set([...data.categories, ...data.items.map((x) => x.category)])]} onClose={() => setEdit(null)} onSaved={(t) => { setEdit(null); done(t); }} />}
      {historyOf && <History item={historyOf} onClose={() => setHistoryOf(null)} />}

      {tab === 'stock' && <StockTable groups={groups} onEdit={setEdit} onHistory={setHistoryOf} />}
      {tab === 'count' && <EntryForm kind="count" groups={groups} onDone={done} />}
      {tab === 'delivery' && <EntryForm kind="purchase" groups={groups} onDone={done} />}
      {tab === 'order' && <OrderList items={lowItems} categories={groups.map((g) => g.cat)} />}
      {tab === 'history' && <History />}
    </div>
  );
}

function status(x) {
  if (x.qty <= 0) return <span className="pill bad">Out</span>;
  if (x.min_qty != null && x.qty <= x.min_qty) return <span className="pill warn">Low</span>;
  if (x.min_qty == null) return <span className="pill" title="Set a minimum to get a warning before it runs out">No minimum</span>;
  return <span className="pill ok">OK</span>;
}

function StockTable({ groups, onEdit, onHistory }) {
  const [q, setQ] = useState('');
  const f = q.trim().toLowerCase();
  return (
    <div className="card">
      <input className="inv-search" type="search" placeholder="Find an item…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find an item" />
      <div className="table-wrap"><table>
        <thead><tr><th>Item</th><th className="r">In stock</th><th className="r">Minimum</th><th className="r" title="Average over the last 30 days, from counts and waste">Used / day</th><th className="r">Lasts</th><th>Status</th><th>Last count</th><th /></tr></thead>
        <tbody>
          {groups.map((g) => {
            const items = g.items.filter((x) => !f || x.name.toLowerCase().includes(f));
            if (!items.length) return null;
            return (
              <Fragment key={g.cat}>
                <tr className="inv-cat"><td colSpan={8}>{g.cat}</td></tr>
                {items.map((x) => (
                  <tr key={x.id}>
                    <td>{x.name}{x.note && <><br /><small className="muted">{x.note}</small></>}</td>
                    <td className="r num"><b>{n2(x.qty)}</b> {x.unit}</td>
                    <td className="r num">{x.min_qty == null ? '–' : `${n2(x.min_qty)} ${x.unit}`}</td>
                    <td className="r num">{x.use_per_day ? `${n2(x.use_per_day)} ${x.unit}` : '–'}</td>
                    <td className="r num">{x.use_per_day ? (x.qty / x.use_per_day >= 60 ? '60+ days' : `${Math.floor(x.qty / x.use_per_day)} days`) : '–'}</td>
                    <td>{status(x)}</td>
                    <td className="muted" style={{ fontSize: 13 }}>{x.counted_at ? longDate(x.counted_at.slice(0, 10)) : '–'}</td>
                    <td><span style={{ display: 'flex', gap: 2 }}><button className="btn small ghost" onClick={() => onEdit(x)}>Edit</button><button className="btn small ghost" onClick={() => onHistory(x)}>History</button></span></td>
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table></div>
    </div>
  );
}

/** Count (sets the level) or delivery / waste (adds / subtracts): one box per item, only filled boxes are saved. */
function EntryForm({ kind: start, groups, onDone }) {
  const [kind, setKind] = useState(start);
  const [vals, setVals] = useState({});
  const [note, setNote] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { setKind(start); setVals({}); }, [start]);
  const f = q.trim().toLowerCase();
  const filled = Object.entries(vals).filter(([, v]) => numIn(v) != null && Number.isFinite(numIn(v)));
  async function save() {
    setBusy(true); setErr('');
    try {
      const r = await api('inventory-moves', { method: 'POST', body: { kind, note, lines: filled.map(([id, v]) => ({ id: Number(id), qty: numIn(v) })) } });
      setVals({}); setNote('');
      onDone(kind === 'count' ? `Count saved for ${r.changed} items.` : kind === 'purchase' ? `Delivery added to ${r.changed} items.` : `Waste recorded for ${r.changed} items.`);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }
  const title = kind === 'count' ? 'Count the stock' : kind === 'purchase' ? 'Delivery: what came in' : 'Waste: what was thrown away';
  const help = kind === 'count' ? 'Type what is on the shelf now. Leave an item empty to keep it as it is.'
    : kind === 'purchase' ? 'Type how much arrived; it is added to the stock.' : 'Type how much was thrown away (expired, spilled, broken); it is taken off the stock.';
  return (
    <div className="card">
      <div className="card-head">
        <div><h2>{title}</h2><p>{help}</p></div>
        {start !== 'count' && (
          <div className="seg" role="group" aria-label="Type">
            <button aria-pressed={kind === 'purchase'} onClick={() => setKind('purchase')}>Delivery</button>
            <button aria-pressed={kind === 'waste'} onClick={() => setKind('waste')}>Waste</button>
          </div>
        )}
      </div>
      <input className="inv-search" type="search" placeholder="Find an item…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find an item" />
      <div className="inv-entry">
        {groups.map((g) => {
          const items = g.items.filter((x) => !f || x.name.toLowerCase().includes(f));
          if (!items.length) return null;
          return (
            <fieldset key={g.cat}>
              <legend>{g.cat}</legend>
              {items.map((x) => (
                <label key={x.id} className="inv-line">
                  <span>{x.name}<small className="muted"> · now {n2(x.qty)} {x.unit}</small></span>
                  <span className="inv-in">
                    <input inputMode="decimal" value={vals[x.id] ?? ''} placeholder={kind === 'count' ? n2(x.qty) : '0'} onChange={(e) => setVals((v) => ({ ...v, [x.id]: e.target.value }))} aria-label={`${x.name} in ${x.unit}`} />
                    <em>{x.unit}</em>
                  </span>
                </label>
              ))}
            </fieldset>
          );
        })}
      </div>
      <div className="inv-save">
        <label className="field" style={{ flex: 1, minWidth: 200 }}><span>Note (optional{kind === 'purchase' ? ', e.g. supplier or invoice' : ''})</span><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></label>
        <button className="btn primary" disabled={busy || !filled.length} onClick={save}>{busy ? 'Saving…' : `Save ${filled.length} item${filled.length === 1 ? '' : 's'}`}</button>
      </div>
      {err && <div className="banner bad" role="alert"><span>{err}</span></div>}
    </div>
  );
}

function OrderList({ items, categories }) {
  const [copied, setCopied] = useState(false);
  const text = categories.map((c) => {
    const l = items.filter((x) => x.category === c);
    return l.length ? `${c}:\n${l.map((x) => `- ${x.name}: ${x.qty <= 0 ? 'OUT' : `${n2(x.qty)} ${x.unit} left`}${x.min_qty != null ? ` (min ${n2(x.min_qty)})` : ''}`).join('\n')}` : '';
  }).filter(Boolean).join('\n\n');
  async function copy() { try { await navigator.clipboard.writeText(`Mariam Coffee – to order (${new Date().toLocaleDateString('en-GB')})\n\n${text}`); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* not allowed */ } }
  return (
    <div className="card">
      <div className="card-head">
        <div><h2>To order</h2><p>Everything that is out of stock or at / below its minimum. Items without a minimum only show here when they run out.</p></div>
        {items.length > 0 && <span style={{ display: 'flex', gap: 6 }}><button className="btn" onClick={copy}>{copied ? 'Copied ✓' : 'Copy list'}</button><button className="btn" onClick={() => window.print()}>Print</button></span>}
      </div>
      {!items.length ? <p className="muted">Nothing to order right now.</p> : categories.map((c) => {
        const l = items.filter((x) => x.category === c);
        if (!l.length) return null;
        return (
          <div key={c} style={{ marginBottom: 12 }}>
            <h3 style={{ fontSize: 15, margin: '6px 0' }}>{c}</h3>
            <ul className="inv-order">{l.map((x) => <li key={x.id}><span>{x.name}</span><span className="num">{x.qty <= 0 ? <b style={{ color: 'var(--bad-text)' }}>Out</b> : `${n2(x.qty)} ${x.unit} left`}{x.min_qty != null && <small className="muted"> · min {n2(x.min_qty)}</small>}</span></li>)}</ul>
          </div>
        );
      })}
    </div>
  );
}

const KIND = { count: 'Count', purchase: 'Delivery', waste: 'Waste', adjust: 'Correction' };
function History({ item, onClose }) {
  const [moves, setMoves] = useState(null);
  useEffect(() => { api('inventory-moves' + (item ? `?item=${item.id}` : '')).then((r) => setMoves(r.moves)).catch(() => setMoves([])); }, [item?.id]);
  return (
    <div className="card">
      <div className="card-head"><div><h2>History{item ? ` · ${item.name}` : ''}</h2><p>Latest 200 changes.</p></div>{onClose && <button className="btn ghost" onClick={onClose}>Close</button>}</div>
      {!moves ? <p className="muted">Loading…</p> : !moves.length ? <p className="muted">Nothing yet.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>When</th>{!item && <th>Item</th>}<th>Type</th><th className="r">Quantity</th><th className="r">Before → after</th><th>By</th><th>Note</th></tr></thead>
          <tbody>{moves.map((m) => (
            <tr key={m.id}>
              <td style={{ whiteSpace: 'nowrap' }}>{new Date(m.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</td>
              {!item && <td>{m.name}</td>}
              <td>{KIND[m.kind] || m.kind}</td>
              <td className="r num">{m.kind === 'purchase' ? '+' : m.kind === 'waste' ? '−' : ''}{n2(m.qty)} {m.unit}</td>
              <td className="r num">{m.before == null ? '–' : n2(m.before)} → {n2(m.after)}</td>
              <td>{m.user_name || '–'}</td>
              <td className="wrap-cell">{m.note || ''}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}

function ItemForm({ item, categories, onClose, onSaved }) {
  const isNew = !item.id;
  const [v, setV] = useState({ name: item.name || '', category: item.category || categories[0] || '', unit: item.unit || 'pieces', min_qty: item.min_qty ?? '', note: item.note || '', qty: '' });
  const [newCat, setNewCat] = useState('');
  const [fix, setFix] = useState({ qty: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  async function save(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const body = { name: v.name, category: newCat.trim() || v.category, unit: v.unit, min_qty: numIn(v.min_qty), note: v.note };
      if (isNew) await api('inventory', { method: 'POST', body: { ...body, qty: numIn(v.qty) || 0 } });
      else {
        await api(`inventory/${item.id}`, { method: 'PATCH', body });
        if (numIn(fix.qty) != null) await api('inventory-moves', { method: 'POST', body: { kind: 'adjust', note: fix.reason, lines: [{ id: item.id, qty: numIn(fix.qty), note: fix.reason }] } });
      }
      onSaved(isNew ? `Added ${v.name}.` : `Saved ${v.name}.`);
    } catch (x) { setErr(x.message); }
    setBusy(false);
  }
  async function remove() {
    if (!confirm(`Remove ${item.name} from the inventory? (Its history is kept.)`)) return;
    try { await api(`inventory/${item.id}`, { method: 'PATCH', body: { active: false } }); onSaved(`Removed ${item.name}.`); } catch (x) { setErr(x.message); }
  }
  return (
    <form className="card" onSubmit={save}>
      <div className="card-head"><div><h2>{isNew ? 'Add an item' : `Edit · ${item.name}`}</h2></div><button type="button" className="btn ghost" onClick={onClose}>Close</button></div>
      <div className="form-grid">
        <label className="field"><span>Name</span><input value={v.name} onChange={set('name')} required maxLength={80} /></label>
        <label className="field"><span>Category</span><select value={v.category} onChange={set('category')}>{categories.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="field"><span>…or a new category</span><input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="e.g. Cleaning" maxLength={60} /></label>
        <label className="field"><span>Unit</span><input list="inv-units" value={v.unit} onChange={set('unit')} required maxLength={20} /><datalist id="inv-units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist></label>
        <label className="field"><span>Minimum (warn at or below)</span><input inputMode="decimal" value={v.min_qty} onChange={set('min_qty')} placeholder="e.g. 5" /></label>
        {isNew && <label className="field"><span>In stock now</span><input inputMode="decimal" value={v.qty} onChange={set('qty')} placeholder="0" /></label>}
        <label className="field" style={{ gridColumn: '1 / -1' }}><span>Note (optional, e.g. supplier)</span><input value={v.note} onChange={set('note')} maxLength={300} /></label>
      </div>
      {!isNew && (
        <details style={{ marginTop: 10 }}><summary style={{ cursor: 'pointer', fontWeight: 600 }}>Correct the quantity (now {n2(item.qty)} {item.unit})</summary>
          <div className="form-grid" style={{ marginTop: 8 }}>
            <label className="field"><span>Correct quantity</span><input inputMode="decimal" value={fix.qty} onChange={(e) => setFix({ ...fix, qty: e.target.value })} /></label>
            <label className="field"><span>Reason (required)</span><input value={fix.reason} onChange={(e) => setFix({ ...fix, reason: e.target.value })} maxLength={300} /></label>
          </div>
        </details>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        {!isNew && <button type="button" className="btn ghost" onClick={remove}>Remove item</button>}
      </div>
      {err && <div className="banner bad" role="alert" style={{ marginTop: 8 }}><span>{err}</span></div>}
    </form>
  );
}

/** For everyone's home page: what is running out (names only). */
export function LowStockBanner() {
  const [low, setLow] = useState(null);
  useEffect(() => { api('inventory-low').then((r) => setLow(r.low)).catch(() => setLow([])); }, []);
  if (!low || !low.length) return null;
  const out = low.filter((x) => x.out), few = low.filter((x) => !x.out);
  return (
    <div className="banner warn" role="status" style={{ display: 'block' }}>
      <b>Running out</b>
      {out.length > 0 && <div style={{ marginTop: 4 }}>Out of stock: {out.map((x) => x.name).join(', ')}</div>}
      {few.length > 0 && <div style={{ marginTop: 4 }}>Low: {few.map((x) => `${x.name} (${n2(x.qty)} ${x.unit})`).join(', ')}</div>}
    </div>
  );
}
