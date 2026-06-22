#!/usr/bin/env node
// holo-truename-resolve-witness.mjs — P3: a typed TRUENAME resolves to its κ against
// the REAL apps catalog, fail-closed, and routes as navigation. Proves the name→κ
// front door end-to-end in pure Node (the browser binding is the same functions):
//   · every one of the 50 catalog apps has a UNIQUE truename (the reverse index is sound)
//   · truename → exactly its κ (verify-before-trust); the κ stays identity (L1)
//   · expand(truename) → the holo://<hex> the existing navigation already mounts
//   · LAW L5 — a tampered tail or a wrong slug resolves to NOTHING (refuse, never guess)
//   · the nav detector recognizes a truename but not a "build" phrase (no false-positive)
//   · the user's original opaque κ (bb5fde48…) IS "Holo Amp" → its truename round-trips
//
// Authority: holospaces Law L1/L2/L5 · W3C DCAT/schema.org · proquint · the P0–P2 spine.
//   node tools/holo-truename-resolve-witness.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { truenameForEntry, resolveTruename, expandTruename, suggestTruenames, parseTruename } from "../os/usr/lib/holo/holo-truename.mjs";
import { looksLikeNavigation } from "../os/usr/lib/holo/holo-resolve.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

// ── the REAL served catalog (the candidate set the live OS resolves against) ──
const cat = JSON.parse(readFileSync(join(OS, "usr/share/holospaces/index.jsonld"), "utf8"));
const apps = cat["dcat:dataset"] || [];
ok("real-catalog-loaded", apps.length >= 40, `${apps.length} apps`);

// ── 1 · every app's truename is UNIQUE (the κ→name reverse index is well-formed) ──
const names = apps.map((a) => truenameForEntry(a));
const uniq = new Set(names);
ok("every-app-has-unique-truename", uniq.size === names.length, `${uniq.size}/${names.length} unique`);

// ── 2 · the user's opaque κ IS Holo Amp → its truename resolves back to exactly that κ ──
const RAW = "did:holo:sha256:bb5fde48d9dc00c97ba68c42088538d660c2a0509d60210a934eb4a4ab1d0c36";
const amp = apps.find((a) => (a["@id"] || a.id) === RAW);
const ampTrue = amp && truenameForEntry(amp);
const ampHits = resolveTruename(ampTrue, apps);
ok("opaque-kappa-is-amp-and-round-trips",
  !!amp && /^holo-amp~/.test(ampTrue) && ampHits.length === 1 && ampHits[0].kappa === RAW, ampTrue);

// ── 3 · EVERY app round-trips: truename → exactly its own κ ──
let allRT = true, ambiguous = 0;
for (const a of apps) {
  const hits = resolveTruename(truenameForEntry(a), apps);
  if (hits.length !== 1 || hits[0].kappa !== (a["@id"] || a.id)) { allRT = false; if (hits.length > 1) ambiguous++; }
}
ok("all-50-apps-resolve-to-their-own-kappa", allRT, ambiguous ? `${ambiguous} ambiguous` : "");

// ── 4 · expand(truename) → the holo://<hex> the existing navigation mounts ──
const link = expandTruename(ampTrue, apps);
ok("expand-to-holo-link", link === "holo://" + RAW.split(":").pop(), link);

// ── 5 · LAW L5 — a tampered tail or a wrong slug resolves to NOTHING (fail-closed) ──
const tamperedTail = ampTrue.replace(/~[a-z]+/, "~babad");
const wrongSlug = ampTrue.replace(/^[a-z0-9-]+~/, "music~");
ok("L5-tamper-resolves-to-nothing",
  resolveTruename(tamperedTail, apps).length === 0 &&
  resolveTruename(wrongSlug, apps).length === 0 &&
  expandTruename(tamperedTail, apps) === null);

// ── 6 · the NAV detector recognizes a truename but NOT a build phrase (no false-positive) ──
ok("nav-detector-truename-not-buildphrase",
  looksLikeNavigation(ampTrue) === true &&
  looksLikeNavigation("make me a music player") === false &&
  looksLikeNavigation("holo amp please") === false &&
  parseTruename(ampTrue) !== null);

// ── 7 · SUGGEST — verified autocomplete (the reverse index, used live) ──
const sugg = suggestTruenames("holo-a", apps, 8);
ok("suggest-autocomplete", sugg.some((s) => s.kappa === RAW && s.truename === ampTrue), `${sugg.length} hits`);

const witnessed = Object.values(checks).every(Boolean);
const sample = apps.slice(0, 6).map((a) => ({ name: a["schema:name"], truename: truenameForEntry(a) }));
const result = {
  "@type": "earl:TestResult", witnessed,
  covers: [
    "the real 50-app served catalog is the candidate set; every app has a UNIQUE truename (the κ→name reverse index is sound)",
    "the user's original opaque κ (bb5fde48…) IS Holo Amp; its truename resolves back to exactly that κ",
    "ALL apps round-trip: truename → exactly its own κ (verify-before-trust, no ambiguity)",
    "expand(truename) → the holo://<hex> the existing κ-navigation already mounts (a truename is an alias for a κ)",
    "LAW L5 — a tampered tail or a wrong slug resolves to NOTHING (refuse, never guess)",
    "the nav detector routes a truename as a destination but a build phrase as intent (no false-positive)",
    "verified prefix autocomplete over the catalog",
  ],
  sample,
  checks, failed: fail,
  authority: "holospaces Law L1/L2/L5 · W3C DCAT / schema.org · proquint · RFC 5952 · the holo-proquint/holo-truename/holo-locator spine",
};
writeFileSync(join(here, "holo-truename-resolve-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Truename resolve witness — a name resolves to its κ (P3)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log("\n  sample of the live catalog, named:");
for (const s of sample) console.log(`    ${s.truename.padEnd(34)} ${s.name}`);
console.log(`\n  type   ${ampTrue}`);
console.log(`  → κ    ${link}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
