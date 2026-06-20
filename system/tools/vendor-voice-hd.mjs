// vendor-voice-hd.mjs — vendor the HD VOICE (Parler-TTS Mini) for a fully serverless, on-device upgrade.
//
// Run on a NETWORKED machine, cwd = Hologram OS .../system:   node tools/vendor-voice-hd.mjs
//
// Fetches (content-addressed, Law L5 — a tampered byte changes the sha256 and is refused):
//   • vendor/voice-hd/transformers/  — an ISOLATED FULL @huggingface/transformers (the Kokoro-bundled one
//     is tree-shaken and lacks the ParlerTTS class) + its ORT wasm. Same isolation as the embedder (3.8.1).
//   • vendor/models/<MODEL>/         — Parler-TTS Mini ONNX: config + tokenizer + onnx/* (auto-discovered
//     from the HF repo tree, so no hand-maintained file list).
//
// Weights are .gitignored artifacts, never committed. BOOTSTRAP: PINS is empty on first run → it downloads
// unpinned, prints the sha256 κ-manifest, and you paste the hashes into PINS (and models.manifest.json)
// and commit — after which the download host is no longer trusted. This mirrors vendor-voice-model.mjs.

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VENDOR = path.resolve(HERE, "../os/usr/lib/holo/voice/vendor");
const TF_VER = "3.8.1";                                   // full jsDelivr dist build (includes ParlerTTS)
const MODEL = "onnx-community/parler-tts-mini-v1-ONNX";   // ⚠ confirm exact repo id on first run if 404
const PREFER_QUANTIZED = true;                            // keep onnx/*quantized* (smaller); fall back to all onnx

// ── pinned sha256 (Law L5). Empty on first run → printed, not enforced. Paste back after bootstrap. ──
const PINS = {};

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const _seen = {};
async function fetchBuf(url) {
  const r = await fetch(url); if (!r.ok) throw new Error("HTTP " + r.status + " " + url);
  return new Uint8Array(await r.arrayBuffer());
}
async function take(key, url, outPath) {
  const fp = path.join(VENDOR, outPath);
  if (PINS[key] && existsSync(fp) && sha256(readFileSync(fp)) === PINS[key]) { _seen[key] = PINS[key]; console.log("  · " + outPath + " … cached ✓"); return; }
  const buf = await fetchBuf(url);
  const got = sha256(buf);
  if (PINS[key] && got !== PINS[key]) throw new Error("✗ sha256 mismatch for " + key + " — refused (want " + PINS[key].slice(0, 12) + "… got " + got.slice(0, 12) + "…)");
  await mkdir(path.dirname(fp), { recursive: true });
  await writeFile(fp, buf);
  _seen[key] = got;
  console.log("  · " + outPath + " … " + (buf.length / 1048576).toFixed(1) + "MB " + (PINS[key] ? "verified ✓" : "(" + got.slice(0, 16) + "…)"));
}

async function transformers() {
  console.log("@huggingface/transformers@" + TF_VER + " (isolated FULL build → vendor/voice-hd/transformers/)…");
  const base = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TF_VER}/dist/`;
  for (const f of ["transformers.js", "ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"]) {
    await take("hd/" + f, base + f, "voice-hd/transformers/" + f);
  }
}
async function model() {
  console.log(MODEL + " (auto-discovering files from the HF repo tree)…");
  const tree = await (await fetch(`https://huggingface.co/api/models/${MODEL}/tree/main?recursive=1`)).json();
  if (!Array.isArray(tree)) throw new Error("could not list repo tree for " + MODEL + " — confirm the repo id");
  const all = tree.filter((e) => e && e.type === "file").map((e) => e.path);
  const meta = all.filter((p) => /\.(json|txt)$/.test(p) && !p.startsWith("onnx/"));
  let onnx = all.filter((p) => p.startsWith("onnx/") && p.endsWith(".onnx"));
  if (PREFER_QUANTIZED && onnx.some((p) => /quantized|q8|int8|uint8/i.test(p))) onnx = onnx.filter((p) => /quantized|q8|int8|uint8/i.test(p));
  const files = [...meta, ...onnx];
  if (!files.length) throw new Error("no model files discovered for " + MODEL);
  console.log("  found " + files.length + " files (" + onnx.length + " onnx)");
  for (const f of files) await take(MODEL + "/" + f, `https://huggingface.co/${MODEL}/resolve/main/${f}`, "models/" + MODEL + "/" + f);
}

(async () => {
  await mkdir(VENDOR, { recursive: true });
  await transformers();
  await model();
  console.log("\n── κ-manifest (paste into PINS here, and models.manifest.json) ──");
  console.log(JSON.stringify(_seen, null, 2));
  const unpinned = Object.keys(_seen).filter((k) => !PINS[k]);
  console.log(unpinned.length ? `\nBootstrap: ${unpinned.length} unpinned file(s) — paste the hashes above into PINS and re-run to enforce.` : "\nAll files verified against PINS ✓ (Law L5).");
  console.log("Next: open the bake-off harness, pick 'Parler-TTS Mini', Synthesize, and blind-A/B vs Kokoro.");
})().catch((e) => { console.error("\n" + (e && e.message || e)); process.exit(1); });
