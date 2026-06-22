// holo-devtools-kappa-lens.mjs — Stage A6 of the κ-CDP DevTools (ADR-0095): the κ-LENS. Stock DevTools panels
// (Elements/Styles/Console/Network) cover the rendered web view; this exposes the SUBSTRATE objects underneath —
// EVERY κ a holo-app holds: its manifest (identity), reducer (logic), projection elements (UI), collections +
// records (data), membership/epoch (auth), capabilities (the bridge), and the derived REST/MCP surface
// (functions). Each is INSPECTABLE (read-through-κ: resolve + verifyDeep, a tampered block REFUSED/red — L5/
// SEC-1) and CONTROLLABLE through a GOVERNED action descriptor only — an element edit → editAtPath (new κ + prov),
// a data write → a PROPOSAL (§2.9, never autonomous), a capability → an attenuated grant (SEC-2). The DevTools
// Application/κ panel renders this. Pure + sync → Node-witnessed; mints nothing (returns existing κs).
//
//   lensFor(build) -> { manifestK, count, objects:[ {group, kappa, kid, kind, verified, content, control?} ] }
//   inspectKappa(kappa, store) -> { kappa, kid, verified, content }   // the panel's click handler (refuses tamper)

import { sha256hex, jcs, didHolo } from "../holo-uor.mjs";

function inspectBlock(kappa, bytes, kind) {
  const verified = bytes != null && sha256hex(bytes) === kappa;          // L5: re-derive against the κ
  let content = null;
  if (kind === "html" || kind === "raw") content = bytes;
  else { try { content = JSON.parse(bytes); } catch (e) { content = bytes; } }
  return { kappa, kid: kappa ? didHolo("sha256", kappa) : null, kind, verified, content };
}

// build = the result of buildFullStackApp/buildFromIntent (or { app, sealed, api }). Returns the κ-object tree.
export function lensFor(build = {}) {
  const app = build.app || build;
  const store = (build.sealed && build.sealed.store) || {};
  const api = build.api || {};
  const objects = [];
  const add = (o) => { objects.push(o); return o; };

  if (app.manifestK) add(Object.assign({ group: "manifest" }, inspectBlock(app.manifestK, store[app.manifestK] || (app.manifest && jcs(app.manifest)), "json"), { control: { kind: "version", note: "edit → a new manifest κ (versions immutable)" } }));
  if (app.reducerK) add(Object.assign({ group: "reducer" }, inspectBlock(app.reducerK, store[app.reducerK] || (app.reducer && jcs(app.reducer)), "json")));
  if (app.projectionDAG && app.projectionDAG.store)
    for (const [k, desc] of Object.entries(app.projectionDAG.store))
      add(Object.assign({ group: "projection" }, inspectBlock(k, jcs(desc), "json"), { control: { kind: "editAtPath", note: "edit → a new element κ + re-linked parent (prov)" } }));
  for (const c of (app.collections || []))
    add(Object.assign({ group: "collection", name: c.name, fields: c.fields }, inspectBlock(c.genesisK, c.genesis && jcs(c.genesis), "json"), { control: { kind: "propose", note: "a data write is a PROPOSAL the user authorizes (§2.9)" } }));
  for (const cap of (app.capabilities || []))
    add({ group: "capability", collection: cap.collection, ops: cap.ops, control: { kind: "grant", note: "attenuate-only (SEC-2)" } });
  for (const r of (api.routes || [])) add({ group: "rest", method: r.method, path: r.path, op: r.op, gated: !!r.gated, price: r.price || null });
  for (const t of (api.tools || [])) add({ group: "mcp", name: t.name, op: t.op });

  return { manifestK: app.manifestK || null, count: objects.length, objects };
}

// read-through-κ inspection: resolve a κ from the app's store, RE-DERIVING it — a tampered/missing block is
// REFUSED (the panel shows red), never trusted (SEC-1/L5/SEC-6).
export function inspectKappa(kappa, store) {
  const bytes = store ? store[kappa] : undefined;
  if (bytes == null) throw new Error("MISSING " + kappa);
  if (sha256hex(bytes) !== kappa) throw new Error("L5 REFUSE " + kappa);
  let content = null; try { content = JSON.parse(bytes); } catch (e) { content = bytes; }
  return { kappa, kid: didHolo("sha256", kappa), verified: true, content };
}

export default { lensFor, inspectKappa };
