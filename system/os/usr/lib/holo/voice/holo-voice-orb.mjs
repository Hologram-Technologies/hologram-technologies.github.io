// holo-voice-orb.mjs — Q's living 3D orb. It began as a faithful port of the VapiBlocks "3D Orb"
// (https://www.vapiblocks.com/components/3d-orb, MIT): an icosahedron wireframe morphed by the voice
// volume through 3D simplex noise. It is now rendered as a κ-ADDRESSED OBJECT: the orb's whole form —
// geometry, golden-ratio framing, and a STACK of geometrical transforms — is one small canonical
// descriptor, content-addressed with the SAME scheme as holo-scene.mjs (ADR-0089: canon = RFC 8785 JCS
// subset → did:holo:sha256). The render loop INTERPRETS that descriptor, so the transform stack is data,
// not code: add/retune a transform → a new κ → a new orb. That is what "unlocks complex geometrical
// transformations" — they are addressable and remixable, like any holospace object.
//
// The original `updateBallMorph` is the first transform ("noise"); breathe · twist · attention layer on
// top to make the orb feel alive and conscious — a slowly-drifting focus the surface attends toward, an
// fBm living skin, a breath, an internal swirl — all still driven by Q's on-device voice meter (low
// latency, nothing leaves the device). 100% same-origin: Three.js r134 is the vendored UMD global, the
// noise is the import-mapped vendored simplex-noise ESM (Law L1/L4/L5).
//
//   createOrb(canvas, { detail, spin, level(), color(), descriptor }) → { start, stop, resize, … , kappa, descriptor }

import { createNoise3D } from "simplex-noise";

const THREE = (typeof window !== "undefined" && window.THREE) || null;
const PHI = (1 + Math.sqrt(5)) / 2;     // the golden ratio — the icosahedron's own constant; here it also frames + paces the orb

