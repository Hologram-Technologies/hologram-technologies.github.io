// holo-q-diffusion.js — the DIFFUSION brain seam for Holo Q: a masked-diffusion LM (Dream-org's
// Dream-7B, a Qwen2.5-7B backbone) bound behind the SAME HoloQVAC.useBrain() contract as the
// autoregressive engine. No new façade, no new receipt shape — a second decode FAMILY under the one
// inference transform (ADR-0083, beside ADR-0052's greedy AR).
//
// WHY this slots in cleanly: Holo Q's receipt proves an answer because decode is a deterministic
// transform over content-addressed inputs (κ(prompt ⊕ model ⊕ params ⊕ engine) → κ(output)).
// Autoregression fixes one token per sequential forward pass. Diffusion finalizes a whole block by
// iterative bidirectional UNMASKING over a fixed step schedule. Validated: at temperature 0 the
// confidence-ranked schedule re-derives BLOCK-for-block — two runs of Dream-7B (int4, CPU) produced
// a byte-identical output κ. So diffusion does not break the receipt model; it generalizes it, and
// arguably cleaner: the forward-pass count is fixed by `steps`, not by the output length.
//
// THE FACTORING (the honest part): the DETERMINISTIC control plane — the timestep schedule, the
// confidence-ranked unmask selection, greedy token choice — is pure JS and lives HERE, re-derivable
// in Node and the browser. The only heavy, device-specific piece is the per-step FORWARD (the 7B
// matmul), delegated to an injected `kernel`. Until a WebGPU masked-diffusion kernel is bound, the
// provider REPORTS that it is pending — it never fakes tokens (Law L5 voice, mirroring holo-qvac.js
// unprovisioned() and the dormant useHoloQ() seam). DOM-free, dependency-free; sealing is the
// caller's job (the façade's HoloObject), exactly like holo-q-ai.js.

// the model descriptor (mirrors HoloQVACSpec.MODELS' Dream entry — kept here so the seam is
// self-describing without importing the spec).
export const DREAM_MODEL = {
  id: "DREAM_V0_INSTRUCT_7B", label: "Dream v0 Instruct 7B (diffusion)",
  modelType: "llm", decode: "diffusion", params: "7B", format: "holo-q4",
  backbone: "qwen2.5-7b", maskTokenId: 151666, eosTokenId: 151643, provisioned: false,
  source: "Dream-org/Dream-v0-Instruct-7B (Apache-2.0)",
};

// default decode params — the values validated against the reference (Dream's generation_utils
// entropy path at temperature 0). `steps` is the denoising-iteration count; `eps` the schedule floor.
export const DEFAULTS = { steps: 256, eps: 1e-3, alg: "entropy", temperature: 0, maxTokens: 256 };

// ── the deterministic schedule (pure) ─────────────────────────────────────────────────────────────
// timesteps = linspace(1, eps, steps+1) — the exact schedule Dream walks (generation_utils _sample).
export function schedule(steps = DEFAULTS.steps, eps = DEFAULTS.eps) {
  const out = new Array(steps + 1);
  for (let i = 0; i <= steps; i++) out[i] = 1 + (eps - 1) * (i / steps);
  return out;
}

// confidence of a position's logits — max softmax prob (the deterministic "entropy" ranking key at
// temperature 0; higher = unmask sooner). Pure; argmax token returned alongside.
function pick(logits) {
  let m = -Infinity, arg = 0;
  for (let v = 0; v < logits.length; v++) if (logits[v] > m) { m = logits[v]; arg = v; }
  let z = 0; for (let v = 0; v < logits.length; v++) z += Math.exp(logits[v] - m);
  return { token: arg, conf: 1 / z };                              // softmax(max)=1/Σexp(l-max)
}

// ── the diffusion decode loop (deterministic control plane; forward delegated to `kernel`) ─────────
// kernel: { logits(tokenIds:number[]) → number[][] }  — per-position vocab logits for the sequence
// (the 7B forward; the only device-specific piece). Returns the finalized token ids for the gen span.
// Greedy + confidence-ranked + fixed schedule ⇒ a pure function of (promptIds, genLen, steps, eps, kernel).
export function* decode({ kernel, promptIds, genLen, steps = DEFAULTS.steps, eps = DEFAULTS.eps,
  maskId = DREAM_MODEL.maskTokenId, signal } = {}) {
  const L = promptIds.length + genLen, ts = schedule(steps, eps);
  const x = promptIds.concat(new Array(genLen).fill(maskId));      // gen span starts fully masked
  const emitted = new Set();
  for (let i = 0; i < steps; i++) {
    if (signal && signal.aborted) return;
    const masked = [];
    for (let p = promptIds.length; p < L; p++) if (x[p] === maskId) masked.push(p);
    if (!masked.length) break;
    const logits = kernel.logits(x);                               // ← the WebGPU forward (injected)
    // how many of the still-masked positions to finalize this step (schedule-driven, deterministic)
    const t = ts[i], s = ts[i + 1];
    const frac = i < steps - 1 ? (1 - s / t) : 1;
    const nTransfer = Math.max(1, Math.round(masked.length * frac));
    // rank masked positions by confidence; finalize the top nTransfer (ties broken by position → pure)
    const scored = masked.map((p) => ({ p, ...pick(logits[p]) }));
    scored.sort((a, b) => (b.conf - a.conf) || (a.p - b.p));
    for (let k = 0; k < nTransfer; k++) { const { p, token } = scored[k]; x[p] = token; }
    // stream positions that have become final, in sequence order, once contiguous from the left
    for (let p = promptIds.length; p < L; p++) {
      if (x[p] === maskId) break;
      if (!emitted.has(p)) { emitted.add(p); yield { pos: p - promptIds.length, token: x[p] }; }
    }
  }
  return x.slice(promptIds.length);
}

