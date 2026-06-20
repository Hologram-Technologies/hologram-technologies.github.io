// holo-q-corebrains.mjs — bind the OS's OWN brains to the canonical CORE faculties (respond = the text
// brain, code = the coder) as lazy, readiness-gated providers, so Create mode and every generative surface
// resolve through holo-q-mux to ONE shared brain per task: the coder once it is loaded, the text model
// until then, a silent upgrade in between. This is the binder half of the active-brain plane (the read
// half is holo-q-active.mjs). Browser-leaning (a brain loads transformers.js / the WebGPU engine on first
// need), but the provider FACTORIES are injected, so the bind → kick → ready → upgrade contract is also
// Node-witnessable with fakes (holo-q-corebrains-witness.mjs). Costs nothing at boot: a brain's heavy
// κ-disk load happens only after kick(), in the background — the shell-perf law (never warm at boot) holds.

import { wireCoreBrains } from "./holo-q-active.mjs";

// lazyBrain(id, make) → a readiness-gated provider { id, faculty, isReady, kick, generate }. `make()`
// returns a streaming sampler — either a function (messages,opts)=>async-iterable<delta>, or an object
// with .generate of that shape — optionally carrying .load(onProgress). The provider is bound EAGERLY
// (so the registry knows the brain exists) but reports isReady()===false until make()+load() resolve, so
// the resolver keeps using the text model meanwhile. dead=true (a load that threw) also stays not-ready,
// so a broken coder degrades to text instead of throwing — honest, never blocks (Law L5).
export function lazyBrain(id, make, { onChange = null, onProgress = null } = {}) {
  let sampler = null, loaded = false, dead = false, loadingP = null;
  // ONE shared load promise: kick() and a concurrent generate() both await the SAME in-flight load, so a
  // build that fires while the κ-disk is still streaming doesn't race past it into an empty stream.
  function ensure() {
    if (loaded || dead) return Promise.resolve();
    if (loadingP) return loadingP;
    loadingP = (async () => {
      try {
        const s = await make();
        if (s && typeof s.load === "function") { try { await s.load(onProgress); } catch (e) {} }
        sampler = (typeof s === "function") ? s : (s && typeof s.generate === "function" ? (m, o) => s.generate(m, o) : null);
        loaded = !!sampler;
        if (!sampler) dead = true;
      } catch (e) { dead = true; }
      finally { if (onChange) { try { onChange(id); } catch (e) {} } }
    })();
    return loadingP;
  }
  return {
    id, faculty: id,
    isReady: () => loaded && !dead,
    isDead: () => dead,
    kick: ensure,
    generate: async function* (messages, opts = {}) {
      if (!loaded && !dead) await ensure();
      if (!sampler) return;                         // load failed → empty stream → the chain/floor takes over
      yield* sampler(messages, opts);
    },
  };
}

// mountCoreBrains(mux, { makeText, makeCode, hasGPU, onChange, onProgress }) — build, bind, and background-
// load the core brains. `makeCode` is offered to the `code` faculty ONLY when hasGPU is true; on a device
// without a usable coder, `code` is left UNBOUND so it resolves THROUGH the fallback chain to the text
// model — i.e. "text model only", exactly as intended. Both brains are kicked immediately so they load in
// the background; until each is ready, its faculty falls back (code → respond → the caller's template).
// Idempotent via a guard on the mux (window-free): pass a fresh mux per call in tests. Returns the providers.
export function mountCoreBrains(mux, { makeText = null, makeCode = null, hasGPU = false, onChange = null, onProgress = null } = {}) {
  const text = makeText ? lazyBrain("respond", makeText, { onChange, onProgress }) : null;
  const code = (hasGPU && makeCode) ? lazyBrain("code", makeCode, { onChange, onProgress }) : null;
  wireCoreBrains(mux, { textBrain: text, codeBrain: code, onChange });
  if (text) text.kick();                            // background-load the text brain → the fallback is ready fast
  if (code) code.kick();                            // and the coder → until ready, `code` resolves to the text brain
  return { text, code };
}

export default { lazyBrain, mountCoreBrains };
