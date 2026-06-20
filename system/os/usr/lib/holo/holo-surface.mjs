// holo-surface.mjs — a declarative κ-surface rendered through a WebGPU backend, DOM as the REFERENCE
// renderer + automatic fallback. One entry: renderSurface(target, κ|spec).
//
// A surface is a backend-agnostic, JSON-serialisable κ-object:
//   { "@type":"holo:Surface", kind:"card", w, h, radius, bg:[r,g,b,a], accent:[...], accentH,
//     text, textColor:[...], textSize, pad }
// (0..1 colour components). The SAME spec renders identically on either backend — WebGPU is an
// ACCELERATOR, never a divergent path; DOM is the truth the GPU output must match.
//
// Law L5: a κ surface is verified (re-derived) BEFORE any byte reaches the GPU — verify-before-GPU.
// O(1): the compiled pipeline is cached per (shader ⊕ format) in HoloMemo (session L1) — the SECOND
// card is a zero-recompile rebind. TEXT uses HoloMemo.handle()'s TWO-LAYER key: the rasterised label
// bitmap (the expensive work) is built ONCE and persisted as SOURCE bytes in L2; hydrate() uploads it
// to a GPUTexture (cheap). After a reload the texture is re-uploaded from L2 — NOT re-rasterised. This
// is the first real use of the L2 source-byte tier: "O(1) across reloads" made honest for a GPU asset.

import { memo, handle, key as memoKey } from "./holo-memo.mjs";

