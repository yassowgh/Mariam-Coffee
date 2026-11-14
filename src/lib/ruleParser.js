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

const EVERYONE = /\b(everyone|everybody|all baristas|all the baristas|every barista|each barista|all staff|all employees|each one|each of them|all of them)\b/;

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}
const NOT_NAMES = new Set(['after', 'before', 'from', 'until', 'only', 'work', 'works', 'shift', 'shifts', 'hours', 'days', 'week', 'with', 'they', 'them', 'have', 'there', 'each', 'every', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'morning', 'evening', 'night', 'close', 'open', 'least', 'most', 'baristas', 'barista', 'people', 'weekend', 'weekdays']);

const AR_LAT = { ا: '', ء: '', ئ: '', ؤ: '', ب: 'b', ت: 't', ث: 't', ج: 'j', ح: 'h', خ: 'k', د: 'd', ذ: 'd', ر: 'r', ز: 'z', س: 's', ش: 's', ص: 's', ض: 'd', ط: 't', ظ: 'z', ع: '', غ: 'g', ف: 'f', ق: 'k', ك: 'k', ل: 'l', م: 'm', ن: 'n', ه: 'h', ة: '', و: '', ي: '', ى: '' };
/** Consonant outline of a name in Latin or Arabic letters: "Basel" / "باسل" -> "bsl". */
function skeleton(name) {
  const lat = /[\u0600-\u06FF]/.test(name)
    ? [...name].map((c) => AR_LAT[c] ?? '').join('')
    : name.toLowerCase().replace(/th/g, 't').replace(/kh/g, 'k').replace(/gh/g, 'g').replace(/sh/g, 's').replace(/q|c/g, 'k').replace(/[^a-z]/g, '').replace(/[aeiouyw]/g, '');
  return lat.replace(/(.)\1+/g, '$1');
}

/** Find the people named in a sentence (first name, full name or username, small typos allowed, or "everyone"). */
function readPeople(s, people) {
  if (EVERYONE.test(s)) return [...people];
  const hits = [];
  for (const p of people) {
    const names = new Set([p.username, p.name, ...p.name.split(/\s+/)].map((n) => n.toLowerCase()).filter((n) => n.length >= 3));
    for (const n of names) {
      const re = new RegExp(`(^|[^a-z])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`);
      if (re.test(s)) { hits.push(p); break; }
    }
  }
  // names written in Arabic letters ("باسل" = Basel): compare the consonants
  for (const w of s.match(/[\u0621-\u064A]{3,}/g) || []) {
    const sk = skeleton(w);
    if (!sk) continue;
    const same = people.filter((p) => skeleton(p.name.split(/\s+/)[0]) === sk || skeleton(p.username) === sk);
    if (same.length === 1 && !hits.includes(same[0])) hits.push(same[0]);
  }
  // typos such as "esissa" for Essa: a word close to exactly one first name
  for (const w of s.match(/[a-zçğıöşü]{4,}/g) || []) {
    if (NOT_NAMES.has(w)) continue;
    const close = people.filter((p) => {
      const f = p.name.split(/\s+/)[0].toLowerCase();
      return f.length >= 4 && w[0] === f[0] && editDistance(w, f) <= (f.length >= 5 ? 2 : 2) && editDistance(w, f) > 0;
    });
    if (close.length === 1 && !hits.includes(close[0])) hits.push(close[0]);
  }
  return hits;
}

// ---- Arabic: turned into the English words the reader understands (days, morning/evening, from/to, except, off)
const AR_DAYS = [['احد', 'sunday'], ['اثنين', 'monday'], ['اتنين', 'monday'], ['ثلاثاء', 'tuesday'], ['ثلاثا', 'tuesday'], ['تلات', 'tuesday'],
  ['اربعاء', 'wednesday'], ['اربعا', 'wednesday'], ['خميس', 'thursday'], ['جمعه', 'friday'], ['سبت', 'saturday']];
