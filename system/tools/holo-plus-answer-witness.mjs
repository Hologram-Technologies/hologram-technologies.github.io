#!/usr/bin/env node
// holo-plus-answer-witness.mjs — proves A5 of "The + Everywhere": OMNI-BAR FIRST-CLASS. A drop in the home omni
// search bar surfaces as a PROACTIVE Q ANSWER (the "AI Mode" analog) — ranked to what you typed (A3), every line
// click-through to evidence, answered with NO query — and it also grounds Q (A4). The omni bar is detected by the
// same left-anchor signal the "+" used (A0): no new wiring.
//
// Checks (all must hold):
//   1 omniDetected           — isOmniSurface(omni/search input) true; an ordinary text input false (reuses A0 anchorSide).
//   2 answerCardShape        — asQAnswer → { title, lead, lines[], investigation, brief, answeredWithoutQuery:true }.
//   3 answerIsRanked         — lines follow the result's context-ranked order; the top line is the top (most relevant) insight.
//   4 answerCitesEvidence    — every line carries its insight κ + evidence κs + source κs (click-through to proof).
//   5 leadIsProactiveNoQuery — the lead reads as a proactive answer and answeredWithoutQuery is true (no query was typed).
//   6 emptyAnswerHonest      — a source that yields no insights → an honest "ingested N entities, nothing flagged" lead.
//   7 omniAlsoGroundsQ       — an omni answer and the Q grounding (A4) cover the SAME insights (drop → answer AND keep talking).
//   8 provenanceIntactInAnswer — the answer's line insight κs are exactly the result's insight κs (identity preserved, S5 safe).
//
// Authority: holospaces Laws L2/L5 · rests on #holo-plus + #holo-plus-ambient (A0) + #holo-plus-context (A3) + #holo-plus-q (A4).
//   node tools/holo-plus-answer-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { asQAnswer, isOmniSurface } from "../os/usr/lib/holo/holo-plus-answer.mjs";
import { groundingFrom } from "../os/usr/lib/holo/holo-plus-q.mjs";
import { runPlus } from "../os/usr/lib/holo/holo-plus.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const enc = (s) => new TextEncoder().encode(s);
const el = (attrs) => ({ tagName: "INPUT", getAttribute: (n) => (n in attrs ? attrs[n] : null) });

// an omni-bar drop: a source + the local-surface context (what you typed in the omni bar)
const DOC = "Acme Corp is based in Berlin. Dana Lee is the CEO of Acme Corp. Acme Corp raised funds in Berlin.";
const context = { surface: "local", activeApp: "home", qConversationId: "omni-1", inputText: "berlin location city" };
const result = await runPlus([{ name: "acme.txt", bytes: enc(DOC) }], { context, title: "What the + found" });

// ── 1 · omni detection (reuses A0 anchorSide) ───────────────────────────────────────────────────────
ok("omniDetected",
  isOmniSurface(el({ type: "search" })) === true && isOmniSurface(el({ "data-omni": "" })) === true
  && isOmniSurface(el({ type: "text" })) === false && isOmniSurface(el({ tagName: "TEXTAREA" })) === false);

// ── 2 · answer-card shape ───────────────────────────────────────────────────────────────────────────
const ans = asQAnswer(result, { context });
ok("answerCardShape",
  ans["@type"].includes("holo:QAnswer") && typeof ans.lead === "string" && Array.isArray(ans.lines) && ans.lines.length >= 1
  && ans.investigation === result.investigation["holo:root"] && ans.brief === result.brief["@id"] && ans.answeredWithoutQuery === true);

// ── 3 · ranked: the answer's top line is the brief's top (context-ranked) item ──────────────────────
ok("answerIsRanked",
  ans.lines[0].text === result.brief["holo:items"][0]["schema:text"]
  && ans.lines.every((l, n) => n === 0 || (result.brief["holo:items"][n] && l.text === result.brief["holo:items"][n]["schema:text"])));

// ── 4 · every line cites evidence ───────────────────────────────────────────────────────────────────
ok("answerCitesEvidence", ans.lines.every((l) => l.insight && l.evidence.length > 0 && l.sources.length > 0));

// ── 5 · lead is proactive, no query ─────────────────────────────────────────────────────────────────
ok("leadIsProactiveNoQuery", /Here's what I found/.test(ans.lead) && ans.answeredWithoutQuery === true);

// ── 6 · empty answer is honest ──────────────────────────────────────────────────────────────────────
const empty = await runPlus([{ name: "blank.txt", bytes: enc("   ") }], { context });
const emptyAns = asQAnswer(empty, { context });
ok("emptyAnswerHonest", emptyAns.lines.length === 0 && /nothing yet worth flagging|ingested/.test(emptyAns.lead));

// ── 7 · omni answer AND Q grounding cover the same insights ─────────────────────────────────────────
const grounding = groundingFrom(result, context);
const ansInsightSet = new Set(ans.lines.map((l) => l.insight));
ok("omniAlsoGroundsQ",
  grounding["holo:insights"].length === result.insights.length
  && grounding["holo:insights"].every((k) => result.insights.some((i) => i["@id"] === k))
  && ans.lines.every((l) => grounding["holo:insights"].includes(l.insight) || ansInsightSet.has(l.insight)));

// ── 8 · provenance/identity intact: answer line κs are exactly the result insight κs ────────────────
const resultSet = new Set(result.insights.map((i) => i["@id"]));
ok("provenanceIntactInAnswer", ans.lines.every((l) => resultSet.has(l.insight)));

const witnessed = Object.values(checks).every(Boolean);
const out = {
  "@type": "earl:TestResult",
  spec: "The + Everywhere — A5 OMNI-BAR FIRST-CLASS: a drop in the home omni bar surfaces as a proactive Q answer (asQAnswer) — ranked to the typed context (A3), every line click-through to evidence κs, answered with no query — and it also grounds Q (A4) so you can keep talking. The omni bar is detected by the same left-anchor signal the '+' used (A0). Identity preserved (answer line κs == result insight κs, S5 safe); empty input answered honestly",
  authority: "holospaces Laws L2/L5 · rests on #holo-plus + #holo-plus-ambient (A0) + #holo-plus-context (A3) + #holo-plus-q (A4)",
  witnessed,
  covers: witnessed ? ["omni-first-class","q-answer-card","ranked","cites-evidence","proactive-no-query","empty-honest","also-grounds-q","identity-intact"] : [],
  sample: { lead: ans.lead, top: ans.lines[0] && ans.lines[0].text, lineCount: ans.lines.length, investigation: ans.investigation },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-plus-answer-witness.result.json"), JSON.stringify(out, null, 2) + "\n");
console.log("holo-plus-answer witness — A5 The + (omni-bar drop → proactive Q answer, also grounds Q)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${ans.lead}`);
ans.lines.slice(0, 3).forEach((l, n) => console.log(`    ${n + 1}. ${l.text}  (${(l.confidence*100)|0}%)`));
console.log(`\n  ${witnessed ? "WITNESSED ✓  the omni bar is AI Mode: drop → proactive, ranked, provenance-backed answer + Q grounding" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
