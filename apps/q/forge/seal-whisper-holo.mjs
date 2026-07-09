// seal-whisper-holo.mjs — seal a forged Whisper model into a `.holo` archive, byte-compatible with
// holo-archive.readHolo / openHoloStream (MAGIC "HOLO" v2; sections Extension/Metadata/Weights; footer
// = sha256 over the archive = its did:holo). Whisper ships in whisper.cpp's LEGACY ggml container (not
// GGUF), so writeHolo() can't take it — this is the whisper-aware twin: the legacy-ggml HEAD (hparams +
// mel filterbank + vocab) is baked as the Extension ("ggml.whisper.header"), every tensor body is a
// content-addressed κ-block (verbatim, L2-deduped), and Metadata carries the first-use order (name→κ).
//
//   node seal-whisper-holo.mjs [model.bin] [out.holo]
//
// NOTE (honest): this seals the κ-NATIVE artifact. The forge's forward is a CPU oracle (~17× slower than
// real time); this .holo is NOT yet Q's live ear — that needs the GPU whisper forward. This captures the
// milestone (Whisper is a first-class κ-object), nothing more.

import { readFileSync, writeFileSync, mkdirSync, openSync, fstatSync, readSync, closeSync } from "node:fs";
import { dirname } from "node:path";
import { forgeWhisper, parseWhisperHeader } from "./gguf-forge-whisper.mjs";
import { sha256hex, didHolo } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

const MODEL = process.argv[2] || "C:/Users/pavel/Desktop/SovereignAI/1_Compute/whisper.cpp/ggml-small.bin";
const OUT = process.argv[3] || "./.models/whisper-small.holo";

const MAGIC = [0x48, 0x4f, 0x4c, 0x4f], VERSION = 2, K = { Weights: 3, Metadata: 8, Extension: 14 };
const HEX = (h) => { const b = new Uint8Array(32); for (let i = 0; i < 32; i++) b[i] = parseInt(h.substr(i * 2, 2), 16); return b; };
const enc = new TextEncoder();

// readFileSync caps at 2 GiB → chunked read for large-v3 etc.
function readBig(path) {
  const fd = openSync(path, "r"), size = fstatSync(fd).size, out = new Uint8Array(size);
  const CH = 1 << 30, buf = Buffer.allocUnsafe(Math.min(CH, size));
  for (let off = 0; off < size;) { const n = readSync(fd, buf, 0, Math.min(CH, size - off), off); out.set(buf.subarray(0, n), off); off += n; }
  closeSync(fd); return out;
}

const t0 = Date.now();
const bytes = readBig(MODEL);
const { tensors } = parseWhisperHeader(bytes);
const t = tensors[0];                                                       // legacy-ggml head ends where the 1st tensor record begins
const headerEnd = t.offset - 12 - 4 * t.dims.length - Buffer.byteLength(t.name, "utf8");   // n_dims+name_len+ttype(12) + ne[] + name
const headerBytes = bytes.subarray(0, headerEnd);                           // hparams + mel filters + vocab

const f = forgeWhisper(bytes);                                              // { blocks: Map<hex,bytes>, tensors, plan, rootKappa, ... }
console.log(`forged ${f.tensors.length} tensors → root ${f.rootKappa.slice(0, 28)}… (${((Date.now() - t0) / 1000).toFixed(0)}s); header ${headerBytes.length}B`);

// first-use order; dedup bodies by κ (L2). Tensor bodies, then the mel filterbank κ.
const order = [], seen = new Map(); let bodyTotal = 0;
const pushBody = (hex, len) => { if (!seen.has(hex)) { seen.set(hex, { off: bodyTotal, len }); bodyTotal += len; } };
for (const tt of f.tensors) { const hex = tt.kappa.split(":").pop(); pushBody(hex, tt.nbytes); order.push({ name: tt.name, kappa: hex, dims: tt.dims, type: tt.type }); }
const melHex = f.plan.mel.kappa.split(":").pop(); pushBody(melHex, f.plan.mel.nbytes);
const uniq = [...seen.entries()];

const meta = JSON.stringify({
  format: "holo/2", arch: "whisper", sourceRoot: f.rootKappa,
  hparams: f.hparams, mel: { n_mel: f.plan.mel.n_mel, n_fft: f.plan.mel.n_fft, kappa: melHex },
  vocabCount: f.vocabCount, nTensors: f.tensors.length, nBodies: uniq.length, order,
});
const metaBytes = enc.encode(meta);
const extKey = enc.encode("ggml.whisper.header");
const extPayload = new Uint8Array(2 + extKey.length + headerBytes.length);
new DataView(extPayload.buffer).setUint16(0, extKey.length, true);
extPayload.set(extKey, 2); extPayload.set(headerBytes, 2 + extKey.length);

const sectionCount = 3, headSize = 4 + 2 + 2 + 2 + sectionCount * (1 + 8 + 8);
const extOff = headSize, metaOff = extOff + extPayload.length, weightsOff = metaOff + metaBytes.length;
const dirBytes = 4 + uniq.length * (32 + 8 + 8), bodiesStart = weightsOff + dirBytes;
const fileLen = bodiesStart + bodyTotal + 32;

const out = new Uint8Array(fileLen), dv = new DataView(out.buffer); let p = 0;
out.set(MAGIC, p); p += 4; dv.setUint16(p, VERSION, true); p += 2; dv.setUint16(p, 0, true); p += 2; dv.setUint16(p, sectionCount, true); p += 2;
const sec = (kind, off, len) => { out[p] = kind; p += 1; dv.setBigUint64(p, BigInt(off), true); p += 8; dv.setBigUint64(p, BigInt(len), true); p += 8; };
sec(K.Extension, extOff, extPayload.length); sec(K.Metadata, metaOff, metaBytes.length); sec(K.Weights, weightsOff, dirBytes + bodyTotal);
out.set(extPayload, extOff); out.set(metaBytes, metaOff);
dv.setUint32(weightsOff, uniq.length, true); let dp = weightsOff + 4;
for (const [hex, info] of uniq) { out.set(HEX(hex), dp); dp += 32; dv.setBigUint64(dp, BigInt(bodiesStart + info.off), true); dp += 8; dv.setBigUint64(dp, BigInt(info.len), true); dp += 8; out.set(f.blocks.get(hex), bodiesStart + info.off); }
const footHex = sha256hex(out.subarray(0, fileLen - 32)); out.set(HEX(footHex), fileLen - 32);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out);
console.log(`\nSEALED → ${OUT}`);
console.log(`  ${(fileLen / 1e6).toFixed(1)} MB · ${uniq.length} κ-bodies · arch=whisper`);
console.log(`  sourceRoot ${f.rootKappa}`);
console.log(`  archive κ  ${didHolo("sha256", footHex)}`);
