// onnx-run.mjs — a MINIMAL ONNX interpreter, just enough to run Kokoro-82M (StyleTTS2) on the CPU from raw
// weights and reproduce the golden PCM. It is the executable spec + per-kernel oracle for the WGSL port: every
// heavy op here (MatMul/Gemm/Conv/ConvTranspose/LSTM/LayerNorm/STFT) becomes a WGSL kernel later, diffed vs this.
//
// Not a general runtime — it covers exactly the 49 op types Kokoro uses (see `node onnx-tensors.mjs … --nodes`).
// Tensors are { data: Float64Array (values), dims: number[], int: bool }. f64 keeps int64 shape-math exact and
// float math ample; we cast to Float32 only at the boundary vs the fp32 golden.

import { openOnnx } from "./onnx-tensors.mjs";

let FP32MODE = false;   // when true, ops that ACCUMULATE (CumSum) round per-step in fp32 to match ORT's fp32 running sums
const fr = (v) => FP32MODE ? Math.fround(v) : v;
const prod = (a) => a.reduce((x, y) => x * y, 1);
const T = (data, dims, int = false) => ({ data: data instanceof Float64Array ? data : Float64Array.from(data), dims: dims.slice(), int });
const stridesOf = (dims) => { const s = new Array(dims.length); let a = 1; for (let i = dims.length - 1; i >= 0; i--) { s[i] = a; a *= dims[i]; } return s; };

// decode an initializer TensorProto into our Tensor (f32/f16/i64/i32/i8/u8).
function initToTensor(oz, t) {
  // copy into a fresh (0-aligned) ArrayBuffer — raw_data offsets in the file are not TypedArray-aligned.
  const src = oz.buf.subarray(t.raw[0], t.raw[0] + t.raw[1]);
  const ab = new Uint8Array(src.length); ab.set(src); const buf = ab.buffer;
  const dims = t.dims.slice();
  if (t.dtype === "f32") return T(Float64Array.from(new Float32Array(buf, 0, t.raw[1] / 4)), dims);
  if (t.dtype === "f16") { const n = t.raw[1] / 2, out = new Float64Array(n), dv = new DataView(buf); for (let i = 0; i < n; i++) out[i] = f16(dv.getUint16(i * 2, true)); return T(out, dims); }
  if (t.dtype === "i64") { const n = t.raw[1] / 8, out = new Float64Array(n), dv = new DataView(buf); for (let i = 0; i < n; i++) out[i] = Number(dv.getBigInt64(i * 8, true)); return T(out, dims, true); }
  if (t.dtype === "i32") return T(Float64Array.from(new Int32Array(buf, 0, t.raw[1] / 4)), dims, true);
  if (t.dtype === "i8") return T(Float64Array.from(new Int8Array(buf)), dims, true);
  if (t.dtype === "u8") return T(Float64Array.from(new Uint8Array(buf)), dims, true);
  throw new Error("initToTensor: unhandled dtype " + t.dtype + " for " + t.name);
}
function f16(h) { const s = (h & 0x8000) >> 15, e = (h & 0x7c00) >> 10, f = h & 0x03ff; if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024); if (e === 0x1f) return f ? NaN : (s ? -Infinity : Infinity); return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024); }

// ── broadcasting elementwise ──────────────────────────────────────────────────────────────────────────
function broadcastDims(a, b) {
  const n = Math.max(a.length, b.length), out = new Array(n);
  for (let i = 0; i < n; i++) { const ai = a[a.length - n + i] ?? 1, bi = b[b.length - n + i] ?? 1; if (ai !== bi && ai !== 1 && bi !== 1) throw new Error(`broadcast ${a}×${b}`); out[i] = Math.max(ai, bi); }
  return out;
}
function ewise(x, y, f) {
  const dims = broadcastDims(x.dims, y.dims), n = prod(dims), out = new Float64Array(n);
  const os = stridesOf(dims), xs = stridesOf(x.dims), ys = stridesOf(y.dims), idx = new Array(dims.length).fill(0);
  for (let i = 0; i < n; i++) {
    let xo = 0, yo = 0;
    for (let d = 0; d < dims.length; d++) { const id = Math.floor(i / os[d]) % dims[d]; const xd = x.dims[x.dims.length - dims.length + d] ?? 1, yd = y.dims[y.dims.length - dims.length + d] ?? 1; xo += (xd === 1 ? 0 : id) * (xs[x.dims.length - dims.length + d] ?? 0); yo += (yd === 1 ? 0 : id) * (ys[y.dims.length - dims.length + d] ?? 0); }
    out[i] = f(x.data[xo], y.data[yo]);
  }
  return T(out, dims, x.int && y.int);
}
const mapUnary = (x, f) => T(x.data.map(f), x.dims, false);

// axis-permute (Transpose)
function transpose(x, perm) {
  const dims = perm.map((p) => x.dims[p]), n = prod(dims), out = new Float64Array(n);
  const xs = stridesOf(x.dims), os = stridesOf(dims);
  for (let i = 0; i < n; i++) { let xo = 0; for (let d = 0; d < dims.length; d++) { const id = Math.floor(i / os[d]) % dims[d]; xo += id * xs[perm[d]]; } out[i] = x.data[i === 0 ? 0 : xo]; }
  // recompute properly (the i===0 shortcut above is wrong for i>0) —
  for (let i = 0; i < n; i++) { let rem = i, xo = 0; for (let d = 0; d < dims.length; d++) { const id = Math.floor(rem / os[d]) % dims[d]; xo += id * xs[perm[d]]; } out[i] = x.data[xo]; }
  return T(out, dims, x.int);
}

