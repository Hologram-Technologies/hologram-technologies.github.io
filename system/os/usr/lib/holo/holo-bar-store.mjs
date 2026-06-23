// holo-bar-store.mjs — where a bar's ordering lives. The bar BYTES are content-addressed (holo-bar.barKappa);
// this keeps the user's current ordering + its κ pointer. The backend is pluggable (default localStorage); the
// shell can pass the encrypted profile store instead. defaultBookmarks seeds from the app catalog so a new
// user opens to a populated bar, never a blank one.

import { barKappa } from "./holo-bar.mjs";

const KEY = (kind) => "holo.bar." + kind;          // pointer key, per bar kind

const memBackend = () => { const m = new Map(); return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v) }; };
function lsBackend() {
  try { if (typeof localStorage !== "undefined") return { get: (k) => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v) }; } catch (e) {}
  return memBackend();
}

// loadBar(kind, { backend, seed, digest }) → { items, kappa }. Falls back to seed() (then persists it) when
// the store is empty. kappa is computed only when a digest fn is supplied.
export async function loadBar(kind, { backend = lsBackend(), seed = null, digest = null } = {}) {
  let items = [];
  try { const raw = backend.get(KEY(kind)); if (raw) items = JSON.parse(raw); } catch (e) {}
  if ((!Array.isArray(items) || !items.length) && typeof seed === "function") {
    try { items = seed() || []; } catch (e) { items = []; }
    try { backend.set(KEY(kind), JSON.stringify(items)); } catch (e) {}
  }
  const list = Array.isArray(items) ? items : [];
  return { items: list, kappa: digest ? await barKappa(list, digest) : null };
}

// saveBar(kind, items, { backend, digest }) → { items, kappa }. Persists the ordering and mints the new bar κ
// (identity follows bytes).
export async function saveBar(kind, items, { backend = lsBackend(), digest = null } = {}) {
  const list = Array.isArray(items) ? items : [];
  try { backend.set(KEY(kind), JSON.stringify(list)); } catch (e) {}
  return { items: list, kappa: digest ? await barKappa(list, digest) : null };
}

// defaultBookmarks(catalog, { pick, limit, topUp }) → seed items. ref = the app's content κ (identity); label
// / words / icon are display projections. `pick` features specific app ids/names first; otherwise the first
// `limit`. `topUp` (when > current count) backfills from the catalog so a thin pick still yields a full bar.
export function defaultBookmarks(catalog = [], { pick = null, limit = 12, topUp = 0 } = {}) {
  const items = []; const seen = new Set();
  const take = (a) => { if (a && a.id && !seen.has(a.id)) { seen.add(a.id); items.push({ ref: a.did || ("holo://" + a.id), label: a.name || a.id, words: a.words || "", icon: a.icon || "", open: "" }); } };
  if (Array.isArray(pick)) { for (const key of pick) take((catalog || []).find((x) => x && (x.id === key || x.name === key))); }
  else { for (const a of (catalog || []).slice(0, limit)) take(a); }
  if (topUp && items.length < topUp) { for (const a of (catalog || [])) { if (items.length >= topUp) break; take(a); } }
  return items;
}

if (typeof window !== "undefined") window.HoloBarStore = { loadBar, saveBar, defaultBookmarks };
export default { loadBar, saveBar, defaultBookmarks };
