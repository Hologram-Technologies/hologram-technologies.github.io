// holo-verified-stream.mjs — VERIFIED STREAMING of a κ-object (B3 of the BLAKE3-canonical milestone).
//
// A κ-object is delivered as BLAKE3-hashed content admitted CHUNK BY CHUNK: each 1024-byte chunk is proven
// against the SINGLE root κ via its bao Merkle path (O(log n)), so a consumer renders chunk 0 the instant
// it verifies and a tampered or truncated chunk is REFUSED at its boundary — never after the whole object
// (Law L5). SHA-256, a linear hash, cannot do this; BLAKE3's chunk tree (holo-bao) can. This closes the
// gap the κ-stream transport names but does not yet keep: its admit() re-derives the WHOLE object; here a
// blake3 κ is admitted per chunk. Pure glue over the ONE hash impl (L2); node-, Service-Worker- and DOM-safe.

import { encode, verifiedChunks, outboard, sliceFromOutboard, chunkCount } from "./holo-bao.mjs";

const hexOf = (k) => String(k).split(":").pop().toLowerCase();

// admitVerified(kappa, bytes, onChunk?) → Uint8Array — rebuild the object while ADMITTING each chunk against
// the root κ. The FIRST chunk that fails verification THROWS (L5): earlier chunks were already delivered,
// later chunks are never trusted. onChunk(index, chunkBytes) fires per verified chunk (progressive render).
// This is whole-object-in-hand verification at CHUNK granularity (refuse-early); consumeStream does it over
// the wire. Refuses up front if the bytes' own root κ ≠ the named κ (wrong object, before any chunk).
export async function admitVerified(kappa, bytes, onChunk = null) {
  const root = hexOf(kappa);
  const enc = encode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));   // {root,len,chunks:[{index,bytes,proof}]}
  if (enc.root !== root) throw new Error(`verified-stream: object root κ ${enc.root.slice(0, 12)}… ≠ named κ ${root.slice(0, 12)}… (L5 — refused)`);
  const out = new Uint8Array(enc.len); let off = 0;
  for await (const ev of verifiedChunks(root, enc.chunks)) { out.set(ev.bytes, off); off += ev.bytes.length; if (onChunk) onChunk(ev.index, ev.bytes); }
  return out;
}

// toBaoStream(bytes) → { root, len, chunks:[{index,bytes,proof}] } — the SELF-VERIFYING wire form. A static
// host serves it or a peer sends it; the consumer needs ONLY the root κ to admit every chunk (no outboard,
// no trust in the source). This is what makes a κ-object "streamed as BLAKE-hashed content" literally true.
export function toBaoStream(bytes) { return encode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)); }

// consumeStream(kappa, events, onChunk?) → Uint8Array — admit a (sync/async) stream of bao events against
// the root κ, in whatever order they arrive, and reassemble in index order. Each event is verified by its
// own proof (verifiedChunks); the first that fails THROWS (L5). This is the over-the-wire progressive path.
export async function consumeStream(kappa, events, onChunk = null) {
  const root = hexOf(kappa);
  const parts = [];
  for await (const ev of verifiedChunks(root, events)) { parts.push([ev.index, ev.bytes]); if (onChunk) onChunk(ev.index, ev.bytes); }
  parts.sort((a, b) => a[0] - b[0]);
  let total = 0; for (const [, b] of parts) total += b.length;
  const out = new Uint8Array(total); let off = 0; for (const [, b] of parts) { out.set(b, off); off += b.length; }
  return out;
}

// resolveStreamVerified({ base, kappa, fetchFn?, onChunk? }) → Uint8Array — fetch a κ-object FROM THE STORE
// (b/<blake3hex>, then /.holo/blake3/<hex>) and admit it chunk-by-chunk against its κ. The resolver's
// verified delivery for a blake3 κ: bytes from any source, admitted only if EVERY chunk proves (L5).
export async function resolveStreamVerified({ base, kappa, fetchFn = null, onChunk = null } = {}) {
  const f = fetchFn || ((u) => fetch(u));
  const hex = hexOf(kappa);
  const B = new URL(String(base || (typeof location !== "undefined" ? location.href : "")));
  let bytes = null;
  for (const u of [new URL("b/" + hex, B).href, new URL(".holo/blake3/" + hex, B).href]) {
    try { const r = await f(u); if (r && r.ok) { bytes = new Uint8Array(await r.arrayBuffer()); break; } } catch (e) {}
  }
  if (!bytes) throw new Error(`verified-stream: no store source served ${hex.slice(0, 12)}…`);
  return admitVerified("blake3:" + hex, bytes, onChunk);
}

export { chunkCount, outboard, sliceFromOutboard };
export default { admitVerified, toBaoStream, consumeStream, resolveStreamVerified, chunkCount };
