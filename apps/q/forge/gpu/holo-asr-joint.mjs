// holo-asr-joint.mjs — κ-native RNN-T joint (predictor + joint network) in pure JS. NO onnxruntime / ort-web.
// The 2-layer standard LSTM predictor + the joint MLP, from the fp32 decoder_joint weights. This is the last
// external dependency removed from the decode: makeJoint() returns a `joint(encFrame, lastToken, state)`
// callback that plugs straight into holo-asr-decode's tdtDecode. Standard ONNX LSTM semantics — gates iofc,
// W[4H,in], R[4H,H], B[8H]=Wb(4H)+Rb(4H), f=sigmoid g=tanh h=tanh. Matmuls are [in,out] row-major.

const sig = (x) => 1 / (1 + Math.exp(-x));
const matvec = (W, x, inDim, outDim, bias) => { const o = new Float32Array(outDim); for (let j = 0; j < outDim; j++) { let s = bias ? bias[j] : 0; for (let i = 0; i < inDim; i++) s += x[i] * W[i * outDim + j]; o[j] = s; } return o; };

// friendly weight key → its ONNX initializer name (how bodies are keyed in the joint .holo). The .holo stores
// raw fp32 bytes per initializer; the LSTM W/R are [1,4H,X] and B is [1,8H] in ONNX but byte-contiguous, so the
// raw bytes equal the squeezed/flattened f32 values the cell expects. (Mirror of extract-joint-weights.py.)
export const JOINT_ONNX_NAMES = {
  embed: "decoder.prediction.embed.weight",
  L0_W: "onnx::LSTM_205", L0_R: "onnx::LSTM_206", L0_B: "onnx::LSTM_207",
  L1_W: "onnx::LSTM_225", L1_R: "onnx::LSTM_226", L1_B: "onnx::LSTM_227",
  enc_W: "onnx::MatMul_228", enc_b: "joint.enc.bias",
  pred_W: "onnx::MatMul_229", pred_b: "joint.pred.bias",
  out_W: "onnx::MatMul_230", out_b: "joint.joint_net.2.bias",
};

// makeJoint(floats, manifest) → joint(...). The flat-blob path (joint-weights.bin).
export function makeJoint(floats, manifest, opts = {}) {
  const W = {}; for (const k in manifest) { const m = manifest[k]; W[k] = floats.subarray(m.off, m.off + m.shape.reduce((a, b) => a * b, 1)); }
  return buildJoint(W, opts);
}

// loadJointFromHolo(stream, opts) → joint(...). The κ-native path: each weight body streams from the joint
// .holo BY content address (openHoloStream — HTTP-Range + per-block L5 + OPFS), same loader/format as every
// Hologram model. `stream` is an openHoloStream result (has .order [{name,kappa}] + .getBody). Same f32 values
// as the flat blob, now content-addressed/streamable. Bodies are L5-verified by getBody (refuses on mismatch).
export async function loadJointFromHolo(stream, opts = {}) {
  const kOf = new Map(stream.order.map((o) => [o.name, String(o.kappa).split(":").pop()]));
  const W = {};
  for (const key in JOINT_ONNX_NAMES) {
    const kappa = kOf.get(JOINT_ONNX_NAMES[key]); if (!kappa) throw new Error("joint .holo missing " + JOINT_ONNX_NAMES[key]);
    const body = await stream.getBody(kappa);                            // L5-verified int8/f32 body
    const f = new Float32Array(body.length / 4); new Uint8Array(f.buffer).set(body);   // copy → 4-aligned, alignment-safe
    W[key] = f;
  }
  return buildJoint(W, opts);
}

