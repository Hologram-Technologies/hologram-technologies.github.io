// holo-bridge-adapters.mjs — ONE BRIDGE PER PLATFORM, AS DATA.
//
// Beeper unifies messengers with a re-implemented protocol bridge per service
// (mautrix-whatsapp, -telegram, -signal, -meta, -discord, -slack, …). Hologram needs
// none of that: the message is already RENDERED in an authenticated web client running
// in the native CEF browser. holo-pluck.mjs already lifts a rendered WhatsApp bubble into
// a self-verifying κ. This module is the only generalisation that buys: it turns the
// WhatsApp-specific DOM read (holo-pluck-inpage.readBubble) into a per-platform ADAPTER
// REGISTRY — a small selector map per platform (DATA), not new protocol code.
//
// Every adapter feeds the SAME messageObject() shape { text, sender, sentAt, chat, source,
// media }, so the κ is platform-agnostic: the same words sent on WhatsApp and on Telegram
// mint the SAME κ (holospaces SEC-3 dedup; one identity network-wide). Adding a platform =
// adding a config entry below. No bridge wizard, no homeserver.
//
// Scope: this layer captures WHAT THE WEB CLIENT RENDERS for the logged-in user — the same
// decrypted view Beeper's own-session bridges relay. It mints the message CONTENT κ (the
// holo-apps §2.6 event BODY). Ordering/parents/epoch/Lamport (the event HEADER) and the
// signature axis are the holo-strand layer (the conversation chain) — see Phase 3. Send,
// TEE step-up gating and PQ epoch keys are Phases 4–5. Selector correctness against the
// live sites is provable only in a real browser (Phase 8); this module + its witness prove
// adapter resolution, field extraction over controlled DOM, and κ stability/dedup.
//
// Authority: holo-apps §2.6 (event schema) · holospaces SEC-1 (verify-on-receipt) · SEC-3
//   (dedup / one κ network-wide) · Law L1/L2/L5 · schema.org Message · RFC 8785 JCS.
//
// Pure + dependency-free + isomorphic (Node · browser · Service Worker): it reads DOM nodes
// through the standard querySelector/getAttribute/textContent surface, so the SAME adapter
// code runs in-page (real DOM) and under the witness (a controlled DOM fixture).

