// holo-model-pack.mjs — open the unified q-models.holo ONCE and hand each faculty a per-model view shaped EXACTLY
// like an openHoloStream result, so every loader (parakeet ear's encoderStream/jointStream, loadJointFromHolo, the
// turn-detector binding, moonshine/kokoro) accepts pack.model(id) with ZERO code change. Same body κ ⇒ same bytes
// ⇒ identical results. One open, one OPFS κ-store shared across faculties; faculties Range-fetch only their bodies.
//
//   openModelPack({ rangeReader, persist }) → { manifest, getBody, dir, model(id) }
//     model(id) → { meta:{order}, order, files, headerBytes, getBody, getBodySlice, dir, bodyLen, names }
// rangeReader(off,len)->Uint8Array: production wraps streamHolo/openHoloFiles over the pack URL (Range → release →
// κ-route → OPFS); node wraps a local file. `persist` (makeKappaStore) optional for the shared OPFS warm.
import { openHoloStream } from "../holo-archive.mjs";

const b64dec = (b64) => (typeof Buffer !== "undefined" ? new Uint8Array(Buffer.from(b64, "base64")) : Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));

export async function openModelPack({ rangeReader, persist = null } = {}) {
  if (!rangeReader) throw new Error("openModelPack needs a rangeReader(off,len)->Uint8Array");
  const s = await openHoloStream(rangeReader);                         // one open over the whole pack
  const manifest = JSON.parse(new TextDecoder().decode(s.headerBytes));
  if (!manifest || manifest.format !== "holo-pack/1") throw new Error("not a q-models pack");

  function model(id) {
    const m = manifest.models[id];
    if (!m) throw new Error("model not in pack: " + id);
    // per-model baked header: OLD packs inline it as base64 (m.ext, available sync); NEW split-manifest packs store it
    // as a κ-BODY (m.extKappa) fetched lazily — so OPENING the pack reads ~100 KB not ~29 MB of headers. A loader that
    // needs headerBytes calls await ensureHeader() first (no-op when inline). Both formats supported, no faculty rewrite.
    let _header = m.ext ? b64dec(m.ext) : null;
    // SHAPE == openHoloStream's return (order/getBody/headerBytes) — faculties don't change a line.
    return {
      id, kind: m.kind, tier: m.tier,
      meta: Object.assign({}, m.meta, { order: m.order, arch: (m.meta && m.meta.arch) || id }),
      order: m.order,
      files: m.files || [],
      get headerBytes() { return _header; },
      ensureHeader: async () => { if (_header == null && m.extKappa) _header = await s.getBody(m.extKappa); return _header; },
      getBody: s.getBody,                          // SHARED over the pack (same dir, same OPFS)
      getBodySlice: s.getBodySlice,
      dir: s.dir,
      bodyLen: s.bodyLen,
      names: m.order.map((o) => o.name),
      fileBody: async (name) => { const f = (m.files || []).find((x) => x.name === name) || m.order.find((x) => x.name === name); if (!f) throw new Error("no file " + name + " in " + id); return s.getBody(f.kappa); },
    };
  }

  return { manifest, getBody: s.getBody, dir: s.dir, models: () => Object.keys(manifest.models), model };
}

export default openModelPack;
