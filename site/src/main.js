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
import { applyLinks, content, image, langPath, pickLang, saveLang, txt } from './content.js';
import { createMenu } from './menuview.js';
import { ART } from './art.js';

applyLinks();
let lang = pickLang();
const tr = (k) => txt(k, lang);
const menu = createMenu({ tabsEl: document.getElementById('tabs'), listEl: document.getElementById('menu-list'), getLang: () => lang, searchEl: document.getElementById('menu-q') });

function applyLang() {
  const html = document.documentElement;
  html.lang = lang;
  html.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-t]').forEach((el) => { const v = tr(el.dataset.t); if (v) el.textContent = v; });
  document.querySelectorAll('[data-t-alt]').forEach((el) => { const v = tr(el.dataset.tAlt); if (v) { el.alt = v; if (el.parentElement.matches('button')) el.parentElement.setAttribute('aria-label', v); } });
  document.querySelectorAll('[data-t-ph]').forEach((el) => { const v = tr(el.dataset.tPh); if (v) { el.placeholder = v; el.setAttribute('aria-label', v); } });
  document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-current', String(b.dataset.lang === lang)));
  document.title = tr('seo.title') || document.title;
  document.querySelector('meta[name="description"]')?.setAttribute('content', tr('seo.desc'));
  menu.render();
}

// ---- the owner's photos (Settings → Website) replace the built-in ones
function setImg(img, src) {
  if (!img || !src) return;
  const pic = img.closest('picture');
  if (pic) pic.querySelectorAll('source').forEach((s) => s.remove());
  img.removeAttribute('srcset');
  img.src = src;
}
setImg(document.querySelector('.hero-img'), content.images?.hero);
setImg(document.querySelector('.about-photo'), content.images?.about);
setImg(document.querySelector('#map > img'), content.images?.visit);
['sig1', 'sig2', 'sig3'].forEach((k, i) => {
  const src = image(k, null);
  const art = document.querySelectorAll('.sig-card .art')[i];
  if (src && art) { art.removeAttribute('data-art'); art.classList.add('art-photo'); art.innerHTML = `<img src="${src}" alt="" loading="lazy" decoding="async" />`; }
});
if (Array.isArray(content.gallery) && content.gallery.length) {
  const grid = document.querySelector('.g-grid');
  const n = content.gallery.length;
  grid.innerHTML = '';
  content.gallery.forEach((g, i) => {
    const fig = document.createElement('figure');
    let cls = 'g-item';
    if (i === 0) cls += ' g-big';
    if (i === n - 1 && n > 3 && (n - 3) % 3 === 2) cls += ' g-wide';
    if (i === n - 1 && n > 3 && (n - 3) % 3 === 1) cls += ' g-full';
    if (i === n - 1 && i > 0 && (n - 1) % 2 === 1) cls += ' g-wide-m';
    fig.className = cls;
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'g-open'; btn.dataset.full = g.full || g.src;
    const im = document.createElement('img');
    im.src = g.src; im.loading = 'lazy'; im.decoding = 'async'; im.width = 640; im.height = 360;
    btn.appendChild(im);
    const cap = document.createElement('figcaption');
    cap.dataset.t = 'gallery.' + i;
    fig.append(btn, cap);
    grid.appendChild(fig);
  });
}
function galleryCaptions() {
  if (!Array.isArray(content.gallery)) return;
  document.querySelectorAll('.g-grid figure').forEach((fig, i) => {
    const c = content.gallery[i]?.caption || [];
    const v = c[{ en: 0, ar: 1, tr: 2 }[lang]] || c[0] || '';
    fig.querySelector('figcaption').textContent = v;
    fig.querySelector('figcaption').hidden = !v;
    const im = fig.querySelector('img'); im.alt = v;
    fig.querySelector('button').setAttribute('aria-label', v || 'Photo');
  });
}

document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', (e) => {
  // each language has its own address (/, /ar/, /tr/); switch in place without reloading
  e.preventDefault();
  lang = b.dataset.lang;
  saveLang(lang);
  try { history.pushState({ lang }, '', langPath(lang) + location.hash); } catch { location.href = langPath(lang); return; }
  applyLang();
  galleryCaptions();
  loadReviews();
}));
window.addEventListener('popstate', () => { lang = pickLang(); applyLang(); galleryCaptions(); loadReviews(); });
document.querySelectorAll('[data-art]').forEach((el) => { el.innerHTML = ART[el.dataset.art]; });
document.getElementById('year').textContent = String(new Date().getFullYear());

