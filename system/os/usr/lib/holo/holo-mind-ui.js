// holo-mind-ui.js — Holo Mind (ADR-0081) SHELL BINDING: the LIVE, GATE-ENFORCED ambient loop, exposed
// OS-wide as window.HoloMind. The shell imports this once (the twin of holo-prov-ui.js); it wires the
// isomorphic core (holo-mind.mjs) to the REAL faculties that already exist in the page, with NO new
// substrate (Law L4):
//   · roster   ← the three doors: window.HoloMCP.descriptor() (MCP, ADR-0047/0049) ⊕ /.well-known/skills/index.json (ADR-0035)
//   · gate     ← window.HoloConscience.evaluate (ADR-033) — fail-closed until the constitution self-verifies
//   · dispatch ← window.HoloMCP.handle (the serverless in-page MCP transport, holo-mcp-browser.js)
//   · plan     ← REAL model planning (holo-mind.mjs modelPlan): the model is given the roster as tools
//                and emits tool calls (Qwen2.5 convention, like Holo Q's core/tools.js), parsed into
//                steps (a verb must ORIGINATE from the roster — Law L4). The model is an injected
//                SAMPLER: Holo Q's QVAC engine registers via window.HoloMind.setSampler; the OS's own
//                ask_model tool is auto-discovered; with no model in context it falls back to one honest
//                deterministic answer/search/resolve step. No autonomous firing: the loop runs only when invoked.
//
// Every action passes the conscience BEFORE dispatch (a blocked step seals + dispatches nothing) and
// seals a self-verifying PROV-O receipt that re-derives (Law L5). The trace corpus AND the learned (evolved)
// skills are DURABLE — write-through to the OS's own κ-store and hydrated at boot — so learning accumulates
// across reloads and tabs, and an in-force revision re-projects into the live roster (ADR-0035). Pure browser ESM.

import { composeRoster, runLoop, modelPlan, markReachable, resolve as resolveObj, MAX_ARM } from "/_shared/holo-mind.mjs";
import { appendTrace, evolve as evolveCore, failures as corpusFailures, projectSkill, walkCorpus } from "/_shared/holo-mind-evolve.mjs";
import { initDrives, tickDrives, proposeGoals as soulProposeGoals, coherence, sealUserModel, sealSelfModel, PRIME_DIRECTIVE } from "/_shared/holo-mind-soul.mjs";
import { sealWorkReceipt, sealScheduledTask, dueTasks, mintDelegation, scopeRoster } from "/_shared/holo-mind-orchestrate.mjs";
import { idbBackend } from "/_shared/holo-store.js";

const store = new Map();          // working κ-store (the core seals synchronously here)
const memo = new Map();           // L3 plan replay across a session
let nextId = 1;
let _sampler = null;              // the borrowed model (Holo Q's QVAC registers via setSampler)
let corpusHead = null;            // Phase 2: the trace corpus head (append-only chain) — now DURABLE
const learnedSkills = new Map();  // Phase 2 writeback: in-force evolved skills (name → descriptor) — DURABLE

// ── DURABLE backing (Law L4: reuse the OS's OWN κ-store — holo-store.js idbBackend over the "holo"/"kappa"
// IndexedDB the shell already opened; no new infrastructure). The working store stays a sync Map (the core
// seals synchronously); every set is WRITE-THROUGH to IndexedDB, and at boot the trace-corpus chain + the
// learned skills are HYDRATED back. So learning accumulates across reloads and tabs — the store is the
// memory (Law L3), durably; identity is the content κ, never where it lives (Law L1).
const ENC = new TextEncoder(), DEC = new TextDecoder();
const HEX = (k) => String(k).split(":").pop();
const META_HEAD = "mind/corpus-head", META_LEARNED = "mind/learned-skills";
const durable = (typeof indexedDB !== "undefined") ? idbBackend({ db: "holo", store: "kappa" }) : null;
const _rawSet = store.set.bind(store);
if (durable) store.set = (k, v) => { _rawSet(k, v); durable.set(k, v).catch(() => {}); return store; };
const persistHead = () => { if (durable) durable.set(META_HEAD, ENC.encode(corpusHead || "")).catch(() => {}); };
const persistLearned = () => { if (durable) durable.set(META_LEARNED, ENC.encode(JSON.stringify([...learnedSkills.values()]))).catch(() => {}); };
const persistMeta = (key, obj) => { if (durable) durable.set(key, ENC.encode(JSON.stringify(obj))).catch(() => {}); };   // objects (JSON)
const persistStr = (key, str) => { if (durable) durable.set(key, ENC.encode(str || "")).catch(() => {}); };           // bare κ pointers

