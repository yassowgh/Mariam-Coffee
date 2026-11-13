// The owner's edits (texts, menu, photos) come inside the page as <script id="mc-content">;
// anything not edited falls back to the built-in defaults in text.js / menu.js.
import { CATEGORIES, EXTRAS, ITEMS } from './menu.js';
import { LANGS, T } from './text.js';

let C = {};
try { C = JSON.parse(document.getElementById('mc-content')?.textContent || '{}') || {}; } catch { C = {}; }
export const content = C;
export const LI = { en: 0, ar: 1, tr: 2 };

/** A page text in the language, the owner's version first. */
export function txt(key, lang) {
  const i = LI[lang] ?? 0;
  const o = C.text?.[key];
  const d = T[key];
  return (o && o[i]) || (d && d[i]) || (o && o[0]) || (d && d[0]) || '';
}

/** The menu: the owner's edited menu, or the built-in one. */
export function menuData() {
  const m = C.menu;
  if (m && Array.isArray(m.items) && Array.isArray(m.categories)) return { categories: m.categories, items: m.items, extras: m.extras || [] };
  return { categories: CATEGORIES, items: ITEMS, extras: EXTRAS };
}

/** A photo slot (hero, about, visit, sig1…, tableLogo, tableBg): the owner's photo or the default. */
export const image = (slot, def) => C.images?.[slot] || def;

export function pickLang() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q && LANGS[q]) return q;
  try { const s = localStorage.getItem('mc-lang'); if (s && LANGS[s]) return s; } catch { /* private mode */ }
  const n = (navigator.languages || [navigator.language || 'en']).map((x) => String(x).slice(0, 2).toLowerCase());
  return n.find((x) => LANGS[x]) || 'en';
}
export function saveLang(lang) { try { localStorage.setItem('mc-lang', lang); } catch { /* ignore */ } }
