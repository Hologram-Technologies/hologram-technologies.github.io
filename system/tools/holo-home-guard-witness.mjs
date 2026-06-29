#!/usr/bin/env node
// holo-home-guard-witness.mjs — proves IDENTITY WITHOUT ACCOUNTS (holo-home-guard): Home has no passwords
// and no user-service; the key that owns the manifest is the only authority. Most of Home is ambient, but
// the verbs that change WHO can reach your cloud (pair/revoke a device) or EXPOSE it (export) must pass a
// sovereign step-up first — reusing holo-stepup, inventing no ceremony. Drives the real substrate: a real
// enrolled holo-identity operator as the step-up signer, and the real holo-stepup build/verify path.
//
// Checks (all must hold):
//   1 ambientNoStepUp      — home.files.add / home.app.pin are ambient ⇒ allowed, never gated.
//   2 sensitiveStepsUp     — home.device.pair builds + verifies a sovereign token ⇒ allowed with a token.
//   3 windowSuppressesRepeat— a 2nd pair within the window is suppressed; a 2nd within window is effortless.
//   4 revealNeverSuppressed— home.export (a reveal kind) ALWAYS asks, even with a fresh same-kind step-up.
//   5 forgedTokenRefused   — a tampered step-up token fails verification ⇒ the gate refuses (fail-closed).
//   6 noSignerRefused      — a sensitive verb with no unlocked signer ⇒ refused (no silent pass).
//
// Authority: UOR-ADDR · holospaces Laws L1/L5 · WebAuthn UV · rests on #holo-home-guard + #holo-stepup +
// #holo-identity. node tools/holo-home-guard-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { verbNeedsStepUp, gateVerb, verbStepUpKind } from "../os/usr/lib/holo/holo-home-guard.mjs";
import { buildStepUp, verifyStepUp } from "../os/usr/lib/holo/holo-stepup.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const NOW = Date.parse("2026-06-24T05:00:00Z");

const op = await enroll({ label: "home-key-owner", passphrase: "the only authority here" });

// ── 1 · ambient verbs are never gated ────────────────────────────────────────────────────────────────
const a1 = await gateVerb("home.files.add", { signer: op, nowMs: NOW });
const a2 = await gateVerb("home.app.pin", { signer: op, nowMs: NOW });
ok("ambientNoStepUp",
  a1.allowed === true && a1.guarded === false && a2.allowed === true && a2.guarded === false
  && verbStepUpKind("home.files.add") === null && verbNeedsStepUp("home.app.pin", { nowMs: NOW }) === false,
  JSON.stringify({ a1: a1.guarded, a2: a2.guarded }));

// ── 2 · a sensitive verb builds + verifies a sovereign step-up token ─────────────────────────────────
const g2 = await gateVerb("home.device.pair", { signer: op, nowMs: NOW, reason: "Link a new phone" });
const body2 = g2.token ? await verifyStepUp(g2.token) : null;
ok("sensitiveStepsUp",
  g2.allowed === true && g2.guarded === true && g2.token && body2 && body2.operator === op.kappa && body2.kind === "home.device.pair",
  JSON.stringify({ allowed: g2.allowed, op: body2 && body2.operator === op.kappa }));

// ── 3 · a fresh window suppresses a repeat of the SAME authority verb; a different verb still asks ────
const last = { kind: "home.device.pair", atMs: NOW };
const g3 = await gateVerb("home.device.pair", { signer: op, nowMs: NOW + 30000, last });   // 30s later, same verb
const g3b = await gateVerb("home.device.revoke", { signer: op, nowMs: NOW + 30000, last }); // different verb
ok("windowSuppressesRepeat",
  g3.allowed === true && g3.suppressed === true && !g3.token
  && g3b.allowed === true && g3b.suppressed !== true && !!g3b.token,
  JSON.stringify({ repeatSuppressed: g3.suppressed, otherAsked: !!g3b.token }));

// ── 4 · a reveal verb always asks, even with a fresh same-kind step-up in the window ─────────────────
const lastExport = { kind: "vault.export", atMs: NOW + 60000 };
const needs4 = verbNeedsStepUp("home.export", { last: lastExport, nowMs: NOW + 60001 });
const g4 = await gateVerb("home.export", { signer: op, nowMs: NOW + 60001, last: lastExport });
ok("revealNeverSuppressed", needs4 === true && g4.allowed === true && g4.suppressed !== true && !!g4.token, JSON.stringify({ needs4, suppressed: g4.suppressed }));

// ── 5 · a tampered token fails verification (the gate would refuse) ──────────────────────────────────
const action = { kind: "home.device.pair", payload: { deviceKappa: "did:holo:sha256:" + "c".repeat(64) }, appId: "holo-home", operator: op.kappa, reason: "Link", issuedAt: NOW, nonce: "n1" };
const good = await buildStepUp(action, op);
const tampered = clone(good); tampered.payload.deviceKappa = "did:holo:sha256:" + "e".repeat(64); // change what was signed
const v5 = await verifyStepUp(tampered);
const good5 = await verifyStepUp(good);
ok("forgedTokenRefused", v5 === null && good5 && good5.operator === op.kappa, JSON.stringify({ tamperedRefused: v5 === null, goodOk: !!good5 }));

// ── 6 · a sensitive verb with no signer is refused (never a silent pass) ─────────────────────────────
const g6 = await gateVerb("home.device.pair", { signer: null, nowMs: NOW });
ok("noSignerRefused", g6.allowed === false && g6.guarded === true && g6.reason === "no-signer", JSON.stringify(g6));

await forget(op.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-home-guard — IDENTITY WITHOUT ACCOUNTS: Home has no passwords and no user-service; the key that owns the manifest is the only authority. Most of Home is ambient (browse/open/pin), but the verbs that change WHO can reach your cloud (pair/revoke a device) or EXPOSE it (export) pass a sovereign step-up first, reusing holo-stepup — authority verbs ride a fresh window so repeats feel effortless, while reveal verbs always ask and tampered tokens fail closed. A verb nobody classified as ambient is sensitive by default.",
  authority: "UOR-ADDR · holospaces Laws L1/L5 · WebAuthn UV · rests on #holo-home-guard + #holo-stepup + #holo-identity",
  witnessed,
  covers: witnessed ? ["ambient-no-stepup", "sensitive-steps-up", "window-suppresses-repeat", "reveal-never-suppressed", "forged-token-refused", "no-signer-refused"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-home-guard-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-home-guard witness — no passwords; one key, one biometric, and the dangerous verbs ask\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  ambient by default; pair/revoke/export pass a sovereign step-up, fail-closed" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