// ── SOUL state (Phase 3) — the drives, the running coherence tally, and the user/self models (durable) ──
let drives = initDrives();
let userHead = null, selfHead = null;           // durable user-model / self-model chain heads
let selfStats = { loops: 0, skillsLearned: 0, revisionsAccepted: 0 };
const seenEffects = new Set();                  // dedup for the coherence (signal/noise) measure (L3)
let _runProse = [];                             // PROSE produced this loop — what the output court actually judges
const META_DRIVES = "mind/drives", META_USER = "mind/user-head", META_SELF = "mind/self-head", META_SELFSTATS = "mind/self-stats";
// ── ORCHESTRATION state (Phase 4) — scheduled tasks (durable) + the in-tab ticker handle ──
const META_SCHED = "mind/scheduled";
const scheduled = new Map();      // taskκ → { kappa, utterance, everyMs, lastFired } — DURABLE
let _schedTimer = null;
const persistScheduled = () => persistMeta(META_SCHED, [...scheduled.values()]);
const META_REVOKED = "mind/revoked";
const revoked = new Set();        // revoked delegation κ (+ their subtrees) — Phase 4 UCAN delegation, DURABLE
const persistRevoked = () => persistMeta(META_REVOKED, [...revoked]);
// extractText — pull human PROSE from a dispatch result (MCP content array · a self-verifying object's text fields).
function extractText(out) {
  if (!out) return "";
  if (typeof out === "string") return out;
  if (Array.isArray(out.content)) return out.content.map((x) => (x && x.text) || "").join("\n").trim();
  return String(out["schema:text"] || out["holo:text"] || "").trim();
}
async function hydrate() {
  if (!durable) return;
  try {
    const hb = await durable.get(META_HEAD);
    if (hb && hb.byteLength) {
      corpusHead = DEC.decode(hb) || null;
      let k = corpusHead; const seen = new Set();
      while (k && !seen.has(k)) {                                       // walk the chain from the persisted head, into the working Map
        seen.add(k); const hex = HEX(k); const b = await durable.get(hex); if (!b) break;
        _rawSet(hex, b instanceof Uint8Array ? b : new Uint8Array(b));  // raw set — do NOT re-persist
        let obj; try { obj = JSON.parse(DEC.decode(store.get(hex))); } catch { break; }
        const link = (obj.links || []).find((l) => l.rel === "prov:wasInformedBy"); k = link ? link.id : null;
      }
    }
    const lb = await durable.get(META_LEARNED);
    if (lb && lb.byteLength) { try { for (const s of JSON.parse(DEC.decode(lb))) if (s && s.name) learnedSkills.set(s.name, s); } catch {} }
    const db = await durable.get(META_DRIVES); if (db && db.byteLength) { try { drives = JSON.parse(DEC.decode(db)); } catch {} }
    const ssb = await durable.get(META_SELFSTATS); if (ssb && ssb.byteLength) { try { selfStats = JSON.parse(DEC.decode(ssb)); } catch {} }
    for (const [meta, set] of [[META_USER, (k) => (userHead = k)], [META_SELF, (k) => (selfHead = k)]]) {
      const mb = await durable.get(meta);
      if (mb && mb.byteLength) { const k = DEC.decode(mb) || null; set(k); if (k) { const b = await durable.get(HEX(k)); if (b) _rawSet(HEX(k), b instanceof Uint8Array ? b : new Uint8Array(b)); } }
    }
    const sc = await durable.get(META_SCHED); if (sc && sc.byteLength) { try { for (const t of JSON.parse(DEC.decode(sc))) if (t && t.kappa) scheduled.set(t.kappa, t); } catch {} }
    const rv = await durable.get(META_REVOKED); if (rv && rv.byteLength) { try { for (const k of JSON.parse(DEC.decode(rv))) revoked.add(k); } catch {} }
  } catch {}
}
const _ready = hydrate();

