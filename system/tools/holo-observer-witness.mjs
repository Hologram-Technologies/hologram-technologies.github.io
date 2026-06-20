#!/usr/bin/env node
// holo-observer-witness.mjs — proves S2 of the autonomy spine: Q's AMBIENT OBSERVER, the reactive→copilot
// pivot. S1 folded the OS into "what's true now"; this proves Q can READ that snapshot and decide what is
// worth RAISING — emitting ranked PROPOSALS, never actions. The whole composition is exercised end to end:
// a REAL heal sweep → an S1 coherence snapshot → S2 proposals (sense → reason → speak, minus the speaking).
//
// The discipline is the contract. The observer reuses the WITNESSED Holo Control DSP core (salience +
// hysteresis), so two properties the inbox (S3) depends on are proven here:
//   • NO-NOISE — a whole + coherent snapshot ⇒ zero proposals (nothing changed, nothing to say).
//   • ANTI-NAG — novelty decays as a concern persists, so a fresh break is raised and a CHRONIC known one
//     fades out of the raised set: Q flags the new, it does not nag about the old. And it never FLAPS.
// Proposals are inert (data, no executor), ranked by salience (governance-risk weighted), traceable to the
// snapshot they came from (prov:wasDerivedFrom), self-verifying (Law L5), and deterministic (replayable).
//
// Checks (all must hold):
//   1 composesRealSnapshotToProposals — a REAL heal tick → S1 snapshot → S2 raises the red/unresolved concerns.
//   2 quietOnCoherentState            — a whole + green snapshot ⇒ zero proposals, quiet:true (NO-NOISE).
//   3 rankedByGovernanceRiskSalience  — an unrecoverable (risk .9) outranks a flaky κ (risk .5); rank desc.
//   4 raisesThenReleasesOnFix         — a concern is raised while present, RELEASED once fixed, no resurrection.
//   5 antiNagChronicConcernFades      — a concern present for many ticks drops out of the raised set (no perpetual nag).
//   6 noFlapInTheBand                 — across the run a raised concern never toggles raised→clear→raised (monotonic release).
//   7 proposalsInertAndProvenanced    — the proposal-set re-derives, carries prov:wasDerivedFrom the snapshot; tamper refused; no executor.
//   8 deterministicReplay             — two fresh observers over the SAME snapshot sequence emit byte-identical proposal κs.
//
// Authority (external): the witnessed Holo Control DSP (median/MAD robust salience · hysteresis) · W3C PROV-O ·
// IETF RFC 8785 (JCS) · UOR-ADDR (κ = H(canonical content)) · holospaces Laws L2 (one canonical wire) / L5
// (verify by re-derivation) · rests on #holo-coherence (S1) + #holo-control (the DSP).   node tools/holo-observer-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { makeObserver, verify } from "../os/usr/lib/holo/holo-observer.mjs";
import { makeCoherence } from "../os/usr/lib/holo/holo-coherence.mjs";
import { makeHealer } from "../os/sbin/holo-heal.mjs";
import { makeSupervisor } from "../os/sbin/holo-heal-supervisor.mjs";
import { reDerive, hexOf } from "../os/sbin/holo-resolver.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dsp = await import(pathToFileURL(join(here, "../../../holo-apps/apps/control/holo-control-dsp.js")));

const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const enc = (s) => new TextEncoder().encode(s);
const kOf = async (bytes) => "did:holo:sha256:" + (await reDerive(bytes));
const source = (label, pairs) => { const m = new Map(pairs.map(([k, b]) => [hexOf(k), b])); const s = async (k) => m.get(hexOf(k)) || null; s.peer = label; return s; };
const coh = () => makeCoherence({ now: () => "2026-06-19T00:00:00Z" });
const newObserver = () => makeObserver({ dsp });

