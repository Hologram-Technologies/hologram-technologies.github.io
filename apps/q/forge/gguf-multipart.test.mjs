// Multi-part (split) GGUF witness (Phase 1 of GLM-5.2 run). GLM-5.2 ships as a 7-part split
// GGUF. Prove: a model split into N parts forges to the SAME per-tensor κ and rootKappa as the
// un-split original (split.* is storage metadata, not identity), and seals to a byte-identical
// .holo whose disk-streamed decode matches the single-file forge — so the multi-part path adds
// no divergence anywhere downstream.

import assert from "node:assert";
import { openSync, closeSync, readSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forgeGguf, forgeGgufScanParts, mapStore, loadByKappa } from "./gguf-forge.mjs";
import { GGML } from "./gguf-forge-dequant.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { buildExpertDirectory } from "./gguf-forge-expert-dir.mjs";
import { makeDiskStore } from "./gguf-forge-kstore.mjs";
import { writeHoloPackage, writeHoloPackageStream, openHoloPackageDisk } from "./gguf-forge-package.mjs";
import { openGgufMultipart, multipartReadBlock } from "./gguf-multipart.mjs";

let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log("  ok  " + name); } catch (e) { fail++; console.log("FAIL  " + name + "\n      " + (e.stack || e.message)); } };
const hexOf = (k) => String(k).split(":").pop();

const D = 8, NH = 2, NHKV = 1, HD = 4, FF = 6, VOCAB = 5, E = 6, USED = 2, EPS = 1e-6, FREQ = 10000;
const QD = NH * HD, KV = NHKV * HD;
function prng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; }; }
const randF = (r, n) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = r() * 0.3; return a; };
const f32b = (arr) => new Uint8Array(arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength));

function buildGguf(meta, tensors) {
  const ALIGN = 32; let off = 0;
  const infos = tensors.map((tn) => { const o = off; off = Math.ceil((o + tn.bytes.length) / ALIGN) * ALIGN; return { ...tn, offset: o }; });
  let parts = [], len = 0; const push = (b) => { parts.push(b); len += b.length; };
  const u32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); push(b); };
  const u64 = (v) => { const b = new Uint8Array(8); const dv = new DataView(b.buffer); dv.setUint32(0, v >>> 0, true); dv.setUint32(4, Math.floor(v / 4294967296), true); push(b); };
  const str = (s) => { const e = new TextEncoder().encode(s); u64(e.length); push(e); };
  push(new TextEncoder().encode("GGUF")); u32(3); u64(tensors.length); u64(Object.keys(meta).length);
  for (const [k, val] of Object.entries(meta)) { str(k); if (typeof val === "string") { u32(8); str(val); } else { u32(4); u32(val); } }
  for (const ti of infos) { str(ti.name); u32(ti.dims.length); for (const d of ti.dims) u64(d); u32(ti.type); u64(ti.offset); }
  if (len % ALIGN) push(new Uint8Array(ALIGN - (len % ALIGN)));
  const dataStart = len;
  for (const ti of infos) { while (len < dataStart + ti.offset) push(new Uint8Array(1)); push(ti.bytes); }
  const out = new Uint8Array(len); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}
function modelTensors() {
  const r = prng(7);
  const w = {
    tok_embd: randF(r, VOCAB * D), output_norm: randF(r, D).map((x) => Math.abs(x) + 0.5), output: randF(r, VOCAB * D),
    attn_norm: randF(r, D).map((x) => Math.abs(x) + 0.5), ffn_norm: randF(r, D).map((x) => Math.abs(x) + 0.5),
    wq: randF(r, QD * D), wk: randF(r, KV * D), wv: randF(r, KV * D), wo: randF(r, D * QD),
    gate_inp: randF(r, E * D), gate_exps: randF(r, E * FF * D), up_exps: randF(r, E * FF * D), down_exps: randF(r, E * D * FF),
  };
  const T = [
    ["token_embd.weight", [D, VOCAB], w.tok_embd], ["output_norm.weight", [D], w.output_norm], ["output.weight", [D, VOCAB], w.output],
    ["blk.0.attn_norm.weight", [D], w.attn_norm], ["blk.0.attn_q.weight", [D, QD], w.wq], ["blk.0.attn_k.weight", [D, KV], w.wk],
    ["blk.0.attn_v.weight", [D, KV], w.wv], ["blk.0.attn_output.weight", [QD, D], w.wo], ["blk.0.ffn_norm.weight", [D], w.ffn_norm],
    ["blk.0.ffn_gate_inp.weight", [D, E], w.gate_inp],
    ["blk.0.ffn_gate_exps.weight", [D, FF, E], w.gate_exps], ["blk.0.ffn_up_exps.weight", [D, FF, E], w.up_exps], ["blk.0.ffn_down_exps.weight", [FF, D, E], w.down_exps],
  ].map(([name, dims, arr]) => ({ name, type: GGML.F32, dims, bytes: f32b(arr) }));
  const meta = {
    "general.architecture": "llama", "llama.block_count": 1, "llama.embedding_length": D,
    "llama.attention.head_count": NH, "llama.attention.head_count_kv": NHKV, "llama.attention.key_length": HD,
    "llama.feed_forward_length": FF, "llama.expert_count": E, "llama.expert_used_count": USED,
    "llama.expert_feed_forward_length": FF, "llama.rope.freq_base": FREQ, "llama.attention.layer_norm_rms_epsilon": EPS,
  };
  return { meta, T };
}
// split T into K contiguous parts, each its own GGUF carrying split.* metadata
function splitGguf(meta, T, K) {
  const per = Math.ceil(T.length / K), parts = [];
  for (let i = 0; i < K; i++) {
    const sub = T.slice(i * per, (i + 1) * per);
    if (!sub.length) continue;
    const m = { ...meta, "split.no": parts.length, "split.count": 0, "split.tensors.count": T.length };
    parts.push({ meta: m, tensors: sub });
  }
  for (const p of parts) p.meta["split.count"] = parts.length;
  return parts.map((p) => buildGguf(p.meta, p.tensors));
}