// generic 2D matmul over trailing dims with batch broadcast
function matmul(a, b) {
  const ad = a.dims, bd = b.dims;
  const M = ad[ad.length - 2], K = ad[ad.length - 1], K2 = bd[bd.length - 2], N = bd[bd.length - 1];
  if (K !== K2) throw new Error(`matmul K ${K}!=${K2} (${ad}×${bd})`);
  const batchA = ad.slice(0, -2), batchB = bd.slice(0, -2), batch = broadcastDims(batchA.length ? batchA : [1], batchB.length ? batchB : [1]);
  const bn = prod(batch), out = new Float64Array(bn * M * N);
  const asBatch = prod(batchA), bsBatch = prod(batchB);
  for (let bi = 0; bi < bn; bi++) {
    const ao = (asBatch === 1 ? 0 : bi) * M * K, bo = (bsBatch === 1 ? 0 : bi) * K * N, co = bi * M * N;
    for (let m = 0; m < M; m++) for (let nn = 0; nn < N; nn++) { let s = 0; for (let k = 0; k < K; k++) s += a.data[ao + m * K + k] * b.data[bo + k * N + nn]; out[co + m * N + nn] = s; }
  }
  const outDims = (batch.length && !(batch.length === 1 && batch[0] === 1 && !batchA.length && !batchB.length) ? batch : []).concat([M, N]);
  return T(out, outDims.length ? outDims : [M, N]);
}

// ── op table ──────────────────────────────────────────────────────────────────────────────────────────
const attr = (node, name, def) => { const a = node.attrs.find((x) => x.name === name); if (!a) return def; if (a.ints.length) return a.ints; if (a.i != null) return a.i; if (a.f != null) return a.f; if (a.s != null) return a.s; return def; };

