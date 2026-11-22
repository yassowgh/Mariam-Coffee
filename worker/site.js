// The public website (mariamcoffeeshop.com) for search engines and AI assistants:
// - every language has its own address (/ English, /ar/ Arabic, /tr/ Turkish), built fully on the server:
//   texts, the whole menu with prices, and structured data (schema.org), so crawlers that do not run
//   JavaScript see the same page as visitors
// - /llms.txt and /llms-full.txt (plain-text summary and full menu for AI assistants), robots.txt, sitemap.xml
// - /api/reviews: the café's latest 5-star Google reviews (Google Places API, key set by the owner)
// - best sellers from the till, shown as badges on the menu
import { CATEGORIES, EXTRAS, ITEMS } from '../site/src/menu.js';
import { T } from '../site/src/text.js';
import { load as loadContent } from './content.js';
import { currentUser, isOwner } from './staff.js';

export const SITE = 'https://mariamcoffeeshop.com';
const LANGS = ['en', 'ar', 'tr'];
const LI = { en: 0, ar: 1, tr: 2 };
const PATH = { en: '/', ar: '/ar/', tr: '/tr/' };
const LOCALE = { en: 'en_GB', ar: 'ar_AR', tr: 'tr_TR' };
const PHONE = '+905551844115';
const PHONE_SHOW = '+90 555 184 41 15';
const GEO = { lat: 41.1236348, lng: 28.7777111 };
const INSTAGRAM = 'https://www.instagram.com/mariamcoffee.tr/';
const MAPS = 'https://www.google.com/maps?q=41.1236348,28.7777111';
const ADDRESS = { streetAddress: 'Park Mavera, Veysel Karani Cad. D:4, A2/28', addressLocality: 'Başakşehir', addressRegion: 'İstanbul', postalCode: '34494', addressCountry: 'TR' };
const AMENITIES = ['Free Wi-Fi', 'Power outlets (laptop-friendly)', 'Outdoor seating', 'Family-friendly'];
const FAQ_N = 6;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });

/** The page language of an address, or null when it is not a website page. */
export function siteLang(pathname) {
  if (pathname === '/' || pathname === '/index.html') return 'en';
  const m = /^\/(ar|tr)\/(index\.html)?$/.exec(pathname);
  return m ? m[1] : null;
}

function txtOf(content) {
  return (key, lang) => {
    const i = LI[lang] ?? 0;
    const o = content.text?.[key];
    const d = T[key];
    return (o && o[i]) || (d && d[i]) || (o && o[0]) || (d && d[0]) || '';
  };
}

/** The menu as shown on the site: the owner's edited menu (or the built-in one), live till prices, best sellers. */
export async function siteMenu(env, content) {
  const m = content.menu && Array.isArray(content.menu.items) && Array.isArray(content.menu.categories)
    ? { categories: content.menu.categories, items: content.menu.items, extras: content.menu.extras || [] }
    : { categories: CATEGORIES, items: ITEMS, extras: EXTRAS };
  const cache = (env.DATA && (await env.DATA.get('menu-prices-v2', 'json'))) || {};
  const live = cache.prices && Object.keys(cache.prices).length ? cache.prices : null;
  const isPos = (x) => typeof x.id === 'number' || /^\d+$/.test(String(x.id));
  const shown = (x) => !x.hidden && (!isPos(x) || !live || (live[x.id] && live[x.id].a !== false));
  const price = (x) => { const l = isPos(x) && live ? live[x.id] : null; const v = l ? Number(l.p) : Number(x.p); return Number.isFinite(v) && v > 0 ? v : null; };
  const items = m.items.filter(shown).map((x) => ({ ...x, price: price(x) }));
  const cats = m.categories.filter((c) => !c.hidden && items.some((x) => x.cat === c.id));
  // best sellers: the till's top items that are on the website menu (at most 8)
  const bs = (env.DATA && (await env.DATA.get('best-sellers', 'json'))) || {};
  const onMenu = new Set(items.map((x) => Number(x.id)));
  const best = (bs.items || []).map(Number).filter((id) => onMenu.has(id)).slice(0, 8);
  return { cats, items, extras: m.extras.filter(shown).map((x) => ({ ...x, price: price(x) })), best, pricesAt: cache.uploadedAt || null };
}

