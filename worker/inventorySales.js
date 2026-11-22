// Stock goes down from till sales: every sold menu item takes its recipe off the inventory.
// Runs after each till upload (about every 30 minutes). Sales are counted per business day and per
// till item; only what is new since the last run is taken off, so re-uploads never double-count.
// A recipe line is "1 sold item uses QTY of this stock item", in the stock item's use unit
// (e.g. ml for a syrup counted in 700 ml bottles; the stock goes down by QTY / 700 bottles).
import { unzipSync } from 'fflate';
import { TABLES } from '../src/lib/tables.js';
import { buildModel } from '../src/lib/model.js';

export const SALES_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS inventory_recipes (pos_item INTEGER NOT NULL, inv_item INTEGER NOT NULL, qty REAL NOT NULL, draft INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT, PRIMARY KEY (pos_item, inv_item))`,
  `CREATE TABLE IF NOT EXISTS inventory_sales (day TEXT NOT NULL, pos_item INTEGER NOT NULL, qty REAL NOT NULL, name TEXT, PRIMARY KEY (day, pos_item))`,
];
// columns added to inventory_items: a bottle / litre counted as a whole, used in ml or g
export const ITEM_COLUMNS = ['pack_size REAL', 'use_unit TEXT'];
export const SALES_START = '2026-11-23'; // the day after the starting stock list (22 Nov 2026)

const WANTED = new Map(TABLES.map((t) => [t.toLowerCase() + '.db', t]));
function entriesOf(zipBytes) {
  const out = [];
  const files = unzipSync(new Uint8Array(zipBytes), { filter: (f) => WANTED.has(f.name.split('/').pop().toLowerCase()) });
  for (const [path, data] of Object.entries(files)) {
    const parts = path.split('/');
    out.push({ folder: parts.slice(0, -1).join('/'), name: WANTED.get(parts.pop().toLowerCase()), data });
  }
  return out;
}

/** Sold quantity per business day and till item, from the start day. */
export async function salesByDay(zipBytes, from = SALES_START) {
  const m = await buildModel(entriesOf(zipBytes), () => {});
  const v = m.view(m.hasAcc ? 'acc' : 'pos', 'business');
  const out = new Map(); // `${day}|${item}` -> { day, item, qty, name }
  for (const inv of v.invoices) {
    if (inv.date < from) continue;
    for (const l of inv.lines) {
      if (!(Number(l.item) > 0)) continue;
      const k = `${inv.date}|${l.item}`;
      const o = out.get(k) || { day: inv.date, item: Number(l.item), qty: 0, name: m.products.get(l.item)?.name || l.name || '' };
      o.qty += l.qty; // returns come in with a negative quantity
      out.set(k, o);
    }
  }
  return { rows: [...out.values()], maxDate: v.maxDate };
}

const perUse = (it) => (it.pack_size > 0 ? 1 / it.pack_size : 1); // stock units per use unit

/** Take new sales off the stock. Returns what changed. */
export async function applySales(env, zipBytes, from = SALES_START) {
  const db = env.DB;
  const getS = async (d, k) => { const r = await d.prepare('SELECT value FROM settings WHERE key = ?').bind(k).first(); return r ? JSON.parse(r.value) : null; };
  const setS = (d, k, v) => d.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, JSON.stringify(v)).run();
  await seedSales(db, getS, setS); // the draft recipes must exist before any sales are marked as done
  const { rows } = await salesByDay(zipBytes, from);
  if (!rows.length) return { days: 0, changed: 0 };
  const done = new Map((await db.prepare('SELECT day, pos_item, qty FROM inventory_sales WHERE day >= ?').bind(from).all()).results.map((r) => [`${r.day}|${r.pos_item}`, r.qty]));
  const recipes = (await db.prepare('SELECT r.pos_item, r.inv_item, r.qty, i.pack_size FROM inventory_recipes r JOIN inventory_items i ON i.id = r.inv_item WHERE i.active = 1').all()).results;
  const byPos = new Map();
  for (const r of recipes) { if (!byPos.has(r.pos_item)) byPos.set(r.pos_item, []); byPos.get(r.pos_item).push(r); }
  const use = new Map(); // inv item -> { qty, why: Map(name -> sold) }
  const stmts = [];
  for (const s of rows) {
    const k = `${s.day}|${s.item}`;
    const delta = s.qty - (done.get(k) || 0);
    if (Math.abs(delta) < 1e-9) continue;
    stmts.push(db.prepare('INSERT INTO inventory_sales (day, pos_item, qty, name) VALUES (?, ?, ?, ?) ON CONFLICT(day, pos_item) DO UPDATE SET qty = excluded.qty, name = excluded.name').bind(s.day, s.item, s.qty, s.name));
    for (const r of byPos.get(s.item) || []) {
      const u = use.get(r.inv_item) || { qty: 0, why: new Map() };
      u.qty += delta * r.qty * (r.pack_size > 0 ? 1 / r.pack_size : 1);
      u.why.set(s.name, (u.why.get(s.name) || 0) + delta);
      use.set(r.inv_item, u);
    }
  }
  const now = new Date().toISOString();
  if (use.size) {
    const ids = [...use.keys()];
    const cur = new Map((await db.prepare(`SELECT id, qty FROM inventory_items WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results.map((x) => [x.id, x.qty]));
    for (const [id, u] of use) {
      if (!cur.has(id) || Math.abs(u.qty) < 1e-9) continue;
      const before = cur.get(id);
      const after = Math.max(0, Math.round((before - u.qty) * 1000) / 1000);
      const note = 'Sold: ' + [...u.why].filter(([, n]) => n).map(([n, q]) => `${n} ×${Math.round(q * 100) / 100}`).join(', ').slice(0, 280);
      stmts.push(db.prepare("INSERT INTO inventory_moves (item_id, at, kind, qty, before, after, note) VALUES (?, ?, 'sale', ?, ?, ?, ?)").bind(id, now, Math.round(u.qty * 1000) / 1000, before, after, note));
      stmts.push(db.prepare('UPDATE inventory_items SET qty = ?, updated_at = ? WHERE id = ?').bind(after, now, id));
    }
  }
  for (let i = 0; i < stmts.length; i += 80) await db.batch(stmts.slice(i, i + 80));
  await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind('inventorySalesRun', JSON.stringify({ at: now, items: use.size })).run();
  return { changed: use.size, rows: rows.length };
}

