#!/usr/bin/env node
// holo-memory-witness.mjs — proves S2 of the Q-unification: Q's PERSISTENT USER MODEL. The audit found Q
// forgets you every reload (ctx session-only, no persistence). This proves a durable, content-addressed memory
// that SURVIVES reload, LEARNS your preferences from your votes, stays PRIVATE-FIRST, and that YOU can forget
// anything — the "it knows me" layer, witnessed.
//
// Checks (all must hold):
//   1 persistsAcrossReload      — remember in one instance, a FRESH instance over the same store recovers it (the headline).
//   2 recordsReDerive           — each remembered record is a self-verifying UOR object (Law L5); a tampered one fails.
//   3 feedbackAggregates        — 👍/👎 are counted from the persisted feedback records.
//   4 affinityLearnsFromVotes   — upvoting a topic gives POSITIVE affinity for similar text; downvoting NEGATIVE; unrelated ~0.
//   5 boundedCapTrimsOldest     — beyond the cap, the oldest records are trimmed (memory never grows unbounded).
//   6 userCanForget             — forget() deletes (by kind / before a time) and persists the smaller model.
//   7 privateFirstEgressGated   — export() is default-deny AND conscience-gated (memory never phones home).
//   8 summaryIsHonest           — summary() reflects the actual counts (intents · artifacts · votes).
//
// Authority (external): W3C PROV-O · W3C DID Core (did:holo) · IETF RFC 8785 (JCS) · UOR-ADDR (κ = H(content)) ·
// holospaces Laws L1 (private-first) / L5 (verify by re-derivation).   node tools/holo-memory-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeMemory, verify } from "../os/usr/lib/holo/holo-memory.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
// a durable backend simulated by a shared array — a "reload" is a NEW makeMemory over the SAME backing store.
const makeBackend = () => { let saved = null; return { load: async () => saved, save: async (r) => { saved = JSON.parse(JSON.stringify(r)); }, peek: () => saved }; };
let T = 0; const clock = () => "2026-06-19T00:00:" + String(T++).padStart(2, "0") + "Z";

// ── 1 · PERSISTS ACROSS RELOAD: the headline — a fresh instance over the same store recovers the memory ──
{
  const backend = makeBackend();
  const a = makeMemory({ backend, now: clock });
  await a.remember({ kind: "intent", text: "build a pricing page" });
  await a.remember({ kind: "feedback", text: "build a pricing page", vote: "up" });
  const reloaded = makeMemory({ backend, now: clock });   // simulate reload
  await reloaded.ready();
  const rec = reloaded.recent({ n: 5 });
  ok("persistsAcrossReload", rec.length === 2 && rec.some((r) => r["holmem:text"] === "build a pricing page") && reloaded.feedback().up === 1);
}

// ── 2 · each record RE-DERIVES (Law L5); a tampered record fails ───────────────────────────────────────
{
  const m = makeMemory({ now: clock });
  const rec = await m.remember({ kind: "intent", text: "make a dark theme" });
  const tampered = { ...rec, "holmem:text": "make a LIGHT theme" };
  ok("recordsReDerive", verify(rec) === true && verify(tampered) === false);
}

// ── 3 · feedback aggregates from the persisted records ─────────────────────────────────────────────────
{
  const m = makeMemory({ now: clock });
  await m.remember({ kind: "feedback", text: "a", vote: "up" });
  await m.remember({ kind: "feedback", text: "b", vote: "up" });
  await m.remember({ kind: "feedback", text: "c", vote: "down" });
  const fb = m.feedback();
  ok("feedbackAggregates", fb.up === 2 && fb.down === 1);
}

// ── 4 · AFFINITY learns from votes: similar-to-upvoted ⇒ +, similar-to-downvoted ⇒ −, unrelated ⇒ ~0 ────
{
  const m = makeMemory({ now: clock });
  await m.remember({ kind: "feedback", text: "minimal dark dashboard", vote: "up" });
  await m.remember({ kind: "feedback", text: "loud neon arcade theme", vote: "down" });
  const liked = m.affinity("a minimal dark layout");
  const disliked = m.affinity("a loud neon theme");
  const unrelated = m.affinity("quarterly tax spreadsheet");
  ok("affinityLearnsFromVotes", liked > 0.2 && disliked < -0.2 && Math.abs(unrelated) < 0.2, `liked=${liked} disliked=${disliked} unrelated=${unrelated}`);
}

// ── 5 · BOUNDED: beyond the cap, the oldest are trimmed ────────────────────────────────────────────────
{
  const m = makeMemory({ now: clock, cap: 5 });
  for (let i = 0; i < 12; i++) await m.remember({ kind: "intent", text: "intent-" + i });
  const all = m.recent({ n: 100 });
  ok("boundedCapTrimsOldest", all.length === 5 && all[0]["holmem:text"] === "intent-11" && !all.some((r) => r["holmem:text"] === "intent-0"));
}

// ── 6 · the USER can forget — delete persists the smaller model ────────────────────────────────────────
{
  const backend = makeBackend();
  const m = makeMemory({ backend, now: clock });
  await m.remember({ kind: "intent", text: "keep me" });
  await m.remember({ kind: "feedback", text: "forget me", vote: "down" });
  const deleted = await m.forget({ kind: "feedback" });
  const reloaded = makeMemory({ backend, now: clock }); await reloaded.ready();
  ok("userCanForget", deleted === 1 && reloaded.feedback().up === 0 && reloaded.feedback().down === 0 && reloaded.recent({ n: 9 }).length === 1);
}

// ── 7 · PRIVATE-FIRST: export is default-deny and conscience-gated ─────────────────────────────────────
{
  const m = makeMemory({ now: clock });
  await m.remember({ kind: "intent", text: "private thing" });
  const noConsent = m.export("https://peer.example/mem");
  const gated = makeMemory({ now: clock, conscience: { evaluate: () => ({ outcome: "block", reason: "policy" }) } });
  await gated.remember({ kind: "intent", text: "x" });
  const blocked = gated.export("https://peer.example/mem", { consent: true });
  ok("privateFirstEgressGated", noConsent.ok === false && /local-only/.test(noConsent.reason) && blocked.ok === false && /conscience/.test(blocked.reason));
}

// ── 8 · summary is honest ──────────────────────────────────────────────────────────────────────────────
{
  const m = makeMemory({ now: clock });
  await m.remember({ kind: "intent", text: "i1" });
  await m.remember({ kind: "artifact", text: "a todo app" });
  await m.remember({ kind: "feedback", text: "i1", vote: "up" });
  const s = m.summary();
  ok("summaryIsHonest", s.intents === 1 && s.artifacts === 1 && s.votes === 1 && s.total === 3);
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "Holo Memory (S2, Q's persistent user model) — a durable, content-addressed memory of the user's world that SURVIVES reload, learns preference affinity from votes, stays private-first (export default-deny + conscience-gated), is bounded, and is forgettable on request; each record is a self-verifying UOR object (Law L5)",
  authority: "W3C PROV-O · W3C DID Core (did:holo) · IETF RFC 8785 (JCS) · UOR-ADDR · holospaces Laws L1/L5",
  witnessed,
  covers: witnessed ? ["persistent-user-model", "survives-reload", "content-addressed-records", "affinity-learning", "bounded", "forgettable", "private-first"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-memory-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Memory witness — S2 Q's persistent user model (it remembers you)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  Q remembers you across reloads — yours, verifiable, forgettable" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
