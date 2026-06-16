// holo-session-client.mjs — the app-side of the Holo Session save/restore handshake (ADR-0106).
//
// A holospace app runs in a sandboxed iframe; the shell cannot read its internal state. This is the
// thin, OPT-IN bridge: an app declares how to serialize + rehydrate its own state, and the shell folds
// that blob into the operator's encrypted session manifest (so it rides the SAME sovereignty + κ as the
// rest of the experience). An app that doesn't import this keeps its own per-origin storage — an honest,
// documented boundary, never faked as covered.
//
// Usage (one call in an app):
//   import { holoSession } from "/_shared/holo-session-client.mjs";
//   holoSession({ save: () => myState, restore: (s) => applyMyState(s) });
//
// Protocol (sibling to holo-files / holo-live-edit):
//   shell → app  { t:"holo-session:save", surfaceId }            → app replies with its state
//   app  → shell { t:"holo-session:state", surfaceId, state }    (state = small JSON-serializable blob)
//   shell → app  { t:"holo-session:restore", surfaceId, state }  → app rehydrates

export function holoSession({ save, restore } = {}) {
  if (typeof window === "undefined" || window.top === window.self) return () => {};   // top shell is not an app
  const onMsg = (e) => {
    const m = e && e.data; if (!m || typeof m !== "object") return;
    if (m.t === "holo-session:save" && typeof save === "function") {
      let state = null; try { state = save(); } catch { state = null; }
      try { window.parent.postMessage({ t: "holo-session:state", surfaceId: m.surfaceId, state }, "*"); } catch {}
    } else if (m.t === "holo-session:restore" && typeof restore === "function") {
      try { restore(m.state); } catch {}
    }
  };
  window.addEventListener("message", onMsg);
  // announce readiness so the shell knows this surface participates (and can dispatch a pending restore)
  try { window.parent.postMessage({ t: "holo-session:ready" }, "*"); } catch {}
  return () => window.removeEventListener("message", onMsg);   // unsubscribe
}

export default holoSession;
