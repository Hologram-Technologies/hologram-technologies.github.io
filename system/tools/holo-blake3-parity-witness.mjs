#!/usr/bin/env node
// holo-blake3-parity-witness.mjs — P0 of the BLAKE3-canonical-κ cutover. The substrate has ONE hash
// (kappo() = BLAKE3); before we promote it from "σ-axis tag-along" to "the κ", we lock cross-impl
// parity so a promoted axis cannot silently diverge between the three implementations that all claim
// to compute it:
//
//   • JS  — os/usr/lib/holo/holo-blake3.mjs  (the pure-JS kappo, runs in the browser SW + page)
//   • Rust — the `blake3` crate via kappa-route blake3_hex() (the native CEF/Tauri verifier)
//   • CEF — kr_blake3_hex (FFI) == the same Rust `blake3` crate == the same KATs the JS re-derives
//
// This witness proves the JS axis (one-shot AND streaming) against the OFFICIAL BLAKE3 known-answer
// vectors — the external authority both the Rust crate and the CEF host also satisfy by construction
// (same standard). It additionally emits holo-blake3-parity-vectors.json, which a Rust #[test]
// (kappa-route: parity_vectors_match_js) re-derives with blake3::hash — closing JS == Rust == CEF
// DIRECTLY, including chunk-boundary and large (1 MiB) inputs and the incremental streaming hasher.
//
//   node tools/holo-blake3-parity-witness.mjs
//   (then: cargo test -p kappa-route parity_vectors_match_js   — the Rust half of the parity gate)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const { blake3hex, createBlake3 } = await import(new URL("../os/usr/lib/holo/holo-blake3.mjs", import.meta.url));

// Official BLAKE3 known-answer vectors (input = bytes i % 251), the published authority both the Rust
// `blake3` crate and CEF's kr_blake3_hex reproduce verbatim. These pin the cross-impl agreement offline.
const KAT = {
  0: "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262",
  1: "2d3adedff11b61f14c886e35afa036736dcd87a74d27b5c1510225d0f592e213",
  63: "e9bc37a594daad83be9470df7f7b3798297c3d834ce80ba85d6e207627b7db7b",
  64: "4eed7141ea4a5cd4b788606bd23f46e212af9cacebacdc7d1f4c6dc7f2511b98",
  65: "de1e5fa0be70df6d2be8fffd0e99ceaa8eb6e8c93a63f2d8d1c30ecb6b263dee",
  1023: "10108970eeda3eb932baac1428c7a2163b0e924c9a9e25b35bba72b28f70bd11",
  1024: "42214739f095a406f3fc83deb889744ac00df831c10daa55189b5d121c855af7",
  1025: "d00278ae47eb27b34faecf67b4fe263f82d5412916c1ffd97c8cb7fb814b8444",
  2048: "e776b6028c7cd22a4d0ba182a8bf62205d2ef576467e838ed6f2529b85fba24a",
  4096: "015094013f57a5277b59d8475c0501042c0b642e531b0a1c8f58d2163229e969",
  16385: "1dabe216be2578830263b049de1639f39f05a4da616b9b78c7a5e4e41662fd1f",
};
const mk = (L) => { const b = new Uint8Array(L); for (let i = 0; i < L; i++) b[i] = i % 251; return b; };

// 1 MiB has no published KAT line here; derive it ONCE from the trusted one-shot path and treat the
// streaming path + Rust re-derivation as the cross-checks (a length the small KATs never exercise).
KAT[1048576] = blake3hex(mk(1048576));

const checks = {}; let passed = 0, failed = 0;
const rec = (name, ok) => { checks[name] = !!ok; ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${name}`); };

// 1 · one-shot JS == official KAT (the external authority Rust + CEF also satisfy)
for (const [L, expected] of Object.entries(KAT)) {
  if (L === "1048576") continue;   // derived, not a published line — covered by streaming + Rust below
  rec(`one-shot blake3(${L} bytes) == KAT`, blake3hex(mk(+L)) === expected);
}

// 2 · streaming hasher == one-shot, across odd chunk sizes that straddle the 1024-byte chunk boundary.
// This is the invariant the prompt names: "byte-for-byte … including streaming/chunked input."
const streamHex = (bytes, step) => { const h = createBlake3(); for (let o = 0; o < bytes.length; o += step) h.update(bytes.subarray(o, o + step)); return h.hex(); };
for (const L of [0, 1, 65, 1023, 1024, 1025, 2048, 4096, 16385, 1048576]) {
  const b = mk(L), one = blake3hex(b);
  for (const step of [1, 7, 64, 100, 1000, 1024]) rec(`streaming blake3(${L}, step ${step}) == one-shot`, streamHex(b, step) === one);
}

// 3 · emit the parity vectors the Rust #[test] re-derives with blake3::hash (JS == Rust == CEF direct).
const vectors = Object.keys(KAT).map((L) => ({ len: +L, blake3: blake3hex(mk(+L)) })).sort((a, b) => a.len - b.len);
writeFileSync(join(here, "holo-blake3-parity-vectors.json"), JSON.stringify({
  spec: "Cross-impl BLAKE3 parity vectors: input = bytes (i % 251) of the given length; blake3 = lowercase hex of standard BLAKE3. Re-derived by holo-blake3.mjs (JS/browser), the `blake3` crate (kappa-route, native verifier), and kr_blake3_hex (CEF FFI). The κ-cutover's bedrock invariant — a promoted canonical axis that diverges here does NOT land.",
  pattern: "i % 251",
  vectors,
}, null, 2) + "\n");

const witnessed = failed === 0;
writeFileSync(join(here, "holo-blake3-parity-witness.result.json"), JSON.stringify({
  spec: "BLAKE3 cross-impl parity (P0 of the canonical-κ cutover): JS one-shot == JS streaming == official KAT, with emitted vectors the Rust/CEF layers re-derive. Locks kappo() before it is promoted from σ-axis to the one κ.",
  authority: "Official BLAKE3 test vectors (BLAKE3-team) + the substrate's own kappo() (ADR-052). Rust half: cargo test -p kappa-route parity_vectors_match_js.",
  witnessed,
  covers: ["blake3", "kappo", "parity", "streaming", "canonical-kappa", "law-l5"],
  checks, passed, failed,
  vectors: vectors.length,
}, null, 2) + "\n");

console.log(`\nholo-blake3-parity-witness: ${passed} passed, ${failed} failed · ${vectors.length} parity vectors emitted`);
console.log("Rust half of the gate: cargo test -p kappa-route parity_vectors_match_js");
process.exit(witnessed ? 0 : 1);
