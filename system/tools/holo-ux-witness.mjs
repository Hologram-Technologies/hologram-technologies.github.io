#!/usr/bin/env node
// holo-ux-witness.mjs — PROVE Holo UX (ADR-0062) is the single canonical, self-verifying source of
// the experience, the way holo-ui-conformance-witness.mjs proves it for the UI tokens. Pure-Node
// static analysis + re-derivation:
//
//   1 · DOCTRINE (Law L5)  — etc/holo-ux/doctrine.uor.json re-derives to its own did, and every
//        Merkle link re-derives against the on-disk source file (a tampered byte breaks the address).
//   2 · ONTOLOGY (no drift)— os/usr/share/ns/ux.jsonld is byte-equal to the materializer's output,
//        so the dereferenceable hosux: vocabulary cannot drift from its one source.
//   3 · COMPLETE           — all 13 tenets are present (the founding 5 + Jobs's 8), each a non-empty
//        checkable obligation, and the sealed object embeds them — the parameters a per-app ratchet binds.
//   4 · NATIVE (autodetect)— the host resolver covers the user's five named OSes (+ iPadOS/ChromeOS)
//        with DISTINCT native feel, and the sealed profile matrix is FAITHFUL to the live resolver.
//   5 · APPLIED            — holo-ux.js adapts to the host (data-holo-platform/-mod/-controls + seeds
//        accent/font) and resolves the tier, and the desktop shell (home.html) loads it.
//   6 · CAPABILITY         — the tier resolution is pure + conservative + honest headless.
//   7 · VOICE              — the plain register holds: the doctrine's own descriptions carry no jargon.
//   8 · SACRED RESOURCES   — the embedded budget keeps interaction ≤100ms on every tier (RAIL).
//
//   node tools/holo-ux-witness.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TENETS, PLATFORM_OSES, navFor, toOntology } from "../os/usr/lib/holo/holo-ux-doctrine.mjs";
import { profileFor } from "../os/usr/lib/holo/holo-platform.js";
import { TIERS, resolveTier, tierSettings, headlessProbe } from "../os/usr/lib/holo/holo-capability.mjs";
import { lint } from "../os/usr/lib/holo/holo-voice.mjs";
import { jcs, sha256hex } from "../os/usr/lib/holo/holo-uor.mjs";
import { verify } from "../os/usr/lib/holo/holo-object.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const read = (rel) => readFileSync(join(OS, rel), "utf8");
const checks = {};
const set = (k, v) => { checks[k] = !!v; };

// ── 1 · the sealed doctrine re-derives + its links re-derive (Law L5) ─────────────────────────────
let doctrine = null;
try { doctrine = JSON.parse(read("etc/holo-ux/doctrine.uor.json")); } catch {}
set("doctrine.uor.json exists + is a UOR object with a did", !!(doctrine && doctrine.id && doctrine["@context"]));
set("doctrine.uor.json re-derives to its content address (Law L5 — tamper-refused)", !!(doctrine && verify(doctrine)));

// each Merkle link is a leaf to a real source file by content address — re-hash the file, compare.
const LINK_FILES = {
  "hosux:ontology": "usr/share/ns/ux.jsonld",
  "hosux:doctrineSource": "usr/lib/holo/holo-ux-doctrine.mjs",
  "hosux:runtime": "usr/lib/holo/holo-ux.js",
  "hosux:platform": "usr/lib/holo/holo-platform.js",
  "hosux:capability": "usr/lib/holo/holo-capability.mjs",
  "hosux:voice": "usr/lib/holo/holo-voice.mjs",
  "hosux:proportion": "usr/lib/holo/holo-phi.css",
  "hosux:budget": "usr/lib/holo/holo-perf-budget.json",
};
const linkBad = [];
for (const link of (doctrine && doctrine.links) || []) {
  const file = LINK_FILES[link.rel];
  if (!file) { linkBad.push(`${link.rel}: unmapped`); continue; }
  const want = String(link.id).split(":").pop();
  const got = sha256hex(readFileSync(join(OS, file)));
  if (want !== got) linkBad.push(`${link.rel}: ${file} does not re-derive`);
}
set(`all ${Object.keys(LINK_FILES).length} source links re-derive against the on-disk files (Law L5)`,
  (doctrine?.links?.length === Object.keys(LINK_FILES).length) && linkBad.length === 0);

