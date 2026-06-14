#!/usr/bin/env node
// holo-research-loop.mjs — an AUTONOMOUS research loop over the warm, κ-DAG-anchored Holo Jupyter
// kernel. A goal + a step-generator + a result-driven decision function run on the persistent
// session: propose code → run (warm, ms) → observe → decide whether to continue → repeat. Every
// step is a κ-linked PROV-O receipt; on convergence the loop SEALS a single citable research
// artifact (a κ object linking the goal, the ordered step chain, and the synthesized conclusion —
// Law L5 reproducible: re-running the deterministic plan re-derives the same κ).
//
// The autonomy here is ALGORITHMIC (data-driven stopping) so it runs 100% offline with no model.
// The same harness is pluggable: an LLM agent can supply step()/decide() (or just call the
// holo_jupyter_run MCP tool in its own loop) for open-ended hypothesis-driven research.
//
//   import { researchLoop } from "./holo-research-loop.mjs";
//   const r = await researchLoop({ goal, init, step, decide, synthesize, session });
//
// Demo:  node tools/holo-research-loop.mjs --demo
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const { HoloJupyterSession } = await import(pathToFileURL(join(here, "holo-jupyter-session.mjs")).href);
const OSPRIM = process.env.HOLO_OS_PRIM || "C:/Users/pavel/Desktop/hologram-os/os";

// researchLoop({ goal, init, step, decide, synthesize, maxSteps, session, log })
//   init(): code run once to set up the experiment (optional)
//   step(ctx): → python code for the next experiment; the code sets `result = <json string of metrics>`
//   decide(metrics, history): → { stop: bool, reason?: string, ctx?: nextCtx }  (data-driven control)
//   synthesize(history): → a conclusion object
export async function researchLoop({ goal, init, step, decide, synthesize, maxSteps = 25, session, installs = [], log = () => {} } = {}) {
  const { makeObject } = await import(pathToFileURL(join(OSPRIM, "holo-object.mjs")));
  const own = !session;
  session = session || new HoloJupyterSession();
  await session.start();
  const history = [];
  let stopReason = "maxSteps";
  try {
    if (init) await session.run(init, installs);
    let ctx = {};
    for (let i = 0; i < maxSteps; i++) {
      const code = step(ctx);
      const r = await session.run(code, installs);
      if (!r.ok) { stopReason = "error: " + (r.error || "").split("\n").slice(-2)[0]; history.push({ ...r, metrics: null }); break; }
      let metrics = null; try { metrics = JSON.parse(r.result); } catch {}
      const rec = { step: i, metrics, stdout: r.stdout.trim(), receiptKappa: r.receiptKappa, prevReceipt: r.prevReceipt };
      history.push(rec);
      log(rec);
      const d = decide(metrics, history) || {};
      if (d.stop) { stopReason = d.reason || "converged"; break; }
      ctx = d.ctx || ctx;
    }
  } finally { if (own) await session.close(); }

  const conclusion = synthesize ? synthesize(history) : { steps: history.length };
  // seal the citable research artifact: goal ⊕ ordered step chain ⊕ conclusion → one κ (Law L5)
  const report = makeObject(new Map(), {
    type: ["prov:Bundle", "schema:Dataset", "schema:ScholarlyArticle"],
    context: [{ prov: "http://www.w3.org/ns/prov#" }],
    "schema:name": "Holo autonomous research report",
    "schema:about": goal,
    "schema:resultsOf": "holo-research-loop",
    steps: history.length,
    stopReason,
    chain: history.map((h) => h.receiptKappa).filter(Boolean),
    "schema:conclusion": conclusion,
  });
  return { goal, steps: history, stopReason, conclusion, reportKappa: report.id, sessionRootKappa: session.sessionRoot().id };
}

// ─── Demo: an autonomous agent estimates π by Monte-Carlo, ADAPTIVELY sampling more until the
// statistical standard error falls below a target — then seals the finding. Genuinely autonomous:
// the loop decides each next step from the data, and decides when it is done. 100% offline.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes("--demo")) {
  const TOL = 0.001;
  const ms = () => Number(process.hrtime.bigint() / 1000000n);
  const t0 = ms();
  const r = await researchLoop({
    goal: "Estimate π by Monte-Carlo integration to a standard error below " + TOL + ", sampling adaptively.",
    init: "import numpy as np, math, json\nrng = np.random.default_rng(0)\nhits = 0\ntotal = 0",
    step: () => [
      "m = 250_000",
      "p = rng.random((m, 2))",
      "hits += int((p[:,0]**2 + p[:,1]**2 <= 1.0).sum())",
      "total += m",
      "phat = hits / total",
      "est = 4.0 * phat",
      "stderr = 4.0 * math.sqrt(phat * (1 - phat) / total)",
      "print(f'n={total:>9,} est={est:.5f} err={abs(est-math.pi):.5f} stderr={stderr:.5f}')",
      "result = json.dumps({'n': total, 'est': est, 'err': abs(est-math.pi), 'stderr': stderr})",
    ].join("\n"),
    decide: (m) => ({ stop: m && m.stderr < TOL, reason: `stderr ${m ? m.stderr.toFixed(5) : "?"} < ${TOL}` }),
    synthesize: (h) => { const last = h[h.length - 1]?.metrics || {}; return { estimate: last.est, abs_error_vs_math_pi: last.err, samples: last.n, standard_error: last.stderr }; },
    maxSteps: 40,
    log: (rec) => console.log(`  step ${String(rec.step).padStart(2)} | ${rec.stdout} | receipt ${rec.receiptKappa.slice(15, 29)}…`),
  });
  console.log(`\nautonomous run finished in ${ms() - t0} ms · stop: ${r.stopReason}`);
  console.log("conclusion:", JSON.stringify(r.conclusion));
  console.log("steps (κ-DAG length):", r.steps.length);
  console.log("sealed research report κ:", r.reportKappa);
  console.log("session root κ:", r.sessionRootKappa);
}