export function arabicToEnglish(t) {
  if (!/[؀-ۿ]/.test(t)) return t;
  let s = t
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6F0))
    .replace(/[ً-ْـ]/g, '') // tashkeel, tatweel
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/،/g, ',').replace(/؛/g, ';');
  const W = (re, en) => { s = s.replace(new RegExp(`(^|[\\s,(:-])(?:${re})(?=$|[\\s,.;:)-])`, 'g'), `$1 ${en} `); };
  W('كل يوم|كل الايام|يوميا|طول الاسبوع', 'every day');
  W('نهايه الاسبوع|الويكند|ويكند', 'weekend');
  for (const [ar, en] of AR_DAYS) W(`(?:و|ب|ل)?(?:يوم\\s*)?(?:ال)?${ar}`, en);
  // times: "11 الصباح" / "8 مساء" / "1 بالليل"
  s = s.replace(/(\d{1,2}(?:[:.]\d{2})?)\s*(?:ال|في ال|بال)?(?:صباحا|صباح|ص)(?=$|[\s,.;:)-])/g, '$1am')
    // "at night": 12–4 are after midnight (am), 5–11 are evening (pm)
    .replace(/(\d{1,2}(?:[:.]\d{2})?)\s*(?:ال|في ال|بال)?(?:ليلا|ليل)(?=$|[\s,.;:)-])/g, (m, h) => { const n = Number(String(h).split(/[:.]/)[0]); return n === 12 || n <= 4 ? `${h}am` : `${h}pm`; })
    .replace(/(\d{1,2}(?:[:.]\d{2})?)\s*(?:ال|في ال|بال)?(?:مساءا|مساء|مسا|م|عصرا|عصر)(?=$|[\s,.;:)-])/g, '$1pm')
    .replace(/(\d{1,2}(?:[:.]\d{2})?)\s*(?:ال|بال)?(?:ظهرا|ظهر)(?=$|[\s,.;:)-])/g, (m, h) => (Number(h) === 12 ? '12pm' : `${h}pm`));
  W('الساعه|ساعه ال', '');
  W('من', 'from');
  W('الي|حتي|لغايه|لحد|للساعه|ل', 'to');
  W('الا|ما عدا|ماعدا|عدا|باستثناء|ما عدا يوم', 'except');
  W('اجازه|اجازته|عطله|راحه|اوف|فري', 'off');
  W('بعد', 'after');
  W('قبل', 'before');
  W('علي الاكثر|كحد اقصي|بحد اقصي|اقصي حد|اقصي|اكثر شي', 'at most');
  W('علي الاقل|كحد ادني|بحد ادني|ادني', 'at least');
  W('باريستا|باريستات|موظف|موظفين|اشخاص|شخص', 'baristas');
  W('ساعات|ساعه', 'hours');
  W('ايام', 'days');
  W('لا يستطيع|ما بيقدر|ما يقدر|لا يمكنه|لا يقدر|مش فاضي|مو فاضي', 'cant work');
  W('يعمل|يشتغل|دوامه|دوام', 'works');
  W('مواعيد العمل|ساعات العمل|نفتح|الفتح', 'working hours are');
  W('و', 'and');
  return s.replace(/\s+/g, ' ').trim();
}

/** Puts each condition next to its person: a line with only a name ("Essa:") applies to the lines below it,
 *  and a line starting with "except …" belongs to the line before. */
