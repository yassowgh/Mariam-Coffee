// Cloudflare Worker: serves the app (static assets) and stores the last
// uploaded database so everyone who opens the site sees the same data.
//
//   GET /api/data  -> the saved ZIP of the Paradox tables (404 if none)
//   PUT /api/data  -> replace it; requires the upload password in X-Upload-Password
//   POST /api/auth -> 204 if X-Upload-Password is right, 401 otherwise
//   GET/PUT /api/costs -> product cost settings (JSON); PUT requires the password
//   Anyone can view the sales reports. Saving needs the owner's sign-in or the upload password.
//   Staff features (accounts, expenses, fixed costs, shifts, clock-in) live in staff.js.
//
// Password: set the secret UPLOAD_PASSWORD (Settings -> Variables and Secrets) to
// override; otherwise it is checked against UPLOAD_PASSWORD_SHA256 from wrangler.jsonc.

import { STAFF_ROUTES, currentUser, handleStaff, isOwner } from './staff.js';
import { safeEqual, sha256Hex } from './auth.js';
import { handleMenu, refreshMenuPrices } from './menu.js';
import { handleContent, handleMedia, withContent } from './content.js';

const KEY = 'dataset';
const MAX_BYTES = 24 * 1024 * 1024; // Workers KV value limit is 25 MiB

async function passwordOk(env, given) {
  if (!given) return false;
  if (env.UPLOAD_PASSWORD) return safeEqual(await sha256Hex(given), await sha256Hex(env.UPLOAD_PASSWORD));
  if (env.UPLOAD_PASSWORD_SHA256) return safeEqual(await sha256Hex(given), env.UPLOAD_PASSWORD_SHA256.toLowerCase());
  return false;
}

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

/** Saving: owner signed in, the upload password, or the POS computer's upload key. */
async function allowed(request, env) {
  const me = await currentUser(request, env).catch(() => null);
  if (isOwner(me)) return true;
  const token = request.headers.get('x-upload-token');
  if (token && env.DB) {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'uploadToken'").first().catch(() => null);
    const saved = row ? JSON.parse(row.value) : null;
    if (saved?.hash && safeEqual(await sha256Hex(token), saved.hash)) return true;
  }
  return passwordOk(env, request.headers.get('x-upload-password'));
}

async function handleData(request, env, ctx) {
  if (!env.DATA) return json({ error: 'Storage is not configured on this deployment.' }, 503);

  if (request.method === 'GET' || request.method === 'HEAD') {
    const { value, metadata } = await env.DATA.getWithMetadata(KEY, { type: 'arrayBuffer' });
    if (!value) return json({ error: 'No saved data yet.' }, 404);
    return new Response(request.method === 'HEAD' ? null : value, {
      headers: {
        'content-type': 'application/zip',
        'content-length': String(value.byteLength),
        'x-meta': encodeURIComponent(JSON.stringify(metadata || {})),
        'cache-control': 'no-store',
      },
    });
  }

  if (request.method === 'PUT') {
    if (!(await allowed(request, env))) {
      return json({ error: 'Wrong password. The data was not saved.' }, 401);
    }
    const body = await request.arrayBuffer();
    if (!body.byteLength) return json({ error: 'Empty upload.' }, 400);
    if (body.byteLength > MAX_BYTES) return json({ error: `Upload is ${(body.byteLength / 1048576).toFixed(1)} MB; the limit is 24 MB.` }, 413);
    let meta = {};
    try { meta = JSON.parse(decodeURIComponent(request.headers.get('x-meta') || '%7B%7D')); } catch { /* ignore */ }
    const metadata = {
      uploadedAt: new Date().toISOString(),
      name: String(meta.name || '').slice(0, 120),
      auto: request.headers.get('x-upload-token') ? true : undefined,
      from: String(meta.from || '').slice(0, 10),
      to: String(meta.to || '').slice(0, 10),
      bytes: body.byteLength,
    };
    await env.DATA.put(KEY, body, { metadata });
    // update the website menu prices from the new POS item list
    if (ctx) ctx.waitUntil(refreshMenuPrices(env, body, metadata.uploadedAt));
    return json({ ok: true, metadata });
  }

  return json({ error: 'Method not allowed' }, 405);
}

const COSTS_KEY = 'costs';
const MAX_COSTS_BYTES = 2 * 1024 * 1024;

async function handleCosts(request, env) {
  if (!env.DATA) return json({ error: 'Storage is not configured on this deployment.' }, 503);
  if (request.method === 'GET') {
    const value = await env.DATA.get(COSTS_KEY);
    if (!value) return json({ error: 'No cost settings saved yet.' }, 404);
    return new Response(value, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }
  if (request.method === 'PUT') {
    if (!(await allowed(request, env))) {
      return json({ error: 'Wrong password. Costs were not saved.' }, 401);
    }
    const text = await request.text();
    if (text.length > MAX_COSTS_BYTES) return json({ error: 'Cost settings are too large.' }, 413);
    let cfg;
    try { cfg = JSON.parse(text); } catch { return json({ error: 'Invalid JSON.' }, 400); }
    if (!cfg || !Array.isArray(cfg.recipes) || typeof cfg.links !== 'object') return json({ error: 'Not a cost settings file.' }, 400);
    cfg.savedAt = new Date().toISOString();
    await env.DATA.put(COSTS_KEY, JSON.stringify(cfg));
    return json({ ok: true, savedAt: cfg.savedAt });
  }
  return json({ error: 'Method not allowed' }, 405);
}

// Security headers on every response (pages, files and API).
const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), payment=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-src https://www.google.com",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; '),
};

