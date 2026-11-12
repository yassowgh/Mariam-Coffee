// Public menu prices for mariamcoffeeshop.com.
// Prices come from the POS item list (Items.DB, "SellingPrice1") inside the latest uploaded dataset,
// so the website menu follows the till automatically. The result is cached in KV per upload.
import { unzipSync } from 'fflate';
import { readTable } from '../src/lib/paradox.js';

const DATA_KEY = 'dataset';
const CACHE_KEY = 'menu-prices';

async function extractPrices(zipBytes) {
  const files = unzipSync(new Uint8Array(zipBytes), { filter: (f) => /(^|\/)items\.db$/i.test(f.name) });
  // newest Items.DB if the upload has several folders
  const bufs = Object.values(files);
  if (!bufs.length) return null;
  const prices = {};
  for (const buf of bufs) {
    const { rows } = await readTable(buf, { fields: ['ItemNo', 'SellingPrice1', 'Active'], yieldEvery: 1e9 });
    for (const r of rows) {
      if (r.ItemNo == null || !(r.SellingPrice1 > 0)) continue;
      prices[r.ItemNo] = { p: Math.round(r.SellingPrice1 * 100) / 100, a: r.Active !== false };
    }
  }
  return prices;
}

/** Re-reads the prices for the stored dataset (called after each upload). */
export async function refreshMenuPrices(env, zipBytes, uploadedAt) {
  try {
    const prices = await extractPrices(zipBytes);
    if (prices) await env.DATA.put(CACHE_KEY, JSON.stringify({ uploadedAt, prices }));
  } catch (e) {
    console.log('menu prices failed', e && e.message);
  }
}

export async function handleMenu(request, env) {
  const headers = { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' };
  if (!env.DATA) return new Response('{"prices":{}}', { headers });
  const cached = await env.DATA.get(CACHE_KEY, 'json');
  const { metadata } = await env.DATA.getWithMetadata(DATA_KEY, { type: 'stream' }).then((r) => {
    try { r.value?.cancel(); } catch { /* ignore */ }
    return r;
  });
  const uploadedAt = metadata?.uploadedAt || null;
  if (cached && cached.uploadedAt === uploadedAt) return new Response(JSON.stringify(cached), { headers });
  if (uploadedAt) {
    const zip = await env.DATA.get(DATA_KEY, 'arrayBuffer');
    if (zip) {
      await refreshMenuPrices(env, zip, uploadedAt);
      const fresh = await env.DATA.get(CACHE_KEY, 'json');
      if (fresh) return new Response(JSON.stringify(fresh), { headers });
    }
  }
  return new Response(JSON.stringify(cached || { prices: {} }), { headers });
}
