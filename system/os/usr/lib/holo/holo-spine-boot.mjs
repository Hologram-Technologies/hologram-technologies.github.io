// holo-spine-boot.mjs — make the autonomy spine BE Q. Not a system beside Q that labels its notes "Q", but
// Q's own faculties: Q senses (coherence), Q decides what's worth raising (observer), Q speaks in its own
// voice (window.Q.note), and Q acts only within its trust boundary. The complexity is abstracted away — the
// user just gets a copilot that quietly watches and, rarely, says something genuinely worth hearing.
//
// What the user sees on window.Q (the magical, simple surface — ADR-0091 unified door):
//   Q.briefing()   → one plain sentence: what's true now, and the one thing (if any) worth your attention.
//   Q.coherence()  → the live "what's true now" snapshot (coherence scalar, whole, attention) — Q's reflection.
//   Q.notices()    → what Q is currently paying attention to (the ranked proposals) — never acted, only raised.
//   Q.trust        → the boundary that governs Q acting (default-deny; you grant per topic; one-move pause).
// And Q SPEAKS through its own voice: the courier hands notes to window.Q.note, so a heads-up in your inbox
// is literally Q talking — the promise the welcome note already made ("when I notice something, it lands here").
//
// Driven by the heal-boot idle loop (window.HoloSpine.runOnce per tick) — fully automated, zero config. The
// engine is dependency-injected + witnessed; this file is only the wiring that hangs it on Q.

import * as dsp from "/_shared/holo-control-dsp.js";
import { makeCoherence } from "/_shared/holo-coherence.mjs";
import { makeObserver } from "/_shared/holo-observer.mjs";
import { makeCourier } from "/_shared/holo-courier.mjs";
import { makeTrust } from "/_shared/holo-trust.mjs";
import { makeSpine } from "/_shared/holo-spine.mjs";
import { makeMemory } from "/_shared/holo-memory.mjs";
import "/_shared/holo-evolve.mjs";   // side-effect: registers window.HoloEvolve once Q.trust is up (closes the loop, gated)
import { ensureBrainFloor, makeBrainFloor } from "/_shared/holo-brain-floor.mjs";   // guarantee a brain on every core task
import { makeIntentRouter } from "/_shared/holo-intent.mjs";              // one classifier
import { makeResolver, looksLikeNavigation } from "/_shared/holo-resolve.mjs";   // ONE front door (nav lane + Q.intent)
import "/_shared/q/holo-q-faculty.mjs";   // side-effect: window.HoloQFaculty — governed bridge so an intent inside an app reaches the same Q
import "/_shared/holo-ambient.mjs";       // side-effect: window.HoloAmbient — ONE ambient loop the heal-boot pump drives (reflect · drift-heal)
import "/_shared/holo-fix-proposer.mjs";  // side-effect: window.__holoFixProposer — real reversible fixes so the evolve loop SHIPS (within trust)

