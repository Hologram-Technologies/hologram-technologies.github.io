#!/usr/bin/env node
// holo-bao-parity-witness.mjs — S4 of "collect the BLAKE3 dividend": emit a verified-streaming fixture so
// the NATIVE verifier (kappa-route, the `blake3` crate's hazmat tree primitives) can re-verify the EXACT
// proofs holo-bao produces — proving a slice verifies JS == Rust == CEF (cross-impl, no new crypto). The
// Rust half is `cargo test -p kappa-route bao_slice_parity`. Self-checks the fixture in JS first.
//
//   node tools/holo-bao-parity-witness.mjs
//   then: cargo test -p kappa-route bao_slice_parity

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const bao = await import(new URL("../os/usr/lib/holo/holo-bao.mjs", import.meta.url));
const { blake3hex } = await import(new URL("../os/usr/lib/holo/holo-blake3.mjs", import.meta.url));

// a chaining value in holo-bao is 8 LE u32 words; the `blake3` crate's ChainingValue is 32 LE bytes.
// Convert so Rust reads [u8;32] directly.
const cvHex = (words) => { let s = ""; for (const w of words) for (let i = 0; i < 4; i++) s += ((w >>> (i * 8)) & 255).toString(16).padStart(2, "0"); return s; };
const bytesHex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log("  ✗ " + m)); };

// objects across tree shapes: single chunk, exact boundary, asymmetric multi-chunk, large.
const SIZES = [500, 1024, 1025, 3000, 7000, 70000];
const mk = (n) => { const u = new Uint8Array(n); for (let i = 0; i < n; i++) u[i] = (i * 131 + 17) % 251; return u; };

const objects = [];
for (const n of SIZES) {
  const b = mk(n), enc = bao.encode(b);
  ok(enc.root === blake3hex(b), `root == blake3hex @${n}`);
  // self-verify every chunk in JS before exporting (the fixture must be sound)
  for (const c of enc.chunks) ok(bao.verifyChunk(enc.root, c.index, c.bytes, c.proof), `JS verifies chunk ${c.index} @${n}`);
  objects.push({
    len: n, root: enc.root,
    chunks: enc.chunks.map((c) => ({ index: c.index, bytes: bytesHex(c.bytes), proof: c.proof.map((s) => ({ side: s.side, cv: cvHex(s.cv) })) })),
  });
}

writeFileSync(join(here, "holo-bao-parity-vectors.json"), JSON.stringify({
  spec: "Cross-impl verified-streaming vectors: per object, root = blake3 hex; each chunk carries its bytes (hex) and proof (sibling {side, cv} where cv = 32 LE bytes hex). The native verifier (kappa-route, blake3 hazmat) re-verifies each chunk against root and refuses a tampered one — proving holo-bao's proofs verify JS == Rust == CEF.",
  chunkLen: 1024, objects,
}, null, 2) + "\n");

console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed · ${objects.length} objects emitted`);
console.log("Rust half: cargo test -p kappa-route bao_slice_parity");
process.exit(fail === 0 ? 0 : 1);
