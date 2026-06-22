// holo-q-app.js — the CROSS-FRAME bridge that makes Q omnipresent INSIDE apps. A sandboxed holospace is
// a separate window: it does NOT inherit the shell's window.Q. This module lets an app reach the one Q
// over the SAME governed `holo-privacy:rpc` channel holo-gov.js already brokers — so the app holds
// NOTHING (no model, no key), the host un-forgeably identifies the frame (byWin), and a build from an app
// goes through Q's governed door (fail-closed + receipted). Mirrors holo-q-remote-client.mjs (ADR-0090).
//
// Protocol (app → host over postMessage):
//   { type:"holo-privacy:rpc", method:"q.summon"|"q.ask"|"q.create", args:{text,context}, id }
// Host → app:  { type:"holo-privacy:delta", id, delta }  (0+ streamed)  ·  { type:"holo-privacy:res", id, result, error }
//
// Both sides live here: createQClient/installQApp (app-side) and createQServe (host-side, injectable Q +
// summon → witnessed in Node with a mock bus).

const RPC = "holo-privacy:rpc", RES = "holo-privacy:res", DELTA = "holo-privacy:delta";

// ── APP SIDE ────────────────────────────────────────────────────────────────────────────────────────
// createQClient({ target?, source? }) → { summon, ask, create }. `target` = the host window (default
// window.parent); `source` = where replies arrive (default window). The app holds only intents.
export function createQClient({ target, source } = {}) {
  const tgt = target || (typeof window !== "undefined" ? window.parent : null);
  const src = source || (typeof window !== "undefined" ? window : null);
  if (!tgt || !src) throw new Error("createQClient: target + source windows are required");

  const pending = new Map(); let _seq = 0;
  const nextId = () => "q-" + (++_seq);
  src.addEventListener("message", (e) => {
    const d = e && e.data; if (!d || (d.type !== RES && d.type !== DELTA)) return;
    const p = pending.get(d.id); if (!p) return;
    if (d.type === DELTA) { if (p.onDelta) { try { p.onDelta(d.delta); } catch (x) {} } return; }
    pending.delete(d.id);
    if (d.error) p.reject(new Error(d.error)); else p.resolve(d.result);
  });
  const call = (method, args, onDelta) => new Promise((resolve, reject) => {
    const id = nextId(); pending.set(id, { resolve, reject, onDelta });
    try { tgt.postMessage({ type: RPC, method, args: args || {}, id }, "*"); }
    catch (err) { pending.delete(id); reject(err); }
  });
  return {
    summon: (text, context) => call("q.summon", { text: text || null, context: context || null }),
    ask: (text, context, onDelta) => call("q.ask", { text, context: context || null }, onDelta),
    create: (text, context) => call("q.create", { text, context: context || null }),
    act: (text, context) => call("q.act", { text, context: context || null }),               // governed OS action
    dictate: () => call("q.dictate", {}),                                                     // one-shot on-device ear → transcript
    // FACULTY BRIDGE (Fork 2): the app reaches the SAME Q's faculties — read the OS reflection + contribute to
    // the user model. The raw model never crosses the frame; trust/privileged surfaces are refused host-side.
    coherence: () => call("q.coherence", {}),
    briefing: () => call("q.briefing", {}),
    notices: () => call("q.notices", {}),
    remember: (signal) => call("q.remember", { signal: signal || {} }),
    // "+" grounding from inside an app → the shell's one Q (holo-plus-q's detectQBus finds this on window.Q).
    addGrounding: (grounding) => call("q.ground", { grounding: grounding || null }),
  };
}

