// holo-insight.mjs — THE REASON REFLEX (S4 of "the +"). This is the magic: the act of ingesting fired a
// signal (S3); this layer is what wakes on that signal and INVESTIGATES the κ-hypergraph unbidden — no query,
// no button beyond the "+". It mirrors ANIMA's autonomic loop (perceive → orient → decide → act): on new
// data, spawn investigation goals (corroborate, find the hubs, flag the single-sourced, detect the shape) and
// emit findings. Each finding is sealed as a content-addressed INSIGHT κ that CITES its evidence (claim/entity
// κs) and traces to the source κs — so S5's provenance is structural, and a brief (S6) is just these κs rendered.
//
// THE INVESTIGATOR IS A SWAPPABLE SEAM, exactly like holo-map's extractor. Production injects Q's zero-shot
// .holo brain (makeQInvestigator) to find OPEN-ENDED, novel insights. The built-in graph investigators are a
// DETERMINISTIC baseline — real, graph-derived findings (NOT an LLM), so the reflex MECHANICS (signal → goal →
// insight κ with evidence + provenance, zero user input) are Node-witnessable without a GPU. Q is the intelligence.
//
// The headline baseline finding — "X is corroborated by N independent sources" — is only computable BECAUSE of
// the multi-source provenance the κ-substrate gives for free (S2). That is a genuinely valuable insight that
// ANIMA's glued 3-database graph cannot surface without bespoke join logic. Pure ESM, isomorphic, hash injectable.

import { sha256hex, didHolo, jcs } from "./holo-uor.mjs";
import { sourcesForClaim } from "./holo-map.mjs";

const SHA = "sha256";
const enc = new TextEncoder();
const HOLO_CONTEXT = { holo: "https://hologram.os/ns#", schema: "http://schema.org/", prov: "http://www.w3.org/ns/prov#" };

// seal one finding into an insight κ-object. evidence = the graph κs that justify it; sources = traced provenance.
function sealInsight({ kind, text, confidence, evidence, sources }, hash) {
  const ev = [...new Set(evidence)].sort();
  const src = [...new Set(sources)].sort();
  const canonical = { t: "insight", kind, text, evidence: ev };   // identity = the finding + its evidence (dedups)
  const kappa = didHolo(SHA, hash(enc.encode(jcs(canonical))));
  return { "@context": HOLO_CONTEXT, "@id": kappa, "@type": ["holo:Insight", "schema:Claim"],
           "holo:kind": kind, "schema:text": text, "holo:confidence": confidence,
           "holo:evidence": ev, "prov:wasDerivedFrom": src, kappa };
}

// ── graph helpers ────────────────────────────────────────────────────────────────────────────────
const entitiesOf = (g) => g["holo:entities"] || [];
const claimsOf = (g) => g["holo:claims"] || [];
const nameOf = (g, k) => { const e = entitiesOf(g).find((x) => x["@id"] === k); return e ? e["schema:name"] : k.slice(0, 16); };
// claims touching an entity (as subject, or as an entity-valued object).
const claimsTouching = (g, ek) => claimsOf(g).filter((c) => c["holo:subject"] === ek || (c["holo:objectKind"] === "entity" && c["holo:object"] === ek));
// distinct source κs attesting an entity (union over the sources of all its claims).
const sourcesForEntity = (g, ek) => [...new Set(claimsTouching(g, ek).flatMap((c) => sourcesForClaim(g, c["@id"])))];

