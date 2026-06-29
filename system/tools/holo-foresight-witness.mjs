#!/usr/bin/env node
// holo-foresight-witness.mjs — proves PROOF OF FORESIGHT (holo-foresight): the private-edge forecaster
// that reads the operator's PRIVATE κ-graph against the crowd's READ-ONLY price, surfaces only the delta,
// commits each belief to the source chain the moment it forms, and later grades it into a verifiable,
// tamper-evident forecasting reputation. The private edge never leaves the device; the track record cannot
// be faked, moved, or revoked.
//
// Hermetic: a deterministic clock + an in-memory strand backend + a REAL enrolled holo-identity signer (so
// authorship is proven against the production Ed25519/ECDSA axis, not a stub). No network — the crowd feed
// is injected. Drives the REAL substrate (holo-strand → holo-object seal/verify).
//
// Checks (all must hold):
//   1 edgeDetected          — a market the private graph DISAGREES with surfaces, with the right side.
//   2 agreementIsSilent     — a market the private graph AGREES with does NOT surface (no noise).
//   3 noPrivateNoSignal     — a market we know nothing about defers to the crowd (informed:false → silent).
//   4 evidenceAnchored      — each signal cites the content-addressed source κ that backs the belief.
//   5 committedBeforeMove    — every signal is sealed onto the chain as a foresight.belief, in order.
//   6 chainAttestsBeliefs    — the strand verifies end-to-end; head κ attests the whole belief sequence.
//   7 beliefsSigned          — committed beliefs carry operator authorship (sig over the entry κ).
//   8 tamperRefused          — mutate a committed belief's payload ⇒ verify refuses AT that index (L5).
//   9 proofsReplay           — proofs() returns the committed beliefs, in chain order, with their κ + seq.
//  10 beatsCrowdWhenRight    — on resolution, a correct contrarian scores a better Brier than the crowd.
//  11 deterministic          — same inputs → byte-identical beliefs (pure core; re-derivable).
//
// Authority: UOR-ADDR (κ = H(canonical_form)) · holospaces Laws L1 (private-first) / L2 (one canonical
// form) / L5 (tamper-evident over the sequence) · rests on #holo-strand + #holo-object + #holo-identity.
// node tools/holo-foresight-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeForesight, defaultRead, score } from "../os/usr/lib/holo/holo-foresight.mjs";
import { makeStrand, verifyEntry } from "../os/usr/lib/holo/holo-strand.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = (init = []) => { let store = clone(init); return { load: async () => clone(store), save: async (r) => { store = clone(r); }, dump: () => clone(store) }; };

let tick = 0;
const now = () => `2026-06-28T00:00:${String(tick++).padStart(2, "0")}.000Z`;

// ── the operator's PRIVATE κ-graph (what only I know — from the + ingest) ────────────────────────────
// Each node: { label, stance -1..+1, weight, sourceKappa }. Stance is MY read of the evidence; the κ is the
// content-addressed anchor (a memo, a transcript, a doc) that re-derives it. This never leaves the device.
const graph = [
  { label: "Fed", stance: 0.9, weight: 1.4, sourceKappa: "did:holo:sha256:aa11" },   // strong: cut is coming
  { label: "rate cut", stance: 0.8, weight: 1.0, sourceKappa: "did:holo:sha256:bb22" },
  { label: "Acme Corp", stance: -0.95, weight: 1.6, sourceKappa: "did:holo:sha256:cc33" }, // strong: deal dies
];

// ── the crowd's READ-ONLY feed (injected; no network) ───────────────────────────────────────────────
const markets = [
  { id: "m-fed", question: "Will the Fed announce a rate cut in July?", yes: 0.35, entities: ["Fed", "rate cut"], kappa: "did:holo:sha256:mkt-fed" }, // crowd 35% vs my ~0.9 → big YES edge
  { id: "m-acme", question: "Will the Acme Corp merger close this quarter?", yes: 0.70, entities: ["Acme Corp"], kappa: "did:holo:sha256:mkt-acme" }, // crowd 70% vs my ~0.0 → big NO edge
  { id: "m-agree", question: "Will it rain in Seattle tomorrow?", yes: 0.52, entities: ["Seattle"], kappa: "did:holo:sha256:mkt-rain" }, // I have a weak agreeing node
  { id: "m-blind", question: "Will Zorblax win the Glorptron League?", yes: 0.40, entities: ["Zorblax", "Glorptron League"], kappa: "did:holo:sha256:mkt-blind" }, // no private signal
];
graph.push({ label: "Seattle", stance: 0.05, weight: 0.4, sourceKappa: "did:holo:sha256:dd44" }); // → p≈0.52, agrees

// ── build the watcher on a REAL signed strand ────────────────────────────────────────────────────────
const op = await enroll({ label: "foresight-tester", passphrase: "correct horse battery" });
const backend = arrayBackend();
const strand = makeStrand({ backend, now, signer: op });
const fs = makeForesight({ read: defaultRead, strand, threshold: 0.1, now });