// ---------------------------------------------------------------- the first draft of recipes and pack sizes

// [inventory item name, pack size, use unit] — bottles of syrup 700 ml; sauces and purées 1 L; milk in ml
export function packDefaults(name, category, unit) {
  if (/syrup/i.test(category)) return [700, 'ml'];
  if (/sauce|pur[ée]e/i.test(category)) return [1000, 'ml'];
  if (unit === 'L') return [1000, 'ml'];
  return [null, null];
}

// Till item number -> [[inventory item name, qty in use unit], …]. A first draft for the owner to check.
// Amounts are common café portions, not Mariam's measured recipes.
export const DRAFT_RECIPES = {
  7: [['Milk', 200]], // caffè latte
  6: [['Milk', 150]], // cappuccino
  10: [['Milk', 120]], // flat white
  5: [['Milk', 60]], // cortado
  4: [['Milk', 20]], // espresso macchiato
  17: [['Milk', 180], ['Chocolate sauce', 20]], // caffè mocha
  167: [['Milk', 200], ['Vanilla syrup', 15], ['Caramel decorating sauce', 10]], // caramel macchiato
  8: [['Milk', 200], ['Ground cinnamon', 1]], // cinnamon dolce latte
  12: [['Milk', 220], ['Hot chocolate powder', 30]], // hot chocolate
  112: [['Milk', 220], ['Salep powder', 25], ['Ground cinnamon', 1]], // salep
  33: [['Milk', 150]], // iced latte
  32: [['Milk', 150], ['Chocolate sauce', 20]], // iced mocha
  168: [['Milk', 150], ['Vanilla syrup', 15], ['Caramel decorating sauce', 10]], // iced caramel macchiato
  26: [['Milk', 150]], // cappuccino frappé
  36: [['Milk', 150]], // boba latte
  68: [['Milk', 150]], // iced matcha
  202: [['Milk', 150], ['Karak tea powder', 25]], // karak tea
  864: [['Milk', 150], ['Karak tea powder', 25]], // iced karak tea
  19: [['Black tea', 8]], // Turkish tea
  171: [['Black tea', 8]], // Turkish tea in a cup
  35: [['Mojito syrup', 20], ['Mint', 0.1], ['Lemons', 0.5], ['Sparkling water, plain', 1]], // mojito
  42: [['Lemons', 2], ['Sugar', 20]], // lemonade
  54: [['Water', 1]], // water
  113: [['Sparkling water, plain', 1]], // soda
  114: [['Sparkling water, plain', 1], ['Lemons', 0.25]], // soda with lime
  839: [['Red Bull original', 1]], // Red Bull (the till has one Red Bull item for all flavours)
  45: [['San Sebastián cheesecake', 1]],
  868: [['San Sebastián cheesecake', 1]], // San Sebastián + drink
  140: [['Cookies', 1]],
  867: [['Cookies', 1], ['Black tea', 8]], // cookie + tea
  43: [['Apple tart', 1]], // apple pie
};

/** Once: pack sizes for bottles and litres, and the draft recipes (only where none exist yet). */
export async function seedSales(db, getSetting, setSetting) {
  if ((await getSetting(db, 'inventorySalesSeed'))?.v === 1) return;
  const items = (await db.prepare('SELECT id, name, category, unit, pack_size FROM inventory_items').all()).results;
  const byName = new Map(items.map((x) => [x.name.toLowerCase(), x]));
  const stmts = [];
  for (const it of items) {
    if (it.pack_size) continue;
    const [size, u] = packDefaults(it.name, it.category, it.unit);
    if (size) stmts.push(db.prepare('UPDATE inventory_items SET pack_size = ?, use_unit = ? WHERE id = ?').bind(size, u, it.id));
  }
  const now = new Date().toISOString();
  for (const [pos, lines] of Object.entries(DRAFT_RECIPES)) {
    for (const [name, qty] of lines) {
      const it = byName.get(name.toLowerCase());
      if (it) stmts.push(db.prepare('INSERT OR IGNORE INTO inventory_recipes (pos_item, inv_item, qty, draft, updated_at) VALUES (?, ?, ?, 1, ?)').bind(Number(pos), it.id, qty, now));
    }
  }
  for (let i = 0; i < stmts.length; i += 80) await db.batch(stmts.slice(i, i + 80));
  await setSetting(db, 'inventorySalesSeed', { v: 1, at: now });
}

export { perUse };
