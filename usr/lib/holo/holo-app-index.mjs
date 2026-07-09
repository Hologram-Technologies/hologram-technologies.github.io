// holo-app-index.mjs — EVERY HOLO APP, INDEXED BY ITS SELF-VERIFYING κ (E3 of the Q-is-the-resolver
// fusion). No new catalog: the SIGNED release strand's apps table (release.json → payload.apps:
// dir → sha256(entry-document)) is the AUTHORITY — it is what the release actually committed, so an
// app's κ is signed, chained, and gate-checked. apps/index.jsonld supplies only display metadata and
// the launch URL (dcat:landingPage → apps/<dir>/… — the same <dir> that keys the signed table).
//
// LAUNCHING = RESOLVING (V-INDEX): resolve(app-κ) fetches the entry document by hash and re-derives it
// to the signed κ BEFORE it opens — a tampered app refuses by name; a moved app still opens by κ. The
// path is a convenience for the browser's address bar, never the identity (L1).
//
// Pure + injected (fetchFn); one tiny reader, no dependency on holo-names — the host surface joins them.

export async function loadAppIndex({ base, fetchFn = null } = {}) {
  const BASE = new URL(String(base || (typeof location !== "undefined" ? new URL("./", location.href) : "")));
  const f = fetchFn || ((u, o) => fetch(u, o));
  // the SIGNED authority: only apps the release committed exist in the index
  let signed = {};
  try { const rel = await (await f(new URL("release.json", BASE), { cache: "no-store" })).json(); signed = (rel["holstr:payload"] || {}).apps || {}; } catch {}
  // display metadata + launch URL (optional; an app absent here still indexes with its dir as title)
  const meta = {};
  try {
    const j = await (await f(new URL("apps/index.jsonld", BASE))).json();
    for (const d of j["dcat:dataset"] || []) {
      const landing = String(d["dcat:landingPage"] || "");
      const dir = landing.split("/")[1];
      if (dir) meta[dir] = { title: d["schema:name"] || dir, desc: d["schema:description"] || "", entry: landing, words: d["holo:words"] || "" };
    }
  } catch {}
  const apps = [];
  for (const [dir, hex] of Object.entries(signed)) {
    if (!/^[0-9a-f]{64}$/i.test(String(hex))) continue;   // apps table is name→hex (SEC: ignore malformed)
    const m = meta[dir] || {};
    apps.push({ dir, hex: String(hex).toLowerCase(), kappa: "sha256:" + String(hex).toLowerCase(), title: m.title || dir, desc: m.desc || "", entry: m.entry || ("apps/" + dir + "/"), words: m.words || "" });
  }
  apps.sort((a, b) => a.title.localeCompare(b.title));
  return { apps, byHex: new Map(apps.map((a) => [a.hex, a])), byDir: new Map(apps.map((a) => [a.dir, a])), base: BASE };
}

// findApp — is this name AN APP? Its κ (did:holo / sha256: / bare hex), its dir, or holo://app/<dir>.
// Returns the app row (with entry URL resolved against base) or null. Pure — no fetch.
export function findApp(index, name) {
  if (!index) return null;
  const s = String(name || "").trim();
  let m;
  if ((m = /^(?:did:holo:sha256:|sha256:)?([0-9a-f]{64})$/i.exec(s))) { const a = index.byHex.get(m[1].toLowerCase()); if (a) return withUrl(index, a); }
  if ((m = /^holo:\/\/app\/([a-z0-9-]+)$/i.exec(s))) { const a = index.byDir.get(m[1]); return a ? withUrl(index, a) : null; }
  if (index.byDir.has(s)) return withUrl(index, index.byDir.get(s));
  return null;
}
const withUrl = (index, a) => ({ ...a, url: new URL(a.entry, index.base).href });

export default { loadAppIndex, findApp };
