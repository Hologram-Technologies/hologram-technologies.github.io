#!/usr/bin/env node
// holo-forge-registry-witness.mjs — proves the Holo Forge content-addressed library registry
// (ADR-0051): a verifiable package universe where dependencies resolve by content address, shared
// libraries link exactly once (Law L3), the whole linked build re-derives byte-for-byte (Law L5),
// and a tampered DEPENDENCY cannot reproduce the pinned artifact (the supply-chain attack, refused).
// Pure Node, no network, no toolchain. Authority: W3C WebAssembly Core 2.0 · RFC 8785 (JCS) · W3C
// PROV-O / DID Core / SRI · UOR-ADDR · Law L5. Writes the result the gate joins.
//
//   node tools/holo-forge-registry-witness.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { compile } from "../os/usr/lib/holo/holo-forge/holo-forge.mjs";
import { resolveClosure, linkedSource, linkReceipt } from "../os/usr/lib/holo/holo-forge/holo-forge-resolve.mjs";
import { sha256hex, didHolo } from "../os/usr/lib/holo/holo-uor.mjs";
import { address, seal, verify } from "../os/sbin/holo-object.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const kappaOf = (bytes) => didHolo("sha256", sha256hex(bytes));

const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

const registry = JSON.parse(readFileSync(join(OS, "usr/lib/holo/holo-forge/registry.uor.json"), "utf8"));
const compilerKappa = kappaOf(readFileSync(join(OS, "usr/lib/holo/holo-forge/holo-forge.mjs")));

// fixed build: a program that calls across prime + combo (which both depend on math)
const PROGRAM = `int primePick(int p, int k) { int n = nthPrime(p); if (isPrime(n) == 0) return -1; return choose(n, k); }\n`;
const SELECTED = ["prime", "combo"];
const FLAGS = { lang: "holo-c", target: "wasm-core-2.0", link: "static" };
const flagsKappa = kappaOf(Buffer.from(JSON.stringify(FLAGS)));
const programKappa = kappaOf(Buffer.from(PROGRAM, "utf8"));

// ── 1 · the registry is a self-verifying UOR object; each library re-derives to its κ (Law L5) ──
ok("registry-verifies", verify(registry) === true);
ok("libraries-rederive", (registry.libraries || []).every((l) => kappaOf(Buffer.from(l.source, "utf8")) === l.sourceKappa));

// ── 2 · transitive resolution + dedup (Law L3): prime+combo pull math ONCE, deps before dependents ──
const order = resolveClosure(registry, SELECTED);
const names = order.map((l) => l.name);
ok("transitive-resolution", names.includes("math") && names.includes("prime") && names.includes("combo"), names.join(" → "));
ok("dedup-shared-dep", names.filter((n) => n === "math").length === 1, "math linked once");
ok("deps-before-dependents", names.indexOf("math") < names.indexOf("prime") && names.indexOf("math") < names.indexOf("combo"));

// ── 3 · deterministic link → compile → spec-valid wasm that COMPUTES across libraries (Law L5) ──
const unit = linkedSource(order, PROGRAM);
const { wasm, exports } = compile(unit);
const wasmBytes = Buffer.from(wasm);
const artifactKappa = kappaOf(wasmBytes);
ok("link-reproducible", kappaOf(Buffer.from(compile(linkedSource(resolveClosure(registry, SELECTED), PROGRAM)).wasm)) === artifactKappa);
ok("wasm-valid", WebAssembly.validate(wasmBytes));
let X = null;
try { X = (await WebAssembly.instantiate(wasmBytes, {})).instance.exports; ok("wasm-instantiates", true); } catch (e) { ok("wasm-instantiates", false, e.message); }
if (X) {
  const cases = [["isPrime(97)", X.isPrime(97), 1], ["nthPrime(10)", X.nthPrime(10), 29], ["gcd(48,36)", X.gcd(48, 36), 12],
    ["choose(6,2)", X.choose(6, 2), 15], ["primePick(5,2)", X.primePick(5, 2), 55]];
  const wrong = cases.filter(([, g, w]) => g !== w);
  ok("linked-semantics-correct", wrong.length === 0, wrong.map(([n, g, w]) => `${n}=${g}≠${w}`).join(", "));
}

