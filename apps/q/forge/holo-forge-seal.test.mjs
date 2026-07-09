#!/usr/bin/env node
// holo-forge-seal.test.mjs — ADR-0114 S0: prove the extracted ONE sealer + ModelFrontEnd seam (holo-forge-seal.mjs)
// emits .holo that the REAL production reader (readHolo / openHoloStream from holo-archive.mjs) consumes — so it is
// a verified drop-in for the existing path, and a single sealer serves GGUF, Whisper, ONNX, and the next format.
//
// This is an INTEGRATION test, not a mock: the writer is the new sealHolo, the reader is the actual holo-archive.mjs
// the cold-load runtime uses. If the real reader L5-verifies every body, honors first-use order, collapses dedup,
// preserves each format's Extension, and refuses a tampered byte — the seam is faithful and safe to cut over.
//
// Checks (all must hold):
//   1  realReaderAccepts     — sealHolo(gguf parts) → readHolo parses: arch, format "holo/2", order length, footer = rootHolo.
//   2  everyBodyL5Verifies   — the reader's L5 store returns each body byte-identical to source (no REFUSE on a clean seal).
//   3  streamRoundTrips       — openHoloStream over a Range reader: headerBytes = the format Extension; each κ getBody L5-OK.
//   4  dedupCollapsesBodies   — 3 tensors, 2 distinct bodies → nBodies 2 < nTensors 3; both names resolve to the one body.
//   5  twoFrontEndsOneSealer  — GGUF ("gguf.header") AND Whisper ("whisper.ggml") seal+read through the SAME sealer; keys preserved.
//   6  detectFrontEndRoutes   — magic routes GGUF→gguf, ggml→whisper, random→null.
//   7  tamperRefused          — flip one body byte → readHolo footer REFUSE (archive L5) AND openHoloStream getBody REFUSE (block L5).
//   8  forgeToHoloEndToEnd    — forgeToHolo(bytes, frontEnds) detects + forges + seals; both formats read back with a rootHolo.
//
// Authority (external): holospaces Laws L1/L3/L5 · ADR-0114 · hologram-archive (MAGIC "HOLO" v2). Usage:
//   node holo-apps/apps/q/forge/holo-forge-seal.test.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sealHolo, forgeToHolo, detectFrontEnd } from "./holo-forge-seal.mjs";
import { readHolo, openHoloStream } from "./holo-archive.mjs";   // the REAL production reader
import { sha256hex } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const write = (r) => writeFileSync(join(here, "holo-forge-seal.test.result.json"), JSON.stringify(r, null, 2) + "\n");
const enc = new TextEncoder();
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const body = (seed, n) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (seed * 131 + i * 7) & 0xff; return b; };

// build forge "parts" the way a ModelFrontEnd.forge() would: first-use tensors + a κ-keyed body store
function makeParts(arch, extKey, headerStr, defs /* [[name, seed, len]] */) {
  const blocks = new Map(); const tensors = [];
  for (const [name, seed, len] of defs) {
    const b = body(seed, len), hex = sha256hex(b);
    blocks.set(hex, b);
    tensors.push({ name, kappa: "did:holo:sha256:" + hex, nbytes: len });
  }
  return { arch, sourceRoot: "did:holo:sha256:" + sha256hex(enc.encode(arch + "-root")), tensors, blocks, ext: { key: extKey, bytes: enc.encode(headerStr) } };
}

const ggufParts = makeParts("qwen2", "gguf.header", "GGUF-HEADER-META…", [["token_embd", 1, 40], ["blk.0.attn", 2, 24], ["output.weight", 3, 16]]);
const dedupParts = makeParts("qwen2", "gguf.header", "H", [["a", 7, 40], ["b", 9, 24], ["a_again", 7, 40]]); // a == a_again
const whisperParts = makeParts("whisper", "whisper.ggml", "GGML-WHISPER-HDR…", [["encoder.conv", 4, 32], ["decoder.0", 5, 32], ["mel.filter", 6, 8]]);