// ── the three doors → one capped roster ──────────────────────────────────────────────────────────
async function liveRoster() {
  await _ready;
  let mcp = [];
  try {
    const d = (typeof window !== "undefined" && window.HoloMCP) ? window.HoloMCP.descriptor() : null;
    const tools = (d && (d.tools || (d.capabilities && d.capabilities.tools))) || [];
    mcp = tools.map((t) => ({ name: t.name, description: t.description || "" }));
  } catch {}
  let skills = [];
  try {
    const r = await fetch("/.well-known/skills/index.json", { cache: "no-cache" });
    if (r.ok) { const j = await r.json(); skills = (j.skills || []).map((s) => ({ name: s.name, description: s.description || "" })); }
  } catch {}
  // Phase 2 writeback: LEARNED (evolved) skills go FIRST so they WIN the de-dup over the base skill of the
  // same name — the planner now sees the improved skill. That is an evolved skill changing behavior.
  const learned = [...learnedSkills.values()].map((s) => ({ name: s.name, description: s.description }));
  return composeRoster({ mcp, skills: [...learned, ...skills] }, { max: MAX_ARM });
}

// ── the conscience gate (fail-closed if absent) ────────────────────────────────────────────────────
function liveGate(decision) {
  const C = (typeof window !== "undefined") ? window.HoloConscience : null;
  if (!C || typeof C.evaluate !== "function") return { outcome: "block", reason: "conscience gate absent — fail closed" };
  try { return C.evaluate(decision); } catch (e) { return { outcome: "block", reason: "gate error — fail closed: " + (e && e.message) }; }
}

// ── dispatch through the serverless in-page MCP transport; the effect is a re-derivable κ ──────────
async function liveDispatch(step) {
  if (typeof window === "undefined" || !window.HoloMCP) throw new Error("HoloMCP transport absent");
  const req = { jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name: step.verb, arguments: step.args || {} } };
  const r = await window.HoloMCP.handle(req);
  if (r && r.error) throw new Error(r.error.message || "tool error");
  // r.result is (usually) a self-verifying UOR object; if it carries its own κ use it, else seal a wrapper.
  const out = r && r.result;
  const txt = extractText(out); if (txt) _runProse.push(txt);            // capture PROSE for the output court (Phase 3 depth)
  if (out && typeof out.id === "string" && out.id.startsWith("did:holo:")) return out.id;
  const { makeObject } = await import("/_shared/holo-mind.mjs");
  return makeObject(store, { type: ["holo:Effect", "prov:Entity"], "holo:verb": step.verb, "holo:result": out ?? null }).id;
}

// ── the QVAC seam: register a model sampler (Holo Q's engine calls this); ask_model is auto-discovered ──
function setSampler(fn) { _sampler = (typeof fn === "function") ? fn : null; return (typeof window !== "undefined") ? window.HoloMind : null; }
async function discoverSampler(roster) {
  if (_sampler) return _sampler;                                   // explicit registration (Holo Q's QVAC engine)
  if (typeof window !== "undefined" && window.HoloMCP && roster.some((v) => v.name === "ask_model")) {
    return async ({ prompt, maxTokens }) => {                      // the OS's own ask_model tool (MCP sampling)
      const r = await window.HoloMCP.handle({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name: "ask_model", arguments: { prompt, maxTokens } } });
      if (r && r.error) throw new Error(r.error.message);
      const c = r && r.result && r.result.content;
      return Array.isArray(c) ? c.map((x) => x.text || "").join("") : String((r && r.result) || "");
    };
  }
  return null;                                                     // no model in this context → deterministic fallback
}

