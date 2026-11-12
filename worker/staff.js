// Staff side of the site: accounts and roles, shifts and
// clock-in / clock-out with a location check. Stored in the D1 database "DB";
// receipt photos go to the KV namespace "DATA".
//
// Roles (one person can have several):
//   owner      everything: reports, accounts, accounting, schedule, attendance, salaries, settings
//   accountant accounting records, sales reports, net profit, salaries
//   expenses   records spending and sees what they recorded
//   manager    adds/removes baristas, plans shifts, sees and corrects attendance, salaries
//   barista    sees their own shifts, clocks in and out at the café
import { PLANNER_ROUTES, handlePlanner } from './planner.js';
import { ACCOUNTING_ROUTES, ACCOUNTING_SCHEMA, DEFAULT_ACCOUNTS, EXPENSE_COLUMNS, handleAccounting } from './accounting.js';
import { COOKIE, SESSION_DAYS, hashPassword, newToken, readCookie, sessionCookie, verifyPassword } from './auth.js';

export const ROLES = ['owner', 'accountant', 'manager', 'barista'];
const TZ_OFFSET_MIN = 180; // Türkiye is UTC+3 all year (no daylight saving since 2016)
const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;
const MAX_OPEN_HOURS = 16; // an open clock-in older than this counts as "forgot to clock out"
const MAX_GPS_ACCURACY_M = 150;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL, roles TEXT NOT NULL, pass TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, rate REAL,
    phone TEXT, color TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    stock INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, created_at TEXT NOT NULL,
    user_id INTEGER NOT NULL, category_id INTEGER NOT NULL, amount REAL NOT NULL, reason TEXT, receipt TEXT,
    payment TEXT, deleted INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS expenses_date ON expenses(date)`,
  `CREATE TABLE IF NOT EXISTS fixed_costs (id INTEGER PRIMARY KEY AUTOINCREMENT, month TEXT NOT NULL, item TEXT NOT NULL,
    amount REAL NOT NULL, note TEXT, source TEXT, created_at TEXT NOT NULL, user_id INTEGER)`,
  `CREATE INDEX IF NOT EXISTS fixed_month ON fixed_costs(month)`,
  `CREATE TABLE IF NOT EXISTS shifts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, date TEXT NOT NULL,
    start TEXT NOT NULL, end TEXT NOT NULL, note TEXT, created_by INTEGER, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS shifts_date ON shifts(date)`,
  `CREATE TABLE IF NOT EXISTS attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    in_at TEXT NOT NULL, in_lat REAL, in_lng REAL, in_acc REAL, in_dist REAL,
    out_at TEXT, out_lat REAL, out_lng REAL, out_acc REAL, out_dist REAL,
    note TEXT, edited_by INTEGER, edited_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS attendance_in ON attendance(in_at)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, user_id INTEGER, action TEXT NOT NULL, detail TEXT)`,
];
// [name, stock]: stock = ingredients / goods for sale, already counted in the recipe costs (COGS)
const DEFAULT_CATEGORIES = [['Coffee beans', 1], ['Milk & dairy', 1], ['Cups & packaging', 1], ['Syrups & sauces', 1],
  ['Pastries & food supplies', 1], ['Water', 1], ['Cleaning supplies', 0], ['Repairs & maintenance', 0], ['Transport', 0],
  ['Marketing', 0], ['Other', 0]];

let schemaReady = null;
function ensureSchema(db) {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.batch([...SCHEMA, ...ACCOUNTING_SCHEMA].map((s) => db.prepare(s)));
      // columns added after the first release
      const cols = [['users', ['email TEXT', 'must_change INTEGER NOT NULL DEFAULT 0', 'pay_type TEXT', 'monthly_salary REAL']], ['expenses', EXPENSE_COLUMNS]];
      for (const [table, list] of cols) {
        const have = new Set((await db.prepare(`PRAGMA table_info(${table})`).all()).results.map((c) => c.name));
        for (const col of list) if (!have.has(col.split(' ')[0])) await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col}`).run();
      }
      // role names used before: scheduler -> manager, expenses -> accountant
      await db.prepare("UPDATE users SET roles = REPLACE(REPLACE(roles, 'scheduler', 'manager'), 'expenses', 'accountant') WHERE roles LIKE '%scheduler%' OR roles LIKE '%expenses%'").run();
      const accs = await db.prepare('SELECT COUNT(*) AS n FROM money_accounts').first();
      if (!accs.n) {
        const now = new Date().toISOString();
        await db.batch(DEFAULT_ACCOUNTS.map(([name, type]) => db.prepare('INSERT OR IGNORE INTO money_accounts (name, type, created_at) VALUES (?, ?, ?)').bind(name, type, now)));
      }
      const { n } = await db.prepare('SELECT COUNT(*) AS n FROM categories').first();
      if (!n) {
        const now = new Date().toISOString();
        await db.batch(DEFAULT_CATEGORIES.map(([c, stock]) => db.prepare('INSERT OR IGNORE INTO categories (name, stock, created_at) VALUES (?, ?, ?)').bind(c, stock, now)));
      }
    })().catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

