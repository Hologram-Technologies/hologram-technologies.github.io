// holo-home-front.mjs — THE FRONT DOOR, headless. Turns the personal-cloud manifest (holo-home) into a
// render-ready view-model and routes every open through THE one open path (holo-open). The shell's DOM
// layer consumes this; all the logic that must be correct (what shows, how it opens) lives here, node-
// witnessable, so the surface stays a thin painter. This is the CasaOS dashboard reframed: the home
// screen is a PROJECTION of one owned κ, and "tap → it plays" is the same single seam everywhere.
//
// Two guarantees this module exists to hold:
//   1. The front door shows EXACTLY the manifest-listed items — nothing fabricated, nothing leaked, and
//      a broken chain shows NOTHING (fail-closed, never a partial/drifted Home).
//   2. Every item opens through holo-open's makeOpen — files, apps, spaces all route the one way. No
//      surface ever invents its own opener.
//
// Anchored on: holo-home (project) + holo-open (classifyOpen / makeOpen). No new state, no new opener.

import { classifyOpen, idOf } from "./holo-open.mjs";

// the visible sections, in order. Plain words only — Ask is a panel, devices live in settings.
export const FRONT_SECTIONS = Object.freeze([
  { id: "files", title: "Files" },
  { id: "apps", title: "Apps" },
  { id: "spaces", title: "Spaces" },
]);
export const ASK_TITLE = "Ask";

const shortRef = (ref) => { const id = idOf(ref); return id.length > 14 ? id.slice(0, 6) + "…" + id.slice(-4) : id; };

// homeView(home) → a render-ready view-model from the PROJECTED Home. Fail-closed: a broken chain yields
// { ok:false } and no items, so a tampered/drifted manifest can never paint a partial front door.
export async function homeView(home) {
  const h = await home.project();
  if (!h.ok) return { ok: false, why: h.why, brokeAt: h.brokeAt ?? null };
  const item = (ref, label, extra = {}) => ({ ref, label, kind: classifyOpen(ref).kind, ...extra });
  return {
    ok: true,
    head: h.head,
    title: h.meta.title || "Home",
    sections: [
      { id: "files",  title: "Files",  items: h.files.map((f) => item(f.ref, f.name, { parent: f.parent ?? null })) },
      { id: "apps",   title: "Apps",   items: h.apps.map((a) => item(a.ref, a.label || shortRef(a.ref), { appClass: a.class })) },
      { id: "spaces", title: "Spaces", items: h.spaces.map((s) => item(s.ref, s.name)) },
    ],
    ask: { title: ASK_TITLE, context: h.ask.context.slice() },
  };
}

// openHomeItem(item, open) → route a Home item through THE one open path. `open` is holo-open's
// makeOpen({space, app, fallback}) result. A missing/empty ref never opens. This is the ONLY way the
// front door opens anything — the surface passes the user's tap straight here.
export async function openHomeItem(item, open) {
  if (!item || !item.ref) return null;
  if (typeof open !== "function") return null;
  return await open(item.ref);
}

export default { FRONT_SECTIONS, ASK_TITLE, homeView, openHomeItem };
