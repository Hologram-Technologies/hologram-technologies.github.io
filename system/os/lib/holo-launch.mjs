// holo-launch.mjs — the projection that turns ONE did:holo link into a running, ISOLATED,
// serverless holospace app. This is the engine's boot model (docs/08 §The execution surface,
// §Projection, §Capabilities): "booting realizes the holospace as a computation over content";
// "a projection makes the browser a peer that IS the substrate"; "the same holospace κ runs on
// any peer and re-derives to verify (L5)"; the capability set "bounds what it may touch" and is
// part of the content-addressed identity. Given an app's content address it produces an isolated,
// capability-bounded mount:
//   • a single LINK is a W3C DID URL (did:holo:…) / holo://<hex> — the app's content identity;
//   • the CLOSURE resolves by κ from ANY source (local cache, peer, gateway), each byte re-derived
//     (Law L5) — 100% serverless, location-independent (Law L1);
//   • the CAPABILITY set → a W3C-native sandbox: a WHATWG <iframe sandbox> in its own realm with a
//     Permissions-Policy `allow` granting ONLY the declared features — everything else is denied.
// No server: resolution is content-addressed; isolation is the platform's. Pure, dependency-free.

// Constitutional admission (ADR-033): mount() — the one unbypassable chokepoint every app boots
// through — refuses any holospace the Constitution's fail-closed conscience gate does not admit.
import { admit } from "./_shared/holo-admit.mjs";

const PREFIX = "did:holo:sha256:";

// parseLink(s) → { did, hex } | null — a single link is a did:holo URL or holo://<hex>.
export function parseLink(s) {
  if (typeof s !== "string") return null;
  let hex = null;
  if (s.startsWith(PREFIX)) hex = s.slice(PREFIX.length).split(/[/?#]/)[0];
  else if (s.startsWith("holo://")) hex = s.slice("holo://".length).split(/[/?#]/)[0];
  return /^[0-9a-f]{64}$/.test(hex || "") ? { did: PREFIX + hex, hex } : null;
}
export const linkFor = (did) => `holo://${String(did).split(":").pop()}`;

// W3C Permissions-Policy feature names the substrate can grant a holospace (the allowlist).
const FEATURE = new Set(["display-capture", "camera", "microphone", "clipboard-read", "clipboard-write",
  "geolocation", "fullscreen", "autoplay", "midi", "usb", "serial", "bluetooth", "xr-spatial-tracking"]);
const SANDBOX_TOKENS = new Set(["allow-scripts", "allow-same-origin", "allow-popups", "allow-downloads",
  "allow-forms", "allow-modals", "allow-popups-to-escape-sandbox", "allow-pointer-lock"]);

// capabilitiesToSandbox(caps) → { sandbox, allow } — the κ-addressed capability set translated to a
// W3C-isolated browsing context. Default-DENY: the frame starts with nothing; we re-grant ONLY what
// the definition declares. `sandbox` is the WHATWG iframe sandbox; `allow` is Permissions-Policy.
export function capabilitiesToSandbox(caps = {}) {
  const sandbox = ["allow-scripts"];                                   // execute the app's code
  if ((caps.storage || []).length) sandbox.push("allow-same-origin");  // its own κ-store namespace (OPFS / Cache API)
  if ((caps.channels || []).length) sandbox.push("allow-popups");      // share / teleport to another holospace
  const allow = (caps.permissions || []).filter((p) => FEATURE.has(p)).join("; ");
  return { sandbox: sandbox.join(" "), allow };
}

// mount({ def, lock, grant }) → the isolated mount descriptor a projection (holospace.html) renders.
// `entry` is the κ of the app's entry page; `closure` is the κ map the in-frame resolver (service
// worker) serves — so every subresource is fetched-and-verified by content, from any source.
//
// Holo Terms enforcement (MyTerms / IEEE 7012): an app is spawned with the AGREED capabilities, not
// merely what it declares. `grant` is the EFFECTIVE capability set the OS derived from the user's
// standing term + signed agreement record (holo-terms.effective / window.HoloTerms.gate) — declared
// ∩ what the first party granted. Default-deny: an empty `grant` yields the bare sandbox; absent a
// grant the app gets only its DECLARED set (the prior contract, for hosts that don't gate).
export function mount({ def, lock, grant } = {}) {
  // The Constitution governs every holospace at the door (ADR-033). Fail-closed: an unverified
  // constitution, or a red-line violation, REFUSES the mount — no app runs ungoverned.
  const verdict = admit(def || {});
  if (!verdict.ok) throw new Error("Constitution refused this holospace (ADR-033): " + verdict.reason);
  const entryRel = Object.keys(lock.closure).find((p) => p.endsWith("/" + def.entry) || p === def.entry);
  const { sandbox, allow } = capabilitiesToSandbox(grant || def.capabilities);
  return {
    id: lock.root,                          // the app's content identity (did:holo) — the single link
    link: linkFor(lock.root),
    name: def.name,
    entry: entryRel ? lock.closure[entryRel].kappa : null,
    sandbox, allow,
    crossOriginIsolated: true,              // COOP/COEP (the coi shim) → SharedArrayBuffer for VM apps
    closure: Object.fromEntries(Object.entries(lock.closure).map(([p, r]) => [p, r.kappa])),
  };
}

// ── the FRAME BOUNDARY (Law L1/L4/L5): make the entry document location-independent ───────────────
// A projection used to navigate its frame to a PATH (`./apps/<id>/index.html`) and trust the worker to
// resolve it by content — so the frame's IDENTITY was a location. These two pure helpers let a projection
// instead fetch the entry BY ITS κ, re-derive it (L5), and mount it as the frame's CONTENT (srcdoc): the
// document IS the κ. The app's own relative subresources still need somewhere to resolve, so we inject ONE
// <base> at the entry's canonical directory — a resolver HINT, never identity — and the worker re-derives
// each of those to its κ in turn (Law L5). Absolute (`/_shared/…`) refs ignore the base and resolve the
// same way; an app that already declares a <base> is left untouched.

// entryBase(landing) → the canonical directory of the entry, as an origin-absolute href (the resolver hint).
export function entryBase(landing) {
  return "/" + String(landing).replace(/^\/+/, "").replace(/[^/]+$/, "");
}

// projectHtml(html, baseHref) → the entry document with a single <base> injected (idempotent: honors an
// existing <base>; inserts at the start of <head>, or prepends if there is none). Pure, dependency-free.
export function projectHtml(html, baseHref) {
  if (/<base\s/i.test(html)) return html;
  const tag = `<base href="${baseHref}">`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + tag) : tag + html;
}

// validateMount(m) → string[] — W3C well-formedness of the isolated mount (empty ⇒ valid).
export function validateMount(m) {
  const errs = [];
  if (!parseLink(m.link)) errs.push("link is not a resolvable did:holo / holo:// URL");
  for (const t of (m.sandbox || "").split(/\s+/).filter(Boolean)) if (!SANDBOX_TOKENS.has(t)) errs.push(`invalid sandbox token: ${t}`);
  for (const f of (m.allow || "").split(";").map((s) => s.trim()).filter(Boolean)) if (!FEATURE.has(f)) errs.push(`invalid Permissions-Policy feature: ${f}`);
  if (m.entry && !/^did:holo:sha256:[0-9a-f]{64}$/.test(m.entry)) errs.push("entry is not a content address");
  return errs;
}