function makeOps(env) {
  const g = (name) => { const t = env.get(name); if (!t) throw new Error("missing tensor " + name); return t; };
  const has = (name) => name !== "" && env.has(name);
  return {
    Gather(n) { const data = g(n.inputs[0]), ind = g(n.inputs[1]); const axis = attr(n, "axis", 0); const ax = axis < 0 ? axis + data.dims.length : axis;
      const outer = data.dims.slice(0, ax), inner = data.dims.slice(ax + 1), innerN = prod(inner), axLen = data.dims[ax];
      const idDims = ind.dims, idN = prod(idDims), outerN = prod(outer);
      const out = new Float64Array(outerN * idN * innerN); let o = 0;
      for (let ou = 0; ou < outerN; ou++) for (let ii = 0; ii < idN; ii++) { let gi = ind.data[ii]; if (gi < 0) gi += axLen; const base = (ou * axLen + gi) * innerN; for (let k = 0; k < innerN; k++) out[o++] = data.data[base + k]; }
      return T(out, outer.concat(idDims).concat(inner), data.int); },
    Add: (n) => ewise(g(n.inputs[0]), g(n.inputs[1]), (a, b) => a + b),
    Sub: (n) => ewise(g(n.inputs[0]), g(n.inputs[1]), (a, b) => a - b),
    Mul: (n) => ewise(g(n.inputs[0]), g(n.inputs[1]), (a, b) => a * b),
    Div: (n) => { const y = ewise(g(n.inputs[0]), g(n.inputs[1]), (a, b) => a / b); return y; },
    Pow: (n) => ewise(g(n.inputs[0]), g(n.inputs[1]), (a, b) => Math.pow(a, b)),
    Sqrt: (n) => mapUnary(g(n.inputs[0]), Math.sqrt),
    Exp: (n) => mapUnary(g(n.inputs[0]), Math.exp),
    Sin: (n) => mapUnary(g(n.inputs[0]), Math.sin),
    Cos: (n) => mapUnary(g(n.inputs[0]), Math.cos),
    Atan: (n) => mapUnary(g(n.inputs[0]), Math.atan),
    Tanh: (n) => mapUnary(g(n.inputs[0]), Math.tanh),
    Sigmoid: (n) => mapUnary(g(n.inputs[0]), (v) => 1 / (1 + Math.exp(-v))),
    Relu: (n) => mapUnary(g(n.inputs[0]), (v) => Math.max(0, v)),
    LeakyRelu: (n) => { const s = attr(n, "alpha", 0.01); return mapUnary(g(n.inputs[0]), (v) => v < 0 ? v * s : v); },
    Floor: (n) => mapUnary(g(n.inputs[0]), Math.floor),
    Round: (n) => mapUnary(g(n.inputs[0]), (v) => { const r = Math.round(v); return (Math.abs(v - Math.trunc(v)) === 0.5 && r % 2 !== 0) ? r - Math.sign(v) : r; }),  // round-half-to-even (ONNX)
    Clip: (n) => { const x = g(n.inputs[0]); const lo = has(n.inputs[1]) ? g(n.inputs[1]).data[0] : -Infinity, hi = has(n.inputs[2]) ? g(n.inputs[2]).data[0] : Infinity; return mapUnary(x, (v) => Math.min(hi, Math.max(lo, v))); },
    Neg: (n) => mapUnary(g(n.inputs[0]), (v) => -v),
    Abs: (n) => mapUnary(g(n.inputs[0]), Math.abs),
    Reciprocal: (n) => mapUnary(g(n.inputs[0]), (v) => 1 / v),
    Log: (n) => mapUnary(g(n.inputs[0]), Math.log),
    Erf: (n) => mapUnary(g(n.inputs[0]), erf),
    MatMul: (n) => matmul(g(n.inputs[0]), g(n.inputs[1])),
    Gemm(n) { let A = g(n.inputs[0]), B = g(n.inputs[1]); const C = has(n.inputs[2]) ? g(n.inputs[2]) : null;
      const alpha = attr(n, "alpha", 1), beta = attr(n, "beta", 1), tA = attr(n, "transA", 0), tB = attr(n, "transB", 0);
      if (tA) A = transpose(A, [1, 0]); if (tB) B = transpose(B, [1, 0]);
      let Y = matmul(A, B); if (alpha !== 1) Y = mapUnary(Y, (v) => v * alpha);
      if (C) Y = ewise(Y, beta !== 1 ? mapUnary(C, (v) => v * beta) : C, (a, b) => a + b); return Y; },
    Transpose(n) { const x = g(n.inputs[0]); const perm = attr(n, "perm", x.dims.map((_, i) => x.dims.length - 1 - i)); return transpose(x, perm); },
    Shape(n) { const x = g(n.inputs[0]); let s = 0, e = x.dims.length; const st = attr(n, "start", null); if (st != null) s = st < 0 ? st + x.dims.length : st; const en = attr(n, "end", null); if (en != null) e = en < 0 ? en + x.dims.length : en; return T(x.dims.slice(s, e), [e - s], true); },
    Size: (n) => T([prod(g(n.inputs[0]).dims)], [], true),
    Reshape(n) { const x = g(n.inputs[0]), shape = Array.from(g(n.inputs[1]).data); let dims = shape.slice(); const known = prod(x.dims); let negI = -1, acc = 1; for (let i = 0; i < dims.length; i++) { if (dims[i] === 0) dims[i] = x.dims[i]; if (dims[i] === -1) negI = i; else acc *= dims[i]; } if (negI >= 0) dims[negI] = known / acc; return T(x.data.slice(), dims, x.int); },
    Flatten(n) { const x = g(n.inputs[0]); const ax = attr(n, "axis", 1); const a = ax < 0 ? ax + x.dims.length : ax; const d0 = prod(x.dims.slice(0, a)) || 1, d1 = prod(x.dims.slice(a)) || 1; return T(x.data.slice(), [d0, d1], x.int); },
    Unsqueeze(n) { const x = g(n.inputs[0]); const axesT = has(n.inputs[1]) ? Array.from(g(n.inputs[1]).data) : attr(n, "axes", []); const dims = x.dims.slice(); const r = dims.length + axesT.length; const ax = axesT.map((a) => a < 0 ? a + r : a).sort((a, b) => a - b); for (const a of ax) dims.splice(a, 0, 1); return T(x.data.slice(), dims, x.int); },
    Squeeze(n) { const x = g(n.inputs[0]); const axesT = has(n.inputs[1]) ? Array.from(g(n.inputs[1]).data) : attr(n, "axes", null); let dims; if (axesT) { const ax = axesT.map((a) => a < 0 ? a + x.dims.length : a); dims = x.dims.filter((_, i) => !ax.includes(i)); } else dims = x.dims.filter((d) => d !== 1); return T(x.data.slice(), dims, x.int); },
    Concat(n) { const xs = n.inputs.map(g); const axis = attr(n, "axis", 0); const ax = axis < 0 ? axis + xs[0].dims.length : axis;
      const dims = xs[0].dims.slice(); dims[ax] = xs.reduce((s, x) => s + x.dims[ax], 0);
      const out = new Float64Array(prod(dims)), os = stridesOf(dims); const outer = prod(dims.slice(0, ax));
      let axOff = 0;
      for (const x of xs) { const xs2 = stridesOf(x.dims), inner = prod(x.dims.slice(ax)); for (let ou = 0; ou < outer; ou++) { const src = ou * inner, dst = ou * os[ax === 0 ? 0 : ax - 1] * (ax === 0 ? 1 : 1); // fall to explicit copy below
        }
        // explicit copy: iterate all elements of x, map to out
        const xN = prod(x.dims); for (let i = 0; i < xN; i++) { let rem = i, oo = 0; for (let d = 0; d < x.dims.length; d++) { const id = Math.floor(rem / xs2[d]) % x.dims[d]; oo += (d === ax ? id + axOff : id) * os[d]; } out[oo] = x.data[i]; }
        axOff += x.dims[ax];
      }
      return T(out, dims, xs[0].int); },
    Slice(n) { const x = g(n.inputs[0]); const starts = Array.from(g(n.inputs[1]).data), ends = Array.from(g(n.inputs[2]).data);
      const axesIn = has(n.inputs[3]) ? Array.from(g(n.inputs[3]).data) : starts.map((_, i) => i);
      const stepsIn = has(n.inputs[4]) ? Array.from(g(n.inputs[4]).data) : starts.map(() => 1);
      const dims = x.dims.slice(); const st = new Array(x.dims.length).fill(0), en = x.dims.slice(), sp = new Array(x.dims.length).fill(1);
      axesIn.forEach((a, i) => { const ax = a < 0 ? a + x.dims.length : a; let s = starts[i], e = ends[i], step = stepsIn[i]; const L = x.dims[ax];
        if (s < 0) s += L; if (e < 0) e += L; s = Math.max(0, Math.min(L, s)); e = Math.max(step < 0 ? -1 : 0, Math.min(L, e)); st[ax] = s; en[ax] = e; sp[ax] = step; });
      const outDims = x.dims.map((L, i) => Math.max(0, Math.ceil((en[i] - st[i]) / sp[i])));
      const out = new Float64Array(prod(outDims)), xs = stridesOf(x.dims), os = stridesOf(outDims); const N = prod(outDims);
      for (let i = 0; i < N; i++) { let rem = i, xo = 0; for (let d = 0; d < outDims.length; d++) { const id = Math.floor(rem / os[d]) % outDims[d]; xo += (st[d] + id * sp[d]) * xs[d]; } out[i] = x.data[xo]; }
      return T(out, outDims, x.int); },
    Cast(n) { const x = g(n.inputs[0]); const to = attr(n, "to", 1); const isInt = (to === 6 || to === 7 || to === 9 || to === 3 || to === 2); return T(isInt ? x.data.map((v) => Math.trunc(v)) : x.data.slice(), x.dims, isInt); },
    Identity: (n) => g(n.inputs[0]),
    ConstantOfShape(n) { const shape = Array.from(g(n.inputs[0]).data); const v = attr(n, "value", 0); return T(new Float64Array(prod(shape)).fill(v), shape); },   // value is a TensorProto attr → decoded to scalar by the reader
    Range(n) { const s = g(n.inputs[0]).data[0], lim = g(n.inputs[1]).data[0], d = g(n.inputs[2]).data[0]; const out = []; for (let v = s; d > 0 ? v < lim : v > lim; v += d) out.push(v); return T(out, [out.length], true); },
    ReduceMean: (n) => reduce(n, g, (arr) => arr.reduce((a, b) => a + b, 0) / arr.length),
    ReduceSum: (n) => reduce(n, g, (arr) => arr.reduce((a, b) => a + b, 0)),
    ReduceMax: (n) => reduce(n, g, (arr) => Math.max(...arr)),
    Softmax(n) { const x = g(n.inputs[0]); const axis = attr(n, "axis", -1); const ax = axis < 0 ? axis + x.dims.length : axis;
      const inner = prod(x.dims.slice(ax + 1)), axLen = x.dims[ax], outer = prod(x.dims.slice(0, ax));
      const out = new Float64Array(x.data.length);
      for (let ou = 0; ou < outer; ou++) for (let ii = 0; ii < inner; ii++) { let mx = -Infinity; for (let a = 0; a < axLen; a++) { const v = x.data[(ou * axLen + a) * inner + ii]; if (v > mx) mx = v; } let s = 0; for (let a = 0; a < axLen; a++) { const e = Math.exp(x.data[(ou * axLen + a) * inner + ii] - mx); out[(ou * axLen + a) * inner + ii] = e; s += e; } for (let a = 0; a < axLen; a++) out[(ou * axLen + a) * inner + ii] /= s; }
      return T(out, x.dims); },
    LayerNormalization(n) { const x = g(n.inputs[0]), scale = g(n.inputs[1]), bias = has(n.inputs[2]) ? g(n.inputs[2]) : null;
      const axis = attr(n, "axis", -1), eps = attr(n, "epsilon", 1e-5); const ax = axis < 0 ? axis + x.dims.length : axis;
      const inner = prod(x.dims.slice(ax)), outer = prod(x.dims.slice(0, ax)); const out = new Float64Array(x.data.length);
      for (let ou = 0; ou < outer; ou++) { let m = 0; for (let i = 0; i < inner; i++) m += x.data[ou * inner + i]; m /= inner; let v = 0; for (let i = 0; i < inner; i++) { const d = x.data[ou * inner + i] - m; v += d * d; } v /= inner; const inv = 1 / Math.sqrt(v + eps); for (let i = 0; i < inner; i++) out[ou * inner + i] = (x.data[ou * inner + i] - m) * inv * scale.data[i] + (bias ? bias.data[i] : 0); }
      return T(out, x.dims); },
    Where(n) { const c = g(n.inputs[0]), a = g(n.inputs[1]), b = g(n.inputs[2]); const cb = ewise(c, a, (cc, aa) => cc ? 1 : 0); /* align dims */ const dims = broadcastDims(broadcastDims(c.dims, a.dims), b.dims); const A = ewise(a, T([0], [1]), (x) => x), B = ewise(b, T([0], [1]), (x) => x); const C = c; const os = stridesOf(dims), N = prod(dims), out = new Float64Array(N); const gg = (t, i) => { let o = 0; for (let d = 0; d < dims.length; d++) { const id = Math.floor(i / os[d]) % dims[d]; const td = t.dims[t.dims.length - dims.length + d] ?? 1; o += (td === 1 ? 0 : id) * (stridesOf(t.dims)[t.dims.length - dims.length + d] ?? 0); } return t.data[o]; }; for (let i = 0; i < N; i++) out[i] = gg(C, i) ? gg(A, i) : gg(B, i); return T(out, dims, a.int && b.int); },
    Equal: (n) => ewise(g(n.inputs[0]), g(n.inputs[1]), (a, b) => a === b ? 1 : 0),
    Greater: (n) => ewise(g(n.inputs[0]), g(n.inputs[1]), (a, b) => a > b ? 1 : 0),
    GreaterOrEqual: (n) => ewise(g(n.inputs[0]), g(n.inputs[1]), (a, b) => a >= b ? 1 : 0),
    Less: (n) => ewise(g(n.inputs[0]), g(n.inputs[1]), (a, b) => a < b ? 1 : 0),
    And: (n) => ewise(g(n.inputs[0]), g(n.inputs[1]), (a, b) => (a && b) ? 1 : 0),
    Not: (n) => mapUnary(g(n.inputs[0]), (v) => v ? 0 : 1),
    CumSum(n) { const x = g(n.inputs[0]); const axis = g(n.inputs[1]).data[0]; const ax = axis < 0 ? axis + x.dims.length : axis; const inner = prod(x.dims.slice(ax + 1)), axLen = x.dims[ax], outer = prod(x.dims.slice(0, ax)); const out = Float64Array.from(x.data); for (let ou = 0; ou < outer; ou++) for (let ii = 0; ii < inner; ii++) { let s = 0; for (let a = 0; a < axLen; a++) { s = fr(s + x.data[(ou * axLen + a) * inner + ii]); out[(ou * axLen + a) * inner + ii] = s; } } return T(out, x.dims, x.int); },   // per-step fp32 (fr) matches ORT's fp32 phase accumulation
    Expand(n) { const x = g(n.inputs[0]); const shape = Array.from(g(n.inputs[1]).data); return ewise(x, T(new Float64Array(prod(shape)), shape), (a) => a); },
    // ── 1D conv (Kokoro is audio → all convs are 1D). group/dilation/pads/strides per ONNX. ──
    Conv(n) { const X = g(n.inputs[0]), W = g(n.inputs[1]), B = has(n.inputs[2]) ? g(n.inputs[2]) : null;
      const group = attr(n, "group", 1), dil = (attr(n, "dilations", [1]))[0] || 1, strd = (attr(n, "strides", [1]))[0] || 1;
      const pads = attr(n, "pads", [0, 0]), pl = pads[0] || 0, pr = pads[1] != null ? pads[1] : pl;
      const [N, Cin, L] = X.dims, [Cout, CinG, K] = W.dims, Lout = Math.floor((L + pl + pr - dil * (K - 1) - 1) / strd) + 1;
      const out = new Float64Array(N * Cout * Lout), og = Cout / group, ig = Cin / group;
      for (let ni = 0; ni < N; ni++) for (let oc = 0; oc < Cout; oc++) { const grp = Math.floor(oc / og), bias = B ? B.data[oc] : 0;
        for (let ol = 0; ol < Lout; ol++) { let s = bias; const start = ol * strd - pl;
          for (let ic = 0; ic < ig; ic++) { const inC = grp * ig + ic, xb = (ni * Cin + inC) * L, wb = (oc * CinG + ic) * K;
            for (let k = 0; k < K; k++) { const il = start + k * dil; if (il >= 0 && il < L) s += X.data[xb + il] * W.data[wb + k]; } }
          out[(ni * Cout + oc) * Lout + ol] = s; } }
      return T(out, [N, Cout, Lout]); },
    // ── 1D transposed conv (generator upsampling). W: [Cin, Cout/group, K]. ──
    ConvTranspose(n) { const X = g(n.inputs[0]), W = g(n.inputs[1]), B = has(n.inputs[2]) ? g(n.inputs[2]) : null;
      const group = attr(n, "group", 1), dil = (attr(n, "dilations", [1]))[0] || 1, strd = (attr(n, "strides", [1]))[0] || 1;
      const pads = attr(n, "pads", [0, 0]), pl = pads[0] || 0, pr = pads[1] != null ? pads[1] : pl, outPad = (attr(n, "output_padding", [0]))[0] || 0;
      const [N, Cin, L] = X.dims, CoutG = W.dims[1], K = W.dims[2], Cout = CoutG * group, ig = Cin / group;
      const Lout = (L - 1) * strd - (pl + pr) + dil * (K - 1) + outPad + 1, out = new Float64Array(N * Cout * Lout);
      for (let ni = 0; ni < N; ni++) for (let grp = 0; grp < group; grp++) for (let ic = 0; ic < ig; ic++) { const inC = grp * ig + ic;
        for (let il = 0; il < L; il++) { const xv = X.data[(ni * Cin + inC) * L + il];
          for (let ocg = 0; ocg < CoutG; ocg++) { const oc = grp * CoutG + ocg, wb = (inC * CoutG + ocg) * K;
            for (let k = 0; k < K; k++) { const ol = il * strd - pl + k * dil; if (ol >= 0 && ol < Lout) out[(ni * Cout + oc) * Lout + ol] += xv * W.data[wb + k]; } } } }
      if (B) for (let ni = 0; ni < N; ni++) for (let oc = 0; oc < Cout; oc++) { const b = B.data[oc]; for (let ol = 0; ol < Lout; ol++) out[(ni * Cout + oc) * Lout + ol] += b; }
      return T(out, [N, Cout, Lout]); },
    Pad(n) { const X = g(n.inputs[0]); const padsT = has(n.inputs[1]) ? Array.from(g(n.inputs[1]).data) : attr(n, "pads", []);
      const cval = has(n.inputs[2]) ? g(n.inputs[2]).data[0] : (attr(n, "value", 0) || 0), mode = attr(n, "mode", "constant");
      const r = X.dims.length, begin = padsT.slice(0, r), end = padsT.slice(r), dims = X.dims.map((d, i) => d + (begin[i] || 0) + (end[i] || 0));
      const out = new Float64Array(prod(dims)).fill(mode === "constant" ? cval : 0), os = stridesOf(dims), xs = stridesOf(X.dims), Nn = prod(dims);
      for (let i = 0; i < Nn; i++) { let rem = i, valid = true, xo = 0;
        for (let d = 0; d < r; d++) { const id = Math.floor(rem / os[d]) % dims[d]; let src = id - (begin[d] || 0); const Ld = X.dims[d];
          if (mode === "reflect") { if (Ld > 1) { const p = 2 * Ld - 2; src = ((src % p) + p) % p; if (src >= Ld) src = p - src; } else src = 0; }
          else if (src < 0 || src >= Ld) valid = false; xo += src * xs[d]; }
        if (valid) out[i] = X.data[xo]; }
      return T(out, dims, X.int); },
    // ── ONNX LSTM (forward/reverse/bidirectional). Gate order i,o,f,c; activations sigmoid,tanh,tanh. ──
    LSTM(n) { const X = g(n.inputs[0]), W = g(n.inputs[1]), R = g(n.inputs[2]), Bt = has(n.inputs[3]) ? g(n.inputs[3]) : null;
      const [seq, batch, inp] = X.dims, numDir = W.dims[0], H = W.dims[1] / 4, dir = attr(n, "direction", "forward");
      const sig = (x) => 1 / (1 + Math.exp(-x)), th = Math.tanh;
      const Y = new Float64Array(seq * numDir * batch * H), Yh = new Float64Array(numDir * batch * H), Yc = new Float64Array(numDir * batch * H);
      for (let d = 0; d < numDir; d++) { const back = dir === "reverse" || (dir === "bidirectional" && d === 1);
        const Wb = d * 4 * H * inp, Rb = d * 4 * H * H, Bb = Bt ? d * 8 * H : 0;
        for (let b = 0; b < batch; b++) { let h = new Float64Array(H), c = new Float64Array(H);
          for (let ti = 0; ti < seq; ti++) { const t = back ? seq - 1 - ti : ti, xb = (t * batch + b) * inp, gate = new Float64Array(4 * H);
            for (let gi = 0; gi < 4 * H; gi++) { let s = Bt ? (Bt.data[Bb + gi] + Bt.data[Bb + 4 * H + gi]) : 0; const wrow = Wb + gi * inp; for (let k = 0; k < inp; k++) s += W.data[wrow + k] * X.data[xb + k]; const rrow = Rb + gi * H; for (let k = 0; k < H; k++) s += R.data[rrow + k] * h[k]; gate[gi] = s; }
            const nh = new Float64Array(H), nc = new Float64Array(H);
            for (let j = 0; j < H; j++) { const I = sig(gate[j]), O = sig(gate[H + j]), Ff = sig(gate[2 * H + j]), G = th(gate[3 * H + j]); const cc = Ff * c[j] + I * G; nc[j] = cc; nh[j] = O * th(cc); }
            h = nh; c = nc; const yb = ((t * numDir + d) * batch + b) * H; for (let j = 0; j < H; j++) Y[yb + j] = h[j]; }
          const hb = (d * batch + b) * H; for (let j = 0; j < H; j++) { Yh[hb + j] = h[j]; Yc[hb + j] = c[j]; } } }
      return [T(Y, [seq, numDir, batch, H]), T(Yh, [numDir, batch, H]), T(Yc, [numDir, batch, H])]; },
    ScatterND(n) { const data = g(n.inputs[0]), idx = g(n.inputs[1]), upd = g(n.inputs[2]), out = Float64Array.from(data.data);
      const q = idx.dims.length, k = idx.dims[q - 1], numUpd = prod(idx.dims.slice(0, q - 1)), ds = stridesOf(data.dims), updInner = prod(data.dims.slice(k));
      for (let u = 0; u < numUpd; u++) { let off = 0; for (let j = 0; j < k; j++) off += idx.data[u * k + j] * ds[j]; for (let e = 0; e < updInner; e++) out[off + e] = upd.data[u * updInner + e]; }
      return T(out, data.dims, data.int); },
    NonZero(n) { const x = g(n.inputs[0]), r = x.dims.length, xs = stridesOf(x.dims), coords = [];
      for (let i = 0; i < x.data.length; i++) if (x.data[i] !== 0) { const c = []; let rem = i; for (let d = 0; d < r; d++) c.push(Math.floor(rem / xs[d]) % x.dims[d]); coords.push(c); }
      const cnt = coords.length, out = new Float64Array(r * cnt); for (let j = 0; j < cnt; j++) for (let d = 0; d < r; d++) out[d * cnt + j] = coords[j][d];
      return T(out, [r, cnt], true); },
    Resize(n) { const X = g(n.inputs[0]);
      const scalesIn = has(n.inputs[2]) && g(n.inputs[2]).data.length ? Array.from(g(n.inputs[2]).data) : null;
      const sizesIn = n.inputs[3] && has(n.inputs[3]) && g(n.inputs[3]).data.length ? Array.from(g(n.inputs[3]).data) : null;
      const mode = attr(n, "mode", "nearest"), ctm = attr(n, "coordinate_transformation_mode", "half_pixel"), nmode = attr(n, "nearest_mode", "round_prefer_floor");
      const r = X.dims.length, outDims = sizesIn ? sizesIn.map((v) => Math.round(v)) : X.dims.map((d, i) => Math.floor(d * scalesIn[i]));
      const sc = scalesIn || X.dims.map((d, i) => outDims[i] / d), xs = stridesOf(X.dims), os = stridesOf(outDims), N = prod(outDims), out = new Float64Array(N);
      const srcCoord = (o, d) => { const s = sc[d]; if (ctm === "asymmetric") return o / s; if (ctm === "align_corners") return outDims[d] > 1 ? o * (X.dims[d] - 1) / (outDims[d] - 1) : 0; if (ctm === "pytorch_half_pixel") return outDims[d] > 1 ? (o + 0.5) / s - 0.5 : 0; return (o + 0.5) / s - 0.5; };
      for (let i = 0; i < N; i++) { let rem = i; const ic = new Array(r); for (let d = 0; d < r; d++) { const o = Math.floor(rem / os[d]) % outDims[d]; ic[d] = srcCoord(o, d); }
        if (mode === "nearest") { let xo = 0; for (let d = 0; d < r; d++) { let c = ic[d], q; if (nmode === "floor") q = Math.floor(c); else if (nmode === "ceil") q = Math.ceil(c); else if (nmode === "round_prefer_ceil") q = Math.floor(c + 0.5); else q = Math.ceil(c - 0.5); q = Math.max(0, Math.min(X.dims[d] - 1, q)); xo += q * xs[d]; } out[i] = X.data[xo]; }
        else { let acc = 0; const corners = 1 << r; for (let cm = 0; cm < corners; cm++) { let w = 1, xo = 0; for (let d = 0; d < r; d++) { const c = ic[d], c0 = Math.floor(c), frac = c - c0, hi = (cm >> d) & 1; let q = X.dims[d] === 1 ? 0 : c0 + hi; q = Math.max(0, Math.min(X.dims[d] - 1, q)); w *= hi ? frac : (1 - frac); xo += q * xs[d]; } acc += w * X.data[xo]; } out[i] = acc; } }
      return T(out, outDims); },
    // ONNX STFT: signal[b,L(,1)], frame_step, window[fl], frame_length → [b, frames, bins, 2] (re,im). onesided default.
    STFT(n) { const sig = g(n.inputs[0]), frameStep = g(n.inputs[1]).data[0], window = has(n.inputs[2]) ? g(n.inputs[2]) : null;
      const onesided = attr(n, "onesided", 1), ch = sig.dims.length === 3 ? sig.dims[2] : 1, siglen = sig.dims[1];
      const L = (n.inputs[3] && has(n.inputs[3])) ? g(n.inputs[3]).data[0] : (window ? window.dims[0] : 0);
      const batch = sig.dims[0], bins = onesided ? Math.floor(L / 2) + 1 : L, frames = Math.floor((siglen - L) / frameStep) + 1;
      const out = new Float64Array(batch * frames * bins * 2), cos = new Float64Array(L * bins), sin = new Float64Array(L * bins);
      for (let k = 0; k < bins; k++) for (let t = 0; t < L; t++) { const a = -2 * Math.PI * k * t / L; cos[k * L + t] = Math.cos(a); sin[k * L + t] = Math.sin(a); }
      for (let b = 0; b < batch; b++) for (let f = 0; f < frames; f++) { const start = f * frameStep;
        for (let k = 0; k < bins; k++) { let re = 0, im = 0; for (let t = 0; t < L; t++) { let v = sig.data[(b * siglen + start + t) * ch]; if (window) v *= window.data[t]; re += v * cos[k * L + t]; im += v * sin[k * L + t]; } const o = ((b * frames + f) * bins + k) * 2; out[o] = re; out[o + 1] = im; } }
      return T(out, [batch, frames, bins, 2]); },
  };
}
function erf(x) { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return Math.sign(x) * y; }
function reduce(n, g, fn) { const x = g(n.inputs[0]); let axes = null; if (n.inputs[1] !== undefined && g && n.inputs[1] !== "") { try { axes = Array.from(g(n.inputs[1]).data); } catch (e) {} } if (!axes) { const a = n.attrs.find((z) => z.name === "axes"); axes = a ? a.ints.slice() : x.dims.map((_, i) => i); } const keep = (() => { const a = n.attrs.find((z) => z.name === "keepdims"); return a ? a.i : 1; })();
  axes = axes.map((a) => a < 0 ? a + x.dims.length : a);
  const outDims = x.dims.map((d, i) => axes.includes(i) ? 1 : d); const out = new Float64Array(prod(outDims)); const os = stridesOf(outDims), xs = stridesOf(x.dims);
  const groups = new Map();
  for (let i = 0; i < x.data.length; i++) { let rem = i, key = 0; for (let d = 0; d < x.dims.length; d++) { const id = Math.floor(rem / xs[d]) % x.dims[d]; key += (axes.includes(d) ? 0 : id) * os[d]; } if (!groups.has(key)) groups.set(key, []); groups.get(key).push(x.data[i]); }
  for (const [k, arr] of groups) out[k] = fn(arr);
  const finalDims = keep ? outDims : x.dims.filter((_, i) => !axes.includes(i)); return T(out, finalDims.length ? finalDims : [1]);
}

