#!/usr/bin/env node
// holo-messenger-share-witness.mjs — TRUENAMES & MAGICAL SHARE, proven in pure Node.
//
// Drives the REAL holo-words three-word projection, holo-locator IPv6, and holo-pluck verify-
// before-trust over REAL signed conversation chains. Proves a thread has a human address that
// can't lie, resolves by its words, and shares as a self-contained link granting attenuated
// read-only of exactly one conversation.
//
//   ADDRESS  — a thread's genesis κ projects to three speakable words + an IPv6 locator (no registry)
//   RESOLVE  — typing a thread's words finds THAT thread (verified, L5); others/gibberish don't match
//   SHARE    — the share payload carries verified message content + a read cap bound to ONE collection
//   NOKEYS   — the payload leaks no signer / operator key / account (attenuation, SEC-2)
//   MOUNT    — the recipient re-derives every message verify-before-trust; read-only, no signer
//   REJECT   — a tampered message is dropped; a cap not bound to its collection is refused
//   LINK     — the share link round-trips serverless (#fragment) → mounts byte-identical
//
//   node tools/holo-messenger-share-witness.mjs
//
// Authority: holo-words · holo-locator · holo-pluck (L5) · holospaces SEC-2 · Law L1/L2/L5.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { conversationGenesis, makeThread } from "../os/usr/lib/holo/holo-messenger-thread.mjs";
import { threadAddress, resolveThreadWords, resolveThreadLink, shareThreadPayload, shareLinkFor, decodeShareLink, mountSharedThread } from "../os/usr/lib/holo/holo-messenger-share.mjs";
import { defaultWordlist, looksLikeWords } from "../os/usr/lib/holo/holo-words.mjs";
import { parseIPv6, formatIPv6 } from "../os/usr/lib/holo/holo-locator.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
let tick = 0; const now = () => `2026-06-23T13:00:${String(tick++).padStart(2, "0")}.000Z`;

const wordlist = await defaultWordlist();
const op = await enroll({ label: "share-tester", passphrase: "correct horse battery" });

// three conversations
const mk = async (platform, chat, msgs) => {
  const genesis = conversationGenesis({ platform, chat });
  const thread = makeThread({ genesis, now, signer: op });
  for (const m of msgs) await thread.ingest({ ...m, chat, source: "web." + platform + ".com" });
  return { genesis, chat, platform, thread };
};
const ilya = await mk("whatsapp", "Ilya", [
  { text: "The future is light photonics. HOLOGRAM.", sender: "Ilya", sentAt: "08:31" },
  { text: "Make it feel like WhatsApp.", sender: "Ilya", sentAt: "08:33" },
]);
const devs = await mk("telegram", "Hologram Devs", [{ text: "gm — green", sender: "Bob", sentAt: "09:00" }]);
const eng = await mk("slack", "#eng", [{ text: "deploy is green", sender: "Dave", sentAt: "09:20" }]);
const convos = [ilya, devs, eng];

// ── 1 · ADDRESS — three words + IPv6, both derived from the genesis κ ──
const addr = threadAddress(ilya.genesis, wordlist);
const v6ok = formatIPv6(parseIPv6(addr.ipv6)) === addr.ipv6 && addr.ipv6.toLowerCase().startsWith("fd");
ok("thread-address-words-and-ipv6",
  looksLikeWords(addr.words, wordlist) && addr.words.split(".").length === 3 && v6ok && addr.short === ilya.genesis.split(":").pop().slice(0, 8),
  `${addr.words} | ${addr.ipv6}`);

// ── 2 · RESOLVE — typing a thread's words finds THAT thread; others/gibberish do not ──
const hit = resolveThreadWords(addr.words, convos, wordlist);
const link = resolveThreadLink(addr.words, convos, wordlist);
const devsWords = threadAddress(devs.genesis, wordlist).words;
const crossMiss = resolveThreadWords(devsWords, convos, wordlist);   // should resolve to devs, NOT ilya
ok("resolve-by-words-finds-the-thread",
  hit.length === 1 && hit[0].kappa === ilya.genesis &&
  link === "holo://" + ilya.genesis.split(":").pop() &&
  crossMiss.length === 1 && crossMiss[0].kappa === devs.genesis &&
  resolveThreadWords("zzzz.not.words", convos, wordlist).length === 0,
  `${addr.words}→${hit.length}`);

