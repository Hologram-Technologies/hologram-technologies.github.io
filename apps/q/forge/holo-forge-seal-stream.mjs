// holo-forge-seal-stream.mjs — stream a model into a .holo on DISK, byte-identical to sealHolo,
// WITHOUT ever holding the whole model (or the whole output) in RAM.
//
// Why this exists: sealHolo (holo-forge-seal.mjs) allocates ONE Uint8Array(fileLen) and a Map of
// every body. For a ~5.5 GB model (a 9B @ Q4_K_M) fileLen exceeds V8's ArrayBuffer ceiling — so the
// in-memory path literally cannot PRODUCE the artifact. That is the wall between this stack and a 9B
// brain. Here the head+ext+meta+directory (KBs) are built in memory; the bodies are streamed from a
// bodySource in chunks; the footer sha256 is computed incrementally with node:crypto (byte-for-byte
// equal to holo-uor's sha256hex — holo-uor.mjs:9). Peak memory is one chunk. The output is the
// IDENTICAL archive openHoloStream/readHolo consume — proven byte-equal to sealHolo by
// holo-forge-seal-stream.test.mjs. Same byte layout as sealHolo (holo-forge-seal.mjs:37-87).
//
// bodySource: { stream(hex) -> AsyncIterable<Uint8Array|Buffer> } over the κ-store (the source GGUF,
// range-read). Bodies are emitted in FIRST-USE dedup order — exactly as sealHolo orders them.

import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { didHolo } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

const MAGIC = Buffer.from([0x48, 0x4f, 0x4c, 0x4f]);            // "HOLO"
const VERSION = 2;
const K = { Weights: 3, Metadata: 8, Extension: 14 };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n, 0); return b; };

// Pure: derive the exact prefix sealHolo would write BEFORE the body region (head + Extension + meta +
// weights directory), plus the unique-body order and total. Identical formula to sealHolo — only the
// bodies are deferred to a stream. No weight bytes are read here.
export function computeHoloPrefix({ arch, sourceRoot, tensors, extKey = "model.header", extBytes = new Uint8Array(0), extraMeta = {} }) {
  const order = [], seen = new Map();
  let bodyTotal = 0;
  for (const t of tensors) {
    const hex = String(t.kappa).split(":").pop();
    if (!seen.has(hex)) { seen.set(hex, { off: bodyTotal, len: t.nbytes }); bodyTotal += t.nbytes; }
    order.push({ name: t.name, kappa: hex });
  }
  const uniq = [...seen.entries()];                            // first-use insertion order

  const meta = JSON.stringify({ format: "holo/2", arch, sourceRoot, ...extraMeta, nTensors: tensors.length, nBodies: uniq.length, order });
  const metaBytes = Buffer.from(meta, "utf8");
  const extKeyBytes = Buffer.from(extKey, "utf8");
  const extPayload = Buffer.concat([u16(extKeyBytes.length), extKeyBytes, Buffer.from(extBytes)]);   // [keyLen][key][bytes]
  const dirCount = uniq.length;
  const dirBytes = 4 + dirCount * (32 + 8 + 8);
  const weightsLen = dirBytes + bodyTotal;

  const sectionCount = 3;
  const headSize = 4 + 2 + 2 + 2 + sectionCount * (1 + 8 + 8);
  const extOff = headSize, metaOff = extOff + extPayload.length, weightsOff = metaOff + metaBytes.length;
  const bodiesStart = weightsOff + dirBytes;
  const fileLen = bodiesStart + bodyTotal + 32;

  const head = Buffer.alloc(headSize);
  let p = 0;
  MAGIC.copy(head, p); p += 4;
  head.writeUInt16LE(VERSION, p); p += 2;
  head.writeUInt16LE(0, p); p += 2;                            // flags
  head.writeUInt16LE(sectionCount, p); p += 2;
  const sec = (kind, off, len) => { head.writeUInt8(kind, p); p += 1; head.writeBigUInt64LE(BigInt(off), p); p += 8; head.writeBigUInt64LE(BigInt(len), p); p += 8; };
  sec(K.Extension, extOff, extPayload.length);
  sec(K.Metadata, metaOff, metaBytes.length);
  sec(K.Weights, weightsOff, weightsLen);

  const dir = Buffer.alloc(dirBytes);
  let dp = 0;
  dir.writeUInt32LE(dirCount, dp); dp += 4;
  for (const [hex, info] of uniq) {
    Buffer.from(hex, "hex").copy(dir, dp); dp += 32;
    dir.writeBigUInt64LE(BigInt(bodiesStart + info.off), dp); dp += 8;
    dir.writeBigUInt64LE(BigInt(info.len), dp); dp += 8;
  }

  return { prefix: Buffer.concat([head, extPayload, metaBytes, dir]), uniq, bodyTotal, fileLen, nBodies: uniq.length, nTensors: tensors.length };
}

// Stream-seal to a file. Returns { rootHolo, nBodies, nTensors, bytes } exactly like sealHolo.
export async function sealHoloToFile({ outPath, bodySource, ...parts }) {
  const { prefix, uniq, fileLen, nBodies, nTensors } = computeHoloPrefix(parts);
  const hash = createHash("sha256");
  const fh = await open(outPath, "w");
  try {
    await fh.write(prefix); hash.update(prefix);
    for (const [hex, info] of uniq) {
      let n = 0;
      for await (const chunk of bodySource.stream(hex)) {
        const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        await fh.write(b); hash.update(b); n += b.length;
      }
      if (n !== info.len) throw new Error(`holo-forge-seal-stream: body ${hex} wrote ${n} != ${info.len}`);
    }
    const footHex = hash.digest("hex");                        // = sha256(everything-before) = did:holo
    await fh.write(Buffer.from(footHex, "hex"));
    return { rootHolo: didHolo("sha256", footHex), nBodies, nTensors, bytes: fileLen };
  } finally {
    await fh.close();
  }
}
