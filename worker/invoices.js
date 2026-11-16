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
import Anthropic from '@anthropic-ai/sdk';

export const INVOICE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS invoices (id INTEGER PRIMARY KEY AUTOINCREMENT, expense_id INTEGER, supplier TEXT, invoice_no TEXT,
    date TEXT, currency TEXT NOT NULL DEFAULT 'TRY', subtotal REAL, tax REAL, total REAL NOT NULL, lang TEXT, raw TEXT,
    created_at TEXT NOT NULL, user_id INTEGER)`,
  `CREATE TABLE IF NOT EXISTS invoice_lines (id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER NOT NULL, item TEXT NOT NULL,
    desc_orig TEXT, qty REAL, unit TEXT, unit_price REAL, total REAL NOT NULL, category_id INTEGER)`,
  'CREATE INDEX IF NOT EXISTS invoice_lines_item ON invoice_lines (item)',
];

const PROMPT = `You read supplier invoices and receipts for a café in Istanbul. The document can be in Turkish, Arabic or English (or mixed), printed or handwritten.
Return JSON only, with this shape:
{"supplier": string, "invoice_no": string, "date": "YYYY-MM-DD" or "", "currency": "TRY" | "USD" | "EUR" | other ISO code,
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
- "notes": anything unclear, in English (e.g. "line 3 partly unreadable").`;

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
  return {
    supplier: str(o?.supplier, 160), invoice_no: str(o?.invoice_no, 60), date, currency: str(o?.currency || 'TRY', 6).toUpperCase() || 'TRY',
    lang: str(o?.lang, 10), lines, subtotal: num(o?.subtotal), tax: num(o?.tax), total: num(o?.total) || lines.reduce((t, l) => t + l.total, 0), notes: str(o?.notes, 500),
  };
};
function parseJson(text) {
  if (text && typeof text === 'object') return text;
  const s = String(text || '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

// Workers AI vision models, best first; each is tried until one answers with usable JSON.
const CF_VISION = ['@cf/meta/llama-4-scout-17b-16e-instruct', '@cf/mistralai/mistral-small-3.1-24b-instruct', '@cf/google/gemma-3-12b-it', '@cf/meta/llama-3.2-11b-vision-instruct'];
const CF_TEXT = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

async function readWithWorkersAI(env, { images, text }) {
  const tried = [];
  if (text) {
    const res = await env.AI.run(CF_TEXT, { messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: `Invoice text:\n${text}` }], max_tokens: 4000, temperature: 0 });
    const out = parseJson(res?.response);
    if (out) return { out, by: 'Cloudflare AI (text)' };
    throw new Error('The AI could not read the text of this PDF.');
  }
  for (const model of CF_VISION) {
    try {
      let res;
      if (model.includes('llama-3.2-11b-vision')) {
        // older format: one image as bytes; Meta's licence must be accepted once
        const bytes = [...Uint8Array.from(atob(images[0].split(',')[1]), (c) => c.charCodeAt(0))];
        try { await env.AI.run(model, { prompt: 'agree' }); } catch { /* already accepted */ }
        res = await env.AI.run(model, { messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: 'Read this invoice.' }], image: bytes, max_tokens: 4000, temperature: 0 });
      } else {
        const content = [{ type: 'text', text: `${PROMPT}\n\nRead this invoice${images.length > 1 ? ` (${images.length} pages, in order)` : ''}.` },
          ...images.map((url) => ({ type: 'image_url', image_url: { url } }))];
        res = await env.AI.run(model, { messages: [{ role: 'user', content }], max_tokens: 4000, temperature: 0 });
      }
      const out = parseJson(res?.response ?? res?.choices?.[0]?.message?.content);
      if (out && (Array.isArray(out.lines) || out.total)) return { out, by: `Cloudflare AI (${model.split('/').pop()})` };
      tried.push(`${model.split('/').pop()}: no usable answer`);
    } catch (e) {
      tried.push(`${model.split('/').pop()}: ${String(e?.message || e).slice(0, 120)}`);
      if (/limit|quota|neurons|429/i.test(String(e?.message))) throw new Error('The free Cloudflare AI allowance for today is used up. Try again tomorrow, or type the invoice in.');
    }
  }
  const err = new Error('The AI could not read this invoice. Try a sharper, straight photo in good light.');
  err.tried = tried;
  throw err;
}

async function readWithClaude(env, { images, text }) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const content = text
    ? [{ type: 'text', text: `Invoice text:\n${text}` }]
    : images.map((url) => ({ type: 'image', source: { type: 'base64', media_type: url.slice(5, url.indexOf(';')), data: url.split(',')[1] } }));
  const msg = await client.messages.create({
    model: 'claude-opus-5-5', max_tokens: 6000, system: PROMPT,
    messages: [{ role: 'user', content: [...content, { type: 'text', text: 'Read this invoice and answer with the JSON only.' }] }],
  });
  const out = parseJson(msg.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
  if (!out) throw new Error('Claude gave an answer that could not be read. Try again.');
  return { out, by: 'Claude' };
}

export async function handleInvoices({ head, sub, request, env, me, h }) {
  const db = env.DB;
  const m = request.method;

  if (head === 'invoices' && sub === 'read' && m === 'POST') {
    if (!env.ANTHROPIC_API_KEY && !env.AI) h.fail(501, 'No AI is connected to the website. Type the invoice in by hand.');
    const b = await h.body(request);
    const images = (Array.isArray(b.images) ? b.images : []).filter((u) => typeof u === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(u)).slice(0, 4);
    const text = typeof b.text === 'string' ? b.text.slice(0, 30000) : '';
    if (!images.length && text.trim().length < 20) h.fail(400, 'Add a photo or PDF of the invoice.');
    if (images.reduce((t, u) => t + u.length, 0) > 9 * 1024 * 1024) h.fail(413, 'The photos are too large. Try fewer pages.');
    let r;
    try { r = env.ANTHROPIC_API_KEY ? await readWithClaude(env, { images, text }) : await readWithWorkersAI(env, { images, text }); } catch (e) {
      return json(h, { error: e.message, tried: e.tried }, 502);
    }
    const inv = clean(r.out);
    // a second invoice with the same supplier + number (or same supplier, date and total) is probably a duplicate
    const dup = inv.supplier ? await db.prepare(`SELECT i.id, i.date, i.total, i.invoice_no FROM invoices i JOIN expenses e ON e.id = i.expense_id
      WHERE e.deleted = 0 AND lower(i.supplier) = lower(?) AND ((? <> '' AND i.invoice_no = ?) OR (i.date = ? AND abs(i.total - ?) < 0.01)) LIMIT 1`)
      .bind(inv.supplier, inv.invoice_no, inv.invoice_no, inv.date, inv.total).first() : null;
    await h.audit(db, me, 'invoice.read', { lines: inv.lines.length, by: r.by });
    return json(h, { invoice: inv, by: r.by, duplicate: dup || null });
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
    if (!inv.lines.length) h.fail(400, 'The invoice has no lines.');
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
    const name = `Invoice ${inv.supplier || 'supplier'}${inv.invoice_no ? ' #' + inv.invoice_no : ''}`.slice(0, 160);
    const reason = [`${inv.lines.length} lines`, inv.tax ? `VAT ${inv.tax}` : '', inv.currency !== 'TRY' ? `currency ${inv.currency}` : '', inv.notes].filter(Boolean).join(' · ');
    const ex = await db.prepare(`INSERT INTO expenses (name, category_id, amount, date, status, paid_date, due_date, account_id, payee, payee_type, reason, receipt, kind, created_at, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'company', ?, ?, 'regular', ?, ?)`)
      .bind(name, cat.id, inv.total, inv.date, status, paid_date, due_date, account_id, inv.supplier || null, reason, receipt, now, me.id).run();
    const expenseId = ex.meta.last_row_id;
    const iv = await db.prepare(`INSERT INTO invoices (expense_id, supplier, invoice_no, date, currency, subtotal, tax, total, lang, raw, created_at, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(expenseId, inv.supplier, inv.invoice_no, inv.date, inv.currency, inv.subtotal || null, inv.tax || null, inv.total, inv.lang, JSON.stringify(b.raw || null).slice(0, 20000), now, me.id).run();
    const invoiceId = iv.meta.last_row_id;
    await db.batch(inv.lines.map((l) => db.prepare('INSERT INTO invoice_lines (invoice_id, item, desc_orig, qty, unit, unit_price, total, category_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(invoiceId, l.item || l.desc_orig, l.desc_orig, l.qty, l.unit, l.unit_price, l.total, cat.id)));
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

/** TEMPORARY: runs every Workers AI vision model on one image and reports what each answered. */
export async function testInvoiceAI(env, { images, text, model }) {
  const out = {};
  const models = text ? [CF_TEXT] : (model ? [model] : CF_VISION);
  for (const mdl of models) {
    const t0 = Date.now();
    try {
      const r = text ? await readWithWorkersAI(env, { text }) : await (async () => {
        const save = CF_VISION.slice(); CF_VISION.length = 0; CF_VISION.push(mdl);
        try { return await readWithWorkersAI(env, { images }); } finally { CF_VISION.length = 0; CF_VISION.push(...save); }
      })();
      out[mdl] = { ms: Date.now() - t0, invoice: clean(r.out) };
    } catch (e) { out[mdl] = { ms: Date.now() - t0, error: e.message, tried: e.tried }; }
  }
  return out;
}
