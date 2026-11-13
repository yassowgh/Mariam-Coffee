// The menu (section tabs + list with prices and optional photos), shared by the website and the table page.
import { ART } from './art.js';
import { LI, menuData, txt } from './content.js';

const EXTRA_CATS = ['coffee', 'turkish', 'iced', 'fresh'];

export function createMenu({ tabsEl, listEl, getLang }) {
  let live = null; // { [itemNo]: { p, a } } from the POS
  let current = null;
  const nm = (arr) => (arr ? arr[LI[getLang()]] || arr[0] : '');
  const isPos = (x) => typeof x.id === 'number' || /^\d+$/.test(String(x.id));
  const shown = (x) => {
    if (x.hidden) return false;
    if (!isPos(x) || !live || !Object.keys(live).length) return true;
    const l = live[x.id];
    return !!l && l.a !== false;
  };
  const price = (x) => {
    const l = isPos(x) && live ? live[x.id] : null;
    const v = l ? l.p : Number(x.p);
    if (!Number.isFinite(v) || v <= 0) return '';
    return `${new Intl.NumberFormat(getLang() === 'tr' ? 'tr-TR' : 'en-GB', { maximumFractionDigits: 2 }).format(v)} TL`;
  };

  function row(x) {
    const li = document.createElement('li');
    li.className = 'item' + (x.img ? ' has-img' : '');
    if (x.img) {
      const im = document.createElement('img');
      im.src = x.img; im.alt = ''; im.loading = 'lazy'; im.decoding = 'async'; im.width = 64; im.height = 64; im.className = 'item-img';
      li.appendChild(im);
    }
    const name = document.createElement('div');
    name.className = 'item-name';
    const t = document.createElement('span');
    t.textContent = nm(x.name);
    name.appendChild(t);
    if (x.d && nm(x.d)) { const d = document.createElement('small'); d.textContent = nm(x.d); name.appendChild(d); }
    const dots = document.createElement('span'); dots.className = 'dots';
    const p = document.createElement('span'); p.className = 'price num'; p.textContent = price(x);
    li.append(name, dots, p);
    return li;
  }

  function render() {
    const { categories, items, extras } = menuData();
    const cats = categories.filter((c) => !c.hidden && items.some((x) => x.cat === c.id && shown(x)));
    if (!cats.length) { tabsEl.innerHTML = ''; listEl.innerHTML = ''; return; }
    if (!cats.some((c) => c.id === current)) current = cats[0].id;
    tabsEl.innerHTML = '';
    for (const c of cats) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(c.id === current));
      b.className = 'tab';
      b.innerHTML = `<span class="tab-ic">${ART[c.icon] || ART.cup}</span><span></span>`;
      b.lastChild.textContent = nm(c.name);
      b.addEventListener('click', () => { current = c.id; render(); });
      tabsEl.appendChild(b);
    }
    const cat = cats.find((c) => c.id === current);
    listEl.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.setAttribute('role', 'tabpanel');
    const head = document.createElement('div');
    head.className = 'panel-head';
    head.innerHTML = `<span class="panel-ic">${ART[cat.icon] || ART.cup}</span><h3></h3>`;
    head.querySelector('h3').textContent = nm(cat.name);
    const ul = document.createElement('ul');
    ul.className = 'items';
    items.filter((x) => x.cat === current && shown(x)).forEach((x) => ul.appendChild(row(x)));
    panel.append(head, ul);
    if (cat.extras ?? EXTRA_CATS.includes(cat.id)) {
      const ex = extras.filter(shown);
      if (ex.length) {
        const h = document.createElement('h4'); h.className = 'extras-h'; h.textContent = txt('menu.extras', getLang());
        const u = document.createElement('ul'); u.className = 'items extras';
        ex.forEach((x) => u.appendChild(row(x)));
        panel.append(h, u);
      }
    }
    listEl.appendChild(panel);
  }

  fetch('/api/menu').then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (d && d.prices && Object.keys(d.prices).length) { live = d.prices; render(); }
  }).catch(() => { /* keep the built-in prices */ });

  return { render };
}
