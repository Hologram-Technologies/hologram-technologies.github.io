#!/usr/bin/env node
// holo-foresight-live-witness.mjs — proves PROOF OF FORESIGHT IN ONE CALL (holo-foresight-live): the bound
// live loop that ties THE + (the private κ-graph), the read-only crowd feed, the best-present belief reader
// (Q else baseline), and the source-chain commit into a single tick — with each seam a graceful upgrade,
// never a hard dependency. The end-to-end path is driven through the REAL feed adapter with an INJECTED
// fetch (no network) and a REAL signed strand.
//
// Checks (all must hold):
//   1 bindAutoBaseline   — no brain ⇒ the deterministic baseline reader is bound.
//   2 bindAutoQ          — a brain present ⇒ Q's reader is bound (belief p comes from the brain).
//   3 watchCommits       — watch(graph, markets) scans + commits a verifiable belief onto the chain.
//   4 runFromFeed        — run() pulls markets through the REAL feed (injected fetch) and scans them.
//   5 feedReadOnly       — the bound loop exposes NO order/spend path (read + commit-belief only).
//   6 scanOnlyNoStrand   — no strand ⇒ watch scans but commits nothing (zero side effects).
//   7 proofsOnChain      — proofs() returns the committed beliefs, in order, from the live loop.
//
// Authority: UOR-ADDR · holospaces Laws L1/L2/L5 · rests on #holo-foresight(-graph/-feed) + #holo-strand.
// node tools/holo-foresight-live-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeLiveForesight, bindForesight } from "../os/usr/lib/holo/holo-foresight-live.mjs";
import { extractGraph } from "../os/usr/lib/holo/holo-map.mjs";
import { makeStrand } from "../os/usr/lib/holo/holo-strand.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = () => { let store = []; return { load: async () => clone(store), save: async (r) => { store = clone(r); } }; };
let tick = 0; const now = () => `2026-06-28T02:00:${String(tick++).padStart(2, "0")}.000Z`;

// ── a REAL + graph (production-shaped extractor injected, as the live + would) ───────────────────────
const sourceKappa = "did:holo:sha256:note-live";
const extract = () => ({ entities: [{ name: "Acme Corp", type: "Organization", attributes: { "holo:status": "regulator lawsuit will block the deal; collapse likely" } }], relationships: [] });
const graph = extractGraph({ text: "private note", sourceKappa, extract });
const market = { id: "m-acme", question: "Will the Acme Corp merger close this quarter?", yes: 0.70, entities: ["Acme Corp"], kappa: "did:holo:sha256:mkt-acme" };

// ── 1 · auto-baseline when no brain ──────────────────────────────────────────────────────────────────
const baseRead = bindForesight(null);
const baseBelief = await baseRead(market, graph);
ok("bindAutoBaseline", baseBelief.informed && baseBelief.p < 0.5 && baseBelief.evidence.includes(sourceKappa), JSON.stringify(baseBelief));

// ── 2 · auto-Q when a brain is present (belief comes from the brain) ─────────────────────────────────
const brain = { generate: async (p) => (/Acme Corp/.test(p) ? `{"p":0.05,"why":"lawsuit blocks it"}` : `{"p":0.5}`) };
const qRead = bindForesight(brain);
const qBelief = await qRead(market, graph);
ok("bindAutoQ", qBelief.informed && qBelief.p === 0.05 && qBelief.evidence.includes(sourceKappa), JSON.stringify(qBelief));

// ── 3 · watch commits a verifiable belief onto a real signed strand ─────────────────────────────────
const op = await enroll({ label: "foresight-live-tester", passphrase: "correct horse battery" });
const strand = makeStrand({ backend: arrayBackend(), now, signer: op });
const live = makeLiveForesight({ brain, strand, threshold: 0.1, now });
const w = await live.watch(graph, [market]);
const v = await strand.verify();
ok("watchCommits",
  w.signals.length === 1 && w.signals[0].side === "no" && w.entries.length === 1
  && w.entries[0]["holstr:kind"] === "foresight.belief" && v.ok,
  JSON.stringify({ sig: w.signals.map((s) => ({ side: s.side, edge: s.edge })), v: v.ok }));

