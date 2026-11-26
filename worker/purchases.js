// Purchase requests: anyone asks to buy something → the owner approves (amount, how and when it is paid) →
// the requester is emailed to send the invoice → an accountant / manager checks the invoice → it becomes the expense
// record (paid or scheduled) and its goods go into the inventory.
// An invoice more than OVER_PCT above the approved amount goes back to the owner.
//
//   GET    /api/purchases                  lists, categories, accounts, stock items, this month's budgets
//   POST   /api/purchases                  new request (anyone)
//   POST   /api/purchases/photo            invoice photo (anyone signed in) -> { photo }
//   GET    /api/purchases/photo/r_…        the photo
//   GET    /api/purchases/tracker?month=   spend tracker (owner, accountant, manager)
//   GET    /api/purchases/:id              one request with its lines
//   POST   /api/purchases/:id/approve      { amount, account_id, pay_date, note }   (owner)
//   POST   /api/purchases/:id/reject       { reason }                               (owner)
//   POST   /api/purchases/:id/cancel       (the requester while not done, or the owner)
//   POST   /api/purchases/:id/invoice      { photos: [..], total, note }            (the requester, or a checker)
//   GET/PUT /api/purchase-budgets          { budgets: { category_id: monthly TL } } (PUT: owner)
// The invoice check itself is the normal invoice save (POST /api/invoices with purchase_id), see purchaseBeforeSave/AfterSave.

import { ADMIN_EMAIL, SITE, appUrl, notify, sendMany } from './email.js';

