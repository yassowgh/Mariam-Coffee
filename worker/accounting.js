// Accounting records (expenses and bills), money accounts, loans, receipts and salary data.
//
// A record: what (name), category, amount (+ transfer fees), the date of the expense, and its status:
//   paid       paid on paid_date from a money account (cash, bank, loan from a person, bank loan)
//   scheduled  to be paid on due_date
//   unpaid     to be paid, date not known yet
// kind: regular | old_debt (paying an old bill) | advance (avans to an employee) | loan_repayment
// A loan_repayment pays back a loan account (loan_account_id) and is not a cost in the profit report.
//
// Roles: owner and accountant add records; an accountant edits or removes only their own records.

export const ACCOUNT_TYPES = ['cash', 'bank', 'person_loan', 'bank_loan'];
const KINDS = ['regular', 'old_debt', 'advance', 'loan_repayment'];
const STATUSES = ['paid', 'scheduled', 'unpaid'];
const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;

export const ACCOUNTING_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS money_accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    type TEXT NOT NULL DEFAULT 'bank', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)`,
];
export const EXPENSE_COLUMNS = ['name TEXT', "status TEXT NOT NULL DEFAULT 'paid'", 'due_date TEXT', 'paid_date TEXT', 'account_id INTEGER',
  'payee TEXT', 'payee_type TEXT', 'employee TEXT', 'employee_user_id INTEGER', "kind TEXT NOT NULL DEFAULT 'regular'",
  'fees REAL NOT NULL DEFAULT 0', 'paid_by TEXT', "currency TEXT NOT NULL DEFAULT 'TRY'", 'loan_account_id INTEGER', 'import_ref TEXT', 'updated_at TEXT'];
export const DEFAULT_ACCOUNTS = [['Cash - TRY', 'cash'], ['Ziraat - Mustafa', 'bank'], ['Finans Turkiye - Old Co.', 'bank'],
  ['Yaman - Yapı Kredi', 'bank'], ['İsra - Kuveyt Türk', 'bank'], ['EMA - Ziraat Bank', 'bank']];

const SELECT = `SELECT e.*, c.name AS category, c.stock, u.name AS user_name, a.name AS account, a.type AS account_type,
  la.name AS loan_account FROM expenses e JOIN categories c ON c.id = e.category_id LEFT JOIN users u ON u.id = e.user_id
  LEFT JOIN money_accounts a ON a.id = e.account_id LEFT JOIN money_accounts la ON la.id = e.loan_account_id`;

export async function handleAccounting(ctx) {
  const { head, sub, me, h } = ctx;
  const { need, fail } = h;
  switch (head) {
    case 'categories':
      need(me, 'accountant');
      return sub ? categoryEdit(ctx, Number(sub)) : categories(ctx);
    case 'money-accounts':
      need(me, 'accountant');
      return moneyAccounts(ctx, sub ? Number(sub) : null);
    case 'expenses':
      need(me, 'accountant');
      if (sub === 'import') return importRecords(ctx);
      if (sub === 'payees') return payees(ctx);
      return records(ctx, sub && /^\d+$/.test(sub) ? Number(sub) : null);
    case 'receipts':
      need(me, 'accountant');
      return receipts(ctx, sub);
    case 'cost-summary':
      need(me, 'accountant');
      return costSummary(ctx);
    case 'salaries':
      need(me, 'manager', 'accountant');
      return salaries(ctx);
    default:
      return fail(404, 'Not found');
  }
}

async function categories({ request, env, me, h }) {
  const db = env.DB;
  if (request.method === 'GET') {
    const { results } = await db.prepare('SELECT id, name, stock, active FROM categories ORDER BY name COLLATE NOCASE').all();
    return h.json({ categories: results });
  }
  if (request.method === 'POST') {
    const name = h.str((await h.body(request)).name, 60);
    if (!name) h.fail(400, 'Enter a name for the new category.');
    const found = await db.prepare('SELECT id, name, stock, active FROM categories WHERE name = ?').bind(name).first();
    if (found) {
      if (!found.active) await db.prepare('UPDATE categories SET active = 1 WHERE id = ?').bind(found.id).run();
      return h.json({ category: { ...found, active: 1 } });
    }
    const r = await db.prepare('INSERT INTO categories (name, created_at) VALUES (?, ?)').bind(name, h.nowIso()).run();
    await h.audit(db, me, 'category.create', name);
    return h.json({ category: { id: r.meta.last_row_id, name, stock: 0, active: 1 } });
  }
  return h.fail(405, 'Not allowed.');
}

async function categoryEdit({ request, env, me, h }, id) {
  const b = await h.body(request);
  const sets = [], vals = [];
  if (b.name != null) { if (!h.str(b.name, 60)) h.fail(400, 'Enter a name.'); sets.push('name = ?'); vals.push(h.str(b.name, 60)); }
  if (b.active != null) { sets.push('active = ?'); vals.push(b.active ? 1 : 0); }
  if (b.stock != null) { sets.push('stock = ?'); vals.push(b.stock ? 1 : 0); }
  if (sets.length) await env.DB.prepare(`UPDATE categories SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
  await h.audit(env.DB, me, 'category.update', { id, ...b });
  return h.json({ ok: true });
}

