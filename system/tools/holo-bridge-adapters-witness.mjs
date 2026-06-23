#!/usr/bin/env node
// holo-bridge-adapters-witness.mjs — ONE BRIDGE PER PLATFORM, AS DATA — proven in Node.
//
// Beeper needs a re-implemented protocol bridge per service. Holo Messenger needs only a
// per-platform DOM selector map (holo-bridge-adapters.mjs) feeding the EXISTING pluck spine.
// This witness drives four real platforms (WhatsApp, Telegram, Discord, Slack) through a
// CONTROLLED DOM fixture — the SAME adapter code that runs in-page runs here, only the DOM
// nodes are fakes — and proves:
//   RESOLVE  → each web-client host resolves to the right adapter; unknown host → null (SEC-6)
//   CAPTURE  → each adapter extracts {text,sender,sentAt,chat,source} from a rendered row
//   PARITY   → the WhatsApp adapter reproduces the canonical pluck TARGET byte-for-byte
//   KAPPA    → every captured message mints a self-verifying κ (Law L1/L2/L5, SEC-1)
//   DEDUP    → the SAME content captured by two different adapters mints ONE κ (SEC-3)
//   REFUSE   → tampering a captured message's bytes is refused fail-closed (Law L5)
//
//   node tools/holo-bridge-adapters-witness.mjs
//
// Honest boundary: selector CORRECTNESS against the live sites is provable only in a real
// browser (Phase 8). This proves adapter resolution, extraction over controlled DOM, and κ
// stability/dedup — the platform-agnostic substrate the unified inbox stands on.
//
// Authority: holo-apps §2.6 (event body) · holospaces SEC-1/SEC-3/SEC-6 · Law L1/L2/L5 ·
//   RFC 8785 JCS · FIPS 180-4 · schema.org Message.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mint, mountFromPayload, sharePayload, messageObject } from "../os/usr/lib/holo/holo-pluck.mjs";
import { verify } from "../os/usr/lib/holo/holo-object.mjs";
import { ADAPTERS, resolveAdapter, captureRow, captureAll } from "../os/usr/lib/holo/holo-bridge-adapters.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

