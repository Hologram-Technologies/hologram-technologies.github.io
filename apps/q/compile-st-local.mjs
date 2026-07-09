// compile-st-local.mjs — LOCAL-FILE twin of compile-st.mjs. Reads bf16 safetensors shards straight
// off disk (no 15GB HTTP re-stream) and packs every matrix to q3f, norms/biases f32. Resumable via
// the SAME progress.json — already-done tensors are skipped, and packQ3 is deterministic so the
// blobs are byte-identical to the HTTP path's. Usage:
//   node compile-st-local.mjs <src-dir> <out-dir> <tokenizer-source> [maskId]
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdirSync, writeFileSync, existsSync, readFileSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";

const SRC = process.argv[2], OUT = process.argv[3], TOKSRC = process.argv[4], MASKID = process.argv[5] ? Number(process.argv[5]) : undefined;
if (!SRC || !OUT || !TOKSRC) { console.log("usage: node compile-st-local.mjs <src-dir> <out-dir> <tokenizer-source> [maskId]"); process.exit(1); }
const sha = (b) => "sha256:" + createHash("sha256").update(b).digest("hex");
const MB = (n) => (n / 1e6).toFixed(1);

const cfg = JSON.parse(readFileSync(join(SRC, "config.json"), "utf8"));
const d = cfg.hidden_size, L = cfg.num_hidden_layers, nh = cfg.num_attention_heads, nkv = cfg.num_key_value_heads, ff = cfg.intermediate_size, vocab = cfg.vocab_size, hd = d / nh;
console.log(`compiling [q3-safetensors LOCAL] ${SRC}\n  d=${d} L=${L} h=${nh}/${nkv} ff=${ff} vocab=${vocab} maskId=${MASKID}`);
const idx = JSON.parse(readFileSync(join(SRC, "model.safetensors.index.json"), "utf8"));

// shard file → { fd, hl, hdr }
const shards = {};
const shardOf = (file) => {
  if (shards[file]) return shards[file];
  const fd = openSync(join(SRC, file), "r");
  const h8 = Buffer.alloc(8); readSync(fd, h8, 0, 8, 0);
  const hl = Number(h8.readBigUInt64LE(0));
  const hb = Buffer.alloc(hl); readSync(fd, hb, 0, hl, 8);
  const hdr = JSON.parse(hb.toString("utf8"));
  return (shards[file] = { fd, hl, hdr });
};
const bf16row = (b) => { const n = b.length / 2, W = new Float32Array(n), f = new Float32Array(1), u = new Uint32Array(f.buffer); for (let i = 0; i < n; i++) { u[0] = ((b[i * 2 + 1] << 8) | b[i * 2]) << 16; W[i] = f[0]; } return W; };
const fetchST = (hfName) => {
  const file = idx.weight_map[hfName]; if (!file) throw new Error("no tensor " + hfName);
  const s = shardOf(file); const t = s.hdr[hfName];
  if (t.dtype !== "BF16") throw new Error(hfName + " dtype " + t.dtype);
  const bytes = t.data_offsets[1] - t.data_offsets[0], base = 8 + s.hl + t.data_offsets[0];
  const buf = Buffer.alloc(bytes);
  for (let off = 0; off < bytes;) { const got = readSync(s.fd, buf, off, Math.min(bytes - off, 1 << 30), base + off); if (got <= 0) throw new Error("short read " + hfName); off += got; }
  return { W: bf16row(buf), shape: t.shape };
};

// q3f packer (verbatim from compile-st.mjs)
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
  const { W } = fetchST(hf);
  let rec;
  if (fmt === "f32") rec = { fmt: "f32", N, K, ...writeBlock(new Uint8Array(W.buffer, 0, W.byteLength)) };
  else { const r = packQ3(W, N, K); const blob = new Uint8Array(r.q.length + r.s.byteLength); blob.set(r.q, 0); blob.set(new Uint8Array(r.s.buffer), r.q.length); rec = { fmt: "q3", N, K, ...writeBlock(blob) }; }
  index[name] = rec; out += rec.stored; save();
  process.stdout.write(`\r  ${done}/${plan.length} · ${name} · ${MB(out)}MB · ${((Date.now() - t0) / 1000) | 0}s        `);
}
for (const f in shards) { try { closeSync(shards[f].fd); } catch {} }
const root = sha(Buffer.from(Object.keys(index).sort().map(n => n + ":" + index[n].kappa).join("\n")));
const man = { format: "holo-2bit/1", mode: "q3", model: cfg.model_type || "model", source: TOKSRC, bits: 3, layout: "q3f", twoBit: false, incoherent: false, root, d, n_heads: nh, n_kv_heads: nkv, ff, vocab, n_layers: L, hd, rope_base: cfg.rope_theta || 10000, attn_bias: true, qk_norm: false, qk_norm_dim: 0, tied: false, ...(MASKID !== undefined ? { maskId: MASKID, diffusion: true } : {}), tensors: index };
writeFileSync(`${OUT}/manifest.json`, JSON.stringify(man, null, 1));
console.log(`\ncompiled → ${OUT}\n  ${Object.keys(index).length} tensors · ${MB(out)}MB · root ${root.slice(0, 40)}…`);
