// Small client for the Worker's staff API (cookie session).

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function api(path, { method = 'GET', body, raw, type, headers: extra } = {}) {
  let res;
  try {
    res = await fetch(import.meta.env.BASE_URL + 'api/' + path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { ...(raw ? { 'content-type': type } : body !== undefined ? { 'content-type': 'application/json' } : {}), ...(extra || {}) },
      body: raw || (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check the internet connection and try again.');
  }
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const data = isJson ? await res.json().catch(() => ({})) : null;
  if (!res.ok) {
    if (res.status === 401 && path !== 'login') window.dispatchEvent(new Event('mc-signed-out'));
    throw new ApiError(res.status, data?.error || `Request failed (HTTP ${res.status}).`);
  }
  if (!isJson) throw new ApiError(res.status, 'This feature works only on the published website.');
  return data;
}

export const ROLE_LABELS = {
  owner: 'Owner',
  accountant: 'Accountant',
  manager: 'Manager',
  barista: 'Barista',
};
export const hasRole = (user, ...roles) => !!user && (user.roles.includes('owner') || roles.some((r) => user.roles.includes(r)));

// ---------- display time zone: Türkiye by default, whatever the device's own time zone ----------
// Clock-in/out times and "today" follow this zone. Each person can choose another one on their device.
export const DEFAULT_TZ = 'Europe/Istanbul';
const TZ_KEY = 'mc-tz';
function readTz() {
  try {
    const t = localStorage.getItem(TZ_KEY);
    if (t) { new Intl.DateTimeFormat('en', { timeZone: t }); return t; } // still a valid zone
  } catch { /* private mode or unknown zone */ }
  return DEFAULT_TZ;
}
let TZ = readTz();
export const getTz = () => TZ;
export function setTz(tz) {
  try { if (tz === DEFAULT_TZ) localStorage.removeItem(TZ_KEY); else localStorage.setItem(TZ_KEY, tz); } catch { /* ignore */ }
  TZ = tz;
}
export const deviceTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } };
const fmts = {};
function wall(ms) {
  const f = fmts[TZ] || (fmts[TZ] = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  const o = {};
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  return Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour % 24, +o.minute, +o.second);
}
/** Offset of the display zone from UTC at that instant, in ms (handles summer time). */
const offsetAt = (ms) => wall(ms) - Math.floor(ms / 1000) * 1000;
/** "GMT+3" style label of the display zone right now. */
export function tzOffsetLabel(tz = TZ) {
  try { return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value || ''; } catch { return ''; }
}
/** "Türkiye time (GMT+3)" or "London time (GMT)" for the display zone. */
export const tzName = () => `${TZ === DEFAULT_TZ ? 'Türkiye' : TZ.split('/').pop().replace(/_/g, ' ')} time (${tzOffsetLabel()})`;
export const localNow = () => new Date(Date.now() + offsetAt(Date.now())).toISOString();
export const todayLocal = () => localNow().slice(0, 10);
/** Local date "YYYY-MM-DD" and time "HH:MM" of a UTC ISO instant, in the display zone. */
export const toLocal = (iso) => {
  const ms = Date.parse(iso);
  const d = new Date(ms + offsetAt(ms)).toISOString();
  return { date: d.slice(0, 10), time: d.slice(11, 16) };
};
/** UTC ms of a local date + HH:MM in the display zone. */
export const localMs = (date, hhmm) => {
  const guess = Date.parse(`${date}T${hhmm}:00Z`);
  return guess - offsetAt(guess - offsetAt(guess));
};
export const addDaysLocal = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
/** Monday of the week containing `date`. */
export const weekStart = (date) => {
  const dow = new Date(date + 'T00:00:00Z').getUTCDay();
  return addDaysLocal(date, -((dow + 6) % 7));
};
export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const dowOf = (date) => DOW[new Date(date + 'T00:00:00Z').getUTCDay()];
/** Shift length in hours; an end time before the start means it ends after midnight. */
export const shiftHours = (s) => {
  const [a, b] = [s.start, s.end].map((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)));
  return ((b - a + 1440) % 1440 || 1440) / 60;
};
export const shiftRange = (s) => {
  const start = localMs(s.date, s.start);
  return [start, start + shiftHours(s) * 3600000];
};
export const hoursFmt = (h) => {
  if (h == null || !Number.isFinite(h)) return '–';
  const m = Math.round(h * 60);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};
export const distFmt = (m) => (m == null ? '–' : m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m');

/** Phone location (high accuracy). Resolves { lat, lng, accuracy }. */
export function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('This browser cannot share its location. Use Chrome or Safari on your phone.')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new Error(e.code === 1
        ? 'Location is blocked for this site. Allow location in the browser settings (and turn on Location on the phone), then try again.'
        : e.code === 3 ? 'Finding your location took too long. Make sure Location/GPS is on and try again.'
          : 'Your location could not be found. Make sure Location/GPS is on and try again.')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
}

/** Shrinks a photo to at most 1600 px on the long side, as JPEG. */
export async function compressPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('That file is not a photo this browser can open.'));
      i.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.75));
  } finally {
    URL.revokeObjectURL(url);
  }
}
