#!/usr/bin/env node
// holo-messenger-creds-witness.mjs — LOG IN ONCE, EVERY PLATFORM — proven on the canonical vault.
//
// Drives the REAL holo-login identity stack + holo-vault (Holo Pass): per-platform messenger sessions
// stored as vault entries, unlocked by ONE biometric, sealed at rest, step-up-gated to reveal.
//
//   ONCE     — one vault unlock links many platforms; linkedPlatforms lists them (metadata only)
//   SESSION  — the warm session continuity is recoverable in-session; an unlinked platform is absent
//   OPAQUE   — the at-rest chain leaks no session secret, account, or platform id (SEC-5)
//   ONEKEY   — one biometric covers all platforms (re-unlock recovers them); a wrong secret is refused
//   REVEAL   — surfacing a raw session is a payload-bound TEE step-up — fail-closed without a TEE (SEC-2)
//   FORWARD  — epoch rotation keeps sealing future sessions under a fresh key (§2.8 forward secrecy)
//   UNLINK   — disconnecting a platform removes it from the linked set
//
//   node tools/holo-messenger-creds-witness.mjs
//
// Authority: holo-vault (Holo Pass) · holo-login (the one gate) · holo-stepup · holo-apps §2.8/§2.9 · SEC-1/2/4/5.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { enroll, unlock } from "../os/usr/lib/holo/holo-login.mjs";
import { openVault, __rawChain, forgetVault } from "../os/usr/lib/holo/holo-vault.mjs";
import { ADAPTERS } from "../os/usr/lib/holo/holo-bridge-adapters.mjs";
import { linkPlatform, linkedPlatforms, platformLinked, platformSession, unlinkPlatform, revealPlatformSession } from "../os/usr/lib/holo/holo-messenger-creds.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const throws = async (fn) => { try { await fn(); return false; } catch { return true; } };
const A = (id) => ADAPTERS.find((a) => a.id === id);

const SECRET = "messenger-creds-witness-prf-0001";   // stands in for the enclave PRF output
const { principal } = await enroll({ label: "messenger-operator", secret: SECRET, allowPhrase: true });
const OP = principal.kappa;

// distinctive secrets/accounts so at-rest opacity is meaningful
const WA = { account: "ILYA-WA-ACCT", session: { device: "linked", token: "SECRET-WA-TOKEN-7f3a", since: "2026-06-23" } };
const TG = { account: "@ilya-tg", session: { token: "SECRET-TG-TOKEN-9b2c" } };
const SL = { account: "ilya-slack", session: { token: "SECRET-SL-TOKEN-1d4e" } };

// ── 1 · ONCE — one unlock links many platforms ──
const v = await openVault(OP, SECRET);
await linkPlatform(v, A("whatsapp"), WA);
await linkPlatform(v, A("telegram"), TG);
await linkPlatform(v, A("slack"), SL);
const linked = linkedPlatforms(v);
ok("one-unlock-links-platforms",
  linked.length === 3 && linked.map((p) => p.id).sort().join(",") === "slack,telegram,whatsapp" &&
  linked.find((p) => p.id === "whatsapp").account === "ILYA-WA-ACCT",
  linked.map((p) => p.id).join(","));

// ── 2 · metadata only — the linked list carries NO secret ──
ok("linked-list-metadata-only", linked.every((p) => !("secret" in p) && !("session" in p)) && linked.every((p) => p.label), "no secret in list");

// ── 3 · SESSION — recoverable in-session; an unlinked platform is absent ──
const waSess = platformSession(v, "whatsapp");
ok("session-recoverable-in-session",
  waSess && waSess.token === "SECRET-WA-TOKEN-7f3a" && waSess.device === "linked" &&
  platformLinked(v, "whatsapp") === true && platformLinked(v, "discord") === false &&
  platformSession(v, "discord") === null,
  waSess ? waSess.token : "none");

// ── 4 · OPAQUE — the at-rest chain leaks no session secret, account, or platform id (SEC-5) ──
const wire = JSON.stringify(await __rawChain(OP));
const leaks = ["SECRET-WA-TOKEN-7f3a", "SECRET-TG-TOKEN-9b2c", "SECRET-SL-TOKEN-1d4e", "ILYA-WA-ACCT", "@ilya-tg", "holo-messenger://whatsapp"].filter((s) => wire.includes(s));
ok("at-rest-opaque", leaks.length === 0, leaks.join(",") || "clean");

// ── 5 · ONEKEY — one biometric covers all; re-unlock recovers them; a wrong secret is refused ──
const v2 = await openVault(OP, SECRET);
const reLinked = linkedPlatforms(v2);
const wrongRefused = await throws(() => openVault(OP, "the-wrong-secret"));
ok("one-biometric-covers-all",
  reLinked.length === 3 && platformSession(v2, "telegram").token === "SECRET-TG-TOKEN-9b2c" && wrongRefused,
  `reopened=${reLinked.length} wrongRefused=${wrongRefused}`);

// ── 6 · REVEAL — surfacing a raw session is step-up gated; fail-closed without a TEE (SEC-2) ──
const revealGated = await throws(() => revealPlatformSession(v2, "whatsapp"));
ok("reveal-is-step-up-gated", revealGated, "reveal refused without TEE");

// ── 7 · FORWARD — epoch rotation seals future sessions under a fresh key (§2.8) ──
const epoch0 = v2.epoch();
await v2.rotateEpoch();
await linkPlatform(v2, A("discord"), { account: "ilya#0001", session: { token: "SECRET-DC-TOKEN-5a6b" } });
const epoch1 = v2.epoch();
const wire2 = JSON.stringify(await __rawChain(OP));
ok("forward-secrecy-rotation",
  epoch1 === epoch0 + 1 && platformLinked(v2, "discord") === true && !wire2.includes("SECRET-DC-TOKEN-5a6b"),
  `epoch ${epoch0}→${epoch1}`);

// ── 8 · UNLINK — disconnecting removes it from the linked set ──
await unlinkPlatform(v2, "telegram");
const after = linkedPlatforms(v2);
ok("unlink-removes-platform",
  after.length === 3 && !after.find((p) => p.id === "telegram") && !!after.find((p) => p.id === "discord"),
  after.map((p) => p.id).join(","));

await forgetVault(OP).catch(() => {});

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult", witnessed,
  covers: [
    "ONCE — one vault unlock links many messenger platforms; linkedPlatforms lists them (metadata only)",
    "METADATA — the linked list carries no session secret",
    "SESSION — the warm session continuity is recoverable in-session; an unlinked platform is absent",
    "OPAQUE — the at-rest credential chain leaks no session secret, account, or platform id in cleartext (SEC-5)",
    "ONEKEY — one biometric covers all platforms (re-unlock recovers them); a wrong secret is refused fail-closed",
    "REVEAL — surfacing a raw session is a payload-bound TEE step-up, fail-closed without a TEE (SEC-2 consent)",
    "FORWARD — epoch rotation seals future sessions under a fresh key (holo-apps §2.8 forward secrecy)",
    "UNLINK — disconnecting a platform removes it from the linked set",
  ],
  operator: OP, linked: linked.map((p) => p.id),
  checks, failed: fail,
  authority: "holo-vault (Holo Pass) · holo-login · holo-stepup · holo-apps §2.8/§2.9 · holospaces SEC-1/2/4/5",
};
writeFileSync(join(here, "holo-messenger-creds-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Messenger creds witness — log in once, every platform (Holo Pass)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  operator ${String(OP).slice(-12)} · linked: ${linked.map((p) => p.id).join(" · ")} · one biometric, sealed at rest`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
