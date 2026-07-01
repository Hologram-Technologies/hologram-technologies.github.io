// holo-hub-kernel-witness.mjs — proves Holo Hub Stage 3 (ADR-0094): Medusa's commerce MATH runs
// in-tab as a deterministic Forge κ-transform — VERBATIM Medusa code, compiled, not re-implemented.
//
// Drives the REAL esbuild κ-transform (the in-tree bundler) over the VERBATIM vendored Medusa
// source (vendor/medusa @ v2.15.5) + the pinned bignumber.js, then LOADS the bundle and runs
// Medusa's own calculateTaxTotal / calculateAmountsWithTax — asserting the numbers are correct.
// Checks: bundles self-contained · Forge receipt minted · deterministic (same κ, L5) · the source
// files re-hash to their pinned κ (verbatim) · the MATH is correct · runtime is 0-network.

import esbuild from "../docs/site/node_modules/esbuild/lib/main.js";   // the real bundler, injected (browser: esbuild-wasm)
import { buildCommerceKernel, KERNEL_FILES } from "../os/usr/lib/holo/holo-hub-kernel.mjs";
import { sha256hex } from "../os/usr/lib/holo/holo-blocks-repo.mjs";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const VENDOR = join(here, "..", "..", "..", "Hologram Apps", "apps", "hub", "vendor");
const read = (p) => readFileSync(join(VENDOR, "medusa", p), "utf8");
const bignumber = readFileSync(join(VENDOR, "bignumber.js", "bignumber.mjs"), "utf8");

const checks = {};
let pass = 0, fail = 0, kn = 0;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const ok = (n, c, x = "") => { (c ? pass++ : fail++); checks[(slug(n) || "check") + "-" + (++kn)] = !!c; console.log((c ? "  ok  " : " FAIL ") + n + (x ? "  — " + x : "")); };

// build (esbuild is a local transform; bignumber injected) — no fetch at build either
const k1 = await buildCommerceKernel({ read, esbuild, bignumber, hash: sha256hex });
ok("Medusa commerce math bundles to a self-contained kernel (no unresolved deps)", k1.unresolved.length === 0 && k1.js.length > 0, k1.js.length + " bytes");
ok("a Forge κ-transform receipt is minted (κ(source)⊕esbuild⊕flags → κ(kernel), ADR-0051)",
  /hosc:Compilation/.test(JSON.stringify(k1.receipt)) && k1.receipt["hosc:lang"] === "medusa-commerce-kernel" && k1.kappa.startsWith("did:holo:blake3:"));

// deterministic / re-derivable (Law L5)
const k2 = await buildCommerceKernel({ read, esbuild, bignumber, hash: sha256hex });
ok("deterministic: rebuild → identical kernel κ (re-derivable, L5)", k2.kappa === k1.kappa, k1.kappa.slice(0, 30) + "…");

// verbatim: every Medusa source file the kernel compiles re-hashes to its pinned κ (Stage 1/3)
const manifest = JSON.parse(readFileSync(join(VENDOR, "medusa", "medusa-pin.kappa.json"), "utf8"));
const pinned = Object.fromEntries(manifest.files.map((f) => [f.path, f.kappa]));
let verbatim = 0;
for (const p of KERNEL_FILES) {
  const k = "did:holo:sha256:" + sha256hex(read(p));
  if (k === pinned[p]) verbatim++;
}
ok("the kernel is VERBATIM Medusa (every source file re-hashes to its pinned κ)", verbatim === KERNEL_FILES.length, verbatim + "/" + KERNEL_FILES.length);

// ── 0-network guard for the RUNTIME (Law L4): loading + running touches no network ──
let fetches = 0;
globalThis.fetch = () => { fetches++; throw new Error("kernel runtime must be 0-network"); };

// load the bundle (an ESM module) and run Medusa's verbatim functions
const dir = mkdtempSync(join(tmpdir(), "holo-hub-kernel-"));
const modPath = join(dir, "kernel.mjs");
writeFileSync(modPath, k1.js);
const K = await import(pathToFileURL(modPath).href);
ok("kernel exports Medusa's verbatim functions", typeof K.calculateTaxTotal === "function" && typeof K.calculateAmountsWithTax === "function" && typeof K.BigNumber === "function");

// the MATH is correct — Medusa's own tax computation, running in-tab
const num = (x) => (x && typeof x.toNumber === "function" ? x.toNumber() : Number(x));
ok("calculateTaxTotal: 200 @ 10% = 20", num(K.calculateTaxTotal({ taxLines: [{ rate: 10 }], taxableAmount: 200 })) === 20);
ok("multi-rate tax: 400 @ (8.25% + 1.75%) = 40", num(K.calculateTaxTotal({ taxLines: [{ rate: 8.25 }, { rate: 1.75 }], taxableAmount: 400 })) === 40);
const ex = K.calculateAmountsWithTax({ taxLines: [{ rate: 10 }], amount: 100, includesTax: false });
ok("amounts (tax-exclusive): 100 + 10% → withTax 110 / withoutTax 100", ex.priceWithTax === 110 && ex.priceWithoutTax === 100, JSON.stringify(ex));
const inc = K.calculateAmountsWithTax({ taxLines: [{ rate: 10 }], amount: 110, includesTax: true });
ok("amounts (tax-inclusive): 110 incl 10% → withTax 110 / withoutTax 100", inc.priceWithTax === 110 && Math.abs(inc.priceWithoutTax - 100) < 1e-9, JSON.stringify(inc));
// BigNumber precision (the reason Medusa uses bignumber.js — no float drift)
ok("BigNumber arbitrary precision: 0.1 + 0.2 === 0.3 (no float drift)", num(K.MathBN.add(0.1, 0.2)) === 0.3);

ok("0-network: running the kernel made no fetch (serverless, L4)", fetches === 0, fetches + " fetches");

// ── emit the EARL result + exit ──
const result = { "@type": "earl:TestResult", witnessed: fail === 0,
  subject: "Holo Hub — Medusa commerce-math kernel as a Forge κ-transform (ADR-0094 Stage 3)",
  passed: pass, failed: fail, kernelKappa: k1.kappa, checks };
writeFileSync(join(here, "holo-hub-kernel-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("\n" + (fail === 0 ? "PASS" : "FAIL") + " — " + pass + " ok, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
