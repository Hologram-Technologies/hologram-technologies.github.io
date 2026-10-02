// bonsai27-bridge.mjs — the ADAPTER that lets the Bonsai demo app run the 27B hybrid engine
// (holo-bonsai27-gpu.mjs, ring decode head) behind the EXACT surface the app already consumes from its
// 8B path. The app swaps engines with ~10 lines: replace its loadKappaObject→createQvacGPU→createEngine
// block with `const { engine, modelName, rootK } = await loadBridge({ base, onProgress, onStatus });`.
//
// CONTRACT (verbatim from holo-apps/apps/bonsai/index.html, read-only):
//   loadBridge({ base, onProgress(name, bytesDelta), onStatus(text) }) → { engine, modelName, rootK }
//   engine = {
//     tokenize(text) → ids,
//     detokenize(ids) → text,
//     frameTurn(q, hasHistory) → framedText,                         // ChatML, eos 248046
//     generate(ids, { maxNew, signal, onToken }) → Promise<{ outIds, text, stats:{ tokps } }>,
//       onToken({ outIds, text, stats:{ tokps } }) fired per COMMITTED token
//   }
//   plus (convenience / think-split fallback): engine.thinkOpen, engine.thinkClose, engine.eos
//
// Loading mirrors the app's own driver: loadKappaObject gives a κ-verified per-tensor reader (Law L5) whose
// byte-deltas paint the app's progress line; a plain gunzip reader is the dev/loose-object fallback. The raw
// tensor bytes are handed to loadBonsai27Brain verbatim (reshapeTensor is identity for q1/f32), and the
// tokenizer is the SAME qvac path (tokenizer.gguf from the κ-object) the 8B uses.

import { loadBonsai27Brain } from "../q/forge/gpu/holo-bonsai27-gpu.mjs";
import { loadKappaObject } from "../q/holo-load2bit.mjs";

const EOS_IM_END = 248046;   // qwen35 <|im_end|> — the app's stated eos; matches the engine's EOS_DEFAULT[0]

// dev/loose-object fallback reader (no κ-verify) — mirrors loadBonsai27Brain's own built-in dev reader,
// used only when loadKappaObject can't open `base` (e.g. a loose κ dir on a plain static server).
async function plainReader(base) {
  const manifest = await (await fetch(base + "/manifest.json")).json();
  const gunzip = async (u8) => { const ds = new DecompressionStream("gzip"); const w = ds.writable.getWriter(); w.write(u8); w.close(); return new Uint8Array(await new Response(ds.readable).arrayBuffer()); };
  const fetchTensor = async (name) => { const rec = manifest.tensors[name]; const gz = new Uint8Array(await (await fetch(base + "/b/" + String(rec.kappa).replace(":", "_") + ".gz")).arrayBuffer()); return gunzip(gz); };
  return { manifest, fetchTensor, info: manifest };
}

export async function loadBridge({ base, pin = null, onProgress = () => {}, onStatus = () => {} } = {}) {
  if (!base) throw new Error("loadBridge: `base` (κ-object dir) is required");

  // κ-verified reader first (production); fall back to a plain reader for dev/loose objects.
  let r;
  try {
    r = await loadKappaObject(base, { expectKappa: pin || undefined, allowUnpinned: !pin, blake3: false });
  } catch (e) {
    onStatus("loading (dev reader)");
    r = await plainReader(base);
  }
  const rawMan = r.info;                                          // RAW manifest (hybrid, tensors[*].N/K, d, model, root)
  if (!rawMan || !rawMan.hybrid) throw new Error("bonsai27-bridge: this κ-object is not a hybrid (27B) model");

  // wrap the reader so every tensor's byte length paints the app's per-tensor progress line
  const fetchTensor = async (name) => {
    const b = await r.fetchTensor(name);
    try { onProgress(name, (b && b.byteLength) || 0); } catch (e) {}
    return b;
  };

  onStatus("building engine");
  const brain = await loadBonsai27Brain({
    baseUrl: base, manifest: rawMan, fetchTensor,               // tokenizer.gguf is fetched from `base` by the loader
    onProgress: (label) => { try { onStatus(label); } catch (e) {} },
  });

  const modelName = String((rawMan.model) || "Bonsai").replace(/-/g, " ");
  const rootK = String((rawMan.root) || pin || "");

  // think markers: the app splits streamed outIds by tokenize("<think>")/("</think>"). Verify they are
  // ATOMIC single ids in the 27B vocab AND round-trip through detokenize; expose them either way so the
  // app can use engine.thinkOpen/thinkClose directly if its own tokenize() probe ever disagrees.
  const encode = (t) => brain.tok.encode(t, { addSpecial: false, parseSpecial: true });
  const decode = (ids) => brain.tok.decode(ids);
  const oIds = encode("<think>"), cIds = encode("</think>");
  const thinkOpen = oIds.length === 1 ? oIds[0] : -1;
  const thinkClose = cIds.length === 1 ? cIds[0] : -1;

  const engine = {
    tokenize: encode,
    detokenize: decode,
    // ChatML single user turn. hasHistory closes the previous assistant turn (<|im_end|>) before this one,
    // since the app carries prior-turn token ids in `mind` without a trailing end marker (qwen3 convention).
    frameTurn(q, hasHistory) {
      return (hasHistory ? "<|im_end|>\n" : "") + `<|im_start|>user\n${q}<|im_end|>\n<|im_start|>assistant\n`;
    },
    // ids-based ring decode: fires onToken per committed token, resolves to { outIds, text, stats:{ tokps } }.
    generate(ids, opts = {}) {
      return brain.generateIds(ids, { maxNew: opts.maxNew ?? 128, onToken: opts.onToken, signal: opts.signal });
    },
    thinkOpen, thinkClose, eos: EOS_IM_END,
    _brain: brain,
  };

  return { engine, modelName, rootK, _raw: r, _thinkAtomic: { thinkOpen, thinkClose } };
}

export default { loadBridge };
