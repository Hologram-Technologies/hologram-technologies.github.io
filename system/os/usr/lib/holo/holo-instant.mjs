// holo-instant.mjs — the reusable "compute once, then instant + provable" engine.
//
// instant(classKey, compute) returns a deterministic result for an equivalence CLASS:
//   · classKey is the canonical class string a surface produces AFTER collapsing equivalent
//     requests (e.g. an image "look" = adjust:Z12|a,b). Provably-equivalent requests share it.
//   · first time (MISS): runs compute() — HONEST, normal speed — seals the bytes to the durable
//     κ-store and records a class→result pointer.
//   · every time after (HIT): serves the bytes from the store INSTANTLY and PROVES they re-derive
//     to the pinned κ (L5, byte-identical) — not assumed.
//
// Durable store = the OS's wired κ-cache (Cache API "holo-kappa-v2", keyed /.holo/ipfs/<κ>), the
// same commons holo-web-snapshot.mjs publishes to — so a result persists across sessions and the
// gateway resolves it with no network. Cross-PEER reuse rides the wired mesh share separately.
//
// Honest boundary: this never makes a FIRST computation faster. Its value is the 2nd occurrence,
// equivalent variants, and provable portability.

import { kappaBlake3 } from "/usr/lib/holo/holo-blake3.mjs";

const STORE = "holo-kappa-v2";
const TE = new TextEncoder();
const hex = (k) => String(k).replace(/^blake3:/, "");
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

// Open the durable commons; fall back to an in-memory shim where Cache API is absent (Node tests).
async function openStore() {
  if (typeof caches !== "undefined") {
    try { return await caches.open(STORE); } catch {}
  }
  const m = (globalThis.__holoInstantMem ||= new Map());
  return {
    match: async (k) => (m.has(k) ? new Response(m.get(k)) : undefined),
    put: async (k, r) => { m.set(k, new Uint8Array(await r.clone().arrayBuffer())); },
  };
}

/// instant(classKey, compute) -> { bytes, hit, verified, classKappa, resultKappa, ms }
export async function instant(classKey, compute) {
  const t0 = now();
  const classKappa = kappaBlake3(TE.encode(String(classKey)));
  const c = await openStore();
  const ptrKey = "https://holo.kappa/instant/" + hex(classKappa);

  const ptr = await c.match(ptrKey);
  if (ptr) {
    try {
      const meta = await ptr.json(); // { resultKey, resultKappa }
      const res = await c.match("https://holo.kappa/ipfs/" + meta.resultKey);
      if (res) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        const verified = kappaBlake3(bytes) === meta.resultKappa; // L5 proof
        return { bytes, hit: true, verified, classKappa, resultKappa: meta.resultKappa, ms: now() - t0 };
      }
    } catch {}
  }

  // MISS — do the real work (honest, normal speed), then seal it for every future occurrence.
  const bytes = await compute();
  const resultKappa = kappaBlake3(bytes);
  const resultKey = hex(resultKappa);
  try {
    await c.put("https://holo.kappa/ipfs/" + resultKey, new Response(bytes, { headers: { "x-holo-verified": "L5", "cache-control": "public, max-age=31536000, immutable" } }));
    await c.put(ptrKey, new Response(JSON.stringify({ resultKey, resultKappa }), { headers: { "content-type": "application/json" } }));
  } catch {}
  return { bytes, hit: false, verified: true, classKappa, resultKappa, ms: now() - t0 };
}

/// peek(classKey) -> the class κ without computing (for UI hints).
export function classKappaOf(classKey) {
  return kappaBlake3(TE.encode(String(classKey)));
}

export default { instant, classKappaOf };
