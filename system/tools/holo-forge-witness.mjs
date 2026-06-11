#!/usr/bin/env node
// holo-forge-witness.mjs — proves Holo Forge (ADR-0051): a build is a re-derivable κ-transform.
// Pure Node, no DOM, no network, no toolchain. It re-derives the compiler's own content address
// (the compiler IS a κ-object), compiles a fixed Holo-C source to WebAssembly, and proves the
// FOUR substrate claims that make a build self-verifying like every other object in the OS:
//
//   1. REPRODUCIBILITY — identical source ⇒ identical wasm bytes (compile twice, byte-equal),
//      so  κ(source) ⊕ κ(compiler) ⊕ κ(flags) → κ(artifact)  is a deterministic function.
//   2. CORRECTNESS (Law L5, semantic) — the emitted module is spec-valid WebAssembly and, when
//      instantiated, COMPUTES the right answers (fib, gcd, factorial, mutual recursion …).
//   3. TAMPER-REFUSAL — flip one source byte ⇒ a different artifact κ; flip one wasm byte ⇒ the
//      binary fails WebAssembly validation. A forged build cannot wear an honest address.
//   4. RE-DERIVATION — given only the receipt's input κ's + the (κ-verified) source & compiler
//      bytes, RE-RUN the compile and reproduce the pinned artifact κ. This is "verify a build by
//      re-derivation, no build server trusted" — Law L5 extended from files to builds.
//
// The build receipt is itself a sealed UOR object (PROV-O activity: prov:used source → prov:
// generated artifact, via the compiler tool), so its did:holo proves the whole transform.
//
// Authority: WebAssembly Core Specification 2.0 (W3C) · IETF RFC 8785 (JCS) · W3C Subresource
// Integrity / DID Core / PROV-O · UOR-ADDR (κ-label = H(canonical_form)) · verify by re-
// derivation (Law L5). Writes the result the gate (tools/gate.mjs) joins.
//
//   node tools/holo-forge-witness.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { compile, forgeReceipt, jcs, VERSION, LANG } from "../os/usr/lib/holo/holo-forge/holo-forge.mjs";
import { sha256hex, sriOf, mbSha256, didHolo } from "../os/usr/lib/holo/holo-uor.mjs";
import { address, seal, verify } from "../os/sbin/holo-object.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const COMPILER_PATH = "usr/lib/holo/holo-forge/holo-forge.mjs";

const checks = {};
const fail = [];
const ok = (name, cond, detail = "") => { checks[name] = !!cond; if (!cond) fail.push(name + (detail ? ` — ${detail}` : "")); return !!cond; };
const kappaOf = (bytes) => didHolo("sha256", sha256hex(bytes));   // did:holo:sha256:<hex> of raw bytes

// ── the fixed Holo-C program this build compiles (self-contained; its κ is part of the build) ──
const SOURCE = `// Holo Forge witness fixture — real Holo-C compiled to WebAssembly, in the browser, verifiably.
int add(int a, int b) { return a + b; }
int abs(int x) { if (x < 0) return -x; return x; }
int max(int a, int b) { if (a > b) return a; else return b; }
int fib(int n) { if (n < 2) return n; return add(fib(n - 1), fib(n - 2)); }
int fact(int n) { int r = 1; while (n > 1) { r = r * n; n = n - 1; } return r; }
int gcd(int a, int b) { while (b != 0) { int t = a % b; a = b; b = t; } return a; }
int isqrt(int n) { int r = 0; while ((r + 1) * (r + 1) <= n) { r = r + 1; } return r; }
int isEven(int n) { if (n == 0) return 1; return isOdd(n - 1); }
int isOdd(int n) { if (n == 0) return 0; return isEven(n - 1); }
`;
const FLAGS = { lang: LANG, target: "wasm-core-2.0", optimize: false };

