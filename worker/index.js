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

async function handleData(request, env) {
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/data') return handleData(request, env);
    if (url.pathname === '/api/costs') return handleCosts(request, env);
    if (url.pathname === '/api/auth' && request.method === 'POST') {
      return (await allowed(request, env))
        ? new Response(null, { status: 204 })
        : json({ error: 'Wrong password.' }, 401);
    }
    const head = url.pathname.split('/')[2];
    if (STAFF_ROUTES.includes(head)) return handleStaff(request, env, url.pathname, passwordOk);
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    return env.ASSETS.fetch(request);
  },
};
