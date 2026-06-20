// holo-space3d.js — Holo Space (ADR-0080, L5 + L6): the reusable NAVIGABLE-SCENE surface that any
// holospace mounts, plus the κ-chunk STREAMER that feeds it detail on demand.
//
//   L6  HoloSpace.mount(target, scene, opts) -> { stop, getCam, streamer }   (scene = descriptor | seed)
//       <holo-space seed="…"></holo-space>                                    (one tag, any holospace)
//   L5  new HoloSpace.ChunkStreamer(chunks, { resolve, verify, loadRadius, dropRadius })
//       Loads κ-addressed scene chunks within range from the source chain, accepts each ONLY after
//       re-derivation (Law L5 — a wrong byte is refused), caches, and evicts far ones (O(view) detail).
//
// A scene is itself content-addressed: same descriptor κ → same world everywhere (L5). The procedural
// cosmos (holo-cosmos) is the first renderer; the streamer is renderer-agnostic — the substrate for
// authored / Gaussian-splat / heightfield scenes whose detail genuinely lives in streamable κ chunks.
// Pure browser APIs, no CDN (Law L4); degrades cleanly (mount returns null where WebGL2 is absent).

import HoloCosmos from "./holo-cosmos.js";
import HoloCosmosGPU from "./holo-cosmos-gpu.js";   // WebGPU backend (same start() contract); selected when a device is confirmed

// ── backend selector (Law L4: pure browser APIs, degrade cleanly) ─────────────────────────────────
// Capability-ordered: WebGPU (only once a device is CONFIRMED, so start() stays synchronous) → WebGL2 →
// null. ?forceGL / ?forceGPU override for witnessing. The async probe lives in holo-cosmos-gpu.js;
// until it resolves, gpuAvailable() is false and we use WebGL2 — never a black screen.
function pickBackend() {
  try {
    const q = (typeof location !== "undefined" && location.search) || "";
    if (/[?&]forceGL\b/i.test(q)) return HoloCosmos;
    if (/[?&]forceGPU\b/i.test(q)) return HoloCosmosGPU;
  } catch {}
  return (HoloCosmosGPU.gpuAvailable && HoloCosmosGPU.gpuAvailable()) ? HoloCosmosGPU : HoloCosmos;
}

