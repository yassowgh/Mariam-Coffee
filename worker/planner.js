// Automatic schedule helpers on the server:
//   GET/PUT /api/demand            sales pattern (average orders per weekday and hour), saved by the owner's browser
//   GET/PUT /api/plan-settings     settings for the automatic schedule (orders per barista per hour, overlap…)
//   GET/PUT /api/plan-rules?week=  the conditions written for one week
//   POST    /api/plan-parse        sentences the built-in reader could not read -> rules, with Claude
//                                  (if ANTHROPIC_API_KEY is set) or Cloudflare Workers AI (binding AI, free allowance)
import { aiChat, parseJson } from './ai.js';

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
          type: { type: 'string', enum: ['off', 'available', 'fixed', 'maxHours', 'minHours', 'maxDays', 'minStaff', 'maxStaff', 'hours'] },
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
- maxStaff: at most "number" baristas at the café at the same time, on the given days between "from" and "to" (person null).
- hours: the café's opening hours on the given days: "from" = opening time, "to" = closing time (person null). "We close at 1am" -> hours, from null, to "01:00".
- A condition about everyone ("everyone has one day off") becomes one rule per barista ("one day off" = maxDays 6).
- One sentence can hold several conditions ("off on Wednesday and works only after 4 PM" = off + available); return each.
Rules:
- "person" is the username from the list of baristas (match first names, nicknames and spelling variants); null only for minStaff, maxStaff and hours. The text may be in Arabic, English or Turkish; a line with only a name applies to the lines under it.
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
      need(me, 'manager', 'accountant');
      const d = await getSetting(db, 'demand');
      return d ? json({ demand: d }) : json({ error: 'No sales pattern saved yet.' }, 404);
    }
    if (request.method === 'PUT') {
      // the owner's browser saves it after loading the sales; an admin's browser can too (worked out from the saved sales)
      const canSave = isOwner(me) || (me && (',' + me.roles + ',').includes(',manager,')) || (await passwordOk(env, request.headers.get('x-upload-password')));
      if (!canSave) fail(401, 'Only the owner or an admin can save the sales pattern.');
      const b = await request.json().catch(() => null);
      if (!b || !Array.isArray(b.days) || b.days.length !== 7) fail(400, 'Not a sales pattern.');
      await setSetting(db, 'demand', { ...b, savedAt: new Date().toISOString() });
      return json({ ok: true });
    }
  }
  need(me, 'manager');
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
    // the AI rotation: Claude (if a key is set), Cloudflare AI, then the free keys in Settings → AI providers
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
    let parsed, by;
    try {
      const r = await aiChat(env, db, { system: SYSTEM + CF_RULES, text: context, schema: CF_SCHEMA, maxTokens: 2048,
        accept: (o) => Array.isArray(parseJson(o)?.rules) });
      parsed = normalize(parseJson(r.out)); by = r.by;
    } catch (e) { fail(503, `${e.message} You can still add the conditions with “Add a condition”.`); }
    // "off" with a time means "not during those hours": keep the rest of the day open
    for (const r of parsed.rules) {
      if (r.type === 'off' && (r.from || r.to)) {
        if (r.from) { r.type = 'available'; r.to = r.from; r.from = null; } else { r.type = 'available'; r.from = r.to; r.to = null; }
      }
    }
    const known = new Set(people.map((p) => p.username.toLowerCase()));
    const unclear = [...parsed.unclear];
    const rules = [];
    for (const r of parsed.rules) {
      if (!['minStaff', 'maxStaff', 'hours'].includes(r.type) && !(r.person && known.has(r.person.toLowerCase()))) { unclear.push(`${r.text || r.person}: no barista with that name`); continue; }
      rules.push({ ...r, person: ['minStaff', 'maxStaff', 'hours'].includes(r.type) ? null : r.person.toLowerCase(), source: /claude/i.test(by) ? 'claude' : 'ai' });
    }
    await audit(db, me, 'plan.parse', { rules: rules.length, unclear: unclear.length, by });
    return json({ rules, unclear, by: by.replace(/ \(.*\)$/, '') });
  }
  fail(405, 'Not allowed.');
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
          type: { type: 'string', enum: ['off', 'available', 'fixed', 'maxHours', 'minHours', 'maxDays', 'minStaff', 'maxStaff', 'hours'] },
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

/** The AI's rules, cleaned: "" / 0 mean not given; unknown types dropped. */
function normalize(out) {
  const time = (t) => (typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : null);
  const TYPES = ['off', 'available', 'fixed', 'maxHours', 'minHours', 'maxDays', 'minStaff', 'maxStaff', 'hours'];
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
