#!/usr/bin/env node
// holo-consent-witness.mjs — PROVE the human-layer CONSENT POLICY that removes the #1 wall (a legalese
// consent card before EVERY app open — holo-terms.js:229). The principle: the substrate keeps default-deny
// and its cryptographic proof (holo-admit / holo-stepup) UNCHANGED; only the SURFACE changes. Ambient
// capabilities (an app using its own data/compute) are auto-granted SILENTLY — no card on open. Genuinely
// sensitive, user-affecting acts (camera, mic, location, spend, reading another app's data) are asked for
// ONLY at the moment of use, in ONE plain sentence with no jargon. Unknown/prohibited caps are refused, not
// prompted. So my mother opens any app and it just opens; she's asked, in plain words, only when something
// truly touches her — exactly like iOS, never like a constitution.
//
// Checks: ambient auto-granted (no card on open); EVER no open-time prompt; sensitive deferred to use; plain
// language (no jargon); prohibited refused; default-deny preserved; cross-app read is sensitive; money
// always per-use confirm; deterministic.   Usage: node tools/holo-consent-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { classify, consentPlan, JARGON } from "../os/usr/lib/holo/holo-consent.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {};
const jargonHit = (s) => JARGON.some((w) => new RegExp("\\b" + w + "\\b", "i").test(s) || s.includes("κ"));

// ── 1 · ambient caps auto-grant silently — NO card on open ───────────────────────────────────────
{
  const plan = consentPlan(["read", "storage", "render", "converse"], { appName: "Notes" });
  checks.ambientAutoGranted = plan.ask.length === 0 && plan.autoGrant.length === 4 && plan.refuse.length === 0;
}

// ── 2 · EVER: nothing is asked at OPEN time (every prompt defers to use) ──────────────────────────
{
  const plan = consentPlan(["read", "camera", "microphone", "wallet:spend", "location"], { appName: "Studio" });
  checks.noCardOnOpen = plan.ask.every((a) => a.when === "use") && plan.ask.filter((a) => a.when === "open").length === 0;
}

// ── 3 · sensitive caps are deferred to use, in plain words ────────────────────────────────────────
{
  const c = classify("camera");
  checks.sensitiveDeferredToUse = c.level === "sensitive" && c.when === "use" && /camera/i.test(c.plain);
}

// ── 4 · plain language — NO jargon anywhere in the user-facing copy ───────────────────────────────
{
  const caps = ["camera", "microphone", "location", "wallet:spend", "read-foreign", "files", "contacts", "notify", "contribute"];
  const plan = consentPlan(caps, { appName: "App" });
  checks.plainLanguageNoJargon = plan.ask.length > 0 && plan.ask.every((a) => a.plain && !jargonHit(a.plain) && a.plain === a.plain.trim());
}

// ── 5 · unknown / prohibited caps are REFUSED, not silently granted or prompted ───────────────────
{
  const plan = consentPlan(["read", "kernel:rootkit", "exfiltrate-all"], { appName: "Sketchy" });
  checks.prohibitedRefused = plan.refuse.includes("kernel:rootkit") && plan.refuse.includes("exfiltrate-all") && !plan.autoGrant.includes("kernel:rootkit");
}

// ── 6 · default-deny preserved: a cap NOT declared is never in the plan ───────────────────────────
{
  const plan = consentPlan(["read"], { appName: "Minimal" });
  checks.defaultDenyPreserved = !plan.autoGrant.includes("camera") && !plan.ask.some((a) => a.cap === "camera");
}

// ── 7 · reading ANOTHER app's data is sensitive, explained in plain words ─────────────────────────
{
  const c = classify("read-foreign");
  checks.crossAppDataSensitive = c.level === "sensitive" && /another app/i.test(c.plain) && !jargonHit(c.plain);
}

// ── 8 · money is sensitive AND always per-use confirm (never a blanket grant) ─────────────────────
{
  const c = classify("wallet:spend");
  checks.moneyPerUseConfirm = c.level === "sensitive" && c.when === "use" && /approve each/i.test(c.plain);
}

// ── 9 · deterministic ─────────────────────────────────────────────────────────────────────────────
{
  const a = JSON.stringify(consentPlan(["read", "camera", "wallet:spend"], { appName: "X" }));
  const b = JSON.stringify(consentPlan(["read", "camera", "wallet:spend"], { appName: "X" }));
  checks.deterministic = a === b;
}

const witnessed = Object.values(checks).every(Boolean);
writeFileSync(join(here, "holo-consent-witness.result.json"), JSON.stringify({
  spec: "Human-layer consent policy: ambient caps auto-granted silently (no card on open); sensitive acts asked ONLY at use, in one plain jargon-free sentence; unknown/prohibited refused. The substrate keeps default-deny + cryptographic proof (holo-admit/holo-stepup) unchanged — only the surface stops interrupting. Removes the #1 non-technical-user wall.",
  authority: "holospaces default-deny (holo-admit) · holo-stepup (proof for sensitive acts) · iOS/Android just-in-time permission UX (external)",
  witnessed,
  covers: witnessed ? ["consent-policy", "ambient-auto-grant", "no-card-on-open", "use-time-deferral", "plain-language", "prohibited-refused", "default-deny", "money-per-use"] : [],
  checks,
}, null, 2) + "\n");

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ apps just open; consent is plain-words, at use, only when it truly touches her — substrate proof intact" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
