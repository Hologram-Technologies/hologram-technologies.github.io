// Per-expert κ directory — make each MoE expert independently content-addressable.
//
// A forged MoE keeps each blk.L.ffn_{gate,up,down}_exps as ONE stacked [K,N,E]
// κ-object holding all E experts' verbatim quant bytes (gguf-forge.mjs). The router
// selects only n_expert_used of them per token, but the executor still loads the
// whole stack to reach a slice (gguf-forge-exec.mjs:107). This module derives, per
// expert e, the hash of its EXACT byte-range within that stack — an ADDITIVE index:
// the whole-tensor κ is unchanged, the per-expert κ-objects are subarrays of the
// same bytes, so L5 holds at BOTH granularities and a sparse loader can fetch only
// the routed experts.
//
// Laws: L1 the directory is content-addressed and bound to the model root κ; L2
// byte-identical experts dedup to one κ; L5 each expert κ re-derives to its slice
// or refuses. holospaces github.com/Hologram-Technologies/holospaces.

import { sha256hex, kappa, didHolo, jcs } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";
import { GGML_TYPE_NAME, ggmlNBytes, loadByKappa } from "./gguf-forge.mjs";

// Stacked expert tensors as named by llama.cpp's GGUF writer (ffn_*_exps).
const EXPERT_RE = /\.ffn_(gate|up|down)_exps\.weight$/;
export const isExpertTensor = (name) => EXPERT_RE.test(name);

// Build the per-expert directory from a forge result {tensors, blocks, rootKappa}.
// Returns { dir, dirKappa, expertBlocks } where expertBlocks is a Map<hex,Uint8Array>
// of the ADDITIVE sub-block κ-objects (owned copies of each expert's slice).
// opts.storeBlocks=false skips the byte copies (compute κ only) — for multi-GB real
// models where the slices are served lazily as views over the whole-stack block.
export function buildExpertDirectory(forge, { storeBlocks = true } = {}) {
  const { tensors, blocks } = forge;
  const expertBlocks = new Map();
  const dirTensors = {};
  for (const t of tensors) {
    if (!isExpertTensor(t.name)) continue;
    if (!t.dims || t.dims.length < 3) throw new Error(`expert-dir: ${t.name} is not a stacked [K,N,E] tensor (dims ${t.dims})`);
    const K = t.dims[0], N = t.dims[1], E = t.dims[2];
    const stride = ggmlNBytes(t.type, K * N);               // == expertStride(type,K,N)
    if (stride * E !== t.nbytes) throw new Error(`expert-dir: ${t.name} stride*E (${stride * E}) != nbytes (${t.nbytes})`);
    const hex = String(t.kappa).split(":").pop();
    const whole = blocks.get(hex);
    if (!whole) throw new Error(`expert-dir: no block bytes for ${t.name} (${t.kappa})`);
    if (whole.byteLength !== t.nbytes) throw new Error(`expert-dir: ${t.name} block ${whole.byteLength}B != nbytes ${t.nbytes}`);
    const experts = [];
    for (let e = 0; e < E; e++) {
      const slice = whole.subarray(e * stride, (e + 1) * stride);
      const sh = sha256hex(slice);
      if (storeBlocks && !expertBlocks.has(sh)) expertBlocks.set(sh, slice.slice());   // own bytes; L2 dedup by content
      experts.push({ e, kappa: kappa("sha256", sh) });
    }
    dirTensors[t.name] = { type: t.type, typeName: GGML_TYPE_NAME[t.type] || String(t.type), dims: [K, N, E], stride, nExpert: E, experts };
  }
  // Bound to the model (rootKappa) so the directory cannot be silently re-pointed.
  const dir = { format: "gguf-forge-expert-dir/1", model: forge.rootKappa || null, tensors: dirTensors };
  const dirKappa = didHolo("sha256", sha256hex(jcs(dir)));
  return { dir, dirKappa, expertBlocks };
}

// Resolve one expert's sub-block κ from a directory (by stacked-tensor name + index).
export function expertKappa(dir, tensorName, e) {
  const td = dir.tensors[tensorName];
  if (!td) throw new Error(`expert-dir: ${tensorName} not in directory`);
  const ent = td.experts[e];
  if (!ent) throw new Error(`expert-dir: expert ${e} out of range for ${tensorName} (n=${td.nExpert})`);
  return ent.kappa;
}

// L5 load of ONE expert's slice bytes by κ from a store (refuses on mismatch).
export function loadExpertSlice(store, dir, tensorName, e, load = loadByKappa) {
  return load(store, expertKappa(dir, tensorName, e));
}
