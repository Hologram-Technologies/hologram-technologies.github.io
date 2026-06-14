#!/usr/bin/env node
// holo-forge-exec-witness.mjs — proves Holo Forge verified EXECUTION (ADR-0074, extends ADR-0051):
// a COMPUTATION is a re-derivable κ-transform —  κ(module) ⊕ κ(input) → κ(output)  — so "verified
// bytes" become "verified computation". Pure Node, no DOM, no network, no toolchain, no VM. It
// compiles a fixed Holo-C program to a closed Wasm module, RUNS it (scalar + general byte→buffer),
// and proves the substrate claims that make a run self-verifying like every other object in the OS:
//
//   1. DETERMINISM — same module + same input ⇒ same output bytes (run twice, byte-equal), so
//      κ(module) ⊕ κ(input) → κ(output) is a function (Law L4: WebAssembly Core 2.0 is deterministic).
//   2. CORRECTNESS (Law L5, semantic) — scalar evaluation (fib/gcd) and a general-purpose byte→byte
//      transform both compute the right answers when instantiated and run in-engine.
//   3. CLOSED-MODULE GUARD — a module that imports a host is REFUSED (its run is not re-derivable);
//      only self-contained modules are admitted, run under an empty import object.
//   4. TAMPER-REFUSAL — flip one module byte ⇒ a different module κ (and the engine rejects it); flip
//      one output byte ⇒ a different output κ. A forged computation cannot wear an honest address.
//   5. RE-DERIVATION (headline) — from the receipt + the κ-verified module & input bytes, RE-RUN and
//      reproduce the pinned output κ. "Verify a computation by re-derivation, no server trusted" (L5).
//   6. RECEIPT — the execution receipt is a sealed PROV-O UOR object (prov:used module+input → prov:
//      generated output); it seals, verifies, and re-derives; tamper → refuse.
//   7. COMPOSITION (the thesis) — the execution receipt's module κ IS the Forge BUILD receipt's
//      generated artifact κ. Build proves the bytes; execution proves the computation — one chain.
//
// Authority: W3C WebAssembly Core 2.0 · IETF RFC 8785 (JCS) · W3C DID Core / PROV-O · UOR-ADDR
// (κ = H(canonical_form)) · holospaces Laws L1/L4/L5, Q4/Q6 (verify by re-derivation). Writes the
// result the gate (tools/gate.mjs) joins.
//
//   node tools/holo-forge-exec-witness.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { compile, forgeReceipt } from "../os/usr/lib/holo/holo-forge/holo-forge.mjs";
import { runScalar, runBuffer, admits, execReceipt, jcs, RUN_VERSION } from "../os/usr/lib/holo/holo-forge/holo-forge-run.mjs";
import { sha256hex, sriOf, didHolo } from "../os/usr/lib/holo/holo-uor.mjs";
import { seal, verify } from "../os/sbin/holo-object.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const COMPILER_PATH = "usr/lib/holo/holo-forge/holo-forge.mjs";

const checks = {};
const fail = [];
const ok = (name, cond, detail = "") => { checks[name] = !!cond; if (!cond) fail.push(name + (detail ? ` — ${detail}` : "")); return !!cond; };
const kappaOf = (bytes) => didHolo("sha256", sha256hex(bytes));   // did:holo:sha256:<hex> of raw bytes

// ── the fixed Holo-C program (self-contained, closed): two pure scalar functions + one general
//    byte→byte transform over the linker memory ABI (load8/store8). Its κ is the module under test. ──
const SOURCE = `// Holo Forge exec witness — real Holo-C run verifiably in-engine, no server, no VM.
int fib(int n) { if (n < 2) return n; return fib(n - 1) + fib(n - 2); }
int gcd(int a, int b) { while (b != 0) { int t = a % b; a = b; b = t; } return a; }
// general-purpose byte→byte transform: out[i] = in[i] ^ 0x5a, for inLen bytes. Returns outLen.
int transform(int inPtr, int inLen, int outPtr) {
  int i = 0;
  while (i < inLen) { store8(outPtr + i, load8(inPtr + i) ^ 90); i = i + 1; }
  return inLen;
}
`;
const FLAGS = { engine: "wasm-core-2.0", deterministic: true };