// ── the registry: each platform is a selector map (DATA) ──────────────────────────────
// adapter = {
//   id, label, glyph,            // identity + a quiet UI glyph
//   hosts: [host-suffix, …],     // which web clients this adapter owns
//   rowSelector,                 // a rendered message row/bubble
//   sel: {                       // where the fields are DRAWN inside a row (comma = fallbacks)
//     text, sender?, senderAttr?, time?, timeAttr?, chatTitle?, chatTitleAttr?
//   },
//   caption?: {                  // a single pre-formatted caption (e.g. WhatsApp's "[time, date] sender:")
//     selector, attr, re, timeGroup, senderGroup
//   },
// }
export const ADAPTERS = [
  {
    id: "whatsapp", label: "WhatsApp", glyph: "🟢",
    hosts: ["web.whatsapp.com"],
    rowSelector: "div.message-in, div.message-out, div[role='row']",
    sel: {
      text: "span.selectable-text, .copyable-text span",
      chatTitle: "header [role='button'] span[title], header span[title]",
      chatTitleAttr: "title",
    },
    caption: {
      selector: "[data-pre-plain-text], .copyable-text[data-pre-plain-text]",
      attr: "data-pre-plain-text",
      re: /^\[([^,\]]+),[^\]]*\]\s*(.*?):\s*$/, timeGroup: 1, senderGroup: 2,
    },
  },
  {
    id: "telegram", label: "Telegram", glyph: "🔵",
    hosts: ["web.telegram.org"],
    rowSelector: ".message, .Message, div[data-mid]",
    sel: {
      text: ".text-content, .message-text, .translatable-message",
      sender: ".peer-title, .sender-title, .message-title-name",
      time: ".time, .message-time, .MessageMeta time", timeAttr: "title",
      chatTitle: ".chat-info .title, .ChatInfo .title, .top .info .title",
    },
  },
  {
    id: "discord", label: "Discord", glyph: "🟣",
    hosts: ["discord.com", "discordapp.com"],
    rowSelector: "li[id^='chat-messages'], div[class*='message_']",
    sel: {
      text: "div[id^='message-content'], div[class*='messageContent']",
      sender: "span[id^='message-username'] span, span[class*='username']",
      time: "time", timeAttr: "datetime",
      chatTitle: "section[aria-label] h1, h1[class*='title'], div[class*='title'] h3",
    },
  },
  {
    id: "slack", label: "Slack", glyph: "🟡",
    hosts: ["app.slack.com"],
    rowSelector: "div[data-qa='message_container'], div.c-message_kit__message",
    sel: {
      text: "div.c-message__body, div.p-rich_text_section, span.c-message__body",
      sender: "a.c-message__sender_link, span[data-qa='message_sender_name'], button.c-message__sender_button",
      time: "a.c-timestamp, span.c-timestamp", timeAttr: "aria-label",
      chatTitle: "div.p-view_header__channel_title, span[data-qa='channel_name']",
    },
  },
  // additional platforms — resolved by URL today; extraction selectors present, fixture
  // proof for these comes with each one's first live-tab verify (honest: not yet witnessed).
  {
    id: "x", label: "X", glyph: "⚫",
    hosts: ["x.com", "twitter.com", "mobile.twitter.com"],
    rowSelector: "div[data-testid='messageEntry']",
    sel: {
      text: "div[data-testid='tweetText'], div[data-testid='messageEntry'] span",
      time: "time", timeAttr: "datetime",
      chatTitle: "div[data-testid='DM_Conversation_Avatar'] + div span, h2[role='heading'] span",
    },
  },
  {
    id: "messenger", label: "Messenger", glyph: "🔷",
    hosts: ["www.messenger.com", "messenger.com"],
    rowSelector: "div[role='row'], div[data-scope='messages_table']",
    sel: {
      text: "div[dir='auto'] span, div[data-content-type='text']",
      chatTitle: "div[role='main'] h1 span, span[role='heading']",
    },
  },
  {
    id: "instagram", label: "Instagram", glyph: "🟠",
    hosts: ["www.instagram.com", "instagram.com"],
    rowSelector: "div[role='row'], div[data-scope='messages_table']",
    sel: {
      text: "div[dir='auto'] span, div[data-content-type='text']",
      chatTitle: "div[role='main'] header span, span[role='heading']",
    },
  },
  {
    id: "linkedin", label: "LinkedIn", glyph: "🔹",
    hosts: ["www.linkedin.com", "linkedin.com"],
    rowSelector: "li.msg-s-event-listitem, div.msg-s-event-listitem",
    sel: {
      text: ".msg-s-event-listitem__body, p.msg-s-event-listitem__body",
      sender: ".msg-s-message-group__name, span.msg-s-message-group__profile-link",
      time: "time.msg-s-message-group__timestamp, time", timeAttr: "datetime",
      chatTitle: "h2.msg-entity-lockup__entity-title, div.msg-thread__topbar h2",
    },
  },
  {
    id: "gmessages", label: "Google Messages", glyph: "🟦",
    hosts: ["messages.google.com"],
    rowSelector: "mws-message-wrapper, div[data-e2e-message-wrapper]",
    sel: {
      text: "mws-text-message-part .text-msg-content, div.text-msg-content",
      time: "mws-relative-timestamp, span.timestamp", timeAttr: "title",
      chatTitle: "mws-conversation-title span, h2.conversation-title",
    },
  },
];

