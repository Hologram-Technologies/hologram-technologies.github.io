// holo-address.mjs — The address is a NAME, never a path.
//
// One law: the address bar shows the NAME of a place, never its filesystem path. A
// Hologram place shows its name (Browser, Login, Home); the open web shows its domain
// (decided upstream by holo-open's classifier). This module is the projection layer:
//
//   nameOf(loc)   — the human name for a holo location, or null (never a guess).
//   resolve(typed)— the canonical destination for a typed name, or null (refuse, never invent).
//
// Names come from what a place ALREADY declares: the app catalog (schema:name / holo:words)
// plus a small FROZEN table of the OS front-door places that are chrome, not catalog apps.
//
// Invariants (witnessed in holo-address-witness.mjs):
//  · Pure + total. No clock, no RNG. Node === browser === host. Same input → same output.
//  · Lossless round-trip. resolve(nameOf(p)).loc === p, and nameOf(resolve(n).loc) === n,
//    for every app in the catalog and every frozen place.
//  · No new reachability. resolve() only returns a location already in the catalog or the
//    frozen table; it never fabricates a path. The scheme handler still re-verifies the
//    bytes under L5 — a name is a lossy-but-VERIFIED view of the κ, exactly like a truename.
//  · Refuses noise. "..", machine endpoints (cache/ · sc/ · .holo/ · .well-known/ · κ-hash),
//    and unknown names yield null, not a fabricated answer.
//
// Back-compat: any already-canonical holo://os/… URL or did:holo κ passes through resolve()
// unchanged, so every existing caller keeps working while the human surface gets names.

// The OS front door — places that are chrome, not catalog apps. The ONLY hand-curated names;
// everything else derives from the catalog. Keep this tiny.
export const PLACES = Object.freeze([
  { name: "Login", path: "login.html" },
  { name: "Home",  path: "shell.html", alt: ["home", "home.html", "home-screen.html"] },
  { name: "Find",  path: "find.html",  alt: ["search"] },
  { name: "Echo",  path: "echo.html",  alt: ["echo"] },
  { name: "Instant", path: "instant.html", alt: ["instant"] },
]);

