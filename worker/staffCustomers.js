// Customer registrations per employee, checked against the till.
// Every till upload (about every 30 minutes) saves the minutes in which the till rang up orders (Istanbul time).
// A registration (or a +1 order) with no till order within WINDOW minutes before or after it is "not on the till";
// two or more of these by the same employee within an hour get a warning.
// Registrations newer than the last till data are "waiting for the till" and are never flagged.

export const POS_ORDERS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS pos_order_minutes (at TEXT PRIMARY KEY, n INTEGER NOT NULL)`, // 'YYYY-MM-DD HH:MM' Istanbul time
];
export const WINDOW = 15; // minutes
const CLUSTER = 60; // minutes: unmatched registrations this close together are one warning
const KEEP_DAYS = 120;
const TZ_MIN = 180; // Istanbul is UTC+3 all year

const pad = (n) => String(n).padStart(2, '0');
const dayAdd = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
/** UTC ISO -> minutes since epoch in Istanbul time (so day boundaries are local). */
const localMin = (iso) => Math.floor((Date.parse(iso) + TZ_MIN * 60e3) / 60e3);
const minKey = (m) => { const d = new Date(m * 60e3); return `${d.toISOString().slice(0, 10)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
const keyMin = (k) => Math.floor(Date.parse(k.replace(' ', 'T') + ':00Z') / 60e3);

/** From the till model's invoices (calDate + minute of the day, local): orders per minute. */
export function orderMinutes(invoices, fromDay) {
  const out = new Map();
  let last = '';
  for (const inv of invoices) {
    const day = inv.calDate || inv.date;
    if (!(inv.sign > 0) || !day || day < fromDay || inv.minute == null) continue;
    const mm = ((inv.minute % 1440) + 1440) % 1440;
    const k = `${day} ${pad(Math.floor(mm / 60))}:${pad(mm % 60)}`;
    out.set(k, (out.get(k) || 0) + 1);
    if (k > last) last = k;
  }
  return { minutes: out, last };
}

/** Save the new upload's order minutes. Only the days from the last saved one are compared, and only changes are written. */
export async function savePosOrders(db, invoices) {
  const st = await db.prepare("SELECT value FROM settings WHERE key = 'posOrders'").first().catch(() => null);
  const prev = st ? JSON.parse(st.value) : null;
  const today = new Date(Date.now() + TZ_MIN * 60e3).toISOString().slice(0, 10);
  const fromDay = prev?.last ? dayAdd(prev.last.slice(0, 10), -1) : dayAdd(today, -60); // the first time: the last 60 days
  const { minutes, last } = orderMinutes(invoices, fromDay);
  if (!last) return { written: 0 };
  const have = new Map((await db.prepare('SELECT at, n FROM pos_order_minutes WHERE at >= ?').bind(fromDay).all()).results.map((r) => [r.at, r.n]));
  const stmts = [];
  for (const [k, n] of minutes) if (have.get(k) !== n) stmts.push(db.prepare('INSERT INTO pos_order_minutes (at, n) VALUES (?, ?) ON CONFLICT(at) DO UPDATE SET n = excluded.n').bind(k, n));
  for (const k of have.keys()) if (!minutes.has(k)) stmts.push(db.prepare('DELETE FROM pos_order_minutes WHERE at = ?').bind(k)); // a refunded / removed order
  if (!prev?.last || prev.last.slice(0, 10) !== last.slice(0, 10)) stmts.push(db.prepare('DELETE FROM pos_order_minutes WHERE at < ?').bind(dayAdd(today, -KEEP_DAYS)));
  stmts.push(db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind('posOrders', JSON.stringify({ last: last > (prev?.last || '') ? last : prev.last, at: new Date().toISOString(), first: prev?.first || fromDay })));
  for (let i = 0; i < stmts.length; i += 90) await db.batch(stmts.slice(i, i + 90));
  return { written: stmts.length - 1 };
}

/** GET /api/customers-staff?from=YYYY-MM-DD&to=YYYY-MM-DD (Istanbul days) */
export async function staffReport(db, h, url) {
  const today = minKey(localMin(new Date().toISOString())).slice(0, 10);
  const isD = (v) => /^\d{4}-\d\d-\d\d$/.test(v || '');
  const to = isD(url.searchParams.get('to')) ? url.searchParams.get('to') : today;
  const from = isD(url.searchParams.get('from')) ? url.searchParams.get('from') : dayAdd(to, -29);
  // the range in UTC for the queries (local midnight = 21:00 UTC the day before)
  const fromUtc = new Date(Date.parse(from + 'T00:00:00Z') - TZ_MIN * 60e3).toISOString();
  const toUtc = new Date(Date.parse(dayAdd(to, 1) + 'T00:00:00Z') - TZ_MIN * 60e3).toISOString();
  const users = new Map((await db.prepare('SELECT id, name, active FROM users').all()).results.map((u) => [u.id, u]));
  const regs = (await db.prepare('SELECT id, phone, name, created_at AS at, created_by AS user_id FROM customers WHERE created_at >= ? AND created_at < ?').bind(fromUtc, toUtc).all()).results;
  const ords = (await db.prepare(`SELECT o.customer_id, o.at, o.user_id, c.phone, c.name, c.created_at FROM customer_orders o LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.at >= ? AND o.at < ?`).bind(fromUtc, toUtc).all()).results;
  const pos = (await db.prepare('SELECT at FROM pos_order_minutes WHERE at >= ? AND at < ?').bind(dayAdd(from, -1), dayAdd(to, 2)).all()).results.map((r) => keyMin(r.at)).sort((a, b) => a - b);
  const st = await db.prepare("SELECT value FROM settings WHERE key = 'posOrders'").first();
  const posInfo = st ? JSON.parse(st.value) : null;
  const lastPos = posInfo?.last ? keyMin(posInfo.last) : null;
  const firstPos = posInfo?.first ? keyMin(posInfo.first + ' 00:00') : null;
  // nearest till order to minute m (binary search)
  const near = (m) => {
    let lo = 0, hi = pos.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pos[mid] < m) lo = mid + 1; else hi = mid; }
    const c = [pos[lo - 1], pos[lo]].filter((x) => x != null).map((x) => Math.abs(x - m));
    return c.length ? Math.min(...c) : Infinity;
  };
  const tail = (p) => '••• ' + String(p || '').slice(-4);
  const check = (at) => {
    const m = localMin(at);
    if (lastPos == null || m > lastPos - 1) return { m, state: 'waiting' }; // the till data does not reach this time yet
    if (firstPos != null && m < firstPos) return { m, state: 'nodata' }; // before the till times were kept
    return { m, state: near(m) <= WINDOW ? 'ok' : 'none' };
  };
  const per = new Map();
  const get = (id) => {
    if (!per.has(id)) per.set(id, { user_id: id, name: users.get(id)?.name || (id ? `User #${id}` : 'Unknown'), registered: 0, regNoTill: 0, orders: 0, ordersNoTill: 0, waiting: 0, events: [], warnings: [] });
    return per.get(id);
  };
  for (const r of regs) {
    const p = get(r.user_id), c = check(r.at);
    p.registered++;
    if (c.state === 'none') p.regNoTill++;
    if (c.state === 'waiting') p.waiting++;
    p.events.push({ kind: 'registration', at: r.at, local: minKey(c.m), state: c.state, customer: r.name || tail(r.phone) });
  }
  for (const o of ords) {
    if (o.created_at && Math.abs(Date.parse(o.created_at) - Date.parse(o.at)) < 5000) continue; // the first order is counted with the registration
    const p = get(o.user_id), c = check(o.at);
    p.orders++;
    if (c.state === 'none') p.ordersNoTill++;
    if (c.state === 'waiting') p.waiting++;
    p.events.push({ kind: 'order', at: o.at, local: minKey(c.m), state: c.state, customer: o.name || tail(o.phone) });
  }
  for (const p of per.values()) {
    p.events.sort((a, b) => (a.at < b.at ? 1 : -1));
    // warnings: 2+ registrations / orders not on the till within an hour of each other
    const bad = p.events.filter((e) => e.state === 'none').map((e) => ({ ...e, m: localMin(e.at) })).sort((a, b) => a.m - b.m);
    let group = [];
    const close = () => { if (group.length >= 2) p.warnings.push({ from: group[0].local, to: group[group.length - 1].local, count: group.length, registrations: group.filter((e) => e.kind === 'registration').length }); group = []; };
    for (const e of bad) { if (group.length && e.m - group[group.length - 1].m > CLUSTER) close(); group.push(e); }
    close();
    p.events = p.events.slice(0, 300);
  }
  const rows = [...per.values()].sort((a, b) => b.warnings.length - a.warnings.length || b.registered - a.registered);
  return h.json({ from, to, window: WINDOW, cluster: CLUSTER, till: posInfo, tillFrom: pos.length ? minKey(pos[0]) : null, rows });
}
