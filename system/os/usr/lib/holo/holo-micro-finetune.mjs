// holo-micro-finetune.mjs — A1 orchestrator: the real `window.HoloMicroFinetune` the learn-scheduler calls.
// It turns the PROVEN whole-transformer LoRA loop (forge gguf-forge-lora-graph: forwardCache → masked-CE →
// full-graph backward → AdamW on every layer's adapters → all-layers κ-checkpoint) into the one async plug
// the scheduler injects as `train`: SFT samples → train the user's LoRA model → sealed adapter κ-bytes, which
// the scheduler persists ENCRYPTED via HoloUserAdapter. Base weights frozen; only adapters move. 100% local;
// nothing egresses. Pure core (deps injected) → Node-witnessable; the browser binding wires the live forge.
//
// SCOPE (honest): this is the on-device training LOOP, end-to-end and tier-gated. Binding it to the FULL
// streamed-by-κ base model at GPU scale (running the linears on the A5 GPU backward kernels instead of the
// f64 reference graph, and emitting the brain's adapter-.holo format) is the remaining GPU integration —
// the loop here is the orchestration that wraps those kernels. `window.__holoTrainModel` is the seam the
// brain sets when a trainable LoRA graph is mounted; null → the scheduler simply skips (fail-soft).

export function makeMicroFinetune({ getModel, train, opts = {} } = {}) {
  return async function microFinetune(samples, { signal = null, steps = null, lr = null } = {}) {
    if (!samples || !samples.length) return null;                                  // nothing up-voted to learn from
    if (typeof train !== "function") return null;
    const M = (typeof getModel === "function") ? await getModel() : getModel;
    if (!M) return null;                                                           // no trainable model mounted → skip
    if (signal && signal.aborted) return null;                                     // interruptible: bail before work
    const run = train(M, samples, { ...opts, ...(steps ? { steps } : {}), ...(lr ? { lr } : {}) });
    const { checkpoint } = run && run.then ? await run : run;                      // train may be sync (f64) or async (GPU)
    if (signal && signal.aborted) return null;                                     // never persist a half/aborted run
    return checkpoint && checkpoint.bytes ? checkpoint.bytes : null;               // → HoloUserAdapter.save (encrypted)
  };
}

// browser: bind the live plug. Lazy-imports the forge graph trainer on first call so the global is set
// synchronously at load (the scheduler reads window.HoloMicroFinetune at its first idle tick).
if (typeof window !== "undefined" && !window.HoloMicroFinetune) {
  let _g = null;
  window.HoloMicroFinetune = async (samples, opts = {}) => {
    if (!_g) { try { _g = await import("/apps/q/forge/gguf-forge-lora-graph.mjs"); } catch (e) { return null; } }
    const mf = makeMicroFinetune({ getModel: () => window.__holoTrainModel || null, train: _g.trainGraphLoRA, opts: { steps: 120, lr: 0.05, warmupSteps: 8 } });
    return mf(samples, opts);
  };
}
export default makeMicroFinetune;
