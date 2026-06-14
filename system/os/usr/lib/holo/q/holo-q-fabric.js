// holo-q-fabric.js — the low-latency compute FABRIC for Holo Q's Mixture-of-Specialists (ADR-0084).
// It makes every specialist call ride the substrate's existing rails so the experience converges on
// "streaming + instant": a content-addressed κ-memo (Law L3 — "identical ask addresses the SAME
// result → O(1) replay", the holo-mind.memoKey idiom) over the durable OS κ-store (holo-store.js),
// fronted by a hot in-memory cache, exposed as ONE streaming interface, with each result carrying its
// content κ so a κ-addressed renderer reuses identical on-screen fragments (compute once, address it,
// replay — never recompute, never re-render).
//
// WHY this is the unlock: a fleet of tiny specialists (holo-q-mux) is only "real-time" if repeated and
// structural work is free. The substrate already addresses compute by content — Holo Q's answer memo,
// the κ-store, Holo Mind's plan memo. This fabric generalizes that one idiom across ALL helper tasks:
// the FIRST time an (model, input, params) is seen it streams and is sealed to a κ; every identical
// ask after is O(1) with no compute and no token stream — the hot path of an LLM-like UI. The
// orchestrator (Holo Mind, ADR-0081) discovers (mux) · applies (embed/classify/generate) · and
// self-improves (reevaluate) on top; this is the layer that makes its outputs cheap to render live.
//
// DOM-free, dependency-free. Uses Web Crypto (sha-256) present in both the browser and Node; the
// κ-store backend is injectable (memBackend for a witness, idbBackend for durability across reloads).