// ── κ identity (the holo-scene.mjs scheme, inlined so the orb stays dependency-free) ────────────────
// canon = RFC 8785 JCS subset (sorted keys) — byte-identical to holo-scene's canon, so the orb's κ is a
// first-class did:holo:sha256 in the same address space as scenes/desktops.
function canon(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
}
async function kappaOf(obj) {
  const str = canon(obj);
  const c = (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.subtle) || null;
  if (c) { const h = await c.digest("SHA-256", new TextEncoder().encode(str)); return "did:holo:sha256:" + [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
  let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return "did:holo:sha256:" + ("00000000" + (h >>> 0).toString(16)).slice(-8);
}

// ── the orb DESCRIPTOR (the κ-object) — the orb's form as pure, addressable data ─────────────────────
// geometry/frame: an icosahedron (φ-native) framed by the golden ratio. transforms[]: the deformation
// stack, applied per-vertex per-frame against the rest direction. Edit this → a different κ → a different orb.
export const ORB_DESCRIPTOR = {
  "@type": "holo:Orb",
  geometry: { radius: 10, detail: 8 },                                   // IcosahedronGeometry(10, 8) — orb.tsx
  frame: { fov: 45, distance: 46, near: 0.5, far: 100 },                 // distance 46 ⇒ the rest orb fills ~1/φ of the view (golden framing)
  material: { wireframe: true, emissive: 0.35 },
  // the full brand SPECTRUM — the SAME 8 stops as the desktop omnibar (#omni) conic-gradient outline, the
  // OS's "content-addressed spectrum". Wrapped around the orb (longitude → hue) and rotated like omni-spin
  // (7s/turn, accelerated by the voice). vertex-colored so every wireframe edge is a live gradient.
  spectrum: { stops: ["#ff3b6b", "#ff9e2c", "#ffe24a", "#46e08a", "#2bd4ff", "#5b8cff", "#c77bff", "#ff3b6b"],
    spin: 7, lat: 0.42, sparkle: 0.1, voiceSpin: 1.6, voiceBright: 0.55, depth: 0.4 },
  motion: { spinY: 0.005, spinX: 0.005 / PHI, breathe: 0.05 },          // two axes in φ ratio (orb.tsx spun y by 0.005)
  // a luminous PARTICLE AURA around the wireframe (Tier 3) — additive points, voice-reactive, offline.
  aura: { count: 700, spread: 0.55, size: 0.6, drift: 0.00018 },
  transforms: [
    // 1) the VapiBlocks morph, generalized to fractal noise (fBm) for a living, organic skin.
    { type: "noise", octaves: 3, freq: 0.62, lacunarity: PHI, gain: 0.5, amp: 2.5, drift: 0.00001, idle: 0.14 },
    // 2) a slow breath — the orb is never fully still (consciousness at rest).
    { type: "breathe", amp: 0.06, period: PHI },
    // 3) an internal swirl — latitude-sheared rotation, a sense of inner life.
    { type: "twist", amp: 0.22, freq: 1.6, rate: 0.0006 },
    // 4) ATTENTION — the surface bulges toward a slowly-drifting focus: the orb looks, attends, thinks.
    { type: "attention", amp: 0.5, sharp: 3, rate: 0.00013, gain: 0.6 },
  ],
};

export function orbSupported() {
  if (!THREE) return false;
  try { var c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl") || c.getContext("experimental-webgl")); }
  catch (e) { return false; }
}

export function createOrb(canvas, opts) {
  if (!THREE) throw new Error("THREE not loaded (voice/lib/three.min.js)");
  opts = opts || {};
  // the descriptor is the orb. detail/spin overrides fold INTO it, so the κ reflects exactly what renders.
  var D = JSON.parse(JSON.stringify(opts.descriptor || ORB_DESCRIPTOR));
  if (opts.detail != null) D.geometry.detail = opts.detail;
  if (opts.spin != null) { D.motion.spinY *= opts.spin; D.motion.spinX *= opts.spin; }
  // optional max device-pixel-ratio cap (default 2). A caller wanting MAXIMUM sharpness on a Hi-DPI phone
  // can raise this (e.g. to the device's full dpr) for a crisp, hyper-real wireframe; the frame-time
  // adaptive loop still backs off under load, so quality is high by default and never at the cost of fps.
  var PRCAP = Math.max(1, opts.maxPixelRatio || 2);
  var radius = D.geometry.radius, getLevel = typeof opts.level === "function" ? opts.level : function () { return 0; };
  var getColor = typeof opts.color === "function" ? opts.color : function () { return null; };
  var noise = createNoise3D();
  var inst = { descriptor: D, kappa: null };
  kappaOf(D).then(function (k) { inst.kappa = k; try { canvas.dataset.kappa = k; } catch (e) {} }, function () {});

  // ── scene · group · camera (golden-framed) ──────────────────────────────────────────────────────
  var scene = new THREE.Scene();
  var group = new THREE.Group();
  var camera = new THREE.PerspectiveCamera(D.frame.fov, 1, D.frame.near, D.frame.far);
  camera.position.set(0, 0, D.frame.distance);
  camera.lookAt(scene.position);
  scene.add(camera);

  var renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PRCAP));

  // the SPECTRUM stops as rgb (0..1) — parsed from the κ descriptor (same colours as the omnibar outline)
  var SPEC = D.spectrum || ORB_DESCRIPTOR.spectrum;
  function hex2rgb(h) { h = String(h).replace("#", ""); if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255]; }
  var STOPS = (SPEC.stops || []).map(hex2rgb), SEG = Math.max(1, STOPS.length - 1);
  // the spectrum can be RE-SKINNED at runtime (e.g. to the desktop wallpaper's palette) via the color
  // callback returning a `stops` hex array — applied only when the array reference changes (cheap).
  var _stopsRef = null;
  function applyStops(hexArr) { try { var s = (hexArr || []).map(hex2rgb); if (s.length >= 2) { STOPS = s; SEG = s.length - 1; } } catch (e) {} }

  // ── the ball: icosahedron, wireframe, VERTEX-COLOURED so the spectrum lives on every edge (orb.tsx) ──
  var geometry = new THREE.IcosahedronGeometry(radius, D.geometry.detail);
  // UNLIT (MeshBasicMaterial): the per-vertex spectrum + a depth term ARE the shading, so no lights and no
  // per-frame normal recompute are needed — fewer ops per frame (lower latency), and a vivid neon spectrum.
  var material = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: D.material.wireframe !== false, vertexColors: true });
  var ball = new THREE.Mesh(geometry, material);
  group.add(ball);

  // rest UNIT DIRECTIONS — every transform is measured from these, so the stack composes cleanly and is
  // stable to run every frame (radial scale + tangential twist, recomputed from rest, never accumulating).
  // uBase = the vertex's longitude (0..1) → its position in the spectrum (the conic wrap, like omni-spin).
  var pos = geometry.getAttribute("position"), N = pos.count;
  var dir = new Float32Array(N * 3), uBase = new Float32Array(N);
  var colAttr = new THREE.BufferAttribute(new Float32Array(N * 3), 3); geometry.setAttribute("color", colAttr);
  for (var i = 0; i < N; i++) {
    var x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), l = Math.hypot(x, y, z) || 1;
    dir[i * 3] = x / l; dir[i * 3 + 1] = y / l; dir[i * 3 + 2] = z / l;
    uBase[i] = Math.atan2(x, z) / (Math.PI * 2) + 0.5;
  }

  // ── PARTICLE AURA (Tier 3) — a soft luminous shell of additive points that breathes + sparkles with
  // your voice. Robust + offline: THREE.Points on the r134 core (no WebGPU, no render-targets, transparent-
  // safe). Colours track the same adaptive spectrum; count scales down on weak GPUs (see frame()).
  var AURA = D.aura || ORB_DESCRIPTOR.aura, PN = (AURA && AURA.count) || 0, _auraN = PN;
  var points = null, pgeo = null, ppos = null, pcol = null, pdir = null, pu = null, pph = null, pband = null;
  function softSprite() {
    var s = 32, cv = document.createElement("canvas"); cv.width = cv.height = s; var cx = cv.getContext("2d");
    var g = cx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.4, "rgba(255,255,255,0.5)"); g.addColorStop(1, "rgba(255,255,255,0)");
    cx.fillStyle = g; cx.fillRect(0, 0, s, s); return new THREE.CanvasTexture(cv);
  }
  if (PN > 0) {
    pgeo = new THREE.BufferGeometry();
    ppos = new Float32Array(PN * 3); pcol = new Float32Array(PN * 3);
    pdir = new Float32Array(PN * 3); pu = new Float32Array(PN); pph = new Float32Array(PN); pband = new Float32Array(PN);
    for (var q = 0; q < PN; q++) {                                       // golden-spiral spherical spread → an even shell
      var yk = 1 - (q + 0.5) / PN * 2, rk = Math.sqrt(Math.max(0, 1 - yk * yk)), th = q * Math.PI * (3 - Math.sqrt(5));
      var qx = Math.cos(th) * rk, qz = Math.sin(th) * rk;
      pdir[q * 3] = qx; pdir[q * 3 + 1] = yk; pdir[q * 3 + 2] = qz;
      pu[q] = Math.atan2(qx, qz) / (Math.PI * 2) + 0.5;
      pph[q] = (q * 0.61803) % 1 * Math.PI * 2;                          // a golden spread of phases
      pband[q] = (q % 3) / 2;                                            // 0 / .5 / 1 → bass / mid / treble affinity
    }
    pgeo.setAttribute("position", new THREE.BufferAttribute(ppos, 3));
    pgeo.setAttribute("color", new THREE.BufferAttribute(pcol, 3));
    var pmat = new THREE.PointsMaterial({ size: AURA.size || 0.6, map: softSprite(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    points = new THREE.Points(pgeo, pmat); points.frustumCulled = false; group.add(points);
  }

  scene.add(group);   // no lights — unlit material; depth comes from the per-vertex brightness term in updateMorph

  // fractal Brownian motion (octave-summed simplex) — the living skin
  function fbm(x, y, z, oct, gain, lac) {
    var amp = 1, f = 1, sum = 0, norm = 0;
    for (var k = 0; k < oct; k++) { sum += amp * noise(x * f, y * f, z * f); norm += amp; amp *= gain; f *= lac; }
    return norm ? sum / norm : 0;
  }
  // sample the brand spectrum at u∈[0,1) (wraps seamlessly) → rgb, lerping the omnibar stops
  function sampleSpectrum(u, out) {
    u = u - Math.floor(u); var s = u * SEG, k = s | 0, f = s - k, a = STOPS[k] || STOPS[0], b = STOPS[k + 1] || a;
    out[0] = a[0] + (b[0] - a[0]) * f; out[1] = a[1] + (b[1] - a[1]) * f; out[2] = a[2] + (b[2] - a[2]) * f;
  }

  // ── the transform stack: interpret D.transforms per vertex → a deformed, conscious, SPECTRAL orb ───
  // base: the faithful VapiBlocks radius = 10 + volume*4; each transform adds radial swell and/or a small
  // tangential twist (voice-reactive + a tiny idle term). Per vertex we ALSO write the rotating spectrum,
  // so every wireframe edge is a live gradient — the same colours the omnibar outline sweeps.
  var _fx = 0, _fy = 1, _fz = 0, _rgb = [1, 1, 1];                        // the drifting ATTENTION focus + a colour scratch
  // `sig` is either a number (the old single volume) or a rich signal:
  //   { level, bass, mid, treble, bright, onset, state }  — bands MODULATE on top of the base `level`.
  function updateMorph(sig, t, col, ambient) {
    var L = (typeof sig === "number") ? sig : (sig && sig.level) || 0;
    var bass = (sig && sig.bass) || 0, mid = (sig && sig.mid) || 0, treble = (sig && sig.treble) || 0, bright = (sig && sig.bright) || 0, onset = (sig && sig.onset) || 0, state = (sig && sig.state) || "";
    var gold = (typeof col === "number") ? col : (col && col.gold) || 0, warm = (col && col.warm) || 0, dim = (col && col.dim) || 0;
    var wake = (typeof col === "number") ? 0 : (col && col.wake) || 0;   // optimistic "I heard 'Q'" flare (KWS stage-1 spot)
    ambient = (ambient == null) ? 1 : ambient;                          // PRESENCE / reduced-motion scale for AMBIENT motion (voice reactivity stays full)
    // per-state BODY LANGUAGE (cheap "choreography"): listening = calm wide breath; thinking = tight fast swirl.
    var spinK = ambient, noiseK = 1, breatheK = ambient, twistK = ambient;
    if (state === "listening") { spinK *= 0.7; noiseK = 0.85; breatheK *= 1.35; }
    else if (state === "thinking") { spinK *= 1.6; twistK *= 1.7; noiseK = 1.1; }
    var att = null;
    for (var ti = 0; ti < D.transforms.length; ti++) if (D.transforms[ti].type === "attention") att = D.transforms[ti];
    if (att) {
      var a = t * (att.rate || 0.00013);
      _fx = Math.cos(a) * Math.cos(a * PHI); _fy = Math.sin(a * 0.7); _fz = Math.sin(a) * Math.cos(a * PHI);
      var fl = Math.hypot(_fx, _fy, _fz) || 1; _fx /= fl; _fy /= fl; _fz /= fl;
    }
    // spectrum spin — omni-spin pace, accelerated by the voice + treble shimmer + posture; + facing for depth
    var spinT = (t / 1000) / (SPEC.spin || 7) * (1 + L * (SPEC.voiceSpin || 1.6) + treble * 1.4) * spinK;
    var ry = group.rotation.y, cry = Math.cos(ry), sry = Math.sin(ry);
    var bGain = 0.9 + L * (SPEC.voiceBright || 0.55) + onset * 0.6;       // onset = a bright flash on consonants/beats
    var spk = ((SPEC.sparkle || 0.1) + treble * 0.3) * (ambient < 0.3 ? 0.2 : 1), depth = SPEC.depth || 0.4, lat = SPEC.lat || 0.42;   // no shimmer under reduced-motion
    var pump = radius * 0.14 * bass + radius * 0.10 * onset;             // bass pump + onset swell (uniform → a "boom")
    for (var i = 0; i < N; i++) {
      var dx = dir[i * 3], dy = dir[i * 3 + 1], dz = dir[i * 3 + 2];
      var r = radius + L * 4 + pump;                                      // orb.tsx base + band energy
      var twistAng = 0;
      for (var j = 0; j < D.transforms.length; j++) {
        var tr = D.transforms[j];
        if (tr.type === "noise") {
          var dr = tr.drift || 0.00001;
          var n = fbm(dx * tr.freq + t * dr * 7, dy * tr.freq + t * dr * 8, dz * tr.freq + t * dr * 9, tr.octaves || 3, tr.gain || 0.5, tr.lacunarity || PHI);
          r += n * (tr.amp || 2.5) * ((L + (tr.idle || 0)) * noiseK + mid * 0.7);   // mids add surface texture
        } else if (tr.type === "breathe") {
          r += radius * (tr.amp || 0.05) * breatheK * Math.sin(t / 1000 / (tr.period || PHI) * Math.PI * 2);
        } else if (tr.type === "twist") {
          twistAng += (tr.amp || 0.2) * twistK * Math.sin(dy * (tr.freq || 1.6) * Math.PI + t * (tr.rate || 0.0006));
        } else if (tr.type === "attention") {
          var d = dx * _fx + dy * _fy + dz * _fz;                          // alignment with the focus
          if (d > 0) r += radius * (tr.amp || 0.5) * Math.pow(d, tr.sharp || 3) * (0.35 + L * (tr.gain || 0.6));
        }
      }
      if (twistAng) { var ca = Math.cos(twistAng), sa = Math.sin(twistAng), nx = dx * ca + dz * sa, nz = -dx * sa + dz * ca; dx = nx; dz = nz; }   // swirl about Y
      pos.setXYZ(i, dx * r, dy * r, dz * r);
      // the rotating spectrum: longitude → colour, swept by spinT, spread across latitude (a 2D rainbow)
      sampleSpectrum(uBase[i] + spinT + lat * dy, _rgb);
      var worldZ = dx * sry + dz * cry;                                   // approx facing (Y-rotation) → front brighter (depth)
      var bri = bGain * (1 - depth + depth * (worldZ * 0.5 + 0.5)) * (1 - spk + spk * Math.sin(t * 0.004 + i * 0.7));
      var cr = _rgb[0], cg = _rgb[1], cb = _rgb[2];
      if (bright > 0) { var wb = bright * 0.22; cr += (1 - cr) * wb; cg += (1 - cg) * wb; cb += (1 - cb) * wb; }   // brighter voice → warmer/whiter
      if (gold > 0) { cr += (1 - cr) * gold; cg += (0.78 - cg) * gold; cb += (0.20 - cb) * gold; }   // gold mind-flare wash (Holo Mind acting)
      if (wake > 0) { cr += (0.17 - cr) * wake; cg += (0.83 - cg) * wake; cb += (1 - cb) * wake; }   // teal "I heard you" wash (KWS wake spot, #2bd4ff)
      if (warm > 0) { cr = cr * (1 + warm * 0.10); cb = cb * (1 - warm * 0.30); }                    // circadian: warmer toward evening/night
      var dbri = bri * (1 - dim * 0.4);                                                              // circadian: dimmer at night (calm, never off)
      colAttr.setXYZ(i, Math.min(1, cr * dbri), Math.min(1, cg * dbri), Math.min(1, cb * dbri));
    }
    pos.needsUpdate = true; colAttr.needsUpdate = true;   // no computeVertexNormals — unlit material ignores normals (saves an O(N) pass/frame)
    // the particle aura: a luminous shell that breathes outward with the voice + sparkles on highs/onsets
    if (points && _auraN > 0) {
      var aSpread = (AURA.spread || 0.55), aDrift = (AURA.drift || 0.00018), shell = radius * 1.12;
      var pulse = 0.4 + L * 1.6 + bass * 1.4 + onset * 0.8, rcap = radius * 2.4;
      for (var q = 0; q < _auraN; q++) {
        var ax = pdir[q * 3], ay = pdir[q * 3 + 1], az = pdir[q * 3 + 2];
        var da = pph[q] + t * aDrift * (1 + pband[q]) * ambient, dca = Math.cos(da), dsa = Math.sin(da);   // slow orbital drift
        var rx = ax * dca + az * dsa, rz = -ax * dsa + az * dca;
        var wob = 0.5 + 0.5 * Math.sin(t * 0.0016 + pph[q]);
        var rr = Math.min(rcap, shell + radius * aSpread * pulse * (0.35 + 0.65 * wob) * (0.6 + pband[q] * 0.8));
        ppos[q * 3] = rx * rr; ppos[q * 3 + 1] = ay * rr; ppos[q * 3 + 2] = rz * rr;
        sampleSpectrum(pu[q] + spinT + 0.13 * ay, _rgb);
        var tw = 0.55 + 0.45 * Math.sin(t * 0.006 + pph[q] * 3) + treble * 0.6 + onset * 0.5;
        var pr2 = _rgb[0], pg2 = _rgb[1], pb2 = _rgb[2];
        if (warm > 0) { pr2 *= (1 + warm * 0.10); pb2 *= (1 - warm * 0.30); }
        var pbri = Math.min(1.4, tw) * (1 - dim * 0.4);
        pcol[q * 3] = Math.min(1, pr2 * pbri); pcol[q * 3 + 1] = Math.min(1, pg2 * pbri); pcol[q * 3 + 2] = Math.min(1, pb2 * pbri);
      }
      pgeo.attributes.position.needsUpdate = true; pgeo.attributes.color.needsUpdate = true; pgeo.setDrawRange(0, _auraN);
    }
  }
  // restore the rest icosahedron (orb.tsx resetBallMorph)
  function reset() { for (var i = 0; i < N; i++) pos.setXYZ(i, dir[i * 3] * radius, dir[i * 3 + 1] * radius, dir[i * 3 + 2] * radius); pos.needsUpdate = true; }

  function resize() {
    var w = canvas.clientWidth || canvas.width || 1, h = canvas.clientHeight || canvas.height || 1;
    camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false);
  }
  var ro = null;
  if (typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(resize); try { ro.observe(canvas); } catch (e) {} }
  else { window.addEventListener("resize", resize); }
  resize();

  var raf = 0, running = false;
  var _lastT = 0, _emaDt = 0, _fc = 0, _prCap = Math.min(window.devicePixelRatio || 1, PRCAP), _pr = _prCap;
  var _rmq = null; try { _rmq = window.matchMedia("(prefers-reduced-motion: reduce)"); } catch (e) {}
  // one frame: spin, run the transform stack (deform + spectrum), render. Exposed as step() for
  // deterministic/manual rendering; frame() adds the rAF loop + frame-time adaptive resolution.
  function step() {
    var t = window.performance.now();
    var sig = getLevel();
    var energy = (sig && sig.energy != null) ? sig.energy : 1;
    var reduced = _rmq ? _rmq.matches : false;
    var ambient = reduced ? 0.22 : (0.4 + 0.6 * energy);                      // PRESENCE: serene when idle, lively when active; calm under reduced-motion
    group.rotation.y += D.motion.spinY * ambient; group.rotation.x += D.motion.spinX * ambient;
    var col = getColor() || {};
    if (col.stops && col.stops !== _stopsRef) { _stopsRef = col.stops; applyStops(col.stops); }   // adopt an adaptive palette (e.g. the wallpaper's)
    updateMorph(sig, t, col, ambient);
    renderer.render(scene, camera);
  }
  function frame() {
    if (!running) return;
    var now = window.performance.now();
    if (_lastT) _emaDt = _emaDt ? _emaDt * 0.9 + (now - _lastT) * 0.1 : (now - _lastT);
    _lastT = now;
    if ((++_fc % 45) === 0 && _emaDt > 0) {                                   // FRAME-TIME ADAPTIVE QUALITY — scale render resolution to hold fps
      var fps = 1000 / _emaDt;
      if (fps < 45 && _pr > 0.7) { _pr = Math.max(0.7, _pr - 0.25); renderer.setPixelRatio(_pr); resize(); }
      else if (fps > 57 && _pr < _prCap) { _pr = Math.min(_prCap, _pr + 0.25); renderer.setPixelRatio(_pr); resize(); }
      if (fps < 38) _auraN = Math.max(0, Math.floor(PN * 0.4)); else if (fps > 55) _auraN = PN;   // thin the aura on weak GPUs
    }
    step();
    raf = requestAnimationFrame(frame);
  }
  function start() { if (running) return; running = true; resize(); raf = requestAnimationFrame(frame); }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
  function dispose() {
    stop();
    try { if (ro) ro.disconnect(); else window.removeEventListener("resize", resize); } catch (e) {}
    try { if (pgeo) pgeo.dispose(); if (points && points.material) { if (points.material.map) points.material.map.dispose(); points.material.dispose(); } } catch (e) {}
    try { geometry.dispose(); material.dispose(); renderer.dispose(); } catch (e) {}
  }

  inst.start = start; inst.stop = stop; inst.step = step; inst.resize = resize; inst.dispose = dispose; inst.reset = reset;
  inst.getKappa = function () { return inst.kappa; };
  inst.geometry = geometry; inst.material = material; inst.points = points;   // exposed for inspection (spectrum in geometry.attributes.color; aura in points.geometry)
  return inst;
}

export default createOrb;
