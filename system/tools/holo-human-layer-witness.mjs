#!/usr/bin/env node
// holo-human-layer-witness.mjs — the ACCEPTANCE GATE for the human layer: a repeatable proof that the real
// surfaces carry the mother-test wins AND that the substrate's safety is untouched. It is the automatable
// half of the acceptance ritual (the other half is a recorded cold walkthrough with a real person). It
// reads the served surfaces and the policy modules and asserts: first run is guest-first (no setup wall);
// the consent cards are plain words (no terms/propose/deny-extras jargon); no "Resolving app…"; the policy
// modules behave; and the substrate gate logic (default-deny, classify, signed records) is still present.
//
//   node tools/holo-human-layer-witness.mjs

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { consentPlan } from "../os/usr/lib/holo/holo-consent.mjs";
import { bootPlan } from "../os/usr/lib/holo/holo-onboarding.mjs";
import { humanize } from "../os/usr/lib/holo/holo-plainwords.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const read = (rel) => readFileSync(join(OS, rel), "utf8");
const checks = {};

const login = read("usr/share/frame/login.html");
const terms = read("usr/lib/holo/holo-terms.js");
const holospace = read("usr/share/frame/holospace.html");

// ── 1 · first run is GUEST-FIRST — "Just start" wired to guest, no setup wall ─────────────────────
checks.guestFirstBoot = login.includes('id="juststart"') && /juststart.*sddm\.guest\(\)/s.test(login) &&
  login.includes("Just start") && !login.includes("Set up this device");

// ── 2 · both consent cards are PLAIN — no terms/propose/deny-extras jargon in the visible templates ──
checks.consentCardsPlain =
  terms.includes("would like your OK") && terms.includes("A few apps would like your OK") &&
  terms.includes("It works on its own") &&
  terms.includes('data-act="deny">Not now<') && terms.includes('data-act="allow">Allow<') && terms.includes('data-act="allow">Allow all<') &&
  !terms.includes('class="ht-t">Your terms for') && !terms.includes('data-act="deny">Deny extras<') && !terms.includes('data-act="allow">Agree');

// ── 3 · no "Resolving app…" jargon on the loading path ────────────────────────────────────────────
checks.noResolvingApp = !holospace.includes("Resolving app");

// ── 4 · the policies behave (the logic behind the surfaces) ───────────────────────────────────────
{
  const ambient = consentPlan(["read", "storage", "render"]);            // an everyday app
  const sensitive = consentPlan(["camera"]);
  const boot = bootPlan({ hasUsers: false });
  const stripped = humanize("did:holo:sha256:" + "a".repeat(64) + " is your κ wallet");
  checks.policiesBehave = ambient.ask.length === 0 && sensitive.ask[0].when === "use" &&
    boot.mode === "guest" && boot.land === "experience" &&
    !/did:holo/.test(stripped) && !stripped.includes("κ") && /Money/.test(stripped);
}

// ── 5 · the substrate SAFETY is untouched (default-deny gate + classify + signed records present) ──
checks.substrateIntact = /async function gate\(/.test(terms) && /function classify\(/.test(terms) &&
  /makeRecord/.test(terms) && terms.includes("fail closed");

// ── 6 · the policy modules are present (served + importable) ──────────────────────────────────────
checks.policiesServed = ["holo-consent.mjs", "holo-onboarding.mjs", "holo-plainwords.mjs", "holo-player.mjs"]
  .every((m) => existsSync(join(OS, "usr/lib/holo", m)));

const witnessed = Object.values(checks).every(Boolean);
import("node:fs").then(({ writeFileSync }) => writeFileSync(join(here, "holo-human-layer-witness.result.json"), JSON.stringify({
  spec: "Acceptance gate for the human layer: the real surfaces carry the mother-test wins (guest-first boot, plain-words consent, no 'Resolving app…') and the substrate safety is untouched (default-deny gate, classify, signed records). The automatable half of the acceptance ritual.",
  authority: "the file-cited friction audit (this session) · holospaces default-deny · the committed human-layer policies",
  witnessed,
  covers: witnessed ? ["guest-first-boot", "plain-consent-cards", "no-resolving-jargon", "policies-behave", "substrate-intact", "policies-served"] : [],
  checks,
}, null, 2) + "\n"));

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ surfaces carry the human-layer wins; substrate safety intact — the spell holds, the truth too" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
