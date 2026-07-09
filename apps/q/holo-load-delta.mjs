// holo-load-delta.mjs — A2 LOAD wiring. Loads a family finetune stored as `base-κ + delta` (format
// "holo-delta/1", produced by _delta-build.mjs) and returns the SAME { manifest, fetchTensor, info } shape
// as holo-load2bit.loadKappaObject — so the GPU engine, KV-cache, and Q's brain loader are UNCHANGED.
// loadKappaObject delegates here automatically when it sees the holo-delta/1 format (one seam, hidden).
//
// Per tensor: ref → the base block (frozen, κ identical, dedup'd in the OPFS store); whole → the stored
// finetune block; bytedelta → base block + lossless byte-delta. Reconstruction is byte-identical to the
// finetune's own block ⇒ perplexity = standalone (no quality gate). The win is download/storage.
//
// Law L5: base AND delta blocks are each κ-verified (sha256(gz)==κ) before use; both κ are named in the
// L5-verified delta manifest, so the trust chain holds without re-hashing the reconstruction.
import { parseDelta, applyByteDelta } from "./holo-delta.mjs";
import { reshapeTensor, buildEngineManifest } from "./holo-load2bit.mjs";

async function gunzip(u8) { const ds = new DecompressionStream("gzip"); const w = ds.writable.getWriter(); w.write(u8); w.close(); return new Uint8Array(await new Response(ds.readable).arrayBuffer()); }
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const kFile = (k) => String(k).replace(":", "_");   // κ "sha256:<hex>" → block file "sha256_<hex>"

export async function loadDeltaObject(deltaUrl, opts = {}) {
  const droot = String(deltaUrl).replace(/\/+$/, "");
  const man = opts.manifest || await (await fetch(droot + "/manifest.json", { cache: "no-store" })).json();
  const baseRoot = String(opts.baseUrl || man.base?.url || man.base?.dir || "").replace(/\/+$/, "");
  if (!baseRoot) throw new Error("delta-load: no base location (opts.baseUrl or manifest.base.url)");

  // κ-verified block fetch against a chosen root (base for frozen/base blocks, delta for delta blocks).
  const getBlock = async (root, kappa) => {
    const gz = new Uint8Array(await (await fetch(root + "/b/" + kFile(kappa) + ".gz", { cache: "no-store" })).arrayBuffer());
    const got = "sha256:" + hex(await crypto.subtle.digest("SHA-256", gz));
    if (got !== kappa) throw new Error("delta-load κ MISMATCH " + String(kappa).slice(0, 24));
    return gunzip(gz);
  };

  const normRecs = {};                                   // {name → {N,K,fmt,fp16?,s?}} for the shared manifest builder
  for (const [name, dr] of Object.entries(man.tensors)) normRecs[name] = dr.meta || {};

  const fetchTensor = async (name) => {
    const dr = man.tensors[name]; if (!dr) return new Uint8Array(0);
    let raw;
    if (dr.kind === "ref") raw = await getBlock(baseRoot, dr.kappa);                                   // frozen
    else if (dr.kind === "whole") raw = parseDelta(await getBlock(droot, dr.delta)).bytes;             // stored whole
    else if (dr.kind === "bytedelta") raw = applyByteDelta(await getBlock(baseRoot, dr.base), parseDelta(await getBlock(droot, dr.delta)));
    else throw new Error("delta-load: unknown record kind " + dr.kind + " for " + name);
    return reshapeTensor(dr.meta || {}, raw);
  };

  let e8lutData;   // E₈ LUT (if any) is a frozen base block
  if (man.e8lut) { const b = await getBlock(baseRoot, man.e8lut.replace(/^did:holo:/, "")); e8lutData = new Float32Array(b.buffer, b.byteOffset, 2048); }
  const manifest = buildEngineManifest(man, normRecs, e8lutData);
  // tokenizer is the base's (finetune shares vocab); resolve a relative source against the BASE dir.
  if (man.source && !/^https?:\/\//.test(man.source)) man.source = baseRoot + "/" + man.source;
  return { manifest, fetchTensor, info: man };
}

export default loadDeltaObject;
