// holo-home-apps.mjs — APPS, the Home pillar. CasaOS's one-click Docker app store, reframed: there is no
// "install" — a pinned app is a κ-ref in the manifest, and "open" is a projection. One tile UI, but the
// renderer picks HOW to open by the app's class:
//   kappa  → project a κ app/object (κ-cache front-runs the network)
//   web    → open a web app (live page, κ-cached after first touch)
//   alpine → boot a full-system Linux app in the tab (Docker-ecosystem long tail; host-gated)
//   ext    → install a Chrome extension as a κ-object
// And a TRUST flag: a pin is trusted only if it's in the SIGNED catalog or is a content κ (self-verifying).
// A bare unknown app-id is surfaced as untrusted (catalog divergence), never silently opened.
//
// Anchored on: holo-home (the app pins, projected) + holo-bar (buildBarModel — the catalog join for
// display) + holo-open (classifyOpen — is this ref a self-verifying content κ?). No new catalog, no new
// store: the Apps section is the manifest's pins joined to the existing signed catalog.

import { buildBarModel } from "./holo-bar.mjs";
import { classifyOpen } from "./holo-open.mjs";

// app class → open strategy the surface must use. Unknown class falls back to a κ projection.
const STRATEGY = Object.freeze({ kappa: "project", web: "web", alpine: "boot", ext: "install" });
export function appOpenStrategy(appClass) { return STRATEGY[appClass] || "project"; }

// appsModel(home, catalog) → { ok, apps } — the Apps section. Each pinned app is joined to the catalog for
// its display name/icon (via holo-bar), then decorated with its class, the open strategy, and `trusted`.
// Fail-closed: a broken manifest yields no apps.
export async function appsModel(home, catalog = []) {
  const h = await home.project();
  if (!h.ok) return { ok: false, why: h.why, brokeAt: h.brokeAt ?? null };

  const classByRef = new Map(h.apps.map((a) => [a.ref, a.class]));
  const items = h.apps.map((a) => ({ ref: a.ref, kind: a.class === "ext" ? "ext" : "app" }));
  const rows = buildBarModel(items, { catalog });

  const cat = Array.isArray(catalog) ? catalog : [];
  const inCatalog = new Set();
  for (const c of cat) { if (c && c.did) inCatalog.add(c.did); if (c && c.id) { inCatalog.add(c.id); inCatalog.add("holo://" + c.id); } }

  const apps = rows.map((r) => {
    const cls = classByRef.get(r.ref) || "kappa";
    const isKappa = classifyOpen(r.ref).kind === "kappa";          // a content address verifies itself
    const known = inCatalog.has(r.ref);                            // present in the signed catalog
    return { ref: r.ref, label: r.label, icon: r.icon, class: cls, strategy: appOpenStrategy(cls), trusted: known || isKappa };
  });
  return { ok: true, apps };
}

export default { appOpenStrategy, appsModel };