// header turns solid after the hero
const top = document.getElementById('top');
const onScroll = () => top.classList.toggle('solid', window.scrollY > 40);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

applyLang();
galleryCaptions();
setupLightbox();

// The Google map (heavy) loads by itself when the visitor gets close to "Visit us".
(() => {
  const box = document.getElementById('map');
  if (!box) return;
  const load = () => { box.innerHTML = '<iframe title="Map: Mariam Coffee" src="https://www.google.com/maps?q=41.1236348,28.7777111&amp;z=16&amp;output=embed" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>'; };
  if (!('IntersectionObserver' in window)) { load(); return; }
  const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { io.disconnect(); load(); } }, { rootMargin: '400px 0px' });
  io.observe(box);
})();

// Google reviews (5-star, newest first), read on the server from Google; hidden when none.
function stars(n) { return '★★★★★'.slice(0, Math.round(n)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(n)); }
async function loadReviews() {
  const sec = document.getElementById('reviews');
  if (!sec) return;
  try {
    const r = await fetch('/api/reviews?lang=' + lang).then((x) => (x.ok ? x.json() : null));
    if (!r || !r.reviews || !r.reviews.length) { sec.hidden = true; return; }
    document.getElementById('rev-rating').textContent = r.rating ? r.rating.toFixed(1) : '';
    document.getElementById('rev-stars').textContent = r.rating ? stars(r.rating) : '';
    document.getElementById('rev-count').textContent = r.count ? r.count.toLocaleString('en-US') : '';
    const all = document.getElementById('rev-all');
    if (r.url) all.href = r.url; else all.remove();
    const list = document.getElementById('rev-list');
    list.innerHTML = '';
    for (const v of r.reviews) {
      const fig = document.createElement('figure'); fig.className = 'rev';
      const q = document.createElement('blockquote'); q.textContent = v.text; q.dir = 'auto';
      const cap = document.createElement('figcaption');
      if (v.photo) { const im = document.createElement('img'); im.src = v.photo; im.alt = ''; im.loading = 'lazy'; im.referrerPolicy = 'no-referrer'; cap.appendChild(im); }
      const who = document.createElement(v.profile ? 'a' : 'span');
      if (v.profile) { who.href = v.profile; who.target = '_blank'; who.rel = 'noopener'; }
      const b = document.createElement('b'); b.textContent = v.author; who.appendChild(b);
      const when = document.createElement('span'); when.textContent = `${'★★★★★'} · ${v.when || ''}`; who.appendChild(when);
      cap.appendChild(who);
      fig.append(q, cap);
      list.appendChild(fig);
    }
    sec.hidden = false;
  } catch { sec.hidden = true; }
}
loadReviews();

// Full-screen photo viewer: arrows, swipe, Esc, click outside to close.
function setupLightbox() {
  const box = document.getElementById('lightbox');
  if (!box) return;
  const items = [...document.querySelectorAll('.g-open')];
  const img = box.querySelector('img');
  const cap = box.querySelector('figcaption');
  let at = 0;
  let back = null;
  const show = (i) => {
    at = (i + items.length) % items.length;
    const b = items[at];
    img.src = b.dataset.full;
    img.alt = b.querySelector('img').alt;
    cap.textContent = b.parentElement.querySelector('figcaption').textContent;
    const next = items[(at + 1) % items.length];
    const pre = new Image(); pre.src = next.dataset.full; // preload the next one
  };
  const open = (i) => { back = document.activeElement; show(i); box.hidden = false; document.body.classList.add('lb-on'); box.querySelector('.lb-close').focus(); };
  const close = () => { box.hidden = true; img.removeAttribute('src'); document.body.classList.remove('lb-on'); if (back) back.focus(); };
  items.forEach((b, i) => b.addEventListener('click', () => open(i)));
  const rtl = () => document.documentElement.dir === 'rtl';
  box.querySelector('.lb-close').addEventListener('click', close);
  box.querySelector('.lb-prev').addEventListener('click', () => show(at + (rtl() ? 1 : -1)));
  box.querySelector('.lb-next').addEventListener('click', () => show(at + (rtl() ? -1 : 1)));
  box.addEventListener('click', (e) => { if (e.target === box) close(); });
  document.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') show(at + (rtl() ? 1 : -1));
    else if (e.key === 'ArrowRight') show(at + (rtl() ? -1 : 1));
  });
  let x0 = null;
  box.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  box.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 50) show(at + ((dx < 0) !== rtl() ? 1 : -1));
  });
}
