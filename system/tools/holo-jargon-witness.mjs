#!/usr/bin/env node
// holo-jargon-witness.mjs — the simplicity gate (S3): the everyday surface must speak plain language. Scans
// the shell's USER-FACING attributes (title / placeholder / aria-label tooltips + labels) for technical
// jargon that should never reach a non-technical user — κ, "content address", sync, install, manifest,
// reseal, rendezvous, did:holo, "source chain". Dynamic (JS-built) attribute values are skipped; this gates
// the static, human-read strings. A repeatable guard so jargon can't creep back into the front door.
//
// Checks:
//   1 shellAttrsPlain   — no banned technical term in any static title/placeholder/aria-label in shell.html.
//   2 frontDoorPresent  — the everyday labels still read plainly (Create · Play · Share · "Search anything").
//
// Authority: holospaces W5 (jargon) + the streaming-os simplicity bar. node tools/holo-jargon-witness.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

const shell = readFileSync(join(here, "../os/usr/share/frame/shell.html"), "utf8");

// every static user-facing attribute value
const BANNED = /(κ\b|kappa|\bsync\b|\binstall\b|\bmanifest\b|\breseal\b|\brendezvous\b|content address|source chain|did:holo)/i;
const isDynamic = (v) => /[+$]|encodeURIComponent|\$\{/.test(v);   // JS-built value → not a static human string
const offenders = [];
const re = /(?:title|placeholder|aria-label)="([^"]*)"/g;
let m;
while ((m = re.exec(shell))) {
  const v = m[1];
  if (!v || isDynamic(v)) continue;
  if (BANNED.test(v)) offenders.push(v.slice(0, 60));
}
ok("shellAttrsPlain", offenders.length === 0, offenders.join("  |  "));

// the front door still reads in plain language (positive sanity — we didn't strip the real labels)
const frontDoor = ['>✦ <span class="vl">Create</span>', '>▶ <span class="vl">Play</span>', 'Share</span>', 'placeholder="Search anything"'];
const missing = frontDoor.filter((s) => shell.indexOf(s) < 0);
ok("frontDoorPresent", missing.length === 0, "missing: " + missing.join(" , "));

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-jargon — the simplicity gate: the shell's static user-facing tooltips/labels carry no technical jargon (κ, content address, sync, install, manifest, reseal, rendezvous, did:holo, source chain), while the plain front-door labels (Create · Play · Share · Search anything) remain. A repeatable guard against jargon creep into the everyday surface.",
  authority: "holospaces W5 (jargon) · the streaming-os simplicity bar",
  witnessed,
  covers: witnessed ? ["shell-attrs-plain", "front-door-present"] : [],
  offenders,
  checks, failed: fail,
};
writeFileSync(join(here, "holo-jargon-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-jargon witness — the everyday surface speaks plain language\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
if (offenders.length) console.log("\n  jargon found: " + offenders.join("  |  "));
console.log(`\n  ${witnessed ? "WITNESSED ✓  no jargon at the front door; plain labels intact" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
