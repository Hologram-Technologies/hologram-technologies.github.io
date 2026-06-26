// holo-omni-resolve.mjs — the omnibox, as a PURE destination resolver.
//
// Strategy A (unify the chrome) needs ONE thing the shell never had to express: given whatever a human
// types, produce the CANONICAL NAVIGABLE URL a real CEF tab should LoadURL — plus the human NAME to show
// in the bar. Today omniGo (shell-main.mjs) fuses resolve + open: it classifies AND mutates in-page tabs
// (launch/addNode/newTab). With real CEF tabs there is no in-page mutation; the host intercepts the typed
// string, asks THIS function for a destination, and navigates. So this is omniGo's resolver half, lifted
// out side-effect-free.
//
//   resolveDestination(typed, { catalog, hasAnchor }) → { url, name, kind } | { defer:true, kind } | null
//
// Invariants (witnessed in holo-omni-resolve-witness.mjs):
//  · Pure + total + deterministic. No clock, no RNG, no fetch. Node === browser === host. Same input → same out.
//  · Parity with omniGo's precedence: a κ-that-is-an-app, a NAME, three words, a κ, a CID, an onion, media,
//    a web URL, free text → the SAME destination class omniGo would open.
//  · Names, not paths. For a known place/app the `name` is its catalog/PLACES name; for the web, its domain;
//    for a κ, a short κ label — never a filesystem path.
//  · Refuse, never invent. An input that needs LIVE resolution (an owned holo-zone name, a web3 ENS/0x
//    lookup) returns { defer:true } so the host routes it through the real async resolver (omniGo over the
//    service bridge) — this function never fabricates a destination it cannot derive offline.
//  · No new reachability. Every URL it emits is one the κ-scheme is meant to serve (holo://os/…, holo://<κ>/,
//    holo://space/…, holo://<appid>/) or an explicit web projection lens — the host still re-verifies under L5.

import { classifyOpen } from "./holo-open.mjs";
import { resolve as addrResolve, nameOf as addrNameOf } from "./holo-address.mjs";

// ── The destination URL grammar. ONE place names every navigable form, so the host and Strategy B's
//    shell-drawn chrome agree on what a tab's URL means. Phase 2 wires the κ-scheme + shell to serve these.
export const DEST = Object.freeze({
  kappa:   (hex)      => `holo://${hex}/`,                                                  // a content address → boot the app/object at that κ
  app:     (id)       => `holo://${id}/`,                                                   // a named (non-hash) app
  space:   (id)       => `holo://space/${id}`,                                              // a holospace / room
  ipfs:    (cid)      => `holo://os/ipfs/${cid}`,                                            // IPFS object, browsed through the native verified gateway
  onion:   (host)     => `holo://os/onion?target=${encodeURIComponent(host)}`,              // Tor v3, the validated onion path (every byte re-derived)
  media:   (src)      => `holo://os/sc/play?src=${encodeURIComponent(src)}`,                // a streamable file → the κ-anchored player
  web:     (url)      => `holo://os/usr/lib/holo/holo-osr-projector.html?target=${encodeURIComponent(url)}`, // a live page → a PROJECTED κ tab (matches projectOpen)
  find:    (q)        => `holo://os/find.html?q=${encodeURIComponent(q)}`,                  // free text → Holo Find
});

const PREFIX = "did:holo:sha256:";

// normalize any κ form (did:holo:sha256:<hex> · holo://<hex> · bare 64hex) to its bare hex.
function kappaHex(v) {
  const m = String(v).match(/([0-9a-f]{64})/i);
  return m ? m[1].toLowerCase() : null;
}
// a short, human κ label for the bar — first 8 of the hex, never the whole path.
const kappaLabel = (hex) => "κ:" + hex.slice(0, 8);
// the domain of a web url, for the bar.
const domainOf = (url) => String(url).replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "");

// web3 shapes omniGo resolves LIVE (openWeb3 runs before classify): an ENS name (*.eth) or a 0x account/tx.
// We cannot derive their destination offline (a name → an address → a sealed κ-card is a live lookup), so we
// DEFER rather than guess. .eth is also a TLD classifyOpen would call "url"; catch it here first, like omniGo.
const isWeb3 = (v) => /\.eth$/i.test(v) || /^0x[0-9a-f]{40}$/i.test(v) || /^0x[0-9a-f]{64}$/i.test(v);
// an owned, mutable holo name (holo-zone / a bare pinned root name) — also live (re-derives off a source chain).
// A fully-qualified holo://zone/… always; a bare single token (no dots, so not a domain or three-words) only
// when a root anchor is pinned (it MIGHT be an owned name worth a live lookup). Known names already won in step 1.
const isHoloName = (v, hasAnchor) =>
  /^holo:\/\/zone\//i.test(v) ||
  (hasAnchor && /^[a-z0-9][a-z0-9-]*$/i.test(v));

