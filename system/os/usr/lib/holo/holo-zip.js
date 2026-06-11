// holo-zip.js — a minimal, dependency-free ZIP reader/writer.
//
// OOXML (.docx/.xlsx/.pptx, ISO/IEC 29500) and ODF (.odt/.ods/.odp, ISO/IEC 26300)
// are both ZIP containers of XML. This is the lean, hologram-native way to read and
// write them ENTIRELY IN THE BROWSER with no vendored zlib and no CDN: DEFLATE is
// the platform's own Compression Streams API ('deflate-raw'), so the "engine" is
// the runtime itself. Isomorphic — the same module backs the live editor and the
// Node conformance witness (Compression Streams, Blob, Response are global in
// browsers and Node ≥18).

// ── CRC-32 (ZIP/PKZIP polynomial) ───────────────────────────────────────────────
const CRC_TABLE = (() => { const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

// ── DEFLATE via the platform Compression Streams API ────────────────────────────
async function streamBytes(u8, transform) {
  const stream = new Blob([u8]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
export const deflateRaw = (u8) => streamBytes(u8, new CompressionStream("deflate-raw"));
export const inflateRaw = (u8) => streamBytes(u8, new DecompressionStream("deflate-raw"));

const te = new TextEncoder();
const td = new TextDecoder();
export const utf8 = (s) => te.encode(s);
export const fromUtf8 = (u8) => td.decode(u8);

// ── writer ───────────────────────────────────────────────────────────────────────
// files: [{ name, data: string|Uint8Array, store?: bool }]. `store` (no compression)
// is required for the ODF `mimetype` entry, which must be the first, uncompressed.
export async function zip(files) {
  const enc = files.map((f) => ({ name: f.name, data: typeof f.data === "string" ? te.encode(f.data) : f.data, store: !!f.store }));
  const parts = []; const central = []; let offset = 0;
  const u16 = (n) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
  const u32 = (n) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
  for (const f of enc) {
    const nameB = te.encode(f.name); const crc = crc32(f.data);
    const comp = f.store ? f.data : await deflateRaw(f.data);
    const method = f.store ? 0 : 8;
    const local = concat([u32(0x04034b50), u16(20), u16(0), u16(method), u16(0), u16(0), u32(crc), u32(comp.length), u32(f.data.length), u16(nameB.length), u16(0), nameB, comp]);
    central.push(concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(method), u16(0), u16(0), u32(crc), u32(comp.length), u32(f.data.length), u16(nameB.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameB]));
    parts.push(local); offset += local.length;
  }
  const cd = concat(central); const cdOffset = offset;
  const eocd = concat([u32(0x06054b50), u16(0), u16(0), u16(enc.length), u16(enc.length), u32(cd.length), u32(cdOffset), u16(0)]);
  return concat([...parts, cd, eocd]);
}

// ── reader ───────────────────────────────────────────────────────────────────────
// Returns Map(name → Uint8Array). Robust: drives off the central directory (correct
// sizes/CRC even when entries used a streaming data descriptor).
export async function unzip(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error("not a zip (no EOCD)");
  const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nameLen));
    // local header: data starts after its own (possibly different) name+extra lengths
    const lNameLen = dv.getUint16(localOff + 26, true), lExtraLen = dv.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const comp = u8.subarray(dataStart, dataStart + compSize);
    out.set(name, method === 0 ? comp.slice() : await inflateRaw(comp));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function concat(arrs) { let n = 0; for (const a of arrs) n += a.length; const o = new Uint8Array(n); let p = 0; for (const a of arrs) { o.set(a, p); p += a.length; } return o; }

export default { zip, unzip, deflateRaw, inflateRaw, crc32, utf8, fromUtf8 };
