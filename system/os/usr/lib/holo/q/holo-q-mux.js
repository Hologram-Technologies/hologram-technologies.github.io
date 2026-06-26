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

// ── the faculty surface (the OS surface) → a discovery spec each ────────────────────────────────────
// `pipeline` is the Hugging Face pipeline_tag the job maps to; `need` the engine capability that runs
// it; `maxParams` the size ceiling that keeps it browser-fast. Two classes share ONE registry + UI:
//   • CORE I/O faculties (pinned:true) — Q's own senses: respond/listen/speak/code. Their specialist is
//     NOT HF-discovered; it is a precompiled, κ-pinned .holo that ships WITH the OS (see PINNED below,
//     sourced from apps/q/forge/.models/holo-ipfs-pins.json). "auto" for these = the OS's own brain.
//   • HELPER tasks (the rest) — each quietly binds the best small specialist the open web offers, by a
//     cheap HF discovery call. "auto" for these = the right tiny mind, else a fall-back to the main brain.
export const TASKS = [
  // ── CORE I/O — Q's senses (pinned κ .holo, precompiled, content-addressed; not HF-discovered) ──
  { id: "respond",        label: "Respond",       job: "Main chat / reasoning", pipeline: "text-generation",  need: "generative", maxParams: "1.5B", pinned: true },
  { id: "listen",         label: "Listen",        job: "Speech → text (ASR)",  pipeline: "automatic-speech-recognition", need: "asr", maxParams: "700M", pinned: true },
  { id: "speak",          label: "Speak",         job: "Text → speech (TTS)",  pipeline: "text-to-speech",    need: "tts",        maxParams: "100M", pinned: true },
  { id: "code",           label: "Code",          job: "Agentic coding",       pipeline: "text-generation",   need: "generative", maxParams: "3B",   pinned: true },
  // ── HELPER tasks — each discovers + binds the best browser-runnable small specialist (or main) ──
  { id: "create",         label: "Create",        job: "Build a holospace",    pipeline: "text-generation",   need: "generative", maxParams: "8B" },
  { id: "ask",            label: "Ask",           job: "Answer about a holospace", pipeline: "text-generation", need: "generative", maxParams: "8B" },
  { id: "vision",         label: "Vision",        job: "Image analysis",       pipeline: "image-to-text",     need: "vlm",        maxParams: "2B" },
  { id: "web-extract",    label: "Web extract",   job: "Page summarization",   pipeline: "summarization",     need: "generative", maxParams: "1B" },
  { id: "compression",    label: "Compression",   job: "Context compaction",   pipeline: "summarization",     need: "generative", maxParams: "1B" },
  { id: "session-search", label: "Session search",job: "Recall queries",       pipeline: "feature-extraction",need: "embedding",  maxParams: "200M" },
  { id: "skills-hub",     label: "Skills hub",    job: "Skill search",         pipeline: "feature-extraction",need: "embedding",  maxParams: "200M" },
  { id: "approval",       label: "Approval",      job: "Smart auto-approve",   pipeline: "text-classification",need: "classifier",maxParams: "200M" },
  { id: "mcp",            label: "MCP",           job: "MCP tool routing",     pipeline: "zero-shot-classification", need: "classifier", maxParams: "500M" },
  { id: "title-gen",      label: "Title gen",     job: "Session titles",       pipeline: "summarization",     need: "generative", maxParams: "500M" },
  { id: "curator",        label: "Curator",       job: "Skill-usage review",   pipeline: "text-classification",need: "classifier",maxParams: "500M" },
  // DETERMINISTIC tasks — routed like any other, but NOT model-discovered: their specialist is a pure
  // encoder (no HF model, no weights, no maxParams). `deterministic:true` makes discovery SKIP them, so
  // they ride the same per-task registry + κ-memo spine without ever pretending to pick a model (honest).
  { id: "import",         label: "Import",        job: "Encode a GitHub repo as a Holo app", deterministic: true },
];

