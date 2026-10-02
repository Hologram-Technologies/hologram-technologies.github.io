// holo-q-live-evolve.mjs — Q EVOLVES (Q-ONE U3b): the WELD that wires the orphaned deep-evolution engine
// (holo-mind-evolve.mjs, ADR-0081 Phase 2 — complete, witnessed, and until now imported by NOTHING) into the
// living Q. No second engine, no re-implementation: this module only adapts the live product's signals into the
// engine's contracts — the deepest lesson of the Q-ONE unification applied to its own last gap.
//
//   the corpus    = Q's real conversational performance (identity-guard trips · empty replies · no-brain
//                   dead-ends · successes), appended as sealed, hash-linked Traces (rewriting history breaks κs)
//   the skill     = ONE evolving SKILL.md ("q-style-evolution") whose body is a bounded addendum to Q's persona
//   the optimizer = the LOCAL warm brain (injected sampler; cold → honestly no proposal)
//   governance    = deterministic tests (injected by the surface: identity fixed-point, frontmatter, injection,
//                   size) + the ENGINE's fail-closed gate — a proposal seals UN-ratified → NOT in force; only
//                   the USER's "approve" (a classifier verb from their own turn — content can never ratify)
//                   re-seals it ratified → in force → the persona changes. Rollback re-pins the parent (append-
//                   only succession: nothing is ever mutated).
//   persistence   = the realm store (a HoloMemory record): AES-sealed, realm-keyed, CLAIMED at sign-in (U1) —
//                   your Q's evolution survives reload + sign-in and is yours alone.
//
// HONEST BOUNDARY (the engine's own): the proposal is a stochastic generation — NOT reproducible. What re-derives
// (L5) is the audit trail: which corpus, which parent, which gate evidence, ratified by whom, and that the
// in-force fact follows from the sealed gate (isInForce re-evaluates it — a forged approval is refused).
// Fail-soft everywhere; kill-switch ?qevolve=0; zero boot-path cost (no timers beyond a debounced persist).

import { appendTrace, walkCorpus, failures, proposeRevision, sealSkillRevision, isInForce, projectSkill, parseFrontmatter, SIZE_CEILING } from "../holo-mind-evolve.mjs";
import { resolve } from "../holo-mind.mjs";

const SEED_BYTES = "---\nname: q-style-evolution\ndescription: How Q speaks and behaves with this specific person - learned from real conversations, ratified by them.\n---\n";
const ADDENDUM_CAP = 1200, CORPUS_KEEP = 30, REV_KEEP = 12;
const _enc = new TextEncoder(), _dec = new TextDecoder();

