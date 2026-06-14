// holo-q-mux.js — Mixture-of-Specialists for Holo Q: the OS's helper tasks stop defaulting to one
// big model and each quietly binds the BEST small specialist the open web offers, run on-device and
// proven by receipt. The native orchestrator (Holo Mind, ADR-0081) discovers · selects · binds ·
// routes · verifies a per-task model. "auto" stops meaning "use the main model" and starts meaning
// "the right tiny mind for this exact job" (ADR-0084).
//
// THE FACTORING (the honest part): DISCOVERY is one cheap Hugging Face Hub API call per task
// (serverless — a browser fetch, never a server); SELECTION is a PURE ranking over the returned
// metadata (no candidate is downloaded to be judged — that would break "fast" and "serverless"); a
// chosen specialist is a PLAN, not yet a loaded model — loading streams its weights as a
// content-addressed κ-disk (Holo Q, ADR-0052) and BINDS it behind the existing per-task provider
// registry. Until a specialist is bound, routeTask() falls back to the main model — never blocks,
// never fakes (Law L5 voice). DOM-free, dependency-free; sealing/loading is the caller's job, exactly
// like holo-q-ai.js and holo-q-diffusion.js. The ranking + routing are re-derivable (Node witness).

// ── the helper tasks (the OS surface) → a discovery spec each ───────────────────────────────────────
// `pipeline` is the Hugging Face pipeline_tag the job maps to; `need` the engine capability that runs
// it; `maxParams` the size ceiling that keeps it browser-fast. These nine are the helper-task router.
export const TASKS = [
  { id: "vision",         label: "Vision",        job: "Image analysis",       pipeline: "image-to-text",     need: "vlm",        maxParams: "2B" },
  { id: "web-extract",    label: "Web extract",   job: "Page summarization",   pipeline: "summarization",     need: "generative", maxParams: "1B" },
  { id: "compression",    label: "Compression",   job: "Context compaction",   pipeline: "summarization",     need: "generative", maxParams: "1B" },
  { id: "session-search", label: "Session search",job: "Recall queries",       pipeline: "feature-extraction",need: "embedding",  maxParams: "200M" },
  { id: "skills-hub",     label: "Skills hub",    job: "Skill search",         pipeline: "feature-extraction",need: "embedding",  maxParams: "200M" },
  { id: "approval",       label: "Approval",      job: "Smart auto-approve",   pipeline: "text-classification",need: "classifier",maxParams: "200M" },
  { id: "mcp",            label: "MCP",           job: "MCP tool routing",     pipeline: "zero-shot-classification", need: "classifier", maxParams: "500M" },
  { id: "title-gen",      label: "Title gen",     job: "Session titles",       pipeline: "summarization",     need: "generative", maxParams: "500M" },
  { id: "curator",        label: "Curator",       job: "Skill-usage review",   pipeline: "text-classification",need: "classifier",maxParams: "500M" },
];

// markers (in a model's tags/library) that say "this can run IN A TAB" — the hard gate on selection.
export const BROWSER_LIBS = ["onnx", "transformers.js", "transformers.js", "gguf"];
const OPEN_LICENSES = ["apache-2.0", "mit", "bsd", "openrail", "cc-by", "cc0", "llama"];
const HF_API = "https://huggingface.co/api/models";

// ── pure helpers ─────────────────────────────────────────────────────────────────────────────────
const _tags = (m) => [...(m.tags || []), m.library_name, m.pipeline_tag].filter(Boolean).map((s) => String(s).toLowerCase());

// can this model execute in the browser? (an ONNX / transformers.js / GGUF marker present)
export function runnable(m) { const t = _tags(m); return BROWSER_LIBS.some((lib) => t.includes(lib)); }

// estimate parameter count from the id/tags ("0.5b", "135m", "tiny"/"small"/"base") — an ESTIMATE,
// not a weight fetch (keeping selection cheap). Returns a number or null when unknowable.
export function paramsEstimate(m) {
  const s = (m.id || m.modelId || "").toLowerCase() + " " + _tags(m).join(" ");
  let mm = s.match(/(\d+(?:\.\d+)?)\s*b(?:\b|illion|-)/); if (mm) return parseFloat(mm[1]) * 1e9;
  mm = s.match(/(\d+(?:\.\d+)?)\s*m(?:\b|illion|-)/);     if (mm) return parseFloat(mm[1]) * 1e6;
  if (/\btiny\b/.test(s)) return 60e6;
  if (/\bmini\b|\bsmall\b/.test(s)) return 120e6;
  if (/\bbase\b/.test(s)) return 250e6;
  return null;
}
export function maxParamsToNum(cap) {
  const m = String(cap || "").toLowerCase().match(/(\d+(?:\.\d+)?)\s*([bm])/);
  return m ? parseFloat(m[1]) * (m[2] === "b" ? 1e9 : 1e6) : Infinity;
}
const openLicense = (m) => _tags(m).some((t) => OPEN_LICENSES.some((l) => t.includes("license:" + l) || t === l));

