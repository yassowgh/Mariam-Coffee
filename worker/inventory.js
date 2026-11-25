// Inventory: stock of ingredients and ready-made items, kept up to date by counts, deliveries and waste.
// Managers, accountants and the owner manage it; everyone signed in can see what is running low.
//
//   GET    /api/inventory                 -> { items, low }            (manager/accountant)
//   POST   /api/inventory                 <- new item                  (manager/accountant)
//   PATCH  /api/inventory/:id             <- name, category, unit, min_qty, note, active
//   POST   /api/inventory-moves           <- { kind: count|purchase|waste|adjust, lines: [{ id, qty, note }] }
//   GET    /api/inventory-moves?item=ID   -> history (last 200)
//   GET    /api/inventory-low             -> { low: [{ name, qty, unit, out }] }   (anyone signed in)
//
// A count sets the level; purchase adds; waste subtracts; adjust sets with a reason.
// Use per day = what went down between counts (plus waste), over the last 30 days.

import { SALES_SCHEMA, SALES_START, applySales, seedSales } from './inventorySales.js';
import { STOCK_LINK_SCHEMA } from './invoiceStock.js';
import { ITEMS as MENU_ITEMS, EXTRAS as MENU_EXTRAS } from '../site/src/menu.js';

export const INVENTORY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS inventory_items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT NOT NULL,
    unit TEXT NOT NULL, qty REAL NOT NULL DEFAULT 0, min_qty REAL, note TEXT, active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT, counted_at TEXT, updated_by INTEGER)`,
  `CREATE TABLE IF NOT EXISTS inventory_moves (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, at TEXT NOT NULL,
    kind TEXT NOT NULL, qty REAL NOT NULL, before REAL, after REAL, note TEXT, user_id INTEGER)`,
  `CREATE INDEX IF NOT EXISTS inventory_moves_item ON inventory_moves(item_id, at)`,
  ...SALES_SCHEMA,
  ...STOCK_LINK_SCHEMA,
];

export const INVENTORY_ROUTES = ['inventory', 'inventory-moves', 'inventory-low', 'inventory-recipes', 'inventory-sync', 'inventory-diff'];
const KINDS = ['count', 'purchase', 'waste', 'adjust'];

// The stock list the owner gave on 22 Nov 2026 (units agreed: litres, bottles, cans, pieces, packs, bunches, boxes, grams).
const C = { daily: 'Daily use & refrigerated', redbull: 'Red Bull', soda: 'Sparkling water / soda', dessert: 'Desserts & cookies', syrup: 'Syrups', sauce: 'Sauces', puree: 'Purées', tea: 'Teas & powders' };
const SEED = [
  [C.daily, 'Milk', 'L', 8], [C.daily, 'Lactose-free milk', 'L', 26], [C.daily, 'Condensed milk', 'cans', 0], [C.daily, 'Mint', 'bunches', 1],
  [C.daily, 'Lemons', 'pieces', 6], [C.daily, 'Pesto sauce', 'packs', 0.5], [C.daily, 'Lettuce', 'packs', 0.5], [C.daily, 'Sliced cheese', 'packs', 0.5],
  [C.daily, 'Turkey salami', 'packs', 4], [C.daily, 'Smoked turkey', 'packs', 4.5], [C.daily, 'Croissants', 'boxes', 2.5], [C.daily, 'Honey', 'g', 448],
  [C.daily, 'Sugar', 'g', 1552], [C.daily, 'Ginger', 'g', 97], [C.daily, 'Cumin', 'g', 646], [C.daily, 'Salt', 'g', 970], [C.daily, 'Cinnamon', 'g', 48],
  [C.daily, 'Ground cinnamon', 'g', 76], [C.daily, 'Belgian chocolate', 'g', 5066], [C.daily, 'Water', 'bottles', 45],
  [C.redbull, 'Red Bull original', 'cans', 4], [C.redbull, 'Red Bull sugar-free', 'cans', 13], [C.redbull, 'Red Bull lemon', 'cans', 21],
  [C.redbull, 'Red Bull forest fruit', 'cans', 8], [C.redbull, 'Red Bull coconut', 'cans', 0],
  [C.soda, 'Sparkling water, plain', 'cans', 39], [C.soda, 'Sparkling water, lemon', 'cans', 67], [C.soda, 'Sparkling water, black mulberry', 'cans', 37],
  [C.soda, 'Sparkling water, watermelon & strawberry', 'cans', 23], [C.soda, 'Sparkling water, grapefruit & blueberry', 'cans', 4],
  [C.dessert, 'San Sebastián cheesecake', 'pieces', 6], [C.dessert, 'Raspberry cheesecake', 'pieces', 0], [C.dessert, 'White chocolate raspberry cake', 'pieces', 7],
  [C.dessert, "Devil's cake", 'pieces', 2], [C.dessert, 'Apple tart', 'pieces', 7], [C.dessert, 'Pumpkin cake', 'pieces', 4], [C.dessert, 'Honey pistachio dessert', 'pieces', 5],
  [C.dessert, 'Honey walnut dessert', 'pieces', 4], [C.dessert, 'Cocomore', 'pieces', 9], [C.dessert, 'Belgian chocolate cake', 'pieces', 10], [C.dessert, 'Rainbow cake', 'pieces', 3],
  [C.dessert, 'Cookies', 'pieces', 0], [C.dessert, 'Double chocolate cookies', 'pieces', 0], [C.dessert, 'Red velvet cookies', 'pieces', 0], [C.dessert, 'Small date cookies', 'pieces', 0],
  [C.dessert, 'Round cookies', 'g', 2146], [C.dessert, 'Filled date cookies', 'g', 2896], [C.dessert, 'Sesame cookies', 'g', 2364],
  ...[['Vanilla', 3.5], ['Caramel', 1.5], ['Salted caramel', 0.5], ['Blueberry', 1.5], ['Mojito', 2], ['Spearmint', 0.5], ['Hazelnut', 2], ['Coconut', 1.5], ['Lime', 0],
    ['Hibiscus', 0.5], ['Roasted almond', 1.5], ['Mango', 1], ['Shortbread cookie', 2], ['Raspberry', 0.5], ['Strawberry', 0.5], ['Toffee nut', 1], ['Blue Curaçao', 0.5],
    ['Green apple', 3.5], ['Peach', 2.5], ['Blackberry', 0.5], ['Cool lime', 1.5], ['Pineapple', 0.5], ['Mango orange', 2], ['Pumpkin spice', 2.5], ['Maple spice', 1],
    ['Kiwi', 1.5], ['Gingerbread', 1], ['Pistachio', 2.5], ['Strawberry lime', 2]].map(([n, q]) => [C.syrup, `${n} syrup`, 'bottles', q]),
  ...[['Chocolate sauce', 2.5], ['Dark chocolate sauce', 0.5], ['White chocolate sauce', 1.5], ['Toffee caramel sauce', 2.5], ['Chocolate decorating sauce', 1.5],
    ['White chocolate decorating sauce', 4.5], ['Caramel decorating sauce', 0], ['Strawberry decorating sauce', 3.5]].map(([n, q]) => [C.sauce, n, 'bottles', q]),
  ...[['Passion fruit', 1.5], ['Blueberry', 2.5], ['Mango', 2], ['Strawberry', 4], ['Forest fruit', 0.5], ['Pistachio', 4], ['Raspberry hibiscus', 1.5]].map(([n, q]) => [C.puree, `${n} purée`, 'bottles', q]),
  [C.tea, 'Black tea', 'g', 4000], [C.tea, 'Hot chocolate powder', 'g', 2000], [C.tea, 'White hot chocolate powder', 'g', 1990], [C.tea, 'Salep powder', 'g', 1360],
  [C.tea, 'Karak tea powder', 'g', 0], [C.tea, 'Chocolate milkshake powder', 'g', 0], [C.tea, 'Strawberry milkshake powder', 'g', 2000],
  [C.tea, 'Vanilla milkshake powder', 'g', 258], [C.tea, 'Lotus milkshake powder', 'g', 278],
];
export const CATEGORY_ORDER = Object.values(C);

/** First use: put the owner's list in (only when the table is empty). */
export async function seedInventory(db) {
  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM inventory_items').first();
  if (n) return;
  const now = new Date().toISOString();
  const stmts = [];
  SEED.forEach(([cat, name, unit, qty], i) => {
    stmts.push(db.prepare('INSERT INTO inventory_items (name, category, unit, qty, sort, created_at, counted_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(name, cat, unit, qty, i, now, now));
  });
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  // the starting level counts as the first count, so use per day can be worked out from the next count
  await db.prepare(`INSERT INTO inventory_moves (item_id, at, kind, qty, before, after, note) SELECT id, ?, 'count', qty, NULL, qty, 'Starting stock (list of 22 Nov 2026)' FROM inventory_items`).bind(now).run();
}

const isLow = (it) => it.active && (it.qty <= 0 || (it.min_qty != null && it.qty <= it.min_qty));

/** Use per day over the last 30 days: decreases at counts and waste (purchases do not count). */
async function usePerDay(db) {
  const since = new Date(Date.now() - 30 * 86400e3).toISOString();
  const { results } = await db.prepare(`SELECT item_id, SUM(CASE WHEN kind IN ('waste','sale') THEN qty WHEN kind IN ('count','adjust') AND before IS NOT NULL AND after < before THEN before - after ELSE 0 END) AS used,
    MIN(at) AS first, MAX(at) AS last FROM inventory_moves WHERE at >= ? GROUP BY item_id`).bind(since).all();
  const out = {};
  for (const r of results) {
    const days = Math.max(1, (Date.parse(r.last) - Date.parse(r.first)) / 86400e3);
    if (r.used > 0 && r.last !== r.first) out[r.item_id] = r.used / days;
  }
  return out;
}

export async function handleInventory({ head, sub, request, env, me, h }) {
  const db = env.DB;
  const m = request.method;
  await seedInventory(db);
  await seedSales(db, h.getSetting, h.setSetting);
  if (head === 'inventory-low') {
    h.need(me);
    const { results } = await db.prepare('SELECT name, qty, unit, min_qty, active FROM inventory_items WHERE active = 1 ORDER BY category, sort').all();
    return h.json({ low: results.filter(isLow).map((x) => ({ name: x.name, qty: x.qty, unit: x.unit, out: x.qty <= 0 })) });
  }
  h.need(me, 'manager', 'accountant');
  const now = h.nowIso();
  if (head === 'inventory') {
    const id = sub && /^\d+$/.test(sub) ? Number(sub) : null;
    if (m === 'GET') {
      const { results } = await db.prepare(`SELECT i.*, u.name AS updated_by_name FROM inventory_items i LEFT JOIN users u ON u.id = i.updated_by ORDER BY i.category, i.sort, i.name`).all();
      const use = await usePerDay(db);
      const items = results.map((x) => ({ ...x, use_per_day: use[x.id] ?? null, low: isLow(x) }));
      return h.json({ items, categories: CATEGORY_ORDER, low: items.filter((x) => x.low).length });
    }
    const b = await h.body(request);
    const clean = (o) => {
      const out = {};
      if ('name' in o) { out.name = h.str(o.name, 80); if (!out.name) h.fail(400, 'Type the item name.'); }
      if ('category' in o) out.category = h.str(o.category, 60) || 'Other';
      if ('unit' in o) { out.unit = h.str(o.unit, 20); if (!out.unit) h.fail(400, 'Choose the unit (e.g. L, g, bottles, pieces).'); }
      if ('min_qty' in o) out.min_qty = o.min_qty === '' || o.min_qty == null ? null : Math.max(0, Number(o.min_qty) || 0);
      if ('note' in o) out.note = h.str(o.note, 300) || null;
      if ('active' in o) out.active = o.active ? 1 : 0;
      if ('pack_size' in o) out.pack_size = o.pack_size === '' || o.pack_size == null ? null : Math.max(0, Number(o.pack_size) || 0) || null;
      if ('use_unit' in o) out.use_unit = h.str(o.use_unit, 20) || null;
      return out;
    };
    if (m === 'POST' && !id) {
      const v = clean({ name: b.name, category: b.category, unit: b.unit, min_qty: b.min_qty, note: b.note });
      const qty = Math.max(0, Number(b.qty) || 0);
      const { s } = await db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM inventory_items').first();
      const r = await db.prepare('INSERT INTO inventory_items (name, category, unit, qty, min_qty, note, sort, created_at, counted_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(v.name, v.category, v.unit, qty, v.min_qty ?? null, v.note ?? null, s, now, now, me.id).run();
      await db.prepare("INSERT INTO inventory_moves (item_id, at, kind, qty, before, after, note, user_id) VALUES (?, ?, 'count', ?, NULL, ?, 'New item', ?)").bind(r.meta.last_row_id, now, qty, qty, me.id).run();
      await h.audit(db, me, 'inventory.add', { name: v.name });
      return h.json({ ok: true, id: r.meta.last_row_id });
    }
    if (m === 'PATCH' && id) {
      const v = clean(b);
      const cols = Object.keys(v);
      if (!cols.length) h.fail(400, 'Nothing to change.');
      await db.prepare(`UPDATE inventory_items SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ?, updated_by = ? WHERE id = ?`).bind(...cols.map((c) => v[c]), now, me.id, id).run();
      await h.audit(db, me, 'inventory.edit', { id, ...v });
      return h.json({ ok: true });
    }
    return h.fail(405, 'Not allowed.');
  }
  if (head === 'inventory-moves') {
    if (m === 'GET') {
      const item = Number(new URL(request.url).searchParams.get('item')) || null;
      const { results } = await db.prepare(`SELECT mv.*, i.name, i.unit, u.name AS user_name FROM inventory_moves mv JOIN inventory_items i ON i.id = mv.item_id LEFT JOIN users u ON u.id = mv.user_id
        ${item ? 'WHERE mv.item_id = ?' : ''} ORDER BY mv.at DESC, mv.id DESC LIMIT 200`).bind(...(item ? [item] : [])).all();
      return h.json({ moves: results });
    }
    if (m !== 'POST') return h.fail(405, 'Not allowed.');
    const b = await h.body(request);
    const kind = KINDS.includes(b.kind) ? b.kind : null;
    if (!kind) h.fail(400, 'Choose count, delivery or waste.');
    const lines = (Array.isArray(b.lines) ? b.lines : []).filter((l) => l && /^\d+$/.test(String(l.id)) && l.qty !== '' && l.qty != null && Number.isFinite(Number(l.qty)));
    if (!lines.length) h.fail(400, 'Enter at least one quantity.');
    if (lines.length > 300) h.fail(400, 'Too many lines at once.');
    const ids = lines.map((l) => Number(l.id));
    const { results: items } = await db.prepare(`SELECT id, qty FROM inventory_items WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
    const cur = new Map(items.map((x) => [x.id, x.qty]));
    const stmts = [];
    let changed = 0;
    for (const l of lines) {
      const id = Number(l.id);
      if (!cur.has(id)) continue;
      const q = Number(l.qty);
      if (q < 0) h.fail(400, 'Quantities cannot be negative.');
      const before = cur.get(id);
      const after = kind === 'purchase' ? before + q : kind === 'waste' ? Math.max(0, before - q) : q;
      if (kind === 'adjust' && !h.str(l.note || b.note)) h.fail(400, 'Write the reason for the correction.');
      stmts.push(db.prepare('INSERT INTO inventory_moves (item_id, at, kind, qty, before, after, note, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, now, kind, q, before, after, h.str(l.note || b.note, 300) || null, me.id));
      stmts.push(db.prepare(`UPDATE inventory_items SET qty = ?, updated_at = ?, updated_by = ?${kind === 'count' ? ', counted_at = ?' : ''} WHERE id = ?`).bind(...(kind === 'count' ? [after, now, me.id, now, id] : [after, now, me.id, id])));
      changed++;
    }
    for (let i = 0; i < stmts.length; i += 80) await db.batch(stmts.slice(i, i + 80));
    await h.audit(db, me, 'inventory.' + kind, { lines: changed });
    return h.json({ ok: true, changed });
  }
  if (head === 'inventory-recipes') return recipes({ request, db, me, h, now });
  if (head === 'inventory-sync' && m === 'POST') {
    // take the latest till upload's new sales off the stock now (it also runs after every upload)
    const zip = await env.DATA.get('dataset', 'arrayBuffer');
    if (!zip) h.fail(400, 'No till data uploaded yet.');
    const r = await applySales(env, zip);
    await h.audit(db, me, 'inventory.sync', r);
    return h.json({ ok: true, ...r });
  }
  if (head === 'inventory-diff' && m === 'GET') {
    // each count compared with what the system expected (after sales, deliveries and waste)
    const { results } = await db.prepare(`SELECT mv.at, mv.before, mv.after, mv.note, i.name, i.unit, i.category, u.name AS user_name FROM inventory_moves mv
      JOIN inventory_items i ON i.id = mv.item_id LEFT JOIN users u ON u.id = mv.user_id
      WHERE mv.kind = 'count' AND mv.before IS NOT NULL AND mv.at >= ? ORDER BY mv.at DESC LIMIT 500`).bind(SALES_START).all();
    return h.json({ since: SALES_START, rows: results.map((r) => ({ ...r, diff: Math.round((r.after - r.before) * 1000) / 1000 })) });
  }
  return h.fail(404, 'Not found');
}