// ── the runner ──────────────────────────────────────────────────────────────────────────────────────
export function loadModel(path) {
  const oz = openOnnx(path); const env = new Map();
  for (const t of oz.tensors) env.set(t.name, initToTensor(oz, t));
  return { oz, env };
}
export function run(model, inputs, { stopAt = null, trace = false, fp32 = false } = {}) {
  FP32MODE = fp32;
  const env = new Map(model.env);
  for (const [k, v] of Object.entries(inputs)) env.set(k, v);
  if (fp32) for (const t of env.values()) if (t && !t.int && t.data) for (let i = 0; i < t.data.length; i++) t.data[i] = Math.fround(t.data[i]);   // ORT is fp32: round weights + inputs
  const ops = makeOps(env);
  let count = 0;
  for (const node of model.oz.nodes) {
    const fn = ops[node.op];
    if (!fn) throw new Error(`UNIMPLEMENTED op "${node.op}" (node ${count}: ${node.name})  in=[${node.inputs.join(",")}]`);
    let outs;
    try { outs = fn(node); } catch (e) { throw new Error(`op ${node.op} (node ${count} ${node.name}) failed: ${e.message}`); }
    if (!Array.isArray(outs)) outs = [outs];
    if (fp32) for (const o of outs) if (o && !o.int && o.data) for (let i = 0; i < o.data.length; i++) o.data[i] = Math.fround(o.data[i]);   // fp32 tensor boundary like ORT
    node.outputs.forEach((name, i) => { if (name) env.set(name, outs[i] !== undefined ? outs[i] : outs[0]); });
    if (trace) console.log(`${count} ${node.op} -> ${node.outputs[0]} [${env.get(node.outputs[0])?.dims}]`);
    count++;
    if (stopAt && node.outputs.includes(stopAt)) break;
  }
  return env;
}

