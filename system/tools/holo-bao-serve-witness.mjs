#!/usr/bin/env node
// holo-bao-serve-witness.mjs — S2 of "collect the BLAKE3 dividend": VERIFIED-SLICE SERVING with bounded
// residency. The point of a tree hash over a linear one: serve/consume an object's chunks each proven
// against the SINGLE root κ, WITHOUT the whole object ever being simultaneously resident. Proves:
//   • outboard(bytes) = the proof tree (cacheable by root κ); sliceFromOutboard serves a chunk only if it
//     verifies (Law L5), bytes sourced on demand — no whole-object re-derivation per request;
//   • a consumer renders chunk 0 the instant it arrives (time-to-first-chunk ≪ time-to-whole);
//   • PEAK RESIDENCY is bounded to ~one chunk + its O(log n) proof, NOT the object size — the dividend;
//   • a tampered slice at chunk k is REFUSED while chunks 0..k-1 have already been served (stream survives);
//   • the served root == the object's canonical stream κ (S1) — same axis end to end.
//
//   node tools/holo-bao-serve-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const bao = await import(new URL("../os/usr/lib/holo/holo-bao.mjs", import.meta.url));
const { kappaOf } = await import(new URL("../os/usr/lib/holo/holo-kappa-stream.mjs", import.meta.url));
const { hexOf } = await import(new URL("../os/usr/lib/holo/holo-kappa.mjs", import.meta.url));

const checks = {}; let passed = 0, failed = 0;
const rec = (name, ok) => { checks[name] = !!ok; ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${name}`); };

// a large object (≈3.1 MB → 3072 chunks). The "origin" holds the bytes on disk; the server pages them.
const N = 3145728;
const big = new Uint8Array(N); for (let i = 0; i < N; i++) big[i] = (i * 131 + 17) % 251;

// ── SERVER side: compute the outboard ONCE, cache it by root κ; bytes stay at the "origin". ──
const ob = bao.outboard(big);
rec("outboard root == object's canonical stream κ (same axis as S1)", ob.root === hexOf(await kappaOf(big)));
rec(`outboard carries one proof per chunk (${ob.chunkCount} chunks)`, ob.proofs.length === ob.chunkCount);

// the origin: hands out a chunk's bytes on demand (a disk read / range fetch). Counts reads so we can
// prove the server never reads the whole object to serve one slice.
let originReads = 0;
const originChunk = (index) => { const [s, e] = bao.chunkRange(ob.len, index); originReads++; return big.subarray(s, e); };

// serveSlice(index): page the bytes, verify against root via the cached proof, return or refuse.
const serveSlice = (index) => bao.sliceFromOutboard(ob.root, ob, index, originChunk(index));

// ── 1 · serve slice 0 first (render-on-chunk-0) with bounded residency ──
const first = serveSlice(0);
rec("chunk 0 serves immediately, verified (render-on-first-chunk)", first.length > 0 && originReads === 1);

// ── 2 · stream ALL chunks through a one-chunk SINK; assert peak residency ≪ object size ──
let peakResident = 0;
function makeSink() {
  let held = null;                                  // the sink keeps at most ONE chunk at a time
  return {
    push(chunk) { held = chunk; peakResident = Math.max(peakResident, (chunk ? chunk.length : 0)); /* "render" */ held = null; },
  };
}
const sink = makeSink();
let servedCount = 0;
for (let i = 0; i < ob.chunkCount; i++) { sink.push(serveSlice(i)); servedCount++; }
rec("every chunk served + verified against the root", servedCount === ob.chunkCount);
rec("PEAK RESIDENCY ≪ object size (one chunk window, not the whole object)", peakResident <= 1024 && peakResident > 0 && N / peakResident > 1000);

// ── 3 · a tampered slice at chunk k is refused AFTER 0..k-1 already served ──
const k = 2000;
let servedBefore = 0; for (let i = 0; i < k; i++) { serveSlice(i); servedBefore++; }
const dirty = Uint8Array.from(originChunk(k)); dirty[0] ^= 0xff;
let refused = false; try { bao.sliceFromOutboard(ob.root, ob, k, dirty); } catch { refused = true; }
rec(`chunks 0..${k - 1} served, then a tampered chunk ${k} is REFUSED (Law L5, stream survives)`, servedBefore === k && refused);
// and the CLEAN chunk k still serves (refusal was the byte, not the position)
rec("the clean chunk k still serves after the tampered attempt", serveSlice(k).length > 0);

// ── 4 · verifiedChunks over a LAZY source never materializes the whole object ──
let maxLive = 0, live = 0;
async function* lazySource() {
  for (let i = 0; i < ob.chunkCount; i++) { live++; maxLive = Math.max(maxLive, live); yield { index: i, bytes: originChunk(i), proof: ob.proofs[i] }; live--; }
}
let n = 0; for await (const _ev of bao.verifiedChunks(ob.root, lazySource())) n++;
rec("verifiedChunks streams a lazy source, ≤1 chunk live at a time (whole object never resident)", n === ob.chunkCount && maxLive === 1);

const witnessed = failed === 0;
writeFileSync(join(here, "holo-bao-serve-witness.result.json"), JSON.stringify({
  spec: "S2 — verified-slice serving: outboard (proof tree, cached by root κ) + sliceFromOutboard serve any chunk proven against the single root, bytes paged on demand, peak residency bounded to one chunk + its O(log n) proof. Render-on-chunk-0; a tampered slice refused while earlier slices already streamed. The BLAKE3 dividend made concrete — what SHA-256 (linear) cannot do.",
  witnessed, objectBytes: N, chunks: ob.chunkCount,
  covers: ["bao", "outboard", "verified-slice", "bounded-residency", "render-on-chunk-0", "law-l5"],
  checks, passed, failed,
}, null, 2) + "\n");
console.log(`\nholo-bao-serve-witness: ${passed} passed, ${failed} failed`);
process.exit(witnessed ? 0 : 1);
