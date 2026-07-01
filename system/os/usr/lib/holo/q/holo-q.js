// holo-q.js — Q: the single, unified surface for hologram-native intelligence. ONE object every human,
// app, and external agent touches; behind it sits the whole Holo Q spine — the trinity (create·exist·
// perceive, ADR-0087) over the Mixture-of-Specialists fabric (ADR-0084/0085), the self-improvement loop
// (ADR-0086), and the conscience (ADR-0033). Q abstracts that stack into one calm door.
//
//   Q.create(intent, {onPartial,id,params}) → a holospace/answer, RIDING THE SPINE (κ-memo O(1) on a
//                                              repeat, auto-perceived, healable). The verb the Create
//                                              studio and every app call — same path for all.
//   Q.ask(intent)                           → await form (the sealed value only).
//   Q.agent(request, {caller})              → the SINGLE governed point of contact for EXTERNAL agents /
//                                              non-human entities. FAIL-CLOSED: a conscience must accept,
//                                              every act seals a receipt, and the caller gets ONLY this
//                                              door — never raw interior access.
//   Q.perceive()                            → the live scene feedback (what exists · coherent · drift).
//   Q.improve() / startEvolving()           → the self-healing loop (bounded, governed, ambient).
//   Q.remember(signal) / Q.context          → bounded per-user adaptation (recent intents + 👍/👎 bias).
//
// installQ() → window.Q singleton; ubiquitous (every app inherits the ONE Q). Q COMPOSES — it does not
// replace — HoloTrinity/HoloMind/HoloConscience (all kept working); Q is the unified surface over them.
//
// HONEST by construction: "self-evolving" is the bounded heal/reevaluate loop, NOT an open-ended learner;
// "adapts to the user" is recent-intent context + feedback bias; a build runs on-device/template unless a
// boost model is installed (then it is a network call, governed). Pure ESM, deps injected → Node-witnessed.

import { installTrinity } from "./holo-q-trinity.js";
import mux from "./holo-q-mux.js";
import { createFuse } from "./holo-q-fuse.js";
import { createRecall } from "./holo-q-recall.js";

const intentText = (i) => typeof i === "string" ? i : (i && (i.text || i.utterance || i.input || i.prompt)) || "";

// classifyIntent(text) → { kind, target } — the ONE intent classifier, pure (string in, decision out, no state).
// Exported standalone so EVERY surface shares the exact same door: the desktop shell (HoloResolve over
// Q.intent), the "+" router, AND the mobile home — no divergent per-surface regex. kinds: help · close ·
// minimize · maximize · arrange · open · ask · build. (createQ's intent() simply delegates here.)
export function classifyIntent(text) {
  const s = String(text || "").trim();
  if (!s) return { kind: "build", target: "" };
  const low = s.toLowerCase();
  let m;
  if (/^(?:help|what can (?:you|q) do|what can i (?:say|ask|do|build)|capabilities|commands|\/help)\b/.test(low)) return { kind: "help", target: "" };
  if ((m = low.match(/^(?:close|quit|exit|dismiss)\b\s*(.*)$/))) return { kind: "close", target: m[1].trim() || "this" };
  if ((m = low.match(/^(?:minimi[sz]e|hide)\b\s*(.*)$/))) return { kind: "minimize", target: m[1].trim() || "this" };
  if ((m = low.match(/^(?:maximi[sz]e|full[\s-]?screen|expand)\b\s*(.*)$/))) return { kind: "maximize", target: m[1].trim() || "this" };
  if (/^(?:tile|arrange|grid)\b/.test(low)) return { kind: "arrange", target: "tile" };
  if (/^(?:cascade|stack)\b/.test(low)) return { kind: "arrange", target: "cascade" };
  if (/^(?:focus mode|distraction[\s-]?free|zen)\b/.test(low)) return { kind: "arrange", target: "focus" };
  if ((m = s.match(/^(?:open|launch|go to|goto|navigate to|take me to|jump to)\s+(.+)$/i))) return { kind: "open", target: m[1].trim() };
  if (/^(?:https?:\/\/|holo:\/\/|did:holo:|ipfs:\/\/|www\.)/i.test(s) || /^[\w-]+\.(?:com|org|net|io|dev|app|xyz|ai|gov|edu|co|eth)\b/i.test(s)) return { kind: "open", target: s };
  if (/\?\s*$/.test(s) || /^(?:what|why|how|who|when|where|which|is|are|does|do|can|could|should|would|will|explain|describe|tell me|summari[sz]e|define)\b/i.test(low)) return { kind: "ask", target: s };
  return { kind: "build", target: s };
}