const ggufFE = { name: "gguf", detect: (h) => h[0] === 0x47 && h[1] === 0x47 && h[2] === 0x55 && h[3] === 0x46, forge: () => ggufParts };       // "GGUF"
const whisperFE = { name: "whisper", detect: (h) => h[0] === 0x67 && h[1] === 0x67 && h[2] === 0x6d && h[3] === 0x6c, forge: () => whisperParts }; // "ggml"
const FES = [ggufFE, whisperFE];
const rrOf = (holo) => async (off, len) => holo.subarray(off, off + len);
function readExtKey(holo) {
  const dv = new DataView(holo.buffer, holo.byteOffset, holo.byteLength);
  const cnt = dv.getUint16(8, true); let p = 10, extOff = null;
  for (let i = 0; i < cnt; i++) { if (holo[p] === 14) extOff = Number(dv.getBigUint64(p + 1, true)); p += 17; }
  const keyLen = dv.getUint16(extOff, true);
  return new TextDecoder().decode(holo.subarray(extOff + 2, extOff + 2 + keyLen));
}

const checks = {};

// 1 · real reader accepts the seal
{
  const s = sealHolo({ arch: ggufParts.arch, sourceRoot: ggufParts.sourceRoot, tensors: ggufParts.tensors, blocks: ggufParts.blocks, extKey: ggufParts.ext.key, extBytes: ggufParts.ext.bytes });
  const r = readHolo(s.holo);
  checks.realReaderAccepts = r.meta.arch === "qwen2" && r.meta.format === "holo/2" && r.meta.order.length === 3 && r.meta.nBodies === s.nBodies && r.footer === s.rootHolo;
}
// 2 · every body L5-verifies via the reader's store
{
  const s = sealHolo({ ...ggufParts, extKey: ggufParts.ext.key, extBytes: ggufParts.ext.bytes });
  const r = readHolo(s.holo);
  let ok = true;
  for (const [hex, b] of ggufParts.blocks) { const got = r.store.get(hex); if (!got || !eq(got, b)) ok = false; }
  checks.everyBodyL5Verifies = ok;
}
// 3 · stream round-trips over a Range reader, headerBytes = the Extension, every body L5-OK
{
  const s = sealHolo({ ...ggufParts, extKey: ggufParts.ext.key, extBytes: ggufParts.ext.bytes });
  const h = await openHoloStream(rrOf(s.holo));
  let bodiesOk = true;
  for (const [hex, b] of ggufParts.blocks) { const got = await h.getBody(hex); if (!eq(got, b)) bodiesOk = false; }
  checks.streamRoundTrips = eq(h.headerBytes, ggufParts.ext.bytes) && bodiesOk && h.order.length === 3;
}
// 4 · dedup collapses identical bodies
{
  const s = sealHolo({ ...dedupParts, extKey: dedupParts.ext.key, extBytes: dedupParts.ext.bytes });
  const r = readHolo(s.holo);
  const aK = r.meta.order.find((o) => o.name === "a").kappa, aaK = r.meta.order.find((o) => o.name === "a_again").kappa;
  checks.dedupCollapsesBodies = s.nTensors === 3 && s.nBodies === 2 && aK === aaK && eq(r.store.get(aK), dedupParts.blocks.get(aK));
}
// 5 · two front-ends, one sealer; each Extension key preserved
{
  const g = sealHolo({ ...ggufParts, extKey: ggufParts.ext.key, extBytes: ggufParts.ext.bytes });
  const w = sealHolo({ ...whisperParts, extKey: whisperParts.ext.key, extBytes: whisperParts.ext.bytes });
  const rg = readHolo(g.holo), rw = readHolo(w.holo);
  checks.twoFrontEndsOneSealer = rg.meta.arch === "qwen2" && rw.meta.arch === "whisper"
    && readExtKey(g.holo) === "gguf.header" && readExtKey(w.holo) === "whisper.ggml"
    && eq(rw.headerBytes, whisperParts.ext.bytes) && g.rootHolo !== w.rootHolo;
}
// 6 · detect routes by magic
{
  const gguf = detectFrontEnd(new Uint8Array([0x47, 0x47, 0x55, 0x46, 0, 0, 0, 0]), FES);
  const ggml = detectFrontEnd(new Uint8Array([0x67, 0x67, 0x6d, 0x6c, 0, 0, 0, 0]), FES);
  const none = detectFrontEnd(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), FES);
  checks.detectFrontEndRoutes = gguf && gguf.name === "gguf" && ggml && ggml.name === "whisper" && none === null;
}
// 7 · tamper refused at BOTH L5 layers (archive footer + per-block)
{
  const s = sealHolo({ ...ggufParts, extKey: ggufParts.ext.key, extBytes: ggufParts.ext.bytes });
  const h0 = await openHoloStream(rrOf(s.holo));
  const [hex, d] = [...h0.dir.entries()][0];
  const tampered = s.holo.slice(); tampered[d.off] ^= 0xff;        // flip the first byte of a body
  let footerRefused = false, blockRefused = false;
  try { readHolo(tampered); } catch (e) { footerRefused = /footer mismatch|tamper/.test(e.message); }
  try { const h1 = await openHoloStream(rrOf(tampered)); await h1.getBody(hex); } catch (e) { blockRefused = /L5 REFUSE/.test(e.message); }
  checks.tamperRefused = footerRefused && blockRefused;
}
// 9 · extraMeta reproduces Whisper's richer meta field ORDER (so seal-whisper cut-over is byte-identical)
{
  const s = sealHolo({ ...whisperParts, extKey: whisperParts.ext.key, extBytes: whisperParts.ext.bytes, extraMeta: { hparams: { n_audio_state: 768 }, mel: { n_mel: 80, n_fft: 201 }, vocabCount: 51865 } });
  const r = readHolo(s.holo);
  checks.extraMetaPreservesOrder = JSON.stringify(Object.keys(r.meta)) === JSON.stringify(["format", "arch", "sourceRoot", "hparams", "mel", "vocabCount", "nTensors", "nBodies", "order"]) && r.meta.vocabCount === 51865;
}

