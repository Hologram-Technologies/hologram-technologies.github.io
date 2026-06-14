// holo-jupyter.mjs — MCP handlers for Holo Jupyter (tools DECLARED in apps/jypyter/holospace.json,
// listed by the manifest scan; these supply the effectful HANDLERS via the toolHandlers escape hatch).
//   holo_jupyter_run   — execute Python in the sealed env; returns stdout + a κ PROV-O receipt.
//   holo_research_run  — run an AUTONOMOUS study (adaptive loop to a metric threshold) and seal a
//                        citable κ-DAG research report.
// Both share ONE persistent warm Pyodide session (boot once → sub-10ms warm runs, Python namespace
// persists across calls → an agent's whole tools/call sequence is one stateful, κ-DAG-anchored
// session). Local-host capability; honest no-op where the sealed app / Playwright aren't present.
// Override the kernel path via HOLO_JUPYTER_KERNEL.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function loadHoloJupyter(here) {
  const toolsDir = join(here, "..", "..", "..", "..", "..", "tools");
  const sessionPath = (typeof process !== "undefined" && process.env && process.env.HOLO_JUPYTER_KERNEL) || join(toolsDir, "holo-jupyter-session.mjs");
  const loopPath = join(toolsDir, "holo-research-loop.mjs");
  let SessionClass = null, session = null, researchLoop = null, tried = false, starting = null;

  async function ensure() {
    if (!tried) {
      tried = true;
      if (existsSync(sessionPath)) ({ HoloJupyterSession: SessionClass } = await import(pathToFileURL(sessionPath).href));
      if (existsSync(loopPath)) ({ researchLoop } = await import(pathToFileURL(loopPath).href));
    }
    if (!SessionClass) return false;
    if (!session) { session = new SessionClass(); starting = starting || session.start(); await starting; }
    return true;
  }
  const toInstalls = (v) => Array.isArray(v) ? v : (v ? String(v).split(",").map((s) => s.trim()).filter(Boolean) : []);
  const unavailable = { ok: false, error: "Holo Jupyter kernel unavailable in this deployment (needs the local sealed app + Playwright). Set HOLO_JUPYTER_KERNEL." };

  const holo_jupyter_run = async (args = {}) => {
    const code = args && typeof args.code === "string" ? args.code : "";
    if (!code.trim()) return { ok: false, error: "holo_jupyter_run requires { code: <python source> }" };
    try {
      if (!(await ensure())) return unavailable;
      const r = await session.run(code, toInstalls(args.installs));
      return { ...r, sessionRootKappa: session.sessionRoot().id };
    } catch (e) { return { ok: false, error: "holo_jupyter_run failed: " + ((e && e.message) || String(e)) }; }
  };

  const holo_research_run = async (args = {}) => {
    const step = args && typeof args.step === "string" ? args.step : "";
    if (!step.trim()) return { ok: false, error: "holo_research_run requires { step: <python that sets result = json.dumps(metrics)> }" };
    const metric = String(args.metric || "");
    const threshold = Number(args.threshold);
    const comparator = String(args.comparator || "<");
    const hasStop = metric && Number.isFinite(threshold);
    const cmp = (v) => comparator === ">" ? v > threshold : comparator === "<=" ? v <= threshold
      : comparator === ">=" ? v >= threshold : comparator === "abs<" ? Math.abs(v) < threshold : v < threshold;
    try {
      if (!(await ensure())) return unavailable;
      if (!researchLoop) return { ok: false, error: "research loop module unavailable" };
      const r = await researchLoop({
        goal: String(args.goal || "autonomous study"),
        init: typeof args.init === "string" ? args.init : null,
        step: () => step,
        decide: (m) => ({ stop: !!(hasStop && m && metric in m && cmp(Number(m[metric]))), reason: hasStop ? `${metric} ${comparator} ${threshold}` : "maxSteps" }),
        synthesize: (h) => (h[h.length - 1] && h[h.length - 1].metrics) || { steps: h.length },
        maxSteps: Number.isFinite(args.maxSteps) ? args.maxSteps : 25,
        installs: toInstalls(args.installs),
        session,
      });
      return { ok: true, ...r };
    } catch (e) { return { ok: false, error: "holo_research_run failed: " + ((e && e.message) || String(e)) }; }
  };

  return { toolHandlers: { holo_jupyter_run, holo_research_run } };
}
