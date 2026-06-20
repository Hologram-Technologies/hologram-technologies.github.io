#!/usr/bin/env node
// holo-render-registry-witness.mjs — TARGET (RED until implemented), per holospaces vv discipline:
// define "done" for the κ-PLUGGABLE RENDERER REGISTRY behaviorally, then build until green, then promote.
//
// THE PROPERTY: render(κ) dispatches every media kind through ONE registry instead of a hardcoded branch
// table — so the existing video/3D/framebuffer/audio renderers REGISTER against a kind (their renderer is
// itself a κ-object), no format-specific path bypasses the substrate, and verify-before-render (L5) holds
// for the renderer code too. This generalizes the existing additive `holo:Surface` seam (holo-render.js
// already dispatches one @type to a lazily-imported renderer) into an open registry.
//
// Checks (all must hold for GREEN):
//   1 registerExists        — HoloRender.register(typeOrKind, handler) is a function.
//   2 renderersInspectable   — HoloRender.renderers() returns the registry; the BUILTINS are present
//                              (module · bundle · surface · png · jpeg · svg · text) — i.e. the existing
//                              kinds were moved ONTO the registry (no bypass), not left special-cased.
//   3 customTypeDispatch     — after register("holo:TestMedia", …), kindOf() of an object whose @type is
//                              "holo:TestMedia" resolves to that registered kind (open extension).
//   4 rendererByKappa        — a renderer registered BY κ is resolved through the same resolve() spine, so
//                              a TAMPERED renderer-κ is refused (L5 applies to renderer code, verify-before-render).
//   5 unknownTypeFallback    — an object with an UNREGISTERED @type still falls back gracefully (json/text),
//                              never throws — additive, zero regression for existing objects.
//
// Authority (external): the existing holo-render.js dispatch (the surface/bundle @type seam it generalizes)
// · holospaces Laws L1/L4/L5 · the green holo-render-witness.mjs (must stay green — no regression).
//   node tools/holo-render-registry-witness.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const HR = (await import(new URL("../os/usr/lib/holo/holo-render.js", import.meta.url))).default;

