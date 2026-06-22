#!/usr/bin/env node
// holo-strand-ingest-witness.mjs — proves P2: THE "+" PROVENANCE DERIVES FROM THE SPINE. Ingestion is
// recorded as signed entries on the operator's source chain, and the hypergraph's provenance edges
// reconcile against it: every source κ a claim cites must trace to a signed `ingest` entry, or it is
// unprovenanced and refused (fail-closed). A tampered ingest log breaks the chain (Law L5).
//
// Drives the REAL substrate end-to-end: holo-ingest (the Port) seals sources, holo-map (the Map) builds
// the κ-hypergraph with prov edges, holo-strand is the spine, a REAL enrolled holo-identity principal
// signs, and holo-strand-provenance is the seam under test.
//
// Checks (all must hold):
//   1 ingestRecordedOnSpine    — each sealed source appends a signed `ingest` entry; spine verifies; order kept.
//   2 provenanceResolves       — provenanceOf(source κ) returns the signed entry that introduced it.
//   3 graphProvenanceReconciles— every prov edge in a REAL holo-map graph traces to a spine ingest entry (ok).
//   4 foreignSourceUnprovenanced— a source κ never ingested → provenanceOf null; reconcile flags it, ok=false.
//   5 tamperedIngestRefused    — mutate an ingest entry ⇒ spine.verify fails (provenance not trusted).
//   6 ingestEntriesSigned      — every ingest entry carries a verifying operator signature (authorship).
//
// Authority: UOR-ADDR (κ=H(canonical_form)) · W3C PROV-O · IETF RFC 8785 (JCS) · holospaces Laws L1/L2/L5 ·
// rests on #holo-ingest + #holo-map + #holo-strand + #holo-identity. node tools/holo-strand-ingest-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sealIngest } from "../os/usr/lib/holo/holo-ingest.mjs";
import { extractGraph } from "../os/usr/lib/holo/holo-map.mjs";
import { makeStrand, verifyEntry } from "../os/usr/lib/holo/holo-strand.mjs";
import { recordIngest, provenanceOf, reconcileProvenance } from "../os/usr/lib/holo/holo-strand-provenance.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = (init = []) => { let s = clone(init); return { load: async () => clone(s), save: async (r) => { s = clone(r); }, dump: () => clone(s) }; };
const enc = (s) => new TextEncoder().encode(s);
let tick = 0; const now = () => `2026-06-22T00:00:${String(tick++).padStart(2, "0")}.000Z`;

const op = await enroll({ label: "ingest-tester", passphrase: "correct horse battery ingest" });
const backend = arrayBackend();
const strand = makeStrand({ backend, now, signer: op });

// ── ingest three real sources through the Port, recording each on the spine ──────────────────────────
const DOCS = [
  { name: "acme.txt", text: "Acme Corp was founded in Berlin in 2019. CEO: Dana Lee." },
  { name: "beta.md", text: "Beta Labs was founded in Oslo in 2021. CTO: Sam Roe." },
  { name: "note.txt", text: "Gamma Inc raised funds in 2024." },
];
const sources = [];
for (const d of DOCS) {
  const m = sealIngest({ name: d.name, bytes: enc(d.text) });
  const entry = await recordIngest(strand, m);
  sources.push({ ...d, manifest: m, entry });
}

// ── 1 · each ingest is on the spine, signed, in order; the chain verifies ────────────────────────────
const ingEntries = strand.replay({ kind: "ingest" });
const v = await strand.verify();
ok("ingestRecordedOnSpine",
  v.ok && ingEntries.length === 3 && ingEntries.every((e, i) => e["holstr:seq"] === i)
  && ingEntries[0]["holstr:payload"].source === sources[0].manifest.source,
  JSON.stringify({ chain: v.ok, n: ingEntries.length }));

