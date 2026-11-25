// Invoices add to the inventory: each invoice line can be linked to a stock item ("Süt 3% 1L × 12" → Milk +12 L).
// A link is remembered by the item's name, so the same product on the next invoice goes into stock by itself.
// New names get a suggestion (name match + unit conversion) that the accountant confirms in the invoice check.

export const STOCK_LINK_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS inventory_links (name_key TEXT PRIMARY KEY, inv_item INTEGER, factor REAL, updated_at TEXT)`,
];

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
const STOP = new Set(['the', 'and', 'with', 'for', 'of', 'fat', 'light', 'full', 'pack', 'box', 'bottle', 'piece', 'pieces', 'pcs', 'adet', 'kg', 'gr', 'g', 'ml', 'lt', 'l', 'cl', 'ltr', 'x', 'new']);
const tokens = (s) => fold(s).replace(/[^a-z؀-ۿ]+/g, ' ').split(' ').filter((t) => t.length >= 2 && !STOP.has(t));
export const nameKey = (s) => tokens(s).join(' ').slice(0, 120);

const UNIT = (u) => {
  const x = fold(u).replace(/[^a-z]/g, '');
  if (['kg', 'kilo', 'kilogram', 'kilograms'].includes(x)) return 'kg';
  if (['g', 'gr', 'gram', 'grams', 'gramme'].includes(x)) return 'g';
  if (['l', 'lt', 'ltr', 'litre', 'liter', 'litres', 'liters'].includes(x)) return 'L';
  if (['ml', 'mililitre', 'milliliter'].includes(x)) return 'ml';
  if (['koli', 'case', 'carton', 'cartons', 'cases', 'kutu', 'box', 'boxes', 'pack', 'packs', 'paket', 'package', 'bag', 'bags', 'torba', 'cuval'].includes(x)) return 'case';
  if (x) return 'count'; // piece, adet, bottle, şişe, can, kutu, pack, box, bunch…
  return 'count';
};
const COUNT = new Set(['bottles', 'cans', 'pieces', 'packs', 'boxes', 'bunches', 'bags']);

/** How many stock units one invoice unit is, when it can be known from the units alone (else null). */
export function unitFactor(lineUnit, invUnit) {
  const a = UNIT(lineUnit), b = invUnit;
  if (b === 'g') return a === 'kg' ? 1000 : a === 'g' ? 1 : null;
  if (b === 'kg') return a === 'kg' ? 1 : a === 'g' ? 0.001 : null;
  if (b === 'L') return a === 'L' ? 1 : a === 'ml' ? 0.001 : null;
  if (b === 'ml') return a === 'L' ? 1000 : a === 'ml' ? 1 : null;
  if (['boxes', 'packs', 'bags'].includes(b) && a === 'case') return 1;
  if (COUNT.has(b)) return a === 'count' ? 1 : null; // a box / case of 12 needs the number in it
  return null;
}

/** Per invoice line: { inv_item, factor, from: 'saved' | 'match' | 'skip' | null }. */
export async function suggestStock(db, lines) {
  const items = (await db.prepare('SELECT id, name, unit FROM inventory_items WHERE active = 1').all().catch(() => ({ results: [] }))).results;
  const keys = lines.map((l) => nameKey(l.item || l.desc_orig));
  const saved = new Map();
  if (keys.some(Boolean)) {
    const { results } = await db.prepare(`SELECT * FROM inventory_links WHERE name_key IN (${keys.map(() => '?').join(',')})`).bind(...keys).all().catch(() => ({ results: [] }));
    for (const r of results) saved.set(r.name_key, r);
  }
  return lines.map((l, i) => {
    const s = saved.get(keys[i]);
    if (s) return s.inv_item ? { inv_item: s.inv_item, factor: s.factor, from: 'saved' } : { inv_item: null, factor: null, from: 'skip' };
    // name match: every word of the stock item's name appears in the line (English or original); the longest name wins
    const words = new Set([...tokens(l.item), ...tokens(l.desc_orig)]);
    let best = null, bestScore = 0, tie = false;
    for (const it of items) {
      const t = tokens(it.name);
      if (!t.length || !t.every((w) => words.has(w))) continue;
      if (t.length > bestScore) { best = it; bestScore = t.length; tie = false; } else if (t.length === bestScore) tie = true;
    }
    if (!best || tie) return { inv_item: null, factor: null, from: null };
    return { inv_item: best.id, factor: unitFactor(l.unit, best.unit), from: 'match' };
  });
}

/**
 * After an invoice is saved: add its lines to the stock. rawLines are the lines as sent by the app, each may carry
 * stock: { inv_item, factor } (confirmed in the invoice check) or { skip: true }. Lines without it use a saved link.
 */
export async function addInvoiceToStock(db, me, rawLines, label, now) {
  const lines = rawLines.map((l) => ({ ...l, qty: Number(l.qty) || 0 }));
  const sugg = await suggestStock(db, lines);
  const items = new Map((await db.prepare('SELECT id, name, unit, qty FROM inventory_items').all()).results.map((x) => [x.id, x]));
  const add = new Map(), linkStmts = [], added = [], notLinked = [];
  lines.forEach((l, i) => {
    const key = nameKey(l.item || l.desc_orig);
    const s = l.stock;
    let inv = null, factor = null;
    if (s && s.skip) { if (key) linkStmts.push(db.prepare('INSERT INTO inventory_links (name_key, inv_item, factor, updated_at) VALUES (?, NULL, NULL, ?) ON CONFLICT(name_key) DO UPDATE SET inv_item = NULL, factor = NULL, updated_at = excluded.updated_at').bind(key, now)); return; }
    if (s && Number(s.inv_item) > 0) { inv = Number(s.inv_item); factor = Number(s.factor); }
    else if (sugg[i].from === 'saved') { inv = sugg[i].inv_item; factor = sugg[i].factor; }
    if (!inv || !(factor > 0) || !items.has(inv)) { if (l.qty > 0 && sugg[i].from !== 'skip') notLinked.push(l.item || l.desc_orig); return; }
    if (key && s) linkStmts.push(db.prepare('INSERT INTO inventory_links (name_key, inv_item, factor, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(name_key) DO UPDATE SET inv_item = excluded.inv_item, factor = excluded.factor, updated_at = excluded.updated_at').bind(key, inv, factor, now));
    const q = Math.round(l.qty * factor * 1000) / 1000;
    if (q <= 0) return;
    const a = add.get(inv) || { qty: 0, from: [] };
    a.qty += q; a.from.push(`${l.item || l.desc_orig} ×${l.qty}`);
    add.set(inv, a);
  });
  const stmts = [...linkStmts];
  for (const [id, a] of add) {
    const it = items.get(id);
    const after = Math.round((it.qty + a.qty) * 1000) / 1000;
    stmts.push(db.prepare("INSERT INTO inventory_moves (item_id, at, kind, qty, before, after, note, user_id) VALUES (?, ?, 'purchase', ?, ?, ?, ?, ?)").bind(id, now, a.qty, it.qty, after, `${label}: ${a.from.join(', ')}`.slice(0, 300), me.id));
    stmts.push(db.prepare('UPDATE inventory_items SET qty = ?, updated_at = ?, updated_by = ? WHERE id = ?').bind(after, now, me.id, id));
    added.push({ name: it.name, qty: a.qty, unit: it.unit });
  }
  for (let i = 0; i < stmts.length; i += 80) await db.batch(stmts.slice(i, i + 80));
  return { added, notLinked };
}
