#!/usr/bin/env node
// holo-bao-stream-witness.mjs — S1 of "collect the BLAKE3 dividend": the stream primitive now mints the
// CANONICAL κ (blake3), so a stream object's κ IS its Bao root — the composition the whole initiative
// stands on. Proves:
//   • holo-kappa-stream.kappaOf(bytes) == did:holo:blake3:<rootHex> == kappo(bytes) (one axis, three names);
//   • frame/admit round-trip on blake3 (novel object verified by re-derivation, ref reconstructs);
//   • a stream object's κ is BOTH whole-object-verifiable (kappoVerify) AND per-chunk-verifiable (bao) —
//     i.e. the SAME κ a small object streams under is the root a large object streams its chunks under;
//   • compute-memo (the other former sha island) now mints the same canonical κ.
//
//   node tools/holo-bao-stream-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const { kappaOf, makeKappaStream } = await import(new URL("../os/usr/lib/holo/holo-kappa-stream.mjs", import.meta.url));
const { kappo, kappoHex, kappoVerify, hexOf } = await import(new URL("../os/usr/lib/holo/holo-kappa.mjs", import.meta.url));
const bao = await import(new URL("../os/usr/lib/holo/holo-bao.mjs", import.meta.url));
const { makeComputeMemo } = await import(new URL("../os/usr/lib/holo/holo-compute-memo.mjs", import.meta.url));

const checks = {}; let passed = 0, failed = 0;
const rec = (name, ok) => { checks[name] = !!ok; ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${name}`); };
const enc = (s) => new TextEncoder().encode(s);

// 1 · the stream κ IS the canonical blake3 κ IS the Bao root — one axis, three names.
const obj = enc("a κ-object: one frame / token / tile / layer");
const k = await kappaOf(obj);
rec("stream kappaOf mints did:holo:blake3", /^did:holo:blake3:[0-9a-f]{64}$/.test(k));
rec("stream κ == canonical kappo(bytes)", k === kappo(obj));
rec("stream κ tail == Bao rootHex (the chunk proofs verify against THIS κ)", hexOf(k) === bao.rootHex(obj));

// 2 · frame/admit round-trip on blake3: a novel object travels + verifies; once admitted (the shared
// cache = the address space, Law L3), the producer collapses a repeat to a ref (≈0 bytes on the wire).
const stream = makeKappaStream();
const ev1 = await stream.frame(obj);
rec("frame(novel) emits an obj event with the blake3 κ", ev1.kind === "obj" && ev1.kappa === k);
const got = await stream.admit(ev1);                               // verifies by re-derivation + fills the κ-cache
rec("admit(obj) verifies by blake3 re-derivation + returns the bytes", got.length === obj.length && got.every((b, i) => b === obj[i]));
const ev2 = await stream.frame(obj);                               // now held → ref
rec("frame(held) collapses to a ref (≈0 bytes)", ev2.kind === "ref" && ev2.kappa === k);
let tampered = false; try { await stream.admit({ kind: "obj", kappa: k, payload: enc("forged bytes for a real κ") }); } catch { tampered = true; }
rec("admit refuses a payload that doesn't re-derive to the blake3 κ (Law L5)", tampered);

// 3 · the SAME κ is whole-object AND per-chunk verifiable — small objects and large objects share the axis.
const big = new Uint8Array(100001); for (let i = 0; i < big.length; i++) big[i] = (i * 31 + 7) % 251;
const kbig = await kappaOf(big);
rec("a large object's stream κ == its Bao root", hexOf(kbig) === bao.rootHex(big));
rec("whole-object verify (kappoVerify) holds on the stream κ", kappoVerify(big, kbig));
const encd = bao.encode(big);
let everyChunk = encd.root === hexOf(kbig);
for (const c of encd.chunks) if (!bao.verifyChunk(kbig, c.index, c.bytes, c.proof)) everyChunk = false;
rec(`every chunk verifies against the stream κ (${encd.chunks.length} chunks, none held whole)`, everyChunk);

// 4 · compute-memo (the other former sha island) mints the same canonical κ.
const memo = makeComputeMemo({ l2: new Map(), cap: 16 });
const opK = await kappaOf(enc("op")), inK = await kappaOf(enc("in"));
const r = await memo.compute(opK, inK, async (o, i) => enc("OUT:" + o + "|" + i));
rec("compute-memo output κ is canonical blake3", /^did:holo:blake3:/.test(r.kappa) && r.kappa === await kappaOf(r.bytes));

const witnessed = failed === 0;
writeFileSync(join(here, "holo-bao-stream-witness.result.json"), JSON.stringify({
  spec: "S1 — the κ-stream primitive (and compute-memo) mint the canonical BLAKE3 κ, so a stream object's κ IS its Bao root. Small objects stream whole-verified; large objects stream the SAME κ's chunks per-chunk-verified (holo-bao). The SHA-256 stream island is retired.",
  witnessed, covers: ["kappa-stream", "bao", "blake3-canonical", "verified-streaming", "compute-memo", "law-l5"],
  checks, passed, failed,
}, null, 2) + "\n");
console.log(`\nholo-bao-stream-witness: ${passed} passed, ${failed} failed`);
process.exit(witnessed ? 0 : 1);
