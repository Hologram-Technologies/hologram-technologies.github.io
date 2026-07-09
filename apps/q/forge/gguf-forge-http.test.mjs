// HTTP Range streaming witness (Phase 2 of GLM-5.2 holo-stream).
// Serve a sealed .holo over a real loopback HTTP Range server and decode a model OVER THE WIRE,
// pulling only the trunk + the experts the token routes to. Proves: (parity) HTTP-streamed decode
// == in-RAM whole-stack forward, bit-identical; (sparsity) only routed-expert κ are fetched —
// unrouted experts never touch the wire, bytes pulled ≪ .holo size; (L5) a corrupt range is
// refused; (warm) a second decode reusing residency pulls nothing.

import assert from "node:assert";
import http from "node:http";
import { openSync, closeSync, readSync, writeFileSync, statSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forgeGguf, mapStore } from "./gguf-forge.mjs";
import { GGML } from "./gguf-forge-dequant.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { buildExpertDirectory, expertKappa } from "./gguf-forge-expert-dir.mjs";
import { writeHoloPackage, openHoloPackageDisk } from "./gguf-forge-package.mjs";
import { httpRangeSource, decodeFromAsyncSource } from "./gguf-forge-http.mjs";

let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log("  ok  " + name); } catch (e) { fail++; console.log("FAIL  " + name + "\n      " + (e.stack || e.message)); } };
const hexOf = (k) => String(k).split(":").pop();

const D = 8, NH = 2, NHKV = 1, HD = 4, FF = 6, VOCAB = 5, E = 8, USED = 2, EPS = 1e-6, FREQ = 10000;
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
  return buildGguf(meta, T.map(([name, dims, arr]) => ({ name, type: GGML.F32, dims, bytes: f32b(arr) })));
}

const dir = mkdtempSync(join(tmpdir(), "holo-http-"));
const ggufBytes = moeGgufBytes();
const forge = forgeGguf(ggufBytes);
const expert = buildExpertDirectory(forge);
const graph = synthesizeGraph(forge.plan);
const ids = [1, 4, 2];

// in-RAM reference + the routed-expert set (record via onExpertSelect)
const routed = {};
const refLogits = forward(forge.plan, graph, mapStore(forge.blocks), ids, {
  onExpertSelect: (key, sel) => { const L = key.split(".")[0]; (routed[L] ??= new Set()); for (const e of sel) routed[L].add(e); },
});
const expectedExpertHex = new Set();
for (const L in routed) { const Nl = +L.slice(1); for (const tt of ["gate", "up", "down"]) { const tn = `blk.${Nl}.ffn_${tt}_exps.weight`; if (expert.dir.tensors[tn]) for (const e of routed[L]) expectedExpertHex.add(hexOf(expertKappa(expert.dir, tn, e))); } }
const allExpertHex = new Set();
for (const tn of Object.keys(expert.dir.tensors)) for (let e = 0; e < expert.dir.tensors[tn].nExpert; e++) allExpertHex.add(hexOf(expertKappa(expert.dir, tn, e)));

// seal a .holo to disk and read its header/regionStart
const holoPath = join(dir, "model.holo");
writeFileSync(holoPath, writeHoloPackage(forge, expert).bytes);
const holoSize = statSync(holoPath).size;
const hfd = openSync(holoPath, "r");
const hRead = (off, len) => { const b = Buffer.allocUnsafe(len); let g = 0; while (g < len) { const n = readSync(hfd, b, g, len - g, off + g); if (n <= 0) break; g += n; } return new Uint8Array(b.buffer, b.byteOffset, len); };
const diskPkg = openHoloPackageDisk(hfd, hRead);

// loopback HTTP Range server over the .holo (optional corrupt mode flips bytes in served ranges)
let corrupt = false;
const server = http.createServer((req, res) => {
  const m = /bytes=(\d+)-(\d+)/.exec(req.headers.range || "");
  if (!m) { res.writeHead(416); return res.end(); }
  const start = +m[1], end = +m[2], len = end - start + 1;
  const buf = Buffer.alloc(len); let g = 0; while (g < len) { const n = readSync(hfd, buf, g, len - g, start + g); if (n <= 0) break; g += n; }
  if (corrupt) buf[0] ^= 0xff;
  res.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${holoSize}`, "Content-Length": len });
  res.end(buf);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/model.holo`;

await t("HTTP-streamed decode == in-RAM whole-stack forward, bit-identical", async () => {
  const src = httpRangeSource(url, diskPkg.header, diskPkg.regionStart);
  const { logits, fetched } = await decodeFromAsyncSource({ forward, plan: diskPkg.plan, graph, ids, expertDir: diskPkg.expertDir, source: src });
  assert.strictEqual(logits.length, refLogits.length);
  for (let i = 0; i < logits.length; i++) assert.strictEqual(logits[i], refLogits[i], `logit ${i}`);
  assert.ok(fetched.size > 0, "fetched some blocks");
});

await t("only routed experts are pulled over the wire (unrouted experts never fetched); bytes ≪ .holo", async () => {
  const src = httpRangeSource(url, diskPkg.header, diskPkg.regionStart);
  const { fetched } = await decodeFromAsyncSource({ forward, plan: diskPkg.plan, graph, ids, expertDir: diskPkg.expertDir, source: src });
  const fetchedExperts = new Set([...fetched].filter((h) => allExpertHex.has(h)));
  assert.deepStrictEqual([...fetchedExperts].sort(), [...expectedExpertHex].sort(), "fetched experts == router selection");
  assert.ok(fetchedExperts.size < allExpertHex.size, `strict sparsity: ${fetchedExperts.size} fetched < ${allExpertHex.size} total experts`);
  assert.ok(src.stats.bytes < holoSize, `bytes pulled ${src.stats.bytes} < .holo ${holoSize}`);
});

await t("a corrupt HTTP range is refused by re-derivation (L5)", async () => {
  corrupt = true;
  const src = httpRangeSource(url, diskPkg.header, diskPkg.regionStart);
  await assert.rejects(decodeFromAsyncSource({ forward, plan: diskPkg.plan, graph, ids, expertDir: diskPkg.expertDir, source: src }), /L5 refuse/i);
  corrupt = false;
});

await t("warm: a second decode reusing residency pulls 0 new ranges", async () => {
  const src = httpRangeSource(url, diskPkg.header, diskPkg.regionStart);
  const resident = new Map();
  await decodeFromAsyncSource({ forward, plan: diskPkg.plan, graph, ids, expertDir: diskPkg.expertDir, source: src, resident });
  const after = src.stats.fetches;
  await decodeFromAsyncSource({ forward, plan: diskPkg.plan, graph, ids, expertDir: diskPkg.expertDir, source: src, resident });
  assert.strictEqual(src.stats.fetches, after, "second decode fetched 0 new ranges (warm)");
});

server.close(); closeSync(hfd);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
