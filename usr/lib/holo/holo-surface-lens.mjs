// holo-surface-lens.mjs — the UNIVERSAL transparent GPU compositor for Holo Messenger. It generalizes
// holo-msglist-lens from ONE surface to Z-ORDERED LAYERS on ONE GPUDevice: the wallpaper (back), the chat
// tiles, each embedded app's tiles, the chrome, and the Q orb (front) all composite in a SINGLE transparent
// pass. This permanently resolves the "two WebGPU contexts fight" problem — there is one lens for the whole
// app. Every layer's tiles are κ-addressed and share ONE texture cache, so a tile used by two surfaces (an
// avatar in chat AND the sidebar, a wallpaper region behind everything) is uploaded ONCE — one κ address
// space at the metal. Relates: [[holo-messenger-projection-upgrade]] · holo-msglist-lens.mjs · holo_osr.cc.
//
//   makeSurfaceLens(canvas, { device? }) -> {
//     ensureTile(key, srcCanvas)              // upload a κ tile ONCE (shared across all layers/surfaces)
//     frame(layers)                            // layers: [{ z, quads:[{key,x,y,w,h,alpha}] }] → one back-to-front pass
//     has(key) · destroy() · tier · device
//   } | null                                   // null when WebGPU is unavailable → caller keeps a DOM/2D fallback

const WGSL = `
struct Quad { rect: vec4<f32>, misc: vec4<f32>, viewport: vec4<f32> };   // rect=x,y,w,h(px) · misc.x=alpha · viewport.xy=W,H  (NOTE: 'meta' is a reserved WGSL keyword — do not use it)
@group(0) @binding(0) var<uniform> q: Quad;
@group(1) @binding(0) var samp: sampler;
@group(1) @binding(1) var tex: texture_2d<f32>;
struct VO { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VO {
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(0.0,0.0), vec2<f32>(1.0,0.0), vec2<f32>(0.0,1.0),
    vec2<f32>(0.0,1.0), vec2<f32>(1.0,0.0), vec2<f32>(1.0,1.0));
  let c = corners[vi];
  let px = q.rect.xy + c * q.rect.zw;
  let ndc = vec2<f32>(px.x / q.viewport.x * 2.0 - 1.0, 1.0 - px.y / q.viewport.y * 2.0);
  var o: VO; o.pos = vec4<f32>(ndc, 0.0, 1.0); o.uv = c; return o;
}
@fragment fn fs(i: VO) -> @location(0) vec4<f32> { return textureSample(tex, samp, i.uv) * q.misc.x; }
`;

