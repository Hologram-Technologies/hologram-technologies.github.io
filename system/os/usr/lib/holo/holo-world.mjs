// holo-world.mjs — the WORLD / NAVIGATION layer: an A-Frame world (navigable with WASD + mouse, and
// VR via progressive WebXR) that HOSTS κ-surface panels as in-world content. Option A: each panel is
// rendered by our renderer-agnostic Phase-3b renderer (holo-surface → a canvas) and mapped as a
// CanvasTexture on an A-Frame plane — so the world runs on A-Frame's super-three (r173) with NO
// three-mesh-ui version conflict, and reuses our κ-surface renderer + L5. A-Frame is the original
// vendored build (κ-addressable, L5-served, lazy-loaded). In-world clicks reuse pickAtRay → κ.

import { renderSurface } from "./holo-surface.mjs";
import { pickAtRay } from "./holo-xr.mjs";

// lazily inject the vendored A-Frame (~1.28MB, κ-verified over the route) — ONCE, only on entering a world.
let _afP = null;
export function ensureAframe(opts = {}) {
  if (_afP) return _afP;
  const URL_ = opts.aframeUrl || "/_shared/vendor/aframe/aframe.min.js";
  _afP = new Promise((res, rej) => {
    if (typeof window !== "undefined" && window.AFRAME) return res(window.AFRAME);
    const s = document.createElement("script"); s.src = URL_;
    s.onload = () => res(window.AFRAME); s.onerror = () => rej(new Error("A-Frame load failed: " + URL_));
    document.head.appendChild(s);
  });
  return _afP;
}

// render a κ-surface to a canvas (Phase-3b), copy to a WebGL-safe 2D canvas → CanvasTexture (any three).
async function panelTexture(THREE, sceneSpecOrK, ctx) {
  const off = document.createElement("div"); off.style.cssText = "position:fixed;left:-99999px;top:0"; document.body.appendChild(off);
  await renderSurface(off, sceneSpecOrK, { ...ctx, force: "gpu", spatial: false });   // κ-surface → a canvas (L5 in resolveTree)
  const src = off.querySelector("canvas");
  const c2 = document.createElement("canvas"); c2.width = src.width; c2.height = src.height;
  c2.getContext("2d").drawImage(src, 0, 0);                                            // webgpu/webgl canvas → 2d (texture-safe)
  off.remove();
  const tex = new THREE.CanvasTexture(c2);
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return { tex, w: c2.width, h: c2.height };
}

const el = (tag, attrs = {}) => { const e = document.createElement(tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

// renderWorld(mount, scene κ|spec, ctx) → a navigable A-Frame world with one κ-surface panel you can
// walk up to and click. Returns handles + a manual tick() (headless rAF is throttled) + pick/pickForward.
export async function renderWorld(mount, sceneSpecOrK, ctx = {}) {
  const AFRAME = await ensureAframe(ctx);
  const THREE = AFRAME.THREE;
  const sceneK = (typeof sceneSpecOrK === "string") ? sceneSpecOrK : (ctx.sceneKappa || "did:holo:inline-scene");
  const { tex, w, h } = await panelTexture(THREE, sceneSpecOrK, ctx);

  const sceneEl = el("a-scene", { embedded: "", "vr-mode-ui": "enabled: true", background: "color: #0b0c10", renderer: "antialias: true; colorManagement: true; preserveDrawingBuffer: true" });
  sceneEl.appendChild(el("a-sky", { color: "#0b0c10" }));
  sceneEl.appendChild(el("a-plane", { rotation: "-90 0 0", width: "40", height: "40", position: "0 0 0", color: "#10141c" }));   // floor
  // navigation: Maps-grade defaults — WASD walk + mouse look + a clickable cursor; progressive to touch/VR.
  const cam = el("a-camera", { position: "0 1.6 3", "wasd-controls": "acceleration: 28", "look-controls": "pointerLockEnabled: false" });
  cam.appendChild(el("a-cursor", { raycaster: "objects: .pickable", fuse: "false", color: "#7aa2ff" }));
  sceneEl.appendChild(cam);
  // the κ-surface panel as a textured plane
  const aspect = h / Math.max(1, w);
  const panel = el("a-plane", { class: "pickable", width: "1.8", height: (1.8 * aspect).toFixed(3), position: "0 1.6 0", material: "shader: flat; side: double" });
  sceneEl.appendChild(panel);
  mount.replaceChildren(sceneEl);

  if (!sceneEl.hasLoaded) await new Promise((r) => sceneEl.addEventListener("loaded", r, { once: true }));
  const mesh = panel.getObject3D("mesh");
  if (mesh) { mesh.material.map = tex; mesh.material.needsUpdate = true; mesh.userData.kappa = sceneK; mesh.userData.kind = "panel"; }

  const renderer = sceneEl.renderer, camera = sceneEl.camera, scene3 = sceneEl.object3D;
  const tick = () => { tex.needsUpdate = true; renderer.render(scene3, camera); };
  const ray = (nx, ny) => { const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(nx, ny), camera); return pickAtRay(scene3, rc); };
  const pick = (clientX, clientY) => { const r = renderer.domElement.getBoundingClientRect(); return ray(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1); };
  const pickForward = () => ray(0, 0);                                  // where the camera is looking → the panel
  const enter = (onSelect) => import("./holo-xr.mjs").then((x) => x.enterVR({ renderer, scene: scene3, camera, THREE, ThreeMeshUI: window.ThreeMeshUI, onSelect }));
  return { AFRAME, sceneEl, renderer, camera, scene: scene3, panel, mesh, texture: tex, tick, pick, pickForward, enter };
}

export const HoloWorld = { ensureAframe, renderWorld };
export default HoloWorld;
