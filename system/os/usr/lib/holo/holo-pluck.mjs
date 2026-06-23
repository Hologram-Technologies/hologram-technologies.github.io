// holo-pluck.mjs — PLUCK A MESSAGE INTO ETERNITY.
//
// A rendered message in any web app (WhatsApp Web, a tweet, an email row) is, to the
// Hologram browser, just pixels over a DOM subtree. This module lifts that exact
// rendered object — sender + text + timestamp + any media, AS DRAWN — into a
// self-verifying κ-object. The app's code is never touched: the browser owns the
// objects beneath it.
//
// Once plucked, the message is a content-addressed UOR object (holo-object.mjs): its
// identity IS the hash of its own canonical content. From the κ alone we derive a
// human truename, three speakable words, and a directly-reachable IPv6 locator — all
// deterministic projections of the same content (no registry, no server). Anyone
// opens the κ in Hologram and it re-derives byte-identical (Law L5); flip one byte and
// it is refused. WhatsApp need not be loaded, reachable, or even still exist.
//
// This is the SUBSTRATE seam. The browser-side capture (the CEF render-process hook
// that reads the DOM subtree) calls plucker()/mint() with byte-identical results,
// because holo-object/holo-uor are isomorphic (Node · browser · Service Worker).
//
// Authority: UOR object envelope (ADR-025) · RFC 8785 JCS · holospaces Law L1/L2/L5 ·
//   schema.org (Message/Person/MediaObject) · this file mints nothing new — it only
//   names the existing seal/verify/truename/locator/words primitives for "a message".

import { seal, verify, address, contentLink } from "./holo-object.mjs";
import { truenameOf } from "./holo-truename.mjs";
import { kappaToIPv6, kappaToCID, kappaToMultiaddr } from "./holo-locator.mjs";
import { kappaToWords } from "./holo-words.mjs";

const hexOf = (k) => String(k).split(":").pop();

// ── self-contained transport: the message rides in the link's #fragment ──
// A plucked text message is a few hundred bytes; base64url-JSON of its share payload
// fits in a URL fragment, which the browser NEVER sends to a server. So the link IS the
// message: open it and it resolves from its own bytes — no WhatsApp, no κ-store, no
// network. (Media leaves resolve by their own κ from the store; text needs nothing.)
// Isomorphic: Buffer in Node, btoa/atob in the browser/Service Worker.
export function encodePayload(payload) {
  const json = JSON.stringify(payload);
  if (typeof Buffer !== "undefined") return Buffer.from(json, "utf8").toString("base64url");
  const bytes = new TextEncoder().encode(json);
  let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function decodePayload(token) {
  if (typeof Buffer !== "undefined") return JSON.parse(Buffer.from(String(token), "base64url").toString("utf8"));
  const b64 = String(token).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes));
}

// shareLinkFor(object, base) → a self-contained link the receiving surface mounts. The
// payload is in the #fragment; the bytes never touch a server. base defaults to the
// frame page so it works from any origin (file://, the Hologram gateway, anywhere).
export function shareLinkFor(object, base = "/usr/share/frame/holopluck.html") {
  return base + "#m=" + encodePayload(sharePayload(object));
}

// renderModel(object) → the pure view-model the receiving surface paints (a faithful
// message bubble + verified provenance). No DOM here — Node can build + witness it.
export function renderModel(object, { wordlist = null } = {}) {
  const kappa = object.id || address(object);
  return {
    text: object["schema:text"] || "",
    sender: object["schema:sender"] || "",
    sentAt: object["schema:dateSent"] || "",
    chat: object["schema:isPartOf"] || "",
    source: object["holo:capturedFrom"] || "",
    media: (object.links || []).map((l) => ({ kappa: l.id, type: l["@type"] })),
    kappa,
    hex: hexOf(kappa),
    short: hexOf(kappa).slice(0, 8),
    truename: truenameOf(object),
    words: wordlist ? kappaToWords(kappa, wordlist) : null,
    ipv6: kappaToIPv6(kappa),
  };
}

// A short, stable headline re-projected from the message text — this becomes the
// truename slug ("the-future-is-light~..."), so the name speaks the message. It is
// part of the canonical content (it derives from the text), never a separate fact.
function headline(text, words = 6) {
  return String(text || "")
    .replace(/\s+/g, " ").trim()
    .split(" ").slice(0, words).join(" ")
    .slice(0, 48) || "message";
}

