#!/usr/bin/env node
// holo-pluck-witness.mjs — PLUCK A MESSAGE INTO ETERNITY, proven in pure Node.
//
// Takes the live test target — the "Ilya" chat message "The future is light photonics.
// HOLOGRAM." — and rides it through the whole arc the browser would:
//   PLUCK  → a rendered message becomes a self-verifying κ-object (its id = H(content))
//   NAME   → truename, three words, IPv6 locator, CID — all deterministic from the κ
//   TELEPORT → a share payload mounts byte-identical via verify-before-trust (no WhatsApp)
//   REFUSE → flip one byte → mount is refused, fail-closed (Law L5)
//   STABLE → minting the same message twice yields the same κ; a different message differs
//   MEDIA  → a message with a media leaf commits to the media's κ (Merkle), still verifies
//
//   node tools/holo-pluck-witness.mjs
//
// Authority: UOR object envelope (ADR-025) · RFC 8785 JCS · FIPS 180-4 · holospaces
//   Law L1/L2/L5 · schema.org (Message/Person/MediaObject).

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mint, mountFromPayload, sharePayload, messageObject, badgeFor, encodePayload, decodePayload, shareLinkFor, renderModel } from "../os/usr/lib/holo/holo-pluck.mjs";
import { verify, address, contentLink } from "../os/usr/lib/holo/holo-object.mjs";
import { defaultWordlist, looksLikeWords } from "../os/usr/lib/holo/holo-words.mjs";
import { looksLikeTruename, matchesTruename } from "../os/usr/lib/holo/holo-truename.mjs";
import { parseIPv6, formatIPv6, cidToKappaDid } from "../os/usr/lib/holo/holo-locator.mjs";
import { pluckKappa as inPagePluck } from "../os/usr/share/frame/holo-pluck-inpage.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const hexOf = (k) => String(k).split(":").pop();

const wordlist = await defaultWordlist();

// ── the live test target, exactly as drawn in the WhatsApp Web tab ──
const TARGET = {
  text: "The future is light photonics. HOLOGRAM.",
  sender: "Ilya",
  sentAt: "08:31",
  chat: "Ilya",
  source: "web.whatsapp.com",
};

// ── 1 · PLUCK — the rendered message becomes a self-verifying κ-object ──
const m = mint(TARGET, { wordlist });
ok("pluck-mints-self-verifying-kappa",
  /^did:holo:sha256:[0-9a-f]{64}$/.test(m.kappa) && verify(m.object) && m.object.id === m.kappa,
  m.kappa);

// ── 2 · NAME — truename, three words, IPv6, CID all derive from the κ ──
const v6canonical = formatIPv6(parseIPv6(m.ipv6)) === m.ipv6;
ok("name-projections-derive-from-kappa",
  looksLikeTruename(m.truename) && matchesTruename(m.object, m.truename) &&
  looksLikeWords(m.words, wordlist) && m.words.split(".").length === 3 &&
  v6canonical && m.ipv6.toLowerCase().startsWith("fd") &&
  cidToKappaDid(m.cid) === m.kappa,
  `${m.truename} | ${m.words} | ${m.ipv6}`);

// the slug speaks the message (re-projected from the text, not a stored label)
ok("truename-speaks-the-message", m.truename.startsWith("the-future-is-light"), m.truename);

// ── 3 · TELEPORT — a share payload mounts byte-identical with NO WhatsApp in the path ──
const payload = sharePayload(m.object);                          // what the κ-link carries
const wire = JSON.parse(JSON.stringify(payload));                // serialize → deserialize (the wire)
const mounted = mountFromPayload(wire);
ok("teleport-mounts-byte-identical",
  mounted.ok && mounted.kappa === m.kappa &&
  mounted.object["schema:text"] === TARGET.text &&
  mounted.object["schema:sender"] === "Ilya",
  mounted.why || "");

// resolving needed nothing from web.whatsapp.com — the bytes ARE the message
ok("no-server-in-resolve-path",
  mounted.ok && JSON.stringify(mounted.object) === JSON.stringify(m.object));

