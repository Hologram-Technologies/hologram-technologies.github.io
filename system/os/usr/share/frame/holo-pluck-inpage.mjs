// holo-pluck-inpage.mjs — the CEF render-process capture hook, in-page.
//
// This is what the Hologram native browser injects into a THIRD-PARTY page (web.whatsapp
// .com) — the place the browser asserts ownership of the objects beneath the app. It runs
// in the page's world, touches none of WhatsApp's code, and turns any rendered message
// bubble into a κ-object byte-identical to holo-pluck.mjs / holo-object.mjs (same JCS, same
// SHA-256), so the κ a user plucks here is the SAME κ that mounts in a Hologram surface.
//
// WIRING (production): CefRenderProcessHandler::OnContextCreated, for frames whose origin
// is a non-holo web app, evaluates this module. For testing today it is also a bookmarklet:
//   javascript:(async()=>{const m=await import('holo://os/usr/share/frame/holo-pluck-inpage.mjs');m.installPluck();})()
// or paste the IIFE in holo-pluck-bookmarklet.js into DevTools on the WhatsApp tab.
//
// Pure + dependency-free (no fetch, no Hologram origin needed): SHA-256 via WebCrypto,
// truename via inlined proquint. The three speakable words are filled in by the Hologram
// surface when the κ is opened (it has the BIP-39 wordlist); here we show truename + κ⌘.

// ── JCS (RFC 8785), identical to holo-uor.mjs jcs ──
export const jcsCanon = (v) =>
  Array.isArray(v) ? "[" + v.map(jcsCanon).join(",") + "]" :
  (v && typeof v === "object") ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcsCanon(v[k])).join(",") + "}" :
  JSON.stringify(v);

// ── headline(): identical to holo-pluck.mjs (the truename slug speaks the message) ──
const headline = (text, words = 6) =>
  String(text || "").replace(/\s+/g, " ").trim().split(" ").slice(0, words).join(" ").slice(0, 48) || "message";

const mediaType = (mime) =>
  /^image\//.test(mime) ? "schema:ImageObject" :
  /^video\//.test(mime) ? "schema:VideoObject" :
  /^audio\//.test(mime) ? "schema:AudioObject" : "schema:MediaObject";

// ── buildMessageObject(input): identical content to holo-pluck.mjs messageObject ──
// (media leaves are built by the caller via contentLink-equivalent; text path needs none)
export function buildMessageObject({ text = "", sender = "", sentAt = "", chat = "", source = "", links = [] } = {}) {
  return {
    "@context": ["https://schema.org/", { holo: "https://hologram.os/ns#" }],
    "@type": ["schema:Message", "schema:Comment"],
    "schema:name": headline(text),
    "schema:text": String(text),
    ...(sender ? { "schema:sender": String(sender) } : {}),
    ...(sentAt ? { "schema:dateSent": String(sentAt) } : {}),
    ...(chat ? { "schema:isPartOf": String(chat) } : {}),
    ...(source ? { "holo:capturedFrom": String(source) } : {}),
    ...(links.length ? { links } : {}),
  };
}

