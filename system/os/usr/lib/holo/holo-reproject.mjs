// holo-reproject.mjs — async input REPROJECTION (present-side negative latency), lifted from the game
// emulator (holo-retro-engine/holo-reproject.js) into the projection substrate and generalized to a
// per-pixel motion-vector warp so the browser (scroll/scale), QEMU, and 3D cores inherit it.
//
// The twin of run-ahead. Run-ahead cuts latency on the PRODUCE side (re-run from a κ-snapshot); reprojection
// cuts it on the PRESENT side: a frame was produced with the input current when it was rendered, but by the
// time it reaches the panel a FRESHER input sample has arrived. Reprojection warps the already-rendered frame
// by the delta, so what hits the eye reflects input from microseconds ago, not the last produce tick. This is
// async timewarp (VR). In the substrate it runs in the present loop (holo-present-mailbox) on the held front
// frame, between produced frames — which is what makes a 480 Hz present over a 60 Hz producer feel live.
//
// THE DETERMINISM FENCE (the rule that keeps the substrate alive): reprojection is PRESENTATION-ONLY. It
// reads a frame + the input delta and returns a NEW frame; it NEVER writes producer state. If it did, Law L1,
// run-ahead, and rollback netplay would break. These functions take a frame and return a new buffer — they
// have no handle to the producer and cannot mutate it. The witness asserts the source frame is untouched.
//
// node-, Service-Worker- and DOM-safe; pure, no imports. (A WebGPU shader is the natural home for the warp on
// the metal — same math per pixel; this CPU reference is the oracle the GPU pass is validated against.)

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// bilinear sample of `frame` (RGBA, w×h) at (srcX, srcY), edge-clamped, into out[o..o+3].
function sample(frame, w, h, srcX, srcY, out, o) {
  const bx = Math.floor(srcX), by = Math.floor(srcY);
  const tx = srcX - bx, ty = srcY - by;
  const x0 = clamp(bx, 0, w - 1), x1 = clamp(bx + 1, 0, w - 1);
  const y0 = clamp(by, 0, h - 1), y1 = clamp(by + 1, 0, h - 1);
  for (let c = 0; c < 4; c++) {
    const p00 = frame[(y0 * w + x0) * 4 + c], p10 = frame[(y0 * w + x1) * 4 + c];
    const p01 = frame[(y1 * w + x0) * 4 + c], p11 = frame[(y1 * w + x1) * 4 + c];
    const top = p00 + (p10 - p00) * tx, bot = p01 + (p11 - p01) * tx;
    out[o + c] = (top + (bot - top) * ty + 0.5) | 0;
  }
}

// Warp `frame` by a GLOBAL (dx, dy) — the 2D camera/pan/cursor case. Integer part = copy, fractional =
// bilinear (a 0.5-pixel delta is honestly represented, not snapped). Shifting by +dx moves content right ⇒
// output(x) samples source(x-dx). Out-of-frame samples clamp to the edge (no wrap, no garbage).
export function reproject(frame, w, h, dx, dy, out = new Uint8Array(frame.length)) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) sample(frame, w, h, x - dx, y - dy, out, (y * w + x) * 4);
  return out;
}

// Warp `frame` by a PER-PIXEL motion-vector field — the generalization the 2D shift is a special case of
// (3D depth/motion vectors, page scroll/scale, a VM's per-region transform). `field` is either a
// Float32Array of length w*h*2 (interleaved dx,dy) or a function (x,y)→[dx,dy]. A uniform field reduces
// EXACTLY to reproject(frame,w,h,dx,dy) — the witness asserts byte-identical parity.
export function reprojectMV(frame, w, h, field, out = new Uint8Array(frame.length)) {
  const fn = typeof field === "function";
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let dx, dy;
    if (fn) { const v = field(x, y); dx = v[0]; dy = v[1]; }
    else { const i = (y * w + x) * 2; dx = field[i]; dy = field[i + 1]; }
    sample(frame, w, h, x - dx, y - dy, out, (y * w + x) * 4);
  }
  return out;
}

// build a uniform motion-vector field (every pixel = (dx,dy)) — the bridge between the 2D and MV forms.
export function uniformField(w, h, dx, dy) {
  const f = new Float32Array(w * h * 2);
  for (let i = 0; i < w * h; i++) { f[i * 2] = dx; f[i * 2 + 1] = dy; }
  return f;
}

// A tiny input integrator the present loop uses: "how much fresher is now than the frame I'm about to show?"
// The producer records the input it rendered with; the present loop reads the LATEST input at scanout; the
// reprojection delta is the difference. Presentation-only — touches no producer state.
export class ReprojectionTracker {
  constructor() { this.frameInput = { x: 0, y: 0 }; this.latestInput = { x: 0, y: 0 }; }
  setFrameInput(x, y) { this.frameInput = { x, y }; }          // the input the about-to-show frame was produced with
  setLatestInput(x, y) { this.latestInput = { x, y }; }        // the freshest input sample at scanout
  delta() { return { dx: this.latestInput.x - this.frameInput.x, dy: this.latestInput.y - this.frameInput.y }; }
}

export default { reproject, reprojectMV, uniformField, ReprojectionTracker };