// createQ({ trinity?, mux?, conscience?, clock? }) — all deps injectable (the Holo Atlas isomorphism).
// `conscience` may be an object ({evaluate}) or a thunk returning one (resolved per call → load-order safe).
export function createQ({ trinity = null, mux: muxImpl = mux, conscience = null, clock = null } = {}) {
  const T = trinity || installTrinity();
  const now = clock || (() => (typeof Date !== "undefined" ? Date.now() : 0));
  const resolveGate = () => {
    if (typeof conscience === "function") return conscience();
    if (conscience) return conscience;
    return (typeof window !== "undefined") ? window.HoloConscience : null;
  };

  // ── bounded per-user adaptation: recent intents (continuity) + 👍/👎 (a routing bias signal). This is
  //    a small preference memory, NOT an open-ended learner — labelled honestly in describe(). ──
  const ctx = { recent: [], feedback: { up: 0, down: 0 }, intents: 0 };
  function remember(signal = {}) {
    const i = intentText(signal.intent != null ? signal.intent : signal);
    if (i) { ctx.recent = [i, ...ctx.recent.filter((x) => x !== i)].slice(0, 8); ctx.intents++; }
    if (signal.vote === "up") ctx.feedback.up++; else if (signal.vote === "down") ctx.feedback.down++;
    return q.context;
  }

  // ── CREATE — the ONE verb (human · app · internal). Rides trinity.create → the κ-memoized spine. ──
  // CONTEXT-AWARE: `opts.context` = what the caller is looking at ({ kappa?, source?, name? }). An intent
  // WITH a focused source EDITS it (the source becomes the edit base — "make this calmer" targets THIS);
  // WITHOUT context it's a fresh build. The host binds context = the focused holospace, so Q already knows
  // what "this" is — no copy-paste, no re-describing.
  async function create(intent, opts = {}) {
    const input = intentText(intent);
    if (!input) throw new Error("Q.create: an intent (text) is required");
    remember({ intent: input });
    const ctx = opts.context || null;
    let params = opts.params || {};
    if (ctx && ctx.source && params.current == null) params = { ...params, current: ctx.source, editing: true };
    return T.create({
      id: opts.id || (ctx && ctx.id) || undefined, task: opts.task || "create", input,
      params, render: opts.render === true, onPartial: opts.onPartial || null,
    });
  }
  // ASK — get an ANSWER (text), not a build. Routes to the `ask` specialist (a generative model with a
  // Q&A prompt); context-aware (the focused source is what "this" refers to). Returns null if no answer
  // specialist is bound (the host then shows a graceful notice) — never throws.
  async function ask(intent, opts = {}) {
    try { const r = await create(intent, { ...opts, task: opts.task || "ask" }); return r && r.value; }
    catch (e) { return null; }
  }

  // ── SUMMON — bind a context once and get a context-locked Q (the ambient surface calls this with the
  //    focused holospace, so every act resolves against "what you're looking at"). Same spine, same κs. ──
  function summon(context = null) {
    return {
      context,
      create: (intent, opts = {}) => create(intent, { ...opts, context: opts.context || context }),
      ask: (intent, opts = {}) => ask(intent, { ...opts, context: opts.context || context }),
      agent: (request, opts = {}) => agent(request, opts),
      perceive, improve, remember,
    };
  }

  // ── AGENT — the SINGLE governed door for external / non-human callers. Fail-closed: the conscience
  //    must accept (ADR-0033); with NO gate present, an unknown external caller is DENIED by default
  //    (only an explicit host opt-in, allowUngoverned, lets an internal trusted caller through). Every
  //    accepted act returns a receipt (who · verb · the content-addressed effect κ). The interior
  //    (trinity/fabric/scene) is NEVER handed out — an outside entity gets exactly this function. ──
  async function agent(request, { caller = "external", allowUngoverned = false, params = {}, delegation = null, capability = "q.agent" } = {}) {
    const input = intentText(request);
    if (!input) return { ok: false, refused: true, reason: "empty request", caller };
    // ── DELEGATION (PC → NPC, ADR-0094): if the agent presents a capability grant, it MUST verify
    //    (hybrid Ed25519 ‖ ML-DSA, re-derived κ, unexpired — Law L5), NAME this caller as its subject,
    //    and INCLUDE the capability for this verb. Fail-closed; enforced on TOP of the conscience gate. ──
    let grant = null;
    if (delegation) {
      try {
        const { verifyDelegation, grants } = await import("../holo-delegate.mjs");
        grant = verifyDelegation(delegation, { nowIso: new Date().toISOString() });
        if (!grant) return { ok: false, refused: true, reason: "delegation failed verification (Law L5)", caller };
        if (caller && caller !== "external" && grant.subject !== caller) return { ok: false, refused: true, reason: "delegation subject ≠ caller", caller };
        if (!grants(grant, capability)) return { ok: false, refused: true, reason: "capability not granted: " + capability, caller };
      } catch (e) { return { ok: false, refused: true, reason: "delegation check error: " + (e && e.message), caller }; }
    }
    const C = resolveGate();
    let verdict = { outcome: "accept" };
    if (C && typeof C.evaluate === "function") {
      try { verdict = await C.evaluate({ verb: "q.agent", caller, intent: input, capability, delegation: grant ? grant.subject : null }); }
      catch (e) { return { ok: false, refused: true, reason: "gate error: " + (e && e.message), caller }; }
    } else if (!allowUngoverned) {
      return { ok: false, refused: true, reason: "no conscience gate present — external access is fail-closed", caller };
    }
    if (verdict.outcome === "block") return { ok: false, refused: true, reason: verdict.reason || "refused by conscience", caller };
    const r = await create(input, { task: "create", render: false, params });
    return {
      ok: true, caller, kappa: r.kappa, value: r.value, cached: r.cached, ms: r.ms,
      receipt: { who: caller, verb: "q.agent", intent: input, effectKappa: r.kappa, at: now(), ...(grant ? { delegation: delegation.id, subjectType: "npc", capability } : {}) },
    };
  }

  const perceive = () => T.state();
  const improve = (o) => T.improve(o);

  // ── INTENT — the OMNIPOTENT router: a pure, deterministic classifier that sorts a plain-language line
  //    into what Q should DO — act on the OS (open · close · minimize · maximize), ASK (a question), or
  //    BUILD (everything else). The host executes the action verbs against the OS's existing open/window
  //    primitives; Q just decides. Pure → witnessed; reusable by the orb, an app, or an agent. ──
  function intent(text) { return classifyIntent(text); }

  // ── CAPABILITIES — Q tells you what you can say. Discoverability IS the simplicity: one door, but the
  //    user shouldn't have to guess its verbs. Pure → witnessed; the orb renders it on "help". ──
  function capabilities() {
    return [
      { id: "build", what: "Build a holospace from a plain prompt", examples: ["a teal pricing page", "a todo app"] },
      { id: "ask", what: "Answer about what you're looking at, or your whole desktop", examples: ["what is this?", "what's open?"] },
      { id: "open", what: "Open an app, a link, or any κ (Q.open drives the one portal verb)", examples: ["open files", "go to github.com", "open holo://space/<κ>"] },
      { id: "window", what: "Manage the focused window", examples: ["close this", "minimize", "maximize this"] },
      { id: "arrange", what: "Arrange the whole desktop", examples: ["tile", "cascade", "focus mode"] },
      { id: "runtimes", what: "See and manage every runtime — snapshot/suspend/resume/stop, on κ (Q.runtimes/Q.manage)", examples: ["what's running?", "snapshot this machine", "resume that VM"] },
    ];
  }

  // ── ACT — the ONE verb that DOES anything: classify the line (intent), then ask · build · or act on
  //    the OS. OS actions (open/close/minimize/maximize) execute through host-injected handlers
  //    (configureActions) and are GOVERNED for non-human callers: an agent (caller set, or governed:true)
  //    must pass the conscience — fail-closed with no gate — and every executed action mints a receipt.
  //    The human orb is sovereign (no caller ⇒ ungoverned); an external agent is gated, like Q.agent. ──
  let _actions = null;
  function configureActions(handlers) { _actions = handlers || null; return q; }
  async function act(text, { caller = null, governed = false, context = null } = {}) {
    const line = intentText(text);
    const it = intent(line);
    remember({ intent: line });
    if (it.kind === "ask") return { kind: "ask", value: await ask(line, { context }) };
    if (it.kind === "build") { const r = await create(line, { context }); return { kind: "build", kappa: r && r.kappa, value: r && r.value, cached: r && r.cached }; }
    if (governed || caller != null) {                                  // an OS action by a non-human caller → gate it
      const C = resolveGate();
      if (C && typeof C.evaluate === "function") {
        let v; try { v = await C.evaluate({ verb: "q.act", action: it.kind, target: it.target, caller }); } catch (e) { return { kind: it.kind, refused: true, reason: "gate error: " + (e && e.message), caller }; }
        if (v && v.outcome === "block") return { kind: it.kind, refused: true, reason: v.reason || "refused by conscience", caller };
      } else if (governed) {
        return { kind: it.kind, refused: true, reason: "no conscience gate — OS actions are fail-closed for external callers", caller };
      }
    }
    if (!_actions || typeof _actions[it.kind] !== "function") return { kind: it.kind, target: it.target, error: "no executor bound for action '" + it.kind + "'" };
    let result; try { result = await _actions[it.kind](it.target); } catch (e) { return { kind: it.kind, target: it.target, error: String((e && e.message) || e) }; }
    return { kind: it.kind, target: it.target, ok: true, result: result == null ? true : result, receipt: caller ? { who: caller, verb: "q.act", action: it.kind, target: it.target, at: now() } : null };
  }

  // ── OPEN — a FIRST-CLASS operator verb: open ANY ref (a bare κ · an app · a space · a url) through the
  //    ONE open path (window.HoloOpen → holo://space/<κ> → the derive portal). This is Q OPERATING the one
  //    verb, not merely classifying it — callable programmatically with a κ (no text line to parse). Routes
  //    through the SAME host-bound `open` executor as act(), and is GOVERNED identically (a non-human caller
  //    passes the conscience, fail-closed with no gate; the human orb is sovereign). Every act mints a receipt.
  async function open(ref, { caller = null, governed = false } = {}) {
    const target = intentText(ref);
    if (!target) return { kind: "open", ok: false, error: "Q.open: a ref (κ · app · space · url) is required" };
    if (governed || caller != null) {                                 // a non-human caller → gate it (like act/agent)
      const C = resolveGate();
      if (C && typeof C.evaluate === "function") {
        let v; try { v = await C.evaluate({ verb: "q.act", action: "open", target, caller }); }
        catch (e) { return { kind: "open", refused: true, reason: "gate error: " + (e && e.message), caller }; }
        if (v && v.outcome === "block") return { kind: "open", refused: true, reason: v.reason || "refused by conscience", caller };
      } else if (governed) return { kind: "open", refused: true, reason: "no conscience gate — open is fail-closed for external callers", caller };
    }
    if (!_actions || typeof _actions.open !== "function") return { kind: "open", target, error: "no open executor bound (host must configureActions)" };
    remember({ intent: "open " + target });
    let result; try { result = await _actions.open(target); } catch (e) { return { kind: "open", target, error: String((e && e.message) || e) }; }
    return { kind: "open", target, ok: true, result: result == null ? true : result, receipt: caller ? { who: caller, verb: "q.open", target, at: now() } : null };
  }

  // ── RUNTIMES — Q operates the ONE management plane (§6): observe EVERY runtime (holospace · web · VM) and
  //    snapshot / suspend / resume / stop it, tier-agnostic, on κ. The host binds the plane via
  //    configureRuntimes(manager) — the same holo-runtime-manage plane the shell renders. Observing (runtimes())
  //    is open; a CONTROL verb (manage) is GOVERNED like act/open (external gated, fail-closed with no gate; the
  //    human orb is sovereign) and receipted. This is Q as a first-class operator of the hypervisor, not beside it.
  let _runtimes = null;
  function configureRuntimes(manager) { _runtimes = manager || null; return q; }
  function runtimes() { try { return _runtimes ? _runtimes.list() : []; } catch (e) { return []; } }
  async function manage(verb, id, { caller = null, governed = false } = {}) {
    if (!["snapshot", "suspend", "resume", "stop"].includes(verb)) return { ok: false, reason: "unknown runtime verb: " + verb };
    if (!_runtimes || typeof _runtimes[verb] !== "function") return { ok: false, reason: "no runtime plane bound (host must configureRuntimes)" };
    if (governed || caller != null) {                                 // a non-human caller controlling a runtime → gate it
      const C = resolveGate();
      if (C && typeof C.evaluate === "function") {
        let v; try { v = await C.evaluate({ verb: "q.manage", action: verb, target: id, caller }); }
        catch (e) { return { ok: false, refused: true, reason: "gate error: " + (e && e.message), caller }; }
        if (v && v.outcome === "block") return { ok: false, refused: true, reason: v.reason || "refused by conscience", caller };
      } else if (governed) return { ok: false, refused: true, reason: "no conscience gate — runtime control is fail-closed for external callers", caller };
    }
    remember({ intent: verb + " " + id });
    let r; try { r = await _runtimes[verb](id); } catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
    return { ...(r && typeof r === "object" ? r : { ok: r !== false }), receipt: caller ? { who: caller, verb: "q.manage", action: verb, target: id, at: now() } : null };
  }

  // ── SCOPE — Q's awareness of the WHOLE OS experience: summarize the desktop's open holospaces into a
  //    compact, model-readable overview (pure — the host passes the live world + focused id). This is
  //    what makes Q "aware of the entire Hologram OS," not just the one thing in front of you. ──
  function scope(world = [], focusedId = null) {
    const items = (world || [])
      .filter((n) => n && n.state !== "hidden" && (n.kind === "app" || n.kind === "web" || n.kind === "block" || n.appId || n.webAddr || n.src || n.content))
      .map((n) => ({
        name: String(n.title || n.name || "holospace").replace(/\s+·.*$/, "").replace(/^🌐\s*/, "").trim() || "holospace",
        kind: (n.webAddr || n.kind === "web") ? "web" : (n.kind || "app"),
        focused: focusedId != null && n.id === focusedId,
      }));
    const focused = items.find((i) => i.focused) || null;
    const summary = items.length
      ? "The desktop has " + items.length + " open holospace" + (items.length === 1 ? "" : "s") + ": " +
        items.map((i) => i.name + (i.focused ? " (focused)" : "")).join(", ") + "."
      : "The desktop is empty — no holospaces open.";
    return { count: items.length, open: items, focused, summary };
  }

  // ── FUSE — the COMPOUND verb (ADR-0098): run a PANEL of small specialists on the SAME prompt in
  //    parallel, JUDGE them, then SYNTHESIZE one new answer none produced. Rides the κ-memo fabric, so a
  //    repeat fusion is O(1) and every deliberation seals a re-derivable holoq:FusionReceipt. The host
  //    wires the panel (which models) via configureFuse — exactly like binding a specialist (mux's job);
  //    with no panel configured, fuse() returns an honest notice (never throws), like ask(). Conscience
  //    is passed through so the FusionReceipt carries the gate's verdict. Lift, not magic — see
  //    holo-q-fuse.describeFuse(): "compound beats components on the WASM floor", not "Fable-5 in a tab". ──
  let _fuse = null;
  function configureFuse(config = {}) {
    if (config && typeof config.fuse === "function") { _fuse = config; }      // an already-built createFuse() instance
    else { _fuse = createFuse({ panel: config.panel || [], judge: config.judge || null, synth: config.synth || null, fabric: config.fabric || null, clock }); }
    return q;
  }
  async function fuse(input, opts = {}) {
    if (!_fuse) return { ok: false, refused: true, reason: "Q.fuse: no panel configured — call Q.configureFuse({ panel, judge?, synth? }) first" };
    remember({ intent: intentText(input) });
    try { return await _fuse.fuse(input, { conscience: resolveGate(), ...opts }); }
    catch (e) { return { ok: false, refused: true, reason: "Q.fuse: " + (e && e.message || e) }; }
  }

  // ── RECALL — κ-graph retrieval over the PRIVATE corpus (ADR-0099): semantic ⊕ lexical ⊕ graph-expanded
  //    retrieval over YOUR own objects, sealed as a re-derivable holoq:RecallReceipt. This is the "what do
  //    I know" door — STRICTLY separate from the open-web stack (ADR-0037–0046, "what does the open web
  //    know"). The host wires the corpus (which objects are indexed) via configureRecall — exactly like
  //    binding a fuse panel or a specialist (the host's job); with no corpus, recall() returns an honest
  //    notice (never throws), like ask()/fuse(). The deterministic core runs zero models; synthesize:true
  //    is an opt-in cited answer + gap analysis over the injected synth (a Q.fuse instance or a provider).
  //    Conscience is passed through so the RecallReceipt carries the gate's verdict. ──
  let _recall = null;
  function configureRecall(config = {}) {
    if (config && typeof config.recall === "function") { _recall = config; }              // an already-built createRecall() instance
    else if (config && config.corpus) { _recall = createRecall({ corpus: config.corpus, synth: config.synth || _fuse || null, clock }); }
    return q;
  }
  async function recall(query, opts = {}) {
    if (!_recall) return { ok: false, refused: true, reason: "Q.recall: no corpus configured — call Q.configureRecall({ corpus }) first" };
    remember({ intent: intentText(query) });
    try { return await _recall.recall(query, { conscience: resolveGate(), ...opts }); }
    catch (e) { return { ok: false, refused: true, reason: "Q.recall: " + (e && e.message || e) }; }
  }

  const q = {
    create, ask, agent, open, runtimes, manage, configureRuntimes, summon, scope, intent, capabilities, act, configureActions, fuse, configureFuse, recall, configureRecall, perceive, improve, remember,
    get context() { return { recent: ctx.recent.slice(), feedback: { ...ctx.feedback }, intents: ctx.intents }; },
    route: (task) => muxImpl.routeTask(task),
    trinity: T, mux: muxImpl,
    startEvolving: (ms = 2000) => T.startImproving(ms), stopEvolving: () => T.stopImproving(),
    describe: () => ({
      what: "Q — the one surface for hologram-native intelligence: humans, apps, and external agents all touch this single door",
      verbs: "create/ask (build·answer, rides the κ-memo spine) · fuse (compound model — panel→judge→synthesize, ADR-0098) · recall (κ-graph retrieval over your PRIVATE corpus — hybrid ⊕ graph-expand, ADR-0099) · summon(context) (context-locked Q — resolves intent against what you're looking at) · agent (governed external door, fail-closed + receipted) · perceive/improve (self-healing) · remember (bounded adaptation)",
      ubiquity: "installQ() → window.Q singleton; every app inherits ONE Q (composes, never replaces, HoloTrinity/HoloMind/HoloConscience)",
      governance: "external / non-human callers get ONLY Q.agent — conscience-gated (fail-closed), receipted; the interior is never exposed raw",
      honest: "self-evolving = the bounded heal/reevaluate loop (not open-ended learning); adaptation = recent-intent context + 👍/👎 bias; a build is on-device/template unless boost is installed (then a governed network call)",
    }),
  };
  return q;
}

// the OS-wide singleton — every native app inherits ONE Q (the shell installs it over the trinity).
export function installQ(opts = {}) {
  const g = (typeof window !== "undefined") ? window : globalThis;
  if (!g.Q) g.Q = createQ(opts);
  return g.Q;
}

export default { createQ, installQ };
