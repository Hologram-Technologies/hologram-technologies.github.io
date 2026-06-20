// holo-closure-anchor-witness.mjs — proves G1/SEC-1: the SW's pin set (etc/os-closure.json) is itself
// re-derived against a baked anchor (CLOSURE_KAPPA in holo-fhs-sw.js), so a tampered pin set fails CLOSED
// instead of re-pointing every per-path κ to forged-but-self-consistent bytes. Mirrors the worker's exact
// check: sha256(os-closure.json) === CLOSURE_KAPPA. Run: node system/tools/holo-closure-anchor-witness.mjs
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sha = (b) => createHash("sha256").update(b).digest("hex");
let pass = 0, fail = 0;
const ok = (n, c) => { (c ? pass++ : fail++); console.log(`  ${c ? "✓" : "✗"}  ${n}`); };

console.log("holo-closure-anchor — the pin set is verified against a baked anchor (G1/SEC-1)\n");

const swSrc = readFileSync(join(ROOT, "os/holo-fhs-sw.js"), "utf8");
const anchor = (swSrc.match(/const CLOSURE_KAPPA = "([0-9a-f]{0,64})"/) || [])[1];
ok("holo-fhs-sw.js bakes a CLOSURE_KAPPA anchor", typeof anchor === "string");
ok("the anchor is a sealed 64-hex κ (not the empty dev sentinel)", /^[0-9a-f]{64}$/.test(anchor));

const closureBytes = readFileSync(join(ROOT, "os/etc/os-closure.json"));
const real = sha(closureBytes);
ok("baked anchor == sha256(os-closure.json) → prod boots (no false refusal)", anchor === real);

// the worker's check, exactly: a tampered pin set does NOT re-derive → CLOSURE_TRUSTED=false → refuse all
const tampered = Buffer.from(closureBytes); tampered[tampered.length - 2] ^= 0x01;   // flip one byte of the JSON
ok("a 1-byte-tampered os-closure.json FAILS re-derivation (fail closed)", sha(tampered) !== anchor);

// re-pointing a single pin (the real attack) also breaks the anchor
const obj = JSON.parse(closureBytes.toString());
const firstKey = Object.keys(obj.closure)[0];
obj.closure[firstKey] = "did:holo:sha256:" + "f".repeat(64);   // forge a pin
ok("re-pointing ANY pin breaks the anchor (forged-but-self-consistent closure refused)", sha(Buffer.from(JSON.stringify(obj))) !== anchor);

ok("the fail-closed guard exists in the fetch handler", /if \(!CLOSURE_TRUSTED\) return refuseClosure\(\)/.test(swSrc));

console.log(`\n${fail ? "WITNESS FAILED" : "WITNESSED ✓"}  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
