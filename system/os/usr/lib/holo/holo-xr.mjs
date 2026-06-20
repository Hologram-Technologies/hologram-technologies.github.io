// holo-xr.mjs — the PROJECTOR: a κ-surface scene (Phase 3b) → a three-mesh-ui 3D panel tree, so the
// SAME content-addressed scene that renders flat (holo-surface) also renders in space / WebXR. This is
// substrate glue, NOT a UI library — the 3D UI primitives are the VENDORED, κ-verified three-mesh-ui
// (vendor/three-mesh-ui, pinned dual-axis, L5-served). Same κ, same L5 (via resolveTree), same tree.
//
//   container → ThreeMeshUI.Block   ·   text → ThreeMeshUI.Text   ·   image → Block + backgroundTexture
//
// THREE + ThreeMeshUI are passed in (the in-stack globals or ESM), so this module stays renderer-agnostic
// and node-testable with stubs. Containers must carry explicit w/h (the flat layout already computes them).

import { resolveTree } from "./holo-surface.mjs";

export const PX_PER_METER = 240;                       // 320px scene ≈ 1.33m panel — one canonical scale

// ensureThree — lazily inject the in-stack three.js + the vendored three-mesh-ui (both UMD globals,
// served by content-address over the κ-route and L5-verified by the delivery worker). Loaded ONCE, only
// when a surface is entered in 3D — the lean rule. Returns { THREE, ThreeMeshUI }. Browser-only.
let _threeP = null;
export function ensureThree(opts = {}) {
  if (_threeP) return _threeP;
  // three r0.150.1 — matches three-mesh-ui 6.5.4's peer (>=0.144), clearing the version caveat. Kept
  // SEPARATE from the legacy r134 (voice/lib) that holo-3d/voice/vanta were verified against (no regression).
  const THREE_URL = opts.threeUrl || "/_shared/vendor/three/three.min.js";
  const TMUI_URL = opts.tmuiUrl || "/_shared/vendor/three-mesh-ui/three-mesh-ui.js";
  const load = (src) => new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("load failed: " + src)); document.head.appendChild(s); });
  _threeP = (async () => {
    if (typeof window.THREE === "undefined") await load(THREE_URL);          // UMD → global THREE
    if (typeof window.ThreeMeshUI === "undefined") await load(TMUI_URL);     // UMD → global ThreeMeshUI
    return { THREE: window.THREE, ThreeMeshUI: window.ThreeMeshUI };
  })();
  return _threeP;
}

const c3 = (THREE, c) => new THREE.Color(c[0], c[1], c[2]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// project ONE normalized node → a three-mesh-ui object (recursive over children).
export function projectNode(node, ctx) {
  const { THREE, ThreeMeshUI, font, tex, ppm = PX_PER_METER } = ctx;
  if (node.kind === "text") {
    const t = new ThreeMeshUI.Text({ content: String(node.text || ""), fontSize: (node.textSize || 16) / ppm, fontColor: c3(THREE, node.textColor || [0.92, 0.94, 0.98, 1]) });
    t.userData.kappa = node.__k || null; t.userData.kind = "text"; return t;
  }
  if (node.kind === "image") {
    const blk = new ThreeMeshUI.Block({ width: (node.w || 64) / ppm, height: (node.h || 64) / ppm, borderRadius: (node.radius || 0) / ppm, backgroundOpacity: 1 });
    if (node.__tex) blk.set({ backgroundTexture: node.__tex });   // a THREE.Texture loaded from the L5-verified image κ (attached by the caller)
    blk.userData.kappa = node.__k || null; blk.userData.kind = "image"; return blk;
  }
  // container
  const opt = {
    width: (node.w || 320) / ppm, height: (node.h || 200) / ppm,
    padding: (node.pad || 0) / ppm, borderRadius: (node.radius || 0) / ppm,
    contentDirection: node.layout === "grid" ? "row" : "column",   // grid≈row for the slice (true grid later)
    justifyContent: "start", alignItems: "stretch",
    backgroundOpacity: node.fill ? (node.fill[3] ?? 1) : 0,
    fontFamily: font, fontTexture: tex,
  };
  if (node.fill) opt.backgroundColor = c3(THREE, node.fill);
  const blk = new ThreeMeshUI.Block(opt);
  blk.userData.kappa = node.__k || null; blk.userData.kind = "container";   // so a raycast resolves to its κ
  for (const ch of (node.children || [])) blk.add(projectNode(ch, ctx));
  return blk;
}

// ── hit-test in 3D: a ray (controller or mouse-derived) → the nearest ancestor carrying a κ. One pick
// path for flat pointer AND XR controller. Uses the REAL rendered meshes (not the 2D layout), so it is
// always consistent with what the user sees. Returns { kappa, kind, object, point } | null.
export function pickAtRay(root, raycaster) {
  const hits = raycaster.intersectObject(root, true);
  for (const h of hits) {
    let o = h.object;
    while (o) { if (o.userData && o.userData.kappa) return { kappa: o.userData.kappa, kind: o.userData.kind, object: o, point: h.point }; o = o.parent; }
  }
  if (hits.length) { let o = hits[0].object; while (o) { if (o.userData && o.userData.kind) return { kappa: null, kind: o.userData.kind, object: o, point: hits[0].point }; o = o.parent; } }
  return null;
}
export function pickAtPointer(THREE, canvas, camera, root, clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, camera);
  return pickAtRay(root, rc);
}

