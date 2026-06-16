// holo-onnx-kstore.mjs — the browser/Node twin of ari's `crates/hologram-ai/src/kstore.rs`
// (ADR-0101, Seam A — the browser half). It implements the SAME KappaStore contract over the
// OS2 κ-store so a `.holo` model is addressed by its κ, never a path, and the wasm
// `compile/run/generate(&[u8])` seam pulls archive bytes by κ.
//
// κ-PARITY (the load-bearing property): the κ minted here is `blake3:<hex>` over the archive
// bytes — byte-identical to ari's `hologram_archive::address_bytes`, because both are standard
// BLAKE3 and holo-blake3 is witnessed equal to the substrate's own kappa() (holo-blake3-witness).
// So an archive put in Rust resolves by the SAME κ here, and vice-versa.
//
//   Law L1 — identity is the κ-label, not a host/path/URL.
//   Law L2 — `put` re-derives the address from the bytes; identity is content.
//   Law L3 — the content-addressed store is the address space; identical bytes are stored once.
//   Law L5 — `get` re-derives every byte against its κ before yielding it; a tampered object is
//            refused, never returned (the bare holo-store leaves verify() to the caller; the
//            archive seam enforces it itself, matching FsKappaStore::get).

import { blake3hex, kappaBlake3 } from "./holo-blake3.mjs";
import { makeStore, idbBackend } from "./holo-store.js";

// A dedicated IndexedDB database for `.holo` archives, shared by the page (ingest) and the
// Service Worker (serve-by-κ). Its own DB (not the shared "holo" store) because models are large
// and because `idbBackend` opens at a fixed version — a separate DB creates its store cleanly on
// first open. The names are fixed so both contexts address the same objects.
export const ARCHIVE_DB = "holo-archives";
export const ARCHIVE_STORE = "archives";

const toBytes = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b));

/// The archive's κ-label: `blake3:<64hex>` over the bytes — the same address ari's
/// `archive_label` / `address_bytes` mints (re-derivable from the bytes alone, Law L2).
export function archiveLabel(bytes) {
  return kappaBlake3(toBytes(bytes));
}

/// A content-addressed `.holo` store: `put(bytes) → κ`, `get(κ) → Uint8Array | null`, `has(κ)`.
/// The twin of ari's `FsKappaStore` — same κ, same contract, with L5 re-derivation on read.
/// Backed by the OS2 κ-store (`holo-store.makeStore` over IndexedDB by default; pass a Map/mem
/// backend for Node witnesses).
export function makeArchiveStore({ backend } = {}) {
  const be = backend || idbBackend({ db: ARCHIVE_DB, store: ARCHIVE_STORE });
  const inner = makeStore({ hash: blake3hex, axis: "blake3", backend: be });
  return {
    /// Put archive bytes; return their κ (`blake3:<hex>`). Identical bytes share one slot (L3).
    put(bytes) {
      return inner.put(toBytes(bytes));
    },
    /// Resolve archive bytes by κ, re-deriving them against the κ first (Law L5). Returns a
    /// `Uint8Array`, or `null` if absent; throws if the stored bytes do not re-derive to `k`.
    async get(k) {
      const stored = await inner.get(k);
      if (stored == null) return null;
      const bytes = toBytes(stored);
      if (!(await inner.verify(k, bytes))) {
        throw new Error(
          `κ-object failed re-derivation (Law L5): claims ${k}, content is ${archiveLabel(bytes)}`,
        );
      }
      return bytes;
    },
    has(k) {
      return inner.has(k);
    },
  };
}

/// Put a compiled `.holo` into the κ-store; return its κ (twin of `HoloArchive::put`).
export function ingestHolo(store, bytes) {
  return store.put(toBytes(bytes));
}

/// Resolve a `.holo` by κ as a `Uint8Array` ready for the wasm verbs
/// (`compile/run/generate(&[u8])`). Throws if the store holds no archive at `k`
/// (twin of `HoloRunner::get` → "no .holo archive at κ").
export async function loadHoloByKappa(store, k) {
  const bytes = await store.get(k);
  if (bytes == null) throw new Error(`no .holo archive at κ ${k}`);
  return bytes;
}