// ── 4 · REFUSE — flip one byte → fail-closed (Law L5) ──
const tampered = JSON.parse(JSON.stringify(wire));
tampered.object["schema:text"] = TARGET.text.replace("future", "futurd");   // one byte
const r1 = mountFromPayload(tampered);
// forge the κ to a value that does NOT match the (still-original) content
const forged = JSON.parse(JSON.stringify(wire));
forged.kappa = "did:holo:sha256:" + "0".repeat(64);
forged.object.id = forged.kappa;
const r2 = mountFromPayload(forged);
// claim a different κ via expectKappa than the bytes derive to
const r3 = mountFromPayload(wire, { expectKappa: "did:holo:sha256:" + "f".repeat(64) });
ok("tamper-refused-fail-closed",
  r1.ok === false && r2.ok === false && r3.ok === false,
  `${r1.why} | ${r2.why} | ${r3.why}`);

// ── 5 · STABLE — same message → same κ; different message → different κ (L2) ──
const again = mint(TARGET, { wordlist });
const other = mint({ ...TARGET, text: TARGET.text + " " }, { wordlist });   // trailing space = different content
ok("deterministic-and-collision-honest",
  again.kappa === m.kappa && again.words === m.words && other.kappa !== m.kappa,
  m.kappa);

// field order independence — JCS sorts keys, so capture order can't change the κ
const reordered = mint({ source: "web.whatsapp.com", chat: "Ilya", sentAt: "08:31", sender: "Ilya", text: TARGET.text }, { wordlist });
ok("kappa-independent-of-capture-order", reordered.kappa === m.kappa, reordered.kappa);

// ── 6 · MEDIA — a message with a media leaf commits to the media's κ (Merkle) ──
// a photo's bytes are content-addressed to their own κ; the message links it as a leaf.
const photoKappa = "did:holo:sha256:" + hexOf(address({ "schema:name": "a photo's raw bytes (stand-in)" }));
const withMedia = mint({ ...TARGET, text: "📷 Photo", media: [{ kappa: photoKappa, mime: "image/jpeg" }] }, { wordlist });
const mediaLeaf = (withMedia.object.links || [])[0];
const mediaMount = mountFromPayload(sharePayload(withMedia.object));
ok("media-leaf-merkle-linked-and-verifies",
  !!mediaLeaf && mediaLeaf.id === photoKappa && mediaLeaf.leaf === true &&
  mediaLeaf["@type"] === "schema:ImageObject" &&
  withMedia.kappa !== m.kappa &&                       // the link changed the message κ (Merkle)
  mediaMount.ok,
  mediaLeaf && mediaLeaf.id);

// ── 7 · BADGE — the glanceable chip the browser draws over the bubble ──
const b = badgeFor(m.object, wordlist);
ok("badge-glanceable-and-consistent",
  b.words === m.words && b.truename === m.truename && b.short === hexOf(m.kappa).slice(0, 8),
  `${b.short} · ${b.words}`);

// ── 8 · IN-PAGE PARITY — the CEF capture hook mints the SAME κ as the substrate ──
// (proves the live-tab pluck and the Hologram-surface mount agree without a live tab)
const inpage = await inPagePluck(TARGET);
ok("inpage-hook-byte-identical-to-substrate",
  inpage.kappa === m.kappa &&
  inpage.truename === m.truename &&
  inpage.holoLink === m.holoLink &&
  JSON.stringify(inpage.object) === JSON.stringify(m.object),
  inpage.kappa);

// the in-page artifact mounts under the substrate's own verify-before-trust
const crossMount = mountFromPayload(sharePayload(inpage.object));
ok("inpage-artifact-mounts-under-substrate-verify", crossMount.ok && crossMount.kappa === m.kappa, crossMount.why || "");

// ── 9 · TRANSPORT — the message rides in the link #fragment; decode → mount round-trips ──
const link = shareLinkFor(m.object);                            // /usr/share/frame/holopluck.html#m=<token>
const token = link.split("#m=")[1];
const back = decodePayload(token);
const linkMount = mountFromPayload(back);
ok("fragment-link-round-trips-serverless",
  link.includes("holopluck.html#m=") &&
  linkMount.ok && linkMount.kappa === m.kappa &&
  linkMount.object["schema:text"] === TARGET.text,
  link.slice(0, 64) + "…");

