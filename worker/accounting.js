import { ADMIN_EMAIL, appUrl, notify, sendMany } from './email.js';
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

export const BARISTA_COST_LIMIT = 400; // TL, per purchase

export const ACCOUNTING_SCHEMA = [
  // Day-to-day costs a barista paid (e.g. milk from the shop): waiting for an accountant or owner to approve.
  `CREATE TABLE IF NOT EXISTS cost_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, date TEXT NOT NULL,
    name TEXT NOT NULL, amount REAL NOT NULL, category_id INTEGER, receipt TEXT, note TEXT, status TEXT NOT NULL DEFAULT 'pending',
    decided_by INTEGER, decided_at TEXT, reason TEXT, expense_id INTEGER, created_at TEXT NOT NULL)`,
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
      if (sub === 'extract') return extract(ctx);
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
    case 'documents':
      need(me, 'accountant');
      return documents(ctx, sub || null);
    case 'cost-requests':
      return costRequests(ctx, sub);
    case 'finance-advice':
      need(me, 'accountant');
      return financeAdvice(ctx);
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
async function salaries({ request, env, me, h }) {
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
  // a manager sees hours only: no pay, no payments
  const fin = h.has(me, 'accountant');
  const list = people.results.map((p) => ({ ...p, roles: (p.roles || '').split(','), ...(fin ? {} : { rate: null, monthly_salary: null }) }));
  return h.json({ month, finance: fin, people: list, attendance: rec.results, shifts: sh.results, payments: fin ? pay.results : [] });
}

export const ACCOUNTING_ROUTES = ['cost-requests', 'categories', 'money-accounts', 'expenses', 'receipts', 'cost-summary', 'salaries', 'documents', 'finance-advice'];

// ---------- expenses from free text (PDF, TXT, Word), read by AI ----------
async function extract({ request, env, me, h }) {
  const b = await h.body(request);
  const text = String(b.text || '').slice(0, 24000);
  if (!text.trim()) h.fail(400, 'The file has no text.');
  if (!env.AI) h.fail(501, 'No AI is connected, so free text cannot be read.');
  const cats = (await env.DB.prepare('SELECT name FROM categories WHERE active = 1').all()).results.map((c) => c.name);
  const prompt = `Extract every expense / payment from this document of a café in Istanbul (amounts in Turkish lira).
For each one give: name (what it was for, short), date (YYYY-MM-DD, or "" if not shown; dates like 03/04/2026 are day/month/year),
amount (number, no currency), category (one of: ${cats.join(', ')}; or "" if unsure), payee (shop, company or person paid, or ""),
status ("paid", or "unpaid" if the document says it is not paid yet).
Skip totals, subtotals, VAT summary lines and anything that is not a single expense. Do not invent anything.
Answer with JSON: {"records": [...]}

Document:
${text}`;
  let out = null;
  try {
    const res = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_schema', json_schema: { type: 'object', required: ['records'], properties: { records: { type: 'array', items: { type: 'object', required: ['name', 'date', 'amount', 'category', 'payee', 'status'], properties: { name: { type: 'string' }, date: { type: 'string' }, amount: { type: 'number' }, category: { type: 'string' }, payee: { type: 'string' }, status: { type: 'string' } } } } } } },
      max_tokens: 4000, temperature: 0,
    });
    out = res?.response;
    if (typeof out === 'string') { try { out = JSON.parse(out); } catch { out = null; } }
  } catch (e) { console.error('extract', e); h.fail(503, 'The AI could not read the file right now. Try again, or use an Excel/CSV file.'); }
  if (!out || !Array.isArray(out.records)) h.fail(502, 'The AI answer could not be read. Try again.');
  const records = out.records.map((r) => ({
    name: h.str(r.name, 160) || 'Expense', amount: Math.abs(Number(r.amount) || 0), date: h.isDate(r.date) ? r.date : '',
    category: cats.includes(r.category) ? r.category : '', payee: h.str(r.payee, 120), status: r.status === 'unpaid' ? 'unpaid' : 'paid',
  })).filter((r) => r.amount > 0);
  await h.audit(env.DB, me, 'expense.extract', { records: records.length });
  return h.json({ records });
}

