// Talks to the Worker's /api endpoints to load and save the shared dataset.
import { zipSync } from 'fflate';

/**
 * Returns { available, file?, meta? }.
 * available = the site has server storage (false in a local preview);
 * file is set only when a dataset has been saved.
 */
export async function loadSaved(progress) {
  let res;
  try {
    res = await fetch('/api/data', { cache: 'no-store' });
  } catch {
    return { available: false };
  }
  const type = res.headers.get('content-type') || '';
  if (!type.includes('zip')) return { available: type.includes('json') && res.status !== 503 };
  let meta = {};
  try { meta = JSON.parse(decodeURIComponent(res.headers.get('x-meta') || '%7B%7D')); } catch { /* ignore */ }
  const total = Number(res.headers.get('content-length')) || meta.bytes || 0;
  const chunks = [];
  let got = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.byteLength;
    progress(`Downloading saved data… ${(got / 1048576).toFixed(1)} MB`, total ? Math.min(1, got / total) : 0.5);
  }
  return { available: true, file: new File(chunks, 'saved-data.zip', { type: 'application/zip' }), meta };
}

/** Throws with a readable message if the password is wrong or the server has no storage. */
export async function checkPassword(password) {
  let res;
  try {
    res = await fetch('/api/auth', { method: 'POST', headers: { 'x-upload-password': password } });
  } catch {
    throw new Error('Could not reach the server to check the password.');
  }
  if (res.status === 204) return;
  if (res.status === 401) throw new Error('Wrong password. Nothing was loaded or saved.');
  throw new Error('Saving is only available on the published website (not in this preview). Untick “Save” to just view the files.');
}

/** Zips the table files and replaces the saved dataset. */
export async function saveRemote(entries, meta, password) {
  const files = {};
  for (const e of entries) {
    const path = (e.folder ? e.folder.replace(/^\/+/, '') + '/' : '') + e.name + '.DB';
    files[path] = [e.data, { level: 6 }];
  }
  const zip = zipSync(files);
  const res = await fetch('/api/data', {
    method: 'PUT',
    headers: {
      'content-type': 'application/zip',
      'x-upload-password': password,
      'x-meta': encodeURIComponent(JSON.stringify(meta)),
    },
    body: zip,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Saving failed (HTTP ${res.status}).`);
  return body.metadata;
}

/** Saved cost settings, or null. */
export async function loadCosts() {
  try {
    const res = await fetch('/api/costs', { cache: 'no-store' });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) return null;
    const cfg = await res.json();
    return cfg && Array.isArray(cfg.recipes) ? cfg : null;
  } catch {
    return null;
  }
}

export async function saveCosts(cfg, password) {
  let res;
  try {
    res = await fetch('/api/costs', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-upload-password': password },
      body: JSON.stringify(cfg),
    });
  } catch {
    throw new Error('Could not reach the server.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || (res.status === 404 ? 'Saving is only available on the published website.' : `Saving failed (HTTP ${res.status}).`));
  return body;
}
