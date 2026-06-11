// holo-capture.js — the engine core for Holo Capture (Flameshot, hologram-native).
//
// Drop-in classic script:  <script src="_shared/holo-capture.js"></script>  → window.HoloCapture
// Also self-exposes in a Web Worker (self.HoloCapture) and in Node (module.exports), so the
// SAME pure model + renderer drives the page, the OffscreenCanvas compute worker, and the
// witness — one source of truth, no drift.
//
// Faithful to Flameshot's source of truth — the CaptureTool enum in
// src/tools/capturetool.h (TYPE_PENCIL, TYPE_DRAWER, TYPE_ARROW, TYPE_SELECTION,
// TYPE_RECTANGLE, TYPE_CIRCLE, TYPE_MARKER, TYPE_TEXT, TYPE_PIXELATE, TYPE_MOVESELECTION,
// TYPE_CIRCLECOUNT and the action tools UNDO/REDO/COPY/SAVE/EXIT/IMAGEUPLOADER/OPEN_APP/
// PIN/SIZEINCREASE/SIZEDECREASE/INVERT/ACCEPT/CANCEL). Each draw tool maps to one vector
// annotation; the document is content-addressed.
//
// UOR-native (the five laws):
//   • a capture's identity is its CONTENT — κ = H(canonical bytes), not a filename (Law 1/2).
//   • the annotation DOCUMENT (.holocap) canonicalizes to stable bytes → its own κ (Law 2).
//   • render/encode/hash re-derive deterministically, so a saved capture VERIFIES by
//     re-derivation against its κ (Law 5).
// No DOM/canvas is touched at import — render() is the only browser-only entry point — so
// the model is pure and runs anywhere (page · worker · Node witness).

