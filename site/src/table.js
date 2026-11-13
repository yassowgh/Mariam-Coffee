// The page behind the QR code on the tables (mariamcoffeeshop.com/t): menu, Google review, Instagram.
import '@fontsource/el-messiri/latin-700.css';
import '@fontsource/el-messiri/arabic-700.css';
import '@fontsource/el-messiri/arabic-400.css';
import '@fontsource/montserrat/latin-400.css';
import '@fontsource/montserrat/latin-600.css';
import '@fontsource/montserrat/latin-ext-400.css';
import '@fontsource/montserrat/latin-ext-600.css';
import './table.css';

const T = {
  'tbl.title': ['Welcome to Mariam', 'أهلاً بك في مريم', "Mariam'a hoş geldiniz"],
  'tbl.sub': ['Enjoy your coffee. What would you like to do?', 'استمتع بقهوتك. ماذا تودّ أن تفعل؟', 'Kahvenizin tadını çıkarın. Ne yapmak istersiniz?'],
  'tbl.menu': ['See the menu', 'تصفّح القائمة', 'Menüyü gör'],
  'tbl.menu.s': ['Drinks, desserts and prices', 'المشروبات والحلويات والأسعار', 'İçecekler, tatlılar ve fiyatlar'],
  'tbl.google': ['Review us on Google', 'قيّمنا على Google', "Google'da bizi değerlendirin"],
  'tbl.insta': ['Follow us on Instagram', 'تابعنا على إنستغرام', "Instagram'da bizi takip edin"],
  'tbl.site': ['mariamcoffeeshop.com', 'mariamcoffeeshop.com', 'mariamcoffeeshop.com'],
};
const LI = { en: 0, ar: 1, tr: 2 };

function pick() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q && q in LI) return q;
  try { const s = localStorage.getItem('mc-lang'); if (s && s in LI) return s; } catch { /* private mode */ }
  const n = (navigator.languages || [navigator.language || 'en']).map((x) => String(x).slice(0, 2).toLowerCase());
  return n.find((x) => x in LI) || 'en';
}

function apply(lang) {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = T[el.dataset.t][LI[lang]]; });
  document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  // the menu opens in the same language
  document.getElementById('menu-link').href = `/?lang=${lang}#menu`;
}

let lang = pick();
apply(lang);
document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => {
  lang = b.dataset.lang;
  try { localStorage.setItem('mc-lang', lang); } catch { /* ignore */ }
  apply(lang);
}));
