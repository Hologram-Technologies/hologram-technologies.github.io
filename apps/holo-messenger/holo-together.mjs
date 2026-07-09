// holo-together.mjs - "Together": one link to a LIVE shared Hologram experience. THE LINK IS THE ROOM.
//
// Mirrors holo-pay.mjs exactly (proven): the session descriptor travels INSIDE the link (base64url JSON in the URL
// fragment), so a plain browser with NO Hologram, NO app can open it, see "X invited you to watch …", and JOIN. The
// κ is SHA-256 of the canonical public fields (integrity + dedup) - SHA-256 (not BLAKE3) because the viewer must run
// anywhere off Hologram with bare WebCrypto. The `room` is the live signaling/mesh channel id (holo-kappa-room /
// holo-rtc) peers rendezvous on; the `joinSecret` is a bearer token in the link (whoever holds the link may join -
// that IS the design) and is NOT part of the κ. Capability is explicit: "view" (stream only - the default & the only
// thing a non-Hologram or stranger gets) vs "control"/"edit" (Hologram peers, real identity + consent). Framework-free:
// the SAME module powers the messenger AND the standalone viewer page.

export const TOGETHER_VERSION = 1;

function _b64urlEncode(obj) { const b = btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function _b64urlDecode(str) { const b = str.replace(/-/g, "+").replace(/_/g, "/"); return JSON.parse(decodeURIComponent(escape(atob(b)))); }
async function _sha256hex(s) { const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
function _randHex(n) { const b = crypto.getRandomValues(new Uint8Array(n)); return [...b].map((x) => x.toString(16).padStart(2, "0")).join(""); }
// canonical κ string - PUBLIC fields only (joinSecret excluded, so κ is the shareable id)
function _canon(i) { return [i.v, i.kind, i.title || "", i.hostName || "", i.room || "", i.capability || "view", i.signal || "", i.content || "", i.created || "", i.expires || ""].join("|"); }

// CONTEXTUAL DISCOVERY - does a message carry something you'd want to enjoy together? Detect a watchable/listenable link
// so the chat can offer "Watch together" at the perfect moment. Returns { kind:"watch"|"listen", url, title } | null.
function _titleFromUrl(u) {
  try { const h = new URL(u).hostname.replace(/^www\./, ""); if (/youtu/.test(h)) return "this video"; if (/spotify|soundcloud/.test(h)) return "this track"; if (/vimeo|twitch/.test(h)) return "this stream"; return h; } catch { return "this"; }
}
export function watchableContent(text) {
  const urls = String(text || "").match(/https?:\/\/[^\s]+/g) || [];
  for (const raw of urls) {
    const u = raw.replace(/[.,)\]]+$/, "");
    if (/youtube\.com\/watch|youtu\.be\/|vimeo\.com\/\d|twitch\.tv\/|\.(mp4|webm|mov|m3u8)(\?|$)/i.test(u)) return { kind: "watch", url: u, title: _titleFromUrl(u) };
    if (/open\.spotify\.com\/|soundcloud\.com\/|music\.youtube|\.(mp3|m4a|wav|flac|ogg)(\?|$)/i.test(u)) return { kind: "listen", url: u, title: _titleFromUrl(u) };
  }
  return null;
}

// Where viewers rendezvous (together-signal). The default is the app's OWN origin - the relay is mounted at /signal on
// the server that serves the messenger (serve-m1 for dev; the OS static layer in prod), so same-origin joins "just work"
// with nothing to run by hand. For TRUE cross-network "watch together" (an off-Hologram friend across the internet), a
// holo:///localhost origin isn't reachable - ops point everyone at one PUBLIC relay by setting `window.HoloTogetherSignal`
// (or globalThis.HOLO_TOGETHER_SIGNAL) once at boot; no code change. The chosen URL travels in the tamper-checked link.
export function defaultSignal() {
  // precedence: build/server inject → runtime global → an ops-set <meta> → a per-user localStorage override → origin.
  if (typeof globalThis !== "undefined" && globalThis.HOLO_TOGETHER_SIGNAL) return String(globalThis.HOLO_TOGETHER_SIGNAL);
  if (typeof window !== "undefined" && window.HoloTogetherSignal) return String(window.HoloTogetherSignal);
  if (typeof document !== "undefined") { const meta = document.querySelector && document.querySelector('meta[name="holo-together-signal"]'); if (meta && meta.content) return meta.content; }
  try { if (typeof localStorage !== "undefined") { const v = localStorage.getItem("holo.together.signal"); if (v) return v; } } catch {}
  return (typeof location !== "undefined" ? location.origin : "");
}

