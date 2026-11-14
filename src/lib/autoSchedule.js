// Automatic weekly schedule from the sales pattern and the manager's conditions.
//
// 1. Need per half hour = max(minimum staff, ceil(average orders in that hour / orders one barista handles per hour)).
// 2. Fixed shifts from the conditions go in first.
// 3. Then, again and again, the shift (person, day, start, length) that covers the most
//    uncovered need is added, preferring people with fewer hours so far, until the need is met
//    or nobody may work more.
// 4. Minimum weekly hours are topped up on the busiest times.
// 5. At every hand-over the incoming barista starts a little earlier, so shifts overlap.
// Times run on the café's business day (05:00 to 05:00), so a shift can end after midnight.

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SLOT = 30; // minutes
const SLOTS = 48;

export const DEFAULT_SETTINGS = {
  perBarista: 20, // orders one barista can handle in an hour
  minStaff: 1,
  maxStaff: null, // most baristas at the same time (null = no limit)
  overlap: 30, // minutes of overlap at a hand-over
  minShift: 4, // hours
  maxShift: 9,
  maxWeekHours: 45,
  maxDays: 6,
  hours: null, // [{ open, close } | null] per weekday (0 = Sunday); null = from the sales pattern
};

/** "HH:MM" -> half-hour slot of the business day (0 = 05:00). */
export const toSlot = (t) => {
  const [h, m] = t.split(':').map(Number);
  return Math.round((((h - 5 + 24) % 24) * 60 + m) / SLOT);
};
export const fromSlot = (k) => {
  const min = (k * SLOT + 300) % 1440;
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
};

/** Opening hours per weekday from the sales pattern: first to last hour with at least half an order on average. */
export function hoursFromDemand(demand) {
  return demand.days.map((day) => {
    if (day.orders < 1) return null;
    const busy = day.hours.filter((h) => h.orders >= 0.5).map((h) => (h.h - 5 + 24) % 24);
    if (!busy.length) return null;
    const first = Math.min(...busy), last = Math.max(...busy);
    return { open: fromSlot(first * 2), close: fromSlot((last + 1) * 2) };
  });
}

/** Average orders in each half-hour slot of a weekday. */
function slotOrders(demand, dow) {
  const out = new Array(SLOTS).fill(0);
  for (const h of demand.days[dow].hours) {
    const k = ((h.h - 5 + 24) % 24) * 2;
    out[k] = h.orders / 2;
    out[k + 1] = h.orders / 2;
  }
  return out;
}

const appliesTo = (r, dow) => !r.days || !r.days.length || r.days.includes(dow);

export function describeRule(r, people) {
  const who = r.person ? (people.find((p) => p.username.toLowerCase() === String(r.person).toLowerCase())?.name || r.person) : 'Café';
  const days = !r.days || !r.days.length || r.days.length === 7 ? 'every day' : [...r.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => DAY_SHORT[d]).join(', ');
  const span = r.from || r.to ? `${r.from || 'opening'}–${r.to || 'closing'}` : '';
  switch (r.type) {
    case 'off': return `${who} is off on ${days}`;
    case 'available': return `${who} can work ${span || 'any time'} on ${days}`;
    case 'fixed': return `${who} works ${span} on ${days}`;
    case 'maxHours': return `${who} works at most ${r.number} hours this week`;
    case 'minHours': return `${who} works at least ${r.number} hours this week`;
    case 'maxDays': return `${who} works at most ${r.number} days this week`;
    case 'minStaff': return `At least ${r.number} baristas ${span ? span + ' ' : ''}on ${days}`;
    case 'maxStaff': return `At most ${r.number} baristas at the same time ${span ? span + ' ' : ''}on ${days}`;
    case 'hours': return `Café ${[r.from && `opens ${r.from}`, r.to && `closes ${r.to}`].filter(Boolean).join(' and ')} on ${days}`;
    default: return r.text || r.type;
  }
}

/**
 * dates: the 7 dates of the week (Monday first); people: [{ id, name, username }]
 * Returns { shifts, days, people, warnings }.
 */
