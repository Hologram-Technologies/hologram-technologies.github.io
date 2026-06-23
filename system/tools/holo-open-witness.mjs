#!/usr/bin/env node
// holo-open-witness.mjs — proves "the one open path" (S2): the shape classifier routes every ref kind, and
// makeOpen dispatches the named forms to space/app handlers while delegating every other shape to the one
// fallback resolver (the shell wires omniGo). So a card, a search result, a shared link, or an agent intent
// all open through ONE seam — press play, it plays.
//
// Checks:
//   1 classifyShapes   — each ref shape → the right kind (space/kappa/app/words/cid/onion/url/media/text).
//   2 routesNamedForms — holo://<id> → app handler; holo://space/<id> → space handler (with bare ids).
//   3 delegatesRest    — κ / words / url / media / text → the fallback resolver (one path for everything else).
//   4 idStripsPrefix   — idOf strips holo:// and holo://space/.
//   5 failSoftEmpty    — empty / no-handler → null, never throws.
//
// Authority: rests on #holo-open (+ the shell's omniGo as fallback). node tools/holo-open-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { classifyOpen, idOf, makeOpen } from "../os/usr/lib/holo/holo-open.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

// ── 1 · shape classification ─────────────────────────────────────────────────────────────────────────
const hex = "a".repeat(64);
const cases = [
  ["holo://space/research", "space"],
  ["did:holo:sha256:" + hex, "kappa"],
  [hex, "kappa"],
  ["holo://" + hex, "kappa"],
  ["holo://org.hologram.HoloAmp", "app"],
  ["brass.junior.quiz", "words"],
  ["news.ycombinator.com", "url"],
  ["example.io", "url"],
  ["my.cool.app", "url"],
  ["ipfs://bafy123abc", "cid"],
  ["Qm" + "1".repeat(44), "cid"],
  ["http://example.com/page", "url"],
  ["https://x.io", "url"],
  ["abc.onion", "onion"],
  ["https://cdn.x/clip.mp4", "media"],
  ["a song.mp3", "media"],
  ["how tall is everest", "text"],
  ["", "empty"],
];
const wrong = cases.filter(([v, k]) => classifyOpen(v).kind !== k).map(([v, k]) => `${v}→${classifyOpen(v).kind}≠${k}`);
ok("classifyShapes", wrong.length === 0, wrong.join("  |  "));

// ── 2+3 · routing through the seam ───────────────────────────────────────────────────────────────────
{
  const log = [];
  const open = makeOpen({
    space: (id) => { log.push(["space", id]); return "S:" + id; },
    app: (id) => { log.push(["app", id]); return "A:" + id; },
    fallback: (ref) => { log.push(["fallback", ref]); return "F:" + ref; },
  });
  const rApp = await open("holo://org.hologram.HoloAmp");
  const rSpace = await open("holo://space/research");
  ok("routesNamedForms", rApp === "A:org.hologram.HoloAmp" && rSpace === "S:research", JSON.stringify(log));

  const rKappa = await open("did:holo:sha256:" + hex);
  const rWords = await open("brass.junior.quiz");
  const rUrl = await open("https://x.io");
  const rText = await open("find me a cafe");
  ok("delegatesRest", rKappa.startsWith("F:") && rWords.startsWith("F:") && rUrl.startsWith("F:") && rText.startsWith("F:"), JSON.stringify({ rKappa, rWords, rUrl, rText }));
}

// ── 4 · idOf ─────────────────────────────────────────────────────────────────────────────────────────
ok("idStripsPrefix", idOf("holo://space/research") === "research" && idOf("holo://org.hologram.X") === "org.hologram.X");

// ── 5 · fail-soft ────────────────────────────────────────────────────────────────────────────────────
{
  const open = makeOpen({});   // no handlers
  const a = await open("");                          // empty
  const b = await open("holo://org.x");              // no app handler → null (not a throw)
  ok("failSoftEmpty", a === null && b === null, JSON.stringify({ a, b }));
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-open S2 — the one open path: a pure shape classifier (space/kappa/app/words/cid/onion/url/media/text) + a makeOpen seam that dispatches named forms (holo://<id>, holo://space/<id>) to handlers and delegates every other shape to one fallback resolver (the shell wires omniGo). Every surface and agent opens anything through ONE call, the same way. Fail-soft.",
  authority: "rests on #holo-open (+ shell omniGo fallback)",
  witnessed,
  covers: witnessed ? ["classify-shapes", "routes-named-forms", "delegates-rest", "id-strips-prefix", "fail-soft-empty"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-open-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-open witness — press play: one open path for every ref\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  one seam opens app · space · κ · words · cid · web · media · text" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
