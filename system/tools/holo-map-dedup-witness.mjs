#!/usr/bin/env node
// holo-map-dedup-witness.mjs — proves S2 of "the +": DEDUP IS FREE, and this is where κ beats ANIMA.
// ANIMA scatters its graph across Redis/Qdrant/Postgres, so the same entity from two documents is two rows
// glued by app logic. On the κ-substrate an entity's address IS H(its identity), so the SAME entity ingested
// from TWO different sources collapses to ONE node κ with NO merge logic — and a claim asserted by both
// sources keeps ONE claim κ but TWO provenance κs (multi-source attestation, the evidence set S5 will cite).
//
// Two DISTINCT sources (distinct ingest source κs) that mention overlapping facts are mapped, then merged.
//
// Checks (all must hold):
//   1 distinctSources             — the two documents seal to DIFFERENT ingest source κs (genuinely two inputs).
//   2 sharedEntityCollapses       — "Acme Corp" from source A and source B is ONE node κ in the merged graph.
//   3 collapseCounted             — merged entity count < (entitiesA + entitiesB): the overlap actually collapsed.
//   4 sharedClaimOneKappaTwoProv  — a fact in BOTH docs → ONE claim κ but TWO provenance κs (one per source).
//   5 evidenceSetIsMultiSource    — sourcesForClaim(shared claim) = {source A, source B}, both re-derivable.
//   6 uniqueFactStaysSingleProv   — a fact in only ONE doc → ONE claim κ with ONE provenance κ (no phantom evidence).
//   7 mergeOrderInvariantClosure  — merge(A,B) and merge(B,A) yield the SAME graphClosure κ (Law L2 determinism).
//   8 mergedClosureReDerives      — the merged graphClosure κ re-derives from its sorted members (Law L5).
//
// Authority: UOR-ADDR (κ = H(canonical_form)) · W3C PROV-O · IETF RFC 8785 (JCS) · holospaces Laws L2/L5 ·
// rests on #holo-ingest (S0) + #holo-map (S1). node tools/holo-map-dedup-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sealIngest } from "../os/usr/lib/holo/holo-ingest.mjs";
import { extractGraph, mergeGraphs, sourcesForClaim } from "../os/usr/lib/holo/holo-map.mjs";
import { jcs } from "../os/usr/lib/holo/holo-uor.mjs";
import { reDerive } from "../os/sbin/holo-resolver.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const enc = (s) => new TextEncoder().encode(s);
const reKappa = async (bytes) => "did:holo:sha256:" + (await reDerive(bytes));

// ── two DISTINCT sources, overlapping facts. BOTH say "Acme Corp ... in Berlin"; only B adds the CEO. ──
const DOC_A = "Acme Corp operates in Berlin. Acme Corp shipped 12 products in 2023.";
const DOC_B = "Acme Corp is based in Berlin. CEO: Dana Lee leads the company.";
const srcA = sealIngest({ name: "a.txt", bytes: enc(DOC_A) });
const srcB = sealIngest({ name: "b.txt", bytes: enc(DOC_B) });
const gA = extractGraph({ text: DOC_A, sourceKappa: srcA.source });
const gB = extractGraph({ text: DOC_B, sourceKappa: srcB.source });
const merged = mergeGraphs([gA, gB]);

// ── 1 · genuinely two inputs ────────────────────────────────────────────────────────────────────────
ok("distinctSources", srcA.source !== srcB.source, "the two docs must seal to different source κs");

// ── 2 · the shared entity collapses to ONE node κ across the two sources ───────────────────────────
const acmeA = gA["holo:entities"].find((e) => e["schema:name"] === "Acme Corp");
const acmeB = gB["holo:entities"].find((e) => e["schema:name"] === "Acme Corp");
const acmeMerged = merged["holo:entities"].filter((e) => e["schema:name"] === "Acme Corp");
ok("sharedEntityCollapses",
  !!acmeA && !!acmeB && acmeA["@id"] === acmeB["@id"] && acmeMerged.length === 1 && acmeMerged[0]["@id"] === acmeA["@id"],
  `A=${acmeA && acmeA["@id"].slice(0,20)} B=${acmeB && acmeB["@id"].slice(0,20)} merged=${acmeMerged.length}`);

// ── 3 · the collapse is real: merged entities fewer than the naive sum ──────────────────────────────
const sum = gA["holo:entities"].length + gB["holo:entities"].length;
ok("collapseCounted", merged["holo:stats"].entities < sum,
  `merged ${merged["holo:stats"].entities} < A+B ${sum}`);

