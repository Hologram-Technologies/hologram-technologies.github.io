// holo-q-vision-capture.mjs — THE RASTER-ISLAND SOURCE (browser tier). The ambient watcher promotes
// islands; SOMETHING must notice them. This is that something for the part the web tier can reach with
// no native host: same-origin <canvas>, <img>, <video> (current frame), <svg>/<object>/<embed> — the
// on-screen surfaces the renderer could NOT κ-stamp because their content is raw pixels, not a κ-graph.
//
// PRECEDENCE BAKED IN: any surface that already carries a κ (data-holo-k / a render-κ) is skipped — it
// is already in the graph and must never be OCR'd (the regression guard). Cross-origin <iframe> pixels
// are NOT reachable here (the browser forbids reading them); those are the NATIVE leg (CDP screenshot).
//
// FACTORED FOR WITNESS: the pure core (which surfaces are raster islands, dedup, κ-skip) is separated
// from the browser-only edge (querySelectorAll, getBoundingClientRect, canvas rasterization, observers),
// which is injected. So the decision logic is provable in pure Node with a fake surface list.

export const RASTER_TAGS = ["canvas", "img", "video", "picture", "svg", "object", "embed"];

// classifySurface(surface, { hasKappa }) — PURE. surface: { tag, id, kappa?, w?, h?, crossOrigin? }.
// → { island } to promote, { skip } with a reason, or null when it is not a raster surface at all.
export function classifySurface(surface = {}, { hasKappa = null } = {}) {
  const tag = String(surface.tag || "").toLowerCase();
  if (!RASTER_TAGS.includes(tag)) return null;
  if (surface.kappa || (hasKappa && hasKappa(surface))) return { skip: "kappa-native" };   // ← precedence
  if (surface.crossOrigin === true && tag !== "video") return { skip: "cross-origin-pixels-unreadable" }; // needs the native CDP leg
  if ((surface.w != null && surface.w < 1) || (surface.h != null && surface.h < 1)) return { skip: "zero-area" };
  return { island: { id: surface.id, tag, kind: "raster", rect: surface.rect || null, hint: surface.hint || tag } };
}

// planScan(surfaces, opts) — PURE. Classify a whole surface list; return the islands to rasterize plus a
// tally of what was skipped and why. Dedups by id (one island per surface this pass).
export function planScan(surfaces = [], opts = {}) {
  const islands = [], skipped = [], seenId = new Set();
  for (const s of surfaces) {
    const c = classifySurface(s, opts);
    if (!c) continue;
    if (c.skip) { skipped.push({ id: s.id, reason: c.skip }); continue; }
    if (seenId.has(c.island.id)) continue;
    seenId.add(c.island.id);
    islands.push(c.island);
  }
  return { islands, skipped };
}

// createCapture(deps) — the live source. Calls notice(island) for each non-κ raster surface, attaching
// the rasterized pixels. Everything browser-only is injected so the core stays pure/witnessable:
//   notice     — the ambient watcher's notice(island) (the only output)
//   enumerate  — (root) => surfaces[]            (querySelectorAll over RASTER_TAGS + rect + κ read)
//   rasterize  — async (island) => pixels|null   (canvas.toDataURL / drawImage; null if unreadable)
//   hasKappa   — (surface) => bool               (does the element carry a render-κ?)
export function createCapture({ notice, enumerate, rasterize, hasKappa = null } = {}) {
  if (typeof notice !== "function") throw new Error("holo-q-vision-capture: notice is required");
  if (typeof rasterize !== "function") throw new Error("holo-q-vision-capture: rasterize is required");
  const stats = { scans: 0, noticed: 0, skipped: 0, unreadable: 0 };

  // scan(root) — one pass: enumerate → plan → rasterize the islands → notice them. Returns the plan.
  async function scan(root) {
    stats.scans++;
    const surfaces = enumerate ? enumerate(root) : (Array.isArray(root) ? root : []);
    const plan = planScan(surfaces, { hasKappa });
    stats.skipped += plan.skipped.length;
    for (const island of plan.islands) {
      const pixels = await rasterize(island);
      if (pixels == null) { stats.unreadable++; continue; }            // honest: can't read → don't fake
      stats.noticed++;
      await notice({ ...island, pixels });
    }
    return plan;
  }

  return { scan, stats: () => ({ ...stats }) };
}

// browser binding: build a capture wired to the live ambient watcher + the DOM. The actual DOM/canvas
// adapters are defined here (the browser-only edge); fail-soft if the watcher is not up yet.
if (typeof window !== "undefined") {
  const enumerate = (root) => {
    const doc = root || document;
    const out = [];
    try {
      for (const el of doc.querySelectorAll(RASTER_TAGS.join(","))) {
        const r = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: el.width, height: el.height, left: 0, top: 0 };
        const kappa = el.getAttribute && (el.getAttribute("data-holo-k") || el.getAttribute("data-kappa"));
        out.push({
          tag: el.tagName.toLowerCase(),
          id: el.id || (el.getAttribute && el.getAttribute("data-holo-id")) || `${el.tagName.toLowerCase()}@${Math.round(r.left)},${Math.round(r.top)}`,
          kappa: kappa || null,
          crossOrigin: !!(el.src && (() => { try { return new URL(el.src, location.href).origin !== location.origin; } catch { return false; } })()),
          w: r.width, h: r.height, rect: { x: r.left, y: r.top, w: r.width, h: r.height },
        });
      }
    } catch {}
    return out;
  };
  const rasterize = async (island) => {
    try {
      const el = document.getElementById(island.id);
      if (!el) return null;
      const w = el.naturalWidth || el.videoWidth || el.width || (island.rect && island.rect.w) || 0;
      const h = el.naturalHeight || el.videoHeight || el.height || (island.rect && island.rect.h) || 0;
      if (!w || !h) return null;
      if (el.tagName.toLowerCase() === "canvas") return new Uint8Array(await (await fetch(el.toDataURL("image/png"))).arrayBuffer());
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(el, 0, 0, w, h);                    // throws (tainted) for cross-origin → caught → null
      return new Uint8Array(await (await fetch(c.toDataURL("image/png"))).arrayBuffer());
    } catch { return null; }                                          // unreadable pixels → honest null, never fake
  };
  window.HoloVisionCapture = {
    createCapture, planScan, classifySurface, RASTER_TAGS,
    attach(noticeFn) { return createCapture({ notice: noticeFn, enumerate, rasterize }); },
  };
}

export default { createCapture, planScan, classifySurface, RASTER_TAGS };
