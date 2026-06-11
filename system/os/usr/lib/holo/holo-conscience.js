// _shared/holo-conscience.js — the runtime conscience gate (ADR-033), browser-side and isomorphic
// (Web Crypto; also runs in Node 20+ for its witness). Mirrors holo-constitution.mjs's `evaluate` and
// its deterministic content checks EXACTLY — the way _shared/holo-object.js mirrors holo-object.mjs —
// so the user-facing OS enforces the SAME constitution the build gate proved consistent, with no drift.
//
// Sovereign + self-verifying + fail-closed. On load the gate RE-DERIVES each principle's content
// address with Web Crypto and compares it to the pinned κ of the canonical constitution (Law L5). If a
// single byte of a rule has been altered, the address no longer matches and the gate seals shut —
// `evaluate` then refuses EVERYTHING rather than enforce a tampered constitution. No server is asked;
// the gate trusts the rules only because it re-derived them itself. The full byte-leaf DAG (depth ≥ 2,
// the byte-pinned normative source) is re-derived by the Node witness; here we self-verify the rules.

export const CTX = { odrl: "http://www.w3.org/ns/odrl/2/", hcon: "https://hologram.os/ns/constitution#" };
// the base UOR envelope @context — byte-identical to holo-object.mjs's UOR_CONTEXT, so a principle's
// canonical form (and therefore its κ) re-derives the same here as in the Node sealer.
const UOR_CONTEXT = [
  "https://www.w3.org/ns/did/v1",
  "https://w3id.org/security/data-integrity/v2",
  { schema: "https://schema.org/", prov: "http://www.w3.org/ns/prov#", dcterms: "http://purl.org/dc/terms/",
    rel: "schema:additionalType", links: { "@id": "schema:hasPart", "@container": "@set" } },
];

// RFC 8785 JCS — identical to holo-object.js (sorted keys, arrays in order).
export const jcs = (v) => Array.isArray(v) ? "[" + v.map(jcs).join(",") + "]"
  : (v && typeof v === "object") ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}"
  : JSON.stringify(v);
export async function sha256hex(u8) {
  const d = await crypto.subtle.digest("SHA-256", u8);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}
const address = async (doc) => "did:holo:sha256:" + await sha256hex(new TextEncoder().encode(jcs(doc)));

// ── the world model + the eight principles (mirror of holo-constitution.mjs) ──────────────────────
export const WORLD_VARS = [
  "disclosesPii", "disclosesClassified", "fabricatesEvidence", "breachesConsent",
  "refusesLawfulRequest", "refusesToExplain", "overridesKillSwitch", "leavesNoAuditTrace",
  "lawfulDisclosure", "emergencyOverride",
];
export const PRINCIPLES = [
  { id: "P1", title: "Truthfulness", odrl: "prohibition", redLine: false,
    statement: "Shall not assert as fact anything not present in its sources.",
    governs: "fabricatesEvidence", relaxedBy: [] },
  { id: "P2", title: "Provenance", odrl: "duty", redLine: false,
    statement: "Every output shall leave an audit-trail entry naming its sources and the engines that contributed.",
    governs: "leavesNoAuditTrace", relaxedBy: [] },
  { id: "P3", title: "Explainability", odrl: "duty", redLine: false,
    statement: "When asked why, shall surface the reasoning trace.",
    governs: "refusesToExplain", relaxedBy: [] },
  { id: "P4", title: "Consent", odrl: "prohibition", redLine: false,
    statement: "Data shall be used only within its consent envelope, unless lawful disclosure or emergency-override applies.",
    governs: "breachesConsent", relaxedBy: ["lawfulDisclosure", "emergencyOverride"] },
  { id: "P5", title: "Data minimisation", odrl: "prohibition", redLine: true,
    statement: "Shall not disclose personally-identifying data unless lawful disclosure applies.",
    governs: "disclosesPii", relaxedBy: ["lawfulDisclosure"] },
  { id: "P6", title: "Classification handling", odrl: "prohibition", redLine: true,
    statement: "Shall never disclose classified-tagged content. Emergency-override does not relax this.",
    governs: "disclosesClassified", relaxedBy: [] },
  { id: "P7", title: "Kill-switch supremacy", odrl: "prohibition", redLine: true,
    statement: "No output may bypass the kill switch.",
    governs: "overridesKillSwitch", relaxedBy: [] },
  { id: "P8", title: "Caretaker duty", odrl: "duty", redLine: false,
    statement: "Shall not refuse a lawful request from its operator.",
    governs: "refusesLawfulRequest", relaxedBy: [] },
];
export const RED_LINE = PRINCIPLES.filter((p) => p.redLine).map((p) => p.id);   // ["P5","P6","P7"]