// ── the deterministic baseline investigators (the witness fixture; NOT the production intelligence) ──
export const baselineInvestigators = {
  // 1 · CORROBORATION — entities attested by ≥2 independent sources (only possible via S2 multi-source prov).
  corroboration(g) {
    const out = [];
    for (const e of entitiesOf(g)) {
      const srcs = sourcesForEntity(g, e["@id"]);
      if (srcs.length >= 2) {
        const ev = [e["@id"], ...claimsTouching(g, e["@id"]).map((c) => c["@id"])];
        out.push({ kind: "corroboration", confidence: Math.min(0.95, 0.6 + 0.15 * srcs.length),
          text: `${e["schema:name"]} is corroborated by ${srcs.length} independent sources.`, evidence: ev, sources: srcs });
      }
    }
    return out;
  },
  // 2 · CENTRALITY — the hub entity (most connections): where the investigation should focus first.
  centrality(g) {
    let best = null, bestN = 1;
    for (const e of entitiesOf(g)) { const n = claimsTouching(g, e["@id"]).length; if (n > bestN) { best = e; bestN = n; } }
    if (!best) return [];
    const ev = [best["@id"], ...claimsTouching(g, best["@id"]).map((c) => c["@id"])];
    return [{ kind: "centrality", confidence: 0.7,
      text: `${best["schema:name"]} is the most connected entity (${bestN} relationships), the natural focal point.`,
      evidence: ev, sources: sourcesForEntity(g, best["@id"]) }];
  },
  // 3 · SINGLE-SOURCE RISK — a claim resting on only one source (ANIMA-style red flag, honest about weakness).
  singleSourceRisk(g) {
    const out = [];
    for (const c of claimsOf(g)) {
      const srcs = sourcesForClaim(g, c["@id"]);
      if (srcs.length === 1) {
        const subj = nameOf(g, c["holo:subject"]);
        const obj = c["holo:objectKind"] === "entity" ? nameOf(g, c["holo:object"]) : c["holo:object"];
        out.push({ kind: "single-source-risk", confidence: 0.5,
          text: `"${subj} ${c["holo:predicate"]} ${obj}" rests on a single source. Corroborate before relying on it.`,
          evidence: [c["@id"]], sources: srcs });
      }
    }
    return out.slice(0, 3);   // bound the noise; log() the cap honestly at the call site if it bites
  },
  // 4 · SHAPE — what KIND of data this is, from the entity-type histogram (mirror ANIMA vertical detection).
  shape(g) {
    const hist = {};
    for (const e of entitiesOf(g)) hist[e["holo:entityType"]] = (hist[e["holo:entityType"]] || 0) + 1;
    const has = (t) => (hist[t] || 0) > 0;
    let shape = null;
    if (has("Money") && has("Organization")) shape = "financial / due-diligence";
    else if (has("Organization") && (has("Person") || has("Place"))) shape = "organizational / CRM-like";
    else if (has("Person") && has("Place")) shape = "people-and-places";
    if (!shape) return [];
    const ev = entitiesOf(g).map((e) => e["@id"]);
    return [{ kind: "shape", confidence: 0.65,
      text: `This data looks ${shape} (${Object.entries(hist).map(([k, v]) => `${v} ${k}`).join(", ")}).`,
      evidence: ev, sources: [...new Set(entitiesOf(g).flatMap((e) => sourcesForEntity(g, e["@id"])))] }];
  },
};

// ── investigate — run a set of investigators over the graph, seal each finding as an insight κ ──────
// investigators: a map of name → (graph, context) → [finding]. Default = the baseline set. Production passes Q's.
// context (A2): the local surface { activeApp, inputText, qConversationId, … } so an investigator can rank/filter
// findings to what the user is doing NOW (A3). Baseline investigators ignore the 2nd arg; it is purely additive.
export async function investigate(graph, { investigators = baselineInvestigators, hash = sha256hex, context = null } = {}) {
  const findings = [];
  for (const fn of Object.values(investigators)) {
    // await supports BOTH sync baseline investigators and async ones (Q's brain call) in the one path.
    try { for (const f of ((await fn(graph, context)) || [])) if (f && f.text && f.evidence) findings.push(f); } catch { /* one investigator failing never aborts the reflex */ }
  }
  const insights = new Map();   // κ → insight (dedup identical findings across investigators)
  for (const f of findings) {
    const ins = sealInsight({ confidence: 0.6, ...f }, hash);
    if (!insights.has(ins.kappa)) insights.set(ins.kappa, ins);
  }
  return [...insights.values()];
}

// ── reactToIngest — THE REFLEX. signal in (S3) → investigate (S4) → insight κs out. ZERO user input. ─
// tap.observeIngest(graph) fires the perception signal; then investigate() produces the briefable insights.
// Returns { signal, insights, graph } — the raw material a brief (S6) renders. Q never had to be asked.
export async function reactToIngest({ graph, tap } = {}, { investigators, hash = sha256hex } = {}) {
  const signal = tap ? await tap.observeIngest(graph) : null;
  const insights = await investigate(graph, { investigators, hash });
  return { signal, insights, graph };
}

