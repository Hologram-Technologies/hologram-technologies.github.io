// Run the wasm32-wasip1 repro under Node's WASI — i.e. on **V8**, the same engine
// Chrome runs. If this hangs (no `aarch64`, diverges from native) while wasmtime
// runs it correctly, the AArch64 NEON frontier is a V8 wasm-execution bug.
//
// Usage: node run-node-wasi.mjs <wasm> <host-diff-dir> [cap_million]
import { readFileSync } from "node:fs";
import { WASI } from "node:wasi";
import { argv, env, exit } from "node:process";

const wasmPath = argv[2];
const diffDir = argv[3];
const cap = argv[4] || "5";

const wasi = new WASI({
  version: "preview1",
  args: ["arm64-repro", "/d/Image", "/d/rootfs.ext4", "/d/wasm-node.trace", cap],
  env,
  preopens: { "/d": diffDir },
});

const bytes = readFileSync(wasmPath);
const module = await WebAssembly.compile(bytes);
const instance = await WebAssembly.instantiate(module, wasi.getImportObject());
try {
  wasi.start(instance);
} catch (e) {
  console.error("node-wasi: error —", e && e.message ? e.message : e);
  exit(1);
}
