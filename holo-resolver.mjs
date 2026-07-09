// holo-resolver.mjs — content-addressed resolution: fetch any holospace file BY ITS κ, from ANY
// source, and accept it ONLY after re-deriving the hash (Law L5). This is what makes a holospace
// app serverless + distributed: its closure (path → κ) is a manifest, and each κ can be served by
// local cache, the origin, a peer, or a gateway — "stored anywhere, accessed from multiple sources."
// Trust is in the math, not the source (docs/08 §Verify by re-derivation): a wrong or tampered byte
// from any source is refused, and a κ-verified copy from a hostile gateway is as good as from home.
// The shared logic lives HERE (node-testable); holo-fhs-sw.js is the Service-Worker shell that calls it.

// hexOf(κ) — the sha-256 hex of a did:holo:sha256:… / sha256:… κ.
export const hexOf = (k) => String(k).split(":").pop();

// reDerive(bytes) → sha-256 hex (the open-web κ axis). WebCrypto in the browser/SW, node:crypto in
// node — the same digest either way (Law L2: one canonical hash, no per-environment re-derivation).
export async function reDerive(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (globalThis.crypto && globalThis.crypto.subtle) {
    const d = await crypto.subtle.digest("SHA-256", u);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(u).digest("hex");
}

// resolveByKappa(kappa, sources, store) → Uint8Array — fetch an object BY ITS CONTENT ADDRESS from the
// ordered sources and accept the FIRST κ-verified copy (Law L5). No path, no location: the address IS
// the object, so a κ resolves identically wherever its bytes live (cache · peer · origin · gateway).
// This is the location-independent core; makeResolver layers a path→κ closure lookup on top of it, and
// the Service Worker κ-route (/.holo/sha256/<hex>) calls it directly so apps can reference shared
// objects by address rather than by path — relocate the bytes and the reference still resolves.
export async function resolveByKappa(kappa, sources, store = new Map()) {
  const hex = hexOf(kappa);
  if (store.has(hex)) return store.get(hex);                       // "page fault" hit — local, already verified
  for (const fetchFrom of sources) {                              // try each source; the FIRST κ-verified copy wins
    let bytes;
    try { bytes = await fetchFrom(kappa); } catch { bytes = null; }
    if (!bytes) continue;
    const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (await reDerive(u) !== hex) continue;                      // Law L5: re-derive; refuse a wrong/tampered byte
    store.set(hex, u);                                            // verified once, served from anywhere thereafter
    return u;
  }
  throw new Error(`unresolved — no source served a κ-verified copy of ${kappa}`);
}

// makeResolver({ closure, sources, store }) → async resolve(path) : Uint8Array (throws if unresolved).
//   closure : { path → κ }                      — the app's content-address lock
//   sources : [ async (κ) → Uint8Array | null ] — ordered fetchers (cache · origin · peer · gateway…)
//   store   : Map(κ-hex → bytes)                — the κ-store cache, filled on first verified fetch
//                                                 (RAM is a cache of the address space — Law L3; dedup)
export function makeResolver({ closure, sources, store = new Map() }) {
  return async function resolve(path) {
    const kappa = closure[path];
    if (!kappa) throw new Error(`not in closure: ${path}`);
    return resolveByKappa(kappa, sources, store);                  // path → κ, then resolve by content address
  };
}
