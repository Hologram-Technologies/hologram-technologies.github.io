// holo-playground-shatter.mjs — Holo Playground 3.0, Stage 2 (Track D): shatter a text block into independent
// word particles so a tornado can blow a paragraph apart word by word. The crux is measuring each word WITHOUT a
// DOM layout pass per frame (hundreds of fragments would thrash reflow), which is exactly what chenglou/pretext
// (github.com/chenglou/pretext) is built for: a DOM-free measure/layout via canvas + pure arithmetic.
//
// PRETEXT EVALUATION (honest, per the ADR-0110 mandate). pretext's value is COMPREHENSIVE text correctness — bidi,
// i18n segmentation, full line-breaking rules — shipped as its own toolchain. Our need is narrow: the x/y offset
// of each whitespace-split word in one element's font, measured once, off the layout path. Vendoring the whole
// library (its own build) is not justified by that single use, so we take pretext's CORE IDEA — DOM-free canvas
// measurement, pure-arithmetic layout — as a minimal shim (the sanctioned fallback). `layoutWords` is pure and
// isomorphic (the metric fn is injected: a real canvas 2d measureText in the browser, a deterministic stub in the
// Node witness), so the word geometry is witnessed with no browser. If richer scripts ever need true shaping, this
// is the seam to swap in vendored pretext behind the same `measure` interface.
//
// EPHEMERAL by the L5 play rule: shatter builds a [data-holo-ephemeral] shard layer (stripped by serialize, never
// sealed) and hides the original ONLY for the duration of a force; the engine reassembles (layer removed, original
// restored) before any Freeze/Reset, so the κ never sees a transient shard or a hidden original.

// ── pure word geometry — pretext's core idea (measure once, lay out by arithmetic), scoped to word offsets. ──
export function splitWords(text) { return String(text || "").split(/\s+/).filter((w) => w.length); }

// lay words left-to-right, wrapping when the next word would exceed maxWidth. `measure(str)->px` is injected.
// Returns [{ word, x, y, w }] — x/y are offsets within the element's box; pure, no DOM.
export function layoutWords(words, measure, maxWidth = 0, lineHeight = 0) {
  const space = measure(" ") || 0;
  const lh = lineHeight || 0;
  let x = 0, y = 0; const boxes = [];
  for (const word of words) {
    const w = measure(word) || 0;
    if (maxWidth && x > 0 && x + w > maxWidth) { x = 0; y += lh; }   // wrap
    boxes.push({ word, x, y, w });
    x += w + space;
  }
  return boxes;
}

// ── createShatter — browser-only. No-op stubs without a document, so it never runs in the witness. ──────────
export function createShatter({ doc, win } = {}) {
  if (!doc || typeof doc.createElement !== "function") return { shatter: () => null, reassemble: () => {} };
  win = win || doc.defaultView || null;
  let canvas = null;
  const ctxFor = (font) => { if (!canvas) canvas = doc.createElement("canvas"); const c = canvas.getContext("2d"); c.font = font; return c; };

  function shatter(el) {
    try {
      const words = splitWords(el.textContent); if (words.length < 2) return null;
      const cs = win.getComputedStyle(el);
      const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize}/${cs.lineHeight} ${cs.fontFamily}`;
      const ctx = ctxFor(font);
      const r = el.getBoundingClientRect();
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3 || 20;
      const boxes = layoutWords(words, (s) => ctx.measureText(s).width, r.width, lh);
      const layer = doc.createElement("div");
      layer.className = "holo-pg-shards"; layer.setAttribute("data-holo-ephemeral", "");
      layer.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;` +
        `z-index:2147483599;pointer-events:none;font:${font};color:${cs.color};will-change:transform`;
      for (const b of boxes) {
        const s = doc.createElement("span");
        s.textContent = b.word;
        s.style.cssText = `position:absolute;left:${b.x}px;top:${b.y}px;white-space:pre`;
        layer.appendChild(s);
      }
      (doc.body || doc.documentElement).appendChild(layer);
      const vis0 = el.style ? el.style.visibility : "";       // hide the original only while it's shattered
      if (el.style) el.style.visibility = "hidden";
      return { el, layer, vis0 };
    } catch (e) { return null; }
  }
  function reassemble(h) {
    try { if (!h) return; if (h.layer && h.layer.remove) h.layer.remove(); if (h.el && h.el.style) h.el.style.visibility = h.vis0 || ""; } catch (e) {}
  }
  return { shatter, reassemble };
}

export default { splitWords, layoutWords, createShatter };
