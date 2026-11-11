// Automatic schedule helpers on the server:
//   GET/PUT /api/demand            sales pattern (average orders per weekday and hour), saved by the owner's browser
//   GET/PUT /api/plan-settings     settings for the automatic schedule (orders per barista per hour, overlap…)
//   GET/PUT /api/plan-rules?week=  the conditions written for one week
//   POST    /api/plan-parse        sentences the built-in reader could not read -> rules, with Claude
//                                  (if ANTHROPIC_API_KEY is set) or Cloudflare Workers AI (binding AI, free allowance)
import Anthropic from '@anthropic-ai/sdk';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const NUL = (type) => ({ anyOf: [{ type }, { type: 'null' }] });

// The shape Claude must answer in (structured outputs).
const RULES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rules', 'unclear'],
  properties: {
    rules: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'person', 'days', 'from', 'to', 'number', 'text'],
        properties: {
          type: { type: 'string', enum: ['off', 'available', 'fixed', 'maxHours', 'minHours', 'maxDays', 'minStaff'] },
          person: NUL('string'),
          days: { type: 'array', items: { type: 'integer', enum: [0, 1, 2, 3, 4, 5, 6] } },
          from: NUL('string'),
          to: NUL('string'),
          number: NUL('number'),
          text: { type: 'string' },
        },
      },
    },
    unclear: { type: 'array', items: { type: 'string' } },
  },
};

const SYSTEM = `You turn a café manager's scheduling conditions into structured rules for an automatic weekly schedule.
Rule types:
- off: the person does not work on the given days.
- available: the person may only work between "from" and "to" on the given days (null "from" = from opening, null "to" = until closing). "Jawad can work on Tuesday after 8" -> available, days [2], from the time meant, to null.
- fixed: the person must work exactly from "from" to "to" on the given days.
- maxHours / minHours: weekly hours for the person, in "number".
- maxDays: the most days the person works this week, in "number".
- minStaff: at least "number" baristas at the café on the given days between "from" and "to" (person null).
Rules:
- "person" is the username from the list of baristas (match first names, nicknames and spelling variants); null only for minStaff.
- "days" uses 0=Sunday … 6=Saturday; an empty list means every day of the week.
- Times are 24-hour "HH:MM". Decide am/pm from the café's opening hours (for example "after 8" in a café that opens at 07:00 means 08:00, but "until 2" in the afternoon means 14:00). A time after midnight (e.g. "until 1am") is written "01:00".
- "text" is the part of the manager's words the rule comes from.
- If a sentence cannot be turned into these rules, or names someone not in the list, put the sentence in "unclear" with a short reason instead of guessing.`;

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

export async function handlePlanner({ request, env, head, me, need, isOwner, passwordOk, getSetting, setSetting, audit, fail }) {
  const db = env.DB;
  const url = new URL(request.url);
  if (head === 'demand') {
    if (request.method === 'GET') {
      need(me, 'scheduler');
      const d = await getSetting(db, 'demand');
      return d ? json({ demand: d }) : json({ error: 'No sales pattern saved yet.' }, 404);
    }
    if (request.method === 'PUT') {
      // the owner's browser saves it after loading the sales; an admin's browser can too (worked out from the saved sales)
      const canSave = isOwner(me) || (me && (',' + me.roles + ',').includes(',scheduler,')) || (await passwordOk(env, request.headers.get('x-upload-password')));
      if (!canSave) fail(401, 'Only the owner or an admin can save the sales pattern.');
      const b = await request.json().catch(() => null);
      if (!b || !Array.isArray(b.days) || b.days.length !== 7) fail(400, 'Not a sales pattern.');
      await setSetting(db, 'demand', { ...b, savedAt: new Date().toISOString() });
      return json({ ok: true });
    }
  }
  need(me, 'scheduler');
  if (head === 'plan-settings') {
    if (request.method === 'GET') return json({ settings: await getSetting(db, 'planSettings') });
    const b = await request.json().catch(() => null);
    if (!b || typeof b !== 'object') fail(400, 'Not valid settings.');
    await setSetting(db, 'planSettings', b);
    return json({ ok: true });
  }
  if (head === 'plan-rules') {
    const week = url.searchParams.get('week');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week || '')) fail(400, 'Choose a week.');
    if (request.method === 'GET') {
      // this week's conditions, or the most recent earlier week's as a starting point
      const own = await getSetting(db, 'rules:' + week);
      if (own) return json({ ...own, week, copied: false });
      const prev = await db.prepare("SELECT key, value FROM settings WHERE key LIKE 'rules:%' AND key < ? ORDER BY key DESC LIMIT 1").bind('rules:' + week).first();
      return json(prev ? { ...JSON.parse(prev.value), week, copied: prev.key.slice(6) } : { text: '', rules: [], week, copied: false });
    }
    const b = await request.json().catch(() => null);
    if (!b || !Array.isArray(b.rules)) fail(400, 'Not valid conditions.');
    await setSetting(db, 'rules:' + week, { text: String(b.text || '').slice(0, 4000), rules: b.rules.slice(0, 200) });
    return json({ ok: true });
  }
  if (head === 'plan-parse' && request.method === 'POST') {
    // Claude when an Anthropic key is set, otherwise Cloudflare Workers AI (free allowance on the Cloudflare account)
    if (!env.ANTHROPIC_API_KEY && !env.AI) fail(501, 'No AI is connected to the website, so only the built-in reader is used. Rephrase like the examples, or add these with “Add a condition”.');
    const b = await request.json().catch(() => null);
    const text = String(b?.text || '').trim().slice(0, 4000);
    if (!text) fail(400, 'Write the conditions first.');
    const people = (await db.prepare("SELECT name, username FROM users WHERE active = 1 AND (',' || roles || ',') LIKE '%,barista,%'").all()).results;
    const hours = Array.isArray(b?.hours) ? b.hours : [];
    const context = [
      `Week starting ${b?.week || ''} (Monday).`,
      'Baristas (name -> username):',
      ...people.map((p) => `- ${p.name} -> ${p.username}`),
      'Café opening hours:',
      ...hours.map((h, i) => `- ${DAY_NAMES[i]}: ${h ? `${h.open}–${h.close}` : 'closed'}`),
      '',
      'Conditions written by the manager:',
      text,
    ].join('\n');
    const parsed = env.ANTHROPIC_API_KEY ? await withClaude(env, context, fail) : await withWorkersAI(env, context, fail);
    const known = new Set(people.map((p) => p.username.toLowerCase()));
    const unclear = [...parsed.unclear];
    const rules = [];
    for (const r of parsed.rules) {
      if (r.type !== 'minStaff' && !(r.person && known.has(r.person.toLowerCase()))) { unclear.push(`${r.text || r.person}: no barista with that name`); continue; }
      rules.push({ ...r, person: r.type === 'minStaff' ? null : r.person.toLowerCase(), source: env.ANTHROPIC_API_KEY ? 'claude' : 'cloudflare-ai' });
    }
    await audit(db, me, 'plan.parse', { rules: rules.length, unclear: unclear.length, by: env.ANTHROPIC_API_KEY ? 'claude' : 'workers-ai' });
    return json({ rules, unclear, by: env.ANTHROPIC_API_KEY ? 'Claude' : 'Cloudflare AI' });
  }
  fail(405, 'Not allowed.');
}