// ── drive a REAL heal sweep, then deliberately reflect a DEGRADED state (a red required row) so there is
//    something for Q to raise — the live composition S0 → S1 → S2 ──────────────────────────────────────
const A = enc("observer-witness · A (healthy)"), B = enc("observer-witness · B (healable)");
const kA = await kOf(A), kB = await kOf(B);
const realTick = await (async () => {
  const durable = new Map([[hexOf(kA), A]]);
  const intact = async (hex) => durable.has(hex) && (await reDerive(durable.get(hex))) === hex;
  const healer = makeHealer({ sources: [source("ipfs", [[kA, A], [kB, B]])], store: new Map(),
    persist: async (hex, b) => durable.set(hex, b), now: () => "2026-06-19T00:00:00Z" });
  const sup = makeSupervisor({ loadClosure: async () => ({ "a.js": kA, "b.js": kB }), healer, intact, now: () => "2026-06-19T00:00:00Z" });
  return sup.tick("boot");
})();
const healState = { total: realTick.summary.total, healthy: realTick.summary.healthy, healed: realTick.summary.healed,
  unresolved: realTick.summary.unresolved, flaky: realTick.flaky };
const degradedSnap = coh().fold({ heal: healState, gate: { total: 143, passing: 131, failingRequired: 1, redRows: ["#share-runtime"] } });

// ── 1 · the live composition raises the real concern ───────────────────────────────────────────────────
{
  const obs = newObserver();
  const r = obs.observe(degradedSnap);
  ok("composesRealSnapshotToProposals",
    r.proposals.length >= 1 && r.proposals.some((p) => p.kind === "gate.red" && p.subject === "#share-runtime") && r.quiet === false,
    `${r.proposals.length} proposals`);
}

// ── 2 · NO-NOISE: a whole + green snapshot raises nothing ───────────────────────────────────────────────
{
  const obs = newObserver();
  const wholeSnap = coh().fold({ heal: { total: 3, healthy: 3, healed: 0, unresolved: 0, whole: true }, gate: { total: 10, passing: 10, failingRequired: 0, redRows: [] } });
  const r = obs.observe(wholeSnap);
  ok("quietOnCoherentState", r.quiet === true && r.proposals.length === 0);
}

// ── 3 · ranked by governance-risk-weighted salience: of two equally-anomalous concerns (both z=6, both
//        raised), the higher-risk one ranks first — an unrecoverable object (risk .9) over a red row (.8) ──
{
  const obs = newObserver();
  const snap = coh().fold({ heal: { total: 5, healthy: 4, healed: 0, unresolved: 1, whole: false }, gate: { total: 10, passing: 9, failingRequired: 1, redRows: ["#x"] } });
  const r = obs.observe(snap);
  const unres = r.proposals.find((p) => p.kind === "heal.unresolved");
  const red = r.proposals.find((p) => p.kind === "gate.red");
  const sortedDesc = r.proposals.every((p, i) => i === 0 || r.proposals[i - 1].salience >= p.salience);
  ok("rankedByGovernanceRiskSalience", unres && red && unres.salience > red.salience && r.proposals[0].kind === "heal.unresolved" && sortedDesc,
    unres && red ? `unres=${unres.salience} red=${red.salience}` : "a concern did not raise");
}

// ── 4 · raises while present, RELEASES once fixed, no resurrection ───────────────────────────────────────
{
  const obs = newObserver();
  const red = coh().fold({ heal: { total: 1, healthy: 1, whole: true }, gate: { total: 10, passing: 9, failingRequired: 1, redRows: ["#x"] } });
  const green = coh().fold({ heal: { total: 1, healthy: 1, whole: true }, gate: { total: 10, passing: 10, failingRequired: 0, redRows: [] } });
  const t0 = obs.observe(red);   const raisedT0 = t0.proposals.some((p) => p.subject === "#x");
  const t1 = obs.observe(green); const releasedT1 = !t1.proposals.some((p) => p.subject === "#x") && t1.quiet === true;
  const t2 = obs.observe(green); const stayReleased = !t2.proposals.some((p) => p.subject === "#x");
  ok("raisesThenReleasesOnFix", raisedT0 && releasedT1 && stayReleased);
}