// installQApp(opts) — ONE-LINE conformance: an app `import`s this and gets window.Q + a ⌘/Ctrl-I that
// summons the shell orb over the app. The app's OWN context (title + visible text) is captured so Q is
// aware of what's INSIDE the app — screen awareness without the app holding any intelligence itself.
export function installQApp(opts = {}) {
  if (typeof window === "undefined" || window.parent === window) return null;   // top frame already has the real Q
  if (window.__holoQApp) return window.__holoQApp;                              // idempotent — survives a double inject
  const client = createQClient(opts);
  const appContext = () => { try { return { name: document.title || "this app", source: String((document.body && document.body.innerText) || "").slice(0, 4000) }; } catch (e) { return null; } };
  const Q = {
    summon: (text) => client.summon(text || null, appContext()),
    ask: (text, onDelta) => client.ask(text, appContext(), onDelta),
    create: (text) => client.create(text, appContext()),
    act: (text) => client.act(text, appContext()),
    dictate: () => client.dictate(),                              // capture one utterance → on-device transcript
    // same faculty names as the shell Q, so an app reads the one Q's reflection + contributes to the user model.
    coherence: () => client.coherence(),
    briefing: () => client.briefing(),
    notices: () => client.notices(),
    remember: (signal) => client.remember(signal),
    addGrounding: (grounding) => client.addGrounding(grounding),   // "+" inside an app → the one Q
    _client: client,
  };
  if (!window.Q) window.Q = Q;
  window.__holoQApp = Q;
  try { window.addEventListener("keydown", (e) => { const t = e.target; if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return; if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key || "").toLowerCase() === "i") { e.preventDefault(); Q.summon(); } }); } catch (e) {}
  return Q;
}

// ── HOST SIDE ───────────────────────────────────────────────────────────────────────────────────────
// createQServe({ Q, summon }) → the dispatcher holo-gov.js delegates `q.*` to (as W.HoloQServe). `Q` is
// the shell's real Q; `summon(text,context)` opens the orb. GOVERNED: an app is a separate principal, so
// q.create routes through Q.agent (fail-closed + receipted); q.ask is the answer specialist (egress, if
// boost runs, is gated by the boost broker); q.summon just opens the UI.
export function createQServe({ Q, summon } = {}) {
  if (!Q) throw new Error("createQServe: Q required");
  const ctxFrom = (supplied, app) => { const c = supplied || {}; return { name: c.name || app, source: c.source || null, kappa: c.kappa || null }; };
  return async function serve({ app, method, args = {}, onDelta } = {}) {
    const caller = app || "app";
    try {
      // FACULTY BRIDGE (Fork 2): an app reaches the SAME Q's faculties, governed — reads the OS reflection
      // (q.coherence/briefing/notices), writes through to memory (q.remember, attributed), is REFUSED the
      // user's private/privileged surfaces (q.trust.* / raw memory). Returns null for non-faculty methods, so
      // the base governed serve below handles q.summon/ask/create/act unchanged. The raw user model never
      // crosses the frame (Law L1); only the GROUNDING (affinity + relevant recents) feeds generation.
      const fac = (typeof window !== "undefined" && window.HoloQFaculty) || null;
      if (fac) { const f = await fac.serve({ method, args, caller }); if (f) return f; }
      const ground = (text) => { try { return fac ? fac.ground(caller, text) : null; } catch (e) { return null; } };
      if (method === "q.ground") {   // "+" grounding from an app frame → the shell faculty's sink (feeds the next ask)
        if (fac && typeof fac.addGrounding === "function") { try { fac.addGrounding(args.grounding); return { result: { ok: true } }; } catch (e) { return { result: { ok: false } }; } }
        return { result: { ok: false, reason: "no faculty" } };
      }
      if (method === "q.summon") { if (summon) summon(args.text || null, ctxFrom(args.context, caller)); return { result: { ok: true, app: caller } }; }
      if (method === "q.ask") { const ans = await Q.ask(String(args.text || ""), { context: ctxFrom(args.context, caller), grounding: ground(String(args.text || "")) }); return { result: ans != null ? ans : "" }; }
      if (method === "q.create") { const r = await Q.agent(String(args.text || ""), { caller: caller, params: { current: (args.context && args.context.source) || null, grounding: ground(String(args.text || "")) } }); return { result: r }; }
      if (method === "q.act") { const r = await Q.act(String(args.text || ""), { caller: caller, context: args.context || null }); return { result: r }; }   // GOVERNED OS action from an app/agent
      if (method === "q.dictate") { const hv = (typeof window !== "undefined" && window.HoloVoice); const t = (hv && typeof hv.dictate === "function") ? await hv.dictate() : ""; return { result: t || "" }; }   // one-shot on-device ear → transcript (host owns the mic)
      return { error: "unsupported q method: " + method };
    } catch (e) { return { error: String((e && e.message) || e) }; }
  };
}

// auto-install for apps (the one-line conformance): importing this in a sandboxed holospace wires Q.
if (typeof window !== "undefined" && window.parent !== window && !window.__holoQAppManual) { try { installQApp(); } catch (e) {} }

export default { createQClient, installQApp, createQServe };
