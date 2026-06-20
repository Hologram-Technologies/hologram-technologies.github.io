#!/usr/bin/env node
// holo-insight-provenance-witness.mjs — proves S5 of "the +": PROVENANCE IS ENFORCED, not decorative. An
// insight is only as trustworthy as the evidence it cites. verifyInsight re-derives the WHOLE chain — insight κ
// ← evidence κs present in the graph ← source κs re-derive from their ORIGINAL bytes — and a renderer (the
// brief, S6) must REFUSE any insight whose chain is broken. This is the ADR done-check: tamper one evidence
// source and watch the dependent insight refuse to render, while insights resting on other evidence stand.
//
// Checks (all must hold):
//   1 cleanChainVerifies         — with all original bytes present, every insight verifies (ok:true).
//   2 tamperSourceRefusesInsight — mutate one source's bytes ⇒ insights citing it become ok:false (refuse to render).
//   3 untouchedInsightsStand     — insights NOT citing the tampered source still verify (selective, not all-or-nothing).
//   4 restoreReVerifies          — restore the original bytes ⇒ the refused insight verifies again.
//   5 missingSourceRefuses       — drop a source's bytes entirely (unresolvable evidence) ⇒ ok:false.
//   6 forgedInsightIdRefused     — flip an insight's text without re-deriving its κ ⇒ ok:false (no forged claims).
//   7 danglingEvidenceRefused    — an insight citing a κ absent from the graph ⇒ ok:false.
//   8 brokenReportIsSpecific     — the refusal names WHICH link broke (source vs evidence vs id) — auditable, not opaque.
//
// Authority: UOR-ADDR (κ = H(canonical_form)) · W3C PROV-O · IETF RFC 8785 (JCS) · holospaces Law L5 (verify
// by re-derivation). rests on #holo-ingest + #holo-map + #holo-insight. node tools/holo-insight-provenance-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sha256hex } from "../os/usr/lib/holo/holo-uor.mjs";
import { sealIngest } from "../os/usr/lib/holo/holo-ingest.mjs";
import { extractGraph, mergeGraphs } from "../os/usr/lib/holo/holo-map.mjs";
import { investigate, verifyInsight } from "../os/usr/lib/holo/holo-insight.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const enc = (s) => new TextEncoder().encode(s);

// ── build the chain: two sources → merged graph → insights; keep the ORIGINAL source bytes (the resolver's job) ──
const DOC_A = "Acme Corp operates in Berlin. Acme Corp shipped 12 products in 2023.";
const DOC_B = "Acme Corp is based in Berlin. CEO: Dana Lee leads the company.";
const bytesA = enc(DOC_A), bytesB = enc(DOC_B);
const srcA = sealIngest({ name: "a.txt", bytes: bytesA });
const srcB = sealIngest({ name: "b.txt", bytes: bytesB });
const graph = mergeGraphs([
  extractGraph({ text: DOC_A, sourceKappa: srcA.source }),
  extractGraph({ text: DOC_B, sourceKappa: srcB.source }),
]);
const insights = await investigate(graph);
const sourceBytes = new Map([[srcA.source, bytesA], [srcB.source, bytesB]]);   // the original, untampered bytes

// ── 1 · clean chain: everything verifies ────────────────────────────────────────────────────────────
ok("cleanChainVerifies", insights.length > 0 && insights.every((i) => verifyInsight(i, { graph, sourceBytes }).ok));

// ── 2/3 · tamper source A's bytes → insights citing A refuse; insights NOT citing A still stand ─────
const tampered = new Map(sourceBytes);
tampered.set(srcA.source, enc(DOC_A + " (forged addendum)"));      // same κ key, different bytes ⇒ κ no longer re-derives
const citesA = (i) => i["prov:wasDerivedFrom"].includes(srcA.source);
const dependsOnA = insights.filter(citesA);
const independentOfA = insights.filter((i) => !citesA(i));
ok("tamperSourceRefusesInsight",
  dependsOnA.length > 0 && dependsOnA.every((i) => verifyInsight(i, { graph, sourceBytes: tampered }).ok === false),
  `${dependsOnA.length} insights cite source A`);