// the canonical pins — the κ of the constitution root and of each principle object, as sealed by
// holo-constitution.mjs and committed to constitution/constitution.uor.json. The gate enforces a rule
// only after re-deriving its address to exactly these values.
export const PINNED = {
  root: "did:holo:sha256:3ff288d0c06a0fd22da898301cb6c8c11fc62e3b2b7ab58a53c7cb0cb385f00c",
  principles: {
    P1: "did:holo:sha256:f6f388b6a2000d85530419e8ad9b0fd7cddc93e3d8ab4ea129e7b1ed549b7e7e",
    P2: "did:holo:sha256:77468513ce556e75637fe1a65209af95c56ebf1ced6dddab5ffd9247e865e831",
    P3: "did:holo:sha256:95a096bc2a94b9f39ef9a91224d35f60a88cec6bd6b81940f480cf89832dabc9",
    P4: "did:holo:sha256:95f6502d025bcb5dded74e3a17605a663ba3bdd438544278209bae22f7212f3c",
    P5: "did:holo:sha256:b3d682365a1621611f5d04f6d5230ded2ac9a58ed970bb51fc486fb716014745",
    P6: "did:holo:sha256:e3bce5057da42d0b6b912672a7df9f0b98d38b863625ef8d08561e8b13fbd39a",
    P7: "did:holo:sha256:3092f393e0fb34f2d9e60d2efe328bc7f11b43846f656a9e68d42208837544ab",
    P8: "did:holo:sha256:e95ed978427797b8136f88d93dd2062873f949acae62667cad4d522550427f16",
  },
};

// principleDoc(p): the EXACT content (minus id) holo-constitution.mjs seals — its address is the κ.
const principleDoc = (p) => ({
  "@context": [...UOR_CONTEXT, CTX],
  "@type": [p.odrl === "duty" ? "odrl:Duty" : "odrl:Prohibition", "schema:CreativeWork"],
  "schema:identifier": p.id, "dcterms:title": p.title, "dcterms:description": p.statement,
  "odrl:action": p.governs, "odrl:constraint": p.relaxedBy, "hcon:nonDerogable": p.redLine,
  "prov:wasInfluencedBy": "os/_shared/holo-conscience.js",
});

// ── self-verification + fail-closed seal ──────────────────────────────────────────────────────────
let _sealed = null;                                          // null = not yet verified ⇒ fail closed
// verifyConstitution(opts?): re-derive each principle's address and compare to the pinned κ (Law L5).
// Returns true only if EVERY rule re-derives to its canonical address. opts.principles lets a witness
// pass a tampered set to prove the gate seals shut. Sets the module seal that `evaluate` reads.
export async function verifyConstitution({ principles = PRINCIPLES, pinned = PINNED } = {}) {
  let ok = principles.length === Object.keys(pinned.principles).length;
  for (const p of principles) {
    const did = await address(principleDoc(p));
    if (did !== pinned.principles[p.id]) { ok = false; break; }
  }
  _sealed = ok;
  return ok;
}
export const sealed = () => _sealed === true;

// sat(principle, decision): the uniform predicate — mirror of holo-constitution.mjs.
export const sat = (p, d) => !d[p.governs] || (p.relaxedBy || []).some((r) => d[r]);