// ── 4 · run() pulls markets through the REAL feed adapter (injected fetch — no network) ──────────────
const gammaRow = { conditionId: "0xacme", question: "Will the Acme Corp merger close this quarter?", outcomes: JSON.stringify(["Yes", "No"]), outcomePrices: JSON.stringify(["0.70", "0.30"]), closed: false };
const live2 = makeLiveForesight({ brain, strand: makeStrand({ backend: arrayBackend(), now, signer: op }), threshold: 0.1, now });
const r = await live2.run({ graph, feed: { fetchJson: async () => [gammaRow] } });
ok("runFromFeed",
  Array.isArray(r.markets) && r.markets.length === 1 && r.markets[0].id === "0xacme"
  && r.signals.length === 1 && r.signals[0].side === "no",
  JSON.stringify({ markets: r.markets.map((m) => m.id), sig: r.signals.map((s) => s.side) }));

// ── 5 · read-only by construction: the loop exposes no order/spend surface ───────────────────────────
const surface = Object.keys(live);
ok("feedReadOnly",
  !surface.some((k) => /buy|sell|order|send|spend|swap|trade|execute/i.test(k)) && surface.includes("watch") && surface.includes("proofs"),
  surface.join(","));

// ── 6 · no strand ⇒ scan only, commit nothing (zero side effects) ───────────────────────────────────
const dry = makeLiveForesight({ brain, threshold: 0.1, now });
const d = await dry.watch(graph, [market]);
ok("scanOnlyNoStrand", d.signals.length === 1 && d.entries.length === 0, JSON.stringify({ sig: d.signals.length, entries: d.entries.length }));

// ── 7 · proofs() from the live loop, in order ───────────────────────────────────────────────────────
const proofs = live.proofs();
ok("proofsOnChain", proofs.length === 1 && proofs[0].seq === 0 && proofs[0].id === "m-acme" && proofs[0].side === "no", JSON.stringify(proofs.map((p) => ({ id: p.id, seq: p.seq }))));

await forget(op.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-foresight-live — PROOF OF FORESIGHT in one call. The bound live loop ties THE + (private κ-graph), the read-only crowd feed, the best-present belief reader (Q on-device else the deterministic baseline), and the source-chain commit into one tick. Every seam is a graceful upgrade, never a hard dependency: no brain → baseline; no strand → scan only (zero side effects). Read-only by construction — the loop exposes no order/spend path; acting on a signal is a separate, human-gated step through the wallet's one door. Mirrors holo-plus.bindQ.",
  authority: "UOR-ADDR · holospaces Laws L1/L2/L5 · rests on #holo-foresight + #holo-foresight-graph + #holo-foresight-feed + #holo-strand",
  witnessed,
  covers: witnessed ? ["auto-baseline", "auto-q", "watch-commits", "run-from-feed", "read-only-surface", "scan-only-no-strand", "proofs-on-chain"] : [],
  sample: { baselineP: baseBelief.p, qP: qBelief.p, signal: w.signals[0] && { side: w.signals[0].side, edge: w.signals[0].edge, marketYes: w.signals[0].marketYes, impliedP: w.signals[0].impliedP }, feedMarket: r.markets[0] && r.markets[0].id, surface },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-foresight-live-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-foresight-live witness — PROOF OF FORESIGHT in one call (+ × crowd × Q × chain · read-only)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  baseline p ${baseBelief.p} · Q p ${qBelief.p} · live signal ${w.signals[0] && w.signals[0].side}(${w.signals[0] && w.signals[0].edge}) · feed→${r.markets[0] && r.markets[0].id}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  one call: what I know, what the crowd priced, and the proof — before the move" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
