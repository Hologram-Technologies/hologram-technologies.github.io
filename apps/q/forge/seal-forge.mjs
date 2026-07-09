// Seal the GGUF Forge as a κ-object: walk the runtime files, content-address each
// (did:holo:sha256 = L1), and write holospace.lock.json whose root κ is the app's
// identity. Uses the substrate's canonical primitives (holo-uor) so the seal speaks
// the same axis as the rest of the OS. Edit any sealed byte and the lock no longer
// re-derives (L5) — re-run this sealer to re-pin.

import { readFileSync, writeFileSync } from "node:fs";
import { sha256hex, sriOf, mbSha256, didHolo, jcs } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

// The forge runtime closure (source of truth modules + GPU kernels + manifest).
// Tests, harnesses, generators, the sealer/witness, and large model artifacts are
// not part of the runtime and are intentionally excluded.
export const SEALED = [
  "holospace.json",
  "gguf-forge.mjs",
  "gguf-forge-dequant.mjs",
  "gguf-forge-iq-grids.mjs",
  "gguf-forge-iq-dequant.mjs",
  "gguf-forge-quantize.mjs",
  "gguf-forge-kvmem.mjs",
  "gguf-forge-matmul.mjs",
  "gguf-forge-graph.mjs",
  "gguf-forge-kernels.mjs",
  "gguf-forge-exec.mjs",
  "gguf-forge-tokenizer.mjs",
  "gguf-forge-gpupack.mjs",
  "gguf-forge-kvcache.mjs",
  "gguf-forge-kstream.mjs",
  "gguf-forge-turboquant.mjs",
  "gguf-forge-lora-train.mjs",
  "gguf-forge-lora-graph.mjs",
  "gguf-forge-whisper.mjs",
  // persistent content-addressed κ-store (OPFS warm-cache shared across all .holo models)
  "gpu/holo-kappa-store.mjs",
  // LoRA adapter as a κ-object (adapter-inference in the forward; open base+adapter by link)
  "gpu/holo-lora.mjs",
  // GPU witness pages
  "gpu/index.html",
  "gpu/kernels.html",
  // ONE shared WGSL kernel runtime (run-native + Q's brain consume the same kernels)
  "gpu/holo-gguf-gpu.mjs",
  // κ-native browser runtime (forges GGUF in-browser, no server compute)
  "gpu/run-native.html",
  "gpu/chat.html",
  // share-a-chat surface: a conversation is a content κ, shared as a URL #fragment link, resumed by re-prefill
  "gpu/chat-share.html",
  // κ-native Whisper "ear": κ-streamed weights + GPU encoder-decoder forward + ASR provider (W-6)
  "gpu/holo-whisper-stream.mjs",
  "gpu/holo-whisper-gpu.mjs",
  "gpu/holo-whisper-frontend.mjs",
  "gpu/holo-whisper-ear.mjs",
  "gpu/whisper-transcribe-streamed.html",
  "gpu/whisper-ear-witness.html",
  "gpu/whisper-ear-e2e.html",
];

export function buildClosure(root = new URL(".", import.meta.url)) {
  const closure = {};
  for (const rel of [...SEALED].sort()) {
    const bytes = new Uint8Array(readFileSync(new URL(rel, root)));
    closure[rel] = {
      kappa: didHolo("sha256", sha256hex(bytes)),
      sri: sriOf(bytes),
      multibase: mbSha256(bytes),
      bytes: bytes.length,
    };
  }
  return closure;
}

// root κ = identity over the canonical closure (L1: identity is content).
export const rootOf = (closure) => didHolo("sha256", sha256hex(jcs(closure)));

export function seal() {
  const closure = buildClosure();
  const root = rootOf(closure);
  const lock = {
    "@context": "https://hologram.os/ns/holospace.jsonld",
    root,
    identifier: "org.hologram.GgufForge",
    algo: "sha256",
    files: Object.keys(closure).length,
    closure,
  };
  writeFileSync(new URL("./holospace.lock.json", import.meta.url), JSON.stringify(lock, null, 2) + "\n");
  return { root, files: lock.files };
}

if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("seal-forge.mjs")) {
  const { root, files } = seal();
  console.log(`sealed ${files} files -> root ${root}`);
}
