/** Small CSV reader (quotes, commas or semicolons, line breaks inside quotes). Returns rows of strings. */
export function csvRows(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split('\n')[0];
  const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
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
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** CSV text -> array of objects keyed by the header row. */
export function csvObjects(text) {
  const [head, ...rest] = csvRows(text);
  const keys = head.map((h) => h.trim());
  return rest.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ''])));
}