const rgba = (c) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${c[3]})`;

// ── backend selection: WebGPU when present, else the DOM reference. force: "gpu" | "dom" to override.
export function pickBackend(opts = {}) {
  if (opts.force === "dom" || opts.force === "gpu") return opts.force;
  return (typeof navigator !== "undefined" && navigator.gpu) ? "gpu" : "dom";
}

// ── L5: resolve a κ to bytes, re-derive, refuse a mismatch, parse the spec. An inline spec passes through.
export async function specOf(input, { resolve, verify } = {}) {
  if (input && typeof input === "object" && !(input instanceof Uint8Array)) return input;   // inline spec
  if (typeof resolve !== "function") throw new Error("surface κ given but no resolver");
  const bytes = await resolve(input);
  if (typeof verify === "function" && !(await verify(input, bytes))) throw new Error("L5 REFUSED: surface κ did not re-derive");
  return JSON.parse(new TextDecoder().decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)));
}

const clamp01 = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : d; };
const col = (c, d) => { const a = Array.isArray(c) ? c : []; return [clamp01(a[0], d[0]), clamp01(a[1], d[1]), clamp01(a[2], d[2]), a[3] == null ? d[3] : clamp01(a[3], d[3])]; };
// normalise a card spec to concrete values both backends read the SAME way (no drift).
export function normCard(spec = {}) {
  return {
    kind: "card",
    w: Math.max(1, spec.w || 320), h: Math.max(1, spec.h || 200),
    radius: Math.max(0, spec.radius == null ? 16 : spec.radius),
    bg: col(spec.bg, [0.12, 0.13, 0.18, 1]),
    accent: col(spec.accent, [0.42, 0.55, 1, 1]),
    accentH: Math.max(0, spec.accentH == null ? 8 : spec.accentH),
    text: spec.text != null ? String(spec.text) : null,
    textColor: col(spec.textColor, [0.92, 0.94, 0.98, 1]),
    textSize: Math.max(1, spec.textSize == null ? 18 : spec.textSize),
    pad: Math.max(0, spec.pad == null ? 16 : spec.pad),
  };
}

// ── DOM reference renderer: the truth. cardStyle (pure) + a thin mount; text is a positioned child.
export function cardStyle(spec) {
  const s = normCard(spec);
  return {
    width: s.w + "px", height: s.h + "px", borderRadius: s.radius + "px",
    background: `linear-gradient(${rgba(s.accent)} 0 ${s.accentH}px, ${rgba(s.bg)} ${s.accentH}px 100%)`,
    boxSizing: "border-box", position: "relative", overflow: "hidden",
  };
}
export function renderCardDOM(target, spec, doc = (typeof document !== "undefined" ? document : null)) {
  if (!doc) throw new Error("renderCardDOM needs a document");
  const s = normCard(spec);
  const el = doc.createElement("div");
  Object.assign(el.style, cardStyle(spec));
  el.setAttribute("data-holo-surface", "card");
  if (s.text) {
    const tx = doc.createElement("div");
    Object.assign(tx.style, { padding: `${s.accentH + s.pad}px ${s.pad}px ${s.pad}px`, color: rgba(s.textColor), font: `${s.textSize}px system-ui, -apple-system, sans-serif`, whiteSpace: "pre-wrap", lineHeight: "1.35" });
    tx.textContent = s.text;
    el.appendChild(tx);
  }
  target.replaceChildren(el);
  return { backend: "dom", el };
}

// ── WebGPU backend ──────────────────────────────────────────────────────────────────────────────
export const CARD_WGSL = `
struct U { res: vec2f, radius: f32, accentH: f32, bg: vec4f, accent: vec4f };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f,3>(vec2f(-1.0,-1.0), vec2f(3.0,-1.0), vec2f(-1.0,3.0));   // fullscreen triangle
  return vec4f(p[i], 0.0, 1.0);
}
fn sdRoundRect(p: vec2f, b: vec2f, r: f32) -> f32 {
  let q = abs(p) - b + vec2f(r);
  return min(max(q.x, q.y), 0.0) + length(max(q, vec2f(0.0))) - r;
}
@fragment fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let uv = frag.xy;
  let c = u.res * 0.5;
  let half = u.res * 0.5 - vec2f(1.0);
  let d = sdRoundRect(uv - c, half, u.radius);
  let aa = 1.0 - smoothstep(-1.0, 1.0, d);                 // antialiased rounded mask
  let top = c.y - half.y;
  let band = step(uv.y, top + u.accentH);                  // accent bar across the top
  var card = mix(u.bg, u.accent, band);
  let t = textureSample(tex, smp, uv / u.res);             // label texture, aligned 1:1 to the card
  card = vec4f(mix(card.rgb, t.rgb, t.a), card.a);         // composite text over the card fill
  return card * aa;                                        // premultiplied; aa→0 outside the rounded card
}`;

// the compiled pipeline, cached per (shader-hash ⊕ format) — second card = zero-recompile rebind.
function cardPipeline(device, format) {
  return memo(["holo:card-pipeline", memoKey(CARD_WGSL), format], () => {
    const module = device.createShaderModule({ code: CARD_WGSL });
    return device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });
  }, { persist: false });   // a GPURenderPipeline is not serialisable → session-only L1
}

// pack/unpack a label bitmap as L2 SOURCE bytes: [w:u32][h:u32][rgba…]
function packTex(w, h, rgba) { const b = new Uint8Array(8 + w * h * 4); const dv = new DataView(b.buffer); dv.setUint32(0, w, true); dv.setUint32(4, h, true); if (rgba) b.set(rgba, 8); return b; }
// rasterise the label to RGBA bytes (the EXPENSIVE work, run once → L2). Node-safe: returns blank if no canvas.
function buildTextBytes(s) {
  const w = s.w, h = s.h;
  let canvas = null;
  if (typeof OffscreenCanvas !== "undefined") canvas = new OffscreenCanvas(w, h);
  else if (typeof document !== "undefined") { canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h; }
  if (!canvas) return packTex(w, h, null);                  // no rasteriser (e.g. Node) → blank atlas
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = rgba(s.textColor);
  ctx.font = `${s.textSize}px system-ui, -apple-system, sans-serif`;
  ctx.textBaseline = "top";
  const align = s.align || "left"; ctx.textAlign = align;
  // simple word-wrap inside the padding box
  const x = align === "center" ? Math.round(w / 2) : align === "right" ? w - s.pad : s.pad, maxW = w - s.pad * 2; let y = s.accentH + s.pad; const lh = Math.ceil(s.textSize * 1.35);
  for (const para of String(s.text).split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const test = line ? line + " " + word : word;
      if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, y); y += lh; line = word; }
      else line = test;
    }
    if (line) { ctx.fillText(line, x, y); y += lh; }
  }
  return packTex(w, h, ctx.getImageData(0, 0, w, h).data);
}

// rasterise an SVG icon (path(s) over a viewBox) to RGBA bytes (the L2 source). Node-safe: blank if no canvas.
function buildVectorBytes(s) {
  const w = s.w, h = s.h;
  let canvas = null;
  if (typeof OffscreenCanvas !== "undefined") canvas = new OffscreenCanvas(w, h);
  else if (typeof document !== "undefined") { canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h; }
  if (!canvas) return packTex(w, h, null);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  const [vx, vy, vw, vh] = s.viewBox, sx = w / vw, sy = h / vh;
  ctx.save(); ctx.translate(-vx * sx, -vy * sy); ctx.scale(sx, sy);
  ctx.lineWidth = s.strokeWidth; ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const d of s.paths) { const p = new Path2D(d); if (s.fill) { ctx.fillStyle = rgba(s.fill); ctx.fill(p); } if (s.stroke) { ctx.strokeStyle = rgba(s.stroke); ctx.stroke(p); } }
  ctx.restore();
  return packTex(w, h, ctx.getImageData(0, 0, w, h).data);
}

const _samplers = new WeakMap();
function getSampler(device) { let s = _samplers.get(device); if (!s) { s = device.createSampler({ magFilter: "linear", minFilter: "linear" }); _samplers.set(device, s); } return s; }

let _devP = null;
async function getDevice() { if (!_devP) _devP = (async () => { const a = await navigator.gpu.requestAdapter(); if (!a) throw new Error("no WebGPU adapter"); return a.requestDevice(); })(); return _devP; }

// render the card to a <canvas> via WebGPU. device/context/format/sampler are injectable (Node-testable).
export async function renderCardGPU(canvas, spec, inj = {}) {
  const s = normCard(spec);
  const device = inj.device || await getDevice();
  const format = inj.format || (navigator.gpu ? navigator.gpu.getPreferredCanvasFormat() : "bgra8unorm");
  const context = inj.context || canvas.getContext("webgpu");
  if (canvas.width !== s.w) canvas.width = s.w;
  if (canvas.height !== s.h) canvas.height = s.h;
  if (context.configure) context.configure({ device, format, alphaMode: "premultiplied" });
  const pipeline = await cardPipeline(device, format);

  // TWO-LAYER label texture: rasterise once (→ L2 source bytes), hydrate = upload to a GPUTexture.
  // text-less cards share ONE 1×1 transparent texture (built once ever). A reload re-uploads from L2,
  // never re-rasterising. hydrate captures the CURRENT device, so it rebuilds correctly post-reload.
  const texKey = s.text
    ? ["holo:card-tex/v1", s.text, s.w, s.h, s.textColor.join(","), s.textSize, s.accentH, s.pad]
    : ["holo:blank-tex/v1"];
  const texOut = await handle(texKey, {
    buildSource: () => (s.text ? buildTextBytes(s) : packTex(1, 1, null)),
    hydrate: (bytes) => {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, 8);
      const w = dv.getUint32(0, true), h = dv.getUint32(4, true);
      const tex = device.createTexture({ size: [w, h], format: "rgba8unorm", usage: 0x4 | 0x2 /*TEXTURE_BINDING|COPY_DST*/ });
      device.queue.writeTexture({ texture: tex }, bytes.subarray(8), { bytesPerRow: w * 4, rowsPerImage: h }, { width: w, height: h });
      return { view: tex.createView() };
    },
  });

  const data = new Float32Array([s.w, s.h, s.radius, s.accentH, ...s.bg, ...s.accent]);
  const ubo = device.createBuffer({ size: data.byteLength, usage: 0x40 | 0x8 /*UNIFORM|COPY_DST*/ });
  device.queue.writeBuffer(ubo, 0, data);
  const bind = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: ubo } },
      { binding: 1, resource: texOut.view },
      { binding: 2, resource: inj.sampler || getSampler(device) },
    ],
  });

  const view = inj.view || context.getCurrentTexture().createView();
  const enc = device.createCommandEncoder();
  const pass = enc.beginRenderPass({ colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }] });
  pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(3); pass.end();
  device.queue.submit([enc.finish()]);
  return { backend: "gpu", format, text: !!s.text };
}

// ══ SCENE GRAPH — container composition (Phase 3b slice: container + text; image/IME next) ═══════
// A scene is a tree of κ-surfaces: a `container` (layout + optional fill) holding child κ-surfaces
// (κ refs resolved + L5-verified + L3-deduped, or inline specs). The whole scene is ONE addressable κ
// (the root); any child is independently renderable (the holographic principle). Each node draws as a
// positioned rounded quad on ONE pipeline; layout is pure (declared sizing) so it is node-testable.

export function normNode(spec = {}) {
  const n = normCore(spec);
  // overlay positioning (optional, any kind): an `abs` child is placed at (ax,ay) within its parent's box and
  // does NOT consume flow space — the minimal capability cards need for corner badges / centered play glyphs.
  if (spec.abs) { n.abs = true; n.ax = +spec.ax || 0; n.ay = +spec.ay || 0; }
  return n;
}
function normCore(spec = {}) {
  const k = spec.kind || (spec["@type"] === "holo:Surface" && spec.children ? "container" : (spec.kind || "card"));
  if (k === "text") return { kind: "text", text: String(spec.text ?? ""), textColor: col(spec.textColor, [0.92, 0.94, 0.98, 1]), textSize: Math.max(1, spec.textSize ?? 16), pad: Math.max(0, spec.pad ?? 8), align: spec.align === "center" ? "center" : spec.align === "right" ? "right" : "left", w: spec.w || null, h: spec.h || null };
  if (k === "image") return { kind: "image", src: spec.src || null, w: Math.max(1, spec.w || 64), h: Math.max(1, spec.h || 64), radius: Math.max(0, spec.radius || 0) };
  if (k === "vector") {
    // a crisp SVG icon: path(s) over a viewBox, rasterised to a texture (GPU) or an inline <svg> (DOM).
    const paths = Array.isArray(spec.paths) ? spec.paths.map(String) : (spec.path != null ? [String(spec.path)] : []);
    return { kind: "vector", paths, viewBox: Array.isArray(spec.viewBox) && spec.viewBox.length === 4 ? spec.viewBox.map(Number) : [0, 0, 24, 24],
      w: Math.max(1, spec.w || 24), h: Math.max(1, spec.h || 24),
      stroke: spec.stroke === null ? null : col(spec.stroke, [0.92, 0.94, 0.98, 1]), fill: spec.fill ? col(spec.fill, [0, 0, 0, 0]) : null,
      strokeWidth: spec.strokeWidth != null ? Math.max(0, spec.strokeWidth) : 2 };
  }
  if (k === "button") {
    // a button is an interactive container: GPU draws the visual; a DOM-mirror <button> (rendered by
    // renderSceneGPU's proxy overlay / renderSceneDOM) is the real focusable/clickable/ARIA node. The
    // `action` is a content-addressed handler id (the substrate NEVER runs inline code — L4/L5).
    const h = Math.max(1, spec.h || 40), ts = Math.max(1, spec.textSize ?? 15), toggled = !!spec.toggled;
    const label = spec.label != null ? String(spec.label) : null;
    const fill = spec.fill !== undefined ? col(spec.fill, [0.16, 0.17, 0.22, 1]) : (toggled && spec.accent ? col(spec.accent, [0.42, 0.55, 1, 1]) : col(null, [0.16, 0.17, 0.22, 1]));
    return { kind: "button", w: Math.max(1, spec.w || 120), h, layout: "stack", gap: 0, cols: 1,
      radius: Math.max(0, spec.radius ?? 999), pad: Math.max(0, spec.pad ?? 12), fill,
      accent: spec.accent ? col(spec.accent, [0.42, 0.55, 1, 1]) : null, accentH: Math.max(0, spec.accentH ?? 0),
      action: spec.action || null, toggleable: !!spec.toggleable || toggled, toggled, disabled: !!spec.disabled,
      aria: spec.aria || label || "button", label, textColor: col(spec.textColor, [0.92, 0.94, 0.98, 1]), textSize: ts,
      children: Array.isArray(spec.children) ? spec.children : (label != null ? [{ kind: "text", text: label, textSize: ts, h, textColor: spec.textColor, align: "center", pad: Math.max(0, Math.round((h - Math.ceil(ts * 1.4)) / 2)) }] : []) };
  }
  if (k === "input") {
    // a text field: GPU draws the box chrome; a DOM-mirror <input>/<textarea> is the REAL editable node
    // (text entry, IME composition, caret, selection, clipboard, a11y — these are DOM-only by nature). The
    // host supplies `action` (fired on input, value→handler) and optional `submit` (fired on Enter), both
    // content-addressed ids — the substrate runs NO inline code (L4/L5).
    const h = Math.max(1, spec.h || (spec.multiline ? 96 : 40)), ts = Math.max(1, spec.textSize ?? 15);
    return { kind: "input", w: Math.max(1, spec.w || 280), h, multiline: !!spec.multiline, layout: "stack", gap: 0, cols: 1,
      radius: Math.max(0, spec.radius ?? 10), pad: Math.max(0, spec.pad ?? 12),
      fill: spec.fill !== undefined ? col(spec.fill, [0.10, 0.11, 0.16, 1]) : col(null, [0.10, 0.11, 0.16, 1]),
      accent: spec.accent ? col(spec.accent, [0.42, 0.55, 1, 1]) : null, accentH: Math.max(0, spec.accentH ?? 0),
      value: spec.value != null ? String(spec.value) : "", placeholder: spec.placeholder != null ? String(spec.placeholder) : "",
      action: spec.action || null, submit: spec.submit || null, disabled: !!spec.disabled, name: spec.name || null,
      aria: spec.aria || spec.placeholder || "text field", textColor: col(spec.textColor, [0.94, 0.95, 0.99, 1]), textSize: ts, children: [] };
  }
  return { kind: "container", w: Math.max(1, spec.w || 320), h: spec.h || null, layout: spec.layout === "grid" ? "grid" : spec.layout === "row" ? "row" : "stack", gap: Math.max(0, spec.gap ?? 10), pad: Math.max(0, spec.pad ?? 14), cols: Math.max(1, spec.cols || 2),
    fill: spec.fill !== undefined ? col(spec.fill, [0, 0, 0, 0]) : (spec.bg ? col(spec.bg, [0.12, 0.13, 0.18, 1]) : null),
    accent: spec.accent ? col(spec.accent, [0.42, 0.55, 1, 1]) : null, accentH: Math.max(0, spec.accentH ?? 0), radius: Math.max(0, spec.radius ?? 12),
    children: Array.isArray(spec.children) ? spec.children : [] };
}

// resolve κ-ref children to specs (L5 via specOf), deduped by κ (L3). Returns a fully-inlined tree.
export async function resolveTree(spec, ctx, seen = new Map()) {
  const node = normNode(spec);
  if (node.kind === "container" || node.kind === "button") {
    const kids = [];
    for (const ch of node.children) {
      let cs;
      if (typeof ch === "string") { if (seen.has(ch)) cs = seen.get(ch); else { cs = await specOf(ch, ctx); seen.set(ch, cs); } cs = { ...cs, __k: ch }; }
      else cs = ch;
      kids.push(await resolveTree(cs, ctx, seen));
    }
    node.children = kids; node.__k = spec.__k || null;
  } else node.__k = spec.__k || null;
  return node;
}

const textH = (n) => n.h || (Math.ceil(n.textSize * 1.4) + n.pad * 2);
// pure layout: tree → flat draw list with absolute boxes. Returns { draws, h } (computed container height).
function layoutNode(node, x, y, w) {
  const draws = [];
  if (node.kind === "text") { const h = textH(node); draws.push({ kind: "text", box: [x, y, w, h], node }); return { draws, h }; }
  if (node.kind === "image") { draws.push({ kind: "image", box: [x, y, node.w, node.h], node }); return { draws, h: node.h }; }
  // container
  const innerX = x + node.pad, innerW = w - node.pad * 2; let cursor = y + node.pad;
  const bg = { kind: "container", box: [x, y, w, 0], node };   // height patched after children
  draws.push(bg);
  const flow = node.children.filter((c) => !c.abs), over = node.children.filter((c) => c.abs);
  let rowMax = 0;   // tallest child in a single horizontal row (row layout)
  if (node.layout === "grid") {
    const cw = (innerW - node.gap * (node.cols - 1)) / node.cols; let col0 = 0, rowH = 0;
    for (const ch of flow) { const cx = innerX + col0 * (cw + node.gap); const r = layoutNode(ch, cx, cursor, cw); draws.push(...r.draws); rowH = Math.max(rowH, r.h); col0++; if (col0 >= node.cols) { col0 = 0; cursor += rowH + node.gap; rowH = 0; } }
    if (col0 > 0) cursor += rowH + node.gap;
  } else if (node.layout === "row") {
    let cx = innerX; for (const ch of flow) { const cw = ch.w || innerW; const r = layoutNode(ch, cx, cursor, cw); draws.push(...r.draws); cx += cw + node.gap; rowMax = Math.max(rowMax, r.h); }
  } else {
    for (const ch of flow) { const r = layoutNode(ch, innerX, cursor, innerW); draws.push(...r.draws); cursor += r.h + node.gap; }
  }
  const h = node.h || (node.layout === "row" ? (flow.length ? rowMax + node.pad * 2 : node.pad * 2) : (flow.length ? cursor - node.gap + node.pad - y : node.pad * 2));
  bg.box[3] = h;
  // overlay children: positioned at (ax,ay) within this container's box, outside the flow, drawn on top
  for (const ch of over) { const r = layoutNode(ch, x + (ch.ax || 0), y + (ch.ay || 0), ch.w || innerW); draws.push(...r.draws); }
  return { draws, h };
}

// pure layout over an INLINE tree (children are specs, not κ) — for conformance/testing without resolve.
export function layoutScene(rootSpec) {
  const norm = (s) => { const n = normNode(s); if (n.kind === "container" || n.kind === "button") n.children = n.children.map(norm); return n; };
  return layoutNode(norm(rootSpec), 0, 0, normNode(rootSpec).w);
}

// hit-index: laid-out leaf boxes keyed by κ — pointer (px,py) → the κ of the hit surface. O(n), no GPU readback.
export function buildHitIndex(draws) { const interactive = (k) => k === "button" || k === "input"; return draws.filter((d) => d.node && (d.node.__k || (interactive(d.node.kind) && d.node.action))).map((d) => ({ kappa: d.node.__k || null, kind: d.node.kind, box: d.box, action: d.node.action || null, node: interactive(d.node.kind) ? d.node : undefined })); }
export function hitTest(index, px, py) { for (let i = index.length - 1; i >= 0; i--) { const [x, y, w, h] = index[i].box; if (px >= x && px <= x + w && py >= y && py <= y + h) return index[i]; } return null; }

export const SCENE_WGSL = `
struct U { res: vec2f, box: vec4f, radius: f32, accentH: f32, hasTex: f32, _p: f32, fill: vec4f, accent: vec4f };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;
struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VO {
  var q = array<vec2f,4>(vec2f(0.0,0.0), vec2f(1.0,0.0), vec2f(0.0,1.0), vec2f(1.0,1.0));
  let uv = q[i];
  let px = u.box.xy + uv * u.box.zw;
  var o: VO; o.pos = vec4f(px.x / u.res.x * 2.0 - 1.0, 1.0 - px.y / u.res.y * 2.0, 0.0, 1.0); o.uv = uv; return o;
}
fn sdRoundRect(p: vec2f, b: vec2f, r: f32) -> f32 { let q = abs(p) - b + vec2f(r); return min(max(q.x,q.y),0.0) + length(max(q, vec2f(0.0))) - r; }
@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let halfb = u.box.zw * 0.5;
  let lp = uv * u.box.zw - halfb;
  let d = sdRoundRect(lp, halfb - vec2f(1.0), u.radius);
  let aa = 1.0 - smoothstep(-1.0, 1.0, d);
  let band = step(uv.y * u.box.w, u.accentH);
  var c = mix(u.fill, u.accent, band * u.accentH);             // accent band only when accentH>0
  if (u.hasTex > 0.5) { let t = textureSample(tex, smp, uv); c = vec4f(mix(c.rgb, t.rgb, t.a), max(c.a, t.a)); }
  return c * aa;
}`;

function scenePipeline(device, format) {
  return memo(["holo:scene-pipeline", memoKey(SCENE_WGSL), format], () => {
    const module = device.createShaderModule({ code: SCENE_WGSL });
    return device.createRenderPipeline({ layout: "auto", vertex: { module, entryPoint: "vs" }, fragment: { module, entryPoint: "fs", targets: [{ format }] }, primitive: { topology: "triangle-strip" } });
  }, { persist: false });
}

let _blankTexP = new WeakMap();
async function blankTex(device) { if (!_blankTexP.has(device)) _blankTexP.set(device, handle(["holo:blank-tex/v1"], { buildSource: () => packTex(1, 1, null), hydrate: (b) => { const dv = new DataView(b.buffer, b.byteOffset, 8); const w = dv.getUint32(0, true), h = dv.getUint32(4, true); const t = device.createTexture({ size: [w, h], format: "rgba8unorm", usage: 0x4 | 0x2 }); device.queue.writeTexture({ texture: t }, b.subarray(8), { bytesPerRow: w * 4, rowsPerImage: h }, { width: w, height: h }); return { view: t.createView() }; } })); return _blankTexP.get(device); }

async function nodeTexture(device, d, ctx) {
  if (d.kind === "image" && d.node.src && ctx && typeof ctx.resolve === "function") {
    // image: TWO-LAYER — L2 source = the encoded image κ bytes (L5-verified before decode); hydrate =
    // decode (createImageBitmap) + upload. Reload re-decodes from L2 bytes, never refetches unverified.
    const src = d.node.src, w = Math.round(d.box[2]), h = Math.round(d.box[3]);
    return handle(["holo:image/v1", src, w, h], {
      buildSource: async () => { const b = await ctx.resolve(src); const u = b instanceof Uint8Array ? b : new Uint8Array(b); if (typeof ctx.verify === "function" && !(await ctx.verify(src, u))) throw new Error("L5 REFUSED: image κ did not re-derive"); return u; },
      hydrate: async (bytes) => { const bmp = await createImageBitmap(new Blob([bytes])); const t = device.createTexture({ size: [w, h], format: "rgba8unorm", usage: 0x4 | 0x2 | 0x10 /*TEXTURE_BINDING|COPY_DST|RENDER_ATTACHMENT*/ }); device.queue.copyExternalImageToTexture({ source: bmp }, { texture: t }, [w, h]); return { view: t.createView() }; },
    });
  }
  if (d.kind !== "text") return blankTex(device);
  const n = d.node, w = Math.round(d.box[2]), h = Math.round(d.box[3]);
  const s = { ...n, w, h, accentH: 0 };
  return handle(["holo:text/v1", n.text, w, h, n.textColor.join(","), n.textSize, n.pad, n.align || "left"], {
    buildSource: () => buildTextBytes(s),
    hydrate: (b) => { const dv = new DataView(b.buffer, b.byteOffset, 8); const tw = dv.getUint32(0, true), th = dv.getUint32(4, true); const t = device.createTexture({ size: [tw, th], format: "rgba8unorm", usage: 0x4 | 0x2 }); device.queue.writeTexture({ texture: t }, b.subarray(8), { bytesPerRow: tw * 4, rowsPerImage: th }, { width: tw, height: th }); return { view: t.createView() }; },
  });
}

// render a composed scene to a <canvas>: resolve tree (L5) → layout → one draw per node (positioned quad).
export async function renderSceneGPU(canvas, rootSpec, ctx = {}) {
  const inj = ctx;
  const device = inj.device || await getDevice();
  const format = inj.format || (typeof navigator !== "undefined" && navigator.gpu ? navigator.gpu.getPreferredCanvasFormat() : "bgra8unorm");
  const context = inj.context || canvas.getContext("webgpu");
  const tree = await resolveTree(rootSpec, ctx);
  const root = normNode(rootSpec);
  const W = root.w, { draws, h } = layoutNode(tree, 0, 0, W); const H = root.h || h;
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  if (context.configure) context.configure({ device, format, alphaMode: "premultiplied" });
  const pipeline = await scenePipeline(device, format);
  const sampler = inj.sampler || getSampler(device);
  // PREBUILD every node's bind group (the only awaits — node textures) BEFORE acquiring the swap-chain texture.
  // getCurrentTexture() returns a texture valid only until the next await / frame; an await between it and
  // submit() lets the compositor reclaim it → "Destroyed texture … used in a submit" (Chrome D3D WebGPU).
  // So: do all awaits first, then acquire + encode + submit with NO awaits in between.
  const binds = [];
  for (const d of draws) {
    const n = d.node;
    const fill = d.kind === "container" ? (n.fill || [0, 0, 0, 0]) : [0, 0, 0, 0];
    const accent = d.kind === "container" && n.accent ? n.accent : [0, 0, 0, 0];
    const radius = d.kind === "image" ? n.radius : (d.kind === "container" ? n.radius : 0);
    const accentH = d.kind === "container" ? n.accentH : 0;
    const hasTex = (d.kind === "text" || d.kind === "image") ? 1 : 0;
    const tx = await nodeTexture(device, d, ctx);
    const data = new Float32Array(20);
    data[0] = W; data[1] = H; data[4] = d.box[0]; data[5] = d.box[1]; data[6] = d.box[2]; data[7] = d.box[3];
    data[8] = radius; data[9] = accentH; data[10] = hasTex; data.set(fill, 12); data.set(accent, 16);
    const ubo = device.createBuffer({ size: data.byteLength, usage: 0x40 | 0x8 });
    device.queue.writeBuffer(ubo, 0, data);
    binds.push(device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: tx.view }, { binding: 2, resource: sampler }] }));
  }
  const view = inj.view || context.getCurrentTexture().createView();
  const enc = device.createCommandEncoder();
  const pass = enc.beginRenderPass({ colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }] });
  pass.setPipeline(pipeline);
  for (const bind of binds) { pass.setBindGroup(0, bind); pass.draw(4); }
  pass.end(); device.queue.submit([enc.finish()]);
  if (ctx.actions) mountInteractiveProxies(canvas, draws, ctx);   // DOM-mirror <button>/<input> proxies: real input/click/keyboard/focus/ARIA
  return { backend: "gpu", nodes: draws.length, w: W, h: H, hitIndex: buildHitIndex(draws) };
}

// ── interaction: a node's declarative κ-action, mediated by the conscience gate (P7), no inline code ──
// `actionId` overrides node.action (e.g. an input's `submit` id); defaults to node.action.
export function dispatchAction(node, ev, ctx = {}, actionId) {
  if (!node || node.disabled) return;
  const id = actionId || node.action; if (!id) return;
  const gate = ctx.gate || (typeof window !== "undefined" && window.HoloConscience && window.HoloConscience.allow);
  if (typeof gate === "function" && gate(id, node) === false) return;   // fail-closed (P7)
  const fn = ctx.actions && ctx.actions[id];
  if (typeof fn === "function") fn(node, ev);   // app-registered handler addressed by id — the substrate runs NO inline code (L4/L5)
}
// GPU path: overlay REAL DOM proxies at each interactive node's box. button → transparent <button> (GPU draws
// the label); input → a real editable <input>/<textarea> with visible text (text entry/IME/caret are DOM-only).
function mountInteractiveProxies(canvas, draws, ctx) {
  const host = canvas.parentElement; if (!host || typeof document === "undefined") return;
  host.querySelectorAll(":scope > .holo-btn-proxy, :scope > .holo-input-proxy").forEach((n) => n.remove());
  if (getComputedStyle(host).position === "static") host.style.position = "relative";
  // position proxies in PERCENT of the canvas's intrinsic size so they track the canvas even when it is
  // CSS-scaled (fluid grids, responsive cards) — the canvas fills the host, so % over the host == over the canvas.
  const W = canvas.width || 1, H = canvas.height || 1;
  const pc = (v, t) => (v / t * 100) + "%";
  for (const d of draws) {
    const n = d.node; if (!n) continue;
    const [x, y, w, h] = d.box;
    if (n.kind === "button") {
      const b = document.createElement("button"); b.className = "holo-btn-proxy";
      b.style.cssText = `position:absolute;left:${pc(x, W)};top:${pc(y, H)};width:${pc(w, W)};height:${pc(h, H)};margin:0;padding:0;border:0;background:transparent;color:transparent;cursor:${n.disabled ? "default" : "pointer"};font:inherit;outline-offset:-2px`;
      b.setAttribute("aria-label", n.aria || n.label || "button");
      if (n.toggleable) b.setAttribute("aria-pressed", n.toggled ? "true" : "false");
      if (n.disabled) { b.disabled = true; b.setAttribute("aria-disabled", "true"); }
      b.addEventListener("click", (ev) => dispatchAction(n, ev, ctx));
      host.appendChild(b);
    } else if (n.kind === "input") {
      const e = document.createElement(n.multiline ? "textarea" : "input"); e.className = "holo-input-proxy";
      e.style.cssText = `position:absolute;left:${pc(x, W)};top:${pc(y, H)};width:${pc(w, W)};height:${pc(h, H)};margin:0;padding:${n.pad}px;border:0;border-radius:${n.radius}px;background:transparent;color:${rgba(n.textColor)};font:${n.textSize}px system-ui,sans-serif;box-sizing:border-box;outline:none;resize:none`;
      e.value = n.value; if (n.placeholder) e.placeholder = n.placeholder; if (n.name) e.name = n.name;
      e.setAttribute("aria-label", n.aria); if (n.disabled) { e.disabled = true; e.setAttribute("aria-disabled", "true"); }
      e.addEventListener("input", (ev) => dispatchAction(n, ev, ctx));
      if (!n.multiline) e.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); dispatchAction(n, ev, ctx, n.submit); } });
      host.appendChild(e);
    }
  }
}

// DOM reference / SEMANTICS mirror: nested divs (also the a11y + input layer). Truth the GPU must match.
export async function renderSceneDOM(target, rootSpec, ctx = {}, doc = (typeof document !== "undefined" ? document : null)) {
  if (!doc) throw new Error("renderSceneDOM needs a document");
  const tree = await resolveTree(rootSpec, ctx);
  const build = (n) => {
    if (n.kind === "text") { const e = doc.createElement("div"); e.textContent = n.text; Object.assign(e.style, { padding: n.pad + "px", color: rgba(n.textColor), font: `${n.textSize}px system-ui, sans-serif`, whiteSpace: "pre-wrap" }); if (n.__k) e.setAttribute("data-holo-kappa", n.__k); return e; }
    if (n.kind === "image") { const e = doc.createElement("div"); Object.assign(e.style, { width: n.w + "px", height: n.h + "px", borderRadius: n.radius + "px", background: "#234" }); return e; }
    if (n.kind === "button") {
      const e = doc.createElement("button");
      Object.assign(e.style, { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: n.gap + "px", padding: `0 ${n.pad}px`, height: n.h + "px", minWidth: n.w + "px", border: "0", borderRadius: n.radius + "px", background: n.fill ? rgba(n.fill) : "transparent", color: rgba(n.textColor || [0.92, 0.94, 0.98, 1]), font: `600 ${n.textSize}px system-ui, sans-serif`, cursor: n.disabled ? "default" : "pointer", whiteSpace: "nowrap", boxSizing: "border-box" });
      e.setAttribute("data-holo-surface", "button"); if (n.__k) e.setAttribute("data-holo-kappa", n.__k);
      if (n.aria) e.setAttribute("aria-label", n.aria);
      if (n.toggleable) e.setAttribute("aria-pressed", n.toggled ? "true" : "false");
      if (n.disabled) { e.disabled = true; e.setAttribute("aria-disabled", "true"); }
      if (n.label != null && !n.children.length) e.textContent = n.label; else for (const ch of n.children) e.appendChild(build(ch));
      e.addEventListener("click", (ev) => dispatchAction(n, ev, ctx));
      return e;
    }
    if (n.kind === "input") {
      const e = doc.createElement(n.multiline ? "textarea" : "input");
      Object.assign(e.style, { width: n.w + "px", height: n.h + "px", padding: n.pad + "px", border: "0", borderRadius: n.radius + "px", background: n.fill ? rgba(n.fill) : "transparent", color: rgba(n.textColor), font: `${n.textSize}px system-ui, sans-serif`, boxSizing: "border-box", outline: "none", resize: "none" });
      e.setAttribute("data-holo-surface", "input"); if (n.__k) e.setAttribute("data-holo-kappa", n.__k);
      e.value = n.value; if (n.placeholder) e.placeholder = n.placeholder; if (n.name) e.name = n.name;
      e.setAttribute("aria-label", n.aria); if (n.disabled) { e.disabled = true; e.setAttribute("aria-disabled", "true"); }
      e.addEventListener("input", (ev) => dispatchAction(n, ev, ctx));
      if (!n.multiline) e.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); dispatchAction(n, ev, ctx, n.submit); } });
      return e;
    }
    const e = doc.createElement("div");
    const hasOverlay = n.children.some((c) => c.abs);
    Object.assign(e.style, { position: hasOverlay ? "relative" : "static", display: n.layout === "grid" ? "grid" : "flex", flexDirection: n.layout === "row" ? "row" : "column", gap: n.gap + "px", padding: n.pad + "px", width: n.w + "px", boxSizing: "border-box", borderRadius: n.radius + "px", ...(n.layout === "grid" ? { gridTemplateColumns: `repeat(${n.cols},1fr)` } : {}), ...(n.fill ? { background: rgba(n.fill) } : {}) });
    e.setAttribute("data-holo-surface", "container"); if (n.__k) e.setAttribute("data-holo-kappa", n.__k);
    for (const ch of n.children) { const ce = build(ch); if (ch.abs) Object.assign(ce.style, { position: "absolute", left: (ch.ax || 0) + "px", top: (ch.ay || 0) + "px" }); e.appendChild(ce); }
    return e;
  };
  const el = build(tree); target.replaceChildren(el); return { backend: "dom", el };
}

// ── the one entry: dispatch by capability; GPU draws into a <canvas>, DOM into the target ──────────
export async function renderSurface(target, input, ctx = {}) {
  const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
  const el = typeof target === "string" ? document.querySelector(target) : target;
  const spec = await specOf(input, ctx);
  // SPATIAL: "enter 3D" — the same κ-surface scene, projected into space via the vendored κ-native
  // three-mesh-ui. Apps opt in with ctx.spatial; three.js + three-mesh-ui auto-load (κ-verified) once.
  if (ctx.spatial) {
    const xr = await import("./holo-xr.mjs");
    const lib = (ctx.THREE && ctx.ThreeMeshUI) ? ctx : await xr.ensureThree(ctx);
    const canvas = (el.tagName === "CANVAS") ? el : (() => { const c = document.createElement("canvas"); c.width = ctx.w || 680; c.height = ctx.h || 420; el.replaceChildren(c); return c; })();
    const sctx = { ...ctx, THREE: lib.THREE, ThreeMeshUI: lib.ThreeMeshUI, font: ctx.font || "/_shared/vendor/three-mesh-ui/Roboto-msdf.json", tex: ctx.tex || "/_shared/vendor/three-mesh-ui/Roboto-msdf.png" };
    const sp = await xr.renderSpatial(canvas, spec, sctx);
    return { backend: "spatial", renderer: sp.renderer, scene: sp.scene, camera: sp.camera, root: sp.root, pick: sp.pick, enter: sp.enter, ms: +(((typeof performance !== "undefined" ? performance.now() : Date.now())) - t0).toFixed(3) };
  }
  const backend = pickBackend(ctx);
  const isScene = spec && (spec.kind === "container" || spec.kind === "button" || spec.kind === "input" || Array.isArray(spec.children));   // a composed scene (incl. a bare interactive root)
  let out;
  if (backend === "gpu") {
    try {
      const canvas = (el.tagName === "CANVAS") ? el : (() => { const c = document.createElement("canvas"); el.replaceChildren(c); return c; })();
      out = isScene ? await renderSceneGPU(canvas, spec, ctx) : await renderCardGPU(canvas, spec, ctx);
    } catch (e) { out = { ...(isScene ? await renderSceneDOM(el, spec, ctx) : renderCardDOM(el, spec)), backend: "dom", fellBack: String(e && e.message || e) }; }
  } else {
    out = isScene ? await renderSceneDOM(el, spec, ctx) : renderCardDOM(el, spec);
  }
  const t1 = (typeof performance !== "undefined" ? performance.now() : Date.now());
  return { ...out, ms: +(t1 - t0).toFixed(3) };
}

export const HoloSurface = { renderSurface, renderCardGPU, renderCardDOM, renderSceneGPU, renderSceneDOM, pickBackend, specOf, normCard, normNode, layoutScene, buildHitIndex, hitTest, dispatchAction, cardStyle, CARD_WGSL, SCENE_WGSL };
export default HoloSurface;
