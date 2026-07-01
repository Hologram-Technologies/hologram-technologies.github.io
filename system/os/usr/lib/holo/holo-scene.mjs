// holo-scene.mjs — the GENERAL composed-holospace manifest (ADR-0089). The desktop (ADR-0088) was the
// first instance; this generalizes it so ANY composed holospace — an app that arranges several
// κ-objects, a multi-pane experience, a dashboard — declares its own scene the SAME way and inherits
// the five verbs (render · link · remix · share · provenance) over its live state, not just its source.
//
// A scene is one small canonical manifest that REFERENCES, never serializes:
//   • @type      : the scene kind (e.g. "holo:HomeScene", "holo:AppScene") — part of identity,
//   • background : an opaque κ-ref (a cosmos SEED, an image κ, a color, or null) — re-derives, not pixels,
//   • objects[]  : each placed κ-object as { k, x, y, w, h, z?, state? } — a ref + layout + a DEFINED
//                  minimal round-trip state (named per object kind, not "whatever the DOM holds"),
//   • props      : a generic config bag of κs (dock, theme, grid, …).
//
// The manifest IS the scene κ. render(manifest) ⇄ serializeWorld(live) are INVERSE (the Atlas
// isomorphism) — the running scene and its κ are one object, two views, so an app can round-trip its
// LIVE STATE to a κ (the discipline that pulls runtime across the re-derivable line). remix → a child κ
// linked prov:wasDerivedFrom (Holo Prov, ADR-0082). Re-derivable (Law L5): same scene → same κ. Pure +
// dependency-free (Web Crypto for the address); the browser and the Node witness run identical logic.

// ── canonicalization + address (RFC 8785 JCS subset · sorted keys) ───────────────────────────────
export function canon(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
}
async function sha256hex(str) {
  const c = (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.subtle) || null;
  if (c) { const h = await c.digest("SHA-256", new TextEncoder().encode(str)); return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
  let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return ("00000000" + (h >>> 0).toString(16)).slice(-8);
}

// the CONTENT fields that define the scene's identity — provenance/id are metadata, NOT addressed, so
// the same composed scene re-derives to the same κ regardless of lineage.
const CONTENT = ["@type", "background", "objects", "props"];
function content(m) { const out = {}; for (const k of CONTENT) if (m[k] !== undefined && m[k] !== null) out[k] = m[k]; return out; }

// ── the manifest (normalized, canonical) ─────────────────────────────────────────────────────────
// objects sorted by (k,x,y,z) → the κ is a pure function of the SET of placed objects + layout,
// independent of mount/insertion order.
export function scene({ type = "holo:Scene", background = null, objects = [], props = null } = {}) {
  const m = { "@type": type };
  if (background !== null && background !== undefined) m.background = background;
  m.objects = (objects || []).map((o) => {
    const e = { k: o.k, x: o.x | 0, y: o.y | 0, w: o.w | 0, h: o.h | 0 };
    if (o.z !== undefined) e.z = o.z | 0;
    if (o.state !== undefined) e.state = o.state;
    return e;
  }).sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : (a.x - b.x) || (a.y - b.y) || ((a.z | 0) - (b.z | 0))));
  if (props && Object.keys(props).length) m.props = props;
  return m;
}

import { blake3hex } from "./holo-blake3.mjs";                          // the ONE canonical κ hash (§1.2)
const b3str = (s) => blake3hex(new TextEncoder().encode(s));            // BLAKE3 hex of a string

// sceneKappa(manifest) → did:holo:blake3:… over the CONTENT (kind ⊕ background ⊕ objects ⊕ props). Same
// composed scene → same κ on every device. Works on ANY scene manifest (home, app, experience). Canonical
// BLAKE3 by default; the local sha256hex remains as the legacy dual-read reader a caller can inject.
export async function sceneKappa(manifest, hash) {
  const h = hash || b3str;
  return "did:holo:blake3:" + (await h(canon(content(manifest))));
}

// ── serialize a LIVE composed holospace → manifest (pure given the readers) ──────────────────────
export function serializeWorld({ type = "holo:Scene", background = null, objectNodes = [], readObject, props = null } = {}) {
  const objects = (objectNodes || []).map((n) => (readObject ? readObject(n) : null)).filter((o) => o && o.k);
  return scene({ type, background, objects, props });
}