// inputs, content-addressed (Law L1/L2)
const compilerBytes = readFileSync(join(OS, COMPILER_PATH));
const compilerKappa = kappaOf(compilerBytes);
const sourceKappa = kappaOf(Buffer.from(SOURCE, "utf8"));
const flagsKappa = kappaOf(Buffer.from(jcs(FLAGS), "utf8"));

// the BUILD: compile → the module bytes whose κ both receipts share
const { wasm, exports } = compile(SOURCE);
const moduleBytes = Buffer.from(wasm);
const moduleKappa = kappaOf(moduleBytes);                 // == the build's artifact κ

// the build receipt (ADR-0051) — its generated artifact is this module
const buildReceipt = seal(forgeReceipt({ sourceKappa, compilerKappa, flagsKappa, artifactKappa: moduleKappa, exports }));

// ── the EXECUTION (headline: general byte→byte transform) ──
const INPUT = Buffer.from("Hologram: verified bytes → verified computation.", "utf8");
const inputKappa = kappaOf(INPUT);
const { output } = await runBuffer(wasm, "transform", new Uint8Array(INPUT));
const outputBytes = Buffer.from(output);
const outputKappa = kappaOf(outputBytes);

// the execution receipt — a sealed PROV-O UOR object linking module + input → output
const execReceiptObj = execReceipt({ moduleKappa, inputKappa, outputKappa, entry: "transform", mode: "buffer", flagsKappa });
const execR = seal(execReceiptObj);

// ── PINS — a computation is re-derivable, so its addresses are CONSTANTS. A changed compiler, source,
//    or input changes these by construction (that is the point); re-pin deliberately when they change. ──
const PIN = {
  module: "did:holo:sha256:a7d914d7ff0840d45dd5834a75f395ae2d2ec5fc84f976d752811a2f4e03e424",
  input: "did:holo:sha256:ed3a6aca898eb420308b96c8ff0448a917877e23a9e399a5ff394ec7ef8fbda1",
  output: "did:holo:sha256:f103ed75a6b94f5b37227befc61cf9110037e1cf788b75a88f7663972e71dd7d",
  execReceipt: "did:holo:sha256:482308da03dce957aa8409ae481af9582d6f31de283faad49153d261d2481ceb",
};

// ── 1 · DETERMINISM — same module + input ⇒ identical output bytes (and κ) ──
const again = Buffer.from((await runBuffer(wasm, "transform", new Uint8Array(INPUT))).output);
ok("deterministic-bytes", Buffer.compare(again, outputBytes) === 0);
ok("deterministic-kappa", kappaOf(again) === outputKappa);

// ── 2 · CORRECTNESS (Law L5, semantic) — scalar + buffer compute the right answers ──
const fib = (await runScalar(wasm, "fib", [10])).result;
const gcd = (await runScalar(wasm, "gcd", [1071, 462])).result;
ok("scalar-correct", fib === 55 && gcd === 21, `fib(10)=${fib}, gcd(1071,462)=${gcd}`);
const expect = Buffer.from(INPUT.map((b) => b ^ 0x5a));
ok("buffer-correct", Buffer.compare(outputBytes, expect) === 0);
// and the transform is invertible in-engine (xor twice ⇒ original) — a second verified run
const roundtrip = Buffer.from((await runBuffer(wasm, "transform", new Uint8Array(outputBytes))).output);
ok("buffer-roundtrip", Buffer.compare(roundtrip, INPUT) === 0);

// ── 3 · CLOSED-MODULE GUARD — a module that imports a host is refused (its run is not re-derivable) ──
ok("closed-module-admitted", admits(wasm) === true);
const openWasm = compile(`extern int helper(int x) from "did:holo:sha256:0000000000000000000000000000000000000000000000000000000000000000";
int useit(int x) { return helper(x) + 1; }`).wasm;
ok("open-module-detected", admits(openWasm) === false);
let refused = false;
try { await runScalar(openWasm, "useit", [1]); } catch (e) { refused = e.name === "ExecError"; }
ok("open-module-refused", refused);

// ── 4 · TAMPER-REFUSAL ──
const tamperedModule = Buffer.from(moduleBytes); tamperedModule[tamperedModule.length - 4] ^= 0xff;
ok("module-tamper-refused", kappaOf(tamperedModule) !== moduleKappa && WebAssembly.validate(tamperedModule) === false);
const tamperedOut = Buffer.from(outputBytes); tamperedOut[0] ^= 0xff;
ok("output-tamper-refused", kappaOf(tamperedOut) !== outputKappa);