// the cheap selection signal — a PURE, deterministic score over metadata only.
export function scoreCandidate(m, task) {
  const dl = Math.log10((m.downloads || 0) + 1);                  // popularity (≈0..7)
  const lk = Math.log10((m.likes || 0) + 1);                      // endorsement (≈0..4)
  const pipeOk = m.pipeline_tag === task.pipeline ? 1 : 0;
  const run = runnable(m) ? 1 : 0;
  const est = paramsEstimate(m), cap = maxParamsToNum(task.maxParams);
  // within the size cap, smaller is better; over the cap is disqualifying; unknown is neutral-ish.
  const sizeFit = est == null ? 0.3 : est <= cap ? 0.5 + (1 - est / cap) * 0.5 : -2;
  const lic = openLicense(m) ? 0.5 : 0;
  return run * 3 + pipeOk * 2 + dl * 0.6 + lk * 0.3 + sizeFit * 1.5 + lic;
}

// rank fetched candidates for a task — PURE (no network). Returns a sorted, annotated list; ties are
// broken by id (so the SAME metadata always yields the SAME pick — re-derivable, Law L5).
export function rankCandidates(models, task) {
  return (models || []).map((m) => ({
    id: m.id || m.modelId, score: +scoreCandidate(m, task).toFixed(4),
    runnable: runnable(m), paramsEstimate: paramsEstimate(m), pipeline: m.pipeline_tag || null,
    downloads: m.downloads || 0, likes: m.likes || 0,
  })).sort((a, b) => (b.score - a.score) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ── discovery (the one serverless call per task) ────────────────────────────────────────────────────
// build the Hugging Face Hub query URL for a task (pure — testable without a network).
export function discoverURL(task, { limit = 20 } = {}) {
  const q = new URLSearchParams({ pipeline_tag: task.pipeline, sort: "downloads", direction: "-1", limit: String(limit) });
  return `${HF_API}?${q.toString()}`;
}
// discover(task) → ranked, browser-RUNNABLE candidates. `fetch` is injectable (Node witness / browser).
export async function discover(task, { fetch = globalThis.fetch, limit = 20 } = {}) {
  const res = await fetch(discoverURL(task, { limit }));
  const models = await res.json();
  return rankCandidates(models, task).filter((c) => c.runnable);
}

// pickSpecialist(taskId) → a PLAN: the top runnable specialist, or an honest fall-back to main when
// none is browser-runnable. Does NOT download or bind — that is an explicit next step (κ-disk load).
export async function pickSpecialist(taskId, opts = {}) {
  const task = TASKS.find((t) => t.id === taskId);
  if (!task) throw new Error(`holo-q-mux: unknown task "${taskId}"`);
  const ranked = await discover(task, opts);
  if (!ranked.length) return { task: taskId, specialist: null, fallback: "main", reason: "no browser-runnable specialist found — using the main model" };
  return { task: taskId, specialist: ranked[0], alternatives: ranked.slice(1, 4), fallback: null };
}

// autoAssign() → the "magic" entry: a per-task PLAN across the whole helper-task surface, one cheap
// call each. Pure orchestration over pickSpecialist; the caller loads + binds the ones it wants.
export async function autoAssign(opts = {}) {
  const out = [];
  for (const t of TASKS) { try { out.push(await pickSpecialist(t.id, opts)); } catch (e) { out.push({ task: t.id, error: String(e && e.message || e) }); } }
  return out;
}

// ── the per-task provider registry — route each helper task to its bound specialist (or main) ────────
// A provider is the same shape useBrain() takes: { id, generate?|complete?|embed?|classify? }. Loading
// the κ-disk and constructing the provider is the caller's job; here we only ROUTE.
const _bound = new Map();
export function bindSpecialist(taskId, provider) {
  if (!TASKS.find((t) => t.id === taskId)) throw new Error(`holo-q-mux: unknown task "${taskId}"`);
  if (!provider) { _bound.delete(taskId); return { task: taskId, provider: null }; }
  _bound.set(taskId, provider);
  return { task: taskId, provider: provider.id || "specialist" };
}
export function routeTask(taskId) { return _bound.get(taskId) || { id: "main", fallback: true }; }
export function boundSpecialists() { return [..._bound.entries()].map(([task, p]) => ({ task, provider: p.id || "specialist" })); }
export function unbindAll() { _bound.clear(); }

// describeMux() — the seam's honest state: what it routes, how it selects, what is proven vs pending.
export function describeMux() {
  return {
    tasks: TASKS.map((t) => ({ id: t.id, job: t.job, pipeline: t.pipeline, need: t.need, maxParams: t.maxParams })),
    discovery: "Hugging Face Hub API (one cheap call per task, serverless — a browser fetch)",
    selection: "pure deterministic ranking over metadata; no candidate downloaded to be judged",
    execution: "chosen specialist streams as a content-addressed κ-disk (ADR-0052), bound per-task",
    fallback: "no browser-runnable specialist (or no WebGPU) → the main model; never blocks, never fakes (Law L5)",
    receipt: "decode-agnostic — each task output seals the SAME re-derivable InferenceReceipt, conscience-gated (ADR-0033/0083)",
    bound: boundSpecialists(),
  };
}

export default {
  TASKS, BROWSER_LIBS, runnable, paramsEstimate, maxParamsToNum, scoreCandidate, rankCandidates,
  discoverURL, discover, pickSpecialist, autoAssign, bindSpecialist, routeTask, boundSpecialists, unbindAll, describeMux,
};
