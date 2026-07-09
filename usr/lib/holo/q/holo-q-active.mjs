// holo-q-active.mjs — the ACTIVE-BRAIN resolver: the ONE canonical way for any surface to get the brain
// it should use RIGHT NOW for a generative faculty, with an honest fallback chain and a live identity it
// can show the user. It sits on top of holo-q-mux: routeTask(task) = what is LOADED, resolveModel(task) =
// what is INTENDED. Pure ESM, the mux is injected → Node-witnessed (no DOM, no network, no model load).
//
// Why this exists (the gap the audit found): a core faculty like `code` is PINNED by identity
// (qwen-coder-3b) but only becomes RUNNABLE once its κ-disk is loaded and bound. Until then
// routeTask("code") is the bare { id:"main", fallback:true } sentinel. Surfaces must not block, fake, or
// each pick their own private model: Create mode should use the CODING brain when it is loaded, the TEXT
// brain (`respond`) while it is not, and a deterministic floor if even that is missing — and ALWAYS tell
// the user which one is talking. This module encodes that single rule so every surface obeys it the same.
//
//   resolveActive(mux, task, {chain}) → which brain answers this faculty NOW (+ what to show the user)
//   facultySampler(mux, task, {chain}) → a codegen/voice-shaped sampler that re-resolves PER CALL, so a
//                                        coder loading mid-session silently takes over the next build
//   describeActive(mux, task, {chain}) → a small, honest model-identity label for a badge
//   wireCoreBrains(mux, {textBrain, codeBrain}) → bind the OS's own brains to respond/code as runnable
//                                        providers (lazy; code is offered only on capable hardware, else
//                                        `code` resolves THROUGH the chain to the text model — Law L5)

// the default fallback chain per faculty: prefer the faculty's own brain, then the text brain (`respond`).
// `respond` itself has no further generative fallback (the floor catches it). Override via opts.chain.
const DEFAULT_CHAIN = {
  code:    ["code", "respond"],
  create:  ["create", "respond"],
  ask:     ["ask", "respond"],
  think:   ["think", "respond"],   // 9B deep-reasoning brain → text brain while it loads / on weak hardware
  respond: ["respond"],
};

// a provider is READY unless it explicitly says otherwise. A heavy brain (the κ-disk coder) binds
// eagerly so the registry knows it exists, but reports isReady()===false / ready===false while its
// weights are still streaming — so the resolver treats it as NOT-yet-runnable and the chain falls to the
// text model. The instant it flips ready, the next resolve upgrades to it. (No flag ⇒ ready, back-compat.)
function ready(p) {
  if (!p) return false;
  if (typeof p.isReady === "function") { try { return !!p.isReady(); } catch (e) { return false; } }
  if (p.ready === false) return false;
  return true;
}
const runnable = (p) => !!(p && typeof p.generate === "function") && ready(p);   // usable RIGHT NOW; the main sentinel has no generate
const isFloor  = (p) => !!(p && p.floor === true);                   // a deterministic floor (usable, but degraded — not the ceiling)

// identityOf — the INTENDED model id+source for a faculty (what it WANTS to be), read from the mux's
// single front door. Pinned faculties report their κ-pinned id; everything else its resolved id.
function identityOf(mux, taskId) {
  try {
    const r = mux.resolveModel(taskId);
    return { id: r.source === "pinned" ? r.spec.instant.id : r.id, source: r.source };
  } catch (e) { return { id: "main", source: "main" }; }
}

// resolveActive — walk the fallback chain and return the FIRST faculty whose brain is actually runnable
// right now. A real (non-floor) brain wins; a floor is held as the last resort; if nothing is runnable
// the result says so (the caller then shows its own template floor — never blocks, never fakes).
export function resolveActive(mux, taskId, { chain } = {}) {
  if (!mux || typeof mux.routeTask !== "function" || typeof mux.resolveModel !== "function")
    throw new Error("resolveActive needs the mux ({ routeTask, resolveModel })");
  const order = (chain || DEFAULT_CHAIN[taskId] || [taskId, "respond"]).filter((t, i, a) => a.indexOf(t) === i);
  const requested = identityOf(mux, taskId);            // what the REQUESTED faculty wants (for the badge)
  let floorHit = null;
  for (const t of order) {
    const p = mux.routeTask(t);
    if (runnable(p) && !isFloor(p)) {
      return {
        task: taskId, active: t, provider: p, runnable: true, onFloor: false,
        isFallback: t !== taskId, requested,
        activeId: identityOf(mux, t).id, providerId: p.id || identityOf(mux, t).id,
      };
    }
    if (runnable(p) && isFloor(p) && !floorHit) floorHit = { t, p };
  }
  if (floorHit) {
    return {
      task: taskId, active: floorHit.t, provider: floorHit.p, runnable: true, onFloor: true,
      isFallback: floorHit.t !== taskId, requested,
      activeId: "floor", providerId: floorHit.p.id || "floor",
    };
  }
  return { task: taskId, active: null, provider: null, runnable: false, onFloor: false, isFallback: false, requested, activeId: null, providerId: null };
}

