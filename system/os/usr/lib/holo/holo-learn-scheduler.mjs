// holo-learn-scheduler.mjs — A3: the hands-free "learn while you rest" loop. On IDLE / while charging, IF
// learning isn't paused, the device can take it, and there's NEW up-voted data since last time, it micro-
// finetunes a chunk and SILENTLY swaps in the new per-user adapter κ. Never blocks the UI (idle-scheduled,
// chunked, interruptible). Device-tier gated (full train only on a strong GPU; phone/low-tier skips → it gets
// the synced adapter / grounding-only). 100% local; nothing egresses. Pure core (deps injected) → Node-
// witnessable; the real trainer (A1, whole-transformer LoRA on the GPU) is the injected `train` plug.
const MARK = "holo.learn.trained.v1";

// makeScheduler({ memory, userAdapter, sft, train, deviceTier, isPaused, store }) — run() does ONE pass:
// gate → gather NEW up-voted samples → train → save the adapter κ → advance the watermark. Idempotent + safe.
export function makeScheduler({ memory, userAdapter, sft, train, deviceTier = () => "high", isPaused = () => false, store = null } = {}) {
  const mark = store || {
    get: () => { try { return +(localStorage.getItem(MARK) || 0) || 0; } catch (e) { return 0; } },
    set: (n) => { try { localStorage.setItem(MARK, String(n)); } catch (e) {} },
  };
  let running = false;
  async function run({ tokenize = null, signal = null } = {}) {
    if (running) return { skipped: "already-running" };
    if (isPaused()) return { skipped: "paused" };                                  // user paused learning
    const tier = deviceTier(); if (tier !== "high") return { skipped: "device-tier:" + tier };   // train only on a capable GPU
    const recs = (memory && (memory.all ? memory.all() : (memory.recent ? memory.recent({ n: 500 }) : []))) || [];
    const upvotes = recs.filter((r) => (r["holmem:vote"] || r.vote) === "up").length;
    const last = mark.get();
    if (upvotes <= last) return { skipped: "no-new-data", upvotes, last };          // nothing new since last train
    running = true;
    try {
      const samples = sft(recs, tokenize) || [];
      if (!samples.length) return { skipped: "no-samples" };
      const adapterBytes = await train(samples, { signal });                        // A1 micro-finetune (GPU); injected
      if (signal && signal.aborted) return { skipped: "aborted" };                   // interruptible: never persist a half run
      if (adapterBytes && userAdapter && userAdapter.save) {
        const saved = await userAdapter.save(adapterBytes);                          // swap in the new adapter (encrypted)
        mark.set(upvotes);                                                           // advance watermark only on success
        return { trained: true, samples: samples.length, adapter: saved && saved.kappa, upvotes };
      }
      return { skipped: "no-adapter" };
    } finally { running = false; }
  }
  return { run };
}

// browser: wire IDLE + charging triggers around the live deps + the forge trainer. Fail-soft: if the trainer
// (A1) isn't present yet, run() simply skips (no-op) — the scheduler is live, the GPU training plugs in later.
export function startScheduler() {
  if (typeof window === "undefined" || window.__holoLearnSched) return null; window.__holoLearnSched = true;
  const deviceTier = () => { try { return (window.HoloVoice && window.HoloVoice.brainTier && window.HoloVoice.brainTier()) || (window.__holoGpuTier) || "high"; } catch (e) { return "high"; } };
  const isPaused = () => { try { return !!(window.HoloLearning && window.HoloLearning.isPaused && window.HoloLearning.isPaused()); } catch (e) { return false; } };
  let sched = null, tokenize = null, trainer = null;
  const deps = async () => {
    if (sched) return sched;
    try {
      const loop = await import("/apps/q/forge/holo-lora-train-loop.mjs");          // sftFromMemory + (real) trainer
      tokenize = (typeof window !== "undefined" && window.HoloQTokenize) || ((t) => String(t || "").toLowerCase().match(/[a-z0-9]+/g) || []);
      trainer = (window.HoloMicroFinetune) || (async () => null);                   // A1 plug — null until the GPU trainer lands
      sched = makeScheduler({ memory: window.HoloMemory, userAdapter: window.HoloUserAdapter, sft: loop.sftFromMemory, train: trainer, deviceTier, isPaused });
    } catch (e) { sched = makeScheduler({ memory: window.HoloMemory, userAdapter: window.HoloUserAdapter, sft: () => [], train: async () => null, deviceTier, isPaused }); }
    return sched;
  };
  let charging = true; try { if (navigator.getBattery) navigator.getBattery().then((b) => { charging = b.charging; b.addEventListener("chargingchange", () => { charging = b.charging; }); }); } catch (e) {}
  const tick = async () => { try { if (!charging) return; const s = await deps(); await s.run({ tokenize }); } catch (e) {} };
  const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 60000 }) : setTimeout(fn, 30000));
  const loop = () => { idle(async () => { await tick(); setTimeout(loop, 5 * 60 * 1000); }); };   // re-check every ~5 min at idle
  setTimeout(loop, 30000);                                                          // first pass 30s after boot (idle), never at startup
  return { run: async () => (await deps()).run({ tokenize }) };
}
if (typeof window !== "undefined") { try { startScheduler(); } catch (e) {} }
export default makeScheduler;
