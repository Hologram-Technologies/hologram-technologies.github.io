// holo-webgpu-lens.mjs — the GPU PROJECTION SURFACE. The lens of the projection browser, on the metal: it
// receives κ tiles (the same regions holo-projector emits) and blits each into a GPU texture, then copies
// that texture onto the canvas swap-chain. This is the portable, bare-metal-close surface — WebGPU maps to
// Vulkan/Metal/D3D12 under the hood, and the SAME module runs in a plain tab (WASM-WebGPU) or a native
// projector. The channel above it (holo-raster-ingest → holo-projector) is unchanged; only the paint target
// moves from Canvas2D putImageData to a GPU texture write.
//
// A tile write is `queue.writeTexture` into the tile's sub-rectangle (no per-frame full upload — only the
// κ-changed tiles the projector hands us are written). present() copies the staging texture onto the current
// swap-chain texture 1:1 (copyTextureToTexture — exact pixels, no sampling/filtering, so the projection is
// bit-exact). readback() exists for proofs: it copies the staging texture to a mappable buffer.
//
//   makeWebGpuLens({ device, context, width, height, tile?, format? })
//     .paint(id, bytes)   — write one κ tile (RGBA) at its grid slot          (holo-projector's paint callback)
//     .present()          — copy the composed texture to the canvas this frame
//     .readback() → RGBA  — the composed pixels (width*height*4), for verification
export function makeWebGpuLens({ device, context, width, height, tile = 256, format = "rgba8unorm" }) {
  if (!device || !context) throw new Error("holo-webgpu-lens: needs { device, context } (a configured WebGPU surface)");
  // the canvas must accept a copy INTO its swap-chain texture (RENDER_ATTACHMENT is implicit; add COPY_DST)
  context.configure({ device, format, alphaMode: "opaque", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST });
  const staging = device.createTexture({
    size: [width, height],
    format,
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING,
  });

  const slot = (id) => { const m = /^t(\d+)_(\d+)$/.exec(id); if (!m) throw new Error("holo-webgpu-lens: bad tile id " + id); return { x: +m[1] * tile, y: +m[2] * tile }; };

  function paint(id, bytes) {
    const { x, y } = slot(id);
    const tw = Math.min(tile, width - x), th = Math.min(tile, height - y);
    const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    device.queue.writeTexture({ texture: staging, origin: { x, y, z: 0 } }, u, { bytesPerRow: tw * 4, rowsPerImage: th }, { width: tw, height: th });
  }

  function present() {
    const enc = device.createCommandEncoder();
    enc.copyTextureToTexture({ texture: staging }, { texture: context.getCurrentTexture() }, { width, height });
    device.queue.submit([enc.finish()]);
  }

  async function readback() {
    const bpr = width * 4;                                   // 256-aligned (width is a multiple of 64 in practice)
    if (bpr % 256 !== 0) throw new Error("holo-webgpu-lens: readback needs width*4 to be 256-aligned");
    const buf = device.createBuffer({ size: bpr * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: staging }, { buffer: buf, bytesPerRow: bpr, rowsPerImage: height }, { width, height });
    device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const out = new Uint8Array(buf.getMappedRange()).slice();
    buf.unmap(); buf.destroy();
    return out;
  }

  return { paint, present, readback, staging };
}

export default { makeWebGpuLens };
