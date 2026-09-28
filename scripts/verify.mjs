// Usage: node scripts/verify.mjs <folder-with-.DB-files>
// Parses the tables with the same code the web app uses and prints the
// monthly totals and reconciliation checks.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildModel } from '../src/lib/model.js';
import { TABLES } from '../src/lib/tables.js';
import { applyCosts, makeCostConfig, parseCostWorkbook, unitCosts } from '../src/lib/costs.js';

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
// optional: COSTS=<cost sheet .xlsx> checks profit figures
if (process.env.COSTS) {
  const cfg = makeCostConfig(parseCostWorkbook(readFileSync(process.env.COSTS), 'costs.xlsx'));
  const info = applyCosts(m.baseSets, cfg);
  m.clearViews();
  const invs = m.view(source, day).invoices;
  console.log('costs: linked items', info.items, 'coverage of all sales', (info.coverage * 100).toFixed(1) + '%');
  const byDay = new Map();
  let bad = 0;
  for (const i of invs) {
    const lineProfit = i.lines.reduce((s, l) => s + (l.cost == null ? 0 : l.net - l.cost), 0);
    if (Math.abs(lineProfit - i.profit) > 0.02) bad++;
    byDay.set(i.date, (byDay.get(i.date) || 0) + i.profit);
  }
  console.log('invoices whose line profit != invoice profit:', bad);
  const y = invs.filter((i) => i.date >= '2026-01-01');
  const P = y.reduce((s, i) => s + i.profit, 0), CN = y.reduce((s, i) => s + i.costedNet, 0), N = y.reduce((s, i) => s + i.net, 0);
  console.log('2026: sales', N.toFixed(0), 'costed sales', CN.toFixed(0), 'profit', P.toFixed(0), 'margin', (P / CN * 100).toFixed(1) + '%');
  const uc = unitCosts(cfg);
  for (const id of [33, 19, 15, 115]) console.log('  unit cost', id, m.products.get(id)?.name, uc.get(id)?.cost.toFixed(2), uc.get(id)?.label);
  if (bad) process.exit(3);
}
if (m.recon.dailyCheck.failed) process.exit(2);
