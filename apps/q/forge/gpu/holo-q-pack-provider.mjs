// holo-q-pack-provider.mjs — the consumer seam: open the unified q-models pack ONCE per page and hand each faculty its
// model view from it, fail-soft to the faculty's own standalone .holo when the pack isn't reachable. This is what
// voice.js / the ear + brain loaders call instead of fetching a per-model .holo: one open, one warm OPFS store, one
// address; pack.model(id) is openHoloStream-shaped so the loaders take it unchanged.
//
//   getQPack({ packSpec, fetchImpl }) → the opened pack (memoized; concurrent callers share one open)
//   packModelFor(spec, { packSpec, fetchImpl }) → spec's model view FROM the pack, or null (caller uses standalone)
//
// spec is a faculty spec from holo-q-faculty-models.specFor()/resolveFacultyModel — it carries spec.pack={url,release,
// model} when the model lives in the pack. packSpec is that module's exported packSpec (one file + shards manifest).
import { openQPack } from "./holo-pack-shards.mjs";

let _pack = null, _opening = null, _key = null;

const baseOf = (url) => (url ? url.replace(/[^/]*$/, "") : undefined);

// open the pack once. Prefers the monolithic file (dev/FORGE-local), falls back to release shards. Memoized by the
// pack's address so every faculty on the page shares ONE open + OPFS warm. Concurrent callers await the same promise.
export async function getQPack({ packSpec, fetchImpl } = {}) {
  if (!packSpec) throw new Error("getQPack needs packSpec");
  const key = (packSpec.url || "") + "|" + (packSpec.partsManifest || "");
  if (_pack && _key === key) return _pack;
  if (_opening && _key === key) return _opening;
  _key = key;
  _opening = openQPack({ monolithicUrl: packSpec.url, partsUrl: packSpec.partsManifest, base: baseOf(packSpec.release), fetchImpl })
    .then((r) => { _pack = r.pack; _pack.__via = r.via; _opening = null; return _pack; })
    .catch((e) => { if (_key === key) { _opening = null; _key = null; } throw e; });
  return _opening;
}

export function resetQPack() { _pack = null; _opening = null; _key = null; }

// hand a faculty its model view FROM the pack, or null. null ⇒ the model isn't in the pack OR the pack is unreachable
// ⇒ the caller falls back to spec.url/spec.release (the standalone .holo) — never a hard failure.
export async function packModelFor(spec, { packSpec, fetchImpl } = {}) {
  try {
    if (!spec || !spec.pack) return null;
    const pack = await getQPack({ packSpec, fetchImpl });
    return pack.model(spec.pack.model);
  } catch { return null; }
}