// ── the conscience gate ─────────────────────────────────────────────────────────────────────────
// evaluate(decision, opts): per-principle accept | caveat | block + an overall outcome. FAILS CLOSED —
// if the constitution has not self-verified (sealed !== true), it refuses everything. Red-line
// violations (P5/P6/P7) always hard-block; under "answer-then-caveat" a non-red-line violation is a
// caveat; "strict" blocks any violation. Pure + deterministic once sealed.
export function evaluate(decision = {}, { posture = "answer-then-caveat", principles = PRINCIPLES } = {}) {
  if (_sealed !== true) return { outcome: "block", blocked: ["*"], caveats: [], verdicts: [], posture, sealed: false, reason: "constitution unverified — gate failed closed" };
  const d = {}; for (const v of WORLD_VARS) d[v] = !!decision[v];
  const verdicts = principles.map((p) => {
    if (sat(p, d)) return { id: p.id, title: p.title, verdict: "accept", redLine: !!p.redLine };
    const hard = posture === "strict" || p.redLine;
    return { id: p.id, title: p.title, verdict: hard ? "block" : "caveat", redLine: !!p.redLine };
  });
  const blocked = verdicts.filter((v) => v.verdict === "block").map((v) => v.id);
  const caveats = verdicts.filter((v) => v.verdict === "caveat").map((v) => v.id);
  return { outcome: blocked.length ? "block" : caveats.length ? "caveat" : "accept", blocked, caveats, verdicts, posture, sealed: true };
}

// the individual-identifier guard + the unbracketed-claim check (source §4/§5) — mirror of the module.
export const PII_PATTERNS = [
  { type: "nhs", re: /\b\d{3}[ -]?\d{3}[ -]?\d{4}\b/ },
  { type: "nino", re: /\b[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]\b/i },
  { type: "ssn", re: /\b\d{3}-\d{2}-\d{4}\b/ },
  { type: "card", re: /\b(?:\d[ -]?){13,19}\b/ },
  { type: "email", re: /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/ },
  { type: "phone", re: /\b\+?\d[\d ()-]{8,}\d\b/ },
];
export function scanPii(text = "") {
  const out = [];
  for (const p of PII_PATTERNS) { const m = String(text).match(p.re); if (m) out.push({ type: p.type, match: m[0] }); }
  return out;
}
export const hasUnbracketedClaim = (text = "") => {
  const s = String(text); const nums = s.match(/\b\d+(?:\.\d+)?%?\b/g) || [];
  return nums.length > 0 && !/\[[A-Za-z]+\d+\]/.test(s);
};
// evaluateText(text, opts): derive disclosesPii (PII guard, unless lawful) + fabricatesEvidence
// (unbracketed claim) from prose, then run the gate. Mirror of the module's evaluateText.
export function evaluateText(text = "", { decision = {}, posture = "answer-then-caveat", principles = PRINCIPLES } = {}) {
  const pii = scanPii(text);
  const d = { ...decision,
    disclosesPii: decision.disclosesPii || (pii.length > 0 && !decision.lawfulDisclosure),
    fabricatesEvidence: decision.fabricatesEvidence || hasUnbracketedClaim(text) };
  return { ...evaluate(d, { posture, principles }), pii, decision: d };
}