// enterVR — request an immersive-vr session (device-gated). Controller select → pickAtRay → κ (onSelect).
// Honest: returns { supported:false } where there is no XR device (e.g. headless / a flat screen).
export async function enterVR(ctx) {
  const { renderer, scene, camera, THREE, ThreeMeshUI, onSelect } = ctx;
  if (typeof navigator === "undefined" || !navigator.xr) return { supported: false, reason: "navigator.xr absent" };
  const ok = await navigator.xr.isSessionSupported("immersive-vr").catch(() => false);
  if (!ok) return { supported: false, reason: "immersive-vr not supported (no device)" };
  const session = await navigator.xr.requestSession("immersive-vr", { optionalFeatures: ["local-floor", "hand-tracking"] });
  renderer.xr.enabled = true; await renderer.xr.setSession(session);
  const controller = renderer.xr.getController(0); scene.add(controller);
  const rc = new THREE.Raycaster();
  controller.addEventListener("select", () => {
    const m = new THREE.Matrix4().extractRotation(controller.matrixWorld);
    rc.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    rc.ray.direction.set(0, 0, -1).applyMatrix4(m);
    const hit = pickAtRay(scene, rc); if (hit && onSelect) onSelect(hit);
  });
  renderer.setAnimationLoop(() => { ThreeMeshUI.update(); renderer.render(scene, camera); });   // XR present loop
  return { supported: true, session, controller };
}

// resolve the scene (L5 + L3 dedup, the SAME spine as the 2D path) then project the whole tree.
export async function projectToMeshUI(sceneSpecOrKappa, ctx) {
  const tree = await resolveTree(sceneSpecOrKappa, ctx);   // verify-before-projection
  return projectNode(tree, ctx);
}

// render a κ-surface scene into a <canvas> in 3D (flat projection now; renderer.xr-ready for headset).
// setTimeout-driven (headless rAF is throttled). Returns the three handles + the projected root.
export async function renderSpatial(canvas, sceneSpecOrKappa, ctx) {
  const { THREE, ThreeMeshUI } = ctx;
  const W = canvas.width, H = canvas.height;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(W, H, false);
  if (ctx.xr && renderer.xr) renderer.xr.enabled = true;          // headset-ready when a session exists
  const scene = new THREE.Scene(); scene.background = new THREE.Color(ctx.bg ?? 0x0b0c10);
  const camera = new THREE.PerspectiveCamera(ctx.fov ?? 55, W / H, 0.1, 100); camera.position.set(0, 0, ctx.dist ?? 1.7);
  scene.add(new THREE.AmbientLight(0xffffff, 1));
  const root = await projectToMeshUI(sceneSpecOrKappa, ctx);
  scene.add(root);
  const tick = () => { ThreeMeshUI.update(); renderer.render(scene, camera); };
  tick(); await sleep(ctx.fontWaitMs ?? 1800);
  for (let i = 0; i < (ctx.settle ?? 6); i++) { tick(); await sleep(120); }
  const pick = (clientX, clientY) => pickAtPointer(THREE, canvas, camera, root, clientX, clientY);   // mouse/pointer → κ
  const enter = (onSelect) => enterVR({ renderer, scene, camera, THREE, ThreeMeshUI, onSelect });    // device-gated headset
  return { renderer, scene, camera, root, tick, pick, enter };
}

export const HoloXR = { projectNode, projectToMeshUI, renderSpatial, pickAtRay, pickAtPointer, enterVR, ensureThree, PX_PER_METER };
export default HoloXR;