export async function makeSurfaceLens(canvas, { device = null, tileCap = 2048 } = {}) {
  try {
    if (typeof navigator === "undefined" || !navigator.gpu || !canvas) return null;
    let dev = device;
    if (!dev) { const adapter = await navigator.gpu.requestAdapter(); if (!adapter) return null; dev = await adapter.requestDevice(); }
    const format = navigator.gpu.getPreferredCanvasFormat();

    // Build + VALIDATE the pipeline on the device BEFORE the canvas is committed to WebGPU. A shader/validation
    // fault (e.g. a reserved WGSL keyword like `meta`) surfaces as an async error, not a throw — so we catch it
    // with an error scope and return null with the canvas UNTOUCHED, letting the caller keep Canvas2D. This is
    // what makes the GPU path fail SOFT to 2D on any browser, instead of silently rendering a black surface.
    const ALIGN = 256;
    dev.pushErrorScope("validation");
    const module = dev.createShaderModule({ code: WGSL });
    const uniLayout = dev.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: 48 } }] });
    const texLayout = dev.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
    ] });
    const pipeline = dev.createRenderPipeline({
      layout: dev.createPipelineLayout({ bindGroupLayouts: [uniLayout, texLayout] }),
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format, blend: {
        color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
        alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
      } }] },
      primitive: { topology: "triangle-list" },
    });
    const sampler = dev.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
    const perr = await dev.popErrorScope();
    if (perr) { try { console.error("[surface-lens] pipeline invalid — staying on Canvas2D:", perr.message); } catch {} return null; }

    const context = canvas.getContext("webgpu");
    if (!context) return null;
    context.configure({ device: dev, format, alphaMode: "premultiplied", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });

    let _clear = null;   // debug: force a visible clear color to isolate "presents but samples transparent" from "no present"
    // ONE shared tile cache — the single κ address space at the metal (LRU by κ key).
    const tiles = new Map();
    function ensureTile(key, src) {
      if (!src || !src.width || !src.height) return;
      const hit = tiles.get(key);
      if (hit && hit.w === src.width && hit.h === src.height) { tiles.delete(key); tiles.set(key, hit); return; }
      if (hit) { try { hit.tex.destroy(); } catch {} tiles.delete(key); }
      const tex = dev.createTexture({ size: [src.width, src.height], format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
      dev.queue.copyExternalImageToTexture({ source: src, flipY: false }, { texture: tex, premultipliedAlpha: true }, [src.width, src.height]);
      const bind = dev.createBindGroup({ layout: texLayout, entries: [{ binding: 0, resource: sampler }, { binding: 1, resource: tex.createView() }] });
      tiles.set(key, { tex, bind, w: src.width, h: src.height });
      while (tiles.size > tileCap) { const oldest = tiles.keys().next().value; const e = tiles.get(oldest); try { e.tex.destroy(); } catch {} tiles.delete(oldest); }
    }

    let uni = null, uniSlots = 0, uniBind = null, staging = null;
    function ensureUniform(n) {
      if (n <= uniSlots) return;
      const slots = Math.max(128, n);
      if (uni) try { uni.destroy(); } catch {}
      uni = dev.createBuffer({ size: slots * ALIGN, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      uniBind = dev.createBindGroup({ layout: uniLayout, entries: [{ binding: 0, resource: { buffer: uni, size: ALIGN } }] });
      staging = new Float32Array(slots * (ALIGN / 4));
      uniSlots = slots;
    }

    // frame(layers): flatten layers back-to-front (z ascending, producer order within a layer) into ONE ordered
    // quad list, then composite them in a single transparent pass. Draw order = paint order (premultiplied over).
    function frame(layers) {
      const ordered = [];
      for (const L of (layers || []).slice().sort((a, b) => (a.z || 0) - (b.z || 0))) {
        for (const q of (L.quads || [])) { const e = tiles.get(q.key); if (e) ordered.push({ q, e }); }
      }
      const W = canvas.width || 1, H = canvas.height || 1;
      if (ordered.length) {
        ensureUniform(ordered.length);
        const F = ALIGN / 4;
        for (let i = 0; i < ordered.length; i++) {
          const b = i * F, r = ordered[i].q;
          staging[b + 0] = r.x; staging[b + 1] = r.y; staging[b + 2] = r.w; staging[b + 3] = r.h;
          staging[b + 4] = r.alpha == null ? 1 : r.alpha;
          staging[b + 8] = W; staging[b + 9] = H;
        }
        dev.queue.writeBuffer(uni, 0, staging, 0, ordered.length * F);
      }
      const enc = dev.createCommandEncoder();
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: _clear || { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }] });
      if (ordered.length) { pass.setPipeline(pipeline); for (let i = 0; i < ordered.length; i++) { pass.setBindGroup(0, uniBind, [i * ALIGN]); pass.setBindGroup(1, ordered[i].e.bind); pass.draw(6); } }
      pass.end();
      dev.queue.submit([enc.finish()]);
    }

    // DEBUG probe: render the given layers into the current swap-chain texture AND copy it back, returning the
    // center pixel [r,g,b,a]. Renders + copies in ONE encoder (same texture), so it reflects exactly what a normal
    // frame() would present. Lets a headless harness (rAF paused) verify the pipeline produces visible pixels.
    async function probe(layers) {
      const ordered = [];
      for (const L of (layers || []).slice().sort((a, b) => (a.z || 0) - (b.z || 0))) { for (const q of (L.quads || [])) { const e = tiles.get(q.key); if (e) ordered.push({ q, e }); } }
      const W = canvas.width || 1, H = canvas.height || 1;
      if (ordered.length) { ensureUniform(ordered.length); const F = ALIGN / 4; for (let i = 0; i < ordered.length; i++) { const b = i * F, r = ordered[i].q; staging[b] = r.x; staging[b + 1] = r.y; staging[b + 2] = r.w; staging[b + 3] = r.h; staging[b + 4] = r.alpha == null ? 1 : r.alpha; staging[b + 8] = W; staging[b + 9] = H; } dev.queue.writeBuffer(uni, 0, staging, 0, ordered.length * F); }
      const tex = context.getCurrentTexture();
      const enc = dev.createCommandEncoder();
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: tex.createView(), clearValue: _clear || { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }] });
      if (ordered.length) { pass.setPipeline(pipeline); for (let i = 0; i < ordered.length; i++) { pass.setBindGroup(0, uniBind, [i * ALIGN]); pass.setBindGroup(1, ordered[i].e.bind); pass.draw(6); } }
      pass.end();
      const bpr = Math.ceil(W * 4 / 256) * 256;
      const buf = dev.createBuffer({ size: bpr * H, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr, rowsPerImage: H }, { width: W, height: H });
      dev.queue.submit([enc.finish()]);
      await buf.mapAsync(GPUMapMode.READ);
      const data = new Uint8Array(buf.getMappedRange());
      const cx = W >> 1, cy = H >> 1, off = cy * bpr + cx * 4;
      const px = [data[off], data[off + 1], data[off + 2], data[off + 3]];
      buf.unmap(); buf.destroy();
      return { px, W, H, drawn: ordered.length, format };
    }
    function destroy() { for (const e of tiles.values()) { try { e.tex.destroy(); } catch {} } tiles.clear(); if (uni) try { uni.destroy(); } catch {} }
    return { ensureTile, frame, probe, has: (k) => tiles.has(k), tileCount: () => tiles.size, destroy, tier: "surface-lens", device: dev, format, set debugClear(c) { _clear = c; } };
  } catch (e) { try { console.error("[surface-lens] init failed:", e); } catch {} return null; }
}

export default { makeSurfaceLens };