// ── plan: REAL model planning via the injected sampler; honest deterministic fallback when no model ──
async function livePlan(intent, roster) {
  const sampler = await discoverSampler(roster);
  if (sampler) { try { const steps = await modelPlan(intent, roster, sampler); if (steps.length) return steps; } catch (e) { /* model failed → fall through to deterministic */ } }
  const utter = intent["holo:utterance"] || "";
  const r = roster.find((v) => v.name === "answer") || roster.find((v) => v.name === "search_web");
  if (r) return [{ verb: r.name, args: { query: utter }, decision: {} }];
  const ro = roster.find((v) => v.name === "resolve_object");
  if (ro) return [{ verb: "resolve_object", args: { identifier: utter }, decision: {} }];
  return [];   // nothing armed → nothing to do (honest: the loop refuses to invent a verb, Law L4)
}

// loop(ask) — ask = { utterance, source?, contextKappa?, actor? }. Runs the live, gated loop ONCE, then
// LEARNS: appends this run to the session trace corpus (append-only chain, L3/L5 — Phase 2).
async function loop(ask) {
  await _ready;
  _runProse = [];                                        // reset the prose buffer for this loop
  const roster = await liveRoster();
  const run = await runLoop(typeof ask === "string" ? { utterance: ask } : (ask || {}),
    { store, roster, plan: livePlan, gate: liveGate, dispatch: liveDispatch, memo });
  const outcome = run.receiptIds.length ? "success" : (run.refused.length ? "refused" : "failure");
  const trace = appendTrace(store, corpusHead, { intentKappa: run.intentId, receiptKappa: run.root, outcome });
  corpusHead = trace.id; persistHead();                  // the corpus survives the reload (durable, L3)
  // SOUL (Phase 3): score coherence (richer signal/noise), let the outcome move the drives, judge the output court.
  const coh = coherence({ effectKappa: run.root, seen: seenEffects, receipts: run.receiptIds.length, refused: run.refused.length }); if (run.root) seenEffects.add(run.root);
  drives = tickDrives(drives, { unseen: 1, failures: outcome === "failure" ? 1 : 0, successes: outcome === "success" ? 1 : 0 }); persistMeta(META_DRIVES, drives);
  selfStats = { ...selfStats, loops: selfStats.loops + 1 }; persistMeta(META_SELFSTATS, selfStats);
  let court = null;
  try {
    const C = (typeof window !== "undefined") ? window.HoloConscience : null;
    if (C && typeof C.judgeOutput === "function") {                                  // the model-judged measure of a GOOD action (ADR-033)
      const prose = _runProse.join("\n").trim();                                     // the output court is most meaningful over PROSE
      const sampler = await discoverSampler(roster);
      const judge = (sampler && typeof C.samplerJudge === "function") ? C.samplerJudge(sampler) : null;
      const v = await C.judgeOutput(prose, { judge, flags: { lucida_constitutional_llm: !!judge } });
      court = { outcome: v.outcome, accepts: v.acceptCount, source: v.judged && v.judged.source, judgedProse: prose.length > 0 };
    }
  } catch {}
  return { ...run, traceKappa: trace.id, coherence: coh, court };
}

// evolve — Phase 2 self-evolution: run the optimizer over the session corpus's FAILURES, propose an
// improved skill via the registered model (QVAC, the same sampler that plans), and seal it under the
// GOVERNING gate (tests · size · conscience · operator ratification · cooling-off — ADR-033 rule 4). The
// proposal is a stochastic generation (not reproducible); the sealed revision's provenance + in-force
// fact re-derive (L5). Returns the SkillRevision (inForce only if the caller supplies a passing gate).
async function evolve({ parentKappa = null, parentBytes = "", gate = {} } = {}) {
  await _ready;
  const sampler = await discoverSampler(await liveRoster());
  const rev = await evolveCore(store, { parentKappa, parentBytes, corpusHeadKappa: corpusHead, optimizerKappa: null, sampler, gate });
  // WRITEBACK (ADR-0035): an IN-FORCE revision re-projects to a live skill that wins the roster — DURABLE.
  if (rev) { const skill = projectSkill(rev); if (skill) { learnedSkills.set(skill.name, skill); persistLearned(); selfStats = { ...selfStats, skillsLearned: selfStats.skillsLearned + 1, revisionsAccepted: selfStats.revisionsAccepted + 1 }; persistMeta(META_SELFSTATS, selfStats); } }
  return rev;
}
const failures = () => (corpusHead ? corpusFailures(store, corpusHead) : []);

