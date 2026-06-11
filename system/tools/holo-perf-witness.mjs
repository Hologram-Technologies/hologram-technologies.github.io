#!/usr/bin/env node
// holo-perf-witness.mjs — EVIDENCE the speed claim ("very fast in any browser"). Everything in
// Hologram OS costs one thing on the hot path: canonicalize → hash → re-derive-and-compare (Law
// L5). If that is fast, the system is fast — in Node AND in the browser, where the SAME
// holo-object/holo-uor code runs (sha256 via WebCrypto, blake3 pure-JS). This witness BENCHMARKS
// that hot path and REPORTS the real numbers (MB/s, ops/sec, ms/op) as the proof, while the gate
// asserts only generous, machine-independent bounds (≥10× headroom) so it never false-fails on a
// loaded CI box. Pure Node → the gate re-runs it live. The in-browser cold-boot facet is the
// separate #boot Chromium tier (this row + that row together evidence "fast in any browser").
// Authority: W3C High Resolution Time (performance.now) · BLAKE3 + SHA-256 reference throughput ·
// UOR-ADDR re-derivation (Law L5) · the measured hot-path baseline.
//
//   node tools/holo-perf-witness.mjs

import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const L = (p) => new URL("../os/usr/lib/holo/" + p, import.meta.url);
const { seal, verify, verifyDeep, makeObject, linkTo, putDual, blakeDid, resolve } = await import(L("holo-object.mjs"));
const { sha256hex } = await import(L("holo-uor.mjs"));
const { blake3hex } = await import(L("holo-blake3.mjs"));