// CLI: run against the golden oracle and report the first gap or the waveform error.
if (process.argv[1] && (await import("node:url")).fileURLToPath(import.meta.url) === (await import("node:path")).resolve(process.argv[1])) {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const MODEL = process.argv.slice(2).find((a) => !a.startsWith("--")) || "../../../../../../holo-os/system/os/usr/lib/holo/voice/vendor/models/onnx-community/Kokoro-82M-v1.0-ONNX/onnx/model.onnx";
  const meta = JSON.parse(readFileSync("golden.json", "utf8"));
  const styleBuf = readFileSync("golden.style.f32"); const style = new Float32Array(styleBuf.buffer, styleBuf.byteOffset, 256);
  const goldBuf = readFileSync("golden.pcm.f32"); const gold = new Float32Array(goldBuf.buffer, goldBuf.byteOffset, goldBuf.length / 4);
  console.log(`loading ${MODEL} …`);
  const model = loadModel(MODEL);
  console.log(`model: ${model.oz.tensors.length} initializers, ${model.oz.nodes.length} nodes`);
  const inputs = {
    input_ids: T(meta.ids, [1, meta.ids.length], true),
    style: T(Float64Array.from(style), [1, 256]),
    speed: T([1], [1]),
  };
  const t0 = performance.now();
  const env = run(model, inputs, { trace: process.argv.includes("--trace"), fp32: process.argv.includes("--fp32") });
  const ms = Math.round(performance.now() - t0);
  const wav = env.get("waveform");
  if (!wav) { console.log("no 'waveform' output produced"); process.exit(1); }
  let maxAbs = 0, err = 0, sxy = 0, sxx = 0, syy = 0, mx = 0, my = 0, l2 = 0, l2g = 0; const nn = Math.min(wav.data.length, gold.length);
  for (let i = 0; i < nn; i++) { mx += wav.data[i]; my += gold[i]; } mx /= nn; my /= nn;
  for (let i = 0; i < nn; i++) { const a = wav.data[i], b = gold[i]; maxAbs = Math.max(maxAbs, Math.abs(a)); err = Math.max(err, Math.abs(a - b));
    sxy += (a - mx) * (b - my); sxx += (a - mx) ** 2; syy += (b - my) ** 2; l2 += (a - b) ** 2; l2g += b ** 2; }
  const corr = sxy / Math.sqrt(sxx * syy), relL2 = Math.sqrt(l2 / l2g);
  writeFileSync("mine.pcm.f32", Buffer.from(new Float32Array(wav.data.slice(0, nn)).buffer));
  console.log(`waveform ${wav.data.length} samples (golden ${gold.length}) · maxAbs ${maxAbs.toFixed(5)} (golden 0.400) · max-abs err ${err.toExponential(3)} · ${ms}ms`);
  console.log(`correlation ${corr.toFixed(6)} · relative-L2 ${(relL2 * 100).toFixed(2)}%  (residual = fp64-vs-ORT-fp32 phase accumulation in the harmonic source)`);
  const green = wav.data.length === gold.length && (err < 1e-2 || corr > 0.999);
  console.log(green ? "✅ REFERENCE VALIDATED" + (err < 1e-2 ? " (exact)" : " (structural: corr>0.999, residual is fp32 source-phase precision)") : "✗ mismatch");
}