// buildJoint(W, opts) → the joint(encFrame, lastToken, state) closure. W = { embed, L0_W/R/B, L1_W/R/B,
// enc_W/b, pred_W/b, out_W/b } as Float32Arrays. Shared by both loaders above.
export function buildJoint(W, { H = 640, encDim = 1024 } = {}) {
  // PERF: the joint runs ~100 sequential steps/utterance — the decode hot loop. Transpose the joint-MLP weights
  // to [out,in] for cache-contiguous matvec, and reuse scratch (no per-step allocation). Math-identical.
  const VOC = 1030;
  const tr = (src, inD, outD) => { const o = new Float32Array(inD * outD); for (let i = 0; i < inD; i++) for (let j = 0; j < outD; j++) o[j * inD + i] = src[i * outD + j]; return o; };
  const encWt = tr(W.enc_W, encDim, H), predWt = tr(W.pred_W, H, H), outWt = tr(W.out_W, H, VOC);
  const _encP = new Float32Array(H), _predP = new Float32Array(H), _j = new Float32Array(H), _out = new Float32Array(VOC);
  const mvT = (Wt, x, inD, outD, bias, out) => { for (let j = 0; j < outD; j++) { const o2 = j * inD; let s = bias ? bias[j] : 0; for (let i = 0; i < inD; i++) s += x[i] * Wt[o2 + i]; out[j] = s; } return out; };
  // one LSTM cell step (gates iofc). Wm[4H,inDim], Rm[4H,H], Bm[8H].
  function cell(x, hPrev, cPrev, Wm, Rm, Bm, inDim) {
    const h = new Float32Array(H), c = new Float32Array(H);
    for (let j = 0; j < H; j++) {
      const gi = j, go = H + j, gf = 2 * H + j, gc = 3 * H + j;
      let si = Bm[gi] + Bm[4 * H + gi], so = Bm[go] + Bm[4 * H + go], sf = Bm[gf] + Bm[4 * H + gf], sc = Bm[gc] + Bm[4 * H + gc];
      const bi = gi * inDim, bo = go * inDim, bf = gf * inDim, bc = gc * inDim;
      for (let i = 0; i < inDim; i++) { const xi = x[i]; si += Wm[bi + i] * xi; so += Wm[bo + i] * xi; sf += Wm[bf + i] * xi; sc += Wm[bc + i] * xi; }
      const ri = gi * H, ro = go * H, rf = gf * H, rc = gc * H;
      for (let k = 0; k < H; k++) { const hk = hPrev[k]; si += Rm[ri + k] * hk; so += Rm[ro + k] * hk; sf += Rm[rf + k] * hk; sc += Rm[rc + k] * hk; }
      const it = sig(si), ot = sig(so), ft = sig(sf), ct = Math.tanh(sc);
      const C = ft * cPrev[j] + it * ct; c[j] = C; h[j] = ot * Math.tanh(C);
    }
    return { h, c };
  }
  const Z = () => new Float32Array(H);
  return async function joint(encFrame, lastToken, state) {
    const s = state || { h0: Z(), c0: Z(), h1: Z(), c1: Z() };
    const emb = W.embed.subarray(lastToken * H, (lastToken + 1) * H);
    const l0 = cell(emb, s.h0, s.c0, W.L0_W, W.L0_R, W.L0_B, H);          // predictor LSTM layer 0
    const l1 = cell(l0.h, s.h1, s.c1, W.L1_W, W.L1_R, W.L1_B, H);          // layer 1
    mvT(encWt, encFrame, encDim, H, W.enc_b, _encP);                      // joint.enc: encoder → H (contiguous)
    mvT(predWt, l1.h, H, H, W.pred_b, _predP);                            // joint.pred: predictor → H
    for (let k = 0; k < H; k++) { const v = _encP[k] + _predP[k]; _j[k] = v > 0 ? v : 0; }  // add + ReLU
    mvT(outWt, _j, H, VOC, W.out_b, _out);                               // joint_net.2 → 1030 (reused scratch; read before next call)
    return { out: _out, state: { h0: l0.h, c0: l0.c, h1: l1.h, c1: l1.c } };
  };
}

export default { makeJoint, buildJoint, loadJointFromHolo, JOINT_ONNX_NAMES };
