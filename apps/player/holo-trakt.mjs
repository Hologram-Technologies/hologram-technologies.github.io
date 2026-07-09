// holo-trakt.mjs — Trakt.tv: cross-device watch progress (scrobble), your lists, and recommendations.
// Needs a Trakt app (register once at trakt.tv/oauth/applications → client id + secret), then device sign-in.
// The client id/secret + token are the USER's, stored locally. fetch injected → Node-witnessable.

const API = "https://api.trakt.tv";
const hdr = (clientId, token) => { const h = { "Content-Type": "application/json", "trakt-api-version": "2", "trakt-api-key": clientId }; if (token) h.Authorization = "Bearer " + token; return h; };

// Device sign-in: show a short code → the user approves it at trakt.tv/activate → poll for the token.
export async function deviceAuth({ clientId, clientSecret, fetch: f, onCode, signal, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const doFetch = f || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  if (!doFetch) throw new Error("holo-trakt: fetch required");
  const dc = await (await doFetch(`${API}/oauth/device/code`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: clientId }) })).json();
  if (!dc || !dc.device_code) throw new Error("trakt device code failed");
  if (onCode) { try { onCode({ user_code: dc.user_code, verification_url: dc.verification_url || "https://trakt.tv/activate", expires_in: dc.expires_in }); } catch {} }
  const interval = Math.max(2, +dc.interval || 5) * 1000, deadline = Date.now() + (+dc.expires_in || 600) * 1000;
  while (Date.now() < deadline) {
    if (signal && signal.aborted) throw new Error("aborted");
    await sleep(interval);
    let r; try { r = await doFetch(`${API}/oauth/device/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: dc.device_code, client_id: clientId, client_secret: clientSecret }) }); } catch { continue; }
    if (r.status === 200) { const t = await r.json(); return { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + (+t.expires_in || 7776000) * 1000 }; }
    // 400 = authorization pending → keep polling; other codes fall through to the timeout.
  }
  throw new Error("trakt sign-in timed out");
}
export async function refreshAccess({ clientId, clientSecret, refresh_token, fetch: f }) {
  const doFetch = f || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  const t = await (await doFetch(`${API}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token, client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", redirect_uri: "urn:ietf:wg:oauth:2.0:oob" }) })).json();
  if (!t || !t.access_token) throw new Error("trakt refresh failed");
  return { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + (+t.expires_in || 7776000) * 1000 };
}

// The id block Trakt wants for one of our items (imdb preferred, tmdb fallback); null if neither is known.
export function refOf(item) {
  const ids = {}; const imdb = (item.imdbId && /^tt/.test(item.imdbId)) ? item.imdbId : null;
  if (imdb) ids.imdb = imdb; if (item.tmdbId) ids.tmdb = +item.tmdbId;
  if (!Object.keys(ids).length) return null;
  if (item.kind === "series" || item._stremioType === "series") {
    const ep = (item.seasonNumber && item.episodeNumber) ? { season: item.seasonNumber, number: item.episodeNumber } : null;
    return ep ? { show: { ids }, episode: ep } : { show: { ids } };
  }
  return { movie: { ids } };
}

// A Trakt list entry ({ movie|show: { title, year, ids } }) → the player's item shape, with CDN poster art.
export function traktItem(entry) {
  const m = entry.movie || entry.show; if (!m || !m.ids) return null;
  const imdb = m.ids.imdb, isShow = !!entry.show || entry.type === "show";
  return {
    id: "trakt:" + (m.ids.trakt || imdb || m.title), name: m.title, year: m.year || null, kind: isShow ? "series" : "movie",
    imdbId: imdb || null, tmdbId: m.ids.tmdb || null,
    posterUrl: imdb ? `https://images.metahub.space/poster/large/${imdb}/img` : null,
    backdrop: imdb ? `https://images.metahub.space/background/large/${imdb}/img` : null,
    overview: "", blurb: "", genres: [], topics: [], rating: null, runtimeSec: 0,
    source: "tmdb", provider: "trakt", kappa: "", holoKappa: "trakt:" + (m.ids.trakt || imdb || m.title),
    availability: { playable: false, source: null, kappa: "", playSrc: "", type: "" }, _trakt: true,
  };
}

export function createTrakt({ clientId, clientSecret, token, fetch: f } = {}) {
  const doFetch = f || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  if (!doFetch) throw new Error("holo-trakt: fetch required");
  const get = async (path) => { const r = await doFetch(API + path, { headers: hdr(clientId, token) }); if (!r.ok) throw new Error("trakt " + r.status); return r.json(); };
  const post = async (path, body) => { const r = await doFetch(API + path, { method: "POST", headers: hdr(clientId, token), body: JSON.stringify(body) }); if (!r.ok) throw new Error("trakt " + r.status); return r.json().catch(() => ({})); };
  return {
    user: () => get("/users/me"),
    // scrobble — the cross-device progress sync. action: start | pause | stop. progress 0..100.
    async scrobble(action, item, progress) { const ref = refOf(item); if (!ref) return null; return post(`/scrobble/${action}`, { ...ref, progress: Math.max(0, Math.min(100, progress || 0)) }); },
    watchlist: (type = "movies") => get(`/sync/watchlist/${type}`).catch(() => []),
    playback: (type = "movies") => get(`/sync/playback/${type}`).catch(() => []),       // continue-watching, with progress
    recommendations: (type = "movies") => get(`/recommendations/${type}?limit=20`).catch(() => []),
    addWatchlist: (item) => { const ref = refOf(item); return ref ? post("/sync/watchlist", { [ref.show ? "shows" : "movies"]: [ref.show ? { ids: ref.show.ids } : { ids: ref.movie.ids }] }) : null; },
  };
}

export default { deviceAuth, refreshAccess, createTrakt, refOf, traktItem };
if (typeof window !== "undefined") window.HoloTrakt = { deviceAuth, refreshAccess, createTrakt, refOf, traktItem };
