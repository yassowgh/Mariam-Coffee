// Small client for the Worker's staff API (cookie session).

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function api(path, { method = 'GET', body, raw, type } = {}) {
  let res;
  try {
    res = await fetch('/api/' + path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: raw ? { 'content-type': type } : body !== undefined ? { 'content-type': 'application/json' } : undefined,
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
  expenses: 'Expenses',
  scheduler: 'Scheduler',
  barista: 'Barista',
};
export const hasRole = (user, ...roles) => !!user && (user.roles.includes('owner') || roles.some((r) => user.roles.includes(r)));

// ---------- Türkiye local time (UTC+3 all year) ----------
const OFFSET = 180 * 60000;
export const localNow = () => new Date(Date.now() + OFFSET).toISOString();
export const todayLocal = () => localNow().slice(0, 10);
/** Local date "YYYY-MM-DD" and time "HH:MM" of a UTC ISO instant. */
export const toLocal = (iso) => {
  const d = new Date(Date.parse(iso) + OFFSET).toISOString();
  return { date: d.slice(0, 10), time: d.slice(11, 16) };
};
/** UTC ms of a local date + HH:MM. */
export const localMs = (date, hhmm) => Date.parse(`${date}T${hhmm}:00Z`) - OFFSET;
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
