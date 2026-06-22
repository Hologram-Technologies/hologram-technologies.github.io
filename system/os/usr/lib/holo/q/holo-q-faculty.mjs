// holo-q-faculty.mjs — THE FACULTY BRIDGE (Fork 2 of the intent-unification). The audit found that inside an
// app frame window.Q is a thin proxy {summon,ask,create,act}: an intent raised in an app reaches the shell's
// Q but NOT its faculties — coherence, briefing, notices, memory — so an app's create runs against NOTHING it
// knows about the user, while the shell's runs against the full user model. This extends the governed cross-
// frame serve so an app reaches the SAME Q — but GOVERNED, because an app is a separate principal:
//
//   • READ the OS reflection — q.coherence · q.briefing · q.notices. System state, not personal; an app may
//     know "the OS is busy / healing / 98% coherent" to behave well. Read-only.
//   • GROUNDED intent — the app does NOT get the raw user model (a privacy leak). Instead the SHELL grounds an
//     app's create/ask in the user model (affinity for this request + relevant recent intents) and the app
//     receives a context-aware RESULT, never the memory itself. The model stays the shell's; the benefit crosses.
//   • WRITE-THROUGH, attributed — q.remember folds an app's intent into the user model, tagged with the app
//     (provenance), so the model adapts across the whole experience, not just the shell.
//   • REFUSED, fail-closed — q.trust.* (an app cannot change the user's grants or act AS the user), and raw
//     memory (q.memory.recent / export / forget). The user's boundary and private model are not an app's to touch.
//
// Pure + dependency-injected (the shell Q is passed in): a witness drives a mock Q; the host wires it into
// createQServe (holo-q-app.js) so q.<faculty> delegates here. Fail-soft — a missing faculty degrades to an
// honest empty / refusal, never a throw, so a thin Q still serves.

const READS = new Set(["q.coherence", "q.briefing", "q.notices"]);
const REFUSED = new Set(["q.trust", "q.trust.set", "q.trust.setTrust", "q.trust.act", "q.trust.approve", "q.trust.pause",
  "q.memory", "q.memory.recent", "q.memory.affinity", "q.memory.export", "q.memory.forget", "q.remember.forget"]);

