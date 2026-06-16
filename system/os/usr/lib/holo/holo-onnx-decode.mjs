// holo-onnx-decode.mjs — the browser leg of the resident-GPU int4 decode engine
// (ADR-0101 GE-5). The engine itself is Rust/WebGPU, compiled to wasm
// (`crates/hologram-decode-wasm`, exposed as `WasmDecoder`); this module is the thin JS
// that STREAMS a `.holo` model's weight κ-blocks onto the GPU and drives the generation
// loop. No model bytes are ever held by a server: each weight is a κ-addressed block
// pulled from the OS2 κ-store / Service-Worker gateway and re-derived against its κ (L5).
//
//   Law L1 — a weight is identified by its κ-label, not a path/URL.
//   Law L3 — the content-addressed store is the address space; the SW serves /.holo/blake3/<κ>.
//   Law L5 — every block is re-derived against its κ before it reaches the GPU.
//
// The engine's API (see the wasm `WasmDecoder`):
//   JsDims(nh, hd, ff, vocab, max_seq, group, n_layers)
//   WasmDecoder.create(dims, blob: Uint8Array, offsets: Uint32Array) -> Promise<WasmDecoder>
//   decoder.decode(token, pos) -> Promise<number>          // greedy next-token id
//
// The model arrives as ONE `blob` (the concatenated weight bytes) plus an `offsets`
// table delimiting each tensor, in the canonical order the engine expects:
//   embed, final_norm, lm_head, then per layer
//   [norm_a, wq, wk, wv, wo, norm_f, wg, wu, wd].
// A manifest lists the weight κ-refs in exactly this order; we stream each block and
// concatenate. (This is the demand-paging the Stage-2 WeightIndex + Stage-3 Range
// transport were built for — a model pages onto the GPU as it loads.)

import { blake3hex } from "./holo-blake3.mjs";

/// The per-layer weight tensors, in the engine's canonical order.
const LAYER_ORDER = ["norm_a", "wq", "wk", "wv", "wo", "norm_f", "wg", "wu", "wd"];

/// Default block fetcher: pull a weight κ-block from the Service-Worker κ-store gateway
/// (`/.holo/blake3/<hex>`, the Stage-3 Range transport — the SW re-derives the bytes
/// against the κ before serving, L5). Returns the raw f32-LE weight bytes.
export async function fetchBlockByKappa(kappa) {
  const hex = kappa.startsWith("blake3:") ? kappa.slice("blake3:".length) : kappa;
  const res = await fetch(`/.holo/blake3/${hex}`);
  if (!res.ok) throw new Error(`weight block ${kappa} → HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/// Order the manifest's weight κ-refs into the engine's canonical sequence:
/// [embed, final_norm, lm_head, then each layer's nine tensors].
function orderedRefs(manifest) {
  const refs = [manifest.embed, manifest.final_norm, manifest.lm_head];
  for (const layer of manifest.layers) {
    for (const name of LAYER_ORDER) refs.push(layer[name]);
  }
  return refs;
}

/// Stream every weight κ-block (in canonical order) and pack them into a single `blob`
/// + an `offsets` table (length = #tensors + 1, the last entry being the blob end) —
/// exactly the shape `WasmDecoder.create` consumes. `getBlock` defaults to the SW κ-store
/// gateway; pass a `(κ) → Uint8Array` to source blocks elsewhere (tests, an in-page store).
/// Optionally verifies each block's κ before it is admitted (L5, belt-and-suspenders on top
/// of the SW's own re-derivation).
export async function streamModel(manifest, { getBlock = fetchBlockByKappa, verify = false } = {}) {
  const refs = orderedRefs(manifest);
  const blocks = [];
  let total = 0;
  for (const ref of refs) {
    const bytes = await getBlock(ref);
    if (verify) {
      const got = `blake3:${await blake3hex(bytes)}`;
      if (got !== ref) throw new Error(`weight κ mismatch: expected ${ref}, derived ${got}`);
    }
    blocks.push(bytes);
    total += bytes.length;
  }
  const blob = new Uint8Array(total);
  const offsets = new Uint32Array(refs.length + 1);
  let at = 0;
  for (let i = 0; i < blocks.length; i++) {
    offsets[i] = at;
    blob.set(blocks[i], at);
    at += blocks[i].length;
  }
  offsets[blocks.length] = at;
  return { blob, offsets };
}

/// Build a GPU-resident decoder from a streamed model. `wasm` is the initialized
/// `hologram-decode-wasm` module (`{ JsDims, WasmDecoder }`); `manifest` carries the dims
/// and the ordered weight κ-refs. Returns the live `WasmDecoder` (weights uploaded once,
/// resident) — call `.decode(token, pos)` to generate.
export async function createDecoder(wasm, manifest, opts = {}) {
  const { dims } = manifest;
  const { blob, offsets } = await streamModel(manifest, opts);
  const jsDims = new wasm.JsDims(
    dims.nh,
    dims.hd,
    dims.ff,
    dims.vocab,
    dims.max_seq,
    dims.group,
    manifest.layers.length,
  );
  return wasm.WasmDecoder.create(jsDims, blob, offsets);
}

/// Run a greedy generation loop on the resident decoder: feed `promptTokens`, then sample
/// `maxNew` more, feeding each back in. Returns `{ tokens, tokPerSec }`. The KV-cache lives
/// on the GPU across steps, so each call is one submission + a 4-byte readback.
export async function generate(decoder, promptTokens, maxNew) {
  const out = [];
  let pos = 0;
  let token = promptTokens[0] ?? 0;
  // Prime the cache with the prompt (each step also samples, but we keep the given tokens).
  for (let i = 1; i < promptTokens.length; i++) {
    await decoder.decode(token, pos++);
    token = promptTokens[i];
  }
  const t0 = (globalThis.performance ?? Date).now();
  for (let i = 0; i < maxNew; i++) {
    token = await decoder.decode(token, pos++);
    out.push(token);
  }
  const secs = ((globalThis.performance ?? Date).now() - t0) / 1000;
  return { tokens: out, tokPerSec: secs > 0 ? maxNew / secs : Infinity };
}