// ---------- uploaded expense files (kept for the records) ----------
const MAX_DOC_BYTES = 15 * 1024 * 1024;
async function documents({ request, env, me, h }, id) {
  if (!env.DATA) h.fail(503, 'File storage is not configured.');
  if (request.method === 'GET' && !id) {
    const list = await env.DATA.list({ prefix: 'doc:' });
    return h.json({ documents: list.keys.map((k) => ({ id: k.name.slice(4), ...(k.metadata || {}) })).sort((a, b) => (a.at < b.at ? 1 : -1)) });
  }
  if (request.method === 'POST' && !id) {
    const name = decodeURIComponent(request.headers.get('x-filename') || 'file').slice(0, 160);
    const type = (request.headers.get('content-type') || 'application/octet-stream').slice(0, 120);
    const buf = await request.arrayBuffer();
    if (!buf.byteLength) h.fail(400, 'The file is empty.');
    if (buf.byteLength > MAX_DOC_BYTES) h.fail(413, 'The file is too large (limit 15 MB).');
    const docId = 'd_' + h.newToken().slice(0, 24);
    const meta = { name, type, size: buf.byteLength, by: me.name, at: h.nowIso(), records: 0 };
    await env.DATA.put('doc:' + docId, buf, { metadata: meta });
    await h.audit(env.DB, me, 'document.upload', { name, size: buf.byteLength });
    return h.json({ document: { id: docId, ...meta } });
  }
  if (id && !/^d_[a-f0-9]{24}$/.test(id)) h.fail(404, 'Not found');
  if (request.method === 'GET') {
    const { value, metadata } = await env.DATA.getWithMetadata('doc:' + id, { type: 'arrayBuffer' });
    if (!value) h.fail(404, 'The file was not found.');
    return new Response(value, { headers: { 'content-type': metadata?.type || 'application/octet-stream',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(metadata?.name || 'file')}`, 'cache-control': 'private, max-age=3600' } });
  }
  if (request.method === 'PATCH') {
    // remember how many records were imported from the file
    const b = await h.body(request);
    const { value, metadata } = await env.DATA.getWithMetadata('doc:' + id, { type: 'arrayBuffer' });
    if (!value) h.fail(404, 'The file was not found.');
    await env.DATA.put('doc:' + id, value, { metadata: { ...metadata, records: Number(b.records) || 0 } });
    return h.json({ ok: true });
  }
  if (request.method === 'DELETE') {
    if (!h.isOwner(me)) h.fail(403, 'Only the owner can delete a stored file.');
    await env.DATA.delete('doc:' + id);
    await h.audit(env.DB, me, 'document.delete', { id });
    return h.json({ ok: true });
  }
  return h.fail(405, 'Not allowed.');
}

// ---------- 5 recommendations for a month, written by AI from the month's figures ----------
async function financeAdvice({ request, env, me, h }) {
  const db = env.DB;
  const b = await h.body(request);
  if (!h.isMonth(b.month) || !b.summary) h.fail(400, 'Missing month or figures.');
  const lang = b.lang === 'ar' ? 'ar' : 'en';
  const key = `advice:${b.month}:${lang}`;
  const sig = JSON.stringify(b.summary).length + ':' + JSON.stringify(b.summary).slice(0, 2000).split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const cached = await h.getSetting(db, key);
  if (cached && cached.sig === sig && !b.refresh) return h.json(cached);
  const prompt = `You advise the owner of Mariam Coffee, a small café in Istanbul (amounts in Turkish lira, TL).
Here are the café's figures for ${b.month} (JSON):
${JSON.stringify(b.summary).slice(0, 6000)}
Write exactly 5 short, concrete recommendations to reduce costs, pay bills on time or improve profit, based only on these figures.
Each one sentence or two, plain words, mention the category or bill and the amount when useful. Do not invent figures.
${lang === 'ar' ? 'Write them in Arabic.' : 'Write them in English.'} Answer with JSON: {"recommendations": ["...", "...", "...", "...", "..."]}`;
  let recs = null;
  try {
    if (env.AI) {
      const res = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_schema', json_schema: { type: 'object', required: ['recommendations'], properties: { recommendations: { type: 'array', items: { type: 'string' } } } } },
        max_tokens: 1200, temperature: 0.3,
      });
      let out = res?.response;
      if (typeof out === 'string') { try { out = JSON.parse(out); } catch { out = null; } }
      recs = Array.isArray(out?.recommendations) ? out.recommendations.map(String).filter(Boolean).slice(0, 5) : null;
    }
  } catch (e) { console.error('advice', e); }
  if (!recs || !recs.length) h.fail(503, 'The AI could not write recommendations right now. The key figures above are still correct.');
  const result = { month: b.month, recommendations: recs, sig, at: h.nowIso(), by: 'Cloudflare AI' };
  await h.setSetting(db, key, result);
  await h.audit(db, me, 'finance.advice', { month: b.month });
  return h.json(result);
}

// ---------- day-to-day costs from baristas (up to BARISTA_COST_LIMIT per purchase, approved by accounting) ----------
const isApprover = (h, me) => h.isOwner(me) || String(me.roles || '').split(',').includes('accountant');
const REQ_SELECT = `SELECT q.*, u.name AS user_name, c.name AS category, d.name AS decided_name FROM cost_requests q
  JOIN users u ON u.id = q.user_id LEFT JOIN categories c ON c.id = q.category_id LEFT JOIN users d ON d.id = q.decided_by`;

async function costRequests({ request, env, me, h }, sub) {
  const db = env.DB;
  const m = request.method;
  const approver = isApprover(h, me);
  const roles = String(me.roles || '').split(',');

  // a barista's receipt photo
  if (sub === 'receipt' && m === 'POST') {
    const type = request.headers.get('content-type') || '';
    if (!/^image\/(jpeg|png|webp)$/.test(type)) h.fail(400, 'The receipt must be a photo (JPEG, PNG or WebP).');
    const buf = await request.arrayBuffer();
    if (!buf.byteLength) h.fail(400, 'The photo is empty.');
    if (buf.byteLength > MAX_RECEIPT_BYTES) h.fail(413, 'The photo is too large (limit 4 MB).');
    const id = 'r_' + h.newToken().slice(0, 32);
    await env.DATA.put('receipt:' + id, buf, { metadata: { type, by: me.id, at: h.nowIso() } });
    return h.json({ receipt: id });
  }

  if (m === 'GET' && !sub) {
    const cats = (await db.prepare('SELECT id, name FROM categories WHERE active = 1 ORDER BY name').all()).results;
    const mine = (await db.prepare(`${REQ_SELECT} WHERE q.user_id = ? ORDER BY q.id DESC LIMIT 30`).bind(me.id).all()).results;
    const all = approver ? (await db.prepare(`${REQ_SELECT} WHERE q.status = 'pending' OR q.id IN (SELECT id FROM cost_requests WHERE status <> 'pending' ORDER BY id DESC LIMIT 40) ORDER BY q.id DESC`).all()).results : null;
    return h.json({ limit: BARISTA_COST_LIMIT, categories: cats, mine, all, today: h.localParts().date });
  }

  if (m === 'POST' && !sub) {
    if (!roles.includes('barista') && !approver) h.fail(403, 'Only baristas send day-to-day costs.');
    const b = await h.body(request);
    const name = h.str(b.name, 120);
    if (!name) h.fail(400, 'Write what you bought (e.g. “Milk, 6 litres”).');
    const amount = h.money(b.amount);
    if (!Number.isFinite(amount) || amount <= 0) h.fail(400, 'Enter the amount (more than 0 TL).');
    if (amount > BARISTA_COST_LIMIT) h.fail(400, `The most you can add is ${BARISTA_COST_LIMIT} TL per purchase. For more, ask the accountant.`);
    const today = h.localParts().date;
    const date = h.isDate(b.date) ? b.date : today;
    if (date > today) h.fail(400, 'The date cannot be in the future.');
    const cat = b.category_id ? await db.prepare('SELECT id, name FROM categories WHERE id = ? AND active = 1').bind(Number(b.category_id)).first() : null;
    const receipt = b.receipt && /^r_[a-f0-9]{32}$/.test(b.receipt) ? b.receipt : null;
    const note = h.str(b.note, 500) || null;
    const ins = await db.prepare('INSERT INTO cost_requests (user_id, date, name, amount, category_id, receipt, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(me.id, date, name, amount, cat ? cat.id : null, receipt, note, h.nowIso()).run();
    const id = ins.meta.last_row_id;
    await h.audit(db, me, 'costreq.create', { id, amount, name });
    const mail = await tellAccounting(env, h, request, me, { id, date, name, amount, category: cat?.name, note, receipt });
    return h.json({ request: await db.prepare(`${REQ_SELECT} WHERE q.id = ?`).bind(id).first(), mail });
  }

  const id = /^\d+$/.test(sub || '') ? Number(sub) : null;
  const row = id ? await db.prepare('SELECT * FROM cost_requests WHERE id = ?').bind(id).first() : null;
  if (!row) h.fail(404, 'That request does not exist.');

  if (m === 'DELETE') {
    if (row.user_id !== me.id) h.fail(403, 'You can only cancel your own requests.');
    if (row.status !== 'pending') h.fail(400, 'It has already been answered.');
    await db.prepare("UPDATE cost_requests SET status = 'cancelled', decided_at = ? WHERE id = ?").bind(h.nowIso(), id).run();
    await h.audit(db, me, 'costreq.cancel', { id });
    return h.json({ ok: true });
  }

  if (m === 'PATCH') {
    if (!approver) h.fail(403, 'Only the accountant or the owner can approve.');
    if (row.status !== 'pending') h.fail(400, 'It has already been answered.');
    const b = await h.body(request);
    const now = h.nowIso();
    if (b.action === 'reject') {
      const reason = h.str(b.reason, 300) || null;
      await db.prepare("UPDATE cost_requests SET status = 'rejected', decided_by = ?, decided_at = ?, reason = ? WHERE id = ?").bind(me.id, now, reason, id).run();
      await h.audit(db, me, 'costreq.reject', { id, reason });
      await tellBarista(env, h, request, row, `Your cost “${row.name}” (${row.amount} TL) was not approved.${reason ? ' Reason: ' + reason : ''}`);
      return h.json({ ok: true });
    }
    if (b.action !== 'approve') h.fail(400, 'Choose approve or reject.');
    const cat = await db.prepare('SELECT id FROM categories WHERE id = ?').bind(Number(b.category_id || row.category_id)).first();
    if (!cat) h.fail(400, 'Choose a category before approving.');
    const acc = await db.prepare('SELECT id FROM money_accounts WHERE id = ?').bind(Number(b.account_id)).first();
    if (!acc) h.fail(400, 'Choose where the money came from (e.g. Cash).');
    const who = await db.prepare('SELECT name FROM users WHERE id = ?').bind(row.user_id).first();
    const ins = await db.prepare(`INSERT INTO expenses (name, category_id, amount, date, status, paid_date, account_id, paid_by, reason, receipt, kind, created_at, user_id)
      VALUES (?, ?, ?, ?, 'paid', ?, ?, ?, ?, ?, 'regular', ?, ?)`)
      .bind(row.name, cat.id, row.amount, row.date, row.date, acc.id, who?.name || null, row.note ? `${row.note} (day-to-day cost from ${who?.name || 'barista'})` : `Day-to-day cost from ${who?.name || 'barista'}`, row.receipt, now, me.id).run();
    await db.prepare("UPDATE cost_requests SET status = 'approved', decided_by = ?, decided_at = ?, expense_id = ?, category_id = ? WHERE id = ?")
      .bind(me.id, now, ins.meta.last_row_id, cat.id, id).run();
    await h.audit(db, me, 'costreq.approve', { id, expense: ins.meta.last_row_id, amount: row.amount });
    await tellBarista(env, h, request, row, `Your cost “${row.name}” (${row.amount} TL) was approved.`);
    return h.json({ ok: true, expense_id: ins.meta.last_row_id });
  }
  return h.fail(405, 'Not allowed.');
}

async function tellAccounting(env, h, request, me, r) {
  const { results } = await env.DB.prepare("SELECT email FROM users WHERE active = 1 AND email IS NOT NULL AND email <> '' AND ((',' || roles || ',') LIKE '%,owner,%' OR (',' || roles || ',') LIKE '%,accountant,%')").all();
  const to = [...new Set([...results.map((x) => x.email.toLowerCase()), ADMIN_EMAIL])];
  const site = appUrl(new URL(request.url).origin) + '/staff';
  const text = `${me.name} added a day-to-day cost and it is waiting for approval:\n\n${r.name}\nAmount: ${r.amount} TL\nDate: ${r.date}${r.category ? '\nCategory: ' + r.category : ''}${r.note ? '\nNote: ' + r.note : ''}\nReceipt photo: ${r.receipt ? 'yes' : 'no'}\n\nApprove or reject it in Accounting → Barista costs:\n${site}`;
  return sendMany(env, h, to, `Mariam Coffee: ${me.name} asks to approve ${r.amount} TL`, text);
}

async function tellBarista(env, h, request, row, text) {
  const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(row.user_id).first();
  if (u?.email) await notify(env, h, new URL(request.url).origin, u, 'your day-to-day cost', text);
}
