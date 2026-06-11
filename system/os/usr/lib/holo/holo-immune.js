// _shared/holo-immune.js — the PERIMETER / immune system (ADR-033, source §8.1): score every input
// for ATTACK SHAPE before it is trusted. This is the first of the six defence layers — it sits ahead
// of the constitutional conscience gate, scoring untrusted input (an agent's tool-call args, a pasted
// blob) from the SHAPE of the payload alone, with no training required.
//
// Two parts, mirroring the source: an INNATE detector (always-on, deterministic, dependency-free — a
// risk score from oversized payloads, prompt-injection markers, URL floods, large base-64 blobs, and
// long repeated-character runs) and a REGULATORY gate that caps the false-positive rate and routes
// uncertain cases to human review, so the immune response cannot itself become a denial of service. By
// DEFAULT the immune system observes, logs and reports — blocking is enabled deliberately ("enforce"),
// never assumed. Pure + isomorphic (browser + Node), so it is exactly witnessable. The detector
// ruleset is data (patterns as strings), so it seals into immutable content-addressed κ-objects.

// the innate detectors — each a pure shape test over the payload text, with a risk weight. Patterns
// are STRINGS so the ruleset is content-addressable (a detector cannot be silently weakened, Law L5).
export const INNATE_DETECTORS = [
  { id: "I1", title: "Oversized payload", weight: 0.5, kind: "length", limit: 100000,
    statement: "A payload far larger than any legitimate request — a resource-exhaustion / smuggling shape." },
  { id: "I2", title: "Prompt-injection markers", weight: 0.6, kind: "regex", flags: "i",
    pattern: "\\b(ignore (all )?previous|disregard (the )?above|forget (your |the )?instructions|system prompt|you are now|new instructions?:|jailbreak|developer mode|prompt injection)\\b",
    statement: "Phrases that try to override prior instructions — the classic prompt-injection shape." },
  { id: "I3", title: "URL flood", weight: 0.4, kind: "count", flags: "gi", pattern: "https?://[^\\s]+", limit: 20,
    statement: "A flood of URLs — an exfiltration / spam / SSRF-probe shape." },
  { id: "I4", title: "Large base-64 blob", weight: 0.4, kind: "regex", flags: "",
    pattern: "[A-Za-z0-9+/]{512,}={0,2}", statement: "A long base-64 run — an encoded-payload / smuggling shape." },
  { id: "I5", title: "Long repeated-character run", weight: 0.3, kind: "regex", flags: "",
    pattern: "(.)\\1{200,}", statement: "A long repeated-character run — a buffer / amplification shape." },
];

const fires = (d, text) => {
  if (d.kind === "length") return text.length > d.limit;
  if (d.kind === "count") return (text.match(new RegExp(d.pattern, d.flags || "g")) || []).length > d.limit;
  return new RegExp(d.pattern, d.flags || "").test(text);   // "regex"
};

// scoreInnate(payload, detectors): a risk score in [0,1] from the payload SHAPE alone, plus the hits.
// Deterministic and training-free — the same bytes always score the same (so the score is itself
// content-addressable). Derives entirely from the (sealable) detector ruleset.
export function scoreInnate(payload = "", detectors = INNATE_DETECTORS) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload ?? "");
  const hits = [];
  let sum = 0;
  for (const d of detectors) if (fires(d, text)) { hits.push({ id: d.id, title: d.title, weight: d.weight }); sum += d.weight; }
  return { score: Math.min(1, sum), hits, bytes: text.length };
}

// regulate(score, opts): the regulatory gate. Maps a risk score to allow | review | block, with a
// REVIEW band that routes uncertain cases to a human rather than auto-blocking — the false-positive cap
// that stops the immune response becoming a DoS. Posture "observe" (the DEFAULT) NEVER auto-blocks: a
// would-be block is downgraded to review (report + escalate), so blocking is a deliberate "enforce"
// act, never assumed. Pure + deterministic.
export function regulate(score, { posture = "observe", blockAt = 0.6, reviewAt = 0.3 } = {}) {
  const raw = score >= blockAt ? "block" : score >= reviewAt ? "review" : "allow";
  const decision = posture === "enforce" ? raw : (raw === "block" ? "review" : raw);  // observe never blocks
  return { decision, raw, score, posture, observeOnly: posture !== "enforce" };
}

// assess(payload, opts): the perimeter verdict — innate score + regulatory decision. The one call the
// MCP perimeter (and any input boundary) makes before the input is trusted.
export function assess(payload = "", { posture = "observe", blockAt = 0.6, reviewAt = 0.3, detectors = INNATE_DETECTORS } = {}) {
  const innate = scoreInnate(payload, detectors);
  const reg = regulate(innate.score, { posture, blockAt, reviewAt });
  return { decision: reg.decision, raw: reg.raw, score: innate.score, hits: innate.hits, bytes: innate.bytes, posture, observeOnly: reg.observeOnly };
}

if (typeof window !== "undefined") window.HoloImmune = { INNATE_DETECTORS, scoreInnate, regulate, assess };