// ---------- helpers ----------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };
const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
});
const nowIso = () => new Date().toISOString();
/** Local (Türkiye) date and time for a UTC instant. */
export function localParts(iso = nowIso()) {
  const d = new Date(new Date(iso).getTime() + TZ_OFFSET_MIN * 60000).toISOString();
  return { date: d.slice(0, 10), time: d.slice(11, 16), month: d.slice(0, 7) };
}
/** UTC ISO for a local date + HH:MM. */
const localToIso = (date, hhmm) => new Date(new Date(`${date}T${hhmm}:00Z`).getTime() - TZ_OFFSET_MIN * 60000).toISOString();
const addDaysIso = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isMonth = (s) => typeof s === 'string' && /^\d{4}-\d{2}$/.test(s);
const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const str = (v, max = 300) => (v == null ? '' : String(v).trim().slice(0, max));
// accepts 1250.5, 1,250.50 and Turkish 1.250,50
const money = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN;
  let t = String(v ?? '').replace(/[^\d.,-]/g, '');
  if (!t) return NaN;
  if (t.includes(',') && t.lastIndexOf(',') > t.lastIndexOf('.')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ''); // 12.500 = twelve thousand five hundred
  else t = t.replace(/,/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};
const cleanEmail = (v) => {
  const e = str(v, 120).toLowerCase();
  if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) fail(400, 'The email address does not look right.');
  return e || null;
};
const rolesOf = (u) => (u?.roles || '').split(',').filter(Boolean);
const has = (u, ...roles) => { const r = rolesOf(u); return r.includes('owner') || roles.some((x) => r.includes(x)); };
const need = (u, ...roles) => { if (!u) fail(401, 'Please sign in.'); if (roles.length && !has(u, ...roles)) fail(403, 'Your account cannot do this.'); };

/** Distance in metres between two points (haversine). */
export function distanceM(a, b) {
  const R = 6371000, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const publicUser = (u) => u && ({
  id: u.id, username: u.username, name: u.name, roles: rolesOf(u), active: !!u.active,
  rate: u.rate, pay_type: u.pay_type || null, monthly_salary: u.monthly_salary ?? null, phone: u.phone || '', color: u.color || '', email: u.email || '', mustChange: !!u.must_change, created_at: u.created_at,
});

async function audit(db, user, action, detail) {
  await db.prepare('INSERT INTO audit (at, user_id, action, detail) VALUES (?, ?, ?, ?)')
    .bind(nowIso(), user?.id ?? null, action, typeof detail === 'string' ? detail : JSON.stringify(detail)).run();
}

async function body(request) {
  try { return await request.json(); } catch { fail(400, 'The request was not valid.'); }
}

// Mariam Coffee Shop's pin on Google Maps, used until the owner saves another location in Settings
const DEFAULT_SITE = { lat: 41.1236348, lng: 28.7777111, radius: 100, name: 'Mariam Coffee Shop', isDefault: true };
const siteOf = async (db) => (await getSetting(db, 'site')) || DEFAULT_SITE;

async function getSetting(db, key, fallback = null) {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row ? JSON.parse(row.value) : fallback;
}
async function setSetting(db, key, value) {
  await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, JSON.stringify(value)).run();
}

