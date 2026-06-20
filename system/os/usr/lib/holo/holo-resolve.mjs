// holo-resolve.mjs — THE ONE FRONT DOOR FOR INTENT (Fork 1 of the intent-unification). The audit found the
// user's intent is classified by a DIFFERENT engine per surface: the omnibar runs its own classify(), voice
// runs its own route(), the "+" runs decideRoute() — so the same words get decided three ways. Q.intent is the
// canonical classifier, but the surfaces don't call it. This is the single resolver every surface routes
// through, so intent is decided ONCE wherever it's expressed.
//
// The subtlety the audit surfaced: the omnibar legitimately handles NAVIGATION (a URL, a content address κ, an
// onion, an explicit search) — which is NOT a Q-intent and must never be "built". So the resolver LAYERS two
// lanes in the right order: a request is NAVIGATION (→ the nav handler) or it is a Q-INTENT (→ the one
// Q.intent classifier → ask · build · open · close). Navigation stays navigation; language is decided once by
// the one classifier. Every surface — typed omnibar, spoken voice, dropped "+", an app's call — calls resolve()
// and gets the SAME decision. Source is carried for the record but is NEVER an input to the decision.
//
//   resolve(text, { source, context }) → { source, lane:'nav'|'intent', kind, target, handled, result }
//   register(kind, handler)   // nav · open · close · ask · build · help — the ONE dispatch table
//
// Pure + dependency-injected: `intent` is Q.intent (the one classifier); `isNav` is the surface's navigation
// detector (URL / κ / onion / search); handlers are the real executors. A witness drives faithful stubs; the
// browser passes window.Q.intent + the omnibar's detectors + executors. Deterministic — same text, same lane.

export function makeResolver({ intent, isNav = () => false, handlers = {}, fallback = "build" } = {}) {
  if (typeof intent !== "function") throw new Error("makeResolver needs intent(text) → {kind,target} (Q.intent)");
  const table = new Map(Object.entries(handlers));

  function register(kind, handler) {
    if (typeof handler !== "function") { table.delete(kind); return () => {}; }
    table.set(String(kind), handler);
    return () => table.delete(String(kind));
  }

  // decide(text) — the ONE layered decision, source-independent (it only sees the text):
  //   1. NAVIGATION lane — a URL / content-address / onion / explicit search is a destination, not an intent.
  //   2. INTENT lane — everything else is classified ONCE by Q.intent (ask · build · open · close · help).
  function decide(text) {
    const t = String(text == null ? "" : text);
    let nav = false; try { nav = !!isNav(t); } catch (e) { nav = false; }
    if (nav) return { lane: "nav", kind: "nav", target: t };
    let d = null; try { d = intent(t); } catch (e) { d = null; }
    if (!d || !d.kind) return { lane: "intent", kind: fallback, target: t };
    return { lane: "intent", kind: String(d.kind), target: d.target == null ? t : d.target };
  }

  // resolve(text, {source}) — decide ONCE, dispatch ONCE. The {lane,kind,target} is identical for the same
  // text whatever the source; `source` rides along but is not part of the decision. handled:false (never a
  // throw) when no handler is bound, so a surface can fall back gracefully.
  async function resolve(text, { source = "type", context = null } = {}) {
    const { lane, kind, target } = decide(text);
    const handler = table.get(kind);
    if (!handler) return { source, lane, kind, target, handled: false };
    let result; try { result = await handler(target, { source, context, lane, text: String(text == null ? "" : text) }); }
    catch (e) { return { source, lane, kind, target, handled: true, error: (e && e.message) || String(e) }; }
    return { source, lane, kind, target, handled: true, result };
  }

  return { resolve, decide, register, kinds: () => [...table.keys()].sort() };
}

// the canonical navigation detector — a URL, a did:holo / bare-κ content address, an .onion, or an explicit
// search operator. Conservative: anything that is plainly a DESTINATION, so it never gets misread as "build".
export function looksLikeNavigation(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return true;                              // http(s):// ftp:// ...
  if (/^did:holo:(sha256|blake3):[0-9a-f]{64}$/i.test(t)) return true;             // a content address κ
  if (/^[0-9a-f]{64}$/i.test(t)) return true;                                       // a bare 64-hex κ
  if (/^[a-z2-7]{16,56}\.onion(\/|$)/i.test(t)) return true;                        // a Tor onion
  if (/^\S+\.[a-z]{2,}(\/\S*)?$/i.test(t) && !/\s/.test(t)) return true;            // a bare domain (one token, has a TLD)
  return false;
}

// ── browser binding: window.HoloResolve over Q.intent + the navigation detector. The omnibar, voice, and "+"
// route their text through HoloResolve.resolve(text,{source}) instead of each classifying on their own — ONE
// front door for intent. The shell registers the real handlers (nav → openWeb · open → launch · ask → Q.ask ·
// build → Q.create) where it already has those executors. Law L2, one canonical wire.
if (typeof window !== "undefined") {
  const wire = () => {
    try {
      if (window.HoloResolve || !(window.Q && typeof window.Q.intent === "function")) return;
      window.HoloResolve = makeResolver({ intent: (t) => window.Q.intent(t), isNav: looksLikeNavigation });
      if (document.documentElement) document.documentElement.dispatchEvent(new Event("holo-resolve-ready"));
    } catch (e) { /* leave unset; surfaces keep their own path until wired */ }
  };
  if (window.Q && typeof window.Q.intent === "function") wire();
  else if (document.documentElement) document.documentElement.addEventListener("holo-app-ready", wire, { once: true });
}
