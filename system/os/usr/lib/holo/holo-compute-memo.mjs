// holo-compute-memo.mjs — the O(1) L1/L2 COMPUTE memo. A computed result (a graded frame, a matmul, a
// token block) is addressed by its κ and memoized BEFORE the work: keyed by the INPUT identity (op κ + in
// κ), so a repeat returns the cached output with NO recompute and NO GPU dispatch — "compute once, address
// it, replay." holo-q-render already does this for built DOM; this is the general compute twin that sits
// under fabric.transform / a WebGPU kernel / any CPU fn.
//
// Two tiers (Law L3 — the store is the memory, RAM is its cache):
//   L1 — a bounded, page-resident map (LRU): zero-copy reuse, the resident set stays ≤ cap → low memory.
//   L2 — an injected durable store (OPFS/κ-store): survives L1 eviction and reload; recovered without recompute.
// Every cached output stays content-addressed, so it re-derives to its κ (Law L5) — a wrong kernel cannot
// masquerade as a hit. Delta compute falls out: stream the inputs and only the NOVEL (op,in) pays.
//
// node-, SW- and DOM-safe; pure (own hash, no imports). The work is injected — the memo never recomputes a
// known (op,in).

const hexOf = (k) => String(k).split(":").pop();
async function reDerive(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (globalThis.crypto && globalThis.crypto.subtle) {
    const d = await crypto.subtle.digest("SHA-256", u);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(u).digest("hex");
}
const kappaOf = async (bytes) => "did:holo:sha256:" + (await reDerive(bytes));
// the input identity: a deterministic κ of (op, in) — the lookup key BEFORE any work is done (Law L2).
const inputKey = async (opKappa, inKappa) => reDerive(new TextEncoder().encode(JSON.stringify({ in: String(inKappa), op: String(opKappa) })));

// makeComputeMemo({ l2, cap, pin }) →
//   compute(opκ, inκ, produce) → { kappa, bytes, hit:"L1"|"L2"|false, computed }
//     produce: async (opκ, inκ) → Uint8Array | { kappa?, bytes }   — the actual GPU/CPU work, run ONLY on a miss
//   get(outκ) → bytes | null     · stats() → { l1Hits, l2Hits, misses, computes, evictions, resident }
export function makeComputeMemo({ l2 = null, cap = 256, pin = null } = {}) {
  const index = new Map();                              // inputKey(hex) → outKappa  (which inputs produced which output)
  const l1 = new Map();                                 // outKappa-hex → bytes      (resident, LRU, bounded by cap)
  const stats = { l1Hits: 0, l2Hits: 0, misses: 0, computes: 0, evictions: 0 };
  const pinned = (hex) => (typeof pin === "function" ? !!pin(hex) : false);

  const l1Get = (hex) => { if (!l1.has(hex)) return null; const v = l1.get(hex); l1.delete(hex); l1.set(hex, v); return v; };   // bump recency
  const l1Set = (hex, bytes) => {
    l1.delete(hex); l1.set(hex, bytes);
    while (l1.size > cap) { let victim = null; for (const k of l1.keys()) { if (!pinned(k)) { victim = k; break; } } if (victim == null) break; l1.delete(victim); stats.evictions++; }
  };

  async function compute(opKappa, inKappa, produce) {
    const ik = await inputKey(opKappa, inKappa);
    const known = index.get(ik);
    if (known) {
      const hex = hexOf(known);
      const hot = l1Get(hex);
      if (hot) { stats.l1Hits++; return { kappa: known, bytes: hot, hit: "L1", computed: false }; }
      if (l2) {                                         // L1 missed but the durable tier may hold it (post-eviction / reload)
        const cold = await l2.get(hex);
        if (cold) { const u = cold instanceof Uint8Array ? cold : new Uint8Array(cold); l1Set(hex, u); stats.l2Hits++; return { kappa: known, bytes: u, hit: "L2", computed: false }; }
      }
    }
    // miss → do the work exactly once, address the output by content (Law L1/L5), cache at L1 + L2
    stats.misses++; stats.computes++;
    const raw = await produce(opKappa, inKappa);
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw && raw.bytes != null ? raw.bytes : raw);
    const outKappa = (raw && raw.kappa) || (await kappaOf(bytes));
    const hex = hexOf(outKappa);
    index.set(ik, outKappa); l1Set(hex, bytes);
    if (l2) { try { await l2.put(hex, bytes); } catch (e) {} }
    return { kappa: outKappa, bytes, hit: false, computed: true };
  }

  // seen(opκ, inκ) → has this (op,in) been computed before? (a cheap hit awaits — L1 or L2). Lets a render
  // loop know a region is NOVEL before paying for it, so it can hold a per-frame compute budget.
  async function seen(opKappa, inKappa) { return index.has(await inputKey(opKappa, inKappa)); }

  async function get(outKappa) {
    const hex = hexOf(outKappa);
    const hot = l1Get(hex); if (hot) return hot;
    if (l2) { const cold = await l2.get(hex); if (cold) { const u = cold instanceof Uint8Array ? cold : new Uint8Array(cold); l1Set(hex, u); return u; } }
    return null;
  }

  return { compute, get, seen, stats: () => ({ ...stats, resident: l1.size }), evictAll: () => { l1.clear(); } };
}

export default { makeComputeMemo };
