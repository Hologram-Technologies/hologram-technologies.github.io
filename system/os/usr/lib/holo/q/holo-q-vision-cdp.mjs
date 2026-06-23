// holo-q-vision-cdp.mjs — THE NATIVE LEG of the raster-island source: cross-origin <iframe> pixels. The
// browser forbids JS from reading another origin's pixels (canvas taint), so the same-origin capture in
// holo-q-vision-capture.mjs cannot see them. The native Hologram browser CAN: it speaks CDP to its own
// renderer (the κ-CDP backend, ADR-0095; remote_debugging_port=9333). This module shapes the CDP calls —
// Page.getFrameTree to find cross-origin frames, Page.captureScreenshot to rasterize one — and emits the
// result as an island to the ambient watcher's notice(). Same κ-precedence, same seal-back-as-κ.
//
// The CDP transport `send(method, params) → result` is injected (the native host provides it; the Node
// witness provides a fake). So the message-shaping + frame-selection logic is pure and provable offline,
// while the actual pixels only ever flow on the native host. Cross-origin reading is a deliberate, gated
// capability of the native browser — not a web-tier escape hatch.

const _b64ToBytes = (b64) => {
  if (typeof atob === "function") { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  return new Uint8Array(Buffer.from(b64, "base64"));                          // Node (witness)
};

// originOf(url) — best-effort origin for the cross-origin test. Returns null for about:blank/data:.
export function originOf(url) {
  try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.origin : null; } catch { return null; }
}

// crossOriginFrames(frameTree, pageOrigin) — PURE. Walk a CDP Page.getFrameTree result; return the
// frames whose origin differs from the top page (the ones same-origin capture cannot read). Each →
// { frameId, url, origin }. about:blank/data: frames are skipped (no readable distinct origin).
export function crossOriginFrames(frameTree, pageOrigin = null) {
  const out = [];
  const top = pageOrigin || (frameTree && frameTree.frame && originOf(frameTree.frame.url));
  const walk = (node) => {
    if (!node || !node.frame) return;
    const o = originOf(node.frame.url);
    if (o && o !== top) out.push({ frameId: node.frame.id, url: node.frame.url, origin: o });
    for (const ch of (node.childFrames || [])) walk(ch);
  };
  for (const ch of ((frameTree && frameTree.childFrames) || [])) walk(ch);
  return out;
}

// createCdpCapture({ send, notice }) — the live native source.
//   send   — async (method, params) => result   (CDP over the native host's debugger transport)
//   notice — the ambient watcher's notice(island)
export function createCdpCapture({ send, notice } = {}) {
  if (typeof send !== "function") throw new Error("holo-q-vision-cdp: send is required");
  if (typeof notice !== "function") throw new Error("holo-q-vision-cdp: notice is required");
  const stats = { scans: 0, frames: 0, noticed: 0, failed: 0 };

  // captureFrame(frame) — screenshot ONE cross-origin frame → island with PNG bytes. A frame that fails
  // to capture is counted, never faked (null bytes are dropped by the ambient layer anyway).
  async function captureFrame(frame, { rect = null } = {}) {
    try {
      const params = { format: "png", captureBeyondViewport: true };
      if (frame && frame.frameId) params.frameId = frame.frameId;             // CDP screenshots the named frame
      if (rect) params.clip = { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 1 };
      const res = await send("Page.captureScreenshot", params);
      if (!res || !res.data) { stats.failed++; return null; }
      return { id: `frame:${(frame && frame.frameId) || "top"}`, pixels: _b64ToBytes(res.data), kind: "raster", hint: (frame && frame.origin) || "cross-origin frame", rect: rect || null };
    } catch { stats.failed++; return null; }
  }

  // scan() — find cross-origin frames, screenshot each, notice them. Returns the islands noticed.
  async function scan() {
    stats.scans++;
    const tree = await send("Page.getFrameTree", {});
    const frames = crossOriginFrames(tree && tree.frameTree ? tree.frameTree : tree);
    stats.frames += frames.length;
    const noticed = [];
    for (const f of frames) {
      const island = await captureFrame(f);
      if (!island) continue;
      stats.noticed++;
      await notice(island);                                                  // κ-precedence + memo handled downstream
      noticed.push(island.id);
    }
    return noticed;
  }

  return { scan, captureFrame, stats: () => ({ ...stats }) };
}

// browser/native binding: wire to the live ambient watcher when a CDP transport is present (the native
// host sets window.HoloCDP.send). On a plain web browser there is no transport → this stays dormant,
// and same-origin capture (holo-q-vision-capture.mjs) is the only raster source. Fail-soft.
if (typeof window !== "undefined") {
  window.HoloVisionCdp = { createCdpCapture, crossOriginFrames, originOf };
  try {
    const send = window.HoloCDP && window.HoloCDP.send;
    const live = window.HoloAmbientPerception && window.HoloAmbientPerception.live;
    if (send && live && !window.__holoCdpCaptureWired) {
      const cap = createCdpCapture({ send: (m, p) => window.HoloCDP.send(m, p), notice: (isl) => live.notice(isl) });
      if (window.HoloAmbient) window.HoloAmbient.register("scan-cross-origin", () => { try { return cap.scan(); } catch { return null; } }, { everyTicks: 16 });
      window.__holoCdpCaptureWired = true;
      window.HoloAmbientPerception.cdp = cap;
    }
  } catch {}
}

export default { createCdpCapture, crossOriginFrames, originOf };
