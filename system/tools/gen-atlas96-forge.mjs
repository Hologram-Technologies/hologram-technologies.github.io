#!/usr/bin/env node
// gen-atlas96-forge.mjs — COMPILE the Φ-Atlas-12288 primitives directly from the VERBATIM vendored
// upstream C (apps/atlas96/vendor/atlas-12288/ffi/c/minimal_wrapper.c — no hand-written engine) with
// Holo Forge (ADR-0051) to a deterministic, content-addressed WebAssembly κ-object that runs natively
// in the holospace. Holo Forge 1.2.0's preprocessor + fixed-width types + void functions accept it as-is.
//
// Writes:
//   apps/atlas96/forge/atlas12288.wasm          — the compiled artifact (the engine)
//   apps/atlas96/forge/atlas12288.forge.jsonld  — the PROV-O build receipt, sealed to its own did:holo
//                                                 (κ(source) ⊕ κ(compiler) ⊕ κ(flags) → κ(artifact))
//   tools/atlas96-forge.result.json             — the determinism + equivalence witness
//
// Proves: (a) reproducibility — compiling twice yields byte-identical WASM; (b) EQUIVALENCE — the
// compiled artifact reproduces atlas-12288's documented function table exactly (r96 over all 256
// bytes; Φ encode/decode round-trip over the full 48×256 boundary; the truth predicates).
//
//   node tools/gen-atlas96-forge.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const HOLOGRAM_OS = "C:/Users/pavel/Desktop/hologram-os/os";
const APP_DIR = "C:/Users/pavel/Desktop/Hologram Apps/apps/atlas96";
const FORGE = join(APP_DIR, "forge");
const here = "C:/Users/pavel/Desktop/Hologram OS2/system/tools";

const { sha256hex, sriOf, mbSha256, didHolo, jcs } = await import(pathToFileURL(join(HOLOGRAM_OS, "holo-uor.mjs")));
const { address } = await import(pathToFileURL(join(HOLOGRAM_OS, "holo-object.mjs")));
// the app ships its OWN copy of the compiler (self-contained) and re-compiles in-browser from it;
// build with that exact copy so the receipt pins the κ the holospace actually uses.
const { compile, VERSION, LANG, forgeReceipt } = await import(pathToFileURL(join(FORGE, "holo-forge.mjs")));

const kappaOf = (bytes) => didHolo("sha256", sha256hex(bytes));

// ── inputs, content-addressed (Law L1/L2) ──
// The source is the VERBATIM vendored upstream C — no hand-written engine. Holo Forge 1.2.0's
// preprocessor + fixed-width types + void functions compile minimal_wrapper.c as-is; its source κ
// is the SAME κ the file carries in the app closure (one object, two roles).
const sourceBytes = readFileSync(join(APP_DIR, "vendor", "atlas-12288", "ffi", "c", "minimal_wrapper.c"));
const compilerBytes = readFileSync(join(FORGE, "holo-forge.mjs"));
const FLAGS = { lang: LANG, target: "wasm-core-2.0", optimize: false };
const sourceKappa = kappaOf(sourceBytes);
const compilerKappa = kappaOf(compilerBytes);
const flagsKappa = kappaOf(Buffer.from(jcs(FLAGS), "utf8"));

// ── the κ-transform ──
const { wasm, exports } = compile(sourceBytes.toString("utf8"));
const wasmBytes = Buffer.from(wasm);
const artifactKappa = kappaOf(wasmBytes);
writeFileSync(join(FORGE, "atlas12288.wasm"), wasmBytes);

// determinism — recompile, expect identical bytes
const again = Buffer.from(compile(sourceBytes.toString("utf8")).wasm);
const reproducible = Buffer.compare(wasmBytes, again) === 0;

// ── the build receipt, sealed to its own did:holo (a UOR PROV-O object) ──
const receiptObj = forgeReceipt({ sourceKappa, compilerKappa, flagsKappa, artifactKappa, lang: LANG, exports });
const receipt = { ...receiptObj, id: address(receiptObj) };
writeFileSync(join(FORGE, "atlas12288.forge.jsonld"), JSON.stringify(receipt, null, 2) + "\n");

// ── EQUIVALENCE: the compiled artifact vs atlas-12288's documented function table ──
const { instance } = await WebAssembly.instantiate(wasm, {});
const X = instance.exports;
const checks = {};
checks.pages = X.lean_uor_pages_minimal() === 48;
checks.bytes = X.lean_uor_bytes_minimal() === 256;
checks.rclasses = X.lean_uor_rclasses_minimal() === 96;

let r96 = true;
for (let b = 0; b < 256; b++) if (X.lean_uor_r96_classify_minimal(b) !== b % 96) r96 = false;
checks.r96_all_256_bytes = r96;

let phi = true;
for (let p = 0; p < 48 && phi; p++) for (let b = 0; b < 256; b++) {
  const code = X.lean_uor_phi_encode_minimal(p, b);
  if (code !== p * 256 + b || X.lean_uor_phi_page_minimal(code) !== p || X.lean_uor_phi_byte_minimal(code) !== b) { phi = false; break; }
}
checks.phi_roundtrip_12288 = phi;

checks.truth_zero = X.lean_uor_truth_zero_minimal(0) === 1 && X.lean_uor_truth_zero_minimal(7) === 0;
checks.truth_add = X.lean_uor_truth_add_minimal(0, 0) === 1 && X.lean_uor_truth_add_minimal(3, 4) === 0;
checks.reproducible = reproducible;

const pass = Object.values(checks).every(Boolean);
const result = { tool: "gen-atlas96-forge", compiler: VERSION, lang: LANG,
  source: sourceKappa, compilerKappa, flags: flagsKappa, artifact: artifactKappa,
  receipt: receipt.id, wasmBytes: wasmBytes.length, exports: exports.map((e) => e.name), checks, witnessed: pass };
writeFileSync(join(here, "atlas96-forge.result.json"), JSON.stringify(result, null, 2) + "\n");

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  source   ${sourceKappa}`);
console.log(`  compiler ${compilerKappa}  (${VERSION})`);
console.log(`  artifact ${artifactKappa}  (${wasmBytes.length} bytes, ${exports.length} exports)`);
console.log(`  receipt  ${receipt.id}`);
console.log(`\n  ${pass ? "WITNESSED ✓ — engine compiled by Holo Forge reproduces atlas-12288 exactly" : "FAILED ✗"}`);
process.exit(pass ? 0 : 1);