async function moneyAccounts({ request, env, me, h }, id) {
  const db = env.DB;
  if (request.method === 'GET') {
    const { results } = await db.prepare('SELECT * FROM money_accounts ORDER BY active DESC, type, name COLLATE NOCASE').all();
    return h.json({ accounts: results });
  }
  const b = await h.body(request);
  const type = ACCOUNT_TYPES.includes(b.type) ? b.type : null;
  if (request.method === 'POST' && !id) {
    const name = h.str(b.name, 60);
    if (!name) h.fail(400, 'Enter a name, e.g. “Loan from Yaman” or “Ziraat - Mustafa”.');
    if (!type) h.fail(400, 'Choose the kind of account.');
    const found = await db.prepare('SELECT * FROM money_accounts WHERE name = ?').bind(name).first();
    if (found) {
      if (!found.active) await db.prepare('UPDATE money_accounts SET active = 1 WHERE id = ?').bind(found.id).run();
      return h.json({ account: { ...found, active: 1 } });
    }
    const r = await db.prepare('INSERT INTO money_accounts (name, type, created_at) VALUES (?, ?, ?)').bind(name, type, h.nowIso()).run();
    await h.audit(db, me, 'account.money.create', { name, type });
    return h.json({ account: { id: r.meta.last_row_id, name, type, active: 1 } });
  }
  if (request.method === 'PATCH' && id) {
    if (!h.isOwner(me)) h.fail(403, 'Only the owner can change an account.');
    const sets = [], vals = [];
    if (b.name != null) { if (!h.str(b.name, 60)) h.fail(400, 'Enter a name.'); sets.push('name = ?'); vals.push(h.str(b.name, 60)); }
    if (type) { sets.push('type = ?'); vals.push(type); }
    if (b.active != null) { sets.push('active = ?'); vals.push(b.active ? 1 : 0); }
    if (sets.length) await db.prepare(`UPDATE money_accounts SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
    await h.audit(db, me, 'account.money.update', { id, ...b });
    return h.json({ ok: true });
  }
  return h.fail(405, 'Not allowed.');
}

/** Checks and cleans one record from the form or an import. */
async function clean(db, b, h, { partial = false, current = null } = {}) {
  const out = {};
  const amount = h.money(b.amount);
  if (!partial || 'amount' in b) {
    if (!Number.isFinite(amount) || amount <= 0) h.fail(400, 'Enter the amount (more than 0 TL).');
    if (amount > 50000000) h.fail(400, 'That amount looks too large.');
    out.amount = amount;
  }
  if (!partial || 'name' in b) {
    out.name = h.str(b.name, 160);
    if (!out.name) h.fail(400, 'Write what the payment is for (e.g. “Milk”, “October rent”).');
  }
  if (!partial || 'category_id' in b) {
    const cat = await db.prepare('SELECT id, active FROM categories WHERE id = ?').bind(Number(b.category_id)).first();
    if (!cat) h.fail(400, 'Choose a category.');
    out.category_id = cat.id;
  }
  if (!partial || 'status' in b) {
    out.status = STATUSES.includes(b.status) ? b.status : 'paid';
  }
  const status = out.status ?? b.status ?? current?.status;
  if (!partial || 'date' in b) {
    if (b.date && !h.isDate(b.date)) h.fail(400, 'The expense date is not valid.');
    out.date = b.date || '';
  }
  if (!partial || 'kind' in b) out.kind = KINDS.includes(b.kind) ? b.kind : 'regular';
  if (!partial || 'fees' in b) { const f = h.money(b.fees || 0); out.fees = Number.isFinite(f) && f > 0 ? f : 0; }
  for (const [k, n] of [['payee', 120], ['payee_type', 40], ['employee', 80], ['paid_by', 60], ['reason', 1000]]) if (!partial || k in b) out[k] = h.str(b[k], n) || null;
  if (!partial || 'employee_user_id' in b) out.employee_user_id = Number(b.employee_user_id) || null;
  if (!partial || 'receipt' in b) out.receipt = b.receipt && /^r_[a-f0-9]{32}$/.test(b.receipt) ? b.receipt : null;
  if (!partial || 'status' in b || 'account_id' in b || 'paid_date' in b || 'due_date' in b) {
    if (status === 'paid') {
      const acc = b.account_id ? await db.prepare('SELECT id FROM money_accounts WHERE id = ?').bind(Number(b.account_id)).first() : null;
      if (b.account_id && !acc) h.fail(400, 'Choose where it was paid from.');
      out.account_id = acc ? acc.id : null;
      if (b.paid_date && !h.isDate(b.paid_date)) h.fail(400, 'The payment date is not valid.');
      out.paid_date = b.paid_date || current?.paid_date || out.date || b.date || current?.date || null;
      // a planned bill keeps its due date once paid, so it stays in that month's list
      out.due_date = h.isDate(b.due_date) ? b.due_date : current?.due_date ?? null;
    } else if (status === 'scheduled') {
      if (!h.isDate(b.due_date)) h.fail(400, 'Choose the date it will be paid.');
      out.due_date = b.due_date; out.account_id = null; out.paid_date = null;
    } else {
      out.due_date = null; out.account_id = null; out.paid_date = null;
    }
  }
  if (!partial || 'loan_account_id' in b || 'kind' in b) {
    const kind = out.kind ?? b.kind ?? current?.kind;
    if (kind === 'loan_repayment') {
      const la = await db.prepare("SELECT id FROM money_accounts WHERE id = ? AND type IN ('person_loan','bank_loan')").bind(Number(b.loan_account_id)).first();
      if (!la) h.fail(400, 'Choose which loan is being paid back.');
      out.loan_account_id = la.id;
    } else out.loan_account_id = null;
  }
  return out;
}

async function records({ request, env, me, h }, id) {
  const db = env.DB;
  if (request.method === 'GET') {
    // all records (a café has a few thousand a year at most); the page filters them
    const { results } = await db.prepare(`${SELECT} WHERE e.deleted = 0 ORDER BY COALESCE(NULLIF(e.date, ''), e.due_date, '9999') DESC, e.id DESC`).all();
    return h.json({ records: results, today: h.localParts().date });
  }
  if (request.method === 'POST' && !id) {
    const r = await clean(db, await h.body(request), h);
    const now = h.nowIso();
    if (!r.date) r.date = h.localParts().date;
    if (r.status === 'paid' && !r.paid_date) r.paid_date = r.date;
    const cols = Object.keys(r);
    const ins = await db.prepare(`INSERT INTO expenses (${cols.join(', ')}, created_at, user_id) VALUES (${cols.map(() => '?').join(', ')}, ?, ?)`)
      .bind(...cols.map((c) => r[c]), now, me.id).run();
    await h.audit(db, me, 'expense.create', { id: ins.meta.last_row_id, amount: r.amount, status: r.status });
    return h.json({ record: await db.prepare(`${SELECT} WHERE e.id = ?`).bind(ins.meta.last_row_id).first() });
  }
  const row = id ? await db.prepare('SELECT * FROM expenses WHERE id = ? AND deleted = 0').bind(id).first() : null;
  if (id && !row) h.fail(404, 'That record does not exist.');
  if (row && !h.isOwner(me) && row.user_id !== me.id) h.fail(403, 'Only the owner can change records entered by someone else.');
  if (request.method === 'PATCH' && row) {
    const b = await h.body(request);
    // marking as paid / changing the status needs the full payment details
    if ('status' in b && b.status === 'paid' && !b.paid_date) b.paid_date = h.localParts().date;
    const r = await clean(db, b, h, { partial: true, current: row });
    const cols = Object.keys(r);
    if (cols.length) {
      await db.prepare(`UPDATE expenses SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).bind(...cols.map((c) => r[c]), h.nowIso(), id).run();
    }
    await h.audit(db, me, b.status === 'paid' && row.status !== 'paid' ? 'expense.paid' : 'expense.update', { id, changed: cols });
    return h.json({ record: await db.prepare(`${SELECT} WHERE e.id = ?`).bind(id).first() });
  }
  if (request.method === 'DELETE' && row) {
    await db.prepare('UPDATE expenses SET deleted = 1, updated_at = ? WHERE id = ?').bind(h.nowIso(), id).run();
    await h.audit(db, me, 'expense.delete', { id, name: row.name, amount: row.amount, date: row.date });
    return h.json({ ok: true });
  }
  return h.fail(405, 'Not allowed.');
}

