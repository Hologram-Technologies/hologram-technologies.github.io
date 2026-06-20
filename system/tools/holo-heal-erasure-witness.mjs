#!/usr/bin/env node
// holo-heal-erasure-witness.mjs — PROVE the fractal-heal integration: when NO whole-object copy survives
// on any source, the healer rebuilds the whole from k of (k+m) surviving SHARDS (holo-erasure), re-derives
// it to its own κ (L5), and serves it — "cut it in half, the OS heals itself back to whole." Fails closed
// below k; still PREFERS a whole copy when one exists (erasure is the fallback, not the primary).
//
// Authority: holo-heal.mjs recover() (the production healer) + holo-erasure.mjs (RS, witnessed exhaustively)
// + UOR-ADDR re-derivation (L5). Pure Node → gated live (LIVE_EXIT).
//   node tools/holo-heal-erasure-witness.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const { makeHealer } = await import(pathToFileURL(join(OS, "sbin/holo-heal.mjs")));
const erasure = await import(pathToFileURL(join(OS, "usr/lib/holo/holo-erasure.mjs")));
const { sha256hex } = await import(pathToFileURL(join(OS, "usr/lib/holo/holo-uor.mjs")));
const { hexOf } = await import(pathToFileURL(join(OS, "sbin/holo-resolver.mjs")));

const checks = {}; let passed = 0, failed = 0;
const rec = (n, ok, d) => { checks[n] = !!ok; ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${n}${d ? "  (" + d + ")" : ""}`); };
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// the object to protect, and its erasure encoding (4 data + 2 parity → survive any 2 of 6)
const orig = new Uint8Array(3000); for (let i = 0; i < orig.length; i++) orig[i] = (i * 17 + 5) & 0xff;
const wholeHex = await sha256hex(orig);                         // the healer works on the sha256 axis
const wholeKappa = "did:holo:sha256:" + wholeHex;
const { manifest, shards } = await erasure.encode(orig, { data: 4, parity: 2, shardSize: 1024 });
const manifestFor = async (hex) => (hex === wholeHex ? manifest : null);
// a source that serves a chosen subset of SHARDS by their (blake3) κ — but NEVER the whole object.
const shardSource = (indices) => { const m = new Map(indices.map((i) => [hexOf(shards[i].kappa), shards[i].bytes])); const s = async (k) => m.get(hexOf(k)) || null; s.peer = "mesh-shards"; return s; };

// 1 · FRACTAL HEAL — no whole copy anywhere; rebuild from 4 of 6 shards (drop the first data + one parity)
{
  const store = new Map();
  const h = makeHealer({ sources: [shardSource([1, 2, 3, 4])], store, erasure, manifestFor });
  const r = await h.heal(wholeKappa);
  rec("rebuilds the whole from k surviving shards when no whole copy exists (fractal heal)", r.ok && r.recoveredFrom === "erasure" && eq(r.bytes, orig), r.ok ? `from ${r.recoveredFrom}` : "not healed");
}
// 2 · FAIL CLOSED below k — only 3 shards reachable → cannot fabricate; honest unresolved
{
  const store = new Map();
  const h = makeHealer({ sources: [shardSource([0, 1, 2])], store, erasure, manifestFor });
  const r = await h.heal(wholeKappa);
  rec("fewer than k shards ⇒ unresolved (fail-closed, never fabricates)", r.ok === false && r.refused === "unresolved");
}
// 3 · WHOLE PREFERRED — when a whole κ-verified copy exists, erasure is NOT used (fallback, not primary)
{
  const store = new Map();
  const whole = async (k) => (hexOf(k) === wholeHex ? orig.slice() : null); whole.peer = "origin";
  const h = makeHealer({ sources: [whole, shardSource([0, 1, 2, 3])], store, erasure, manifestFor });
  const r = await h.heal(wholeKappa);
  rec("a surviving whole copy is preferred over reconstruction (erasure is the fallback)", r.ok && r.recoveredFrom === "origin" && eq(r.bytes, orig), r.ok ? `from ${r.recoveredFrom}` : "not healed");
}
// 4 · NO-REGRESSION — without erasure deps, a missing object is still honestly unresolved (additive)
{
  const store = new Map();
  const h = makeHealer({ sources: [shardSource([0, 1, 2, 3])], store });   // no erasure/manifestFor injected
  const r = await h.heal(wholeKappa);
  rec("without erasure deps the healer is unchanged (additive, no regression)", r.ok === false && r.refused === "unresolved");
}

const witnessed = failed === 0;
writeFileSync(join(here, "holo-heal-erasure-witness.result.json"), JSON.stringify({
  spec: "Fractal-heal integration: holo-heal recover() rebuilds a whole object from k of (k+m) surviving shards via holo-erasure when no whole copy survives, re-derives it to its κ (L5), prefers a whole copy when present, fails closed below k, and is a no-op when erasure deps are absent (additive).",
  authority: "holo-heal.mjs recover() (production healer) · holo-erasure.mjs (RS, exhaustively witnessed) · UOR-ADDR re-derivation (Law L5) · holospaces Laws L1·L3·L5",
  witnessed, covers: ["fractal-heal", "erasure-recovery", "reconstruct-from-shards", "fail-closed", "whole-preferred", "no-regression"],
  checks, passed, failed,
}, null, 2) + "\n");
console.log(`\nholo-heal-erasure-witness: ${passed} passed, ${failed} failed — ${witnessed ? "GREEN" : "RED"}`);
process.exit(witnessed ? 0 : 1);