// ── 2 · ns/ux.jsonld has not drifted from the one materializer ────────────────────────────────────
let ontoOnDisk = null;
try { ontoOnDisk = JSON.parse(read("usr/share/ns/ux.jsonld")); } catch {}
set("ns/ux.jsonld is byte-faithful to toOntology() (no drift — re-seal after editing the doctrine)",
  !!ontoOnDisk && jcs(ontoOnDisk) === jcs(toOntology()));
set("ns/ux.jsonld declares the hosux: OWL ontology + the SKOS doctrine scheme",
  !!ontoOnDisk && ontoOnDisk["@type"] === "owl:Ontology" && (ontoOnDisk["@graph"] || []).some((t) => t["@id"] === "https://hologram.os/ns/ux#doctrine"));

// ── 3 · completeness — all 13 tenets, each with a checkable obligation ────────────────────────────
const founding = TENETS.filter((t) => t.group === "founding").length;
const jobs = TENETS.filter((t) => t.group === "jobs").length;
set("the doctrine carries the 5 founding tenets", founding === 5);
set("the doctrine carries Steve Jobs's 8 UX-lesson tenets", jobs === 8);
set("every tenet has a non-empty checkable obligation + a definition",
  TENETS.length === 13 && TENETS.every((t) => t.id && t.label && t.principle.trim() && t.obligation.trim()));
const embeddedTenets = (doctrine && doctrine["hosux:tenets"]) || [];
set("the sealed object embeds all 13 tenets + obligations (the parameters a per-app ratchet binds)",
  embeddedTenets.length === 13 && embeddedTenets.every((t) => t["@id"] && t["hosux:obligation"]));
// the founding brief is actually represented (not just counted)
const ids = new Set(TENETS.map((t) => t.id));
for (const need of ["native-adaptive", "familiar-effortless", "moments-of-magic", "sacred-resources", "signal-over-noise"])
  set(`the brief is encoded: tenet "${need}" is present`, ids.has(need));

// ── 4 · native-OS autodetect → distinct native feel, faithfully sealed ────────────────────────────
const profiles = Object.fromEntries(PLATFORM_OSES.map((os) => [os, profileFor(navFor(os))]));
for (const named of ["windows", "macos", "android", "ios", "linux"])
  set(`autodetect resolves the user-named host "${named}"`, profiles[named] && profiles[named].os === named);
set("iPadOS + ChromeOS are also resolved (7 hosts total)", profiles.ipados?.os === "ipados" && profiles.chromeos?.os === "chromeos");
const vals = Object.values(profiles);
set("the native feel DIFFERS by host — both modifier keys (⌘ meta / Ctrl control) appear",
  vals.some((p) => p.modKey === "meta") && vals.some((p) => p.modKey === "control"));
set("the native feel DIFFERS by host — window controls sit left (macOS) AND right (Win/Linux)",
  vals.some((p) => p.controlsSide === "left") && vals.some((p) => p.controlsSide === "right"));
set("the native feel DIFFERS by host — ≥3 distinct native accents", new Set(vals.map((p) => p.accent)).size >= 3);
// faithfulness: the sealed matrix is exactly what the live resolver produces.
const FIELDS = ["label", "mobile", "apple", "touch", "modKey", "modSymbol", "altSymbol", "controlsSide", "controlStyle", "font", "accent", "shortcuts"];
const matrix = (doctrine && doctrine["hosux:platformProfiles"]) || {};
const matrixBad = PLATFORM_OSES.filter((os) => {
  const live = Object.fromEntries(FIELDS.map((f) => [f, profiles[os][f]]));
  return jcs(live) !== jcs(matrix[os] || {});
});
set("the sealed platform matrix is FAITHFUL to the live HoloPlatform resolver (no restatement)",
  Object.keys(matrix).length === 7 && matrixBad.length === 0);