/** Names used before, for the "paid to" and "paid by" suggestions. */
async function payees({ env, h }) {
  const db = env.DB;
  const [p, e, by] = await Promise.all([
    db.prepare("SELECT payee AS name, MAX(payee_type) AS type, COUNT(*) AS n FROM expenses WHERE deleted = 0 AND payee IS NOT NULL AND payee <> '' GROUP BY payee COLLATE NOCASE ORDER BY n DESC").all(),
    db.prepare("SELECT employee AS name, COUNT(*) AS n FROM expenses WHERE deleted = 0 AND employee IS NOT NULL AND employee <> '' GROUP BY employee COLLATE NOCASE ORDER BY n DESC").all(),
    db.prepare("SELECT paid_by AS name, COUNT(*) AS n FROM expenses WHERE deleted = 0 AND paid_by IS NOT NULL AND paid_by <> '' GROUP BY paid_by COLLATE NOCASE ORDER BY n DESC").all(),
  ]);
  return h.json({ payees: p.results, employees: e.results, paidBy: by.results });
}

/** Bulk import (e.g. the Notion export). Rows already imported (same import_ref) are skipped. */
async function importRecords({ request, env, me, h }) {
  const db = env.DB;
  const b = await h.body(request);
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (!rows.length) h.fail(400, 'Nothing to import.');
  if (rows.length > 3000) h.fail(400, 'Too many rows at once (limit 3,000).');
  const cats = new Map((await db.prepare('SELECT id, name FROM categories').all()).results.map((c) => [c.name.toLowerCase(), c.id]));
  const accs = new Map((await db.prepare('SELECT id, name FROM money_accounts').all()).results.map((a) => [a.name.toLowerCase(), a.id]));
  const refs = new Set((await db.prepare('SELECT import_ref FROM expenses WHERE import_ref IS NOT NULL').all()).results.map((r) => r.import_ref));
  const now = h.nowIso();
  let added = 0, skipped = 0;
  const stmts = [];
  for (const raw of rows) {
    const ref = h.str(raw.import_ref, 300);
    if (ref && refs.has(ref)) { skipped++; continue; }
    const catName = h.str(raw.category, 60) || 'Other';
    if (!cats.has(catName.toLowerCase())) {
      const r = await db.prepare('INSERT INTO categories (name, stock, created_at) VALUES (?, ?, ?)').bind(catName, raw.stock ? 1 : 0, now).run();
      cats.set(catName.toLowerCase(), r.meta.last_row_id);
    }
    let accountId = null;
    if (raw.account) {
      const k = h.str(raw.account, 60).toLowerCase();
      if (!accs.has(k)) {
        const r = await db.prepare('INSERT INTO money_accounts (name, type, created_at) VALUES (?, ?, ?)').bind(h.str(raw.account, 60), ACCOUNT_TYPES.includes(raw.account_type) ? raw.account_type : 'bank', now).run();
        accs.set(k, r.meta.last_row_id);
      }
      accountId = accs.get(k);
    }
    const rec = await clean(db, { ...raw, category_id: cats.get(catName.toLowerCase()), account_id: accountId }, h);
    if (rec.status === 'paid' && !rec.paid_date) rec.paid_date = rec.date || null;
    rec.import_ref = ref || null;
    const cols = Object.keys(rec);
    stmts.push(db.prepare(`INSERT INTO expenses (${cols.join(', ')}, created_at, user_id) VALUES (${cols.map(() => '?').join(', ')}, ?, ?)`)
      .bind(...cols.map((c) => rec[c]), now, me.id));
    if (ref) refs.add(ref);
    added++;
  }
  for (let i = 0; i < stmts.length; i += 80) await db.batch(stmts.slice(i, i + 80));
  await h.audit(db, me, 'expense.import', { added, skipped, source: h.str(b.source, 120) });
  return h.json({ added, skipped });
}

