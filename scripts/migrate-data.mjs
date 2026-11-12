// Copies all data (D1 tables + KV keys) from one deployment to another through /api/migrate.
// Usage: node scripts/migrate-data.mjs <from-origin> <to-origin>
// The upload password is read from the MC_UPLOAD_PASSWORD environment variable.
const [from, to] = process.argv.slice(2);
const pw = process.env.MC_UPLOAD_PASSWORD;
if (!from || !to || !pw) { console.error('usage: MC_UPLOAD_PASSWORD=… node scripts/migrate-data.mjs <from> <to>'); process.exit(1); }
const H = { 'x-upload-password': pw };

async function req(url, opts = {}) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
      if (!r.ok) throw new Error(`${r.status} ${url} ${(await r.text()).slice(0, 200)}`);
      return r;
    } catch (e) {
      if (i >= 3) throw e;
      await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
    }
  }
}

// 1. D1
const d1 = await (await req(from + '/api/migrate/d1')).json();
console.log('D1 tables:', d1.tables.map((t) => `${t.name}=${t.rows.length}`).join(', '));
const imp = await (await req(to + '/api/migrate/d1', { method: 'POST', headers: { 'content-type': 'application/json', 'x-migrate-confirm': 'replace' }, body: JSON.stringify(d1) })).json();
let bad = 0;
for (const [name, r] of Object.entries(imp.tables)) { if (r.sent !== r.now) { bad++; console.log('  MISMATCH', name, r); } }
console.log('D1 imported', bad ? `with ${bad} mismatches` : 'OK');

// 2. KV
let cursor = null; const keys = [];
do {
  const r = await (await req(from + '/api/migrate/kv-list' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''))).json();
  keys.push(...r.keys); cursor = r.cursor;
} while (cursor);
let bytes = 0;
for (const k of keys) {
  if (k.name === 'menu-prices') continue; // rebuilt automatically
  const r = await req(from + '/api/migrate/kv?key=' + encodeURIComponent(k.name));
  const meta = r.headers.get('x-kv-meta') || encodeURIComponent('null');
  const body = await r.arrayBuffer();
  await req(to + '/api/migrate/kv?key=' + encodeURIComponent(k.name), { method: 'PUT', headers: { 'x-kv-meta': meta, 'content-type': 'application/octet-stream' }, body });
  bytes += body.byteLength;
}
console.log(`KV copied: ${keys.length} keys, ${(bytes / 1048576).toFixed(2)} MB`);

// 3. check
const after = await (await req(to + '/api/migrate/d1')).json();
const cnt = (x) => Object.fromEntries(x.tables.map((t) => [t.name, t.rows.length]));
const a = cnt(d1), b = cnt(after);
const diff = Object.keys(a).filter((k) => a[k] !== b[k]);
console.log(diff.length ? 'Row count differences: ' + diff.map((k) => `${k} ${a[k]}→${b[k]}`).join(', ') : 'Row counts match on both sides.');