/// One-time ingest of a *served* `.holo` (the migration off `fetch(path).arrayBuffer()`): fetch
/// the bytes ONCE — the network is an injected boundary, hit once (Law L4) — store them by κ, and
/// return the κ. After this the model is content-addressed; a re-open re-fetches nothing (L3).
export async function ingestUrl(store, url, { fetch: fetchImpl } = {}) {
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!f) throw new Error("ingestUrl: no fetch available; pass { fetch }");
  const resp = await f(url);
  if (!resp.ok) throw new Error(`ingestUrl: ${url} → HTTP ${resp.status}`);
  const bytes = new Uint8Array(await resp.arrayBuffer());
  return store.put(bytes);
}

/// The Service-Worker delivery seam (ADR-0026): given a blake3 hex (no `blake3:` prefix), return
/// the archive bytes from the κ-store, re-derived (L5), or `null` if not held here. The SW calls
/// this from its `/.holo/blake3/<hex>` route as a fallback when the OS closure has no such name,
/// so any ingested `.holo` is also reachable via `fetch('/.holo/blake3/<hex>')`.
export async function serveArchiveHex(store, hex) {
  return store.get(`blake3:${hex}`);
}

// ── Stage 3 (ADR-0101): range streaming — page a `.holo` by κ without it ever being page-resident ──
//
// The JS twin of the substrate `RangeResolver` trait. A streaming wasm load fetches weight bodies
// by byte range from the κ-store as the schedule references them, so the (multi-hundred-MB) archive
// itself need not be held in the page — the move that dodges the 2× peak and the 32-bit-tab ceiling.

/// Fetch the byte range `[offset, offset+len)` of an archive by κ via an HTTP `Range` request to the
/// SW κ-route (`/.holo/blake3/<hex>`). The SW answers `206` with exactly that range; a server that
/// ignores `Range` returns `200` and the full body, which we slice (correctness preserved either way).
export async function fetchArchiveRange(k, offset, len, { fetch: fetchImpl, route = "/" } = {}) {
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!f) throw new Error("fetchArchiveRange: no fetch available; pass { fetch }");
  const hex = k.startsWith("blake3:") ? k.slice("blake3:".length) : k;
  const url = `${route}.holo/blake3/${hex}`;
  const resp = await f(url, { headers: { Range: `bytes=${offset}-${offset + len - 1}` } });
  if (!resp.ok && resp.status !== 206) throw new Error(`fetchArchiveRange: ${url} → HTTP ${resp.status}`);
  const buf = new Uint8Array(await resp.arrayBuffer());
  return resp.status === 206 ? buf : buf.subarray(offset, offset + len);
}

/// A `RangeResolver` over the SW κ-store: `fetch(offset, len) → Uint8Array`, paging the archive `k`
/// by HTTP `Range` so it stays in the κ-store, never fully resident in the page. This is the transport
/// a streaming wasm `InferenceSession` load consumes (the JS twin of `hologram_archive::RangeResolver`).
export function makeRangeResolver(k, opts) {
  return { fetch: (offset, len) => fetchArchiveRange(k, offset, len, opts) };
}

/// A `RangeResolver` over a *resident* κ-store object — slices `store.get(k)`. The parity twin of the
/// substrate `SliceResolver` (and the deterministic, network-free path for Node witnesses). Useful when
/// the archive is already in the store; the HTTP resolver is the genuinely-non-resident case.
export function makeStoreRangeResolver(store, k) {
  return {
    async fetch(offset, len) {
      const all = await store.get(k);
      if (all == null) throw new Error(`no .holo archive at κ ${k}`);
      if (offset + len > all.length) throw new Error(`range past end of archive ${k}`);
      return all.subarray(offset, offset + len);
    },
  };
}