// a tiny canonicalizer (sorted keys — RFC 8785 subset) so the memo key is order-independent. Matches
// holo-qvac.mjs canon / holo-mind jcs for the shapes used here.
function canon(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
}
async function sha256hex(str) {
  const data = new TextEncoder().encode(str);
  const c = (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.subtle) || null;
  if (c) { const h = await c.digest("SHA-256", data); return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
  // last-resort non-crypto fallback (witness only) — still deterministic.
  let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return ("00000000" + (h >>> 0).toString(16)).slice(-8);
}
const enc = (v) => new TextEncoder().encode(JSON.stringify(v));
const dec = (b) => JSON.parse(new TextDecoder().decode(b instanceof Uint8Array ? b : new Uint8Array(b)));

// ── a minimal in-memory κ-store (used when the OS store isn't injected) ───────────────────────────
function memStore() {
  const m = new Map();
  return { async put(bytes) { const k = await sha256hex(new TextDecoder().decode(bytes)); m.set(k, bytes); return k; },
           async get(k) { return m.get(k) || null; }, async has(k) { return m.has(k); } };
}

// ── the fabric ─────────────────────────────────────────────────────────────────────────────────────
// createFabric({ store?, hotMax? }) — `store` is an OS κ-store ({put(bytes)→κ, get(κ)}); omit for an
// in-memory one. Providers are the per-task brains the mux binds: { id, embed?|classify?|generate? }.
export function createFabric({ store = null, hotMax = 512 } = {}) {
  const kstore = store || memStore();
  const hot = new Map();                                  // memoKey → { value, kappa }   (hot O(1))
  const index = new Map();                                // memoKey → kappa              (durable lookup)
  const stats = { hits: 0, misses: 0, coldMs: 0, coldN: 0 };

  function touchHot(key, rec) {                            // tiny LRU
    hot.delete(key); hot.set(key, rec);
    if (hot.size > hotMax) hot.delete(hot.keys().next().value);
  }
  const memoKey = (task, providerId, input, params) =>
    sha256hex(canon({ t: task, m: providerId || "?", i: input, p: params || {} }));

  // run({ provider, task, input, params, signal }) → async generator of events:
  //   { phase:"final"|"delta", value?, partial?, delta?, kappa, cached, ms }
  // cached (hot or durable) → ONE "final" event in O(1), no compute. Cold generative → streamed
  // "delta" events then a sealed "final". Every event carries the content κ (κ-addressed rendering).
  async function* run({ provider, task, input, params = {}, signal } = {}) {
    if (!provider) throw new Error("holo-q-fabric: no provider for task " + task);
    const key = await memoKey(task, provider.id, input, params);

    // 1) hot path — instant replay
    if (hot.has(key)) { const r = hot.get(key); stats.hits++; touchHot(key, r); yield { phase: "final", value: r.value, kappa: r.kappa, cached: "hot", ms: 0 }; return; }
    // 2) durable path — sealed earlier (survives reload when backed by idbBackend)
    if (index.has(key)) {
      const kappa = index.get(key); const bytes = await kstore.get(kappa);
      if (bytes) { const value = dec(bytes); const rec = { value, kappa }; touchHot(key, rec); stats.hits++; yield { phase: "final", value, kappa, cached: "durable", ms: 0 }; return; }
    }

    // 3) cold path — compute once, stream, seal to a κ
    const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    let value;
    if (typeof provider.generate === "function") {        // streaming brain (LLM-like) → emit deltas live
      let acc = "";
      for await (const tok of provider.generate(input, { ...params, signal })) {
        if (signal && signal.aborted) break;
        if (tok && typeof tok === "object" && tok.replace != null) acc = tok.replace;        // block-refine (diffusion)
        else if (tok && typeof tok === "object" && tok.delta != null) acc += tok.delta;       // append (object delta)
        else acc += String(tok);                                                              // append (plain token)
        yield { phase: "delta", delta: tok, partial: acc, kappa: null, cached: false, ms: (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0 };
      }
      value = acc;
    } else if (typeof provider.embed === "function") {    // instant specialist (embedding/recall)
      value = await provider.embed(input, { signal });
    } else if (typeof provider.classify === "function") {
      value = await provider.classify(input, { signal });
    } else throw new Error("holo-q-fabric: provider has no embed/classify/generate");

    const kappa = await kstore.put(enc(value));           // seal the output to its content address
    index.set(key, kappa); touchHot(key, { value, kappa });
    const ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
    stats.misses++; stats.coldMs += ms; stats.coldN++;
    yield { phase: "final", value, kappa, cached: false, ms };
  }

  // run to completion — the simple, non-streaming surface (await the final value + its κ).
  async function compute(args) { let last = null; for await (const e of run(args)) if (e.phase === "final") last = e; return last; }

  // κ-addressed render key — a UI keeps Map<κ, node> and skips re-rendering identical output.
  async function renderKey(value) { return kstore.put ? sha256hex(canon(value)) : sha256hex(canon(value)); }

  function fabricStats() {
    const total = stats.hits + stats.misses;
    return { hits: stats.hits, misses: stats.misses, total,
      hitRate: total ? +(stats.hits / total).toFixed(3) : 0,
      avgColdMs: stats.coldN ? +(stats.coldMs / stats.coldN).toFixed(2) : 0,
      hotEntries: hot.size, sealed: index.size };
  }
  return { run, compute, renderKey, memoKey, stats: fabricStats, clear: () => { hot.clear(); index.clear(); } };
}

// describeFabric() — the seam's honest contract: what makes it low-latency, what it leverages.
export function describeFabric() {
  return {
    idiom: "content-addressed compute — κ(model ⊕ input ⊕ params) → O(1) replay (Law L3, the holo-mind.memoKey generalized to every specialist)",
    durability: "the durable OS κ-store (holo-store.js idbBackend) holds sealed outputs across reloads; a hot LRU fronts it",
    streaming: "run() is one async-iterable: cached → a single instant final; cold generative → live deltas then a sealed final",
    render: "every result carries its content κ → a κ-addressed renderer reuses identical on-screen fragments (never re-render)",
    orchestrator: "Holo Mind (ADR-0081) discovers (mux) · applies (embed/classify/generate) · self-improves (reevaluate) over this fabric",
    honest: "the input→κ index is in-memory in v1 (sealed bytes are durable); cross-reload O(1) needs the index persisted too — a small refinement",
  };
}

export default { createFabric, describeFabric };