// ── the soul, live (Phase 3) ───────────────────────────────────────────────────────────────────────
function proposeGoals() { return soulProposeGoals(drives); }
// runProposals — run each drive PROPOSAL through the ordinary GATED loop. A drive never acts directly: it
// raises an intent the conscience gates (self-discipline is structural — no path here skips the gate).
async function runProposals() { await _ready; const out = []; for (const g of soulProposeGoals(drives)) out.push(await loop({ utterance: g.utterance, source: g.source })); return out; }
// updateUser — adapt the PRIVATE-FIRST user model (facts) and record teaching; durable, revisioned, never published.
async function updateUser({ facts = {}, taught = 0 } = {}) { await _ready; const u = sealUserModel(store, { facts, taught, priorKappa: userHead }); userHead = u.id; persistStr(META_USER, userHead); return u; }
// snapshotSelf — seal the persistent self identity (divergence grows with experience), durable + revisioned.
async function snapshotSelf() { await _ready; const s = sealSelfModel(store, { stats: selfStats, priorKappa: selfHead }); selfHead = s.id; persistStr(META_SELF, selfHead); return s; }

// gc — bound the DURABLE corpus (Phase 3 depth): keep the last `keepLast` traces (+ the model/learned roots
// and their forward refs); evict the older prefix from BOTH the working store and IndexedDB (durable.del).
// Append-only INTEGRITY is intact — the kept window re-derives and the chain still commits to the evicted
// prefix's κ; there is just a deliberate "horizon" past which the bytes are gone (L1/L5). Head untouched.
async function gc({ keepLast = 200 } = {}) {
  await _ready;
  if (!corpusHead) return { evicted: 0, kept: 0, window: 0, horizon: null };
  const chain = walkCorpus(store, corpusHead);
  const windowK = chain.slice(0, keepLast).map((t) => t.id);
  const roots = [...windowK, userHead, selfHead, ...[...learnedSkills.values()].map((s) => s.revisionKappa)].filter(Boolean);
  const keep = markReachable(store, roots, { skipRels: ["prov:wasInformedBy", "prov:wasRevisionOf"] });   // don't follow predecessor chains
  let evicted = 0;
  for (const hex of [...store.keys()]) { if (keep.has(hex)) continue; store.delete(hex); if (durable && durable.del) durable.del(hex).catch(() => {}); evicted++; }
  return { evicted, kept: keep.size, window: windowK.length, horizon: chain[keepLast] ? chain[keepLast].id : null };
}

// ── orchestration at scale (Phase 4) ─────────────────────────────────────────────────────────────
// orchestrate — run N sub-agents IN PARALLEL (each an ordinary conscience-gated loop), compose ONE
// self-verifying work receipt over their receipts (ADR-0045 — the root κ proves the whole collaboration),
// and record one corpus trace. Sub-agents share the κ-store (content-addressed → concurrent seals can't
// collide); the corpus head is touched ONCE, after the barrier — no race.
async function orchestrate(intents = [], { actor = "agent" } = {}) {
  await _ready;
  const roster = await liveRoster();
  const subs = await Promise.all((intents || []).map((item) => {
    const ask = (typeof item === "string") ? { utterance: item } : (item || {});
    const delegation = ask.delegationKappa ? resolveObj(store, ask.delegationKappa) : null;
    const subRoster = scopeRoster(roster, delegation, { revoked, store });    // ATTENUATE to the grant; revoked → empty → refuse all (ADR-0042)
    return runLoop(ask, { store, roster: subRoster, plan: livePlan, gate: liveGate, dispatch: liveDispatch, memo })
      .then((run) => ({ run, delegationKappa: ask.delegationKappa || null }));
  }));
  const subRoots = subs.map((s) => s.run && s.run.root).filter(Boolean);
  const delegationKappas = [...new Set(subs.map((s) => s.delegationKappa).filter(Boolean))];   // the authorities each sub acted under
  const ok = subs.some((s) => s.run && s.run.receiptIds.length);
  const work = sealWorkReceipt(store, { subKappas: [...subRoots, ...delegationKappas], actor, outcome: ok ? "success" : "failure" });
  const trace = appendTrace(store, corpusHead, { receiptKappa: work.id, outcome: ok ? "success" : "failure" });
  corpusHead = trace.id; persistHead();
  return { workReceipt: work.id, subAgents: subs.length, subRoots, delegations: delegationKappas.length, traceKappa: trace.id };
}

