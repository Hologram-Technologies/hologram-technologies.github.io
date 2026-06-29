// holo-pocket.mjs — STEP 3: apps share ONLY through Perspectives. The κ-WAL (universal asset locator = a κ +
// render hint) and the ONE Pocket (the system clipboard). "Grab any asset, drop it anywhere" is a single
// path; cross-app composition is just a κ-Link with a predicate (…/embeds, …/attaches) — zero copy, no new
// machinery. This is the seam Share / Pluck / +ingest / κ-Open fold onto. An asset IS a κ; the Pocket moves
// LOCATORS, never bytes. Holospace-independent: the same κ-WAL resolves wherever the asset κ is available.

export const EMBEDS = "holo:embeds";       // subject …/embeds  asset   (render inline, cross-app)
export const ATTACHES = "holo:attaches";   // subject …/attaches asset   (reference, cross-app)

// a κ-WAL: { kappa, hint } — the universal pointer to any asset in any app. hint is an optional render tag.
export const wal = (kappa, hint = null) => ({ kappa: String(kappa), hint: hint || null });
export const isWal = (w) => !!(w && typeof w.kappa === "string" && w.kappa.startsWith("did:holo:"));

// makePocket(node) — one clipboard over a Hologram node. grab/peek/drop hold κ-WALs; resolve re-verifies the
// asset on read (Law L5); embed/attach write a cross-app κ-Link into a Perspective (the link target IS the κ).
export function makePocket(node) {
  if (!node || !node.languages) throw new Error("a Pocket needs a node");
  let held = [];
  const grab = (w) => { if (!isWal(w)) throw new Error("grab needs a κ-WAL"); held.unshift(w); return w; };
  const peek = () => held.slice();
  const drop = () => held.shift() || null;
  const resolve = (w) => (isWal(w) ? node.languages.get(w.kappa) : null);   // → the asset κ, re-verified
  const embed = (perspective, subjectKappa, w) => perspective.link(subjectKappa, EMBEDS, w.kappa);
  const attach = (perspective, subjectKappa, w) => perspective.link(subjectKappa, ATTACHES, w.kappa);
  return { wal, isWal, grab, peek, drop, resolve, embed, attach, EMBEDS, ATTACHES };
}

// appConforms(app) — an app shares ONLY through Perspectives: it DECLARES the perspectives it uses and the
// asset types it produces/consumes, and holds NO private byte store of its own. A private store fails closed.
export function appConforms(app) {
  if (!app || !Array.isArray(app.perspectives) || app.perspectives.length === 0) return { ok: false, why: "no-perspectives-declared" };
  if (app.store || app.db || app.localData) return { ok: false, why: "private-store" };
  if (!Array.isArray(app.produces) || !Array.isArray(app.consumes)) return { ok: false, why: "no-asset-contract" };
  return { ok: true };
}

// NEVER clobber the live pocket instance (boot wires window.HoloPocket = front.pocket, with bound grab/drop/
// embed the UI uses); a re-import must keep that instance, not replace it with the factory (which has no grab).
if (typeof window !== "undefined") window.HoloPocket = window.HoloPocket || { makePocket, wal, isWal, appConforms, EMBEDS, ATTACHES };
export default { makePocket, wal, isWal, appConforms, EMBEDS, ATTACHES };
