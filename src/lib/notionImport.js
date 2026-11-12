// Turns the Notion "MC-expenses" export into accounting records for /api/expenses/import.
import { csvObjects } from './csv.js';

const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const stripLink = (v) => String(v || '').replace(/\s*\(https?:\/\/[^)]*\)/g, '').trim();
const amountOf = (v) => {
  const n = Number(String(v || '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
};
/** "November 10, 2026" -> "2026-11-10" */
function dateOf(v) {
  const m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(String(v || '').trim());
  if (!m || !MONTHS[m[1].toLowerCase()]) return '';
  return `${m[3]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}
// categories whose items are ingredients or goods for sale (already counted in the recipe costs)
const STOCK = /^(bar materials|breakfast materials|sweets orders|ambalaj)/i;

export function isNotionExport(text) {
  const head = text.replace(/^﻿/, '').split('\n')[0];
  return /Expense Date/.test(head) && /Expense Category/.test(head) && /From Account/.test(head);
}

export function notionRecords(text) {
  const rows = csvObjects(text);
  const seen = new Map();
  const records = [], skipped = [];
  for (const r of rows) {
    const name = stripLink(r['Name']);
    const amount = amountOf(r['Amount']);
    if (!name || !amount) { skipped.push(name || '(empty row)'); continue; }
    const date = dateOf(r['Expense Date']);
    const st = stripLink(r['Status']).toLowerCase();
    const status = st === 'paid' ? 'paid' : st === 'planned' && date ? 'scheduled' : 'unpaid';
    const type = stripLink(r['Expense Type']).toLowerCase();
    const category = stripLink(r['Expense Category']) || 'Other';
    const account = stripLink(r['From Account']);
    const employee = stripLink(r['To Employee']);
    const kind = type.startsWith('loan') ? 'old_debt' : /avans/i.test(name) ? 'advance' : 'regular';
    // the same row exported twice gets the same reference, so importing again does not double it
    const base = [name, date, amount, account, employee].join('|');
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    records.push({
      import_ref: `notion:${base}|${n}`,
      name, amount, category, stock: STOCK.test(category),
      date: status === 'scheduled' ? date : date, // planned items: the planned date is both the expense date and the due date
      due_date: status === 'scheduled' ? date : null,
      status,
      account: status === 'paid' ? account || null : null,
      account_type: /cash/i.test(account) ? 'cash' : 'bank',
      fees: amountOf(r['Transfer Fees']),
      kind,
      payee: stripLink(r['To Company']) || null,
      payee_type: stripLink(r['Company Type']) || null,
      employee: employee || null,
      paid_by: stripLink(r['Expense Owner']) || null,
      reason: String(r['Notes if any!'] || '').trim() || null,
    });
  }
  return { records, skipped };
}