// messageObject(input) → the UNSEALED canonical UOR object for a rendered message.
// `input` is what the DOM capture produced; everything here is content (no id yet).
//   { text, sender, sentAt, chat, source, media? }
//   media?: [{ kappa, mime?, kind? }]  — each already content-addressed (a leaf edge)
// Strings only, sorted at hash time by JCS — so the κ is independent of field order.
export function messageObject({ text = "", sender = "", sentAt = "", chat = "", source = "", media = [] } = {}) {
  const links = (media || [])
    .filter((m) => m && m.kappa)
    .map((m) => contentLink(m.kind || "schema:associatedMedia", m.kappa, m.mime ? mediaType(m.mime) : "schema:MediaObject"));
  const obj = {
    "@context": [
      "https://schema.org/",
      { holo: "https://hologram.os/ns#" },
    ],
    "@type": ["schema:Message", "schema:Comment"],
    "schema:name": headline(text),
    "schema:text": String(text),
    ...(sender ? { "schema:sender": String(sender) } : {}),
    ...(sentAt ? { "schema:dateSent": String(sentAt) } : {}),
    ...(chat ? { "schema:isPartOf": String(chat) } : {}),
    ...(source ? { "holo:capturedFrom": String(source) } : {}),
    ...(links.length ? { links } : {}),
  };
  return obj;
}

const mediaType = (mime) =>
  /^image\//.test(mime) ? "schema:ImageObject" :
  /^video\//.test(mime) ? "schema:VideoObject" :
  /^audio\//.test(mime) ? "schema:AudioObject" : "schema:MediaObject";

// mint(input, { wordlist }) → the full plucked artifact. `wordlist` is the BIP-39 list
// (Node: defaultWordlist(); browser: HoloWords already holds it) — optional; words are
// omitted if absent. Everything else derives from the κ with no extra input.
export function mint(input, { wordlist = null } = {}) {
  const object = seal(messageObject(input));
  const kappa = object.id;
  const hex = hexOf(kappa);
  return {
    object,
    kappa,
    hex,
    truename: truenameOf(object),
    ipv6: kappaToIPv6(kappa),
    cid: kappaToCID(kappa),
    multiaddr: kappaToMultiaddr(kappa),
    words: wordlist ? kappaToWords(kappa, wordlist) : null,
    holoLink: "holo://" + hex,
    spaceLink: "/holospace.html?app=" + hex + "&bare=1",
    shareLink: shareLinkFor(object),     // self-contained, serverless — the demo link
    badge: badgeFor(object, wordlist),
  };
}

// the "minted" affordance the browser draws over the bubble — tiny, glanceable.
export function badgeFor(object, wordlist = null) {
  const kappa = object.id || address(object);
  return {
    words: wordlist ? kappaToWords(kappa, wordlist) : null,
    truename: truenameOf(object),
    short: hexOf(kappa).slice(0, 8),     // κ⌘ short form for the chip
  };
}

// ── VERIFY-BEFORE-TRUST (the consume side; what holospace.html runs before mounting) ──
// A shared payload is the object's own bytes plus the κ it CLAIMS to be. Admit only if
// the bytes re-derive to that exact κ (Law L5). Fail-closed on any mismatch — a tampered
// byte, a forged κ, a wrong-shape object. Returns the verified object or a refusal reason.
export function mountFromPayload(payload, { expectKappa = null } = {}) {
  if (!payload || typeof payload !== "object") return { ok: false, why: "no payload" };
  const object = payload.object || payload;
  const claimed = expectKappa || payload.kappa || object.id;
  if (!claimed) return { ok: false, why: "no claimed κ" };
  if (!object || object.id !== claimed) return { ok: false, why: "object id ≠ claimed κ" };
  if (!verify(object)) return { ok: false, why: "content does not re-derive to its κ (tampered)" };
  if (hexOf(address(object)) !== hexOf(claimed)) return { ok: false, why: "address mismatch" };
  return { ok: true, object, kappa: claimed };
}

// A compact, self-contained share payload: the object plus its κ. No server needed to
// resolve — the bytes ARE the message and the κ proves them. (Media leaves resolve from
// the κ-store by their own κ; text needs nothing.)
export const sharePayload = (object) => ({ kappa: object.id, object });

// ── browser binding: window.HoloPluck — the seam the CEF capture hook calls in-page ──
// The render-process hook builds `input` from the DOM subtree, then window.HoloPluck
// mints with the already-loaded wordlist. Kept tiny + dependency-free at the call site.
if (typeof window !== "undefined" && !window.HoloPluck) {
  let _wl = null;
  const wl = async () => {
    if (_wl) return _wl;
    try { const m = await import("./holo-words.mjs"); _wl = await m.defaultWordlist(); } catch { _wl = null; }
    return _wl;
  };
  window.HoloPluck = {
    messageObject,
    mint: async (input) => mint(input, { wordlist: await wl() }),
    badge: async (object) => badgeFor(object, await wl()),
    mount: (payload, opts) => mountFromPayload(payload, opts),
    render: async (object) => renderModel(object, { wordlist: await wl() }),
    sharePayload, encodePayload, decodePayload, shareLinkFor,
  };
}
