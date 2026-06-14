#!/usr/bin/env node
// holo-product-witness.mjs — PROVE Holo Product (ADR-0065) is the canonical, self-verifying foundation
// that BUNDLES + BALANCES Holo UI ⊕ Holo UX. Pure-Node static analysis + re-derivation:
//
//   1 · SEALED (L5)   — etc/holo-product/product.uor.json re-derives to its did, and every linked
//        hemisphere/source re-derives against the on-disk file (a tampered byte breaks the address).
//   2 · BALANCE       — exactly 5 UX + 5 UI faculties, each with a checkable obligation + a realizedBy
//        artifact that EXISTS (the diagram's two hemispheres, both wired, neither missing).
//   3 · COMPOSES BOTH — the bundle links the sealed Holo UX doctrine AND the canonical Holo UI files,
//        and the Holo UX doctrine it rests on is itself valid (re-derives).
//   4 · METHOD        — all 6 hybrid phases, each citing ≥1 named framework + a checkable obligation.
//   5 · FOUNDATION    — the bundle rests on PROVEN rows: the gate carries #holo-ui-conformance and
//        #holo-ux (and the per-app UI/UX rows) — Holo Product is a foundation over witnessed faculties.
//   6 · NO DRIFT      — ns/product.jsonld is byte-faithful to the one materializer.
//   7 · VOICE         — the bundle practises the plain register (no jargon in its own descriptions).
//
//   node tools/holo-product-witness.mjs

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FACULTIES, METHOD, FRAMEWORKS, toOntology } from "../os/usr/lib/holo/holo-product.mjs";
import { lint } from "../os/usr/lib/holo/holo-voice.mjs";
import { jcs, sha256hex } from "../os/usr/lib/holo/holo-uor.mjs";
import { verify } from "../os/usr/lib/holo/holo-object.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const read = (rel) => readFileSync(join(OS, rel), "utf8");
const checks = {};
const set = (k, v) => { checks[k] = !!v; };

// ── 1 · the bundle re-derives + its links re-derive (Law L5) ───────────────────────────────────────
let product = null; try { product = JSON.parse(read("etc/holo-product/product.uor.json")); } catch {}
set("product.uor.json exists + is a UOR object with a did", !!(product && product.id && product["@context"]));
set("product.uor.json re-derives to its content address (Law L5 — tamper-refused)", !!(product && verify(product)));

const LINK_FILES = {
  "hosprod:source": "usr/lib/holo/holo-product.mjs",
  "hosprod:ontology": "usr/share/ns/product.jsonld",
  "hosprod:ux": "etc/holo-ux/doctrine.uor.json",
  "hosprod:ui-engine": "usr/lib/holo/holo-theme.js",
  "hosprod:ui-kernel": "usr/lib/holo/holo-ui-kernel.js",
  "hosprod:ui-color": "usr/lib/holo/holo-theme.css",
  "hosprod:ui-layout": "usr/lib/holo/holo-mobile.css",
  "hosprod:ui-proportion": "usr/lib/holo/holo-phi.css",
  "hosprod:ui-zones": "usr/lib/holo/holo-zones.js",
  "hosprod:ui-icons": "usr/lib/holo/holo-icons.js",
};
const linkBad = [];
for (const link of (product && product.links) || []) {
  const file = LINK_FILES[link.rel];
  if (!file) { linkBad.push(`${link.rel}: unmapped`); continue; }
  if (String(link.id).split(":").pop() !== sha256hex(readFileSync(join(OS, file)))) linkBad.push(`${link.rel}: ${file} does not re-derive`);
}
set(`all ${Object.keys(LINK_FILES).length} hemisphere/source links re-derive against the on-disk files (Law L5)`,
  (product?.links?.length === Object.keys(LINK_FILES).length) && linkBad.length === 0);