export function makeLiveEvolve({ memory = null, now = () => Date.now() } = {}) {
  const store = new Map();
  let corpusHead = null, skillHead = null, pending = null, hydrated = false, tracesSincePersist = 0, persistT = null;

  // ── realm persistence: ONE HoloMemory record (latest wins) carrying the REACHABLE object set + heads ──
  function reachable() {
    const keep = new Set();
    const walkRevs = (k, n) => { while (k && n-- > 0 && !keep.has(k)) { keep.add(k); const r = resolve(store, k); if (!r) break; const p = (r.links || []).find((l) => l.rel === "prov:wasRevisionOf"); const d = (r.links || []).filter((l) => l.rel === "prov:wasDerivedFrom"); for (const l of d) keep.add(l.id); k = p ? p.id : null; } };
    for (const t of walkCorpus(store, corpusHead).slice(0, CORPUS_KEEP)) keep.add(t.id);
    walkRevs(skillHead, REV_KEEP); walkRevs(pending, 2);
    return keep;
  }
  const hexOf = (did) => String(did || "").split(":").pop();
  function snapshot() {
    const objs = {};
    for (const did of reachable()) { const b = store.get(hexOf(did)); if (b) objs[hexOf(did)] = _dec.decode(b); }
    return { v: 1, objs, corpusHead, skillHead, pending };
  }
  async function persistNow() {
    try { if (memory && memory.remember) await memory.remember({ kind: "evolve", text: "state", meta: snapshot() }); } catch (e) {}
  }
  function persistSoon() { if (persistT) return; persistT = setTimeout(() => { persistT = null; persistNow(); }, 2000); }
  async function hydrate() {
    if (hydrated) return; hydrated = true;
    try {
      if (memory && memory.ready) await memory.ready();
      const rec = memory && memory.recent ? memory.recent({ kind: "evolve", n: 1 })[0] : null;
      const m = rec && rec["holmem:meta"];
      if (m && m.objs) { for (const [hex, s] of Object.entries(m.objs)) store.set(hex, _enc.encode(s)); corpusHead = m.corpusHead || null; skillHead = m.skillHead || null; pending = m.pending || null; }
    } catch (e) {}
  }

  // ── the live skill (parent bytes + the persona addendum) ──
  const skillRev = () => (skillHead ? resolve(store, skillHead) : null);
  const parentBytes = () => { const r = skillRev(); return (r && r["holo:proposalBytes"]) || SEED_BYTES; };
  function addendum() {
    const r = skillRev(); if (!r || !isInForce(r) || !projectSkill(r)) return "";
    const body = String(r["holo:proposalBytes"] || "").replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim();
    return body.slice(0, ADDENDUM_CAP);
  }

  // ── the corpus: note real turns ──
  async function noteTurn({ outcome = "success", kind = null } = {}) {
    try {
      await hydrate();
      const t = appendTrace(store, corpusHead, { outcome: outcome === "failure" ? "failure" : "success", failureKind: kind });
      corpusHead = t.id;
      if (++tracesSincePersist >= 10 || outcome === "failure") { tracesSincePersist = 0; persistSoon(); }
      return t.id;
    } catch (e) { return null; }
  }

  // ── default deterministic tests (the surface INJECTS stronger ones — identity fixed-point etc.) ──
  function defaultTests(bytes) {
    try {
      if (typeof bytes !== "string" || !bytes.trim() || bytes.length > SIZE_CEILING) return false;
      const fm = parseFrontmatter(bytes); if (fm.name !== "q-style-evolution" || !fm.description) return false;
      if (/\b(ignore (all |your )?previous|system override|you are (chatgpt|gpt|openai|gemini|claude)|hosted on (aws|azure|the cloud))\b/i.test(bytes)) return false;
      return true;
    } catch (e) { return false; }
  }

  // ── propose: failures → the injected sampler → sealed UN-ratified (NOT in force) ──
  async function propose({ sampler = null, tests = null } = {}) {
    await hydrate();
    if (typeof sampler !== "function") return { ok: false, reason: "no-sampler" };   // cold brain → honestly nothing
    let bytes = null;
    try { bytes = await proposeRevision({ parentBytes: parentBytes(), failureTraces: failures(store, corpusHead).slice(0, 12), sampler }); } catch (e) {}
    if (!bytes) return { ok: false, reason: "no-proposal" };
    if (!/^---/.test(bytes)) bytes = SEED_BYTES + bytes.trim();      // a bare-body proposal is wrapped in the canonical frontmatter
    const testsPass = !!(defaultTests(bytes) && (typeof tests !== "function" || tests(bytes) === true));
    if (!testsPass) return { ok: false, reason: "tests-fail" };      // a draft that fails the deterministic gate is DEAD ON ARRIVAL — it never becomes a pending revision (so it can't be shown or later approved)
    const rev = sealSkillRevision(store, {
      parentKappa: skillHead, corpusHeadKappa: corpusHead, proposalBytes: bytes,
      gate: { testsPass: true, conscienceOutcome: "accept", ratifiedBy: "", coolingOffElapsed: true },
    });
    pending = rev.id; persistSoon();
    return { ok: true, kappa: rev.id, inForce: isInForce(rev), testsPass: true, preview: bytes.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim().slice(0, 400) };
  }

  // ── approve: the USER ratifies → re-sealed in force → the persona changes ──
  async function approve({ ratifiedBy = "operator", tests = null } = {}) {
    await hydrate();
    const p = pending ? resolve(store, pending) : null;
    if (!p) return { ok: false, reason: "nothing-pending" };
    const bytes = p["holo:proposalBytes"] || "";
    const testsPass = !!(defaultTests(bytes) && (typeof tests !== "function" || tests(bytes) === true));
    if (!testsPass) { pending = null; persistSoon(); return { ok: false, reason: "tests-fail" }; }
    const rev = sealSkillRevision(store, {
      parentKappa: skillHead, corpusHeadKappa: corpusHead, proposalBytes: bytes,
      gate: { testsPass: true, conscienceOutcome: "accept", ratifiedBy: String(ratifiedBy || "operator"), coolingOffElapsed: true },
    });
    if (!isInForce(rev)) return { ok: false, reason: "gate-refused" };
    skillHead = rev.id; pending = null; await persistNow();
    return { ok: true, kappa: rev.id, addendum: addendum() };
  }

  // ── rollback: re-pin the parent (append-only — the old κ was never mutated) ──
  async function rollback() {
    await hydrate();
    const r = skillRev(); if (!r) return { ok: false, reason: "nothing-in-force" };
    const parent = (r.links || []).find((l) => l.rel === "prov:wasRevisionOf");
    skillHead = parent ? parent.id : null; pending = null; await persistNow();
    return { ok: true, kappa: skillHead };
  }

  async function status() {
    await hydrate();
    const corpus = walkCorpus(store, corpusHead);
    const r = skillRev(); const p = pending ? resolve(store, pending) : null;
    return {
      traces: corpus.length, failures: corpus.filter((t) => t["holo:outcome"] === "failure").length,
      inForce: !!(r && isInForce(r)), skillKappa: skillHead, revisions: (() => { let n = 0, k = skillHead; while (k && n < 99) { n++; const x = resolve(store, k); const l = x && (x.links || []).find((q) => q.rel === "prov:wasRevisionOf"); k = l ? l.id : null; } return n; })(),
      pending: p ? { kappa: pending, preview: String(p["holo:proposalBytes"] || "").replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim().slice(0, 200) } : null,
      addendum: addendum(),
    };
  }

  return { noteTurn, propose, approve, rollback, status, addendum, hydrate, _store: store };
}

// ── browser binding: window.QEvolve over the realm store, once HoloMemory exists. Kill-switch ?qevolve=0. ──
if (typeof window !== "undefined") {
  try {
    const off = /[?&]qevolve=0/.test(location.search);
    const bind = () => {
      try {
        if (window.QEvolve || !window.HoloMemory) return !!window.QEvolve;
        window.QEvolve = off
          ? { noteTurn: async () => null, propose: async () => ({ ok: false, reason: "off" }), approve: async () => ({ ok: false, reason: "off" }), rollback: async () => ({ ok: false, reason: "off" }), status: async () => ({ off: true }), addendum: () => "" }
          : makeLiveEvolve({ memory: window.HoloMemory });
        try { document.documentElement.dispatchEvent(new Event("holo-qevolve-ready")); } catch (e) {}
        return true;
      } catch (e) { return false; }
    };
    if (!bind()) {
      try { document.documentElement.addEventListener("holo-memory-ready", bind, { once: true }); } catch (e) {}
      let n = 0; const iv = setInterval(() => { if (bind() || ++n > 40) clearInterval(iv); }, 500);
    }
  } catch (e) { try { console.warn("[q-evolve] init failed:", e); } catch (x) {} }
}
