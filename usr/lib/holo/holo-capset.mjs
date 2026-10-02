// holo-capset.mjs — HOLO-RESOLVER-IN-RUNTIME G0: the CapabilitySet + attenuation, the SEC-2 boundary.
//
// A holospace mounts under a CapabilitySet. The OS root holds everything; every nested mount holds a
// SUBSET (SEC-2 / Invariant A6: authority can only NARROW). This module is the PURE math — the schema
// `holospace.json` already authors ({storage, channels, permissions}), plus `fetch` (origin allowlist)
// and `budgets` (hints, not a sandbox) — and the one function the mount boundary calls:
//   attenuate(parent, childDeclared) → admits   (per-facet intersection, wildcards honoured)
// It is the SAME law _shared/holo-delegate.mjs enforces for identity delegation (capMatch: `*` and
// `<ns>:*` wildcards), lifted to return the ADMITTED SET (not just a yes/no) so the boundary can grant
// exactly what the parent allows and LOG what it dropped. Pure + isomorphic (SW + page + Node, Law L4):
// no imports, no platform calls — the whole point is that both sides re-derive the same admits (L5).

// the capability facets a mount is granted. Order-independent sets of string capabilities; a facet
// absent from a capset grants NOTHING for it (least authority), never everything.
export const FACETS = ["storage", "channels", "permissions", "fetch"];

// capMatch(held, want) — does a HELD capability cover a WANTED one? Exact, or a wildcard the holder owns:
// `*` covers all; `<ns>:*` covers the namespace `<ns>:` (and the bare `<ns>`). Same rule as holo-delegate.
export const capMatch = (held, want) =>
  held === want || held === "*" ||
  (typeof held === "string" && held.endsWith(":*") &&
    (want === held.slice(0, -2) || String(want).startsWith(held.slice(0, -1))));

// admitsFacet(held, want) → the subset of `want` the holder actually grants (order preserved from want).
const admitsFacet = (held = [], want = []) => want.filter((w) => held.some((h) => capMatch(h, w)));

// minBudgets(parent, child) → a child budget can never EXCEED the parent's (narrowing). Absent parent
// key ⇒ unbounded there (parent grants it); absent child key ⇒ inherits nothing (child asked nothing).
function minBudgets(parent = {}, child = {}) {
  const out = {};
  for (const k of Object.keys(child)) {
    const p = parent[k];
    out[k] = (typeof p === "number") ? Math.min(p, child[k]) : child[k];   // parent unbounded → child's own ask
  }
  return out;
}

// attenuate(parent, childDeclared) → admits — THE boundary function. `admits ⊆ parent` for every facet;
// a child that declares nothing gets nothing. Returns a fully-shaped capset (every FACET present as an
// array) so callers never branch on undefined.
export function attenuate(parent, childDeclared) {
  const p = parent || {}, c = childDeclared || {};
  const admits = {};
  for (const f of FACETS) admits[f] = admitsFacet(p[f] || [], c[f] || []);
  admits.budgets = minBudgets(p.budgets, c.budgets);
  return admits;
}

// admits(parent, child) → boolean — did the parent grant EVERYTHING the child declared? (nothing dropped)
export function admits(parent, childDeclared) {
  const a = attenuate(parent, childDeclared);
  const c = childDeclared || {};
  return FACETS.every((f) => (c[f] || []).length === a[f].length);
}

// overRequest(parent, child) → { facet: [dropped…] } — what the child asked that the parent WON'T grant.
// The log-first probe (G0) records this per mount; empty object = a clean, fully-granted request.
export function overRequest(parent, childDeclared) {
  const c = childDeclared || {}, out = {};
  for (const f of FACETS) {
    const granted = admitsFacet((parent || {})[f] || [], c[f] || []);
    const dropped = (c[f] || []).filter((w) => !granted.includes(w));
    if (dropped.length) out[f] = dropped;
  }
  return out;
}

// fromHolospace(manifest) → a capset in this module's shape, read from a holospace.json `capabilities`
// facet (authored today as {storage, channels, permissions}). A missing facet ⇒ [] (requests nothing).
export function fromHolospace(manifest) {
  const caps = (manifest && manifest.capabilities) || {};
  const out = {};
  for (const f of FACETS) out[f] = Array.isArray(caps[f]) ? caps[f] : [];
  if (caps.budgets && typeof caps.budgets === "object") out.budgets = caps.budgets;
  return out;
}

// ROOT — the OS's own CapabilitySet (app #0 / the shell). The sovereign root holds everything; every
// nested mount attenuates from here. Declared as wildcards so `attenuate(ROOT, x)` grants x verbatim.
export const ROOT = Object.freeze({ storage: ["*"], channels: ["*"], permissions: ["*"], fetch: ["*"], budgets: {} });

export const HoloCapset = { FACETS, capMatch, attenuate, admits, overRequest, fromHolospace, ROOT };
export default HoloCapset;