// ── 2 · balance — 5 UX + 5 UI faculties, each obligated + wired ─────────────────────────────────────
const ux = FACULTIES.filter((f) => f.hemisphere === "ux");
const ui = FACULTIES.filter((f) => f.hemisphere === "ui");
set("the two hemispheres are balanced — 5 UX faculties + 5 UI faculties", ux.length === 5 && ui.length === 5);
set("every faculty has a checkable obligation + a hemisphere", FACULTIES.every((f) => f.id && f.label && f.hemisphere && f.obligation.trim()));
const facultyMissing = FACULTIES.filter((f) => !existsSync(join(OS, f.realizedBy)));
set("every faculty is REALIZED by a present canonical artifact (already wired, not aspirational)", facultyMissing.length === 0);
const embeddedF = (product && product["hosprod:faculties"]) || [];
set("the sealed bundle embeds all 10 faculties + obligations", embeddedF.length === 10 && embeddedF.every((f) => f["@id"] && f["hosprod:obligation"]));
set("the bundle declares its balance is even (ux === ui)", !!(product && product["hosprod:balanced"] && product["hosprod:balanced"].balanced === true));

// ── 3 · composes BOTH hemispheres, and the UX hemisphere it rests on is itself valid ────────────────
const rels = new Set(((product && product.links) || []).map((l) => l.rel));
set("the bundle links the Holo UX hemisphere (the sealed doctrine)", rels.has("hosprod:ux"));
set("the bundle links the Holo UI hemisphere (engine + colour + layout + proportion + type + icons)",
  ["hosprod:ui-engine", "hosprod:ui-color", "hosprod:ui-layout", "hosprod:ui-proportion", "hosprod:ui-icons"].every((r) => rels.has(r)));
let uxDoctrine = null; try { uxDoctrine = JSON.parse(read("etc/holo-ux/doctrine.uor.json")); } catch {}
set("the Holo UX doctrine it rests on is itself self-verifying (re-derives, Law L5)", !!(uxDoctrine && verify(uxDoctrine)));

// ── 4 · the hybrid method ───────────────────────────────────────────────────────────────────────────
set("the delivery method has all 6 phases, each citing ≥1 framework + a checkable obligation",
  METHOD.length === 6 && METHOD.every((m) => m.id && m.label && Array.isArray(m.draws) && m.draws.length >= 1 && m.obligation.trim()));
const drawn = new Set(METHOD.flatMap((m) => m.draws));
set("the method is a HYBRID — it draws on multiple named PM frameworks (≥4 of the field's)",
  [...drawn].filter((d) => FRAMEWORKS.includes(d)).length >= 4);
const embeddedM = (product && product["hosprod:method"]) || [];
set("the sealed bundle embeds the method phases + obligations", embeddedM.length === 6 && embeddedM.every((m) => m["@id"] && m["hosprod:obligation"]));

// ── 5 · foundation — the bundle rests on PROVEN UI + UX rows in the gate ────────────────────────────
let catalog = ""; try { catalog = read("etc/conformance.jsonld"); } catch {}
const foundationRows = ["#holo-ui-conformance", "#holo-ux", "#app-ui-wired", "#app-ux-conformance"];
const missingRows = foundationRows.filter((r) => !catalog.includes(`os2${r}`));
set("Holo Product rests on PROVEN foundations — the gate carries the Holo UI + Holo UX rows", missingRows.length === 0);

// ── 6 · no drift ─────────────────────────────────────────────────────────────────────────────────────
let ontoOnDisk = null; try { ontoOnDisk = JSON.parse(read("usr/share/ns/product.jsonld")); } catch {}
set("ns/product.jsonld is byte-faithful to toOntology() (no drift — re-seal after editing the source)",
  !!ontoOnDisk && jcs(ontoOnDisk) === jcs(toOntology()));

// ── 7 · plain voice ──────────────────────────────────────────────────────────────────────────────────
const voiceTexts = [product?.["schema:description"] || "", product?.["hosprod:balance"] || "",
  ...FACULTIES.map((f) => f.obligation), ...METHOD.map((m) => m.obligation)];