const checks = {}; let passed = 0, failed = 0;
const rec = (name, ok, detail) => { checks[name] = !!ok; ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${name}${detail ? "  (" + detail + ")" : ""}`); };
const now = () => performance.now();            // W3C High Resolution Time
const r2 = (x) => Math.round(x * 100) / 100;
const metrics = {};

// ── 1 · hash throughput on the two axes (sha256 = open-web, blake3 = substrate) ──────────────
const MB = 4, big = Buffer.allocUnsafe(MB * 1024 * 1024);
for (let i = 0; i < big.length; i++) big[i] = i & 0xff;
let t = now(); blake3hex(big); const blakeMBs = MB / ((now() - t) / 1000);
t = now(); sha256hex(big); const shaMBs = MB / ((now() - t) / 1000);
metrics.hash = { blake3_MBps: r2(blakeMBs), sha256_MBps: r2(shaMBs), sample_MB: MB };
rec("blake3 (substrate axis) hashes at a real throughput", blakeMBs > 1, `${r2(blakeMBs)} MB/s`);
rec("sha256 (open-web axis) hashes at a real throughput", shaMBs > 2, `${r2(shaMBs)} MB/s`);

// ── 2 · the object hot path: seal + verify (re-derive, Law L5) ────────────────────────────────
const VN = 5000;
t = now();
for (let i = 0; i < VN; i++) { const o = seal({ "@context": "https://schema.org/", "@type": "schema:Dataset", i, tag: "perf" }); if (!verify(o)) { rec("seal+verify correctness", false); break; } }
const vMs = now() - t, vOps = VN / (vMs / 1000);
metrics.sealVerify = { ops: VN, total_ms: r2(vMs), ms_per_op: r2(vMs / VN), ops_per_sec: Math.round(vOps) };
rec("seal+verify hot path is fast", vMs < 10000 && vOps > 200, `${Math.round(vOps)} ops/s · ${r2(vMs / VN)} ms/op`);

// ── 3 · verifyDeep over a Merkle-DAG (the real resolve cost) + fail-fast tamper refusal ───────
const store = new Map();
const K = 100, leaves = [];
for (let i = 0; i < K; i++) leaves.push(makeObject(store, { type: "schema:Dataset", n: i, blob: "x".repeat(96) }));
const parent = makeObject(store, { type: "schema:Collection", links: leaves.map((c) => linkTo(store, "part", c)) });
t = now(); const deep = verifyDeep(store, parent); const dMs = now() - t;
metrics.verifyDeep = { nodes: K + 1, ms: r2(dMs) };
rec("verifyDeep re-derives a whole DAG within budget", deep.ok === true && dMs < 5000, `${K + 1} nodes · ${r2(dMs)} ms`);
const bad = new Map(store); bad.set(leaves[K - 1].id.split(":").pop(), Buffer.from('{"tampered":true}', "utf8"));
t = now(); const refuse = verifyDeep(bad, parent); const tMs = now() - t;
rec("a tampered node is refused FAST (fail-fast L5)", refuse.ok === false && tMs < 5000, `refused in ${r2(tMs)} ms`);

// ── 4 · dual-axis resolution throughput — resolve by BOTH the sha256 and blake3 κ ─────────────
const RN = 2000, rstore = new Map(), ids = [];
for (let i = 0; i < RN; i++) ids.push(putDual(rstore, { "@context": "https://schema.org/", "@type": "schema:Thing", i }));
t = now();
let okBoth = true;
for (const o of ids) { const a = resolve(rstore, o.id), b = resolve(rstore, blakeDid(o)); if (!a || !b || a.id !== o.id || b.id !== o.id) { okBoth = false; break; } }
const rMs = now() - t, rOps = (RN * 2) / (rMs / 1000);
metrics.dualResolve = { objects: RN, resolves: RN * 2, total_ms: r2(rMs), resolves_per_sec: Math.round(rOps) };
rec("dual-axis resolution (sha256 + blake3) is fast", okBoth && rMs < 10000 && rOps > 200, `${Math.round(rOps)} resolves/s`);

// ── 5 · hashing scales LINEARLY in bytes (no accidental O(n²)) ────────────────────────────────
const oneMB = big.subarray(0, 1024 * 1024);
let t1 = now(); blake3hex(oneMB); t1 = now() - t1;
let t4 = now(); blake3hex(big); t4 = now() - t4;
const ratio = t1 > 0 ? t4 / t1 : 1;
metrics.scaling = { t_1MB_ms: r2(t1), t_4MB_ms: r2(t4), ratio_4x_input: r2(ratio) };
rec("hash time scales ~linearly with input (4× bytes ≤ 8× time)", ratio <= 8, `4× input → ${r2(ratio)}× time`);

const witnessed = failed === 0;
writeFileSync(join(here, "holo-perf-witness.result.json"), JSON.stringify({
  spec: "Hologram OS is FAST — the content-addressing + verification hot path that 'fast in any browser' rests on is benchmarked within budget and its real throughput reported: blake3 (substrate axis) + sha256 hashing MB/s, seal+verify and verifyDeep ops/sec, dual-axis resolution, fail-fast tamper refusal, and linear (not quadratic) hash scaling. The gate asserts generous bounds (≥10× headroom); the numbers are the evidence. Paired with #boot (serverless boot in a real browser), this evidences the speed claim.",
  authority: "W3C High Resolution Time (performance.now) · BLAKE3 + SHA-256 reference throughput · UOR-ADDR re-derivation (Law L5) · the measured hot-path baseline — the in-browser cold-boot facet is the #boot Chromium tier (degrade honestly)",
  witnessed,
  covers: ["performance", "hot-path", "hash-throughput", "verify-rederivation", "verifyDeep", "dual-axis-resolution", "linear-scaling", "law-l5"],
  metrics,
  checks, passed, failed,
}, null, 2) + "\n");

console.log(`\nholo-perf-witness: ${passed} passed, ${failed} failed`);
console.log(`  hash: blake3 ${metrics.hash.blake3_MBps} MB/s · sha256 ${metrics.hash.sha256_MBps} MB/s`);
console.log(`  seal+verify ${metrics.sealVerify.ops_per_sec} ops/s · verifyDeep(${K + 1}) ${metrics.verifyDeep.ms} ms · dual-resolve ${metrics.dualResolve.resolves_per_sec}/s`);
process.exit(witnessed ? 0 : 1);
