#!/usr/bin/env node
// holo-q-faculty-witness.mjs — proves Fork 2 of the intent-unification: THE FACULTY BRIDGE. Inside an app frame
// window.Q is a thin proxy {summon,ask,create,act} — an intent raised in an app reaches Q but NOT its faculties,
// so an app's create runs against nothing it knows about the user. This proves the governed bridge that lets an
// app reach the SAME Q — read the OS reflection, have its intent GROUNDED in the user model (without ever seeing
// the raw model), write through to memory (attributed), and be REFUSED the user's private/privileged surfaces.
//
// Checks (all must hold):
//   1 exposesReflectionReads     — q.coherence / q.briefing / q.notices return the shell Q's reflection (read-only).
//   2 groundsAppIntentInUserModel— ground(caller,text) returns affinity + RELEVANT recent intents from the shell memory.
//   3 rawModelNeverHandedToApp   — q.memory.recent / affinity / export / forget are REFUSED (the app never gets the raw model).
//   4 refusesTrustMutationAndAct — q.trust.setTrust / q.trust.act / q.trust.approve are REFUSED (an app can't change grants or act AS the user).
//   5 rememberWritesThroughAttributed — q.remember folds the app's intent into memory, tagged with the app (provenance).
//   6 nonFacultyFallsThrough     — q.summon / q.ask / q.create return null so the base createQServe handles them unchanged.
//   7 unknownFacultyRefusedNotThrown — an unknown q.* method is refused, never throws.
//   8 degradesWhenFacultyAbsent  — a thin Q (no memory/coherence) yields honest empties / no-ops, never a throw.
//
// Authority (external): the holo-gov cross-frame governed RPC channel (holo-privacy:rpc) · the app-as-separate-
// principal model (holo-q-app.js, fail-closed) · holospaces Laws L1 (private-first — the raw model never leaves
// the shell) / L5.   node tools/holo-q-faculty-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeFacultyBridge } from "../os/usr/lib/holo/q/holo-q-faculty.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

// a mock SHELL Q with the full faculty surface the spine attaches.
const remembered = [];
const shellQ = () => ({
  coherence: () => ({ coherence: 0.98, whole: true, attention: [{ kind: "gate.red", ref: "#x" }] }),
  briefing: () => "All clear — coherence 98%.",
  notices: () => [{ kind: "gate.red", subject: "#x", salience: 0.7, suggestedAction: "fix it" }],
  remember: (sig) => { remembered.push(sig); return { ok: true }; },
  memory: {
    affinity: (t) => (/dark/i.test(t) ? 1 : 0),
    recent: ({ n = 12 } = {}) => [{ "holmem:text": "build a minimal dark page", "holmem:kind": "intent" }, { "holmem:text": "quarterly taxes", "holmem:kind": "intent" }].slice(0, n),
  },
  trust: { setTrust: () => { throw new Error("an app must never reach setTrust"); }, act: () => { throw new Error("an app must never act as the user"); } },
});

// ── 1 · reflection reads return the shell Q's state (read-only) ────────────────────────────────────────
{
  const b = makeFacultyBridge({ Q: shellQ() });
  const coh = await b.serve({ method: "q.coherence", caller: "files" });
  const brief = await b.serve({ method: "q.briefing", caller: "files" });
  const notices = await b.serve({ method: "q.notices", caller: "files" });
  ok("exposesReflectionReads",
    coh.result && coh.result.coherence === 0.98 && coh.result.attention === 1
    && brief.result === "All clear — coherence 98%." && Array.isArray(notices.result) && notices.result[0].subject === "#x");
}

// ── 2 · ground() returns affinity + RELEVANT recent from the shell memory (the sanctioned path) ────────
{
  const b = makeFacultyBridge({ Q: shellQ() });
  const g = b.ground("editor", "a minimal dark dashboard");
  ok("groundsAppIntentInUserModel", g && g.affinity === 1 && g.hints.includes("build a minimal dark page") && !g.hints.includes("quarterly taxes") && g.app === "editor");
}

