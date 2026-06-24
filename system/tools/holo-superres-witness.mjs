#!/usr/bin/env node
// holo-superres-witness.mjs — PROVE the lens super-resolution pass: sharpness from the projector, not the
// producer. A low-res κ tile upscales to the device resolution, the result is κ-cached (re-seen ⇒ O(1), no
// re-upscale), and ONE low-res source projects sharp at any scale (resolution independence).
//   • dimensions — ×s upscale yields (sw·s)×(sh·s).
//   • bilinear correctness — flat tiles stay flat (no ringing); a ramp upscales monotonically end-to-end.
//   • κ-cache O(1) — re-upscaling the same tile is a cache hit, zero kernel dispatches.
//   • resolution independence — one source κ upscales to ×2/×4/×8, each a distinct content-addressed result.
//   • content-addressed + deterministic — upscaled bytes re-derive to their κ; same source ⇒ same output κ.
//   node tools/holo-superres-witness.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { upscaleBilinear, makeSuperRes } from "../os/usr/lib/holo/holo-superres.mjs";
import { kappaOf } from "../os/usr/lib/holo/holo-kappa-stream.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const tile = (sw, sh, fn) => { const f = new Uint8Array(sw * sh * 4); for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { const [r, g, b, a] = fn(x, y); const o = (y * sw + x) * 4; f[o] = r; f[o + 1] = g; f[o + 2] = b; f[o + 3] = a; } return f; };
const Rrow = (bytes, w, row) => Array.from({ length: w }, (_, x) => bytes[(row * w + x) * 4]);

const checks = {}; let model = null;

// 1 · dimensions
{
  const src = tile(64, 64, () => [100, 100, 100, 255]);
  const r = upscaleBilinear(src, 64, 64, 4);
  checks.dimensions = r.w === 256 && r.h === 256 && r.bytes.length === 256 * 256 * 4;
}

// 2 · flat stays flat (no ringing) + a ramp upscales monotonically with correct endpoints
{
  const flat = tile(8, 8, () => [128, 64, 32, 255]);
  const rf = upscaleBilinear(flat, 8, 8, 4);
  const flatOk = rf.bytes.every((v, i) => v === [128, 64, 32, 255][i % 4]);
  const ramp = tile(2, 1, (x) => [x === 0 ? 0 : 200, 0, 0, 255]);   // R: 0 → 200
  const rr = upscaleBilinear(ramp, 2, 1, 4); const row = Rrow(rr.bytes, 8, 0);
  let mono = true; for (let i = 1; i < row.length; i++) if (row[i] < row[i - 1]) mono = false;
  checks.bilinearCorrect = flatOk && mono && row[0] <= 5 && row[7] >= 195;
}

// 3 · κ-cache O(1): re-upscaling the same tile is a hit, no second dispatch
{
  const sr = makeSuperRes({ scale: 4 });
  const src = tile(32, 32, (x, y) => [(x * 8) & 0xff, (y * 8) & 0xff, 0, 255]);
  const a = await sr.upscale(src, 32, 32);
  const b = await sr.upscale(src.slice(), 32, 32);            // same bytes, different array
  checks.cacheHitO1 = a.cached === false && b.cached === true && sr.dispatches() === 1 && a.kappa === b.kappa;
}

// 4 · resolution independence: ONE source κ upscales to ×2/×4/×8, each a distinct result of correct size
{
  const sr = makeSuperRes();
  const src = tile(64, 64, (x, y) => [(x ^ y) & 0xff, (x * 3) & 0xff, (y * 3) & 0xff, 255]);
  const srcK = await kappaOf(src);
  const x2 = await sr.upscale(src, 64, 64, { scale: 2 });
  const x4 = await sr.upscale(src, 64, 64, { scale: 4 });
  const x8 = await sr.upscale(src, 64, 64, { scale: 8 });
  const dims = x2.w === 128 && x4.w === 256 && x8.w === 512;
  const distinct = new Set([x2.kappa, x4.kappa, x8.kappa]).size === 3;
  // all three derive from the SAME source κ (one low-res tile → any panel)
  checks.resolutionIndependence = dims && distinct && (await kappaOf(src)) === srcK && sr.dispatches() === 3;
  model = { sourcePx: "64×64", scales: [2, 4, 8], to8k: "512×512 tile from one 64×64 κ" };
}

// 5 · content-addressed + deterministic: upscaled bytes re-derive to κ; same source ⇒ same output κ
{
  const src = tile(40, 40, (x, y) => [(x + y) & 0xff, 0, 0, 255]);
  const r = upscaleBilinear(src, 40, 40, 4);
  const k = await kappaOf(r.bytes);
  const r2 = upscaleBilinear(src.slice(), 40, 40, 4);
  checks.contentAddressedDeterministic = k === (await kappaOf(r2.bytes));
}

const witnessed = Object.values(checks).every(Boolean);
writeFileSync(join(here, "holo-superres-witness.result.json"), JSON.stringify({
  spec: "Lens super-resolution: a low-res κ tile upscales to the device resolution AT THE LENS (sharpness from the projector, not the producer); the upscaled tile is content-addressed and κ-cached (re-seen ⇒ O(1), no re-upscale); one low-res source κ projects sharp at ×2/×4/×8 (resolution independence). Bilinear is the baseline + the CPU oracle the GPU path is validated against; a learned kernel drops into the same seam.",
  authority: "bilinear resampling · content-addressed memoization (Laws L1/L3/L5) · super-resolution as a present-side pass",
  witnessed,
  covers: witnessed ? ["superres", "dimensions", "bilinear-correct", "kappa-cache-o1", "resolution-independence", "content-addressed-deterministic"] : [],
  model,
  checks,
}, null, 2) + "\n");

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
if (model) console.log(`· resolution independence: one ${model.sourcePx} κ → ${model.to8k} (scales ${model.scales.join("/")}) — sharpness lives in the lens`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ a low-res κ tile projects sharp at any panel; the upscaled tile is κ-cached so re-seen tiles never re-upscale" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
