// Forge the BitNet TQ2_0 GGUF into a sealed .holo (per-tensor κ-bodies) so it rides the unified
// κ-stream loader, and print the tensor-type summary that drives the runtime kernel/forward wiring.
import { readFileSync, writeFileSync } from "node:fs";
import { writeHolo } from "../holo-archive.mjs";
import { parseGgufHeader } from "../../qvac-ingest.mjs";
import { GGML_TYPE_NAME } from "../gguf-forge.mjs";

const SRC = "./.models/bitnet-xl-tq2_0.gguf";
const OUT = "./.models/bitnet-xl-tq2_0.holo";
const bytes = new Uint8Array(readFileSync(SRC));
console.log(`read ${(bytes.length / 1e6 | 0)}MB gguf`);

const { tensors, meta } = parseGgufHeader(bytes);
const arch = meta["general.architecture"];
const typeCount = {}; for (const t of tensors) { const nm = GGML_TYPE_NAME[t.ggmlType] || t.ggmlType; typeCount[nm] = (typeCount[nm] || 0) + 1; }
const has = (suffix) => tensors.some((t) => t.name.endsWith(suffix));
const sample = (name) => { const t = tensors.find((x) => x.name === name); return t ? `${GGML_TYPE_NAME[t.ggmlType] || t.ggmlType} ${JSON.stringify(t.dims)}` : "(absent)"; };
console.log("arch:", arch, "| nTensors:", tensors.length);
console.log("type histogram:", typeCount);
console.log("has attn_q.bias:", has("attn_q.bias"), "| has attn_sub_norm:", has("attn_sub_norm.weight"), "| has ffn_sub_norm:", has("ffn_sub_norm.weight"), "| has output.weight:", has("output.weight"));
for (const n of ["token_embd.weight", "blk.0.attn_q.weight", "blk.0.attn_output.weight", "blk.0.ffn_down.weight", "output_norm.weight", "blk.0.attn_sub_norm.weight"]) console.log("  ", n, "=>", sample(n)); // gitleaks:allow — GGUF tensor names, not a secret (entropy false-positive)

const { holo, rootHolo, nBodies, nTensors, bytes: outLen } = writeHolo(bytes);
writeFileSync(OUT, holo);
console.log(`\nwrote ${OUT} (${(outLen / 1e6 | 0)}MB, ${nTensors} tensors, ${nBodies} unique bodies)`);
console.log("rootHolo:", rootHolo);
