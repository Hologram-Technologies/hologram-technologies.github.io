// onnx-expose.mjs — protobuf surgery: append internal tensor names to GraphProto.output so ONNX Runtime will
// return them. This turns any intermediate into a fetchable output → a per-node ORT ground-truth oracle to diff
// the JS interpreter (onnx-run.mjs) against and pin the first divergent op. Name-only ValueInfoProto (ORT infers
// type from the graph); if a build rejects untyped outputs, add a minimal TypeProto (not needed for ORT-web here).
//
// GraphProto.output = field 12 (repeated ValueInfoProto). ValueInfoProto.name = field 1 (string). ModelProto.graph
// = field 7. We append the new outputs at the END of the graph submessage (protobuf fields may appear in any order)
// and rewrite the graph's length prefix.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

function readVarint(buf, p) { let shift = 0, val = 0; for (;;) { const b = buf[p++]; val += (b & 0x7f) * Math.pow(2, shift); if (!(b & 0x80)) break; shift += 7; } return [val, p]; }
function encVarint(v) { const out = []; for (;;) { let b = v & 0x7f; v = Math.floor(v / 128); if (v) out.push(b | 0x80); else { out.push(b); break; } } return out; }

// scan top-level ModelProto fields for graph (field 7, wire type 2) → its tag+payload location.
function findGraph(buf) {
  let p = 0;
  while (p < buf.length) {
    const tagStart = p; let tag; [tag, p] = readVarint(buf, p); const field = tag >>> 3, wt = tag & 7;
    if (wt === 2) { let len; [len, p] = readVarint(buf, p); if (field === 7) return { tagStart, tag, payloadStart: p, payloadLen: len }; p += len; }
    else if (wt === 0) { [, p] = readVarint(buf, p); }
    else if (wt === 1) p += 8;
    else if (wt === 5) p += 4;
    else throw new Error("bad wire type " + wt + " @" + tagStart);
  }
  throw new Error("no graph (field 7) at top level");
}

function valueInfoBytes(name) {
  const nb = Buffer.from(name, "utf8");
  // TypeProto{ tensor_type: { elem_type: 1(float) } } — ORT-web needs typed graph outputs (untyped → shape-infer abort).
  const typeBytes = [0x0a, 0x02, 0x08, 0x01];                  // TypeProto.tensor_type(f1) → Tensor.elem_type(f1)=1
  const typeField = [0x12, ...encVarint(typeBytes.length), ...typeBytes];   // ValueInfoProto.type (field 2)
  const nameField = [0x0a, ...encVarint(nb.length), ...nb];    // ValueInfoProto.name (field 1)
  const inner = nameField.concat(typeField);
  return [0x62, ...encVarint(inner.length), ...inner];         // GraphProto.output: field 12
}

export function exposeOutputs(inPath, names, outPath) {
  const buf = readFileSync(inPath);
  const g = findGraph(buf);
  const tagBytes = encVarint(g.tag);                           // field-7 tag varint (usually one byte 0x3a)
  const add = []; for (const n of names) add.push(...valueInfoBytes(n));
  const addBuf = Buffer.from(add);
  const newLen = g.payloadLen + addBuf.length;
  const out = Buffer.concat([
    buf.subarray(0, g.tagStart),                               // everything before the graph field
    Buffer.from(tagBytes),                                     // graph tag
    Buffer.from(encVarint(newLen)),                            // NEW length
    buf.subarray(g.payloadStart, g.payloadStart + g.payloadLen), // old graph payload
    addBuf,                                                    // + the new output entries
    buf.subarray(g.payloadStart + g.payloadLen),              // top-level fields after graph
  ]);
  writeFileSync(outPath, out);
  return { added: names.length, oldGraphLen: g.payloadLen, newGraphLen: newLen, fileBytes: out.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [inPath, outPath, ...names] = process.argv.slice(2);
  if (!inPath || !outPath || !names.length) { console.error("usage: node onnx-expose.mjs <in.onnx> <out.onnx> <tensor> [tensor…]"); process.exit(1); }
  console.log(exposeOutputs(inPath, names, outPath));
}