// ── 4 · the linked build is a self-verifying receipt (PROV-O) that re-derives from the registry ──
const receiptObj = linkReceipt({ libs: order.map((l) => ({ name: l.name, kappa: l.sourceKappa, deps: l.deps })), programKappa, compilerKappa, flagsKappa, artifactKappa, exports });
const receipt = seal(receiptObj);
ok("receipt-verifies", verify(receipt) === true);

// ── 5 · SUPPLY-CHAIN TAMPER REFUSED: forge one byte of a DEPENDENCY (math) ⇒ artifact κ changes ──
const forgedReg = JSON.parse(JSON.stringify(registry));
const mathLib = forgedReg.libraries.find((l) => l.name === "math");
mathLib.source = mathLib.source.replace("a < b", "a > b");   // silently weaken min()
const forgedOrder = resolveClosure(forgedReg, SELECTED);
const forgedArtifact = kappaOf(Buffer.from(compile(linkedSource(forgedOrder, PROGRAM)).wasm));
ok("tampered-dependency-refused", forgedArtifact !== artifactKappa, "a forged dependency cannot reproduce the pinned artifact κ");
// and the forged library no longer matches its pinned κ in the honest registry
ok("forged-lib-fails-rederivation", kappaOf(Buffer.from(mathLib.source, "utf8")) !== registry.libraries.find((l) => l.name === "math").sourceKappa);

// ── PINS — registry + linked artifact are reproducible constants. The receipt κ is NOT pinned: it
// embeds the compiler's own κ (hosc:tool), which legitimately shifts on any edit to the compiler
// source; the receipt is proven sound by receipt-verifies above (it re-derives to its own did, L5). ──
const PIN = {
  registry: "did:holo:sha256:2d68b6b3fd1a41abf169e10bab211ab8440a273c4eead07bdd5629b5a561ecfe",
  artifact: "did:holo:sha256:7b52b30de3d115e4fe64f69ea92c73ff68b3ab6c6a55d514d235d9d0d2900706",
};
ok("registry-rederives-to-pin", registry.id === PIN.registry, registry.id);
ok("linked-artifact-rederives-to-pin", artifactKappa === PIN.artifact, artifactKappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  witnessed,
  covers: [
    "the Holo Forge library registry is a self-verifying UOR object; every library re-derives to its κ (Law L5)",
    "dependencies resolve by content address; a shared library links exactly once (Law L3 dedup); deps precede dependents",
    "deterministic static linking → spec-valid WebAssembly that computes correctly ACROSS libraries (linked Law L5)",
    "the linked build is a PROV-O receipt sealed to a did:holo, re-derivable from the registry with no server",
    "supply-chain tamper refused: forging one byte of a DEPENDENCY changes the artifact κ — a forged dep cannot wear the honest address",
  ],
  build: { registry: registry.id, selected: SELECTED, order: names, programKappa, artifactKappa, receipt: receipt.id, wasmBytes: wasmBytes.length, exports: exports.map((e) => e.name) },
  checks, failed: fail,
  authority: "W3C WebAssembly Core 2.0 · IETF RFC 8785 (JCS) · W3C SRI · W3C DID Core · W3C PROV-O · UOR-ADDR · Law L1/L3/L5",
};
writeFileSync(join(here, "holo-forge-registry-witness.result.json"), JSON.stringify(result, null, 2) + "\n");

console.log("Holo Forge registry witness — a verifiable package universe\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  registry ${registry.id}\n  order    ${names.join(" → ")}\n  artifact ${artifactKappa}  (${wasmBytes.length} bytes)\n  receipt  ${receipt.id}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