// ── a tiny controlled DOM: real querySelector grammar, fake nodes ──────────────────────
// supports: tag · .class · [attr] · [attr=v] · [attr^=v] · [attr$=v] · [attr*=v] · descendants
function parseSimple(tok) {
  const tagM = /^([a-zA-Z*][\w-]*)/.exec(tok);
  const classes = [...tok.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const attrs = [...tok.matchAll(/\[([\w-]+)(?:(\^=|\$=|\*=|=)(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g)]
    .map((m) => ({ name: m[1], op: m[2] || null, val: m[3] != null ? m[3] : (m[4] != null ? m[4] : (m[5] != null ? m[5] : null)) }));
  return { tag: tagM ? tagM[1] : null, classes, attrs };
}
function matchSimple(node, s) {
  if (s.tag && s.tag !== "*" && (node.tag || "").toLowerCase() !== s.tag.toLowerCase()) return false;
  for (const c of s.classes) if (!node.classList.includes(c)) return false;
  for (const a of s.attrs) {
    const v = node.getAttribute(a.name);
    if (a.op == null) { if (v == null) return false; continue; }
    if (v == null) return false;
    if (a.op === "=" && v !== a.val) return false;
    if (a.op === "^=" && !v.startsWith(a.val)) return false;
    if (a.op === "$=" && !v.endsWith(a.val)) return false;
    if (a.op === "*=" && !v.includes(a.val)) return false;
  }
  return true;
}
function matchChain(node, chain) {
  if (!matchSimple(node, chain[chain.length - 1])) return false;
  let i = chain.length - 2, p = node.parent;
  while (i >= 0 && p) { if (matchSimple(p, chain[i])) i--; p = p.parent; }
  return i < 0;
}
function descendants(root) { const out = []; (function walk(n) { for (const c of n.children) { out.push(c); walk(c); } })(root); return out; }
function qsa(root, selList) {
  const cands = descendants(root), res = [], seen = new Set();
  const chains = selList.split(",").map((p) => p.trim().split(/\s+/).filter(Boolean).map(parseSimple)).filter((c) => c.length);
  for (const node of cands) for (const chain of chains) {
    if (!seen.has(node) && matchChain(node, chain)) { seen.add(node); res.push(node); break; }
  }
  return res;
}
function h(tag, attrs = {}, kids = []) {
  const node = { tag, _attrs: { ...attrs }, children: [], parent: null, _text: null };
  if (typeof kids === "string") node._text = kids;
  else for (const k of kids) { k.parent = node; node.children.push(k); }
  node.classList = String(node._attrs.class || "").split(/\s+/).filter(Boolean);
  node.getAttribute = (n) => (n in node._attrs ? String(node._attrs[n]) : null);
  node.querySelectorAll = (sel) => qsa(node, sel);
  node.querySelector = (sel) => qsa(node, sel)[0] || null;
  Object.defineProperty(node, "textContent", { get() { return node._text != null ? node._text : node.children.map((c) => c.textContent).join(""); } });
  Object.defineProperty(node, "innerText", { get() { return node.textContent; } });
  return node;
}

// ── the canonical target (identical to the pluck witness) — the WhatsApp adapter must reach it ──
const TARGET = { text: "The future is light photonics. HOLOGRAM.", sender: "Ilya", sentAt: "08:31", chat: "Ilya", source: "web.whatsapp.com" };
const canonical = mint(TARGET);

// ── fixtures: realistic rendered rows for four platforms ───────────────────────────────
const docWA = h("div", {}, [
  h("header", {}, [h("div", { role: "button" }, [h("span", { title: "Ilya" }, "Ilya")])]),
  h("div", { class: "message-in" }, [
    h("div", { class: "copyable-text", "data-pre-plain-text": "[08:31, 6/23/2026] Ilya: " }, [
      h("span", { class: "selectable-text" }, "The future is light photonics. HOLOGRAM."),
    ]),
  ]),
]);
const rowWA = docWA.querySelector("div.message-in");

const docTG = h("div", {}, [
  h("div", { class: "ChatInfo" }, [h("div", { class: "title" }, "Hologram")]),
  h("div", { class: "message", "data-mid": "1" }, [
    h("div", { class: "sender-title" }, "Bob"),
    h("div", { class: "text-content" }, "gm from Telegram"),
    h("div", { class: "message-time", title: "09:00" }, "09:00"),
  ]),
]);
const rowTG = docTG.querySelector("div.message");

const docDC = h("div", {}, [
  h("section", { "aria-label": "general" }, [h("h1", {}, "general")]),
  h("li", { id: "chat-messages-123" }, [
    h("h3", {}, [h("span", { id: "message-username-1" }, [h("span", { class: "username-abc" }, "carol")])]),
    h("div", { id: "message-content-123" }, "ship it"),
    h("time", { datetime: "2026-06-23T09:01:00Z" }, "9:01 AM"),
  ]),
]);
const rowDC = docDC.querySelector("li[id^='chat-messages']");

const docSL = h("div", {}, [
  h("div", { class: "p-view_header__channel_title" }, "eng"),
  h("div", { "data-qa": "message_container" }, [
    h("a", { class: "c-message__sender_link" }, "Dave"),
    h("div", { class: "c-message__body" }, "deploy is green"),
    h("a", { class: "c-timestamp", "aria-label": "09:02" }, "9:02"),
  ]),
]);
const rowSL = docSL.querySelector("div[data-qa='message_container']");

const A = (id) => ADAPTERS.find((a) => a.id === id);

// ── 1 · RESOLVE — host → the right adapter; unknown → null (SEC-6: selects a parser, never trusts) ──
ok("resolve-host-to-adapter",
  resolveAdapter("web.whatsapp.com")?.id === "whatsapp" &&
  resolveAdapter("https://web.telegram.org/k/")?.id === "telegram" &&
  resolveAdapter("discord.com")?.id === "discord" &&
  resolveAdapter("sub.discord.com")?.id === "discord" &&
  resolveAdapter("app.slack.com")?.id === "slack" &&
  resolveAdapter("x.com")?.id === "x" &&
  resolveAdapter("example.com") === null,
  "adapter resolution by host suffix");

// ── 2 · CAPTURE — each adapter extracts the drawn fields ──
const capWA = captureRow(A("whatsapp"), rowWA, docWA, { hostname: "web.whatsapp.com" });
const capTG = captureRow(A("telegram"), rowTG, docTG, { hostname: "web.telegram.org" });
const capDC = captureRow(A("discord"), rowDC, docDC, { hostname: "discord.com" });
const capSL = captureRow(A("slack"), rowSL, docSL, { hostname: "app.slack.com" });

ok("capture-whatsapp", capWA.text === TARGET.text && capWA.sender === "Ilya" && capWA.sentAt === "08:31" && capWA.chat === "Ilya" && capWA.source === "web.whatsapp.com", JSON.stringify(capWA));
ok("capture-telegram", capTG.text === "gm from Telegram" && capTG.sender === "Bob" && capTG.sentAt === "09:00" && capTG.chat === "Hologram" && capTG.source === "web.telegram.org", JSON.stringify(capTG));
ok("capture-discord", capDC.text === "ship it" && capDC.sender === "carol" && capDC.sentAt === "2026-06-23T09:01:00Z" && capDC.chat === "general" && capDC.source === "discord.com", JSON.stringify(capDC));
ok("capture-slack", capSL.text === "deploy is green" && capSL.sender === "Dave" && capSL.sentAt === "09:02" && capSL.chat === "eng" && capSL.source === "app.slack.com", JSON.stringify(capSL));

// ── 3 · PARITY — the WhatsApp adapter reproduces the canonical pluck TARGET byte-for-byte ──
ok("whatsapp-adapter-byte-identical-to-pluck-target",
  JSON.stringify(messageObject(capWA)) === JSON.stringify(messageObject(TARGET)) &&
  mint(capWA).kappa === canonical.kappa,
  mint(capWA).kappa);

// ── 4 · KAPPA — every captured message mints a self-verifying κ (L1/L2/L5, SEC-1) ──
const minted = [capWA, capTG, capDC, capSL].map((c) => mint(c));
ok("every-platform-mints-self-verifying-kappa",
  minted.every((m) => /^did:holo:sha256:[0-9a-f]{64}$/.test(m.kappa) && verify(m.object) && m.object.id === m.kappa) &&
  new Set(minted.map((m) => m.kappa)).size === 4,
  minted.map((m) => m.kappa.slice(-8)).join(" "));

// ── 5 · DEDUP — the SAME content, captured by two DIFFERENT adapters, mints ONE κ (SEC-3) ──
// a Telegram-shaped fixture rendering the EXACT TARGET fields (same source) → must equal capWA's κ.
const docTGsame = h("div", {}, [
  h("div", { class: "ChatInfo" }, [h("div", { class: "title" }, "Ilya")]),
  h("div", { class: "message" }, [
    h("div", { class: "sender-title" }, "Ilya"),
    h("div", { class: "text-content" }, "The future is light photonics. HOLOGRAM."),
    h("div", { class: "message-time", title: "08:31" }, "08:31"),
  ]),
]);
const capTGsame = captureRow(A("telegram"), docTGsame.querySelector("div.message"), docTGsame, { hostname: "web.whatsapp.com" });
ok("same-content-two-adapters-one-kappa",
  JSON.stringify(capTGsame) === JSON.stringify(capWA) && mint(capTGsame).kappa === canonical.kappa,
  mint(capTGsame).kappa);

// ── 6 · REFUSE — tampering a captured message's bytes is refused fail-closed (Law L5) ──
const wire = JSON.parse(JSON.stringify(sharePayload(mint(capTG).object)));
const good = mountFromPayload(wire);
const tampered = JSON.parse(JSON.stringify(wire));
tampered.object["schema:text"] = "gm from Te1egram"; // one byte
const bad = mountFromPayload(tampered);
ok("captured-kappa-obeys-verify-before-trust", good.ok === true && bad.ok === false, `${good.ok} / ${bad.ok} (${bad.why})`);

// ── 7 · LIVE SCAN — captureAll reads every rendered row, skips empty ones ──
const docFeed = h("div", {}, [
  h("header", {}, [h("div", { role: "button" }, [h("span", { title: "Ilya" }, "Ilya")])]),
  h("div", { class: "message-in" }, [h("div", { class: "copyable-text", "data-pre-plain-text": "[08:31, 6/23/2026] Ilya: " }, [h("span", { class: "selectable-text" }, "first")])]),
  h("div", { class: "message-out" }, [h("div", { class: "copyable-text", "data-pre-plain-text": "[08:32, 6/23/2026] Me: " }, [h("span", { class: "selectable-text" }, "second")])]),
  h("div", { class: "message-in" }, [h("div", { class: "copyable-text" }, [h("span", { class: "selectable-text" }, "")])]), // empty → skipped
]);
const scanned = captureAll(A("whatsapp"), docFeed, { hostname: "web.whatsapp.com" });
ok("capture-all-reads-feed-skips-empty",
  scanned.length === 2 && scanned[0].input.text === "first" && scanned[1].input.text === "second",
  `rows=${scanned.length}`);

// ── 8 · REGISTRY SHAPE — every adapter is well-formed data (a config entry, not code) ──
ok("registry-entries-well-formed",
  ADAPTERS.length >= 9 &&
  ADAPTERS.every((a) => a.id && a.label && Array.isArray(a.hosts) && a.hosts.length && a.rowSelector && a.sel && a.sel.text),
  `${ADAPTERS.length} adapters`);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult", witnessed,
  covers: [
    "RESOLVE — each web-client host resolves to the right adapter; unknown host → null (SEC-6 name→parser binding never authenticates content)",
    "CAPTURE — WhatsApp/Telegram/Discord/Slack adapters each extract {text,sender,sentAt,chat,source} from a rendered row via the standard querySelector surface",
    "PARITY — the WhatsApp adapter reproduces the canonical pluck TARGET byte-for-byte (same messageObject, same κ)",
    "KAPPA — every captured message mints a self-verifying did:holo:sha256 κ that re-derives (Law L1/L2/L5, SEC-1); four distinct messages → four distinct κ",
    "DEDUP — the same content captured by two different adapters mints ONE κ (SEC-3: content, not codepath, is identity)",
    "REFUSE — a one-byte edit to a captured message is refused fail-closed under verify-before-trust (Law L5)",
    "LIVE SCAN — captureAll reads every rendered row and skips empty ones (the in-page observer's feed)",
    "REGISTRY — every platform is a well-formed selector-map DATA entry (≥9 platforms); adding one is config, not protocol code",
  ],
  adapters: ADAPTERS.map((a) => ({ id: a.id, label: a.label, hosts: a.hosts })),
  canonical: { kappa: canonical.kappa, truename: canonical.truename },
  checks, failed: fail,
  authority: "holo-apps §2.6 · holospaces SEC-1/SEC-3/SEC-6 · Law L1/L2/L5 · RFC 8785 (JCS) · FIPS 180-4 · schema.org Message",
};
writeFileSync(join(here, "holo-bridge-adapters-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Bridge adapters witness — one bridge per platform, as data\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  platforms: ${ADAPTERS.map((a) => a.label).join(" · ")}`);
console.log(`  canonical κ (WhatsApp adapter == pluck target): ${canonical.kappa}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
