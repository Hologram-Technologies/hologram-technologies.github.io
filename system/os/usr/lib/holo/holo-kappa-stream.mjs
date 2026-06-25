// holo-kappa-stream.mjs — the ONE κ-STREAM primitive. The whole Hologram experience — a frame, a token,
// a UI subtree, a model layer — is a stream of κ-OBJECTS against a local κ-cache (Law L3: the store IS
// the memory; RAM/cache is the address space). The producer references what the consumer already holds:
// a κ the consumer has ⇒ a REF (≈0 bytes, reconstruct O(1)); a NOVEL κ ⇒ its BYTES (the delta), which the
// consumer re-derives on arrival before admitting (Law L5). So WHAT TRAVELS IS NOVELTY, NOT RESOLUTION —
// the reason the experience can stream at high FPS on any device and any network — and render and LLM ride
// this SAME transport (Law L4: no parallel runtime). Personalization is a κ-delta: the shared base is all
// refs (held by everyone, deduped), and only "you" — your one personal region — ever travels.
//
// This is the transport beneath holo-q-render (which caches BUILT DOM by κ) and the LLM sampler (which
// streams weights/tokens by κ): both become "emit κ-objects, admit by re-derivation, reconstruct from
// cache." The producer learns what the consumer holds the way HTTP learns it for ETag/304 — a cache
// digest the consumer advertises, or simply the same device's persistent κ-store across sessions; here
// that shared knowledge is the `cache` the consumer fills and the producer consults.
//
// One canonical hash (Law L2): the κ axis is BLAKE3 — the substrate's kappo() — so a stream object's κ
// IS its Bao root (holo-bao), letting the SAME object stream with O(log n) PER-CHUNK verification, not
// just whole-object re-derivation. Routes through the canonical seam (holo-kappa → holo-blake3); both are
// pure and node-, Service-Worker- and DOM-safe. (Was SHA-256 — the one stream island left after the
// canonical-κ cutover, ADR-0115; flipped here so the streaming subsystem joins the blake3 substrate.)

import { kappoHex, KAPPA_PREFIX } from "./holo-kappa.mjs";

const hexOf = (k) => String(k).split(":").pop();

// reDerive(bytes) → blake3 hex (the canonical κ axis = kappo). Sync under the hood; kept async-shaped so
// every existing `await kappaOf(...)` / `await frame(...)` caller is unchanged (await on a value is a no-op).
async function reDerive(bytes) { return kappoHex(bytes); }

// kappaOf(bytes) → did:holo:blake3:… — the content address of an object's bytes (Law L1), == its Bao root.
export const kappaOf = async (bytes) => KAPPA_PREFIX + (await reDerive(bytes));

// makeKappaStream(cache?) — one channel. `cache` is the consumer's local κ-store (Map hex → bytes): the
// address space (Law L3). Share one cache across many streams on a device and novelty dedupes globally.
//   frame(bytes) → { kind:"ref"|"obj", kappa, payload? }  — producer: minimal event given what's held.
//   admit(event) → bytes                                   — consumer: reconstruct (ref, O(1)) or verify+cache (obj, L5).
//   wireBytes()                                            — total novel bytes that crossed the wire (the cost).
//   stats()                                                — { objs, refs, hits, novelBytes, held }.
export function makeKappaStream(cache = new Map()) {
  let wire = 0;
  const stats = { objs: 0, refs: 0, hits: 0, novelBytes: 0 };

  // PRODUCER — turn a κ-object's bytes into the minimal event: a ref if the consumer holds it, else the bytes.
  async function frame(bytes) {
    const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const hex = await reDerive(u);
    const kappa = KAPPA_PREFIX + hex;
    if (cache.has(hex)) { stats.refs++; return { kind: "ref", kappa }; }          // held ⇒ ≈0 bytes on the wire
    stats.objs++; stats.novelBytes += u.length;
    return { kind: "obj", kappa, payload: u };                                     // novel ⇒ the delta travels once
  }

  // CONSUMER — admit an event: a ref reconstructs from cache (O(1)); an obj is verified (Law L5), cached, returned.
  async function admit(ev) {
    const hex = hexOf(ev.kappa);
    if (ev.kind === "ref") {
      if (!cache.has(hex)) throw new Error(`κ-stream: ref to un-held κ ${ev.kappa} — the object must travel first`);
      stats.hits++; return cache.get(hex);                                         // reconstruct from the address space
    }
    if (ev.kind === "obj") {
      const u = ev.payload instanceof Uint8Array ? ev.payload : new Uint8Array(ev.payload);
      if (await reDerive(u) !== hex) throw new Error(`κ-stream: payload does not re-derive to ${ev.kappa} (Law L5 — refused)`);
      wire += u.length; cache.set(hex, u);                                         // novel byte admitted exactly once
      return u;
    }
    throw new Error(`κ-stream: unknown event kind ${ev && ev.kind}`);
  }

  return { frame, admit, cache, wireBytes: () => wire, stats: () => ({ ...stats, held: cache.size }) };
}

export default { makeKappaStream, kappaOf };
