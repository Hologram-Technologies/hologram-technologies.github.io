// holo-scheduler.mjs — the ONE unified scheduler (Law L4: one runtime, no parallel loops). A single
// budgeted tick drives EVERY stream — the render-delta loop AND the LLM token stream (and anything else) —
// by priority, holding a per-tick time budget. Render registers at high priority so it pumps first and
// every tick (the frame rate is protected); the LLM registers lower so it fills the remaining budget
// (steady throughput, never starved). The orb renders WHILE Q generates, under one loop. In the browser a
// requestAnimationFrame / requestIdleCallback drives tick(); here an injected `now` clock makes it
// deterministic. node-, SW- and DOM-safe; no imports.
//
//   makeScheduler({ now, budgetMs })
//     register({ id, priority, pump, kind? }) → unregister()
//        pump: async () → undefined | { done?:bool, idle?:bool }
//          • returns { done:true }  ⇒ the task finished and is removed
//          • returns { idle:true }  ⇒ no work right now (don't busy-spin on it)
//          • otherwise              ⇒ it progressed; more work may remain
//     tick({ budgetMs? }) → { ran:[id…], spent, tasks }    // one budgeted pass; call it per frame
//     tasks() → snapshot

export function makeScheduler({ now = () => Date.now(), budgetMs = 8 } = {}) {
  let tasks = [];
  function sort() { tasks.sort((a, b) => a.priority - b.priority); }   // lower priority value = runs first
  function register(t) {
    const task = { priority: 0, kind: "work", ...t };
    tasks.push(task); sort();
    return () => { tasks = tasks.filter((x) => x !== task); };
  }

  async function tick({ budgetMs: bm = budgetMs } = {}) {
    const start = now(); const ran = []; let progressed = true;
    // rounds: each round offers every task ONE pump in priority order; repeat while the budget holds and
    // at least one task still has work. High-priority tasks are offered first every round (so they pump
    // most often and never miss a tick); lower-priority tasks take the remaining budget.
    while (progressed && (now() - start) < bm) {
      progressed = false;
      for (const t of tasks.slice()) {
        if ((now() - start) >= bm) break;                  // budget spent — defer the rest to the next tick
        const r = await t.pump();
        ran.push(t.id);
        if (r && r.done) { tasks = tasks.filter((x) => x !== t); }
        else if (r && r.idle) { /* no work now — don't count as progress */ }
        else progressed = true;
      }
    }
    return { ran, spent: now() - start, tasks: tasks.length };
  }

  return { register, tick, tasks: () => tasks.slice() };
}

export default { makeScheduler };
