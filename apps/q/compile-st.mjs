// compile-st.mjs — SAFETENSORS → q3f κ-object compiler (for models with no GGUF, e.g. Dream-7B).
// Streams sharded bf16 safetensors via HTTP Range, packs every matrix to q3f (3.5 bpw, cliff-safe),
// norms/biases stay f32. Emits the same holo-2bit/1 manifest the loader already speaks (mode "q3"),
// with `source` pointed at a TOKENIZER-COMPATIBLE GGUF (Dream = Qwen2.5 vocab; mask id rides as
// manifest.maskId — never tokenized from text). Usage:
//   node compile-st.mjs <hf-repo-url> <out-dir> <tokenizer-gguf-url> [maskId]
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";

const REPO = process.argv[2], OUT = process.argv[3], TOKGGUF = process.argv[4], MASKID = process.argv[5] ? Number(process.argv[5]) : undefined;
if (!REPO || !OUT || !TOKGGUF) { console.log("usage: node compile-st.mjs <hf-repo-url> <out-dir> <tokenizer-gguf-url> [maskId]"); process.exit(1); }
const sha = (b) => "sha256:" + createHash("sha256").update(b).digest("hex");
const MB = (n) => (n / 1e6).toFixed(1);
const rng = async (url, s, l) => { for (let a = 0; a < 16; a++) { const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 120000); try { const r = await fetch(url, { headers: { Range: `bytes=${s}-${s + l - 1}` }, redirect: "follow", signal: ac.signal }); if (r.ok || r.status === 206) { const buf = new Uint8Array(await r.arrayBuffer()); clearTimeout(to); return buf; } } catch {} clearTimeout(to); await new Promise(z => setTimeout(z, 800 * (a + 1))); } throw new Error("range @" + s); };
const getJson = async (p) => await (await fetch(`${REPO}/raw/main/${p}`, { redirect: "follow" })).json();

const cfg = await getJson("config.json");
const d = cfg.hidden_size, L = cfg.num_hidden_layers, nh = cfg.num_attention_heads, nkv = cfg.num_key_value_heads, ff = cfg.intermediate_size, vocab = cfg.vocab_size, hd = d / nh;
console.log(`compiling [q3-safetensors] ${REPO}\n  d=${d} L=${L} h=${nh}/${nkv} ff=${ff} vocab=${vocab}`);
const idx = await getJson("model.safetensors.index.json");
const shards = {};                                        // shard file → { hl, hdr }
const shardOf = async (file) => {
  if (shards[file]) return shards[file];
  const u = `${REPO}/resolve/main/${file}`;
  const hl = Number(new DataView((await rng(u, 0, 8)).buffer).getBigUint64(0, true));
  const hdr = JSON.parse(new TextDecoder().decode(await rng(u, 8, hl)));
  return (shards[file] = { u, hl, hdr });
};
const bf16row = (b) => { const n = b.length / 2, W = new Float32Array(n), f = new Float32Array(1), u = new Uint32Array(f.buffer); for (let i = 0; i < n; i++) { u[0] = ((b[i * 2 + 1] << 8) | b[i * 2]) << 16; W[i] = f[0]; } return W; };
const fetchST = async (hfName) => {                       // → Float32Array (streamed in 64MB chunks)
  const file = idx.weight_map[hfName]; if (!file) throw new Error("no tensor " + hfName);
  const s = await shardOf(file); const t = s.hdr[hfName];
  if (t.dtype !== "BF16") throw new Error(hfName + " dtype " + t.dtype);
  const bytes = t.data_offsets[1] - t.data_offsets[0], base = 8 + s.hl + t.data_offsets[0];
  const W = new Float32Array(bytes / 2); const CH = 16 * 1024 * 1024;   // smaller chunks survive slow links (resumable)
  for (let off = 0; off < bytes; off += CH) { const n = Math.min(CH, bytes - off); W.set(bf16row(await rng(s.u, base + off, n)), off / 2); }
  return { W, shape: t.shape };
};

// q3f packer (verbatim semantics from compile2bit packQ3)
function packQ3(W, N, K) {
  const nb = K / 32, planes = new Uint32Array(N * nb * 3), sc = new Float32Array(N * nb);
  for (let n = 0; n < N; n++) for (let b = 0; b < nb; b++) {
    const o = n * K + b * 32; let mx = 0; for (let i = 0; i < 32; i++) { const a = Math.abs(W[o + i]); if (a > mx) mx = a; }
    let s = (mx / 3) || 1e-12, best = Infinity;
    for (let c = 0; c < 9; c++) { const s2 = (mx * (0.22 + c * 0.035)) || 1e-12; let mse = 0; for (let i = 0; i < 32; i++) { let q = Math.round(W[o + i] / s2) + 3; if (q < 0) q = 0; else if (q > 7) q = 7; const dd = W[o + i] - (q - 3) * s2; mse += dd * dd; } if (mse < best) { best = mse; s = s2; } }
    sc[n * nb + b] = s;
    let p0 = 0, p1 = 0, p2 = 0, sp6 = 0;
    for (let i = 0; i < 32; i++) { let q = Math.round(W[o + i] / s) + 3; if (q < 0) q = 0; else if (q > 7) q = 7;
      if (i < 10) p0 |= q << (i * 3); else if (i < 20) p1 |= q << ((i - 10) * 3); else if (i < 30) p2 |= q << ((i - 20) * 3); else sp6 |= q << ((i - 30) * 3); }
    p0 |= (sp6 & 3) << 30; p1 |= ((sp6 >> 2) & 3) << 30; p2 |= ((sp6 >> 4) & 3) << 30;
    const bp = (n * nb + b) * 3; planes[bp] = p0 >>> 0; planes[bp + 1] = p1 >>> 0; planes[bp + 2] = p2 >>> 0;
  }
  return { q: new Uint8Array(planes.buffer), s: sc };
}