// normalize any provider's generate() yield into a text delta. Three conventions coexist across the
// brain stack — string deltas (voice LLM / GPU brain), { delta } / { text } events, { value } floor —
// so this funnel lets one sampler ride them all without the caller caring which brain answered.
function normalizeDelta(d) {
  if (d == null) return "";
  if (typeof d === "string") return d;
  if (typeof d.delta === "string") return d.delta;
  if (typeof d.text === "string") return d.text;
  if (typeof d.value === "string") return d.value;
  return "";
}

// facultySampler — a sampler in the codegen/voice shape: (messages, opts) → async-iterable of text
// deltas. It RE-RESOLVES the active brain on every call (not once at construction), so the instant a
// heavier/better brain for the faculty finishes loading and binds, the NEXT call streams from it — a
// silent mid-session upgrade with no surface change. When no brain is runnable it yields nothing (an
// empty stream), so the caller's deterministic template floor stands. Never throws on a missing brain.
export function facultySampler(mux, taskId, { chain, onResolve } = {}) {
  async function* sampler(messages, opts = {}) {
    const r = resolveActive(mux, taskId, { chain });
    if (onResolve) { try { onResolve(r); } catch (e) {} }
    if (!r.runnable) return;                                   // no brain yet → empty stream → template floor stands
    for await (const d of r.provider.generate(messages, opts)) {
      if (opts && opts.signal && opts.signal.aborted) break;
      const s = normalizeDelta(d);
      if (s) yield s;
    }
  }
  sampler.active = () => resolveActive(mux, taskId, { chain });
  sampler.available = () => resolveActive(mux, taskId, { chain }).runnable;
  sampler.describe = () => describeActive(mux, taskId, { chain });
  return sampler;
}

// describeActive — the honest "which model am I talking to" label for a badge. `label` is the headline
// (the model the user is effectively talking to / waiting on); `note` explains a fallback/floor/loading
// state in plain words. `loading:true` means a better brain for this faculty is still coming.
export function describeActive(mux, taskId, { chain } = {}) {
  const r = resolveActive(mux, taskId, { chain });
  const wantId = r.requested.id;
  if (r.runnable && !r.isFallback && !r.onFloor)
    return { id: r.activeId, source: identityOf(mux, r.active).source, isFallback: false, onFloor: false, loading: false, label: r.activeId, note: "" };
  if (r.runnable && r.isFallback && !r.onFloor)
    return { id: r.activeId, source: "fallback", isFallback: true, onFloor: false, loading: true, label: r.activeId, note: "text fallback — loading " + wantId + "…" };
  if (r.onFloor)
    return { id: "floor", source: "floor", isFallback: r.isFallback, onFloor: true, loading: true, label: wantId, note: "starting up — loading " + wantId + "…" };
  return { id: wantId, source: r.requested.source, isFallback: false, onFloor: false, loading: true, label: wantId, note: "loading " + wantId + "…" };
}

// asProvider — coerce a brain (a generate function, or a { generate } object) into the per-task provider
// shape the mux registry stores. A bare function becomes { id, faculty, generate }.
function asProvider(faculty, brain) {
  if (typeof brain === "function") return { id: faculty + "-brain", faculty, generate: brain };
  if (brain && typeof brain.generate === "function") return brain.faculty ? brain : { ...brain, faculty };
  return null;
}

// wireCoreBrains — bind the OS's OWN brains to the canonical core faculties so routeTask resolves to a
// REAL provider instead of the main sentinel. The binding is immediate and CHEAP: a brain provider
// lazy-loads its κ-disk only on its first generate(), so this costs nothing at boot (the shell-perf law:
// never warm a model at boot). `respond` (the text brain) binds whenever offered; `code` (the coding
// brain) binds ONLY when a code brain is supplied — the shell supplies it only on capable hardware, so on
// a device without it `code` resolves THROUGH the chain to the text model ("text model only", honestly).
// onChange(faculty) fires after each bind so a live model badge can refresh. Idempotent-ish: re-binding a
// faculty replaces its provider (the silent-upgrade path). Never clobbers a faculty whose brain is null.
export function wireCoreBrains(mux, { textBrain = null, codeBrain = null, thinkBrain = null, onChange = null } = {}) {
  if (!mux || typeof mux.bindSpecialist !== "function") throw new Error("wireCoreBrains needs the mux ({ bindSpecialist })");
  const bound = [];
  const bind = (fac, brain) => {
    const prov = asProvider(fac, brain);
    if (!prov) return;
    mux.bindSpecialist(fac, prov); bound.push(fac);
    if (onChange) { try { onChange(fac); } catch (e) {} }
  };
  bind("respond", textBrain);
  bind("code", codeBrain);
  bind("think", thinkBrain);   // the 9B deep-reasoning brain — offered only on capable hardware (else left unbound → think→respond)
  return { bound };
}

export default { resolveActive, facultySampler, describeActive, wireCoreBrains };