// the inputs, content-addressed by the canonical primitive (Law L1/L2)
const compilerBytes = readFileSync(join(OS, COMPILER_PATH));
const compilerKappa = kappaOf(compilerBytes);
const sourceKappa = kappaOf(Buffer.from(SOURCE, "utf8"));
const flagsKappa = kappaOf(Buffer.from(jcs(FLAGS), "utf8"));

// the transform
const { wasm, exports } = compile(SOURCE);
const wasmBytes = Buffer.from(wasm);
const artifactKappa = kappaOf(wasmBytes);

// the build receipt, sealed to its own did:holo (a UOR PROV-O object)
const receiptObj = forgeReceipt({ sourceKappa, compilerKappa, flagsKappa, artifactKappa, lang: LANG, exports });
const receipt = seal(receiptObj);

// ── PINS — a build is reproducible, so its addresses are CONSTANTS. A changed compiler or source
//    changes these by construction (that is the point); re-pin deliberately when the build changes.
// Re-pinned 2026-06-10: Holo-C grew in two backward-compatible steps — v1.1.0 added bitwise
// (& | ^ << >>) + ternary (?:), v1.2.0 added a minimal C preprocessor (#include/#define), the
// fixed-width integer types + casts, and void functions (so real vendored C compiles verbatim).
// Each step moved the compiler's κ (and the receipt embedding it); the fixture source/artifact are
// UNCHANGED — the additions compile every existing program to byte-identical wasm.
const PIN = {
  compiler: "did:holo:sha256:60cffa9f729ea9f605bc33f0bc099f91b2e3d471c31606511dc65e399d7f39bf",
  source: "did:holo:sha256:8951cf3781168cb9dccf7533caf4d8c2c56484c3a6fca3193d61e9234d0ef700",
  artifact: "did:holo:sha256:48d118b77c3912ffc8e647d3e6242667f75aff22c857677a4dbc9d07b65d7919",
  receipt: "did:holo:sha256:ba015c16a6f780ec0d340d99e4ac4ca6cb2639d61350a13e94a78970f558fe25",
};

// ── 1 · the compiler is itself a content-addressed object (the "compiler on the substrate") ──
ok("compiler-is-kappa-object", compilerKappa === PIN.compiler, `${compilerKappa} vs pin`);

// ── 2 · reproducible: identical source ⇒ identical wasm bytes (determinism of the transform) ──
const again = Buffer.from(compile(SOURCE).wasm);
ok("reproducible-bytes", Buffer.compare(again, wasmBytes) === 0);
ok("reproducible-kappa", kappaOf(again) === artifactKappa);
ok("source-pinned", sourceKappa === PIN.source, sourceKappa);
ok("artifact-rederives-to-pin", artifactKappa === PIN.artifact, artifactKappa);

// ── 3 · the artifact is spec-valid WebAssembly ──
ok("wasm-valid", WebAssembly.validate(wasmBytes));

// ── 4 · CORRECTNESS (Law L5, semantic): instantiate and run — the emitted code computes right ──
let X = null;
try { const { instance } = await WebAssembly.instantiate(wasmBytes, {}); X = instance.exports; } catch (e) { ok("wasm-instantiates", false, e.message); }
if (X) {
  ok("wasm-instantiates", true);
  const cases = [
    ["fib(10)", X.fib(10), 55], ["fib(20)", X.fib(20), 6765],
    ["fact(6)", X.fact(6), 720], ["gcd(1071,462)", X.gcd(1071, 462), 21],
    ["isqrt(144)", X.isqrt(144), 12], ["isqrt(145)", X.isqrt(145), 12],
    ["abs(-9)", X.abs(-9), 9], ["max(7,4)", X.max(7, 4), 7],
    ["isEven(10)", X.isEven(10), 1], ["isOdd(10)", X.isOdd(10), 0],
  ];
  const wrong = cases.filter(([, got, want]) => got !== want);
  ok("semantics-correct", wrong.length === 0, wrong.map(([n, g, w]) => `${n}=${g}≠${w}`).join(", "));
}

