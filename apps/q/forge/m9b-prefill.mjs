// m9b-prefill.mjs — KV-cache PREFILL memoization on the REAL Q model. A long shared prefix (system
// prompt + RAG) is prefilled ONCE and cached by classκ = H(prefixTokens ⊕ modelκ ⊕ deviceClass); a
// repeat RESTORES the KV (forward opts.inKV) and decodes only the suffix — skipping the expensive prefill.
// 9a proved the KV κ reproduces (same/fresh-process, CPU), so WARM output is byte-identical to COLD.
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import { forgeGguf } from "./gguf-forge.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { sha256hex } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

const sha = (u8) => crypto.createHash("sha256").update(u8).digest("hex");
const bytesOf = (f) => new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
const buf = new Uint8Array(readFileSync(".models/qwen2.5-0.5b-instruct-q4_k_m.gguf"));
const f = forgeGguf(buf); const graph = synthesizeGraph(f.plan); const store = { get: (h) => f.blocks.get(h) };
const verified = new Set();
const load = (st, k) => { const hex = String(k).split(":").pop(); const b = st.get(hex); if (!b) throw new Error("κ?"); if (!verified.has(hex)) { if (sha256hex(b) !== hex) throw new Error("L5"); verified.add(hex); } return b; };
const modelK = f.rootKappa; const deviceClass = "cpu-tierA-f32";   // 9c: KV-κ valid at OWN + same-device-class scope
const tok = (i, salt = 0) => ((i * 2654435761 + salt * 40503) % 150000) >>> 0;   // deterministic valid token ids
const classKappa = (prefix) => sha256hex(new TextEncoder().encode("kv:" + modelK + "|" + deviceClass + "|" + prefix.join(",")));

// the memo: classκ(prefix) -> cached prefill KV (own/device-class scope)
const kvStore = new Map();
function prefillCached(prefix) {
  const ck = classKappa(prefix);
  if (kvStore.has(ck)) return { kv: kvStore.get(ck), hit: true, ck };
  const kv = {}; forward(f.plan, graph, store, prefix, { load, outKV: kv }); kvStore.set(ck, kv);
  return { kv, hit: false, ck };
}
const decodeLogits = (seq, inKV) => forward(f.plan, graph, store, seq, inKV ? { load, inKV } : { load });

console.log(`MODEL Qwen2.5-0.5B · device-class "${deviceClass}" · modelκ ${modelK.slice(0, 12)}…`);
console.log(`prefixLen   COLD(full prefill+decode)   WARM(restore KV, decode suffix)   speedup   output byte-identical`);
for (const PLEN of [16, 48, 96]) {
  const prefix = Array.from({ length: PLEN }, (_, i) => tok(i));
  const query = Array.from({ length: 8 }, (_, i) => tok(i, 1));
  const seq = prefix.concat(query);
  const { kv } = prefillCached(prefix);                    // turn 1 already cached this prefix's KV

  const c0 = performance.now(); const cold = decodeLogits(seq, null); const coldMs = performance.now() - c0;        // recompute everything
  const w0 = performance.now(); const warm = decodeLogits(seq, kv);   const warmMs = performance.now() - w0;        // restore KV, decode only the 8-tok suffix
  const identical = sha(bytesOf(cold)) === sha(bytesOf(warm));
  console.log(`  ${String(PLEN).padStart(4)}      ${coldMs.toFixed(0).padStart(8)} ms              ${warmMs.toFixed(0).padStart(8)} ms                ${(coldMs / warmMs).toFixed(1).padStart(5)}x      ${identical ? "YES ✓" : "NO ✗"}`);
}

// null control: a UNIQUE prefix never seen → no cache → pays full prefill + the hash (memo loses)
{
  const uniq = Array.from({ length: 64 }, (_, i) => tok(i, 999));
  const t0 = performance.now(); const r = prefillCached(uniq); const ms = performance.now() - t0;
  console.log(`\n[null control] unique 128-tok prefix: cache hit=${r.hit} → paid full prefill ${ms.toFixed(0)}ms + classκ hash. Memo wins ONLY when the prefix recurs.`);
}
console.log(`SCOPE (9c): this KV reuse is sound at OWN + same-device-class ("${deviceClass}") — 9a proved κ reproduces there. Cross-backend/cross-device κ DIVERGES (WITNESS GEMV 4.8e-7) → recompute or 7e-quorum the OUTPUT, never share raw KV across heterogeneous devices.`);
