// holo-seed-runner.mjs — run the SEED first-responder from q-seed.holo via onnxruntime-web (browser WASM/WebGPU).
// Opens the file-bundle .holo (κ-verified), creates an ORT session over seed.onnx, and generates the opening clause
// token-by-token using the SHARED qwen tokenizer (from the pack — the seed must share qwen's vocab for the speculative
// handoff). Exposes `respond(history)` as makeSeedHandoff's `seed.respond` (async-iterable of decoded token strings),
// so the seed plugs straight into speak-while-streaming. `ort`/`openFiles`/`tokenizer` injectable → Node-witnessable.
const ORT_CDN = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.webgpu.bundle.min.mjs";
const argmax = (a) => { let m = -Infinity, k = 0; for (let i = 0; i < a.length; i++) if (a[i] > m) { m = a[i]; k = i; } return k; };
// CONTEXT-ALIGNED seeds are trained on qwen's chat-template prompt → the runner must feed the SAME prefix so the seed
// predicts qwen's exact tokens (high speculative accept). The system prompt is fixed (matches gen_tokens_hf.py / training).
const SEED_SYS = "You are Q, a concise, helpful on-device voice assistant. Reply in one short spoken sentence.";
const chatPrompt = (u) => `<|im_start|>system\n${SEED_SYS}<|im_end|>\n<|im_start|>user\n${u}<|im_end|>\n<|im_start|>assistant\n`;

export async function createSeedRunner({ holoUrl, openFiles, tokenizer, ort = null, ortUrl = ORT_CDN, maxNew = 16 } = {}) {
  const O = ort || (await import(/* @vite-ignore */ ortUrl));
  const bundle = await openFiles(holoUrl);                       // openHoloFiles-shaped: getFile(name) (κ-verified)
  const onnx = await bundle.getFile("seed.onnx");
  const cfg = JSON.parse(new TextDecoder().decode(await bundle.getFile("seed.json")));
  const eos = cfg.eos, V = cfg.vocab;
  const sess = await O.InferenceSession.create(onnx, { executionProviders: ["webgpu", "wasm"] });

  // greedy token stream. ids stay in the qwen vocab so the full model can verify/continue the draft (speculative).
  async function* respond(history) {
    const user = (history && history.length ? history[history.length - 1].content : "") || "";
    // ctx seed → feed qwen's chat-template prefix (parseSpecial maps <|im_start|>/<|im_end|> to their ids); else raw.
    let ids = cfg.ctx ? tokenizer.encode(chatPrompt(user), { parseSpecial: true }) : tokenizer.encode(user, { addSpecial: false });
    for (let i = 0; i < maxNew; i++) {
      const T = ids.length;
      const input = new O.Tensor("int64", BigInt64Array.from(ids.map((x) => BigInt(x))), [1, T]);
      const out = await sess.run({ ids: input });
      const logits = (out.logits || out[Object.keys(out)[0]]).data;     // [1,T,V] → last position
      const next = argmax(logits.subarray((T - 1) * V, T * V));
      if (next === eos) break;
      ids.push(next);
      yield tokenizer.decode([next]);
    }
  }
  return { respond, cfg, bytes: onnx.length, info: () => ({ engine: "q-seed-onnx", sizeMB: +(onnx.length / 1e6).toFixed(2), cfg }) };
}

export default createSeedRunner;
