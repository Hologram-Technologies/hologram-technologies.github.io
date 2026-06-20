// holo-brain-floor.mjs — GUARANTEE A BRAIN (S3 of the Q-unification). The audit found Q's brains are
// bind-or-die: the on-device CPU .holo floor is never bound, the WebGPU brain lives inside the Q app, and the
// mux falls through to a "main" specialist that may not exist — so Q.create/Q.ask can fatally throw
// "no specialist bound for task". This removes that cliff: a deterministic, ZERO-DOWNLOAD floor specialist is
// bound to every core task at boot, so routing ALWAYS resolves to something usable. A real brain (the WebGPU
// engine, a boosted model, an acquired specialist) silently UPGRADES over the floor when present; the floor
// is the safety net underneath, never the ceiling. Q always answers — gracefully degraded, never broken.
//
//   makeBrainFloor(task) → { id, floor:true, generate }   // the never-fails provider for a task (create|ask|…)
//   ensureBrainFloor({ route, bind, tasks, makeFloor }) → { ensured, upgrade, acquireMissing }
//     • fills any task that has no specialist (or the fatal fallback) with its floor — NEVER clobbers a real brain.
//     • upgrade(task, provider) — swap the floor for a real brain (silent upgrade); idempotent.
//     • acquireMissing(task, acquire) — when a task is on the floor, try the GOVERNED self-acquire path to bind
//       a real specialist; if it's refused/unavailable, the floor stays (honest, never throws).
//
// THE FLOOR IS HONEST: it does not fabricate a model answer. For `ask` it says plainly that no language model
// is loaded and what it CAN do; for `create` it emits a minimal, valid scaffold from the prompt (deterministic,
// re-derivable — Law L5). No hallucination, no download, no throw. Pure + dependency-injected (the mux's
// route/bind are passed in): a witness drives a fresh in-memory mux; the browser passes holo-q-mux's real ones.

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// the deterministic floor RESPONSE per task — honest, useful, model-free.
function floorRespond(task, input) {
  const text = typeof input === "string" ? input : (input && (input.prompt || input.text || input.intent)) || "";
  if (task === "create") {
    // a minimal valid holospace scaffold — a real starting point, produced with no model (the template tier).
    return "<!doctype html><meta charset=utf-8><title>" + esc(text).slice(0, 80) +
      "</title><main style=\"font:16px system-ui;max-width:48rem;margin:3rem auto;padding:0 1rem\"><h1>" +
      esc(text) + "</h1><p>Scaffolded by Q — connect a model to build this out.</p></main>";
  }
  // `ask` and everything else: an HONEST floor — no model loaded, so no fabricated answer.
  return "I don't have a language model loaded right now, so I can't answer that fully. " +
    "I can still act on your OS, recall from your own data, or you can connect a model. (You asked: “" + text + "”.)";
}

// makeBrainFloor(task) → a provider with the fabric's shape ({ id, generate(input,opts) → async generator }).
// generate yields ONE final result; it never downloads and never throws. `floor:true` marks it swappable.
export function makeBrainFloor(task = "ask") {
  const id = "floor:" + task;
  async function* generate(input) {
    yield { phase: "final", value: floorRespond(task, input), floor: true };
  }
  return { id, floor: true, task, generate, respond: (input) => floorRespond(task, input) };
}

// ensureBrainFloor — make routing ALWAYS resolve to a usable provider. route(task)→provider; bind(task,prov).
// A task is "uncovered" if route returns nothing, the fatal {fallback:true}, or a provider with no generate.
export function ensureBrainFloor({ route, bind, tasks = ["create", "ask"], makeFloor = makeBrainFloor } = {}) {
  if (typeof route !== "function" || typeof bind !== "function") throw new Error("ensureBrainFloor needs the mux's { route, bind }");
  const uncovered = (t) => { const p = route(t); return !p || p.fallback === true || typeof p.generate !== "function"; };

  const ensured = [];
  for (const t of tasks) if (uncovered(t)) { bind(t, makeFloor(t)); ensured.push(t); }

  // silent upgrade: replace the floor (or fill a gap) with a real brain. Idempotent; a falsy provider is ignored.
  function upgrade(task, provider) {
    if (!provider || typeof provider.generate !== "function") return false;
    bind(task, provider); return true;
  }

  // governed self-acquire: only when the task is on the FLOOR, try acquire() → a real specialist. acquire is the
  // dormant skill-acquisition path (discover → AUTHORIZE → forge → bind); if it returns null (refused/unavailable),
  // the floor stays. Never throws — a missing brain degrades to the floor, it does not break Q.
  async function acquireMissing(task, acquire) {
    const cur = route(task);
    if (!cur || cur.floor !== true) return { task, acquired: false, reason: cur && cur.floor !== true ? "already has a real brain" : "no floor" };
    if (typeof acquire !== "function") return { task, acquired: false, reason: "no acquire path" };
    let prov = null;
    try { prov = await acquire(task); } catch (e) { return { task, acquired: false, reason: "acquire error: " + ((e && e.message) || e) }; }
    if (!prov || typeof prov.generate !== "function") return { task, acquired: false, reason: "acquire returned nothing — floor stays" };
    bind(task, prov);
    return { task, acquired: true, id: prov.id };
  }

  return { ensured, upgrade, acquireMissing, uncovered };
}

// ── browser binding: bind a floor to every core task on holo-q-mux at boot, so Q.create/Q.ask NEVER throw.
// Real specialists (the WebGPU engine, a boost model) upgrade over it where the shell binds them. Law L2.
if (typeof window !== "undefined") {
  const wire = async () => {
    try {
      if (window.__holoBrainFloor) return;
      const mux = (window.Q && window.Q.mux) || window.HoloQMux || null;
      const route = mux && (mux.routeTask || mux.route), bind = mux && (mux.bindSpecialist || mux.bind);
      if (typeof route !== "function" || typeof bind !== "function") return;   // no mux yet; try again on next event
      window.__holoBrainFloor = ensureBrainFloor({ route: (t) => route(t), bind: (t, p) => bind(t, p) });
      if (document.documentElement) document.documentElement.dispatchEvent(new Event("holo-brain-floor-ready"));
    } catch (e) { /* leave unset; Q falls back to its own error path */ }
  };
  if (window.Q) wire();
  else if (document.documentElement) document.documentElement.addEventListener("holo-app-ready", wire, { once: true });
}