// ── 5 + 6 · ANTI-NAG + NO-FLAP: a chronic concern is raised early, fades from the raised set, never flaps ─
{
  const obs = newObserver();
  const red = coh().fold({ heal: { total: 1, healthy: 1, whole: true }, gate: { total: 10, passing: 9, failingRequired: 1, redRows: ["#chronic"] } });
  const seen = [];
  for (let t = 0; t < 40; t++) seen.push(obs.observe(red).proposals.some((p) => p.subject === "#chronic"));
  const raisedEarly = seen[0] === true;
  const fadedLate = seen[seen.length - 1] === false;
  // NO-FLAP: the raised→cleared transition happens at most once (monotonic release; never raised again)
  let transitions = 0; for (let t = 1; t < seen.length; t++) if (seen[t] !== seen[t - 1]) transitions++;
  ok("antiNagChronicConcernFades", raisedEarly && fadedLate);
  ok("noFlapInTheBand", transitions <= 1, `${transitions} transitions`);
}

// ── 7 · proposals are INERT + PROVENANCED + self-verifying; a tampered set is refused ───────────────────
{
  const obs = newObserver();
  const r = obs.observe(degradedSnap);
  const inert = r.proposals.every((p) => typeof p === "object" && !Object.values(p).some((v) => typeof v === "function"));
  const provenanced = r.object["prov:wasDerivedFrom"] === degradedSnap.kappa;
  const tampered = { ...r.object, "holobs:count": 999 };
  ok("proposalsInertAndProvenanced", inert && provenanced && verify(r.object) === true && verify(tampered) === false);
}

// ── 8 · DETERMINISTIC REPLAY: two fresh observers over the same snapshot sequence emit identical proposal κs ─
{
  const seq = [
    coh().fold({ heal: { total: 2, healthy: 2, whole: true }, gate: { total: 10, passing: 9, failingRequired: 1, redRows: ["#r1"] } }),
    coh().fold({ heal: { total: 2, healthy: 1, unresolved: 1, whole: false, flaky: [{ hex: "bb".repeat(32), repairs: 2 }] }, gate: { total: 10, passing: 9, failingRequired: 1, redRows: ["#r1"] } }),
    coh().fold({ heal: { total: 2, healthy: 2, whole: true }, gate: { total: 10, passing: 10, failingRequired: 0, redRows: [] } }),
  ];
  const a = newObserver(), b = newObserver();
  const ka = seq.map((s) => a.observe(s).kappa);
  const kb = seq.map((s) => b.observe(s).kappa);
  ok("deterministicReplay", JSON.stringify(ka) === JSON.stringify(kb) && new Set(ka).size >= 2);
}

// ── 9 · PERSONAL: an app the user is using that ERRORED becomes its own raised, first-person proposal ───
{
  const obs = newObserver();
  const snap = coh().fold({ heal: { total: 1, healthy: 1, whole: true }, gate: { total: 10, passing: 10, failingRequired: 0, redRows: [] }, apps: [{ app: "editor", phase: "error" }] });
  const r = obs.observe(snap);
  const err = r.proposals.find((p) => p.kind === "app.error");
  ok("appErrorRaisesPersonalProposal", !!err && err.subject === "editor" && /editor/.test(err.suggestedAction), err ? err.suggestedAction : "no app.error proposal raised");
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "Holo Observer (S2, the reactive→copilot pivot) — Q reads the S1 coherence snapshot and emits ranked PROPOSALS, never actions: NO-NOISE (a coherent state raises nothing), ANTI-NAG (novelty decays so a fresh break is raised and a chronic one fades, never flapping), salience ranked by governance-risk via the witnessed Holo Control DSP, every proposal inert + traceable to its snapshot (prov:wasDerivedFrom) + self-verifying (Law L5) + deterministic; composition proven from a real heal sweep through S1 to S2",
  authority: "the witnessed Holo Control DSP (robust salience + hysteresis) · W3C PROV-O · IETF RFC 8785 (JCS) · UOR-ADDR · holospaces Laws L2/L5 · rests on #holo-coherence + #holo-control",
  witnessed,
  covers: witnessed ? ["ambient-observer", "proposals-not-actions", "no-noise", "anti-nag", "no-flap", "salience-ranked", "provenanced", "deterministic", "s0-s1-s2-composition"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-observer-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Observer witness — S2 the reactive→copilot pivot (sense → reason → speak)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  Q raises what's worth raising — ranked, anti-nag, never acting" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
