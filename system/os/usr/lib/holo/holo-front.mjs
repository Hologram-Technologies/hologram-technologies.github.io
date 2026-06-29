// holo-front.mjs — STEP A: the ONE front door. An app is a THIN view over a Hologram node: the user signs in
// (Agent), everything an app shows is a Perspective query, everything it creates is a link(), and the Pocket
// moves κ-WALs between apps. The front door holds NO app-private state — an app that declares a private store
// is refused at mount (appConforms, Law: apps share ONLY through Perspectives). apps/web and the OS shell bind
// to this, so the whole system presents as three nouns: an Agent acts on κ inside a Holospace, through one door.

import { makeNode } from "./holo-node.mjs";
import { makePocket, appConforms } from "./holo-pocket.mjs";
import { makeHoloWeb } from "./holo-ad4m-boot.mjs";

export function makeFront({ signer = null, now = () => "1970-01-01T00:00:00Z", web: webOpts = {} } = {}) {
  const store = new Map();                                  // ONE κ-store shared by the node, the pocket, and Flux
  const node = makeNode({ signer, now, store });
  const pocket = makePocket(node);
  // VERB-PARITY with the Flux surface: compose makeHoloWeb over the SAME store, so the 8 Flux verbs
  // (me/spaces/open/post/search/invite/people/onChange) and the Pocket operate on one κ-store — a Flux post
  // is grabbable by the Pocket, and a Pocket κ resolves in Flux. apps/web binds to ONE door (this), not two.
  const web = makeHoloWeb({ signer, store, now, ...webOpts });
  const mounted = new Map();   // appName → { app, perspective, view, put } — NO app bytes, only a node handle

  // mount(app) — app declares { name, perspectives:[...], produces:[...], consumes:[...] }. Refused if it
  // carries a private store (appConforms). On mount it gets a handle whose ONLY surface is view()=query and
  // put()=link — the front door stores nothing itself; the Perspective (the node) is the single source of truth.
  function mount(app, { backend = null, ruleset, isMember } = {}) {
    const c = appConforms(app);
    if (!c.ok) return { ok: false, why: c.why };
    const perspective = node.perspectives.create({ backend, ruleset, isMember });
    const handle = {
      perspective,
      view: (q = {}) => perspective.query(q),                 // render = a Perspective query (no private copy)
      put: (s, p, o) => perspective.link(s, p, o),            // create = a κ-Link
      receive: (e) => perspective.receive(e),                 // validating-peer path (integrity-free, warrants)
      neighbourhood: perspective.neighbourhood,
    };
    mounted.set(app.name, { app, ...handle });
    return { ok: true, app: app.name, handle };
  }

  return {
    node, pocket, web, mount,
    app: (name) => mounted.get(name) || null,
    mountedApps: () => [...mounted.keys()],
    me: () => node.agent.me(),
  };
}

// NEVER clobber a live instance (boot wires window.HoloFront = the front instance with bound verbs); a later
// or re-ordered import of this module must keep that instance, not replace it with the bare factory.
if (typeof window !== "undefined") window.HoloFront = window.HoloFront || { makeFront };
export default { makeFront };