// the link is self-contained — decode never needed a network/κ-store for this text message
ok("payload-encode-decode-is-isomorphic",
  JSON.stringify(decodePayload(encodePayload(sharePayload(m.object)))) === JSON.stringify(sharePayload(m.object)));

// ── 10 · FRAGMENT TAMPER — edit one byte inside the link → refused (what the page shows) ──
const t = back.object["schema:text"];
const tamperedPayload = { ...back, object: { ...back.object, "schema:text": t.slice(0, -1) + "!" } };
const tamperedToken = encodePayload(tamperedPayload);
const tamperedMount = mountFromPayload(decodePayload(tamperedToken));
ok("fragment-tamper-refused", tamperedMount.ok === false, tamperedMount.why || "");

// ── 11 · RENDER MODEL — the pure view-model the receiving surface paints ──
const view = renderModel(linkMount.object, { wordlist });
ok("render-model-faithful",
  view.text === TARGET.text && view.sender === "Ilya" && view.sentAt === "08:31" &&
  view.chat === "Ilya" && view.source === "web.whatsapp.com" &&
  view.short === hexOf(m.kappa).slice(0, 8) && view.truename === m.truename &&
  view.words === m.words && view.ipv6 === m.ipv6,
  `${view.short} · ${view.words}`);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult", witnessed,
  covers: [
    "PLUCK — a rendered message (sender+text+time+source) becomes a self-verifying UOR κ-object; id = H(JCS(content))",
    "NAME — truename (slug speaks the message), three BIP-39 words, RFC-5952 IPv6 locator, and CIDv1 all derive from the κ (no registry)",
    "TELEPORT — a compact share payload mounts byte-identical via verify-before-trust; nothing from web.whatsapp.com is in the resolve path",
    "REFUSE — a one-byte text edit, a forged κ, and a wrong expected-κ are each refused fail-closed (Law L5)",
    "STABLE — same message → same κ + same words (L2); a trailing space → a different κ (collision-honest); capture field order is irrelevant (JCS)",
    "MEDIA — a media leaf is a Merkle contentLink to the media's own κ; it changes the message κ and still verifies",
    "BADGE — the minted chip (short κ · three words · truename) is a consistent projection of the object",
    "IN-PAGE PARITY — the CEF render-hook (holo-pluck-inpage.mjs, WebCrypto + inlined proquint) mints a byte-identical κ + truename and mounts under the substrate's verify-before-trust",
    "TRANSPORT — the message rides in the link #fragment (base64url JSON); decode → mount round-trips with no server/κ-store; encode/decode isomorphic",
    "FRAGMENT TAMPER — editing one byte inside the link is refused fail-closed (the exact path holopluck.html guards)",
    "RENDER MODEL — the pure view-model the receiving surface paints (text/sender/time/chat/source + κ short/truename/words/IPv6) is faithful",
  ],
  shareLink: m.shareLink,
  target: TARGET,
  minted: { kappa: m.kappa, truename: m.truename, words: m.words, ipv6: m.ipv6, cid: m.cid, holoLink: m.holoLink, spaceLink: m.spaceLink },
  checks, failed: fail,
  authority: "UOR object envelope (ADR-025) · IETF RFC 8785 (JCS) · FIPS 180-4 (SHA-256) · RFC 4291/5952/4193/3972 · multiformats (CID) · holospaces Law L1/L2/L5 · schema.org",
};
writeFileSync(join(here, "holo-pluck-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Pluck witness — pluck a WhatsApp message into eternity\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  the plucked message — "${TARGET.text}"  (from ${TARGET.sender})`);
console.log(`    κ          ${m.kappa}`);
console.log(`    truename   ${m.truename}`);
console.log(`    3 words    ${m.words}`);
console.log(`    IPv6       ${m.ipv6}`);
console.log(`    holo://    ${m.holoLink}`);
console.log(`    open       ${m.spaceLink}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
