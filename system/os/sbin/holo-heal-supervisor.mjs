// holo-heal-supervisor.mjs — the AUTONOMOUS heal loop. This is what makes self-healing need NO user
// action: on boot and on every idle tick, it SCRUBS the OS closure (re-verify each κ-object against its
// content, Law L5; pre-heal the missing/corrupt from the mesh; seed what it heals), appends a verifiable
// PROV-O receipt per repair to an append-only HEAL-LOG, and seals a HEALTH ATTESTATION — a UOR object that
// re-derives — so the OS can PROVE its own health rather than assert it. Invisible when healthy (a tick
// over an intact closure heals nothing and is idempotent); self-evident when it acts (every repair leaves
// a witness). The sealed ANCHOR is never scrubbed (the healer's isAnchor gates it). Origin-agnostic: the
// healer recovers a κ from wherever its bytes live (durable store · peers · IPFS · origin), torrent-style.
//
// VERIFY → REFOCUS → EVOLVE. The first two legs (re-derive every byte; recover the broken one) heal. The
// third LEARNS: the supervisor remembers which κ have needed healing before — folding each sweep's outcome
// into a per-κ history — and reranks the next sweep FLAKY-FIRST, so historically-unstable objects are
// re-verified first and (under a heal-budget) more often, while stable ones are confirmed and left alone.
// The signal is plain integer history (repairs + misses counted from the sweep's own outcomes — the same
// data the heal-log already records), no geometry, no clock: deterministic and re-derivation-safe. The
// learned ranking is inspectable via flakiness() and folded into the attestation, so "the OS adapts" is a
// proven, content-addressed fact, not a claim.
//
// Pure + isomorphic + dependency-injected (no clock, no timer, no scheduler in the core — all injected),
// exactly like holo-heal.mjs / holo-resolver.mjs: the witness drives it in Node with an in-memory store
// and a synthetic closure; the browser drives it with the durable κ-store (holo-kstore) + a requestIdle-
// Callback scheduler + the live source chain. Its imports are the healer it supervises and hexOf (to key
// the learned history by content address).

import { makeHealer } from "./holo-heal.mjs";
import { hexOf } from "./holo-resolver.mjs";