// ── 3 · SHARE — payload carries verified content + a read cap bound to ONE collection ──
const payload = shareThreadPayload(ilya.thread, { genesis: ilya.genesis, platform: "whatsapp", chat: "Ilya", wordlist });
ok("share-payload-attenuated-read-cap",
  payload["@type"] === "HoloThreadShare" && payload.cap.read === ilya.genesis &&
  payload["holo:collection"] === ilya.genesis && payload.messages.length === 2 &&
  payload.name.words === addr.words,
  `cap.read=${payload.cap.read.slice(-8)} msgs=${payload.messages.length}`);

// ── 4 · NOKEYS — the payload leaks no signer / operator key / account (SEC-2 attenuation) ──
const wire = JSON.stringify(payload);
const leaks = ["holstr:sig", "holstr:pub", "holstr:op", "privateKey", "\"sk\"", "secret", "passphrase"].filter((s) => wire.includes(s));
ok("share-leaks-no-signer-or-account", leaks.length === 0, leaks.join(",") || "clean");

// ── 5 · MOUNT — recipient re-derives every message verify-before-trust; read-only, no signer ──
const mounted = mountSharedThread(payload);
ok("mount-verifies-read-only",
  mounted.ok && mounted.readOnly === true && mounted.hasSigner === false &&
  mounted.genesis === ilya.genesis && mounted.cap.read === ilya.genesis &&
  mounted.messages.length === 2 && mounted.rejected === 0 &&
  mounted.messages[0].object["schema:text"] === "The future is light photonics. HOLOGRAM.",
  `msgs=${mounted.messages.length} rejected=${mounted.rejected}`);

// ── 6 · REJECT — a tampered message dropped; a cap not bound to its collection refused ──
const tampered = JSON.parse(JSON.stringify(payload));
tampered.messages[1].object["schema:text"] = "forged history";           // one byte → κ no longer matches
const mTampered = mountSharedThread(tampered);
const capForged = JSON.parse(JSON.stringify(payload)); capForged.cap.read = devs.genesis;   // cap names a DIFFERENT collection
const mCapForged = mountSharedThread(capForged);
ok("tamper-and-cap-mismatch-refused",
  mTampered.ok === true && mTampered.messages.length === 1 && mTampered.rejected === 1 &&     // tampered one dropped, rest stand
  mCapForged.ok === false && /cap-not-bound/.test(mCapForged.why),
  `tampered rejected=${mTampered.rejected} | cap=${mCapForged.why}`);

// ── 7 · LINK — the share link round-trips serverless (#fragment) and mounts byte-identical ──
const lnk = shareLinkFor(payload);
const back = decodeShareLink(lnk);
const mLink = mountSharedThread(back);
ok("share-link-round-trips-serverless",
  lnk.includes("?app=" + ilya.genesis.split(":").pop()) && lnk.includes("#share=") &&
  mLink.ok && mLink.genesis === ilya.genesis && mLink.messages.length === 2 &&
  JSON.stringify(back) === JSON.stringify(payload),
  lnk.slice(0, 56) + "…");

await forget(op.kappa).catch(() => {});

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult", witnessed,
  covers: [
    "ADDRESS — a conversation's genesis κ projects to three speakable words + an RFC-5952 IPv6 locator, both deterministic from the κ (no registry)",
    "RESOLVE — typing a thread's words resolves to THAT thread, verified by exact re-derivation (Law L5); another thread's words resolve to it, gibberish resolves to nothing",
    "SHARE — the share payload carries the verified message set + a read capability bound to exactly one collection (SEC-2 attenuation)",
    "NOKEYS — the payload leaks no signing key, operator key, or account material — read of one thread, never the account",
    "MOUNT — the recipient re-derives every message verify-before-trust and gets a read-only view with no signer (cannot append)",
    "REJECT — a tampered message is dropped fail-closed while the rest stand; a capability that doesn't bind to its collection is refused entirely",
    "LINK — the share link carries the κ in the query and the payload in the #fragment; it round-trips with no server and mounts byte-identical",
  ],
  sample: { genesis: ilya.genesis, words: addr.words, ipv6: addr.ipv6 },
  checks, failed: fail,
  authority: "holo-words · holo-locator · holo-pluck (verify-before-trust) · holospaces SEC-2 · Law L1/L2/L5",
};
writeFileSync(join(here, "holo-messenger-share-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Messenger share witness — truenames & magical share\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  "${ilya.chat}"  ${addr.words}  ·  ${addr.ipv6}  ·  read-only share, attenuated to one thread`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
