// Supplier invoices read by AI (photo, scan or PDF in English, Arabic or Turkish), translated to English,
// saved as an accounting record with its line items, so the cost of every item can be followed over time.
//
//   POST   /api/invoices/read        { images: [dataURL…] } or { text }  -> what the AI read (nothing saved)
//   POST   /api/invoices             invoice + lines + payment          -> saves record + invoice + lines
//   GET    /api/invoices             all saved invoices with their lines (for item costs and history)
//   PATCH  /api/invoice-lines/:id    { item, category_id }              -> rename / merge an item
//
// AI: Claude when ANTHROPIC_API_KEY is set (best for Arabic handwriting), otherwise Cloudflare Workers AI
// (free allowance): several vision models are tried in turn.
import { aiChat, parseJson } from './ai.js';

export const INVOICE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS invoices (id INTEGER PRIMARY KEY AUTOINCREMENT, expense_id INTEGER, supplier TEXT, invoice_no TEXT,
    date TEXT, currency TEXT NOT NULL DEFAULT 'TRY', subtotal REAL, tax REAL, total REAL NOT NULL, lang TEXT, raw TEXT,
    created_at TEXT NOT NULL, user_id INTEGER)`,
  `CREATE TABLE IF NOT EXISTS invoice_lines (id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER NOT NULL, item TEXT NOT NULL,
    desc_orig TEXT, qty REAL, unit TEXT, unit_price REAL, total REAL NOT NULL, category_id INTEGER)`,
  'CREATE INDEX IF NOT EXISTS invoice_lines_item ON invoice_lines (item)',
];

export const INVOICE_PROMPT = `You read supplier invoices, receipts and bank payment slips for MARIAM COFFEE, a café in Istanbul. The document can be in Turkish, Arabic or English (or mixed), printed or handwritten.
Return JSON only, with this shape:
{"doc_type": "invoice" | "payment",
 "supplier": string, "invoice_no": string, "date": "YYYY-MM-DD" or "", "currency": "TRY" | "USD" | "EUR" | other ISO code,
 "category": string, "paid_from": string, "description": string,
 "lang": "tr" | "ar" | "en" | "mixed",
 "lines": [{"desc_orig": string, "item": string, "qty": number, "unit": string, "unit_price": number, "total": number}],
 "subtotal": number, "tax": number, "total": number, "notes": string}
Rules:
- One entry in "lines" per product line of the invoice, in order. Do not invent lines.
- "desc_orig" = the line text exactly as written (original language). "item" = a short, plain ENGLISH product name
  (translate Turkish/Arabic), e.g. "Whole milk 1L", "Paper cups 8oz", "Sugar 1kg". Same product = same English name.
- "unit" in English (piece, kg, g, L, box, pack, bottle…). qty and prices as plain numbers: Turkish "1.250,50" = 1250.5.
- "total" of a line = qty × unit_price as printed (after line discount). Use 0 when something is not on the invoice.
- "tax" = total VAT/KDV. "total" = the amount to pay (genel toplam / الإجمالي).
- Dates: Turkish invoices use DD.MM.YYYY. Write the date as YYYY-MM-DD.
- "notes": anything unclear, in English (e.g. "line 3 partly unreadable").
- doc_type "invoice" = a bill / invoice / shop receipt with products. doc_type "payment" = a bank transfer or payment slip
  (dekont, havale/EFT, "Alıcı", receipt from a bank): it usually has NO product lines; then "lines" is [] and "total" is the amount sent.
- "supplier" = who RECEIVED the money or SOLD the goods. Mariam Coffee (any spelling, e.g. "MAR İ AM COFFEE", "Mariam Kahve") is the
  customer/sender and is NEVER the supplier. On a bank slip it is the receiver ("Alıcı", "Alıcı Adı", "Receiver"), never the bank itself.
