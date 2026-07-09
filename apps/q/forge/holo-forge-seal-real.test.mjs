#!/usr/bin/env node
// holo-forge-seal-real.test.mjs — ADR-0114 S0, on a REAL model: prove forgeToHolo([ggufFrontEnd]) (the new seam)
// is BYTE-IDENTICAL to the existing writeHolo() on an actual 491 MB Qwen2.5-0.5B GGUF, and that the produced .holo
// round-trips through the real reader with a real tensor body L5-verifying. This is the direct de-risk of the Step-3
// cut-over (holo-archive.mjs writeHolo → sealHolo): if the bytes are identical on a real model, the cut-over changes
// no .holo κ. Skips cleanly (exit 0, witnessed:false+skipped) if the model file is absent.
//
// Checks (all must hold when the model is present):
//   1  byteIdenticalToWriteHolo — sha256(forgeToHolo(gguf).holo) === sha256(writeHolo(gguf).holo) AND same rootHolo.
//   2  realReaderRoundTrips      — readHolo(new .holo): arch present, footer === rootHolo, nBodies>0.
//   3  realTensorBodyL5          — openHoloStream getBody on a real weight body re-derives (L5) — no REFUSE.
//
// Authority: holospaces Laws L1/L3/L5 · ADR-0114 · hologram-archive (MAGIC "HOLO" v2). Heavy (multi-GB hashing);
// allow a few minutes. Usage: node holo-apps/apps/q/forge/holo-forge-seal-real.test.mjs

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeHolo, readHolo, openHoloStream } from "./holo-archive.mjs";
import { forgeToHolo, ggufFrontEnd } from "./holo-forge-seal.mjs";
import { sha256hex } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const write = (r) => writeFileSync(join(here, "holo-forge-seal-real.test.result.json"), JSON.stringify(r, null, 2) + "\n");
const MODEL = join(here, ".models", "qwen2.5-0.5b-instruct-q4_k_m.gguf");

if (!existsSync(MODEL)) {
  write({ spec: "ADR-0114 S0 real-model byte-identity", witnessed: false, skipped: true, reason: "model file absent: " + MODEL, covers: [] });
  console.log(`SKIP — model absent (${MODEL}); the synthetic S0 witness (holo-forge-seal.test.mjs) covers the seam.`);
  process.exit(0);
}

const checks = {};
const gguf = new Uint8Array(readFileSync(MODEL));
console.log(`loaded ${(gguf.length / 1e6).toFixed(0)} MB GGUF`);

// 1 · byte-identity: forge both ways, compare whole-archive hashes (collision-resistant) + roots
let w1 = writeHolo(gguf);
const h1 = sha256hex(w1.holo), r1 = w1.rootHolo, nB1 = w1.nBodies, len1 = w1.bytes;
console.log(`writeHolo:    ${(len1 / 1e6).toFixed(0)} MB · ${nB1} bodies · ${r1.slice(0, 28)}…`);
w1 = null;                                                    // free ~491 MB before forging again

const w2 = await forgeToHolo(gguf, [ggufFrontEnd]);
const h2 = sha256hex(w2.holo), r2 = w2.rootHolo;
console.log(`forgeToHolo:  ${(w2.bytes / 1e6).toFixed(0)} MB · ${w2.nBodies} bodies · ${r2.slice(0, 28)}…  frontEnd=${w2.frontEnd}`);
checks.byteIdenticalToWriteHolo = h1 === h2 && r1 === r2 && nB1 === w2.nBodies && len1 === w2.bytes;

// 2 · the new .holo round-trips through the real reader
const r = readHolo(w2.holo);
checks.realReaderRoundTrips = typeof r.meta.arch === "string" && r.meta.arch.length > 0 && r.footer === r2 && r.meta.nBodies > 0;

// 3 · a real weight body L5-verifies via the streaming reader
const h = await openHoloStream(async (off, len) => w2.holo.subarray(off, off + len));
const [firstHex] = [...h.dir.keys()];
const body = await h.getBody(firstHex);                      // throws "holo L5 REFUSE" on mismatch
checks.realTensorBodyL5 = sha256hex(body) === firstHex && body.length > 0;

const witnessed = Object.values(checks).every(Boolean);
write({
  spec: "Holo Forge Unified (ADR-0114) S0 on a REAL model — forgeToHolo([ggufFrontEnd]) is BYTE-IDENTICAL to the existing writeHolo() on a real 491 MB Qwen2.5-0.5B GGUF (same archive hash, same rootHolo, same body count/length), the .holo round-trips through the real reader, and a real weight body L5-verifies. Direct proof the Step-3 cut-over (writeHolo → sealHolo) changes no .holo κ.",
  authority: "holospaces Laws L1/L3/L5 · ADR-0114 · hologram-archive (MAGIC \"HOLO\" v2)",
  model: "qwen2.5-0.5b-instruct-q4_k_m.gguf",
  witnessed,
  covers: witnessed ? ["real-model-byte-identity", "writeHolo-equals-sealHolo", "real-reader-roundtrip", "real-body-l5"] : [],
  checks,
});

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ the new seam forges a REAL model byte-identically to writeHolo — the cut-over changes no κ" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