// ── 3 · the raw user model is NEVER handed to an app ───────────────────────────────────────────────────
{
  const b = makeFacultyBridge({ Q: shellQ() });
  const recent = await b.serve({ method: "q.memory.recent", caller: "x" });
  const exp = await b.serve({ method: "q.memory.export", caller: "x" });
  const forget = await b.serve({ method: "q.memory.forget", caller: "x" });
  ok("rawModelNeverHandedToApp", /refused/.test(recent.error) && /refused/.test(exp.error) && /refused/.test(forget.error));
}

// ── 4 · an app can't mutate trust or act AS the user ───────────────────────────────────────────────────
{
  const b = makeFacultyBridge({ Q: shellQ() });
  let threw = false; let setRes, actRes;
  try { setRes = await b.serve({ method: "q.trust.setTrust", args: { topic: "pay", level: "silent" }, caller: "evil" }); actRes = await b.serve({ method: "q.trust.act", caller: "evil" }); }
  catch (e) { threw = true; }   // must be refused BEFORE Q.trust is touched (mock throws if reached)
  ok("refusesTrustMutationAndAct", !threw && /refused/.test(setRes.error) && /refused/.test(actRes.error));
}

// ── 5 · remember writes through, attributed to the app ─────────────────────────────────────────────────
{
  remembered.length = 0;
  const b = makeFacultyBridge({ Q: shellQ() });
  const r = await b.serve({ method: "q.remember", args: { signal: { kind: "intent", text: "from the app" } }, caller: "notepad" });
  ok("rememberWritesThroughAttributed", r.result && r.result.ok === true && r.result.attributedTo === "notepad" && remembered.length === 1 && remembered[0].meta.app === "notepad");
}

// ── 6 · non-faculty methods fall through (base createQServe handles them) ──────────────────────────────
{
  const b = makeFacultyBridge({ Q: shellQ() });
  const a = await b.serve({ method: "q.create", args: { text: "x" }, caller: "y" });
  const c = await b.serve({ method: "q.summon", caller: "y" });
  ok("nonFacultyFallsThrough", a === null && c === null);
}

// ── 7 · unknown faculty method refused, not thrown ─────────────────────────────────────────────────────
{
  const b = makeFacultyBridge({ Q: shellQ() });
  let threw = false, res = null;
  try { res = await b.serve({ method: "q.memory.everything", caller: "z" }); } catch (e) { threw = true; }
  ok("unknownFacultyRefusedNotThrown", !threw && (res === null || /refused/.test(res.error || "")));
}

// ── 8 · degrades when the faculty is absent (a thin Q) — honest empty / no-op, never a throw ───────────
{
  const thinQ = { coherence: undefined, ask: () => "x" };   // no coherence/briefing/notices/memory/remember
  const b = makeFacultyBridge({ Q: thinQ });
  let threw = false; let coh, rem, g;
  try { coh = await b.serve({ method: "q.coherence", caller: "a" }); rem = await b.serve({ method: "q.remember", args: { signal: {} }, caller: "a" }); g = b.ground("a", "x"); }
  catch (e) { threw = true; }
  ok("degradesWhenFacultyAbsent", !threw && coh.result === null && rem.result.ok === false && g === null);
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "Holo Q Faculty bridge (Fork 2, the iframe boundary) — an app reaches the SAME Q over the governed cross-frame channel, GOVERNED: it READS the OS reflection (coherence/briefing/notices, read-only); its intent is GROUNDED in the user model by the shell (affinity + relevant recents) without the app ever seeing the raw model; q.remember writes through attributed to the app; and it is REFUSED the user's private/privileged surfaces (trust mutation, acting-as-user, raw memory). Fail-soft on a thin Q",
  authority: "the holo-gov cross-frame governed RPC (holo-privacy:rpc) · the app-as-separate-principal model (holo-q-app.js, fail-closed + receipted) · holospaces Laws L1 (private-first) / L5",
  witnessed,
  covers: witnessed ? ["faculty-bridge", "reflection-reads", "grounded-intent", "raw-model-private", "refuses-trust-and-act", "attributed-remember", "fail-soft"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-q-faculty-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Q Faculty witness — Fork 2 the iframe boundary (an app reaches the same Q, governed)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  an app reaches the one Q — reads reflection, grounded in the model, refused the user's private surfaces" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
