// Verify the Moonshine κ-forge CPU oracle stage-by-stage vs the HF Python goldens, ending in exact id match.
import { readFileSync } from "node:fs";
import { readSafetensors, moonshineConvStem, moonshineEncoder, moonshineFirstLogits, moonshineDecodeGreedy } from "./gguf-forge-moonshine.mjs";

const f32 = (p) => { const b = readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
function readWav16(path) { const b = new Uint8Array(readFileSync(path)); const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); let o = 12;
  while (o + 8 <= b.byteLength) { const id = String.fromCharCode(b[o], b[o+1], b[o+2], b[o+3]), sz = dv.getUint32(o+4, true); if (id === "data") { const n = sz >> 1, x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = dv.getInt16(o+8+i*2, true) / 32768; return x; } o += 8 + sz + (sz & 1); } throw new Error("no data"); }
function score(a, g, label) { const n = Math.min(a.length, g.length); let dot = 0, na = 0, nb = 0, mx = 0; for (let i = 0; i < n; i++) { dot += a[i]*g[i]; na += a[i]*a[i]; nb += g[i]*g[i]; const e = Math.abs(a[i]-g[i]); if (e > mx) mx = e; } const cos = dot/(Math.sqrt(na)*Math.sqrt(nb)); console.log(`  ${label.padEnd(10)} len ${a.length} vs ${g.length} · cosine ${cos.toFixed(6)} · maxAbs ${mx.toExponential(2)} ${cos>=0.999?"✓":"✗"}`); return cos; }

const MODEL = "./.models/moonshine-tiny/model.safetensors";
const WAV = process.argv[2] || "C:/Users/pavel/Desktop/SovereignAI/1_Compute/whisper.cpp/jo16.wav";
const stage = JSON.parse(readFileSync("./gpu/moonshine-stage-ref.json")), txref = JSON.parse(readFileSync("./gpu/moonshine-tx-ref.json"));

console.log("loading safetensors…"); const W = readSafetensors(MODEL);
const pcm = readWav16(WAV);
console.log(`pcm ${pcm.length} samples (${(pcm.length/16000).toFixed(2)}s)\n— conv stem —`);
const t0 = Date.now();
const cs = moonshineConvStem(W, pcm);
score(cs.conv1, f32("./gpu/moonshine-conv1.f32"), "conv1");
score(cs.conv2, f32("./gpu/moonshine-conv2.f32"), "conv2");
score(cs.conv3, f32("./gpu/moonshine-conv3.f32"), "conv3");
console.log(`frames=${cs.frames}\n— encoder —`);
const enc = moonshineEncoder(W, cs.x0, cs.frames);
score(enc, f32("./gpu/moonshine-enc.f32"), "enc");
console.log("— decoder first-step logits —");
const lg0 = moonshineFirstLogits(W, enc, cs.frames);
score(lg0, f32("./gpu/moonshine-logits0.f32"), "logits0");
let am = 0, av = -Infinity; for (let v = 0; v < lg0.length; v++) if (lg0[v] > av) { av = lg0[v]; am = v; }
console.log(`  argmax ${am} (oracle ${stage.logits0_argmax}) ${am===stage.logits0_argmax?"✓":"✗"}`);
console.log("— full greedy —");
const ids = moonshineDecodeGreedy(W, enc, cs.frames, { maxNew: 200 });
let gold = txref.ids.slice(1);   // golden includes leading bos(1); our gen excludes it
if (gold[gold.length - 1] === 2) gold = gold.slice(0, -1);   // …and trailing eos(2), which greedy stops before emitting
let pre = 0; while (pre < ids.length && pre < gold.length && ids[pre] === gold[pre]) pre++;
const exact = ids.length === gold.length && pre === gold.length;
console.log(`  gen ${ids.length} vs golden ${gold.length} · prefix-match ${pre}/${gold.length} → ${exact?"✓ EXACT":"✗"}`);
console.log(`  gen   ${JSON.stringify(ids.slice(0, 12))}`);
console.log(`  golden${JSON.stringify(gold.slice(0, 12))}`);
console.log(`\ntotal ${((Date.now()-t0)/1000).toFixed(1)}s · ${exact ? "✅ FORGE ORACLE MATCHES REFERENCE" : "❌ mismatch"}`);
