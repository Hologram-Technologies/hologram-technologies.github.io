// holo-heal.mjs — AUTONOMOUS SELF-HEALING over the κ-addressed, self-verified substrate. Detection
// already exists everywhere (the SW re-derives every served byte and REFUSES a mismatch, Law L5);
// what was missing is RECOVERY. A content address is a perfect lie-detector but not a healer: knowing
// a byte is wrong does not hand you the right byte back. This module turns the dead-end refusal into a
// recovery step — origin-agnostic, torrent-style: a κ resolves from WHEREVER its bytes live (durable
// κ-store · peers · IPFS · origin), and the FIRST copy that re-derives to the address wins (Law L5).
// Trust is in the math, not the source, so a wrong byte from any source is refused and nothing is
// laundered — only a copy that re-derives to the SAME κ is ever served. A device that heals an object
// keeps it (persist), so it becomes a seed: stored anywhere, reassembled into the original κ-object.
//
// Two boundaries are LAW here, not options:
//   • The sealed ANCHOR (constitution · gate-pinned constants · OS-closure root) is NEVER auto-healed.
//     If the anchor does not verify, the OS stays fail-closed and surfaces it to the operator — a healer
//     that could rewrite the law to match drifted bytes is a back-door, not a repair. `isAnchor` gates it.
//   • Healing RECOVERS the pinned bytes; it never RE-SEALS a pin. Re-sealing legitimate drift is a
//     build/operator act (tools/reseal-drift.mjs); doing it at runtime would launder corruption.
//
// Pure + isomorphic + dependency-injected (like holo-resolver.mjs, its one import): the witness drives
// it in Node with a Map κ-store + synthetic sources; the Service Worker drives it with the durable
// IndexedDB κ-store (holo-kstore) + the live source chain (holo-sources / holo-peers). No clock, no
// randomness in the core (both would break re-derivation) — timestamps for receipts are injected.

import { reDerive, hexOf } from "./holo-resolver.mjs";

