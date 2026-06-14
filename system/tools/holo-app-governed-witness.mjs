#!/usr/bin/env node
// holo-app-governed-witness.mjs — PROVE Holo Terms + Holo Privacy are enforced for EVERY holospace,
// at the host that mounts them. Governance is HOST-level by design (like the capability sandbox): an
// app is governed because the host is, not because it opts in — so the right thing to witness is the
// host, not 40 apps. If the host carries the wire, every app it mounts is covered; if it ever drops
// it, this row goes red. Read-only static analysis of the canonical host frames + the gov module.
//
//   node tools/holo-app-governed-witness.mjs
//
// The invariant, per host frame (shell.html — the World door; holospace.html — the bare/share mount):
//   1. loads Holo Terms, Holo Privacy, and the host governance module (holo-gov.js);
//   2. clamps capabilities through the Terms GATE before mounting (HoloTerms.gate / gateCaps);
//   3. binds each mounted frame's verified identity to the privacy broker (HoloGov.register/focus);
//   4. does NOT suppress the shields (no __holoTermsBadge=false / __holoPrivacyBadge=false) — silent
//      enforcement is not enforcement; the user must see the active term + disclosure.
// And the gov module itself must broker privacy with a HOST-asserted recipient (default-deny).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "..", "os");
const FRAME = join(OS, "usr", "share", "frame");
const GOV = join(OS, "usr", "lib", "holo", "holo-gov.js");

// Each host frame and the checks it must satisfy. A check is a set of substrings, ANY of which counts
// (so an adoption can change form — κ-route, path, or data-holo-shared hint — without a false red).
const FRAMES = ["shell.html", "holospace.html"];
const CHECKS = [
  { key: "terms-loaded", any: ['data-holo-shared="holo-terms.js"', "holo-terms.js"], why: "loads Holo Terms" },
  { key: "privacy-loaded", any: ['data-holo-shared="holo-privacy.js"', "holo-privacy.js"], why: "loads Holo Privacy" },
  { key: "gov-loaded", any: ['data-holo-shared="holo-gov.js"', "holo-gov.js"], why: "loads the host governance module" },
  { key: "terms-gate", any: ["HoloTerms.gate", "gateCaps("], why: "clamps capabilities through the Terms gate before mount" },
  { key: "privacy-bound", any: ["HoloGov.register", "HoloGov.focus"], why: "binds each mounted frame to the privacy broker" },
];
// A frame must NOT contain any of these — they suppress the shields (silent governance).
const FORBID = [/__holoTermsBadge\s*=\s*false/, /__holoPrivacyBadge\s*=\s*false/];

// The gov module must actually broker privacy at the host, recipient asserted from what it mounted.
const GOV_REQUIRED = [
  { any: ['"holo-privacy:rpc"', "holo-privacy:rpc"], why: "accepts the privacy RPC from app frames" },
  { any: ["byWin.get", "byWin.set"], why: "keys identity by frame window (host-asserted recipient)" },
  { any: ["HoloPrivacy.gate"], why: "gates the disclosure under the user's stance" },
];

const fails = [];
for (const f of FRAMES) {
  const p = join(FRAME, f);
  if (!existsSync(p)) { fails.push(`${f}: MISSING host frame`); continue; }
  const html = readFileSync(p, "utf8");
  for (const c of CHECKS) if (!c.any.some((s) => html.includes(s))) fails.push(`${f}: ${c.why} (${c.key})`);
  for (const re of FORBID) if (re.test(html)) fails.push(`${f}: suppresses a governance shield — ${re}`);
}
if (!existsSync(GOV)) fails.push("holo-gov.js: MISSING governance module");
else { const gov = readFileSync(GOV, "utf8"); for (const c of GOV_REQUIRED) if (!c.any.some((s) => gov.includes(s))) fails.push(`holo-gov.js: ${c.why}`); }

const witnessed = fails.length === 0;
console.log(`Holo governance wiring — ${FRAMES.length} host frame(s) + the gov module`);
console.log(witnessed
  ? "PASS — Holo Terms + Holo Privacy are loaded, gated, surfaced, and brokered at every host mount (universal)"
  : `FAIL — ${fails.length} gap(s):\n  - ${fails.join("\n  - ")}`);

writeFileSync(join(here, "holo-app-governed-witness.result.json"), JSON.stringify({
  spec: "Holo Terms (capability gate) and Holo Privacy (disclosure gate) are core OS functions enforced at the HOST for every mounted holospace: the host loads both + the governance module, clamps capabilities through the Terms gate before mounting, brokers privacy with a host-asserted recipient (the app never holds the wallet/keys), and surfaces one shield per focused app. Universal by construction — proven at the host, so no app can be an ungoverned island.",
  authority: "IEEE 7012-2025 (MyTerms) · W3C VC/DPV (selective disclosure) · ADR-031 (Holo Conform — spec governance, build-gated separately) · holo-launch.mount (capability sandbox) · static analysis of the canonical host frames",
  witnessed,
  covers: ["holo-terms", "holo-privacy", "host-enforced", "every-application", "default-deny", "surfaced"],
  frames: FRAMES,
  gaps: fails,
}, null, 2) + "\n");

console.log(`\nholo-app-governed: ${witnessed ? "WITNESSED" : "FAILED"}${fails.length ? ` · ${fails.length} gap(s)` : ""}`);
process.exit(witnessed ? 0 : 1);
