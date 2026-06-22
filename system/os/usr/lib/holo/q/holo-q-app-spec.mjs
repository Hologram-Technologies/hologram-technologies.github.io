// holo-q-app-spec.mjs — Stage A: intent → a TYPED app spec → the holo-apps BUNDLE (manifest κ + reducer κ +
// projection κ + collections + capabilities), content-addressed. The coder fills a typed spec (components from
// the κ-library, typed fields, declared kinds), NOT free-form code — so a weak on-device model is reliable, and
// a malformed spec is REPAIRED into a valid app, never rendered as broken pseudo-code. The app's identity is the
// manifest κ (versions are distinct κs). Adheres to the holo-apps standard: app declares kinds + capabilities;
// platform kinds (genesis/membership/epoch/tombstone) are never app-authored; capabilities only over declared
// collections (attenuate-able, SEC-2). Pure + sync → Node-witnessed; the substrate hash addresses every piece.
//
//   validateSpec(spec) -> { spec(repaired), report, ok }
//   compileSpec(spec)  -> { manifestK, manifest, kid, projectionK, projectionHtml, projectionDAG, reducerK,
//                           reducer, collections, capabilities, report }

import { COMPONENTS, isComponent, CONTAINERS } from "./holo-q-components.mjs";
import { enforce } from "./holo-q-design-conscience.mjs";
import * as dag from "./holo-q-app-dag.mjs";
import { sha256hex, jcs, didHolo } from "../holo-uor.mjs";

export const PLATFORM_KINDS = ["genesis", "membership", "epoch", "tombstone"];   // interpreted uniformly; never app-authored (§2.9/§3)
export const CAP_OPS = ["read", "write", "admin"];
export const FIELD_TYPES = ["string", "number", "bool", "ref", "timestamp"];
const list = (v) => Array.isArray(v) ? v : (v == null ? [] : [v]);
const slug = (s, d) => String(s == null ? "" : s).replace(/[^a-z0-9_]/gi, "").slice(0, 40) || d;

// render a typed UI node tree to HTML using ONLY the κ-component library. An unknown type is REPAIRED (replaced
// by a safe, empty text node) and reported — never compiled into a broken app. This is the "just works" floor.
export function renderNode(node, report = []) {
  if (!node || typeof node !== "object") return "";
  const type = node.type;
  if (!isComponent(type)) { report.push({ fix: "unknown-component", was: type }); return COMPONENTS.text({ content: "", muted: true }); }
  const props = (node.props && typeof node.props === "object") ? node.props : {};
  let kids = "";
  if (CONTAINERS.has(type) && Array.isArray(node.children)) kids = node.children.map((c) => renderNode(c, report)).join("\n");
  try { return COMPONENTS[type](props, kids); } catch (e) { report.push({ fix: "render-error", type }); return ""; }
}

// typed-slot validation + repair → a SAFE spec that always compiles to a valid app.
export function validateSpec(spec) {
  const report = [];
  const s = (spec && typeof spec === "object") ? spec : {};
  const out = { name: String(s.name || "App").slice(0, 80) };
  out.ui = (s.ui && isComponent(s.ui.type)) ? s.ui : { type: "page", children: [{ type: "hero", props: { title: out.name } }] };
  if (!s.ui || !isComponent(s.ui && s.ui.type)) report.push({ fix: "ui-default" });
  out.collections = list(s.collections).map((c) => ({
    name: slug(c && c.name, "items"), kind: slug(c && c.kind, "item"),
    fields: list(c && c.fields).map((f) => ({ name: slug(f && f.name, "field"), type: FIELD_TYPES.includes(f && f.type) ? f.type : "string" })),
  }));
  const collNames = new Set(out.collections.map((c) => c.name));
  const appKinds = out.collections.map((c) => c.kind);
  out.capabilities = list(s.capabilities).map((cap) => {
    if (!cap || !collNames.has(cap.collection)) { report.push({ fix: "cap-dropped", was: cap && cap.collection }); return null; }   // only over DECLARED collections
    const ops = list(cap.ops).filter((o) => CAP_OPS.includes(o));
    return { collection: cap.collection, ops: ops.length ? ops : ["read"] };
  }).filter(Boolean);
  out.kinds = { platform: PLATFORM_KINDS.slice(), app: appKinds };       // app authors ONLY its app kinds
  out.identity = s.identity === "required" ? "required" : "open";        // "add logins" → required
  return { spec: out, report, ok: report.length === 0 };
}

// compile a (validated) spec into the content-addressed holo-apps bundle. manifest κ = the app's identity.
export function compileSpec(spec) {
  const { spec: v, report } = validateSpec(spec);
  const rep = [];
  const projectionHtml = enforce(`<!doctype html><html><head></head><body>${renderNode(v.ui, rep)}</body></html>`).html;   // beautiful by construction
  const projectionK = sha256hex(projectionHtml);                         // projection bundle κ
  const projectionDAG = dag.decompose(projectionHtml);                   // every element addressable (S2)
  const reducer = { format: "holo-reducer/1", platform: "uniform", kinds: v.kinds.app.reduce((m, k) => { m[k] = "append"; return m; }, {}) };   // deterministic, no IO/clock/random
  const reducerK = sha256hex(jcs(reducer));
  const collections = v.collections.map((c) => {
    const genesis = { kind: "genesis", reducer: reducerK, collection: c.name, recordKind: c.kind, fields: c.fields };
    return { ...c, genesis, genesisK: sha256hex(jcs(genesis)) };
  });
  const manifest = { format: "holo-app/1", name: v.name, reducer: reducerK, projection: projectionK, kinds: v.kinds, capabilities: v.capabilities, identity: v.identity };
  const manifestK = sha256hex(jcs(manifest));                            // app identity (CC-1/L1); upgrades = new κ
  return { manifestK, manifest, kid: didHolo("sha256", manifestK), projectionK, projectionHtml, projectionDAG, reducerK, reducer, collections, capabilities: v.capabilities, report: report.concat(rep) };
}

export default { validateSpec, compileSpec, renderNode, PLATFORM_KINDS, CAP_OPS, FIELD_TYPES };
