// holo-bao.mjs — VERIFIED STREAMING over the BLAKE3 σ-axis (Bao). This is what lets the experience
// be streaming AND canonical at the same time: any 1024-byte chunk of a κ-object can be verified
// against the SINGLE root κ in O(log n) using its Merkle path — WITHOUT holding the whole object.
// So a consumer renders frame 0 / plays second 0 / runs layer 0 the instant the first chunk arrives,
// each chunk proven intact on arrival. SHA-256 (a linear hash) cannot do this; BLAKE3's binary tree
// of chunks can, and that tree already lives in holo-blake3.mjs — here we expose proofs over it.
//
// Soundness: each chunk's output node binds its index via the chunk counter (no reordering), the
// proof folds siblings up to the true root, and the ROOT flag is applied ONLY at the real top — so a
// subtree CV can never be passed off as the root, and a forged chunk+proof would require a BLAKE3
// collision. Pure; reuses the ONE hash implementation (Law L2). Node-, SW- and DOM-safe.

import {
  CHUNK_BYTES, chunkNode, parentNode, nodeChainingValue, nodeRootBytes, subtree,
} from "./holo-blake3.mjs";

const toHex = (d) => { let s = ""; for (let i = 0; i < 32; i++) s += d[i].toString(16).padStart(2, "0"); return s; };
const asU8 = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b));
const hexOf = (k) => String(k).split(":").pop().toLowerCase();

// rootHex(bytes) → the object's root κ hex (== blake3hex). The address the proofs verify against.
export function rootHex(bytes) { return toHex(nodeRootBytes(subtree(asU8(bytes), 0, asU8(bytes).length, 0))); }

// chunkCount(len) → number of 1024-byte chunks (≥1; the empty object is one zero-length chunk).
export const chunkCount = (len) => Math.max(1, Math.ceil(len / CHUNK_BYTES));

// proofFor(bytes, index) → { proof:[{side,cv}], chunkStart, chunkLen, counter } for absolute chunk
// `index`, walking the SAME left-balanced split as blake3()'s subtree(). Siblings are bottom-up.
function buildProof(bytes, start, len, counter, target) {
  if (len <= CHUNK_BYTES) return { proof: [], chunkStart: start, chunkLen: len, counter };
  let left = CHUNK_BYTES; while (left * 2 < len) left *= 2;     // largest power-of-two byte span < len
  const leftChunks = left / CHUNK_BYTES;
  if (target < counter + leftChunks) {                          // target in LEFT — sibling is the right subtree
    const res = buildProof(bytes, start, left, counter, target);
    res.proof.push({ side: "R", cv: nodeChainingValue(subtree(bytes, start + left, len - left, counter + leftChunks)) });
    return res;
  }
  const leftCV = nodeChainingValue(subtree(bytes, start, left, counter));   // target in RIGHT — sibling is the left subtree
  const res = buildProof(bytes, start + left, len - left, counter + leftChunks, target);
  res.proof.push({ side: "L", cv: leftCV });
  return res;
}
export function proofFor(bytes, index) {
  const b = asU8(bytes);
  if (index < 0 || index >= chunkCount(b.length)) throw new RangeError(`bao: chunk ${index} out of range`);
  return buildProof(b, 0, b.length, 0, index);
}

// verifyChunk(root, index, chunkBytes, proof) → bool. Recompute the chunk's node (binding index via
// counter), fold the proof siblings, apply ROOT only at the top, compare to root. Pure verifier — it
// holds no other bytes. A tampered chunk OR a wrong proof OR a wrong index fails; the rest stream on.
export function verifyChunk(root, index, chunkBytes, proof) {
  const want = hexOf(root);
  const node = chunkNode(asU8(chunkBytes), 0, asU8(chunkBytes).length, index);
  if (!proof || proof.length === 0) return toHex(nodeRootBytes(node)) === want;
  let cv = nodeChainingValue(node);
  for (let i = 0; i < proof.length; i++) {
    const s = proof[i];
    const parent = s.side === "L" ? parentNode(s.cv, cv) : parentNode(cv, s.cv);
    if (i === proof.length - 1) return toHex(nodeRootBytes(parent)) === want;
    cv = nodeChainingValue(parent);
  }
  return false;
}

// encode(bytes) → { root, len, chunks:[{index, bytes, proof}] } — a fully self-verifying stream. Each
// element carries exactly what a blind consumer needs to admit it against `root` alone. `proof` is the
// SIBLING ARRAY (the shape verifyChunk/verifiedChunks consume), not the proofFor wrapper — proofFor()
// returns { proof, chunkStart, chunkLen, counter } for random access; the stream event needs only .proof.
export function encode(bytes) {
  const b = asU8(bytes), n = chunkCount(b.length), root = rootHex(b);
  const chunks = [];
  for (let i = 0; i < n; i++) {
    const start = i * CHUNK_BYTES, end = Math.min(start + CHUNK_BYTES, b.length);
    chunks.push({ index: i, bytes: b.subarray(start, end), proof: proofFor(b, i).proof });
  }
  return { root, len: b.length, chunks };
}

// chunkRange(len, index) → [start, end) byte span of chunk `index` (for a server paging bytes on demand).
export const chunkRange = (len, index) => { const start = index * CHUNK_BYTES; return [start, Math.min(start + CHUNK_BYTES, len)]; };

// outboard(bytes) → { root, len, chunkCount, proofs:[siblingArray] } — the proof TREE without the bytes.
// Cache it by the object's root κ, and a server (or peer) can then serve a VERIFIED slice of an object
// whose bytes live elsewhere (origin/disk/peer) without re-hashing the whole object per request: pair
// proofs[index] with the bytes of chunkRange(len,index). This is the κ-store artifact that makes ranged
// blake3 delivery verifiable at chunk granularity (the dividend) rather than whole-object re-derivation.
export function outboard(bytes) {
  const b = asU8(bytes), n = chunkCount(b.length);
  const proofs = []; for (let i = 0; i < n; i++) proofs.push(proofFor(b, i).proof);
  return { root: rootHex(b), len: b.length, chunkCount: n, proofs };
}

// sliceFromOutboard(root, ob, index, chunkBytes) → chunkBytes if it verifies against `root` via the cached
// proof, else throws (Law L5). The serve primitive: the bytes came from anywhere; admit only if proven.
export function sliceFromOutboard(root, ob, index, chunkBytes) {
  if (!verifyChunk(root, index, chunkBytes, ob.proofs[index]))
    throw new Error(`bao: slice ${index} does not verify against ${hexOf(root).slice(0, 12)}… (L5 — refused)`);
  return asU8(chunkBytes);
}

// verifiedChunks(root, source) → async iterator yielding ONLY chunks that verify against `root`, in
// order. `source` is any (sync/async) iterable of { index, bytes, proof } (a network/peer stream). A
// chunk that fails verification is refused (throws) — streaming never admits an unverified byte (L5).
export async function* verifiedChunks(root, source) {
  for await (const ev of source) {
    if (!verifyChunk(root, ev.index, ev.bytes, ev.proof))
      throw new Error(`bao: chunk ${ev.index} does not verify against ${hexOf(root).slice(0, 12)}… (L5 — refused)`);
    yield ev;
  }
}

export default { rootHex, chunkCount, chunkRange, proofFor, verifyChunk, encode, outboard, sliceFromOutboard, verifiedChunks };
