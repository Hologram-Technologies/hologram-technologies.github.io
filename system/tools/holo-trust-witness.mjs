#!/usr/bin/env node
// holo-trust-witness.mjs — proves S4 of the autonomy spine: THE TRUST BOUNDARY. S3 let Q speak; this proves
// the contract that lets Q ACT while the user stays in the driving seat. Every proposed action resolves to one
// disposition through a pure lattice — disposition = min(user-trust, risk-cap) under the conscience floor —
// and three hard guarantees the user's trust can never override are enforced in code, not policy.
//
// Checks (all must hold):
//   1 defaultDenyNeverSilent    — an UNCONFIGURED topic resolves to `propose` (never silent); decide is deterministic.
//   2 trustLadderGovernsDisposition — setTrust moves a low-risk reversible action propose→ask→silent→deny (never⇒deny); user-driven.
//   3 riskCapNeverSilentForValue— a value-moving / irreversible / egress action with trust `silent` is CAPPED at `ask`.
//   4 noBlindSilentAct          — a silent-eligible act with NO undo is refused and downgraded to ask (reversibility is the price).
//   5 conscienceIsTheFloor      — a blocking conscience ⇒ `deny` even at trust `silent` (fail-closed); an allowing one lets it through.
//   6 silentActSealsReceiptAndUndo — a permitted silent act performs, returns an undo + a receipt that re-derives (L5); a tampered receipt fails.
//   7 askPathRequiresExplicitApproval — an `ask` action does NOT perform via act(); only approve() runs it, sealing a receipt naming the approver.
//   8 oneMovePauseAndUserOnlyTrust — pause() caps a previously-silent topic to propose; resume() restores; decide()/act() never mutate trust.
//
// Authority (external): the Holo Constitution conscience gate (ADR-0033, the fail-closed floor) · the wallet
// default-deny human-approval model (ADR-0053) · W3C PROV-O (the act receipt) · UOR-ADDR (κ = H(content)) ·
// holospaces Laws L1 (private-first) / L5 (verify by re-derivation).   node tools/holo-trust-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeTrust, verify } from "../os/usr/lib/holo/holo-trust.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const allow = { evaluate: () => ({ outcome: "allow" }) };
const block = { evaluate: () => ({ outcome: "block", reason: "unsealed" }) };
const lowRisk = (topic) => ({ topic, kind: "heal", reversible: true });   // a reversible, non-dangerous act

// ── 1 · DEFAULT-DENY: an unconfigured topic is `propose`, never silent; same input ⇒ same disposition ────
{
  const t = makeTrust({ conscience: allow, now: () => "2026-06-19T00:00:00Z" });
  const d1 = t.decide(lowRisk("repin"));
  const d2 = t.decide(lowRisk("repin"));
  ok("defaultDenyNeverSilent", d1.disposition === "propose" && d2.disposition === "propose" && t.getTrust("repin") === "propose");
}

// ── 2 · the TRUST LADDER governs the disposition (user-driven) ──────────────────────────────────────────
{
  const t = makeTrust({ conscience: allow });
  t.setTrust("repin", "ask");     const askD = t.decide(lowRisk("repin")).disposition;
  t.setTrust("repin", "silent");  const silentD = t.decide(lowRisk("repin")).disposition;
  t.setTrust("repin", "propose"); const propD = t.decide(lowRisk("repin")).disposition;
  t.setTrust("repin", "never");   const neverD = t.decide(lowRisk("repin")).disposition;   // user said no ⇒ "never" (vs conscience "deny")
  ok("trustLadderGovernsDisposition", askD === "ask" && silentD === "silent" && propD === "propose" && neverD === "never");
}

// ── 3 · RISK CAP: value-moving / irreversible / egress can NEVER be silent, even at trust silent ─────────
{
  const t = makeTrust({ conscience: allow });
  t.setTrust("pay", "silent"); t.setTrust("rm", "silent"); t.setTrust("send", "silent");
  const pay = t.decide({ topic: "pay", kind: "wallet-out", value: true }).disposition;
  const del = t.decide({ topic: "rm", kind: "delete", reversible: false }).disposition;
  const egr = t.decide({ topic: "send", kind: "egress" }).disposition;
  ok("riskCapNeverSilentForValue", pay === "ask" && del === "ask" && egr === "ask");
}

