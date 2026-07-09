// holo-msglist-lens.mjs — the TRANSPARENT GPU compositor for Holo Messenger's κ-message-list. Unlike
// holo-webgpu-lens (opaque, fixed 256 grid), this surface is TRANSPARENT (the WebGPU wallpaper shows
// through the gaps), and its tiles are VARIABLE-HEIGHT full-width bubbles positioned at arbitrary,
// continuously-easing scroll offsets. So it is a textured-QUAD compositor: each κ-addressed bubble tile
// is uploaded ONCE to a GPU texture (on κ-change), then drawn as a quad at its device-pixel rect every
// frame. Tiles are the SAME OffscreenCanvas the 2D path already rasters (uploaded via
// copyExternalImageToTexture — no readback). ~20–40 draws/frame → free on any GPU.
//
// The message list stays the origin of truth for geometry (the Fenwick scroller) and novelty (κ tile
// cache); this module is purely the PRESENT target — swap g2.drawImage for a GPU quad. Fail-soft: returns
// null when WebGPU is unavailable so the caller keeps its labelled Canvas2D path. Relates:
// [[holo-messenger-projection-upgrade]] · holo-kappa-msglist.mjs · holo-webgpu-lens.mjs.
//
//   makeMsglistLens(canvas, { device? }) -> {
//     ensureTile(key, srcCanvas)          // upload a tile texture from an OffscreenCanvas, ONLY on κ-change
//     frame(quads)                         // quads: [{ key, x, y, w, h, alpha }] in DEVICE px — one transparent pass
//     has(key) · destroy() · tier          // 'msglist-lens' when live
//   } | null

const WGSL = `
struct Quad { rect: vec4<f32>, misc: vec4<f32>, viewport: vec4<f32> };   // rect=x,y,w,h(px) · misc.x=alpha · viewport.xy=W,H  (NOTE: 'meta' is a reserved WGSL keyword — do not use it)
@group(0) @binding(0) var<uniform> q: Quad;
@group(1) @binding(0) var samp: sampler;
@group(1) @binding(1) var tex: texture_2d<f32>;

struct VO { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VO {
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0));
  let c = corners[vi];
  let px = q.rect.xy + c * q.rect.zw;                                    // pixel position of this corner
  let ndc = vec2<f32>(px.x / q.viewport.x * 2.0 - 1.0, 1.0 - px.y / q.viewport.y * 2.0);
  var o: VO; o.pos = vec4<f32>(ndc, 0.0, 1.0); o.uv = c; return o;
}

@fragment fn fs(i: VO) -> @location(0) vec4<f32> {
  let t = textureSample(tex, samp, i.uv);                               // tile uploaded premultiplied
  return t * q.misc.x;                                                  // fade → still premultiplied
}
`;

export async function makeMsglistLens(canvas, { device = null, tileCap = 700 } = {}) {
  try {
    if (typeof navigator === "undefined" || !navigator.gpu || !canvas) return null;   // untouched canvas → caller keeps 2D
    let dev = device;
    if (!dev) { const adapter = await navigator.gpu.requestAdapter(); if (!adapter) return null; dev = await adapter.requestDevice(); }
    const context = canvas.getContext("webgpu");
    if (!context) return null;
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device: dev, format, alphaMode: "premultiplied" });            // transparent → wallpaper shows through

    const ALIGN = 256;                                                                 // uniform dynamic-offset alignment
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

    // per-tile texture cache (LRU by κ key). Each entry: { tex, bind, w, h }.
    const tiles = new Map();
    function ensureTile(key, src) {
      if (!src || !src.width || !src.height) return;
      const hit = tiles.get(key);
      if (hit && hit.w === src.width && hit.h === src.height) { tiles.delete(key); tiles.set(key, hit); return; }   // bump LRU
      if (hit) { try { hit.tex.destroy(); } catch {} tiles.delete(key); }
      const tex = dev.createTexture({
        size: [src.width, src.height],
        format,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      dev.queue.copyExternalImageToTexture({ source: src, flipY: false }, { texture: tex, premultipliedAlpha: true }, [src.width, src.height]);
      const bind = dev.createBindGroup({ layout: texLayout, entries: [{ binding: 0, resource: sampler }, { binding: 1, resource: tex.createView() }] });
      tiles.set(key, { tex, bind, w: src.width, h: src.height });
      while (tiles.size > tileCap) { const oldest = tiles.keys().next().value; const e = tiles.get(oldest); try { e.tex.destroy(); } catch {} tiles.delete(oldest); }
    }

    // one dynamic uniform buffer holding every visible quad's params, 256-aligned per slot; grown as needed.
    let uni = null, uniSlots = 0, uniBind = null, staging = null;
    function ensureUniform(n) {
      if (n <= uniSlots) return;
      const slots = Math.max(64, n);                                                   // grow in chunks
      if (uni) try { uni.destroy(); } catch {}
      uni = dev.createBuffer({ size: slots * ALIGN, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      uniBind = dev.createBindGroup({ layout: uniLayout, entries: [{ binding: 0, resource: { buffer: uni, size: ALIGN } }] });
      staging = new Float32Array(slots * (ALIGN / 4));
      uniSlots = slots;
    }

    function frame(quads) {
      const drawable = [];
      for (const q of quads || []) { const e = tiles.get(q.key); if (e) drawable.push({ q, e }); }
      const W = canvas.width || 1, H = canvas.height || 1;
      if (drawable.length) {
        ensureUniform(drawable.length);
        const F = ALIGN / 4;
        for (let i = 0; i < drawable.length; i++) {
          const b = i * F, r = drawable[i].q;
          staging[b + 0] = r.x; staging[b + 1] = r.y; staging[b + 2] = r.w; staging[b + 3] = r.h;   // rect
          staging[b + 4] = r.alpha == null ? 1 : r.alpha;                                            // meta.x = alpha
          staging[b + 8] = W; staging[b + 9] = H;                                                    // viewport
        }
        dev.queue.writeBuffer(uni, 0, staging, 0, drawable.length * F);
      }
      const enc = dev.createCommandEncoder();
      const pass = enc.beginRenderPass({ colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store",   // TRANSPARENT → wallpaper shows through
      }] });
      if (drawable.length) {
        pass.setPipeline(pipeline);
        for (let i = 0; i < drawable.length; i++) { pass.setBindGroup(0, uniBind, [i * ALIGN]); pass.setBindGroup(1, drawable[i].e.bind); pass.draw(6); }
      }
      pass.end();
      dev.queue.submit([enc.finish()]);
    }

    function destroy() { for (const e of tiles.values()) { try { e.tex.destroy(); } catch {} } tiles.clear(); if (uni) try { uni.destroy(); } catch {} }

    return { ensureTile, frame, has: (k) => tiles.has(k), destroy, tier: "msglist-lens", device: dev, format };
  } catch (e) { try { console.error("[κ-lens] init failed:", e); } catch {} return null; }
}

export default { makeMsglistLens };