// makeSupervisor(deps) → { tick, start, healLog, last, flakiness }
//   loadClosure    : async () → { path → κ }        the OS-wide closure to keep healthy (e.g. fetch os-closure.json)
//   healer         : a makeHealer() instance         the repair engine (carries sources, store, persist, isAnchor)
//   intact         : (hex) → Promise<boolean>        re-derive the durable local copy (e.g. holo-kstore.kverify != null)
//   budget         : number                          max objects HEALED per tick (flaky-first + budget = flaky more often). ∞ = full sweep.
//   sealAttestation: (info) → object                 mint a re-derivable UOR health attestation — optional, injected
//   now            : () → string                     ISO timestamp (injected; no clock in the core)
//   log            : (msg, info) → void              progress sink (default no-op) — invisible when healthy
//   backoffAfter   : number                          consecutive UNRESOLVED misses before a κ goes on cooldown (default 2)
//   backoffMax     : number                          max cooldown in ticks for a chronically-unreachable κ (default 64)
export function makeSupervisor({ loadClosure, healer, intact = async () => false, budget = Infinity, sealAttestation = null, now = () => "1970-01-01T00:00:00Z", log = () => {}, backoffAfter = 2, backoffMax = 64 } = {}) {
  const healLog = [];   // append-only: the sealed PROV-O receipt of every repair, ever — the OS's repair history
  const memory = new Map();   // hex → { path, visits, repairs, misses, lastRepairTick, lastSeenTick } — the EVOLVE leg's learning
  let _last = null;
  let _ticks = 0;             // integer epoch (no clock): recency for fairness without a wall time

  // kappaHex(k) — pull the content address out of a closure entry's value (string κ or {kappa|did|@id}).
  const kappaHex = (k) => hexOf(typeof k === "string" ? k : (k && (k.kappa || k.did || k["@id"])) || "");

  // remember(path, hex, outcome) — fold one entry's fate into the per-κ history the next sweep ranks by.
  function remember(path, hex, outcome) {
    const m = memory.get(hex) || { path, visits: 0, repairs: 0, misses: 0, lastRepairTick: -1, lastSeenTick: -1 };
    m.path = path; m.visits++; m.lastSeenTick = _ticks;
    if (outcome === "healed") { m.repairs++; m.misses = 0; m.lastRepairTick = _ticks; }   // a successful heal CLEARS the backoff
    else if (outcome === "unresolved") { m.misses++; m.lastRepairTick = _ticks; }
    else if (outcome === "healthy") { m.misses = 0; }                                      // verified intact → no longer missing
    memory.set(hex, m);
  }

  // score(hex) — priority = how often this κ has BROKEN-AND-RECOVERED (repairs). A MISS (currently
  // unreachable) is deliberately NOT escalated: retrying an unresolvable κ harder cannot conjure a source,
  // and escalating it would let it monopolise a small heal-budget and starve the objects that CAN be fixed.
  // Misses are tracked (observability) but never raise rank — staleness (below) rotates unresolved and
  // historyless κ through their fair share instead. Unknown κ score 0 (no history → no priority).
  const score = (hex) => memory.get(hex)?.repairs ?? 0;

  // rank(entries) — order a sweep FLAKY-FIRST: flakiest κ, then the least-recently-seen (fairness, so a
  // budgeted sweep still reaches the tail), then original order (stable). Only integer history — no clock,
  // no randomness — so it is deterministic and re-derivation-safe. With empty memory it is the identity.
  function rank(entries) {
    return entries
      .map((e, i) => ({ e, i, hex: kappaHex(e[1]) }))
      .sort((a, b) => {
        const fb = score(b.hex) - score(a.hex); if (fb) return fb;          // flakier first
        const sa = memory.get(a.hex)?.lastSeenTick ?? -1, sb = memory.get(b.hex)?.lastSeenTick ?? -1;
        if (sa !== sb) return sa - sb;                                      // staler first (fairness)
        return a.i - b.i;                                                   // stable
      })
      .map((x) => x.e);
  }

  // flakiness() → ranked [{ path, hex, repairs, misses, visits }] — the learned history, inspectable so the
  // OS can PROVE it adapts. Only κ that have ever needed attention appear; flakiest first.
  function flakiness() {
    return [...memory.entries()]
      .map(([hex, m]) => ({ hex, path: m.path, repairs: m.repairs, misses: m.misses, visits: m.visits }))
      .filter((m) => m.repairs + m.misses > 0)
      .sort((a, b) => (b.repairs - a.repairs) || (b.misses - a.misses) || a.hex.localeCompare(b.hex));
  }

  // tick(reason) → { summary, attestation, order, flaky, at } — one autonomous pass over the whole closure,
  // swept flaky-first and learning from every outcome (verify → refocus → EVOLVE).
  async function tick(reason = "boot") {
    _ticks++;
    const closure = await loadClosure();
    // BACKOFF (EVOLVE): a κ that keeps coming back UNRESOLVED (no source anywhere has its bytes — an
    // unreachable pin, or an object only the local origin holds) is retried on an EXPONENTIAL cooldown, not
    // every tick. Without this, a couple of unrecoverable κ make the loop hammer the mesh (and flood the
    // console) on every idle pass. Healthy + healable objects are untouched; a cooling κ is still COUNTED
    // (honesty) and swept again once its cooldown elapses, and any success (heal or intact) clears it.
    const all = Array.isArray(closure) ? closure.slice() : Object.entries(closure || {});
    const due = []; let cooling = 0;
    for (const e of all) {
      const m = memory.get(kappaHex(e[1]));
      if (m && m.misses >= backoffAfter) {
        const wait = Math.min(2 ** (m.misses - backoffAfter + 1), backoffMax);   // 2, 4, 8, … ticks, capped
        if (_ticks - m.lastSeenTick < wait) { cooling++; continue; }              // still cooling → skip this pass
      }
      due.push(e);
    }
    const order = [];                                                       // the actual visit order, for proof
    const onVisit = (path, hex, outcome) => { remember(path, hex, outcome); order.push(hex); };
    const summary = await healer.scrub(due, { intact, order: rank, onVisit, budget });
    summary.total = all.length; summary.cooling = cooling;                  // report the FULL closure + what we deferred to a cooldown
    for (const r of summary.receipts) healLog.push(r);                      // accumulate the verifiable repair trail
    const healthyAfter = summary.healthy + summary.healed;                  // intact + just-repaired
    const flaky = flakiness();
    const attestation = sealAttestation ? sealAttestation({
      total: summary.total, healthy: summary.healthy, healed: summary.healed,
      unresolved: summary.unresolved, deferred: summary.deferred || 0, cooling, anchors: summary.anchors, healthyAfter,
      whole: summary.unresolved === 0 && (summary.deferred || 0) === 0 && cooling === 0,   // every reachable non-anchor object swept & healthy
      tracked: memory.size, flaky: flaky.length,                           // the LEARNED signal — the OS knows what keeps breaking
      reason, generatedAtTime: now(),
    }) : null;
    _last = { summary, attestation, order, flaky, at: now() };
    log(summary.healed ? `healed ${summary.healed}` : "healthy", summary);
    return _last;
  }

  // start({ schedule }) — run the loop forever with NO user action. `schedule(fn)` is the injected pump
  // (requestIdleCallback in the browser, setInterval as a fallback); the core never owns a timer. Each
  // tick re-arms the next, so the OS keeps itself whole continuously — quietly, in the background.
  function start({ schedule } = {}) {
    if (typeof schedule !== "function") return () => {};
    let stopped = false;
    const loop = () => { if (stopped) return; tick("idle").catch(() => {}).finally(() => { if (!stopped) schedule(loop); }); };
    schedule(loop);
    return () => { stopped = true; };                                       // returns a stop() handle
  }

  return { tick, start, healLog, last: () => _last, flakiness };
}

// bootSupervisor(cfg) — convenience: build a healer from raw deps AND the supervisor over it, in one call.
// cfg merges makeHealer deps (sources, store, persist, sealReceipt, isAnchor, now) with the supervisor's
// (loadClosure, intact, budget, sealAttestation, now, log). Returns { healer, supervisor }.
export function bootSupervisor(cfg = {}) {
  const healer = makeHealer(cfg);
  const supervisor = makeSupervisor({ ...cfg, healer });
  return { healer, supervisor };
}
