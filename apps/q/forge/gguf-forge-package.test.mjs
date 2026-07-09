// .holo package witness (S1 round-trip + seal, S2 streamed forward, S3 first-use order).
// Forge olmoe-shape MoE → write a holo-pkg/1 → prove: deterministic did:holo; every
// block range-fetchable byte-identical (whole tensors AND reconstructed expert stacks);
// one-byte edit breaks the seal; per-block tamper refused (L5); a forward STREAMED from
// the single package (via makeResidentStore) is bit-identical to the in-memory forge and
// fetches only trunk + routed experts; trunk precedes the expert tier in compute order.

import assert from "node:assert";
import { forgeGguf, mapStore, loadByKappa } from "./gguf-forge.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { GGML } from "./gguf-forge-dequant.mjs";
import { buildExpertDirectory, expertKappa, isExpertTensor } from "./gguf-forge-expert-dir.mjs";
import { makeResidentStore } from "./gguf-forge-kstore.mjs";
import { writeHoloPackage, readHoloPackage, packageSource } from "./gguf-forge-package.mjs";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); } catch (e) { fail++; console.log("FAIL  " + name + "\n      " + e.message); } };

const D = 8, NH = 2, NHKV = 1, HD = 4, FF = 6, VOCAB = 5, E = 4, USED = 2, EPS = 1e-6, FREQ = 10000;
const QD = NH * HD, KV = NHKV * HD;
const hexOf = (k) => String(k).split(":").pop();
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
function forgeMoe() {
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
  return forgeGguf(buildGguf(meta, T.map(([name, dims, arr]) => ({ name, type: GGML.F32, dims, bytes: f32bytes(arr) }))));
}
function fixture() {
  const forge = forgeMoe();
  const graph = synthesizeGraph(forge.plan);
  const expert = buildExpertDirectory(forge);                  // {dir, dirKappa, expertBlocks}
  return { forge, graph, expert };
}

t("S1: deterministic did:holo + header binds to model root", () => {
  const { forge, expert } = fixture();
  const a = writeHoloPackage(forge, expert), b = writeHoloPackage(forge, expert);
  assert.deepStrictEqual([...a.bytes], [...b.bytes], "byte-identical writes");
  assert.strictEqual(a.packageKappa, b.packageKappa, "deterministic packageKappa");
  assert.match(a.packageKappa, /^did:holo:sha256:/);
  assert.strictEqual(a.header.model, forge.rootKappa, "header.model == rootKappa");
  assert.strictEqual(a.header.expertDir.model, forge.rootKappa, "expertDir bound to model");
  assert.strictEqual(readHoloPackage(a.bytes).packageKappa, a.packageKappa, "round-trip κ stable");
});

t("S1: every block range-fetches byte-identical (wholes + reconstructed expert stacks) [L5]", () => {
  const { forge, expert } = fixture();
  const pkg = readHoloPackage(writeHoloPackage(forge, expert).bytes);
  // whole tensors (non-expert stored directly; expert stacks reconstructed from slices)
  for (const tn of forge.tensors) {
    const want = forge.blocks.get(hexOf(tn.kappa));
    assert.deepStrictEqual([...pkg.blockAt(hexOf(tn.kappa))], [...want], `whole ${tn.name}`);
  }
  // per-expert slices stored directly
  for (const tn of Object.keys(expert.dir.tensors)) for (let e = 0; e < E; e++) {
    const k = hexOf(expertKappa(expert.dir, tn, e));
    assert.deepStrictEqual([...pkg.blockAt(k)], [...expert.expertBlocks.get(k)], `${tn} expert ${e}`);
  }
});

