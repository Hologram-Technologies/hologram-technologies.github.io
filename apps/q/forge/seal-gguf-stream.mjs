// seal-gguf-stream.mjs — forge a (multi-GB) GGUF into a κ-addressable .holo by STREAMING, end to end.
//   node seal-gguf-stream.mjs <in.gguf> <out.holo>
//
// The streaming twin of forge-gguf-holo.mjs. That one does readFileSync(IN) + in-memory sealHolo —
// fine to ~2 GB, impossible at 5.5 GB (a 9B @ Q4_K_M). This path:
//   1. reads only the header, parses tensor infos,
//   2. forgeGgufScan: hashes each tensor span ONCE to derive its κ (peak mem = largest tensor),
//   3. sealHoloToFile: writes the .holo body-by-body straight to disk (peak mem = one chunk).
// Never holds the whole model or the whole archive. Output is byte-identical to forge-gguf-holo.mjs's
// in-memory seal (proven equal to sealHolo by holo-forge-seal-stream.test.mjs).
//
// Next steps after this emits <out.holo>: shard <2 GiB for delivery (q-models pack convention), pin to
// IPFS, then register the archive κ printed below into holo-q-mux PINNED + holo-q-faculty-models FILE.

import { open } from "node:fs/promises";
import { forgeGgufScan } from "./gguf-forge.mjs";
import { parseGgufHeader } from "../qvac-ingest.mjs";
import { sealHoloToFile } from "./holo-forge-seal-stream.mjs";

const IN = process.argv[2], OUT = process.argv[3];
if (!IN || !OUT) { console.error("usage: node seal-gguf-stream.mjs <in.gguf> <out.holo>"); process.exit(1); }

const CHUNK = 8 * 1024 * 1024;
const fh = await open(IN, "r");
try {
  const { size } = await fh.stat();
  const readRange = async (off, len) => {
    const buf = Buffer.allocUnsafe(len);
    let got = 0;
    while (got < len) { const { bytesRead } = await fh.read(buf, got, len - got, off + got); if (bytesRead === 0) break; got += bytesRead; }
    if (got !== len) throw new Error(`seal-gguf-stream: short read @${off} ${got}/${len}`);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  };

  // Read enough of the head to cover ALL tensor infos (they end exactly at dataOffset). Grow on miss.
  let headLen = Math.min(size, 64 * 1024 * 1024), header, dataOffset;
  for (;;) {
    header = await readRange(0, headLen);
    try { dataOffset = parseGgufHeader(header).dataOffset; if (dataOffset <= headLen) break; } catch { /* grow */ }
    if (headLen >= size) throw new Error("seal-gguf-stream: could not parse GGUF header within file");
    headLen = Math.min(size, headLen * 2);
  }

  const t0 = Date.now();
  const scan = await forgeGgufScan(readRange, { headerBytes: header });   // tensors + dir{hex->{fileOffset,len}}, no bodies held
  const bodySource = {
    async *stream(hex) {
      const { fileOffset, len } = scan.dir[hex];
      for (let o = 0; o < len; o += CHUNK) yield await readRange(fileOffset + o, Math.min(CHUNK, len - o));
    },
  };

  const r = await sealHoloToFile({
    outPath: OUT, bodySource,
    arch: scan.arch, sourceRoot: scan.rootKappa, tensors: scan.tensors,
    extKey: "gguf.header", extBytes: header.subarray(0, scan.dataOffset),
  });

  const base = (s) => s.split(/[\\/]/).pop();
  console.log(`forged ${base(IN)} → ${base(OUT)}`);
  console.log(`  ${(r.bytes / 1e6).toFixed(1)} MB · ${r.nTensors} tensors · ${r.nBodies} κ-bodies · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`  arch       ${scan.arch}`);
  console.log(`  archive κ  ${r.rootHolo}`);
} finally {
  await fh.close();
}
