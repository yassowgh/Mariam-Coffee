import { useMemo, useRef, useState } from 'react';
import { productRows, summarize } from '../lib/aggregate.js';
import { DEFAULT_LINKS, makeCostConfig, parseCostWorkbook, unitCosts } from '../lib/costs.js';
import DataTable from '../components/DataTable.jsx';
import { dec1, int, longDate, money, money2, pct, shortDate } from '../format.js';
import { ChangeCell, marginFmt } from './common.jsx';

const LOW_MARGIN = 0.6; // flag items keeping less than 60% of their price

/** Menu-engineering class (Kasavana & Smith): popularity vs profit per item. */
export function menuEngineering(rows) {
  const items = rows.filter((r) => r.costed && r.qty > 0 && !r.unallocated);
  const totalQty = items.reduce((s, r) => s + r.qty, 0);
  const totalProfit = items.reduce((s, r) => s + r.profit, 0);
  const popLine = items.length ? (1 / items.length) * 0.7 : 0; // 70% of an equal share of sales
  const profitLine = totalQty ? totalProfit / totalQty : 0; // average profit per item sold
  for (const r of items) {
    const popular = totalQty ? r.qty / totalQty >= popLine : false;
    const profitable = r.unitProfit >= profitLine;
    r.menuClass = popular ? (profitable ? 'Star' : 'Workhorse') : profitable ? 'Puzzle' : 'Dog';
  }
  return { items, profitLine, popLine };
}

export const MENU_CLASSES = [
  ['Star', 'Popular and profitable', 'Keep them visible and consistent. Do not discount.'],
  ['Workhorse', 'Popular, low profit per item', 'Check recipe cost or raise the price slightly; pair with high-profit add-ons.'],
  ['Puzzle', 'Profitable, not popular', 'Promote them: menu position, staff suggestions, combos.'],
  ['Dog', 'Not popular, low profit', 'Candidates to remove or rework.'],
];

/** Products ranked by gross profit in the period, with share of profit and profit per day. */
export function profitRanking(model, invs, prevInvs) {
  const rows = productRows(model, invs, prevInvs, 'profit').filter((r) => r.costed && !r.unallocated);
  const days = new Set(invs.map((i) => i.date)).size || 1;
  const total = rows.reduce((s, r) => s + (r.profit || 0), 0);
  for (const r of rows) {
    r.profitShare = total ? r.profit / total : 0;
    r.profitPerDay = r.profit / days;
    r.qtyPerDay = r.qty / days;
  }
  return { rows: rows.sort((a, b) => b.profit - a.profit), total, days };
}

export default function Profit({ ctx }) {
  return ctx.model.hasCosts ? <ProfitReport ctx={ctx} /> : <CostSetup ctx={ctx} />;
}