// ── verifyInsight — VERIFY-BEFORE-RENDER (S5). An insight is only as trustworthy as its evidence: this
// re-derives the whole provenance chain (insight κ ← evidence κs present in graph ← source κs re-derive from
// their ORIGINAL bytes). If any link breaks — a tampered source, a missing evidence node, a forged insight κ —
// it returns ok:false so a renderer (the brief, S6) REFUSES to show the claim. Provenance is enforced, not
// decorative. sourceBytes: Map<sourceκ, Uint8Array> (what the resolver would supply). rehash injectable (L2).
export function verifyInsight(insight, { graph, sourceBytes = new Map(), rehash = sha256hex } = {}) {
  const broken = { insightId: false, evidence: [], sources: [] };
  // 1 · the insight κ itself re-derives from its canonical finding form (no forged id).
  const canonical = { t: "insight", kind: insight["holo:kind"], text: insight["schema:text"], evidence: [...(insight["holo:evidence"] || [])].sort() };
  broken.insightId = didHolo(SHA, rehash(enc.encode(jcs(canonical)))) !== insight["@id"];
  // 2 · every cited evidence κ is present in the graph (no dangling claim).
  const present = new Set([...(graph["holo:entities"] || []), ...(graph["holo:claims"] || []), ...(graph["holo:provenance"] || [])].map((n) => n["@id"]));
  for (const k of insight["holo:evidence"] || []) if (!present.has(k)) broken.evidence.push(k);
  // 3 · every source κ re-derives from its ORIGINAL bytes (tamper the bytes → this breaks → insight refused).
  for (const s of insight["prov:wasDerivedFrom"] || []) {
    const bytes = sourceBytes.get(s);
    if (!bytes || didHolo(SHA, rehash(bytes)) !== s) broken.sources.push(s);
  }
  const ok = !broken.insightId && broken.evidence.length === 0 && broken.sources.length === 0;
  return { ok, broken };
}

// ── makeQInvestigator — the PRODUCTION seam: Q's zero-shot brain finds open-ended insights ──────────
// Serializes the graph and asks Q for NOVEL findings, each citing the entity/claim names it used (mapped back
// to κs by the caller). NOT witnessed headless (needs a live brain) — honest: the baseline proves mechanics,
// Q proves novelty. Returns findings in the same shape the baseline emits, so it drops into investigate() as-is.
export function makeQInvestigator(brain, { generate = "generate" } = {}) {
  const serialize = (g) => ({
    entities: entitiesOf(g).map((e) => ({ k: e["@id"], name: e["schema:name"], type: e["holo:entityType"] })),
    claims: claimsOf(g).map((c) => ({ k: c["@id"], s: c["holo:subject"], p: c["holo:predicate"], o: c["holo:object"] })),
  });
  return {
    async qInsights(g) {
      const view = serialize(g);
      const PROMPT =
`You are given a knowledge graph (entities + claims, each with a κ id). Find up to 5 NON-OBVIOUS, valuable
insights a human would miss. Return ONLY minified JSON:
[{"kind":"pattern|risk|opportunity|anomaly","text":str,"confidence":0..1,"evidence":[κ,...]}]
Use ONLY κ ids that appear in the graph for evidence.
GRAPH: ${JSON.stringify(view)}`;
      try {
        const out = await brain[generate](PROMPT);
        const m = String(out).match(/\[[\s\S]*\]/);
        const arr = JSON.parse(m ? m[0] : out);
        const valid = new Set([...view.entities.map((e) => e.k), ...view.claims.map((c) => c.k)]);
        return (Array.isArray(arr) ? arr : []).map((f) => {
          const evidence = (f.evidence || []).filter((k) => valid.has(k));
          const sources = [...new Set(evidence.flatMap((k) => sourcesForClaim(g, k)))];
          return { kind: String(f.kind || "pattern"), text: String(f.text || ""),
                   confidence: Number(f.confidence) || 0.6, evidence, sources };
        }).filter((f) => f.text && f.evidence.length);
      } catch { return []; }
    },
  };
}

export default { investigate, reactToIngest, baselineInvestigators, makeQInvestigator };
