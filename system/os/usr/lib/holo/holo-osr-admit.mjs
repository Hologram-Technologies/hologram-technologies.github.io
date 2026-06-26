// holo-osr-admit.mjs — ONE place that reconstructs an OSR content-space κ-tile manifest.
//
// The web lens (holo-osr-projector.html) and the unified second-viewer (view.html) both turn a manifest of the
// shape { w, h, tile, scrollY?, tiles:[{id, k}] } into placed, L5-verified tiles. Before this module each
// re-implemented placement + verification; now they share it — so "one viewer reconstructs a projected web tab"
// is literally one code path, used on the producer side and the remote side alike.
//
// Tile ids: "c{cx}_{prow}" = CONTENT-space (placed by document row − scrollY, so a κ recurs across scroll);
//           "t{cx}_{ry}"   = legacy SCREEN-space grid slot. Bytes are RGBA, addressed on the blake3 σ-axis (k).
// L5: a tile whose bytes don't re-derive to its own address is REFUSED — never painted. Verify-before-paint.
//
// Pure (no DOM, no fetch): the caller injects getTile / digestHex / paint, so it node-witnesses and runs in any
// surface (the in-OS κ-cache, a remote shared-κ, or an in-memory test store).

// tilePlacement(id, TILE, W, scrollY) → { x, y, w, h, space } | null
export function tilePlacement(id, TILE, W, scrollY = 0) {
  let m = /^c(\d+)_(-?\d+)$/.exec(id);
  if (m) { const x = +m[1] * TILE; return { x, y: +m[2] * TILE - scrollY, w: Math.min(TILE, W - x), h: TILE, space: "content" }; }
  m = /^t(\d+)_(\d+)$/.exec(id);
  if (m) { const x = +m[1] * TILE; return { x, y: +m[2] * TILE, w: Math.min(TILE, W - x), h: TILE, space: "screen" }; }
  return null;
}

// admitOsrManifest(manifest, hooks) → { painted, refused, novelBytes, held }
//   hooks.getTile(b3hex)  → Promise<Uint8Array>  fetch a tile's bytes by address (κ-cache / shared-κ / test store)
//   hooks.digestHex(bytes)→ Promise<string>      re-derive the blake3 address (L5)
//   hooks.paint(id,bytes,place)                  draw the verified tile at its placement
//   hooks.store?                                 a Map for residency: a held κ is never re-fetched/re-verified
export async function admitOsrManifest(manifest, hooks) {
  const { getTile, digestHex, paint, store } = hooks;
  const TILE = manifest.tile || 256, W = manifest.w;
  const scrollY = typeof manifest.scrollY === "number" ? manifest.scrollY : 0;
  let painted = 0, refused = 0, novelBytes = 0;
  for (const t of manifest.tiles || []) {
    const b3 = String(t.k).split(":").pop();              // accept "did:holo:blake3:<hex>" or a bare hex
    const place = tilePlacement(t.id, TILE, W, scrollY);
    if (!place) continue;                                  // unknown id shape → skip (never guess placement)
    let bytes = store ? store.get(b3) : null;
    if (bytes) { paint(t.id, bytes, place); painted++; continue; }   // resident κ: ref, no wire, already verified
    try { bytes = await getTile(b3); } catch (e) { continue; }
    if (!bytes) continue;
    novelBytes += bytes.length;                            // only NOVEL tiles cross the wire (∝ novelty)
    const got = await digestHex(bytes);
    if (got !== b3) { refused++; continue; }               // L5 verify-before-paint: address must re-derive
    if (store) store.set(b3, bytes);
    paint(t.id, bytes, place); painted++;
  }
  return { painted, refused, novelBytes, held: store ? store.size : 0 };
}

export default { tilePlacement, admitOsrManifest };
