// holo-strand-stores.mjs — P5 of the unification: OLD STORES BECOME PROJECTIONS OF THE ONE SPINE.
// The scattered stores (Q's memory model, the session experience, …) each keep their own keyed blob.
// This provides the {load, save} backend interface they already accept (makeMemory / createSession),
// but persisted THROUGH the source chain: save() appends a `store.<ns>` snapshot entry; load() projects
// the latest. So a store retires onto the single spine — its data becomes a re-derivable projection of
// the chain (ordered, tamper-evident), and the dozen backends collapse to one.
//
// Drop-in + reversible: pass strandBackend(strand,"memory") where a store takes { backend }. Nothing in
// the store changes. The actual cutover of a LIVE store is then a one-line backend swap (deferred — it
// belongs with a careful migration, not a blind edit). Snapshot-per-save here for clarity; a production
// cutover would append deltas. Additive, projection-only; holo-strand is unchanged.

// strandBackend(strand, namespace) → { load, save } — the old backend contract, persisted on the spine.
export function strandBackend(strand, namespace) {
  const KIND = "store." + String(namespace);
  return {
    load: async () => {
      if (strand.ready) await strand.ready();
      const snaps = strand.replay({ kind: KIND });
      if (!snaps.length) return [];
      const p = snaps[snaps.length - 1]["holstr:payload"] || {};
      return Array.isArray(p.records) ? p.records : [];
    },
    save: async (records) => {
      // SNAPSHOT at save time: stores (e.g. makeMemory) reuse one mutable array across saves; a sealed
      // entry must own an immutable copy or a later push would mutate already-committed history (κ breaks).
      const snap = Array.isArray(records) ? JSON.parse(JSON.stringify(records)) : [];
      return strand.append({ kind: KIND, payload: { ns: String(namespace), records: snap, n: snap.length } });
    },
  };
}

// projectStores(strand) → reconstruct EVERY store's latest state from the chain alone — the proof that
// the spine is a sufficient single backend (the precondition for retiring the separate stores). Returns
// { [namespace]: { records, n, atSeq } } plus the head κ the whole projection is anchored to.
export function projectStores(strand) {
  const latest = {};
  for (const e of strand.replay({})) {
    const k = e["holstr:kind"];
    if (typeof k === "string" && k.startsWith("store.")) {
      const ns = k.slice("store.".length);
      const p = e["holstr:payload"] || {};
      latest[ns] = { records: Array.isArray(p.records) ? p.records : [], n: p.n | 0, atSeq: e["holstr:seq"] };
    }
  }
  return { stores: latest, head: strand.head ? strand.head() : null };
}

// browser binding: one seam over the live operator strand. Fail-soft; callers degrade if absent.
if (typeof window !== "undefined") {
  window.HoloStrandStores = { strandBackend, projectStores };
}
