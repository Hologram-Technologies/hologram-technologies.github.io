// holo-parakeet-stem.mjs — the FastConformer "dw_striding" conv-subsampling STEM (pre_encode): log-mel image
// → acoustic features [T,1024], the input to the 24-layer conformer encoder. 8× downsample in both time and
// freq: conv0(1→256,k3,s2) → relu → dw(k3,s2,g256) → pw(1×1) → relu → dw(k3,s2,g256) → pw(1×1) → relu →
// flatten(256·16) → linear(4096→1024). Weights stream from the encoder .holo BY κ (the same 6 pre_encode
// tensors), dequantized f32 ((uint8−zp)·scale). Conv math is the torch-witnessed kernel (s2/conv-subsampling),
// inlined here so the module seals with the listen faculty. Validated end-to-end against the real pre_encode
// output (layer0-in.f32) via mel(jo16)→stem in the browser.
//
//   createParakeetStem({ getWeight, rescale, rescaleBin }) →
//     { ready(): Promise, stem(mel /*Float32Array [F*Tmel], freq-major (nemo [1,128,Tmel])*/, F, Tmel) -> { features, T } }

const f32 = (bin, e) => new Float32Array(bin.buffer, bin.byteOffset + e.off * 4, e.len);   // rescale.bin: f32 ELEMENTS

// grouped conv2d. inp[Cin][H][W], W[Cout][Cin/groups][kh][kw], b[Cout] → out[Cout][H'][W'].
function conv2d(inp, W, b, stride, pad, groups) {
  const Cin = inp.length, H = inp[0].length, Wd = inp[0][0].length;
  const Cout = W.length, kh = W[0][0].length, kw = W[0][0][0].length;
  const cinG = Cin / groups, coutG = Cout / groups;
  const Ho = ((H + 2 * pad - kh) / stride | 0) + 1, Wo = ((Wd + 2 * pad - kw) / stride | 0) + 1;
  const out = new Array(Cout);
  for (let co = 0; co < Cout; co++) {
    const g = (co / coutG) | 0, plane = new Array(Ho), Wco = W[co];
    for (let oh = 0; oh < Ho; oh++) {
      const row = new Float32Array(Wo);
      for (let ow = 0; ow < Wo; ow++) {
        let acc = b[co];
        for (let cig = 0; cig < cinG; cig++) {
          const ci = g * cinG + cig, Wcc = Wco[cig], inci = inp[ci];
          for (let i = 0; i < kh; i++) { const ih = oh * stride - pad + i; if (ih < 0 || ih >= H) continue; const inrow = inci[ih], wr = Wcc[i];
            for (let j = 0; j < kw; j++) { const iw = ow * stride - pad + j; if (iw < 0 || iw >= Wd) continue; acc += inrow[iw] * wr[j]; } }
        }
        row[ow] = acc;
      }
      plane[oh] = row;
    }
    out[co] = plane;
  }
  return out;
}
const relu3 = (x) => { for (const p of x) for (const r of p) for (let i = 0; i < r.length; i++) if (r[i] < 0) r[i] = 0; return x; };

export function createParakeetStem({ getWeight, rescale, rescaleBin } = {}) {
  if (!getWeight || !rescale || !rescaleBin) throw new Error("createParakeetStem needs getWeight + rescale + rescaleBin");
  const bin = rescaleBin instanceof Uint8Array ? rescaleBin : new Uint8Array(rescaleBin.buffer || rescaleBin);
  const byRole = {}; for (const w of rescale.weights) if (w.layer < 0) byRole[w.role] = w;

  // dequant a stem weight to a flat f32 [prod(shape)]
  async function dqFlat(role) { const w = byRole[role]; const b = await getWeight(w.kappa); const o = new Float32Array(b.length); for (let i = 0; i < b.length; i++) o[i] = (b[i] - w.zp) * w.scale; return { w, f: o }; }
  // reshape a flat conv weight [Cout,Cin/g,kh,kw] → nested
  const resh4 = (f, [Co, Ci, kh, kw]) => { const o = new Array(Co); let p = 0; for (let c = 0; c < Co; c++) { const a = new Array(Ci); for (let i = 0; i < Ci; i++) { const m = new Array(kh); for (let y = 0; y < kh; y++) { const r = new Float32Array(kw); for (let x = 0; x < kw; x++) r[x] = f[p++]; m[y] = r; } a[i] = m; } o[c] = a; } return o; };

  let fx = null;
  async function ready() {
    if (fx) return fx;
    const mk = async (role, stride, pad, groups) => { const { w, f } = await dqFlat(role); return { w: resh4(f, w.shape), b: f32(bin, w.bias), stride, pad, groups }; };
    const c0 = await mk("stem.conv0", 2, 1, 1);
    const dw1 = await mk("stem.conv2", 2, 1, 256), pw1 = await mk("stem.conv3", 1, 0, 1);
    const dw2 = await mk("stem.conv5", 2, 1, 256), pw2 = await mk("stem.conv6", 1, 0, 1);
    const op = await dqFlat("stem.out_proj");                          // [in=4096, out=1024] row-major
    fx = { c0, dw1, pw1, dw2, pw2, lin: { w: op.f, in: op.w.shape[0], out: op.w.shape[1], b: f32(bin, op.w.bias) } };
    return fx;
  }

  // stem(mel, F, Tmel): mel is freq-major [F*Tmel] (nemo [1,128,Tmel]); build the [1][T][F] image, run the pipeline.
  async function stem(mel, F, Tmel) {
    await ready();
    const img = new Array(Tmel); for (let t = 0; t < Tmel; t++) { const r = new Float32Array(F); for (let f = 0; f < F; f++) r[f] = mel[f * Tmel + t]; img[t] = r; }
    let h = relu3(conv2d([img], fx.c0.w, fx.c0.b, fx.c0.stride, fx.c0.pad, fx.c0.groups));
    h = relu3(conv2d(conv2d(h, fx.dw1.w, fx.dw1.b, fx.dw1.stride, fx.dw1.pad, fx.dw1.groups), fx.pw1.w, fx.pw1.b, fx.pw1.stride, fx.pw1.pad, fx.pw1.groups));
    h = relu3(conv2d(conv2d(h, fx.dw2.w, fx.dw2.b, fx.dw2.stride, fx.dw2.pad, fx.dw2.groups), fx.pw2.w, fx.pw2.b, fx.pw2.stride, fx.pw2.pad, fx.pw2.groups));
    const C = h.length, Tout = h[0].length, Fout = h[0][0].length, inDim = C * Fout;   // flatten channel-major then freq
    const { w: lw, out: D, b: lb } = fx.lin;                            // lw row-major [inDim, D]
    const features = new Float32Array(Tout * D);
    for (let t = 0; t < Tout; t++) {
      const fo = t * D;
      for (let cc = 0; cc < C; cc++) for (let ff = 0; ff < Fout; ff++) { const v = h[cc][t][ff]; if (v === 0) continue; const wo = (cc * Fout + ff) * D; for (let o = 0; o < D; o++) features[fo + o] += v * lw[wo + o]; }
      for (let o = 0; o < D; o++) features[fo + o] += lb[o];
    }
    return { features, T: Tout };
  }

  return { ready, stem };
}
export default createParakeetStem;
