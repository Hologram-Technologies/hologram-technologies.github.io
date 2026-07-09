// holo-forge-seal.mjs — ADR-0114 S0: the ONE format-agnostic .holo sealer + the ModelFrontEnd seam.
//
// Today writeHolo() (holo-archive.mjs) and seal-whisper-holo.mjs hand-roll the SAME archive protocol (MAGIC,
// sections, directory, footer) twice. This extracts that core into one sealHolo() so every format — GGUF, ONNX,
// Whisper, the next one — emits the identical .holo the existing reader (readHolo/openHoloStream) consumes. The
// byte layout here is lifted verbatim from writeHolo (holo-archive.mjs:30-84): same meta {format:"holo/2", arch,
// sourceRoot, nTensors, nBodies, order}, same first-use dedup, same absolute-offset directory, same footer =
// sha256(everything-before) = the model's did:holo. Only the Extension key/bytes and the forged parts are
// parameterized — so a format differs ONLY inside its front-end's forge(), never in the sealer or the reader.
//
// Cut-over (a 3-line, behaviour-preserving change to the SEALED holo-archive.mjs — a reseal step, NOT applied here):
//   export function writeHolo(ggufBytes) {
//     const f = forgeGguf(ggufBytes);
//     const headerBytes = ggufBytes.subarray(0, parseGgufHeader(ggufBytes).dataOffset);
//     return sealHolo({ arch: f.arch, sourceRoot: f.rootKappa, tensors: f.tensors, blocks: f.blocks, extKey: "gguf.header", extBytes: headerBytes });
//   }
// (seal-whisper-holo.mjs collapses the same way with extKey "whisper.ggml".) Relates: ADR-0114 · ADR-0101.

import { sha256hex, didHolo } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";
import { forgeGguf } from "./gguf-forge.mjs";
import { parseGgufHeader } from "../qvac-ingest.mjs";

const MAGIC = [0x48, 0x4f, 0x4c, 0x4f];           // "HOLO"
const VERSION = 2;
const K = { Weights: 3, Metadata: 8, Extension: 14 };
const HEX = (h) => { const b = new Uint8Array(32); for (let i = 0; i < 32; i++) b[i] = parseInt(h.substr(i * 2, 2), 16); return b; };
const u16 = (n) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n, true); return b; };
function cat(arrs) { let n = 0; for (const a of arrs) n += a.length; const o = new Uint8Array(n); let p = 0; for (const a of arrs) { o.set(a, p); p += a.length; } return o; }

