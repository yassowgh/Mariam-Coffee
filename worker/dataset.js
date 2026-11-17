// Protects the saved POS data: an upload whose newest sale is older than the saved data is refused
// (e.g. the uploader found an old copy of the ASEAL database), and the data it replaces is kept as a backup.
import { unzipSync } from 'fflate';
import { readTable } from '../src/lib/paradox.js';

/** { from, to } dates of the sales in Invoices.DB inside the zip, or null. */
export async function salesRange(zipBytes) {
  try {
    const files = unzipSync(new Uint8Array(zipBytes), { filter: (f) => /(^|\/)invoices\.db$/i.test(f.name) });
    const buf = Object.values(files)[0];
    if (!buf) return null;
    const { rows } = await readTable(buf, { fields: ['Date'], yieldEvery: 1e9 });
    let from = '', to = '';
    for (const r of rows) {
      const d = r.Date ? String(r.Date).slice(0, 10) : '';
      if (!/^\d{4}-\d\d-\d\d$/.test(d) || d < '2000') continue; // empty dates read as 1899
      if (!from || d < from) from = d;
      if (d > to) to = d;
    }
    return to ? { from, to } : null;
  } catch { return null; }
}