t("S1: one-byte edit breaks the seal (P2); per-block tamper refused (L5)", () => {
  const { forge, expert } = fixture();
  const { bytes } = writeHoloPackage(forge, expert);
  const edited = bytes.slice(); edited[edited.length - 33] ^= 0xff;     // last region byte (before 32B footer)
  assert.throws(() => readHoloPackage(edited), /seal REFUSE/, "package seal fails closed");
  // per-block L5: mutate a parsed region in place, the block refuses (footer already passed)
  const pkg = readHoloPackage(bytes.slice());
  const k = hexOf(expertKappa(expert.dir, "blk.0.ffn_gate_exps.weight", 0));
  pkg.region[pkg.header.blocks[k].off] ^= 0xff;
  assert.throws(() => pkg.blockAt(k), /L5 REFUSE/, "tampered block refuses");
});

t("S2: a forward STREAMED from the single package is bit-identical to the in-memory forge", () => {
  const { forge, graph, expert } = fixture();
  const ref = forward(forge.plan, graph, mapStore(new Map([...forge.blocks, ...expert.expertBlocks])), [1, 3, 2], { expertDir: expert.dir });
  const pkg = readHoloPackage(writeHoloPackage(forge, expert).bytes);
  const store = makeResidentStore({ sources: [packageSource(pkg)], resident: new Map() });
  const streamed = forward(forge.plan, graph, store, [1, 3, 2], { expertDir: pkg.header.expertDir });
  assert.strictEqual(streamed.length, ref.length);
  for (let i = 0; i < ref.length; i++) assert.strictEqual(streamed[i], ref[i], `logit ${i}`);
  assert.ok(store.stats.fetched > 0 && store.stats.refused === 0, "streamed + verified from the package");
});

t("S2: a corrupt expert block in the package is refused; a prompt not routing to it still runs", () => {
  const { forge, graph, expert } = fixture();
  // learn which expert token [1] routes
  let sel = null;
  forward(forge.plan, graph, mapStore(new Map([...forge.blocks, ...expert.expertBlocks])), [1], { expertDir: expert.dir, onExpertSelect: (_k, s) => { sel = s.slice(); } });
  const routed = sel[0], unrouted = [0, 1, 2, 3].find((e) => !sel.includes(e));

  const corruptExpert = (e) => {
    const pkg = readHoloPackage(writeHoloPackage(forge, expert).bytes.slice());
    const k = hexOf(expertKappa(expert.dir, "blk.0.ffn_gate_exps.weight", e));
    pkg.region[pkg.header.blocks[k].off] ^= 0xff;               // corrupt expert e in transit
    return makeResidentStore({ sources: [packageSource(pkg)], resident: new Map() });
  };
  // routing to the corrupt expert → re-derivation refuses, single source → fail closed
  assert.throws(() => forward(forge.plan, graph, corruptExpert(routed), [1], { expertDir: expert.dir }), /not found|REFUSE/);
  // corrupting an UNROUTED expert does not affect a forward that never fetches it
  assert.doesNotThrow(() => forward(forge.plan, graph, corruptExpert(unrouted), [1], { expertDir: expert.dir }));
});

t("S3: first-use order — trunk precedes the expert tier, offsets monotonic", () => {
  const { forge, expert } = fixture();
  const { header } = writeHoloPackage(forge, expert);
  const nameByHex = {}; for (const tn of forge.tensors) nameByHex[hexOf(tn.kappa)] = tn.name;
  const expertHexes = new Set(); for (const tn of Object.keys(expert.dir.tensors)) for (let e = 0; e < E; e++) expertHexes.add(hexOf(expertKappa(expert.dir, tn, e)));
  // offsets strictly increase along `order`
  for (let i = 1; i < header.order.length; i++) assert.ok(header.blocks[header.order[i]].off > header.blocks[header.order[i - 1]].off, "monotonic offsets");
  // every expert block comes after every trunk (non-expert) block
  const firstExpertIdx = header.order.findIndex((h) => expertHexes.has(h));
  const lastTrunkIdx = header.order.reduce((acc, h, i) => (expertHexes.has(h) ? acc : i), -1);
  assert.ok(firstExpertIdx > lastTrunkIdx, "trunk tier precedes expert tier");
  // and the trunk really is trunk (a referenced non-expert tensor like the embedding)
  assert.ok(!isExpertTensor(nameByHex[header.order[0]]), "first block is a trunk tensor");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