// sealHolo(parts) -> { holo, rootHolo, nBodies, nTensors, bytes }
//   parts: { arch, sourceRoot, tensors:[{name, kappa, nbytes}], blocks:Map<hex,Uint8Array>, extKey, extBytes }
// tensors are in FIRST-USE (compute) order; bodies dedup by κ keeping first occurrence — so a tensor reused across
// the model (or shared with another model that seals the same κ) stores ONE body. Byte-identical to writeHolo.
// extraMeta (optional) is spliced into the meta object BETWEEN sourceRoot and nTensors — this reproduces, byte
// for byte, the richer Whisper meta {…, hparams, mel, vocabCount, …} so seal-whisper-holo.mjs collapses onto
// sealHolo without changing its archive κ. GGUF passes none → its meta is byte-identical to the original writeHolo.
export function sealHolo({ arch, sourceRoot, tensors, blocks, extKey = "model.header", extBytes = new Uint8Array(0), extraMeta = {} }) {
  const order = [], seen = new Map();             // κ-hex → {off(within bodies), len}
  let bodyTotal = 0;
  for (const t of tensors) {
    const hex = String(t.kappa).split(":").pop();
    if (!seen.has(hex)) { seen.set(hex, { off: bodyTotal, len: t.nbytes }); bodyTotal += t.nbytes; }
    order.push({ name: t.name, kappa: hex });
  }
  const uniq = [...seen.entries()];

  const meta = JSON.stringify({ format: "holo/2", arch, sourceRoot, ...extraMeta, nTensors: tensors.length, nBodies: uniq.length, order });
  const enc = new TextEncoder();
  const metaBytes = enc.encode(meta);
  const extKeyBytes = enc.encode(extKey);
  const extPayload = cat([u16(extKeyBytes.length), extKeyBytes, extBytes]);   // [keyLen][key][bytes]
  const dirCount = uniq.length;
  const dirBytes = 4 + dirCount * (32 + 8 + 8);
  const weightsLen = dirBytes + bodyTotal;

  const sectionCount = 3;
  const headSize = 4 + 2 + 2 + 2 + sectionCount * (1 + 8 + 8);
  const extOff = headSize, metaOff = extOff + extPayload.length, weightsOff = metaOff + metaBytes.length;
  const bodiesStart = weightsOff + dirBytes;
  const fileLen = bodiesStart + bodyTotal + 32;

  const out = new Uint8Array(fileLen);
  const dv = new DataView(out.buffer);
  let p = 0;
  out.set(MAGIC, p); p += 4;
  dv.setUint16(p, VERSION, true); p += 2;
  dv.setUint16(p, 0, true); p += 2;               // flags
  dv.setUint16(p, sectionCount, true); p += 2;
  const sec = (kind, off, len) => { out[p] = kind; p += 1; dv.setBigUint64(p, BigInt(off), true); p += 8; dv.setBigUint64(p, BigInt(len), true); p += 8; };
  sec(K.Extension, extOff, extPayload.length);
  sec(K.Metadata, metaOff, metaBytes.length);
  sec(K.Weights, weightsOff, weightsLen);
  out.set(extPayload, extOff);
  out.set(metaBytes, metaOff);
  dv.setUint32(weightsOff, dirCount, true);
  let dp = weightsOff + 4;
  for (const [hex, info] of uniq) {
    out.set(HEX(hex), dp); dp += 32;
    dv.setBigUint64(dp, BigInt(bodiesStart + info.off), true); dp += 8;
    dv.setBigUint64(dp, BigInt(info.len), true); dp += 8;
    const body = blocks.get(hex);
    if (!body) throw new Error("holo-forge-seal: missing body for κ " + hex);
    out.set(body, bodiesStart + info.off);
  }
  const footHex = sha256hex(out.subarray(0, fileLen - 32));
  out.set(HEX(footHex), fileLen - 32);
  return { holo: out, rootHolo: didHolo("sha256", footHex), nBodies: uniq.length, nTensors: tensors.length, bytes: fileLen };
}

// ── the ModelFrontEnd seam ──
// A ModelFrontEnd is { name, detect(headBytes)->bool, forge(bytes)-> { arch, sourceRoot, tensors, blocks, ext:{key,bytes} } }.
// Every format implements this; the seam routes by magic, forges, and seals through the ONE sealHolo above.
export function detectFrontEnd(headBytes, frontEnds) { return (frontEnds || []).find((fe) => { try { return !!fe.detect(headBytes); } catch { return false; } }) || null; }

// The GGUF ModelFrontEnd — the real one (forgeGguf is witnessed by gguf-forge.test.mjs). With this, writeHolo
// (holo-archive.mjs) is exactly `sealHolo(ggufFrontEnd.forge(bytes))` — the cut-over of Step 3 in byte-identical form.
export const ggufFrontEnd = {
  name: "gguf",
  detect: (h) => h[0] === 0x47 && h[1] === 0x47 && h[2] === 0x55 && h[3] === 0x46, // "GGUF"
  forge: (bytes) => {
    const f = forgeGguf(bytes);
    const headerBytes = bytes.subarray(0, parseGgufHeader(bytes).dataOffset);
    return { arch: f.arch, sourceRoot: f.rootKappa, tensors: f.tensors, blocks: f.blocks, ext: { key: "gguf.header", bytes: headerBytes } };
  },
};

export async function forgeToHolo(bytes, frontEnds) {
  const fe = detectFrontEnd(bytes.subarray(0, 8), frontEnds);
  if (!fe) throw new Error("holo-forge-seal: no front-end matched these bytes");
  const parts = await fe.forge(bytes);
  const sealed = sealHolo({ arch: parts.arch, sourceRoot: parts.sourceRoot, tensors: parts.tensors, blocks: parts.blocks, extKey: parts.ext && parts.ext.key, extBytes: parts.ext && parts.ext.bytes, extraMeta: parts.extraMeta });
  return { frontEnd: fe.name, format: parts.arch, ...sealed };
}
