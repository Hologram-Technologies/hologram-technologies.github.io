// holo-asr-decode.mjs — the ONE TDT decode core (Token-and-Duration Transducer greedy). Backend-agnostic:
// the `joint` (predictor + joint network) is injected, so the SAME loop drives onnxruntime-web in the browser,
// onnxruntime in Python's twin, or — once built — κ-native WGSL joint kernels. This is the integration seam
// the listen faculty wires to; it replaces the decode logic that was inlined in the demo pages (de-dup).
//
// joint(frameData, lastToken, state) → { out, state }
//   frameData : Float32Array(d)  — one encoder frame
//   lastToken : int               — previous emitted token (or blank at start)
//   state     : opaque            — predictor (LSTM) state; null at start. The joint snapshots its own state.
//   returns   : { out: Float32Array(>= vocabSize + nDurations), state: <new predictor state> }
//
// Pure, dependency-free, DOM-free. Witnessed in holo-asr-decode-witness.mjs against a scripted mock joint.

// `bias` (optional, B1): a makeBiasContext — boosts token logits that continue an active bias-phrase match
// (contextual biasing). bias=null ⇒ this path is BYTE-IDENTICAL to before (the witnessed decode). The boost is
// bounded + additive (it never sets a logit, only nudges), and gated: a token only receives the boost when the
// joint already gives it a non-trivial score relative to the argmax (so bias can't insert a word that wasn't said).
export async function tdtDecode({ T, frame, joint, blank = 1024, vocabSize = 1025, maxPerStep = 10, bias = null, biasGateDelta = 8.0 }) {
  let state = null;
  const tokens = [];
  let t = 0, emitted = 0, steps = 0;
  while (t < T) {
    const last = tokens.length ? tokens[tokens.length - 1] : blank;
    const r = await joint(frame(t), last, state); steps++;
    const o = r.out;
    let tok = 0, tm = -Infinity; for (let i = 0; i < vocabSize; i++) if (o[i] > tm) { tm = o[i]; tok = i; }     // argmax token (incl blank)
    if (bias) {                                                                   // shallow-fusion bias (B1)
      const bo = bias.boosts();
      if (bo.size) {
        let btok = tok, btm = tm;
        for (const [id, boost] of bo) {
          if (id >= vocabSize) continue;
          if (o[id] < tm - biasGateDelta) continue;                              // acoustic gate: don't resurrect a token the joint nearly ruled out
          const s = o[id] + boost; if (s > btm) { btm = s; btok = id; }
        }
        tok = btok;
      }
    }
    let dur = 0, dm = -Infinity; for (let i = vocabSize; i < o.length; i++) if (o[i] > dm) { dm = o[i]; dur = i - vocabSize; }  // argmax duration → frames to skip
    if (tok !== blank) { state = r.state; tokens.push(tok); emitted++; if (bias) bias.advance(tok); }   // advance predictor + bias trie ONLY on a real token
    if (dur > 0) { t += dur; emitted = 0; }                                     // TDT: skip `dur` frames
    else if (tok === blank || emitted === maxPerStep) { t += 1; emitted = 0; }  // no-skip safety: always make progress
  }
  return { tokens, steps };
}

// detokenize SentencePiece pieces → text (▁ marks a leading space).
export function detokenize(tokens, vocab) {
  return tokens.map((x) => vocab[x]).join("").replace(/▁/g, " ").trim();
}

export default { tdtDecode, detokenize };