// ── 2 · provenanceOf resolves each source κ to its signed introducing entry ──────────────────────────
const resolved = sources.map((s) => provenanceOf(strand, s.manifest.source));
ok("provenanceResolves",
  resolved.every((e, i) => e && e["holstr:payload"].source === sources[i].manifest.source && e["holstr:sig"]),
  "each ingested source κ must resolve to its signed ingest entry");

// ── 3 · a REAL holo-map graph's provenance edges all trace to spine ingest entries ───────────────────
const graph = extractGraph({ text: DOCS[0].text, sourceKappa: sources[0].manifest.source });
const rec = reconcileProvenance(strand, graph);
ok("graphProvenanceReconciles",
  rec.ok && rec.unprovenanced.length === 0 && (graph["holo:provenance"] || []).length >= 1
  && graph["holo:provenance"].every((p) => p["prov:wasDerivedFrom"] === sources[0].manifest.source),
  JSON.stringify({ ok: rec.ok, prov: (graph["holo:provenance"] || []).length, unprov: rec.unprovenanced.length }));

// ── 4 · a source κ never ingested is unprovenanced (drift/injection caught, fail-closed) ─────────────
const foreign = "did:holo:sha256:" + "f".repeat(64);
const foreignGraph = { "holo:provenance": [{ "holo:claim": "x", "prov:wasDerivedFrom": foreign }] };
const recF = reconcileProvenance(strand, foreignGraph);
ok("foreignSourceUnprovenanced",
  provenanceOf(strand, foreign) === null && recF.ok === false && recF.unprovenanced.includes(foreign),
  JSON.stringify(recF));

// ── 5 · tampering an ingest entry breaks the chain — provenance is not trusted (Law L5) ──────────────
const bad = clone(backend.dump());
const idx = bad.findIndex((e) => e["holstr:kind"] === "ingest");
bad[idx]["holstr:payload"].source = foreign;            // forge which source this entry introduced
const vbad = await makeStrand({ backend: arrayBackend(bad) }).verify();
ok("tamperedIngestRefused", vbad.ok === false && vbad.brokeAt === idx, JSON.stringify(vbad));

// ── 6 · every ingest entry carries a verifying operator signature ────────────────────────────────────
const sigs = await Promise.all(ingEntries.map((e) => verifyEntry(e)));
ok("ingestEntriesSigned", sigs.every((r) => r.ok && r.signed) && ingEntries.every((e) => e["holstr:op"] === op.kappa), JSON.stringify(sigs.map((r) => r.ok)));

await forget(op.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-strand P2 — THE '+' PROVENANCE DERIVES FROM THE SPINE: ingestion is recorded as signed, hash-linked `ingest` entries on the operator source chain, and the holo-map hypergraph's provenance edges reconcile against it — every source κ a claim cites must trace to a signed ingest entry, else it is unprovenanced and refused (fail-closed). A tampered ingest log breaks the chain (Law L5). The Port and Map are unchanged; the ingest log is one projection of the single spine.",
  authority: "UOR-ADDR (κ=H(canonical_form)) · W3C PROV-O · IETF RFC 8785 (JCS) · holospaces Laws L1/L2/L5 · rests on #holo-ingest + #holo-map + #holo-strand + #holo-identity",
  witnessed,
  covers: witnessed ? ["ingest-on-spine", "provenance-resolves", "graph-reconciles", "foreign-unprovenanced", "tamper-refused", "ingest-signed"] : [],
  sample: { sources: sources.map((s) => s.manifest.source.slice(0, 20) + "…"), graphProv: (graph["holo:provenance"] || []).length, strandHead: strand.head() },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-strand-ingest-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-strand witness — P2 THE '+' PROVENANCE DERIVES FROM THE SPINE (ingest on the source chain)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ingested: ${ingEntries.length} sources on the spine · graph prov edges: ${(graph["holo:provenance"] || []).length} · all reconcile: ${rec.ok}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  every claim's evidence traces to a signed ingest on the one spine" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
