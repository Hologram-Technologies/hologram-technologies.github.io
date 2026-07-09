// holo-realdebrid.mjs — the missing link that makes the catalogue actually stream: turn a Stremio addon's
// torrent `infoHash` (or a hoster link) into an INSTANT, cached, direct HTTPS stream via the user's own
// Real-Debrid account. Hologram orchestrates magnet → select → unrestrict; cached content resolves in ~1–2s,
// uncached is surfaced honestly ("fetching to your debrid"). RD is the USER's paid backend; we bundle nothing.
//
// Dependency-injected (fetch/sleep) so Node witnesses the whole flow with a fake RD and no token/network.
// RD REST v1.0: Authorization: Bearer <token>; POST bodies are application/x-www-form-urlencoded.

const API = "https://api.real-debrid.com/rest/1.0";
const VIDEO_EXT = /\.(mp4|mkv|webm|m4v|mov|avi|ts)$/i;
const guessType = (name) => /\.m3u8/i.test(name || "") ? "application/x-mpegURL" : /\.webm$/i.test(name || "") ? "video/webm" : "video/mp4";
const form = (o) => Object.entries(o).map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&");
const magnetOf = (infoHash) => `magnet:?xt=urn:btih:${infoHash}`;

export function createRealDebrid({ token, fetch: f } = {}) {
  const doFetch = f || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  if (!doFetch) throw new Error("holo-realdebrid: fetch required");
  if (!token) throw new Error("holo-realdebrid: token required");
  async function api(path, { method = "GET", body } = {}) {
    const res = await doFetch(API + path, {
      method,
      headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      body: body ? form(body) : undefined,
    });
    if (res.status === 204) return {};
    if (!res.ok) throw new Error("rd " + res.status + " " + path);
    return res.json();
  }
  return {
    user: () => api("/user"),                                         // validate token → { username, premium, … }
    unrestrict: (link) => api("/unrestrict/link", { method: "POST", body: { link } }),  // → { download, filename, filesize }
    addMagnet: (magnet) => api("/torrents/addMagnet", { method: "POST", body: { magnet } }), // → { id }
    torrentInfo: (id) => api("/torrents/info/" + id),                 // → { status, files, links }
    selectFiles: (id, files = "all") => api("/torrents/selectFiles/" + id, { method: "POST", body: { files } }),
    deleteTorrent: (id) => api("/torrents/delete/" + id, { method: "DELETE" }).catch(() => {}),
  };
}

// resolveStream(rd, candidate, opts) → an instant `httpDirect` stream candidate, or { pending:true } (uncached,
// downloading), or null (dead/error). candidate: { url } (hoster) or { infoHash, fileIdx, quality, hdr, label }.
export async function resolveStream(rd, cand, { sleep = (ms) => new Promise((r) => setTimeout(r, ms)), pollMs = 1500, tries = 6, cachedOnly = false } = {}) {
  const mk = (u, cached) => ({
    playSrc: u.download, type: guessType(u.filename || (cand && cand.label)), quality: cand && cand.quality, hdr: cand && cand.hdr,
    httpDirect: true, cached: cached !== false, filename: u.filename,
    provenance: { resolver: "Real-Debrid", kind: "rd", label: "Real-Debrid" + (u.filename ? " · " + u.filename : "") },
  });
  if (cand && cand.url) return mk(await rd.unrestrict(cand.url), true);     // a hoster link → one call
  if (!cand || !cand.infoHash) return null;
  const add = await rd.addMagnet(magnetOf(cand.infoHash)); const id = add.id;
  // pick the video file (1-based) when the addon told us which; else let RD take all video files.
  await rd.selectFiles(id, cand.fileIdx != null ? String(cand.fileIdx + 1) : "all");
  const maxTries = cachedOnly ? 1 : tries;   // cachedOnly = one peek, no polling (used by the parallel race)
  for (let i = 0; i < maxTries; i++) {
    const info = await rd.torrentInfo(id);
    if (info.status === "downloaded" && info.links && info.links.length) {
      const idx = cand.fileIdx != null ? Math.min(cand.fileIdx, info.links.length - 1) : 0;
      return mk(await rd.unrestrict(info.links[idx] || info.links[0]), true);
    }
    if (["magnet_error", "error", "virus", "dead"].includes(info.status)) { rd.deleteTorrent(id); return null; }
    if (i < maxTries - 1) await sleep(pollMs);
  }
  if (cachedOnly) { rd.deleteTorrent(id); return { cached: false }; }   // not instantly cached → clean up the probe
  return { pending: true };   // still caching on RD — honest "one-time fetch" state
}

// bestCached — probe up to `max` already-score-ranked torrent candidates IN PARALLEL (cachedOnly), bounded by
// capMs, and return the HIGHEST-scored one that's instantly cached. Promise.all preserves input order (= score
// order), so the first httpDirect result is the best cached release. null = none cached in time. Never blocks
// on a download; uncached probes self-clean (deleteTorrent). This is the "race, don't wait" core of Holo Instant.
export async function bestCached(rd, cands, { capMs = 3000, max = 3, ...opts } = {}) {
  const slice = (cands || []).slice(0, max); if (!slice.length || !rd) return null;
  const all = Promise.all(slice.map(async (c) => { try { return await resolveStream(rd, c, { ...opts, cachedOnly: true }); } catch { return null; } }));
  const results = await Promise.race([all, new Promise((r) => setTimeout(() => r(null), capMs))]);
  if (!results) return null;
  return results.find((s) => s && s.httpDirect) || null;
}

