// Product costs (COGS): reads the "Master Drink Costs" workbook, links till
// products to its recipes/ingredients, and applies unit costs to every sold line.
//
// Cost config (saved on the server as JSON):
//   { recipes: [{ id, name, type, cost, price }], ingredients: [{ id, name, cost }],
//     links: { itemNo: [sourceId, ...] },   // cost = sum of the linked recipes/ingredients
//     manual: { itemNo: unitCost },          // typed by the owner; wins over links
//     sheetName, updatedAt }

import { unzipSync, strFromU8 } from 'fflate';

// ---------- minimal .xlsx reader (cached cell values; works in browser and Node) ----------

const decodeXml = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');

const colIndex = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

function readSheets(bytes) {
  const files = unzipSync(bytes);
  const text = (p) => (files[p] ? strFromU8(files[p]) : '');
  const shared = [];
  for (const m of text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    shared.push(decodeXml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  }
  const rels = new Map([...text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((m) => {
    const id = /Id="([^"]+)"/.exec(m[0])?.[1];
    const target = /Target="([^"]+)"/.exec(m[0])?.[1] || '';
    return [id, target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '')];
  }));
  const sheets = [...text('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)].map((m) => ({
    name: decodeXml(/name="([^"]+)"/.exec(m[0])?.[1] || ''),
    path: rels.get(/r:id="([^"]+)"/.exec(m[0])?.[1]),
  }));
  return sheets.filter((s) => s.path && files[s.path]).map((s) => {
    const rows = [];
    for (const r of text(s.path).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row = [];
      for (const c of r[1].matchAll(/<c\b[^>]*?r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[2] || '';
        const body = c[3] || '';
        const type = /\bt="(\w+)"/.exec(attrs)?.[1];
        let v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        if (type === 's') v = shared[Number(v)];
        else if (type === 'inlineStr') v = decodeXml([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
        else if (type === 'str' || type === 'e') v = v != null ? decodeXml(v) : undefined;
        else if (v != null) v = Number(v);
        row[colIndex(c[1])] = v;
      }
      rows.push(row);
    }
    return { name: s.name, rows };
  });
}

const clean = (s) => (s == null ? '' : String(s).trim());
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

/** Parse the cost workbook into recipes and ingredients. Throws if the layout is not recognised. */
export function parseCostWorkbook(bytes, fileName = '') {
  const sheets = readSheets(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  for (const sh of sheets) {
    const hi = sh.rows.findIndex((r) => r && r.some((v) => /drink name/i.test(clean(v))));
    if (hi < 0) continue;
    const head = sh.rows[hi].map((v) => clean(v).toLowerCase());
    const col = (re) => head.findIndex((h) => re.test(h));
    const cName = col(/drink name/), cIng = col(/ingredient|material$/), cAmt = col(/^amount/);
    const cUnit = col(/^unit/), cMat = col(/material cost/), cTotal = col(/total .*cost/);
    const cPrice = col(/selling price/), cType = col(/type/);
    if (cName < 0 || cMat < 0) continue;
    const recipes = [];
    const ingredients = new Map();
    let cur = null;
    for (const r of sh.rows.slice(hi + 1)) {
      if (!r) continue;
      const name = clean(r[cName]);
      if (/^(average|total)\b/i.test(name)) break;
      const ing = clean(r[cIng]);
      if (name) {
        cur = { id: 'r:' + name, name, type: clean(r[cType]) || 'OTHER', cost: 0, sheetTotal: num(r[cTotal]), price: num(r[cPrice]), parts: [] };
        recipes.push(cur);
      }
      if (!cur || !ing) continue;
      const matCost = num(r[cMat]);
      cur.cost += matCost;
      const label = `${ing} ${clean(r[cAmt])}${clean(r[cUnit])}`.trim();
      cur.parts.push({ name: label, cost: matCost });
      if (matCost > 0 && !ingredients.has(label)) ingredients.set(label, { id: 'i:' + label, name: label, cost: matCost });
    }
    for (const rc of recipes) rc.cost = Math.round(rc.cost * 100) / 100;
    if (!recipes.length) continue;
    return {
      recipes,
      ingredients: [...ingredients.values()].sort((a, b) => a.name.localeCompare(b.name)),
      sheetName: fileName || sh.name,
    };
  }
  throw new Error('This workbook has no sheet with a “Drink Name” column and material costs.');
}

// ---------- default links from till products (item numbers) to the cost sheet ----------
// Takeaway sizes use the in-house recipe (cup cost is not in the sheet).
// Add-ons use the matching ingredient; combos add up their parts.
const R = (n) => 'r:' + n;
const I = (n) => 'i:' + n;
export const DEFAULT_LINKS = {
  15: [R('Mariam Coffee Double')], 703: [R('Mariam Coffee Double')],
  13: [R('Mariam Coffee Single')],
  19: [R('Turkish Tea')], 171: [R('Turkish Tea')],
  33: [R('Iced Café Latte')], 803: [R('Iced Café Latte')], 804: [R('Iced Café Latte')],
  7: [R('Café Latte')], 718: [R('Café Latte')], 719: [R('Café Latte')],
  35: [R('Soda Mojito')], 819: [R('Soda Mojito')], 820: [R('Soda Mojito')],
  163: [R('Iced Americano')], 801: [R('Iced Americano')], 802: [R('Iced Americano')],
  3: [R('Double Espresso')], 710: [R('Double Espresso')],
  2: [R('Single Espresso')], 709: [R('Single Espresso')], 107: [R('Single Espresso')],
  10: [R('Flat White')], 714: [R('Flat White')], 715: [R('Flat White')],
  11: [R('Americano')], 705: [R('Americano')], 706: [R('Americano')],
  209: [R('TIRAMISU')],
  147: [R('Mango Juice')], 830: [R('Mango Juice')],
  16: [R('Turkish Coffee Double')], 14: [R('Turkish Coffee Single')],
  6: [R('Cappuccino')], 716: [R('Cappuccino')], 717: [R('Cappuccino')],
  32: [R('Iced Dark Cafe Mocha')], 807: [R('Iced Dark Cafe Mocha')], 808: [R('Iced Dark Cafe Mocha')],
  125: [R('BROWNIES')],
  18: [R('Filtered Coffee')], 707: [R('Filtered Coffee')], 708: [R('Filtered Coffee')],
  17: [R('Dark Mocha')], 722: [R('Dark Mocha')], 723: [R('Dark Mocha')],
  139: [R('BLUEBERRY CHEESECAKE')],
  5: [R('Cortado')], 713: [R('Cortado')],
  45: [R('SAN SEBASTIAN')],
  26: [R('Frappe')], 811: [R('Frappe')], 812: [R('Frappe')],
  814: [R('Frappe'), I('FO Syrup (Any Flavor) 40ml')],
  27: [R('Frappe'), I('FO Caramel Sauce 40gr')],
  112: [R('Sahlep (Plain)')], 729: [R('Sahlep (Plain)')],
  140: [R('COOKIES')],
  12: [R('Hot Chocolate (Premium)')], 726: [R('Hot Chocolate (Premium)')], 727: [R('Hot Chocolate (Premium)')],
  29: [R('Italian Soda')],
  28: [R('Standard Milkshake')], 817: [R('Standard Milkshake')], 818: [R('Standard Milkshake')],
  141: [R('APPLE CINNAMON CAKE')],
  203: [R('Karak Tea')], 202: [R('Karak Tea')], 864: [R('Karak Tea')], 730: [R('Karak Tea')],
  146: [R('Guava Juice')],
  621: [R('DATES CAKE')],
  4: [R('Espresso Macchiato')], 712: [R('Espresso Macchiato')],
  866: [R('BROWNIES'), R('Turkish Tea')],
  867: [R('COOKIES'), R('Turkish Tea')],
  167: [R('Caramel Latte')], 725: [R('Caramel Latte')],
  168: [R('Iced Caramel Latte')], 810: [R('Iced Caramel Latte')],
  42: [R('Fresh Lemonade')],
  173: [R('Iced Filtered Coffee')],
  193: [R('CHEESECAKE LOTUS - CUP')], 902: [R('CHEESECAKE MANGO - CUP')],
  34: [R('Smoothie')], 824: [R('Smoothie')],
  172: [R('Mastic Dibek Turkish Coffee')],
  31: [R('Sparkling Boba')], 826: [R('Sparkling Boba')],
  36: [R('Boba Milk Tea / Latte')],
  191: [R('CHOCOLATE CAKE with Almond')],
  176: [R('Strawberry Juice')], 832: [R('Strawberry Juice')],
  68: [R('Iced Matcha Latte')], 50: [R('Matcha Latte')],
  721: [R('Café Latte + Syrup')], 720: [R('Café Latte + Syrup')],
  8: [R('Café Latte + Syrup')], 873: [R('Café Latte + Syrup')], 9: [R('Café Latte + Syrup')],
  805: [R('Iced Latte + Syrup')], 806: [R('Iced Latte + Syrup')],
  199: [R('Cold Brew')],
  30: [R('Iced Turkish Coffee')],
  903: [R('LIMON CAKE')],
  164: [R('Single Espresso'), I('Vanilla Ice Cream 50gr')],
  40: [I('Fresh Peppermint (Nane) 1portion')],
  115: [I('FO Syrup (Any Flavor) 40ml')],
  120: [I('FO Dark Choc Sauce 40gr')],
  108: [I('Milk 150ml')],
  839: [I('Red Bull 250ml')],
};

// Costs (TL) for items the sheet does not cover, given by the owner.
export const DEFAULT_MANUAL = {
  54: 8.25, // WATER SMALL
  55: 189.5, // MARIAM CARDAMOM 250G
  61: 10, 503: 10, 504: 10, 506: 10, 507: 10, // other cardamom packs
  508: 40, // trendyol 1 kilo cardamom = 4 packs
};
// earlier built-in values: replaced by the new ones unless the owner changed them
const PREVIOUS_DEFAULTS = { 54: [6], 55: [10] };
const DEFAULTS_VERSION = 3;

/** Build a cost config from a parsed workbook, keeping the owner's manual costs and edited links. */
export function makeCostConfig(parsed, previous) {
  return withDefaults({
    // a new sheet replaces the sheet items; items the owner added in the app are kept
    recipes: [
      ...parsed.recipes.map(({ id, name, type, cost, price }) => ({ id, name, type, cost, price })),
      ...(previous?.recipes || []).filter((r) => r.custom && !parsed.recipes.some((p) => p.id === r.id)),
    ],
    ingredients: [
      ...parsed.ingredients,
      ...(previous?.ingredients || []).filter((r) => r.custom && !parsed.ingredients.some((p) => p.id === r.id)),
    ],
    links: previous?.links ? { ...DEFAULT_LINKS, ...previous.links } : { ...DEFAULT_LINKS },
    manual: previous?.manual ? { ...previous.manual } : {},
    defaultsVersion: previous?.defaultsVersion,
    sheetName: parsed.sheetName,
    updatedAt: new Date().toISOString(),
  });
}

/** Add/refresh the built-in manual costs in an older config (never overrides a cost the owner typed). */
export function withDefaults(cfg) {
  if (!cfg || (cfg.defaultsVersion || 0) >= DEFAULTS_VERSION) return cfg;
  const manual = { ...DEFAULT_MANUAL, ...(cfg.manual || {}) };
  for (const [item, olds] of Object.entries(PREVIOUS_DEFAULTS)) {
    if (olds.includes(Number(manual[item]))) manual[item] = DEFAULT_MANUAL[item];
  }
  return { ...cfg, manual, defaultsVersion: DEFAULTS_VERSION };
}

/** itemNo -> { cost, via: 'manual' | 'sheet', label, type } for items with a known cost. */
export function unitCosts(cfg) {
  const out = new Map();
  if (!cfg) return out;
  const src = new Map([...cfg.recipes, ...cfg.ingredients].map((s) => [s.id, s]));
  for (const [item, ids] of Object.entries(cfg.links || {})) {
    const parts = (ids || []).map((id) => src.get(id));
    if (!parts.length || parts.some((p) => !p)) continue;
    const recipe = parts.find((p) => p.id.startsWith('r:'));
    out.set(Number(item), {
      cost: parts.reduce((s, p) => s + p.cost, 0),
      via: 'sheet',
      label: parts.map((p) => p.name).join(' + '),
      type: recipe?.type || 'ADD-ON',
    });
  }
  for (const [item, c] of Object.entries(cfg.manual || {})) {
    if (c === '' || c == null || !Number.isFinite(Number(c))) continue;
    const prev = out.get(Number(item));
    out.set(Number(item), { cost: Number(c), via: 'manual', label: 'Entered manually', type: prev?.type || 'OTHER' });
  }
  return out;
}

/**
 * Put `cost` on every sold line (null when unknown) and cogs/profit/costed sales on every invoice.
 * Returns coverage figures for all loaded data.
 */
export function applyCosts(invoiceSets, cfg) {
  const uc = unitCosts(cfg);
  const seen = new Set();
  let sales = 0, costedSales = 0;
  for (const list of invoiceSets) {
    for (const inv of list) {
      if (seen.has(inv)) continue;
      seen.add(inv);
      let cogs = 0, costedNet = 0, costedGross = 0;
      for (const l of inv.lines) {
        const u = uc.get(l.item);
        l.cost = u ? Math.round(u.cost * l.qty * 100) / 100 : null;
        if (l.cost != null) { cogs += l.cost; costedNet += l.net; costedGross += l.gross; }
      }
      inv.cogs = cogs;
      inv.costedNet = costedNet;
      inv.costedGross = costedGross;
      inv.profit = costedNet - cogs;
      sales += inv.net;
      costedSales += costedNet;
    }
  }
  return { coverage: sales ? costedSales / sales : 0, items: uc.size };
}
