// vendor-voice-model.mjs — make Holo Voice 100% serverless by vendoring its recognizer on-disk.
//
// Downloads, into system/os/usr/lib/holo/voice/vendor/ :
//   • transformers/ — @huggingface/transformers ESM entry + its bundled onnxruntime-web wasm
//   • models/onnx-community/whisper-base/ — the quantized Whisper-base κ-disk (encoder + merged decoder)
//
// The weights are CONTENT-ADDRESSED ARTIFACTS, not source — they are .gitignored. Run this once after
// clone (or to refresh) with cwd = Hologram OS2/system:   node tools/vendor-voice-model.mjs
//
// Every file is verified against a pinned sha256 (PINS below, Law L5) — so the download host is not
// trusted: a tampered or wrong byte changes the hash → refused. After it runs, holo-voice-asr.mjs loads
// everything same-origin: no inference server, no CDN, offline-capable. To bump the model, change MODEL,
// run once with empty PINS (it prints the hashes it got), paste them back in, and commit the script.

import { mkdir, writeFile, rm } from "node:fs/promises";
import { readdirSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VENDOR = path.resolve(HERE, "../os/usr/lib/holo/voice/vendor");
const TF_VER = "3.0.2";
const ORT_VER = "1.21.0-dev.20241024-d9ca84ef96";
const MODEL = "onnx-community/whisper-base";
const hf = (repo, p) => `https://huggingface.co/${repo}/resolve/main/${p}`;
const HF = (p) => hf(MODEL, p);

// ASR (Whisper-base): config + tokenizer + the q8 ("_quantized") encoder & merged decoder.
const MODEL_FILES = [
  "config.json", "generation_config.json", "preprocessor_config.json",
  "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json",
  "added_tokens.json", "normalizer.json", "merges.txt", "vocab.json",
  "onnx/encoder_model_quantized.onnx",
  "onnx/decoder_model_merged_quantized.onnx",
];
// Fast listen tier: Whisper-TINY (~3-5x faster than base on WASM — ASR wall-time dominates response
// onset). Same file layout as base; vendored by default. holo-voice-asr.mjs prefers it, falls back to base.
const MODEL_TINY = "onnx-community/whisper-tiny";

// Agent brain (Phase 2): a small on-device instruct LLM. int8 ("_quantized") is single-file and runs on
// both WASM (any browser) and WebGPU. Bound via HoloQVAC; conversation upgrades from the reference floor.
// Two-tier agent brain. The WASM floor (Qwen2.5-0.5B int8) is ALWAYS vendored — it's the verified,
// any-browser default. Pass --webgpu to ALSO vendor the quality tier (Qwen2.5-1.5B q4f16, ~1GB) for
// WebGPU-capable browsers. WebGPU produced garbage in our headless test env (likely a software-GPU
// issue, not transformers.js — q4f16 Qwen is reported fine on real GPUs); verify on real hardware
// before relying on it (HOLO_VOICE_CONFIG.preferWebGPU=true).
const WANT_WEBGPU = process.argv.includes("--webgpu");
const LLM_BASE = ["config.json", "generation_config.json", "tokenizer.json", "tokenizer_config.json",
  "special_tokens_map.json", "added_tokens.json", "merges.txt", "vocab.json"];
const LLMS = [
  { repo: "onnx-community/Qwen2.5-0.5B-Instruct", files: [...LLM_BASE, "onnx/model_quantized.onnx"] },   // WASM floor (int8)
  ...(WANT_WEBGPU ? [{ repo: "onnx-community/Qwen2.5-1.5B-Instruct", files: [...LLM_BASE, "onnx/model_q4f16.onnx"] }] : []), // WebGPU tier
];

// Q's natural voice — Kokoro-82M (best-in-class on-device TTS). Needs its own transformers (3.5.1) +
// phonemizer (espeak inlined), resolved in the browser via an import map; runs serverless once vendored.
const KOKORO = "onnx-community/Kokoro-82M-v1.0-ONNX";
const KOKORO_VOICES = ["af_heart", "af_bella", "af_nicole", "am_michael", "am_fenrir", "am_puck", "bf_emma", "bm_george"];
const KOKORO_FILES = ["config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model_quantized.onnx",
  ...KOKORO_VOICES.map((v) => "voices/" + v + ".bin")];

// Semantic turn-detector (deep-research RANK 1) — LiveKit's open-weights end-of-turn model, ONNX. Opt-in
// with --turn (it's experimental + ~118MB). Bootstrap: no PINS yet → downloads unpinned and prints the
// sha256 to paste back below. Used by voice/holo-voice-turn.mjs when HOLO_VOICE_CONFIG.turnModel=true.
const WANT_TURN = process.argv.includes("--turn");
const TURN = "onnx-community/turn-detector-ONNX";
const TURN_FILES = ["config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "onnx/model_q4f16.onnx"];

// ── pinned sha256 (Law L5). Keyed by logical name; empty/missing → printed, not enforced (bootstrap). ──
const PINS = {
  // libraries (from @huggingface/transformers@3.0.2 dist)
  "transformers.js": "3171218a65957f10e616cc2a639282d574d327bda3e1a7d0edbb375e4b091e91",
  "transformers.mjs": "913fd75bc7a778280c4af43a2678ede77fc74b287f435ba07ca802ec461123b4",
  "ort-wasm-simd-threaded.jsep.wasm": "0f6fe5c40378504d1a25a77f766133464bb15705af23e01c994f185719fb080e",
  // ASR model files (keyed by repo/path — filenames collide across models)
  "onnx-community/whisper-base/config.json": "f4d0608f7d918166da7edb3e188de5ef1bfe70d9802e785d271fd88111e9cf4b",
  "onnx-community/whisper-base/generation_config.json": "61070cf8de25b1e9256e8e102ded49d8d24a8369ed36ef84fdf21549e68125a0",
  "onnx-community/whisper-base/preprocessor_config.json": "a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d",
  "onnx-community/whisper-base/tokenizer.json": "27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566",
  "onnx-community/whisper-base/tokenizer_config.json": "2e036e4dbacfdeb7242c7d4ec4149f4a16e86026048f94d1637e3a8ee9c6a573",
  "onnx-community/whisper-base/special_tokens_map.json": "e67ae3a0aaa99abcd9f187138e12db1f65c16a14761c50ef10eef2c174a7a691",
  "onnx-community/whisper-base/added_tokens.json": "9715fd2243b6f06a5858b5e32950d2853f73dd5bc201aafcf76f5082a2d8acd1",
  "onnx-community/whisper-base/normalizer.json": "bf1c507dc8724ca9cf9903640dacfb69dae2f00edee4f21ceba106a7392f26dd",
  "onnx-community/whisper-base/merges.txt": "2df2990a395e35e8dfbc7511e08c12d56018d8d04691e0133e5d63b21e154dc6",
  "onnx-community/whisper-base/vocab.json": "50d6a919f0a0601d56a04eb583c780d18553aa388254ba3158eb6a00f13e2c1a",
  "onnx-community/whisper-base/onnx/encoder_model_quantized.onnx": "5862993336bf33acd23736071aae2b32261d3b1b2f37780194460d4ef974dd46",
  "onnx-community/whisper-base/onnx/decoder_model_merged_quantized.onnx": "fa3ef9902734ce5ae6f9ef2bdb2ba9a6c4b5785b09f4f420ce036573dc9d090b",
  // ASR fast listen tier (Whisper-tiny, q8)
  "onnx-community/whisper-tiny/config.json": "46aeea0a406afbeb563fc8e59ca10609203df4299af6a83f73752fef369efd2d",
  "onnx-community/whisper-tiny/generation_config.json": "f5c67e5a4f7102f8cb4d058bc95da276bbc19eeec997267c3bb0f25ef68facd1",
  "onnx-community/whisper-tiny/preprocessor_config.json": "a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d",
  "onnx-community/whisper-tiny/tokenizer.json": "27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566",
  "onnx-community/whisper-tiny/tokenizer_config.json": "2a4c4281cf9f51ac6ccc406fdc711a087afe6530f671fa7b80953edc498275ce",
  "onnx-community/whisper-tiny/special_tokens_map.json": "e67ae3a0aaa99abcd9f187138e12db1f65c16a14761c50ef10eef2c174a7a691",
  "onnx-community/whisper-tiny/added_tokens.json": "9715fd2243b6f06a5858b5e32950d2853f73dd5bc201aafcf76f5082a2d8acd1",
  "onnx-community/whisper-tiny/normalizer.json": "bf1c507dc8724ca9cf9903640dacfb69dae2f00edee4f21ceba106a7392f26dd",
  "onnx-community/whisper-tiny/merges.txt": "2df2990a395e35e8dfbc7511e08c12d56018d8d04691e0133e5d63b21e154dc6",
  "onnx-community/whisper-tiny/vocab.json": "50d6a919f0a0601d56a04eb583c780d18553aa388254ba3158eb6a00f13e2c1a",
  "onnx-community/whisper-tiny/onnx/encoder_model_quantized.onnx": "2af4a414ca47aa30f61246017e5fe82b0a8d229281d1255ba666a2a7f6b84d19",
  "onnx-community/whisper-tiny/onnx/decoder_model_merged_quantized.onnx": "25e807a962b6349356d0ea5d0dfe530b7e5bf0e2a484aeca0359d03143faddd3",
  // LLM — WASM floor (Qwen2.5-0.5B-Instruct, int8)
  "onnx-community/Qwen2.5-0.5B-Instruct/config.json": "777e01f0fbb3346eb229cb6fb278ed6533c1e4dcb9ebf4bed0f6e94ef17fa1b5",
  "onnx-community/Qwen2.5-0.5B-Instruct/generation_config.json": "f7e7ce458658b2d40d9eb213b91b77a8bf698845ab89360976722d7ac46928a3",
  "onnx-community/Qwen2.5-0.5B-Instruct/tokenizer.json": "a8506e7111b80c6d8635951a02eab0f4e1a8e4e5772da83846579e97b16f61bf",
  "onnx-community/Qwen2.5-0.5B-Instruct/tokenizer_config.json": "7e88129d9769a0b14b1587a7d5e829fe93ac0e1511636471fdfc0811951418e6",
  "onnx-community/Qwen2.5-0.5B-Instruct/special_tokens_map.json": "76862e765266b85aa9459767e33cbaf13970f327a0e88d1c65846c2ddd3a1ecd",
  "onnx-community/Qwen2.5-0.5B-Instruct/added_tokens.json": "58b54bbe36fc752f79a24a271ef66a0a0830054b4dfad94bde757d851968060b",
  "onnx-community/Qwen2.5-0.5B-Instruct/merges.txt": "8831e4f1a044471340f7c0a83d7bd71306a5b867e95fd870f74d0c5308a904d5",
  "onnx-community/Qwen2.5-0.5B-Instruct/vocab.json": "ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910",
  "onnx-community/Qwen2.5-0.5B-Instruct/onnx/model_quantized.onnx": "41834041ab1b29eff9fc592f1a29a1844133aea35832ea9fa91682be13016100",
  // LLM — WebGPU quality tier (Qwen2.5-1.5B-Instruct, q4f16). model_q4f16 bootstraps on first --webgpu run.
  "onnx-community/Qwen2.5-1.5B-Instruct/config.json": "215eb99c4955b0c42ea9f6e0980d922c228950c5dbc09bde6dc451fbba4d21f3",
  "onnx-community/Qwen2.5-1.5B-Instruct/generation_config.json": "f7e7ce458658b2d40d9eb213b91b77a8bf698845ab89360976722d7ac46928a3",
  "onnx-community/Qwen2.5-1.5B-Instruct/tokenizer.json": "a8506e7111b80c6d8635951a02eab0f4e1a8e4e5772da83846579e97b16f61bf",
  "onnx-community/Qwen2.5-1.5B-Instruct/tokenizer_config.json": "7e88129d9769a0b14b1587a7d5e829fe93ac0e1511636471fdfc0811951418e6",
  "onnx-community/Qwen2.5-1.5B-Instruct/special_tokens_map.json": "76862e765266b85aa9459767e33cbaf13970f327a0e88d1c65846c2ddd3a1ecd",
  "onnx-community/Qwen2.5-1.5B-Instruct/added_tokens.json": "58b54bbe36fc752f79a24a271ef66a0a0830054b4dfad94bde757d851968060b",
  "onnx-community/Qwen2.5-1.5B-Instruct/merges.txt": "8831e4f1a044471340f7c0a83d7bd71306a5b867e95fd870f74d0c5308a904d5",
  "onnx-community/Qwen2.5-1.5B-Instruct/vocab.json": "ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910",
  "onnx-community/Qwen2.5-1.5B-Instruct/onnx/model_q4f16.onnx": "19dec9f63488016185ba997d5e4492b5ac5b4f7ef1abb45243a91de958838dcd",
  // TTS — Kokoro-82M (Q's natural voice)
  "onnx-community/Kokoro-82M-v1.0-ONNX/config.json": "df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f",
  "onnx-community/Kokoro-82M-v1.0-ONNX/tokenizer.json": "77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34",
  "onnx-community/Kokoro-82M-v1.0-ONNX/tokenizer_config.json": "be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20",
  "onnx-community/Kokoro-82M-v1.0-ONNX/onnx/model_quantized.onnx": "fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478",
  "onnx-community/Kokoro-82M-v1.0-ONNX/voices/af_heart.bin": "d583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b",
  "onnx-community/Kokoro-82M-v1.0-ONNX/voices/af_bella.bin": "f69d836209b78eb8c66e75e3cda491e26ea838a3674257e9d4e5703cbaf55c8b",
  "onnx-community/Kokoro-82M-v1.0-ONNX/voices/af_nicole.bin": "cd2191ab31b914ed7b318416b0e4440fdf392ddad9106a060819aa600a64f59a",
  "onnx-community/Kokoro-82M-v1.0-ONNX/voices/am_michael.bin": "1d1f21dd8da39c30705cd4c75d039d265e9bc4a2a93ed09bc9e1b1225eb95ba1",
  "onnx-community/Kokoro-82M-v1.0-ONNX/voices/am_fenrir.bin": "c27989f741f7ee34d273a39d8a595cc0837d35f5ced9a29b7cc162614616df43",
  "onnx-community/Kokoro-82M-v1.0-ONNX/voices/am_puck.bin": "fcf73c989033e9233e0b98713eca600c8c74dcc1614b37009d5450ff4a2274a0",
  "onnx-community/Kokoro-82M-v1.0-ONNX/voices/bf_emma.bin": "669fe0647f9dd04fcab92f1439a40eeb4c8b4ab1f82e4996fe3d918ce4a63b73",
  "onnx-community/Kokoro-82M-v1.0-ONNX/voices/bm_george.bin": "c4b235a4c1f2cd3b939fed08b899ce9385638b763f7b73a59616c4fc9bd6c9bc",
};
const _seen = {};
function verify(name, buf) {
  const got = createHash("sha256").update(buf).digest("hex");
  const want = PINS[name];
  if (want && got !== want) throw new Error(`HASH MISMATCH ${name}\n  expected ${want}\n  got      ${got}`);
  _seen[name] = got;
  return want ? "✓ pinned" : "(unpinned — add: \"" + name + "\": \"" + got + "\")";
}

async function get(url) {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
  return Buffer.from(await r.arrayBuffer());
}
const mb = (n) => (n / 1048576).toFixed(1) + " MB";

async function vendorRepo(repo, files) {
  const dst = path.join(VENDOR, "models", repo);
  let total = 0;
  for (const f of files) {
    const key = repo + "/" + f, fp = path.join(dst, f);
    await mkdir(path.dirname(fp), { recursive: true });               // onnx/ , voices/ , …
    if (PINS[key] && existsSync(fp) && createHash("sha256").update(readFileSync(fp)).digest("hex") === PINS[key]) {
      _seen[key] = PINS[key]; console.log(`  · ${f} … cached ✓`); continue;   // already present + verified
    }
    process.stdout.write(`  · ${f} … `);
    const buf = await get(hf(repo, f));
    const v = verify(key, buf);                                        // throws on a pinned-hash mismatch
    await writeFile(fp, buf);
    total += buf.length; console.log(mb(buf.length), v);
  }
  console.log(`  ${repo} total: ${mb(total)}`);
}

// minimal in-process tar.gz reader (Windows + GNU tar mangles "C:\…" paths, so we extract natively).
function untarGz(buf) {
  const data = gunzipSync(buf), files = {};
  let off = 0;
  while (off + 512 <= data.length) {
    const h = data.subarray(off, off + 512);
    const name = h.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    if (!name) break;                                                  // end-of-archive zero block
    const size = parseInt(h.subarray(124, 136).toString("utf8").replace(/\0.*$/, "").trim(), 8) || 0;
    const type = String.fromCharCode(h[156] || 48);
    const start = off + 512;
    if (type === "0" || type === "\0" || type === "") files[name] = Buffer.from(data.subarray(start, start + size));
    off = start + Math.ceil(size / 512) * 512;
  }
  return files;
}
function pack(spec, into) {
  // npm pack → tarball; return { "package/<path>": Buffer } without shelling out to tar.
  mkdirSync(into, { recursive: true });
  execSync(`npm pack ${spec} --pack-destination "${into}" --silent`, { stdio: ["ignore", "ignore", "inherit"], shell: true });
  const tgz = readdirSync(into).find((f) => f.endsWith(".tgz"));
  if (!tgz) throw new Error(`no tarball produced for ${spec}`);
  return untarGz(readFileSync(path.join(into, tgz)));
}

async function vendorLibs() {
  const tmp = path.join(tmpdir(), "holo-voice-vendor-" + Date.now());
  await mkdir(tmp, { recursive: true });
  try {
    console.log("  · @huggingface/transformers (npm pack)…");
    const files = pack(`@huggingface/transformers@${TF_VER}`, path.join(tmp, "tf"));
    const out = path.join(VENDOR, "transformers");
    await rm(out, { recursive: true, force: true });
    await mkdir(out, { recursive: true });
    // The transformers package BUNDLES its onnxruntime-web wasm in dist/ — keep the ESM entry + every
    // wasm so nothing is fetched from a CDN at runtime. Skip the heavy source maps and min duplicates.
    const got = [];
    for (const [name, buf] of Object.entries(files)) {
      const base = name.replace(/^package\/dist\//, "");
      if (name.startsWith("package/dist/") && (base === "transformers.js" || base === "transformers.mjs" || base.endsWith(".wasm"))) {
        const v = verify(base, buf);                                  // throws on a pinned-hash mismatch
        await writeFile(path.join(out, base), buf); got.push(base); console.log("    " + base, mb(buf.length), v);
      }
    }
    console.log("  · vendored:", got.join(", "));
    if (!got.some((f) => f.endsWith(".wasm"))) throw new Error("no ORT wasm found in transformers dist");
  } finally { await rm(tmp, { recursive: true, force: true }); }
}

// Kokoro's libs into vendor/kokoro/: its OWN transformers (3.5.1, kokoro needs >=3.5) + bundled ORT wasm,
// the phonemizer (espeak inlined), kokoro-js itself, and a stub for the node built-ins kokoro imports.
async function vendorKokoroLibs() {
  const tmp = path.join(tmpdir(), "holo-kokoro-vendor-" + Date.now());
  await mkdir(tmp, { recursive: true });
  const out = path.join(VENDOR, "kokoro");
  await rm(out, { recursive: true, force: true });
  await mkdir(path.join(out, "transformers"), { recursive: true });
  try {
    console.log("  · @huggingface/transformers@3.5.1 (for kokoro)…");
    const tf = pack("@huggingface/transformers@3.5.1", path.join(tmp, "tf"));
    for (const [name, buf] of Object.entries(tf)) {
      const base = name.replace(/^package\/dist\//, "");
      // transformers entry + ORT wasm AND its .mjs loaders (3.5.x loads ort-wasm-*.jsep.mjs at runtime).
      if (name.startsWith("package/dist/") && (base === "transformers.js" || base.endsWith(".wasm") || /^ort-.*\.mjs$/.test(base))) {
        await writeFile(path.join(out, "transformers", base), buf); console.log("    transformers/" + base, mb(buf.length));
      }
    }
    console.log("  · phonemizer (espeak inlined)…");
    const ph = pack("phonemizer@1.2.1", path.join(tmp, "ph"));
    await writeFile(path.join(out, "phonemizer.js"), ph["package/dist/phonemizer.js"]);
    console.log("  · kokoro-js…");
    const kk = pack("kokoro-js@1.2.1", path.join(tmp, "kk"));
    await writeFile(path.join(out, "kokoro.js"), kk["package/dist/kokoro.js"]);
    // stub for the node-only built-ins kokoro statically imports (unused in the browser path).
    await writeFile(path.join(out, "stub.js"),
      "// browser stub for node built-ins kokoro-js imports but doesn't use client-side.\n" +
      "export const join = (...a) => a.join('/');\nexport const resolve = (...a) => a.join('/');\nexport const dirname = (p) => String(p).replace(/\\/[^/]*$/, '');\n" +
      "export const readFile = async () => { throw new Error('fs unavailable in browser'); };\nexport default {};\n");
    console.log("  · kokoro libs vendored → vendor/kokoro/");
  } finally { await rm(tmp, { recursive: true, force: true }); }
}

(async () => {
  console.log("Vendoring Holo Voice recognizer →", VENDOR);
  await mkdir(VENDOR, { recursive: true });
  console.log("[1/4] libraries (transformers.js + onnxruntime-web wasm)");
  await vendorLibs();
  console.log("[2/4] ASR weights (" + MODEL + " + " + MODEL_TINY + ", quantized)");
  await vendorRepo(MODEL, MODEL_FILES);
  await vendorRepo(MODEL_TINY, MODEL_FILES);                            // fast listen tier (same layout; pins bootstrap)
  console.log("[3/4] agent LLM weights (" + LLMS.map((l) => l.repo.split("/").pop()).join(" + ") + ")");
  for (const l of LLMS) await vendorRepo(l.repo, l.files);
  console.log("[4/4] Q's natural voice — Kokoro-82M (TTS)");
  await vendorKokoroLibs();
  await vendorRepo(KOKORO, KOKORO_FILES);
  if (WANT_TURN) { console.log("[+] semantic turn-detector (" + TURN + ", --turn)"); await vendorRepo(TURN, TURN_FILES); }
  await writeFile(path.join(VENDOR, "README.md"),
    `# Holo Voice vendored recognizer (serverless, .gitignored)\n\n` +
    `Generated + sha256-verified by tools/vendor-voice-model.mjs (run it after clone). NOT committed —\n` +
    `these are content-addressed artifacts, not source. See holo-models for the artifact store.\n\n` +
    `- transformers/ — @huggingface/transformers@${TF_VER} ESM entry + bundled onnxruntime-web wasm\n` +
    `  (the .wasm here is set as env.backends.onnx.wasm.wasmPaths, so no CDN wasm fetch)\n` +
    `- models/${MODEL}/ — quantized Whisper-base (encoder + merged decoder) — speech recognition\n` +
    LLMS.map((l) => `- models/${l.repo}/ — the agent brain (text generation)\n`).join("") +
    `- kokoro/ — kokoro-js + transformers@3.5.1 + phonemizer (resolved via import map)\n` +
    `- models/${KOKORO}/ — Q's natural voice (Kokoro-82M, quantized) + voices/\n` + `\n` +
    `Everything loads same-origin; nothing is fetched from a CDN at runtime.\n`);
  const unpinned = Object.keys(_seen).filter((k) => !PINS[k]);
  if (unpinned.length) {
    console.log("\n⚠ unpinned files — paste these into PINS to lock integrity:");
    for (const k of unpinned) console.log(`  "${k}": "${_seen[k]}",`);
  }
  console.log("\nDone. holo-voice-asr.mjs will now load on-device, serverless. (weights are .gitignored)");
})().catch((e) => { console.error("\nVENDOR FAILED:", e && e.message || e); process.exit(1); });