// delegate — mint a NARROWED, revocable authority for a sub-agent (ADR-0042): a scoped verb set, optionally
// derived from a parent delegation (the attenuation chain). Pass its κ as a sub-intent's `delegationKappa`.
function delegate({ capabilities = [], granter = "self", parentKappa = null } = {}) { return mintDelegation(store, { granter, capabilities, parentKappa }); }
// revoke — invalidate a delegation and its whole SUBTREE; any sub-agent acting under it is refused next run.
function revoke(kappa) { if (!kappa) return false; revoked.add(kappa); persistRevoked(); return true; }

// scheduled tasks — a holo:ScheduledTask is a re-derivable κ-object; the ticker fires DUE ones through the
// gated loop. OPT-IN (never auto-started). Honest scope: in-tab + serverless, so tasks fire only while the tab
// is open (no background server) — the clock is read at the EDGE (Date.now in the ticker), never in the core.
async function schedule({ utterance, everyMs = null } = {}) { await _ready; const t = sealScheduledTask(store, { utterance, everyMs }); scheduled.set(t.id, { kappa: t.id, utterance: String(utterance), everyMs, lastFired: 0 }); persistScheduled(); return t; }
function unschedule(kappa) { const had = scheduled.delete(kappa); if (had) persistScheduled(); return had; }
async function tick(now) {                              // fire due tasks; `now` supplied at the edge (the clock is not in the core)
  const due = dueTasks([...scheduled.values()], now); const fired = [];
  for (const t of due) { t.lastFired = now; persistScheduled(); try { fired.push(await loop({ utterance: t.utterance, source: "self" })); } catch {} }
  return fired;
}
function startScheduler({ intervalMs = 1000 } = {}) { if (_schedTimer || typeof setInterval === "undefined") return false; _schedTimer = setInterval(() => tick(Date.now()), intervalMs); return true; }
function stopScheduler() { if (!_schedTimer) return false; clearInterval(_schedTimer); _schedTimer = null; return true; }

if (typeof window !== "undefined") {
  window.HoloMind = Object.assign(window.HoloMind || {}, {
    loop, roster: liveRoster, store, composeRoster, setSampler, hasSampler: () => !!_sampler,
    evolve, failures, corpusHead: () => corpusHead, gc,                               // Phase 2 + GC: self-evolution + the (durable, bounded) trace corpus
    learned: () => [...learnedSkills.values()], ready: () => _ready,                  // Phase 2 writeback + durable hydration
    drives: () => ({ ...drives }), proposeGoals, runProposals, primeDirective: () => PRIME_DIRECTIVE,   // Phase 3: the soul —
    updateUser, userModel: () => userHead, snapshotSelf, selfModel: () => selfHead, selfStats: () => ({ ...selfStats }),  // drives, models
    orchestrate, schedule, unschedule, scheduledTasks: () => [...scheduled.values()], tick, startScheduler, stopScheduler,  // Phase 4: parallel sub-agents + scheduled tasks
    delegate, revoke, revocations: () => [...revoked],   // Phase 4: UCAN-scoped, revocable sub-agent authority (ADR-0042)
  });
}

export { loop, liveRoster, setSampler, evolve, failures, proposeGoals, runProposals, gc, orchestrate, schedule, delegate, revoke };
