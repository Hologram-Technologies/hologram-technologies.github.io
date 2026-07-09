// holo-chat-link.mjs — M1: THE SINGLE LINK IS THE DOOR.
//
// A live conversation, shareable and runnable from ONE self-contained web link. The descriptor travels
// INSIDE the link (b64url JSON in the URL fragment) exactly like holo-together.mjs / holo-pay.mjs — a bare
// browser with NO Hologram opens it, verifies it locally, derives the room, and joins live. The κ is
// SHA-256 of the canonical PUBLIC fields (integrity + shareable id); the bearer `joinSecret` (private
// rooms) is EXCLUDED from the κ — whoever holds the link may join, that IS the design.
//
// This is NOT the `#chat=` route (that is a Q-conversation SNAPSHOT restore in holo-voice.js). This is a
// live context-room JOIN — the Together link shape, keyed by a HoloChat context so the opener derives the
// SAME room as everyone else. Laws: L1 room derived from ctx, L2 canonical, L5 verify by re-derivation.

import { canonContext, contextRoom, signalBase } from "./holo-chat-context.mjs";

export const CHAT_LINK_VERSION = 1;
const VIEW_PATH = "/apps/holo-messenger/chat-view.html";

const _te = new TextEncoder();
async function _sha256hex(s) { const h = await (globalThis.crypto || crypto).subtle.digest("SHA-256", _te.encode(s)); return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
function _b64urlEncode(obj) { const b = btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function _b64urlDecode(str) { const b = String(str).replace(/-/g, "+").replace(/_/g, "/"); return JSON.parse(decodeURIComponent(escape(atob(b)))); }
function _randHex(n) { const b = (globalThis.crypto || crypto).getRandomValues(new Uint8Array(n)); return [...b].map((x) => x.toString(16).padStart(2, "0")).join(""); }

// canonical PUBLIC form — joinSecret EXCLUDED so the κ is the shareable id. The ctx is committed via
// canonContext (the SAME bytes contextRoom hashes), so the link provably commits to exactly one room.
function _canon(d) {
  // canonContext commits kind+ref (the ROOM identity — label-independent, so re-labels still converge);
  // the link ALSO commits the display label + host, so a tampered invite card breaks integrity (anti-phish).
  return ["v" + (d.v | 0), d.kind || "chat", canonContext(d.ctx || {}), String((d.ctx && d.ctx.label) || ""), d.signal || "", d.capability || "talk", d.hostName || "", String(d.created || 0), String(d.expires || 0)].join("␟");
}

// build a shareable link for a HoloChat context. `capability`: "talk" (default) or "view".
// `joinSecret`: pass true to mint a bearer token (private room); omit for a public-context room.
export async function makeChatLink(ctx, { capability = "talk", hostName = "", ttlSeconds = 7 * 24 * 3600, signal = null, joinSecret = false, origin = null, nowMs = null } = {}) {
  if (!ctx || !ctx.kind) throw new Error("a context {kind, ref} is required");
  const now = nowMs || Date.now();
  const d = {
    v: CHAT_LINK_VERSION, kind: "chat",
    ctx: { kind: String(ctx.kind), ref: ctx.ref, label: String(ctx.label || "").slice(0, 120) },
    signal: signal || signalBase(), capability: capability === "view" ? "view" : "talk",
    hostName: String(hostName || "").slice(0, 60), created: now, expires: now + ttlSeconds * 1000,
  };
  if (joinSecret) d.joinSecret = _randHex(16);           // bearer token — NOT part of the κ
  d.kappa = await _sha256hex(_canon(d));
  const payload = _b64urlEncode(d);
  const org = origin || (typeof location !== "undefined" ? location.origin : "");
  return { kappa: d.kappa, payload, descriptor: d,
    https: `${org}${VIEW_PATH}#${payload}`,          // opens in ANY browser, off-Hologram
    holo: `holo://chat/${d.kappa}#${payload}` };     // in-shell full surface
}

// parse a link (URL, holo:// form, or bare payload) → { ok, descriptor, integrity, expired }.
export async function parseChatLink(input, { nowMs = null } = {}) {
  let payload = String(input || "");
  if (payload.includes("#")) payload = payload.split("#").pop();
  if (payload.includes("/")) payload = payload.split("/").pop();
  let d; try { d = _b64urlDecode(payload); } catch { return { ok: false, error: "unreadable link" }; }
  if (!d || d.v !== CHAT_LINK_VERSION || d.kind !== "chat" || !d.ctx || !d.ctx.kind || !d.kappa) return { ok: false, error: "not a valid chat link" };
  const integrity = (await _sha256hex(_canon(d))) === d.kappa;   // Law L5: re-derive; tamper → false
  const expired = !!(d.expires && (nowMs || Date.now()) > d.expires);
  return { ok: true, descriptor: d, integrity, expired };
}

// convenience: verify + resolve to the joinable room (only if integrity holds and not expired).
export async function resolveChatLink(input, opts = {}) {
  const p = await parseChatLink(input, opts);
  if (!p.ok || !p.integrity || p.expired) return { ...p, ok: false, reason: !p.ok ? p.error : (!p.integrity ? "tampered" : "expired") };
  const cr = await contextRoom(p.descriptor.ctx);
  return { ok: true, descriptor: p.descriptor, cr, room: cr.room, joinSecret: p.descriptor.joinSecret || null };
}

// a short human line for the landing card, mirroring together.describe().
export function describe(d) {
  const who = (d && d.hostName) || "Someone";
  const what = (d && d.ctx && d.ctx.label) || "a conversation";
  return { headline: `${who} invited you to ${d && d.capability === "view" ? "follow" : "talk in"} ${what}`, cta: d && d.capability === "view" ? "Join to watch" : "Join the conversation" };
}

export function installChatLink() {
  if (typeof window === "undefined") return false;
  window.HoloChatLink = Object.assign(window.HoloChatLink || {}, { version: CHAT_LINK_VERSION, makeChatLink, parseChatLink, resolveChatLink, describe });
  return true;
}
try { installChatLink(); } catch {}
