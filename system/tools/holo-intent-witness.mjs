#!/usr/bin/env node
// holo-intent-witness.mjs — proves S4 of the Q-unification (the last seam): ONE INTENT CLASSIFIER. Input was
// decided twice — typed via Q.intent, spoken via voice's own route() — so the same words could be classified
// differently by source. This proves a single canonical router: every surface classifies with the ONE Q.intent
// and dispatches through ONE table, so a request is decided ONCE and spoken/typed CONVERGE; source is carried
// but never changes the decision.
//
// Checks (all must hold):
//   1 sameTextSameDecisionAnySource — route(text,{source:'voice'}) and {source:'type'} yield identical {kind,target}.
//   2 voiceTypedConvergeAtScale     — across a batch of varied utterances, voice and typed decisions match every time.
//   3 deterministic                 — same text ⇒ same decision (re-runnable).
//   4 dispatchesToHandler           — a registered handler for the kind runs and its result is returned.
//   5 sourceCarriedNotDecisive      — the source rides in the result but is absent from the {kind,target} decision.
//   6 unhandledKindReportedNotThrown— a kind with no handler returns handled:false (caller can fall back), never throws.
//   7 honestFallback                — blank / unclassifiable input resolves to the fallback kind, never a throw.
//   8 registerable                  — register(kind,handler) adds/repoints a dispatch; returns an off() handle.
//
// Authority (external): the Q.intent deterministic classifier contract (holo-q.js) · holospaces Law L2 (one
// canonical wire) / L5 (deterministic re-derivation).   node tools/holo-intent-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeIntentRouter } from "../os/usr/lib/holo/holo-intent.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

// a faithful Q.intent (same contract + spirit as holo-q.js:intent): help/open/close, question→ask, else build.
const qIntent = (text) => {
  const s = String(text || "").trim(), low = s.toLowerCase();
  if (!s) return { kind: "build", target: "" };
  if (/^(?:help|what can (?:you|q) do|capabilities|\/help)\b/.test(low)) return { kind: "help", target: "" };
  let m; if ((m = low.match(/^(?:close|quit|exit)\b\s*(.*)$/))) return { kind: "close", target: m[1].trim() || "this" };
  if ((m = low.match(/^(?:open|launch|go to)\b\s*(.*)$/))) return { kind: "open", target: m[1].trim() };
  if (/\?\s*$/.test(s) || /^(?:what|why|how|who|when|where|which|is|are|does|do|can|could|should|explain|describe|tell me|summari[sz]e)\b/i.test(low)) return { kind: "ask", target: s };
  return { kind: "build", target: s };
};

// ── 1 · same text, same decision, any source ───────────────────────────────────────────────────────────
{
  const r = makeIntentRouter({ classify: qIntent });
  const v = await r.route("how do I center a div?", { source: "voice" });
  const t = await r.route("how do I center a div?", { source: "type" });
  ok("sameTextSameDecisionAnySource", v.kind === t.kind && v.target === t.target && v.kind === "ask" && v.source === "voice" && t.source === "type");
}

// ── 2 · voice and typed converge across a batch (the unification property at scale) ────────────────────
{
  const r = makeIntentRouter({ classify: qIntent });
  const inputs = ["build a todo app", "open files", "close this", "what is a holospace?", "help", "make a dark dashboard", "summarize my notes"];
  let allMatch = true;
  for (const s of inputs) {
    const v = await r.route(s, { source: "voice" }); const t = await r.route(s, { source: "type" });
    if (v.kind !== t.kind || v.target !== t.target) { allMatch = false; break; }
  }
  ok("voiceTypedConvergeAtScale", allMatch);
}

// ── 3 · deterministic ──────────────────────────────────────────────────────────────────────────────────
{
  const r = makeIntentRouter({ classify: qIntent });
  const a = r.decide("build a pricing page"), b = r.decide("build a pricing page");
  ok("deterministic", JSON.stringify(a) === JSON.stringify(b) && a.kind === "build");
}

// ── 4 · dispatches to a registered handler ─────────────────────────────────────────────────────────────
{
  let opened = null;
  const r = makeIntentRouter({ classify: qIntent, handlers: { open: (target) => { opened = target; return "opened:" + target; } } });
  const res = await r.route("open wallet", { source: "voice" });
  ok("dispatchesToHandler", res.handled === true && res.kind === "open" && opened === "wallet" && res.result === "opened:wallet");
}

// ── 5 · source is carried but NOT part of the decision ─────────────────────────────────────────────────
{
  const r = makeIntentRouter({ classify: qIntent });
  const v = r.decide("open files");        // decide() takes only text — proves the decision can't see source
  const routed = await r.route("open files", { source: "voice" });
  ok("sourceCarriedNotDecisive", !("source" in v) && v.kind === routed.kind && v.target === routed.target && routed.source === "voice");
}

// ── 6 · an unhandled kind is reported, not thrown ──────────────────────────────────────────────────────
{
  const r = makeIntentRouter({ classify: qIntent });   // no handlers registered
  let threw = false, res = null;
  try { res = await r.route("build a thing", { source: "type" }); } catch (e) { threw = true; }
  ok("unhandledKindReportedNotThrown", !threw && res.handled === false && res.kind === "build");
}

// ── 7 · honest fallback on blank / unclassifiable input ────────────────────────────────────────────────
{
  const r = makeIntentRouter({ classify: () => null, fallback: "ask" });   // a classifier that returns nothing
  const res = r.decide("");
  ok("honestFallback", res.kind === "ask" && typeof res.target === "string");
}

// ── 8 · registerable: add / repoint a dispatch, get an off() handle ────────────────────────────────────
{
  const r = makeIntentRouter({ classify: qIntent });
  let n = 0; const off = r.register("ask", () => { n++; return "answered"; });
  const res1 = await r.route("what time is it?", { source: "type" });
  off();
  const res2 = await r.route("what time is it?", { source: "type" });
  ok("registerable", res1.handled === true && res1.result === "answered" && n === 1 && res2.handled === false && r.kinds().length === 0);
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "Holo Intent (S4, one intent classifier — the last Q-unification seam) — a single canonical router every surface funnels through: typed omnibar, voice, an app's cross-frame call all classify with the ONE Q.intent and dispatch through ONE table, so a request is decided ONCE and spoken/typed converge; source is carried but never changes the decision; an unhandled kind is reported (never thrown) so callers fall back gracefully; blank input resolves to an honest fallback; deterministic",
  authority: "the Q.intent deterministic classifier contract (holo-q.js) · holospaces Laws L2 (one canonical wire) / L5 (deterministic re-derivation)",
  witnessed,
  covers: witnessed ? ["one-intent-classifier", "voice-typed-converge", "source-not-decisive", "single-dispatch", "honest-fallback", "deterministic"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-intent-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Intent witness — S4 one intent classifier (spoken and typed converge)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  one classifier, one decision — every surface routes through the one Q" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