ok("untouchedInsightsStand",
  independentOfA.length === 0 || independentOfA.every((i) => verifyInsight(i, { graph, sourceBytes: tampered }).ok === true),
  `${independentOfA.length} insights independent of A`);

// ── 4 · restore the original bytes → the refused insight verifies again ─────────────────────────────
ok("restoreReVerifies", dependsOnA.every((i) => verifyInsight(i, { graph, sourceBytes }).ok === true));

// ── 5 · a source whose bytes are simply unresolvable (dropped) ⇒ refuse ─────────────────────────────
const missing = new Map([[srcB.source, bytesB]]);                  // srcA bytes absent entirely
ok("missingSourceRefuses", dependsOnA.every((i) => verifyInsight(i, { graph, sourceBytes: missing }).ok === false));

// ── 6 · a forged insight (text changed, κ not re-derived) ⇒ refuse ──────────────────────────────────
const forged = JSON.parse(JSON.stringify(insights[0]));
forged["schema:text"] = "Acme Corp is a guaranteed fraud.";       // a lie, but the @id still claims to be the old finding
const vForged = verifyInsight(forged, { graph, sourceBytes });
ok("forgedInsightIdRefused", vForged.ok === false && vForged.broken.insightId === true);

// ── 7 · an insight citing a κ that is not in the graph ⇒ refuse ─────────────────────────────────────
const dangling = JSON.parse(JSON.stringify(insights.find((i) => i["holo:kind"] === "single-source-risk") || insights[0]));
dangling["holo:evidence"] = [...dangling["holo:evidence"], "did:holo:sha256:" + "f".repeat(64)];
// re-derive the κ so ONLY the dangling-evidence rule fires (isolate from check 6)
const { didHolo, jcs } = await import("../os/usr/lib/holo/holo-uor.mjs");
dangling["@id"] = didHolo("sha256", sha256hex(enc(jcs({ t: "insight", kind: dangling["holo:kind"], text: dangling["schema:text"], evidence: [...dangling["holo:evidence"]].sort() }))));
const vDangling = verifyInsight(dangling, { graph, sourceBytes });
ok("danglingEvidenceRefused", vDangling.ok === false && vDangling.broken.evidence.length === 1);

// ── 8 · the refusal is specific: it names which link broke (auditable) ──────────────────────────────
const vTamper = verifyInsight(dependsOnA[0], { graph, sourceBytes: tampered });
ok("brokenReportIsSpecific",
  vTamper.ok === false && vTamper.broken.sources.includes(srcA.source)
  && vTamper.broken.insightId === false && vTamper.broken.evidence.length === 0);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "the + — S5 PROVENANCE ENFORCED: verifyInsight re-derives the whole chain (insight κ ← evidence κs in graph ← source κs from original bytes). Tampering one source's bytes makes insights citing it refuse to render (ok:false) while insights resting on other evidence stand; restoring the bytes re-verifies; a dropped source, a forged insight id, or dangling evidence each refuse; and the refusal names which link broke. Provenance is structural and enforced (Law L5), the ADR done-check made literal",
  authority: "UOR-ADDR (κ = H(canonical_form)) · W3C PROV-O · IETF RFC 8785 (JCS) · holospaces Law L5 · rests on #holo-ingest + #holo-map + #holo-insight",
  witnessed,
  covers: witnessed ? ["provenance-enforced","verify-before-render","tamper-refuse","selective-refusal","forged-id-refused","dangling-refused","auditable-refusal","law-l5"] : [],
  sample: { insightsVerified: insights.length, tamperedSource: srcA.source, dependsOnA: dependsOnA.length, independentOfA: independentOfA.length },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-insight-provenance-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-insight provenance witness — S5 the + (tamper an evidence source → dependent insight refuses)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${insights.length} insights verify clean · tamper source A → ${dependsOnA.length} refuse, ${independentOfA.length} stand · restore → re-verify`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  every insight is only as trustworthy as its evidence — tamper-refuse is structural" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
