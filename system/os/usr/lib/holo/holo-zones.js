// holo-zones.js — native FancyZones/KWin-style window zones for the holospace. Not FancyZones
// (a Win32 app) and not KWin (a Wayland/X11 compositor) — both control OS windows from outside
// the browser. This is the same idea, in-page + serverless: a LAYOUT is a set of zones; dragging
// a window onto a zone snaps it there; a background grid shows the zones.
//
// Ecosystem leverage (the "adopt a published format" discipline): a custom layout can be a KDE
// KWin TILE-TREE (layoutDirection + nested tiles with width/height ratios), resolved here to
// zones — so KWin layouts are interoperable, not reinvented. Every layout content-addresses to a
// did:holo, so you can share a tiling as a link and a peer re-derives it (Law L5). Pure +
// dependency-free (Law L4); zonesFor/zoneAt/zonesFromKwinTree are node-testable.

const F = (x, y, w, h) => ({ x, y, w, h });

export const LAYOUTS = {
  halves: { name: "Halves", zones: [F(0, 0, .5, 1), F(.5, 0, .5, 1)] },
  columns: { name: "Columns", zones: [F(0, 0, 1 / 3, 1), F(1 / 3, 0, 1 / 3, 1), F(2 / 3, 0, 1 / 3, 1)] },
  grid2x2: { name: "Grid 2×2", zones: [F(0, 0, .5, .5), F(.5, 0, .5, .5), F(0, .5, .5, .5), F(.5, .5, .5, .5)] },
  grid3x3: { name: "Grid 3×3", zones: (() => { const z = []; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) z.push(F(c / 3, r / 3, 1 / 3, 1 / 3)); return z; })() },
  golden: { name: "Golden", zones: [F(0, 0, .618, 1), F(.618, 0, .382, .5), F(.618, .5, .382, .5)] },
  // a KDE KWin custom-tiling tree (adopting the published format), resolved to zones below.
  kwin: { name: "KWin Tiles", tree: { layoutDirection: "horizontal", tiles: [{ width: .6 }, { layoutDirection: "vertical", width: .4, tiles: [{ height: .5 }, { height: .5 }] }] } },
};
export const LAYOUT_ORDER = ["halves", "columns", "grid2x2", "grid3x3", "golden", "kwin"];

// zonesFromKwinTree(tree) → fractional zones. Mirrors KWin's tile tree: each level splits its rect
// horizontally or vertically by the children's width/height ratios; leaves are zones. Recursive.
export function zonesFromKwinTree(tree, rect = { x: 0, y: 0, w: 1, h: 1 }) {
  const tiles = tree && tree.tiles;
  if (!tiles || !tiles.length) return [rect];
  const horiz = (tree.layoutDirection || "horizontal") === "horizontal";
  const sizes = tiles.map((t) => (horiz ? (t.width || 1 / tiles.length) : (t.height || 1 / tiles.length)));
  const total = sizes.reduce((a, b) => a + b, 0) || 1;
  const out = []; let off = 0;
  tiles.forEach((t, i) => {
    const frac = sizes[i] / total;
    const sub = horiz ? { x: rect.x + off * rect.w, y: rect.y, w: frac * rect.w, h: rect.h } : { x: rect.x, y: rect.y + off * rect.h, w: rect.w, h: frac * rect.h };
    off += frac;
    if (t.tiles) out.push(...zonesFromKwinTree(t, sub)); else out.push(sub);
  });
  return out;
}

// zonesFor(layout, W, H, gap) → pixel rects {left,top,width,height} for the usable area W×H.
export function zonesFor(layout, W, H, gap = 6) {
  const L = typeof layout === "string" ? LAYOUTS[layout] : layout;
  const fracs = L && L.tree ? zonesFromKwinTree(L.tree) : (L && L.zones ? L.zones : LAYOUTS.halves.zones);
  return fracs.map((z) => ({ left: Math.round(z.x * W) + gap, top: Math.round(z.y * H) + gap, width: Math.round(z.w * W) - gap * 2, height: Math.round(z.h * H) - gap * 2 }));
}
// the zone under a point (the one whose center is nearest, among those containing it).
export function zoneAt(zones, x, y) {
  const hit = zones.filter((z) => x >= z.left && x <= z.left + z.width && y >= z.top && y <= z.top + z.height);
  if (!hit.length) return null;
  return hit.sort((a, b) => (Math.hypot(x - (a.left + a.width / 2), y - (a.top + a.height / 2)) - Math.hypot(x - (b.left + b.width / 2), y - (b.top + b.height / 2))))[0];
}
// the canonical string a layout content-addresses through (the shell turns it into a did:holo).
export const layoutCanonical = (id) => JSON.stringify(typeof id === "string" ? (LAYOUTS[id] || { id }) : id);

const HoloZones = { LAYOUTS, LAYOUT_ORDER, zonesFor, zoneAt, zonesFromKwinTree, layoutCanonical };
if (typeof globalThis !== "undefined") globalThis.HoloZones = globalThis.HoloZones || HoloZones;
export default HoloZones;
