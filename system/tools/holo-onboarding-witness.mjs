#!/usr/bin/env node
// holo-onboarding-witness.mjs — PROVE the guest-first boot policy that removes wall #2 (a name+biometric
// identity wall before she sees anything — login.html:416) and wall #6 ("Sign in" → unfamiliar crypto auth).
// The principle: she JUST STARTS. First run lands straight in the experience on a silently-created guest;
// no name, no biometric, no "sign in", no jargon. Identity is DEFERRED, not removed: it surfaces only when
// an action genuinely benefits from it (keep across devices, spend money, be "from you"), in one plain
// sentence — and those acts really do create a real identity (we defer, we never deceive). A guest has the
// full LOCAL experience; identity only adds cross-device / money / attributable.
//
// Checks: first run is guest, no wall; everyday actions need no identity; only beneficial actions prompt;
// plain-language upgrade copy; guest fully capable locally; returning user resumes; deferred-not-removed
// (money/cross-device genuinely require identity); deterministic.   node tools/holo-onboarding-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { bootPlan, needsIdentity, upgradeCopy, guestCapable } from "../os/usr/lib/holo/holo-onboarding.mjs";
import { JARGON } from "../os/usr/lib/holo/holo-consent.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const EXTRA = ["biometric", "passkey", "enroll", "authenticate"];
const jargonHit = (s) => [...JARGON, ...EXTRA].some((w) => new RegExp("\\b" + w + "\\b", "i").test(s)) || s.includes("κ");
const checks = {};

const everyday = ["open", "play", "converse", "browse", "local-edit", "resume"];
const beneficial = ["persist-across-devices", "spend", "sign-as-you", "publish-as-you"];

// ── 1 · first run is GUEST and lands in the experience — no wall, no prompts ──────────────────────
{
  const p = bootPlan({ hasUsers: false });
  checks.firstRunIsGuestNoWall = p.mode === "guest" && p.land === "experience" && p.prompts.length === 0;
}

// ── 2 · everyday actions need NO identity ────────────────────────────────────────────────────────
{
  checks.everydayNoIdentity = everyday.every((a) => needsIdentity(a) === false);
}

// ── 3 · only genuinely beneficial actions prompt for identity ─────────────────────────────────────
{
  checks.onlyBeneficialPrompts = beneficial.every((a) => needsIdentity(a) === true);
}

// ── 4 · the upgrade copy is plain language — no jargon ────────────────────────────────────────────
{
  const copies = beneficial.map((a) => upgradeCopy(a));
  checks.plainLanguageUpgrade = copies.every((c) => c && !jargonHit(c) && /\?$/.test(c)) && copies.length === 4;
}

// ── 5 · a guest has the FULL local experience ─────────────────────────────────────────────────────
{
  checks.guestFullyCapableLocally = everyday.every((a) => guestCapable(a) === true);
}

// ── 6 · a returning user resumes — also no setup wall ────────────────────────────────────────────
{
  const p = bootPlan({ hasUsers: true });
  checks.returningUserResumes = (p.mode === "resume" || p.mode === "you") && p.land === "experience" && p.prompts.length === 0;
}

// ── 7 · deferred, NOT removed: money & cross-device genuinely require a real identity ──────────────
{
  checks.deferredNotRemoved = needsIdentity("spend") === true && needsIdentity("persist-across-devices") === true &&
    guestCapable("spend") === false && guestCapable("persist-across-devices") === false;
}

// ── 8 · deterministic ─────────────────────────────────────────────────────────────────────────────
{
  checks.deterministic = JSON.stringify(bootPlan({ hasUsers: false })) === JSON.stringify(bootPlan({ hasUsers: false })) && upgradeCopy("spend") === upgradeCopy("spend");
}

const witnessed = Object.values(checks).every(Boolean);
writeFileSync(join(here, "holo-onboarding-witness.result.json"), JSON.stringify({
  spec: "Guest-first boot: first run lands straight in the experience on a silent guest — no name, biometric, sign-in, or jargon. Identity is deferred, surfaced only when an action benefits (keep across devices, spend, be 'from you'), in plain words — and those acts genuinely create real identity (defer, never deceive). Guests have the full local experience. Removes walls #2 and #6.",
  authority: "holospaces holo-identity (guest + sovereign enroll, unchanged) · just-in-time account upgrade UX (external)",
  witnessed,
  covers: witnessed ? ["guest-first", "no-boot-wall", "everyday-no-identity", "beneficial-only-prompt", "plain-upgrade", "guest-full-local", "returning-resumes", "deferred-not-removed"] : [],
  checks,
}, null, 2) + "\n");

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ she just starts — guest-first, no wall, no jargon; identity deferred but honest" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