// ── 1·2·3·4 · scan: the delta surface ────────────────────────────────────────────────────────────────
const signals = await fs.scan(markets, graph);
const byId = Object.fromEntries(signals.map((s) => [s.id, s]));
ok("edgeDetected",
  byId["m-fed"] && byId["m-fed"].side === "yes" && byId["m-fed"].edge > 0.4
  && byId["m-acme"] && byId["m-acme"].side === "no" && byId["m-acme"].edge < -0.4,
  JSON.stringify(signals.map((s) => ({ id: s.id, side: s.side, edge: s.edge }))));
ok("agreementIsSilent", !byId["m-agree"], "m-agree should not surface (private ≈ crowd)");
ok("noPrivateNoSignal", !byId["m-blind"] && !defaultRead(markets[3], graph).informed, "m-blind: no private signal");
ok("evidenceAnchored",
  byId["m-fed"].evidence.includes("did:holo:sha256:aa11") && byId["m-acme"].evidence.includes("did:holo:sha256:cc33"),
  JSON.stringify(byId["m-fed"] && byId["m-fed"].evidence));

// ── 5·6·7 · commit every signal onto the chain, then verify it attests the whole belief sequence ─────
const { signals: sig2, entries } = await fs.scanAndCommit(markets, graph);
ok("committedBeforeMove",
  entries.length === sig2.length && entries.every((e) => e["holstr:kind"] === "foresight.belief")
  && entries[0]["holstr:payload"].id === sig2[0].id,
  `entries=${entries.length}`);
const v = await strand.verify();
ok("chainAttestsBeliefs", v.ok && v.length === entries.length && v.head === strand.head(), JSON.stringify(v));
const perEntry = await Promise.all(entries.map((e) => verifyEntry(e)));
ok("beliefsSigned", perEntry.every((r) => r.ok && r.signed), JSON.stringify(perEntry.map((r) => r.signed)));

// ── 8 · tamper a committed belief → the chain refuses at that index (proof-of-foresight is immutable) ─
const forged = arrayBackend(backend.dump());
const dump = forged.dump();
dump[0]["holstr:payload"].impliedP = 0.01;                      // rewrite history: "I never said that"
const tampered = makeStrand({ backend: { load: async () => dump, save: async () => {} } });
const vt = await tampered.verify();
ok("tamperRefused", vt.ok === false && vt.brokeAt === 0, JSON.stringify(vt));

// ── 9 · proofs(): the committed track record, in order ──────────────────────────────────────────────
const proofs = fs.proofs();
ok("proofsReplay",
  proofs.length === entries.length && proofs[0].seq === 0 && proofs[0].kappa === entries[0].id && proofs[0].id === sig2[0].id,
  JSON.stringify(proofs.map((p) => ({ id: p.id, seq: p.seq }))));

// ── 10 · settle: a correct contrarian beats the crowd's Brier ───────────────────────────────────────
// Reality: the Fed DID cut (1), the Acme merger DID die (0) — exactly as my private graph read.
const resolutions = { "m-fed": 1, "m-acme": 0 };
const card = score(proofs, resolutions);
ok("beatsCrowdWhenRight",
  card.n === 2 && card.brier < card.crowdBrier && card.edgeOverCrowd > 0 && card.beatRate === 1,
  JSON.stringify(card));

// ── 11 · determinism: the pure core re-derives byte-identical beliefs ────────────────────────────────
const a = await makeForesight({ now: () => "T" }).scan(markets, graph);
const b = await makeForesight({ now: () => "T" }).scan(markets, graph);
ok("deterministic", JSON.stringify(a) === JSON.stringify(b) && a.length === 2, `${a.length} signals`);

await forget(op.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-foresight — PROOF OF FORESIGHT: a private-edge forecaster that reads the operator's PRIVATE κ-hypergraph against the crowd's READ-ONLY market price, surfaces only the delta (where my information disagrees with the crowd), commits each belief to the source chain the moment it forms (hash-linked, operator-signed, timestamped κ), and grades it into a verifiable, tamper-evident forecasting reputation. The edge never leaves the device (Law L1); each belief is content-addressed (Law L2); the chain of beliefs is tamper-evident over the sequence (Law L5). Impossible without κ: a cloud copilot leaks the edge by construction, and a track record cannot be proven without exposing the bets.",
  authority: "UOR-ADDR (κ = H(canonical_form)) · holospaces Laws L1/L2/L5 · rests on #holo-strand + #holo-object + #holo-identity",
  witnessed,
  covers: witnessed ? ["private-graph-vs-crowd-delta", "agreement-silent", "defer-when-blind", "evidence-anchored", "committed-before-move", "chain-attests-beliefs", "operator-signed", "tamper-refused", "proofs-replay", "beats-crowd-when-right", "deterministic-core"] : [],
  sample: { signals: sig2.map((s) => ({ id: s.id, side: s.side, marketYes: s.marketYes, impliedP: s.impliedP, edge: s.edge })), scorecard: card, head: strand.head() },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-foresight-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-foresight witness — PROOF OF FORESIGHT (private edge · committed before the move · tamper-evident reputation)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  signals: ${sig2.map((s) => `${s.id}:${s.side}(${s.edge > 0 ? "+" : ""}${s.edge})`).join("  ")}`);
console.log(`  scorecard: my Brier ${card.brier} vs crowd ${card.crowdBrier} — edge +${card.edgeOverCrowd}, beat ${card.beatRate * 100}%`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  the crowd measures itself; this measures ME — privately, provably, before the move" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