// kind: "watch" | "listen" | "tab" | "doc" | "game" | "room"  - what you're doing together
export async function createSession({ kind = "tab", title = "", hostName = "", capability = "view", room = null, signal = null, content = "", ttlSeconds = 6 * 3600, nowMs = null } = {}) {
  if (capability !== "view" && capability !== "control" && capability !== "edit") capability = "view";
  const now = nowMs || Date.now();
  const intent = { v: TOGETHER_VERSION, kind, title: String(title || "").slice(0, 120), hostName: String(hostName || "").slice(0, 60), capability, room: room || ("rm" + _randHex(8)), signal: signal || defaultSignal(), content: String(content || "").slice(0, 600), created: now, expires: now + ttlSeconds * 1000, joinSecret: _randHex(16) };
  intent.kappa = await _sha256hex(_canon(intent));
  return intent;
}

export function buildLink(intent, { origin = null, viewPath = "/apps/holo-messenger/together-view.html" } = {}) {
  const payload = _b64urlEncode(intent);
  const org = origin || (typeof location !== "undefined" ? location.origin : "");
  return {
    kappa: intent.kappa, payload, room: intent.room,
    https: `${org}${viewPath}#${payload}`,             // opens in ANY browser, no Hologram - the off-Hologram viewer
    holo: `holo://together/${intent.kappa}#${payload}`, // opens the in-app full session (interactive for Hologram peers)
  };
}

export async function parseSession(input) {
  let payload = String(input || "");
  if (payload.includes("#")) payload = payload.split("#").pop();
  if (payload.includes("/")) payload = payload.split("/").pop();
  let intent; try { intent = _b64urlDecode(payload); } catch { return { ok: false, error: "unreadable link" }; }
  if (!intent || intent.v !== TOGETHER_VERSION || !intent.room) return { ok: false, error: "not a valid Together link" };
  const integrity = (await _sha256hex(_canon(intent))) === intent.kappa;   // tamper check
  const expired = !!(intent.expires && Date.now() > intent.expires);
  return { ok: true, intent, integrity, expired };
}

// SYNC detect a Together link in a message body → { intent, url } for rendering the in-chat Join card. Display only
// (integrity verified at the viewer, where you actually join). null if not a Together link.
const _TOG_RE = /(https?:\/\/\S*together-view\.html#([A-Za-z0-9_-]+))|(holo:\/\/together\/\S*#([A-Za-z0-9_-]+))/;
export function togetherLinkInText(text) {
  const m = String(text || "").match(_TOG_RE); if (!m) return null;
  const payload = m[2] || m[4], url = m[0];
  try { const intent = _b64urlDecode(payload); if (intent && intent.v === TOGETHER_VERSION && intent.room) return { intent, url, payload }; } catch {}
  return null;
}
const _KIND = { watch: { verb: "watch", icon: "🎬", noun: "video" }, listen: { verb: "listen to", icon: "🎵", noun: "track" }, tab: { verb: "watch", icon: "🖥", noun: "screen" }, doc: { verb: "edit", icon: "📝", noun: "doc" }, game: { verb: "play", icon: "🎮", noun: "game" }, room: { verb: "join", icon: "✨", noun: "room" } };
export function describe(intent) {
  const k = _KIND[intent.kind] || _KIND.room;
  const who = intent.hostName || "Someone";
  const what = intent.title || k.noun;
  return { icon: k.icon, headline: `${who} invited you to ${k.verb} ${what}`, cta: intent.kind === "tab" ? "Watch live" : `Join to ${k.verb} together`, verb: k.verb };
}

// ── live mesh adapter (the room) ──────────────────────────────────────────────────────────────────────────────────
// Joining the room = rendezvous on `intent.room` over the existing co-presence engine (holo-kappa-room + holo-rtc +
// holo-pair), brokered by the host frame the same way Holo Pay brokers the wallet (window.HoloTogether, set by the
// shell/app when present). Off-Hologram (the standalone viewer) connects view-only via the signaling relay. Absent →
// a scaffold that reports "connecting" so the join UX round-trips before the live transport is wired end-to-end.
export function getMesh() {
  const t = (typeof window !== "undefined") && window.HoloTogether;
  if (t && (t.join || t.host)) return { mode: "live", t };
  return { mode: "scaffold", t: null };
}
export async function joinSession(intent, { onState = () => {}, onControl = () => {}, capability = "view" } = {}) {
  const { mode, t } = getMesh();
  if (mode === "live" && t.join) { try { return await t.join({ room: intent.room, signal: intent.signal, joinSecret: intent.joinSecret, capability, onState, onControl }); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } }
  onState({ phase: "scaffold", detail: "Live transport not wired in this context yet." });
  return { ok: true, live: false };
}
export async function hostSession(intent, { stream = null, control = false, onState = () => {}, onControl = () => {} } = {}) {
  const { mode, t } = getMesh();
  if (mode === "live" && t.host) { try { return await t.host({ room: intent.room, signal: intent.signal, joinSecret: intent.joinSecret, stream, control, onState, onControl }); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } }
  return { ok: true, live: false };
}
