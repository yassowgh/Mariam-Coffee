// How accounting records are grouped in the financial statement and the Finance explanation.
// Agreed with the owner (Nov 2026):
// - fixed: rent, salaries, bills (electricity, water, gas, internet), recurring services
// - raw materials: coffee / bar, breakfast, sweets, packaging (the "stock" categories)
// - purchases: tools, equipment and supplies (bar / kitchen tools, cleaning materials)
// - operating: everything else needed to run the café
// - one-off / setup: company set-up and legal fees, renovation, the new POS machine (a separate line)
// - not a cost: loan repayments (money borrowed and given back)
// Every record counts on its own date (the date it was paid, or for planned bills the date set).

export const GROUPS = [
  { key: 'fixed', en: 'Fixed monthly costs', ar: 'المصاريف الشهرية الثابتة', color: 'var(--cat-1)' },
  { key: 'raw', en: 'Raw materials', ar: 'المواد الخام', color: 'var(--cat-2)' },
  { key: 'purchases', en: 'Purchases (tools, equipment, supplies)', ar: 'المشتريات (أدوات ومعدات ولوازم)', color: 'var(--cat-3)' },
  { key: 'operating', en: 'Operating expenses', ar: 'المصاريف التشغيلية', color: 'var(--cat-4)' },
  { key: 'oneoff', en: 'One-off / setup costs', ar: 'مصاريف التأسيس / لمرة واحدة', color: 'var(--cat-7)' },
];
export const GROUP = Object.fromEntries(GROUPS.map((g) => [g.key, g]));

/** Lines of the fixed costs, in the order the statement shows them. */
export const FIXED = [
  { key: 'rent', en: 'Rent', ar: 'الإيجار' },
  { key: 'salaries', en: 'Salaries', ar: 'الرواتب' },
  { key: 'electricity', en: 'Electricity', ar: 'الكهرباء' },
  { key: 'water', en: 'Water', ar: 'المياه' },
  { key: 'gas', en: 'Gas', ar: 'الغاز' },
  { key: 'internet', en: 'Internet', ar: 'الإنترنت' },
  { key: 'bills', en: 'Other bills', ar: 'فواتير أخرى' },
  { key: 'services', en: 'Recurring services / fees', ar: 'خدمات ورسوم دورية' },
];

const RAW = /^(bar materials|breakfast materials|sweets orders|ambalaj|coffee beans|milk & dairy|cups & packaging|syrups & sauces|pastries & food supplies|water)$/i;
const PURCHASES = /^(bar\/kitchen tools|cleaning materials|cleaning supplies)$/i;
const ONEOFF_CAT = /^(legal fees|renovation)$/i;
const ONEOFF_NAME = /new pos machine/i;
const NOT_COST_CAT = /^loan \/ urgent cash need$/i;

/** { group, sub } of an accounting record, or null when it is not a cost (loan repayment). */
export function groupOf(r) {
  const cat = String(r.category || '').trim();
  const name = String(r.name || '');
  if (r.kind === 'loan_repayment' || NOT_COST_CAT.test(cat)) return null;
  if (ONEOFF_CAT.test(cat) || ONEOFF_NAME.test(name)) return { group: 'oneoff', sub: cat };
  if (/^rents?$/i.test(cat)) return { group: 'fixed', sub: 'rent' };
  if (/^salar/i.test(cat)) return { group: 'fixed', sub: 'salaries' };
  if (/^utilit/i.test(cat)) {
    const n = name.toLowerCase();
    const sub = /elektri|electri/.test(n) ? 'electricity' : /\bsu\b|water/.test(n) ? 'water' : /\bgaz\b|\bgas\b|doğalgaz|dogalgaz/.test(n) ? 'gas' : /internet/.test(n) ? 'internet' : 'bills';
    return { group: 'fixed', sub };
  }
  if (/^recurring/i.test(cat)) return { group: 'fixed', sub: 'services' };
  if (r.stock || RAW.test(cat)) return { group: 'raw', sub: cat };
  if (PURCHASES.test(cat)) return { group: 'purchases', sub: cat };
  return { group: 'operating', sub: cat };
}

export const VAT_RATE = 0.10; // KDV included in the till prices (confirmed by the owner)
export const exVat = (v) => v / (1 + VAT_RATE);

export const monthsBetween = (a, b) => {
  const out = [];
  for (let m = a; m <= b;) {
    out.push(m);
    const [y, mo] = m.split('-').map(Number);
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  }
  return out;
};
export const addMonths = (m, n) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7);
};

/**
 * Costs per month: { [month]: { total, groups: {fixed,…}, fixed: {rent,…}, cats: {name: amount}, notCost } }
 * records: accounting records { date, amount, fees, category, name, kind, stock }
 */
export function costsByMonth(records, months) {
  const want = new Set(months);
  const out = Object.fromEntries(months.map((m) => [m, { total: 0, operatingTotal: 0, groups: Object.fromEntries(GROUPS.map((g) => [g.key, 0])), fixed: Object.fromEntries(FIXED.map((f) => [f.key, 0])), cats: {}, notCost: 0, n: 0 }]));
  for (const r of records) {
    const m = (r.date || '').slice(0, 7);
    if (!want.has(m)) continue;
    const amt = (Number(r.amount) || 0) + (Number(r.fees) || 0);
    const g = groupOf(r);
    const o = out[m];
    if (!g) { o.notCost += amt; continue; }
    o.n++;
    o.total += amt;
    if (g.group !== 'oneoff') o.operatingTotal += amt;
    o.groups[g.group] += amt;
    if (g.group === 'fixed') o.fixed[g.sub] += amt;
    const ck = r.category || 'Other';
    o.cats[ck] = (o.cats[ck] || 0) + amt;
  }
  return out;
}
