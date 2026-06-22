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
import "/_shared/holo-strand.mjs";   // side-effect: window.HoloStrand — the operator's source chain (resume spine; holo-session mirrors/reconciles through it)
import "/_shared/holo-strand-provenance.mjs";   // side-effect: window.HoloStrandProvenance — P2: the "+" ingest provenance derives from the spine
import "/_shared/holo-strand-audit.mjs";        // side-effect: window.HoloStrandAudit — P3: one signed audit source (consent · delegation · value)
import "/_shared/holo-strand-rules.mjs";        // side-effect: window.HoloStrandRules — P4: validation rules as chain-referenced κ (forkable, provable)
import "/_shared/holo-strand-feed.mjs";         // side-effect: window.HoloStrandFeed — the human-readable view of the one spine (Q.activity reads it)
import "/_shared/holo-strand-stores.mjs";       // side-effect: window.HoloStrandStores — P5: old stores as projections of the spine
import "/_shared/holo-warrant.mjs";             // side-effect: window.HoloWarrant — W: the κ-immune system (proof-of-invalid, verified not trusted)
import "/_shared/holo-strand-admit.mjs";        // side-effect: window.HoloStrandAdmit — V: peer re-validation on receipt (verify-before-mount gate)
import "/_shared/holo-shard.mjs";               // side-effect: window.HoloShard — D: content-addressed shared space (sharded κ-store)
import "/_shared/holo-gossip.mjs";              // side-effect: window.HoloGossip — G: κ-gossip of heads + warrants (anti-entropy, self-healing)
import "/_shared/holo-membrane.mjs";            // side-effect: window.HoloMembrane — M: per-app membranes (forkable app boundary)
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
    // AT-REST ENCRYPTION (privacy by construction, matching holo-memory's idb store): records are AES-GCM
    // sealed under the operator's sovereign vault key (holo-session.activeCipher) before they touch
    // localStorage — a same-origin app reads only ciphertext, never your memory. Fail-CLOSED: no cipher
    // (locked) → don't write plaintext. Legacy v1 plaintext arrays are read once, then re-sealed on next save.
    const _b64e = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
    const _b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    const _cipher = async () => { try { const m = await import("/_shared/holo-session.mjs"); return m.activeCipher ? (await m.activeCipher()).cipher : null; } catch (e) { return null; } };
    const lsBackend = {
      load: async () => {
        try {
          const s = localStorage.getItem(MEMKEY); if (!s) return [];
          let v; try { v = JSON.parse(s); } catch (e) { return []; }
          if (Array.isArray(v)) return v;                                           // v1 plaintext → migrated on next save
          if (v && v.v === 2 && typeof v.b64 === "string") { const c = await _cipher(); if (!c) return []; const pt = await c.open(_b64d(v.b64)); return pt ? JSON.parse(new TextDecoder().decode(pt)) : []; }
          return [];
        } catch (e) { return []; }
      },
      save: async (recs) => {
        try {
          const c = await _cipher(); if (!c) return;                                // locked / no key → never write plaintext
          const blob = await c.seal(new TextEncoder().encode(JSON.stringify(recs)));
          localStorage.setItem(MEMKEY, JSON.stringify({ v: 2, b64: _b64e(blob) }));
        } catch (e) {}
      },
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
      // Q.activity(opts) — "what did I do / approve / ingest?" read from the ONE source chain (resume ·
      // ingest provenance · consent/delegation/value audit · rules), most-recent-first, plain language.
      window.Q.activity = (opts = {}) => { try { return window.HoloStrandFeed.activityFeed(window.HoloStrand, opts); } catch (e) { return []; } };
      // the κ-immune system: ONE shared immunity the receive gate (admit, V) and Q.flag both consult, so a
      // confirmed warrant blocks the actor everywhere on this device. Bound once Q is up.
      try { if (window.HoloWarrant && !window.__holoImmunity) window.__holoImmunity = window.HoloWarrant.makeImmunity(); } catch (e) {}
      // Q.flag(entry, ruleset) — the human door to the immune system: raise a warrant on a bad entry, then
      // CONFIRM it independently (the verdict never trusts the flagger). Agents call window.HoloWarrant
      // directly; both reach the SAME shared immunity. Returns { ok, warrant?, actor?, why }.
      window.Q.flag = async (entry, ruleset) => {
        try {
          const w = await window.HoloWarrant.raiseWarrant({ entry, ruleset }, null);
          if (!w) return { ok: false, why: "entry-is-valid" };           // refuse to flag a conforming entry
          const r = await (window.__holoImmunity || window.HoloWarrant.makeImmunity()).receive(w);
          return { ok: !!r.confirmed, warrant: w.id, actor: r.actor || null, why: r.why || null };
        } catch (e) { return { ok: false, why: (e && e.message) || "flag-failed" }; }
      };
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
        // a quiet touch of the living-organism truth (intrinsic integrity + sovereignty) woven into the
        // briefing every operator already sees — natively felt, never a separate surface.
        let spaceTail = ""; try { const n = window.HoloStrand ? window.HoloStrand.length() : 0; if (n > 0) spaceTail = ` Your space is yours — ${n} verified, untampered.`; } catch (e) {}
        if (!notices.length) return `${ctx}${mem}All clear — everything's coherent (${pct}%).${spaceTail} I'll let you know if that changes.`;
        const more = notices.length > 1 ? ` (and ${notices.length - 1} more)` : "";
        return `${ctx}${notices[0].suggestedAction}${more}  ·  coherence ${pct}%.`;
      };
      // Q.space() — the living-organism status in one plain sentence: your space is yours, intact, and
      // protected. The whitepaper's intrinsic data integrity + agent sovereignty + immune system, FELT —
      // drawn live from the source chain + the shared immunity, no jargon, reachable by humans and agents.
      window.Q.space = () => {
        let n = 0, blocked = 0;
        try { n = window.HoloStrand ? window.HoloStrand.length() : 0; } catch (e) {}
        try { blocked = (window.__holoImmunity && window.__holoImmunity.blocklist) ? window.__holoImmunity.blocklist().length : 0; } catch (e) {}
        const remembered = n > 0 ? `${n} thing${n === 1 ? "" : "s"} remembered, all verified` : "a fresh start";
        const guard = blocked > 0 ? ` I've turned away ${blocked} that didn't belong — you're safe.` : "";
        return `Your space is yours and intact — ${remembered}. No server, no account; it can't be quietly changed.${guard}`;
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
