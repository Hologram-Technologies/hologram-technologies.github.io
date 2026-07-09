// seal-moonshine-holo.mjs — seal Moonshine (safetensors) into a `.holo`, byte-compatible with
// holo-whisper-stream (MAGIC "HOLO" v2; sections Extension/Metadata/Weights; footer = sha256 over archive).
// Each tensor's F32 bytes = one content-addressed κ-block (verbatim, L2-deduped). Metadata carries the
// arch config + first-use order (name→κ); the Extension holds tokenizer.json for detok. Self-verifies (L5).
//   node seal-moonshine-holo.mjs [model_dir] [out.holo]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { sha256hex, didHolo } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

const DIR = process.argv[2] || "./.models/moonshine-tiny";
const OUT = process.argv[3] || "./.models/moonshine-tiny.holo";
const QUANT = process.argv[4] || "f32";   // f32 (verbatim) | f16 (half size; streamer dequants type-1)
const MAGIC = [0x48, 0x4f, 0x4c, 0x4f], VERSION = 2, K = { Weights: 3, Metadata: 8, Extension: 14 };
const HEX = (h) => { const b = new Uint8Array(32); for (let i = 0; i < 32; i++) b[i] = parseInt(h.substr(i * 2, 2), 16); return b; };
const enc = new TextEncoder();
// f32 → IEEE half (round-half-up; carry handled by additive assembly). Greedy-token parity tolerates it.
const _qb = new ArrayBuffer(4), _qf = new Float32Array(_qb), _qu = new Uint32Array(_qb);
function f32tof16(v) { _qf[0] = v; const x = _qu[0], s = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112, m = x & 0x7fffff;
  if (e <= 0) { if (e < -10) return s; const mm = (m | 0x800000) >>> (1 - e); return (s + ((mm + 0x1000) >>> 13)) & 0xffff; }
  if (e >= 0x1f) return s | 0x7c00;
  return (s + (e << 10) + ((m + 0x1000) >>> 13)) & 0xffff; }
function toF16Bytes(f32) { const u = new Uint16Array(f32.length); for (let i = 0; i < f32.length; i++) u[i] = f32tof16(f32[i]); return new Uint8Array(u.buffer); }
// per-row symmetric int8 (type 9): body = [f32 scale per row][int8 data]. Quarters 2D weights; scale exact.
function toInt8RowBytes(f32, rows) {
  const n = f32.length, cols = n / rows, scales = new Float32Array(rows), q = new Int8Array(n);
  for (let r = 0; r < rows; r++) { let mx = 0; const b = r * cols; for (let c = 0; c < cols; c++) { const a = Math.abs(f32[b + c]); if (a > mx) mx = a; } const sc = mx > 0 ? mx / 127 : 1, inv = 1 / sc; scales[r] = sc; for (let c = 0; c < cols; c++) { let v = Math.round(f32[b + c] * inv); q[b + c] = v > 127 ? 127 : v < -127 ? -127 : v; } }
  const out = new Uint8Array(rows * 4 + n); new Float32Array(out.buffer, 0, rows).set(scales); new Int8Array(out.buffer, rows * 4, n).set(q); return out;
}

const st = new Uint8Array(readFileSync(`${DIR}/model.safetensors`));
const hlen = Number(new DataView(st.buffer, st.byteOffset, 8).getBigUint64(0, true));
const hdr = JSON.parse(new TextDecoder().decode(st.subarray(8, 8 + hlen))), base = 8 + hlen;
const config = JSON.parse(readFileSync(`${DIR}/config.json`, "utf8"));
const tokenizer = readFileSync(`${DIR}/tokenizer.json`);   // raw bytes → Extension