// ── render a manifest → instantiate the live scene (pure controller; hooks injected) ─────────────
// Same manifest → same ordered hook-calls (re-derivable). The browser passes real
// setBackground/mountObject/applyProps (over holo-cosmos/holo-render); the witness passes recorders.
export function render(manifest, { setBackground, mountObject, applyProps } = {}) {
  const calls = [];
  if (manifest.background !== undefined && manifest.background !== null) { if (setBackground) setBackground(manifest.background); calls.push({ op: "background", background: manifest.background }); }
  for (const o of manifest.objects || []) { if (mountObject) mountObject(o); calls.push({ op: "object", k: o.k, x: o.x, y: o.y, w: o.w, h: o.h, ...(o.z !== undefined ? { z: o.z } : {}) }); }
  if (manifest.props) { if (applyProps) applyProps(manifest.props); calls.push({ op: "props", props: manifest.props }); }
  return { rendered: true, calls };
}

// ── remix → a child manifest linked to its parent (Holo Prov, ADR-0082) ───────────────────────────
// `edit(content) → content` is a pure transform; the child carries prov:wasDerivedFrom the parent κ
// (lineage, not part of the scene address).
export async function remix(parent, edit, opts = {}) {
  const parentK = opts.parentKappa || (await sceneKappa(parent));
  const edited = edit ? edit(structuredClone(content(parent))) : content(parent);
  const child = scene({ type: edited["@type"] || parent["@type"], background: edited.background, objects: edited.objects, props: edited.props });
  const childK = await sceneKappa(child);
  return { manifest: { ...child, "prov:wasDerivedFrom": parentK }, kappa: childK, parent: parentK };
}

// edit helpers (each: content → content) ─────────────────────────────────────────────────────────
export const addObject = (o) => (c) => ({ ...c, objects: [...(c.objects || []), o] });
export const removeObject = (k) => (c) => ({ ...c, objects: (c.objects || []).filter((o) => o.k !== k) });
export const moveObject = (k, x, y) => (c) => ({ ...c, objects: (c.objects || []).map((o) => (o.k === k ? { ...o, x, y } : o)) });
export const setBackground = (background) => (c) => ({ ...c, background });
export const setProp = (key, val) => (c) => ({ ...c, props: { ...(c.props || {}), [key]: val } });

// walkLineage(manifest, resolve) → the wasDerivedFrom chain (newest→genesis). resolve(κ) → manifest|null.
export async function walkLineage(manifest, resolve) {
  const chain = []; let cur = manifest, guard = 0;
  while (cur && guard++ < 4096) {
    chain.push(await sceneKappa(cur));
    const parent = cur["prov:wasDerivedFrom"]; if (!parent) break;
    cur = resolve ? await resolve(parent) : null;
    if (!cur) { chain.push(parent + " (horizon)"); break; }
  }
  return chain;
}

// defineScene({ type, background?, props? }) → a factory for ONE scene kind, so a composed app declares
// its kind once and builds manifests ergonomically: const AppScene = defineScene({type:"holo:AppScene"}).
export function defineScene(spec = {}) {
  const f = (args = {}) => scene({ type: spec.type || "holo:Scene", background: args.background !== undefined ? args.background : spec.background, objects: args.objects, props: { ...(spec.props || {}), ...(args.props || {}) } });
  f.type = spec.type || "holo:Scene";
  f.serialize = (args = {}) => serializeWorld({ type: f.type, ...args });
  return f;
}

export function describeScene() {
  return {
    is: "the GENERAL composed-holospace manifest — any app/experience that arranges κ-objects is one κ with render·link·remix·share·provenance",
    isomorphism: "render(manifest) ⇄ serializeWorld(live) are inverse — an app can round-trip its LIVE STATE to a κ (runtime made re-derivable)",
    rederive: "same composed scene → same κ on every device (Law L5); the desktop (ADR-0088) is the first specialization",
    honest: "background is a ref/seed not pixels; objects carry refs + layout + a DEFINED minimal state, not arbitrary live DOM",
  };
}

export default { canon, scene, sceneKappa, serializeWorld, render, remix, addObject, removeObject, moveObject, setBackground, setProp, walkLineage, defineScene, describeScene };
