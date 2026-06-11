// holo-voice.mjs — the "plain" voice register for Hologram OS (ADR-028). User-facing
// descriptions avoid tech jargon, lead with WHY then HOW then WHAT, and stay concise.
// This is the authoring discipline behind "be concise, clear, self-disciplined" made
// checkable. Pure + isomorphic: the witness runs it in Node, the shell can run it in the
// browser. One source of truth for the jargon lexicon — holo-voice-lexicon.jsonld is its
// SKOS materialization and holo-voice-witness.mjs re-derives both (no drift).

// jargon → plain. Conventional plain-language swaps (plainlanguage.gov-style). NOT the
// domain vocabulary: κ, content-addressed, Merkle-DAG, holospace are precise terms, kept.
export const JARGON = {
  "utilize": "use", "utilise": "use", "leverage": "use", "facilitate": "help",
  "in order to": "to", "functionality": "features", "commence": "start",
  "terminate": "end", "due to the fact that": "because", "methodology": "method",
  "endeavor": "try", "a number of": "several",
};

const reFor = (term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "ig");

// findJargon(text) → [{term, plain}] for each lexicon term present.
export function findJargon(text) {
  const t = String(text || "");
  return Object.entries(JARGON).filter(([term]) => reFor(term).test(t)).map(([term, plain]) => ({ term, plain }));
}

// order(text) → {ok, why, how, what}: positions of the why → how → what lead-ins, in order.
export function order(text) {
  const t = String(text || "");
  const [why, how, what] = ["Why:", "How:", "What:"].map((m) => t.indexOf(m));
  return { ok: why >= 0 && how > why && what > how, why, how, what };
}

// concision(text, maxWords) → {ok, words}.
export function concision(text, maxWords = 60) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;
  return { ok: words <= maxWords, words, maxWords };
}

// lint(text, {requireOrder, maxWords}) → {ok, jargon, order, concision}.
export function lint(text, { requireOrder = false, maxWords = 60 } = {}) {
  const jargon = findJargon(text);
  const ord = order(text);
  const con = concision(text, maxWords);
  const ok = jargon.length === 0 && con.ok && (!requireOrder || ord.ok);
  return { ok, jargon, order: ord, concision: con };
}

// toSkos() — the lexicon as a W3C SKOS ConceptScheme (the share/publish form). Each swap
// is a skos:Concept: skos:prefLabel = the plain word, skos:altLabel = the jargon to avoid.
const slug = (s) => s.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
export function toSkos() {
  return {
    "@context": {
      skos: "http://www.w3.org/2004/02/skos/core#",
      dcterms: "http://purl.org/dc/terms/",
      voice: "https://hologram.os/ns/voice#",
      prefLabel: "skos:prefLabel", altLabel: "skos:altLabel",
      inScheme: { "@id": "skos:inScheme", "@type": "@id" },
    },
    "@id": "https://hologram.os/ns/voice",
    "@type": "skos:ConceptScheme",
    "skos:prefLabel": "Holo plain voice — jargon → plain lexicon (ADR-028)",
    "dcterms:license": "https://creativecommons.org/publicdomain/zero/1.0/",
    "@graph": Object.entries(JARGON).map(([jargon, plain]) => ({
      "@id": `voice:${slug(plain)}-not-${slug(jargon)}`,
      "@type": "skos:Concept",
      prefLabel: plain, altLabel: jargon,
      inScheme: "https://hologram.os/ns/voice",
    })),
  };
}

if (typeof globalThis !== "undefined") globalThis.HoloVoice = { JARGON, findJargon, order, concision, lint, toSkos };
