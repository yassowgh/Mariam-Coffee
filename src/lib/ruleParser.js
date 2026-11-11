// Built-in reader for schedule conditions written in plain English (free, instant, no AI).
// Every sentence becomes one or more rules, or goes to "unclear" with a reason; nothing is guessed.
//
// Times without am/pm: 7–11 = morning, 12 = noon, 1–6 = afternoon (13:00–18:00).
// Write "1am" or "01:00" for after midnight.

const DAYS = [
  [0, /^(sun|sunday|sundays)$/], [1, /^(mon|monday|mondays)$/], [2, /^(tue|tues|tuesday|tuesdays)$/],
  [3, /^(wed|weds|wednesday|wednesdays)$/], [4, /^(thu|thur|thurs|thursday|thursdays)$/],
  [5, /^(fri|friday|fridays)$/], [6, /^(sat|saturday|saturdays)$/],
];
const NUMS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
const dayOf = (w) => DAYS.find(([, re]) => re.test(w))?.[0];
const ORDER = [1, 2, 3, 4, 5, 6, 0];

function readDays(s) {
  if (/\b(every ?day|daily|all week|each day|whole week)\b/.test(s)) return { days: [], found: true };
  const out = new Set();
  let found = false;
  if (/\bweekends?\b/.test(s)) { out.add(6); out.add(0); found = true; }
  if (/\bweekdays?\b/.test(s)) { [1, 2, 3, 4, 5].forEach((d) => out.add(d)); found = true; }
  // ranges: "monday to thursday", "mon-thu", "from tue till fri"
  const DAYWORD = '(sun(?:day)?s?|mon(?:day)?s?|tue(?:s(?:day)?)?s?|wed(?:s|nesday)?s?|thu(?:r(?:s(?:day)?)?)?s?|fri(?:day)?s?|sat(?:urday)?s?)';
  const range = new RegExp(`\\b${DAYWORD}\\s*(?:-|–|to|till|until|through|thru)\\s*${DAYWORD}\\b`, 'g');
  let m;
  const used = [];
  while ((m = range.exec(s))) {
    const a = dayOf(m[1]), b = dayOf(m[2]);
    if (a == null || b == null) continue;
    let i = ORDER.indexOf(a);
    for (let guard = 0; guard < 7; guard++) { out.add(ORDER[i]); if (ORDER[i] === b) break; i = (i + 1) % 7; }
    used.push([m.index, m.index + m[0].length]);
    found = true;
  }
  for (const w of s.matchAll(/[a-z]+/g)) {
    if (used.some(([a, b]) => w.index >= a && w.index < b)) continue;
    const d = dayOf(w[0]);
    if (d != null) { out.add(d); found = true; }
  }
  return { days: [...out].sort((a, b) => a - b), found };
}