// ── 5 · TAMPER-REFUSAL ──
// (a) flip one source byte → a different artifact κ (a forged source cannot reproduce the pin)
const tamperedSrc = SOURCE.replace("a + b", "a - b");
ok("source-tamper-refused", kappaOf(Buffer.from(compile(tamperedSrc).wasm)) !== artifactKappa);
// (b) flip one wasm byte → the binary fails validation (a forged artifact is rejected by the engine)
const tamperedWasm = Buffer.from(wasmBytes); tamperedWasm[tamperedWasm.length - 4] ^= 0xff;
ok("artifact-tamper-refused", kappaOf(tamperedWasm) !== artifactKappa && WebAssembly.validate(tamperedWasm) === false);

// ── 6 · the build receipt is a self-verifying UOR object (re-derive; tamper → refuse) ──
ok("receipt-seals", typeof receipt.id === "string" && receipt.id.startsWith("did:holo:sha256:"));
ok("receipt-verifies", verify(receipt) === true);
ok("receipt-rederives-to-pin", receipt.id === PIN.receipt, receipt.id);
ok("receipt-links-source", receipt["prov:used"]["@id"] === sourceKappa);
ok("receipt-links-artifact", receipt["prov:generated"]["@id"] === artifactKappa);
ok("receipt-links-compiler", receipt["hosc:tool"]["@id"] === compilerKappa);
const forged = { ...receipt, "prov:generated": { ...receipt["prov:generated"], "@id": tamperedSrc && artifactKappa.replace(/.$/, "0") } };
ok("receipt-tamper-refused", verify(forged) === false);

// ── 7 · RE-DERIVATION (the headline): re-run the build from the receipt's inputs, reproduce κ ──
// A peer holds only the receipt + the κ-verified source & compiler bytes. It re-derives:
const reSourceOk = kappaOf(Buffer.from(SOURCE, "utf8")) === receipt["prov:used"]["@id"];   // source bytes match claimed κ (L5)
const reCompilerOk = kappaOf(compilerBytes) === receipt["hosc:tool"]["@id"];                // compiler bytes match claimed κ (L5)
const reArtifact = kappaOf(Buffer.from(compile(SOURCE).wasm));                              // re-run the transform
ok("re-derivation-reproduces-artifact", reSourceOk && reCompilerOk && reArtifact === receipt["prov:generated"]["@id"]);

// ── result ──
const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  witnessed,
  covers: [
    "Holo Forge compiles real Holo-C → spec-valid WebAssembly deterministically (identical source ⇒ identical bytes)",
    "the compiler is itself a content-addressed UOR object (κ pinned + re-derived)",
    "the emitted module instantiates and COMPUTES correctly (fib/gcd/factorial/mutual recursion) — Law L5 semantic",
    "a build is a re-derivable κ-transform: κ(source)⊕κ(compiler)⊕κ(flags)→κ(artifact), reproduced from the receipt with no server",
    "tamper refused: a flipped source byte changes the artifact κ; a flipped wasm byte fails WebAssembly validation",
    "the build receipt is a self-verifying PROV-O UOR object (prov:used source → prov:generated artifact)",
  ],
  build: {
    lang: LANG, tool: VERSION,
    compilerKappa, sourceKappa, flagsKappa, artifactKappa,
    receipt: receipt.id, wasmBytes: wasmBytes.length,
    exports: exports.map((e) => e.name),
    sri: sriOf(wasmBytes), multibase: mbSha256(wasmBytes),
  },
  checks,
  failed: fail,
  authority: "W3C WebAssembly Core 2.0 · IETF RFC 8785 (JCS) · W3C SRI · W3C DID Core · W3C PROV-O · UOR-ADDR · Law L5",
};
writeFileSync(join(here, "holo-forge-witness.result.json"), JSON.stringify(result, null, 2) + "\n");

console.log("Holo Forge witness — verifiable content-addressed compilation\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  source   ${sourceKappa}\n  compiler ${compilerKappa}\n  flags    ${flagsKappa}\n  artifact ${artifactKappa}  (${wasmBytes.length} bytes)\n  receipt  ${receipt.id}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
