// holo-onnx-kserve-witness.mjs — re-derivable proof that the κ-serve shim routes an ONNX faculty's model-file
// fetches to its .holo and is fail-safe. Pure Node — injected fakes, no browser/GPU/network. Proves the LOGIC
// that lets TTS (and later embed/vision) load from a content-addressed .holo through the unchanged engine.
// Run: node holo-onnx-kserve-witness.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const mod = await import(pathToFileURL(resolve(HERE, "../../../holo-apps/apps/q/forge/gpu/holo-onnx-kserve.mjs")).href);
const { modelKeyFor, installModelFetchShim, serveModelFromHolo } = mod;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
class FakeResponse { constructor(body, init = {}) { this.body = body; this.status = init.status; this.headers = init.headers; } async bytes() { return this.body; } }

console.log("\nholo-onnx κ-serve shim — routing + fail-safe witness\n");

// model id → URL key
ok(modelKeyFor("onnx-community/Kokoro-82M-v1.0-ONNX") === "Kokoro-82M-v1.0-ONNX/", "modelKeyFor → last segment + slash");
ok(modelKeyFor("onnx-community/embeddinggemma-300m-ONNX") === "embeddinggemma-300m-ONNX/", "modelKeyFor works for any faculty (embed)");

// the .holo's named files + a fake archive
const FILES = { "onnx/model_quantized.onnx": new Uint8Array([1, 2, 3]), "tokenizer.json": new Uint8Array([9, 9]) };
const hf = { getFile: async (n) => { if (n in FILES) return FILES[n]; throw new Error("κ not in holo: " + n); }, files: Object.keys(FILES).map((name) => ({ name })), stats: { verifies: 2 } };

// a fake fetch target (window stand-in)
const origCalls = [];
const origFetch = async (input) => { origCalls.push(String(input)); return new FakeResponse(new Uint8Array([0xff]), { status: 200, headers: {} }); };
const target = { Response: FakeResponse, fetch: origFetch };
const key = modelKeyFor("onnx-community/Kokoro-82M-v1.0-ONNX");
const shim = installModelFetchShim({ hf, key, target });

console.log("\nthe shim serves model files from the .holo, passes everything else through:");
const r1 = await target.fetch("https://host/vendor/models/onnx-community/Kokoro-82M-v1.0-ONNX/onnx/model_quantized.onnx");
ok(r1.status === 200 && (await r1.bytes()) === FILES["onnx/model_quantized.onnx"], "a matching model file is answered from the .holo (exact bytes)");
ok(shim.served.includes("onnx/model_quantized.onnx"), "served list records the file");
ok(origCalls.length === 0, "the original transport is NOT hit for a .holo file (no flat download)");

await target.fetch("https://host/.../Kokoro-82M-v1.0-ONNX/tokenizer.json?download=1");
ok(shim.served.includes("tokenizer.json"), "query string is stripped from the file name");

const r3 = await target.fetch("https://host/.../Kokoro-82M-v1.0-ONNX/not-in-holo.bin");
ok(shim.missed.includes("not-in-holo.bin") && origCalls.length === 1 && r3.status === 200, "a model file NOT in the .holo falls through to the original transport (graceful)");

await target.fetch("https://cdn/some/other/asset.js");
ok(origCalls.length === 2, "a non-model URL passes through untouched (cheap substring test)");

console.log("\nfail-safe: restore() reinstalls the original transport:");
shim.restore();
ok(target.fetch === origFetch, "after restore the original fetch is back (caller can fall back to vendored ONNX)");

console.log("\nserveModelFromHolo opens the archive + installs in one call (openFiles injected):");
const target2 = { Response: FakeResponse, fetch: async () => new FakeResponse(new Uint8Array(), { status: 200, headers: {} }) };
const s = await serveModelFromHolo({ holoUrl: "kokoro-82m.holo", modelId: "onnx-community/Kokoro-82M-v1.0-ONNX", target: target2, openFiles: async () => hf });
ok(s.modelKey === "Kokoro-82M-v1.0-ONNX/" && typeof s.restore === "function" && s.stats === hf.stats, "serveModelFromHolo → {modelKey, stats, restore}");
await target2.fetch("https://host/x/Kokoro-82M-v1.0-ONNX/tokenizer.json");
ok(s.served.includes("tokenizer.json"), "files route through the installed shim");

console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
