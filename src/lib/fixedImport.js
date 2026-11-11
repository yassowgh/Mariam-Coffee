// Reads a fixed-costs file (.xlsx or .csv) into rows { month: 'YYYY-MM', item, amount, note }.
// Recognised layouts:
//   long:  one row per cost with Month, Item and Amount columns (any order, English or Turkish headers)
//   wide:  one row per item and one column per month (e.g. "Jan 2026", "2026-01", Excel dates)
//   plain: Item + Amount only -> the caller asks which month it is for
import { readSheets } from './costs.js';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTHS_TR = ['oca', 'şub', 'mar', 'nis', 'may', 'haz', 'tem', 'ağu', 'eyl', 'eki', 'kas', 'ara'];
const clean = (v) => (v == null ? '' : String(v).trim());
const pad = (n) => String(n).padStart(2, '0');

/** "2026-11" from many ways of writing a month, or null. */
export function parseMonth(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) { // Excel date serial
      const d = new Date(Math.round((v - 25569) * 86400000));
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
    }
    return null;
  }
  const s = clean(v).toLowerCase();
  let m = /^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/.exec(s);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${pad(m[2])}`;
  m = /^(?:\d{1,2}[-/.])?(\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m && +m[1] >= 1 && +m[1] <= 12) return `${m[2]}-${pad(m[1])}`;
  m = /^([a-zçğıöşü]+)[\s\-/.']*(\d{2}|\d{4})$/.exec(s) || /^(\d{4})[\s\-/.]*([a-zçğıöşü]+)$/.exec(s);
  if (m) {
    const [word, year] = /^\d/.test(m[1]) ? [m[2], m[1]] : [m[1], m[2]];
    const k = word.slice(0, 3);
    let i = MONTHS.indexOf(k);
    if (i < 0) i = MONTHS_TR.indexOf(k);
    if (i >= 0) return `${year.length === 2 ? '20' + year : year}-${pad(i + 1)}`;
  }
  return null;
}

export function parseAmount(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = clean(v).replace(/[^\d.,-]/g, '');
  if (!s) return null;
  // "1.250,50" (Turkish) vs "1,250.50"
  if (s.includes(',') && s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function csvRows(text) {
  const sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const RE = {
  month: /^(month|date|period|ay|tarih|dönem|donem|شهر|التاريخ)/i,
  item: /(item|description|name|category|expense|cost item|kalem|açıklama|aciklama|gider|البند|الوصف)/i,
  amount: /(amount|cost|total|value|tl|tutar|toplam|مبلغ|المبلغ)/i,
  note: /(note|comment|remark|not|ملاحظ)/i,
};

/**
 * Returns { layout, rows, needsMonth, sheet, skipped } or throws with a readable message.
 * rows have month = null when the file has no month (layout "plain").
 */
export async function readFixedCostFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sheets = /\.csv$/i.test(file.name) || /^text\//.test(file.type)
    ? [{ name: file.name, rows: csvRows(new TextDecoder().decode(bytes).replace(/^﻿/, '')) }]
    : readSheets(bytes);
  if (!sheets.length) throw new Error('The file has no sheets.');
  const errors = [];
  for (const sh of sheets) {
    try {
      const r = fromRows(sh.rows);
      if (r.rows.length) return { ...r, sheet: sh.name };
    } catch (e) { errors.push(`${sh.name}: ${e.message}`); }
  }
  throw new Error(errors[0] || 'No cost rows were found. The file needs a column for the cost item and one for the amount (or one column per month).');
}

function fromRows(all) {
  const rows = all.map((r) => (r || []).map((v) => (typeof v === 'string' ? v.trim() : v)));
  for (let hi = 0; hi < Math.min(rows.length, 15); hi++) {
    const head = rows[hi].map(clean);
    const col = (re, not = []) => head.findIndex((h, i) => h && re.test(h) && !not.includes(i));
    const monthCols = head.map((h, i) => [i, parseMonth(rows[hi][i])]).filter(([, m]) => m);
    const cItem0 = col(RE.item);
    // wide layout: several month headers
    if (monthCols.length >= 1 && (cItem0 >= 0 || monthCols[0][0] > 0)) {
      const firstOther = head.findIndex((h, i) => !monthCols.some(([j]) => j === i));
      const cItem = cItem0 >= 0 ? cItem0 : Math.max(0, firstOther);
      const cNote = col(RE.note, [cItem]);
      const out = [];
      let skipped = 0;
      for (const r of rows.slice(hi + 1)) {
        const item = clean(r[cItem]);
        if (!item || /^(total|toplam|المجموع)/i.test(item)) continue;
        for (const [i, month] of monthCols) {
          const a = parseAmount(r[i]);
          if (a == null) { if (clean(r[i])) skipped++; continue; }
          if (a !== 0) out.push({ month, item, amount: a, note: cNote >= 0 ? clean(r[cNote]) : '' });
        }
      }
      if (out.length) return { layout: 'wide', rows: out, needsMonth: false, skipped };
    }
    const cMonth = col(RE.month);
    const cItem = col(RE.item, [cMonth]);
    const cAmount = col(RE.amount, [cMonth, cItem]);
    if (cItem < 0 || cAmount < 0) continue;
    const cNote = col(RE.note, [cMonth, cItem, cAmount]);
    const out = [];
    let skipped = 0;
    for (const r of rows.slice(hi + 1)) {
      const item = clean(r[cItem]);
      if (!item || /^(total|toplam|المجموع)/i.test(item)) continue;
      const amount = parseAmount(r[cAmount]);
      const month = cMonth >= 0 ? parseMonth(r[cMonth]) : null;
      if (amount == null || (cMonth >= 0 && !month)) { skipped++; continue; }
      out.push({ month, item, amount, note: cNote >= 0 ? clean(r[cNote]) : '' });
    }
    if (out.length) return { layout: cMonth >= 0 ? 'long' : 'plain', rows: out, needsMonth: cMonth < 0, skipped };
  }
  throw new Error('No header row with a cost item column and an amount column (or month columns) was found in the first 15 rows.');
}

/** A CSV template the owner can fill in Excel. */
export function templateCsv(month) {
  const lines = [
    'Month,Item,Amount,Note',
    `${month},Rent,0,`,
    `${month},Salaries,0,`,
    `${month},Electricity,0,`,
    `${month},Natural gas,0,`,
    `${month},Water bill,0,`,
    `${month},Internet & phone,0,`,
    `${month},Accountant,0,`,
    `${month},POS / software subscription,0,`,
  ];
  return '﻿' + lines.join('\n') + '\n';
}
