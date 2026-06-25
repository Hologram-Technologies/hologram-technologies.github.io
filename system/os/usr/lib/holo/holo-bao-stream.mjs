// holo-bao-stream.mjs — the CONSUMER side of verified streaming (the live-experience half). Admit a source
// of {index, bytes, proof} events for a κ-object (from the native host's kr_bao_encoder, a peer, or an
// in-page producer), VERIFY each against the SINGLE root κ (holo-bao, O(log n) per chunk), and hand it to a
// sink the INSTANT it verifies — so a surface renders frame 0 / plays second 0 / runs layer 0 before the
// object is whole, each chunk proven on arrival. Peak residency is ONE chunk + its proof (O(log n) bytes),
// never the object: this is what makes streaming a large κ-object integrity-safe without holding it. A bad
// chunk is REFUSED (throws, Law L5); chunks already delivered stand. Pure; reuses the one verifier.
//
// Cross-impl: the chunk/proof wire shape is byte-identical to kappa-route::bao (kr_bao_encoder_chunk /
// kr_bao_verify_slice), so a stream the native host PRODUCES is consumed+verified here and vice versa.

import { verifyChunk } from "./holo-bao.mjs";

const nowMs = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

// streamVerified(root, source, { onChunk, now }) → honest metrics.
//   root    : the object's κ (did:holo:blake3:… | blake3:… | bare hex) — every chunk verifies against THIS.
//   source  : a sync/async iterable of { index, bytes:Uint8Array, proof:[{side,cv}] } (the producer's stream).
//   onChunk(index, bytes) : the sink — called the instant a chunk verifies (render/play/run on arrival).
// Returns { firstChunkMs, totalMs, delivered, peakResidentBytes } — peak bytes the consumer ever held at once
// (one chunk + its proof), the bounded-residency proof. Throws on the first chunk that fails to verify (L5).
export async function streamVerified(root, source, { onChunk = null, now = nowMs } = {}) {
  const t0 = now();
  let firstChunkMs = null, delivered = 0, peakResidentBytes = 0;
  for await (const ev of source) {
    const bytes = ev.bytes instanceof Uint8Array ? ev.bytes : new Uint8Array(ev.bytes);
    const proofBytes = (ev.proof || []).length * 33;            // the only other thing resident: this chunk's proof
    peakResidentBytes = Math.max(peakResidentBytes, bytes.length + proofBytes);
    if (!verifyChunk(root, ev.index, bytes, ev.proof || []))
      throw new Error(`bao-stream: chunk ${ev.index} does not verify against the root κ (Law L5 — refused)`);
    if (firstChunkMs === null) firstChunkMs = now() - t0;        // time-to-first-VERIFIED-chunk (the felt latency)
    if (onChunk) onChunk(ev.index, bytes);                       // hand to the sink; we hold nothing after
    delivered++;
  }
  return { firstChunkMs: firstChunkMs ?? 0, totalMs: now() - t0, delivered, peakResidentBytes };
}

// hexToBytes — decode the wire/fixture hex form of a chunk's bytes.
export const hexToBytes = (h) => { const u = new Uint8Array(h.length / 2); for (let i = 0; i < u.length; i++) u[i] = parseInt(h.substr(i * 2, 2), 16); return u; };

// A proof sibling's chaining value travels in three shapes: holo-bao's native 8×u32 word array (in-page),
// 32 LE bytes (the kr_bao wire / fixture, as a Uint8Array or hex string). verifyChunk needs the word array;
// cvToWords normalizes any of them. normalizeProof maps a whole proof's siblings, leaving native ones as-is.
export function cvToWords(cv) {
  if (Array.isArray(cv) && cv.length === 8) return cv;                       // already holo-bao words
  const b = typeof cv === "string" ? hexToBytes(cv) : (cv instanceof Uint8Array ? cv : new Uint8Array(cv));
  const w = new Array(8);
  for (let j = 0; j < 8; j++) w[j] = (b[j * 4] | (b[j * 4 + 1] << 8) | (b[j * 4 + 2] << 16) | (b[j * 4 + 3] << 24)) >>> 0;
  return w;
}
export const normalizeProof = (proof) => (proof || []).map((s) => ({ side: s.side, cv: cvToWords(s.cv) }));

// unpackPackedProof(hex|bytes) → [{side, cv}] — parse the NATIVE wire proof the host emits (kr_bao_encoder
// / the holo:bao:chunk verb): N siblings × 33 bytes, each = 1 side byte ('L'=0x4c | 'R'=0x52) + 32 CV bytes.
// This is what lets a holo:// page consume a stream the native host PRODUCES (the live-experience seam).
export function unpackPackedProof(hexOrBytes) {
  const b = typeof hexOrBytes === "string" ? hexToBytes(hexOrBytes) : (hexOrBytes instanceof Uint8Array ? hexOrBytes : new Uint8Array(hexOrBytes));
  const out = [];
  for (let off = 0; off + 33 <= b.length; off += 33) out.push({ side: b[off] === 0x4c ? "L" : "R", cv: cvToWords(b.subarray(off + 1, off + 33)) });
  return out;
}

// fromHostVerb(call, root, chunkCount, { onChunk }) — drive the live native path: pull each chunk from the
// host's holo:bao:chunk verb (call(i) → { index, bytes:hex, proof:hex }), unpack, and stream-verify. `call`
// is the page's bridge invoker (window.cefQuery / HoloBridge) returning the parsed JSON for chunk i.
export async function* fromHostVerb(call, chunkCount) {
  for (let i = 0; i < chunkCount; i++) {
    const r = await call(i);
    yield { index: r.index ?? i, bytes: hexToBytes(r.bytes), proof: unpackPackedProof(r.proof) };
  }
}

// fromEncoded(encoded, { delayMs }) → an async source over a holo-bao `encode()` result (or a fixture object
// { root, chunks:[{index, bytes, proof}] }), optionally pacing delivery to model a wire. The chunk producer
// the consumer admits — in production this is the host's kr_bao_encoder_chunk feed or a peer's frames.
export async function* fromEncoded(obj, { delayMs = 0, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (const c of obj.chunks) {
    if (delayMs) await sleep(delayMs);
    yield { index: c.index, bytes: typeof c.bytes === "string" ? hexToBytes(c.bytes) : c.bytes, proof: normalizeProof(c.proof) };
  }
}

export default { streamVerified, fromEncoded, hexToBytes };