function secure(response) {
  const r = new Response(response.body, response);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) r.headers.set(k, v);
  return r;
}

const SITE_HOST = 'mariamcoffeeshop.com';
const APP = '/management';
const OLD_HOST = 'mariam-coffee-db-reader.yassow.workers.dev';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Always use HTTPS: plain http:// links are sent to the https:// address.
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol === 'http:' && !local) {
      url.protocol = 'https:';
      return new Response(null, { status: 301, headers: { Location: url.toString() } });
    }
    // www.mariamcoffeeshop.com -> mariamcoffeeshop.com
    if (url.hostname === 'www.' + SITE_HOST) {
      url.hostname = SITE_HOST;
      return new Response(null, { status: 301, headers: { Location: url.toString() } });
    }
    // The app moved to another Cloudflare account. The old deployment forwards every API call
    // (POS uploader, old links) to the new one, so nothing is written to the old database any more.
    if (url.hostname === OLD_HOST && url.pathname.startsWith('/api/')) {
      return fetch(new Request(`https://${SITE_HOST}${url.pathname}${url.search}`, request));
    }
    // Old address (workers.dev): pages move to mariamcoffeeshop.com/management/…
    // The API keeps answering there so POS uploaders that still use the old address keep working.
    if (url.hostname.endsWith('.workers.dev') && !url.pathname.startsWith('/api/') && (request.method === 'GET' || request.method === 'HEAD')) {
      const path = url.pathname.startsWith(APP) ? url.pathname : APP + (url.pathname === '/' ? '/' : url.pathname);
      return new Response(null, { status: 301, headers: { Location: `https://${SITE_HOST}${path}${url.search}` } });
    }
    return secure(await route(request, env, url, ctx));
  },
};

// Browser caching: hashed build files never change; photos and logos rarely do.
function withCache(pathname, res) {
  let cc = null;
  if (/^\/(management\/)?assets\//.test(pathname)) cc = 'public, max-age=31536000, immutable';
  else if (/^\/(photos|brand)\//.test(pathname)) cc = 'public, max-age=604800, stale-while-revalidate=86400';
  if (!cc || res.status !== 200) return res;
  const r = new Response(res.body, res);
  r.headers.set('cache-control', cc);
  return r;
}

async function route(request, env, url, ctx) {
  // The management app calls /management/api/…; /api/… keeps working too.
  const path = url.pathname.startsWith(APP + '/api/') ? url.pathname.slice(APP.length) : url.pathname;
  if (path === '/api/data') return handleData(request, env, ctx);
  if (path === '/api/costs') return handleCosts(request, env);
  if (path === '/api/menu' && request.method === 'GET') return handleMenu(request, env);
  if (path === '/api/content') return handleContent(request, env);
  if (path === '/api/media' || (path.startsWith('/media/') && request.method === 'GET')) return handleMedia(request, env, path);
  if (path === '/api/auth' && request.method === 'POST') {
    return (await allowed(request, env))
      ? new Response(null, { status: 204 })
      : json({ error: 'Wrong password.' }, 401);
  }
  const head = path.split('/')[2];
  if (path.startsWith('/api/') && STAFF_ROUTES.includes(head)) return handleStaff(request, env, path, passwordOk);
  if (path.startsWith('/api/')) return json({ error: 'Not found' }, 404);

  // Pages and files
  if (url.pathname === APP) return Response.redirect(url.origin + APP + '/' + url.search, 301);
  // The website and the table page get the owner's edited content put into the page.
  if (request.method === 'GET' && ['/', '/index.html', '/t/', '/t/index.html'].includes(url.pathname)) {
    const plain = new Request(url.toString(), { headers: { accept: 'text/html' } }); // no If-None-Match: always the full page
    const page = await env.ASSETS.fetch(plain);
    if (page.status === 200) {
      const out = await withContent(page, env);
      const r = new Response(out.body, out);
      r.headers.delete('etag');
      r.headers.set('cache-control', 'no-cache');
      return r;
    }
    return page;
  }
  const res = await env.ASSETS.fetch(request);
  if (res.status !== 404) return withCache(url.pathname, res);
  const accept = request.headers.get('accept') || '';
  if (url.pathname.startsWith(APP + '/')) {
    // the management app is a single-page app: unknown paths load its index page
    if (!/\.[a-z0-9]+$/i.test(url.pathname) || accept.includes('text/html')) {
      return env.ASSETS.fetch(new Request(url.origin + APP + '/', request));
    }
    return res;
  }
  const page = await env.ASSETS.fetch(new Request(url.origin + '/404.html'));
  return new Response(page.body, { status: 404, headers: page.headers });
}
