// holo-prefetcher.mjs — ACTION the fidelity prefetch policy (streamConfig.prefetch), which was computed and
// then dropped. Registers a LOW-priority task on the ONE unified scheduler (Law L4 — no parallel loop) that
// fetches upcoming κ tiles AHEAD of need: a fast link hides latency, a slow link wastes nothing. Aggressiveness
// IS the policy — off → register nothing; lazy → one tile/tick; eager → a small batch/tick. Bounded (only the
// candidates the surface offers), deduped (skip resident tiles via `has`), self-idling (yields the budget when
// the queue drains, so it never starves render/LLM). Pure, dependency-free, node-witnessed. The surface supplies
// `candidates()` (upcoming κs, nearest first) + `fetch(κ)`; `has(κ)` skips what's already cached.

const BATCH = { off: 0, lazy: 1, eager: 4 };

export function makePrefetcher(scheduler, { policy = "lazy", candidates = () => [], fetch: f = null, has = () => false, priority = 50, id = "prefetch" } = {}) {
  const n = Object.prototype.hasOwnProperty.call(BATCH, policy) ? BATCH[policy] : 1;
  if (!n || typeof f !== "function") return { active: false, unregister: () => {} };   // off / no fetch → no task
  let queue = [];
  const unregister = scheduler.register({
    id, priority, kind: "prefetch",
    pump: async () => {
      if (!queue.length) queue = (candidates() || []).filter((k) => !has(k));   // refill from the surface
      if (!queue.length) return { idle: true };                                 // nothing to do — yield the budget
      const batch = queue.splice(0, n);
      await Promise.all(batch.map((k) => Promise.resolve(f(k)).catch(() => {})));
      return queue.length ? undefined : { idle: true };
    },
  });
  return { active: true, unregister };
}

export default { makePrefetcher };