function groupLines(text, people) {
  const out = [];
  let current = null;
  for (const raw of text.split(/\n/)) {
    const line = arabicToEnglish(raw.trim());
    if (!line) { current = null; continue; } // an empty line ends a person's block
    const bare = line.replace(/[:：\-–]+\s*$/, '').trim();
    const named = readPeople(' ' + bare.toLowerCase() + ' ', people);
    const hasCondition = /\d|\b(off|every|daily|from|to|after|before|except|works?|cant|can|at|most|least|max|min|hours?|days?|only|available|weekends?|weekdays?|sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)\b/i.test(bare);
    if (named.length === 1 && bare.split(/\s+/).length <= 3 && !hasCondition) { current = bare; continue; }
    if (/^(except|but|apart from)\b/i.test(line) && out.length) { out[out.length - 1] += ' ' + line; continue; }
    const cafeWide = /\b(\d+|one|two|three|four|five|six)\s+(baristas?|people|persons|staff|workers|employees)\b|\b(working hours|opening hours|business hours|we (open|close)|close at|open at)\b/i.test(line);
    out.push(current && !named.length && !cafeWide && !EVERYONE.test(' ' + line.toLowerCase() + ' ') ? `${current}: ${line}` : line);
  }
  return out.join('\n');
}

function sentences(text) {
  return text.split(/\n|;|\.(?=\s|$)(?!\d)/).map((x) => x.trim()).filter(Boolean);
}

// "Jawad is off on Wednesday and works only after 4 PM" = two conditions for the same person
const CLAUSE = /\s+(?:and|but|,)\s+(?=(?:is|are|works?|can|cant|cannot|only|off|not|does|doesnt|dont|wont|will|should|must|has|have|max|maximum|at|no)\b)/;

export function parseConditions(text, people) {
  const rules = [], unclear = [];
  for (const original of sentences(groupLines(text, people))) {
    const norm = (x) => ' ' + x.toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ') + ' ';
    const clauses = norm(original).trim().split(CLAUSE);
    let subject = null;
    const errors = [];
    for (const c of clauses) {
      let s = ' ' + c + ' ';
      const named = readPeople(s, people);
      if (named.length) subject = named;
      const r = readOne(s, people, named.length ? null : subject);
      if (r.error) errors.push(r.error);
      else for (const rule of r.rules) rules.push({ ...rule, text: original, source: 'built-in' });
    }
    if (errors.length) unclear.push(`${original}: ${errors[0]}`);
  }
  return { rules, unclear };
}

