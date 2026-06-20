#!/usr/bin/env node
// holo-plus-context-witness.mjs — proves A2 of "The + Everywhere": CONTEXT CAPTURE. The "+" captures the LOCAL
// surface — which app you're in, the text already in the box, your current Q turn, the route — and threads it into
// runPlus as `context`, so A3 can rank insights to what you're doing now. Memory/history is OPT-IN, never default.
//
// Checks (all must hold):
//   1 capturesLocalSurface    — { activeApp, route, inputText, inputKind, qConversationId } assembled from a fake surface.
//   2 inputTextFromValueAndCE — captures <input>.value AND [contenteditable].textContent, trimmed + capped.
//   3 qConversationWhenPresent — qConversationId pulled from a Q global when present; null (graceful) when absent.
//   4 localSurfaceOnlyByDefault — context.memory is null and surface==="local" unless memory is explicitly passed (privacy).
//   5 memoryIsOptIn           — passing { memory } enriches the context AND contextTerms; omitting it does not.
//   6 contextThreadsToInvestigator — runPlus({ context }) → the investigator RECEIVES that exact context object.
//   7 contextOnResult         — out.context === the captured context (available to A3 ranking / A6 routing).
//   8 gracefulNoGlobals       — missing app/Q globals → null fields, never throws.
//
// Authority: holospaces Laws L1 (private-first: local surface default, memory opt-in) / L2 · rests on #holo-plus.
//   node tools/holo-plus-context-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { captureContext, contextTerms, defaultAppOf } from "../os/usr/lib/holo/holo-plus-context.mjs";
import { runPlus } from "../os/usr/lib/holo/holo-plus.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const enc = (s) => new TextEncoder().encode(s);

// ── fake surfaces (no real DOM) ─────────────────────────────────────────────────────────────────────
const winWith = (over = {}) => ({ location: { pathname: "/apps/notes/edit" }, ...over });
const inputEl = (value) => ({ tagName: "INPUT", value, getAttribute: () => null });
const ceEl = (text) => ({ tagName: "DIV", isContentEditable: true, textContent: text, getAttribute: (n) => (n === "contenteditable" ? "true" : null) });

// ── 1 · local surface assembled ─────────────────────────────────────────────────────────────────────
const win1 = winWith({ Q: { conversationId: "conv-42" }, HoloApp: { id: "notes" } });
const ctx1 = captureContext({ target: inputEl("quarterly board memo"), win: win1, doc: { title: "Notes" } });
ok("capturesLocalSurface",
  ctx1.activeApp === "notes" && ctx1.route === "/apps/notes/edit" && ctx1.inputText === "quarterly board memo"
  && ctx1.inputKind === "input" && ctx1.qConversationId === "conv-42" && ctx1.surface === "local");

// ── 2 · input text from value AND contenteditable, trimmed + capped ─────────────────────────────────
const fromVal = captureContext({ target: inputEl("   spaced   "), win: winWith(), doc: {} }).inputText;
const fromCE = captureContext({ target: ceEl("rich editor body"), win: winWith(), doc: {} }).inputText;
const capped = captureContext({ target: inputEl("x".repeat(5000)), win: winWith(), doc: {}, maxText: 100 }).inputText;
ok("inputTextFromValueAndCE", fromVal === "spaced" && fromCE === "rich editor body" && capped.length === 100);

// ── 3 · Q conversation when present, null when absent ───────────────────────────────────────────────
const noQ = captureContext({ target: inputEl(""), win: winWith(), doc: {} });
ok("qConversationWhenPresent", ctx1.qConversationId === "conv-42" && noQ.qConversationId === null);

// ── 4 · local surface only by default (privacy) ─────────────────────────────────────────────────────
ok("localSurfaceOnlyByDefault", ctx1.memory === null && ctx1.surface === "local");

// ── 5 · memory is opt-in and enriches ranking terms ─────────────────────────────────────────────────
const ctxMem = captureContext({ target: inputEl("memo"), win: winWith(), doc: {}, memory: "prior deals with Acme and Berlin" });
const termsNoMem = contextTerms(ctx1);
const termsMem = contextTerms(ctxMem);
ok("memoryIsOptIn",
  ctxMem.memory === "prior deals with Acme and Berlin" && termsMem.includes("acme") && termsMem.includes("berlin") && !termsNoMem.includes("deals"));

// ── 6/7 · context threads through runPlus to the investigator + lands on the result ─────────────────
let seenCtx = null;
const probe = (graph, context) => { seenCtx = context; return []; };   // an investigator that captures the context
const passed = { activeApp: "trade", inputText: "is acme a good bet", surface: "local", memory: null };
const out = await runPlus(
  [{ name: "a.txt", bytes: enc("Acme Corp is based in Berlin. Acme Corp raised funds in Berlin.") }],
  { investigators: { probe }, context: passed, title: "ctx test" }
);
ok("contextThreadsToInvestigator", seenCtx === passed && seenCtx.activeApp === "trade");
ok("contextOnResult", out.context === passed);

// ── 8 · graceful with no globals ────────────────────────────────────────────────────────────────────
let threw = false; let ctx8 = null;
try { ctx8 = captureContext({ target: null, win: null, doc: null }); } catch { threw = true; }
ok("gracefulNoGlobals", !threw && ctx8 && ctx8.activeApp === null && ctx8.qConversationId === null && ctx8.inputText === "" && defaultAppOf(null, null) === null);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "The + Everywhere — A2 CONTEXT CAPTURE: the '+' assembles the LOCAL surface (activeApp, route, the input's current text, inputKind, current Q conversation) and threads it into runPlus as `context`, reaching the investigator (so A3 can rank to the now) and landing on the result (for A6 routing). User memory/history is OPT-IN — context.memory stays null and surface stays 'local' by default (Law L1 private-first). Graceful on missing globals, never throws",
  authority: "holospaces Laws L1 (private-first) / L2 · rests on #holo-plus",
  witnessed,
  covers: witnessed ? ["context-capture","local-surface","input-text","q-conversation","memory-opt-in","threads-to-investigator","on-result","graceful"] : [],
  sample: { ctx1, termsMem: contextTerms(ctxMem).slice(0, 8) },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-plus-context-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-plus-context witness — A2 The + (capture the local surface → thread into runPlus)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  captured: app=${ctx1.activeApp} · q=${ctx1.qConversationId} · text="${ctx1.inputText}" · memory=${ctx1.memory} (opt-in)`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  the + knows where and why you dropped — context reaches the investigator, memory stays opt-in" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