- "paid_from": on a bank slip, the sender's bank (e.g. "Kuveyt Türk", "Ziraat"); otherwise "".
- "description": what it was for, in English, from the slip's explanation ("Açıklama") or the products (e.g. "October rent", "Salary Essa").
- "date" = the transaction / invoice date ("İşlem Tarihi", "Fatura Tarihi"), not the print date.
- "category": choose the single best one from the category list given with the document, written exactly as in the list; "" if unsure.`;

const json = (h, obj, status) => h.json(obj, status);
const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v ?? '').replace(/[^\d.,-]/g, '');
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};
const clean = (o) => {
  const str = (v, n) => String(v ?? '').trim().slice(0, n);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(o?.date || '') ? o.date : '';
  const lines = (Array.isArray(o?.lines) ? o.lines : []).slice(0, 150).map((l) => ({
    desc_orig: str(l.desc_orig ?? l.description, 300), item: str(l.item ?? l.desc_en ?? l.desc_orig, 120),
    qty: num(l.qty ?? l.quantity) || 1, unit: str(l.unit, 20), unit_price: num(l.unit_price ?? l.price), total: num(l.total ?? l.amount),
  })).map((l) => ({ ...l, total: l.total || Math.round(l.qty * l.unit_price * 100) / 100, unit_price: l.unit_price || (l.qty ? Math.round((l.total / l.qty) * 100) / 100 : 0) }))
    .filter((l) => l.item || l.desc_orig);
  let supplier = str(o?.supplier, 160);
  if (/m\s*a\s*r\s*[iİı]?\s*a\s*m\s*(coffee|kahve|cafe|café)/i.test(supplier)) supplier = ''; // the café itself is never the supplier
  const docType = o?.doc_type === 'payment' || (!lines.length && o?.doc_type !== 'invoice') ? 'payment' : 'invoice';
  return {
    doc_type: docType, category: str(o?.category, 80), paid_from: str(o?.paid_from, 80), description: str(o?.description, 160),
    supplier, invoice_no: str(o?.invoice_no, 60), date, currency: str(o?.currency || 'TRY', 6).toUpperCase() || 'TRY',
    lang: str(o?.lang, 10), lines, subtotal: num(o?.subtotal), tax: num(o?.tax), total: num(o?.total) || lines.reduce((t, l) => t + l.total, 0), notes: str(o?.notes, 500),
  };
};

export async function handleInvoices({ head, sub, request, env, me, h }) {
  const db = env.DB;
  const m = request.method;

  if (head === 'invoices' && sub === 'read' && m === 'POST') {
    const b = await h.body(request);
    const images = (Array.isArray(b.images) ? b.images : []).filter((u) => typeof u === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(u)).slice(0, 4);
    const text = typeof b.text === 'string' ? b.text.slice(0, 30000) : '';
    if (!images.length && text.trim().length < 20) h.fail(400, 'Add a photo or PDF of the invoice.');
    if (images.reduce((t, u) => t + u.length, 0) > 9 * 1024 * 1024) h.fail(413, 'The photos are too large. Try fewer pages.');
    const cats = (await db.prepare('SELECT id, name FROM categories WHERE active = 1').all()).results;
    const ctxText = `Category list: ${cats.map((c) => c.name).join(' | ')}\n\n`;
    let r;
    try {
      r = await aiChat(env, db, {
        system: INVOICE_PROMPT,
        text: ctxText + (text ? `Invoice text${b.ocr ? ' (from OCR, may contain small reading mistakes; fix obvious ones)' : ''}:\n${text}` : `Read this invoice${images.length > 1 ? ` (${images.length} pages, in order)` : ''}. Answer with the JSON only.`),
        images: text ? [] : images, maxTokens: 4000,
        accept: (o) => { const j = parseJson(o); return !!j && ((Array.isArray(j.lines) && j.lines.length > 0) || num(j.total) > 0); },
      });
      r.out = parseJson(r.out);
    } catch (e) {
      return json(h, { error: e.message, tried: e.tried }, 502);
    }
    const inv = clean(r.out);
    // a second invoice with the same supplier + number (or same supplier, date and total) is probably a duplicate
    const dup = inv.supplier ? await db.prepare(`SELECT i.id, i.date, i.total, i.invoice_no FROM invoices i JOIN expenses e ON e.id = i.expense_id
      WHERE e.deleted = 0 AND lower(i.supplier) = lower(?) AND ((? <> '' AND i.invoice_no = ?) OR (i.date = ? AND abs(i.total - ?) < 0.01)) LIMIT 1`)
      .bind(inv.supplier, inv.invoice_no, inv.invoice_no, inv.date, inv.total).first() : null;
    // suggestions: the category used last time for this supplier (your own choice) wins over the AI's guess
    const suggest = { category_id: null, category_from: null, status: inv.doc_type === 'payment' ? 'paid' : null, account_id: null };
    if (inv.supplier) {
      const prev = await db.prepare(`SELECT category_id FROM expenses WHERE deleted = 0 AND lower(payee) = lower(?) ORDER BY id DESC LIMIT 1`).bind(inv.supplier).first();
      if (prev?.category_id) { suggest.category_id = prev.category_id; suggest.category_from = 'last time'; }
    }
    if (!suggest.category_id && inv.category) {
      const c = cats.find((x) => x.name.toLowerCase() === inv.category.toLowerCase()) || cats.find((x) => x.name.toLowerCase().includes(inv.category.toLowerCase()) || inv.category.toLowerCase().includes(x.name.toLowerCase()));
      if (c) { suggest.category_id = c.id; suggest.category_from = 'AI'; }
    }
    if (inv.paid_from) {
      const words = inv.paid_from.toLowerCase().split(/[^a-zçğıöşü0-9]+/).filter((w) => w.length >= 4 && !['bank', 'bankası', 'katılım', 'katilim'].includes(w));
      const accs = (await db.prepare("SELECT id, name FROM money_accounts WHERE active = 1 AND type = 'bank'").all()).results;
      const hit = accs.filter((a) => words.some((w) => a.name.toLowerCase().includes(w)));
      if (hit.length === 1) suggest.account_id = hit[0].id;
    }
    await h.audit(db, me, 'invoice.read', { lines: inv.lines.length, by: r.by, type: inv.doc_type });
    return json(h, { invoice: inv, by: r.by, duplicate: dup || null, suggest });
  }

  if (head === 'invoices' && !sub && m === 'GET') {
    const { results: invs } = await db.prepare(`SELECT i.*, e.status, e.category_id AS expense_category_id, c.name AS category FROM invoices i
      JOIN expenses e ON e.id = i.expense_id LEFT JOIN categories c ON c.id = e.category_id WHERE e.deleted = 0 ORDER BY i.date DESC, i.id DESC`).all();
    const { results: lines } = await db.prepare(`SELECT l.* FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id JOIN expenses e ON e.id = i.expense_id WHERE e.deleted = 0`).all();
    const by = new Map(invs.map((i) => [i.id, { ...i, raw: undefined, lines: [] }]));
    for (const l of lines) by.get(l.invoice_id)?.lines.push(l);
    return json(h, { invoices: [...by.values()] });
  }

  if (head === 'invoices' && !sub && m === 'POST') {
    const b = await h.body(request);
    const inv = clean(b.invoice || {});
    if (!inv.lines.length && inv.doc_type === 'invoice' && !b.allow_no_lines) h.fail(400, 'The invoice has no lines.');
    if (!(inv.total > 0)) h.fail(400, 'The invoice total is missing.');
    if (!inv.date) h.fail(400, 'Choose the invoice date.');
    const cat = await db.prepare('SELECT id FROM categories WHERE id = ?').bind(Number(b.category_id)).first();
    if (!cat) h.fail(400, 'Choose a category for the invoice.');
    const status = ['paid', 'scheduled', 'unpaid'].includes(b.status) ? b.status : 'unpaid';
    let account_id = null, paid_date = null, due_date = null;
    if (status === 'paid') {
      const acc = await db.prepare('SELECT id FROM money_accounts WHERE id = ?').bind(Number(b.account_id)).first();
      if (!acc) h.fail(400, 'Choose where it was paid from.');
      account_id = acc.id; paid_date = h.isDate(b.paid_date) ? b.paid_date : inv.date;
    } else if (status === 'scheduled') {
      if (!h.isDate(b.due_date)) h.fail(400, 'Choose the date it will be paid.');
      due_date = b.due_date;
    }
    const receipt = b.receipt && /^r_[a-f0-9]{32}$/.test(b.receipt) ? b.receipt : null;
    const now = h.nowIso();
    const name = (inv.doc_type === 'payment'
      ? `Payment to ${inv.supplier || 'payee'}${inv.description ? ' · ' + inv.description : ''}`
      : `Invoice ${inv.supplier || 'supplier'}${inv.invoice_no ? ' #' + inv.invoice_no : ''}`).slice(0, 160);
    const reason = [inv.lines.length ? `${inv.lines.length} lines` : (inv.doc_type === 'payment' ? 'bank / payment slip' : ''), inv.invoice_no && inv.doc_type === 'payment' ? `ref ${inv.invoice_no}` : '', inv.tax ? `VAT ${inv.tax}` : '', inv.currency !== 'TRY' ? `currency ${inv.currency}` : '', inv.notes].filter(Boolean).join(' · ');
    // already saved (same payee, date, amount and reference)? then do not save it twice
    const same = await db.prepare(`SELECT i.id, i.expense_id FROM invoices i JOIN expenses e ON e.id = i.expense_id
      WHERE e.deleted = 0 AND lower(coalesce(i.supplier, '')) = lower(?) AND i.date = ? AND abs(i.total - ?) < 0.01 AND coalesce(i.invoice_no, '') = ? LIMIT 1`)
      .bind(inv.supplier || '', inv.date, inv.total, inv.invoice_no || '').first();
    if (same && !b.force) return json(h, { error: 'This was already saved.', already: true, invoice_id: same.id, expense_id: same.expense_id }, 409);
    let expenseId = null, invoiceId = null;
    try {
      const ex = await db.prepare(`INSERT INTO expenses (name, category_id, amount, date, status, paid_date, due_date, account_id, payee, payee_type, reason, receipt, kind, created_at, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'company', ?, ?, 'regular', ?, ?)`)
        .bind(name, cat.id, inv.total, inv.date, status, paid_date, due_date, account_id, inv.supplier || null, reason, receipt, now, me.id).run();
      expenseId = ex.meta.last_row_id;
      const iv = await db.prepare(`INSERT INTO invoices (expense_id, supplier, invoice_no, date, currency, subtotal, tax, total, lang, raw, created_at, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(expenseId, inv.supplier, inv.invoice_no, inv.date, inv.currency, inv.subtotal || null, inv.tax || null, inv.total, inv.lang, JSON.stringify(b.raw || null).slice(0, 20000), now, me.id).run();
      invoiceId = iv.meta.last_row_id;
      // a bank / payment slip has no item lines (an empty batch is an error in D1)
      if (inv.lines.length) {
        await db.batch(inv.lines.map((l) => db.prepare('INSERT INTO invoice_lines (invoice_id, item, desc_orig, qty, unit, unit_price, total, category_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(invoiceId, l.item || l.desc_orig, l.desc_orig, l.qty, l.unit, l.unit_price, l.total, cat.id)));
      }
    } catch (e) {
      // all or nothing: remove what was written before the error
      if (invoiceId) await db.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?').bind(invoiceId).run().catch(() => {});
      if (invoiceId) await db.prepare('DELETE FROM invoices WHERE id = ?').bind(invoiceId).run().catch(() => {});
      if (expenseId) await db.prepare('DELETE FROM expenses WHERE id = ?').bind(expenseId).run().catch(() => {});
      throw e;
    }
    await h.audit(db, me, 'invoice.save', { invoice: invoiceId, expense: expenseId, total: inv.total, lines: inv.lines.length });
    return json(h, { ok: true, invoice_id: invoiceId, expense_id: expenseId });
  }

  if (head === 'invoice-lines' && sub && m === 'PATCH') {
    const id = Number(sub);
    const b = await h.body(request);
    const item = String(b.item || '').trim().slice(0, 120);
    if (!item) h.fail(400, 'Write the item name.');
    if (b.all_named) {
      // merge: every line with the old name gets the new one
      const r = await db.prepare('UPDATE invoice_lines SET item = ? WHERE lower(item) = lower(?)').bind(item, String(b.all_named)).run();
      await h.audit(db, me, 'invoice.item.rename', { from: b.all_named, to: item, lines: r.meta.changes });
      return json(h, { ok: true, changed: r.meta.changes });
    }
    await db.prepare('UPDATE invoice_lines SET item = ? WHERE id = ?').bind(item, id).run();
    return json(h, { ok: true });
  }
  return h.fail(404, 'Not found');
}

export const INVOICE_ROUTES = ['invoices', 'invoice-lines'];

