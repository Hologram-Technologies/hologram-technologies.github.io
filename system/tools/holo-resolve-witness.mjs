#!/usr/bin/env node
// holo-resolve-witness.mjs — proves Fork 1 of the intent-unification: ONE FRONT DOOR for intent. Input was
// classified by a different engine per surface (omnibar classify() · voice route() · "+" decideRoute()); this
// proves a single resolver every surface routes through, so intent is decided ONCE wherever expressed — while
// correctly keeping NAVIGATION (a URL / content-address / search) in its own lane so a destination is never
// misread as "build".
//
// Checks (all must hold):
//   1 navigationStaysNavigation  — a URL / κ content-address / onion / bare domain routes to lane 'nav', NOT 'build'.
//   2 languageUsesOneClassifier  — natural-language requests are classified ONCE by Q.intent (build · open · ask).
//   3 everySurfaceConverges      — the SAME text via source voice / type / plus yields an identical {lane,kind,target}.
//   4 dispatchesToHandler        — registered handlers (nav · open · build) run and their result is returned.
//   5 sourceCarriedNotDecisive   — source rides in the result but is absent from the decision (decide() sees only text).
//   6 unhandledReportedNotThrown — a kind with no handler returns handled:false (surface can fall back), never throws.
//   7 deterministic              — same text ⇒ same lane+decision (re-runnable).
//   8 honestFallback             — blank / unclassifiable input resolves to the fallback kind in the intent lane, no throw.
//
// Authority (external): the Q.intent deterministic classifier (holo-q.js, ADR-0091) · holospaces Laws L2 (one
// canonical wire) / L5 (deterministic re-derivation).   node tools/holo-resolve-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeResolver, looksLikeNavigation } from "../os/usr/lib/holo/holo-resolve.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

// the one canonical classifier (faithful to holo-q.js:intent): help/open/close, question→ask, else build.
const qIntent = (text) => {
  const s = String(text || "").trim(), low = s.toLowerCase();
  if (!s) return { kind: "build", target: "" };
  if (/^(?:help|what can (?:you|q) do)\b/.test(low)) return { kind: "help", target: "" };
  let m; if ((m = low.match(/^(?:close|quit|exit)\b\s*(.*)$/))) return { kind: "close", target: m[1].trim() || "this" };
  if ((m = low.match(/^(?:open|launch|go to)\b\s*(.*)$/))) return { kind: "open", target: m[1].trim() };
  if (/\?\s*$/.test(s) || /^(?:what|why|how|who|is|are|does|do|can|explain|describe)\b/i.test(low)) return { kind: "ask", target: s };
  return { kind: "build", target: s };
};

// ── 1 · navigation stays in the nav lane (a destination is never "built") ──────────────────────────────
{
  const r = makeResolver({ intent: qIntent, isNav: looksLikeNavigation });
  const cases = ["https://example.com/x", "example.com", "did:holo:sha256:" + "a".repeat(64), "a".repeat(64), "abcdefghij234567.onion"];
  const allNav = cases.every((c) => { const d = r.decide(c); return d.lane === "nav" && d.kind === "nav"; });
  // and a plain language request that merely contains a dot is NOT hijacked as nav
  const language = r.decide("build a v2.0 dashboard");
  ok("navigationStaysNavigation", allNav && language.lane === "intent" && language.kind === "build");
}

// ── 2 · language is classified ONCE by the one Q.intent ────────────────────────────────────────────────
{
  const r = makeResolver({ intent: qIntent, isNav: looksLikeNavigation });
  const build = r.decide("make a dark pricing page");
  const open = r.decide("open files");
  const ask = r.decide("what is a holospace?");
  ok("languageUsesOneClassifier", build.kind === "build" && open.kind === "open" && open.target === "files" && ask.kind === "ask" && [build, open, ask].every((d) => d.lane === "intent"));
}

// ── 3 · every surface converges: voice / type / plus → identical decision ───────────────────────────────
{
  const r = makeResolver({ intent: qIntent, isNav: looksLikeNavigation });
  const inputs = ["open files", "build a todo app", "example.com", "what is a holospace?"];
  let same = true;
  for (const s of inputs) {
    const v = await r.resolve(s, { source: "voice" }), t = await r.resolve(s, { source: "type" }), p = await r.resolve(s, { source: "plus" });
    if (!(v.lane === t.lane && t.lane === p.lane && v.kind === t.kind && t.kind === p.kind && v.target === t.target && t.target === p.target)) { same = false; break; }
  }
  ok("everySurfaceConverges", same);
}

// ── 4 · dispatches to registered handlers ──────────────────────────────────────────────────────────────
{
  let navTo = null, opened = null, built = null;
  const r = makeResolver({ intent: qIntent, isNav: looksLikeNavigation, handlers: {
    nav: (t) => { navTo = t; return "navigated:" + t; },
    open: (t) => { opened = t; return "opened:" + t; },
    build: (t) => { built = t; return "built:" + t; },
  } });
  const a = await r.resolve("example.com", { source: "type" });
  const b = await r.resolve("open wallet", { source: "voice" });
  const c = await r.resolve("a neon arcade", { source: "plus" });
  ok("dispatchesToHandler", a.result === "navigated:example.com" && navTo === "example.com" && b.result === "opened:wallet" && opened === "wallet" && c.result === "built:a neon arcade" && built === "a neon arcade");
}

// ── 5 · source carried, not decisive ───────────────────────────────────────────────────────────────────
{
  const r = makeResolver({ intent: qIntent, isNav: looksLikeNavigation });
  const d = r.decide("open files");                        // decide() takes only text
  const routed = await r.resolve("open files", { source: "voice" });
  ok("sourceCarriedNotDecisive", !("source" in d) && d.kind === routed.kind && d.target === routed.target && routed.source === "voice");
}

// ── 6 · unhandled kind reported, not thrown ────────────────────────────────────────────────────────────
{
  const r = makeResolver({ intent: qIntent, isNav: looksLikeNavigation });   // no handlers
  let threw = false, res = null;
  try { res = await r.resolve("build a thing", { source: "type" }); } catch (e) { threw = true; }
  ok("unhandledReportedNotThrown", !threw && res.handled === false && res.kind === "build" && res.lane === "intent");
}

// ── 7 · deterministic ──────────────────────────────────────────────────────────────────────────────────
{
  const r = makeResolver({ intent: qIntent, isNav: looksLikeNavigation });
  ok("deterministic", JSON.stringify(r.decide("open files")) === JSON.stringify(r.decide("open files")));
}

// ── 8 · honest fallback on blank ───────────────────────────────────────────────────────────────────────
{
  const r = makeResolver({ intent: () => null, isNav: () => false, fallback: "ask" });
  const d = r.decide("");
  ok("honestFallback", d.lane === "intent" && d.kind === "ask");
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "Holo Resolve (Fork 1, one front door for intent) — a single resolver every surface (omnibar · voice · '+') routes through, layering a navigation lane (URL / content-address / search → destination, never 'built') in front of the ONE Q.intent classifier, so intent is decided ONCE wherever expressed and every surface converges; source is carried but never decisive; unhandled kinds report (never throw) so a surface falls back; deterministic",
  authority: "the Q.intent deterministic classifier (holo-q.js, ADR-0091 unified door) · holospaces Laws L2/L5",
  witnessed,
  covers: witnessed ? ["one-intent-front-door", "navigation-lane", "every-surface-converges", "source-not-decisive", "single-dispatch", "deterministic", "honest-fallback"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-resolve-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Resolve witness — Fork 1 one front door for intent (every surface, one decision)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  one resolver — navigation stays navigation, language decided once, every surface converges" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
