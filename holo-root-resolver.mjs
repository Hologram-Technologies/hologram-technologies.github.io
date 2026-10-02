// holo-root-resolver.mjs — THE ROOT IS A UNIVERSAL RESOLVER, not a location redirect.
//
// One rule (the whole vision in a sentence): the URL names an OBJECT — a κ or a name — never a
// location. The door asks the signed app-index "what is the κ for this?" and resolves it; the
// entry PATH is DERIVED from the κ (holo-app-index: launching = resolving), never a literal here.
// Empty intent → the default surface (the messenger app) resolved BY ITS κ. So the front door
// holds zero `apps/<dir>/` pointers: identity is the content address, path is a convenience the
// signed index produces from it (L1). Axis-agnostic — it uses app.kappa/app.url, so it speaks
// sha256 today and blake3 the instant the release re-seals (no change here).
//
// Pure + node-testable (no DOM, no fetch); root-door.mjs is the thin browser glue that wires this
// to the upstream holospace runtime (holo-app-index + holo-names-host + holo-card).

export const DEFAULT_APP = "holo-messenger";   // a ROLE (the default surface), NOT a location
export const RESOLVE_APP = "resolve";          // the universal name plane is itself a κ-app (dir "resolve")
const KAPPA_RE = /^(?:did:holo:(?:sha256|blake3):|(?:sha256|blake3):)?([0-9a-f]{64})$/i;

// isKappa(s) → the 64-hex content-address core, or null. Location-free identity test (any axis).
export function isKappa(s) { const m = KAPPA_RE.exec(String(s || "").trim()); return m ? m[1].toLowerCase() : null; }

// parseIntent({search, hash, host, frame}) → { mode, name?, variant? }
//   ?resolve=/open=/k=/kappa= <κ|name> · #<κ|name>   → resolve that object (the universal plane)
//   ?app=<dir|κ>                                      → open that app
//   discord frame (frame_id / *.discordsays.com)      → default surface, discord variant
//   (empty)                                           → default surface, app variant
export function parseIntent({ search = "", hash = "", host = "", frame = false } = {}) {
  const inDiscord = !!frame || /(^|\.)discordsays\.com$/i.test(String(host));
  const q = new URLSearchParams(String(search).replace(/^\?/, ""));
  const h = String(hash || "").replace(/^#/, "");
  const hashName = h && !h.includes("=") ? h : new URLSearchParams(h).get("resolve") || "";
  const named = (q.get("resolve") || q.get("open") || q.get("k") || q.get("kappa") || hashName || "").trim();
  const app = (q.get("app") || "").trim();
  if (named) return { mode: "resolve", name: named };
  if (app) return { mode: "app", name: app };
  return { mode: "default", variant: inDiscord ? "discord" : "app" };
}

// chooseTarget({ index, intent, findApp }) → the resolved target
//   { kind:"app",  app, variant }  — app.url is DERIVED from its signed κ by the index (launch=resolve)
//   { kind:"name", name }          — not an app: the surface runs it through the universal resolver
//                                    (content κ · web · chain · ipfs — each re-derived-or-refused, L5)
export function chooseTarget({ index, intent, findApp }) {
  if (intent.mode === "default") {
    const app = findApp(index, DEFAULT_APP);
    return app ? { kind: "app", app, variant: intent.variant } : { kind: "name", name: DEFAULT_APP };
  }
  const app = findApp(index, intent.name);       // a κ or dir that IS an app → launch by re-derivation
  if (app) return { kind: "app", app, variant: intent.variant };
  return { kind: "name", name: intent.name };     // everything else → the universal name plane
}

// entryFor(app, variant) → the entry URL, DERIVED from the κ-index (app.url / app.entry). The κ is
// the identity; this path is convenience. The default surface carries one internal variant
// (discord.html) selected for the Embedded App SDK — an app-internal choice, not a root pointer.
export function entryFor(app, variant) {
  let url = String(app.url || app.entry || "");
  if (variant === "discord") url = url.replace(/(?:app|index)\.html(?=$|[?#])/i, "discord.html");
  return url;
}

// nameplaneEntry(index, findApp, name) → the universal resolver surface, opened BY ITS κ (the
// "resolve" app is indexed like any other), carrying the name to inspect. Returns null if the
// signed index has no resolve app — the caller then falls to the irreducible bootstrap literal.
export function nameplaneEntry(index, findApp, name) {
  const rs = findApp(index, RESOLVE_APP);
  if (!rs) return null;
  return entryFor(rs) + "?resolve=" + encodeURIComponent(String(name || ""));
}

export default { DEFAULT_APP, RESOLVE_APP, isKappa, parseIntent, chooseTarget, entryFor, nameplaneEntry };
