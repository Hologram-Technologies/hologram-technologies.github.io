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
  // the blake3 apps sidecar (optional, transitional): dir → blake3(entry-document). Present ⇒ blake3 is
  // the app's canonical κ (each re-derives from b/<blake3hex>); the SIGNED sha256 stays the trust root +
  // fallback until the strand re-seals under blake3 (HOLO-KAPPA-BLAKE3-CANONICAL B4). Absent ⇒ sha256, as before.
  let b3 = {};
  try { const s = await (await f(new URL("apps-blake3.json", BASE))).json(); b3 = (s && s.apps) || {}; } catch {}

  const apps = [];
  for (const [dir, hex] of Object.entries(signed)) {
    if (!/^[0-9a-f]{64}$/i.test(String(hex))) continue;   // apps table is name→hex (SEC: ignore malformed)
    const m = meta[dir] || {};
    const sha = String(hex).toLowerCase();
    const bl = /^[0-9a-f]{64}$/i.test(String(b3[dir] || "")) ? String(b3[dir]).toLowerCase() : null;
    apps.push({ dir, hex: sha, sha256: sha, blake3: bl, axis: bl ? "blake3" : "sha256",
      kappa: bl ? ("blake3:" + bl) : ("sha256:" + sha),   // blake3 identity when sealed, else the signed sha256
      title: m.title || dir, desc: m.desc || "", entry: m.entry || ("apps/" + dir + "/"), words: m.words || "" });
  }
  apps.sort((a, b) => a.title.localeCompare(b.title));
  // byHex keyed by EVERY axis-hex an app owns (sha256 + blake3), so a κ in either axis resolves (superset).
  const byHex = new Map();
  for (const a of apps) { byHex.set(a.sha256, a); if (a.blake3) byHex.set(a.blake3, a); }
  return { apps, byHex, byDir: new Map(apps.map((a) => [a.dir, a])), base: BASE };
}

// findApp — is this name AN APP? Its κ (did:holo / sha256: / blake3: / bare hex), its dir, or holo://app/<dir>.
// Returns the app row (with entry URL resolved against base) or null. Pure — no fetch. Axis-agnostic:
// byHex is keyed by both the sha256 and blake3 hex, so a κ in EITHER axis lands the same app (superset).
export function findApp(index, name) {
  if (!index) return null;
  const s = String(name || "").trim();
  let m;
  if ((m = /^(?:did:holo:(?:sha256|blake3):|(?:sha256|blake3):)?([0-9a-f]{64})$/i.exec(s))) { const a = index.byHex.get(m[1].toLowerCase()); if (a) return withUrl(index, a); }
  if ((m = /^holo:\/\/app\/([a-z0-9-]+)$/i.exec(s))) { const a = index.byDir.get(m[1]); return a ? withUrl(index, a) : null; }
  if (index.byDir.has(s)) return withUrl(index, index.byDir.get(s));
  return null;
}
const withUrl = (index, a) => ({ ...a, url: new URL(a.entry, index.base).href });

export default { loadAppIndex, findApp };