// ── PINNED — the OS's own precompiled κ .holo specialists for the core I/O faculties ────────────────
// Sourced from apps/q/forge/.models/holo-ipfs-pins.json (archiveKappa = the .holo footer = did:holo).
// `instant` is the always-loads core; `upgrade` (optional) is the silent better tier on capable hardware.
// These are NOT discovered — the κ IS the identity (Law L1); the loader resolves path → Release → κ-route
// (IPFS heal) and L5-verifies every block, so no host is trusted. This is "auto = Q's own brain", honestly.
export const PINNED = {
  respond: { faculty: "respond", instant: { id: "qwen2.5-0.5b",      kappa: "41a930c07450623751f84af6a55bbecd54fe608ad6e94adf17f83c712aaf1b91", bytesMB: 491.4 },  upgrade: { id: "qwen2.5-1.5b", kappa: "ea7323369bfeebb344c9d0b6252de485e2b9833784405678f910a16cd7746202", bytesMB: 1117.4 } },
  code:    { faculty: "code",    instant: { id: "qwen-coder-3b",     kappa: "33ca24ae50bf5649b4c431817ebf15924b8aa929ab87868c33abeeeb8f695a17", bytesMB: 2105.0 } },
  listen:  { faculty: "listen",  instant: { id: "moonshine-tiny-int8", kappa: "bbd89df22c86fc54455779be070395cc8dab0c3438cbe85974c9f02d2a291780", bytesMB: 29.5 }, upgrade: { id: "moonshine-tiny-f16", kappa: "ff7e1c8b3c9e360ab062ce96a297e6f2467608c634f2e4b171078180056a72d8", bytesMB: 56.2 } },
  speak:   { faculty: "speak",   instant: { id: "kokoro-82m",        kappa: "a528332cbe262333c3eef76f581add5de8cd2d54b81c7685914353ad016ff1e5", bytesMB: 96.5 } },
};

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
  // deterministic tasks (e.g. import) have NO model to discover — return an honest plan, never an HF call.
  if (task.deterministic) return { task: taskId, specialist: null, deterministic: true, fallback: null, reason: "deterministic task — a pure encoder is bound, no model is discovered" };
  // pinned core I/O faculties (respond/listen/speak/code) — the OS's OWN precompiled κ .holo, never HF-discovered.
  if (task.pinned) {
    const p = PINNED[task.id];
    return { task: taskId, pinned: true, specialist: p ? { ...p.instant, faculty: p.faculty } : null, upgrade: (p && p.upgrade) || null, fallback: null, reason: "pinned faculty — a precompiled, κ-addressed .holo ships with the OS (content-addressed, L5-verified); not HF-discovered" };
  }
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

// resolveModel(taskId) — THE single front door every consumer reads to learn which LLM runs a faculty
// RIGHT NOW. One precedence, everywhere (the "one place to select the active model" — ADR-0084):
//   1. an explicit OVERRIDE  — a provider bound via bindSpecialist (the settings picker / admin choice)
//   2. a PINNED κ .holo      — the OS's own precompiled brain for a core I/O faculty (respond/listen/speak/code)
//   3. the MAIN brain        — helper tasks with no bound specialist fall back to the main model (never blocks)
// Pure + re-derivable: it READS the registry, it does not load. The caller loads the κ / builds the provider.
export function resolveModel(taskId) {
  const task = TASKS.find((t) => t.id === taskId);
  if (!task) throw new Error(`holo-q-mux: unknown task "${taskId}"`);
  const bound = _bound.get(taskId);
  if (bound) return { task: taskId, source: "override", provider: bound, id: bound.id || "specialist" };
  if (task.pinned && PINNED[taskId]) return { task: taskId, source: "pinned", spec: PINNED[taskId], id: PINNED[taskId].instant.id };
  if (task.deterministic) return { task: taskId, source: "deterministic", id: "encoder" };
  return { task: taskId, source: "main", main: true, id: "main" };
}
export function boundSpecialists() { return [..._bound.entries()].map(([task, p]) => ({ task, provider: p.id || "specialist" })); }
export function unbindAll() { _bound.clear(); }

// describeMux() — the seam's honest state: what it routes, how it selects, what is proven vs pending.
export function describeMux() {
  return {
    tasks: TASKS.map((t) => ({ id: t.id, job: t.job, pipeline: t.pipeline, need: t.need, maxParams: t.maxParams, pinned: !!t.pinned, deterministic: !!t.deterministic })),
    pinned: Object.fromEntries(Object.entries(PINNED).map(([k, v]) => [k, { faculty: v.faculty, instant: v.instant.id, upgrade: v.upgrade ? v.upgrade.id : null, kappa: v.instant.kappa }])),
    discovery: "Hugging Face Hub API (one cheap call per HELPER task, serverless — a browser fetch); core I/O faculties are κ-pinned (precompiled .holo, not discovered)",
    selection: "pure deterministic ranking over metadata; no candidate downloaded to be judged",
    execution: "chosen specialist streams as a content-addressed κ-disk (ADR-0052), bound per-task",
    fallback: "no browser-runnable specialist (or no WebGPU) → the main model; never blocks, never fakes (Law L5)",
    receipt: "decode-agnostic — each task output seals the SAME re-derivable InferenceReceipt, conscience-gated (ADR-0033/0083)",
    bound: boundSpecialists(),
  };
}

export default {
  TASKS, PINNED, BROWSER_LIBS, runnable, paramsEstimate, maxParamsToNum, scoreCandidate, rankCandidates,
  discoverURL, discover, pickSpecialist, autoAssign, bindSpecialist, routeTask, resolveModel, boundSpecialists, unbindAll, describeMux,
};
