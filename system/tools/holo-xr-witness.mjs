#!/usr/bin/env node
// holo-xr-witness.mjs — proves the PROJECTOR (holo-xr.mjs) maps a κ-surface scene → three-mesh-ui
// objects correctly, with the SAME L5 + L3 dedup spine as the 2D path. Uses stub THREE/ThreeMeshUI
// (records constructor calls), so it runs without WebGL. The in-browser render proof is xr.html.
//
// Run: node holo-os/system/tools/holo-xr-witness.mjs
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const { projectToMeshUI, PX_PER_METER, pickAtRay, enterVR } = await import(pathToFileURL(join(here, "../os/usr/lib/holo/holo-xr.mjs")));

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "  ✓ " : "  ✗ ") + m); };

// stub three + three-mesh-ui (record what the projector constructs)
const THREE = { Color: class { constructor(r, g, b) { this.rgb = [r, g, b]; } } };
class Block { constructor(o) { this.type = "Block"; this.opt = o; this.children = []; this.userData = {}; } add(c) { this.children.push(c); return this; } set(o) { Object.assign(this.opt, o); } }
class Text { constructor(o) { this.type = "Text"; this.opt = o; this.userData = {}; } }
const ThreeMeshUI = { Block, Text };

// a κ-ref row (resolved via L5), referenced twice → must dedup; plus a footer text
const rowKappa = "did:holo:blake3:" + "c".repeat(64);
const rowSpec = { "@type": "holo:Surface", kind: "container", w: 296, h: 54, fill: [0.2, 0.2, 0.25, 1], children: [{ kind: "text", text: "row", textSize: 13, h: 54 }] };
let resolves = 0;
const resolve = async () => { resolves++; return new TextEncoder().encode(JSON.stringify(rowSpec)); };
const scene = { "@type": "holo:Surface", kind: "container", w: 320, h: 200, layout: "stack", pad: 12, fill: [0.08, 0.09, 0.13, 1], children: [rowKappa, rowKappa, { kind: "text", text: "footer", textSize: 12, h: 38 }] };

const ctx = { THREE, ThreeMeshUI, font: "/_shared/vendor/three-mesh-ui/Roboto-msdf.json", tex: "/_shared/vendor/three-mesh-ui/Roboto-msdf.png", resolve, verify: async () => true };
const root = await projectToMeshUI(scene, ctx);

ok(root.type === "Block", "root container → ThreeMeshUI.Block");
ok(Math.abs(root.opt.width - 320 / PX_PER_METER) < 1e-6, "container width = px / PX_PER_METER (one canonical scale)");
ok(Array.isArray(root.opt.backgroundColor?.rgb) && root.opt.backgroundColor.rgb[0] === 0.08, "container fill → THREE.Color background");
ok(root.opt.fontFamily.endsWith("Roboto-msdf.json") && root.opt.fontTexture.endsWith(".png"), "root carries the κ-addressed MSDF font (text inherits)");
ok(root.children.length === 3, "composition: 3 children projected (2 rows + footer)");
ok(root.children[0].type === "Block" && root.children[0].children[0].type === "Text", "row → Block containing a Text (nested composition)");
ok(root.children[2].type === "Text" && root.children[2].opt.content === "footer", "text node → ThreeMeshUI.Text with its content");
ok(Math.abs(root.children[2].opt.fontSize - 12 / PX_PER_METER) < 1e-6, "text fontSize = px / PX_PER_METER");
ok(resolves === 1, "L3 dedup: the κ-ref row resolved ONCE despite two references");

// pick: a ray → the nearest ancestor carrying a κ (walk up from the hit mesh to its κ block)
{
  const kBlock = { userData: { kappa: "did:holo:blake3:" + "c".repeat(64), kind: "container" } }; kBlock.parent = null;
  const bgMesh = { userData: {}, parent: kBlock };   // three-mesh-ui background mesh under the κ-tagged Block
  const hit = pickAtRay({}, { intersectObject: () => [{ object: bgMesh, point: {} }] });
  ok(hit && hit.kappa === kBlock.userData.kappa && hit.kind === "container", "pick: ray → child κ (walk-up from rendered mesh)");
  const plain = { userData: { kind: "container" } }; const m2 = { userData: {}, parent: plain };
  const hit2 = pickAtRay({}, { intersectObject: () => [{ object: m2, point: {} }] });
  ok(hit2 && hit2.kappa === null && hit2.kind === "container", "pick: hit with no κ ancestor → kind-only fallback");
  ok(pickAtRay({}, { intersectObject: () => [] }) === null, "pick: no intersection → null");
}

// enterVR is device-gated: honest supported:false where there is no XR device (headless / flat)
{
  const ev = await enterVR({ renderer: {}, scene: {}, camera: {}, THREE: {}, ThreeMeshUI: {} });
  ok(ev.supported === false, "enterVR: device-gated → supported:false with no navigator.xr (honest)");
}

console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
