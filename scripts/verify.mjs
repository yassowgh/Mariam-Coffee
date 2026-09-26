// Usage: node scripts/verify.mjs <folder-with-.DB-files>
// Parses the tables with the same code the web app uses and prints the
// monthly totals and reconciliation checks.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildModel } from '../src/lib/model.js';
import { TABLES } from '../src/lib/tables.js';

const dir = process.argv[2];
if (!dir) { console.error('usage: node scripts/verify.mjs <folder>'); process.exit(1); }
const wanted = new Map(TABLES.map((t) => [t.toLowerCase() + '.db', t]));
const entries = readdirSync(dir)
  .filter((f) => wanted.has(f.toLowerCase()))
  .map((f) => ({ folder: dir, name: wanted.get(f.toLowerCase()), data: new Uint8Array(readFileSync(join(dir, f))) }));

const t0 = Date.now();
const m = await buildModel(entries);
const source = process.argv[3] || 'acc';
const day = process.argv[4] || 'business';
m.invoices = m.view(source, day).invoices;
console.log('view', source, day);
console.log(`parsed in ${Date.now() - t0} ms`);
console.log('sources', m.sources);
const months = new Map();
for (const i of m.invoices) {
  const k = `${i.month} ${i.src} ${i.channel}`;
  const r = months.get(k) || { orders: 0, gross: 0, net: 0 };
  r.orders += i.sign > 0 ? 1 : 0; r.gross += i.gross; r.net += i.net;
  months.set(k, r);
}
for (const [k, r] of [...months].sort()) console.log(k.padEnd(22), String(r.orders).padStart(6), r.gross.toFixed(2).padStart(12), r.net.toFixed(2).padStart(12));
console.log('header/line mismatches', m.recon.headerLineMismatches);
console.log('orphan lines', m.recon.orphanLines);
console.log('daily product check: days', m.recon.dailyCheck.days, 'failed', m.recon.dailyCheck.failed);
const diffDays = m.recon.posVsAcc.filter((r) => Math.abs(r.diff) > 0.01);
console.log('POS vs ACC days with difference', diffDays.length, 'of', m.recon.posVsAcc.length);
console.log('open tickets', m.recon.openTickets.length);
if (m.recon.dailyCheck.failed) process.exit(2);