async function withClaude(env, context, fail) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  let res;
  try {
    res = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: RULES_SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: context }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) fail(502, 'The Anthropic API key on the website is not valid.');
    if (e instanceof Anthropic.RateLimitError) fail(503, 'Too many requests to Claude right now. Try again in a minute.');
    if (e instanceof Anthropic.APIError) fail(502, `Claude could not read the conditions (error ${e.status}). Try again.`);
    throw e;
  }
  if (res.stop_reason === 'refusal') fail(422, 'Claude declined to read these conditions. Please rephrase them.');
  const out = res.content.find((c) => c.type === 'text');
  try { return JSON.parse(out?.text || ''); } catch { return fail(502, 'Claude’s answer could not be read. Try again.'); }
}

// Workers AI: a simpler schema (no null types), "" / 0 mean "not given".
const CF_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const CF_SCHEMA = {
  type: 'object',
  required: ['rules', 'unclear'],
  properties: {
    rules: {
      type: 'array',
      items: {
        type: 'object',
        required: ['type', 'person', 'days', 'from', 'to', 'number', 'text'],
        properties: {
          type: { type: 'string', enum: ['off', 'available', 'fixed', 'maxHours', 'minHours', 'maxDays', 'minStaff'] },
          person: { type: 'string' },
          days: { type: 'array', items: { type: 'integer' } },
          from: { type: 'string' },
          to: { type: 'string' },
          number: { type: 'number' },
          text: { type: 'string' },
        },
      },
    },
    unclear: { type: 'array', items: { type: 'string' } },
  },
};
const CF_RULES = '\nAnswer with JSON only. Use "" for a missing person, from or to, and 0 for a missing number.';

async function withWorkersAI(env, context, fail) {
  let res;
  try {
    res = await env.AI.run(CF_MODEL, {
      messages: [{ role: 'system', content: SYSTEM + CF_RULES }, { role: 'user', content: context }],
      response_format: { type: 'json_schema', json_schema: CF_SCHEMA },
      max_tokens: 2048,
      temperature: 0,
    });
  } catch (e) {
    console.error('workers ai', e);
    const m = String(e?.message || e);
    if (/limit|quota|neurons|429/i.test(m)) fail(503, 'The free Cloudflare AI allowance for today is used up. Try again tomorrow, or add the conditions with “Add a condition”.');
    if (/not enabled|authorized|10000|permission/i.test(m)) fail(503, 'Cloudflare AI is not switched on for this account yet (Cloudflare dashboard → AI → Workers AI).');
    fail(502, 'Cloudflare AI could not read the conditions. Try again, or add them with “Add a condition”.');
  }
  let out = res?.response;
  if (typeof out === 'string') { try { out = JSON.parse(out); } catch { out = null; } }
  if (!out || !Array.isArray(out.rules)) fail(502, 'Cloudflare AI gave an answer that could not be read. Try again, or add the conditions by hand.');
  const time = (t) => (typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : null);
  const TYPES = ['off', 'available', 'fixed', 'maxHours', 'minHours', 'maxDays', 'minStaff'];
  return {
    rules: out.rules.filter((r) => r && TYPES.includes(r.type)).map((r) => ({
      type: r.type,
      person: r.person ? String(r.person) : null,
      days: Array.isArray(r.days) ? [...new Set(r.days.map(Number).filter((d) => d >= 0 && d <= 6))] : [],
      from: time(r.from), to: time(r.to),
      number: Number(r.number) > 0 ? Number(r.number) : null,
      text: String(r.text || ''),
    })),
    unclear: Array.isArray(out.unclear) ? out.unclear.map(String) : [],
  };
}

export const PLANNER_ROUTES = ['demand', 'plan-settings', 'plan-rules', 'plan-parse'];
