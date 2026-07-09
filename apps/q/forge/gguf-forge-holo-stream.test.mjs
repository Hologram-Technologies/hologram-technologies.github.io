// Streaming .holo writer + disk reader witness (Phase 1 of GLM-5.2 holo-stream).
// Prove the scale path is byte-faithful to the in-RAM writer: writeHoloPackageStream produces
// a holo-pkg/1 BYTE-IDENTICAL to writeHoloPackage (same packageKappa) while holding only one
// block at a time; the streamed file's seal verifies and a one-byte edit refuses (P2);
// openHoloPackageDisk range-reads every block byte-identical (L5); and a forward STREAMED from
// the disk .holo (sparse, per-expert) == the in-RAM whole-stack forward, bit-identical.

import assert from "node:assert";
import { openSync, closeSync, readSync, writeFileSync, statSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forgeGguf, forgeGgufScan, mapStore, loadByKappa } from "./gguf-forge.mjs";
import { GGML } from "./gguf-forge-dequant.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { buildExpertDirectory } from "./gguf-forge-expert-dir.mjs";
import { makeDiskStore } from "./gguf-forge-kstore.mjs";
import { writeHoloPackage, readHoloPackage, writeHoloPackageStream, openHoloPackageDisk } from "./gguf-forge-package.mjs";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); } catch (e) { fail++; console.log("FAIL  " + name + "\n      " + (e.stack || e.message)); } };
const hexOf = (k) => String(k).split(":").pop();

const D = 8, NH = 2, NHKV = 1, HD = 4, FF = 6, VOCAB = 5, E = 4, USED = 2, EPS = 1e-6, FREQ = 10000;
const QD = NH * HD, KV = NHKV * HD;
function prng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; }; }
const randF = (r, n) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = r() * 0.3; return a; };
const f32bytes = (arr) => new Uint8Array(arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength));

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
function moeGgufBytes() {
  const r = prng(7);
  const w = {
    tok_embd: randF(r, VOCAB * D), output_norm: randF(r, D).map((x) => Math.abs(x) + 0.5), output: randF(r, VOCAB * D),
    attn_norm: randF(r, D).map((x) => Math.abs(x) + 0.5), ffn_norm: randF(r, D).map((x) => Math.abs(x) + 0.5),
    wq: randF(r, QD * D), wk: randF(r, KV * D), wv: randF(r, KV * D), wo: randF(r, D * QD),
    gate_inp: randF(r, E * D), gate_exps: randF(r, E * FF * D), up_exps: randF(r, E * FF * D), down_exps: randF(r, E * D * FF),
  };
  const meta = {
    "general.architecture": "llama", "llama.block_count": 1, "llama.embedding_length": D,
    "llama.attention.head_count": NH, "llama.attention.head_count_kv": NHKV, "llama.attention.key_length": HD,
    "llama.feed_forward_length": FF, "llama.expert_count": E, "llama.expert_used_count": USED,
    "llama.expert_feed_forward_length": FF, "llama.rope.freq_base": FREQ, "llama.attention.layer_norm_rms_epsilon": EPS,
  };
  const T = [
    ["token_embd.weight", [D, VOCAB], w.tok_embd], ["output_norm.weight", [D], w.output_norm], ["output.weight", [D, VOCAB], w.output],
    ["blk.0.attn_norm.weight", [D], w.attn_norm], ["blk.0.attn_q.weight", [D, QD], w.wq], ["blk.0.attn_k.weight", [D, KV], w.wk],
    ["blk.0.attn_v.weight", [D, KV], w.wv], ["blk.0.attn_output.weight", [QD, D], w.wo], ["blk.0.ffn_norm.weight", [D], w.ffn_norm],
    ["blk.0.ffn_gate_inp.weight", [D, E], w.gate_inp],
    ["blk.0.ffn_gate_exps.weight", [D, FF, E], w.gate_exps], ["blk.0.ffn_up_exps.weight", [D, FF, E], w.up_exps], ["blk.0.ffn_down_exps.weight", [FF, D, E], w.down_exps],
  ];
  return buildGguf(meta, T.map(([name, dims, arr]) => ({ name, type: GGML.F32, dims, bytes: f32bytes(arr) })));
}

const dir = mkdtempSync(join(tmpdir(), "holo-stream-"));
const ggufPath = join(dir, "moe.gguf");
const gguf = moeGgufBytes();
writeFileSync(ggufPath, gguf);
const gSize = statSync(ggufPath).size;
const gfd = openSync(ggufPath, "r");
const readRange = async (off, len) => { const b = Buffer.allocUnsafe(len); let g = 0; while (g < len) { const n = readSync(gfd, b, g, len - g, off + g); if (n <= 0) break; g += n; } return new Uint8Array(b.buffer, b.byteOffset, len); };
const readSyncRange = (off, len) => { const b = Buffer.allocUnsafe(len); let g = 0; while (g < len) { const n = readSync(gfd, b, g, len - g, off + g); if (n <= 0) break; g += n; } return new Uint8Array(b.buffer, b.byteOffset, len); };