const money = (v, lang) => (v == null ? '' : `${new Intl.NumberFormat(lang === 'tr' ? 'tr-TR' : 'en-GB', { maximumFractionDigits: 2 }).format(v)} TL`);

function menuHtml(menu, lang, txt) {
  const nm = (a) => (a ? a[LI[lang]] || a[0] : '');
  const best = new Set(menu.best);
  const row = (x) => {
    const badges = (best.has(Number(x.id)) ? ` <em class="badge best">${esc(txt('badge.best', lang))}</em>` : '') + (x.special ? ` <em class="badge special">${esc(txt('badge.special', lang))}</em>` : '');
    const d = nm(x.d) ? ` <small>${esc(nm(x.d))}</small>` : '';
    const al = Array.isArray(x.al) && x.al.length ? ` <small class="allergens">${esc(txt('al.title', lang))}: ${esc(x.al.map((k) => txt('al.' + k, lang)).join(', '))}</small>` : '';
    return `<li class="item"><div class="item-name"><span>${esc(nm(x.name))}${badges}</span>${d}${al}</div><span class="dots"></span><span class="price num">${esc(money(x.price, lang))}</span></li>`;
  };
  let out = '';
  for (const c of menu.cats) {
    out += `<section class="panel ssr-menu"><h3>${esc(nm(c.name))}</h3><ul class="items">${menu.items.filter((x) => x.cat === c.id).map(row).join('')}</ul></section>`;
  }
  if (menu.extras.length) out += `<section class="panel ssr-menu"><h3>${esc(txt('menu.extras', lang))}</h3><ul class="items extras">${menu.extras.map(row).join('')}</ul></section>`;
  return out;
}