(function () {
  "use strict";

  // ── tools: faithful map of Flameshot's CaptureTool enum → our annotation kinds ──────
  // `key` is Flameshot's default single-letter GUI shortcut. `kind` groups how the tool
  // is drawn. The action tools (no draw) carry kind:"action".
  const TOOLS = [
    { id: "pencil",    flameshot: "TYPE_PENCIL",        key: "p", kind: "path",   label: "Pencil",    hint: "Freehand pencil" },
    { id: "line",      flameshot: "TYPE_DRAWER",        key: "d", kind: "line",   label: "Line",      hint: "Straight line" },
    { id: "arrow",     flameshot: "TYPE_ARROW",         key: "a", kind: "arrow",  label: "Arrow",     hint: "Arrow" },
    { id: "rectangle", flameshot: "TYPE_RECTANGLE",     key: "r", kind: "rect",   label: "Rectangle", hint: "Rectangle (Invert toggles fill)" },
    { id: "circle",    flameshot: "TYPE_CIRCLE",        key: "c", kind: "ellipse",label: "Circle",    hint: "Ellipse (Invert toggles fill)" },
    { id: "marker",    flameshot: "TYPE_MARKER",        key: "m", kind: "marker", label: "Marker",    hint: "Highlighter" },
    { id: "text",      flameshot: "TYPE_TEXT",          key: "t", kind: "text",   label: "Text",      hint: "Add text" },
    { id: "pixelate",  flameshot: "TYPE_PIXELATE",      key: "b", kind: "obscure",label: "Pixelate",  hint: "Pixelate / blur a region" },
    { id: "counter",   flameshot: "TYPE_CIRCLECOUNT",   key: "n", kind: "counter",label: "Counter",   hint: "Numbered step bubble" },
    { id: "move",      flameshot: "TYPE_MOVESELECTION", key: "",  kind: "select", label: "Move",      hint: "Select & move items" },
    { id: "selection", flameshot: "TYPE_SELECTION",     key: "s", kind: "region", label: "Selection", hint: "Adjust the capture region" },
  ];
  // The action (non-drawing) tools — also part of the enum; the toolbar exposes them.
  const ACTIONS = [
    { id: "undo",   flameshot: "TYPE_UNDO",          combo: "Ctrl+Z",       label: "Undo" },
    { id: "redo",   flameshot: "TYPE_REDO",          combo: "Ctrl+Shift+Z", label: "Redo" },
    { id: "copy",   flameshot: "TYPE_COPY",          combo: "Ctrl+C",       label: "Copy" },
    { id: "save",   flameshot: "TYPE_SAVE",          combo: "Ctrl+S",       label: "Save" },
    { id: "upload", flameshot: "TYPE_IMAGEUPLOADER", combo: "Ctrl+U",       label: "Share (holo://κ)" },
    { id: "openapp",flameshot: "TYPE_OPEN_APP",      combo: "Ctrl+O",       label: "Open in…" },
    { id: "pin",    flameshot: "TYPE_PIN",           combo: "",             label: "Pin" },
    { id: "sizeinc",flameshot: "TYPE_SIZEINCREASE",  combo: "",             label: "Thicker" },
    { id: "sizedec",flameshot: "TYPE_SIZEDECREASE",  combo: "",             label: "Thinner" },
    { id: "invert", flameshot: "TYPE_INVERT",        combo: "",             label: "Toggle fill" },
    { id: "accept", flameshot: "TYPE_ACCEPT",        combo: "Enter",        label: "Accept" },
    { id: "cancel", flameshot: "TYPE_CANCEL",        combo: "Esc",          label: "Cancel" },
  ];
  // The complete enum, for the witness to prove parity (no tool dropped).
  const FLAMESHOT_ENUM = [
    "TYPE_PENCIL", "TYPE_DRAWER", "TYPE_ARROW", "TYPE_SELECTION", "TYPE_RECTANGLE",
    "TYPE_CIRCLE", "TYPE_MARKER", "TYPE_MOVESELECTION", "TYPE_UNDO", "TYPE_COPY",
    "TYPE_SAVE", "TYPE_EXIT", "TYPE_IMAGEUPLOADER", "TYPE_OPEN_APP", "TYPE_PIXELATE",
    "TYPE_REDO", "TYPE_PIN", "TYPE_TEXT", "TYPE_CIRCLECOUNT", "TYPE_SIZEINCREASE",
    "TYPE_SIZEDECREASE", "TYPE_INVERT", "TYPE_ACCEPT", "TYPE_CANCEL",
  ];
  // TYPE_EXIT is Cancel-without-accept; we surface it as the `cancel`/Esc action.
  const ENUM_ALIAS = { TYPE_EXIT: "cancel" };

  // Flameshot's default editor palette (its DEFAULT_USER_COLORS), red the default ink.
  const PALETTE = [
    "#ff0000", "#ff8c00", "#ffd700", "#00c853", "#00b0ff",
    "#2962ff", "#aa00ff", "#000000", "#5f6368", "#ffffff",
  ];
  const DEFAULTS = { tool: "rectangle", color: "#ff0000", thickness: 3, fill: false, opacity: 1, fontSize: 18, obscure: "pixelate", pixel: 9, blur: 8 };
  const THICKNESS_MIN = 1, THICKNESS_MAX = 50;

  const byId = (id) => TOOLS.find((t) => t.id === id) || ACTIONS.find((a) => a.id === id) || null;
  const toolForKey = (k) => { k = String(k || "").toLowerCase(); return TOOLS.find((t) => t.key && t.key === k) || null; };

  // ── the document — an image plus an ordered list of vector annotations ──────────────
  // image is referenced by ITS κ (content, not bytes) so the doc stays small and itself
  // content-addresses cleanly; the page holds the pixels.
  function createDoc(opts) {
    opts = opts || {};
    return {
      v: 1,
      w: opts.w | 0, h: opts.h | 0,
      image: opts.image || "",            // κ of the captured image (Law 1)
      region: opts.region || null,        // {x,y,w,h} selection within the image, or null = full
      items: [],
      _undo: [], _redo: [],               // history (not serialized)
      _counter: 0,
    };
  }
  // an annotation item; only the fields a kind needs are kept (canonical form is minimal)
  function makeItem(tool, props) {
    const t = byId(tool); const kind = (t && t.kind) || "rect";
    const it = { tool, kind, color: props.color ?? DEFAULTS.color, thickness: props.thickness ?? DEFAULTS.thickness };
    if (kind === "path" || kind === "marker") it.points = (props.points || []).map((p) => ({ x: r1(p.x), y: r1(p.y) }));
    if (kind === "line" || kind === "arrow" || kind === "rect" || kind === "ellipse" || kind === "obscure") {
      it.a = pt(props.a); it.b = pt(props.b);
    }
    if (kind === "rect" || kind === "ellipse") it.fill = !!props.fill;
    if (kind === "marker") { it.thickness = props.thickness ?? 14; it.opacity = props.opacity ?? 0.35; }
    if (kind === "obscure") { it.mode = props.mode || DEFAULTS.obscure; it.strength = props.strength ?? (it.mode === "blur" ? DEFAULTS.blur : DEFAULTS.pixel); }
    if (kind === "text") { it.a = pt(props.a); it.text = String(props.text || ""); it.fontSize = props.fontSize ?? DEFAULTS.fontSize; }
    if (kind === "counter") { it.a = pt(props.a); it.number = props.number | 0; it.radius = props.radius ?? 14; }
    return it;
  }
  const pt = (p) => (p ? { x: r1(p.x), y: r1(p.y) } : { x: 0, y: 0 });
  const r1 = (n) => Math.round((+n || 0) * 10) / 10;   // 0.1px canonical precision (stable κ)

  // mutate-with-history so undo/redo are exact (Flameshot's TYPE_UNDO/TYPE_REDO)
  function commit(doc, item) { doc._undo.push(snapshot(doc)); doc._redo.length = 0; doc.items.push(item); return item; }
  function nextCounter(doc) { return ++doc._counter; }
  function snapshot(doc) { return JSON.stringify(doc.items); }
  function undo(doc) { if (!doc._undo.length) return false; doc._redo.push(snapshot(doc)); doc.items = JSON.parse(doc._undo.pop()); resyncCounter(doc); return true; }
  function redo(doc) { if (!doc._redo.length) return false; doc._undo.push(snapshot(doc)); doc.items = JSON.parse(doc._redo.pop()); resyncCounter(doc); return true; }
  function resyncCounter(doc) { let m = 0; for (const it of doc.items) if (it.kind === "counter") m = Math.max(m, it.number | 0); doc._counter = m; }
  function clear(doc) { if (!doc.items.length) return false; doc._undo.push(snapshot(doc)); doc._redo.length = 0; doc.items = []; doc._counter = 0; return true; }
  function removeAt(doc, idx) { if (idx < 0 || idx >= doc.items.length) return false; doc._undo.push(snapshot(doc)); doc._redo.length = 0; doc.items.splice(idx, 1); resyncCounter(doc); return true; }

  // ── canonical form → κ (Law 2/5) ────────────────────────────────────────────────────
  // Deterministic JSON: keys sorted, numbers fixed-precision, no history fields. The same
  // document always serializes to the same bytes on any machine, so it re-derives to a
  // single κ — the `.holocap` content address.
  function canonical(doc) {
    const pub = { v: doc.v || 1, w: doc.w | 0, h: doc.h | 0, image: doc.image || "", region: doc.region || null, items: doc.items };
    return stableStringify(pub);
  }
  function stableStringify(x) {
    if (x === null || typeof x !== "object") return JSON.stringify(x);
    if (Array.isArray(x)) return "[" + x.map(stableStringify).join(",") + "]";
    const keys = Object.keys(x).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(x[k])).join(",") + "}";
  }
  function serialize(doc) { return utf8(canonical(doc)); }
  function deserialize(bytes) {
    const o = JSON.parse(typeof bytes === "string" ? bytes : utf8dec(bytes));
    const doc = createDoc({ w: o.w, h: o.h, image: o.image, region: o.region });
    doc.v = o.v || 1; doc.items = o.items || []; resyncCounter(doc);
    return doc;
  }
  const utf8 = (s) => (typeof TextEncoder !== "undefined" ? new TextEncoder().encode(s) : Uint8Array.from(Buffer.from(s, "utf8")));
  const utf8dec = (b) => (typeof TextDecoder !== "undefined" ? new TextDecoder().decode(b) : Buffer.from(b).toString("utf8"));

  // κ = sha256 of the bytes, axis-prefixed (matches teleport.js / holo-manage). Works in
  // the page, the worker, and Node (globalThis.crypto.subtle on Node ≥ 20).
  async function kappa(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const subtle = (globalThis.crypto && globalThis.crypto.subtle) || null;
    if (subtle) { const d = await subtle.digest("SHA-256", u8); return "sha256:" + hex(new Uint8Array(d)); }
    // Node fallback (no global webcrypto): use node:crypto.
    const { createHash } = require("crypto");
    return "sha256:" + createHash("sha256").update(Buffer.from(u8)).digest("hex");
  }
  const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");

  // ── hit testing (the Move tool — Flameshot TYPE_MOVESELECTION) ──────────────────────
  function bounds(it) {
    if (it.points && it.points.length) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of it.points) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    if (it.a && it.b) return { x: Math.min(it.a.x, it.b.x), y: Math.min(it.a.y, it.b.y), w: Math.abs(it.b.x - it.a.x), h: Math.abs(it.b.y - it.a.y) };
    if (it.a) { const r = it.kind === "counter" ? (it.radius || 14) : (it.fontSize || 18); return { x: it.a.x - r, y: it.a.y - r, w: r * 2, h: r * 2 }; }
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  function hitTest(doc, x, y, pad) {
    pad = pad ?? 6;
    for (let i = doc.items.length - 1; i >= 0; i--) {
      const b = bounds(doc.items[i]);
      if (x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad) return i;
    }
    return -1;
  }
  function translateItem(it, dx, dy) {
    if (it.points) it.points = it.points.map((p) => ({ x: r1(p.x + dx), y: r1(p.y + dy) }));
    if (it.a) it.a = { x: r1(it.a.x + dx), y: r1(it.a.y + dy) };
    if (it.b) it.b = { x: r1(it.b.x + dx), y: r1(it.b.y + dy) };
  }

  // ── render — the ONLY browser-only entry (Canvas2D / OffscreenCanvas) ────────────────
  // Draws the base image (cropped to region) then every annotation, in order. The base
  // pixels for pixelate/blur are sampled from `image`. `preview` is an optional in-flight
  // item drawn on top (live drag). Used identically by the page and the compute worker.
  function render(ctx, doc, image, opts) {
    opts = opts || {};
    const region = doc.region || { x: 0, y: 0, w: doc.w, h: doc.h };
    ctx.save();
    ctx.clearRect(0, 0, region.w, region.h);
    if (image) ctx.drawImage(image, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h);
    const off = { x: region.x, y: region.y };
    const list = opts.preview ? doc.items.concat([opts.preview]) : doc.items;
    for (const it of list) drawItem(ctx, it, image, off, region);
    ctx.restore();
  }
  function drawItem(ctx, it, image, off, region) {
    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = it.color; ctx.fillStyle = it.color; ctx.lineWidth = it.thickness || 3;
    const T = (p) => ({ x: p.x - off.x, y: p.y - off.y });
    switch (it.kind) {
      case "path": {
        const pts = (it.points || []).map(T); if (pts.length < 2) { dot(ctx, pts[0], it.thickness); break; }
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke(); break;
      }
      case "marker": {
        const pts = (it.points || []).map(T); if (!pts.length) break;
        ctx.globalAlpha = it.opacity ?? 0.35; ctx.lineWidth = it.thickness || 14;
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke(); break;
      }
      case "line": { const a = T(it.a), b = T(it.b); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); break; }
      case "arrow": { const a = T(it.a), b = T(it.b); arrow(ctx, a, b, it.thickness || 3); break; }
      case "rect": { const a = T(it.a), b = T(it.b); const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
        if (it.fill) { ctx.globalAlpha = 1; ctx.fillRect(x, y, w, h); } else ctx.strokeRect(x, y, w, h); break; }
      case "ellipse": { const a = T(it.a), b = T(it.b); const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); it.fill ? ctx.fill() : ctx.stroke(); break; }
      case "obscure": obscure(ctx, it, image, off, region); break;
      case "text": { const a = T(it.a); ctx.globalAlpha = 1; ctx.font = `600 ${it.fontSize || 18}px ui-sans-serif,system-ui,sans-serif`;
        ctx.textBaseline = "top"; ctx.fillStyle = it.color; outlineText(ctx, it.text || "", a.x, a.y, it.fontSize || 18); break; }
      case "counter": { const a = T(it.a); counterBubble(ctx, a, it.number, it.color, it.radius || 14); break; }
    }
    ctx.restore();
  }
  function dot(ctx, p, t) { if (!p) return; ctx.beginPath(); ctx.arc(p.x, p.y, (t || 3) / 2, 0, Math.PI * 2); ctx.fill(); }
  function arrow(ctx, a, b, t) {
    const head = Math.max(9, (t || 3) * 3.2), ang = Math.atan2(b.y - a.y, b.x - a.x);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - head * Math.cos(ang - Math.PI / 7), b.y - head * Math.sin(ang - Math.PI / 7));
    ctx.lineTo(b.x - head * Math.cos(ang + Math.PI / 7), b.y - head * Math.sin(ang + Math.PI / 7));
    ctx.closePath(); ctx.fill();
  }
  function outlineText(ctx, text, x, y, size) {
    const lines = String(text).split("\n"); ctx.lineJoin = "round"; ctx.lineWidth = Math.max(2, size / 6); ctx.strokeStyle = "rgba(0,0,0,0.55)";
    lines.forEach((ln, i) => { const yy = y + i * size * 1.25; ctx.strokeText(ln, x, yy); ctx.fillText(ln, x, yy); });
  }
  function counterBubble(ctx, c, n, color, r) {
    ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.globalAlpha = 1; ctx.fill();
    ctx.fillStyle = pickInk(color); ctx.font = `700 ${Math.round(r * 1.2)}px ui-sans-serif,system-ui,sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(n), c.x, c.y + 1);
  }
  // pixelate / blur a region by sampling the underlying image (UOR compute — re-derives)
  function obscure(ctx, it, image, off, region) {
    const a = { x: it.a.x, y: it.a.y }, b = { x: it.b.x, y: it.b.y };
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    if (w < 2 || h < 2 || !image) return;
    const dx = x - off.x, dy = y - off.y;
    if (it.mode === "blur") {
      if (typeof ctx.filter !== "undefined") {
        ctx.save(); ctx.beginPath(); ctx.rect(dx, dy, w, h); ctx.clip();
        ctx.filter = `blur(${it.strength || 8}px)`;
        ctx.drawImage(image, x, y, w, h, dx, dy, w, h);
        ctx.restore(); return;
      }
    }
    // pixelate: down-sample to blocks then scale back up with smoothing off
    const blocks = Math.max(1, Math.floor(Math.min(w, h) / (it.strength || 9)));
    const sw = Math.max(1, blocks), sh = Math.max(1, Math.round(blocks * h / w));
    const tmp = makeCanvas(sw, sh); const tctx = tmp.getContext("2d");
    tctx.imageSmoothingEnabled = true; tctx.drawImage(image, x, y, w, h, 0, 0, sw, sh);
    ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(tmp, 0, 0, sw, sh, dx, dy, w, h); ctx.restore();
  }
  function makeCanvas(w, h) {
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
    const c = document.createElement("canvas"); c.width = w; c.height = h; return c;
  }
  function pickInk(bg) { const c = hexToRgb(bg); if (!c) return "#fff"; const l = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b); return l > 150 ? "#0b0f15" : "#ffffff"; }
  function hexToRgb(h) { const m = /^#?([0-9a-f]{6})$/i.exec(String(h)); if (!m) return null; const n = parseInt(m[1], 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; }

  const clampThick = (t) => Math.max(THICKNESS_MIN, Math.min(THICKNESS_MAX, t | 0));

  const HoloCapture = {
    TOOLS, ACTIONS, FLAMESHOT_ENUM, ENUM_ALIAS, PALETTE, DEFAULTS, THICKNESS_MIN, THICKNESS_MAX,
    byId, toolForKey,
    createDoc, makeItem, commit, undo, redo, clear, removeAt, nextCounter, resyncCounter,
    canonical, stableStringify, serialize, deserialize, kappa,
    bounds, hitTest, translateItem, clampThick,
    render, drawItem, version: 1,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = HoloCapture;
  if (typeof self !== "undefined") self.HoloCapture = HoloCapture;
  if (typeof window !== "undefined") window.HoloCapture = HoloCapture;
})();