// in-RAM reference package
const forge = forgeGguf(gguf);
const expert = buildExpertDirectory(forge);
const ref = writeHoloPackage(forge, expert);

// streamed package (collect chunks)
const scan = await forgeGgufScan(readRange, { headerBytes: await readRange(0, gSize) });
let streamed; { const chunks = []; const sink = (b) => { chunks.push(b.slice()); }; const res = await writeHoloPackageStream(scan, (loc) => readRange(loc.fileOffset, loc.len), sink); const total = chunks.reduce((a, c) => a + c.length, 0); streamed = new Uint8Array(total); let o = 0; for (const c of chunks) { streamed.set(c, o); o += c.length; } streamed._kappa = res.packageKappa; }

t("streamed .holo is BYTE-IDENTICAL to in-RAM writeHoloPackage (same packageKappa)", () => {
  assert.strictEqual(streamed.length, ref.bytes.length, `length ${streamed.length} vs ${ref.bytes.length}`);
  assert.deepStrictEqual([...streamed], [...ref.bytes], "byte-identical region+header+footer");
  assert.strictEqual(streamed._kappa, ref.packageKappa, "same packageKappa");
});

t("streamed .holo seal verifies; one-byte edit refuses (P2)", () => {
  const pkg = readHoloPackage(streamed);
  assert.strictEqual(pkg.packageKappa, ref.packageKappa);
  const bad = streamed.slice(); bad[bad.length - 40] ^= 0xff;     // flip a byte in the region
  assert.throws(() => readHoloPackage(bad), /seal REFUSE/i, "tampered package refused");
});

// write streamed bytes to a .holo file and open it disk-backed
const holoPath = join(dir, "moe.holo");
writeFileSync(holoPath, streamed);
const hfd = openSync(holoPath, "r");
const hReadSync = (off, len) => { const b = Buffer.allocUnsafe(len); let g = 0; while (g < len) { const n = readSync(hfd, b, g, len - g, off + g); if (n <= 0) break; g += n; } return new Uint8Array(b.buffer, b.byteOffset, len); };
const disk = openHoloPackageDisk(hfd, hReadSync);

t("openHoloPackageDisk range-reads every block byte-identical to the forge (L5)", () => {
  assert.strictEqual(disk.model, forge.rootKappa, "embedded model κ");
  const store = makeDiskStore({ fd: hfd, dir: disk.dir, budgetBytes: 1 << 30 });
  // trunk tensors
  for (const tn of forge.tensors) {
    if (!disk.dir[hexOf(tn.kappa)]) continue;                      // experts stored as slices, checked below
    assert.deepStrictEqual([...loadByKappa(store, tn.kappa)], [...forge.blocks.get(hexOf(tn.kappa))], `block ${tn.name}`);
  }
  // per-expert slices
  for (const name of Object.keys(expert.dir.tensors)) for (const ent of expert.dir.tensors[name].experts) {
    assert.deepStrictEqual([...loadByKappa(store, ent.kappa)], [...expert.expertBlocks.get(hexOf(ent.kappa))], `expert ${name}`);
  }
  assert.ok(store.stats.refused === 0, "none refused");
});

t("forward STREAMED from the disk .holo (sparse, per-expert) == in-RAM whole-stack forward", () => {
  const ids = [1, 4, 2];
  const graph = synthesizeGraph(forge.plan);
  const refLogits = forward(forge.plan, graph, mapStore(forge.blocks), ids);          // whole-stack
  const store = makeDiskStore({ fd: hfd, dir: disk.dir, budgetBytes: 1 << 30 });
  const holoLogits = forward(disk.plan, synthesizeGraph(disk.plan), store, ids, { expertDir: disk.expertDir });
  assert.strictEqual(holoLogits.length, refLogits.length);
  for (let i = 0; i < refLogits.length; i++) assert.strictEqual(holoLogits[i], refLogits[i], `logit ${i}`);
});

t("a tampered byte in the .holo file is refused on read (L5)", () => {
  const badPath = join(dir, "moe-bad.holo");
  const bad = streamed.slice(); bad[bad.length - 40] ^= 0xff;     // flip a region byte
  writeFileSync(badPath, bad);
  const bfd = openSync(badPath, "r");
  const bReadSync = (off, len) => { const b = Buffer.allocUnsafe(len); let g = 0; while (g < len) { const n = readSync(bfd, b, g, len - g, off + g); if (n <= 0) break; g += n; } return new Uint8Array(b.buffer, b.byteOffset, len); };
  const bdisk = openHoloPackageDisk(bfd, bReadSync);
  const store = makeDiskStore({ fd: bfd, dir: bdisk.dir, budgetBytes: 1 << 30 });
  // find which block covers the flipped byte and assert it refuses
  const regionByte = bad.length - 40;
  let victim = null;
  for (const hex in bdisk.dir) { const l = bdisk.dir[hex]; if (regionByte >= l.fileOffset && regionByte < l.fileOffset + l.len) { victim = hex; break; } }
  assert.ok(victim, "found block covering flipped byte");
  assert.throws(() => store.get(victim), /L5 refuse/i, "tampered block refused");
  closeSync(bfd);
});

closeSync(gfd); closeSync(hfd);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
