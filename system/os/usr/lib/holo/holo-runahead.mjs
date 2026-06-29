// holo-runahead.mjs — NEGATIVE LATENCY as a κ-snapshot substrate capability (generalized from the game
// emulator's holo-retro-runahead so QEMU, a game core, and any deterministic producer all inherit it).
//
// A pipeline has inherent input lag: an input at step t only changes the picture at step t+L. RetroArch's
// run-ahead cancels it by re-running from a fresh save state — which on the κ substrate IS content-addressed
// snapshot/restore, page-deduped and near-free. So run-ahead stops being an emulator bolt-on and becomes a
// substrate primitive — the SAME primitive QEMU uses for resume/migrate (a machine state is a κ you replay).
//
// Per presented step (RetroArch's algorithm, engine-agnostic):
//   1. checkpoint the producer (content-addressed — an unchanged page re-snapshots to the SAME κ, stored once),
//   2. advance L+1 steps on the CURRENT input — the last is L steps "in the future" and already shows the
//      response to this input,
//   3. roll back to the checkpoint and advance EXACTLY ONE step — the committed, authoritative state.
// The committed trajectory is bit-identical to a plain run (determinism preserved); only what the eye SEES is
// pulled L steps earlier. The presented frame feeds the projector; the committed state is the source of truth.
//
// The producer is injected (Law L4 — one runtime; no engine knowledge here):
//   snapshot() -> Page[]            an array of page byte-views (memory pages / save-state chunks); κ-addressed
//   restore(pages: Page[]) -> void  reinstate a checkpoint (the page list from snapshot/store.get)
//   advance(input) -> frame         advance EXACTLY ONE step, return the produced frame (opaque bytes)
//
// node-, Service-Worker- and DOM-safe. Imports only its sibling κ primitive (its content-address law).
import { kappaOf } from "./holo-kappa-stream.mjs";

const hexOf = (k) => String(k).split(":").pop();

// makeSnapshotStore() — a content-addressed PAGE store (Law L1/L3). A snapshot is a list of pages; identical
// pages across snapshots and across producers DEDUP, so a checkpoint costs only its CHANGED pages — the
// "snapshot is near-free" property QEMU resume and emulator save-states both rely on, made explicit.
export function makeSnapshotStore() {
  const pages = new Map();                                   // pageHex → bytes (the deduped page heap)
  const stats = { novelPages: 0, novelBytes: 0, putPages: 0 };
  async function put(pageList) {                             // → manifest { root κ, pages: hex[] }; dedups
    const hexes = [];
    for (const p of pageList) {
      const u = p instanceof Uint8Array ? p : new Uint8Array(p);
      const hex = hexOf(await kappaOf(u));
      if (!pages.has(hex)) { pages.set(hex, u); stats.novelPages++; stats.novelBytes += u.length; }
      stats.putPages++; hexes.push(hex);
    }
    const root = await kappaOf(new TextEncoder().encode(hexes.join(",")));   // the snapshot's κ = κ over its page κ
    return { root, pages: hexes };
  }
  const get = (manifest) => manifest.pages.map((h) => pages.get(h));         // O(1) reconstruct from the heap
  return { put, get, stats: () => ({ ...stats, heldPages: pages.size }) };
}

// makeRunAhead(producer, { frames, store }) — frames = L (latency to cancel, in steps). Returns a stepper
// whose committed trajectory is bit-identical to a plain run, but whose PRESENTED frame is L steps ahead.
export function makeRunAhead(producer, { frames = 1, store = null } = {}) {
  if (!producer || typeof producer.snapshot !== "function" || typeof producer.restore !== "function" || typeof producer.advance !== "function")
    throw new Error("holo-runahead: producer must expose snapshot() / restore(pages) / advance(input)");
  const snaps = store || makeSnapshotStore();
  let committedSteps = 0;
  async function step(input) {
    const manifest = await snaps.put(producer.snapshot());   // checkpoint (content-addressed → page dedup)
    let presented = null;
    for (let i = 0; i <= frames; i++) presented = producer.advance(input);   // L+1 steps into the future
    producer.restore(snaps.get(manifest));                                   // roll back to the checkpoint
    const committed = producer.advance(input);                               // commit EXACTLY one (authoritative)
    committedSteps++;
    return { presented, committed, snapshot: manifest };                     // presented → eye; committed → truth
  }
  return { frames, step, store: snaps, committedSteps: () => committedSteps };
}

export default { makeRunAhead, makeSnapshotStore };
