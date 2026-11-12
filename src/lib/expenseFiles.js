// Reads an uploaded expenses file (Excel .xlsx/.xls, CSV, TXT, PDF, Word .docx) into rows to check and import.
// Tables (Excel, CSV, Word tables) are read column by column; free text (PDF, TXT, Word paragraphs)
// goes to the AI on the server, with a simple line reader as a fallback.
import { unzipSync, strFromU8 } from 'fflate';
import { csvRows } from './csv.js';

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  oca: 1, şub: 2, sub: 2, nis: 4, haz: 6, tem: 7, ağu: 8, agu: 8, eyl: 9, eki: 10, kas: 11, ara: 12 };
const pad = (n) => String(n).padStart(2, '0');

export function parseAmount(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  let t = String(v ?? '').replace(/[^\d.,-]/g, '');
  if (!t || !/\d/.test(t)) return null;
  if (t.includes(',') && t.lastIndexOf(',') > t.lastIndexOf('.')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  else t = t.replace(/,/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Many date formats -> "YYYY-MM-DD" (day first for 03/04/2026, as in Türkiye). */
export function parseDate(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date && !Number.isNaN(v)) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const s = String(v).trim().toLowerCase();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${pad(m[2])}-${pad(m[1])}`; }
  m = /^([a-zçğıöşü]+)\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(s);
  if (m && MONTHS[m[1].slice(0, 3)]) return `${m[3]}-${pad(MONTHS[m[1].slice(0, 3)])}-${pad(m[2])}`;
  m = /^(\d{1,2})\s+([a-zçğıöşü]+)\.?\s+(\d{4})/.exec(s);
  if (m && MONTHS[m[2].slice(0, 3)]) return `${m[3]}-${pad(MONTHS[m[2].slice(0, 3)])}-${pad(m[1])}`;
  return '';
}

const COLS = {
  date: /^(date|day|tarih|التاريخ|تاريخ|expense date|payment date)/i,
  name: /(description|item|name|details|what|for|açıklama|aciklama|ürün|urun|البيان|الوصف|البند|expense$)/i,
  amount: /(amount|total|tutar|toplam|price|cost|sum|المبلغ|القيمة|المجموع|tl$|try$)/i,
  category: /(category|type|kategori|tür|tur|الفئة|النوع|التصنيف)/i,
  payee: /(vendor|supplier|payee|paid to|to company|company|firma|tedarikçi|المورد|الجهة)/i,
  status: /(status|paid|durum|الحالة)/i,
  account: /(from account|account|paid from|payment method|kasa|banka|الحساب)/i,
  notes: /(notes?|remark|comment|not|ملاحظ)/i,
};

/** Rows (arrays) with a header row somewhere in the first 15 -> records. Null when no amount column is found. */
export function tableToRecords(rows) {
  for (let hi = 0; hi < Math.min(rows.length, 15); hi++) {
    const head = (rows[hi] || []).map((c) => String(c ?? '').trim());
    const used = new Set();
    const col = (k) => { const i = head.findIndex((x, j) => x && !used.has(j) && COLS[k].test(x)); if (i >= 0) used.add(i); return i; };
    const c = {};
    for (const k of ['amount', 'date', 'category', 'payee', 'status', 'account', 'notes', 'name']) c[k] = col(k);
    if (c.amount < 0) continue;
    if (c.name < 0) c.name = head.findIndex((x, j) => x && !used.has(j));
    const out = [];
    for (const r of rows.slice(hi + 1)) {
      if (!r) continue;
      const amount = parseAmount(r[c.amount]);
      const name = String(r[c.name] ?? '').trim();
      if (amount == null || amount === 0 || (!name && c.name >= 0)) continue;
      if (/^(total|toplam|المجموع|grand total)/i.test(name)) continue;
      const status = c.status >= 0 ? String(r[c.status] ?? '').toLowerCase() : '';
      out.push({
        name: name || 'Expense', amount: Math.abs(amount), date: c.date >= 0 ? parseDate(r[c.date]) : '',
        category: c.category >= 0 ? String(r[c.category] ?? '').replace(/\s*\(https?:[^)]*\)/g, '').trim() : '',
        payee: c.payee >= 0 ? String(r[c.payee] ?? '').replace(/\s*\(https?:[^)]*\)/g, '').trim() : '',
        account: c.account >= 0 ? String(r[c.account] ?? '').replace(/\s*\(https?:[^)]*\)/g, '').trim() : '',
        status: /unpaid|pending|planned|not|ödenmedi|غير/.test(status) ? 'unpaid' : 'paid',
        notes: c.notes >= 0 ? String(r[c.notes] ?? '').trim() : '',
      });
    }
    if (out.length) return out;
  }
  return null;
}

/** A plain reader for text lines like "17/06/2026 Milk 164 TL" (used when the AI is not available). */
export function linesToRecords(text) {
  const out = [];
  for (const line of text.split(/\n/).map((l) => l.trim()).filter(Boolean)) {
    const am = [...line.matchAll(/(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:tl|₺|try)?/gi)];
    const dm = /(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})/.exec(line);
    const cands = am.filter((m) => !dm || !dm[0].includes(m[1]));
    if (!cands.length) continue;
    const last = cands[cands.length - 1];
    const amount = parseAmount(last[1]);
    if (!amount || amount < 1) continue;
    let name = line.replace(last[0], '').replace(dm ? dm[0] : '', '').replace(/[-–:|,;]+\s*$/, '').replace(/\s{2,}/g, ' ').trim();
    if (!name || /^(total|toplam|المجموع)/i.test(name)) continue;
    out.push({ name: name.slice(0, 160), amount, date: dm ? parseDate(dm[1]) : '', category: '', payee: '', account: '', status: 'paid', notes: '' });
  }
  return out;
}

/** Returns { table: records[] | null, text: string } */
export async function readExpenseFile(file) {
  const name = file.name.toLowerCase();
  const buf = new Uint8Array(await file.arrayBuffer());
  if (/\.(xlsx|xls|xlsm|ods)$/.test(name)) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    for (const sn of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: '' });
      const t = tableToRecords(rows);
      if (t) return { table: t, text: '' };
    }
    const text = wb.SheetNames.map((sn) => XLSX.utils.sheet_to_csv(wb.Sheets[sn])).join('\n');
    return { table: null, text };
  }
  if (/\.(csv|tsv|txt)$/.test(name)) {
    const text = new TextDecoder().decode(buf);
    const rows = /\.tsv$/.test(name) ? text.split(/\r?\n/).map((l) => l.split('\t')) : csvRows(text);
    const t = rows.length > 1 && rows[0].length > 1 ? tableToRecords(rows) : null;
    return { table: t, text };
  }
  if (/\.docx$/.test(name)) {
    const files = unzipSync(buf);
    const xml = files['word/document.xml'] ? strFromU8(files['word/document.xml']) : '';
    const cellText = (x) => [...x.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
    for (const tbl of xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || []) {
      const rows = (tbl.match(/<w:tr[\s>][\s\S]*?<\/w:tr>/g) || []).map((tr) => (tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).map(cellText));
      const t = tableToRecords(rows);
      if (t) return { table: t, text: '' };
    }
    const text = (xml.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) || []).map(cellText).join('\n');
    return { table: null, text };
  }
  if (/\.doc$/.test(name)) throw new Error('Old Word files (.doc) cannot be read. Open it in Word and “Save as” .docx or PDF, then upload again.');
  if (/\.pdf$/.test(name)) {
    const pdfjs = await import('pdfjs-dist');
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const doc = await pdfjs.getDocument({ data: buf }).promise;
    const lines = [];
    for (let p = 1; p <= Math.min(doc.numPages, 30); p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      // group text pieces into lines by their vertical position
      const rows = new Map();
      for (const it of content.items) {
        const y = Math.round(it.transform[5]);
        const key = [...rows.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
        if (!rows.has(key)) rows.set(key, []);
        rows.get(key).push({ x: it.transform[4], s: it.str });
      }
      [...rows.entries()].sort((a, b) => b[0] - a[0]).forEach(([, items]) => lines.push(items.sort((a, b) => a.x - b.x).map((i) => i.s).join(' ').replace(/\s{2,}/g, ' ').trim()));
    }
    const text = lines.filter(Boolean).join('\n');
    if (!text.trim()) throw new Error('This PDF has no text (it is probably a scanned image). Enter the expenses by hand, or take photos of the receipts.');
    return { table: null, text };
  }
  throw new Error('Choose an Excel, CSV, TXT, PDF or Word (.docx) file.');
}
