// seal-files-holo.mjs — pack ANY model's files (ONNX, configs, tokenizer, voices) into one κ-addressable
// .holo, byte-compatible with the holo streamer (MAGIC "HOLO" v2; sections Metadata/Weights; sha256 footer).
// Each FILE is one content-addressed κ-body (verbatim, L2-deduped) → the model is stored+served by κ
// (HTTP-Range, per-block L5 verify, OPFS cache, IPFS-pinnable) exactly like the forged-tensor .holo files.
// This makes models we DON'T natively forge (e.g. Kokoro ONNX) first-class κ objects without a forge.
//   node seal-files-holo.mjs <dir> <out.holo> [arch]
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { sha256hex, didHolo } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

const DIR = process.argv[2], OUT = process.argv[3], ARCH = process.argv[4] || "files";
if (!DIR || !OUT) { console.error("usage: node seal-files-holo.mjs <dir> <out.holo> [arch]"); process.exit(1); }
const MAGIC = [0x48, 0x4f, 0x4c, 0x4f], VERSION = 2, K = { Weights: 3, Metadata: 8 };
const HEX = (h) => { const b = new Uint8Array(32); for (let i = 0; i < 32; i++) b[i] = parseInt(h.substr(i * 2, 2), 16); return b; };
const enc = new TextEncoder();

// collect files recursively (posix-relative names)
function walk(d) { const out = []; for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) out.push(...walk(p)); else if (e.isFile()) out.push(p); } return out; }
const paths = walk(DIR).sort();
const files = [], seen = new Map(), bodies = new Map(); let bodyTotal = 0;
for (const p of paths) {
  const body = new Uint8Array(readFileSync(p)), name = relative(DIR, p).split("\\").join("/"), hex = sha256hex(body);
  if (!seen.has(hex)) { seen.set(hex, { off: bodyTotal, len: body.length }); bodies.set(hex, body); bodyTotal += body.length; }
  files.push({ name, kappa: hex, len: body.length });
}
const uniq = [...seen.entries()];
const meta = JSON.stringify({ format: "holo/2", arch: ARCH, nFiles: files.length, nBodies: uniq.length, files });
const metaBytes = enc.encode(meta);

const sectionCount = 2, headSize = 4 + 2 + 2 + 2 + sectionCount * (1 + 8 + 8);
const metaOff = headSize, weightsOff = metaOff + metaBytes.length;
const dirBytes = 4 + uniq.length * (32 + 8 + 8), bodiesStart = weightsOff + dirBytes, fileLen = bodiesStart + bodyTotal + 32;

const out = new Uint8Array(fileLen), dv = new DataView(out.buffer); let p = 0;
out.set(MAGIC, p); p += 4; dv.setUint16(p, VERSION, true); p += 2; dv.setUint16(p, 0, true); p += 2; dv.setUint16(p, sectionCount, true); p += 2;
const sec = (kind, off, len) => { out[p] = kind; p += 1; dv.setBigUint64(p, BigInt(off), true); p += 8; dv.setBigUint64(p, BigInt(len), true); p += 8; };
sec(K.Metadata, metaOff, metaBytes.length); sec(K.Weights, weightsOff, dirBytes + bodyTotal);
out.set(metaBytes, metaOff);
dv.setUint32(weightsOff, uniq.length, true); let dp = weightsOff + 4;
for (const [hex, info] of uniq) { out.set(HEX(hex), dp); dp += 32; dv.setBigUint64(dp, BigInt(bodiesStart + info.off), true); dp += 8; dv.setBigUint64(dp, BigInt(info.len), true); dp += 8; out.set(bodies.get(hex), bodiesStart + info.off); }
const footHex = sha256hex(out.subarray(0, fileLen - 32)); out.set(HEX(footHex), fileLen - 32);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out);

// L5 self-check: re-derive footer + EVERY body κ
const rd = new Uint8Array(readFileSync(OUT)), rdv = new DataView(rd.buffer, rd.byteOffset, rd.byteLength);
const okFoot = sha256hex(rd.subarray(0, rd.length - 32)) === footHex; let bad = 0;
const cnt = rdv.getUint32(weightsOff, true);
for (let i = 0, q = weightsOff + 4; i < cnt; i++, q += 48) {
  const kh = [...rd.subarray(q, q + 32)].map((x) => x.toString(16).padStart(2, "0")).join("");
  const off = Number(rdv.getBigUint64(q + 32, true)), len = Number(rdv.getBigUint64(q + 40, true));
  if (sha256hex(rd.subarray(off, off + len)) !== kh) bad++;
}
console.log(`SEALED → ${OUT}`);
console.log(`  ${(fileLen / 1e6).toFixed(1)} MB · ${files.length} files · ${uniq.length} κ-bodies · arch=${ARCH}`);
console.log(`  archive κ  ${didHolo("sha256", footHex)}`);
console.log(`  L5 self-check: footer ${okFoot ? "✓" : "✗"} · ${cnt - bad}/${cnt} bodies re-derived ${bad ? "✗" : "✓"}`);
