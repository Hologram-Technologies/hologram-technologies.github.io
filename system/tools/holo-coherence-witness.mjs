#!/usr/bin/env node
// holo-coherence-witness.mjs — proves S1 of the autonomy spine: REFLECTION. S0 made the OS observable; this
// proves the OS can FOLD that observation into one self-verifying snapshot κ — "what's true now" — that S2
// reads to reason. The composition is proven end to end: a REAL makeSupervisor().tick() sweep (the same seam
// S0's tap consumes) flows into the coherence fold, so the snapshot reflects real state, not a mock.
//
// The keystone property: a snapshot's IDENTITY is its STATE, not the clock. Two folds of the same state under
// DIFFERENT clocks re-derive to the SAME κ (content-addressed reflection, comparable + dedup-able, Law L5);
// a changed state yields a different κ; a tampered snapshot fails to re-derive. Coherence is an honest scalar
// ∈ [0,1] that a whole+green system scores 1.0 and any unresolved heal / red required row pulls below. The
// diff is no-noise: identical state ⇒ changed:false (the property S3's inbox depends on — nothing changed,
// nothing to say). Reflection is private-first: share() is default-deny + conscience-gated (Law L1).
//
// Checks (all must hold):
//   1 foldsRealTickToSelfVerifyingSnapshot — a LIVE heal tick folds to a snapshot that verify()s; coherence∈[0,1].
//   2 identityIsStateNotClock              — same state under two different clocks ⇒ the SAME snapshot κ.
//   3 differentStateDifferentKappa         — change one input (a red row / an unresolved κ) ⇒ a different κ.
//   4 tamperedSnapshotRefused              — mutate a sealed field ⇒ verify() false (Law L5).
//   5 coherenceIsHonest                    — whole+green ⇒ 1.0; degraded ⇒ strictly < the whole snapshot.
//   6 attentionIsExactlyTheIncoherentSet   — attention = the union of red rows + flaky + unresolved (no fabrication).
//   7 diffNoNoiseOnIdenticalState          — diff(s,s) ⇒ changed:false; a real change ⇒ changed:true surfacing the new red.
//   8 reflectionIsPrivateFirst             — share() without consent is refused; a blocking conscience refuses it too.
//
// Authority (external): W3C PROV-O · W3C DID Core (did:holo) · IETF RFC 8785 (JCS) · UOR-ADDR (κ = H(canonical
// content), id excluded) · holospaces Laws L1 (private-first) / L2 (one canonical wire) / L5 (verify by
// re-derivation) · rests on #holo-telemetry-tap (S0) + #heal (the live seam).   node tools/holo-coherence-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeCoherence, verify } from "../os/usr/lib/holo/holo-coherence.mjs";
import { makeHealer } from "../os/sbin/holo-heal.mjs";
import { makeSupervisor } from "../os/sbin/holo-heal-supervisor.mjs";
import { reDerive, hexOf } from "../os/sbin/holo-resolver.mjs";
import { makeObject } from "../os/usr/lib/holo/holo-object.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const enc = (s) => new TextEncoder().encode(s);
const kOf = async (bytes) => "did:holo:sha256:" + (await reDerive(bytes));
const source = (label, pairs) => { const m = new Map(pairs.map(([k, b]) => [hexOf(k), b])); const s = async (k) => m.get(hexOf(k)) || null; s.peer = label; return s; };

// ── drive a REAL heal sweep (the same seam S0 taps): one healthy-on-device + one healable object → healed:1 ──
const A = enc("coherence-witness · object-A (healthy)"), B = enc("coherence-witness · object-B (healable)");
const kA = await kOf(A), kB = await kOf(B);
const realTick = await (async () => {
  const durable = new Map([[hexOf(kA), A]]);
  const intact = async (hex) => durable.has(hex) && (await reDerive(durable.get(hex))) === hex;
  const healer = makeHealer({ sources: [source("ipfs", [[kA, A], [kB, B]])],
    store: new Map(), persist: async (hex, b) => durable.set(hex, b), now: () => "2026-06-19T00:00:00Z" });
  const sup = makeSupervisor({ loadClosure: async () => ({ "a.js": kA, "b.js": kB }), healer, intact, now: () => "2026-06-19T00:00:00Z" });
  return sup.tick("boot");
})();
// map the real tick into the fold's `heal` shape (exactly the supervisor's own summary + flaky), plus a real-shaped gate verdict.
const healState = { total: realTick.summary.total, healthy: realTick.summary.healthy, healed: realTick.summary.healed,
  unresolved: realTick.summary.unresolved, deferred: realTick.summary.deferred || 0, cooling: realTick.summary.cooling || 0, flaky: realTick.flaky };
const gateState = { total: 143, passing: 131, failingRequired: 12, redRows: ["#app-ui-conformance", "#share-runtime", "#substrate-anchored"] };

const coh = makeCoherence({ now: () => "2026-06-19T12:00:00Z" });

// ── 1 · a LIVE tick folds to a self-verifying snapshot; coherence is a bounded scalar ──────────────────
const snap = coh.fold({ heal: healState, gate: gateState, apps: [{ app: "files", phase: "open" }, { app: "files", phase: "open" }, { app: "q", phase: "open" }] });
ok("foldsRealTickToSelfVerifyingSnapshot",
  verify(snap.object) === true && /^did:holo:sha256:/.test(snap.kappa)
  && typeof snap.coherence === "number" && snap.coherence >= 0 && snap.coherence <= 1
  && snap.object["holcoh:health"].total === realTick.summary.total,
  `coherence=${snap.coherence}`);

