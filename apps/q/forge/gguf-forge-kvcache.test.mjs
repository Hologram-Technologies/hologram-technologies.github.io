// KV-state codec tests (substrate-convergence S1). (1) synthetic round-trip identity
// on crafted KV. (2) REAL model KV: run a forward, capture the KV state, serialize →
// restore, and prove it's bit-identical — the precondition for κ-addressing it.
// (3) κ-keying: same model+prefix → same κ; any token change → different κ.

import assert from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { kvSerialize, kvRestore, kvByteLen, kvBlockKappa, KvStore } from "./gguf-forge-kvcache.mjs";
import { forgeGguf } from "./gguf-forge.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); } catch (e) { fail++; console.log("FAIL  " + name + "\n      " + e.message); } };

function mkKV(nLayer, nPos, kvDim, seed) {
  let s = seed >>> 0; const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; };
  const Kc = [], Vc = [];
  for (let il = 0; il < nLayer; il++) { const lk = [], lv = []; for (let p = 0; p < nPos; p++) { const k = new Float32Array(kvDim), v = new Float32Array(kvDim); for (let d = 0; d < kvDim; d++) { k[d] = r(); v[d] = r(); } lk.push(k); lv.push(v); } Kc.push(lk); Vc.push(lv); }
  return { nLayer, nPos, kvDim, Kc, Vc };
}
const kvEqual = (a, b) => {
  if (a.nLayer !== b.nLayer || a.nPos !== b.nPos || a.kvDim !== b.kvDim) return false;
  for (let il = 0; il < a.nLayer; il++) for (let p = 0; p < a.nPos; p++) for (let d = 0; d < a.kvDim; d++) {
    if (a.Kc[il][p][d] !== b.Kc[il][p][d] || a.Vc[il][p][d] !== b.Vc[il][p][d]) return false;
  }
  return true;
};

t("synthetic round-trip: restore∘serialize = identity, exact size", () => {
  const kv = mkKV(3, 5, 8, 12345);
  const bytes = kvSerialize(kv);
  assert.strictEqual(bytes.length, kvByteLen(3, 5, 8), "byte length");
  const kv2 = kvRestore(bytes);
  assert.ok(kvEqual(kv, kv2), "values identical");
  // re-serialize is byte-identical (stable encoding)
  const bytes2 = kvSerialize(kv2);
  assert.strictEqual(bytes.length, bytes2.length);
  for (let i = 0; i < bytes.length; i++) assert.strictEqual(bytes[i], bytes2[i], `byte ${i}`);
});

t("kvRestore rejects corrupted magic / wrong length", () => {
  const kv = mkKV(2, 2, 4, 7); const b = kvSerialize(kv);
  const bad = b.slice(); bad[0] ^= 0xff;
  assert.throws(() => kvRestore(bad), /magic/);
  assert.throws(() => kvRestore(b.subarray(0, b.length - 4)), /length/);
});

t("kvBlockKappa: deterministic, prefix-sensitive, model-sensitive", () => {
  const a = kvBlockKappa("did:holo:sha256:" + "a".repeat(64), [1, 2, 3]);
  const a2 = kvBlockKappa("sha256:" + "a".repeat(64), [1, 2, 3]);
  const b = kvBlockKappa("sha256:" + "a".repeat(64), [1, 2, 4]);      // one token differs
  const c = kvBlockKappa("sha256:" + "b".repeat(64), [1, 2, 3]);      // different model
  assert.strictEqual(a.hex, a2.hex, "stable across kappa prefix form");
  assert.notStrictEqual(a.hex, b.hex, "prefix-sensitive");
  assert.notStrictEqual(a.hex, c.hex, "model-sensitive");
  assert.match(a.kappa, /^did:holo:sha256:[0-9a-f]{64}$/);
});