// ── SHA-256 (WebCrypto / Node globalThis.crypto) → the same hex the Node spine produces ──
async function sha256hex(str) {
  const bytes = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── proquint (RFC-of-folklore), identical to holo-proquint.mjs encode, for the truename tail ──
const PQ_C = "bdfghjklmnprstvz", PQ_V = "aiou";
function proquint16(hi, lo) {                       // one 16-bit group → 5-char quint
  const x = (hi << 8) | lo;
  return PQ_C[(x >> 12) & 15] + PQ_V[(x >> 10) & 3] + PQ_C[(x >> 6) & 15] + PQ_V[(x >> 4) & 3] + PQ_C[x & 15];
}
const slugOf = (text) =>
  headline(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "holo";
function truenameFromHex(hex, text, quints = 3) {
  let tail = [];
  for (let i = 0; i < quints; i++) tail.push(proquint16(parseInt(hex.substr(i * 4, 2), 16), parseInt(hex.substr(i * 4 + 2, 2), 16)));
  return `${slugOf(text)}~${tail.join("-")}`;
}

// ── pluckKappa(input) → { kappa, hex, object, truename, holoLink, spaceLink } ──
// The whole mint, in-page, byte-identical to the substrate. (No wordlist here → no words;
// the Hologram surface adds the three words when the κ-link is opened.)
export async function pluckKappa(input) {
  const object = buildMessageObject(input);
  const hex = await sha256hex(jcsCanon(object));          // address() strips id; there is none pre-seal
  const kappa = "did:holo:sha256:" + hex;
  object.id = kappa;                                       // seal()
  return {
    object, kappa, hex,
    truename: truenameFromHex(hex, input.text),
    holoLink: "holo://" + hex,
    spaceLink: "/holospace.html?app=" + hex + "&bare=1",
    shareLink: shareLinkFor(object),                       // self-contained — opens in any Hologram surface
  };
}

// the self-contained link: the message rides in the #fragment (base64url JSON), so it
// never touches a server. Base is the Hologram-origin receiving surface.
export function shareLinkFor(object, base = "holo://os/usr/share/frame/holopluck.html") {
  const json = JSON.stringify({ kappa: object.id, object });
  const bytes = new TextEncoder().encode(json);
  let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
  const tok = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return base + "#m=" + tok;
}

// ── DOM capture for WhatsApp Web: read a rendered bubble's drawn fields ──
// data-pre-plain-text is WhatsApp's own "[08:31, 6/23/2026] Ilya: " caption; the text is
// the selectable span. We read what is DRAWN — nothing from WhatsApp's internals.
export function readBubble(row) {
  const cap = row.querySelector("[data-pre-plain-text]") || row.querySelector(".copyable-text[data-pre-plain-text]");
  const pre = cap && cap.getAttribute("data-pre-plain-text");
  const m = pre && /^\[([^,\]]+),[^\]]*\]\s*(.*?):\s*$/.exec(pre);
  const textEl = row.querySelector("span.selectable-text") || row.querySelector(".copyable-text span") || cap;
  const text = (textEl && (textEl.innerText || textEl.textContent) || "").trim();
  const chatTitle = (document.querySelector('header [role="button"] span[title]') || document.querySelector("header span[title]"));
  return {
    text,
    sentAt: m ? m[1].trim() : "",
    sender: m ? m[2].trim() : "",
    chat: chatTitle ? (chatTitle.getAttribute("title") || chatTitle.textContent || "").trim() : "",
    source: location.hostname,
  };
}

// ── installPluck(): hover a bubble → a κ chip; click it → mint + copy the holo:// link ──
export function installPluck({ selector = "div.message-in, div.message-out, div[role='row']" } = {}) {
  if (typeof document === "undefined") return () => {};
  const STYLE = "position:absolute;top:4px;right:8px;font:11px/1.4 ui-monospace,monospace;background:#0b141a;color:#8696a0;border:1px solid #2a3942;border-radius:10px;padding:2px 8px;cursor:pointer;z-index:9999;opacity:.85;user-select:none";
  async function chipFor(row) {
    if (row.__holoChip) return;
    const input = readBubble(row);
    if (!input.text) return;
    const { kappa, hex, truename, holoLink, shareLink } = await pluckKappa(input);
    const chip = document.createElement("div");
    chip.setAttribute("style", STYLE);
    chip.textContent = "κ " + hex.slice(0, 8) + " · " + truename;
    chip.title = "Pluck into eternity — click to copy the shareable link";
    chip.onclick = async (e) => {
      e.stopPropagation();
      try { await navigator.clipboard.writeText(shareLink); } catch {}
      chip.textContent = "✓ minted · " + hex.slice(0, 8);
      console.log("[holo-pluck]", { kappa, truename, holoLink, shareLink, object: (await pluckKappa(input)).object });
    };
    if (getComputedStyle(row).position === "static") row.style.position = "relative";
    row.appendChild(chip);
    row.__holoChip = chip;
  }
  const scan = () => document.querySelectorAll(selector).forEach((r) => { r.addEventListener("mouseenter", () => chipFor(r), { once: true }); });
  scan();
  const mo = new MutationObserver(scan);
  mo.observe(document.body, { childList: true, subtree: true });
  console.log("[holo-pluck] installed — hover any message bubble to mint its κ");
  return () => mo.disconnect();
}

// auto-install when injected into a live WhatsApp tab (not when imported by the witness)
if (typeof window !== "undefined" && typeof document !== "undefined" && /whatsapp\.com$/.test(location.hostname)) {
  installPluck();
}
