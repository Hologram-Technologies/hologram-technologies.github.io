// holo-manim.js — a NATIVE, zero-dependency animation engine in the spirit of Manim
// (manim.community). Manim itself is a Python engine (Cairo/Pango/FFmpeg/LaTeX) and cannot run
// in a tab; this runs IN the holospace. Rendering is on a RETINA CANVAS via holo-gfx (Canvas2D at
// devicePixelRatio — GPU-rasterized, pixel-sharp on 4K, 60–120fps), decoupled into a steady draw
// loop with an animation timeline that only mutates state → crisp + low-latency, no per-frame DOM
// reflow. A scene is DATA (Mobjects + a play/wait timeline), so it content-addresses to a did:holo
// and carries its real Manim Python source as provenance. Pure helpers (mobjectPoints /
// pathFromPoints / sceneCanonical) are node-testable; scene() renders in the browser.

import { createSurface } from "./holo-gfx.js";

const N = 96;                          // sample points per morphable shape (÷4 for squares)
const smooth = (t) => t * t * (3 - 2 * t); // Manim's default rate function
const TAU = Math.PI * 2;

// ── mobject → an array of [x,y] points in scene units (PURE) ───────────────────────────
export function mobjectPoints(m) {
  const t = m.type, pts = [];
  if (t === "circle" || t === "dot") { const r = t === "dot" ? (m.radius || 0.09) : (m.radius || 1); for (let i = 0; i < N; i++) { const a = (i / N) * TAU; pts.push([r * Math.cos(a), r * Math.sin(a)]); } pts.closed = true; }
  else if (t === "square" || t === "rectangle") { const w = (t === "square" ? (m.side || 2) : (m.width || 2)) / 2, h = (t === "square" ? (m.side || 2) : (m.height || 1.4)) / 2; const corners = [[-w, -h], [w, -h], [w, h], [-w, h]]; const per = N / 4; for (let e = 0; e < 4; e++) { const [ax, ay] = corners[e], [bx, by] = corners[(e + 1) % 4]; for (let i = 0; i < per; i++) { const k = i / per; pts.push([ax + (bx - ax) * k, ay + (by - ay) * k]); } } pts.closed = true; }
  else if (t === "line") { const a = m.from || [-2, 0], b = m.to || [2, 0]; for (let i = 0; i < N; i++) { const k = i / (N - 1); pts.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]); } }
  else if (t === "polygon") { const v = m.points || [[0, 1], [-1, -1], [1, -1]]; const per = Math.max(2, Math.floor(N / v.length)); for (let e = 0; e < v.length; e++) { const a = v[e], b = v[(e + 1) % v.length]; for (let i = 0; i < per; i++) { const k = i / per; pts.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]); } } pts.closed = true; }
  else if (t === "plot") { const f = FUNCS[m.fn] || ((x) => Math.sin(x)); const x0 = m.x0 ?? -6, x1 = m.x1 ?? 6, sy = m.yscale ?? 1; for (let i = 0; i < N; i++) { const x = x0 + (x1 - x0) * (i / (N - 1)); pts.push([x, f(x) * sy]); } }
  else { for (let i = 0; i < N; i++) pts.push([0, 0]); }
  return pts;
}
const FUNCS = { sin: (x) => Math.sin(x), cos: (x) => Math.cos(x), parabola: (x) => 0.25 * x * x - 1 };
export const pathFromPoints = (pts) => "M " + pts.map(([x, y]) => `${x.toFixed(4)} ${y.toFixed(4)}`).join(" L ") + (pts.closed ? " Z" : "");
export const sceneCanonical = (scene) => JSON.stringify({ mobjects: scene.mobjects || {}, timeline: scene.timeline || [], bg: scene.bg || "" });

// ── color lerp (hex) ───────────────────────────────────────────────────────────────────
const hx = (c) => { c = (c || "#ffffff").replace("#", ""); if (c.length === 3) c = c.split("").map((x) => x + x).join(""); return [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2) || "ff", 16)); };
const lerpColor = (a, b, k) => { const A = hx(a), B = hx(b); return "#" + [0, 1, 2].map((i) => Math.round(A[i] + (B[i] - A[i]) * k).toString(16).padStart(2, "0")).join(""); };

