// _shared/holo-answer.js — Holo Answer (ADR-040): the COMPOSED ANSWER CARD. Given the objects a query
// resolved to across the open web, compose a Google-style answer — deterministically, no AI. This is
// an algorithmic "Letter" (composition of many engine outputs) plus due-diligence CONTRADICTION
// DETECTION, realised over the open web's self-verifying objects: every fact is attributed to the source
// object it came from (a clickable did:holo provenance bracket), facts AGREED by ≥2 independent sources are
// corroborated, and facts that DISAGREE are flagged as conflicts — never silently merged.
//
// The honesty is structural: the card asserts only what the sources assert, each claim points back to the
// bytes it came from (re-derivable, Law L5), and disagreement is surfaced, not hidden. No model generates
// the prose, so it cannot hallucinate — the answer is a reconciliation of verifiable facts. Pure +
// isomorphic: extraction + reconciliation are deterministic, so the whole answer is content-addressable.

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));
const LIFESPAN = /\(?\b(\d{4})\s*[–\-—]\s*(\d{4})\b\)?/;   // "(1952–2001)" / "1952-2001"

// extractFacts(obj) → comparable facts from a resolved UOR object (schema.org). Pure + deterministic:
// the canonical name, a lifespan parsed from the description, and the CHARACTERIZATION (the description
// with the lifespan removed) — the field most likely to differ across sources.
export function extractFacts(obj) {
  const name = str(obj["schema:name"]);
  const desc = str(obj["schema:description"]);
  const m = desc.match(LIFESPAN);
  const characterization = desc.replace(LIFESPAN, "").replace(/\s{2,}/g, " ").replace(/^[\s,;–\-—]+|[\s,;–\-—]+$/g, "").trim();
  return { name, born: m ? m[1] : null, died: m ? m[2] : null, characterization: characterization || (desc || null) };
}

export const FACT_KEYS = ["name", "born", "died", "characterization"];
const LABEL = { name: "name", born: "born", died: "died", characterization: "described as" };

// reconcileFacts(objs) → { facts, conflicts, extracted }. For each fact key, group the sources' values:
// one value held by ≥1 source ⇒ a fact (corroborated when ≥2 sources agree); MORE than one distinct value
// ⇒ a conflict carrying every variant + the source that asserts it. Provenance (the source object's did)
// rides on every fact and variant — the clickable bracket.
export function reconcileFacts(objs) {
  const extracted = objs.map((o) => ({ source: str(o["dcterms:source"]) || "source", did: o.id, sameAs: str(o["schema:sameAs"]), ...extractFacts(o) }));
  const facts = [], conflicts = [];
  for (const key of FACT_KEYS) {
    const present = extracted.filter((e) => e[key] != null && e[key] !== "");
    if (!present.length) continue;
    const groups = new Map();
    for (const e of present) { const nv = str(e[key]).toLowerCase().trim(); if (!groups.has(nv)) groups.set(nv, []); groups.get(nv).push(e); }
    if (groups.size === 1) {
      facts.push({ key, label: LABEL[key], value: present[0][key], status: present.length > 1 ? "corroborated" : "single",
        corroboration: present.length, sources: present.map((e) => e.source), provenance: present.map((e) => e.did) });
    } else {
      conflicts.push({ key, label: LABEL[key], variants: [...groups.values()].map((grp) => ({ value: grp[0][key], source: grp[0].source, provenance: grp[0].did })) });
    }
  }
  return { facts, conflicts, extracted };
}

// composeAnswer(query, objs) → the answer card structure: a one-line answer built ONLY from corroborated
// facts (name + lifespan when agreed), the full fact list with provenance, and the flagged conflicts.
export function composeAnswer(query, objs) {
  const { facts, conflicts, extracted } = reconcileFacts(objs);
  const get = (k) => facts.find((f) => f.key === k)?.value;
  const name = get("name") || extracted[0]?.name || str(query);
  const born = get("born"), died = get("died");
  const reconciledTo = (extracted.find((e) => /Q\d+$/.test(e.sameAs))?.sameAs.match(/Q\d+$/) || [null])[0];
  const answer = name + (born && died ? ` (${born}–${died})` : born ? ` (b. ${born})` : "");
  return {
    query: str(query), entity: name, reconciledTo, answer,
    facts, conflicts, sources: objs.map((o) => o.id),
    corroborated: facts.filter((f) => f.status === "corroborated").length, conflicted: conflicts.length,
  };
}

if (typeof window !== "undefined") window.HoloAnswer = { extractFacts, reconcileFacts, composeAnswer, FACT_KEYS };