const { meta, T } = modelTensors();
const single = buildGguf(meta, T);
const forge = forgeGguf(single);                       // un-split reference
const expert = buildExpertDirectory(forge);
const graph = synthesizeGraph(forge.plan);
const ids = [1, 4, 2];
const refLogits = forward(forge.plan, graph, mapStore(forge.blocks), ids);
const refPkg = writeHoloPackage(forge, expert);

const dir = mkdtempSync(join(tmpdir(), "holo-mp-"));

await t("openGgufMultipart unions a 3-part split into the single-file tensor set (split.* stripped)", () => {
  const partBufs = splitGguf(meta, T, 3);
  const mp = openGgufMultipart(partBufs.map((b) => ({ readRange: async (o, l) => b.subarray(o, o + l), headerBytes: b })));
  assert.strictEqual(mp.tensors.length, T.length, "tensor count");
  assert.deepStrictEqual(mp.tensors.map((x) => x.name), T.map((x) => x.name), "names in original order");
  assert.ok(!Object.keys(mp.meta).some((k) => k.startsWith("split.")), "split.* stripped from meta");
  assert.strictEqual(mp.meta["general.architecture"], "llama");
});

await t("split model forges to the SAME per-tensor κ and rootKappa as un-split", async () => {
  const partBufs = splitGguf(meta, T, 3);
  const mp = openGgufMultipart(partBufs.map((b) => ({ readRange: async (o, l) => b.subarray(o, o + l), headerBytes: b })));
  const scan = await forgeGgufScanParts(mp);
  assert.strictEqual(scan.rootKappa, forge.rootKappa, "rootKappa matches un-split");
  for (const rt of forge.tensors) {
    const st = scan.tensors.find((x) => x.name === rt.name);
    assert.strictEqual(st.kappa, rt.kappa, `κ ${rt.name}`);
  }
  // every block reads byte-identical from its owning part
  const readBlock = multipartReadBlock(mp);
  for (const rt of forge.tensors) {
    const got = await readBlock(scan.dir[hexOf(rt.kappa)]);
    assert.deepStrictEqual([...got], [...forge.blocks.get(hexOf(rt.kappa))], `bytes ${rt.name}`);
  }
});

await t("split model seals to a byte-identical .holo (same packageKappa) and decodes identically", async () => {
  const partBufs = splitGguf(meta, T, 4);                // different split arity → still identical .holo
  const mp = openGgufMultipart(partBufs.map((b) => ({ readRange: async (o, l) => b.subarray(o, o + l), headerBytes: b })));
  const scan = await forgeGgufScanParts(mp);
  const chunks = []; const res = await writeHoloPackageStream(scan, multipartReadBlock(mp), (b) => chunks.push(b.slice()));
  assert.strictEqual(res.packageKappa, refPkg.packageKappa, "packageKappa == single-file .holo");
  const total = chunks.reduce((a, c) => a + c.length, 0); const holo = new Uint8Array(total); let o = 0; for (const c of chunks) { holo.set(c, o); o += c.length; }
  assert.deepStrictEqual([...holo], [...refPkg.bytes], "byte-identical .holo");
  // disk-decode the split-produced .holo
  const holoPath = join(dir, "split.holo"); writeFileSync(holoPath, holo);
  const fd = openSync(holoPath, "r");
  const hRead = (off, len) => { const b = Buffer.allocUnsafe(len); let g = 0; while (g < len) { const n = readSync(fd, b, g, len - g, off + g); if (n <= 0) break; g += n; } return new Uint8Array(b.buffer, b.byteOffset, len); };
  const disk = openHoloPackageDisk(fd, hRead);
  const store = makeDiskStore({ fd, dir: disk.dir, budgetBytes: 1 << 30 });
  const logits = forward(disk.plan, synthesizeGraph(disk.plan), store, ids, { expertDir: disk.expertDir });
  for (let i = 0; i < refLogits.length; i++) assert.strictEqual(logits[i], refLogits[i], `logit ${i}`);
  closeSync(fd);
});

await t("split.count mismatch and duplicate tensors are rejected (honest)", () => {
  const bufs = splitGguf(meta, T, 2);
  assert.throws(() => openGgufMultipart([{ readRange: async () => new Uint8Array(), headerBytes: bufs[0] }]), /split\.count/, "wrong part count rejected");
  // duplicate tensor across parts: two correctly-numbered parts that BOTH carry all tensors
  const dup0 = buildGguf({ ...meta, "split.no": 0, "split.count": 2, "split.tensors.count": T.length * 2 }, T);
  const dup1 = buildGguf({ ...meta, "split.no": 1, "split.count": 2, "split.tensors.count": T.length * 2 }, T);
  assert.throws(() => openGgufMultipart([
    { readRange: async (o, l) => dup0.subarray(o, o + l), headerBytes: dup0 },
    { readRange: async (o, l) => dup1.subarray(o, o + l), headerBytes: dup1 },
  ]), /duplicate tensor/, "duplicate tensor rejected");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