// host-suffix match: web.whatsapp.com matches the whatsapp adapter; subdomains allowed.
const hostOf = (urlOrHost = "") => {
  const s = String(urlOrHost);
  try { if (/^[a-z]+:\/\//i.test(s)) return new URL(s).hostname; } catch {}
  return s.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];
};

// resolveAdapter(urlOrHost) → the adapter that owns this web client, or null (SEC-6: a
// name→adapter binding; it only SELECTS a parser, it never authenticates content — the κ
// does that on receipt).
export function resolveAdapter(urlOrHost) {
  const host = hostOf(urlOrHost).toLowerCase();
  if (!host) return null;
  for (const a of ADAPTERS)
    for (const h of a.hosts)
      if (host === h || host.endsWith("." + h)) return a;
  return null;
}

// ── field extraction: ONE generic reader, driven by the adapter's selector map ─────────
const txt = (node) => (node && (node.innerText != null ? node.innerText : node.textContent) || "").trim();
const firstMatch = (root, multiSel) => {
  if (!root || !multiSel) return null;
  for (const part of String(multiSel).split(",")) {
    const sel = part.trim(); if (!sel) continue;
    const found = root.querySelector(sel);
    if (found) return found;
  }
  return null;
};
const attrOf = (node, name) => (node && typeof node.getAttribute === "function" ? node.getAttribute(name) : null);

// captureRow(adapter, row, doc, loc) → the messageObject input { text, sender, sentAt,
// chat, source }. Reads only what is DRAWN, through the standard DOM surface. `doc` is the
// document (for the chat title), `loc` is location (for the source host).
export function captureRow(adapter, row, doc = (typeof document !== "undefined" ? document : null), loc = (typeof location !== "undefined" ? location : null)) {
  if (!adapter || !row) return null;
  const sel = adapter.sel || {};
  let sender = "", sentAt = "";

  if (adapter.caption) {
    const cap = firstMatch(row, adapter.caption.selector);
    const pre = cap && attrOf(cap, adapter.caption.attr);
    const m = pre && adapter.caption.re.exec(pre);
    if (m) { sentAt = (m[adapter.caption.timeGroup] || "").trim(); sender = (m[adapter.caption.senderGroup] || "").trim(); }
  }

  const text = txt(firstMatch(row, sel.text));
  if (!sender && sel.sender) {
    const n = firstMatch(row, sel.sender);
    sender = (sel.senderAttr ? (attrOf(n, sel.senderAttr) || "") : txt(n)).trim();
  }
  if (!sentAt && sel.time) {
    const n = firstMatch(row, sel.time);
    sentAt = (sel.timeAttr ? (attrOf(n, sel.timeAttr) || "") : txt(n)).trim();
  }
  let chat = "";
  if (sel.chatTitle && doc) {
    const n = firstMatch(doc, sel.chatTitle);
    chat = (sel.chatTitleAttr ? (attrOf(n, sel.chatTitleAttr) || "") : txt(n)).trim();
  }
  const source = (loc && loc.hostname) || hostOf(adapter.hosts[0]) || "";
  return { text, sender, sentAt, chat, source };
}

// captureAll(adapter, doc, loc) → inputs for every currently-rendered row (text-only rows;
// empty rows are skipped, matching the pluck spine).
export function captureAll(adapter, doc = (typeof document !== "undefined" ? document : null), loc) {
  if (!adapter || !doc) return [];
  const rows = doc.querySelectorAll ? doc.querySelectorAll(adapter.rowSelector) : [];
  const out = [];
  rows.forEach && rows.forEach((row) => {
    const input = captureRow(adapter, row, doc, loc);
    if (input && input.text) out.push({ row, input });
  });
  return out;
}

// ── browser binding: install live capture on whatever platform tab we're injected into ──
// Emits each newly-rendered message's pluck input to onMessage. Transport (announce over
// the gossip net) + the conversation strand are wired in Phase 3 by the caller; this stays
// a thin, dependency-free observer so it can run in any third-party page's world.
export function installBridgeCapture({ onMessage, doc = (typeof document !== "undefined" ? document : null), loc = (typeof location !== "undefined" ? location : null) } = {}) {
  if (!doc || typeof doc.querySelectorAll !== "function") return () => {};
  const adapter = resolveAdapter((loc && loc.hostname) || "");
  if (!adapter) return () => {};
  const seen = new WeakSet();
  const emit = (row) => {
    if (seen.has(row)) return; seen.add(row);
    const input = captureRow(adapter, row, doc, loc);
    if (input && input.text && typeof onMessage === "function") onMessage(input, { adapter, row });
  };
  const scan = () => doc.querySelectorAll(adapter.rowSelector).forEach(emit);
  scan();
  let stop = () => {};
  if (typeof MutationObserver !== "undefined" && doc.body) {
    const mo = new MutationObserver(scan);
    mo.observe(doc.body, { childList: true, subtree: true });
    stop = () => mo.disconnect();
  }
  return stop;
}

if (typeof window !== "undefined" && !window.HoloBridgeAdapters) {
  window.HoloBridgeAdapters = { ADAPTERS, resolveAdapter, captureRow, captureAll, installBridgeCapture };
}