/** Recipes: GET every menu item with its recipe and sales; PUT { pos_item, lines: [{ inv_item, qty }] } replaces one recipe. */
async function recipes({ request, db, me, h, now }) {
  if (request.method === 'GET') {
    const lines = (await db.prepare('SELECT pos_item, inv_item, qty, draft FROM inventory_recipes').all()).results;
    const since = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
    const sold = (await db.prepare('SELECT pos_item, SUM(qty) AS qty, MAX(name) AS name FROM inventory_sales WHERE day >= ? GROUP BY pos_item').bind(since).all()).results;
    const soldMap = new Map(sold.map((x) => [x.pos_item, x]));
    const menu = [...MENU_ITEMS, ...MENU_EXTRAS].filter((x) => /^\d+$/.test(String(x.id))).map((x) => ({ pos_item: Number(x.id), name: x.name[0], cat: x.cat || 'extras' }));
    const known = new Set(menu.map((x) => x.pos_item));
    for (const x of sold) if (!known.has(x.pos_item)) menu.push({ pos_item: x.pos_item, name: x.name || `Till item ${x.pos_item}`, cat: 'other' });
    const run = await h.getSetting(db, 'inventorySalesRun');
    return h.json({ since: SALES_START, lastRun: run?.at || null, items: menu.map((x) => ({ ...x, sold30: soldMap.get(x.pos_item)?.qty || 0, lines: lines.filter((l) => l.pos_item === x.pos_item) })) });
  }
  if (request.method !== 'PUT') return h.fail(405, 'Not allowed.');
  const b = await h.body(request);
  const pos = Number(b.pos_item);
  if (!(pos > 0)) h.fail(400, 'Choose the menu item.');
  const ls = (Array.isArray(b.lines) ? b.lines : []).filter((l) => Number(l.inv_item) > 0 && Number(l.qty) > 0).slice(0, 30);
  const stmts = [db.prepare('DELETE FROM inventory_recipes WHERE pos_item = ?').bind(pos)];
  for (const l of ls) stmts.push(db.prepare('INSERT OR REPLACE INTO inventory_recipes (pos_item, inv_item, qty, draft, updated_at) VALUES (?, ?, ?, 0, ?)').bind(pos, Number(l.inv_item), Number(l.qty), now));
  await db.batch(stmts);
  await h.audit(db, me, 'inventory.recipe', { pos_item: pos, lines: ls.length });
  return h.json({ ok: true });
}

