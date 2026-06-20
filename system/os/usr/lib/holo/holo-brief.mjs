// holo-brief.mjs — THE BRIEF (S6 of "the +"). The last mile of the reflex: the insight κs (S4), each with an
// enforced provenance chain (S5), become a single proactive message — ANIMA's "first letter," but where every
// line is click-through to verifiable evidence. The brief is itself a sealed κ-object (a portable κ-DAG you can
// pin, S8), and crucially it RENDERS BY VERIFICATION: renderBrief re-checks each insight's chain at display time,
// so a claim whose evidence was tampered after the brief was written simply does not appear. Verify-before-show.
//
// Delivery is a swappable sink (the holo inbox / Q voice, autonomy spine S3). The witness injects a mock sink;
// production wires window inbox. Pure ESM, isomorphic, hash injectable. No clock in core (inject `now`).

import { sha256hex, didHolo, jcs } from "./holo-uor.mjs";
import { verifyInsight } from "./holo-insight.mjs";

const SHA = "sha256";
const enc = new TextEncoder();
const HOLO_CONTEXT = { holo: "https://hologram.os/ns#", schema: "http://schema.org/", prov: "http://www.w3.org/ns/prov#" };

// order: context relevance first (A3; absent ⇒ 0 ⇒ no effect), then confidence, then κ for a stable, clock-free
// ordering (Law L2). With no context-ranking applied, every insight ties at relevance 0 ⇒ pure confidence order
// (backward compatible with A0–S8).
const byConfidence = (a, b) =>
  ((b["holo:relevance"] || 0) - (a["holo:relevance"] || 0))
  || (b["holo:confidence"] - a["holo:confidence"])
  || (a["@id"] < b["@id"] ? -1 : 1);

// composeBrief({ graph, insights, title, now }) → a sealed holo:Brief κ-object (a κ-DAG over the insight κs).
// The brief embeds the full insight objects (they are small JSON-LD) so it is self-contained for rendering and
// portable as one κ; render-time re-verification (renderBrief) is what gates what actually shows.
export function composeBrief({ graph, insights = [], title = "What the + found", now = () => 0 } = {}, { hash = sha256hex } = {}) {
  const items = [...insights].sort(byConfidence);
  const canonical = { t: "brief", title, graph: graph && graph["holo:graphClosure"], insights: items.map((i) => i["@id"]).sort() };
  const kappa = didHolo(SHA, hash(enc.encode(jcs(canonical))));
  return {
    "@context": HOLO_CONTEXT, "@id": kappa, "@type": ["holo:Brief", "schema:Report"],
    "schema:name": title,
    "schema:dateCreated": now(),
    "holo:graph": (graph && graph["holo:graphClosure"]) || null,
    "holo:items": items,                                    // full insight κ-objects, ordered by confidence
    "holo:insightCount": items.length,
    kappa,
  };
}

// renderBrief(brief, { graph, sourceBytes }) → { ok, title, summary, lines, refused }. VERIFY-BEFORE-SHOW: each
// insight is re-checked against the live graph + the original source bytes; only verified insights become lines.
// A claim whose evidence was tampered drops out and is named in `refused` (honest about what could not be shown).
export function renderBrief(brief, { graph, sourceBytes = new Map(), rehash = sha256hex } = {}) {
  const lines = [], refused = [];
  for (const ins of brief["holo:items"] || []) {
    const v = verifyInsight(ins, { graph, sourceBytes, rehash });
    if (v.ok) lines.push({ kind: ins["holo:kind"], text: ins["schema:text"], confidence: ins["holo:confidence"],
                            insight: ins["@id"], evidence: ins["holo:evidence"], sources: ins["prov:wasDerivedFrom"] });
    else refused.push({ insight: ins["@id"], text: ins["schema:text"], broken: v.broken });
  }
  // the proactive "letter": built ONLY from verified lines.
  const head = lines.length
    ? `I looked at what you just added and found ${lines.length} thing${lines.length > 1 ? "s" : ""} worth your attention:`
    : `I looked at what you just added but couldn't verify any insight against its evidence.`;
  const body = lines.map((l, n) => `${n + 1}. ${l.text}  (confidence ${(l.confidence * 100) | 0}%, ${l.sources.length} source${l.sources.length > 1 ? "s" : ""})`);
  const summary = [head, ...body].join("\n");
  return { ok: lines.length > 0, title: brief["schema:name"], summary, lines, refused };
}

// deliver(brief, { sink, graph, sourceBytes, now }) — push the RENDERED brief to a sink (inbox / Q voice).
// The sink receives { title, body, briefKappa, lineCount } — proactive, unrequested. Returns the sink's ack.
// Renders first (verify-before-show) so a sink never carries an unverifiable claim. sink default: a no-op.
export async function deliver(brief, { sink = async () => ({ delivered: false }), graph, sourceBytes, rehash = sha256hex } = {}) {
  const r = renderBrief(brief, { graph, sourceBytes, rehash });
  const ack = await sink({ title: r.title, body: r.summary, briefKappa: brief["@id"], lineCount: r.lines.length, refusedCount: r.refused.length });
  return { rendered: r, ack };
}

export default { composeBrief, renderBrief, deliver };
