// onnx-tensors.mjs — minimal, dependency-free reader for an ONNX model's INITIALIZERS (the weights).
//
// StyleTTS2/Kokoro ships as ONE ONNX graph (protobuf). We don't need a full ONNX runtime — only the named
// weight tensors, to feed our WGSL kernels and to build a pure-JS reference forward. This walks just enough
// of the protobuf wire format to enumerate graph.initializer[] → { name, dims, dtype, raw:[off,len] } WITHOUT
// copying the (hundreds of MB of) tensor bytes: it records byte ranges into the mmapped file, sliced lazily.
//
// Wire format: tag = (field<<3)|wtype. wtype 0=varint, 1=i64, 2=len-delim(len varint + bytes), 5=i32.
// ModelProto.graph = field 7 (msg). GraphProto.initializer = field 5 (repeated TensorProto).
// TensorProto: dims=1 (repeated int64 varint), data_type=2 (varint), name=8 (string), raw_data=9 (bytes).
// data_type: 1=FLOAT32 · 2=UINT8 · 3=INT8 · 6=INT32 · 7=INT64 · 10=FLOAT16 · 11=FLOAT64.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const DTYPE = { 1: "f32", 2: "u8", 3: "i8", 6: "i32", 7: "i64", 10: "f16", 11: "f64" };
const DBYTES = { f32: 4, u8: 1, i8: 1, i32: 4, i64: 8, f16: 2, f64: 8 };

