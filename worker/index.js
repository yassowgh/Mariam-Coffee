// Cloudflare Worker: serves the app (static assets) and stores the last
// uploaded database so everyone who opens the site sees the same data.
//
//   GET /api/data  -> the saved ZIP of the Paradox tables (404 if none)
//   PUT /api/data  -> replace it; requires the upload password in X-Upload-Password
//   POST /api/auth -> 204 if X-Upload-Password is right, 401 otherwise
//
// Password: set the secret UPLOAD_PASSWORD (Settings -> Variables and Secrets) to
// override; otherwise it is checked against UPLOAD_PASSWORD_SHA256 from wrangler.jsonc.

const KEY = 'dataset';
const MAX_BYTES = 24 * 1024 * 1024; // Workers KV value limit is 25 MiB

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function passwordOk(env, given) {
  if (!given) return false;
  if (env.UPLOAD_PASSWORD) return safeEqual(await sha256Hex(given), await sha256Hex(env.UPLOAD_PASSWORD));
  if (env.UPLOAD_PASSWORD_SHA256) return safeEqual(await sha256Hex(given), env.UPLOAD_PASSWORD_SHA256.toLowerCase());
  return false;
}

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

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
    if (!(await passwordOk(env, request.headers.get('x-upload-password')))) {
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
      from: String(meta.from || '').slice(0, 10),
      to: String(meta.to || '').slice(0, 10),
      bytes: body.byteLength,
    };
    await env.DATA.put(KEY, body, { metadata });
    return json({ ok: true, metadata });
  }

  return json({ error: 'Method not allowed' }, 405);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/data') return handleData(request, env);
    if (url.pathname === '/api/auth' && request.method === 'POST') {
      return (await passwordOk(env, request.headers.get('x-upload-password')))
        ? new Response(null, { status: 204 })
        : json({ error: 'Wrong password.' }, 401);
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    return env.ASSETS.fetch(request);
  },
};
