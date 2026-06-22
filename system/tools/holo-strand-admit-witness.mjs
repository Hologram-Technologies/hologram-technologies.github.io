#!/usr/bin/env node
// holo-strand-admit-witness.mjs — proves V: PEER RE-VALIDATION ON RECEIPT. A receiving peer admits an
// incoming entry only if it re-derives (L5), its author isn't immune-blocked (W), and it satisfies the
// governing ruleset when the peer re-runs it (P4). Fail-closed; deterministic. Drives the REAL stack:
// holo-strand entries, holo-strand-rules ruleset, holo-warrant immunity, holo-identity signers.
//
// Checks (all must hold):
//   1 admitValid          — a conforming, signed entry from an unblocked actor is admitted.
//   2 rejectInvalid       — an entry violating the ruleset is refused at stage "rules".
//   3 rejectTampered      — an entry whose κ no longer re-derives is refused at stage "integrity" (L5).
//   4 rejectBlockedActor  — an otherwise-valid entry from a warranted (blocked) actor is refused at "immune".
//   5 deterministicVerdict— admitting the same entry twice yields the identical verdict (no clock/randomness).
//   6 admitChainLinks     — a well-formed incoming segment admits; a reordered one is refused (linkage).
//
// Authority: Holochain peer-validation model · UOR-ADDR · holospaces Laws L1/L2/L5 · rests on
// #holo-strand + #holo-strand-rules + #holo-warrant + #holo-identity. node tools/holo-strand-admit-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeStrand } from "../os/usr/lib/holo/holo-strand.mjs";
import { defineRuleset } from "../os/usr/lib/holo/holo-strand-rules.mjs";
import { raiseWarrant, makeImmunity } from "../os/usr/lib/holo/holo-warrant.mjs";
import { admit, admitChain } from "../os/usr/lib/holo/holo-strand-admit.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
let tick = 0; const now = () => `2026-06-22T00:00:${String(tick++).padStart(2, "0")}.000Z`;

const alice = await enroll({ label: "alice", passphrase: "alice pass" });
const mallory = await enroll({ label: "mallory", passphrase: "mallory pass" });
const RS = defineRuleset({ name: "ingest-rules", rules: { ingest: { require: ["source", "name"] } } });

// alice authors a clean chain (the segment a peer receives)
const aStrand = makeStrand({ now, signer: alice });
const a0 = await aStrand.append({ kind: "ingest", payload: { source: "did:holo:sha256:" + "1".repeat(64), name: "a0.txt" } });
const a1 = await aStrand.append({ kind: "ingest", payload: { source: "did:holo:sha256:" + "2".repeat(64), name: "a1.txt" } });

// mallory authors a valid-looking entry, but will be warranted for a separate violation
const mStrand = makeStrand({ now, signer: mallory });
const mGood = await mStrand.append({ kind: "ingest", payload: { source: "did:holo:sha256:" + "3".repeat(64), name: "m-ok.txt" } });
const mBad = await mStrand.append({ kind: "ingest", payload: { name: "m-no-source.txt" } });   // violates RS

const immunity = makeImmunity();
await immunity.receive(await raiseWarrant({ entry: mBad, ruleset: RS }));   // confirmed → mallory blocked

// ── 1 · admit a valid, signed entry from an unblocked actor ──────────────────────────────────────────
const r1 = await admit(a0, { ruleset: RS, immunity });
ok("admitValid", r1.ok === true && r1.actor === alice.kappa && r1.signed === true, JSON.stringify(r1));

// ── 2 · reject a rule-violating entry ────────────────────────────────────────────────────────────────
const r2 = await admit(mBad, { ruleset: RS });        // no immunity here — isolate the rules stage
const r2b = await admit({ ...a0 }, { ruleset: RS });  // sanity: a0 still ok
const bad = await admit(mBad, { ruleset: RS });
ok("rejectInvalid", bad.ok === false && bad.stage === "rules" && bad.why === "invalid", JSON.stringify(bad));

// ── 3 · reject a tampered entry (κ no longer re-derives) ─────────────────────────────────────────────
const t = clone(a1); t["holstr:payload"].name = "evil.txt";   // mutate content without re-sealing
const r3 = await admit(t, { ruleset: RS });
ok("rejectTampered", r3.ok === false && r3.stage === "integrity", JSON.stringify(r3));

// ── 4 · reject an otherwise-valid entry from a blocked actor (immune system on receipt) ──────────────
const r4 = await admit(mGood, { ruleset: RS, immunity });
ok("rejectBlockedActor", r4.ok === false && r4.stage === "immune" && r4.actor === mallory.kappa, JSON.stringify(r4));

// ── 5 · deterministic verdict (no clock/randomness) ──────────────────────────────────────────────────
const d1 = await admit(a0, { ruleset: RS, immunity });
const d2 = await admit(a0, { ruleset: RS, immunity });
ok("deterministicVerdict", JSON.stringify(d1) === JSON.stringify(d2), "same input → same verdict");

// ── 6 · admit a linked segment; a reordered one is refused ───────────────────────────────────────────
const segOk = await admitChain([a0, a1], { ruleset: RS, immunity });
const segBad = await admitChain([a1, a0], { ruleset: RS, immunity });   // reordered → linkage broken
ok("admitChainLinks", segOk.ok === true && segOk.admitted === 2 && segBad.ok === false, JSON.stringify({ ok: segOk.ok, reordered: segBad.ok }));

await forget(alice.kappa); await forget(mallory.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-strand V — PEER RE-VALIDATION ON RECEIPT: a receiving peer admits an incoming entry only if it re-derives (L5), its author isn't immune-blocked by a confirmed warrant (W), and it satisfies the governing content-addressed ruleset when the peer re-runs it (P4). Fail-closed per stage (integrity → immune → rules); deterministic (validate reads only entry+ruleset data). admitChain enforces segment linkage. The one verify-before-mount gate every transport routes through — Holochain's validation-authority behavior on the κ substrate. Pure assembly, additive.",
  authority: "Holochain peer-validation model · UOR-ADDR · holospaces Laws L1/L2/L5 · rests on #holo-strand + #holo-strand-rules + #holo-warrant + #holo-identity",
  witnessed,
  covers: witnessed ? ["admit-valid", "reject-invalid", "reject-tampered", "reject-blocked-actor", "deterministic", "chain-linkage"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-strand-admit-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-strand witness — V PEER RE-VALIDATION ON RECEIPT (every peer is a validation authority)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  incoming data is admitted only by re-derivation + re-validation, never by trust" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