/** "8", "8am", "8:30 pm", "20:00", "8.30", "noon", "midnight" -> "HH:MM" */
export function readTime(raw) {
  const s = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (s === 'noon' || s === 'midday') return '12:00';
  if (s === 'midnight') return '00:00';
  const m = /^(\d{1,2})(?:[:.](\d{2}))?(am|pm|a\.m\.|p\.m\.)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (h > 23 || min > 59) return null;
  const ap = m[3]?.[0];
  if (ap === 'p' && h < 12) h += 12;
  else if (ap === 'a' && h === 12) h = 0;
  else if (!ap && !m[2] && h >= 1 && h <= 6) h += 12; // "until 4" = 16:00
  else if (!ap && m[2] && h >= 1 && h <= 6 && raw.trim().length <= 4) h += 12; // "4.30" = 16:30, but "04:30" stays
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
const TIME = '(\\d{1,2}(?:[:.]\\d{2})?\\s*(?:am|pm|a\\.m\\.|p\\.m\\.)?|noon|midday|midnight)';

function readNumber(s, unit) {
  const m = new RegExp(`(\\d+(?:\\.\\d+)?|${Object.keys(NUMS).join('|')})\\s*(?:${unit})`).exec(s);
  if (!m) return null;
  return NUMS[m[1]] ?? Number(m[1]);
}

/** Find the people named in a sentence (first name, full name or username). */
function readPeople(s, people) {
  const hits = [];
  for (const p of people) {
    const names = new Set([p.username, p.name, ...p.name.split(/\s+/)].map((n) => n.toLowerCase()).filter((n) => n.length >= 3));
    for (const n of names) {
      const re = new RegExp(`(^|[^a-z])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`);
      if (re.test(s)) { hits.push(p); break; }
    }
  }
  return hits;
}

function sentences(text) {
  return text.split(/\n|;|\.(?=\s|$)(?!\d)/).map((x) => x.trim()).filter(Boolean);
}

export function parseConditions(text, people) {
  const rules = [], unclear = [];
  for (const original of sentences(text)) {
    const s = ' ' + original.toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ') + ' ';
    const r = readOne(s, people);
    if (r.error) unclear.push(`${original}: ${r.error}`);
    else for (const rule of r.rules) rules.push({ ...rule, text: original, source: 'built-in' });
  }
  return { rules, unclear };
}

function readOne(s, people) {
  const who = readPeople(s, people);
  const { days, found: hasDays } = readDays(s);
  const between = new RegExp(`(?:from|between)?\\s*${TIME}\\s*(?:-|–|to|till|until|and)\\s*${TIME}`).exec(s);
  const after = new RegExp(`\\b(?:after|from|starting(?: at)?|not before)\\s+${TIME}`).exec(s);
  const before = new RegExp(`\\b(?:before|until|till|up to|not after|by)\\s+${TIME}`).exec(s);
  const negative = /\b(cant|cannot|can not|not available|unavailable|doesnt|does not|dont|do not|wont|will not|isnt|is not|not working|no work)\b/.test(s);

  // café-wide minimum staff: "at least 2 baristas on friday from 17:00"
  const staff = /\b(at least|minimum|min)?\s*(\d+|one|two|three|four|five|six)\s+(baristas?|people|persons|staff|workers|employees)\b/.exec(s);
  if (staff && !who.length) {
    const n = NUMS[staff[2]] ?? Number(staff[2]);
    const from = between ? readTime(between[1]) : after ? readTime(after[1]) : null;
    const to = between ? readTime(between[2]) : before ? readTime(before[1]) : null;
    return { rules: [{ type: 'minStaff', person: null, days, from, to, number: n }] };
  }
  if (!who.length) return { error: 'no barista name found (use the names in Team)' };
  const each = (rule) => ({ rules: who.map((p) => ({ person: p.username, days: [], from: null, to: null, number: null, ...rule })) });

  // weekly limits
  const hours = readNumber(s, 'hours?|hrs?|h\\b');
  const nDays = readNumber(s, 'days?|shifts?');
  const most = /\b(at most|max|maximum|no more than|up to|not more than|less than|only)\b/.test(s);
  const least = /\b(at least|min|minimum|no less than|not less than|more than)\b/.test(s);
  if (hours != null && !between && !after && !before) {
    if (least) return each({ type: 'minHours', number: hours });
    if (most || /\b(a|per|this) week\b/.test(s)) return each({ type: 'maxHours', number: hours });
    return { error: `say “at most ${hours} hours” or “at least ${hours} hours”` };
  }
  if (nDays != null && !hasDays && !between) {
    if (least) return { error: 'a minimum number of days is not supported; use “at least N hours”' };
    return each({ type: 'maxDays', number: nDays });
  }

  // day off
  const offWords = /\b(off|day off|days off|holiday|leave|vacation|rest|izin|free)\b/.test(s);
  if ((offWords || (negative && !after && !before && !between)) && !after && !before && !between) {
    if (!hasDays) return { error: 'which day? (e.g. “off on Friday”)' };
    return each({ type: 'off', days });
  }

  // times
  if (negative && (after || before)) {
    // "cant work after 18" -> only until 18; "cant work before 12" -> only from 12
    if (after) return each({ type: 'available', days, to: readTime(after[1]) });
    return each({ type: 'available', days, from: readTime(before[1]) });
  }
  if (between) {
    const from = readTime(between[1]), to = readTime(between[2]);
    if (!from || !to) return { error: 'the times could not be read; write them like 08:00 or 4pm' };
    const flexible = /\b(can|could|available|only|between|prefers?|free to)\b/.test(s);
    if (!hasDays && !flexible) return { error: 'which days? (e.g. “works Tuesday 08:00–16:00”)' };
    return each({ type: flexible ? 'available' : 'fixed', days, from, to });
  }
  if (after || before) {
    const from = after ? readTime(after[1]) : null, to = before ? readTime(before[1]) : null;
    if ((after && !from) || (before && !to)) return { error: 'the time could not be read; write it like 08:00 or 4pm' };
    return each({ type: 'available', days, from, to });
  }
  return { error: 'not understood; see the examples' };
}

export const PARSER_EXAMPLES = [
  'Jawad can work on Tuesday after 8',
  'Abrar is off on Friday',
  'Essa off on Saturday and Sunday',
  'Basel works Monday 08:00-16:00',
  'Jawad cant work after 6pm on weekdays',
  'Abrar at most 30 hours',
  'Essa at most 5 days',
  'At least 2 baristas on Friday from 17:00',
];
