// holo-osr-lens.mjs — the LENS RECEIVER for the native off-screen browser producer. This is the JS half of
// the P4 integration: a real web page is rendered by Chromium OFF-SCREEN (Alloy OSR, holo_osr.cc), so the
// page is feature-complete and behaves exactly like Chrome — but it is never drawn to a window. Instead each
// painted frame is tiled + content-addressed natively; novel tiles are written to the κ-store (served at
// holo://os/cache/sha256/<hex>, L5-verified by the κ scheme) and the host calls window.__holoOsrFrame(manifest)
// with a COMPACT per-frame manifest of only the CHANGED tiles:
//
//   manifest = { w, h, tile, seq, tiles: [ { id:"t{cx}_{ry}", k:"did:holo:sha256:…", novel:bool } ] }
//
// This module turns that manifest into the proven projection path: fetch novel tiles over holo:// (re-derive
// to enforce L5 at the lens too), reconstruct held tiles from cache, composite via the injected lens
// (holo-webgpu-lens on the metal / a CPU framebuffer), present at panel rate. So a real Chrome-rendered page
// becomes a stream of κ-addressable objects projected on the metal — feature-complete content, 100% projected.
//
// The producer is swappable (the engine is a detail): the SAME receiver drives a native OSR feed, a remote
// edge feed (κ-Swarm), or an in-page test feed. node-/DOM-safe; lens + fetchTile injected.
import { makeProjector } from "./holo-projector.mjs";
import { kappaOf } from "./holo-kappa-stream.mjs";

const hexOf = (k) => String(k).split(":").pop();
const OP = "did:holo:sha256:" + "00".repeat(31) + "01";     // the constant "blit tile" op κ (matches raster-ingest)

// makeOsrLens({ tile, paint, fetchTile, verify }) —
//   paint(id, bytes)        : the lens sink (webgpu-lens.paint / a CPU blit). Injected.
//   fetchTile(hex) -> bytes : fetch a tile's bytes by content address (holo://os/cache/sha256/<hex>). Injected.
//   verify (default true)   : re-derive fetched bytes to their κ before admitting (L5 at the lens; the κ
//                             scheme already verifies on the wire — this is defense in depth + makes tamper
//                             refusal witnessable here).
// digestHex(bytes) → hex: the axis the tile κ lives on. Default SHA-256 (the κ NAME axis). The native OSR
// producer addresses per-frame tiles on the FAST σ-axis → pass the BLAKE3 digest (blake3hex from
// holo-blake3.mjs) so the lens L5-verify re-derives on the SAME axis the producer hashed.
export function makeOsrLens({ tile = 256, paint, fetchTile, verify = true, decodeChunk = null, digestHex = null } = {}) {
  if (!paint || !fetchTile) throw new Error("holo-osr-lens: needs { paint, fetchTile }");
  const digest = digestHex || (async (b) => hexOf(await kappaOf(b)));   // default = SHA-256 naming axis
  const store = new Map();                                   // hex → bytes (tile RGBA, or an encoded video chunk)
  const transform = async (_op, inn) => store.get(hexOf(inn));
  const projector = makeProjector({ transform, paint });
  const stats = { frames: 0, fetched: 0, refs: 0, refused: 0, vpainted: 0, lastSeq: -1 };

  // admit one frame manifest → composite its changed regions. A region is either a raw κ TILE (low churn,
  // lossless, projected) or a κ video CHUNK (high churn, WebCodecs-decoded then painted) — see holo-churn-router.
  async function frame(manifest) {
    let fetched = 0, refs = 0, vpainted = 0;
    const tileRegions = [];
    for (const t of manifest.tiles) {
      const hex = hexOf(t.k);
      // ensure bytes resident (both kinds fetch + L5-verify the same way — novelty-only wire)
      if (!store.has(hex)) {
        const bytes = await fetchTile(hex);                  // holo://os/cache/{sha256|blake3}/<hex> (κ scheme = L5)
        if (verify && (await digest(bytes)) !== hex) { stats.refused++; throw new Error(`osr-lens: ${t.kind === "vchunk" ? "chunk" : "tile"} ${t.k} failed L5 — refused`); }
        store.set(hex, bytes); fetched++;
      } else refs++;

      if (t.kind === "vchunk") {                             // high-churn region: decode the κ video chunk → frame
        if (!decodeChunk) throw new Error("osr-lens: vchunk region but no decodeChunk provided");
        const rgba = await decodeChunk(t.id, store.get(hex), !!t.keyframe);
        if (rgba) { paint(t.id, rgba); vpainted++; }
      } else {
        tileRegions.push({ id: t.id, op: OP, in: t.k });     // low-churn region: project as a raw κ tile
      }
    }
    const r = await projector.render(tileRegions);           // raw tiles: delta-projected (paint only κ-changes)
    const recv = await projector.receive(r.wire);
    stats.frames++; stats.fetched += fetched; stats.refs += refs; stats.vpainted += vpainted; stats.lastSeq = manifest.seq;
    return { painted: recv.painted + vpainted, vpainted, fetched, refs, novelBytes: recv.novelBytes };
  }

  return { frame, store, stats: () => ({ ...stats }), projector };
}

export default { makeOsrLens };
