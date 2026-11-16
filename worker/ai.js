// One AI call, many free providers: Cloudflare Workers AI first, then the owner's own free API keys
// (Google Gemini, Groq, Mistral, OpenRouter) in the order saved in Settings → AI providers.
// When a provider says its free limit is used up (HTTP 429 / "quota"), it is skipped for the rest of the
// day (UTC) and the next one is used. Claude is used first when ANTHROPIC_API_KEY is set.
//
// Each provider is a different company with its own free tier; this does not use several accounts at
// the same company (that would break their terms).
import Anthropic from '@anthropic-ai/sdk';

export const PROVIDERS = {
  gemini: { label: 'Google Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-2.5-flash', signup: 'https://aistudio.google.com/apikey', note: 'Free tier with a daily limit; very good at Arabic and Turkish.' },
  groq: { label: 'Groq', url: 'https://api.groq.com/openai/v1/chat/completions', model: 'meta-llama/llama-4-scout-17b-16e-instruct', signup: 'https://console.groq.com/keys', note: 'Free tier, very fast.' },
  mistral: { label: 'Mistral', url: 'https://api.mistral.ai/v1/chat/completions', model: 'mistral-small-latest', signup: 'https://console.mistral.ai/api-keys', note: 'Free “Experiment” plan.' },
  openrouter: { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1/chat/completions', model: 'meta-llama/llama-4-scout:free', signup: 'https://openrouter.ai/keys', note: 'Free models end in “:free”; small daily limit.' },
};
const CF_VISION = ['@cf/meta/llama-4-scout-17b-16e-instruct', '@cf/mistralai/mistral-small-3.1-24b-instruct', '@cf/meta/llama-3.2-11b-vision-instruct'];
const CF_TEXT = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/** First {...} block of an AI answer, parsed. */
export function parseJson(text) {
  if (text && typeof text === 'object') return text;
  const s = String(text || '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

const today = () => new Date().toISOString().slice(0, 10);
async function getS(db, key) { const r = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first(); return r ? JSON.parse(r.value) : null; }
async function setS(db, key, value) { await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, JSON.stringify(value)).run(); }

/** { order: ['gemini', …], keys: { gemini: { key, model } } } */
export async function aiConfig(db) { return (await getS(db, 'aiProviders')) || { order: [], keys: {} }; }
export async function aiUsage(db) { return (await getS(db, 'aiUsage:' + today())) || {}; }
async function note(db, name, what) {
  const k = 'aiUsage:' + today();
  const u = (await getS(db, k)) || {};
  u[name] = { ...(u[name] || {}), [what]: ((u[name] || {})[what] || 0) + 1 };
  if (what === 'limit') u[name].exhausted = true;
  await setS(db, k, u);
}
const isLimit = (status, msg) => status === 429 || /quota|rate.?limit|limit (reached|exceeded)|exhausted|neurons|allowance|too many requests|daily/i.test(String(msg || ''));

async function openAICompatible(p, key, model, { system, text, images, maxTokens }) {
  const user = images?.length
    ? [{ type: 'text', text }, ...images.map((url) => ({ type: 'image_url', image_url: { url } }))]
    : text;
  const res = await fetch(p.url, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'HTTP-Referer': 'https://mariamcoffeeshop.com', 'X-Title': 'Mariam Coffee' },
    body: JSON.stringify({ model, temperature: 0, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(body?.error?.message || body?.message || `HTTP ${res.status}`); e.status = res.status; throw e; }
  const out = body?.choices?.[0]?.message?.content;
  return Array.isArray(out) ? out.map((x) => x.text || '').join('') : String(out || '');
}

async function workersAI(env, { system, text, images, maxTokens, schema, temperature = 0 }) {
  if (!images?.length) {
    const r = await env.AI.run(CF_TEXT, { messages: [{ role: 'system', content: system }, { role: 'user', content: text }], max_tokens: maxTokens, temperature, ...(schema ? { response_format: { type: 'json_schema', json_schema: schema } } : {}) });
    return { out: typeof r?.response === 'string' ? r.response : JSON.stringify(r?.response ?? ''), model: CF_TEXT };
  }
  let last;
  for (const model of CF_VISION) {
    try {
      let r;
      if (model.includes('llama-3.2-11b-vision')) {
        const bytes = [...Uint8Array.from(atob(images[0].split(',')[1]), (c) => c.charCodeAt(0))];
        try { await env.AI.run(model, { prompt: 'agree' }); } catch { /* licence already accepted */ }
        r = await env.AI.run(model, { messages: [{ role: 'system', content: system }, { role: 'user', content: text }], image: bytes, max_tokens: maxTokens, temperature: 0 });
      } else {
        r = await env.AI.run(model, { messages: [{ role: 'user', content: [{ type: 'text', text: `${system}\n\n${text}` }, ...images.map((url) => ({ type: 'image_url', image_url: { url } }))] }], max_tokens: maxTokens, temperature: 0 });
      }
      const out = r?.response ?? r?.choices?.[0]?.message?.content;
      if (out) return { out: typeof out === 'string' ? out : JSON.stringify(out), model };
    } catch (e) { last = e; if (isLimit(0, e?.message)) throw e; }
  }
  throw last || new Error('No answer');
}

/**
 * Ask the AI. Returns { out (text), by (who answered), tried: [...] }.
 * accept(out) decides if an answer is usable (else the next provider is tried).
 */
export async function aiChat(env, db, { system, text, images = [], maxTokens = 4000, accept = (o) => !!o, schema = null, temperature = 0 }) {
  const tried = [];
  const usage = await aiUsage(db);
  const cfg = await aiConfig(db);
  const chain = [];
  if (env.ANTHROPIC_API_KEY) chain.push('claude');
  if (env.AI) chain.push('workers');
  for (const name of cfg.order || []) if (PROVIDERS[name] && cfg.keys?.[name]?.key) chain.push(name);
  if (!chain.length) throw Object.assign(new Error('No AI is connected. Add a free AI key in Settings → AI providers.'), { tried });
  for (const name of chain) {
    if (usage[name]?.exhausted) { tried.push(`${name}: daily limit reached earlier today`); continue; }
    try {
      let out, label;
      if (name === 'claude') {
        const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
        const content = [...images.map((url) => ({ type: 'image', source: { type: 'base64', media_type: url.slice(5, url.indexOf(';')), data: url.split(',')[1] } })), { type: 'text', text }];
        const msg = await client.messages.create({ model: 'claude-opus-5-5', max_tokens: maxTokens, system, messages: [{ role: 'user', content }] });
        out = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join(''); label = 'Claude';
      } else if (name === 'workers') {
        const r = await workersAI(env, { system, text, images, maxTokens, schema, temperature });
        out = r.out; label = `Cloudflare AI (${r.model.split('/').pop()})`;
      } else {
        const p = PROVIDERS[name];
        const k = cfg.keys[name];
        out = await openAICompatible(p, k.key, k.model || p.model, { system, text, images, maxTokens });
        label = `${p.label} (${k.model || p.model})`;
      }
      if (accept(out)) { await note(db, name, images.length ? 'vision' : 'text'); return { out, by: label, tried }; }
      tried.push(`${name}: answer could not be used`);
      await note(db, name, 'bad');
    } catch (e) {
      const msg = String(e?.message || e).slice(0, 160);
      tried.push(`${name}: ${msg}`);
      if (isLimit(e?.status, msg)) await note(db, name, 'limit'); else await note(db, name, 'error');
    }
  }
  const allLimited = tried.every((t) => /limit|quota|429|allowance|neurons/i.test(t));
  throw Object.assign(new Error(allLimited
    ? 'All the free AI allowances for today are used up. Add another free AI key in Settings → AI providers, or try again tomorrow.'
    : 'The AI could not read this. Try a sharper, straight photo in good light.'), { tried });
}

/** Settings → AI providers (owner): keys are stored, never sent back (only the last 4 characters). */
export async function handleAiProviders({ request, env, me, h }) {
  h.need(me, 'owner');
  const db = env.DB;
  const cfg = await aiConfig(db);
  if (request.method === 'GET') {
    const usage = await aiUsage(db);
    return h.json({
      workers: !!env.AI, claude: !!env.ANTHROPIC_API_KEY, usage,
      providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, signup: p.signup, note: p.note, defaultModel: p.model,
        connected: !!cfg.keys?.[id]?.key, keyEnd: cfg.keys?.[id]?.key ? cfg.keys[id].key.slice(-4) : null, model: cfg.keys?.[id]?.model || '' })),
      order: cfg.order || [],
    });
  }
  const b = await h.body(request);
  if (request.method === 'POST' && b.action === 'test') {
    const p = PROVIDERS[b.id];
    const k = cfg.keys?.[b.id];
    if (!p || !k?.key) h.fail(400, 'Save the key first.');
    try {
      const out = await openAICompatible(p, k.key, k.model || p.model, { system: 'Answer with one word.', text: 'Translate to English: "süt" (Turkish) and "حليب" (Arabic).', maxTokens: 20 });
      return h.json({ ok: true, answer: out.slice(0, 80) });
    } catch (e) { return h.json({ ok: false, error: String(e.message).slice(0, 200), limit: isLimit(e.status, e.message) }); }
  }
  if (request.method === 'PUT') {
    const keys = { ...(cfg.keys || {}) };
    for (const [id, v] of Object.entries(b.keys || {})) {
      if (!PROVIDERS[id]) continue;
      const cur = keys[id] || {};
      if (v.remove) { delete keys[id]; continue; }
      keys[id] = { key: v.key ? String(v.key).trim().slice(0, 300) : cur.key, model: String(v.model ?? cur.model ?? '').trim().slice(0, 120) };
      if (!keys[id].key) delete keys[id];
    }
    const order = (Array.isArray(b.order) ? b.order : cfg.order || []).filter((id) => keys[id]);
    for (const id of Object.keys(keys)) if (!order.includes(id)) order.push(id);
    await setS(db, 'aiProviders', { keys, order });
    await h.audit(db, me, 'settings.ai', { connected: order });
    // a new key: forget "limit reached" for today so it is tried again
    const u = await aiUsage(db);
    for (const id of Object.keys(b.keys || {})) if (u[id]) delete u[id].exhausted;
    await setS(db, 'aiUsage:' + today(), u);
    return h.json({ ok: true });
  }
  return h.fail(405, 'Not allowed.');
}