// ── the output court (ADR-033 / source §5): a nine-principle gate on the ANSWER itself ────────────
// Four principles are checked DETERMINISTICALLY (no model call); five are JUDGED by an injected model
// (in production the MCP `ask_model` sampler — the OS borrowing the agent's own model). The judged
// tier is flag-gated (lucida_constitutional_llm, default OFF); when off, unavailable, or malformed,
// each judged principle falls back to a RECORDED CAVEAT — never a clean pass — so the degradation is
// visible in the verdict (judged.source). This is the counterpart to the world-model gate above: that
// governs a decision's shape; this governs the prose that ships.
export const COURT_PRINCIPLES = [
  { id: "C1", title: "Truth",           kind: "deterministic", redLine: false, statement: "Every numeric claim must trace to a provenance bracket such as [E1] or [A2]." },
  { id: "C2", title: "Transparency",    kind: "deterministic", redLine: false, statement: "If the underlying findings carry confidence intervals, the prose must surface them." },
  { id: "C3", title: "Proportionality", kind: "deterministic", redLine: false, statement: "High-alarm language is permitted only when the effect size justifies it." },
  { id: "C4", title: "Dignity",         kind: "deterministic", redLine: true,  statement: "No individual identifier may surface in the prose. This is the red line." },
  { id: "C5", title: "Care",            kind: "judged", redLine: false, statement: "The answer attends to the wellbeing of those it concerns." },
  { id: "C6", title: "Fairness",        kind: "judged", redLine: false, statement: "The answer treats the parties it describes even-handedly, without bias." },
  { id: "C7", title: "Autonomy",        kind: "judged", redLine: false, statement: "The answer respects the reader's agency — it informs rather than directs." },
  { id: "C8", title: "Responsibility",  kind: "judged", redLine: false, statement: "The answer owns its limits and the consequences of acting on it." },
  { id: "C9", title: "Justice",         kind: "judged", redLine: false, statement: "The answer is equitable in who it benefits and who it burdens." },
];
export const JUDGED = COURT_PRINCIPLES.filter((p) => p.kind === "judged");   // the five judged principles

// feature flags (source §10) — honesty/answer-quality flags default ON; the judged-LLM tier defaults
// OFF (it costs a model round-trip and degrades to caveats, so adopting it is a deliberate act).
export const FLAG_DEFAULTS = { lucida_spine: true, lucida_answer_then_caveat: true, lucida_constitutional_llm: false, lucida_provenance_check: true, lucida_voice_retry: false };
export const flagOn = (flags, name) => (flags && name in flags) ? !!flags[name] : !!FLAG_DEFAULTS[name];

const ALARM = /\b(catastrophic|severe|critical|urgent|devastating|disastrous|alarming)\b/i;
const CI_WORDS = /\b(confidence interval|CI|95%|interval)\b/i;
const findingsHaveCI = (findings) => (findings || []).some((f) => f && (f.ci || f.confidenceInterval || f.hasCI));
const maxEffect = (findings) => (findings || []).reduce((m, f) => Math.max(m, (f && (f.effect ?? f.effectSize)) || 0), 0);

// judgeOutput(draft, opts) → the nine-principle court verdict. async — the judged tier may call a model.
//   opts: { findings, judge, context, posture, flags, effectSize }
//   judge: async ({ draft, principles, context }) => { C5:"accept"|"amend"|"block", … } | null
// Aggregation (source §5): a single BLOCK halts (outcome "block"); ≥5 of 9 must ACCEPT to proceed;
// under answer-then-caveat a non-red-line would-be-block is a graded CAVEAT; Dignity NEVER downgrades.
export async function judgeOutput(draft = "", { findings = [], judge = null, context = {}, posture = "answer-then-caveat", flags = {}, effectSize = null } = {}) {
  const text = String(draft);
  const det = {                                                       // true = violated (deterministic)
    C1: hasUnbracketedClaim(text),
    C2: findingsHaveCI(findings) && !CI_WORDS.test(text),
    C3: ALARM.test(text) && (effectSize != null ? effectSize : maxEffect(findings)) < 0.5,
    C4: scanPii(text).length > 0,
  };
  let judged = {}, source = "fallback";                               // judged tier, via the injected model
  if (flagOn(flags, "lucida_constitutional_llm") && typeof judge === "function") {
    try {
      const r = await judge({ draft: text, principles: JUDGED, context });
      if (r && typeof r === "object" && JUDGED.every((p) => ["accept", "amend", "block"].includes(r[p.id]))) { judged = r; source = "model"; }
    } catch (e) { /* model failed → fall back */ }
  }
  for (const p of JUDGED) if (!judged[p.id]) judged[p.id] = "caveat";  // recorded caveat (never a clean pass)

  const down = (p) => (posture === "strict" || p.redLine) ? "block" : "caveat";
  const verdicts = COURT_PRINCIPLES.map((p) => {
    let verdict;
    if (p.kind === "deterministic") verdict = det[p.id] ? down(p) : "accept";
    else { const raw = judged[p.id]; verdict = raw === "accept" ? "accept" : raw === "block" ? down(p) : "caveat"; }  // amend ⇒ caveat
    return { id: p.id, title: p.title, kind: p.kind, redLine: !!p.redLine, verdict };
  });
  const blocked = verdicts.filter((v) => v.verdict === "block").map((v) => v.id);
  const caveats = verdicts.filter((v) => v.verdict === "caveat").map((v) => v.id);
  const accepts = verdicts.filter((v) => v.verdict === "accept").map((v) => v.id);
  const quorum = accepts.length >= 5;                                 // "at least five of the nine must accept"
  const outcome = blocked.length ? "block" : (caveats.length || !quorum) ? "caveat" : "accept";
  return { outcome, blocked, caveats, accepts, acceptCount: accepts.length, quorum, verdicts, judged: { source }, posture };
}

