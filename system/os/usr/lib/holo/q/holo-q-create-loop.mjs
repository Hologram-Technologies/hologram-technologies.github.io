// holo-q-create-loop.mjs — the Create loop (S5): the user's only input is intent, and it all converges. A build,
// an edit-by-prompt, an edit-by-gesture, and a dropped screenshot ALL flow through Q's intent→prompt synthesis
// onto the app's κ-DAG; every result is enforced beautiful (S4), addressed by κ (S2), and felt-SOVEREIGN — share
// the app OR any element by its κ, fork it (immutable, copy-on-write by construction), and a shared app re-derives
// + verifies before it opens (L5, never trusted). Pure orchestration — the model fns (build/vision/generate) are
// injected, so the loop + the sovereign-share grain are Node-witnessed end-to-end on the real modules.
//
//   buildApp({ intent, screenshot?, build, generate?, vision? }) -> { root, store, prompt, source }
//   editApp({ root, store, path, intent?|gesture?, build?, generate? }) -> { root, store, via }
//   shareLink(κ) / parseShareLink(link) / resolveShared(link, store) / fork(root, store) / shareElement

import * as dag from "./holo-q-app-dag.mjs";
import * as canvas from "./holo-q-canvas-edit.mjs";
import { synthesizePrompt } from "./holo-q-prompt-synth.mjs";
import { enforce } from "./holo-q-design-conscience.mjs";

// build an app from intent — or seed it from a screenshot via the vision faculty (verify-before-use: only adopt
// a real description). Q writes its own build prompt (validated synth); the model builds; the conscience makes
// it beautiful; decompose gives the κ-DAG.
export async function buildApp({ intent = "", screenshot = null, build, generate = null, vision = null } = {}) {
  if (typeof build !== "function") throw new Error("buildApp needs a build(prompt)->html");
  let seed = intent, seededBy = "intent";
  if (screenshot != null && typeof vision === "function") {
    let described = null; try { described = await vision(screenshot); } catch (e) {}
    if (described && String(described).trim().length > 2) { seed = String(described).trim(); seededBy = "screenshot"; }   // else fall back to intent
  }
  const synth = await synthesizePrompt(seed, { faculty: "create", generate });
  const html = enforce(String((await build(synth.rendered)) || "")).html;
  const { root, store } = dag.decompose(html);
  return { root, store, prompt: synth.rendered, source: synth.source, seededBy };
}

// edit one element — by GESTURE (direct manipulation) or by INTENT (a prompt). Both land on editAtPath; an intent
// edit has Q synth the change and the model build the new element, conscience-enforced as a fragment.
export async function editApp({ root, store, path, intent = null, gesture = null, build = null, generate = null } = {}) {
  if (typeof gesture === "function") { const r = canvas.applyGesture(root, store, path, gesture); return { root: r.root, store, via: "touch", edited: r.edited }; }
  if (intent == null) throw new Error("editApp needs an intent or a gesture");
  if (typeof build !== "function") throw new Error("editApp by intent needs a build(prompt)->html");
  const synth = await synthesizePrompt(intent, { faculty: "create", generate });
  const elHtml = enforce(String((await build(synth.rendered)) || ""), { fragment: true }).html;   // element-level: no doc token-root
  const r = dag.editAtPath(root, store, path, elHtml);
  return { root: r.root, store, via: "prompt", edited: r.edited };
}

// ── sovereignty: share by κ, fork immutably, resolve verified ─────────────────────────────────────────────
const PREFIX = "holo://blake3/";                                          // canonical (new links are BLAKE3, §1.2)
const LEGACY_PREFIX = "holo://sha256/";                                   // still parsed so old links keep resolving (transition)
export const shareLink = (k) => PREFIX + String(k);                       // a content-addressed, serverless-resolvable link
export const shareElement = (k) => PREFIX + String(k);                    // an element is shareable exactly like the app
export const parseShareLink = (link) => {
  const s = String(link || "");
  if (s.startsWith(PREFIX)) return s.slice(PREFIX.length);
  if (s.startsWith(LEGACY_PREFIX)) return s.slice(LEGACY_PREFIX.length);
  return /^[0-9a-f]{64}$/.test(s) ? s : null;
};

// resolve a shared κ from a store, RE-DERIVING every node first (L5) — a tampered store is REFUSED, not trusted.
export function resolveShared(link, store) {
  const k = parseShareLink(link);
  if (!k || !store[k]) throw new Error("share link not resolvable: " + link);
  const v = dag.verify(store);
  if (!v.ok) throw new Error("L5 REFUSE: " + v.bad.length + " tampered node(s) in the shared store");
  return dag.recompose(k, store);
}

// fork: you own it now. Immutable + content-addressed ⇒ forking is free and copy-on-write BY CONSTRUCTION —
// edits from this root mint new κ; the origin root κ never changes and still resolves to the original bytes.
export function fork(root, store) { return { root, store, origin: root }; }

export { dag, canvas };
export default { buildApp, editApp, shareLink, shareElement, parseShareLink, resolveShared, fork };