// ── 4 · NO BLIND SILENT ACT: a silent-eligible act with no undo is refused, downgraded to ask ───────────
{
  const t = makeTrust({ conscience: allow });
  t.setTrust("repin", "silent");
  const noUndo = await t.act(lowRisk("repin"), async () => "did-it");          // no undo supplied
  ok("noBlindSilentAct", noUndo.ok === false && noUndo.performed === false && noUndo.disposition === "ask");
}

// ── 5 · the CONSCIENCE FLOOR: a block denies even at trust silent; an allow lets it through ──────────────
{
  const blocked = makeTrust({ conscience: block }); blocked.setTrust("repin", "silent");
  const allowed = makeTrust({ conscience: allow }); allowed.setTrust("repin", "silent");
  ok("conscienceIsTheFloor",
    blocked.decide(lowRisk("repin")).disposition === "deny" && allowed.decide(lowRisk("repin")).disposition === "silent");
}

// ── 6 · a permitted SILENT act performs, seals a re-deriving receipt + an undo; a tampered receipt fails ─
{
  const t = makeTrust({ conscience: allow, now: () => "2026-06-19T00:00:00Z" });
  t.setTrust("repin", "silent");
  let undone = false;
  const r = await t.act(lowRisk("repin"), async () => "repinned", { undo: () => { undone = true; } });
  const tampered = { ...r.receipt.object, "hostrust:disposition": "approved" };
  r.undo();
  ok("silentActSealsReceiptAndUndo",
    r.ok === true && r.performed === true && r.result === "repinned"
    && verify(r.receipt.object) === true && verify(tampered) === false
    && r.receipt.object["hostrust:undoable"] === true && undone === true);
}

// ── 7 · the ASK path requires explicit approval: act() does not perform; approve() does, naming the approver ─
{
  const t = makeTrust({ conscience: allow });
  t.setTrust("pay", "silent");                                   // even at silent, a value action caps to ask
  const action = { topic: "pay", kind: "wallet-out", value: true, summary: "send 5 USDT" };
  let paid = 0;
  const viaAct = await t.act(action, async () => { paid++; });   // must NOT perform
  const viaApprove = await t.approve(action, async () => { paid++; }, { approver: "did:holo:user" });
  ok("askPathRequiresExplicitApproval",
    viaAct.performed === false && viaAct.disposition === "ask"
    && viaApprove.ok === true && viaApprove.performed === true && viaApprove.approver === "did:holo:user"
    && viaApprove.receipt.object["hostrust:approver"] === "did:holo:user" && paid === 1);
}

// ── 8 · ONE-MOVE pause caps a silent topic to propose; resume restores; trust changes ONLY via setTrust ──
{
  const t = makeTrust({ conscience: allow });
  t.setTrust("repin", "silent");
  const before = t.decide(lowRisk("repin")).disposition;
  t.pause();  const paused = t.decide(lowRisk("repin")).disposition;
  t.resume(); const after = t.decide(lowRisk("repin")).disposition;
  // decide()/act() must not mutate the user's grant
  await t.act(lowRisk("repin"), async () => null, { undo: () => {} });
  const grantIntact = t.getTrust("repin") === "silent";
  ok("oneMovePauseAndUserOnlyTrust", before === "silent" && paused === "propose" && after === "silent" && grantIntact);
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "Holo Trust (S4, the trust boundary) — the contract that lets Q ACT while the user stays in the driving seat: disposition = min(user-trust, risk-cap) under the conscience floor, defaulting to propose (default-deny); three hard guarantees the trust level can't override (value/irreversible/egress capped at ask; no silent act without undo; the conscience gate is the fail-closed floor); every autonomous or approved act seals a re-derivable PROV-O receipt with an undo; one-move pause goes fully hands-off; and trust is mutated ONLY by the user (setTrust), never by Q",
  authority: "the Holo Constitution conscience gate (ADR-0033) · the wallet default-deny human-approval model (ADR-0053) · W3C PROV-O · UOR-ADDR · holospaces Laws L1/L5",
  witnessed,
  covers: witnessed ? ["trust-boundary", "default-deny", "risk-cap", "no-blind-silent-act", "conscience-floor", "receipt-and-undo", "explicit-approval", "one-move-pause"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-trust-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Trust witness — S4 the trust boundary (Q may act; the user stays in the seat)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  Q acts only within granted trust — capped, conscience-floored, receipted, reversible" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