// ── 4 · a shared claim (Acme located in Berlin, asserted by BOTH) → ONE claim κ, TWO provenance κs ──
const berlinClaims = merged["holo:claims"].filter((c) => c["holo:objectKind"] === "entity"
  && c["holo:subject"] === acmeA["@id"] && c["holo:predicate"] === "schema:location");
const sharedClaim = berlinClaims[0];
const provForShared = sharedClaim ? merged["holo:provenance"].filter((p) => p["holo:claim"] === sharedClaim["@id"]) : [];
ok("sharedClaimOneKappaTwoProv",
  berlinClaims.length === 1 && provForShared.length === 2,
  `berlinClaims=${berlinClaims.length} prov=${provForShared.length} (expect 1 claim, 2 prov)`);

// ── 5 · the evidence set is genuinely multi-source and re-derivable ─────────────────────────────────
const ev = sharedClaim ? sourcesForClaim(merged, sharedClaim["@id"]).sort() : [];
ok("evidenceSetIsMultiSource",
  ev.length === 2 && ev.includes(srcA.source) && ev.includes(srcB.source)
  && srcA.source === (await reKappa(enc(DOC_A))) && srcB.source === (await reKappa(enc(DOC_B))),
  `evidence=${ev.map((k) => k.slice(0,16)).join(",")}`);

// ── 6 · a UNIQUE fact (only doc B names a CEO) → one claim, one provenance (no phantom evidence) ────
const ceoClaims = merged["holo:claims"].filter((c) => /hasRole\/CEO/.test(c["holo:predicate"]));
const ceoProv = ceoClaims[0] ? sourcesForClaim(merged, ceoClaims[0]["@id"]) : [];
ok("uniqueFactStaysSingleProv",
  ceoClaims.length === 1 && ceoProv.length === 1 && ceoProv[0] === srcB.source,
  `ceoClaims=${ceoClaims.length} prov=${ceoProv.length}`);

// ── 7 · merge is order-invariant: merge(A,B).closure === merge(B,A).closure (Law L2) ────────────────
const mergedBA = mergeGraphs([gB, gA]);
ok("mergeOrderInvariantClosure", merged["holo:graphClosure"] === mergedBA["holo:graphClosure"]);

// ── 8 · the merged closure re-derives from its sorted members (Law L5) ──────────────────────────────
const members = [...merged["holo:entities"], ...merged["holo:claims"], ...merged["holo:provenance"]].map((n) => n["@id"]).sort();
ok("mergedClosureReDerives", (await reKappa(enc(jcs(members)))) === merged["holo:graphClosure"]);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "the + — S2 DEDUP: the same entity ingested from two DISTINCT sources collapses to one node κ with no merge logic (the address IS H(identity)); a claim asserted by both sources keeps one claim κ but two provenance κs (multi-source attestation); a claim from one source keeps one provenance κ. Merge is order-invariant (Law L2) and the merged closure re-derives from its members (Law L5). This is the structural advantage over ANIMA's 3-database graph: dedup and multi-source evidence are free, not glued by app logic",
  authority: "UOR-ADDR (κ = H(canonical_form)) · W3C PROV-O · IETF RFC 8785 (JCS) · holospaces Laws L2/L5 · rests on #holo-ingest (S0) + #holo-map (S1)",
  witnessed,
  covers: witnessed ? ["dedup","shared-entity-collapse","multi-source-provenance","evidence-set","merge-order-invariant","law-l2","law-l5","beats-anima-graph"] : [],
  sample: { srcA: srcA.source, srcB: srcB.source, mergedStats: merged["holo:stats"],
            sharedAcme: acmeMerged[0] && acmeMerged[0]["@id"], evidenceForSharedClaim: ev },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-map-dedup-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-map dedup witness — S2 the + (two sources → one deduped κ-hypergraph, multi-source provenance)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  merged: ${merged["holo:stats"].entities} entities · ${merged["holo:stats"].claims} claims · ${merged["holo:stats"].provenance} prov · ${merged["holo:stats"].sources} sources`);
console.log(`  shared "Acme Corp" κ = ${acmeMerged[0] ? acmeMerged[0]["@id"].slice(0, 32) : "?"}…  attested by ${ev.length} sources`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  same entity from two sources = one κ; shared claim = two evidence κs. Dedup is free." : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
