// holo-intent.mjs — ONE INTENT CLASSIFIER (S4 of the Q-unification, the last seam). The audit found input is
// decided TWICE: typed text goes through Q.intent (holo-q.js, deterministic), but voice runs its OWN route()
// heuristic — so the same words can be classified differently depending on whether you spoke or typed them,
// and only voice's "unhandled" lines fall through to Q. This is the single canonical router every surface
// funnels through: typed omnibar, voice, an app's cross-frame call — all classify with the ONE Q.intent and
// dispatch through ONE table, so a request is decided ONCE by the orchestrator. Source is carried (for
// telemetry/provenance) but NEVER changes the decision. Spoken and typed converge.
//
//   route(text, { source, context }) → { source, kind, target, handled, result }
//     • classify with the injected Q.intent → { kind, target }  (the ONE classifier; the decision)
//     • dispatch to handlers[kind] if registered → result      (the ONE dispatch table)
//     • handled:false (never a throw) when no handler is bound, so a caller can fall back gracefully.
//   register(kind, handler) → off   ·   handlers can be (target, {source,context,text}) → any
//
// Pure + dependency-injected (the classifier + handlers are passed in): a witness drives a faithful Q.intent;
// the browser passes window.Q.intent and the shell's real executors (open · close · ask → Q.ask · build → Q.create).

export function makeIntentRouter({ classify, handlers = {}, fallback = "build" } = {}) {
  if (typeof classify !== "function") throw new Error("makeIntentRouter needs a classify(text) → {kind,target} (Q.intent)");
  const table = new Map(Object.entries(handlers));

  function register(kind, handler) {
    if (typeof handler !== "function") { table.delete(kind); return () => {}; }
    table.set(String(kind), handler);
    return () => { table.delete(String(kind)); };
  }

  // decide(text) — the ONE classification. Source-independent by construction: it only sees the text. A
  // blank/garbled input resolves to the honest fallback kind, never a throw.
  function decide(text) {
    const t = String(text == null ? "" : text);
    let d = null; try { d = classify(t); } catch (e) { d = null; }
    if (!d || !d.kind) return { kind: fallback, target: t };
    return { kind: String(d.kind), target: d.target == null ? t : d.target };
  }

  // route(text, {source}) — classify ONCE, dispatch ONCE. The returned {kind,target} is identical for the
  // same text whatever the source; `source` rides along for the record but is not an input to the decision.
  async function route(text, { source = "type", context = null } = {}) {
    const { kind, target } = decide(text);
    const handler = table.get(kind);
    if (!handler) return { source, kind, target, handled: false };
    let result; try { result = await handler(target, { source, context, text: String(text == null ? "" : text) }); }
    catch (e) { return { source, kind, target, handled: true, error: (e && e.message) || String(e) }; }
    return { source, kind, target, handled: true, result };
  }

  return { route, decide, register, kinds: () => [...table.keys()].sort() };
}

// ── browser binding: window.HoloIntent over window.Q.intent + the shell's executors. Both the omnibar and
// voice's unhandled-line path should call HoloIntent.route(text, {source}) instead of re-classifying — so
// every surface shares ONE decision. Law L2, one canonical wire. The shell registers handlers (open/close/
// ask/build) where it already has those executors; voice just routes its transcript here.
if (typeof window !== "undefined") {
  const wire = () => {
    try {
      if (window.HoloIntent || !(window.Q && typeof window.Q.intent === "function")) return;
      window.HoloIntent = makeIntentRouter({ classify: (t) => window.Q.intent(t) });
      if (document.documentElement) document.documentElement.dispatchEvent(new Event("holo-intent-ready"));
    } catch (e) { /* leave unset; surfaces keep their own path */ }
  };
  if (window.Q && typeof window.Q.intent === "function") wire();
  else if (document.documentElement) document.documentElement.addEventListener("holo-app-ready", wire, { once: true });
}