async function receipts({ request, env, me, h }, key) {
  if (!env.DATA) h.fail(503, 'Photo storage is not configured.');
  if (request.method === 'POST' && !key) {
    const type = request.headers.get('content-type') || '';
    if (!/^image\/(jpeg|png|webp)$/.test(type)) h.fail(400, 'The receipt must be a photo (JPEG, PNG or WebP).');
    const buf = await request.arrayBuffer();
    if (!buf.byteLength) h.fail(400, 'The photo is empty.');
    if (buf.byteLength > MAX_RECEIPT_BYTES) h.fail(413, 'The photo is too large (limit 4 MB).');
    const id = 'r_' + h.newToken().slice(0, 32);
    await env.DATA.put('receipt:' + id, buf, { metadata: { type, by: me.id, at: h.nowIso() } });
    return h.json({ receipt: id });
  }
  if (request.method === 'GET' && key && /^r_[a-f0-9]{32}$/.test(key)) {
    const { value, metadata } = await env.DATA.getWithMetadata('receipt:' + key, { type: 'arrayBuffer' });
    if (!value) h.fail(404, 'The photo was not found.');
    return new Response(value, { headers: { 'content-type': metadata?.type || 'image/jpeg', 'cache-control': 'private, max-age=86400' } });
  }
  return h.fail(405, 'Not allowed.');
}

