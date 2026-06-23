// holo-recommend.mjs — "Because you've been exploring…": the recommendations row. Netflix's second rail —
// titles you HAVEN'T opened but match your taste — over the κ app catalog, ranked by your PRIVATE interests
// (window.HoloProfile.terms()) and holo-rank authority. Pure + on-device; nothing leaves the machine. Renders
// through the same poster rail as Continue watching (holo-continue-ui.renderContinueRail), one visual language.
// Empty-safe: no catalog → nothing; no interests yet → a light popular fallback by rank (never a cold row).
// (Distinct from os/sbin/holo-discover.mjs, which is open-web discovery — this recommends installed κ apps.)

// recommend(catalog, recentAddrs, { profileTerms, rank, limit }) → poster-rail items for apps NOT already in
// your recents, ranked by interest affinity (× holo-rank). Same item shape the rail + openRecent consume.
export function recommend(catalog = [], recentAddrs = [], { profileTerms = [], rank = null, limit = 12 } = {}) {
  const recent = new Set();
  for (const a of recentAddrs || []) { const s = String(a || ""); recent.add(s); recent.add(s.replace(/^holo:\/\//, "")); }
  const terms = (profileTerms || []).filter((t) => typeof t === "string" && t.length > 2).map((t) => t.toLowerCase());
  const scored = [];
  for (const app of catalog || []) {
    const id = app.id || app.identifier || app["schema:identifier"]; if (!id) continue;
    if (recent.has(id) || recent.has("holo://" + id)) continue;                 // not something you already use
    const kappa = app.did || app.kappa || app["holo:root"] || null;
    const hay = ((app.name || app["schema:name"] || "") + " " + (app.keywords || []).join(" ") + " " + (app.categories || []).join(" ") + " " + (app.category || "")).toLowerCase();
    const aff = terms.reduce((n, t) => n + (hay.indexOf(t) >= 0 ? 1 : 0), 0);
    const auth = (rank && kappa) ? (rank[String(kappa).split(":").pop()] || 0) : 0;
    scored.push({ addr: "holo://" + id, kind: "app", title: app.name || app["schema:name"] || id, kappa, _s: aff * 2 + auth, _aff: aff });
  }
  // with an interest signal, surface ONLY true matches (a real recommendation); a fresh user with no signal
  // gets a light popular fallback (by rank), so the row is never cold/empty-feeling.
  const anyAff = scored.some((x) => x._aff > 0);
  const pool = (terms.length && anyAff) ? scored.filter((x) => x._aff > 0) : scored;
  pool.sort((a, b) => b._s - a._s || (a.title < b.title ? -1 : 1));
  return pool.slice(0, limit).map(({ addr, kind, title, kappa }) => ({ addr, kind, title, kappa }));
}

// titleFor(profileTerms) → an honest heading: personalized when there's a signal, neutral otherwise.
export function titleFor(profileTerms = []) {
  const t = (profileTerms || []).filter((x) => typeof x === "string" && x.length > 2);
  return t.length ? "Because you've been exploring " + t[0] : "Discover";
}

if (typeof window !== "undefined") window.HoloRecommend = { recommend, titleFor };
export default { recommend, titleFor };
