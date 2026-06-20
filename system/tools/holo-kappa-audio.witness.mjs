// holo-kappa-audio.witness.mjs — proves the κ-audio substrate end-to-end, in Node, no browser.
//
// On a REAL lossless track it asserts:
//   1. cross-hash agreement — the browser-side verifier (holo-uor.sha256hex) accepts every κ the ingest
//      tool minted with node:crypto. (If these ever drift, verify-before-decode would falsely refuse.)
//   2. L5 per chunk — verifyChunk(bytes, κ) === true for all chunks.
//   3. bit-exact lossless — assemble(chunks) is byte-identical to the source AND hashes to trackKappa.
//   4. tamper refusal — flipping one byte makes that chunk's verifyChunk === false (it would be refused).
//
//   node holo-kappa-audio.witness.mjs [path-to-wav]
// exit 0 = all green · 1 = a failure · 2 = setup error (no test asset). Never prints a false green.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ingest } from "./holo-audio-ingest.mjs";
import { verifyChunk, assemble, chunkKappa, verifyManifest, hexOf } from "../os/usr/lib/holo/holo-kappa-audio.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..", "..", "..");                       // …/HOLOGRAM
const DEFAULT_TRACK = join(REPO, "holo-apps", "apps", "music", "music", "Hologram Collective", "Kappa Sessions", "01 - Boot Chime.wav");

const eq = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };

function main() {
  const track = process.argv[2] || DEFAULT_TRACK;
  if (!existsSync(track)) { console.error("witness: no test asset at " + track); process.exit(2); }
  const src = new Uint8Array(readFileSync(track));
  const { manifest, chunks } = ingest(src, { ext: ".wav", chunkBytes: 262144, title: "Boot Chime", artist: "Hologram Collective", album: "Kappa Sessions" });
  const bytesByIndex = (i) => chunks[i].bytes;

  let pass = 0, fail = 0; const log = (ok, msg) => { console.log((ok ? "  ✓ " : "  ✗ ") + msg); ok ? pass++ : fail++; };
  console.log("holo-kappa-audio witness — " + track.split(/[\\/]/).pop());
  console.log("  track: " + manifest.bytes + " bytes · " + manifest.chunks.length + " chunks · " +
    (manifest.sampleRate ? (manifest.sampleRate / 1000) + "kHz/" + manifest.bits + "bit/" + manifest.channels + "ch · " + manifest.durationSec + "s" : "") );

  // 1 + 2: cross-hash agreement + L5 per chunk (holo-uor verifies node:crypto's κs)
  let chunkOk = manifest.chunks.length > 0;
  for (let i = 0; i < manifest.chunks.length; i++) if (!verifyChunk(chunks[i].bytes, manifest.chunks[i].kappa)) { chunkOk = false; break; }
  log(chunkOk, "every chunk re-derives to its declared κ (holo-uor ⇄ node:crypto agree · L5 per chunk)");

  // full manifest check via the shipped verifier
  const vm = verifyManifest(manifest, bytesByIndex);
  log(vm.ok && vm.verified === manifest.chunks.length, "verifyManifest(): " + vm.verified + "/" + vm.total + " chunks + trackKappa OK");

  // 3: bit-exact lossless round-trip
  const whole = assemble(chunks.map((c) => c.bytes));
  log(eq(whole, src), "reassembled bytes are BYTE-IDENTICAL to the source (lossless, " + whole.length + " bytes)");
  log(chunkKappa(whole) === manifest.trackKappa, "whole-file κ matches trackKappa (" + manifest.trackKappa.slice(0, 28) + "…)");

  // 4: tamper refusal — flip one byte in chunk 0
  const tampered = Uint8Array.from(chunks[0].bytes); tampered[Math.floor(tampered.length / 2)] ^= 0x01;
  log(verifyChunk(tampered, manifest.chunks[0].kappa) === false, "a single flipped byte is REFUSED (verifyChunk → false)");

  console.log((fail ? "FAIL" : "PASS") + " — " + pass + "/" + (pass + fail) + " checks");
  process.exit(fail ? 1 : 0);
}

main();