export const PURCHASE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS purchase_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, supplier TEXT, category_id INTEGER,
    amount REAL NOT NULL, needed_by TEXT, pay_account_id INTEGER, pay_date TEXT, pay_note TEXT, note TEXT, status TEXT NOT NULL,
    user_id INTEGER NOT NULL, created_at TEXT NOT NULL, decided_by INTEGER, decided_at TEXT, decision_note TEXT, approved_amount REAL,
    photos TEXT, invoice_note TEXT, invoice_total REAL, submitted_at TEXT, expense_id INTEGER, invoice_id INTEGER, done_at TEXT,
    checked_by INTEGER, reminded_at TEXT, history TEXT)`,
  `CREATE INDEX IF NOT EXISTS purchase_requests_status ON purchase_requests(status)`,
  `CREATE TABLE IF NOT EXISTS purchase_request_lines (id INTEGER PRIMARY KEY AUTOINCREMENT, request_id INTEGER NOT NULL, inv_item INTEGER,
    item TEXT NOT NULL, qty REAL, unit TEXT, price REAL)`,
  `CREATE INDEX IF NOT EXISTS purchase_request_lines_r ON purchase_request_lines(request_id)`,
];
export const PURCHASE_ROUTES = ['purchases', 'purchase-budgets'];
export const OVER_PCT = 10; // an invoice up to 10 % above the approved amount is accepted (with a note)
const REMIND_DAYS = 3; // approved but no invoice: remind the requester every 3 days
const OPEN = ['approved', 'invoice_submitted', 'reapproval'];
const MAX_PHOTO = 4 * 1024 * 1024;

const rolesOf = (u) => String(u?.roles || '').split(',');
const isViewer = (h, me) => h.isOwner(me) || rolesOf(me).some((r) => r === 'accountant' || r === 'manager');
const isChecker = isViewer; // accountant, manager or owner check the invoice
const round2 = (n) => Math.round(n * 100) / 100;
const tl = (n) => `${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} TL`;

const SELECT = `SELECT p.*, u.name AS user_name, c.name AS category, a.name AS pay_account, d.name AS decided_name, k.name AS checked_name,
  e.status AS expense_status, e.paid_date AS expense_paid_date, e.due_date AS expense_due_date, e.amount AS expense_amount, ea.name AS expense_account
  FROM purchase_requests p JOIN users u ON u.id = p.user_id LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN money_accounts a ON a.id = p.pay_account_id
  LEFT JOIN users d ON d.id = p.decided_by LEFT JOIN users k ON k.id = p.checked_by LEFT JOIN expenses e ON e.id = p.expense_id
  LEFT JOIN money_accounts ea ON ea.id = e.account_id`;
const out = (r) => r && { ...r, photos: r.photos ? JSON.parse(r.photos) : [], history: r.history ? JSON.parse(r.history) : [] };
const withHistory = (row, me, what, now) => JSON.stringify([...(row?.history ? JSON.parse(row.history) : []), { at: now, by: me?.name || 'system', what }].slice(-40));

async function ownerEmails(db) {
  const { results } = await db.prepare("SELECT email FROM users WHERE active = 1 AND email IS NOT NULL AND email <> '' AND (',' || roles || ',') LIKE '%,owner,%'").all();
  return [...new Set([...results.map((x) => x.email.toLowerCase()), ADMIN_EMAIL])];
}
async function checkerEmails(db) {
  const { results } = await db.prepare("SELECT email FROM users WHERE active = 1 AND email IS NOT NULL AND email <> '' AND ((',' || roles || ',') LIKE '%,accountant,%' OR (',' || roles || ',') LIKE '%,manager,%')").all();
  return [...new Set(results.map((x) => x.email.toLowerCase()))];
}
const link = (origin) => appUrl(origin) + '/staff';

/** Budget use per category for a month: spent (expense records) + committed (approved requests without an invoice yet). */
export async function budgetStatus(db, h, month) {
  const budgets = (await h.getSetting(db, 'purchaseBudgets')) || {};
  const cats = (await db.prepare('SELECT id, name FROM categories WHERE active = 1 ORDER BY name').all()).results;
  const spent = new Map((await db.prepare(`SELECT category_id AS id, SUM(amount + fees) AS n FROM expenses WHERE deleted = 0 AND kind <> 'loan_repayment' AND substr(date, 1, 7) = ? GROUP BY category_id`).bind(month).all()).results.map((r) => [r.id, r.n]));
  const committed = new Map((await db.prepare(`SELECT category_id AS id, SUM(coalesce(approved_amount, amount)) AS n FROM purchase_requests
    WHERE status IN ('approved', 'invoice_submitted', 'reapproval') AND substr(coalesce(pay_date, needed_by, decided_at), 1, 7) = ? GROUP BY category_id`).bind(month).all()).results.map((r) => [r.id, r.n]));
  return cats.map((c) => {
    const budget = Number(budgets[c.id]) || 0, s = round2(spent.get(c.id) || 0), k = round2(committed.get(c.id) || 0);
    return { id: c.id, name: c.name, budget, spent: s, committed: k, left: budget ? round2(budget - s - k) : null };
  });
}

async function stockList(db) {
  const r = await db.prepare('SELECT id, name, category, unit, qty, min_qty FROM inventory_items WHERE active = 1 ORDER BY category, sort, name').all().catch(() => ({ results: [] }));
  return r.results.map((x) => ({ id: x.id, name: x.name, category: x.category, unit: x.unit, low: x.min_qty != null && x.qty <= x.min_qty, need: x.min_qty != null ? Math.max(0, round2(x.min_qty - x.qty)) : null }));
}

export async function handlePurchases({ head, sub, request, env, me, h }) {
  const db = env.DB;
  const m = request.method;
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/management/, '').split('/').filter(Boolean); // api, head, id, action
  const viewer = isViewer(h, me), owner = h.isOwner(me);
  const today = h.localParts().date;

  if (head === 'purchase-budgets') {
    if (m === 'GET') { if (!viewer) h.fail(403, 'Not allowed.'); return h.json({ budgets: (await h.getSetting(db, 'purchaseBudgets')) || {} }); }
    if (m === 'PUT') {
      if (!owner) h.fail(403, 'Only the owner sets the budgets.');
      const b = await h.body(request);
      const budgets = {};
      for (const [k, v] of Object.entries(b.budgets || {})) { const n = Number(v); if (/^\d+$/.test(k) && n > 0) budgets[k] = round2(n); }
      await h.setSetting(db, 'purchaseBudgets', budgets);
      await h.audit(db, me, 'purchase.budgets', budgets);
      return h.json({ ok: true, budgets });
    }
    h.fail(405, 'Not allowed.');
  }

  // ---- invoice photos
  if (sub === 'photo') {
    if (m === 'POST') {
      const type = request.headers.get('content-type') || '';
      if (!/^image\/(jpeg|png|webp)$/.test(type)) h.fail(400, 'The invoice must be a photo (JPEG, PNG or WebP).');
      const buf = await request.arrayBuffer();
      if (!buf.byteLength) h.fail(400, 'The photo is empty.');
      if (buf.byteLength > MAX_PHOTO) h.fail(413, 'The photo is too large (limit 4 MB).');
      const id = 'r_' + h.newToken().slice(0, 32);
      await env.DATA.put('receipt:' + id, buf, { metadata: { type, by: me.id, at: h.nowIso() } });
      return h.json({ photo: id });
    }
    const key = parts[3];
    if (m === 'GET' && /^r_[a-f0-9]{32}$/.test(key || '')) {
      const { value, metadata } = await env.DATA.getWithMetadata('receipt:' + key, { type: 'arrayBuffer' });
      if (!value) h.fail(404, 'The photo was not found.');
      return new Response(value, { headers: { 'content-type': metadata?.type || 'image/jpeg', 'cache-control': 'private, max-age=86400' } });
    }
    h.fail(405, 'Not allowed.');
  }

  if (sub === 'tracker' && m === 'GET') {
    if (!viewer) h.fail(403, 'Not allowed.');
    return h.json(await tracker(db, h, /^\d{4}-\d\d$/.test(url.searchParams.get('month') || '') ? url.searchParams.get('month') : today.slice(0, 7)));
  }

  if (!sub) {
    if (m === 'GET') {
      const cats = (await db.prepare('SELECT id, name FROM categories WHERE active = 1 ORDER BY name').all()).results;
      const accounts = (await db.prepare('SELECT id, name, type FROM money_accounts WHERE active = 1 ORDER BY name').all()).results;
      const mine = (await db.prepare(`${SELECT} WHERE p.user_id = ? ORDER BY p.id DESC LIMIT 60`).bind(me.id).all()).results.map(out);
      const all = viewer ? (await db.prepare(`${SELECT} WHERE p.status IN ('pending', 'approved', 'invoice_submitted', 'reapproval') OR p.id IN (SELECT id FROM purchase_requests ORDER BY id DESC LIMIT 200) ORDER BY p.id DESC`).all()).results.map(out) : null;
      const ids = [...new Set([...mine, ...(all || [])].map((r) => r.id))];
      const lines = ids.length ? (await db.prepare(`SELECT * FROM purchase_request_lines WHERE request_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`).bind(...ids).all()).results : [];
      const addLines = (r) => ({ ...r, lines: lines.filter((l) => l.request_id === r.id) });
      return h.json({
        today, overPct: OVER_PCT, roles: { viewer, owner, checker: isChecker(h, me) }, categories: cats, accounts,
        stock: await stockList(db), budgets: await budgetStatus(db, h, today.slice(0, 7)),
        mine: mine.map(addLines), all: all ? all.map(addLines) : null,
      });
    }
    if (m === 'POST') {
      const b = await h.body(request);
      const title = h.str(b.title, 160);
      if (!title) h.fail(400, 'Write what you want to buy.');
      const lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, 60).map((l) => ({
        inv_item: Number(l.inv_item) > 0 ? Number(l.inv_item) : null, item: h.str(l.item, 120), qty: Number(l.qty) > 0 ? Number(l.qty) : null,
        unit: h.str(l.unit, 20) || null, price: Number(l.price) >= 0 && l.price !== '' && l.price != null ? round2(Number(l.price)) : null,
      })).filter((l) => l.item);
      const linesSum = round2(lines.reduce((t, l) => t + (l.qty || 0) * (l.price || 0), 0));
      const amount = h.money(b.amount) || linesSum;
      if (!(amount > 0)) h.fail(400, 'Enter the expected amount (TL).');
      const cat = await db.prepare('SELECT id, name FROM categories WHERE id = ? AND active = 1').bind(Number(b.category_id)).first();
      if (!cat) h.fail(400, 'Choose a category.');
      const acc = b.pay_account_id ? await db.prepare('SELECT id, name FROM money_accounts WHERE id = ?').bind(Number(b.pay_account_id)).first() : null;
      if (!acc) h.fail(400, 'Choose how it will be paid (which account / cash).');
      if (!h.isDate(b.pay_date)) h.fail(400, 'Choose when it will be paid.');
      const needed = h.isDate(b.needed_by) ? b.needed_by : null;
      const now = h.nowIso();
      const ins = await db.prepare(`INSERT INTO purchase_requests (title, supplier, category_id, amount, needed_by, pay_account_id, pay_date, pay_note, note, status, user_id, created_at, history)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`)
        .bind(title, h.str(b.supplier, 160) || null, cat.id, amount, needed, acc.id, b.pay_date, h.str(b.pay_note, 200) || null, h.str(b.note, 800) || null, me.id, now, withHistory(null, me, `Requested ${tl(amount)}`, now)).run();
      const id = ins.meta.last_row_id;
      if (lines.length) await db.batch(lines.map((l) => db.prepare('INSERT INTO purchase_request_lines (request_id, inv_item, item, qty, unit, price) VALUES (?, ?, ?, ?, ?, ?)').bind(id, l.inv_item, l.item, l.qty, l.unit, l.price)));
      await h.audit(db, me, 'purchase.create', { id, amount });
      const bud = (await budgetStatus(db, h, (b.pay_date || today).slice(0, 7))).find((x) => x.id === cat.id);
      const text = `${me.name} asks to buy:\n\n${title}${b.supplier ? `\nSupplier: ${h.str(b.supplier, 160)}` : ''}\nAmount: ${tl(amount)}\nCategory: ${cat.name}\nPaid from: ${acc.name}, on ${b.pay_date}${needed ? `\nNeeded by: ${needed}` : ''}`
        + (lines.length ? `\n\nItems:\n${lines.map((l) => `• ${l.item}${l.qty ? ` × ${l.qty}${l.unit ? ' ' + l.unit : ''}` : ''}${l.price ? ` @ ${tl(l.price)}` : ''}`).join('\n')}` : '')
        + (b.note ? `\n\nNote: ${h.str(b.note, 800)}` : '')
        + (bud?.budget ? `\n\nBudget for ${cat.name} this month: ${tl(bud.budget)}, left before this request: ${tl(bud.left + amount)}${bud.left < 0 ? ' (OVER BUDGET with this request)' : ''}` : '')
        + `\n\nApprove or reject it in Purchases → To approve:\n${link(url.origin)}`;
      const mail = await sendMany(env, h, await ownerEmails(db), `Mariam Coffee: ${me.name} asks to buy ${title} (${tl(amount)})`, text);
      return h.json({ ok: true, id, mail });
    }
    h.fail(405, 'Not allowed.');
  }

  const id = /^\d+$/.test(sub) ? Number(sub) : null;
  const row = id ? await db.prepare('SELECT * FROM purchase_requests WHERE id = ?').bind(id).first() : null;
  if (!row) h.fail(404, 'That request does not exist.');
  const mineRow = row.user_id === me.id;
  const action = parts[3] || null;
  const now = h.nowIso();
  const requester = async () => db.prepare('SELECT * FROM users WHERE id = ?').bind(row.user_id).first();

  if (m === 'GET' && !action) {
    if (!viewer && !mineRow) h.fail(403, 'Not allowed.');
    const lines = (await db.prepare('SELECT * FROM purchase_request_lines WHERE request_id = ? ORDER BY id').bind(id).all()).results;
    return h.json({ request: { ...out(await db.prepare(`${SELECT} WHERE p.id = ?`).bind(id).first()), lines } });
  }
  if (m !== 'POST') h.fail(405, 'Not allowed.');
  const b = await h.body(request);

  if (action === 'approve') {
    if (!owner) h.fail(403, 'Only the owner approves purchases.');
    if (!['pending', 'reapproval'].includes(row.status)) h.fail(400, 'It is not waiting for approval.');
    const amount = h.money(b.amount) || row.approved_amount || row.amount;
    if (!(amount > 0)) h.fail(400, 'Enter the approved amount.');
    const acc = await db.prepare('SELECT id, name FROM money_accounts WHERE id = ?').bind(Number(b.account_id || row.pay_account_id)).first();
    if (!acc) h.fail(400, 'Choose how it will be paid.');
    const payDate = h.isDate(b.pay_date) ? b.pay_date : row.pay_date;
    const note = h.str(b.note, 300) || null;
    const re = row.status === 'reapproval';
    const status = row.photos ? 'invoice_submitted' : 'approved';
    await db.prepare('UPDATE purchase_requests SET status = ?, approved_amount = ?, pay_account_id = ?, pay_date = ?, decided_by = ?, decided_at = ?, decision_note = ?, history = ? WHERE id = ?')
      .bind(status, amount, acc.id, payDate, me.id, now, note, withHistory(row, me, `${re ? 'Approved again' : 'Approved'} ${tl(amount)}, paid from ${acc.name} on ${payDate}${note ? ` (${note})` : ''}`, now), id).run();
    await h.audit(db, me, re ? 'purchase.reapprove' : 'purchase.approve', { id, amount });
    const u = await requester();
    if (re) {
      await sendMany(env, h, await checkerEmails(db), `Mariam Coffee: purchase “${row.title}” approved again (${tl(amount)})`, `The owner approved the higher invoice amount for “${row.title}”: ${tl(amount)}.\n\nCheck and save the invoice in Purchases → Check invoices:\n${link(url.origin)}`);
    } else {
      await notify(env, h, url.origin, u, `approved: ${row.title}`, `Your purchase request “${row.title}” was approved for ${tl(amount)}.\nIt will be paid from ${acc.name} on ${payDate}.${note ? `\nNote from the owner: ${note}` : ''}\n\nAfter you buy it, please send the invoice: open Purchases → My requests, tap “Send the invoice”, and add a photo of the invoice and its total.`);
    }
    return h.json({ ok: true });
  }

  if (action === 'reject') {
    if (!owner) h.fail(403, 'Only the owner rejects purchases.');
    if (!['pending', 'reapproval'].includes(row.status)) h.fail(400, 'It is not waiting for approval.');
    const reason = h.str(b.reason, 300) || null;
    await db.prepare("UPDATE purchase_requests SET status = 'rejected', decided_by = ?, decided_at = ?, decision_note = ?, history = ? WHERE id = ?")
      .bind(me.id, now, reason, withHistory(row, me, `Rejected${reason ? ': ' + reason : ''}`, now), id).run();
    await h.audit(db, me, 'purchase.reject', { id });
    await notify(env, h, url.origin, await requester(), `not approved: ${row.title}`, `Your purchase request “${row.title}” (${tl(row.amount)}) was not approved.${reason ? `\nReason: ${reason}` : ''}`);
    return h.json({ ok: true });
  }

  if (action === 'cancel') {
    if (!(mineRow || owner)) h.fail(403, 'Only the requester or the owner can cancel it.');
    if (['done', 'rejected', 'cancelled'].includes(row.status)) h.fail(400, 'It is already closed.');
    await db.prepare("UPDATE purchase_requests SET status = 'cancelled', history = ? WHERE id = ?").bind(withHistory(row, me, 'Cancelled', now), id).run();
    await h.audit(db, me, 'purchase.cancel', { id });
    return h.json({ ok: true });
  }

  if (action === 'invoice') {
    if (!(mineRow || isChecker(h, me))) h.fail(403, 'Only the requester sends the invoice.');
    if (!['approved', 'invoice_submitted'].includes(row.status)) h.fail(400, row.status === 'pending' ? 'It is not approved yet.' : 'It cannot take an invoice now.');
    const photos = (Array.isArray(b.photos) ? b.photos : []).filter((p) => /^r_[a-f0-9]{32}$/.test(p)).slice(0, 4);
    if (!photos.length) h.fail(400, 'Add a photo of the invoice.');
    const total = h.money(b.total);
    if (!(total > 0)) h.fail(400, 'Enter the invoice total.');
    const approved = row.approved_amount || row.amount;
    const over = total > approved * (1 + OVER_PCT / 100);
    await db.prepare("UPDATE purchase_requests SET status = 'invoice_submitted', photos = ?, invoice_total = ?, invoice_note = ?, submitted_at = ?, history = ? WHERE id = ?")
      .bind(JSON.stringify(photos), total, h.str(b.note, 500) || null, now, withHistory(row, me, `Invoice sent: ${tl(total)}${total > approved ? ` (${tl(total - approved)} above the approved ${tl(approved)})` : ''}`, now), id).run();
    await h.audit(db, me, 'purchase.invoice', { id, total });
    await sendMany(env, h, await checkerEmails(db), `Mariam Coffee: invoice to check, ${row.title} (${tl(total)})`,
      `${me.name} sent the invoice for “${row.title}”.\nApproved: ${tl(approved)} · Invoice: ${tl(total)}${over ? `\nThe invoice is more than ${OVER_PCT}% above the approved amount: it will go back to the owner when you save it.` : ''}\n\nCheck it and save it in Purchases → Check invoices:\n${link(url.origin)}`);
    return h.json({ ok: true, over });
  }
  h.fail(404, 'Not found.');
}

// ---- the invoice check (called from POST /api/invoices with purchase_id)

/** Before the invoice is saved: is it within the approved amount? Throws 428 and sends it back to the owner if not. */
export async function purchaseBeforeSave(env, h, me, request, purchaseId, total) {
  const db = env.DB;
  const row = await db.prepare('SELECT * FROM purchase_requests WHERE id = ?').bind(purchaseId).first();
  if (!row) h.fail(404, 'The purchase request was not found.');
  if (!isChecker(h, me)) h.fail(403, 'Only an accountant or a manager checks purchase invoices.');
  if (row.status === 'done') h.fail(409, 'This purchase already has its invoice saved.');
  if (row.status === 'reapproval') h.fail(428, 'This invoice is waiting for the owner to approve the higher amount.');
  if (!['approved', 'invoice_submitted'].includes(row.status)) h.fail(400, 'This purchase is not approved.');
  const approved = row.approved_amount || row.amount;
  if (total > approved * (1 + OVER_PCT / 100) && !h.isOwner(me)) {
    const now = h.nowIso();
    await db.prepare("UPDATE purchase_requests SET status = 'reapproval', invoice_total = ?, history = ? WHERE id = ?")
      .bind(total, withHistory(row, me, `Invoice ${tl(total)} is more than ${OVER_PCT}% above the approved ${tl(approved)}: sent back to the owner`, now), purchaseId).run();
    await sendMany(env, h, await ownerEmails(db), `Mariam Coffee: approve again, ${row.title} (${tl(total)} instead of ${tl(approved)})`,
      `The invoice for “${row.title}” is ${tl(total)}, but ${tl(approved)} was approved (${Math.round(((total - approved) / approved) * 100)}% more).\n\nApprove the new amount or reject it in Purchases → To approve:\n${link(new URL(request.url).origin)}`);
    h.fail(428, `The invoice (${tl(total)}) is more than ${OVER_PCT}% above the approved ${tl(approved)}. It was sent back to the owner to approve again; nothing was saved.`);
  }
  return row;
}

/** After the invoice is saved: close the request and remember the expense / invoice. */
export async function purchaseAfterSave(db, h, me, row, { invoiceId, expenseId, total }) {
  const now = h.nowIso();
  const approved = row.approved_amount || row.amount;
  await db.prepare("UPDATE purchase_requests SET status = 'done', invoice_total = ?, invoice_id = ?, expense_id = ?, checked_by = ?, done_at = ?, history = ? WHERE id = ?")
    .bind(total, invoiceId, expenseId, me.id, now, withHistory(row, me, `Invoice checked and saved: ${tl(total)}${total > approved ? ` (${tl(total - approved)} above the approved amount)` : ''}`, now), row.id).run();
}

// ---- spend tracker

async function tracker(db, h, month) {
  const reqs = (await db.prepare(`${SELECT} WHERE substr(p.created_at, 1, 7) = ? OR substr(p.decided_at, 1, 7) = ? OR substr(p.done_at, 1, 7) = ? OR p.status IN ('pending', 'approved', 'invoice_submitted', 'reapproval')`).bind(month, month, month).all()).results.map(out);
  const inMonth = (iso) => !!iso && h.localParts(iso).month === month;
  const sum = (l, f) => round2(l.reduce((t, r) => t + (Number(f(r)) || 0), 0));
  const requested = reqs.filter((r) => inMonth(r.created_at));
  const approved = reqs.filter((r) => inMonth(r.decided_at) && !['pending', 'rejected'].includes(r.status) && r.approved_amount);
  const done = reqs.filter((r) => r.status === 'done' && inMonth(r.done_at));
  const today = h.localParts().date;
  const totals = {
    requested: { n: requested.length, amount: sum(requested, (r) => r.amount) },
    approved: { n: approved.length, amount: sum(approved, (r) => r.approved_amount) },
    rejected: { n: requested.filter((r) => r.status === 'rejected').length, amount: sum(requested.filter((r) => r.status === 'rejected'), (r) => r.amount) },
    invoiced: { n: done.length, amount: sum(done, (r) => r.invoice_total) },
    paid: { n: done.filter((r) => r.expense_status === 'paid').length, amount: sum(done.filter((r) => r.expense_status === 'paid'), (r) => r.expense_amount) },
    over: { n: done.filter((r) => r.invoice_total > r.approved_amount).length, amount: sum(done.filter((r) => r.invoice_total > r.approved_amount), (r) => r.invoice_total - r.approved_amount) },
  };
  const group = (key) => {
    const g = new Map();
    for (const r of reqs.filter((x) => inMonth(x.created_at) || inMonth(x.done_at))) {
      if (['rejected', 'cancelled'].includes(r.status)) continue;
      const k = key(r) || '—';
      const o = g.get(k) || { name: k, n: 0, requested: 0, approved: 0, invoiced: 0 };
      o.n++; o.requested += r.amount; o.approved += r.approved_amount || 0; o.invoiced += r.status === 'done' ? r.invoice_total || 0 : 0;
      g.set(k, o);
    }
    return [...g.values()].map((o) => ({ ...o, requested: round2(o.requested), approved: round2(o.approved), invoiced: round2(o.invoiced) })).sort((a, b) => b.approved - a.approved);
  };
  const days = (a) => Math.max(0, Math.round((Date.parse(today) - Date.parse(h.localParts(a).date)) / 86400e3));
  const open = reqs.filter((r) => OPEN.includes(r.status)).map((r) => ({ id: r.id, title: r.title, user_name: r.user_name, status: r.status, approved_amount: r.approved_amount, invoice_total: r.invoice_total, days: days(r.decided_at || r.created_at), pay_date: r.pay_date }));
  const pending = reqs.filter((r) => r.status === 'pending').map((r) => ({ id: r.id, title: r.title, user_name: r.user_name, amount: r.amount, days: days(r.created_at) }));
  const toPay = (await db.prepare(`SELECT p.id, p.title, e.amount, e.status, e.due_date, a.name AS account FROM purchase_requests p JOIN expenses e ON e.id = p.expense_id
    LEFT JOIN money_accounts a ON a.id = e.account_id WHERE e.deleted = 0 AND e.status <> 'paid' ORDER BY coalesce(e.due_date, '9999')`).all()).results;
  return { month, today, overPct: OVER_PCT, totals, budgets: await budgetStatus(db, h, month), bySupplier: group((r) => r.supplier), byRequester: group((r) => r.user_name), byCategory: group((r) => r.category), open, pending, toPay };
}

// ---- daily reminders (cron)

export async function purchaseReminders(env) {
  const db = env.DB;
  const h = { getSetting: async (d, key) => { const r = await d.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first(); return r ? JSON.parse(r.value) : null; } };
  const now = new Date().toISOString();
  const cut = new Date(Date.now() - REMIND_DAYS * 86400e3).toISOString();
  const rows = (await db.prepare(`SELECT p.*, u.email, u.name AS user_name FROM purchase_requests p JOIN users u ON u.id = p.user_id
    WHERE p.status = 'approved' AND p.decided_at <= ? AND (p.reminded_at IS NULL OR p.reminded_at <= ?)`).bind(cut, cut).all().catch(() => ({ results: [] }))).results;
  let sent = 0;
  for (const r of rows) {
    const u = { name: r.user_name, email: r.email };
    const res = await notify(env, h, SITE, u, `please send the invoice: ${r.title}`, `“${r.title}” was approved ${Math.round((Date.now() - Date.parse(r.decided_at)) / 86400e3)} days ago (${tl(r.approved_amount)}), and its invoice has not been sent yet.\n\nIf you bought it, open Purchases → My requests and tap “Send the invoice”. If it is not needed any more, cancel the request there.`);
    if (res.ok) sent++;
    await db.prepare('UPDATE purchase_requests SET reminded_at = ? WHERE id = ?').bind(now, r.id).run();
  }
  // the owner: requests waiting for approval for more than a day (once a day)
  const old = (await db.prepare("SELECT p.title, p.amount, u.name AS user_name FROM purchase_requests p JOIN users u ON u.id = p.user_id WHERE p.status IN ('pending', 'reapproval') AND p.created_at <= ?")
    .bind(new Date(Date.now() - 86400e3).toISOString()).all().catch(() => ({ results: [] }))).results;
  if (old.length) {
    await sendMany(env, h, await ownerEmails(db), `Mariam Coffee: ${old.length} purchase request${old.length === 1 ? '' : 's'} waiting for you`,
      `These purchase requests are waiting for your approval:\n\n${old.map((r) => `• ${r.title} (${tl(r.amount)}) from ${r.user_name}`).join('\n')}\n\nPurchases → To approve:\n${SITE}/management/staff`);
  }
  return { reminded: sent, waiting: old.length };
}
