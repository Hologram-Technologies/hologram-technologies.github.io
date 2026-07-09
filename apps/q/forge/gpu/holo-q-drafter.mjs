// holo-q-drafter.mjs — build a speculative DRAFTER fn(seq,max)=>ids for Q's engine.setDrafter, from the
// retargeted TinySeed (seed_9b.onnx, qwen3.5-9b vocab 248320). Runs on onnxruntime-web (WebGPU/WASM).
//
// General seam drafter: conditions on the RUNNING committed sequence (last max_len tokens) and greedy-
// rolls out up to `max` proposed ids. The target then batch-verifies (specDecode), so output stays
// byte-identical to greedy. Register with:  engine.setDrafter(await createQDrafter({onnxUrl,jsonUrl})).
//
// NOTE: this drafter is trained for the qwen3.5-9b vocab. It only produces a real speedup on an engine
// whose specDecode batch-verifies THAT model. Q's 9B thinking brain runs on the resident qwen35 engine,
// which has no batch-verify yet — wiring a live 9B speedup needs that kernel (see HOLO-Q-FASTER-PROMPT.md).
const ORT_CDN = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.webgpu.bundle.min.mjs";
const argmax = (a, off, n) => { let m = -Infinity, k = 0; for (let i = 0; i < n; i++) { const v = a[off + i]; if (v > m) { m = v; k = i; } } return k; };

export async function createQDrafter({ onnxUrl, jsonUrl, ort = null, ortUrl = ORT_CDN } = {}) {
  const O = ort || (await import(/* @vite-ignore */ ortUrl));
  const cfg = await (await fetch(jsonUrl)).json();
  const ML = cfg.max_len || 256, V = cfg.vocab;
  const sess = await O.InferenceSession.create(onnxUrl, { executionProviders: ["webgpu", "wasm"] });
  async function draft(seq, max) {
    let ids = seq.slice(-ML); const out = [];
    for (let i = 0; i < max; i++) {
      const T = ids.length;
      const t = new O.Tensor("int64", BigInt64Array.from(ids.map((x) => BigInt(x))), [1, T]);
      const r = await sess.run({ ids: t });
      const logits = (r.logits || r[Object.keys(r)[0]]).data;
      const nx = argmax(logits, (T - 1) * V, V);
      out.push(nx); ids.push(nx); if (ids.length > ML) ids = ids.slice(-ML);
    }
    return out;
  }
  draft.info = () => ({ engine: "q-drafter-onnx", vocab: V, maxLen: ML });
  return draft;
}
export default createQDrafter;