export function buildSchedule({ dates, people, demand, settings: s0, rules }) {
  const s = { ...DEFAULT_SETTINGS, ...s0 };
  // opening hours: settings or the sales pattern, then "we close at 1am"-type conditions
  const hours = (s.hours || hoursFromDemand(demand)).map((h, dow) => {
    let out = h ? { ...h } : null;
    for (const r of rules) {
      if (r.type !== 'hours' || !appliesTo(r, dow)) continue;
      if (!out) { if (r.from && r.to) out = { open: r.from, close: r.to }; continue; }
      if (r.from) out.open = r.from;
      if (r.to) out.close = r.to;
    }
    return out;
  });
  const warnings = [];
  const byUser = (name) => people.find((p) => p.username.toLowerCase() === String(name || '').toLowerCase());

  // ---- need per day and slot
  const days = dates.map((date) => {
    const dow = new Date(date + 'T00:00:00Z').getUTCDay();
    const oh = hours[dow];
    const orders = slotOrders(demand, dow);
    const need = new Array(SLOTS).fill(0);
    const cap = new Array(SLOTS).fill(s.maxStaff > 0 ? Number(s.maxStaff) : Infinity);
    let open = null, close = null;
    if (oh) {
      open = toSlot(oh.open);
      close = toSlot(oh.close) || SLOTS; // 05:00 close = end of business day
      if (close <= open) close = SLOTS;
      for (let k = open; k < close; k++) need[k] = Math.max(s.minStaff, Math.ceil((orders[k] * 2) / s.perBarista - 1e-9));
      for (const r of rules) {
        if (r.type !== 'minStaff' || !appliesTo(r, dow) || !r.number) continue;
        const a = r.from ? toSlot(r.from) : open, b = r.to ? (toSlot(r.to) || SLOTS) : close;
        for (let k = Math.max(a, open); k < Math.min(b, close); k++) need[k] = Math.max(need[k], r.number);
      }
      // "at most N baristas at the same time" (setting, or a condition for some days / hours)
      for (const r of rules) {
        if (r.type !== 'maxStaff' || !appliesTo(r, dow) || !r.number) continue;
        const a = r.from ? toSlot(r.from) : 0, b = r.to ? (toSlot(r.to) || SLOTS) : SLOTS;
        for (let k = a; k < b; k++) cap[k] = Math.min(cap[k], r.number);
      }
      for (let k = open; k < close; k++) need[k] = Math.min(need[k], cap[k]);
    }
    return { date, dow, open, close, orders, need, cap, cover: new Array(SLOTS).fill(0), dayOrders: demand.days[dow].orders };
  });

  // ---- what each person may do
  const st = new Map(people.map((p) => {
    const mine = rules.filter((r) => r.person && byUser(r.person)?.id === p.id);
    const num = (type, def) => {
      const r = mine.filter((x) => x.type === type && x.number != null);
      return r.length ? Math.min(...r.map((x) => x.number)) : def;
    };
    return [p.id, {
      p, rules: mine, hours: 0, days: new Set(),
      maxHours: num('maxHours', s.maxWeekHours), minHours: num('minHours', 0), maxDays: num('maxDays', s.maxDays),
    }];
  }));
  const windowFor = (x, day) => {
    if (x.rules.some((r) => r.type === 'off' && appliesTo(r, day.dow))) return null;
    let a = day.open, b = day.close;
    for (const r of x.rules) {
      if (r.type !== 'available' || !appliesTo(r, day.dow)) continue;
      if (r.from) a = Math.max(a, toSlot(r.from));
      if (r.to) b = Math.min(b, toSlot(r.to) || SLOTS);
    }
    return b > a ? [a, b] : null;
  };

  /** true if one more barista fits in [a, b) without going over "at most N at the same time" */
  const fits = (day, a, b) => { for (let k = a; k < b; k++) if (day.cover[k] >= day.cap[k]) return false; return true; };
  const shifts = [];
  const add = (x, di, a, b, kind) => {
    const day = days[di];
    for (let k = a; k < b; k++) day.cover[k]++;
    x.hours += (b - a) / 2;
    x.days.add(di);
    shifts.push({ user_id: x.p.id, di, a, b, kind });
  };

  // ---- fixed shifts first
  for (const x of st.values()) {
    for (const r of x.rules.filter((q) => q.type === 'fixed')) {
      days.forEach((day, di) => {
        if (!appliesTo(r, day.dow) || x.days.has(di)) return;
        if (!r.from || !r.to) { warnings.push(`“${describeRule(r, people)}” needs a start and end time; skipped.`); return; }
        const a = toSlot(r.from), b = toSlot(r.to) || SLOTS;
        if (b <= a) { warnings.push(`“${describeRule(r, people)}”: the end is before the start; skipped.`); return; }
        if (day.open == null) warnings.push(`${x.p.name} is fixed on ${DAY_NAMES[day.dow]}, but the café looks closed that day.`);
        if (!fits(day, a, b)) warnings.push(`${x.p.name}'s fixed shift on ${DAY_NAMES[day.dow]} goes over the most baristas allowed at the same time.`);
        add(x, di, a, b, 'fixed');
      });
    }
  }

  // ---- greedy cover
  const totalNeed = days.reduce((t, d) => t + d.need.reduce((u, v) => u + v, 0), 0) / 2;
  const target = Math.max(1, totalNeed / Math.max(1, people.length));
  const minLen = s.minShift * 2, maxLen = s.maxShift * 2;
  const weight = (day, k) => 1 + day.orders[k] / Math.max(1, s.perBarista / 2) * 0.25;
  // shiftCost: each extra shift uses up one of the person's days, so longer shifts are preferred
  const greedy = (wastePenalty, shiftCost) => {
  for (let guard = 0; guard < 200; guard++) {
    let best = null;
    for (const x of st.values()) {
      if (x.days.size >= x.maxDays) continue;
      days.forEach((day, di) => {
        if (day.open == null || x.days.has(di)) return;
        const w = windowFor(x, day);
        if (!w) return;
        const [wa, wb] = w;
        const lo = Math.min(minLen, wb - wa);
        if (lo < 2) return;
        for (let a = wa; a + lo <= wb; a++) {
          let gain = 0, waste = 0;
          for (let b = a + 1; b <= Math.min(wb, a + maxLen); b++) {
            const k = b - 1;
            if (day.cover[k] >= day.cap[k]) break; // already the most baristas allowed then
            if (day.cover[k] < day.need[k]) gain += weight(day, k); else waste += 1;
            const len = b - a;
            if (len < lo || x.hours + len / 2 > x.maxHours) continue;
            if (gain <= 0) continue;
            const score = (gain - wastePenalty * waste - shiftCost) / (1 + 1.0 * (x.hours / target)) - 0.01 * len;
            if (!best || score > best.score) best = { score, x, di, a, b };
          }
        }
      });
    }
    if (!best || best.score <= 0) break;
    add(best.x, best.di, best.a, best.b, 'auto');
  }
  };
  greedy(0.35, 3);

  // ---- small gaps: stretch a neighbouring shift (up to 1 hour past the longest shift) before adding new ones
  const stretch = () => {
    for (const day of days) {
      if (day.open == null) continue;
      const di = days.indexOf(day);
      for (let k = day.open; k < day.close; k++) {
        if (day.cover[k] >= day.need[k]) continue;
        let e = k;
        while (e < day.close && day.cover[e] < day.need[e]) e++;
        const cands = shifts.filter((sh) => sh.di === di && sh.kind !== 'fixed' && (sh.b === k || sh.a === e));
        for (const sh of cands) {
          const x = st.get(sh.user_id);
          const w = windowFor(x, day);
          const a = sh.b === k ? sh.a : k, b = sh.b === k ? e : sh.b;
          if (!w || a < w[0] || b > w[1] || b - a > maxLen + 2 || x.hours + (e - k) / 2 > x.maxHours || !fits(day, k, e)) continue;
          for (let q = k; q < e; q++) day.cover[q]++;
          x.hours += (e - k) / 2;
          sh.a = a; sh.b = b;
          break;
        }
        k = e;
      }
    }
  };
  stretch();
  greedy(0.15, 0.25);

  // ---- share the work: move whole shifts from the person with the most hours to one with far fewer
  for (let guard = 0; guard < 60; guard++) {
    const order = [...st.values()].sort((p, q) => p.hours - q.hours);
    let moved = false;
    for (const lo of order) {
      for (const hi of [...order].reverse()) {
        if (hi === lo || hi.hours - lo.hours < s.minShift) continue;
        const cand = shifts.filter((sh) => sh.user_id === hi.p.id && sh.kind === 'auto' && !lo.days.has(sh.di) && lo.days.size < lo.maxDays
          && lo.hours + (sh.b - sh.a) / 2 <= lo.maxHours && (sh.b - sh.a) / 2 < hi.hours - lo.hours); // only if it makes them closer
        const sh = cand.find((c) => { const w = windowFor(lo, days[c.di]); return w && w[0] <= c.a && w[1] >= c.b; });
        if (!sh) continue;
        const len = (sh.b - sh.a) / 2;
        hi.hours -= len; hi.days.delete(sh.di);
        lo.hours += len; lo.days.add(sh.di);
        sh.user_id = lo.p.id;
        moved = true;
        break;
      }
      if (moved) break;
    }
    if (!moved) {
      // no whole shift fits: split one. The person with fewer hours takes the start or the end of a long shift
      // (at least the shortest shift length); the busy person keeps at least 2 hours of it.
      for (const hi of [...order].reverse()) {
        for (const lo of order) {
          if (hi === lo || hi.hours - lo.hours < s.minShift || lo.days.size >= lo.maxDays) continue;
          for (const sh of shifts.filter((x) => x.user_id === hi.p.id && x.kind === 'auto' && !lo.days.has(x.di))) {
            const day = days[sh.di];
            const w = windowFor(lo, day);
            if (!w) continue;
            const opts = [[sh.a, Math.min(sh.b, w[1])], [Math.max(sh.a, w[0]), sh.b]]
              .filter(([ta, tb]) => ta >= w[0] && tb <= w[1] && tb - ta >= minLen && tb - ta <= maxLen && (ta === sh.a || tb === sh.b));
            for (const [ta, tb] of opts) {
              const rest = ta === sh.a ? [tb, sh.b] : [sh.a, ta];
              if (rest[1] - rest[0] < 4) continue;
              const give = (tb - ta) / 2, keep = (rest[1] - rest[0]) / 2;
              const before = Math.abs(hi.hours - lo.hours);
              const after = Math.abs((hi.hours - (sh.b - sh.a) / 2 + keep) - (lo.hours + give));
              if (after >= before || lo.hours + give > lo.maxHours) continue;
              hi.hours -= (sh.b - sh.a) / 2 - keep;
              sh.a = rest[0]; sh.b = rest[1];
              shifts.push({ user_id: lo.p.id, di: sh.di, a: ta, b: tb, kind: 'auto' });
              for (let k = ta; k < tb; k++) day.cover[k]++; // the overlap part is now covered twice; the trimmed part stays covered by lo
              for (let k = ta; k < tb; k++) if (k < rest[0] || k >= rest[1]) day.cover[k]--;
              lo.hours += give; lo.days.add(sh.di);
              moved = true;
              break;
            }
            if (moved) break;
          }
          if (moved) break;
        }
        if (moved) break;
      }
    }
    if (!moved) break;
  }

  // the moves above can leave small gaps: close them again
  stretch();
  greedy(0.15, 0.25);

  // ---- repair: a gap only one person could cover, but they have no hours left.
  // Give part of one of their other shifts to someone free that day, then use the freed hours for the gap.
  const gapsOf = (day) => {
    const out = [];
    if (day.open == null) return out;
    for (let k = day.open; k < day.close; k++) {
      if (day.cover[k] >= day.need[k]) continue;
      let e = k;
      while (e < day.close && day.cover[e] < day.need[e]) e++;
      out.push([k, e]);
      k = e;
    }
    return out;
  };
  const coverRange = (day, a, b, d) => { for (let k = a; k < b; k++) day.cover[k] += d; };
  for (let guard = 0; guard < 20; guard++) {
    let fixed = false;
    for (const [gi, gday] of days.entries()) {
      for (const [ga, gb] of gapsOf(gday)) {
        for (const p of st.values()) {
          if (p.days.has(gi) || p.days.size >= p.maxDays && !p.days.has(gi)) continue;
          const pw = windowFor(p, gday);
          if (!pw) continue;
          // the shift P would work on the gap day: the gap, widened to the shortest shift inside P's window
          let na = Math.max(pw[0], ga), nb = Math.min(pw[1], gb);
          if (nb <= na) continue;
          while (nb - na < minLen && (na > pw[0] || nb < pw[1])) { if (nb < pw[1]) nb++; else na--; }
          if (!fits(gday, na, nb)) continue;
          const needH = (nb - na) / 2 - (p.maxHours - p.hours);
          if (needH <= 0) continue; // not an hours problem
          for (const sh of shifts.filter((x) => x.user_id === p.p.id && x.kind === 'auto' && x.di !== gi)) {
            const day = days[sh.di];
            for (const q of st.values()) {
              if (q === p || q.days.has(sh.di) || q.days.size >= q.maxDays) continue;
              const qw = windowFor(q, day);
              if (!qw) continue;
              // Q takes the start or the end of P's shift
              const opts = [[sh.a, Math.min(sh.b, qw[1])], [Math.max(sh.a, qw[0]), sh.b]].filter(([ta, tb]) => ta >= qw[0] && tb <= qw[1] && tb - ta >= minLen);
              for (const [ta, tb] of opts) {
                const rest = ta === sh.a ? [tb, sh.b] : [sh.a, ta];
                const restLen = rest[1] - rest[0];
                if (restLen > 0 && restLen < Math.min(minLen, 4)) continue;
                const freed = (sh.b - sh.a - Math.max(0, restLen)) / 2;
                if (freed < needH || q.hours + (tb - ta) / 2 > q.maxHours) continue;
                // apply: Q gets [ta, tb), P keeps the rest, P works the gap
                coverRange(day, sh.a, sh.b, -1);
                if (restLen > 0) { sh.a = rest[0]; sh.b = rest[1]; coverRange(day, sh.a, sh.b, 1); } else { shifts.splice(shifts.indexOf(sh), 1); p.days.delete(sh.di); }
                p.hours -= freed;
                add(q, sh.di, ta, tb, 'auto');
                add(p, gi, na, nb, 'auto');
                fixed = true;
                break;
              }
              if (fixed) break;
            }
            if (fixed) break;
          }
          if (fixed) break;
        }
        if (fixed) break;
      }
      if (fixed) break;
    }
    if (!fixed) break;
  }

  // ---- top up minimum hours on the busiest free times
  for (const x of st.values()) {
    for (let guard = 0; x.hours < x.minHours && guard < 7; guard++) {
      let best = null;
      days.forEach((day, di) => {
        if (day.open == null || x.days.has(di) || x.days.size >= x.maxDays) return;
        const w = windowFor(x, day);
        if (!w) return;
        const len = Math.min(maxLen, w[1] - w[0], Math.max(minLen, Math.ceil((x.minHours - x.hours) * 2)));
        for (let a = w[0]; a + len <= w[1]; a++) {
          if (!fits(day, a, a + len)) continue;
          let v = 0;
          for (let k = a; k < a + len; k++) v += day.orders[k] / (day.cover[k] + 1);
          if (!best || v > best.v) best = { v, di, a, b: a + len };
        }
      });
      if (!best) break;
      add(x, best.di, best.a, best.b, 'auto');
    }
    if (x.hours < x.minHours) warnings.push(`${x.p.name} gets ${x.hours} hours, less than the ${x.minHours} asked for (not enough free days or times).`);
  }

  // ---- overlap at hand-overs: the incoming barista starts a bit earlier
  const ov = Math.round(s.overlap / SLOT);
  if (ov > 0) {
    for (const sh of shifts) {
      if (sh.kind === 'fixed') continue;
      const day = days[sh.di];
      const handover = shifts.some((o) => o !== sh && o.di === sh.di && o.b === sh.a);
      if (!handover) continue;
      const x = st.get(sh.user_id);
      const w = windowFor(x, day);
      const a = Math.max(day.open, w ? w[0] : day.open, sh.a - ov);
      if (a < sh.a && fits(day, a, sh.a)) {
        for (let k = a; k < sh.a; k++) day.cover[k]++;
        x.hours += (sh.a - a) / 2;
        sh.a = a;
      } else {
        // could not start earlier: let the outgoing barista stay a bit longer
        const o = shifts.find((q) => q !== sh && q.di === sh.di && q.b === sh.a && q.kind !== 'fixed');
        const ow = o && windowFor(st.get(o.user_id), day);
        const b = o ? Math.min(day.close, ow ? ow[1] : day.close, o.b + ov) : 0;
        if (o && b > o.b && fits(day, o.b, b)) {
          for (let k = o.b; k < b; k++) day.cover[k]++;
          st.get(o.user_id).hours += (b - o.b) / 2;
          o.b = b;
        }
      }
    }
  }

  // ---- report gaps
  for (const day of days) {
    if (day.open == null) continue;
    let k = day.open;
    while (k < day.close) {
      if (day.cover[k] >= day.need[k]) { k++; continue; }
      const a = k, needMax = day.need[k], have = day.cover[k];
      while (k < day.close && day.cover[k] < day.need[k]) k++;
      // say why nobody else could take it
      const di = days.indexOf(day);
      const why = [...st.values()].filter((x) => !shifts.some((sh) => sh.user_id === x.p.id && sh.di === di && sh.a <= a && sh.b >= k)).map((x) => {
        const w = windowFor(x, day);
        if (x.rules.some((r) => r.type === 'off' && appliesTo(r, day.dow))) return `${x.p.name.split(' ')[0]} is off`;
        if (shifts.some((sh) => sh.user_id === x.p.id && sh.di === di)) return `${x.p.name.split(' ')[0]} already has a shift that day`;
        if (!w || w[0] > a || w[1] < k) return `${x.p.name.split(' ')[0]} is not available then`;
        if (x.days.size >= x.maxDays) return `${x.p.name.split(' ')[0]} already works ${x.days.size} days`;
        if (x.hours >= x.maxHours - 0.01) return `${x.p.name.split(' ')[0]} is at ${x.maxHours} hours`;
        return `${x.p.name.split(' ')[0]} would need a shift shorter than ${s.minShift} hours`;
      });
      warnings.push(`${DAY_NAMES[day.dow]} ${fromSlot(a)}–${fromSlot(k)}: ${have} barista${have === 1 ? '' : 's'} but ${needMax} needed. ${why.join('; ')}.`);
    }
  }

  // ---- result with expected orders
  const out = shifts.map((sh) => {
    const day = days[sh.di];
    let orders = 0, share = 0;
    for (let k = sh.a; k < sh.b; k++) { orders += day.orders[k]; share += day.orders[k] / Math.max(1, day.cover[k]); }
    return {
      user_id: sh.user_id, date: day.date, start: fromSlot(sh.a), end: fromSlot(sh.b === SLOTS ? 0 : sh.b),
      kind: sh.kind, orders: Math.round(orders), share: Math.round(share),
      note: `auto · ~${Math.round(orders)} orders`,
    };
  }).sort((p, q) => (p.date === q.date ? (p.start < q.start ? -1 : 1) : p.date < q.date ? -1 : 1));
  const summary = [...st.values()].map((x) => ({
    id: x.p.id, name: x.p.name, hours: x.hours, days: x.days.size,
    orders: out.filter((o) => o.user_id === x.p.id).reduce((t, o) => t + o.share, 0),
  }));
  return { shifts: out, days, people: summary, warnings, hours };
}

/** Expected café orders between two times on a weekday (for any shift). */
export function ordersBetween(demand, dow, start, end) {
  if (!demand) return null;
  const orders = slotOrders(demand, dow);
  let a = toSlot(start), b = toSlot(end) || SLOTS;
  if (b <= a) b = SLOTS;
  let t = 0;
  for (let k = a; k < b; k++) t += orders[k];
  return Math.round(t);
}
