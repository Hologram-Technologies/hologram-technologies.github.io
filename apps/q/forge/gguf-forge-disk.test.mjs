// Disk-backed forge witness (Phase 1 of GLM-5.2-at-scale).
// Prove the memory-frugal path is byte-faithful: forgeGgufScan derives the SAME κ/rootKappa
// as the in-RAM forge but retains no bytes (emits a κ→{fileOffset,len} dir); makeDiskStore
// range-reads any κ-block from the file, verifies by re-derivation (L5), bounds memory with
// an LRU (evicts oldest), and refuses corruption. Same laws as the RAM path, at 744B scale.

import assert from "node:assert";
import { openSync, closeSync, readSync, writeFileSync, statSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forgeGguf, forgeGgufScan, mapStore, GGML_TYPE_NAME, ggmlNBytes, loadByKappa } from "./gguf-forge.mjs";
import { GGML } from "./gguf-forge-dequant.mjs";
import { makeDiskStore } from "./gguf-forge-kstore.mjs";
import { buildExpertDirectory, expertKappa, loadExpertSlice } from "./gguf-forge-expert-dir.mjs";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); } catch (e) { fail++; console.log("FAIL  " + name + "\n      " + (e.stack || e.message)); } };
const hexOf = (k) => String(k).split(":").pop();

// ── minimal GGUF writer (same as gguf-forge-expert-dir.test) ──
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
const f32bytes = (arr) => new Uint8Array(arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength));

const K = 4, N = 6, E = 4, KN = K * N;
function stacked(seed) { const a = new Float32Array(KN * E); for (let e = 0; e < E; e++) for (let i = 0; i < KN; i++) a[e * KN + i] = (e + 1) * 0.5 + i * 0.001 + seed; return a; }
function moeGguf() {
  const meta = { "general.architecture": "olmoe", "olmoe.block_count": 1, "olmoe.expert_count": E, "olmoe.expert_used_count": 2 };
  const T = [
    ["token_embd.weight", [K, N], f32bytes(stacked(0.0))],
    ["blk.0.ffn_gate_exps.weight", [K, N, E], f32bytes(stacked(0.1))],
    ["blk.0.ffn_up_exps.weight", [K, N, E], f32bytes(stacked(0.2))],
    ["blk.0.ffn_down_exps.weight", [N, K, E], f32bytes(stacked(0.3))],
  ];
  return buildGguf(meta, T.map(([name, dims, bytes]) => ({ name, type: GGML.F32, dims, bytes })));
}

const dir = mkdtempSync(join(tmpdir(), "holo-disk-"));
const path = join(dir, "moe.gguf");
const gguf = moeGguf();
writeFileSync(path, gguf);
const size = statSync(path).size;
const fd = openSync(path, "r");
const readRange = async (off, len) => { const b = Buffer.allocUnsafe(len); let g = 0; while (g < len) { const n = readSync(fd, b, g, len - g, off + g); if (n <= 0) break; g += n; } return new Uint8Array(b.buffer, b.byteOffset, len); };

const ram = forgeGguf(gguf);                         // in-RAM reference
const headerBytes = await readRange(0, size);
const scan = await forgeGgufScan(readRange, { headerBytes });

t("forgeGgufScan derives the SAME rootKappa + per-tensor κ as the in-RAM forge", () => {
  assert.strictEqual(scan.rootKappa, ram.rootKappa, "rootKappa");
  assert.strictEqual(scan.tensors.length, ram.tensors.length);
  for (const rt of ram.tensors) {
    const st = scan.tensors.find((x) => x.name === rt.name);
    assert.ok(st, `scan has ${rt.name}`);
    assert.strictEqual(st.kappa, rt.kappa, `κ ${rt.name}`);
    assert.strictEqual(st.sri, rt.sri, `sri ${rt.name}`);
  }
});

