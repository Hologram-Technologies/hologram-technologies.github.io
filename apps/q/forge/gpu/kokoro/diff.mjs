// diff.mjs <capture.json> — decode a window.__cap dump (base64 tensors) → ort/*.f32, then run onnx-run.mjs
// (stopAt the last probe) and report max-abs error vs ORT for each exposed tensor, in order. First ">>>" = the
// first divergent stage. The whole Phase-1-to-green bisect loop reduces to: edit probes → gen-exposed → capture → diff.mjs.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { loadModel, run } from "./onnx-run.mjs";

const MODEL = "../../../../../../holo-os/system/os/usr/lib/holo/voice/vendor/models/onnx-community/Kokoro-82M-v1.0-ONNX/onnx/model.onnx";
const capPath = process.argv[2];
if (!capPath) { console.error("usage: node diff.mjs <capture.json>"); process.exit(1); }

let cap = JSON.parse(readFileSync(capPath, "utf8").trim()); if (typeof cap === "string") cap = JSON.parse(cap);
mkdirSync("ort", { recursive: true });
const man = {};
for (const [name, t] of Object.entries(cap)) { const f = "ort/" + name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+/, "") + ".f32"; writeFileSync(f, Buffer.from(t.b64, "base64")); man[name] = { file: f, dims: t.dims }; }
writeFileSync("ort/manifest.json", JSON.stringify(man, null, 2));

const T = (d, dm, i = false) => ({ data: Float64Array.from(d), dims: dm, int: i });
const meta = JSON.parse(readFileSync("golden.json", "utf8"));
const sb = readFileSync("golden.style.f32"); const style = new Float32Array(sb.buffer, sb.byteOffset, 256);
const model = loadModel(MODEL);
const probes = Object.keys(cap).filter((k) => k !== "waveform");
const stop = probes[probes.length - 1];
const env = run(model, { input_ids: T(meta.ids, [1, meta.ids.length], true), style: T(Float64Array.from(style), [1, 256]), speed: T([1], [1]) }, { stopAt: stop });

for (const name of probes) {
  const mine = env.get(name), m = man[name], ob = readFileSync(m.file), ort = new Float32Array(ob.buffer, ob.byteOffset, ob.length / 4);
  if (!mine) { console.log("MISSING(mine) " + name); continue; }
  const n = Math.min(mine.data.length, ort.length); let err = 0, mm = 0, mo = 0;
  for (let i = 0; i < n; i++) { err = Math.max(err, Math.abs(mine.data[i] - ort[i])); mm = Math.max(mm, Math.abs(mine.data[i])); mo = Math.max(mo, Math.abs(ort[i])); }
  const shape = JSON.stringify(mine.dims) === JSON.stringify(m.dims);
  console.log((err < 1e-3 && shape ? "OK  " : ">>> ") + name.slice(-46).padEnd(47) + " err " + err.toExponential(2) + "  mine " + mm.toFixed(3) + " ort " + mo.toFixed(3) + (shape ? "" : "  SHAPE " + JSON.stringify(mine.dims) + "/" + JSON.stringify(m.dims)));
}
