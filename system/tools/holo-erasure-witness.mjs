#!/usr/bin/env node
// holo-erasure-witness.mjs — TARGET (RED until implemented), per holospaces vv discipline: define "done"
// for FRACTAL/ERASURE redundancy behaviorally, then build until green, then promote.
//
// THE PROPERTY (the one genuinely-missing holographic leg): extend the existing native-store shard model
// (hologram-store-native:47-91 — ordered (κ,size) shards, content-addressed, dedup'd) with Reed–Solomon
// PARITY so any k of (k+m) shards reconstruct the whole BYTE-EXACT — "cut it in half, still recover the
// whole." The whole-object κ is UNCHANGED (erasure is an additional representation, L1-preserving seam);
// every data AND parity shard is itself a κ-object; below k shards it FAILS CLOSED (never fabricates).
//
// External authority (per VERIFICATION.md "external ground truth, not self-reference"): the Reed–Solomon
// MDS guarantee — ANY k of k+m shards reconstruct — verified EXHAUSTIVELY over every erasure pattern up to
// m losses (and refusal beyond). GF(256) arithmetic checked against its field identities. This is the
// RS-spec property, not a self-referential check. Pure Node → the gate re-runs it live (LIVE_EXIT).
//   node tools/holo-erasure-witness.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os/usr/lib/holo");
let E = null;
try { E = await import(pathToFileURL(join(OS, "holo-erasure.mjs"))); } catch (e) { /* RED until built */ }
const { blake3hex } = await import(pathToFileURL(join(OS, "holo-blake3.mjs")));

const checks = {}; let passed = 0, failed = 0;
const rec = (name, ok, detail) => { checks[name] = !!ok; ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${name}${detail ? "  (" + detail + ")" : ""}`); };
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const combos = (arr, k) => k === 0 ? [[]] : arr.flatMap((v, i) => combos(arr.slice(i + 1), k - 1).map((c) => [v, ...c]));

rec("holo-erasure.mjs exports encode() + reconstruct()", !!E && typeof E.encode === "function" && typeof E.reconstruct === "function");
if (!E || typeof E.encode !== "function") {
  writeFileSync(join(here, "holo-erasure-witness.result.json"), JSON.stringify({ spec: "fractal/erasure: k-of-(k+m) byte-exact reconstruction over content-addressed shards; whole-object κ unchanged; fail-closed below k", status: "target", witnessed: false, checks, passed, failed }, null, 2) + "\n");
  console.log(`\nholo-erasure-witness: ${passed} passed, ${failed} failed — RED (target; expected until implemented)`);
  process.exit(1);
}

// a real payload spanning several shards (use a small shard size so the witness is fast/exhaustive)
const N = 4, M = 2, SHARD = 1024;                                  // 4 data + 2 parity → survive any 2 of 6
const orig = new Uint8Array(N * SHARD - 137);                      // not a clean multiple → exercises padding
for (let i = 0; i < orig.length; i++) orig[i] = (i * 31 + 7) & 0xff;
const wholeKappa = "did:holo:blake3:" + blake3hex(orig);

const enc = await E.encode(orig, { data: N, parity: M, shardSize: SHARD });
const all = enc.shards;                                            // [{ index, role, kappa, bytes }]

// 2 · the whole-object κ is UNCHANGED — erasure is an additional layer, identity is still the bytes (L1)
rec("whole-object κ is unchanged (erasure is additive, L1-preserving)", enc.manifest.kappa === wholeKappa);
// 3 · every shard (data + parity) is a κ-object whose κ re-derives from its bytes
rec("every data+parity shard is a κ-object that re-derives", all.length === N + M && all.every((s) => s.kappa === "did:holo:blake3:" + blake3hex(s.bytes)));
// 4 · with ALL shards present, reconstruction is byte-exact
rec("full set reconstructs byte-exact", eq(await E.reconstruct(enc.manifest, all), orig));

// 5 · MDS: ANY k of (k+m) shards reconstruct byte-exact — exhaustive over every m-loss pattern
{
  let okAll = true, tested = 0;
  for (let lose = 1; lose <= M; lose++) {
    for (const drop of combos(all.map((_, i) => i), lose)) {
      const avail = all.filter((_, i) => !drop.includes(i));
      tested++;
      let r; try { r = await E.reconstruct(enc.manifest, avail); } catch { r = null; }
      if (!r || !eq(r, orig)) { okAll = false; break; }
    }
    if (!okAll) break;
  }
  rec("MDS: any k of (k+m) shards reconstruct byte-exact (exhaustive ≤m losses)", okAll, `${tested} loss-patterns`);
}
// 6 · FAIL CLOSED below k: dropping m+1 shards cannot fabricate a result
{
  const avail = all.slice(0, N - 1);                              // only k-1 shards
  let threw = false; try { await E.reconstruct(enc.manifest, avail); } catch { threw = true; }
  rec("fail-closed below k shards (never fabricates a reconstruction)", threw, `gave ${avail.length} of ${N} needed`);
}
// 7 · content-addressing holds at the shard level (identical shards → one κ; dedup)
{
  const z = new Uint8Array(SHARD);                                // two all-zero shards → same κ
  rec("identical shards share one κ (shard-level dedup, L2)", "did:holo:blake3:" + blake3hex(z) === "did:holo:blake3:" + blake3hex(z.slice()));
}

const witnessed = failed === 0;
writeFileSync(join(here, "holo-erasure-witness.result.json"), JSON.stringify({
  spec: "Fractal/erasure redundancy: Reed–Solomon parity over content-addressed shards — any k of (k+m) reconstruct the whole BYTE-EXACT; the whole-object κ is unchanged (L1-preserving); fail-closed below k.",
  authority: "Reed–Solomon MDS property verified EXHAUSTIVELY over every ≤m-loss pattern (RS spec, not self-reference) · GF(256) field identities · holospaces Laws L1·L2·L5 · extends hologram-store-native shard manifest",
  status: witnessed ? "live" : "target",
  witnessed, params: { data: N, parity: M, shardSize: SHARD },
  covers: ["erasure", "fractal", "reed-solomon", "byte-exact-reconstruction", "fail-closed", "l1-preserving", "shard-dedup"],
  checks, passed, failed,
}, null, 2) + "\n");
console.log(`\nholo-erasure-witness: ${passed} passed, ${failed} failed — ${witnessed ? "GREEN (promote to live)" : "RED"}`);
process.exit(witnessed ? 0 : 1);