// ── REAL model: round-trip + prefix-cache behavior-preservation (qwen2.5-0.5b) ──
const MODEL = ".models/qwen2.5-0.5b-instruct-q4_k_m.gguf";
if (existsSync(MODEL)) {
  const f = forgeGguf(new Uint8Array(readFileSync(MODEL)));
  const graph = synthesizeGraph(f.plan);
  const wstore = { get: (hex) => f.blocks.get(hex) };
  const PREFIX = [785, 6722, 374], SUFFIX = [264, 11, 13];
  const SEQ = [...PREFIX, ...SUFFIX];
  const eqLogits = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };

  t("REAL model: captured KV serializes and restores bit-identically", () => {
    const outKV = {};
    forward(f.plan, graph, wstore, PREFIX, { outKV });
    assert.strictEqual(outKV.nPos, PREFIX.length);
    assert.strictEqual(outKV.kvDim, graph.stats.n_head_kv * graph.stats.head_dim);
    const kv2 = kvRestore(kvSerialize(outKV));
    assert.ok(kvEqual(outKV, kv2), "real KV identical after round-trip");
    console.log(`      KV: ${outKV.nLayer}L × ${outKV.nPos}pos × ${outKV.kvDim}dim = ${(kvByteLen(outKV.nLayer, outKV.nPos, outKV.kvDim) / 1024).toFixed(1)} KB`);
  });

  t("REAL model: prefix-cached forward is BIT-IDENTICAL to a full forward", () => {
    const full = forward(f.plan, graph, wstore, SEQ);                 // fresh, no cache
    const kvStore = new KvStore();
    const outKV = {};
    forward(f.plan, graph, wstore, PREFIX, { outKV });               // prefill prefix once
    kvStore.put(f.rootKappa, PREFIX, outKV);                          // → κ-addressed, L5, dedup
    const hit = kvStore.longestPrefix(f.rootKappa, SEQ);             // radix lookup
    assert.ok(hit && hit.len === PREFIX.length, `prefix hit len ${hit?.len}`);
    const cached = forward(f.plan, graph, wstore, SEQ, { inKV: hit.kv }); // decode suffix only
    assert.ok(eqLogits(Array.from(full), Array.from(cached)), "cached logits bit-identical to full");
    // dedup: putting the same prefix again is a no-op
    kvStore.put(f.rootKappa, PREFIX, outKV);
    assert.strictEqual(kvStore.size, 1, "L2 dedup: identical prefix stored once");
    console.log(`      prefix-hit covered ${hit.len}/${SEQ.length} tokens; store ${(kvStore.byteLen() / 1024).toFixed(1)} KB, ${kvStore.size} block`);
  });

  t("REAL model: tampered KV block is refused (L5)", () => {
    const kvStore = new KvStore();
    const outKV = {}; forward(f.plan, graph, wstore, PREFIX, { outKV });
    kvStore.put(f.rootKappa, PREFIX, outKV);
    const e = [...kvStore.map.values()][0]; e.bytes[64] ^= 0xff;       // corrupt a byte
    assert.throws(() => kvStore.get(f.rootKappa, PREFIX), /L5 REFUSE/);
  });

  // tie to llama.cpp: the prefix-cached next token == forge-ref greedy next token
  const EXE = "C:/Users/pavel/Desktop/qvac-fabric-llm.cpp-master/qvac-fabric-llm.cpp-master/forge-ref.exe";
  const MINGW = "C:/Users/pavel/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin";
  if (existsSync(EXE)) {
    t("REAL model: prefix-cached next token matches llama.cpp", () => {
      const kvStore = new KvStore();
      const outKV = {}; forward(f.plan, graph, wstore, PREFIX, { outKV });
      kvStore.put(f.rootKappa, PREFIX, outKV);
      const hit = kvStore.longestPrefix(f.rootKappa, SEQ);
      const lg = forward(f.plan, graph, wstore, SEQ, { inKV: hit.kv });
      let am = 0; for (let i = 1; i < lg.length; i++) if (lg[i] > lg[am]) am = i;
      const out = execFileSync(EXE, [MODEL, "--gen", "1", ...SEQ.map(String)], { env: { ...process.env, PATH: MINGW + ";" + process.env.PATH }, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const ref = +((out.match(/gen:\s*(\d+)/) || [])[1]);
      assert.strictEqual(am, ref, `cached argmax ${am} vs llama.cpp ${ref}`);
      console.log(`      prefix-cached next token = ${am} == llama.cpp`);
    });
  }
} else {
  console.log("  --  REAL model tests skipped (model not present)");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
