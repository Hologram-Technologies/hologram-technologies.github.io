#!/usr/bin/env node
// holo-holowhat-parity-witness.mjs — P0 capstone: run the REAL holowhat WASM and prove its content
// addressing is byte-identical to ours. This is the cross-implementation parity that lets our messenger
// ride holowhat's Content Network: the κ we compute for an object's wire bytes IS the κ holowhat's
// cn_put returns, and holowhat's verify_kappa accepts exactly what we accept.
//
//   PARITY   — holowhat kappa(bytes) === our kappaBlake3(bytes) on KATs, text, and a real envelope's bytes
//   VERIFY   — holowhat verify_kappa(bytes, κ) accepts a matching κ and refuses a forged one (L5)
//   CONSENSUS— our verifyReceipt agrees with holowhat verify_kappa on the same inputs
//
//   node tools/holo-holowhat-parity-witness.mjs
//
// Authority: holowhat crates/holospaces-web (real WASM: kappa/verify_kappa) · holo-blake3 (BLAKE3) · Law L1/L5.

import { writeFileSync, readFileSync, existsSync, copyFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { kappaBlake3 } from "../os/usr/lib/holo/holo-blake3.mjs";
import { cnBytesOf, verifyReceipt } from "../os/usr/lib/holo/holo-messenger-cn.mjs";
import { mint } from "../os/usr/lib/holo/holo-pluck.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const HOLOGRAM = join(here, "..", "..", "..");
const PKG = join(HOLOGRAM, "_vendor/holowhat/crates/holospaces-web/web/pkg");
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const te = new TextEncoder();

// load the REAL holowhat WASM (copy the --target web .js to .mjs so Node parses it as ESM; init synchronously)
const jsPath = join(PKG, "holospaces_web.js");
const mjsPath = join(PKG, "holospaces_web.mjs");
if (!existsSync(jsPath)) { console.error("holowhat pkg not built at " + PKG); process.exit(2); }
if (!existsSync(mjsPath)) copyFileSync(jsPath, mjsPath);
const hw = await import(pathToFileURL(mjsPath).href);
const wasmBytes = readFileSync(join(PKG, "holospaces_web_bg.wasm"));
const mod = await WebAssembly.compile(wasmBytes);
hw.initSync({ module: mod });

// ── 1 · PARITY — real holowhat kappa() === our kappaBlake3() on the same bytes ──
const cases = ["", "abc", "first message over the holowhat content network", "the future is light photonics"];
const mism = [];
for (const c of cases) { const b = te.encode(c); const a = hw.kappa(b), o = kappaBlake3(b); if (a !== o) mism.push(`${JSON.stringify(c)}: ${a} != ${o}`); }
// a REAL message envelope's wire bytes (what cn_put would store)
const envBytes = cnBytesOf(mint({ text: "ride the content network", sender: "Ilya", sentAt: "08:31", chat: "Ilya", source: "web.whatsapp.com" }).object);
const envParity = hw.kappa(envBytes) === kappaBlake3(envBytes);
ok("holowhat-kappa-equals-ours", mism.length === 0 && envParity, mism.join(" | ") || `env ${hw.kappa(envBytes)}`);

// ── 2 · VERIFY — holowhat verify_kappa accepts a matching κ, refuses a forged one (L5) ──
const good = te.encode("abc"); const kGood = hw.kappa(good);
const accepts = hw.verify_kappa(good, kGood) === true;
const refuses = hw.verify_kappa(te.encode("abd"), kGood) === false;   // wrong bytes for this κ
ok("holowhat-verify-kappa-fail-closed", accepts && refuses, `accept=${accepts} refuse=${refuses}`);

// ── 3 · CONSENSUS — our verifyReceipt agrees with holowhat verify_kappa on the same inputs ──
ok("our-verify-agrees-with-holowhat",
  verifyReceipt(good, kGood) === hw.verify_kappa(good, kGood) &&
  verifyReceipt(te.encode("abd"), kGood) === hw.verify_kappa(te.encode("abd"), kGood) &&
  verifyReceipt(envBytes, hw.kappa(envBytes)) === true,
  "agree");

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult", witnessed,
  covers: [
    "PARITY — the real holowhat WASM kappa(bytes) is byte-identical to our kappaBlake3(bytes) on KATs, text, and a real message envelope's wire bytes — so our CN κ IS holowhat's cn_put κ",
    "VERIFY — holowhat's own verify_kappa accepts a matching κ and refuses forged bytes (Law L5, fail-closed)",
    "CONSENSUS — our verifyReceipt and holowhat's verify_kappa return the same verdict on the same inputs — the two implementations agree on what to accept",
  ],
  pkg: PKG, wasmBytes: wasmBytes.length,
  checks, failed: fail,
  authority: "holowhat WASM (crates/holospaces-web: kappa, verify_kappa) · holo-blake3 (BLAKE3) · holospaces Law L1/L5",
};
writeFileSync(join(here, "holo-holowhat-parity-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo × holowhat parity witness — the REAL WASM kappa() vs ours (P0 capstone)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  holowhat wasm ${(wasmBytes.length / 1048576).toFixed(2)} MB · kappa(\"abc\") = ${hw.kappa(te.encode("abc"))}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓ — our content-addressing IS holowhat's; the CN bridge is exact" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
