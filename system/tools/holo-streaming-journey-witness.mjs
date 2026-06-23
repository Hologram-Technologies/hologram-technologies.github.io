#!/usr/bin/env node
// holo-streaming-journey-witness.mjs — the S7 coherence gate: the WHOLE streaming-OS journey is wired into
// the ONE shell, in plain language. A repeatable CI guard that the unification (S1–S6) stays intact — if any
// seam regresses, this fails. Static assertions over the served shell.html + holo-share-ui.mjs (the surfaces
// a stranger actually meets), mirroring the "mother test": cold open → browse → play → continue → link →
// share, with no jargon at the front door.
//
// Checks (the journey, end to end):
//   1 frontDoorPlain   — Create · Play · Share + "Search anything" present, in plain words.
//   2 continueWired    — S1: the Continue-watching rail (holo-continue-ui + continueRail) is mounted on Home.
//   3 oneOpenPath      — S2: window.HoloOpen (holo-open) is the one open seam; the rail routes through it.
//   4 rankedToYou      — S5: the rail is fed your private interests (profileTerms / HoloProfile).
//   5 linkADevice      — S4: ♥ Share carries "Link a device" → pair.html (camera).
//   6 justAsk          — S6: the streaming spine is registered as Q tools (holo-stream-agent + HoloContinue).
//   7 noJargonFront    — S3: no technical jargon in the shell's static user-facing tooltips/labels.
//
// Authority: the streaming-os simplicity bar · holospaces W5. node tools/holo-streaming-journey-witness.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

const shell = readFileSync(join(here, "../os/usr/share/frame/shell.html"), "utf8");
const shareUi = readFileSync(join(here, "../os/usr/lib/holo/holo-share-ui.mjs"), "utf8");
const has = (s, ...subs) => subs.every((x) => s.indexOf(x) >= 0);

// 1 · front door, plain
ok("frontDoorPlain", has(shell, '>✦ <span class="vl">Create</span>', 'Play</span>', 'Share</span>', 'placeholder="Search anything"'));

// 2 · S1 Continue watching rail on Home
ok("continueWired", has(shell, 'holo-continue-ui.mjs', 'continueRail()', 'cw-home'));

// 3 · S2 one open path
ok("oneOpenPath", has(shell, 'holo-open.mjs', 'window.HoloOpen = makeHoloOpen', 'window.HoloOpen)'));

// 4 · S5 ranked to you
ok("rankedToYou", has(shell, 'profileTerms:', 'HoloProfile'));

// 5 · S4 link a device, via ♥ Share
ok("linkADevice", has(shell, 'onLinkDevice:', '/pair.html') && has(shareUi, 'data-act="linkdevice"', 'onLinkDevice'));

// 6 · S6 just ask — streaming spine as Q tools
ok("justAsk", has(shell, 'holo-stream-agent.mjs', 'reg.register("stream"', 'window.HoloContinue ='));

// 7 · S3 no jargon at the front door (static user-facing attrs)
{
  const BANNED = /(κ\b|kappa|\bsync\b|\binstall\b|\bmanifest\b|\breseal\b|\brendezvous\b|content address|did:holo)/i;
  const isDynamic = (v) => /[+$]|encodeURIComponent|\$\{/.test(v);
  const offenders = [];
  const re = /(?:title|placeholder|aria-label)="([^"]*)"/g; let m;
  while ((m = re.exec(shell))) { const v = m[1]; if (v && !isDynamic(v) && BANNED.test(v)) offenders.push(v.slice(0, 50)); }
  ok("noJargonFront", offenders.length === 0, offenders.join(" | "));
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-streaming-journey S7 — the whole streaming-OS journey is wired into the one shell, in plain language: the front door reads Create/Play/Share + Search anything; Continue watching is the home (S1); window.HoloOpen is the one open path the rail routes through (S2); the rail is ranked to your private interests (S5); ♥ Share carries 'Link a device' → pair.html (S4); the streaming spine is registered as Q tools (S6); and no technical jargon reaches the front door (S3). The mother-test, as a repeatable gate.",
  authority: "the streaming-os simplicity bar · holospaces W5",
  witnessed,
  covers: witnessed ? ["front-door-plain", "continue-wired", "one-open-path", "ranked-to-you", "link-a-device", "just-ask", "no-jargon-front"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-streaming-journey-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-streaming-journey witness — the whole journey, wired into one shell, in plain language\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  cold open → browse → play → continue → link → share, no jargon" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