/** Daily email to managers (and the owner) listing what is low or out of stock. Only when something is low. */
export async function inventoryEmail(env, sendMany) {
  const db = env.DB;
  const day = new Date().toISOString().slice(0, 10);
  const h = { getSetting: async (d, key) => { const r = await d.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first(); return r ? JSON.parse(r.value) : null; } };
  const done = await h.getSetting(db, 'inventoryEmail');
  if (done?.day === day) return { skipped: 'already sent today' };
  const { results } = await db.prepare('SELECT name, category, qty, unit, min_qty, active FROM inventory_items WHERE active = 1 ORDER BY category, sort').all();
  const low = results.filter(isLow);
  if (!low.length) return { skipped: 'nothing low' };
  const { results: users } = await db.prepare("SELECT email FROM users WHERE active = 1 AND email IS NOT NULL AND email <> '' AND (roles LIKE '%manager%' OR roles LIKE '%owner%')").all();
  const to = [...new Set(users.map((u) => u.email))];
  if (!to.length) return { skipped: 'no manager email' };
  const fmt = (v) => (Math.round(v * 100) / 100).toLocaleString('en-US');
  const out = low.filter((x) => x.qty <= 0), few = low.filter((x) => x.qty > 0);
  const text = [
    `${low.length} item${low.length === 1 ? ' is' : 's are'} low or out of stock today.`,
    out.length ? `Out of stock:\n${out.map((x) => `- ${x.name} (${x.category})`).join('\n')}` : '',
    few.length ? `Running low:\n${few.map((x) => `- ${x.name}: ${fmt(x.qty)} ${x.unit} left (minimum ${fmt(x.min_qty)})`).join('\n')}` : '',
    'The full "To order" list is in the staff website → Inventory.',
  ].filter(Boolean).join('\n\n');
  const r = await sendMany(env, h, to, `Mariam Coffee: ${low.length} items to order`, text);
  await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind('inventoryEmail', JSON.stringify({ day, sent: r.sent })).run();
  return r;
}
