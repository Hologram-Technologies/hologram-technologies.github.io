// holo-kappa-disk.js — the κ-addressable disk: the engine-agnostic substrate seam.
//
// A disk is an array of fixed-size blocks. Each block's IDENTITY is its κ — the
// hash of its bytes — so the device is content-addressed end to end:
//   • dedup      — identical blocks share one κ (write-once); a disk full of repeats
//                  costs one copy (Law L4, one content).
//   • sparse     — all-zero blocks map to the canonical zero-κ and are never stored;
//                  "the KappaStore IS the memory, RAM is a cache" (Law L3).
//   • verify     — every read re-hashes the bytes and checks they match the recorded
//                  κ before returning; a tampered/missing block fails closed (Law L5).
//
// This is the SAME κ-disk whether the execution engine is v86, qemu-wasm
// (a QEMU BlockDriver), or the holospaces native core (KappaBacking) — the engine is
// swappable, the substrate is not. `KappaBlockStore` is the verified core;
// `v86KappaBuffer` is a thin adapter to v86's async image-buffer interface.
//
// `hash` is injected (async (Uint8Array) -> hex string): crypto.subtle in the
// browser, node:crypto in tests — the κ is identical either way.

export class KappaBlockStore {
  constructor({ blockSize = 512, totalBytes, hash, backend } = {}) {
    if (!totalBytes) throw new Error("KappaBlockStore: totalBytes required");
    if (typeof hash !== "function") throw new Error("KappaBlockStore: hash fn required");
    this.blockSize = blockSize;
    this.byteLength = totalBytes;
    this.numBlocks = Math.ceil(totalBytes / blockSize);
    this._hash = hash;
    this._store = backend || new Map();   // κ(hex) -> Uint8Array (content-addressed)
    this._index = new Map();              // blockIndex -> κ(hex); absent ⇒ sparse zero
    this._zero = new Uint8Array(blockSize);
    this._zeroK = null;
    this.stats = { writes: 0, dedupHits: 0, reads: 0, sparseReads: 0, verifyFails: 0 };
  }

  get storedBlocks() { return this._store.size; }   // distinct κ blocks materialized

  async _zeroKappa() { if (this._zeroK == null) this._zeroK = await this._hash(this._zero); return this._zeroK; }

  // ── block-level (the κ core) ────────────────────────────────────────────────

  async writeBlock(i, bytes) {
    if (bytes.length !== this.blockSize) throw new Error(`writeBlock: expected ${this.blockSize} bytes`);
    this.stats.writes++;
    const k = await this._hash(bytes);
    const zk = await this._zeroKappa();
    if (k === zk) { this._index.delete(i); return; }   // sparse: never store zero blocks
    if (this._store.has(k)) this.stats.dedupHits++;     // dedup: identical content already κ
    else this._store.set(k, bytes.slice());
    this._index.set(i, k);
  }

  async readBlock(i) {
    this.stats.reads++;
    const k = this._index.get(i);
    if (k == null) { this.stats.sparseReads++; return this._zero.slice(); }   // sparse zero
    const bytes = this._store.get(k);
    if (bytes == null) { this.stats.verifyFails++; throw new Error(`κ missing for block ${i}`); }
    const actual = await this._hash(bytes);             // verify-before-use (L5)
    if (actual !== k) { this.stats.verifyFails++; throw new Error(`κ mismatch (tamper) at block ${i}`); }
    return bytes.slice();
  }

  // ── byte-range (what an emulator's disk driver calls) ───────────────────────

  async read(offset, len) {
    const out = new Uint8Array(len);
    let pos = 0;
    while (pos < len) {
      const bi = Math.floor((offset + pos) / this.blockSize);
      const within = (offset + pos) % this.blockSize;
      const chunk = Math.min(this.blockSize - within, len - pos);
      const block = await this.readBlock(bi);
      out.set(block.subarray(within, within + chunk), pos);
      pos += chunk;
    }
    return out;
  }

  async write(offset, data) {
    let pos = 0;
    while (pos < data.length) {
      const bi = Math.floor((offset + pos) / this.blockSize);
      const within = (offset + pos) % this.blockSize;
      const chunk = Math.min(this.blockSize - within, data.length - pos);
      if (within === 0 && chunk === this.blockSize) {
        await this.writeBlock(bi, data.subarray(pos, pos + chunk));     // whole-block fast path
      } else {
        const block = await this.readBlock(bi);                         // read-modify-write
        block.set(data.subarray(pos, pos + chunk), within);
        await this.writeBlock(bi, block);
      }
      pos += chunk;
    }
  }

  // Seal the current block→κ map as a manifest κ — a self-verifying snapshot of the
  // whole disk that re-derives (the basis of κ snapshot/resume + planetary sharing).
  async manifestKappa() {
    const entries = [...this._index.entries()].sort((a, b) => a[0] - b[0]);
    const s = entries.map(([i, k]) => `${i}:${k}`).join(",");
    return this._hash(new TextEncoder().encode(s));
  }
}

// Adapter to v86's async image-buffer interface (get/set/byteLength). v86 reads/writes
// disk ranges through this; we route every range through the κ store. (Callback shapes
// match v86's AsyncFileBuffer; confirm against the pinned v86 build when wiring.)
export function v86KappaBuffer(store) {
  return {
    byteLength: store.byteLength,
    get(offset, len, fn) { store.read(offset, len).then((d) => fn(d)).catch((e) => fn(e)); },
    set(offset, slice, fn) { store.write(offset, slice).then(() => fn && fn()).catch(() => fn && fn()); },
    get_buffer(fn) { store.read(0, store.byteLength).then((d) => fn(d)).catch(() => fn(null)); },
  };
}

// Browser κ: SHA-256 via WebCrypto → hex.
export async function subtleHashHex(bytes) {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  const v = new Uint8Array(buf);
  let h = "";
  for (let i = 0; i < v.length; i++) h += v[i].toString(16).padStart(2, "0");
  return h;
}