// ── ear adapter ──────────────────────────────────────────────────────────────────────────────────
// createWhisperEar (parakeet) loads its encoder + joint via deps.openStream(url) and its small loose files (rescale
// json/bin, vocab, nemo) via deps.fetchBytes(url). This maps those URLs — by basename — onto the unified pack so the
// REAL ear streams entirely from the one file, with the standalone url/release as fallback. ZERO ear changes:
//   createWhisperEar(cfg, makePackEarDeps({ packSpec }))   ← that's the whole flip.
const EAR_BYNAME = {
  "parakeet-tdt-0.6b-v2-stream.holo": { kind: "stream", model: "parakeet-encoder" },
  "parakeet-tdt-0.6b-v2-joint.holo": { kind: "stream", model: "parakeet-joint" },
  "parakeet-encoder-rescale.json": { kind: "file", model: "parakeet-encoder", file: "parakeet-encoder-rescale.json" },
  "parakeet-encoder-rescale.bin": { kind: "file", model: "parakeet-encoder", file: "parakeet-encoder-rescale.bin" },
  "parakeet-vocab.txt": { kind: "file", model: "parakeet-encoder", file: "parakeet-vocab.txt" },
  "parakeet-nemo128.onnx": { kind: "file", model: "parakeet-encoder", file: "parakeet-nemo128.onnx" },
};
const basename = (u) => String(u).split(/[/?#]/).filter(Boolean).pop();

// ── universal faculty→pack map ───────────────────────────────────────────────────────────────────
// every model's standalone .holo basename → how it's served from the pack: "stream" (openHoloStream-shaped loaders:
// moonshine/parakeet ears), "gguf" (the GGUF brain via ggufStreamFromPackModel), "files" (file-bundle loaders served
// through openHoloFiles: turn-detector, kokoro). So ONE provider backs every loader in the voice loop.
const PACK_BYNAME = {
  "moonshine-tiny-int8.holo": { kind: "stream", model: "moonshine-tiny-int8" },
  "moonshine-tiny-f16.holo": { kind: "stream", model: "moonshine-tiny-f16" },
  "parakeet-tdt-0.6b-v2-stream.holo": { kind: "stream", model: "parakeet-encoder" },
  "parakeet-tdt-0.6b-v2-joint.holo": { kind: "stream", model: "parakeet-joint" },
  "qwen2.5-0.5b-instruct.holo": { kind: "gguf", model: "qwen2.5-0.5b" },
  "qwen2.5-1.5b-instruct.holo": { kind: "gguf", model: "qwen2.5-1.5b" },
  "qwen2.5-coder-3b-instruct.holo": { kind: "gguf", model: "qwen-coder-3b" },
  "turn-detector.holo": { kind: "files", model: "turn-detector" },
  "kokoro-82m.holo": { kind: "files", model: "kokoro-82m" },
};

// reconstruct streamHolo's view (getF32/getQuant/getMelFilters/meta.config) from a pack model view — the moonshine ear
// reads these, not the bare getBody. Reuses holo-whisper-stream's buildHoloViews over the view's L5 getBody, so decode
// is byte-identical to the standalone .holo. The view carries the full meta (config + order with dims/type) from the pack.
export async function streamHoloFromPackModel(view) {
  await view.ensureHeader?.();   // split-manifest pack: fetch the lazy header body before decode
  const { buildHoloViews } = await import("./holo-whisper-stream.mjs");
  const v = buildHoloViews(view.meta, view.headerBytes, (h) => view.getBody(h));
  return Object.assign({}, v, { dir: view.dir, stats: { ranges: 0, bytesFetched: 0, verifies: 0, opfsHits: 0, fromPack: true } });
}

// an openStream(url,opts) for the moonshine ear (whisper-shaped): pack view (full getF32/getQuant) for a known
// basename, else fallback to streamHolo. (Parakeet uses makePackEarDeps — the raw openHoloStream view — not this.)
export function makePackOpenStream({ packSpec, fetchImpl, openStream, onSource } = {}) {
  return async (url, o) => {
    const e = PACK_BYNAME[basename(url)];
    if (e && e.kind === "stream") { try { const pack = await getQPack({ packSpec, fetchImpl }); const v = await streamHoloFromPackModel(pack.model(e.model)); try { onSource && onSource("stream", basename(url), "pack"); } catch {} return v; } catch {} }
    try { onSource && onSource("stream", basename(url), "standalone"); } catch {}
    if (openStream) return openStream(url, o);
    const { streamHolo } = await import("./holo-whisper-stream.mjs"); return streamHolo(url, o);
  };
}

// an openFiles(url,opts) for file-bundle loaders (serveModelFromHolo's `openFiles`): a files-view backed by the pack
// model's fileBody, else fallback to openHoloFiles. modelId pins which pack model answers (turn-detector / kokoro).
export function makePackOpenFiles(modelId, { packSpec, fetchImpl, openFiles, onSource } = {}) {
  return async (url, o) => {
    try { const pack = await getQPack({ packSpec, fetchImpl }); const m = pack.model(modelId);
      // a file-bundle's named entries land in `order` (the forge stores them there); `files` holds only extra loose
      // files. Expose whichever carries the names so serveModelFromHolo can enumerate; getFile resolves across both.
      const names = (m.files && m.files.length) ? m.files : m.order;
      try { onSource && onSource("files", basename(url), "pack"); } catch {}
      return { meta: { files: names }, files: names, getFile: (name) => m.fileBody(name), bodyByKappa: (k) => m.getBody(k), objectURL: async (name, mime = "application/octet-stream") => URL.createObjectURL(new Blob([await m.fileBody(name)], { type: mime })) };
    } catch {}
    try { onSource && onSource("files", basename(url), "standalone"); } catch {}
    if (openFiles) return openFiles(url, o);
    const { openHoloFiles } = await import("./holo-files.mjs"); return openHoloFiles(url, o);
  };
}

// resolve a model .holo URL → its pack entry {kind,model} (or null if not in the pack) — lets a loader decide whether
// to take a pack adapter for the model it was handed by URL (the brain/turn/tts call sites).
export function packEntryForUrl(url) { return PACK_BYNAME[basename(url)] || null; }

// a ()→{plan,store,headerBytes,…} for the GGUF brain (createHoloBrain's openGgufStream): the unified-pack qwen, built
// via ggufStreamFromPackModel. Falls back to null so the brain uses its own makeBrainRange+openGgufHoloStream path.
export function makePackGgufStream(modelId, { packSpec, fetchImpl, onSource } = {}) {
  return async ({ persist = null } = {}) => {
    try { const pack = await getQPack({ packSpec, fetchImpl }); const { ggufStreamFromPackModel } = await import("../gguf-forge-kstream.mjs");
      const view = pack.model(modelId); await view.ensureHeader?.();   // split-manifest: fetch the lazy GGUF header before planFrom
      try { onSource && onSource("gguf", modelId, "pack"); } catch {}
      return ggufStreamFromPackModel(view, { persist });
    } catch { try { onSource && onSource("gguf", modelId, "standalone"); } catch {} return null; }
  };
}

export function makePackEarDeps({ packSpec, fetchImpl, openStream, fetchBytes, onSource } = {}) {
  const note = (kind, name, src) => { try { onSource && onSource(kind, name, src); } catch {} };
  return {
    openStream: async (url, o) => {
      const e = EAR_BYNAME[basename(url)];
      if (e && e.kind === "stream") { try { const pack = await getQPack({ packSpec, fetchImpl }); const v = pack.model(e.model); await v.ensureHeader?.(); note("stream", basename(url), "pack"); return v; } catch {} }
      note("stream", basename(url), "standalone");
      if (openStream) return openStream(url, o);
      const { streamHolo } = await import("./holo-whisper-stream.mjs"); return streamHolo(url, o);
    },
    fetchBytes: async (url) => {
      const e = EAR_BYNAME[basename(url)];
      if (e && e.kind === "file") { try { const pack = await getQPack({ packSpec, fetchImpl }); const b = await pack.model(e.model).fileBody(e.file); note("file", basename(url), "pack"); return b; } catch {} }
      note("file", basename(url), "standalone");
      if (fetchBytes) return fetchBytes(url);
      const r = await fetch(url); if (!r.ok) throw new Error("fetch " + url + " " + r.status); return new Uint8Array(await r.arrayBuffer());
    },
  };
}

export default { getQPack, packModelFor, resetQPack, makePackEarDeps };
