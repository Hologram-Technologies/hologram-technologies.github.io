// holo-renderable.mjs — makeRenderable: a UOR object that DECLARES how a browser instantiates it (S1). The
// render-contract vocab + read-side dispatch live in the dependency-free holo-render-contract.mjs (SW-safe);
// the seal/build step needs the substrate (makeObject), so makeRenderable lives here, separate from the
// canonical isomorphic holo-object (usr/lib/holo). The render context is appended ONLY to renderable objects,
// so a non-renderable object's address stays byte-stable (Laws L1/L2 — no global churn).

import { makeObject } from "../usr/lib/holo/holo-object.mjs";   // the one isomorphic substrate
import { RENDER_CONTEXT, renderContract } from "./holo-render-contract.mjs";

// makeRenderable(store, {render, ...}) — `render` may be a built contract or the plain {kind,contentType,entry}.
export function makeRenderable(store, { type, context = [], links = [], render, ...props }) {
  const contract = render && render["@type"] === "holo:RenderContract" ? render : renderContract(render || {});
  return makeObject(store, { type, context: [RENDER_CONTEXT, ...context], links, render: contract, ...props });
}
