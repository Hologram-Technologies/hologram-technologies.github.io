// kappa-vram.mjs — κ-keyed VRAM residency: the GPU tier of the unified substrate.
//
// The GPU buffer for tensor T IS the κ(T) object. residentGPU(κ) returns the κ's GPUBuffer, uploading it
// on demand (bytes come from the substrate resolver = verified, from RAM/OPFS/net) and evicting the oldest
// GPU buffers under a VRAM byte budget. Only the working set a forward touches ever climbs to VRAM; the
// rest stay as addresses in the lower tiers or as nothing at all. THIS is "don't store the whole model":
// peak VRAM = the budget, not the model size.
//
//   VRAM (GPUBuffer map, LRU, budget-bounded)  ← this file
//     └─ resolve(κ) → bytes  ← kappa-resolve.mjs (RAM-hot → OPFS-warm → net-cold, BLAKE3-verified)

export function makeVramResidency({ device, resolve, budgetBytes = 512 * 1024 * 1024 } = {}) {
  if (!device) throw new Error("kappa-vram: WebGPU device required");
  if (typeof resolve !== "function") throw new Error("kappa-vram: resolve(κ)->bytes required (kappaResolve.get)");
  const U = GPUBufferUsage;
  const gpu = new Map();                 // κ -> { buf, size } (insertion order = LRU)
  let vramBytes = 0;
  const stats = { gpuHit: 0, uploaded: 0, evicted: 0, bytesUp: 0, peak: 0 };

  const touch = (k) => { const v = gpu.get(k); gpu.delete(k); gpu.set(k, v); };
  const evictFor = (incoming) => {                         // make room BEFORE upload → peak never exceeds budget
    while (vramBytes + incoming > budgetBytes && gpu.size > 0) {
      const oldest = gpu.keys().next().value; const v = gpu.get(oldest);
      v.buf.destroy(); vramBytes -= v.size; gpu.delete(oldest); stats.evicted++;
    }
  };

  async function residentGPU(k) {
    if (gpu.has(k)) { stats.gpuHit++; touch(k); return gpu.get(k).buf; }
    const bytes = await resolve(k);                       // verified bytes from the substrate
    const size = bytes.byteLength, padded = (size + 3) & ~3;
    evictFor(size);                                        // evict oldest until this fits (peak ≤ budget)
    const buf = device.createBuffer({ size: padded, usage: U.STORAGE | U.COPY_DST | U.COPY_SRC });
    const src = (size % 4) ? (() => { const p = new Uint8Array(padded); p.set(bytes); return p; })() : bytes;
    device.queue.writeBuffer(buf, 0, src);
    gpu.set(k, { buf, size }); vramBytes += size; stats.uploaded++; stats.bytesUp += size;
    if (vramBytes > stats.peak) stats.peak = vramBytes;
    return buf;
  }

  async function readBack(k) {                            // verify GPU bytes == source (witness only)
    const v = gpu.get(k); if (!v) return null;
    const padded = (v.size + 3) & ~3;
    const stg = device.createBuffer({ size: padded, usage: U.MAP_READ | U.COPY_DST });
    const enc = device.createCommandEncoder(); enc.copyBufferToBuffer(v.buf, 0, stg, 0, padded); device.queue.submit([enc.finish()]);
    await stg.mapAsync(GPUMapMode.READ); const out = new Uint8Array(stg.getMappedRange().slice(0, v.size)); stg.unmap(); stg.destroy();
    return out;
  }

  return {
    residentGPU, readBack, stats,
    has: (k) => gpu.has(k),
    count: () => gpu.size,
    vramBytes: () => vramBytes,
    flush: () => { for (const v of gpu.values()) v.buf.destroy(); gpu.clear(); vramBytes = 0; },
  };
}