// ── content addressing (Law L5): re-derive sha256 and compare ────────────────────────────────────
async function sha256hex(bytes) {
  const d = await crypto.subtle.digest("SHA-256", bytes.buffer ? bytes : new Uint8Array(bytes));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const hexOf = (k) => String(k || "").split(":").pop().replace(/[^0-9a-f]/gi, "");
async function defaultVerify(kappa, bytes) { return hexOf(kappa) === await sha256hex(bytes); }
async function defaultResolve(kappa) {                       // the OS source chain exposes /.holo/sha256/<hex>
  try { const r = await fetch("/.holo/sha256/" + hexOf(kappa)); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; } catch { return null; }
}

// ── L5: distance-based LOD chunk streamer ─────────────────────────────────────────────────────────
export class ChunkStreamer {
  constructor(chunks, opts = {}) {
    this.chunks = (chunks || []).filter((c) => c && c.k);     // [{ k, center:[x,y,z] }]
    this.loadR = opts.loadRadius != null ? opts.loadRadius : 40;
    this.dropR = opts.dropRadius != null ? opts.dropRadius : 60;
    this.resolve = opts.resolve || defaultResolve;
    this.verify = opts.verify || defaultVerify;
    this.onChange = opts.onChange || (() => {});
    this.loaded = new Map();                                  // k -> { data, bytes, center }
    this.inflight = new Set();
    this.stats = { loaded: 0, verified: 0, rejected: 0, evicted: 0, missing: 0 };
  }
  _dist(c, cam) { const a = c || [0, 0, 0]; return Math.hypot(a[0] - cam[0], a[1] - cam[1], a[2] - cam[2]); }
  async tick(cam) {
    cam = cam || [0, 0, 0];
    const jobs = [];
    for (const ch of this.chunks) {
      const d = this._dist(ch.center, cam);
      if (d <= this.loadR && !this.loaded.has(ch.k) && !this.inflight.has(ch.k)) jobs.push(this._load(ch));
      else if (d > this.dropR && this.loaded.has(ch.k)) { this.loaded.delete(ch.k); this.stats.evicted++; this.onChange(this); }
    }
    if (jobs.length) await Promise.all(jobs);
  }
  async _load(ch) {
    this.inflight.add(ch.k);
    try {
      const bytes = await this.resolve(ch.k);
      if (!bytes) { this.stats.missing++; return; }
      if (!(await this.verify(ch.k, bytes))) { this.stats.rejected++; return; }   // Law L5: refuse a tampered/mis-keyed chunk
      let data = null; try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch {}
      this.loaded.set(ch.k, { data, bytes: bytes.length, center: ch.center });
      this.stats.loaded++; this.stats.verified++;
    } finally { this.inflight.delete(ch.k); this.onChange(this); }
  }
  list() { return [...this.loaded.keys()]; }
}

// ── L6: mount a navigable scene into any element ──────────────────────────────────────────────────
export function mount(target, scene, opts = {}) {
  const el = typeof target === "string" ? document.querySelector(target) : target;
  if (!el) return null;
  const desc = (scene && typeof scene === "object") ? scene : { type: "space", seed: String(scene || "") };
  try { if (getComputedStyle(el).position === "static") el.style.position = "relative"; } catch {}
  // a fresh canvas per attempt: a canvas's context type is one-shot, so the WebGL2 fallback can't reuse
  // a canvas already bound to "webgpu" — give it a clean one.
  const makeCanvas = () => { const c = document.createElement("canvas");
    Object.assign(c.style, { position: "absolute", inset: "0", width: "100%", height: "100%", display: "block" }); el.appendChild(c); return c; };

  let canvas = null, renderer = null;
  if ((desc.type || "space") === "space") {
    const sopts = { seed: desc.seed || desc.k || "", reduced: opts.reduced };
    const backend = pickBackend();
    canvas = makeCanvas();
    renderer = backend.start(canvas, sopts);
    if (!renderer && backend !== HoloCosmos) {        // GPU was chosen but failed → fall back to WebGL2 on a clean canvas
      canvas.remove(); canvas = makeCanvas(); renderer = HoloCosmos.start(canvas, sopts);
    }
    if (!renderer) { canvas.remove(); return null; }  // no usable backend → caller falls back (no-gl)
  } else { return null; }

  let streamer = null, timer = 0, running = true;
  if (desc.chunks && desc.chunks.length) {
    streamer = new ChunkStreamer(desc.chunks, { resolve: opts.resolve, verify: opts.verify, loadRadius: desc.loadRadius, dropRadius: desc.dropRadius, onChange: opts.onChunks });
    const loop = () => { if (!running) return; Promise.resolve(streamer.tick(renderer.getCam ? renderer.getCam() : [0, 0, 0])).catch(() => {}); timer = setTimeout(loop, 250); };
    loop();   // the streamer ticks at ~4 Hz, decoupled from the render loop
  }
  return {
    canvas, streamer, getCam: () => (renderer.getCam ? renderer.getCam() : [0, 0, 0]),
    stop() { running = false; clearTimeout(timer); try { renderer.stop(); } catch {} canvas.remove(); },
  };
}

// ── L6: <holo-space seed="…"> — one tag, any holospace ───────────────────────────────────────────
if (typeof customElements !== "undefined" && typeof HTMLElement !== "undefined" && !customElements.get("holo-space")) {
  customElements.define("holo-space", class extends HTMLElement {
    connectedCallback() {
      const reduced = (() => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } })();
      this._ctrl = mount(this, { type: "space", seed: this.getAttribute("seed") || this.getAttribute("scene") || "" }, { reduced });
    }
    disconnectedCallback() { try { this._ctrl && this._ctrl.stop(); } catch {} this._ctrl = null; }
  });
}

const HoloSpace = { mount, ChunkStreamer, sha256hex, pickBackend, gpuReady: HoloCosmosGPU.ready, gpuAvailable: HoloCosmosGPU.gpuAvailable, version: "0.2" };
if (typeof window !== "undefined") window.HoloSpace = window.HoloSpace || HoloSpace;
export default HoloSpace;
