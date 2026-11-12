import '@fontsource/el-messiri/latin-500.css';
import '@fontsource/el-messiri/latin-700.css';
import '@fontsource/el-messiri/latin-ext-700.css';
import '@fontsource/el-messiri/arabic-400.css';
import '@fontsource/el-messiri/arabic-600.css';
import '@fontsource/el-messiri/arabic-700.css';
import '@fontsource/montserrat/latin-400.css';
import '@fontsource/montserrat/latin-ext-400.css';
import '@fontsource/montserrat/latin-600.css';
import '@fontsource/montserrat/latin-ext-600.css';
import './style.css';
import { CATEGORIES, EXTRAS, ITEMS } from './menu.js';
import { LANGS, T } from './text.js';
import { ART } from './art.js';

const LI = { en: 0, ar: 1, tr: 2 };
let lang = pickLang();
let live = null; // { [itemNo]: { p, a } } from the POS
let current = 'coffee';

function pickLang() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q && LANGS[q]) return q;
  try { const s = localStorage.getItem('mc-lang'); if (s && LANGS[s]) return s; } catch { /* private mode */ }
  const n = (navigator.languages || [navigator.language || 'en']).map((x) => String(x).slice(0, 2).toLowerCase());
  return n.find((x) => LANGS[x]) || 'en';
}

const tr = (k) => (T[k] ? T[k][LI[lang]] || T[k][0] : '');
const nm = (arr) => (arr ? arr[LI[lang]] || arr[0] : '');

function price(item) {
  const l = live && live[item.id];
  const v = l ? l.p : item.p;
  return `${new Intl.NumberFormat(lang === 'tr' ? 'tr-TR' : 'en-GB', { maximumFractionDigits: 2 }).format(v)} TL`;
}
const shown = (item) => !(live && live[item.id] && live[item.id].a === false) && !(live && Object.keys(live).length && !live[item.id]);

function applyLang() {
  const html = document.documentElement;
  html.lang = lang;
  html.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-t]').forEach((el) => { const v = tr(el.dataset.t); if (v) el.textContent = v; });
  document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  renderMenu();
}

function renderTabs() {
  const tabs = document.getElementById('tabs');
  tabs.innerHTML = '';
  for (const c of CATEGORIES) {
    if (!ITEMS.some((x) => x.cat === c.id && shown(x))) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(c.id === current));
    b.className = 'tab';
    b.innerHTML = `<span class="tab-ic">${ART[c.icon]}</span><span></span>`;
    b.lastChild.textContent = nm(c.name);
    b.addEventListener('click', () => { current = c.id; renderMenu(); });
    tabs.appendChild(b);
  }
}

function itemRow(x) {
  const li = document.createElement('li');
  li.className = 'item';
  const name = document.createElement('div');
  name.className = 'item-name';
  const t = document.createElement('span');
  t.textContent = nm(x.name);
  name.appendChild(t);
  if (x.d) { const d = document.createElement('small'); d.textContent = nm(x.d); name.appendChild(d); }
  const dots = document.createElement('span'); dots.className = 'dots';
  const p = document.createElement('span'); p.className = 'price num'; p.textContent = price(x);
  li.append(name, dots, p);
  return li;
}

function renderMenu() {
  renderTabs();
  const box = document.getElementById('menu-list');
  box.innerHTML = '';
  const cat = CATEGORIES.find((c) => c.id === current);
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('role', 'tabpanel');
  const head = document.createElement('div');
  head.className = 'panel-head';
  head.innerHTML = `<span class="panel-ic">${ART[cat.icon]}</span><h3></h3>`;
  head.querySelector('h3').textContent = nm(cat.name);
  const ul = document.createElement('ul');
  ul.className = 'items';
  ITEMS.filter((x) => x.cat === current && shown(x)).forEach((x) => ul.appendChild(itemRow(x)));
  panel.append(head, ul);
  if (['coffee', 'turkish', 'iced', 'fresh'].includes(current)) {
    const ex = EXTRAS.filter(shown);
    if (ex.length) {
      const h = document.createElement('h4'); h.className = 'extras-h'; h.textContent = tr('menu.extras');
      const u = document.createElement('ul'); u.className = 'items extras';
      ex.forEach((x) => u.appendChild(itemRow(x)));
      panel.append(h, u);
    }
  }
  box.appendChild(panel);
}

document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => {
  lang = b.dataset.lang;
  try { localStorage.setItem('mc-lang', lang); } catch { /* ignore */ }
  applyLang();
}));
document.querySelectorAll('[data-art]').forEach((el) => { el.innerHTML = ART[el.dataset.art]; });
document.getElementById('year').textContent = String(new Date().getFullYear());

// header turns solid after the hero
const top = document.getElementById('top');
const onScroll = () => top.classList.toggle('solid', window.scrollY > 40);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

applyLang();

fetch('/api/menu').then((r) => (r.ok ? r.json() : null)).then((d) => {
  if (d && d.prices && Object.keys(d.prices).length) { live = d.prices; renderMenu(); }
}).catch(() => { /* keep the built-in prices */ });