/** Costs per day and category for the net-profit report (loan repayments are not costs). */
async function costSummary({ env, h }) {
  const { results } = await env.DB.prepare(`SELECT e.date, c.name AS category, c.stock, SUM(e.amount + e.fees) AS amount, COUNT(*) AS n,
    SUM(CASE WHEN e.status = 'paid' THEN 0 ELSE e.amount + e.fees END) AS open
    FROM expenses e JOIN categories c ON c.id = e.category_id
    WHERE e.deleted = 0 AND e.date <> '' AND e.kind <> 'loan_repayment' GROUP BY e.date, c.id`).all();
  return h.json({ expenses: results });
}

/** Hours worked and salary payments for one month. */
async function salaries({ request, env, h }) {
  const db = env.DB;
  const month = new URL(request.url).searchParams.get('month');
  if (!h.isMonth(month)) h.fail(400, 'Choose a month.');
  const first = month + '-01';
  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  // a clock-in belongs to the month of its local (Türkiye) date
  const fromIso = h.localToIso(first, '00:00'), toIso = h.localToIso(next, '00:00');
  const [people, rec, sh, pay] = await Promise.all([
    db.prepare('SELECT id, name, username, roles, active, rate, pay_type, monthly_salary FROM users').all(),
    db.prepare('SELECT user_id, in_at, out_at, edited_by FROM attendance WHERE in_at >= ? AND in_at < ?').bind(fromIso, toIso).all(),
    db.prepare('SELECT user_id, date, start, end FROM shifts WHERE date >= ? AND date < ?').bind(first, next).all(),
    db.prepare(`${SELECT} WHERE e.deleted = 0 AND ((e.date >= ? AND e.date < ?) OR (e.paid_date >= ? AND e.paid_date < ?))
      AND (e.kind = 'advance' OR e.employee_user_id IS NOT NULL OR (e.employee IS NOT NULL AND e.employee <> '') OR c.name LIKE 'Salar%')`).bind(first, next, first, next).all(),
  ]);
  return h.json({ month, people: people.results.map((p) => ({ ...p, roles: (p.roles || '').split(',') })), attendance: rec.results, shifts: sh.results, payments: pay.results });
}

export const ACCOUNTING_ROUTES = ['categories', 'money-accounts', 'expenses', 'receipts', 'cost-summary', 'salaries'];