// samplerJudge(sampler): adapt an MCP `ask_model` sampler (async (args)=>text) into a court judge —
// the native model source (the OS borrows the agent's own model). Asks for one batched JSON verdict
// over the five judged principles; a non-JSON / malformed reply ⇒ null ⇒ the court falls back to caveats.
export const samplerJudge = (sampler) => async ({ draft, principles, context }) => {
  if (typeof sampler !== "function") return null;
  const prompt = "You are a constitutional judge. For the ANSWER below, rate each principle as "
    + "\"accept\", \"amend\", or \"block\". Reply with ONLY a JSON object keyed by id.\nPrinciples: "
    + principles.map((p) => `${p.id} (${p.title}): ${p.statement}`).join(" ")
    + `\nContext: ${JSON.stringify(context || {})}\nANSWER:\n${draft}`;
  try { const out = await sampler({ prompt, maxTokens: 256 }); const m = String(out).match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; }
  catch (e) { return null; }
};

// installToSurface(surface): route a UI control surface (the one place every HoloUI page goes
// through — window.HoloUI) through the conscience gate. `evaluate`/`evaluateText` are attached
// IMMEDIATELY and FAIL CLOSED (they refuse until self-verification completes), then re-derive the
// constitution; the same references pass only once the rules re-derive to their pinned κ. Pure (no
// DOM), so it is testable in Node — the UI-edge analog of the MCP pre-dispatch gate.
export async function installToSurface(surface) {
  if (!surface || typeof surface !== "object") return false;
  surface.evaluate = evaluate;                 // fail-closed until sealed (evaluate refuses while _sealed !== true)
  surface.evaluateText = evaluateText;
  surface.judgeOutput = judgeOutput;           // the nine-principle output court (the prose gate)
  surface.conscience = { evaluate, evaluateText, judgeOutput, verifyConstitution, sealed, scanPii, principles: PRINCIPLES, court: COURT_PRINCIPLES, flagOn, RED_LINE, PINNED };
  const ok = await verifyConstitution();
  surface.conscienceSealed = ok;
  return ok;
}

// In the browser, expose the gate and kick off self-verification immediately (fail closed until done).
if (typeof window !== "undefined") {
  window.HoloConscience = { evaluate, evaluateText, judgeOutput, samplerJudge, verifyConstitution, installToSurface, sealed, scanPii, hasUnbracketedClaim, principles: PRINCIPLES, court: COURT_PRINCIPLES, flagOn, RED_LINE, PINNED };
  verifyConstitution().then((ok) => { try { window.dispatchEvent(new CustomEvent("holo-conscience-ready", { detail: { sealed: ok } })); } catch (e) {} });
}