// makeHealer(deps) → { heal, scrub, recover, receipts }
//   sources    : [ async (κ) → Uint8Array | null ]  ordered recovery chain; a source may carry `.peer`
//                /`.label` for provenance. It need NOT verify — recover() re-derives every byte.
//   store      : Map(hex → Uint8Array)               RAM dedup of the address space (Law L3).
//   persist    : async (hex, bytes) → void           durable seed (e.g. holo-kstore.kput) — optional.
//   sealReceipt: (info) → object                     mint a verifiable PROV-O heal receipt — optional,
//                                                     injected so the core stays node/browser-agnostic.
//   isAnchor   : (hex) → boolean                     the sealed-anchor denylist — NEVER auto-healed.
//   now        : () → string                         ISO timestamp for receipts (injected; no clock here).
//   log        : (msg, info) → void                  progress sink (default no-op) — invisible when healthy.
//   erasure    : { reconstruct }                     fractal recovery (holo-erasure.mjs) — optional; when a
//                                                     whole-object copy is gone from every source, rebuild it
//                                                     from k-of-(k+m) surviving SHARDS (each itself a κ-object).
//   manifestFor: async (hex) → manifest | null        lookup an object's erasure manifest (shard κs + params).
export function makeHealer({ sources = [], store = new Map(), persist = null, sealReceipt = null, isAnchor = () => false, now = () => "1970-01-01T00:00:00Z", log = () => {}, erasure = null, manifestFor = null } = {}) {
  const receipts = [];

  // recover(κ) → { bytes, from } | null — the location-independent core. Try the store, then each
  // source IN ORDER, and accept the FIRST copy that RE-DERIVES to the address (Law L5). This is the
  // exact accept-contract of holo-resolver.resolveByKappa, with provenance tracked for the receipt.
  async function recover(kappa) {
    const hex = hexOf(kappa);
    if (store.has(hex)) return { bytes: store.get(hex), from: "store" };
    for (const src of sources) {
      let bytes;
      try { bytes = await src(kappa); } catch { bytes = null; }
      if (!bytes) continue;
      const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      if ((await reDerive(u)) !== hex) continue;            // a wrong/tampered byte from any source is refused
      store.set(hex, u);                                    // verified once → served from anywhere thereafter
      return { bytes: u, from: src.peer || src.label || "source" };
    }
    // FRACTAL heal — no whole-object copy survives anywhere; rebuild it from k of (k+m) surviving SHARDS.
    // Each shard is itself a κ-object fetched from the same mesh; erasure.reconstruct() blake3-verifies every
    // shard (L5) and Reed–Solomon-rebuilds the whole, which we then re-derive to its OWN κ before trusting it
    // (L5 again — a reconstruction that does not re-derive to the address is refused, never served).
    if (erasure && manifestFor) {
      try {
        const manifest = await manifestFor(hex);
        if (manifest && Array.isArray(manifest.shards) && manifest.data) {
          const got = [];
          for (const s of manifest.shards) {
            if (got.length >= manifest.data) break;
            const shex = hexOf(s.kappa);
            let bytes = store.has(shex) ? store.get(shex) : null;
            if (!bytes) for (const src of sources) { try { const b = await src(s.kappa); if (b) { bytes = b instanceof Uint8Array ? b : new Uint8Array(b); break; } } catch {} }
            if (bytes) got.push({ index: s.index, role: s.role, kappa: s.kappa, bytes });
          }
          if (got.length >= manifest.data) {
            const bytes = await erasure.reconstruct(manifest, got);   // blake3-verifies each shard, RS-rebuilds
            if ((await reDerive(bytes)) === hex) { store.set(hex, bytes); return { bytes, from: "erasure" }; }
          }
        }
      } catch { /* fractal recovery is best-effort; fall through to honest unresolved */ }
    }
    return null;                                            // no source served a κ-verified copy
  }

  // heal(κ) → { ok, hex, bytes?, recoveredFrom?, receipt? } | { ok:false, refused }
  // The unit of repair. Refuses the anchor outright; otherwise recovers, seeds, and witnesses.
  async function heal(kappa, { reason = "verify-miss", path = null } = {}) {
    const hex = hexOf(kappa);
    if (isAnchor(hex)) { log("anchor refused (fail-closed, surfaced not healed)", { hex, path }); return { ok: false, refused: "anchor", hex }; }
    const got = await recover(kappa);
    if (!got) { log("unresolved — no source served a κ-verified copy", { hex, path }); return { ok: false, refused: "unresolved", hex, reason }; }
    if (persist) { try { await persist(hex, got.bytes); } catch { /* seeding is best-effort; the serve still happened */ } }
    let receipt = null;
    if (sealReceipt) {
      receipt = sealReceipt({ kappa: "did:holo:sha256:" + hex, recoveredFrom: got.from, axis: "sha256", reDerived: true, reason, path, generatedAtTime: now() });
      receipts.push(receipt);                               // a heal that can't be witnessed didn't happen — the receipt IS the witness
    }
    log("healed", { hex, from: got.from, reason, path });
    return { ok: true, hex, bytes: got.bytes, recoveredFrom: got.from, receipt };
  }

  // scrub(closure, opts) → summary — the PROACTIVE sweep that makes healing autonomous. Walk the closure
  // (path → κ); for every entry, re-verify the LOCAL copy (intact re-derives it, Law L5) and, when it is
  // missing or no longer re-derives, heal it from the mesh. Catches latent corruption in objects nothing
  // has requested yet — the difference between "repair when it breaks under a user" and "keep everything
  // healthy before anyone asks". Anchors are counted and skipped, never touched.
  //
  // Three optional hooks turn a blind sweep into a LEARNING one (the supervisor's EVOLVE leg) — all default
  // to the original behaviour, so existing callers are unchanged:
  //   intact : (hex) → Promise<boolean>           re-derive the durable local copy (e.g. holo-kstore.kverify)
  //   order  : (entries) → entries                rerank the [path,κ] list before the walk — front-load the
  //                                               historically-flaky (the sweep visits them FIRST). Default identity.
  //   budget : number                             cap how many objects this sweep may HEAL (the expensive mesh
  //                                               recovery); the rest are DEFERRED to a later tick. Flaky-first +
  //                                               a small budget = "visit the flaky MORE OFTEN". Default ∞ (full sweep).
  //   onVisit: (path, hex, outcome) → void        report each entry's fate ("anchor"|"healthy"|"healed"|
  //                                               "unresolved") so the caller can LEARN which κ keep breaking.
  // `closure` may be the canonical {path→κ} map OR a pre-ordered [path,κ] entry list.
  async function scrub(closure, { intact = async () => false, order = null, onVisit = null, budget = Infinity } = {}) {
    let entries = Array.isArray(closure) ? closure.slice() : Object.entries(closure || {});
    if (typeof order === "function") entries = order(entries);
    const summary = { total: entries.length, healthy: 0, healed: 0, unresolved: 0, anchors: 0, deferred: 0, receipts: [] };
    let spent = 0;
    for (const [path, k] of entries) {
      const kappa = typeof k === "string" ? k : (k && (k.kappa || k.did || k["@id"])) || "";
      const hex = hexOf(kappa);
      if (!/^[0-9a-f]{64}$/.test(hex)) { continue; }
      if (isAnchor(hex)) { summary.anchors++; onVisit && onVisit(path, hex, "anchor"); continue; }
      if (await intact(hex)) { summary.healthy++; onVisit && onVisit(path, hex, "healthy"); continue; }
      if (spent >= budget) { summary.deferred++; continue; } // out of heal-budget this sweep — a later tick takes it
      spent++;
      const r = await heal(kappa, { reason: "scrub", path });
      if (r.ok) { summary.healed++; if (r.receipt) summary.receipts.push(r.receipt); onVisit && onVisit(path, hex, "healed"); }
      else { summary.unresolved++; onVisit && onVisit(path, hex, "unresolved"); } // reported, never silently counted as healthy
    }
    return summary;
  }

  return { heal, scrub, recover, receipts };
}

// anchorSet(hexes) → (hex)→boolean — build an isAnchor predicate from the sealed-anchor κ-hexes
// (constitution root + principle κs + OS-closure root). A convenience; callers may pass any predicate.
export function anchorSet(hexes = []) {
  const set = new Set(hexes.map((h) => String(h).split(":").pop().toLowerCase()));
  return (hex) => set.has(String(hex).toLowerCase());
}
