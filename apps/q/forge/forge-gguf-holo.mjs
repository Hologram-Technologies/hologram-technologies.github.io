// forge-gguf-holo.mjs — GGUF → κ-addressable .holo (the brain's format). One call: forgeToHolo(ggufFrontEnd).
// Preserves original quant bytes verbatim (per-tensor κ-blocks), seals the same archive the QVAC brain reader
// (openHoloStream) consumes. Archive κ (footer sha256) = the model's did:holo → wire it into holo-voice-holo-brain.
//   node forge-gguf-holo.mjs <in.gguf> <out.holo>
import { readFileSync, writeFileSync } from "node:fs";
import { forgeToHolo, ggufFrontEnd } from "./holo-forge-seal.mjs";

const IN = process.argv[2], OUT = process.argv[3];
if (!IN || !OUT) { console.error("usage: node forge-gguf-holo.mjs <in.gguf> <out.holo>"); process.exit(1); }
const t0 = Date.now();
const bytes = new Uint8Array(readFileSync(IN));
const r = await forgeToHolo(bytes, [ggufFrontEnd]);
writeFileSync(OUT, r.holo);
console.log(`forged ${IN.split(/[\\/]/).pop()} → ${OUT.split(/[\\/]/).pop()}`);
console.log(`  ${(r.bytes / 1e6).toFixed(1)} MB · ${r.nTensors} tensors · ${r.nBodies} κ-bodies · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log(`  archive κ  ${r.rootHolo}`);