// ── Real-Debrid device sign-in (OAuth2 device flow) — no API-token hunting ───────────────────────────────
// RD's open-source app flow: get a short user code → the user approves it at real-debrid.com/device → poll
// for permanent app credentials → exchange for an access/refresh token. The result refreshes forever, so the
// user connects ONCE. CORS-free on the native host; dependency-injected so Node witnesses the state machine.
const RD_OAUTH = "https://api.real-debrid.com/oauth/v2";
const RD_OSS_CLIENT = "X245A4XAIBGVM";          // RD's documented open-source client_id for the device flow
const RD_GRANT = "http://oauth.net/grant_type/device/1.0";
async function rdToken(doFetch, { client_id, client_secret, code }) {
  const body = `client_id=${encodeURIComponent(client_id)}&client_secret=${encodeURIComponent(client_secret)}&code=${encodeURIComponent(code)}&grant_type=${encodeURIComponent(RD_GRANT)}`;
  const t = await (await doFetch(`${RD_OAUTH}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body })).json();
  if (!t || !t.access_token) throw new Error("rd token exchange failed");
  return { access_token: t.access_token, refresh_token: t.refresh_token || code, expires_at: Date.now() + (+t.expires_in || 3600) * 1000 };
}
// deviceAuth → a forever-refreshing credential bundle. onCode({ user_code, verification_url }) fires once so
// the UI can show the code; the promise resolves when the user approves (or rejects on timeout/abort).
export async function deviceAuth({ fetch: f, onCode, signal, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), clientId = RD_OSS_CLIENT } = {}) {
  const doFetch = f || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  if (!doFetch) throw new Error("holo-realdebrid: fetch required");
  const dc = await (await doFetch(`${RD_OAUTH}/device/code?client_id=${clientId}&new_credentials=yes`, { signal })).json();
  if (!dc || !dc.device_code) throw new Error("rd device code failed");
  if (onCode) { try { onCode({ user_code: dc.user_code, verification_url: dc.verification_url || dc.direct_verification_url || "https://real-debrid.com/device", expires_in: dc.expires_in }); } catch {} }
  const interval = Math.max(2, +dc.interval || 5) * 1000, deadline = Date.now() + (+dc.expires_in || 600) * 1000;
  while (Date.now() < deadline) {
    if (signal && signal.aborted) throw new Error("aborted");
    await sleep(interval);
    let cr = null; try { cr = await (await doFetch(`${RD_OAUTH}/device/credentials?client_id=${clientId}&code=${encodeURIComponent(dc.device_code)}`, { signal })).json(); } catch { continue; }
    if (cr && cr.client_id && cr.client_secret) {
      const tok = await rdToken(doFetch, { client_id: cr.client_id, client_secret: cr.client_secret, code: dc.device_code });
      return { client_id: cr.client_id, client_secret: cr.client_secret, ...tok };   // permanent creds + first token
    }   // else authorization_pending → keep polling
  }
  throw new Error("rd sign-in timed out");
}
export async function refreshAccess({ fetch: f, client_id, client_secret, refresh_token }) {
  const doFetch = f || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  return rdToken(doFetch, { client_id, client_secret, code: refresh_token });
}

export default { createRealDebrid, resolveStream, bestCached, deviceAuth, refreshAccess };
if (typeof window !== "undefined") {
  window.HoloRealDebrid = {
    createRealDebrid, resolveStream, bestCached, deviceAuth, refreshAccess,
    // saveOAuth stores the forever-refreshing bundle AND mirrors its access_token into the plain token slot,
    // so every existing caller (live/configured/createRealDebrid) keeps working with zero changes.
    saveOAuth(b) { try { localStorage.setItem("holoplayer.rd.oauth", JSON.stringify(b)); localStorage.setItem("holoplayer.rd.token", b.access_token || ""); } catch {} },
    oauth() { try { return JSON.parse(localStorage.getItem("holoplayer.rd.oauth") || "null"); } catch { return null; } },
    async ensureFresh() {   // refresh the access token when it's near expiry (call on boot + periodically)
      const o = this.oauth(); if (!o || !o.client_id || !o.expires_at || Date.now() < o.expires_at - 120000) return;
      try { const t = await refreshAccess({ client_id: o.client_id, client_secret: o.client_secret, refresh_token: o.refresh_token }); this.saveOAuth({ ...o, ...t }); } catch {}
    },
    live() { try { const t = localStorage.getItem("holoplayer.rd.token") || ""; return t ? createRealDebrid({ token: t }) : null; } catch { return null; } },
    configured() { try { return !!localStorage.getItem("holoplayer.rd.token"); } catch { return false; } },
    setToken(t) { try { if (t) localStorage.setItem("holoplayer.rd.token", t); else { localStorage.removeItem("holoplayer.rd.token"); localStorage.removeItem("holoplayer.rd.oauth"); } } catch {} },
  };
}