// flatPath(loc) — normalize any holo location to its mount-relative key.
//   holo://os/apps/browser/index.html → apps/browser/index.html
//   holo://os/login.html              → login.html
//   /os/login.html                    → login.html
export function flatPath(loc) {
  let s = String(loc == null ? "" : loc).trim();
  s = s.replace(/^holo:\/\//i, "");   // drop scheme
  s = s.split(/[?#]/)[0];             // drop ?query / #frag
  s = s.replace(/^\/+/, "");          // drop leading slash
  s = s.replace(/^os\//i, "");        // drop the os/ mount prefix the scheme already strips
  return s;
}

// Machine locators that must NEVER wear a human name (they are not places a human navigates).
const isUnsafe  = (s) => String(s).includes("..");
const isMachine = (flat) =>
  /^(cache\/|sc\/|\.holo\/|\.well-known\/)/i.test(flat) ||      // OS/streaming/internal endpoints
  /^[0-9a-f]{64}$/i.test(flat) ||                               // a bare κ-hash address
  flat.includes("/cache/") || flat.includes("/.holo/");        // per-κ origin internals

const docOf = (j) => (j && (j["dcat:dataset"] || j["@graph"])) || (Array.isArray(j) ? j : []);

// Build the name↔location index from a catalog array. Cheap, pure, recomputable.
export function index(catalog) {
  const cat = docOf(catalog);
  const byPath = new Map();   // flatPath → { name, kappa, words }
  const byName = new Map();   // lowercased name / words / altName → { loc, kappa, name }
  for (const e of cat) {
    const name = e["schema:name"] || e.name; if (!name) continue;
    const kappa = e["@id"] || e.id || e["holo:root"] || null;
    const lp = e["dcat:landingPage"];
    const flp = lp ? flatPath(lp) : null;
    const loc = flp ? "holo://os/" + flp : null;
    if (flp && !byPath.has(flp)) byPath.set(flp, { name, kappa, words: e["holo:words"] || null });
    const reg = (k) => { if (k && loc) { const key = String(k).toLowerCase(); if (!byName.has(key)) byName.set(key, { loc, kappa, name }); } };
    // Register the name, its three-word κ-address, its alternate name, AND the de-prefixed name —
    // humans type "browser", not "Holo Browser" (every native app shares the "Holo " prefix the
    // shell drops for display). First registration wins, so collisions keep the earliest app.
    reg(name); reg(String(name).replace(/^holo\s+/i, "")); reg(e["holo:words"]); reg(e["schema:alternateName"]);
  }
  return { byPath, byName };
}

// nameOf(loc, catalog) → human name, or null. catalog may be the raw doc, the dataset
// array, or a prebuilt index() result.
export function nameOf(loc, catalog) {
  const flat = flatPath(loc);
  if (!flat || isUnsafe(flat) || isMachine(flat)) return null;
  for (const p of PLACES) if (flat === p.path || (p.alt || []).includes(flat)) return p.name;
  const idx = catalog && catalog.byPath ? catalog : index(catalog);
  const hit = idx.byPath.get(flat);
  if (hit) return hit.name;
  // A canonical content κ in did:/holo:// spelling is itself the address — it has no human name,
  // and feeding it back through resolve() (which passes such forms straight through to nameOf)
  // would loop forever. A bare 64-hex is already caught by isMachine() above; this guards the
  // did:holo: form that dodges it. Refuse here, BEFORE the short-form resolve() fallback.
  if (/^did:holo:/i.test(flat) || /^holo:\/\//i.test(flat)) return null;
  // The committed URL may be the SHORT form (holo://os/login, holo://os/browser) — the origin host stays
  // "os", only the path is shortened. Resolve the bare tail as a name so the bar still reads "Login".
  const r = resolve(flat, idx);
  return r && r.name ? r.name : null;
}

// resolve(typed, catalog) → { name, loc, kappa } | null. A typed name becomes a canonical
// location. Already-canonical input passes through (back-compat). Unknown → null: the caller
// then falls to the truename resolver, then to web, then to Q — never a fabricated path.
export function resolve(typed, catalog) {
  const s = String(typed == null ? "" : typed).trim();
  if (!s || isUnsafe(s)) return null;
  if (/^holo:\/\//i.test(s) || /^did:holo:/i.test(s) || /^[0-9a-f]{64}$/i.test(s))
    return { name: nameOf(s, catalog), loc: s, kappa: null };   // canonical → passthrough
  const key = s.toLowerCase();
  for (const p of PLACES)
    if (key === p.name.toLowerCase() || s === p.path || (p.alt || []).includes(key))
      return { name: p.name, loc: "holo://os/" + p.path, kappa: null };
  const idx = catalog && catalog.byName ? catalog : index(catalog);
  const hit = idx.byName.get(key);
  return hit ? { name: hit.name, loc: hit.loc, kappa: hit.kappa } : null;
}

// bind(catalog) → { nameOf, resolve } closed over one prebuilt index (for hot paths / the bar).
export function bind(catalog) {
  const idx = index(catalog);
  return { nameOf: (loc) => nameOf(loc, idx), resolve: (typed) => resolve(typed, idx) };
}

// ── browser binding: window.HoloAddress over the live apps catalog (mirrors HoloTruename).
// The shell may inject the already-loaded catalog via setCatalog() to avoid a second fetch.
if (typeof window !== "undefined" && !window.HoloAddress) {
  let _idx = null, _loading = null;
  async function ready() {
    if (_idx) return _idx;
    if (!_loading) _loading = (async () => {
      for (const u of ["apps/index.jsonld", "/apps/index.jsonld"]) {
        try { const r = await fetch(u); if (r.ok) return (_idx = index(await r.json())); } catch (e) { /* try next */ }
      }
      return (_idx = index([]));
    })();
    return _loading;
  }
  window.HoloAddress = {
    PLACES, flatPath, index, ready,
    setCatalog: (j) => { _idx = index(j); },
    nameOf: async (loc) => nameOf(loc, await ready()),
    resolve: async (typed) => resolve(typed, await ready()),
    // SYNC — for hot paths like the address bar. Null-safe before the catalog is warm
    // (call ready() once at boot); the PLACES front door (Login/Home/Find) resolves even
    // before the catalog loads, since those names are frozen, not catalog-derived.
    nameSync: (loc) => nameOf(loc, _idx || index([])),
    resolveSync: (typed) => resolve(typed, _idx || index([])),
  };
}

export default { PLACES, flatPath, index, nameOf, resolve, bind };
