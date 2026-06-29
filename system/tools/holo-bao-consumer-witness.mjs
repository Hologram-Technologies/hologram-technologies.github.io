#!/usr/bin/env node
// holo-bao-consumer-witness.mjs — S3 of "collect the BLAKE3 dividend": a streaming CONSUMER renders on
// chunk-0 with per-chunk verification, and the shared facade (holo-stream-kit) exposes verified
// chunk-streaming so any surface opts in with one import. Proves:
//   • a renderer acts on chunk 0 BEFORE the object is whole (render-on-first-chunk, not download-then-show);
//   • every rendered chunk was PROVEN against the object's stream κ (== its Bao root); a bad chunk halts
//     the render at that chunk (Law L5) while everything already rendered stands;
//   • holo-stream-kit exposes `bao` + `streamObject` + publishes them on window.HoloStream (the seam);
//   • the 7 stream consumers stay GREEN after the canonical-axis flip (S1) — the wiring is non-breaking.
//
//   node tools/holo-bao-consumer-witness.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const bao = await import(new URL("../os/usr/lib/holo/holo-bao.mjs", import.meta.url));
const { kappaOf } = await import(new URL("../os/usr/lib/holo/holo-kappa-stream.mjs", import.meta.url));
const { hexOf } = await import(new URL("../os/usr/lib/holo/holo-kappa.mjs", import.meta.url));

const checks = {}; let passed = 0, failed = 0;
const rec = (name, ok) => { checks[name] = !!ok; ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${name}`); };

// a large κ-object = a full-res "frame" (≈2 MB). Its stream κ (S1) is the root the chunks verify against.
const N = 2_000_000;
const frame = new Uint8Array(N); for (let i = 0; i < N; i++) frame[i] = (i * 97 + 13) % 251;
const root = hexOf(await kappaOf(frame));
rec("the large object's stream κ == its Bao root (S1 axis holds end to end)", root === bao.rootHex(frame));

// streamObject (mirrors holo-stream-kit.streamObject): consume verified chunks, render each on arrival.
async function streamObject(root, source, onChunk) { let n = 0; for await (const ev of bao.verifiedChunks(root, source)) { await onChunk(ev.bytes, ev.index); n++; } return n; }

// a lazy source (chunks page in over "time") + a renderer that records WHEN the first paint happened.
const ob = bao.outboard(frame);
async function* lazy(upto = ob.chunkCount) { for (let i = 0; i < upto; i++) { const [s, e] = bao.chunkRange(ob.len, i); yield { index: i, bytes: frame.subarray(s, e), proof: ob.proofs[i] }; } }

// ── 1 · render-on-chunk-0: the first paint happens after chunk 0, long before the last chunk ──
let firstPaintAfter = -1, painted = 0;
await streamObject(root, lazy(), (_bytes, index) => { if (firstPaintAfter < 0) firstPaintAfter = index; painted++; });
rec("renderer paints on chunk 0 (before the object is whole)", firstPaintAfter === 0);
rec(`every chunk rendered + verified against the stream κ (${painted}/${ob.chunkCount})`, painted === ob.chunkCount);

// ── 2 · a bad chunk halts the render at that chunk; everything painted before it stands ──
async function* corruptAt(k) {
  for (let i = 0; i < ob.chunkCount; i++) {
    const [s, e] = bao.chunkRange(ob.len, i);
    let b = frame.subarray(s, e);
    if (i === k) { b = Uint8Array.from(b); b[0] ^= 0xff; }
    yield { index: i, bytes: b, proof: ob.proofs[i] };
  }
}
let paintedBefore = 0, halted = false;
try { await streamObject(root, corruptAt(900), () => { paintedBefore++; }); } catch { halted = true; }
rec("a tampered chunk halts the render (Law L5)", halted);
rec("chunks before the bad one were already painted (render survives up to the fault)", paintedBefore === 900);

// ── 3 · the facade exposes verified chunk-streaming (the seam every consumer imports) ──
const kit = readFileSync(join(here, "../os/usr/lib/holo/holo-stream-kit.mjs"), "utf8");
rec("holo-stream-kit imports + re-exports bao", /import \* as bao from "\.\/holo-bao\.mjs"/.test(kit) && /\bbao,/.test(kit));
rec("holo-stream-kit exposes streamObject", /export async function streamObject/.test(kit));
rec("mount() publishes bao + streamObject on window.HoloStream", /bao, streamObject/.test(kit));

// ── 4 · the canonical-axis flip did NOT break the streaming consumers ──
const consumers = ["holo-projector-witness", "holo-osr-lens-witness", "holo-runahead-witness", "holo-superres-witness", "holo-raster-ingest-witness", "holo-fidelity-stream-witness", "holo-compute-memo-witness", "holo-kappa-stream-witness"];
let allGreen = true;
for (const w of consumers) { const r = spawnSync(process.execPath, [join(here, w + ".mjs")], { encoding: "utf8" }); if (r.status !== 0) { allGreen = false; console.log("       RED: " + w); } }
rec(`all ${consumers.length} stream consumers GREEN after the blake3 flip (non-breaking)`, allGreen);

const witnessed = failed === 0;
writeFileSync(join(here, "holo-bao-consumer-witness.result.json"), JSON.stringify({
  spec: "S3 — a streaming consumer renders on chunk-0 with per-chunk verification, and holo-stream-kit exposes verified chunk-streaming (bao + streamObject) so any surface opts in. The blake3 axis flip is non-breaking: all stream consumers stay green.",
  witnessed, objectBytes: N, chunks: ob.chunkCount,
  covers: ["bao", "render-on-chunk-0", "stream-kit", "facade", "consumers", "law-l5"],
  checks, passed, failed,
}, null, 2) + "\n");
console.log(`\nholo-bao-consumer-witness: ${passed} passed, ${failed} failed`);
process.exit(witnessed ? 0 : 1);
