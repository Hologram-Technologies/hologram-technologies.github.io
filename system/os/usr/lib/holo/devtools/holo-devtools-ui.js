// holo-devtools-ui.js — the SHELL-SIDE install for Holo DevTools (ADR-0095). The twin of
// holo-q-trinity-ui.js / the HoloQServe install: it makes the RUNNING shell able to serve CDP to a
// DevTools holospace frame, 100% serverless and κ-anchored. The vendored Chrome devtools-frontend is the
// UI (untouched); this is the only first-party glue — the authority install + the live-scene projection.
//
// What it does, on load (browser) or on demand (Node witness, via the exported helpers):
//   1. PROJECT the live desktop into a κ-store + a scene manifest — the self-verifying objects the DOM
//      domain inspects (ADR-0089). The objects are SEALED (jcs ⊕ did:holo) so resolve + verify are pure.
//   2. INSTALL window.HoloDevToolsServe = the κ-CDP backend (holo-devtools-serve.mjs), which holo-gov.js
//      already routes method:"cdp" to (the one branch). Browser-safe resolve/verifyDeep are injected, so
//      no Node Buffer is touched — identical re-derivation in the SW / browser / Node (Law L2).
//   3. Expose window.HoloDevTools = { install, setScene, open } — a launcher mounts the UI holospace.
//
// Low latency: resolve is an O(1) Map.get over the projected store (the κ-memo IS the cache, Law L3); CDP
// rides the in-page holo-privacy:rpc bus (no socket). Self-verifying: every inspected κ re-derives (L5).

import { createDevToolsServe } from "./holo-devtools-serve.mjs";
import { createLiveDevToolsServe } from "./holo-devtools-live-backend.mjs";   // Tier 1: real F12 over the live same-origin holospace
import { createKappaFetchTap } from "./holo-devtools-kappa-network.mjs";       // A4: the Network panel's κ-stream seam
import { lensFor, inspectKappa } from "./holo-devtools-kappa-lens.mjs";        // A6: the κ-lens (every app κ-object, inspect+govern)
import { jcs, address } from "../holo-object.mjs";   // both are Buffer-free (browser + SW safe — see holo-object.mjs:42)
import { scene as sceneManifest } from "../holo-scene.mjs";

const hexOf = (did) => String(did).split(":").pop();

// ── browser/SW-safe κ resolution over a string-valued store (Map<hex, jcs-string>) ──
// The default holo-object resolve/verifyDeep are Node-Buffer-based; these are the serverless twins:
// pure string + re-derive, no Buffer, identical Law-L5 semantics (re-derive the address, compare).
export function browserResolve(store, did) {
  const s = store && store.get(hexOf(did));
  if (!s) return null;
  try { return JSON.parse(typeof s === "string" ? s : new TextDecoder().decode(s)); } catch (e) { return null; }
}
export function browserVerifyDeep(store, obj, depth = 0) {
  if (!obj || obj.id !== address(obj)) return { ok: false, at: obj && obj.id, why: "id does not re-derive", depth };
  let max = depth;
  for (const link of obj.links || []) {
    const child = browserResolve(store, link.id);
    if (!child) { if (link.leaf) { max = Math.max(max, depth + 1); continue; } return { ok: false, at: link.id, why: "unresolved link", depth }; }
    if (child.id !== link.id) return { ok: false, at: link.id, why: "id/link mismatch", depth };
    const r = browserVerifyDeep(store, child, depth + 1);
    if (!r.ok) return r;
    max = Math.max(max, r.depth);
  }
  return { ok: true, depth: max };
}

// ── project a set of live, sealed UOR objects → a string-valued κ-store (serverless, Map.get O(1)) ──
export function buildStore(objects = []) {
  const store = new Map();
  for (const o of objects) { if (o && o.id) store.set(hexOf(o.id), jcs(o)); }
  return store;
}

// ── project placed objects → a scene manifest (the DOM root the Elements panel renders) ──
export function buildScene(placements = [], type = "holo:HomeScene") {
  return sceneManifest({ type, objects: placements.map((p) => ({ k: p.k, x: p.x | 0, y: p.y | 0, w: p.w | 0, h: p.h | 0, ...(p.z !== undefined ? { z: p.z } : {}) })) });
}

// ── the install: window.HoloDevToolsServe = the κ-CDP backend over the projected, self-verifying store ──
export function installDevToolsServe({ objects = [], placements = [], type = "holo:HomeScene", conscience = null, qAgent = null, theme = null } = {}) {
  const store = buildStore(objects);
  const scene = buildScene(placements, type);
  // liveEdit (ADR-0093): a DevTools Elements/Sources edit drives the LIVE holospace in place via the ONE
  // primitive — the same κ-act the Build chat performs. Targets window.HoloDevToolsTarget (the focused
  // holospace the shell sets when DevTools opens); absent ⇒ the backend keeps DevTools read-only (honest).
  const liveEdit = (a) => {
    const LE = (typeof window !== "undefined") ? window.HoloLiveEdit : null;
    const id = (typeof window !== "undefined" && window.HoloDevToolsTarget) || (a && (a.kappa || a.nodeId));
    return (LE && id) ? LE.edit(id, a && a.source) : { ok: false, reason: "no live editor / target" };
  };
  const serve = createDevToolsServe({ store, scene, resolve: browserResolve, verifyDeep: browserVerifyDeep, conscience, qAgent, theme, liveEdit });
  if (typeof window !== "undefined") window.HoloDevToolsServe = serve;
  return serve;
}

