#!/usr/bin/env node
// holo-words-witness.mjs — THREE WORDS: the whole κ in three words a human can say.
// Proves the codec + resolution + the "fixed-forever" pin, in pure Node:
//   · the wordlist is a κ-object — its sha256 IS the pinned WORDLIST_KAPPA (Law L1/L2)
//   · κ → 3 words is deterministic (same κ + same list → same words, forever)
//   · every app in the REAL 50-app catalog gets a UNIQUE 3-word address (33 bits ≫ 50)
//   · each 3-word address resolves to EXACTLY its own κ → the holo://<hex> nav mounts
//   · the user's opaque κ (bb5fde48…) → three words → resolves straight back to it
//   · LAW L5 — a wrong/tampered triple resolves to NOTHING (refuse, never mis-resolve)
//   · looksLikeWords tells a 3-word address from a domain (membership, not shape)
//
// Authority: BIP-39 (open) · what3words design principles (not its IP) · W3C i18n /
//   DCAT / schema.org · holospaces Law L1/L2/L5.
//   node tools/holo-words-witness.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sha256hex } from "../os/usr/lib/holo/holo-uor.mjs";
import { WORDLIST_KAPPA, kappaToWords, wordsToValue, wordsForEntry, resolveWords, expandWords, looksLikeWords, suggestWords } from "../os/usr/lib/holo/holo-words.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

// ── the vendored wordlist (the κ-object) ──
const wlText = readFileSync(join(OS, "usr/lib/holo/words/bip39-english.txt"), "utf8");
const wl = wlText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

// ── 1 · the wordlist's sha256 IS its pinned κ (content-addressed, fixed forever) ──
const wlKappa = "did:holo:sha256:" + sha256hex(wlText);
ok("wordlist-is-pinned-kappa-object", wl.length === 2048 && wlKappa === WORDLIST_KAPPA, wlKappa);

// ── 2 · κ → 3 words is DETERMINISTIC (same κ + same list → same words) ──
const RAW = "did:holo:sha256:bb5fde48d9dc00c97ba68c42088538d660c2a0509d60210a934eb4a4ab1d0c36";
const w1 = kappaToWords(RAW, wl), w2 = kappaToWords(RAW, wl);
ok("kappa-to-words-deterministic", w1 === w2 && w1.split(".").length === 3 && w1.split(".").every((x) => wl.includes(x)), w1);

// ── the REAL served catalog (the resolution namespace) ──
const apps = (JSON.parse(readFileSync(join(OS, "usr/share/holospaces/index.jsonld"), "utf8"))["dcat:dataset"]) || [];
ok("real-catalog-loaded", apps.length >= 40, `${apps.length} apps`);

// ── 3 · every app gets a UNIQUE 3-word address (33 bits, 50 apps → no collision) ──
const triples = apps.map((a) => wordsForEntry(a, wl));
ok("every-app-unique-three-words", new Set(triples).size === triples.length, `${new Set(triples).size}/${triples.length}`);

// ── 4 · each 3-word address resolves to EXACTLY its own κ ──
let allRT = true;
for (const a of apps) {
  const hits = resolveWords(wordsForEntry(a, wl), apps, wl);
  if (hits.length !== 1 || hits[0].kappa !== (a["@id"] || a.id)) { allRT = false; break; }
}
ok("all-apps-resolve-to-their-own-kappa", allRT);

// ── 5 · the user's opaque κ IS Holo Amp → words → expand straight back to that κ ──
const amp = apps.find((a) => (a["@id"] || a.id) === RAW);
const ampWords = amp && wordsForEntry(amp, wl);
const link = expandWords(ampWords, apps, wl);
ok("opaque-kappa-round-trips-via-words", !!amp && link === "holo://" + RAW.split(":").pop(), `${ampWords} → ${link}`);

// ── 6 · LAW L5 — a wrong/tampered triple resolves to NOTHING (fail-closed) ──
const parts = ampWords.split(".");
const tampered = [parts[0], parts[1], parts[2] === "zoo" ? "abandon" : "zoo"].join(".");  // swap last word
ok("L5-tampered-triple-resolves-to-nothing",
  resolveWords(tampered, apps, wl).length === 0 &&
  expandWords(tampered, apps, wl) === null &&
  resolveWords("abandon.abandon.abandon", apps, wl).length === 0);   // a valid-but-unowned triple

// ── 7 · looksLikeWords — a 3-word address vs a domain (membership, not shape) ──
ok("recognizer-words-not-domain",
  looksLikeWords(ampWords, wl) === true &&
  looksLikeWords("foo.bar.com", wl) === false &&        // a domain: tokens not all in the list
  looksLikeWords("abandon.zoo.zoo", wl) === true &&     // shape + membership
  looksLikeWords("abandon.zoo", wl) === false);         // wrong count

// ── 8 · round-trip filter integrity — words decode to the κ-leading integer ──
ok("words-value-round-trip", wordsToValue(ampWords, wl) === wordsToValue(kappaToWords(RAW, wl), wl) && wordsToValue("not.a.word", wl) === null);

// ── AutoSuggest sanity ──
const sugg = suggestWords(ampWords.split(".")[0], apps, wl, 20);
ok("autosuggest-verified", sugg.some((s) => s.kappa === RAW && s.words === ampWords));

const witnessed = Object.values(checks).every(Boolean);
const sample = apps.slice(0, 6).map((a) => ({ name: a["schema:name"], words: wordsForEntry(a, wl) }));
const result = {
  "@type": "earl:TestResult", witnessed,
  covers: [
    "the wordlist is a content-addressed κ-object — its sha256 IS the pinned WORDLIST_KAPPA (BIP-39, 2048, public domain); changing it is a new versioned κ, never an edit",
    "κ → three words is deterministic (same κ + same wordlist-κ → same words, forever)",
    "every app in the real 50-app catalog gets a UNIQUE three-word address (33 bits ≫ 50)",
    "each three-word address resolves (verify-before-trust, L5) to exactly its own κ",
    "the user's opaque κ (bb5fde48…) → three words → expands straight back to holo://<that κ>",
    "LAW L5 — a wrong or tampered triple resolves to NOTHING (refuse; the words never mis-resolve)",
    "looksLikeWords distinguishes a three-word address from a domain by wordlist membership, not shape",
    "the words decode to the κ-leading integer (the cheap candidate filter) + verified AutoSuggest",
  ],
  wordlistKappa: WORDLIST_KAPPA, sample,
  example: { kappa: RAW, words: ampWords, link },
  checks, failed: fail,
  authority: "BIP-39 (open/public-domain) · what3words published design principles (not its IP) · W3C i18n / DCAT / schema.org / SKOS · IETF RFC 8785 (JCS) · holospaces Law L1/L2/L5",
};
writeFileSync(join(here, "holo-words-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Words witness — the whole κ, in three words\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log("\n  the live catalog, in three words:");
for (const s of sample) console.log(`    ${s.words.padEnd(26)} ${s.name}`);
console.log(`\n  opaque κ   holo://${RAW.split(":").pop()}`);
console.log(`  3 words    ${ampWords}`);
console.log(`  → mounts   ${link}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
