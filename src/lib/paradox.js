// Minimal Paradox (.DB) table reader. Works in the browser and in Node.
// Supports the field types used by the ASEAL POS / accounting tables.

const TYPE = {
  ALPHA: 0x01, DATE: 0x02, SHORT: 0x03, LONG: 0x04, CURRENCY: 0x05, NUMBER: 0x06,
  LOGICAL: 0x09, TIME: 0x14, TIMESTAMP: 0x15, AUTOINC: 0x16,
};

// Paradox day number 1 = 0001-01-01; 719163 = 1970-01-01.
const UNIX_EPOCH_DAY = 719163;

let decoder;
function textDecoder() {
  if (!decoder) {
    try { decoder = new TextDecoder('windows-1256'); } catch { decoder = new TextDecoder('latin1'); }
  }
  return decoder;
}

export function readHeader(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.byteLength < 0x78) throw new Error('File too small to be a Paradox table');
  const recordSize = dv.getUint16(0, true);
  const headerSize = dv.getUint16(2, true);
  const fileType = buf[4];
  const blockSize = buf[5] * 1024;
  const numRecords = dv.getUint32(6, true);
  const firstBlock = dv.getUint16(0x0e, true);
  const numFields = dv.getUint16(0x21, true);
  const version = buf[0x39];
  if (!recordSize || !headerSize || !blockSize || !numFields || numFields > 1024) {
    throw new Error('Not a valid Paradox data file');
  }
  const fieldOff = version >= 4 ? 0x78 : 0x58;
  const fields = [];
  for (let i = 0; i < numFields; i++) {
    fields.push({ type: buf[fieldOff + 2 * i], size: buf[fieldOff + 2 * i + 1] });
  }
  // after field info: 4-byte table-name ptr + 4 bytes per field-name ptr, then the table name
  let p = fieldOff + 2 * numFields + 4 + 4 * numFields;
  p += version >= 0x0c ? 261 : 79;
  for (let i = 0; i < numFields; i++) {
    let e = p;
    while (e < headerSize && buf[e] !== 0) e++;
    fields[i].name = String.fromCharCode(...buf.subarray(p, e));
    p = e + 1;
  }
  let off = 0;
  for (const f of fields) { f.offset = off; off += f.size; }
  if (off !== recordSize) throw new Error('Field sizes do not add up to the record size');
  return { recordSize, headerSize, fileType, blockSize, numRecords, firstBlock, version, fields };
}

function decodeField(buf, o, f) {
  const { type, size } = f;
  switch (type) {
    case TYPE.ALPHA: {
      let e = o;
      const end = o + size;
      while (e < end && buf[e] !== 0) e++;
      if (e === o) return null;
      return textDecoder().decode(buf.subarray(o, e)).trim() || null;
    }
    case TYPE.SHORT: {
      const hi = buf[o], lo = buf[o + 1];
      if (hi === 0 && lo === 0) return null;
      let v = ((hi ^ 0x80) << 8) | lo;
      if (v & 0x8000) v -= 0x10000;
      return v;
    }
    case TYPE.LONG: case TYPE.AUTOINC: case TYPE.DATE: case TYPE.TIME: {
      const b0 = buf[o], b1 = buf[o + 1], b2 = buf[o + 2], b3 = buf[o + 3];
      if ((b0 | b1 | b2 | b3) === 0) return null;
      let v = (((b0 ^ 0x80) << 24) | (b1 << 16) | (b2 << 8) | b3);
      if (type === TYPE.DATE) return dayToIso(v);
      return v; // TIME = ms since midnight
    }
    case TYPE.CURRENCY: case TYPE.NUMBER: case TYPE.TIMESTAMP: {
      let zero = true;
      for (let i = 0; i < 8; i++) if (buf[o + i]) { zero = false; break; }
      if (zero) return null;
      const tmp = new Uint8Array(8);
      const positive = (buf[o] & 0x80) !== 0;
      for (let i = 0; i < 8; i++) tmp[i] = positive ? buf[o + i] : buf[o + i] ^ 0xff;
      if (positive) tmp[0] &= 0x7f;
      let v = new DataView(tmp.buffer).getFloat64(0, false);
      if (!positive) v = -v;
      if (type === TYPE.TIMESTAMP) {
        // ms counted from day 1 (0001-01-01) = 86400000
        return new Date(v - UNIX_EPOCH_DAY * 86400000).toISOString();
      }
      return v;
    }
    case TYPE.LOGICAL:
      return buf[o] === 0 ? null : buf[o] === 0x81;
    default:
      return null;
  }
}

export function dayToIso(day) {
  const d = new Date((day - UNIX_EPOCH_DAY) * 86400000);
  return d.toISOString().slice(0, 10);
}

/**
 * Read records of a Paradox table.
 * @param {Uint8Array} buf
 * @param {object} opts { fields?: string[] (subset to decode), onProgress?(done,total), yieldEvery? }
 * @returns {Promise<{header, rows: object[]}>}
 */
export async function readTable(buf, opts = {}) {
  const header = readHeader(buf);
  const { recordSize, headerSize, blockSize, firstBlock } = header;
  const wanted = opts.fields
    ? header.fields.filter((f) => opts.fields.includes(f.name))
    : header.fields;
  const rows = [];
  const totalBlocks = Math.max(1, Math.floor((buf.byteLength - headerSize) / blockSize));
  const seen = new Set();
  let bn = firstBlock;
  let done = 0;
  const yieldEvery = opts.yieldEvery ?? 16;
  while (bn && !seen.has(bn)) {
    seen.add(bn);
    const bo = headerSize + (bn - 1) * blockSize;
    if (bo + 6 > buf.byteLength) break;
    const next = buf[bo] | (buf[bo + 1] << 8);
    let add = buf[bo + 4] | (buf[bo + 5] << 8);
    if (add & 0x8000) add -= 0x10000;
    const n = add >= 0 ? Math.floor(add / recordSize) + 1 : 0;
    for (let r = 0; r < n; r++) {
      const ro = bo + 6 + r * recordSize;
      if (ro + recordSize > buf.byteLength) break;
      const rec = {};
      for (const f of wanted) rec[f.name] = decodeField(buf, ro + f.offset, f);
      rows.push(rec);
    }
    bn = next;
    done++;
    if (opts.onProgress && done % yieldEvery === 0) {
      opts.onProgress(Math.min(done, totalBlocks), totalBlocks);
      await new Promise((res) => setTimeout(res, 0));
    }
  }
  opts.onProgress?.(totalBlocks, totalBlocks);
  return { header, rows };
}