// ── 5 · RE-DERIVATION (headline) — a peer holds only the receipt + κ-verified module & input bytes,
//        re-runs, and reproduces the pinned output κ. No server. ──
const reModuleOk = kappaOf(moduleBytes) === execR["prov:used"].find((u) => u["hosc:role"] === "code")["@id"];   // module bytes match claimed κ (L5)
const reInputOk = kappaOf(INPUT) === execR["prov:used"].find((u) => u["hosc:role"] === "input")["@id"];          // input bytes match claimed κ (L5)
const reOutput = kappaOf(Buffer.from((await runBuffer(wasm, "transform", new Uint8Array(INPUT))).output));        // re-run the transform
ok("re-derivation-reproduces-output", reModuleOk && reInputOk && reOutput === execR["prov:generated"]["@id"]);

// ── 6 · the execution receipt is a self-verifying UOR object ──
ok("receipt-seals", typeof execR.id === "string" && execR.id.startsWith("did:holo:sha256:"));
ok("receipt-verifies", verify(execR) === true);
ok("receipt-links-module", execR["prov:used"].some((u) => u["@id"] === moduleKappa && u["hosc:role"] === "code"));
ok("receipt-links-input", execR["prov:used"].some((u) => u["@id"] === inputKappa && u["hosc:role"] === "input"));
ok("receipt-links-output", execR["prov:generated"]["@id"] === outputKappa);
const forged = { ...execR, "prov:generated": { ...execR["prov:generated"], "@id": outputKappa.replace(/.$/, "0") } };
ok("receipt-tamper-refused", verify(forged) === false);

// ── 7 · COMPOSITION (the thesis) — the run's module κ IS the build's generated artifact κ ──
ok("composes-with-build", buildReceipt["prov:generated"]["@id"] === moduleKappa
  && moduleKappa === execR["prov:used"].find((u) => u["hosc:role"] === "code")["@id"]);

// ── pins (skipped while PENDING; flip to constants once observed, then they are enforced) ──
const pinning = PIN.module !== "PENDING";
if (pinning) {
  ok("module-pinned", moduleKappa === PIN.module, moduleKappa);
  ok("input-pinned", inputKappa === PIN.input, inputKappa);
  ok("output-pinned", outputKappa === PIN.output, outputKappa);
  ok("receipt-pinned", execR.id === PIN.execReceipt, execR.id);
}

// ── result ──
const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  witnessed,
  covers: [
    "a computation is a re-derivable κ-transform: κ(module) ⊕ κ(input) → κ(output), reproduced from the receipt with no server (Law L5, extended from files & builds to runs)",
    "WebAssembly Core 2.0 runs deterministically in any browser, 100% serverless: same module+input ⇒ same output bytes & κ",
    "general purpose: scalar evaluation (fib/gcd) AND arbitrary byte→byte transforms, both verified in-engine",
    "closed-module guard: a module that imports a host is refused — only self-contained, re-derivable runs are admitted",
    "tamper refused: a flipped module byte changes its κ (and fails validation); a flipped output byte changes the output κ",
    "the execution receipt is a self-verifying PROV-O UOR object (prov:used module+input → prov:generated output)",
    "composition: the run's module κ IS the Forge build receipt's artifact κ — verified build → verified execution, one chain",
  ],
  run: {
    engine: RUN_VERSION,
    compilerKappa, sourceKappa, flagsKappa,
    moduleKappa, inputKappa, outputKappa,
    buildReceipt: buildReceipt.id, execReceipt: execR.id,
    moduleBytes: moduleBytes.length, inputBytes: INPUT.length, outputBytes: outputBytes.length,
    exports: exports.map((e) => e.name),
    sri: sriOf(outputBytes),
  },
  checks,
  failed: fail,
  authority: "W3C WebAssembly Core 2.0 · IETF RFC 8785 (JCS) · W3C DID Core · W3C PROV-O · UOR-ADDR · Law L4/L5",
};
writeFileSync(join(here, "holo-forge-exec-witness.result.json"), JSON.stringify(result, null, 2) + "\n");

console.log("Holo Forge — verified execution: κ(module) ⊕ κ(input) → κ(output)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  module ${moduleKappa}  (${moduleBytes.length} bytes)\n  input  ${inputKappa}  (${INPUT.length} bytes)\n  output ${outputKappa}  (${outputBytes.length} bytes)\n  build  ${buildReceipt.id}\n  exec   ${execR.id}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