// ── 2 · IDENTITY IS STATE, NOT CLOCK: same state under a different clock ⇒ the SAME κ ───────────────────
const cohB = makeCoherence({ now: () => "1999-01-01T00:00:00Z" });
const snapSameStateOtherClock = cohB.fold({ heal: healState, gate: gateState, apps: [{ app: "q", phase: "open" }, { app: "files", phase: "open" }, { app: "files", phase: "open" }] });
ok("identityIsStateNotClock", snapSameStateOtherClock.kappa === snap.kappa && snapSameStateOtherClock.at !== snap.at);

// ── 3 · a CHANGED state ⇒ a different κ (add a red row; and separately, more unresolved) ────────────────
const snapMoreRed = coh.fold({ heal: healState, gate: { ...gateState, redRows: [...gateState.redRows, "#new-red"], failingRequired: 13 } });
const snapUnresolved = coh.fold({ heal: { ...healState, unresolved: 2, whole: false }, gate: gateState });
ok("differentStateDifferentKappa", snapMoreRed.kappa !== snap.kappa && snapUnresolved.kappa !== snap.kappa);

// ── 4 · Law L5: a tampered sealed field breaks re-derivation ────────────────────────────────────────────
const tampered = { ...snap.object, "holcoh:coherence": 1 };
ok("tamperedSnapshotRefused", verify(snap.object) === true && verify(tampered) === false);

// ── 5 · COHERENCE IS HONEST: whole+green ⇒ 1.0; degraded ⇒ strictly less ───────────────────────────────
const whole = coh.fold({ heal: { total: 3, healthy: 3, healed: 0, unresolved: 0, whole: true }, gate: { total: 10, passing: 10, failingRequired: 0, redRows: [] } });
const degraded = coh.fold({ heal: { total: 3, healthy: 1, healed: 0, unresolved: 2, whole: false }, gate: { total: 10, passing: 6, failingRequired: 4, redRows: ["#a", "#b", "#c", "#d"] } });
ok("coherenceIsHonest", whole.coherence === 1 && degraded.coherence < 1 && degraded.coherence < whole.coherence && whole.whole === true);

// ── 6 · ATTENTION is exactly the incoherent set: red rows + flaky + unresolved, nothing fabricated ──────
const att = snapUnresolved.attention;
const redInAtt = att.filter((a) => a.kind === "gate.red").map((a) => a.ref).sort();
const hasUnresolved = att.some((a) => a.kind === "heal.unresolved");
const flakyInAtt = att.filter((a) => a.kind === "heal.flaky").length;
ok("attentionIsExactlyTheIncoherentSet",
  JSON.stringify(redInAtt) === JSON.stringify([...gateState.redRows].sort())
  && hasUnresolved && flakyInAtt === (realTick.flaky || []).length,
  `${att.length} attention items`);

// ── 7 · DIFF is NO-NOISE: identical state ⇒ changed:false; a real change ⇒ changed:true with the new red ─
const dSame = coh.diff(snap, coh.fold({ heal: healState, gate: gateState }));
const dChange = coh.diff(snap, snapMoreRed);
ok("diffNoNoiseOnIdenticalState",
  dSame.changed === false && dSame.newRed.length === 0 && dSame.coherenceDelta === 0
  && dChange.changed === true && dChange.newRed.includes("#new-red"));

// ── 8 · REFLECTION IS PRIVATE-FIRST: share() default-deny; a blocking conscience refuses it ─────────────
const noConsent = coh.share("https://peer.example/coherence");
const cohGated = makeCoherence({ conscience: { evaluate: () => ({ outcome: "block", reason: "policy" }) } });
const blocked = cohGated.share("https://peer.example/coherence", { consent: true });
ok("reflectionIsPrivateFirst", noConsent.ok === false && /local-only/.test(noConsent.reason) && blocked.ok === false && /conscience/.test(blocked.reason));

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "Holo Coherence (S1 reflection) — the OS folds its perception stream (a real heal sweep + the conformance gate's verdict + app activity) into ONE self-verifying snapshot κ ('what's true now'); the snapshot's identity is its STATE not the clock (same state ⇒ same κ under any clock, Law L5), coherence is an honest re-derivable scalar (whole+green = 1.0), the diff is no-noise (identical state ⇒ nothing to say), and reflection is private-first (share default-deny + conscience-gated)",
  authority: "W3C PROV-O · W3C DID Core (did:holo) · IETF RFC 8785 (JCS) · UOR-ADDR (κ = H(canonical content), id excluded) · holospaces Laws L1/L2/L5 · rests on #holo-telemetry-tap + #heal",
  witnessed,
  covers: witnessed ? ["coherence-model", "reflection", "content-addressed-state", "honest-coherence-scalar", "no-noise-diff", "private-first", "law-l5", "s0-s1-composition"] : [],
  sample: { snapshot: snap.kappa, coherence: snap.coherence, whole: snap.whole, attention: snap.attention.length, realHealed: realTick.summary.healed },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-coherence-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Coherence witness — S1 reflection (sense → REASON → speak)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  snapshot ${snap.kappa}\n  coherence ${snap.coherence} · whole ${snap.whole} · attention ${snap.attention.length} · real healed ${realTick.summary.healed}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  the OS folds its own state into one self-verifying 'what's true now'" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
