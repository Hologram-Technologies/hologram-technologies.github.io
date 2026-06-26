// holo-handoff.mjs — carry the post-login session handoff in same-origin storage, not the URL query, so the
// address bar reads a bare holo://os/home (no ?operator=…&session=…). The login page (holo://os/login) and
// the shell (holo://os/home) share ONE origin (host "os"), so sessionStorage crosses the navigation — the
// query was only ever there to survive the hop, and is now pure noise in the bar.
//
// Pure (no DOM). The glue: holo-sddm.js calls packHandoff() before navigating; shell.html calls
// unpackHandoff() at boot. Carries NOTHING that wasn't already in the URL — same security, off the bar.
const KEYS = ["operator", "host", "session", "next", "via"];

// packHandoff(url) → { path, handoff } — split "loader?operator=…&session=…" into the bare path + a handoff
// object of the known keys. No query (or no known keys) ⇒ handoff null (navigate as-is).
export function packHandoff(url) {
  const u = String(url == null ? "" : url);
  const qi = u.indexOf("?");
  if (qi < 0) return { path: u, handoff: null };
  const q = new URLSearchParams(u.slice(qi + 1));
  const h = {};
  for (const k of KEYS) { const v = q.get(k); if (v != null) h[k] = v; }
  return { path: u.slice(0, qi), handoff: Object.keys(h).length ? h : null };
}

// unpackHandoff(search, stored) → params object | null. The URL query WINS (a shared/deep link still carries
// its own params); otherwise the stored handoff (a JSON string) is used. The caller consumes-once (clears the
// store) on a storage hit, so a refresh can't replay a stale handoff.
export function unpackHandoff(search, stored) {
  const p = new URLSearchParams(search || "");
  if ([...p.keys()].length) { const o = {}; for (const [k, v] of p) o[k] = v; return o; }
  try { const h = JSON.parse(stored || "null"); return h && typeof h === "object" ? h : null; } catch (e) { return null; }
}

export const HANDOFF_KEY = "holo.handoff";
export default { packHandoff, unpackHandoff, HANDOFF_KEY };