// read a base-128 varint at buf[p]; returns [value(Number — safe for our sizes), nextPos].
function varint(buf, p) {
  let shift = 0, val = 0;
  for (;;) {
    const b = buf[p++];
    val += (b & 0x7f) * Math.pow(2, shift);   // Number math: dims/offsets stay < 2^53 here
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return [val, p];
}

// exact SIGNED int64 varint read (protobuf int64: negatives are 10-byte sign-extended, e.g. axis=-1 = 2^64-1
// as unsigned — Number math would lose the sign). Used for attribute ints, which are commonly -1.
function varintSignedAt(buf, p) { let shift = 0n, val = 0n; for (;;) { const b = buf[p++]; val |= BigInt(b & 0x7f) << shift; if (!(b & 0x80)) break; shift += 7n; } return [Number(BigInt.asIntN(64, val)), p]; }
function varintSigned(buf, p) { return varintSignedAt(buf, p)[0]; }

// iterate the (tag, payload-descriptor) fields of a length-delimited message region [start,end).
function* fields(buf, start, end) {
  let p = start;
  while (p < end) {
    let tag; [tag, p] = varint(buf, p);
    const field = tag >>> 3, wtype = tag & 7;
    if (wtype === 0) { const vo = p; let v; [v, p] = varint(buf, p); yield { field, wtype, v, vo }; }
    else if (wtype === 2) { let len; [len, p] = varint(buf, p); yield { field, wtype, off: p, len }; p += len; }
    else if (wtype === 1) { yield { field, wtype, off: p, len: 8 }; p += 8; }
    else if (wtype === 5) { yield { field, wtype, off: p, len: 4 }; p += 4; }
    else throw new Error("bad wtype " + wtype + " @" + p);
  }
}

// AttributeProto (partial): name=1(str), i=3(int varint), ints=8(repeated int), f=2(float32), type=20.
function parseAttr(buf, start, end) {
  const a = { name: "", i: null, ints: [], f: null, s: null };
  for (const fl of fields(buf, start, end)) {
    if (fl.field === 1 && fl.wtype === 2) a.name = buf.toString("utf8", fl.off, fl.off + fl.len);
    else if (fl.field === 3 && fl.wtype === 0) a.i = varintSigned(buf, fl.vo);   // signed: axis=-1 etc.
    else if (fl.field === 2 && fl.wtype === 5) a.f = buf.readFloatLE(fl.off);
    else if (fl.field === 4 && fl.wtype === 2) a.s = buf.toString("utf8", fl.off, fl.off + fl.len);   // string attr (Pad mode, LSTM direction…)
    else if (fl.field === 5 && fl.wtype === 2) a.f = tensorScalar(buf, parseTensor(buf, fl.off, fl.off + fl.len));   // TENSOR attr (ConstantOfShape.value) → scalar into .f
    else if (fl.field === 8 && fl.wtype === 0) a.ints.push(varintSigned(buf, fl.vo));   // repeated int (unpacked)
    else if (fl.field === 8 && fl.wtype === 2) { for (let q = fl.off; q < fl.off + fl.len;) { let v; [v, q] = varintSignedAt(buf, q); a.ints.push(v); } }   // packed
  }
  return a;
}

// NodeProto: input=1(str), output=2(str), name=3(str), op_type=4(str), attribute=5(AttributeProto), domain=7.
function parseNode(buf, start, end) {
  const n = { op: "", name: "", inputs: [], outputs: [], attrs: [] };
  for (const f of fields(buf, start, end)) {
    if (f.field === 1 && f.wtype === 2) n.inputs.push(buf.toString("utf8", f.off, f.off + f.len));
    else if (f.field === 2 && f.wtype === 2) n.outputs.push(buf.toString("utf8", f.off, f.off + f.len));
    else if (f.field === 3 && f.wtype === 2) n.name = buf.toString("utf8", f.off, f.off + f.len);
    else if (f.field === 4 && f.wtype === 2) n.op = buf.toString("utf8", f.off, f.off + f.len);
    else if (f.field === 5 && f.wtype === 2) n.attrs.push(parseAttr(buf, f.off, f.off + f.len));
  }
  return n;
}

// decode the first element of a (usually scalar) TensorProto attribute → Number (ConstantOfShape.value fill).
function tensorScalar(buf, t) {
  if (!t.raw) return 0; const off = t.raw[0];
  switch (t.dtype) {
    case "f32": return buf.readFloatLE(off); case "f64": return buf.readDoubleLE(off);
    case "i64": return Number(buf.readBigInt64LE(off)); case "i32": return buf.readInt32LE(off);
    case "i8": return buf.readInt8(off); case "u8": return buf.readUInt8(off);
    default: return 0;
  }
}

function parseTensor(buf, start, end) {
  const t = { name: "", dims: [], dtype: null, raw: null };
  for (const f of fields(buf, start, end)) {
    if (f.field === 1 && f.wtype === 0) t.dims.push(f.v);                 // dims (non-packed int64 varint)
    else if (f.field === 1 && f.wtype === 2) { for (let q = f.off; q < f.off + f.len;) { let v; [v, q] = varint(buf, q); t.dims.push(v); } }  // packed dims
    else if (f.field === 2 && f.wtype === 0) t.dtype = DTYPE[f.v] || ("dt" + f.v);
    else if (f.field === 8 && f.wtype === 2) t.name = buf.toString("utf8", f.off, f.off + f.len);
    else if (f.field === 9 && f.wtype === 2) t.raw = [f.off, f.len];      // raw_data byte range
  }
  return t;
}

// open(path) → { buf, tensors: [{name,dims,dtype,raw:[off,len],count}], byName(name), read(name)->TypedArray }
export function openOnnx(path) {
  const buf = readFileSync(path);
  // top level: find graph (field 7)
  let graph = null;
  for (const f of fields(buf, 0, buf.length)) { if (f.field === 7 && f.wtype === 2) { graph = f; break; } }
  if (!graph) throw new Error("no graph field in " + path);
  const tensors = [], nodes = [];
  for (const f of fields(buf, graph.off, graph.off + graph.len)) {
    if (f.field === 5 && f.wtype === 2) {                                 // initializer (TensorProto)
      const t = parseTensor(buf, f.off, f.off + f.len);
      t.count = t.dims.reduce((a, b) => a * b, 1);
      tensors.push(t);
    } else if (f.field === 1 && f.wtype === 2) {                          // node (NodeProto) — in topological order
      nodes.push(parseNode(buf, f.off, f.off + f.len));
    }
  }
  const map = new Map(tensors.map((t) => [t.name, t]));
  function read(name) {
    const t = map.get(name); if (!t || !t.raw) return null;
    const [off, len] = t.raw, view = buf.subarray(off, off + len);
    if (t.dtype === "f32") return new Float32Array(view.buffer, view.byteOffset, len / 4);
    if (t.dtype === "f16") return view;                                   // caller decodes (Uint8 pairs)
    if (t.dtype === "i64") return view;                                   // caller decodes if needed
    if (t.dtype === "i32") return new Int32Array(view.buffer, view.byteOffset, len / 4);
    if (t.dtype === "i8") return new Int8Array(view.buffer, view.byteOffset, len);
    if (t.dtype === "u8") return new Uint8Array(view.buffer, view.byteOffset, len);
    return view;
  }
  return { buf, tensors, nodes, byName: (n) => map.get(n), read };
}

// CLI: `node onnx-tensors.mjs <model.onnx> [--full]` → prints the weight inventory (the architecture spec).
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const path = process.argv[2];
  if (!path) { console.error("usage: node onnx-tensors.mjs <model.onnx> [--full]"); process.exit(1); }
  const { tensors, nodes } = openOnnx(path);
  if (process.argv.includes("--nodes")) {
    const hist = new Map();
    for (const n of nodes) hist.set(n.op, (hist.get(n.op) || 0) + 1);
    console.log(`# ${nodes.length} nodes · ${hist.size} distinct ops`);
    for (const [op, c] of [...hist.entries()].sort((a, b) => b[1] - a[1])) console.log(`${String(c).padStart(5)}  ${op}`);
    if (process.argv.includes("--full")) {                                // ordered dataflow (op: inputs → outputs)
      console.log("\n# --- ordered nodes (topological) ---");
      const brief = (s) => s.length > 46 ? s.slice(0, 43) + "…" : s;      // trim the verbose /path/Constant names
      for (const n of nodes) console.log(`${n.op.padEnd(16)} ${brief(n.inputs.join(","))}  ->  ${brief(n.outputs.join(","))}`);
    }
  } else {
    const full = process.argv.includes("--full");
    let bytes = 0, params = 0;
    for (const t of tensors) { bytes += (t.raw ? t.raw[1] : 0); params += t.count; }
    console.log(`# ${tensors.length} initializers · ${(params / 1e6).toFixed(1)}M params · ${(bytes / 1e6).toFixed(1)} MB raw`);
    const list = full ? tensors : tensors.slice(0, 120);
    for (const t of list) console.log(`${t.dtype.padEnd(4)} [${t.dims.join(",")}]`.padEnd(28) + t.name);
    if (!full && tensors.length > 120) console.log(`… ${tensors.length - 120} more (use --full)`);
  }
}