t("scan retains NO bytes (no blocks Map) but emits a κ→{fileOffset,len} directory", () => {
  assert.strictEqual(scan.blocks, undefined, "no blocks Map");
  for (const rt of ram.tensors) {
    const loc = scan.dir[hexOf(rt.kappa)];
    assert.ok(loc && typeof loc.fileOffset === "number" && loc.len === rt.nbytes, `dir entry for ${rt.name}`);
  }
});

t("makeDiskStore range-reads every κ-block from the file, byte-identical to the RAM forge", () => {
  const store = makeDiskStore({ fd, dir: scan.dir, budgetBytes: 1 << 30 });
  for (const rt of ram.tensors) {
    const got = loadByKappa(store, rt.kappa);
    const want = ram.blocks.get(hexOf(rt.kappa));
    assert.deepStrictEqual([...got], [...want], `bytes ${rt.name}`);
  }
  assert.ok(store.stats.verified > 0 && store.stats.refused === 0, "verified, none refused");
});

t("scan.expertDir matches buildExpertDirectory; per-expert slices load from disk (L5)", () => {
  const bd = buildExpertDirectory(ram);
  const store = makeDiskStore({ fd, dir: scan.dir, budgetBytes: 1 << 30 });
  for (const tn of Object.keys(bd.dir.tensors)) {
    const sd = scan.expertDir.tensors[tn];
    assert.ok(sd, `scan expertDir has ${tn}`);
    assert.strictEqual(sd.nExpert, E);
    assert.strictEqual(sd.stride, bd.dir.tensors[tn].stride);
    for (let e = 0; e < E; e++) {
      assert.strictEqual(expertKappa(scan.expertDir, tn, e), expertKappa(bd.dir, tn, e), `${tn} expert ${e} κ`);
      const got = loadExpertSlice(store, scan.expertDir, tn, e);   // range-read one expert, verified
      const wholeHex = hexOf(ram.tensors.find((x) => x.name === tn).kappa);
      const want = ram.blocks.get(wholeHex).subarray(e * sd.stride, (e + 1) * sd.stride);
      assert.deepStrictEqual([...got], [...want], `${tn} expert ${e} bytes`);
    }
  }
});

t("bounded LRU: a tiny byte budget evicts oldest blocks but reads stay correct", () => {
  const tensorBytes = ram.tensors.map((x) => x.nbytes);
  const budget = Math.max(...tensorBytes) + 8;                     // room for ~1 block at a time
  const store = makeDiskStore({ fd, dir: scan.dir, budgetBytes: budget });
  for (const rt of ram.tensors) {
    const got = loadByKappa(store, rt.kappa);
    assert.deepStrictEqual([...got], [...ram.blocks.get(hexOf(rt.kappa))], `bytes ${rt.name}`);
    assert.ok(store.stats.bytes() <= budget, `resident ${store.stats.bytes()} <= budget ${budget}`);
  }
  assert.ok(store.stats.evicted > 0, "LRU evicted under pressure");
});

t("corruption is refused by re-derivation (L5): same dir, fd pointing at a tampered file", () => {
  const bad = gguf.slice();
  bad[size - 1] ^= 0xff;                                           // flip a byte in the last tensor's data
  const badPath = join(dir, "moe-bad.gguf");
  writeFileSync(badPath, bad);
  const badFd = openSync(badPath, "r");
  const store = makeDiskStore({ fd: badFd, dir: scan.dir, budgetBytes: 1 << 30 });
  // the tensor whose bytes were flipped must refuse; pick the one covering size-1
  const victim = ram.tensors.find((x) => { const l = scan.dir[hexOf(x.kappa)]; return size - 1 >= l.fileOffset && size - 1 < l.fileOffset + l.len; });
  assert.ok(victim, "found tensor covering the flipped byte");
  assert.throws(() => loadByKappa(store, victim.kappa), /L5 refuse/i, "tampered block refused");
  assert.ok(store.stats.refused > 0, "refusal counted");
  closeSync(badFd);
});

closeSync(fd);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
