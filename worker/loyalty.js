// Customer loyalty: customers registered by phone number, an order counter, levels and gifts.
// Every signed-in staff member can find a customer (by number), register one, count an order and hand out gifts.
// Only managers and the owner see the whole list, export it, delete customers and change the rules.
//
//   GET    /api/customers?q=           find (staff: at least 4 digits of the phone; managers: any text, or all)
//   GET    /api/customers/:id          one customer with orders and gifts
//   POST   /api/customers              { phone, name?, lang, offers, birth? }
//   PATCH  /api/customers/:id          same fields
//   DELETE /api/customers/:id          (manager)
//   POST   /api/customers/:id/order    { force? } count one order -> { customer, earned: [...] }
//   POST   /api/customers/:id/undo     remove the last order (staff: within 15 minutes; managers: any time)
//   POST   /api/customers/:id/birthday give this year's birthday gift
//   POST   /api/customer-gifts/:id     mark an earned gift as given
//   GET    /api/customers-export       CSV of customers who accept offers (manager)
//   GET    /api/customers-stats        numbers for the manager (manager)
//   GET/PUT /api/loyalty-settings      levels, gifts, rules (PUT: manager)

export const LOYALTY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT NOT NULL UNIQUE, name TEXT, lang TEXT NOT NULL,
    offers INTEGER NOT NULL, birth TEXT, orders INTEGER NOT NULL DEFAULT 0, last_order_at TEXT, note TEXT,
    created_at TEXT NOT NULL, created_by INTEGER, updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS customer_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL, at TEXT NOT NULL, user_id INTEGER)`,
  `CREATE INDEX IF NOT EXISTS customer_orders_c ON customer_orders(customer_id, at)`,
  `CREATE TABLE IF NOT EXISTS customer_gifts (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL, kind TEXT NOT NULL, gift TEXT NOT NULL,
    at_order INTEGER, year INTEGER, earned_at TEXT NOT NULL, given_at TEXT, given_by INTEGER)`,
  `CREATE INDEX IF NOT EXISTS customer_gifts_c ON customer_gifts(customer_id)`,
];
export const LOYALTY_ROUTES = ['customers', 'customer-gifts', 'customers-export', 'customers-stats', 'loyalty-settings'];

export const DEFAULT_LOYALTY = {
  levels: [{ name: 'Bronze', min: 0, gift: '' }, { name: 'Silver', min: 10, gift: 'A free dessert' }, { name: 'Gold', min: 30, gift: 'A bag of Mariam Turkish coffee (100 g)' }],
  every: { n: 10, gift: 'A free hot drink' },
  birthday: { on: true, gift: 'A free drink and dessert', days: 3 },
  cooldownHours: 2,
};
const LANGS = ['ar', 'tr', 'en'];

/** Phone to one form: digits with the country code (Turkish numbers without it get 90). */
export function normPhone(v) {
  let d = String(v || '').replace(/[^\d+]/g, '');
  const plus = d.startsWith('+') || d.startsWith('00');
  d = d.replace(/^\+/, '').replace(/^00/, '');
  if (!plus) {
    if (d.length === 11 && d.startsWith('0')) d = '90' + d.slice(1);
    else if (d.length === 10 && d.startsWith('5')) d = '90' + d;
  }
  return /^\d{10,15}$/.test(d) ? d : null;
}
const show = (p) => (p.startsWith('90') && p.length === 12 ? `+90 ${p.slice(2, 5)} ${p.slice(5, 8)} ${p.slice(8, 10)} ${p.slice(10)}` : '+' + p);
const mask = (p) => '••• ' + p.slice(-4);

async function settings(h, db) {
  const s = (await h.getSetting(db, 'loyalty')) || {};
  return { ...DEFAULT_LOYALTY, ...s, every: { ...DEFAULT_LOYALTY.every, ...(s.every || {}) }, birthday: { ...DEFAULT_LOYALTY.birthday, ...(s.birthday || {}) }, levels: s.levels?.length ? s.levels : DEFAULT_LOYALTY.levels };
}
const levelOf = (cfg, n) => [...cfg.levels].sort((a, b) => a.min - b.min).filter((l) => n >= l.min).pop() || cfg.levels[0];

/** Istanbul calendar date (YYYY-MM-DD) of an ISO time. */
const istDay = (iso = new Date().toISOString()) => new Date(Date.parse(iso) + 3 * 3600e3).toISOString().slice(0, 10);
function birthdayNow(birth, days, today = istDay()) {
  if (!/^\d{2}-\d{2}$/.test(birth || '')) return false;
  const y = Number(today.slice(0, 4));
  for (const yy of [y - 1, y, y + 1]) {
    const d = Date.parse(`${yy}-${birth}T00:00:00Z`);
    if (Number.isFinite(d) && Math.abs(d - Date.parse(today + 'T00:00:00Z')) <= days * 86400e3) return true;
  }
  return false;
}

async function view(db, h, cfg, c, me, full) {
  const manager = h.has(me, 'manager');
  const lvl = levelOf(cfg, c.orders);
  const next = [...cfg.levels].sort((a, b) => a.min - b.min).find((l) => l.min > c.orders);
  const gifts = (await db.prepare('SELECT * FROM customer_gifts WHERE customer_id = ? ORDER BY id DESC').bind(c.id).all()).results;
  const year = Number(istDay().slice(0, 4));
  const bday = cfg.birthday.on && birthdayNow(c.birth, cfg.birthday.days) && !gifts.some((g) => g.kind === 'birthday' && g.year === year);
  const out = {
    id: c.id, phone: manager || full ? show(c.phone) : mask(c.phone), name: c.name || '', lang: c.lang, offers: !!c.offers, birth: c.birth || '',
    orders: c.orders, last_order_at: c.last_order_at, created_at: c.created_at,
    level: lvl?.name || '', nextLevel: next ? { name: next.name, in: next.min - c.orders } : null,
    nextGiftIn: cfg.every.n > 0 ? cfg.every.n - (c.orders % cfg.every.n) : null, everyGift: cfg.every.gift, everyN: cfg.every.n,
    pending: gifts.filter((g) => !g.given_at).map((g) => ({ id: g.id, gift: g.gift, kind: g.kind, at_order: g.at_order })),
    birthdayGift: bday ? cfg.birthday.gift : null,
  };
  if (full) {
    out.gifts = gifts.map((g) => ({ id: g.id, gift: g.gift, kind: g.kind, at_order: g.at_order, earned_at: g.earned_at, given_at: g.given_at }));
    out.history = (await db.prepare('SELECT o.at, u.name AS by FROM customer_orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.customer_id = ? ORDER BY o.id DESC LIMIT 50').bind(c.id).all()).results;
  }
  return out;
}

function cleanFields(h, b, partial) {
  const out = {};
  if (!partial || 'phone' in b) { const p = normPhone(b.phone); if (!p) h.fail(400, 'Type a valid mobile number (e.g. 0555 123 45 67 or +966 …).'); out.phone = p; }
  if (!partial || 'name' in b) out.name = h.str(b.name, 80) || null;
  if (!partial || 'lang' in b) { if (!LANGS.includes(b.lang)) h.fail(400, 'Choose the language.'); out.lang = b.lang; }
  if (!partial || 'offers' in b) { if (typeof b.offers !== 'boolean') h.fail(400, 'Choose whether they accept special offers.'); out.offers = b.offers ? 1 : 0; }
  if (!partial || 'birth' in b) { const v = h.str(b.birth, 5); if (v && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v)) h.fail(400, 'Birthday: choose day and month.'); out.birth = v || null; }
  if ('note' in b) out.note = h.str(b.note, 300) || null;
  return out;
}

/** Count one order: gifts for every Nth order and for reaching a level. */
async function addOrder(db, h, cfg, c, me, force) {
  const now = h.nowIso();
  if (c.last_order_at && !force && Date.now() - Date.parse(c.last_order_at) < (Number(cfg.cooldownHours) || 0) * 3600e3) {
    const mins = Math.round((Date.now() - Date.parse(c.last_order_at)) / 60000);
    return { blocked: true, message: mins < 1 ? 'An order was already counted just now.' : `An order was already counted ${mins} minute${mins === 1 ? '' : 's'} ago.` };
  }
  const n = c.orders + 1;
  const before = levelOf(cfg, c.orders), after = levelOf(cfg, n);
  const earned = [];
  if (cfg.every.n > 0 && n % cfg.every.n === 0 && cfg.every.gift) earned.push({ kind: 'every', gift: cfg.every.gift });
  if (after && before && after.name !== before.name && after.gift) earned.push({ kind: 'level', gift: after.gift, level: after.name });
  const stmts = [
    db.prepare('INSERT INTO customer_orders (customer_id, at, user_id) VALUES (?, ?, ?)').bind(c.id, now, me.id),
    db.prepare('UPDATE customers SET orders = ?, last_order_at = ?, updated_at = ? WHERE id = ?').bind(n, now, now, c.id),
    ...earned.map((g) => db.prepare('INSERT INTO customer_gifts (customer_id, kind, gift, at_order, earned_at) VALUES (?, ?, ?, ?, ?)').bind(c.id, g.kind, g.gift, n, now)),
  ];
  await db.batch(stmts);
  return { earned, levelUp: after && before && after.name !== before.name ? after.name : null };
}

export async function handleLoyalty({ head, sub, request, env, me, h }) {
  const db = env.DB;
  const m = request.method;
  h.need(me);
  const manager = h.has(me, 'manager');
  const cfg = await settings(h, db);
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/management/, '').split('/').filter(Boolean); // api, head, id, action
  const id = /^\d+$/.test(parts[2] || '') ? Number(parts[2]) : null;
  const action = parts[3] || null;
  const get = async (cid) => { const c = await db.prepare('SELECT * FROM customers WHERE id = ?').bind(cid).first(); if (!c) h.fail(404, 'Customer not found.'); return c; };

  if (head === 'loyalty-settings') {
    if (m === 'GET') return h.json({ settings: cfg });
    if (m !== 'PUT') h.fail(405, 'Not allowed.');
    if (!manager) h.fail(403, 'Only a manager or the owner can change the rules.');
    const b = await h.body(request);
    const levels = (Array.isArray(b.levels) ? b.levels : []).map((l) => ({ name: h.str(l.name, 30), min: Math.max(0, Math.floor(Number(l.min) || 0)), gift: h.str(l.gift, 120) })).filter((l) => l.name).slice(0, 8);
    if (!levels.length || !levels.some((l) => l.min === 0)) h.fail(400, 'Keep a first level that starts at 0 orders.');
    const s = {
      levels: levels.sort((a, c) => a.min - c.min),
      every: { n: Math.max(0, Math.floor(Number(b.every?.n) || 0)), gift: h.str(b.every?.gift, 120) },
      birthday: { on: !!b.birthday?.on, gift: h.str(b.birthday?.gift, 120), days: Math.min(15, Math.max(0, Math.floor(Number(b.birthday?.days) || 0))) },
      cooldownHours: Math.min(24, Math.max(0, Number(b.cooldownHours) || 0)),
    };
    await h.setSetting(db, 'loyalty', s);
    await h.audit(db, me, 'loyalty.settings', s);
    return h.json({ ok: true, settings: s });
  }

  if (head === 'customer-gifts') {
    const gid = Number(sub);
    if (m !== 'POST' || !gid) h.fail(405, 'Not allowed.');
    const g = await db.prepare('SELECT * FROM customer_gifts WHERE id = ?').bind(gid).first();
    if (!g) h.fail(404, 'Gift not found.');
    if (g.given_at) h.fail(409, 'This gift was already given.');
    await db.prepare('UPDATE customer_gifts SET given_at = ?, given_by = ? WHERE id = ?').bind(h.nowIso(), me.id, gid).run();
    await h.audit(db, me, 'loyalty.gift', { customer: g.customer_id, gift: g.gift });
    return h.json({ ok: true, customer: await view(db, h, cfg, await get(g.customer_id), me, true) });
  }

  if (head === 'customers-export') {
    if (!manager) h.fail(403, 'Only a manager or the owner can export customers.');
    const { results } = await db.prepare('SELECT * FROM customers WHERE offers = 1 ORDER BY lang, name').all();
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = ['Phone,Name,Language,Orders,Level,Birthday,Registered', ...results.map((c) => [show(c.phone), c.name, { ar: 'Arabic', tr: 'Turkish', en: 'English' }[c.lang], c.orders, levelOf(cfg, c.orders)?.name, c.birth, c.created_at.slice(0, 10)].map(esc).join(','))];
    await h.audit(db, me, 'loyalty.export', { count: results.length });
    return new Response('﻿' + lines.join('\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="mariam-customers-offers.csv"', 'cache-control': 'no-store' } });
  }

  if (head === 'customers-stats') {
    if (!manager) h.fail(403, 'Not allowed.');
    const week = new Date(Date.now() - 7 * 86400e3).toISOString(), month = new Date(Date.now() - 30 * 86400e3).toISOString();
    const one = async (sql, ...a) => (await db.prepare(sql).bind(...a).first()).n;
    return h.json({
      customers: await one('SELECT COUNT(*) AS n FROM customers'),
      offers: await one('SELECT COUNT(*) AS n FROM customers WHERE offers = 1'),
      newWeek: await one('SELECT COUNT(*) AS n FROM customers WHERE created_at >= ?', week),
      ordersWeek: await one('SELECT COUNT(*) AS n FROM customer_orders WHERE at >= ?', week),
      returning: await one('SELECT COUNT(*) AS n FROM customers WHERE orders >= 2'),
      giftsMonth: await one('SELECT COUNT(*) AS n FROM customer_gifts WHERE given_at >= ?', month),
      giftsWaiting: await one('SELECT COUNT(*) AS n FROM customer_gifts WHERE given_at IS NULL'),
      byLang: (await db.prepare('SELECT lang, COUNT(*) AS n FROM customers GROUP BY lang').all()).results,
    });
  }

  // ---- customers
  if (!id) {
    if (m === 'GET') {
      const q = (url.searchParams.get('q') || '').trim();
      const digits = q.replace(/\D/g, '');
      let rows;
      if (!manager) {
        // staff: by number only, at least the last 4 digits
        if (digits.length < 4) h.fail(400, 'Type at least the last 4 digits of the mobile number.');
        const p = normPhone(q);
        rows = (await db.prepare('SELECT * FROM customers WHERE phone = ? OR phone LIKE ? ORDER BY last_order_at DESC LIMIT 5').bind(p || '-', '%' + digits).all()).results;
      } else if (q) {
        const p = normPhone(q);
        rows = (await db.prepare('SELECT * FROM customers WHERE phone = ? OR (? <> \'\' AND phone LIKE ?) OR lower(coalesce(name, \'\')) LIKE ? ORDER BY last_order_at DESC LIMIT 200')
          .bind(p || '-', digits, '%' + digits + '%', '%' + q.toLowerCase() + '%').all()).results;
      } else {
        rows = (await db.prepare('SELECT * FROM customers ORDER BY coalesce(last_order_at, created_at) DESC LIMIT 1000').all()).results;
      }
      const exact = normPhone(q);
      const out = [];
      for (const c of rows) out.push(await view(db, h, cfg, c, me, false));
      return h.json({ customers: out, exact: exact && rows.some((c) => c.phone === exact) ? rows.find((c) => c.phone === exact).id : null, normalized: exact ? show(exact) : null, settings: cfg });
    }
    if (m === 'POST') {
      const b = await h.body(request);
      const v = cleanFields(h, b, false);
      const ex = await db.prepare('SELECT id FROM customers WHERE phone = ?').bind(v.phone).first();
      if (ex) return h.json({ error: 'This number is already registered.', id: ex.id }, 409);
      const now = h.nowIso();
      const r = await db.prepare('INSERT INTO customers (phone, name, lang, offers, birth, note, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(v.phone, v.name, v.lang, v.offers, v.birth, v.note ?? null, now, me.id).run();
      let c = await get(r.meta.last_row_id);
      let earned = [];
      if (b.countOrder) { earned = (await addOrder(db, h, cfg, c, me, true)).earned || []; c = await get(c.id); }
      await h.audit(db, me, 'loyalty.add', { id: c.id });
      return h.json({ ok: true, customer: await view(db, h, cfg, c, me, true), earned });
    }
    h.fail(405, 'Not allowed.');
  }
  const c = await get(id);
  if (!action) {
    if (m === 'GET') return h.json({ customer: await view(db, h, cfg, c, me, true), settings: cfg });
    if (m === 'PATCH') {
      const v = cleanFields(h, await h.body(request), true);
      if (v.phone && v.phone !== c.phone && (await db.prepare('SELECT id FROM customers WHERE phone = ?').bind(v.phone).first())) h.fail(409, 'Another customer already has this number.');
      const cols = Object.keys(v);
      if (cols.length) await db.prepare(`UPDATE customers SET ${cols.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).bind(...cols.map((k) => v[k]), h.nowIso(), id).run();
      return h.json({ ok: true, customer: await view(db, h, cfg, await get(id), me, true) });
    }
    if (m === 'DELETE') {
      if (!manager) h.fail(403, 'Only a manager or the owner can delete a customer.');
      await db.batch([db.prepare('DELETE FROM customer_orders WHERE customer_id = ?').bind(id), db.prepare('DELETE FROM customer_gifts WHERE customer_id = ?').bind(id), db.prepare('DELETE FROM customers WHERE id = ?').bind(id)]);
      await h.audit(db, me, 'loyalty.delete', { id });
      return h.json({ ok: true });
    }
    h.fail(405, 'Not allowed.');
  }
  if (m !== 'POST') h.fail(405, 'Not allowed.');
  if (action === 'order') {
    const b = await h.body(request);
    const r = await addOrder(db, h, cfg, c, me, b.force && manager);
    if (r.blocked) return h.json({ blocked: true, message: r.message, canForce: manager, customer: await view(db, h, cfg, c, me, true) });
    await h.audit(db, me, 'loyalty.order', { id });
    return h.json({ ok: true, ...r, customer: await view(db, h, cfg, await get(id), me, true) });
  }
  if (action === 'undo') {
    const last = await db.prepare('SELECT * FROM customer_orders WHERE customer_id = ? ORDER BY id DESC LIMIT 1').bind(id).first();
    if (!last) h.fail(400, 'No order to remove.');
    if (!manager && Date.now() - Date.parse(last.at) > 15 * 60e3) h.fail(403, 'Only orders from the last 15 minutes can be removed. Ask a manager.');
    const prev = await db.prepare('SELECT at FROM customer_orders WHERE customer_id = ? AND id < ? ORDER BY id DESC LIMIT 1').bind(id, last.id).first();
    await db.batch([
      db.prepare('DELETE FROM customer_orders WHERE id = ?').bind(last.id),
      db.prepare('DELETE FROM customer_gifts WHERE customer_id = ? AND at_order = ? AND given_at IS NULL').bind(id, c.orders),
      db.prepare('UPDATE customers SET orders = MAX(0, orders - 1), last_order_at = ?, updated_at = ? WHERE id = ?').bind(prev?.at || null, h.nowIso(), id),
    ]);
    await h.audit(db, me, 'loyalty.undo', { id });
    return h.json({ ok: true, customer: await view(db, h, cfg, await get(id), me, true) });
  }
  if (action === 'birthday') {
    const year = Number(istDay().slice(0, 4));
    if (!cfg.birthday.on || !birthdayNow(c.birth, cfg.birthday.days)) h.fail(400, 'It is not this customer\'s birthday week.');
    if (await db.prepare("SELECT id FROM customer_gifts WHERE customer_id = ? AND kind = 'birthday' AND year = ?").bind(id, year).first()) h.fail(409, 'The birthday gift was already given this year.');
    const now = h.nowIso();
    await db.prepare("INSERT INTO customer_gifts (customer_id, kind, gift, year, earned_at, given_at, given_by) VALUES (?, 'birthday', ?, ?, ?, ?, ?)").bind(id, cfg.birthday.gift, year, now, now, me.id).run();
    return h.json({ ok: true, customer: await view(db, h, cfg, await get(id), me, true) });
  }
  return h.fail(404, 'Not found');
}
