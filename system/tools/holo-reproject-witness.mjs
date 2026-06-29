#!/usr/bin/env node
// holo-reproject-witness.mjs — PROVE present-side reprojection (async timewarp), lifted from the emulator to
// the substrate and generalized to a per-pixel motion-vector warp. The invariants:
//   • determinism fence — reproject reads a frame and returns a NEW buffer; it NEVER mutates the source (so
//     producer state / run-ahead / rollback can never be corrupted by presentation).
//   • zero-delta identity — warping by (0,0) is an exact passthrough.
//   • integer shift — an integer (dx,dy) is a pure edge-clamped pixel copy (no interpolation error).
//   • subpixel bilinear — a 0.5-pixel delta is the honest average of neighbours (not snapped).
//   • edge clamp — samples outside the frame clamp to the edge (no wrap, no garbage).
//   • MV parity — a UNIFORM motion-vector field reduces byte-identically to the 2D shift (the generalization
//     contains the special case); a NON-UNIFORM field warps each region independently (scroll/parallax/3D).
//   node tools/holo-reproject-witness.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { reproject, reprojectMV, uniformField, ReprojectionTracker } from "../os/usr/lib/holo/holo-reproject.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const W = 8, H = 4;
// R = x*20 (a horizontal ramp, so a horizontal shift is easy to reason about), G = y*20, B = 0, A = 255
const makeFrame = () => { const f = new Uint8Array(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4; f[o] = x * 20; f[o + 1] = y * 20; f[o + 2] = 0; f[o + 3] = 255; } return f; };
const R = (f, x, y) => f[(y * W + x) * 4];
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const eqBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

const checks = {};

// 1 · determinism fence: source untouched, output a distinct full-length buffer
{
  const f = makeFrame(); const before = f.slice();
  const out = reproject(f, W, H, 2.5, 1, undefined);
  const out2 = reprojectMV(f, W, H, uniformField(W, H, 1, 1));
  checks.determinismFence = eqBytes(f, before) && out !== f && out.length === f.length && out2 !== f;
}

// 2 · zero-delta identity: warp by (0,0) is an exact passthrough
{
  const f = makeFrame();
  checks.zeroDeltaIdentity = eqBytes(reproject(f, W, H, 0, 0), f);
}

// 3 · integer shift: output(x) = source(clamp(x-dx)) on the R ramp (pure copy, edge-clamped)
{
  const f = makeFrame(); const out = reproject(f, W, H, 2, 0);
  let ok = true;
  for (let x = 0; x < W; x++) if (R(out, x, 0) !== clamp(x - 2, 0, W - 1) * 20) ok = false;
  checks.integerShift = ok;
}

// 4 · subpixel bilinear: a 0.5-pixel shift averages neighbours ⇒ R(x) = 20x - 10 for x ≥ 1 (honest half-pixel)
{
  const f = makeFrame(); const out = reproject(f, W, H, 0.5, 0);
  checks.subpixelBilinear = R(out, 2, 0) === 30 && R(out, 3, 0) === 50 && R(out, 4, 0) === 70;
}

// 5 · edge clamp: shifting content left samples past the right edge ⇒ clamps to source(W-1), no wrap
{
  const f = makeFrame(); const out = reproject(f, W, H, -3, 0);
  checks.edgeClamp = R(out, W - 1, 0) === (W - 1) * 20 && R(out, W - 2, 0) === (W - 1) * 20;
}

// 6 · MV parity: a uniform field == the 2D shift, byte-identical
{
  const f = makeFrame();
  checks.mvUniformEqualsShift = eqBytes(reprojectMV(f, W, H, uniformField(W, H, 1.5, 0.5)), reproject(f, W, H, 1.5, 0.5));
}

// 7 · MV per-pixel: top half shifts +3, bottom half unchanged (a scroll/parallax) — each region warps alone
{
  const f = makeFrame();
  const out = reprojectMV(f, W, H, (x, y) => (y < H / 2 ? [3, 0] : [0, 0]));
  let topOk = true, bottomOk = true;
  for (let x = 0; x < W; x++) { if (R(out, x, 0) !== clamp(x - 3, 0, W - 1) * 20) topOk = false; if (R(out, x, H - 1) !== R(f, x, H - 1)) bottomOk = false; }
  checks.mvPerPixel = topOk && bottomOk;
}

// 8 · tracker: delta = latest − frame input
{
  const t = new ReprojectionTracker(); t.setFrameInput(10, 20); t.setLatestInput(13, 25);
  const d = t.delta(); checks.trackerDelta = d.dx === 3 && d.dy === 5;
}

const witnessed = Object.values(checks).every(Boolean);
writeFileSync(join(here, "holo-reproject-witness.result.json"), JSON.stringify({
  spec: "Present-side reprojection (async timewarp), lifted from the game emulator to the substrate and generalized to a per-pixel motion-vector warp. Presentation-only (determinism fence: never mutates the producer); zero-delta passthrough; integer shift = edge-clamped copy; 0.5-pixel = honest bilinear average; edge clamp (no wrap). A uniform MV field reduces byte-identically to the 2D shift; a non-uniform field warps each region (scroll/parallax/3D). The CPU reference oracle for a WebGPU warp shader.",
  authority: "VR async timewarp / async reprojection · bilinear resampling · holo-retro-engine/holo-reproject.js · the determinism fence (Law L1)",
  witnessed,
  covers: witnessed ? ["reproject", "determinism-fence", "zero-delta-identity", "integer-shift", "subpixel-bilinear", "edge-clamp", "mv-uniform-parity", "mv-per-pixel"] : [],
  checks,
}, null, 2) + "\n");

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ present-side negative latency: a frame warps to the freshest input before scanout, never touching producer state; the 2D shift generalizes to a per-pixel motion-vector warp" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