const DT = { F32: 0, F16: 1 };
const order = [], seen = new Map(), bodies = new Map(); let bodyTotal = 0;
for (const [name, info] of Object.entries(hdr)) {
  if (name === "__metadata__") continue;
  const [s, e] = info.data_offsets; let body, type;
  if (QUANT === "int8" && info.dtype === "F32" && info.shape.length >= 2) {           // 2D weights → per-row int8
    const al = st.subarray(base + s, base + e).slice(); body = toInt8RowBytes(new Float32Array(al.buffer), info.shape[0]); type = 9;
  } else if ((QUANT === "f16" || QUANT === "int8") && info.dtype === "F32") {          // 1D (bias/norm) → f16 (quality-safe, tiny)
    const al = st.subarray(base + s, base + e).slice(); body = toF16Bytes(new Float32Array(al.buffer)); type = DT.F16;
  } else { body = st.subarray(base + s, base + e); type = DT[info.dtype] ?? -1; }
  const hex = sha256hex(body);
  if (!seen.has(hex)) { seen.set(hex, { off: bodyTotal, len: body.length }); bodies.set(hex, body); bodyTotal += body.length; }
  order.push({ name, kappa: hex, dims: info.shape, type });
}
const uniq = [...seen.entries()];
const meta = JSON.stringify({ format: "holo/2", arch: "moonshine", config, nTensors: order.length, nBodies: uniq.length, order });
const metaBytes = enc.encode(meta);
const extKey = enc.encode("moonshine.tokenizer.json");
const extPayload = new Uint8Array(2 + extKey.length + tokenizer.length);
new DataView(extPayload.buffer).setUint16(0, extKey.length, true);
extPayload.set(extKey, 2); extPayload.set(tokenizer, 2 + extKey.length);

const sectionCount = 3, headSize = 4 + 2 + 2 + 2 + sectionCount * (1 + 8 + 8);
const extOff = headSize, metaOff = extOff + extPayload.length, weightsOff = metaOff + metaBytes.length;
const dirBytes = 4 + uniq.length * (32 + 8 + 8), bodiesStart = weightsOff + dirBytes, fileLen = bodiesStart + bodyTotal + 32;

const out = new Uint8Array(fileLen), dv = new DataView(out.buffer); let p = 0;
out.set(MAGIC, p); p += 4; dv.setUint16(p, VERSION, true); p += 2; dv.setUint16(p, 0, true); p += 2; dv.setUint16(p, sectionCount, true); p += 2;
const sec = (kind, off, len) => { out[p] = kind; p += 1; dv.setBigUint64(p, BigInt(off), true); p += 8; dv.setBigUint64(p, BigInt(len), true); p += 8; };
sec(K.Extension, extOff, extPayload.length); sec(K.Metadata, metaOff, metaBytes.length); sec(K.Weights, weightsOff, dirBytes + bodyTotal);
out.set(extPayload, extOff); out.set(metaBytes, metaOff);
dv.setUint32(weightsOff, uniq.length, true); let dp = weightsOff + 4;
for (const [hex, info] of uniq) { out.set(HEX(hex), dp); dp += 32; dv.setBigUint64(dp, BigInt(bodiesStart + info.off), true); dp += 8; dv.setBigUint64(dp, BigInt(info.len), true); dp += 8; out.set(bodies.get(hex), bodiesStart + info.off); }
const footHex = sha256hex(out.subarray(0, fileLen - 32)); out.set(HEX(footHex), fileLen - 32);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out);

// ── self-verify (L5): re-read sections, re-derive footer + a sample of body κs ──
const rd = new Uint8Array(readFileSync(OUT)), rdv = new DataView(rd.buffer, rd.byteOffset, rd.byteLength);
const okFoot = sha256hex(rd.subarray(0, rd.length - 32)) === footHex;
let checked = 0, bad = 0;
const wOff = weightsOff, cnt = rdv.getUint32(wOff, true);
for (let i = 0, q = wOff + 4; i < cnt; i++, q += 48) {
  if (i % 30 !== 0) continue;   // sample every 30th body
  const kh = [...rd.subarray(q, q + 32)].map((x) => x.toString(16).padStart(2, "0")).join("");
  const off = Number(rdv.getBigUint64(q + 32, true)), len = Number(rdv.getBigUint64(q + 40, true));
  if (sha256hex(rd.subarray(off, off + len)) !== kh) bad++; checked++;
}
console.log(`SEALED → ${OUT}`);
console.log(`  ${(fileLen / 1e6).toFixed(1)} MB · ${uniq.length} κ-bodies · ${order.length} tensors · arch=moonshine`);
console.log(`  S=${config.hidden_size} ${config.encoder_num_hidden_layers}+${config.decoder_num_hidden_layers}L · vocab ${config.vocab_size} · tokenizer ${tokenizer.length}B in Extension`);
console.log(`  archive κ  ${didHolo("sha256", footHex)}`);
console.log(`  L5 self-check: footer ${okFoot ? "✓" : "✗"} · ${checked - bad}/${checked} sampled bodies re-derived ${bad ? "✗" : "✓"}`);
