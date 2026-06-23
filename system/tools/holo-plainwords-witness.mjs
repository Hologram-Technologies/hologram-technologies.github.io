#!/usr/bin/env node
// holo-plainwords-witness.mjs — PROVE the plain-words layer that removes wall #3 (crypto jargon in the
// default path: wallet · κ · did: · seal · sovereign · holospace). It is the presentation complement to the
// consent/onboarding deny-lists: it maps every substrate noun to a plain word, strips raw κ/DID addresses,
// and always shows a human NAME (truename / three-words) instead of a hash. The substrate keeps its precise
// vocabulary internally; my mother only ever sees plain English.
//
// Checks: nouns are human; humanize strips κ/DID; humanize maps jargon; names not hashes; ordinary text
// passes through; nothing jargon survives humanize; displayName is never a hash; deterministic.
//   node tools/holo-plainwords-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { noun, humanize, displayName, isJargon } from "../os/usr/lib/holo/holo-plainwords.mjs";
import { JARGON } from "../os/usr/lib/holo/holo-consent.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const jargonHit = (s) => JARGON.some((w) => new RegExp("\\b" + w + "\\b", "i").test(s)) || s.includes("κ") || /did:holo/i.test(s);
const checks = {};
const K = "did:holo:sha256:" + "ab".repeat(32);

// ── 1 · substrate nouns become human words ───────────────────────────────────────────────────────
{
  checks.nounsAreHuman = noun("wallet") === "Money" && noun("holospace") === "space" && noun("sign in") === "Continue";
}

// ── 2 · humanize strips raw κ / DID addresses + the κ symbol ──────────────────────────────────────
{
  const out = humanize(`This is ${K} — your κ, sealed.`);
  checks.humanizeStripsKappa = !/did:holo/i.test(out) && !out.includes("κ");
}

// ── 3 · humanize maps jargon to plain words ───────────────────────────────────────────────────────
{
  const out = humanize("Sign in to your wallet");
  checks.humanizeMapsJargon = /continue/i.test(out) && /money/i.test(out) && !/wallet/i.test(out);
}

// ── 4 · a thing is shown by its NAME (three-words / truename), never its hash ──────────────────────
{
  const d = displayName(K, { words: "brass.junior.quiz" });
  checks.namesNotHashes = d === "brass.junior.quiz" && !d.includes("ab") && !d.includes("did:holo");
}

// ── 5 · ordinary text passes through unchanged ────────────────────────────────────────────────────
{
  checks.ordinaryPassthrough = humanize("Open your photos and play a film") === "Open your photos and play a film";
}

// ── 6 · nothing jargon survives humanize ─────────────────────────────────────────────────────────
{
  const out = humanize(`Your sovereign did:holo wallet, sealed to κ, can delegate and attest.`);
  checks.noJargonSurvives = !jargonHit(out);
}

// ── 7 · displayName is NEVER a hash, even with nothing to go on ───────────────────────────────────
{
  const d = displayName(K, {});
  checks.displayNameNeverHash = !/[0-9a-f]{16}/i.test(d) && !d.includes("did:holo") && d.length > 0;
}

// ── 8 · isJargon flags the deny-list; deterministic ──────────────────────────────────────────────
{
  checks.deterministicAndFlags = isJargon("wallet") === true && isJargon("photos") === false && humanize("seal it") === humanize("seal it");
}

const witnessed = Object.values(checks).every(Boolean);
writeFileSync(join(here, "holo-plainwords-witness.result.json"), JSON.stringify({
  spec: "Plain-words layer: maps every substrate noun to a plain word, strips raw κ/DID addresses, always shows a human name (truename/three-words) not a hash. The substrate keeps its precise vocabulary; the user sees only plain English. Removes wall #3 (crypto jargon in the default path).",
  authority: "holospaces truenames / three-words (existing) · plain-language UX",
  witnessed,
  covers: witnessed ? ["plain-words", "human-nouns", "strip-kappa-did", "map-jargon", "names-not-hashes", "passthrough", "no-jargon-survives", "displayname-never-hash"] : [],
  checks,
}, null, 2) + "\n");

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ no κ, no did:, no wallet — she sees only plain English and human names" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