function readOne(s, people, inherited) {
  const ex = /\b(?:except|apart from|but not)\b/.exec(s);
  if (ex) {
    const main = s.slice(0, ex.index) + ' ', rest = ' ' + s.slice(ex.index + ex[0].length) + ' ';
    const exDays = readDays(rest);
    if (exDays.found && exDays.days.length) {
      const m = readOne(main, people, inherited);
      if (m.error) return m;
      const who = readPeople(main, people).length ? readPeople(main, people) : inherited || [];
      const out = [];
      for (const r of m.rules) {
        const base = r.days && r.days.length ? r.days : [0, 1, 2, 3, 4, 5, 6];
        out.push({ ...r, days: base.filter((d) => !exDays.days.includes(d)) });
      }
      const between = new RegExp(`(?:from|between)?\\s*${TIME}\\s*(?:-|–|to|till|until|and)\\s*${TIME}`).exec(rest);
      const isOff = /\b(off|holiday|leave|free|rest)\b/.test(rest) || !between;
      const sample = m.rules[0];
      for (const p of who) {
        if (isOff) out.push({ type: 'off', person: p.username, days: exDays.days, from: null, to: null, number: null });
        else {
          const from = readTime(between[1]), to = readTime(between[2]);
          if (!from || !to) return { error: 'the times after “except” could not be read' };
          out.push({ type: sample && sample.type === 'fixed' ? 'fixed' : 'available', person: p.username, days: exDays.days, from, to, number: null });
        }
      }
      return { rules: out };
    }
  }
  const found = readPeople(s, people);
  const who = found.length ? found : inherited || [];
  const { days, found: hasDays } = readDays(s);
  const between = new RegExp(`(?:from|between)?\\s*${TIME}\\s*(?:-|–|to|till|until|and)\\s*${TIME}`).exec(s);
  const after = new RegExp(`\\b(?:after|from|starting(?: at)?|not before)\\s+${TIME}`).exec(s);
  const before = new RegExp(`\\b(?:before|until|till|up to|not after|by)\\s+${TIME}`).exec(s);
  const negative = /\b(cant|cannot|can not|not available|unavailable|doesnt|does not|dont|do not|wont|will not|isnt|is not|not working|no work)\b/.test(s);

  // café-wide minimum staff: "at least 2 baristas on friday from 17:00"
  const staff = /\b(at least|minimum|min|at most|maximum|max|no more than|not more than|up to)?\s*(\d+|one|two|three|four|five|six)\s+(baristas?|people|persons|staff|workers|employees)\b/.exec(s);
  if (staff && !who.length) {
    const n = NUMS[staff[2]] ?? Number(staff[2]);
    const from = between ? readTime(between[1]) : after ? readTime(after[1]) : null;
    const to = between ? readTime(between[2]) : before ? readTime(before[1]) : null;
    const isMax = /^(at most|maximum|max|no more than|not more than|up to)$/.test(staff[1] || '') || /\b(at most|maximum|max|no more than|not more than)\b/.test(s);
    return { rules: [{ type: isMax ? 'maxStaff' : 'minStaff', person: null, days, from, to, number: n }] };
  }
  // opening hours: "we close at 1 am", "we open at 9 on fridays"
  const closeAt = new RegExp(`\\b(?:close|closes|closing|shut)\\b(?:\\s+at)?\\s+${TIME}`).exec(s);
  const openAt = new RegExp(`\\b(?:open|opens|opening)\\b(?:\\s+at)?\\s+${TIME}`).exec(s);
  // "working hours are from 8 am to 1 am", "we are open 9–23"
  if (between && !found.length && !EVERYONE.test(s) && /\b(working hours|opening hours|open|we work|hours are|business hours|cafe hours|café hours)\b/.test(s)) {
    return { rules: [{ type: 'hours', person: null, days, from: readTime(between[1]), to: readTime(between[2]), number: null }] };
  }
  if ((closeAt || openAt) && !found.length) {
    return { rules: [{ type: 'hours', person: null, days, from: openAt ? readTime(openAt[1]) : null, to: closeAt ? readTime(closeAt[1]) : null, number: null }] };
  }
  if (!who.length) return { error: 'no barista name found (use the names in Team, or “everyone”)' };
  const each = (rule) => ({ rules: who.map((p) => ({ person: p.username, days: [], from: null, to: null, number: null, ...rule })) });

  // weekly limits
  const hours = readNumber(s, 'hours?|hrs?|h\\b');
  const nDays = readNumber(s, 'days?|shifts?');
  const most = /\b(at most|max|maximum|no more than|up to|not more than|less than|only)\b/.test(s);
  const least = /\b(at least|min|minimum|no less than|not less than|more than)\b/.test(s);
  if (hours != null && !between && !after && !before) {
    if (least) return each({ type: 'minHours', number: hours });
    void most;
    return each({ type: 'maxHours', number: hours }); // "can work 40 hours a week" = at most 40
  }
  // "has one day off" / "two days off a week" = works at most 7 − N days
  const daysOff = /\b(\d|one|two|three)\s+days?\s+off\b/.exec(s);
  if (daysOff && !hasDays) return each({ type: 'maxDays', number: 7 - (NUMS[daysOff[1]] ?? Number(daysOff[1])) });
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
    // a fixed shift needs a day and a clear "works / shift / must"; otherwise it is the time they can work
    const fixed = hasDays && /\b(works?|working|shift|must|will work|has to)\b/.test(s) && !/\b(can|could|available|only|between|prefers?|free to)\b/.test(s);
    return each({ type: fixed ? 'fixed' : 'available', days, from, to });
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
  'At most 3 baristas at the same time',
  'Essa: every day 11am to 8pm except Sunday and Wednesday 9am to 6pm',
  'باسل: كل يوم من ٩-٦ إلا الأحد إجازة',
  'Working hours are from 8 am to 1 am',
  'We close at 1am',
  'Everyone has one day off',
  'Everyone at most 40 hours',
];