// ── Tier 1 install: window.HoloDevToolsServe = the LIVE κ-CDP backend over a focused same-origin holospace ──
// This is the PURE-WEB real-F12 path: no native host, no extension. `target()` returns the live
// { doc, win, kappa } of the focused holospace iframe; the backend reflects its REAL DOM/CSSOM/eval and
// routes every edit through liveEdit so the holospace stays κ-addressed. The shell calls this from mountDev.
export function installLiveDevToolsServe({ target, edit = null, conscience = null, kappaFetchSource = null } = {}) {
  // the Network panel's κ-stream source (A4): the shared seam window.HoloDevToolsNet, into which any κ-fetch
  // site (streamHolo/openHoloFiles/the SW κ-gate) emits one note(); the backend subscribes on Network.enable.
  const tap = kappaFetchSource || (typeof window !== "undefined"
    ? (window.HoloDevToolsNet || (window.HoloDevToolsNet = createKappaFetchTap()))
    : createKappaFetchTap());
  const liveEdit = edit || ((kappa, source) => {
    const LE = (typeof window !== "undefined") ? window.HoloLiveEdit : null;
    const r = (LE && LE.edit) ? LE.edit(kappa || (typeof window !== "undefined" && window.HoloDevToolsTarget), source) : { ok: false, reason: "no live editor" };
    // a DevTools-driven re-seal IS a κ-write — surface it in the Network timeline (verified by construction).
    try { const k = r && (r.kappa || (r.ok && r.id)); if (k) tap.note({ kappa: k, axis: "sha256", bytes: (source && source.length) || 0, cacheHit: false, verified: r.ok !== false, provenance: kappa ? [kappa] : [] }); } catch (e) {}
    return r;
  });
  const serve = createLiveDevToolsServe({ target, edit: liveEdit, conscience, kappaFetchSource: tap });
  if (typeof window !== "undefined") window.HoloDevToolsServe = serve;
  return serve;
}

// ── live-desktop projection (browser): seal whatever the compositor holds into inspectable objects ──
// Defensive: reads the shell's existing globals if present, projects an empty scene otherwise. The shell
// can re-feed the live scene on focus change via window.HoloDevTools.setScene (no coupling required here).
function projectLiveDesktop() {
  try {
    const W = window;
    const world = (W.HoloShell && W.HoloShell.world) || [];                 // placed κ-nodes, if exposed
    const placements = (world || []).filter((n) => n && n.k).map((n) => ({ k: n.k, x: n.x, y: n.y, w: n.w, h: n.h }));
    const objects = (world || []).filter((o) => o && o.id && o["@context"]); // already-sealed UOR objects
    return { objects, placements };
  } catch (e) { return { objects: [], placements: [] }; }
}

// ── auto-install in the live shell only (guarded so Node import for the witness is side-effect-free) ──
if (typeof window !== "undefined" && typeof document !== "undefined") {
  const { objects, placements } = projectLiveDesktop();
  const serve = installDevToolsServe({ objects, placements });
  // the κ-LENS surface (A6): the robust, faithful way to inspect+control EVERY κ-object of a holo-app from the
  // REAL Console (the surface the Claude extension drives) — and the contract holo-kappa-panel.html reads via
  // inspectedWindow.eval. of(build)→the κ-object tree; inspect(κ,store) re-derives + REFUSES tamper (L5); the
  // surface a build calls expose(build) on, which sets window.__holoLens so any inspector (Console, the native
  // κ panel under a WebView2 host, the Claude extension) can read it. No front_end edit.
  window.HoloLens = {
    of: lensFor,
    inspect: inspectKappa,
    expose: (build) => { try { window.__holoLens = () => lensFor(build); } catch (e) {} return window.__holoLens; },
  };
  window.HoloDevTools = {
    install: installDevToolsServe,
    installLive: installLiveDevToolsServe,   // Tier 1: real F12 over the live same-origin holospace (pure web)
    setScene: (placements, objects) => { const s = buildStore(objects || []); serve.backend.setScene(buildScene(placements || [])); return s; },
    // open the vendored DevTools UI as a holospace. ?ws=holo-bridge engages the fake-WebSocket bridge so the
    // real Chrome panels paint over the κ backend (standalone ⇒ a local κ-scene; defensive launcher).
    open: () => { try { (window.HoloLaunch && window.HoloLaunch.mount ? window.HoloLaunch.mount : (window.holoOpen || function () {}))("/_shared/devtools/holo-devtools.html?ws=holo-bridge"); } catch (e) {} },
  };
}

export default { installDevToolsServe, buildStore, buildScene, browserResolve, browserVerifyDeep };