/** The signed-in user for this request, or null. */
export async function currentUser(request, env) {
  if (!env.DB) return null;
  await ensureSchema(env.DB);
  const token = readCookie(request, COOKIE);
  if (!token) return null;
  const u = await env.DB.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires > ? AND u.active = 1`).bind(token, Date.now()).first();
  return u || null;
}
export const isOwner = (u) => !!u && rolesOf(u).includes('owner');

// ---------- accounts ----------
async function login(request, env, passwordOk) {
  const db = env.DB;
  const { username, password } = await body(request);
  const uname = str(username, 60).toLowerCase();
  if (!uname || !password) fail(400, 'Enter your username and password.');
  let u = await db.prepare('SELECT * FROM users WHERE username = ?').bind(uname).first();
  if (!u) {
    // First start: no accounts yet -> "owner" + the existing upload password creates the owner account.
    const { n } = await db.prepare('SELECT COUNT(*) AS n FROM users').first();
    if (!n && uname === 'owner' && (await passwordOk(env, password))) {
      await db.prepare('INSERT INTO users (username, name, roles, pass, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind('owner', 'Owner', 'owner', await hashPassword(password), nowIso()).run();
      u = await db.prepare('SELECT * FROM users WHERE username = ?').bind('owner').first();
      await audit(db, u, 'account.bootstrap', 'Owner account created at first sign-in');
    }
  }
  if (!u || !u.active || !(await verifyPassword(String(password), u.pass))) {
    await new Promise((r) => setTimeout(r, 400));
    fail(401, 'Wrong username or password.');
  }
  const token = newToken();
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires < ?').bind(Date.now()),
    db.prepare('INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)').bind(token, u.id, Date.now() + SESSION_DAYS * 86400000),
  ]);
  return json({ user: publicUser(u) }, 200, { 'set-cookie': sessionCookie(token, SESSION_DAYS * 86400) });
}

async function logout(request, env) {
  const token = readCookie(request, COOKIE);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
}

async function changeOwnPassword(request, env, me) {
  const { current, next } = await body(request);
  if (!(await verifyPassword(String(current || ''), me.pass))) fail(400, 'Your current password is not right.');
  if (!next || String(next).length < 6) fail(400, 'The new password needs at least 6 characters.');
  if (String(next) === String(current)) fail(400, 'Choose a password different from the one you were given.');
  await env.DB.prepare('UPDATE users SET pass = ?, must_change = 0 WHERE id = ?').bind(await hashPassword(String(next)), me.id).run();
  await audit(env.DB, me, 'account.password', 'Changed own password');
  return json({ ok: true });
}

/** Owner manages every account; a scheduler manages barista-only accounts. */
function canManage(me, target, roles) {
  if (isOwner(me)) return true;
  if (!has(me, 'manager')) return false;
  const onlyBarista = (r) => r.length > 0 && r.every((x) => x === 'barista');
  return (!target || onlyBarista(rolesOf(target))) && (!roles || onlyBarista(roles));
}

async function users(request, env, me, id) {
  const db = env.DB;
  if (request.method === 'GET') {
    need(me, 'manager', 'accountant');
    const { results } = await db.prepare('SELECT * FROM users ORDER BY active DESC, name COLLATE NOCASE').all();
    return json({ users: results.filter((u) => isOwner(me) || rolesOf(u).includes('barista')).map(publicUser) });
  }
  const b = await body(request);
  const roles = b.roles ? [...new Set(b.roles)].filter((r) => ROLES.includes(r)) : null;
  const target = id ? await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first() : null;
  if (id && !target) fail(404, 'That account does not exist.');
  if (!canManage(me, target, roles)) fail(403, 'Your account cannot change this person.');
  const rate = b.rate === '' || b.rate == null ? null : money(b.rate);
  if (rate != null && (Number.isNaN(rate) || rate < 0)) fail(400, 'The hourly rate is not a number.');
  const color = /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : null;
  const payType = ['hourly', 'monthly'].includes(b.pay_type) ? b.pay_type : null;
  const salary = b.monthly_salary === '' || b.monthly_salary == null ? null : money(b.monthly_salary);
  if (salary != null && (Number.isNaN(salary) || salary < 0)) fail(400, 'The monthly salary is not a number.');

  if (request.method === 'POST' && !id) {
    const username = str(b.username, 40).toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) fail(400, 'Username: 3–40 letters or numbers (no spaces).');
    if (!str(b.name, 80)) fail(400, 'Enter the person’s name.');
    if (!roles?.length) fail(400, 'Choose at least one role.');
    if (!b.password || String(b.password).length < 6) fail(400, 'The password needs at least 6 characters.');
    const exists = await db.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
    if (exists) fail(400, 'That username is taken.');
    // a password chosen by someone else must be changed at the first sign-in
    const r = await db.prepare('INSERT INTO users (username, name, roles, pass, rate, phone, color, email, pay_type, monthly_salary, must_change, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)')
      .bind(username, str(b.name, 80), roles.join(','), await hashPassword(String(b.password)), rate, str(b.phone, 30), color, cleanEmail(b.email), payType, salary, nowIso()).run();
    await audit(db, me, 'account.create', { username, roles });
    return json({ id: r.meta.last_row_id });
  }
  if (request.method === 'PATCH' && target) {
    if (target.id === me.id && roles && !roles.includes('owner') && isOwner(me)) fail(400, 'You cannot remove your own owner role.');
    if (target.id === me.id && b.active === false) fail(400, 'You cannot deactivate your own account.');
    const sets = [], vals = [];
    if (b.name != null) { if (!str(b.name, 80)) fail(400, 'Enter the person’s name.'); sets.push('name = ?'); vals.push(str(b.name, 80)); }
    if (roles) { if (!roles.length) fail(400, 'Choose at least one role.'); sets.push('roles = ?'); vals.push(roles.join(',')); }
    if ('rate' in b) { sets.push('rate = ?'); vals.push(rate); }
    if ('phone' in b) { sets.push('phone = ?'); vals.push(str(b.phone, 30)); }
    if ('email' in b) { sets.push('email = ?'); vals.push(cleanEmail(b.email)); }
    if ('color' in b) { sets.push('color = ?'); vals.push(color); }
    if ('pay_type' in b) { sets.push('pay_type = ?'); vals.push(payType); }
    if ('monthly_salary' in b) { sets.push('monthly_salary = ?'); vals.push(salary); }
    if (b.active != null) { sets.push('active = ?'); vals.push(b.active ? 1 : 0); }
    if (b.password) {
      if (String(b.password).length < 6) fail(400, 'The password needs at least 6 characters.');
      sets.push('pass = ?'); vals.push(await hashPassword(String(b.password)));
      if (target.id !== me.id) sets.push('must_change = 1');
    }
    if (!sets.length) return json({ ok: true });
    const stmts = [db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, target.id)];
    if (b.active === false || b.password) stmts.push(db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id));
    if (b.active === false) stmts.push(db.prepare('DELETE FROM shifts WHERE user_id = ? AND date >= ?').bind(target.id, localParts().date));
    await db.batch(stmts);
    await audit(db, me, 'account.update', { username: target.username, changed: Object.keys(b).filter((k) => k !== 'password').concat(b.password ? ['password'] : []) });
    return json({ ok: true });
  }
  fail(405, 'Not allowed.');
}

// ---------- shifts ----------
async function shifts(request, env, me, id) {
  const db = env.DB;
  const url = new URL(request.url);
  if (request.method === 'GET') {
    need(me, 'barista', 'manager');
    const today = localParts().date;
    const from = isDate(url.searchParams.get('from')) ? url.searchParams.get('from') : addDaysIso(today, -7);
    const to = isDate(url.searchParams.get('to')) ? url.searchParams.get('to') : addDaysIso(today, 28);
    const all = has(me, 'manager');
    const { results } = await db.prepare(`SELECT s.*, u.name AS user_name, u.color FROM shifts s JOIN users u ON u.id = s.user_id
      WHERE s.date >= ? AND s.date <= ?${all ? '' : ' AND s.user_id = ?'} ORDER BY s.date, s.start`).bind(...[from, to, ...(all ? [] : [me.id])]).all();
    return json({ shifts: results, from, to });
  }
  need(me, 'manager');
  const check = async (s) => {
    if (!isDate(s.date)) fail(400, 'Choose a date for the shift.');
    if (!isTime(s.start) || !isTime(s.end)) fail(400, 'Enter start and end times like 08:00.');
    if (s.start === s.end) fail(400, 'The shift starts and ends at the same time.');
    const u = await db.prepare('SELECT id, roles, active FROM users WHERE id = ?').bind(Number(s.user_id)).first();
    if (!u || !u.active || !rolesOf(u).includes('barista')) fail(400, 'Choose an active barista.');
    return { user_id: u.id, date: s.date, start: s.start, end: s.end, note: str(s.note, 120) };
  };
  if (request.method === 'POST' && !id) {
    const b = await body(request);
    const list = Array.isArray(b.shifts) ? b.shifts : [b];
    if (list.length > 500) fail(400, 'Too many shifts at once (limit 500).');
    const clean = [];
    for (const s of list) clean.push(await check(s));
    const now = nowIso();
    const stmts = clean.map((s) => db.prepare('INSERT INTO shifts (user_id, date, start, end, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(s.user_id, s.date, s.start, s.end, s.note, me.id, now));
    if (b.replaceRange && isDate(b.replaceRange.from) && isDate(b.replaceRange.to)) {
      stmts.unshift(db.prepare('DELETE FROM shifts WHERE date >= ? AND date <= ?').bind(b.replaceRange.from, b.replaceRange.to));
    }
    if (stmts.length) await db.batch(stmts);
    await audit(db, me, 'shift.create', { count: clean.length });
    return json({ ok: true, count: clean.length });
  }
  if (request.method === 'PATCH' && id) {
    const s = await check(await body(request));
    await db.prepare('UPDATE shifts SET user_id = ?, date = ?, start = ?, end = ?, note = ? WHERE id = ?').bind(s.user_id, s.date, s.start, s.end, s.note, id).run();
    await audit(db, me, 'shift.update', { id, ...s });
    return json({ ok: true });
  }
  if (request.method === 'DELETE' && id) {
    await db.prepare('DELETE FROM shifts WHERE id = ?').bind(id).run();
    await audit(db, me, 'shift.delete', { id });
    return json({ ok: true });
  }
  if (request.method === 'DELETE') {
    const from = url.searchParams.get('from'), to = url.searchParams.get('to');
    if (!isDate(from) || !isDate(to)) fail(400, 'Choose the dates to clear.');
    const r = await db.prepare('DELETE FROM shifts WHERE date >= ? AND date <= ?').bind(from, to).run();
    await audit(db, me, 'shift.clear', { from, to, count: r.meta.changes });
    return json({ ok: true, count: r.meta.changes });
  }
  fail(405, 'Not allowed.');
}

// ---------- clock in / out ----------
async function openRecord(db, userId) {
  return db.prepare('SELECT * FROM attendance WHERE user_id = ? AND out_at IS NULL ORDER BY in_at DESC LIMIT 1').bind(userId).first();
}
const isStale = (rec) => rec && Date.now() - Date.parse(rec.in_at) > MAX_OPEN_HOURS * 3600000;

async function clockStatus(env, me) {
  const db = env.DB;
  const site = await siteOf(db);
  const open = await openRecord(db, me.id);
  const today = localParts().date;
  const { results: upcoming } = await db.prepare('SELECT * FROM shifts WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date, start')
    .bind(me.id, addDaysIso(today, -1), addDaysIso(today, 13)).all();
  const { results: recent } = await db.prepare('SELECT * FROM attendance WHERE user_id = ? ORDER BY in_at DESC LIMIT 20').bind(me.id).all();
  return json({
    site: site ? { name: site.name, radius: site.radius, set: true } : { set: false },
    open: open && !isStale(open) ? open : null,
    forgotten: open && isStale(open) ? open : null,
    now: nowIso(), today, upcoming, recent,
  });
}

async function clock(request, env, me, kind) {
  need(me, 'barista');
  const db = env.DB;
  const site = await siteOf(db);
  if (!site) fail(400, 'The owner has not set the café location yet, so clocking in is not possible.');
  const b = await body(request);
  const lat = Number(b.lat), lng = Number(b.lng), acc = Number(b.accuracy);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) fail(400, 'Your location could not be read. Allow location for this site and try again.');
  if (!Number.isFinite(acc) || acc > MAX_GPS_ACCURACY_M) fail(400, `Your phone’s location is not precise enough (±${Math.round(acc) || '?'} m). Turn on precise location / GPS, step near a window and try again.`);
  const dist = Math.round(distanceM({ lat, lng }, site));
  const open = await openRecord(db, me.id);
  const at = nowIso(); // the server's clock, not the phone's
  if (dist > site.radius) {
    await audit(db, me, `clock.${kind}.refused`, { dist, acc: Math.round(acc) });
    fail(403, `You are about ${dist >= 1000 ? (dist / 1000).toFixed(1) + ' km' : dist + ' m'} from ${site.name || 'the café'}. You must be inside the café (within ${site.radius} m) to clock ${kind}.`);
  }
  if (kind === 'in') {
    if (open && !isStale(open)) fail(400, 'You are already clocked in.');
    const r = await db.prepare('INSERT INTO attendance (user_id, in_at, in_lat, in_lng, in_acc, in_dist) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(me.id, at, lat, lng, Math.round(acc), dist).run();
    await audit(db, me, 'clock.in', { id: r.meta.last_row_id, dist });
    return json({ ok: true, at, dist });
  }
  if (!open || isStale(open)) fail(400, 'You are not clocked in.');
  await db.prepare('UPDATE attendance SET out_at = ?, out_lat = ?, out_lng = ?, out_acc = ?, out_dist = ? WHERE id = ?')
    .bind(at, lat, lng, Math.round(acc), dist, open.id).run();
  await audit(db, me, 'clock.out', { id: open.id, dist });
  return json({ ok: true, at, dist });
}

/** Attendance for a period, with each record matched to the shift it belongs to. */
async function attendance(request, env, me, id) {
  const db = env.DB;
  const url = new URL(request.url);
  if (request.method === 'GET') {
    need(me, 'barista', 'manager');
    const all = has(me, 'manager');
    const today = localParts().date;
    const from = isDate(url.searchParams.get('from')) ? url.searchParams.get('from') : addDaysIso(today, -13);
    const to = isDate(url.searchParams.get('to')) ? url.searchParams.get('to') : today;
    const fromIso = localToIso(addDaysIso(from, -1), '00:00'), toIso = localToIso(addDaysIso(to, 1), '23:59');
    const who = all ? [] : [me.id];
    const [rec, sh] = await Promise.all([
      db.prepare(`SELECT a.*, u.name AS user_name FROM attendance a JOIN users u ON u.id = a.user_id
        WHERE a.in_at >= ? AND a.in_at <= ?${all ? '' : ' AND a.user_id = ?'} ORDER BY a.in_at`).bind(fromIso, toIso, ...who).all(),
      db.prepare(`SELECT s.*, u.name AS user_name, u.rate FROM shifts s JOIN users u ON u.id = s.user_id
        WHERE s.date >= ? AND s.date <= ?${all ? '' : ' AND s.user_id = ?'} ORDER BY s.date, s.start`).bind(from, to, ...who).all(),
    ]);
    const { results: people } = all ? await db.prepare('SELECT id, name, rate, active FROM users').all() : { results: [{ id: me.id, name: me.name, rate: me.rate }] };
    return json({ from, to, now: nowIso(), records: rec.results, shifts: sh.results, people: people.map((p) => ({ id: p.id, name: p.name, rate: all ? p.rate : null })) });
  }
  need(me, 'manager');
  if (request.method === 'POST' && !id) {
    // manual record (e.g. a phone problem); always marked as edited
    const b = await body(request);
    const u = await db.prepare('SELECT id FROM users WHERE id = ?').bind(Number(b.user_id)).first();
    if (!u) fail(400, 'Choose a barista.');
    const inAt = parseLocal(b.in_date, b.in_time, 'clock-in');
    const outAt = b.out_time ? parseLocal(b.out_date || b.in_date, b.out_time, 'clock-out') : null;
    if (outAt && outAt <= inAt) fail(400, 'Clock-out must be after clock-in.');
    const r = await db.prepare('INSERT INTO attendance (user_id, in_at, out_at, note, edited_by, edited_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(u.id, inAt, outAt, str(b.note, 200) || 'Added by hand', me.id, nowIso()).run();
    await audit(db, me, 'attendance.create', { id: r.meta.last_row_id, user_id: u.id, inAt, outAt });
    return json({ ok: true });
  }
  if (request.method === 'PATCH' && id) {
    const b = await body(request);
    const row = await db.prepare('SELECT * FROM attendance WHERE id = ?').bind(id).first();
    if (!row) fail(404, 'Record not found.');
    const inAt = b.in_time ? parseLocal(b.in_date, b.in_time, 'clock-in') : row.in_at;
    const outAt = b.out_time ? parseLocal(b.out_date, b.out_time, 'clock-out') : b.out_time === '' ? null : row.out_at;
    if (outAt && outAt <= inAt) fail(400, 'Clock-out must be after clock-in.');
    if (!str(b.note, 200)) fail(400, 'Write a short reason for the correction.');
    await db.prepare('UPDATE attendance SET in_at = ?, out_at = ?, note = ?, edited_by = ?, edited_at = ? WHERE id = ?')
      .bind(inAt, outAt, str(b.note, 200), me.id, nowIso(), id).run();
    await audit(db, me, 'attendance.update', { id, before: { in: row.in_at, out: row.out_at }, after: { in: inAt, out: outAt }, note: b.note });
    return json({ ok: true });
  }
  if (request.method === 'DELETE' && id) {
    const row = await db.prepare('SELECT * FROM attendance WHERE id = ?').bind(id).first();
    await db.prepare('DELETE FROM attendance WHERE id = ?').bind(id).run();
    await audit(db, me, 'attendance.delete', row || { id });
    return json({ ok: true });
  }
  fail(405, 'Not allowed.');
}
function parseLocal(date, time, what) {
  if (!isDate(date) || !isTime(time)) fail(400, `Enter the ${what} date and time.`);
  return localToIso(date, time);
}

// ---------- settings & activity (owner) ----------
async function site(request, env, me) {
  const db = env.DB;
  if (request.method === 'GET') {
    need(me, 'owner');
    return json({ site: await siteOf(db) });
  }
  need(me, 'owner');
  const b = await body(request);
  const lat = Number(b.lat), lng = Number(b.lng), radius = Math.round(Number(b.radius));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) fail(400, 'The location is not valid.');
  if (!Number.isFinite(radius) || radius < 20 || radius > 2000) fail(400, 'The allowed distance must be between 20 and 2,000 metres.');
  const value = { lat, lng, radius, name: str(b.name, 80) || 'Mariam Coffee', updatedAt: nowIso() };
  await setSetting(db, 'site', value);
  await audit(db, me, 'settings.site', value);
  return json({ site: value });
}

async function activity(request, env, me) {
  need(me, 'owner');
  const { results } = await env.DB.prepare(`SELECT a.*, u.name AS user_name FROM audit a LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.id DESC LIMIT 300`).all();
  return json({ activity: results });
}

// ---------- router ----------
export async function handleStaff(request, env, path, passwordOk) {
  if (!env.DB) return json({ error: 'The staff database is not configured on this deployment.' }, 503);
  try {
    await ensureSchema(env.DB);
    const seg = path.split('/').filter(Boolean).slice(1); // after "api"
    const [head, sub] = seg;
    const idOf = (v) => (v && /^\d+$/.test(v) ? Number(v) : null);
    const m = request.method;
    if (head === 'login' && m === 'POST') return await login(request, env, passwordOk);
    if (head === 'logout' && m === 'POST') return await logout(request, env);
    const me = await currentUser(request, env);
    if (head === 'me') {
      if (sub === 'password' && m === 'POST') { need(me); return await changeOwnPassword(request, env, me); }
      if (!me) {
        const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
        return json({ user: null, firstRun: !n });
      }
      return json({ user: publicUser(me) });
    }
    if (PLANNER_ROUTES.includes(head)) {
      return await handlePlanner({ request, env, head, me, need, isOwner, passwordOk, getSetting, setSetting, audit, fail });
    }
    need(me);
    if (ACCOUNTING_ROUTES.includes(head)) {
      const h = { need, fail, json, str, money, isDate, isMonth, audit, body, nowIso, localParts, localToIso, isOwner, newToken };
      return await handleAccounting({ head, sub, request, env, me, h });
    }
    switch (head) {
      case 'users': return await users(request, env, me, idOf(sub));
      case 'shifts': return await shifts(request, env, me, idOf(sub));
      case 'clock':
        if (!sub && m === 'GET') { need(me, 'barista'); return await clockStatus(env, me); }
        if ((sub === 'in' || sub === 'out') && m === 'POST') return await clock(request, env, me, sub);
        break;
      case 'attendance': return await attendance(request, env, me, idOf(sub));
      case 'site': return await site(request, env, me);
      case 'activity': return await activity(request, env, me);
      default:
    }
    return json({ error: 'Not found' }, 404);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Something went wrong on the server. Please try again.' }, 500);
  }
}

export const STAFF_ROUTES = [...PLANNER_ROUTES, ...ACCOUNTING_ROUTES, 'login', 'logout', 'me', 'users', 'shifts', 'clock', 'attendance', 'site', 'activity'];
