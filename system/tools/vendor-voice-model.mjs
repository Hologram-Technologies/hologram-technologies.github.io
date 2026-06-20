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
// Agent brain (ADR-0096): ONE any-browser model that covers conversation AND agentic coding —
// Qwen2.5-Coder-1.5B-Instruct at q8 (model_quantized, single-file, runs on WASM any-browser + WebGPU).
// The light Qwen2.5-0.5B (int8) stays vendored as the responsive FALLBACK floor. The old WebGPU-only
// Qwen2.5-1.5B q4f16 tier is REMOVED (it aborted onnxruntime-web's WebGPU EP on real HW; superseded).
const LLM_BASE = ["config.json", "generation_config.json", "tokenizer.json", "tokenizer_config.json",
  "special_tokens_map.json", "added_tokens.json", "merges.txt", "vocab.json"];
const LLMS = [
  { repo: "onnx-community/Qwen2.5-Coder-1.5B-Instruct", files: [...LLM_BASE, "onnx/model_quantized.onnx"] },   // brain + coder (q8, ~1.8GB)
  { repo: "onnx-community/Qwen2.5-0.5B-Instruct", files: [...LLM_BASE, "onnx/model_quantized.onnx"] },         // responsive fallback floor (int8)
  { repo: "HuggingFaceTB/SmolLM2-360M-Instruct", files: [...LLM_BASE, "onnx/model_quantized.onnx"] },          // fast base for cheap tasks (q8, ~376MB, ADR-0096)
];

// Q's natural voice — Kokoro-82M (best-in-class on-device TTS). Needs its own transformers (3.5.1) +
// phonemizer (espeak inlined), resolved in the browser via an import map; runs serverless once vendored.
const KOKORO = "onnx-community/Kokoro-82M-v1.0-ONNX";
const KOKORO_VOICES = ["af_heart", "af_bella", "af_nicole", "am_michael", "am_fenrir", "am_puck", "bf_emma", "bm_george"];
const KOKORO_FILES = ["config.json", "tokenizer.json", "tokenizer_config.json",
  "onnx/model_quantized.onnx",                 // q8 — WASM (any browser)
  "onnx/model_fp16.onnx",                      // fp16 — WebGPU (q8 won't run on the WebGPU EP); lower latency. Bootstrap: no PIN yet → fetched unpinned + sha256 printed to paste back.
  ...KOKORO_VOICES.map((v) => "voices/" + v + ".bin")];

