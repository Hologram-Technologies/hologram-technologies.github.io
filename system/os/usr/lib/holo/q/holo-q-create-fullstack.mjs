// holo-q-create-fullstack.mjs — the ONE shell-facing entry that turns a Create build into a sealed, conformant
// holo-apps app addressed by a single κ (the manifest κ = the app's identity). Two paths:
//   • sealBuiltApp(html)        — wrap the coder's already-built HTML as a UI holo-app (the compat path the shell
//                                 uses today: every build becomes a sealed, shareable, verifiable holo-app κ).
//   • buildFullStackApp(intent) — the full A–H pipeline (UI + data + auth + REST/MCP) when the coder emits a
//                                 typed spec (the reliable, full-stack path).
// Both return { manifestK, share, api, sealed } — the app is on-brand (conscience-enforced), opens+verifies in
// any browser (SEC-1/L5), and is shared by its κ. Pure → Node-witnessed; the shell calls it at build/publish.

import { enforce } from "./holo-q-design-conscience.mjs";
import * as dag from "./holo-q-app-dag.mjs";
import { sealApp, openApp, shareLink } from "./holo-q-app-seal.mjs";
import { deriveApi } from "./holo-q-app-api.mjs";
import { PLATFORM_KINDS } from "./holo-q-app-spec.mjs";
import { buildFullStackApp } from "./holo-q-app-agent.mjs";
import { makePlan } from "./holo-q-spec-coder.mjs";
import { jcs, didHolo } from "../holo-uor.mjs";
import { blake3hex } from "../holo-blake3.mjs";   // the ONE canonical κ hash (§1.2)
const k3 = (s) => blake3hex(new TextEncoder().encode(String(s)));   // mint κ over a string

// buildFromIntent — the FULL-STACK path for the live shell: the coder emits a TYPED SPEC (reliable on a weak
// model), which compiles to a beautiful UI + data/auth + REST/MCP, self-tested + sealed to a κ. `generate` is the
// shell's codegen sampler. A garbled model reply → a valid default app (never broken). → { app, sealed, manifestK, … }
export async function buildFromIntent(intent, { generate, pricing = {}, history = [], maxTokens = 1200 } = {}) {
  const r = await buildFullStackApp(intent, { plan: makePlan(generate, { maxTokens }), pricing, history });
  return Object.assign({}, r, { share: shareLink(r.manifestK), projectionHtml: r.app && r.app.projectionHtml });
}

// wrap an already-built HTML projection as a conformant holo-apps app (UI-only: no collections, empty caps).
export function sealBuiltApp(html, { name = "App", pricing = {} } = {}) {
  const projectionHtml = enforce(String(html == null ? "" : html)).html;     // beautiful by construction
  const projectionK = k3(projectionHtml);
  const projectionDAG = dag.decompose(projectionHtml);                       // every element addressable (S2)
  const reducer = { format: "holo-reducer/1", platform: "uniform", kinds: {} };
  const reducerK = k3(jcs(reducer));
  const manifest = { format: "holo-app/1", name, reducer: reducerK, projection: projectionK, kinds: { platform: PLATFORM_KINDS.slice(), app: [] }, capabilities: [], identity: "open" };
  const manifestK = k3(jcs(manifest));
  const compiled = { manifestK, manifest, projectionK, projectionHtml, projectionDAG, reducerK, reducer, collections: [], capabilities: [] };
  const sealed = sealApp(compiled);
  return { manifestK, kid: didHolo("blake3", manifestK), compiled, sealed, api: deriveApi(manifest, { pricing }), share: shareLink(manifestK) };
}

export { buildFullStackApp, openApp, shareLink };
export default { sealBuiltApp, buildFromIntent, buildFullStackApp, openApp, shareLink };