/** schema.org data: the café (with address, hours, amenities and the full menu), the website and the FAQ. */
function structured(menu, lang, txt, content) {
  const nm = (a) => (a ? a[LI[lang]] || a[0] : '');
  const url = SITE + PATH[lang];
  const links = content.links || {};
  const cafe = {
    '@type': 'CafeOrCoffeeShop',
    '@id': SITE + '/#cafe',
    name: 'Mariam Coffee',
    alternateName: ['مقهى مريم', 'Mariam Coffee Başakşehir'],
    description: txt('seo.desc', lang),
    url,
    logo: SITE + '/brand/logo-stack.svg',
    image: [SITE + '/photos/front-1280.jpg', SITE + '/photos/mural-1280.jpg', SITE + '/photos/counter-1280.jpg', SITE + '/photos/lounge-1280.jpg'],
    telephone: PHONE,
    address: { '@type': 'PostalAddress', ...ADDRESS },
    geo: { '@type': 'GeoCoordinates', latitude: GEO.lat, longitude: GEO.lng },
    hasMap: MAPS,
    openingHoursSpecification: [{ '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], opens: '08:00', closes: '01:00' }],
    priceRange: '₺₺',
    currenciesAccepted: 'TRY',
    servesCuisine: ['Coffee', 'Turkish coffee', 'Tea', 'Desserts', 'Middle Eastern sweets'],
    amenityFeature: AMENITIES.map((n) => ({ '@type': 'LocationFeatureSpecification', name: n, value: true })),
    sameAs: [links.instagram || INSTAGRAM, links.google || 'https://g.page/r/CWSMLS5rSzlAEBE/review'],
    hasMenu: {
      '@type': 'Menu',
      name: `Mariam Coffee · ${txt('menu.title', lang)}`,
      url: url + '#menu',
      inLanguage: lang,
      hasMenuSection: menu.cats.map((c) => ({
        '@type': 'MenuSection',
        name: nm(c.name),
        hasMenuItem: menu.items.filter((x) => x.cat === c.id).map((x) => ({
          '@type': 'MenuItem',
          name: nm(x.name),
          ...(nm(x.d) ? { description: nm(x.d) } : {}),
          ...(x.price ? { offers: { '@type': 'Offer', price: String(x.price), priceCurrency: 'TRY' } } : {}),
        })),
      })),
    },
  };
  const site = { '@type': 'WebSite', '@id': SITE + '/#website', url: SITE + '/', name: 'Mariam Coffee', inLanguage: ['en', 'ar', 'tr'], publisher: { '@id': SITE + '/#cafe' } };
  const faq = {
    '@type': 'FAQPage',
    '@id': url + '#faq',
    inLanguage: lang,
    mainEntity: Array.from({ length: FAQ_N }, (_, i) => ({ '@type': 'Question', name: txt(`faq.${i + 1}.q`, lang), acceptedAnswer: { '@type': 'Answer', text: txt(`faq.${i + 1}.a`, lang) } })),
  };
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': [cafe, site, faq] }).replace(/</g, '\\u003c');
}

/** The website page in one language, with everything already in the HTML. */
export async function renderSite(page, env, lang) {
  const content = await loadContent(env);
  const txt = txtOf(content);
  const menu = await siteMenu(env, content);
  const url = SITE + PATH[lang];
  const data = JSON.stringify(content).replace(/</g, '\\u003c');
  const set = (sel, attr, val) => [sel, { element(el) { el.setAttribute(attr, val); } }];
  const handlers = [
    ['html', { element(el) { el.setAttribute('lang', lang); el.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr'); } }],
    ['title', { element(el) { el.setInnerContent(txt('seo.title', lang)); } }],
    set('meta[name="description"]', 'content', txt('seo.desc', lang)),
    set('meta[property="og:title"]', 'content', txt('seo.title', lang)),
    set('meta[property="og:description"]', 'content', txt('seo.desc', lang)),
    set('meta[property="og:url"]', 'content', url),
    set('meta[property="og:locale"]', 'content', LOCALE[lang]),
    set('meta[property="og:image:alt"]', 'content', txt('gal.front', lang)),
    set('link[rel="canonical"]', 'href', url),
    ['meta[property="og:locale:alternate"]', { element(el) { el.remove(); } }],
    ['head', { element(el) {
      el.append(LANGS.filter((l) => l !== lang).map((l) => `<meta property="og:locale:alternate" content="${LOCALE[l]}" />`).join(''), { html: true });
      el.append(`<script type="application/json" id="mc-content">${data}</script>`, { html: true });
    } }],
    ['[data-t]', { element(el) { const v = txt(el.getAttribute('data-t'), lang); if (v) el.setInnerContent(v); } }],
    ['[data-t-alt]', { element(el) { const v = txt(el.getAttribute('data-t-alt'), lang); if (v) el.setAttribute('alt', v); } }],
    ['[data-t-ph]', { element(el) { const v = txt(el.getAttribute('data-t-ph'), lang); if (v) { el.setAttribute('placeholder', v); el.setAttribute('aria-label', v); } } }],
    ['[data-lang]', { element(el) { el.setAttribute('aria-current', String(el.getAttribute('data-lang') === lang)); } }],
    ['[data-link]', { element(el) { const u = content.links?.[el.getAttribute('data-link')]; if (u) el.setAttribute('href', u); } }],
    ['#menu-list', { element(el) { el.setInnerContent(menuHtml(menu, lang, txt), { html: true }); } }],
    ['#ld-main', { element(el) { el.setInnerContent(structured(menu, lang, txt, content), { html: true }); } }],
  ];
  let rw = new HTMLRewriter();
  for (const [sel, h] of handlers) rw = rw.on(sel, h);
  const out = rw.transform(page);
  const r = new Response(out.body, out);
  r.headers.delete('etag');
  r.headers.set('cache-control', 'no-cache');
  r.headers.set('content-language', lang);
  r.headers.set('link', LANGS.map((l) => `<${SITE + PATH[l]}>; rel="alternate"; hreflang="${l}"`).concat(`<${SITE}/>; rel="alternate"; hreflang="x-default"`).join(', '));
  return r;
}

// ---------------------------------------------------------------- AI assistants and search engines

export async function llmsTxt(env, full) {
  const content = await loadContent(env);
  const txt = txtOf(content);
  const menu = await siteMenu(env, content);
  const L = [];
  L.push('# Mariam Coffee', '');
  L.push(`> Mariam Coffee (مقهى مريم) is a café in Park Mavera, Kayabaşı, Başakşehir, Istanbul, Türkiye, about 1 km (around 12 minutes on foot) from Kayaşehir Merkez metro station (M3 line). Open every day 08:00–01:00. Known for Turkish coffee with cardamom, stone-ground dibek coffee, karak tea, espresso drinks, San Sebastián cheesecake and date maamoul. Free Wi-Fi, power outlets, outdoor seating, family-friendly. The website is in English, Arabic and Turkish.`, '');
  L.push('## Key facts', '');
  L.push(`- Name: Mariam Coffee (Arabic: مقهى مريم)`);
  L.push(`- Type: café / coffee shop`);
  L.push(`- Address: Park Mavera, Veysel Karani Cad. D:4, A2/28, Kayabaşı, 34494 Başakşehir/İstanbul, Türkiye`);
  L.push(`- Area: Kayaşehir, Başakşehir (European side of Istanbul)`);
  L.push(`- Getting there: M3 metro to Kayaşehir Merkez (last stop), then about 1 km on foot`);
  L.push(`- Map: ${MAPS} (latitude ${GEO.lat}, longitude ${GEO.lng})`);
  L.push(`- Opening hours: every day 08:00–01:00 (open late)`);
  L.push(`- Phone: ${PHONE_SHOW}`);
  L.push(`- Amenities: ${AMENITIES.join(', ')}`);
  L.push(`- Prices: in Turkish lira (TL), including VAT; taken from the café's till and updated automatically`);
  L.push(`- Instagram: ${content.links?.instagram || INSTAGRAM}`);
  L.push(`- Google reviews: ${content.links?.google || 'https://g.page/r/CWSMLS5rSzlAEBE/review'}`, '');
  L.push('## Pages', '');
  L.push(`- [Mariam Coffee (English)](${SITE}/): menu with prices, about, photos, visit information, FAQ`);
  L.push(`- [مقهى مريم (العربية)](${SITE}/ar/): the same page in Arabic`);
  L.push(`- [Mariam Coffee (Türkçe)](${SITE}/tr/): the same page in Turkish`);
  L.push(`- [Full menu and details for AI assistants](${SITE}/llms-full.txt): every item with its current price, FAQ in three languages`, '');
  const nm = (a, l = 'en') => (a ? a[LI[l]] || a[0] : '');
  if (menu.best.length) {
    L.push('## Best sellers', '');
    for (const id of menu.best) { const x = menu.items.find((y) => Number(y.id) === id); if (x) L.push(`- ${nm(x.name)}${x.price ? `: ${money(x.price, 'en')}` : ''}`); }
    L.push('');
  }
  L.push('## Signature items', '');
  for (const k of ['sig.1', 'sig.2', 'sig.3']) L.push(`- ${txt(k + '.t', 'en')}: ${txt(k + '.d', 'en')}`);
  L.push('');
  if (!full) {
    L.push('## Menu sections', '');
    for (const c of menu.cats) L.push(`- ${nm(c.name)}: ${menu.items.filter((x) => x.cat === c.id).length} items`);
    L.push('', `Full menu with prices: ${SITE}/llms-full.txt`, '');
    L.push('## FAQ', '');
    for (let i = 1; i <= FAQ_N; i++) L.push(`- ${txt(`faq.${i}.q`, 'en')} ${txt(`faq.${i}.a`, 'en')}`);
    return L.join('\n') + '\n';
  }
  L.push(`## Full menu (prices in TL incl. VAT${menu.pricesAt ? `, from the till on ${menu.pricesAt.slice(0, 10)}` : ''})`, '');
  const line = (x) => `- ${nm(x.name)} (${nm(x.name, 'ar')} · ${nm(x.name, 'tr')})${nm(x.d) ? ` — ${nm(x.d)}` : ''}${x.price ? `: ${money(x.price, 'en')}` : ''}${menu.best.includes(Number(x.id)) ? ' [best seller]' : ''}${x.special ? ' [house specialty]' : ''}${Array.isArray(x.al) && x.al.length ? ` [contains: ${x.al.join(', ')}]` : ''}`;
  for (const c of menu.cats) {
    L.push(`### ${nm(c.name)} (${nm(c.name, 'ar')} · ${nm(c.name, 'tr')})`, '');
    for (const x of menu.items.filter((y) => y.cat === c.id)) L.push(line(x));
    L.push('');
  }
  if (menu.extras.length) { L.push('### Extras', ''); for (const x of menu.extras) L.push(line(x)); L.push(''); }
  L.push('## About', '');
  for (const l of LANGS) { L.push(txt('about.text', l), '', txt('about.more', l), ''); }
  L.push('## FAQ (English, العربية, Türkçe)', '');
  for (const l of LANGS) {
    for (let i = 1; i <= FAQ_N; i++) L.push(`- Q: ${txt(`faq.${i}.q`, l)}`, `  A: ${txt(`faq.${i}.a`, l)}`);
    L.push('');
  }
  return L.join('\n');
}

const AI_BOTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'anthropic-ai', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'Bingbot', 'meta-externalagent', 'CCBot', 'DuckAssistBot', 'YandexBot'];
export function robotsTxt() {
  const rules = ['Allow: /', 'Disallow: /management/', 'Disallow: /api/', 'Disallow: /t/', 'Allow: /api/menu'];
  const out = ['# Mariam Coffee: search engines and AI assistants are welcome.', '# A short summary for AI assistants: https://mariamcoffeeshop.com/llms.txt', ''];
  out.push('User-agent: *', ...rules, '');
  for (const b of AI_BOTS) out.push(`User-agent: ${b}`, ...rules, '');
  out.push(`Sitemap: ${SITE}/sitemap.xml`, '');
  return out.join('\n');
}

export async function sitemapXml(env) {
  const content = await loadContent(env);
  const prices = (env.DATA && (await env.DATA.get('menu-prices-v2', 'json'))) || {};
  const last = [content.updatedAt, prices.uploadedAt].filter(Boolean).sort().pop() || new Date().toISOString();
  const alts = LANGS.map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${SITE + PATH[l]}"/>`).join('') + `<xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/"/>`;
  const urls = LANGS.map((l) => `<url><loc>${SITE + PATH[l]}</loc><lastmod>${last.slice(0, 10)}</lastmod>${alts}</url>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls}</urlset>\n`;
}

// ---------------------------------------------------------------- Google reviews

const REV_CFG = 'reviews-config';
const placesHeaders = (key, mask) => ({ 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': mask, 'content-type': 'application/json' });

/** Public: { rating, count, url, reviews: [{ author, profile, photo, text, when }] } — latest 5-star reviews. */
export async function handleReviews(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/api/reviews/config') return reviewsConfig(request, env);
  const lang = LANGS.includes(url.searchParams.get('lang')) ? url.searchParams.get('lang') : 'en';
  const cfg = (await env.DATA.get(REV_CFG, 'json')) || {};
  if (!cfg.key || !cfg.placeId) return json({ reviews: [] }, 200, { 'cache-control': 'public, max-age=600' });
  const ck = `reviews:${lang}`;
  const cached = await env.DATA.get(ck, 'json');
  if (cached && Date.now() - cached.at < 6 * 3600e3) return json(cached.data, 200, { 'cache-control': 'public, max-age=1800' });
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(cfg.placeId)}?languageCode=${lang}`, { headers: placesHeaders(cfg.key, 'rating,userRatingCount,reviews,googleMapsUri') });
    const d = await res.json();
    if (!res.ok) throw new Error(d?.error?.message || `HTTP ${res.status}`);
    const reviews = (d.reviews || []).filter((r) => r.rating === 5 && (r.text?.text || r.originalText?.text))
      .sort((a, b) => String(b.publishTime || '').localeCompare(String(a.publishTime || '')))
      .slice(0, 5)
      .map((r) => ({ author: r.authorAttribution?.displayName || 'Google user', profile: r.authorAttribution?.uri || null, photo: r.authorAttribution?.photoUri || null, text: (r.text?.text || r.originalText?.text || '').slice(0, 1200), when: r.relativePublishTimeDescription || '' }));
    const data = { rating: d.rating || null, count: d.userRatingCount || null, url: d.googleMapsUri || null, reviews };
    await env.DATA.put(ck, JSON.stringify({ at: Date.now(), data }));
    return json(data, 200, { 'cache-control': 'public, max-age=1800' });
  } catch (e) {
    console.error('reviews', e);
    if (cached) return json(cached.data);
    return json({ reviews: [], error: 'unavailable' }, 200, { 'cache-control': 'public, max-age=300' });
  }
}

/** Owner: connect Google reviews (API key + the café's Google place). The key is never sent back. */
async function reviewsConfig(request, env) {
  const me = await currentUser(request, env);
  if (!isOwner(me)) return json({ error: 'Only the owner can change this.' }, 403);
  const cfg = (await env.DATA.get(REV_CFG, 'json')) || {};
  if (request.method === 'GET') return json({ connected: !!(cfg.key && cfg.placeId), keyEnd: cfg.key ? cfg.key.slice(-4) : null, placeId: cfg.placeId || null, name: cfg.name || null, address: cfg.address || null });
  if (request.method === 'DELETE') { await env.DATA.delete(REV_CFG); for (const l of LANGS) await env.DATA.delete(`reviews:${l}`); return json({ ok: true }); }
  if (request.method !== 'PUT') return json({ error: 'Not allowed.' }, 405);
  const b = await request.json().catch(() => ({}));
  const key = String(b.key || cfg.key || '').trim();
  if (!key) return json({ error: 'Paste the Google API key first.' }, 400);
  let placeId = String(b.placeId || '').trim();
  let name = null, address = null;
  // find the café on Google near its map pin
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST', headers: placesHeaders(key, 'places.id,places.displayName,places.formattedAddress'),
    body: JSON.stringify({ textQuery: b.query || 'Mariam Coffee Kayabaşı Başakşehir', locationBias: { circle: { center: { latitude: GEO.lat, longitude: GEO.lng }, radius: 800 } }, maxResultCount: 5 }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) return json({ error: `Google said: ${d?.error?.message || res.status}. Check that "Places API (New)" is enabled for this key.` }, 400);
  const places = (d.places || []).map((p) => ({ id: p.id, name: p.displayName?.text, address: p.formattedAddress }));
  const pick = placeId ? places.find((p) => p.id === placeId) || { id: placeId } : places[0];
  if (!pick) return json({ error: 'The café was not found on Google. Paste its Place ID.', places }, 400);
  placeId = pick.id; name = pick.name || null; address = pick.address || null;
  await env.DATA.put(REV_CFG, JSON.stringify({ key: key.slice(0, 200), placeId, name, address, at: new Date().toISOString(), by: me.name }));
  for (const l of LANGS) await env.DATA.delete(`reviews:${l}`);
  return json({ ok: true, placeId, name, address, places });
}

// ---------------------------------------------------------------- best sellers (from the management app)

/** PUT { items: [itemNo, …] } best first. Owner / manager signed in, or the upload password. */
export async function handleBestSellers(request, env, passwordOk) {
  if (request.method === 'GET') return json((await env.DATA.get('best-sellers', 'json')) || { items: [] });
  if (request.method !== 'PUT') return json({ error: 'Not allowed.' }, 405);
  const me = await currentUser(request, env);
  const roles = String(me?.roles || '');
  const ok = isOwner(me) || /manager/.test(roles) || (await passwordOk(env, request.headers.get('x-upload-password') || ''));
  if (!ok) return json({ error: 'Not allowed.' }, 403);
  const b = await request.json().catch(() => ({}));
  const items = (Array.isArray(b.items) ? b.items : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 40);
  await env.DATA.put('best-sellers', JSON.stringify({ items, at: new Date().toISOString(), days: Number(b.days) || null }));
  return json({ ok: true, count: items.length });
}