// ── scene(scene, {loop}) → an animating element (BROWSER): a retina canvas via holo-gfx ──────
export function scene(sc, { loop = true } = {}) {
  if (typeof document === "undefined") throw new Error("holo-manim: scene() needs a DOM");
  const wrap = document.createElement("div"); wrap.style.cssText = `width:100%;height:100%;background:${sc.bg || "#0b0f17"}`;
  const canvas = document.createElement("canvas"); canvas.style.cssText = "display:block;width:100%;height:100%";
  wrap.appendChild(canvas);
  const surf = createSurface(canvas);
  const ro = (typeof ResizeObserver !== "undefined") ? new ResizeObserver(() => surf.resize()) : null;
  ro && ro.observe(canvas);

  const defs = sc.mobjects || {}, M = new Map();
  const fresh = (def) => ({ type: def.type, points: def.type === "text" ? null : mobjectPoints(def), color: def.stroke || def.color || "#c9d1d9", fill: def.fill || "none", width: def.width || 4, opacity: def.opacity ?? 1, pos: (def.pos || [0, 0]).slice(), rot: def.rot || 0, scale: def.scale || 1, text: def.text || "", size: def.size || 0.6, frac: 1, dotR: def.radius || 0.12 });
  function reset() { M.clear(); for (const id in defs) M.set(id, { def: defs[id], state: fresh(defs[id]) }); }
  reset();
  const map = () => { const W = surf.w, H = surf.h, s = Math.min(W / 14, H / 8); return { s, toPx: ([x, y]) => [W / 2 + x * s, H / 2 - y * s] }; };
  function worldPoints(st) { const c = Math.cos(st.rot), si = Math.sin(st.rot); const p = st.points.map(([x, y]) => { const X = x * st.scale, Y = y * st.scale; return [X * c - Y * si + st.pos[0], X * si + Y * c + st.pos[1]]; }); p.closed = st.points.closed; return p; }

  // ── steady draw loop (only draws; the timeline mutates state) → low-latency, no reflow ──
  let stopped = false;
  function frame() {
    if (stopped) return;
    if (canvas.clientWidth && (canvas.clientWidth !== surf.w || canvas.clientHeight !== surf.h)) surf.resize(); // keep the backing store at element box × dpr (retina-sharp)
    const { s, toPx } = map(); surf.clear(sc.bg || "#0b0f17");
    for (const { def, state } of M.values()) {
      if (state.opacity <= 0.004) continue;
      if (def.type === "text") { const [px, py] = toPx(state.pos); surf.text(state.text, px, py, { size: Math.max(9, state.size * s), color: state.color, opacity: state.opacity }); }
      else if (def.type === "dot") { const [px, py] = toPx(state.pos); surf.dot(px, py, Math.max(2, state.dotR * s), state.fill !== "none" ? state.fill : state.color, state.opacity); }
      else { const wp = worldPoints(state).map(toPx); wp.closed = state.points.closed; surf.poly(wp, { stroke: state.color, fill: state.fill, width: Math.max(1, (state.width / 30) * s), closed: state.points.closed, opacity: state.opacity, frac: state.frac }); }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function tween(ms, fn) { return new Promise((res) => { const t0 = performance.now(); const st = (t) => { if (stopped) return res(); const k = Math.min(1, (t - t0) / Math.max(1, ms)); fn(smooth(k), k); if (k < 1) requestAnimationFrame(st); else res(); }; requestAnimationFrame(st); }); }
  async function playAnim(step) {
    const ms = (step.run || 1) * 1000, m = step.target && M.get(step.target); if (!m) { await sleep(ms); return; }
    const s = m.state;
    switch (step.play) {
      case "Create": s.frac = 0; await tween(ms, (e) => { s.frac = e; }); s.frac = 1; break;
      case "FadeIn": case "Write": s.opacity = 0; await tween(ms, (e) => { s.opacity = e; }); break;
      case "GrowFromCenter": { const tgt = s.scale || 1; s.scale = 0; s.opacity = 0; await tween(ms, (e) => { s.scale = tgt * e; s.opacity = e; }); break; }
      case "FadeOut": await tween(ms, (e) => { s.opacity = 1 - e; }); break;
      case "Rotate": { const r0 = s.rot, r1 = r0 + (step.angle || Math.PI); await tween(ms, (e) => { s.rot = r0 + (r1 - r0) * e; }); break; }
      case "Scale": { const a = s.scale, b = step.factor ?? 1.5; await tween(ms, (e) => { s.scale = a + (b - a) * e; }); break; }
      case "Shift": case "MoveTo": { const p0 = s.pos.slice(), p1 = step.play === "Shift" ? [p0[0] + (step.by ? step.by[0] : 0), p0[1] + (step.by ? step.by[1] : 0)] : (step.to || p0); await tween(ms, (e) => { s.pos = [p0[0] + (p1[0] - p0[0]) * e, p0[1] + (p1[1] - p0[1]) * e]; }); break; }
      case "Trace": { const along = mobjectPoints(step.path || { type: "circle", radius: 2 }); await tween(ms, (e) => { const i = Math.min(along.length - 1, Math.floor(e * (along.length - 1))); s.pos = along[i].slice(); }); break; }
      case "Transform": {
        const to = step.to;
        if (m.def.type === "text" && to.text != null) { await tween(ms / 2, (e) => { s.opacity = 1 - e; }); s.text = to.text; if (to.color) s.color = to.color; await tween(ms / 2, (e) => { s.opacity = e; }); break; }
        const from = s.points, dst = mobjectPoints(to), c0 = s.color, c1 = to.stroke || to.color || c0, f0 = s.fill, f1 = to.fill || f0;
        await tween(ms, (e) => { const p = from.map(([x, y], i) => [x + (dst[i][0] - x) * e, y + (dst[i][1] - y) * e]); p.closed = dst.closed; s.points = p; s.color = lerpColor(c0, c1, e); s.fill = (f0 === "none" || f1 === "none") ? (e > 0.5 ? f1 : f0) : lerpColor(f0, f1, e); });
        break;
      }
      default: await sleep(ms);
    }
  }
  async function runOnce() { for (const step of (sc.timeline || [])) { if (stopped) return; if (step.wait != null) { await sleep(step.wait * 1000); continue; } await playAnim(step); } }
  (async function go() { do { await runOnce(); if (stopped) return; await sleep(900); if (loop && !stopped) reset(); } while (loop && !stopped); })();
  wrap._stop = () => { stopped = true; ro && ro.disconnect(); };
  return wrap;
}
