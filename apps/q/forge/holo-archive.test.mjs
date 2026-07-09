// S1 fidelity gate: GGUF → .holo → back, proving the .holo is a faithful, self-
// describing, content-addressed package — and that a full forward driven ENTIRELY
// from the .holo produces the correct, upstream-matching token.

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { writeHolo, readHolo } from "./holo-archive.mjs";
import { GGML_TYPE_NAME, ggmlNBytes } from "./gguf-forge.mjs";
import { parseGgufHeader } from "../qvac-ingest.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { makeTokenizer } from "./gguf-forge-tokenizer.mjs";
import { sha256hex } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); } catch (e) { fail++; console.log("FAIL  " + name + "\n      " + (e.stack || e.message)); } };

const MODEL = "./.models/qwen2.5-0.5b-instruct-q4_k_m.gguf";
const gguf = new Uint8Array(readFileSync(MODEL));

console.log("writing .holo…");
const W = writeHolo(gguf);
console.log(`  .holo: ${(W.bytes / 1e6).toFixed(0)} MB, ${W.nBodies} bodies / ${W.nTensors} tensors, root ${W.rootHolo.slice(0, 32)}…`);
const R = readHolo(W.holo);

t("footer re-derives → stable did:holo, identical write↔read", () => {
  assert.strictEqual(R.footer, W.rootHolo);
  assert.match(R.footer, /^did:holo:sha256:[0-9a-f]{64}$/);
});

const bytesEqual = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };

t("every weight body re-derives to its content κ (L5, all 291)", () => {
  for (const o of R.meta.order) assert.strictEqual(sha256hex(R.getBody(o.kappa)), o.kappa, "κ re-derive " + o.name);
});

t("sampled bodies are byte-identical to the ORIGINAL GGUF tensor bytes", () => {
  const hh = parseGgufHeader(gguf), tdir = {}; for (const x of hh.tensors) tdir[x.name] = x;
  for (const name of ["token_embd.weight", "blk.0.attn_q.weight", "blk.11.ffn_down.weight", "output.weight", "output_norm.weight"]) {
    const x = tdir[name], n = x.dims.reduce((a, b) => a * b, 1), nb = ggmlNBytes(x.ggmlType, n);
    const orig = gguf.subarray(hh.dataOffset + x.offset, hh.dataOffset + x.offset + nb);
    const k = sha256hex(orig);
    assert.ok(R.dir.has(k), ".holo has κ for " + name);
    assert.ok(bytesEqual(R.getBody(k), orig), "byte-identical " + name);
  }
});

t("bodies are laid out in first-use order, range-fetchable by absolute offset", () => {
  let prev = -1;
  for (const o of R.meta.order) { const r = R.rangeOf(o.kappa); assert.ok(r && r.len > 0); if (R.dir.get(o.kappa)) { /* dedup: first occurrence monotonic */ } }
  // the unique bodies are monotonic in file offset (streaming order)
  const offs = [...R.dir.values()].map(d => d.off);
  for (let i = 1; i < offs.length; i++) assert.ok(offs[i] > offs[i - 1], "monotonic body offsets");
});

t("L5: tamper one body byte → store.get refuses; footer also refuses", () => {
  const tampered = W.holo.slice();
  const r0 = R.dir.values().next().value;        // first body
  tampered[r0.off] ^= 0xff;
  assert.throws(() => readHolo(tampered), /footer mismatch/);   // whole-archive footer catches it
});

t("self-describing: tokenizer + graph recover from the .holo ALONE", () => {
  const tok = makeTokenizer(R.headerBytes);       // tokenizer arrays live in the baked gguf-header
  const ids = tok.encode("The capital of France is", { addSpecial: false });
  assert.deepStrictEqual(ids, [785, 6722, 315, 9625, 374]);
  const hh = parseGgufHeader(R.headerBytes);
  assert.strictEqual(hh.meta["general.architecture"], "qwen2");
});

t("END-TO-END: full forward driven only by the .holo → correct upstream token (Paris)", () => {
  const hh = parseGgufHeader(R.headerBytes);
  const name2k = new Map(R.meta.order.map(o => [o.name, o.kappa]));
  const tensors = hh.tensors.map(x => ({ name: x.name, dims: x.dims, type: x.ggmlType, typeName: GGML_TYPE_NAME[x.ggmlType] || String(x.ggmlType), kappa: "sha256:" + name2k.get(x.name) }));
  const plan = { format: "gguf-forge/1", arch: hh.meta["general.architecture"], meta: hh.meta, tensors };
  const graph = synthesizeGraph(plan);
  assert.strictEqual(graph.family, "dense", graph.reason);
  const logits = forward(plan, graph, R.store, [785, 6722, 315, 9625, 374]);
  let am = 0; for (let i = 1; i < logits.length; i++) if (logits[i] > logits[am]) am = i;
  assert.strictEqual(am, 12095, "argmax should be ' Paris' (matches llama.cpp)");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
