// holo-launcher.mjs — HoloOpen: the ONE verb that opens any κ-object.
//
// Why: today an app, a Space, a payment each open a different way — five code paths, five ways to drift.
// How: everything is a κ, so one launcher resolves a ref and mounts it; a Space tiles its real members,
//      an app/URL runs in the one run-overlay. L5: where a content route serves the bytes, we re-derive
//      the κ before trusting them (SP.verifyBytes) — a liar is refused, never mounted.
// What: window.HoloOpen(ref) mounts the thing (honest-empty on failure). ref = a κ string, or
//       {kind, kappa, slug, url, members, name, glyph, accent}. The run surface + tiling live in HoloApps.

import * as SP from "../spaces/holo-spaces.mjs";   // proven κ-space model; ../spaces resolves in browser AND node

const stripAxis = (k) => String(k || "").replace(/^did:holo:\w+:/, "");

// L5: do these bytes re-derive to this κ? (used wherever a content gateway serves them)
export async function verifyKappa(bytes, kappa) { try { return await SP.verifyBytes(bytes, stripAxis(kappa)); } catch { return false; } }

// resolve a PUBLISHED Space κ over the content route (/.holo/<axis>/<hex>) → its composition, fail-closed.
export async function resolveSpace(kappa, { base = "", fetch } = {}) {
  try { return await SP.makeStore(SP.contentBackend({ base, fetch })).get(stripAxis(kappa)); } catch { return null; }
}

// THE launcher. Route by shape: a Space tiles members; an app/URL runs; a bare κ defers to the OS frame.
export function HoloOpen(ref) {
  const A = (typeof window !== "undefined") && window.HoloApps;
  if (!A) return false;
  const r = (typeof ref === "string") ? { kind: "app", kappa: ref } : (ref || {});
  const isSpace = r.kind === "space" || Array.isArray(r.members) || (typeof r.slug === "string" && r.slug.startsWith("space:"));
  if (isSpace) return A.openSpace(r);
  if (r.url || r.slug) return A.openApp(r);
  // a bare κ with no servable form → the OS frame mounts it by content route; absent → honest empty.
  try { if (window.parent && window.parent !== window && window.parent.HoloOpen) return window.parent.HoloOpen(r); } catch {}
  A.openApp({ name: r.name || "Not available here", glyph: "🚫", accent: "#e6462e", url: "about:blank" });
  return false;
}

export function installLauncher() {
  if (typeof window === "undefined") return false;
  window.HoloOpen = HoloOpen;
  window.HoloResolve = Object.assign(window.HoloResolve || {}, { verifyKappa, resolveSpace });
  return true;
}
try { installLauncher(); } catch {}