// ── the provider — bindable via HoloQVAC.useBrain() ────────────────────────────────────────────────
// createDiffusionProvider(cfg) → { id, generate(history, params) → async-iterable token-text deltas }.
// cfg: { kernel?, tokenizer?, modelId?, steps?, eps?, template? }. tokenizer: { encodeChat(history) →
// number[], decode(ids) → string, maskTokenId?, eosTokenId? }. Without BOTH a kernel and a tokenizer,
// generate() THROWS a structured "pending" error — completion() surfaces it as a completionError, so
// the contract reports honestly and never streams a fabricated answer.
const DEFAULT_TEMPLATE = (history) => history
  .map((m) => (m.role === "system" ? m.content : `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`))
  .join("\n") + "\nAssistant:";

export function createDiffusionProvider(cfg = {}) {
  const { kernel = null, tokenizer = null, modelId = DREAM_MODEL.id,
    steps = DEFAULTS.steps, eps = DEFAULTS.eps, maxTokens = DEFAULTS.maxTokens,
    template = DEFAULT_TEMPLATE } = cfg;

  async function* generate(history = [], params = {}) {
    if (!kernel || !tokenizer || typeof kernel.logits !== "function") {
      throw new Error(
        "Holo Q diffusion brain: the WebGPU masked-diffusion decode kernel is not yet bound " +
        "(ADR-0083) — reporting, not faking (Law L5). The deterministic control loop is ready; " +
        "bind { kernel: { logits(ids) }, tokenizer } to run Dream-7B. Validated: temperature=0 " +
        "diffusion decode re-derives block-for-block (identical output κ).");
    }
    const promptIds = tokenizer.encodeChat ? tokenizer.encodeChat(history)
      : tokenizer.encode(template(history));
    const genLen = params.maxTokens ?? maxTokens;
    const maskId = tokenizer.maskTokenId ?? DREAM_MODEL.maskTokenId;
    let buf = [];
    for (const step of decode({ kernel, promptIds, genLen, steps, eps, maskId, signal: params.signal })) {
      buf[step.pos] = step.token;                                  // positions stream left-contiguous
      const text = tokenizer.decode(buf.filter((t) => t != null));
      yield { replace: text };                                     // diffusion refines a block → replace, not append
    }
  }

  return { id: `holo-diffusion:${modelId}`, generate, decodeFamily: "diffusion", model: DREAM_MODEL };
}

// describeDiffusion() → the seam's honest state + the validated provenance (what is proven vs pending).
export function describeDiffusion() {
  return {
    model: DREAM_MODEL, defaults: DEFAULTS, decodeFamily: "diffusion",
    provisioned: false, kernel: "webgpu-masked-diffusion (pending, ADR-0083)",
    controlPlane: "deterministic (schedule + confidence-ranked unmask + greedy) — re-derivable here",
    validated: {
      where: "Dream-7B int4 (group-64 RTN), CPU reference, holo_dream_q4_stream.py",
      determinism: "temperature=0 → byte-identical output κ across two passes (2a67997cb7b1725d)",
      property: "satisfies κ(prompt ⊕ model ⊕ params ⊕ engine) → κ(output); pass count fixed by steps",
    },
    receipt: "decode-agnostic — completion() seals the SAME PROV-O InferenceReceipt (params commit to the schedule)",
  };
}

// bind the diffusion brain in one call (needs HoloQVAC loaded). Returns the useBrain() result, or a
// structured reason if the façade isn't present — same shape as holo-q-ai.js bindCpuFloor().
export async function bindDiffusionBrain(cfg = {}) {
  const g = (typeof window !== "undefined") ? window : globalThis;
  const Q = g.HoloQVAC;
  if (!Q || typeof Q.useBrain !== "function") return { connected: false, reason: "HoloQVAC.useBrain not loaded" };
  return Q.useBrain(createDiffusionProvider(cfg));
}

export default { DREAM_MODEL, DEFAULTS, schedule, decode, createDiffusionProvider, describeDiffusion, bindDiffusionBrain };
