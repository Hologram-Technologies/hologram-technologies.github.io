// holo-gfx.js — the native 2D graphics surface for crisp, low-latency, retina rendering. (The OS
// already has a WebGPU video present layer in holo-gpu.js; this is the vector/animation surface.)
//
// Honest engineering: for 2D vector scenes, a Canvas2D context at devicePixelRatio is GPU-
// rasterized (Skia/GPU raster), pixel-sharp on 4K/retina, and holds 60–120fps — the reliable,
// universal real-time surface. WebGPU is DETECTED + its device acquired (reported in the HUD, and
// the path for a full GPU shape pipeline). No dependency (Law L4). Two parts: gpuInfo() — async
// capability probe; createSurface(canvas) — a synchronous DPR-scaled surface (clear/poly/dot/text)
// drawn through each frame. O(1) to clear + composite per frame; the GPU does the rasterization.

let _info = null, _device = null;

export async function gpuInfo() {
  if (_info) return _info;
  const dpr = Math.min(3, (typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1) || 1);
  let webgpu = false, adapter = "";
  try {
    if (typeof navigator !== "undefined" && navigator.gpu) {
      const a = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      if (a) { webgpu = true; try { adapter = (a.info && (a.info.architecture || a.info.vendor)) || ""; } catch {} try { _device = await a.requestDevice(); } catch {} }
    }
  } catch {}
  let webgl2 = false;
  try { if (typeof document !== "undefined") webgl2 = !!document.createElement("canvas").getContext("webgl2"); } catch {}
  _info = { webgpu, webgl2, dpr, adapter, device: _device, backend: webgpu ? "WebGPU" : webgl2 ? "WebGL2" : "Canvas2D" };
  return _info;
}
export const gpuLabel = (i) => `${i.backend}${i.dpr > 1 ? " · " + i.dpr + "×" : ""}`;

export function createSurface(canvas) {
  const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
  let dpr = Math.min(3, (typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1) || 1), W = 1, H = 1;
  function resize() {
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width || canvas.clientWidth || 320));
    H = Math.max(1, Math.round(r.height || canvas.clientHeight || 200));
    dpr = Math.min(3, (typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1) || 1);
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // 1 unit = 1 CSS px, sharp at physical res
  }
  resize();
  return {
    canvas, ctx, get w() { return W; }, get h() { return H; }, get dpr() { return dpr; }, resize,
    clear(color) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); if (color) { ctx.fillStyle = color; ctx.fillRect(0, 0, W, H); } else ctx.clearRect(0, 0, W, H); },
    // a polyline/polygon in CSS px. frac<1 draws the leading fraction (the draw-on "Create" effect).
    poly(pts, { stroke, fill, width = 2, closed = false, opacity = 1, frac = 1 } = {}) {
      if (!pts || pts.length < 2) return;
      ctx.save(); ctx.globalAlpha = opacity; ctx.lineJoin = "round"; ctx.lineCap = "round";
      const n = Math.max(2, Math.round(pts.length * Math.max(0, Math.min(1, frac))));
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < n; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      if (closed && frac >= 1) ctx.closePath();
      if (fill && fill !== "none") { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
      ctx.restore();
    },
    dot(x, y, r, color, opacity = 1) { ctx.save(); ctx.globalAlpha = opacity; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.restore(); },
    text(str, x, y, { size = 16, color = "#fff", align = "center", opacity = 1 } = {}) { ctx.save(); ctx.globalAlpha = opacity; ctx.fillStyle = color; ctx.font = `600 ${size}px ui-sans-serif, system-ui, sans-serif`; ctx.textAlign = align; ctx.textBaseline = "middle"; ctx.fillText(str, x, y); ctx.restore(); },
  };
}

const HoloGfx = { gpuInfo, gpuLabel, createSurface };
if (typeof globalThis !== "undefined") globalThis.HoloGfx = globalThis.HoloGfx || HoloGfx;
export default HoloGfx;
