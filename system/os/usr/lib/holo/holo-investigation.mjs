// holo-investigation.mjs — THE WHOLE INVESTIGATION AS ONE κ-DAG (S8 of "the +"). Everything the reflex produced
// — the source κs (S0), the hypergraph closure (S1/S2), the insight κs (S4), the brief κ (S6) — composes into a
// SINGLE content-addressed root. That root IS the investigation: pin it to IPFS and the entire chain is portable,
// serverless, and re-derivable from anywhere (location-agnostic, like the rest of the OS). Tamper any member and
// the root breaks. This is the ADR's "the whole thing is one pinnable κ-DAG" made literal.
//
// The actual IPFS pin + the relock reseal of the touched substrate files is an OUT-OF-BAND deploy step (network +
// build, the user's call) — exactly like holo-tube-ingest's "next: relock-app". This module produces the verifiable
// root and the pin SET (the κs a pin must carry); it never fabricates a "pinned:true". Pure ESM, isomorphic.

import { sha256hex, didHolo, jcs } from "./holo-uor.mjs";
import { verifyInsight } from "./holo-insight.mjs";

const SHA = "sha256";
const enc = new TextEncoder();
const HOLO_CONTEXT = { holo: "https://hologram.os/ns#", schema: "http://schema.org/", prov: "http://www.w3.org/ns/prov#" };

// composeInvestigation({ title, sources, graph, insights, brief, now }) → a holo:Investigation κ-DAG.
// sources: [sourceκ] (the ingest anchors). graph: the merged HyperGraph. insights/brief: from S4/S6.
// root κ = H(sorted member κs) — non-circular, never includes itself; deterministic (Law L2).
export function composeInvestigation({ title = "Investigation", sources = [], graph = {}, insights = [], brief = null, now = () => 0 } = {}, { hash = sha256hex } = {}) {
  const sourceK = [...new Set(sources)].sort();
  const insightK = insights.map((i) => i["@id"]).sort();
  const graphClosure = graph["holo:graphClosure"] || null;
  const briefK = brief ? brief["@id"] : null;
  const members = [...sourceK, ...(graphClosure ? [graphClosure] : []), ...insightK, ...(briefK ? [briefK] : [])].sort();
  const root = didHolo(SHA, hash(enc.encode(jcs(members))));
  return {
    "@context": HOLO_CONTEXT, "@id": root, "@type": ["holo:Investigation", "prov:Bundle"],
    "schema:name": title, "schema:dateCreated": now(),
    "holo:sources": sourceK, "holo:graph": graphClosure, "holo:insights": insightK, "holo:brief": briefK,
    "holo:memberCount": members.length, "holo:root": root,
    "holo:pinned": null,                                   // honest: no pin until a real IPFS receipt replaces this
  };
}

// pinSet(inv, graph) → the FULL set of κs a pin must carry to replay the investigation offline: every source κ,
// every graph node/edge/provenance κ, the graph closure, every insight κ, and the brief κ. This is the byte-closure
// an IPFS pin (or the relock closure) must contain so the whole chain re-derives on a cold device.
export function pinSet(inv, graph = {}) {
  const all = new Set([...(inv["holo:sources"] || []), ...(inv["holo:insights"] || [])]);
  if (inv["holo:graph"]) all.add(inv["holo:graph"]);
  if (inv["holo:brief"]) all.add(inv["holo:brief"]);
  for (const n of [...(graph["holo:entities"] || []), ...(graph["holo:claims"] || []), ...(graph["holo:provenance"] || [])]) all.add(n["@id"]);
  return [...all].sort();
}

// verifyInvestigation(inv, { graph, insights, sourceBytes, rehash }) → { ok, rootOk, brokenInsights }.
// rootOk: the root re-derives from its members (integrity of the DAG). brokenInsights: any insight whose
// provenance chain (S5) no longer verifies against the live graph + original bytes. ok = both hold.
export function verifyInvestigation(inv, { graph = {}, insights = [], sourceBytes = new Map(), rehash = sha256hex } = {}) {
  const members = [...(inv["holo:sources"] || []), ...(inv["holo:graph"] ? [inv["holo:graph"]] : []),
                   ...(inv["holo:insights"] || []), ...(inv["holo:brief"] ? [inv["holo:brief"]] : [])].sort();
  const rootOk = didHolo(SHA, rehash(enc.encode(jcs(members)))) === inv["holo:root"];
  const brokenInsights = insights.filter((i) => !verifyInsight(i, { graph, sourceBytes, rehash }).ok).map((i) => i["@id"]);
  return { ok: rootOk && brokenInsights.length === 0, rootOk, brokenInsights };
}

export default { composeInvestigation, pinSet, verifyInvestigation };