// ── 5 · the runtime applies it + the shell loads it ───────────────────────────────────────────────
const ux = read("usr/lib/holo/holo-ux.js");
set("holo-ux.js autodetects the host (imports profileFor) + carries it in the resolved state",
  /from\s+["']\.\/holo-platform\.js["']/.test(ux) && /state\.platform/.test(ux));
set("holo-ux.js adapts the chrome to the host (stamps data-holo-platform / -mod / -controls)",
  ux.includes("data-holo-platform") && ux.includes("data-holo-mod") && ux.includes("data-holo-controls"));
set("holo-ux.js seeds the native accent + font without overriding the user's choice",
  /setAccent/.test(ux) && /setFontFamily/.test(ux) && /st\.accent/.test(ux));
set("holo-ux.js still resolves the capability tier + propagates over postMessage",
  ux.includes("resolveTier") && ux.includes("postMessage"));
const home = read("usr/share/frame/home.html");
set("the desktop shell (home.html) loads the Holo UX runtime", home.includes("_shared/holo-ux.js"));

// ── 6 · capability resolution is pure + conservative + honest headless ────────────────────────────
set("tier resolution is conservative — unknown capability never fabricates 'rich'", resolveTier({}) === "standard");
set("tier resolution drops to 'lean' on an explicit low signal", resolveTier({ saveData: true }) === "lean");
set("tier resolution reaches 'rich' only on explicit high mem+cpu+gpu", resolveTier({ deviceMemory: 8, cpu: 8, gpu: "webgpu" }) === "rich");
set("the headless probe degrades honestly to 'standard'", resolveTier(headlessProbe()) === "standard");
set("the sealed object embeds the 3 capability tiers", TIERS.every((t) => doctrine && doctrine["hosux:capabilityTiers"]?.[t]));

// ── 7 · the plain voice register holds in the doctrine's own words ────────────────────────────────
const voiceTexts = [doctrine?.["schema:description"] || "", ...TENETS.map((t) => `${t.principle} ${t.obligation}`)];
const jargonHits = voiceTexts.flatMap((t) => lint(t).jargon.map((j) => j.term));
set("the doctrine practises the plain voice (no jargon in its own descriptions)", jargonHits.length === 0);
set("the sealed object declares the voice register", !!doctrine?.["hosux:voiceRegister"]?.rule);

// ── 8 · sacred resources — a real, declared budget (RAIL) ─────────────────────────────────────────
const budgetTiers = (doctrine && doctrine["hosux:resourceBudget"]) || {};
set("the embedded resource budget keeps interaction ≤100ms on every tier (RAIL response)",
  TIERS.length > 0 && TIERS.every((t) => budgetTiers[t] && budgetTiers[t].interactionMs <= 100));

// ── verdict ───────────────────────────────────────────────────────────────────────────────────────
const witnessed = Object.values(checks).every(Boolean);
for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} — ${k}`);
if (linkBad.length) console.log("  link mismatches:", linkBad.join("; "));
if (matrixBad.length) console.log("  matrix drift:", matrixBad.join(", "));
if (jargonHits.length) console.log("  jargon:", jargonHits.join(", "));

writeFileSync(join(here, "holo-ux-witness.result.json"), JSON.stringify({
  spec: "Holo UX (ADR-0062) is the single canonical, self-verifying source of the experience: the host OS is autodetected and the native feel adapts dynamically; 13 tenets (the founding 5 + Steve Jobs's 8 UX lessons) are each a checkable obligation; the canonical parameters are sealed as a UOR object (etc/holo-ux/doctrine.uor.json) that re-derives to its content address and whose source links re-derive (Law L5). The experience analogue of the Holo UI token contract — apps bind the κ, they do not re-implement UX.",
  authority: "ADR-0062 (Holo UX doctrine) · ADR-0030 (Holo UI) · ADR-0028 (Holo UX Profile) · W3C UA Client Hints (host autodetect) · WCAG 2.2 · RAIL / W3C Web Performance · SKOS / OWL 2 / RDFS · UOR-ADDR (κ = H(canonical_form)) · verify by re-derivation (Law L5)",
  witnessed,
  covers: ["holo-ux", "native-os-autodetect", "doctrine", "13-tenets", "self-verifying", "capability-tier", "plain-voice", "resource-budget", "law-l5", "conformance"],
  doctrineKappa: doctrine?.id || null,
  tenets: TENETS.length,
  hosts: PLATFORM_OSES,
  checks,
  linkBad, matrixBad, jargonHits,
}, null, 2) + "\n");

console.log(`\nholo-ux: ${witnessed ? "WITNESSED" : "FAILED"} · ${Object.keys(checks).length} checks · ${TENETS.length} tenets · ${PLATFORM_OSES.length} hosts`);
process.exit(witnessed ? 0 : 1);
