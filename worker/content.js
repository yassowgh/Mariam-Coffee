// Editable website content (owner): texts, menu, photos for mariamcoffeeshop.com and the table page (/t/).
// Stored in KV as one JSON document ("site-content") holding only what the owner changed; the pages
// keep their built-in defaults for everything else. Photos are stored in KV ("media:<id>") and served
// from /media/<id> with long browser caching (a new photo always gets a new id).
//
//   GET  /api/content          -> { content }            (public)
//   PUT  /api/content          <- { content }            (owner)
//   POST /api/media            <- image (jpeg/png/webp)  (owner) -> { url }
//   GET  /media/<id>           -> the image               (public)
import { currentUser, isOwner } from './staff.js';

const KEY = 'site-content';
const MAX_JSON = 400 * 1024;
const MAX_IMG = 3 * 1024 * 1024;
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

let cache = { at: 0, value: null };
async function load(env) {
  if (Date.now() - cache.at < 20000 && cache.value) return cache.value;
  const value = (env.DATA && (await env.DATA.get(KEY, 'json'))) || {};
  cache = { at: Date.now(), value };
  return value;
}

// Only our own image paths are allowed in the content (no outside links in <img>).
const IMG_RE = /^\/(media\/m_[a-f0-9]{24}|photos\/[a-z0-9-]+\.(webp|jpg)|brand\/[a-z0-9-]+\.(webp|jpg|svg|png))$/;
function cleanImages(v, path = '') {
  if (Array.isArray(v)) return v.map((x, i) => cleanImages(x, `${path}[${i}]`));
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (/^(img|src|full|hero|about|visit|tableLogo|tableBg|sig\d)$/.test(k) && typeof x === 'string' && x && !IMG_RE.test(x)) throw new Error(`Image path not allowed at ${path}.${k}`);
      out[k] = cleanImages(x, `${path}.${k}`);
    }
    return out;
  }
  if (typeof v === 'string') return v.slice(0, 2000);
  return v;
}

export async function handleContent(request, env) {
  if (request.method === 'GET') return json({ content: await load(env) });
  if (request.method === 'PUT') {
    const me = await currentUser(request, env);
    if (!isOwner(me)) return json({ error: 'Only the owner can edit the website.' }, 403);
    const raw = await request.text();
    if (raw.length > MAX_JSON) return json({ error: 'Too much content.' }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ error: 'Not valid JSON.' }, 400); }
    let content;
    try { content = cleanImages(body.content || {}); } catch (e) { return json({ error: e.message }, 400); }
    content.updatedAt = new Date().toISOString();
    content.updatedBy = me.name;
    await env.DATA.put(KEY, JSON.stringify(content));
    cache = { at: Date.now(), value: content };
    return json({ ok: true, content });
  }
  return json({ error: 'Method not allowed' }, 405);
}

export async function handleMedia(request, env, path) {
  if (request.method === 'GET' && path.startsWith('/media/')) {
    const id = path.slice(7);
    if (!/^m_[a-f0-9]{24}$/.test(id)) return new Response('Not found', { status: 404 });
    const { value, metadata } = await env.DATA.getWithMetadata('media:' + id, { type: 'arrayBuffer' });
    if (!value) return new Response('Not found', { status: 404 });
    return new Response(value, { headers: { 'content-type': metadata?.type || 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' } });
  }
  if (request.method === 'POST' && path === '/api/media') {
    const me = await currentUser(request, env);
    if (!isOwner(me)) return json({ error: 'Only the owner can upload website photos.' }, 403);
    const type = request.headers.get('content-type') || '';
    if (!/^image\/(jpeg|png|webp)$/.test(type)) return json({ error: 'The photo must be JPEG, PNG or WebP.' }, 400);
    const buf = await request.arrayBuffer();
    if (!buf.byteLength) return json({ error: 'The photo is empty.' }, 400);
    if (buf.byteLength > MAX_IMG) return json({ error: 'The photo is too large (limit 3 MB).' }, 413);
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    const id = 'm_' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    await env.DATA.put('media:' + id, buf, { metadata: { type, by: me.id, at: new Date().toISOString() } });
    return json({ url: '/media/' + id });
  }
  return json({ error: 'Not found' }, 404);
}

/** Puts the saved content into the page itself, so edited texts show without waiting for another request. */
export async function withContent(res, env) {
  const content = await load(env);
  const data = JSON.stringify(content).replace(/</g, '\\u003c');
  return new HTMLRewriter()
    .on('head', { element(el) { el.append(`<script type="application/json" id="mc-content">${data}</script>`, { html: true }); } })
    .transform(res);
}
