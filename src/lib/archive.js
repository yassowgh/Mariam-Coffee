// Turns whatever the user dropped (loose .DB files, a folder, a .zip or a .rar)
// into a flat list of { folder, name, data } entries for the Paradox tables we use.

import { unzipSync } from 'fflate';
import { TABLES } from './tables.js';

const WANTED = new Map(TABLES.map((t) => [t.toLowerCase() + '.db', t]));

function splitPath(path) {
  const clean = path.replace(/\\/g, '/');
  const i = clean.lastIndexOf('/');
  return { folder: i >= 0 ? clean.slice(0, i) : '', base: clean.slice(i + 1) };
}

function pick(path, data, out) {
  const { folder, base } = splitPath(path);
  const table = WANTED.get(base.toLowerCase());
  if (table) out.push({ folder, name: table, data });
}

async function extractRar(bytes) {
  const [{ createExtractorFromData }, { default: wasmUrl }] = await Promise.all([
    import('node-unrar-js/esm'),
    import('node-unrar-js/esm/js/unrar.wasm?url'),
  ]);
  const wasmBinary = await (await fetch(wasmUrl)).arrayBuffer();
  const extractor = await createExtractorFromData({ wasmBinary, data: bytes.buffer });
  const names = [...extractor.getFileList().fileHeaders]
    .filter((h) => !h.flags.directory && WANTED.has(splitPath(h.name).base.toLowerCase()))
    .map((h) => h.name);
  const { files } = extractor.extract({ files: names });
  const out = [];
  for (const f of files) {
    if (f.extraction) out.push([f.fileHeader.name, f.extraction]);
  }
  return out;
}

/**
 * @param {File[]} fileList
 * @param {(msg:string, frac:number)=>void} progress
 */
export async function collectTables(fileList, progress) {
  const out = [];
  const files = [...fileList];
  let i = 0;
  for (const file of files) {
    const frac = i / files.length;
    const path = file.webkitRelativePath || file.name;
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.zip')) {
      progress(`Unzipping ${file.name}…`, frac);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const entries = unzipSync(bytes, {
        filter: (f) => WANTED.has(splitPath(f.name).base.toLowerCase()),
      });
      for (const [name, data] of Object.entries(entries)) pick(`${path}/${name}`, data, out);
    } else if (lower.endsWith('.rar')) {
      progress(`Extracting ${file.name} (RAR)…`, frac);
      const bytes = new Uint8Array(await file.arrayBuffer());
      for (const [name, data] of await extractRar(bytes)) pick(`${path}/${name}`, data, out);
    } else if (WANTED.has(lower)) {
      progress(`Reading ${file.name}…`, frac);
      pick(path, new Uint8Array(await file.arrayBuffer()), out);
    }
    i++;
  }
  return out;
}