mkdirSync(OUT + "/b", { recursive: true });
const progPath = OUT + "/progress.json";
const index = existsSync(progPath) ? JSON.parse(readFileSync(progPath, "utf8")) : {};
const save = () => writeFileSync(progPath, JSON.stringify(index));
const writeBlock = (bytes) => { const gz = gzipSync(bytes, { level: 6 }); const k = sha(gz); const f = `${OUT}/b/${k.replace(":", "_")}.gz`; if (!existsSync(f)) writeFileSync(f, gz); return { kappa: k, stored: gz.length }; };

// engine-name → HF-name map (qwen-style)
const plan = [["embed", "model.embed_tokens.weight", vocab, d, "q3"], ["final_norm", "model.norm.weight", 1, d, "f32"], ["lm_head", "lm_head.weight", vocab, d, "q3"]];
for (let i = 0; i < L; i++) {
  const p = `model.layers.${i}.`;
  plan.push([`l${i}.attn_norm`, p + "input_layernorm.weight", 1, d, "f32"],
    [`l${i}.wq`, p + "self_attn.q_proj.weight", nh * hd, d, "q3"], [`l${i}.wk`, p + "self_attn.k_proj.weight", nkv * hd, d, "q3"], [`l${i}.wv`, p + "self_attn.v_proj.weight", nkv * hd, d, "q3"],
    [`l${i}.bq`, p + "self_attn.q_proj.bias", 1, nh * hd, "f32"], [`l${i}.bk`, p + "self_attn.k_proj.bias", 1, nkv * hd, "f32"], [`l${i}.bv`, p + "self_attn.v_proj.bias", 1, nkv * hd, "f32"],
    [`l${i}.wo`, p + "self_attn.o_proj.weight", d, nh * hd, "q3"], [`l${i}.ffn_norm`, p + "post_attention_layernorm.weight", 1, d, "f32"],
    [`l${i}.w_gate`, p + "mlp.gate_proj.weight", ff, d, "q3"], [`l${i}.w_up`, p + "mlp.up_proj.weight", ff, d, "q3"], [`l${i}.w_down`, p + "mlp.down_proj.weight", d, ff, "q3"]);
}
let t0 = Date.now(), done = 0, out = 0;
for (const [name, hf, N, K, fmt] of plan) {
  done++;
  if (index[name]) { out += index[name].stored || 0; continue; }
  const { W } = await fetchST(hf);
  let rec;
  if (fmt === "f32") rec = { fmt: "f32", N, K, ...writeBlock(new Uint8Array(W.buffer, 0, W.byteLength)) };
  else { const r = packQ3(W, N, K); const blob = new Uint8Array(r.q.length + r.s.byteLength); blob.set(r.q, 0); blob.set(new Uint8Array(r.s.buffer), r.q.length); rec = { fmt: "q3", N, K, ...writeBlock(blob) }; }
  index[name] = rec; out += rec.stored; save();
  process.stdout.write(`\r  ${done}/${plan.length} · ${MB(out)}MB · ${((Date.now() - t0) / 1000) | 0}s   `);
}
const root = sha(Buffer.from(Object.keys(index).sort().map(n => n + ":" + index[n].kappa).join("\n")));
const man = { format: "holo-2bit/1", mode: "q3", model: cfg.model_type || "model", source: TOKGGUF, bits: 3, layout: "q3f", twoBit: false, incoherent: false, root, d, n_heads: nh, n_kv_heads: nkv, ff, vocab, n_layers: L, hd, rope_base: cfg.rope_theta || 10000, attn_bias: true, qk_norm: false, qk_norm_dim: 0, tied: false, ...(MASKID !== undefined ? { maskId: MASKID, diffusion: true } : {}), tensors: index };
writeFileSync(`${OUT}/manifest.json`, JSON.stringify(man, null, 1));
console.log(`\ncompiled → ${OUT}\n  ${Object.keys(index).length} tensors · ${MB(out)}MB · root ${root.slice(0, 40)}…`);
