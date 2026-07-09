// Multi-part (split) GGUF reader. Large models ship as N files (llama.cpp `gguf-split`):
// each part is a self-describing GGUF with its OWN tensor subset (offsets into ITS data
// section) and `split.no` / `split.count` / `split.tensors.count` metadata. GLM-5.2
// UD-Q2_K_XL is 7 parts. This unions the parts into one logical model so the forge sees a
// single tensor set; the per-tensor bytes are read from the owning part.
//
// `split.*` keys are STORAGE metadata, not model identity — they are stripped from the
// returned `meta`, so a split model has the SAME hparams (and the same forge rootKappa) as
// the un-split original. holospaces github.com/Hologram-Technologies/holospaces.

import { parseGgufHeader } from "../qvac-ingest.mjs";

// parts: ordered [{ readRange(off,len)->Promise<Uint8Array>, headerBytes }] (part 0 first).
// Returns { meta (split.* stripped), version, tensors:[{name,dims,ggmlType,part,fileOffset}], parts:[{readRange}] }.
export function openGgufMultipart(parts) {
  if (!parts?.length) throw new Error("openGgufMultipart: no parts");
  const parsed = parts.map((p, i) => { const hdr = parseGgufHeader(p.headerBytes); return { i, readRange: p.readRange, hdr }; });
  const meta0 = parsed[0].hdr.meta;
  const count = meta0["split.count"] ?? parsed.length;
  if (count !== parts.length) throw new Error(`openGgufMultipart: split.count=${count} but ${parts.length} parts supplied`);
  // verify part indices 0..count-1 present in order (split.no), when declared
  parsed.forEach((p, i) => { const no = p.hdr.meta["split.no"]; if (no != null && no !== i) throw new Error(`openGgufMultipart: part ${i} declares split.no=${no}`); });

  const tensors = [], seen = new Set();
  for (const p of parsed) for (const t of p.hdr.tensors) {
    if (seen.has(t.name)) throw new Error(`openGgufMultipart: duplicate tensor '${t.name}' across parts`);
    seen.add(t.name);
    tensors.push({ name: t.name, dims: t.dims, ggmlType: t.ggmlType, part: p.i, fileOffset: p.hdr.dataOffset + t.offset });
  }
  const declared = meta0["split.tensors.count"];
  if (declared != null && tensors.length !== declared) throw new Error(`openGgufMultipart: ${tensors.length} tensors but split.tensors.count=${declared}`);

  const meta = {}; for (const k of Object.keys(meta0)) if (!k.startsWith("split.")) meta[k] = meta0[k];
  return { meta, version: parsed[0].hdr.version, tensors, parts: parsed.map((p) => ({ readRange: p.readRange })) };
}

// Read one block by its multipart dir entry {part,fileOffset,len} — dispatches to the owning part.
export const multipartReadBlock = (multipart) => (loc) => multipart.parts[loc.part].readRange(loc.fileOffset, loc.len);
