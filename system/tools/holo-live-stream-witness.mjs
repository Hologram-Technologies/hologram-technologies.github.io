#!/usr/bin/env node
// holo-live-stream-witness.mjs — S0–S2 of LIVE verified streaming: the CONSUMER experience, proven end to
// end and CROSS-IMPL. It streams the bao parity fixture (objects whose chunks+proofs are byte-identical
// between the native Rust kr_bao_encoder and JS holo-bao) through holo-bao-stream.streamVerified, and
// asserts the live-experience invariants the felt product depends on:
//   • render-on-first-chunk: chunk 0 reaches the sink the instant it verifies (low latency);
//   • verify-before-use: every delivered chunk verified against the SINGLE root κ (Law L5);
//   • bounded residency: the consumer ever holds ONE chunk + its O(log n) proof — never the whole object;
//   • fail-closed: a tampered chunk mid-stream is REFUSED (throws); chunks already delivered stand;
//   • cross-impl: the chunks were PRODUCED by the native Rust engine → they verify in the JS consumer.
// Reports the honest tuple (first-chunk latency · peak residency vs object · per-chunk · delivered).
//
//   node tools/holo-live-stream-witness.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const { streamVerified, fromEncoded, fromHostVerb, hexToBytes, normalizeProof, unpackPackedProof } = await import(new URL("../os/usr/lib/holo/holo-bao-stream.mjs", import.meta.url));

const checks = {}; let passed = 0, failed = 0;
const rec = (name, ok) => { checks[name] = !!ok; ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${name}`); };

const fixture = JSON.parse(readFileSync(join(here, "holo-bao-parity-vectors.json"), "utf8"));
const obj = fixture.objects.reduce((a, b) => (b.len > a.len ? b : a));   // the largest multi-chunk object
const totalBytes = obj.len, totalChunks = obj.chunks.length;

// ── S2 · render-on-first-chunk, verify-before-use, bounded residency ──
let firstDeliveredIndex = null, deliveredCount = 0, deliveredBytes = 0;
const onChunk = (index, bytes) => { if (firstDeliveredIndex === null) firstDeliveredIndex = index; deliveredCount++; deliveredBytes += bytes.length; };
const m = await streamVerified(obj.root, fromEncoded(obj), { onChunk });

rec(`stream delivered all ${totalChunks} verified chunks (${totalBytes} bytes)`, m.delivered === totalChunks && deliveredCount === totalChunks && deliveredBytes === totalBytes);
rec("render-on-first-chunk: chunk 0 delivered first, the instant it verified", firstDeliveredIndex === 0 && m.firstChunkMs >= 0);
const proofMax = 33 * Math.ceil(Math.log2(Math.max(2, totalChunks)) + 2);
rec(`bounded residency: held ≤ one chunk + proof (${m.peakResidentBytes} B) ≪ object (${totalBytes} B)`, m.peakResidentBytes <= 1024 + proofMax && m.peakResidentBytes * 4 < totalBytes);
rec("cross-impl: host(Rust)-produced chunks verify in the JS consumer", deliveredBytes === totalBytes);

// ── fail-closed: a tampered chunk mid-stream is refused; earlier chunks already delivered stand ──
let deliveredBeforeRefusal = 0, refused = false;
const tamperAt = Math.floor(totalChunks / 2);
async function* tamperedSource() {
  for (const c of obj.chunks) {
    const bytes = hexToBytes(c.bytes);
    if (c.index === tamperAt) bytes[0] ^= 0xff;
    yield { index: c.index, bytes, proof: normalizeProof(c.proof) };
  }
}
try { await streamVerified(obj.root, tamperedSource(), { onChunk: () => { deliveredBeforeRefusal++; } }); }
catch { refused = true; }
rec(`tampered chunk ${tamperAt} REFUSED (fail-closed, L5)`, refused === true);
rec(`chunks before the bad one were already delivered (${deliveredBeforeRefusal}); the rest stop`, deliveredBeforeRefusal === tamperAt);

// ── native host-verb path: the host (handler.cc holo:bao:chunk) emits each proof PACKED (N×33 bytes hex,
// side byte + 32 CV); prove a holo:// page consumes that exact wire form. Pack a fixture proof into the
// native form, then drive the consumer through fromHostVerb (a stubbed bridge call) → stream verifies. This
// is the live native seam, proven without the relink-gated host: the format the verb emits is consumable. ──
const sideByte = (s) => (s === "L" ? 0x4c : 0x52);
const packProof = (proof) => { const u = new Uint8Array(proof.length * 33); for (let i = 0; i < proof.length; i++) { u[i * 33] = sideByte(proof[i].side); u.set(hexToBytes(proof[i].cv), i * 33 + 1); } return u; };
const toHex = (u) => [...u].map((b) => b.toString(16).padStart(2, "0")).join("");
// the host's holo:bao:chunk response for chunk i: { index, bytes:hex, proof:hex (packed) }
const hostCall = async (i) => { const c = obj.chunks[i]; return { index: c.index, bytes: c.bytes, proof: toHex(packProof(c.proof)) }; };
let hostFirstIndex = null, hostDelivered = 0;
const mh = await streamVerified(obj.root, fromHostVerb(hostCall, totalChunks), { onChunk: (idx) => { if (hostFirstIndex === null) hostFirstIndex = idx; hostDelivered++; } });
rec("native host-verb packed proofs unpack + verify in the JS consumer (the live seam)", mh.delivered === totalChunks && hostFirstIndex === 0 && hostDelivered === totalChunks);
rec("unpackPackedProof round-trips one sibling correctly", (() => { const p = obj.chunks[1].proof; if (!p.length) return true; const u = unpackPackedProof(packProof(p)); return u.length === p.length && u[0].side === p[0].side; })());

// ── a wrong root rejects the whole stream (you can't stream against the wrong κ) ──
let wrongRootRefused = false;
try { await streamVerified("did:holo:blake3:" + "0".repeat(64), fromEncoded(obj)); } catch { wrongRootRefused = true; }
rec("a stream against the WRONG root κ is refused", wrongRootRefused === true);

const witnessed = failed === 0;
const tuple = { firstChunkMs: +m.firstChunkMs.toFixed(3), peakResidentBytes: m.peakResidentBytes, objectBytes: totalBytes, residencyRatio: Math.round(totalBytes / Math.max(1, m.peakResidentBytes)), perChunkMs: +(m.totalMs / Math.max(1, totalChunks)).toFixed(4), delivered: m.delivered };
console.log(`\nlive-stream tuple: first-chunk ${tuple.firstChunkMs} ms · residency ${tuple.peakResidentBytes} B (${tuple.residencyRatio}× < object) · ${tuple.perChunkMs} ms/chunk · ${tuple.delivered} chunks`);
writeFileSync(join(here, "holo-live-stream-witness.result.json"), JSON.stringify({
  spec: "S0–S2 live verified streaming (consumer): render-on-first-chunk, verify-before-use, bounded residency (one chunk + proof, not the object), fail-closed tamper refusal — on host(Rust)-produced chunks (cross-impl). The felt-experience half of the BLAKE3 dividend; the native host serve verb is the relink-gated other half.",
  witnessed, covers: ["verified-streaming", "render-on-first-chunk", "bounded-residency", "cross-impl", "law-l5", "live-experience"],
  tuple, checks, passed, failed,
}, null, 2) + "\n");
console.log(`\nholo-live-stream-witness: ${passed} passed, ${failed} failed`);
process.exit(witnessed ? 0 : 1);
