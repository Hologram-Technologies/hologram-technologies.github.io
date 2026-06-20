#!/usr/bin/env node
// holo-brief-witness.mjs — proves S6 of "the +": THE BRIEF. The insight κs (S4) with enforced provenance (S5)
// become one proactive message — ANIMA's "first letter" — delivered to the inbox/voice with NO query. The brief
// is a sealed κ-object (portable κ-DAG, S8) and it RENDERS BY VERIFICATION: each line is re-checked against the
// live evidence at display time, so a claim whose source was tampered simply does not appear (verify-before-show).
//
// Checks (all must hold):
//   1 briefComposesAndSeals      — insights → a holo:Brief κ-object whose κ re-derives (Law L5).
//   2 orderedByConfidence        — brief items are ordered highest-confidence first (the reader sees the strongest first).
//   3 proactiveLetterRenders     — renderBrief produces a human "first letter" summary built from VERIFIED insights, no query.
//   4 everyLineClicksThrough     — every rendered line carries evidence κs that exist in the graph (click-through to proof).
//   5 tamperHidesThatClaim       — tamper a source ⇒ insights citing it DROP from the render and are named in `refused`.
//   6 untamperedLinesRemain      — lines whose evidence is intact still render after the tamper (selective, not all-or-nothing).
//   7 deliveredProactively       — deliver() pushes the rendered brief to an injected inbox sink (unrequested push).
//   8 sinkNeverCarriesUnverified — the delivered body's line count equals the VERIFIED count (a tampered claim never ships).
//
// Authority: UOR-ADDR (κ = H(canonical_form)) · W3C PROV-O · IETF RFC 8785 (JCS) · holospaces Law L5 · rests on
// #holo-ingest + #holo-map + #holo-insight (S0–S5). node tools/holo-brief-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sealIngest } from "../os/usr/lib/holo/holo-ingest.mjs";
import { extractGraph, mergeGraphs } from "../os/usr/lib/holo/holo-map.mjs";
import { investigate } from "../os/usr/lib/holo/holo-insight.mjs";
import { composeBrief, renderBrief, deliver } from "../os/usr/lib/holo/holo-brief.mjs";
import { sha256hex, didHolo, jcs } from "../os/usr/lib/holo/holo-uor.mjs";
import { reDerive } from "../os/sbin/holo-resolver.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const enc = (s) => new TextEncoder().encode(s);

// ── build the chain through to insights, keep original source bytes ─────────────────────────────────
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
const sourceBytes = new Map([[srcA.source, bytesA], [srcB.source, bytesB]]);
const brief = composeBrief({ graph, insights, title: "What the + found", now: () => "2026-06-19T00:00:00Z" });

// ── 1 · the brief composes and its κ re-derives ─────────────────────────────────────────────────────
const reBriefKappa = "did:holo:sha256:" + (await reDerive(enc(jcs({ t: "brief", title: "What the + found", graph: graph["holo:graphClosure"], insights: brief["holo:items"].map((i) => i["@id"]).sort() }))));
ok("briefComposesAndSeals",
  brief["@type"].includes("holo:Brief") && brief["holo:insightCount"] === insights.length && reBriefKappa === brief["@id"],
  `brief κ ${brief["@id"].slice(0, 20)}…`);

// ── 2 · items ordered by confidence (descending) ───────────────────────────────────────────────────
const confs = brief["holo:items"].map((i) => i["holo:confidence"]);
ok("orderedByConfidence", confs.every((c, n) => n === 0 || confs[n - 1] >= c), `confs=${confs.map((c) => c.toFixed(2)).join(",")}`);

// ── 3 · the proactive letter renders from verified insights ─────────────────────────────────────────
const r0 = renderBrief(brief, { graph, sourceBytes });
ok("proactiveLetterRenders", r0.ok && /worth your attention/.test(r0.summary) && r0.lines.length === insights.length);

// ── 4 · every rendered line clicks through to evidence present in the graph ─────────────────────────
const nodeIds = new Set([...graph["holo:entities"], ...graph["holo:claims"], ...graph["holo:provenance"]].map((n) => n["@id"]));
ok("everyLineClicksThrough", r0.lines.every((l) => l.evidence.length > 0 && l.evidence.every((k) => nodeIds.has(k))));

// ── 5/6 · tamper source A ⇒ its claims drop from the render; intact lines remain ───────────────────
const tampered = new Map(sourceBytes); tampered.set(srcA.source, enc(DOC_A + " (forged)"));
const rT = renderBrief(brief, { graph, sourceBytes: tampered });
const citesA = (id) => insights.find((i) => i["@id"] === id)["prov:wasDerivedFrom"].includes(srcA.source);
ok("tamperHidesThatClaim",
  rT.refused.length > 0 && rT.refused.every((x) => citesA(x.insight)) && rT.lines.every((l) => !citesA(l.insight)),
  `refused=${rT.refused.length} lines=${rT.lines.length}`);
ok("untamperedLinesRemain",
  rT.lines.length === insights.filter((i) => !i["prov:wasDerivedFrom"].includes(srcA.source)).length);

// ── 7 · delivered proactively to an injected inbox sink ─────────────────────────────────────────────
let pushed = null;
const inbox = async (msg) => { pushed = msg; return { delivered: true, id: "inbox-1" }; };
const d = await deliver(brief, { sink: inbox, graph, sourceBytes });
ok("deliveredProactively",
  d.ack.delivered === true && pushed && pushed.briefKappa === brief["@id"] && /worth your attention/.test(pushed.body) && pushed.lineCount === insights.length);

// ── 8 · a tampered claim never ships: delivered line count == verified count ────────────────────────
const dT = await deliver(brief, { sink: inbox, graph, sourceBytes: tampered });
ok("sinkNeverCarriesUnverified",
  pushed.lineCount === rT.lines.length && pushed.lineCount < insights.length && pushed.refusedCount === rT.refused.length);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "the + — S6 BRIEF: insight κs (S4) with enforced provenance (S5) become one proactive message (ANIMA's first letter), delivered to the inbox/voice with no query. The brief is a sealed κ-object ordered by confidence; it renders BY VERIFICATION — each line re-checked against the live evidence at display time, so a claim whose source was tampered drops out and is named in `refused`; intact lines remain. Delivery is a swappable sink and never carries an unverified claim",
  authority: "UOR-ADDR (κ = H(canonical_form)) · W3C PROV-O · IETF RFC 8785 (JCS) · holospaces Law L5 · rests on #holo-ingest + #holo-map + #holo-insight",
  witnessed,
  covers: witnessed ? ["brief","proactive-letter","sealed-kappa","ordered-by-confidence","click-through-evidence","verify-before-show","tamper-hides-claim","inbox-delivery"] : [],
  sample: { briefKappa: brief["@id"], insightCount: brief["holo:insightCount"], letter: r0.summary, refusedOnTamper: rT.refused.length },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-brief-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-brief witness — S6 the + (insights → proactive 'first letter' → inbox, verify-before-show)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ── the proactive brief (delivered with no query) ──\n`);
console.log(r0.summary.split("\n").map((l) => "    " + l).join("\n"));
console.log(`\n  brief κ ${brief["@id"].slice(0, 28)}…  ·  tamper a source → ${rT.refused.length} claims vanish, ${rT.lines.length} remain`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  the + delivers a proactive, provenance-verified brief — the magic, end to end" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