function ProfitReport({ ctx }) {
  const { model, invs, prevInvs, prevFrom, prevTo, costs, openProduct, filters } = ctx;
  const d = useMemo(() => {
    const cur = summarize(invs, 'profit');
    const prev = summarize(prevInvs, 'profit');
    const rank = profitRanking(model, invs, prevInvs);
    const me = menuEngineering(rank.rows);
    const cats = new Map();
    const uc = unitCosts(costs.cfg);
    for (const r of productRows(model, invs, null, 'net')) {
      if (r.unallocated) continue;
      const cat = r.costed ? (uc.get(r.key)?.type || 'OTHER') : 'No cost yet';
      const c = cats.get(cat) || { key: cat, net: 0, profit: 0, costedNet: 0, qty: 0, items: 0 };
      c.net += r.net; c.qty += r.qty; c.items++;
      if (r.costed) { c.profit += r.profit; c.costedNet += r.net; }
      cats.set(cat, c);
    }
    const catRows = [...cats.values()].map((c) => ({ ...c, margin: c.costedNet ? c.profit / c.costedNet : null, profitShare: rank.total ? c.profit / rank.total : 0, salesShare: cur.net ? c.net / cur.net : 0 }))
      .sort((a, b) => b.profit - a.profit);
    const low = rank.rows.filter((r) => r.margin != null && r.margin < LOW_MARGIN && r.net > 0).sort((a, b) => b.net - a.net);
    return { cur, prev, rank, me, catRows, low };
  }, [model, invs, prevInvs, costs.cfg]);

  const change = (a, b) => (b ? (a - b) / Math.abs(b) : null);
  const { cur, prev, rank } = d;
  return (
    <div className="stack">
      <div className="kpis" style={{ marginBottom: 0 }}>
        <Tile label="Gross profit" value={money(cur.profit)} delta={change(cur.profit, prev.profit)} sub={`${longDate(filters.from)} – ${longDate(filters.to)}`} />
        <Tile label="Gross margin" value={marginFmt(cur.margin)} delta={cur.margin != null && prev.margin != null ? cur.margin - prev.margin : null} deltaPts sub="profit ÷ sales with a known cost" />
        <Tile label="Profit per day" value={money(rank.total / rank.days)} sub={`${rank.days} trading days`} />
        <Tile label="Cost of goods (COGS)" value={money(cur.cogs)} sub={`${pct(cur.costedNet ? cur.cogs / cur.costedNet : 0)} of costed sales`} />
        <Tile label="Sales with a known cost" value={pct(cur.coverage, 0)} sub={cur.coverage < 0.9 ? 'add costs below to complete the picture' : 'good coverage'} warn={cur.coverage < 0.75} />
        <Tile label="Discounts vs profit" value={cur.profit ? pct(cur.disc / cur.profit, 0) : '–'} sub={`${money(cur.disc)} of discounts given`} />
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Most profitable products · share of daily profit</h2>
            <p>Gross profit per product in the selected period, its share of total profit, and the average profit it brings each trading day. Previous period: {shortDate(prevFrom)} – {shortDate(prevTo)}.</p>
          </div>
        </div>
        <DataTable exportName="profit-by-product" rows={rank.rows} defaultSort={{ key: 'profit', dir: 'desc' }} pageSize={50}
          filters={{ search: 'name', amount: 'profit', amountLabel: 'Gross profit' }} onRowClick={(r) => openProduct(r.key)}
          columns={[
            { key: 'name', label: 'Product', name: true, render: (r) => <span title={r.name}>{r.name}</span> },
            { key: 'profitShare', label: 'Share of profit', align: 'r', fmt: (v) => pct(v), total: 'sum', csv: (r) => (r.profitShare * 100).toFixed(2) },
            { key: 'profitPerDay', label: 'Profit / day', align: 'r', fmt: money, total: 'sum', csv: (r) => r.profitPerDay.toFixed(2) },
            { key: 'profit', label: 'Gross profit', align: 'r', fmt: money, total: 'sum', csv: (r) => r.profit.toFixed(2) },
            { key: 'margin', label: 'Margin %', align: 'r', fmt: marginFmt, csv: (r) => (r.margin == null ? '' : (r.margin * 100).toFixed(2)) },
            { key: 'net', label: 'Sales', align: 'r', fmt: money, total: 'sum', csv: (r) => r.net.toFixed(2) },
            { key: 'qty', label: 'Qty', align: 'r', fmt: dec1, total: 'sum' },
            { key: 'unitCost', label: 'Unit cost', align: 'r', fmt: (v) => (v == null ? '–' : money2(v)) },
            { key: 'unitProfit', label: 'Profit / item', align: 'r', fmt: (v) => (v == null ? '–' : money2(v)) },
            { key: 'change', label: 'Profit vs prev', align: 'r', render: (r) => <ChangeCell v={r.change} />, csv: (r) => (r.change == null ? '' : (r.change * 100).toFixed(2)) },
            { key: 'menuClass', label: 'Menu class', render: (r) => (r.menuClass ? <span className={'pill mc-' + r.menuClass.toLowerCase()}>{r.menuClass}</span> : '–') },
          ]} />
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Menu engineering</h2>
            <p>
              Each costed product is placed by popularity (share of items sold, line at 70% of an equal share) and profit per item
              (line at the average, {money2(d.me.profitLine)}).
            </p>
          </div>
        </div>
        <div className="menu-grid">
          {MENU_CLASSES.map(([cls, what, advice]) => {
            const items = d.me.items.filter((r) => r.menuClass === cls).sort((a, b) => b.profit - a.profit);
            return (
              <div key={cls} className={'menu-cell mc-' + cls.toLowerCase()}>
                <div className="menu-cell-head"><b>{cls}s</b> <span className="faint">{items.length} items · {money(items.reduce((s, r) => s + r.profit, 0))} profit</span></div>
                <div className="faint" style={{ fontSize: 12.5 }}>{what}. {advice}</div>
                <ul>
                  {items.slice(0, 6).map((r) => (
                    <li key={r.key}><button className="linklike" onClick={() => openProduct(r.key)}>{r.name}</button> <span className="faint">{int(r.qty)} sold · {money2(r.unitProfit)}/item</span></li>
                  ))}
                  {items.length > 6 && <li className="faint">+ {items.length - 6} more (see the table above)</li>}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid two">
        <div className="card">
          <div className="card-head"><div><h2>Profit by category</h2><p>Categories come from the cost sheet (drink type). “No cost yet” = sales without a cost.</p></div></div>
          <DataTable exportName="profit-by-category" rows={d.catRows} defaultSort={{ key: 'profit', dir: 'desc' }} columns={[
            { key: 'key', label: 'Category' },
            { key: 'net', label: 'Sales', align: 'r', fmt: money, total: 'sum' },
            { key: 'salesShare', label: 'Share of sales', align: 'r', fmt: (v) => pct(v), total: 'sum' },
            { key: 'profit', label: 'Gross profit', align: 'r', fmt: money, total: 'sum' },
            { key: 'profitShare', label: 'Share of profit', align: 'r', fmt: (v) => pct(v), total: 'sum' },
            { key: 'margin', label: 'Margin %', align: 'r', fmt: marginFmt },
          ]} />
        </div>
        <div className="card">
          <div className="card-head"><div><h2>Low-margin watch list</h2><p>Items keeping less than {pct(LOW_MARGIN, 0)} of their price, biggest sellers first.</p></div></div>
          {d.low.length ? (
            <DataTable exportName="low-margin-items" rows={d.low} defaultSort={{ key: 'net', dir: 'desc' }} pageSize={20} onRowClick={(r) => openProduct(r.key)} columns={[
              { key: 'name', label: 'Product', name: true },
              { key: 'net', label: 'Sales', align: 'r', fmt: money },
              { key: 'avgPrice', label: 'Avg price', align: 'r', fmt: money2 },
              { key: 'unitCost', label: 'Unit cost', align: 'r', fmt: money2 },
              { key: 'margin', label: 'Margin %', align: 'r', fmt: marginFmt, cls: (r) => (r.margin < 0 ? 'down' : '') },
            ]} />
          ) : <p className="muted">No costed item is below {pct(LOW_MARGIN, 0)} margin in this period.</p>}
        </div>
      </div>

      <CostSetup ctx={ctx} />
    </div>
  );
}

function Tile({ label, value, sub, delta, deltaPts, warn }) {
  return (
    <div className="card kpi" style={warn ? { borderColor: 'var(--warn)' } : undefined}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className="sub">
        {delta != null && Number.isFinite(delta) && (
          <span className={'delta ' + (delta > 0 ? 'up' : delta < 0 ? 'down' : 'faint')}>
            {delta > 0 ? '▲' : delta < 0 ? '▼' : ''} {deltaPts ? `${delta > 0 ? '+' : ''}${(delta * 100).toFixed(1)} pts` : `${delta > 0 ? '+' : ''}${(delta * 100).toFixed(1)}%`}
          </span>
        )}{' '}{sub}
      </div>
    </div>
  );
}

/** Cost setup: load the sheet, check/change links, type costs, save for everyone. */
function CostSetup({ ctx }) {
  const { model, invs, costs, openProduct } = ctx;
  const fileRef = useRef(null);
  const [msg, setMsg] = useState(null);
  const [password, setPassword] = useState('');
  const [editing, setEditing] = useState(null);
  const cfg = costs.cfg;

  async function loadSheet(file) {
    try {
      const parsed = parseCostWorkbook(new Uint8Array(await file.arrayBuffer()), file.name);
      const next = makeCostConfig(parsed, cfg);
      costs.update(next);
      setMsg({ kind: 'ok', text: `Loaded ${next.recipes.length} recipes from ${file.name}. Review the links below, then save.` });
    } catch (e) {
      setMsg({ kind: 'bad', text: e.message });
    }
  }

  const rows = useMemo(() => {
    if (!cfg) return [];
    const uc = unitCosts(cfg);
    const stats = productRows(model, invs, null, 'net');
    const byItem = new Map(stats.map((r) => [r.key, r]));
    const all = [...model.products.values()].filter((p) => p.id !== -1);
    return all.map((p) => {
      const s = byItem.get(p.id);
      const u = uc.get(p.id);
      const avgPrice = s && s.qty ? s.gross / s.qty : null;
      return {
        key: p.id, name: p.name, net: s ? s.net : 0, qty: s ? s.qty : 0, avgPrice,
        unitCost: u ? u.cost : null, via: u ? u.via : null, source: u ? u.label : '',
        margin: u && avgPrice ? (avgPrice - u.cost) / avgPrice : null,
      };
    });
  }, [cfg, model, invs]);

  const sources = useMemo(() => (cfg ? [
    ...cfg.recipes.map((r) => ({ id: r.id, label: `${r.name} · ${money2(r.cost)}` })),
    ...cfg.ingredients.map((r) => ({ id: r.id, label: `Ingredient: ${r.name} · ${money2(r.cost)}` })),
  ] : []), [cfg]);

  function setLink(item, id) {
    const links = { ...cfg.links };
    if (id) links[item] = [id]; else links[item] = [];
    costs.update({ ...cfg, links, updatedAt: new Date().toISOString() });
  }
  function setManual(item, v) {
    const manual = { ...cfg.manual };
    if (v === '' || v == null) delete manual[item]; else manual[item] = Number(v);
    costs.update({ ...cfg, manual, updatedAt: new Date().toISOString() });
  }
  async function save() {
    if (!password) { setMsg({ kind: 'bad', text: 'Enter the upload password to save.' }); return; }
    try {
      await costs.save(password);
      setMsg({ kind: 'ok', text: 'Costs saved. Everyone opening the site now sees these margins.' });
    } catch (e) {
      setMsg({ kind: 'bad', text: e.message });
    }
  }

  const soldRows = rows.filter((r) => r.net !== 0);
  const knownSales = soldRows.filter((r) => r.unitCost != null).reduce((s, r) => s + r.net, 0);
  const allSales = soldRows.reduce((s, r) => s + r.net, 0);

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Product costs</h2>
          <p>
            {cfg
              ? <>Using <b>{cfg.sheetName || 'the cost sheet'}</b> ({cfg.recipes.length} recipes). Each till product is linked to a recipe or ingredient from the sheet, or you type its cost. Costs apply to all dates (the sheet has one cost per item, not a history).</>
              : <>Load the cost sheet (.xlsx with columns “Drink Name”, “Ingredient”, “Material Cost”) to see profit and margins.</>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <button className="btn" onClick={() => fileRef.current.click()}>{cfg ? 'Load a new cost sheet' : 'Load cost sheet (.xlsx)'}</button>
          <input ref={fileRef} type="file" accept=".xlsx" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) loadSheet(f); }} />
          {cfg && costs.canSave && (
            <>
              <label className="field"><span>Upload password</span>
                <input id="costs-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: 150 }} /></label>
              <button className="btn primary" onClick={save}>Save costs for everyone</button>
            </>
          )}
        </div>
      </div>
      {msg && <div className={'banner ' + msg.kind}><span>{msg.text}</span><button className="btn small ghost" onClick={() => setMsg(null)} aria-label="Dismiss">✕</button></div>}
      {cfg && (
        <>
          <p className="notice" style={{ margin: '0 0 12px' }}>
            Products with a cost cover <b>{pct(allSales ? knownSales / allSales : 0, 0)}</b> of sales in the selected period.
            Sort by <b>Sales</b> and add the missing costs of your big sellers first. Links marked “sheet” were matched by name; check them once.
            {!costs.canSave && ' Saving is only available on the published website.'}
          </p>
          <DataTable exportName="product-costs" rows={rows} defaultSort={{ key: 'net', dir: 'desc' }} pageSize={60}
            filters={{ search: 'name' }}
            extraTools={<button className="btn small ghost" onClick={() => costs.update({ ...cfg, links: { ...DEFAULT_LINKS } })} title="Undo link changes (manual costs are kept)">Reset links</button>}
            columns={[
              { key: 'name', label: 'Product', name: true, render: (r) => <button className="linklike" onClick={() => openProduct(r.key)} title={r.name}>{r.name}</button> },
              { key: 'net', label: 'Sales (period)', align: 'r', fmt: money, total: 'sum' },
              { key: 'avgPrice', label: 'Avg price', align: 'r', fmt: (v) => (v == null ? '–' : money2(v)) },
              {
                key: 'source', label: 'Cost comes from', sortValue: (r) => r.source || '~',
                render: (r) => (editing === r.key ? (
                  <select autoFocus value={(cfg.links[r.key] || [])[0] || ''} onBlur={() => setEditing(null)}
                    onChange={(e) => { setLink(r.key, e.target.value); setEditing(null); }}>
                    <option value="">— no link —</option>
                    {sources.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                ) : (
                  <button className="linklike" onClick={() => setEditing(r.key)} title="Change the link">
                    {r.source ? <>{r.via === 'manual' ? <span className="pill">manual</span> : <span className="pill">sheet</span>} {r.source}</> : <span className="faint">link…</span>}
                  </button>
                )),
              },
              {
                key: 'manual', label: 'Your cost (₺)', sortValue: (r) => cfg.manual?.[r.key] ?? null,
                render: (r) => (
                  <input type="number" inputMode="decimal" min="0" step="0.01" aria-label={`Cost of ${r.name}`}
                    defaultValue={cfg.manual?.[r.key] ?? ''} placeholder="–" style={{ width: 90, minHeight: 32 }}
                    onBlur={(e) => { const v = e.target.value; if (String(cfg.manual?.[r.key] ?? '') !== v) setManual(r.key, v); }} />
                ),
                csv: (r) => cfg.manual?.[r.key] ?? '',
              },
              { key: 'unitCost', label: 'Unit cost', align: 'r', fmt: (v) => (v == null ? '–' : money2(v)) },
              { key: 'margin', label: 'Margin %', align: 'r', fmt: marginFmt, cls: (r) => (r.margin != null && r.margin < LOW_MARGIN ? 'down' : '') },
            ]} />
        </>
      )}
    </div>
  );
}