// resolveDestination(typed, ctx) — the whole resolver, offline. ctx.catalog is the apps catalog (raw doc,
// dataset array, or a prebuilt index from holo-address); ctx.hasAnchor says whether any holo-root anchor is
// pinned (so a bare word MIGHT be an owned name worth deferring). Both optional.
export function resolveDestination(typed, ctx = {}) {
  const v = String(typed == null ? "" : typed).trim();
  if (!v) return null;
  const catalog = ctx.catalog || [];

  // 0. A CONTENT κ in any spelling (did:holo:sha256:<hex> · bare 64hex · holo://<hex>) → boot the app/object at
  //    that κ. Checked FIRST so a shared app link always opens the app (matches omniGo's appByKappa-first), and
  //    so a canonical κ never reaches holo-address (which is for path-form locations, not content addresses).
  if (/^did:holo:sha256:[0-9a-f]{64}$/i.test(v) || /^[0-9a-f]{64}$/i.test(v) || /^holo:\/\/[0-9a-f]{64}\/?$/i.test(v)) {
    const hex = kappaHex(v);
    return { url: DEST.kappa(hex), kind: "kappa", name: kappaLabel(hex) };
  }

  // 1. A NAME (a place or an app: "home", "login", "find", "Holo Browser", "browser", a three-word address,
  //    an alternate name) → its canonical location IS the destination. holo-address also passes a already-
  //    canonical holo://… / did / 64hex straight through, so we read its classification off the result.
  const ra = addrResolve(v, catalog);
  if (ra && ra.loc) {
    // a name that resolved to a real catalog/place location (not just the passthrough of what we typed).
    const canonical = ra.loc !== v;
    if (canonical) return withName({ url: ra.loc, kind: classifyOpen(ra.loc).kind, name: ra.name || addrNameOf(ra.loc, catalog) }, ra.loc, catalog);
  }

  // 1b. An already-canonical OS URL (holo://os/…) is itself the destination — don't re-classify it.
  if (/^holo:\/\/os\//i.test(v)) return { url: v, kind: "os", name: addrNameOf(v, catalog) };

  // 2. Live shapes we must DEFER (never invent a destination): web3 ENS/0x, owned holo names.
  if (isWeb3(v)) return { defer: true, kind: "web3" };
  if (isHoloName(v, !!ctx.hasAnchor)) return { defer: true, kind: "holoname" };

  // 3. Deterministic shapes — classify by form and map to the canonical URL.
  const { kind } = classifyOpen(v);
  switch (kind) {
    case "kappa": { const hex = kappaHex(v); return hex ? { url: DEST.kappa(hex), kind: "kappa", name: kappaLabel(hex) } : null; }   // (κ forms already handled in step 0; this guards any classifyOpen edge)
    case "space": { const id = v.replace(/^holo:\/\/space\//i, ""); return { url: DEST.space(id), kind: "space", name: id }; }
    case "app":   { const id = v.replace(/^holo:\/\//i, "").replace(/\/.*$/, ""); return { url: DEST.app(id), kind: "app", name: addrNameOf(v, catalog) || id }; }
    case "cid":   { const cid = v.replace(/^ipfs:\/\//i, "").replace(/^.*\/ipfs\//i, ""); return { url: DEST.ipfs(cid), kind: "cid", name: "ipfs:" + cid.slice(0, 10) }; }
    case "onion": { const host = v.replace(/^https?:\/\//i, "").replace(/\/.*$/, ""); return { url: DEST.onion(host), kind: "onion", name: host }; }
    case "media": { const url = /^https?:\/\//i.test(v) ? v : v; return { url: DEST.media(url), kind: "media", name: url.replace(/^.*\//, "") }; }
    case "url":   { const url = /^https?:\/\//i.test(v) ? v : "https://" + v.replace(/^\/+/, ""); return { url: DEST.web(url), kind: "web", name: domainOf(url) }; }
    case "words": return { defer: true, kind: "words" };   // three words that did NOT match a catalog app → let the live resolver try (classify/matches)
    case "text":
    default:      return { url: DEST.find(v), kind: "text", name: v };
  }
}

// stamp the display name, falling back to a name-not-path projection of the destination.
function withName(out, loc, catalog) {
  if (!out.name) out.name = addrNameOf(loc, catalog) || null;
  return out;
}

// route(typed, ctx) → a PURE action descriptor the chrome executes. Splits the resolver's output into the
// three things a chrome can do, so the home-hero omnibox (Strategy A) and a future shell-drawn toolbar
// (Strategy B) share ONE decision and stay in lock-step:
//   { action:"navigate", url, name, kind }  — a deterministic destination → load it (κ · space · app · web · media · cid · onion · Find)
//   { action:"open", input }                — a LIVE shape (web3 ENS/0x · owned holo-name) → hand to the full async resolver (HoloOpen)
//   null                                     — empty input → do nothing
// Note the chrome chooses the TRANSPORT for "navigate": go straight to url, or via the native search route
// holo://os/omni?q=<input> (preferred, since that is exactly what Phase 2's real CEF tabs will do).
export function route(typed, ctx = {}) {
  const r = resolveDestination(typed, ctx);
  if (!r) return null;
  if (r.defer) return { action: "open", input: String(typed).trim() };
  return { action: "navigate", url: r.url, name: r.name || null, kind: r.kind };
}

// ── browser binding: window.HoloResolve over the live apps catalog (mirrors HoloAddress). The shell injects
//    the already-loaded catalog so the host's interception path resolves synchronously, no second fetch.
if (typeof window !== "undefined" && !window.HoloResolve) {
  let _catalog = [];
  window.HoloResolve = {
    DEST,
    setCatalog: (j) => { _catalog = j || []; },
    resolve: (typed, opts) => resolveDestination(typed, { catalog: _catalog, ...(opts || {}) }),
    route: (typed, opts) => route(typed, { catalog: _catalog, ...(opts || {}) }),
  };
}

export default { DEST, resolveDestination, route };
