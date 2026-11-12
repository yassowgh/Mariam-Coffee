// One-off copy of all data from one deployment to another (moving to a new Cloudflare account).
// Every route needs the upload password (x-upload-password). Remove this file once the move is done.
//   GET  /api/migrate/d1            -> every D1 table: { name, sql, rows }
//   POST /api/migrate/d1            <- same shape; replaces the rows of each table (x-migrate-confirm: replace)
//   GET  /api/migrate/kv-list       -> KV keys (+ metadata), ?cursor= for more
//   GET  /api/migrate/kv?key=       -> raw value, metadata in x-kv-meta
//   PUT  /api/migrate/kv?key=       <- raw value, metadata in x-kv-meta

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export async function handleMigrate(request, env, path, passwordOk) {
  if (!(await passwordOk(env, request.headers.get('x-upload-password') || ''))) return json({ error: 'Wrong password.' }, 401);
  const url = new URL(request.url);
  const what = path.split('/')[3];
  const m = request.method;

  if (what === 'd1' && m === 'GET') {
    const { results } = await env.DB.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'").all();
    const tables = [];
    for (const t of results) {
      const rows = (await env.DB.prepare(`SELECT * FROM "${t.name}"`).all()).results;
      tables.push({ name: t.name, sql: t.sql, rows });
    }
    return json({ tables });
  }

  if (what === 'd1' && m === 'POST') {
    if (request.headers.get('x-migrate-confirm') !== 'replace') return json({ error: 'Missing confirmation.' }, 400);
    const { tables } = await request.json();
    const out = {};
    for (const t of tables) {
      if (!/^[a-z_]+$/i.test(t.name)) return json({ error: 'Bad table name ' + t.name }, 400);
      await env.DB.prepare(String(t.sql).replace(/^CREATE TABLE (IF NOT EXISTS )?/i, 'CREATE TABLE IF NOT EXISTS ')).run();
      const have = new Set((await env.DB.prepare(`PRAGMA table_info("${t.name}")`).all()).results.map((c) => c.name));
      const stmts = [env.DB.prepare(`DELETE FROM "${t.name}"`)];
      for (const r of t.rows) {
        const cols = Object.keys(r).filter((c) => have.has(c));
        stmts.push(env.DB.prepare(`INSERT INTO "${t.name}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).bind(...cols.map((c) => r[c])));
      }
      for (let i = 0; i < stmts.length; i += 80) await env.DB.batch(stmts.slice(i, i + 80));
      const { n } = await env.DB.prepare(`SELECT COUNT(*) AS n FROM "${t.name}"`).first();
      out[t.name] = { sent: t.rows.length, now: n };
    }
    return json({ ok: true, tables: out });
  }

  if (what === 'kv-list' && m === 'GET') {
    const r = await env.DATA.list({ cursor: url.searchParams.get('cursor') || undefined, limit: 1000 });
    return json({ keys: r.keys, cursor: r.list_complete ? null : r.cursor });
  }

  const key = url.searchParams.get('key');
  if (what === 'kv' && key && m === 'GET') {
    const { value, metadata } = await env.DATA.getWithMetadata(key, { type: 'arrayBuffer' });
    if (value == null) return json({ error: 'No such key' }, 404);
    return new Response(value, { headers: { 'content-type': 'application/octet-stream', 'x-kv-meta': encodeURIComponent(JSON.stringify(metadata ?? null)) } });
  }
  if (what === 'kv' && key && m === 'PUT') {
    let metadata = null;
    try { metadata = JSON.parse(decodeURIComponent(request.headers.get('x-kv-meta') || 'null')); } catch { /* none */ }
    const value = await request.arrayBuffer();
    await env.DATA.put(key, value, metadata ? { metadata } : undefined);
    return json({ ok: true, key, bytes: value.byteLength });
  }
  return json({ error: 'Not found' }, 404);
}