// makeFacultyBridge({ Q }) → { serve, ground, methods }.
//   Q : the shell's real Q (with coherence/briefing/notices/memory/remember). Faculties it lacks degrade soft.
export function makeFacultyBridge({ Q } = {}) {
  if (!Q) throw new Error("makeFacultyBridge needs the shell Q");

  // ground(caller, text) — the sanctioned path to the user model: the SHELL computes grounding for an app's
  // create/ask (affinity for this request + relevant recent intents), to be passed INTO generation. The app
  // never receives this object — only the grounded result. Returns a small, safe context, or null if no memory.
  // "+" groundings the user added by intent (holo-plus-q → fuseToQ → addGrounding). Conversation-scoped,
  // bounded, newest-first — these inform the NEXT answer without polluting the long-term user model. Each is
  // a content-addressed holo:Grounding κ-object (auditable), so a cited insight still traces to its source bytes.
  const plus = [];
  function addGrounding(g) {
    if (!g || typeof g !== "object") return false;
    plus.unshift({ kappa: g["@id"] || g.kappa || null, text: String(g["schema:text"] || ""),
      insights: g["holo:insights"] || [], sources: g["holo:sources"] || [] });
    if (plus.length > 6) plus.length = 6;                                  // bounded (Law L3 — RAM is a cache)
    // also write-through to the user model so the SHELL's own ask path (which grounds via Q.memory) sees it.
    try { if (typeof Q.remember === "function") Q.remember({ kind: "intent", text: plus[0].text, meta: { via: "the+", kappa: plus[0].kappa } }); } catch (e) {}
    return true;
  }

  function ground(caller, text) {
    const mem = Q.memory;
    let affinity = 0, hints = [];
    try { affinity = (mem && typeof mem.affinity === "function") ? mem.affinity(text) : 0; } catch (e) {}
    try {
      const toks = new Set(String(text || "").toLowerCase().match(/[a-z0-9]+/g) || []);
      const recent = (mem && typeof mem.recent === "function") ? mem.recent({ kind: "intent", n: 12 }) : [];
      hints = recent.map((r) => String(r["holmem:text"] || r.text || ""))
        .filter((s) => { const rt = new Set(s.toLowerCase().match(/[a-z0-9]+/g) || []); return [...toks].some((x) => rt.has(x)); })
        .slice(0, 3);
    } catch (e) {}
    // the "+" groundings are user-chosen context: surface them regardless of token overlap (newest first).
    const plusHints = plus.map((p) => p.text).filter(Boolean);
    const merged = [...plusHints, ...hints].slice(0, 5);
    if (!mem && !plus.length) return null;                                 // nothing to ground with
    return { affinity, hints: merged, app: String(caller || "app"), plus: plus.slice(0, 3) };
  }

  // serve({ method, args, caller }) → { result } | { error } | null. Returns null when `method` is NOT a
  // faculty method, so the base createQServe handles q.summon/ask/create/act unchanged.
  async function serve({ method, args = {}, caller = "app" } = {}) {
    const m = String(method || "");
    if (REFUSED.has(m)) return { error: "refused: " + m + " is the user's, not an app's (use grounded create/ask)" };
    if (m === "q.remember") {
      // write-through, attributed to the app (provenance) — folds the app's intent into the user model.
      if (typeof Q.remember !== "function") return { result: { ok: false, reason: "no memory" } };
      const sig = (args && args.signal) || {};
      try { Q.remember({ ...sig, meta: { ...(sig.meta || {}), app: String(caller) } }); } catch (e) { return { result: { ok: false } }; }
      return { result: { ok: true, attributedTo: String(caller) } };
    }
    if (READS.has(m)) {
      try {
        if (m === "q.coherence") { const s = typeof Q.coherence === "function" ? Q.coherence() : null; return { result: s ? { coherence: s.coherence, whole: s.whole, attention: (s.attention || []).length } : null }; }
        if (m === "q.briefing") return { result: typeof Q.briefing === "function" ? Q.briefing() : "" };
        if (m === "q.notices") { const n = typeof Q.notices === "function" ? Q.notices() : []; return { result: n.map((p) => ({ kind: p.kind, subject: p.subject })) }; }
      } catch (e) { return { result: null }; }
    }
    return null;   // not a faculty method — let the base serve handle it
  }

  return { serve, ground, addGrounding, methods: () => [...READS, "q.remember"].sort() };
}

// ── browser binding: window.HoloQFaculty over the shell Q, once the spine has wired Q's faculties. The host's
// createQServe delegates q.<faculty> here (a one-line change), and q.create/q.ask pass ground(caller,text) into
// generation so an app's intent is user-model-aware. The app-side client gains read verbs (coherence/briefing/
// notices) + remember. Law L1 (the raw model never leaves the shell) / L2 (one canonical wire).
if (typeof window !== "undefined") {
  const wire = () => {
    try {
      if (window.HoloQFaculty || !(window.Q && typeof window.Q.coherence === "function")) return;
      window.HoloQFaculty = makeFacultyBridge({ Q: window.Q });
      // expose the "+" delivery sink ON the shell Q, so holo-plus-q's detectQBus finds it (window.Q.addGrounding)
      // and an intent's grounding reaches Q's next answer. Idempotent; never clobbers an existing sink.
      try { if (typeof window.Q.addGrounding !== "function") window.Q.addGrounding = (g) => window.HoloQFaculty.addGrounding(g); } catch (e) {}
      if (document.documentElement) document.documentElement.dispatchEvent(new Event("holo-q-faculty-ready"));
    } catch (e) { /* leave unset; apps keep the proxy subset */ }
  };
  if (window.Q && typeof window.Q.coherence === "function") wire();
  else if (document.documentElement) document.documentElement.addEventListener("holo-spine-ready", wire, { once: true });
}

export default { makeFacultyBridge };
