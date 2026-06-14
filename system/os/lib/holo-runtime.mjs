// holo-runtime.mjs — THE canonical definition of the Holo Runtime.
//
// The Holo Runtime is the single, content-addressed native runtime that EVERY holo app
// loads inside the holospace shell. It physically lives once, at /usr/lib/holo/ in the OS
// image, and is reached by apps through the flat `/_shared/<engine>` URL space — which the
// ONE flat→FHS mapping (os/lib/holo-fhs-map.mjs) routes to /usr/lib/holo/<engine>, wherever
// the app references it. There is exactly one instance for the entire Hologram OS and all of
// its applications.
//
// THE THREE TIERS (one home each — never two):
//   1. Holospace shell   — the OS frame that hosts apps      → /usr/share/frame/ + the boot chain
//   2. Holo Runtime      — core features every app inherits  → /usr/lib/holo/        (THIS object)
//   3. Holo apps         — self-contained app logic + its    → Hologram Apps/apps/<id>/
//                          own app-ONLY engines
//
// THE INVARIANT (enforced by tools/holo-runtime-witness.mjs):
//   No engine exists in two places. Any engine an app shares with the runtime is canonical in
//   the Holo Runtime and is NOT copied into the app's bundle; the app declares it in
//   holospace.json `shared` and the lock vendors the runtime copy as `_shared/<engine>`. An
//   app's own `_shared/` may carry ONLY app-only engines that have no runtime master.
//
// Pure + dependency-free (string/data only) so it is safe to import from the dev server, the
// in-browser Service Worker, and witnesses alike. Law L2: one canonical definition, no drift.

export const HOLO_RUNTIME = {
  name: "Holo Runtime",
  version: "1.1.0",                                   // 1.1 — incorporates the content-addressed store + delivery tiers
  // the single physical home of the runtime inside the OS (FHS) image.
  root: "usr/lib/holo",
  // apps reach the runtime through this flat prefix; holo-fhs-map.mjs maps it to `root`.
  flatPrefix: "_shared",
  kind: "canonical-native-runtime",

  // THE SUBSTRATE CAPABILITIES every holo app inherits from the ONE runtime — declared here, each
  // proven by its named witness. Each lives once; an app BINDS it, never reimplements it (Law L2).
  // This is what makes the Holo Runtime the single canonical runtime for all hologram native apps:
  // not just "shared engines live here", but "the content-addressing, the store, and the delivery
  // wire are one definition the whole OS and every app share".
  capabilities: {
    // PAGE-SIDE STORE — "the store is the memory" (Law L3). Resolve any object BY ITS κ through a
    // contiguous in-memory ARENA (zero-copy resolveSync; small + contiguous + synchronous ⇒ the CPU
    // keeps the hot working set L1/L2-resident by itself — earned, not addressed) → OPFS (sub-ms,
    // survives reload) → the κ-route over HTTP (cold), VERIFIED by re-derivation on first fetch
    // (Law L5). The 2nd-and-later page-side access of any object is the warm in-memory rebind.
    store: { engine: "holo-kstore.js", flat: "_shared/holo-kstore.js", tiers: ["arena", "opfs", "kappa-route"], witness: "tools/holo-kstore-witness.mjs" },

    // DELIVERY WIRE — the content-verify Service Worker every app's bytes arrive on. It re-derives
    // EVERY byte (OS bytes AND app bytes — it folds each app's own lock closure into its L5 index)
    // to its pinned κ and REFUSES a mismatch (Law L5; the origin demoted to one untrusted CDN), then
    // caches the verified bytes in a κ-keyed CacheStorage — so identical bytes are stored once and
    // shared across every app (dedup) and the 2nd open is network-free. A child app iframe is a
    // separate browsing context the page-side arena CANNOT serve, so THIS is the live-runtime
    // re-open path (network-free milliseconds). Registered at root scope by the gateway, so every
    // nested app inherits it with no per-app wiring.
    delivery: { worker: "holo-fhs-sw.js", scope: "/", cache: "holo-kappa-v1", verifies: "os + app bytes", witness: "tools/holo-sw-cache-witness.mjs" },

    // ADDRESSING — the two content-derived axes every runtime object carries: the σ-axis BLAKE3
    // (byte-identical to the upstream substrate's kappa()) and the finite Φ-Atlas-12288 coordinate.
    addressing: { sigmaAxis: "holo-blake3.mjs", coordinate: "holo-atlas-coord.mjs", witness: "tools/holo-atlas-coord-witness.mjs" },
  },

  invariant:
    "Exactly one instance for the entire Hologram OS and its applications. Every engine has " +
    "one canonical home — the Holo Runtime if shared with the OS, else the owning app. No " +
    "engine is duplicated across the runtime and an app bundle. The content-addressed store, the " +
    "content-verify delivery wire, and the addressing axes are ONE definition the whole OS shares.",
};

// Is `rel` (an os-relative path) a request that the runtime owns? True for any `_shared/<x>`
// or `apps/<id>/_shared/<x>` reference — the resolver collapses all of these to the one runtime.
export function isRuntimeRequest(rel) {
  return /^(?:apps\/[^/]+\/)?_shared\/.+/.test(String(rel).replace(/^\/+/, ""));
}

export default HOLO_RUNTIME;
