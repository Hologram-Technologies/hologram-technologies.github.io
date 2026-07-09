// holo-portal-link.mjs — THE ONE codec for the portal link. Build it · parse it · detect it · resolve it to the
// loader URL. The "#k= fragment" format (server-blind: the κ + loader-κ + PQC token ride the URL fragment, never
// sent to a gateway) lives in exactly ONE place. Every surface — the façade (holo-portal-share), the loader
// (holo-seed), the OS omnibar (holo-omni-resolve), the Messenger composer — imports THIS instead of re-inventing
// a regex. Pure + isomorphic. ────────────────────────────────────────────────────────────────────────────────

// slug(name) → a URL-friendly, human-readable path segment (no jargon, no hash). "Ava's Whiteboard ✨" → "avas-whiteboard".
export const slug = (name) => (String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "portal");

// build(kappa, opts) → the shareable link. A NAME makes the visible URL self-descriptive — ".../open/avas-whiteboard"
// reads like a doorway; the verifying κ rides the #fragment. base = "" → a bare "#k=…" fragment (same-origin loader
// prepends); base = a gateway origin → a full link. loader = the loader's own κ (selfVerify); tp = a PQC token.
export function build(kappa, { loader = null, tp = null, base = "", name = null } = {}) {
  const p = new URLSearchParams();
  p.set("k", kappa);
  if (loader) p.set("l", loader);
  if (tp) p.set("tp", tp);
  const frag = "#" + p.toString();
  if (!base) return frag;
  const origin = String(base).replace(/\/(portal\.html)?$/i, "").replace(/\/$/, "");   // normalize a gateway URL → its origin
  return origin + (name ? "/open/" + slug(name) : "/portal.html") + frag;
}

// parse(str) → { k, l, tp } — ALWAYS an object (k is null when there is no portal fragment, so callers can read
// .k without a guard). Accepts "#k=…&l=…&tp=…", a full "https://gw/portal.html#k=…", or a bare "#<κ>".
export function parse(str) {
  const s = String(str == null ? "" : str);
  const hash = s.split("#").slice(1).join("#");
  if (!hash) return { k: null, l: null, tp: null };
  const bare = decodeURIComponent(hash);
  if (/^did:holo:[a-z0-9]+:[0-9a-f]+$/.test(bare)) return { k: bare, l: null, tp: null };
  const q = new URLSearchParams(hash);
  const k = q.get("k");
  return { k: k ? decodeURIComponent(k) : null, l: q.get("l") ? decodeURIComponent(q.get("l")) : null, tp: q.get("tp") || null };
}

// detect(str) → true iff str carries a portal fragment. The ONE matcher every surface shares.
export function detect(str) { return !!parse(str).k; }

// loaderUrl(str, opts) → the portal-loader URL to actually open. A full external portal URL opens as-is; a bare
// fragment resolves to "<gateway>/portal.html#…" (default gateway = the current origin in a browser).
export function loaderUrl(str, { gateway = null } = {}) {
  const s = String(str == null ? "" : str);
  if (!detect(s)) return null;
  if (/^https?:\/\//i.test(s)) return s;
  const hi = s.indexOf("#");
  const frag = hi >= 0 ? s.slice(hi + 1) : ("k=" + encodeURIComponent(parse(s).k));
  const base = (gateway != null ? gateway : (typeof location !== "undefined" ? location.origin : "")).replace(/\/$/, "");
  return base + "/portal.html#" + frag;
}

export default { build, parse, detect, loaderUrl };