(function boot() {
  try {
    const store = (window.HoloApp && window.HoloApp.store) || new Map();
    const conscience = window.HoloConscience || null;
    const coherence = makeCoherence({ store, conscience });
    const observer = makeObserver({ dsp, store });
    const trust = makeTrust({ store, conscience });

    // Q's VOICE: the courier hands notes to window.Q.note when Q's door is up, else falls back to the inbox
    // directly (still sender "Q"). Either way it is Q speaking — handed, never generated.
    const sink = { q: (opts) => {
      try { if (window.Q && typeof window.Q.note === "function") return window.Q.note(opts); } catch (e) {}
      try { return window.HoloNotify ? window.HoloNotify.q(opts) : null; } catch (e) { return null; }
    } };
    const courier = makeCourier({ notify: sink });

    // Q's CONTEXT — what you're actually doing. window.__holoScope (exposed by the shell) is the live desktop
    // scope (open apps + the focused one); __holoAppActivity is a bounded ring the app-error channel pushes to.
    // The fold rolls these into the snapshot, so an app error becomes a personal notice and Q's briefing can
    // speak to what you're focused on — Q watching WITH you, not just watching the OS.
    const appsNow = () => {
      const sc = (typeof window.__holoScope === "function") ? (window.__holoScope() || {}) : {};
      const open = Array.isArray(sc.open) ? sc.open.map((o) => ({ app: o.name, phase: "open" })) : [];
      return open.concat(window.__holoAppActivity || []);
    };
    // the app-error channel: gov / an app dispatches `holo-app-error` {detail:{app}}; we ring-buffer it so the
    // next heal tick folds it into an app.error notice. Bounded so a crash-looping app can't flood it.
    try {
      document.addEventListener("holo-app-error", (e) => {
        const app = (e && e.detail && e.detail.app) || "an app";
        (window.__holoAppActivity || (window.__holoAppActivity = [])).push({ app, phase: "error" });
        if (window.__holoAppActivity.length > 64) window.__holoAppActivity.shift();
        try { if (window.HoloSpine && window.__holoHeal) window.HoloSpine.runOnce({ heal: window.__holoHeal }); } catch (x) {}   // speak promptly, don't wait for the idle tick
      });
    } catch (e) {}

    // Q's PERSISTENT USER MODEL (S2) — durable over localStorage (small, per-origin; survives reload). Q.remember
    // writes through here so feedback + intents persist; Q.briefing/affinity can read what you've done before.
    const MEMKEY = "holo.memory.v1";
    const lsBackend = {
      load: async () => { try { return JSON.parse(localStorage.getItem(MEMKEY)) || []; } catch (e) { return []; } },
      save: async (recs) => { try { localStorage.setItem(MEMKEY, JSON.stringify(recs)); } catch (e) {} },
    };
    const memory = makeMemory({ backend: lsBackend, now: () => new Date().toISOString(), conscience });

    // the engine + a thin wrapper that remembers the last full result, so Q's faculties can read it.
    const engine = makeSpine({ coherence, observer, courier, apps: appsNow });
    let lastResult = null;
    window.HoloSpine = {
      runOnce: (tick) => { lastResult = engine.runOnce(tick); return lastResult; },
      last: () => engine.last(),
      result: () => lastResult,
    };

    // ONE AMBIENT LOOP (S1 cutover): register the spine's reflection as a faculty of the single scheduler the
    // heal-boot idle pump drives — so there is ONE heartbeat, not the spine loop + trinity's own setInterval.
    // drift-heal (trinity's Q.improve) registers in attachToQ once Q is up. trinity-ui gates its own timer off
    // when window.HoloAmbient exists. Idempotent.
    try {
      if (window.HoloAmbient && !window.HoloAmbient.__reflectWired) {
        window.HoloAmbient.__reflectWired = true;
        window.HoloAmbient.register("reflect", () => { try { if (window.__holoHeal) window.HoloSpine.runOnce({ heal: window.__holoHeal }); } catch (e) {} }, { everyTicks: 1 });
      }
    } catch (e) {}

    // ── attach the faculties to Q (the one door). Additive + idempotent, exactly like installServe's pattern. ──
    const attachToQ = () => {
      if (!window.Q) return false;
      if (window.Q.__spineWired) return true;
      window.Q.__spineWired = true;
      if (!window.Q.trust) window.Q.trust = trust;                      // Q acts only within this boundary
      window.Q.memory = memory;                                         // Q's persistent user model (survives reload)
      memory.ready();                                                   // hydrate last session's records (async, fail-soft)
      // Q.remember now WRITES THROUGH to durable memory (feedback + intents survive reload), then the original
      // session-ctx adaptation. A vote ⇒ a feedback record (drives affinity); otherwise an intent record.
      const origRemember = (typeof window.Q.remember === "function") ? window.Q.remember.bind(window.Q) : null;
      window.Q.remember = (signal = {}) => {
        try { memory.remember({ kind: signal.vote ? "feedback" : "intent", text: String(signal.intent || signal.text || ""), vote: signal.vote, meta: signal.meta }); } catch (e) {}
        return origRemember ? origRemember(signal) : null;
      };
      // ONE FRONT DOOR (Fork 1): construct the resolver + classifier HERE (Q is confirmed present), rather than
      // relying on their own holo-app-ready auto-wire (whose timing is unreliable). Dispatch the ready events so
      // the shell's executor registration (bindResolve) fires.
      try {
        if (!window.HoloIntent) window.HoloIntent = makeIntentRouter({ classify: (t) => window.Q.intent(t) });
        if (!window.HoloResolve) {
          window.HoloResolve = makeResolver({ intent: (t) => window.Q.intent(t), isNav: looksLikeNavigation });
          if (document.documentElement) document.documentElement.dispatchEvent(new Event("holo-resolve-ready"));
        }
        // GUARANTEE A BRAIN (S3): bind a floor to every core task over Q.mux HERE (Q.mux confirmed present),
        // rather than relying on the unreliable holo-app-ready auto-wire. Real brains upgrade over it.
        if (!window.__holoBrainFloor && window.Q.mux) {
          const _route = (t) => (window.Q.mux.routeTask || window.Q.mux.route).call(window.Q.mux, t);
          const _bind = (t, p) => (window.Q.mux.bindSpecialist || window.Q.mux.bind).call(window.Q.mux, t, p);
          window.__holoBrainFloor = ensureBrainFloor({ route: _route, bind: _bind, makeFloor: makeBrainFloor });
        }
      } catch (e) {}
      window.Q.coherence = () => engine.last();                         // Q's reflection — "what's true now"
      window.Q.notices = () => (lastResult && lastResult.observation ? lastResult.observation.proposals : []);
      window.Q.briefing = () => {                                       // one plain sentence — the simple, personal surface
        const snap = engine.last();
        const notices = window.Q.notices();
        // CONTEXT — what you're focused on right now, so Q speaks to your situation, not the abstract OS.
        const sc = (typeof window.__holoScope === "function") ? (window.__holoScope() || {}) : {};
        const focus = sc.focused && sc.focused.name ? sc.focused.name : null;
        const ctx = focus ? `You're in ${focus}. ` : (sc.count ? `${sc.count} open. ` : "");
        if (!snap) return ctx + "Give me a moment — I haven't taken a look yet.";
        const pct = Math.floor((snap.coherence || 0) * 100);   // floor, so a 99.6% with an open notice never reads "100%"
        // a personal touch when you return: Q knows your history (S2), so a clean briefing greets you by it.
        let mem = ""; try { const t = memory.summary().total; if (t > 0) mem = `Welcome back — I remember our last ${t > 99 ? "99+" : t} note${t === 1 ? "" : "s"}. `; } catch (e) {}
        if (!notices.length) return `${ctx}${mem}All clear — everything's coherent (${pct}%). I'll let you know if that changes.`;
        const more = notices.length > 1 ? ` (and ${notices.length - 1} more)` : "";
        return `${ctx}${notices[0].suggestedAction}${more}  ·  coherence ${pct}%.`;
      };
      // drift-heal becomes a faculty of the ONE ambient loop (trinity's Q.improve), so trinity's own 2s timer
      // can stand down (it gates on window.HoloAmbient). One heartbeat drives reflect + drift-heal together.
      try {
        if (window.HoloAmbient && !window.HoloAmbient.__driftWired && window.Q && typeof window.Q.improve === "function") {
          window.HoloAmbient.__driftWired = true;
          window.HoloAmbient.register("drift-heal", () => { try { window.Q.improve({ maxTicks: 4 }); } catch (e) {} }, { everyTicks: 1 });
        }
      } catch (e) {}
      try { console.log("[holo-spine] integrated into Q — Q.briefing() · Q.coherence() · Q.notices() · Q.trust ready"); } catch (e) {}
      try { document.documentElement.dispatchEvent(new Event("holo-spine-ready")); } catch (e) {}
      return true;
    };

    // window.Q mounts asynchronously (the unified door); poll briefly like installServe does. The cadence works
    // the moment the engine exists; the faculties attach as soon as Q's door is up.
    if (!attachToQ()) { let n = 0; const iv = setInterval(() => { if (attachToQ() || ++n > 60) clearInterval(iv); }, 200); }
  } catch (e) { try { console.warn("[holo-spine] boot skipped:", (e && e.message) || e); } catch (x) {} }
})();
