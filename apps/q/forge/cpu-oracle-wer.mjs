// CPU forge-oracle WER over the held-out set — localizes the engine-vs-HF gap. The oracle math is exact to
// HF (jo16 64/64); if its WER ≈ HF's 8.26% then the GPU engine's 9.83% is GPU reduction-order numerics
// (inherent Tier-B); if the oracle is also ~9.83% then it's our SHARED math (erf-GELU approx / decode) = fixable.
import { readFileSync, readdirSync } from "node:fs";
import { readSafetensors, moonshineConvStem, moonshineEncoder, moonshineDecodeGreedy } from "./gguf-forge-moonshine.mjs";

const W = readSafetensors("./.models/moonshine-tiny/model.safetensors");
const tok = JSON.parse(readFileSync("./.models/moonshine-tiny/tokenizer.json", "utf8"));
const inv = []; for (const [t, id] of Object.entries(tok.model.vocab)) inv[id] = t;
const td = new TextDecoder();
function detok(ids) { const bytes = []; for (const id of ids) { if (id <= 2) continue; const p = inv[id]; if (p === undefined) continue; const m = /^<0x([0-9A-Fa-f]{2})>$/.exec(p); if (m) bytes.push(parseInt(m[1], 16)); else for (const b of new TextEncoder().encode(p.replace(/▁/g, " "))) bytes.push(b); } let s = td.decode(new Uint8Array(bytes)); return s.startsWith(" ") ? s.slice(1) : s; }
function readWav16(path) { const b = new Uint8Array(readFileSync(path)); const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); let o = 12; while (o + 8 <= b.byteLength) { const id = String.fromCharCode(b[o], b[o+1], b[o+2], b[o+3]), sz = dv.getUint32(o+4, true); if (id === "data") { const n = sz >> 1, x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = dv.getInt16(o+8+i*2, true) / 32768; return x; } o += 8 + sz + (sz & 1); } }
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9' ]/g, " ").split(/\s+/).filter(Boolean);
function wer(ref, hyp) { const r = norm(ref), h = norm(hyp), n = r.length, m = h.length; let dp = Array.from({ length: m + 1 }, (_, j) => j); for (let i = 1; i <= n; i++) { let prev = dp[0]; dp[0] = i; for (let j = 1; j <= m; j++) { const c = dp[j]; dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (r[i - 1] !== h[j - 1] ? 1 : 0)); prev = c; } } return [dp[m], n]; }

const refs = JSON.parse(readFileSync("./gpu/wer-refs.json"));
let te = 0, tw = 0, t0 = Date.now();
for (let i = 0; i < refs.length; i++) {
  const pcm = readWav16("./gpu/wer/" + refs[i].file);
  const cs = moonshineConvStem(W, pcm); const enc = moonshineEncoder(W, cs.x0, cs.frames);
  const ids = moonshineDecodeGreedy(W, enc, cs.frames, { maxNew: 200 });
  const [e, w] = wer(refs[i].text, detok(ids)); te += e; tw += w;
  if (i % 10 === 0) console.log(`${i + 1}/${refs.length} · WER ${(100 * te / tw).toFixed(2)}% · ${Math.round((Date.now() - t0) / 1000)}s`);
}
console.log(`\nCPU-ORACLE WER ${(100 * te / tw).toFixed(2)}% (${te}/${tw} words) over ${refs.length} clips`);
