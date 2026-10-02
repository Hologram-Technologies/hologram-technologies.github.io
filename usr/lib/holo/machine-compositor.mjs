// machine-compositor.mjs — the `compositor` machine adapter for mount(κ).
//
// realize(image, params, snapshot, surface) → tile CHILD holospaces into `surface`. This is the machine
// that makes nesting fall out for free: compose is not special, it is just a holospace whose machine is
// `compositor` and whose image is a child set.
//
//   image  = a child, or an array of children. Each child is EITHER
//              • an INLINE manifest (a holospace.v1 object) — its identity is already covered by the
//                PARENT κ, so it realizes directly through the registry (no resolve, warm, zero network); OR
//              • a κ string — resolved + re-derived-or-refused through mount() (Law L5).
//   params = { layout }  (single | split-h | split-v | grid | primary-rail | stack)
//
// A single child fills the surface (no chrome). A child whose machine is itself `compositor` recurses
// through the exact same verb — infinite nesting, one code path. Fail-closed per pane: a child that will
// not resolve paints an honest empty tile, never a wrong one.

import { Machines, mount, isManifest } from "./holospace.mjs";

// the machine κ — mnemonic hex 0x63='c' 0x6f='o' 0x6d='m' 0x70='p', zero-padded to a 64-hex κ core.
export const COMPOSITOR = "did:holo:blake3:" + "636f6d70".padEnd(64, "0");

// the resolver the compositor uses for κ-children. Set by the host (portal) via configure(); inline
// children never touch it, so the DEFAULT boot needs no configuration. Module-level because the holospace
// adapter contract (realize) does not thread the resolver — the same shape machine-holospaces-x64 uses for
// its worker URL. A κ-child before configure() fails soft (unresolved), never throws.
let RESOLVE = null;
export function configure({ resolve } = {}) { if (typeof resolve === "function") RESOLVE = resolve; }

// layoutRects(n, layout) — PURE. n tiles → percentage rects. Ported lean from holo-holospace-host.mjs so
// the compositor is self-contained (the OS host stays the richer, themed surface; this is the portal core).
export function layoutRects(n, layout = "single") {
  if (n <= 0) return [];
  if (n === 1 || layout === "single") return [{ left: 0, top: 0, width: 100, height: 100 }];
  switch (layout) {
    case "split-h": { const w = 100 / n; return Array.from({ length: n }, (_, i) => ({ left: i * w, top: 0, width: w, height: 100 })); }
    case "split-v": { const h = 100 / n; return Array.from({ length: n }, (_, i) => ({ left: 0, top: i * h, width: 100, height: h })); }
    case "primary-rail": {
      const rail = n - 1, rh = 100 / rail;
      return [{ left: 0, top: 0, width: 68, height: 100 }, ...Array.from({ length: rail }, (_, i) => ({ left: 68, top: i * rh, width: 32, height: rh }))];
    }
    case "stack": return Array.from({ length: n }, () => ({ left: 0, top: 0, width: 100, height: 100 }));
    default: {   // generalized grid
      const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols), w = 100 / cols, h = 100 / rows;
      return Array.from({ length: n }, (_, i) => ({ left: (i % cols) * w, top: Math.floor(i / cols) * h, width: w, height: h }));
    }
  }
}

export const adapter = {
  async realize(image, params = {}, snapshot = null, surface) {
    const doc = surface.ownerDocument || document;
    const children = Array.isArray(image) ? image.filter((c) => c != null) : (image != null ? [image] : []);
    const layout = typeof params.layout === "string" ? params.layout : "single";
    const rects = layoutRects(children.length, layout);
    surface.textContent = "";
    if (!/(absolute|fixed|relative)/.test(getComputedStyle(surface).position || "")) surface.style.position = "relative";
    surface.style.overflow = surface.style.overflow || "hidden";
    const handles = [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i], r = rects[i];
      const cell = doc.createElement("div");
      cell.className = "holo-tile";
      cell.style.cssText = `position:absolute;left:${r.left}%;top:${r.top}%;width:${r.width}%;height:${r.height}%;overflow:hidden;` +
        (layout === "stack" ? `z-index:${i + 1};` : "");
      surface.appendChild(cell);
      try {
        if (isManifest(child)) {
          const a = Machines.get(child.machine);
          if (!a) { cell.textContent = "no machine"; handles.push(null); continue; }
          handles.push(await a.realize(child.image, child.params || {}, child.snapshot || null, cell));
        } else {
          handles.push(await mount(String(child), cell, { resolve: RESOLVE }));   // a κ-child → resolve + verify (L5)
        }
      } catch (e) { cell.textContent = ""; handles.push(null); }   // fail-closed: an honest empty tile
    }
    return { children: handles, surface, dispose: () => handles.forEach((h) => h && h.dispose && h.dispose()) };
  },
};

if (typeof window !== "undefined") Machines.register(COMPOSITOR, adapter);

export default adapter;