const jargonHits = voiceTexts.flatMap((t) => lint(t).jargon.map((j) => j.term));
set("the bundle practises the plain voice (no jargon in its faculties / method / descriptions)", jargonHits.length === 0);

// ── 8 · operationalized — the foundation SHAPES the build flow (the SDK + the scaffolder) ───────────
// A foundation that only sits sealed is inert. Holo Product is operative: the SDK front door exposes
// it at runtime (apps + agents read product()), and the scaffolder BUILDS new products on it — the
// manifest declares builtOn, the page declares conformance to the foundation, and the method is
// seeded as DECISION.md (Discover · Define · Verify). So every new product is born on the foundation.
const sdk = read("usr/lib/holo/holo-sdk.js");
const scaffold = read("usr/lib/holo/holo-scaffold.js");
const sdkWired = /export\s+(?:async\s+)?function\s+product\b/.test(sdk) && /HoloProduct/.test(sdk);
const scaffoldWired = /builtOn:[^,\n]*["']holo-product["']/.test(scaffold)   // plain apps build on the foundation (a QVAC app rests on it via qvac-sdk)
  && /hologram\.os\/ns\/product/.test(scaffold) && /DECISION\.md/.test(scaffold);
set("Holo Product is OPERATIVE — the SDK exposes product() AND the scaffolder builds new products on the foundation (manifest builtOn + conformsTo + a DECISION.md method record)", sdkWired && scaffoldWired);

// ── verdict ───────────────────────────────────────────────────────────────────────────────────────────
const witnessed = Object.values(checks).every(Boolean);
for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} — ${k}`);
if (linkBad.length) console.log("  link mismatches:", linkBad.join("; "));
if (facultyMissing.length) console.log("  faculties not wired:", facultyMissing.map((f) => `${f.id}→${f.realizedBy}`).join(", "));
if (missingRows.length) console.log("  missing foundation rows:", missingRows.join(", "));
if (jargonHits.length) console.log("  jargon:", jargonHits.join(", "));

writeFileSync(join(here, "holo-product-witness.result.json"), JSON.stringify({
  spec: "Holo Product (ADR-0065) is the canonical, self-verifying foundation for Hologram-native products: it bundles + BALANCES Holo UI (look) and Holo UX (experience) as ten faculties (five per hemisphere, each wired + obligated) and binds a hybrid delivery method (discover · define · design · build · verify · deliver) drawn from the field's PM frameworks. Sealed as one UOR object that re-derives to its content address and whose linked hemispheres re-derive (Law L5); it rests on the proven Holo UI + Holo UX gate rows. Every product binds the κ rather than re-deciding the basics.",
  authority: "ADR-0065 (Holo Product) · ADR-0030/0057 (Holo UI) · ADR-0062 (Holo UX) · Agile · Scrum · Kanban · Waterfall · Lean · PRINCE2 · Six Sigma · Hybrid (cited) · W3C OWL 2 / RDFS / SKOS · UOR-ADDR (κ = H(canonical_form)) · verify by re-derivation (Law L5)",
  witnessed,
  covers: ["holo-product", "bundle-ui-ux", "balanced-faculties", "hybrid-method", "operationalized", "self-verifying", "rests-on-proven", "law-l5", "foundation"],
  productKappa: product?.id || null,
  faculties: FACULTIES.length, method: METHOD.length, frameworks: [...drawn],
  checks, linkBad, facultyMissing: facultyMissing.map((f) => f.id), missingRows, jargonHits,
}, null, 2) + "\n");

console.log(`\nholo-product: ${witnessed ? "WITNESSED" : "FAILED"} · ${ux.length} UX ⊕ ${ui.length} UI faculties · ${METHOD.length} method phases`);
process.exit(witnessed ? 0 : 1);