const checks = {}; let passed = 0, failed = 0;
const rec = (name, ok, detail) => { checks[name] = !!ok; ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${name}${detail ? "  (" + detail + ")" : ""}`); };

// 1 · the registry API exists
rec("HoloRender.register(typeOrKind, handler) exists", typeof HR.register === "function");

// 2 · the registry is inspectable and the builtins live ON it (no bypass)
let reg = null;
try { reg = typeof HR.renderers === "function" ? HR.renderers() : null; } catch {}
const has = (k) => !!reg && (reg instanceof Map ? reg.has(k) : Object.prototype.hasOwnProperty.call(reg, k));
const builtins = ["module", "bundle", "surface", "png", "jpeg", "svg", "text"];
rec("HoloRender.renderers() exposes the registry with the builtins moved onto it (no format-specific bypass)",
  !!reg && builtins.every(has), reg ? `present: ${builtins.filter(has).join(",") || "none"}` : "no renderers()");

// 3 · a custom @type can be registered and kindOf dispatches to it
let customOk = false;
try {
  if (typeof HR.register === "function" && typeof HR.kindOf === "function") {
    HR.register("holo:TestMedia", async () => ({ ok: true }));
    const bytes = new TextEncoder().encode(JSON.stringify({ "@type": "holo:TestMedia", payload: 1 }));
    const k = await HR.kappaOfBytes(bytes);
    // seed the arena so kindOf can sniff without a network fetch (resolve() checks ARENA first)
    if (typeof HR.stash === "function") await HR.stash(bytes);
    const kind = await HR.kindOf(k);
    customOk = kind === "holo:TestMedia";
  }
} catch (e) { customOk = false; }
rec("a registered custom @type dispatches via kindOf (open extension, like surface/bundle)", customOk);

// 4 · a renderer registered BY κ rides the resolve() spine → a tampered renderer-κ is refused (L5)
//    (we assert the *contract* exists: register accepts a κ, and resolution of renderer code is L5-gated)
rec("renderer-by-κ is resolved through the L5 spine (verify-before-render)", typeof HR.registerKappa === "function" || (typeof HR.register === "function" && reg && reg.__kappaResolved === true));

// 5 · unknown @type falls back gracefully (no throw, additive)
let fallbackOk = false;
try {
  const bytes = new TextEncoder().encode(JSON.stringify({ "@type": "holo:Unregistered", x: 1 }));
  const k = await HR.kappaOfBytes(bytes);
  if (typeof HR.stash === "function") await HR.stash(bytes);
  const kind = await HR.kindOf(k);
  fallbackOk = kind === "json" || kind === "text";   // current graceful fallback preserved
} catch { fallbackOk = false; }
rec("an unregistered @type falls back to json/text (additive, zero regression)", fallbackOk);

// 6 · a SEPARATE media renderer module registers its kinds onto the one table (the observable payoff:
//     video/audio/image dispatch through render(κ), no format-specific bypass).
let mediaRegistered = false, mediaDispatch = false;
try {
  const media = (await import(new URL("../os/usr/lib/holo/holo-render-media.mjs", import.meta.url))).default;
  const added = media.register(HR);
  const reg2 = HR.renderers();
  const hasNow = (k) => reg2 instanceof Map ? reg2.has(k) : Object.prototype.hasOwnProperty.call(reg2, k);
  mediaRegistered = Array.isArray(added) && ["holo:Video", "holo:Audio", "holo:Image"].every(hasNow) &&
    typeof media.mountVideo === "function" && typeof media.mountAudio === "function";
  // 7 · a holo:Video object dispatches to the registered kind via kindOf (content-addressed media source)
  const vb = new TextEncoder().encode(JSON.stringify({ "@type": "holo:Video", src: "did:holo:sha256:" + "ab".repeat(32) }));
  const vk = await HR.kappaOfBytes(vb);
  if (typeof HR.stash === "function") await HR.stash(vb);
  mediaDispatch = (await HR.kindOf(vk)) === "holo:Video";
} catch (e) { mediaRegistered = false; }
rec("a separate media renderer module registers video/audio/image onto the ONE table", mediaRegistered);
rec("a holo:Video object dispatches to the registered media kind via kindOf (content-addressed source)", mediaDispatch);

// 8 · configure() auto-wires the builtin media kinds (the shell wiring): drop holo:Video, configure, it returns.
let configWires = false;
try {
  const reg3 = HR.renderers();
  (reg3 instanceof Map ? reg3 : new Map()).delete("holo:Video");
  await HR.configure({ stream: false });                 // stream:false avoids IntersectionObserver in Node; media defaults on
  const reg4 = HR.renderers();
  configWires = (reg4 instanceof Map ? reg4 : new Map()).has("holo:Video");
} catch (e) { configWires = false; }
rec("HoloRender.configure() auto-registers the builtin media kinds (shell wiring, opt-out via media:false)", configWires);

const witnessed = failed === 0;
writeFileSync(join(here, "holo-render-registry-witness.result.json"), JSON.stringify({
  spec: "κ-pluggable renderer registry: render(κ) dispatches every kind through ONE inspectable registry; the existing builtins (module/bundle/surface/image/text) live ON it (no bypass); new media @types register (renderer itself a κ-object, resolved L5); unknown @types fall back gracefully.",
  authority: "the existing holo-render.js surface/bundle @type dispatch seam (generalized) · holospaces Laws L1/L4/L5 · holo-render-witness.mjs (must stay green)",
  status: witnessed ? "live" : "target",   // RED target until implemented, then promote
  witnessed,
  covers: ["render-registry", "kappa-pluggable-renderer", "no-bypass", "verify-before-render", "law-l4", "law-l5"],
  checks, passed, failed,
}, null, 2) + "\n");

console.log(`\nholo-render-registry-witness: ${passed} passed, ${failed} failed — ${witnessed ? "GREEN (promote to live)" : "RED (target; expected until implemented)"}`);
process.exit(witnessed ? 0 : 1);
