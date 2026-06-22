// holo-strand-provenance.mjs — P2 of the unification: THE "+" PROVENANCE DERIVES FROM THE SPINE.
// The Port (holo-ingest) content-addresses every source (source κ = the evidence anchor), and the Map
// (holo-map) hangs every claim off that source κ via a prov edge. But on their own those are a BAG of
// isolated manifests — there is no ordered, signed, tamper-evident record of WHAT was ingested, WHEN,
// by WHOM. This seam puts ingestion ON the operator's source chain: each ingest is a signed strand
// entry, so the hypergraph's provenance can be RECONCILED against the spine — every source κ a claim
// cites must trace to a signed `ingest` entry, or it is unprovenanced (injected / drifted) and refused.
//
// Additive + projection-only: it does NOT touch the Port (holo-ingest stays pure/isomorphic) or the Map
// (holo-map stays the content-addressed graph). It reads/writes the strand through its public surface
// (append/replay), so holo-strand.mjs is unchanged. The spine remains the single source of truth; the
// ingest log is just one PROJECTION of it (Holochain's source-chain insight applied to "the +").

// recordIngest(strand, manifest) — append a signed `ingest` entry carrying the IngestSource manifest's
// κs (source = evidence anchor, view = decoded text κ, closure = the one ingest root). The strand's
// signer (the unlocked operator) binds authorship; unsigned still hash-links. Returns the entry.
export async function recordIngest(strand, manifest = {}) {
  return strand.append({
    kind: "ingest",
    payload: {
      source: manifest.source || null,
      name: manifest["schema:name"] || manifest.name || null,
      kind: manifest.kind || null,
      view: (manifest.view && manifest.view.kappa) || null,
      closure: manifest["holo:ingestClosure"] || null,
      bytes: manifest.bytes ?? null,
    },
  });
}

// provenanceOf(strand, sourceKappa) — the signed ingest entry that introduced this source κ (most recent
// wins), or null if this κ was never ingested on the spine. The returned entry is verifiable via the
// strand's own verifyEntry (its κ re-derives; its operator signature checks) — provenance you can prove.
export function provenanceOf(strand, sourceKappa) {
  const ing = strand.replay({ kind: "ingest" });
  for (let i = ing.length - 1; i >= 0; i--) {
    const p = ing[i]["holstr:payload"];
    if (p && p.source === sourceKappa) return ing[i];
  }
  return null;
}

// reconcileProvenance(strand, graph) — the P2 guarantee: every source κ the hypergraph's provenance edges
// cite (prov:wasDerivedFrom) must be backed by a signed ingest entry on the spine. Returns the per-source
// resolution plus `ok` (all provenanced) and the list of `unprovenanced` source κs (claims citing evidence
// that was never ingested — a drift/injection signal the "+" can now surface, fail-closed).
export function reconcileProvenance(strand, graph = {}) {
  const cited = [...new Set((graph["holo:provenance"] || []).map((p) => p["prov:wasDerivedFrom"]).filter(Boolean))];
  const all = cited.map((source) => ({ source, entry: provenanceOf(strand, source) }));
  return {
    all,
    provenanced: all.filter((o) => o.entry).map((o) => o.source),
    unprovenanced: all.filter((o) => !o.entry).map((o) => o.source),
    ok: cited.length > 0 && all.every((o) => o.entry),
  };
}

// browser binding: one seam over the live operator strand. Fail-soft; callers degrade if absent.
if (typeof window !== "undefined") {
  window.HoloStrandProvenance = { recordIngest, provenanceOf, reconcileProvenance };
}