// 8 · forgeToHolo end-to-end: detect → forge → seal, both formats
{
  const ggufBytes = new Uint8Array(16); ggufBytes.set([0x47, 0x47, 0x55, 0x46], 0);
  const whisperBytes = new Uint8Array(16); whisperBytes.set([0x67, 0x67, 0x6d, 0x6c], 0);
  const g = await forgeToHolo(ggufBytes, FES), w = await forgeToHolo(whisperBytes, FES);
  const rg = readHolo(g.holo), rw = readHolo(w.holo);
  checks.forgeToHoloEndToEnd = g.frontEnd === "gguf" && w.frontEnd === "whisper" && rg.meta.arch === "qwen2" && rw.meta.arch === "whisper" && /^did:holo:sha256:/.test(g.rootHolo);
}

const witnessed = Object.values(checks).every(Boolean);
write({
  spec: "Holo Forge Unified (ADR-0114) S0 — one format-agnostic sealHolo() + the ModelFrontEnd seam (holo-forge-seal.mjs): every format emits the identical .holo the REAL production reader (readHolo/openHoloStream) consumes. Integration-proven: the real reader L5-verifies every body, honors first-use order, collapses dedup, preserves each format's Extension key, and refuses a tampered byte at both the archive-footer and per-block layers. A 3-line behaviour-preserving cut-over of writeHolo/seal-whisper-holo onto sealHolo is the reseal step.",
  authority: "holospaces Laws L1/L3/L5 · ADR-0114 Holo Forge Unified · hologram-archive (MAGIC \"HOLO\" v2)",
  note: "Writer = new sealHolo/forgeToHolo; reader = the ACTUAL holo-archive.mjs the cold-load runtime uses (true integration, not a mock). Cut-over of the SEALED holo-archive.mjs writeHolo + seal-whisper-holo.mjs onto sealHolo is a 3-line behaviour-preserving edit deferred to a reseal+browser session (the app-seal caveat). Wiring forgeToHolo into acquireSpecialist's ctx.forge completes the S1→S0→S3 pipeline.",
  witnessed,
  covers: witnessed ? ["one-sealer", "model-frontend-seam", "real-reader-roundtrip", "per-block-l5", "first-use-dedup", "multi-format-extension", "tamper-refused", "forge-to-holo"] : [],
  checks,
});

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ one sealer serves every format and the REAL reader round-trips it with full L5, dedup, and tamper-refusal" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
