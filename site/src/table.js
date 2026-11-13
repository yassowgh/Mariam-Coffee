// The page behind the QR code on the tables (mariamcoffeeshop.com/t/): menu (on this page), Google review, Instagram.
import '@fontsource/el-messiri/latin-700.css';
import '@fontsource/el-messiri/arabic-700.css';
import '@fontsource/el-messiri/arabic-400.css';
import '@fontsource/montserrat/latin-400.css';
import '@fontsource/montserrat/latin-600.css';
import '@fontsource/montserrat/latin-ext-400.css';
import '@fontsource/montserrat/latin-ext-600.css';
import './table.css';
import { applyLinks, content, pickLang, saveLang, txt } from './content.js';
import { createMenu } from './menuview.js';

applyLinks();
let lang = pickLang();
const menu = createMenu({ tabsEl: document.getElementById('tabs'), listEl: document.getElementById('menu-list'), getLang: () => lang });
const home = document.getElementById('home');
const view = document.getElementById('menu-view');

// the owner's photos (Settings → Website)
if (content.images?.tableLogo) document.querySelector('.tbl-logo').src = content.images.tableLogo;
if (content.images?.tableBg) document.body.style.setProperty('--tbl-bg', `url("${content.images.tableBg}")`), document.body.classList.add('has-bg');

function apply() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-t]').forEach((el) => { const v = txt(el.dataset.t, lang); if (v) el.textContent = v; });
  document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  menu.render();
}

// the menu opens on this page; the phone's back button closes it
function show() {
  const open = location.hash === '#menu';
  view.hidden = !open;
  home.hidden = open;
  window.scrollTo(0, 0);
  if (open) view.querySelector('.tbl-back').focus({ preventScroll: true });
}
document.getElementById('menu-back').addEventListener('click', () => {
  if (location.hash === '#menu') history.back(); else show();
});
window.addEventListener('hashchange', show);

apply();
show();
document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => {
  lang = b.dataset.lang;
  saveLang(lang);
  apply();
}));