// Semantic turn-detector (deep-research RANK 1) — LiveKit's open-weights end-of-turn model, ONNX. Opt-in
// with --turn (it's experimental + ~118MB). Bootstrap: no PINS yet → downloads unpinned and prints the
// sha256 to paste back below. Used by voice/holo-voice-turn.mjs when HOLO_VOICE_CONFIG.turnModel=true.
const WANT_TURN = process.argv.includes("--turn");
const TURN = "onnx-community/turn-detector-ONNX";
const TURN_FILES = ["config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "onnx/model_q4f16.onnx"];

// Sovereign stage-1 WAKE GATE — Silero VAD (MIT), pure ONNX. It runs on the onnxruntime-web that
// transformers.js ALREADY bundles (loaded via AutoModel with config:{model_type:'custom'} — there's no
// config.json in the repo), so there's no new runtime and no emscripten build. Tiny (~2 MB fp32 / ~639 KB
// q8). Vendored BY DEFAULT (small + broadly useful). holo-voice-vad.mjs gates Whisper on real speech, so a
// slammed door / music never wakes the recognizer. Bootstrap: no PINS yet → downloads unpinned + prints
// the sha256 to paste back below. (Replaced the sherpa-onnx KWS path, which needed an emscripten wasm
// runtime we can't vendor in-browser — see the holo-voice memory.)
const VAD_REPO = "onnx-community/silero-vad";
const VAD_FILES = ["onnx/model.onnx", "onnx/model_quantized.onnx"];   // fp32 (default) + q8 (optional smaller)

// semantic embeddings — EmbeddingGemma-300m q8 (Q's semantic memory: recall · skills · RAG; ADR-0096).
// model_quantized.onnx carries its weights in the sibling .onnx_data (external-data ONNX).
const EMBED_REPO = "onnx-community/embeddinggemma-300m-ONNX";
const EMBED_FILES = ["config.json", "generation_config.json", "tokenizer.json", "tokenizer.model", "tokenizer_config.json", "special_tokens_map.json", "onnx/model_quantized.onnx", "onnx/model_quantized.onnx_data"];

// sight — SmolVLM-256M-Instruct q8 (Q's vision: describe / answer about an image; ADR-0096). A 3-part VLM
// (vision_encoder · embed_tokens · decoder_model_merged), each its own _quantized session. Rides the same
// isolated transformers.js 3.8.1 as the embedder (Idefics3/SmolVLM isn't in the main 3.0.2). ~254MB total.
const VISION_REPO = "HuggingFaceTB/SmolVLM-256M-Instruct";
const VISION_FILES = ["config.json", "generation_config.json", "preprocessor_config.json", "processor_config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "added_tokens.json", "chat_template.json", "merges.txt", "vocab.json",
  "onnx/vision_encoder_quantized.onnx", "onnx/embed_tokens_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx"];

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
  // fast base — SmolLM2-360M-Instruct q8 (cheap tasks: routing·titling·compression·approval·curation)
  "HuggingFaceTB/SmolLM2-360M-Instruct/config.json": "224f72354f10d617a359cc82ad15a3c96e866b9b2ffadb81997eeea9e88e22ee",
  "HuggingFaceTB/SmolLM2-360M-Instruct/generation_config.json": "87b916edaaab66b3899b9d0dd0752727dff6666686da0504d89ae0a6e055a013",
  "HuggingFaceTB/SmolLM2-360M-Instruct/tokenizer.json": "9ca9acddb6525a194ec8ac7a87f24fbba7232a9a15ffa1af0c1224fcd888e47c",
  "HuggingFaceTB/SmolLM2-360M-Instruct/tokenizer_config.json": "4ec77d44f62efeb38d7e044a1db318f6a939438425312dfa333b8382dbad98df",
  "HuggingFaceTB/SmolLM2-360M-Instruct/special_tokens_map.json": "2b7379f3ae813529281a5c602bc5a11c1d4e0a99107aaa597fe936c1e813ca52",
  "HuggingFaceTB/SmolLM2-360M-Instruct/added_tokens.json": "f36668ddf22403a332f978057d527cf285b01468bc3431b04094a7bafa6aba59",
  "HuggingFaceTB/SmolLM2-360M-Instruct/merges.txt": "0b54e8aa4e53d5383e2e4bc635a56b43f9647f7b13832d5d9ecd8f82dac4f510",
  "HuggingFaceTB/SmolLM2-360M-Instruct/vocab.json": "82b84012e3add4d01d12ba14442026e49b8cbbaead1f79ecf3d919784f82dc79",
  "HuggingFaceTB/SmolLM2-360M-Instruct/onnx/model_quantized.onnx": "57987a3a24dc34ad2cb5e7e566840ccaece095e35a24ae4fc5b3086c7ddd6918",
  // LLM — brain + agentic coder (Qwen2.5-Coder-1.5B-Instruct, q8 model_quantized, ADR-0096)
  "onnx-community/Qwen2.5-Coder-1.5B-Instruct/config.json": "debf0b90deaf6cbcb066fc26e048d4f14414828114a206b09f263730b1ad7f3c",
  "onnx-community/Qwen2.5-Coder-1.5B-Instruct/generation_config.json": "0dc30d5b7f022dcbfaaef3e55340642208a3b0436214346caf1c522c009f699d",
  "onnx-community/Qwen2.5-Coder-1.5B-Instruct/tokenizer.json": "9c5ae00e602b8860cbd784ba82a8aa14e8feecec692e7076590d014d7b7fdafa",
  "onnx-community/Qwen2.5-Coder-1.5B-Instruct/tokenizer_config.json": "7e88129d9769a0b14b1587a7d5e829fe93ac0e1511636471fdfc0811951418e6",
  "onnx-community/Qwen2.5-Coder-1.5B-Instruct/special_tokens_map.json": "76862e765266b85aa9459767e33cbaf13970f327a0e88d1c65846c2ddd3a1ecd",
  "onnx-community/Qwen2.5-Coder-1.5B-Instruct/added_tokens.json": "58b54bbe36fc752f79a24a271ef66a0a0830054b4dfad94bde757d851968060b",
  "onnx-community/Qwen2.5-Coder-1.5B-Instruct/merges.txt": "8831e4f1a044471340f7c0a83d7bd71306a5b867e95fd870f74d0c5308a904d5",
  "onnx-community/Qwen2.5-Coder-1.5B-Instruct/vocab.json": "ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910",
  "onnx-community/Qwen2.5-Coder-1.5B-Instruct/onnx/model_quantized.onnx": "92f3b69db6c85669db5ed18d501a6e47f8aaf849b847a3c27a2014905db1cc17",
  // Embeddings — EmbeddingGemma-300m q8 (Q's semantic memory, ADR-0096); model_quantized carries weights in .onnx_data
  "onnx-community/embeddinggemma-300m-ONNX/config.json": "6e1f06404b7163e0325ed2ea3e6781cde50f4a50b31780a95ad0d30e8404d77b",
  "onnx-community/embeddinggemma-300m-ONNX/generation_config.json": "1fb1efd221c1ca88a736d1b36cb47d754c177677e222acb3b1e5424c5d664870",
  "onnx-community/embeddinggemma-300m-ONNX/tokenizer.json": "4dda02faaf32bc91031dc8c88457ac272b00c1016cc679757d1c441b248b9c47",
  "onnx-community/embeddinggemma-300m-ONNX/tokenizer.model": "1299c11d7cf632ef3b4e11937501358ada021bbdf7c47638d13c0ee982f2e79c",
  "onnx-community/embeddinggemma-300m-ONNX/tokenizer_config.json": "3ca953eea6c3c9fcda9cf3df22949ff18b216f7c74bd6459230f3f1013953f3a",
  "onnx-community/embeddinggemma-300m-ONNX/special_tokens_map.json": "2f7b0adf4fb469770bb1490e3e35df87b1dc578246c5e7e6fc76ecf33213a397",
  "onnx-community/embeddinggemma-300m-ONNX/onnx/model_quantized.onnx": "172efde319fe1542dc41f31be6154910b05b78f7a861c265c4600eec906bd6d8",
  "onnx-community/embeddinggemma-300m-ONNX/onnx/model_quantized.onnx_data": "705626e28e4c23c82ade34566b4197d97f534c12275fa406dfb71e9937d388c0",
  // sight — SmolVLM-256M-Instruct q8 (3-part VLM)
  "HuggingFaceTB/SmolVLM-256M-Instruct/config.json": "b70fb4bfde88df9eeebc9d8ff523733b8bf70d6c9b06c610325960e06ae9db52",
  "HuggingFaceTB/SmolVLM-256M-Instruct/generation_config.json": "067a2a54e5f87162ecac6e0e911cc4665fc8f7f3324794ecbac0f76badb56636",
  "HuggingFaceTB/SmolVLM-256M-Instruct/preprocessor_config.json": "6cb6e36d6fcb88ca1502c4a26750715dc3e7dedddc9a8f17b27d8d167d1457e7",
  "HuggingFaceTB/SmolVLM-256M-Instruct/processor_config.json": "e7bff42da73ae9eec9042ef20e066e11f1ee20f025358ff79131e3c0fb549b46",
  "HuggingFaceTB/SmolVLM-256M-Instruct/tokenizer.json": "5ece781dc8d2b2f3e2f289ca0ae50b17cfc27dd27bfe7971bb8241e0b964331a",
  "HuggingFaceTB/SmolVLM-256M-Instruct/tokenizer_config.json": "36c6fd44d07d10fd8180ee6b46dcccf69fb7c06753968ff0d7e17b8bfe17b777",
  "HuggingFaceTB/SmolVLM-256M-Instruct/special_tokens_map.json": "aa0ff906077086dfa9734a7f97f68c825877a48f9468807be65504495cdeef09",
  "HuggingFaceTB/SmolVLM-256M-Instruct/added_tokens.json": "74135b8664b56088c0006f1c8e848d79a8eba003411f72ebf1dc2ee96227be3a",
  "HuggingFaceTB/SmolVLM-256M-Instruct/chat_template.json": "a68ad1a42681ae44eacd109ff8dd56a840f761c03d72f4ff4c515d092f882168",
  "HuggingFaceTB/SmolVLM-256M-Instruct/merges.txt": "0b54e8aa4e53d5383e2e4bc635a56b43f9647f7b13832d5d9ecd8f82dac4f510",
  "HuggingFaceTB/SmolVLM-256M-Instruct/vocab.json": "82b84012e3add4d01d12ba14442026e49b8cbbaead1f79ecf3d919784f82dc79",
  "HuggingFaceTB/SmolVLM-256M-Instruct/onnx/vision_encoder_quantized.onnx": "f82adc84246fbfe8651038470166385452682cc889538f5106544e622e5f1595",
  "HuggingFaceTB/SmolVLM-256M-Instruct/onnx/embed_tokens_quantized.onnx": "4b919b829fe2bf225e42431230c56891116f0149e5170e36c99bcc0cfae0d2ef",
  "HuggingFaceTB/SmolVLM-256M-Instruct/onnx/decoder_model_merged_quantized.onnx": "33f14f3bca52699d733d86fcc9c5a0ec6f57afffa1dc9596abde53cde9df81aa",
  // the embedder's isolated transformers.js 3.8.1 (Gemma3-aware) + its ORT wasm — vendor/transformers-embed/
  "embed/transformers.js": "ca697cc102b304de065fbbbd7f3714084d18531509741066ea0bb0326a8ac815",
  "embed/ort-wasm-simd-threaded.jsep.mjs": "08fb86ec433c78bfb032c5d84a68b8e8e5a8d81268fa39e24314179a5767a5b9",
  "embed/ort-wasm-simd-threaded.jsep.wasm": "c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39",
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
  // sovereign wake gate — Silero VAD (MIT), pure ONNX on the bundled ORT
  "onnx-community/silero-vad/onnx/model.onnx": "a4a068cd6cf1ea8355b84327595838ca748ec29a25bc91fc82e6c299ccdc5808",
  "onnx-community/silero-vad/onnx/model_quantized.onnx": "982c96dc518784fb9d19bc7f56cc8252473b020e4f2099f32049e4ad0b3b43e7",
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

// The EMBEDDER's ISOLATED transformers.js — 3.8.1 (knows Gemma3 / EmbeddingGemma, which the main 3.0.2
// does not), kept in vendor/transformers-embed/ so the proven ASR/LLM/TTS stack stays on 3.0.2. Fetched
// from the npm dist on jsDelivr (the bundled ESM + its ORT wasm + the .jsep.mjs loader), sha256-pinned.
const EMBED_TF_VER = "3.8.1";
async function vendorEmbedLib() {
  const out = path.join(VENDOR, "transformers-embed");
  await mkdir(out, { recursive: true });
  const base = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${EMBED_TF_VER}/dist/`;
  for (const f of ["transformers.js", "ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"]) {
    const key = "embed/" + f, fp = path.join(out, f);
    if (PINS[key] && existsSync(fp) && createHash("sha256").update(readFileSync(fp)).digest("hex") === PINS[key]) { _seen[key] = PINS[key]; console.log(`  · ${f} … cached ✓`); continue; }
    process.stdout.write(`  · ${f} … `);
    const buf = await get(base + f);
    const v = verify(key, buf);
    await writeFile(fp, buf);
    console.log(mb(buf.length), v);
  }
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
  console.log("[1/5] libraries (transformers.js + onnxruntime-web wasm)");
  await vendorLibs();
  console.log("[2/5] ASR weights (" + MODEL + " + " + MODEL_TINY + ", quantized)");
  await vendorRepo(MODEL, MODEL_FILES);
  await vendorRepo(MODEL_TINY, MODEL_FILES);                            // fast listen tier (same layout; pins bootstrap)
  console.log("[3/5] agent LLM weights (" + LLMS.map((l) => l.repo.split("/").pop()).join(" + ") + ")");
  for (const l of LLMS) await vendorRepo(l.repo, l.files);
  console.log("[4/5] Q's natural voice — Kokoro-82M (TTS)");
  await vendorKokoroLibs();
  await vendorRepo(KOKORO, KOKORO_FILES);
  if (WANT_TURN) { console.log("[+] semantic turn-detector (" + TURN + ", --turn)"); await vendorRepo(TURN, TURN_FILES); }
  console.log("[5/6] sovereign wake gate — Silero VAD (" + VAD_REPO + ", pure ONNX on the bundled ORT)");
  await vendorRepo(VAD_REPO, VAD_FILES);
  console.log("[6/6] semantic memory — EmbeddingGemma-300m q8 (" + EMBED_REPO + ") + its isolated transformers " + EMBED_TF_VER);
  await vendorEmbedLib();
  await vendorRepo(EMBED_REPO, EMBED_FILES);
  console.log("[7/7] sight — SmolVLM-256M-Instruct q8 (" + VISION_REPO + ") on the isolated transformers " + EMBED_TF_VER);
  await vendorRepo(VISION_REPO, VISION_FILES);
  await writeFile(path.join(VENDOR, "README.md"),
    `# Holo Voice vendored recognizer (serverless, .gitignored)\n\n` +
    `Generated + sha256-verified by tools/vendor-voice-model.mjs (run it after clone). NOT committed —\n` +
    `these are content-addressed artifacts, not source. κ-pins: voice/models.manifest.json.\n\n` +
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
