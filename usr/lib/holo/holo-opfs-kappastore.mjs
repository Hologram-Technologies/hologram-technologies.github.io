// holo-opfs-kappastore.mjs — the browser KappaStore backend (design -04-): a persistent,
// content-addressed store over the Origin Private File System (OPFS), implementing the holospaces
// KappaStore contract — put / get / contains / pin — keyed by content κ. Dual-axis (sha256 · blake3),
// matching the OS κ-route. This is what makes Law L3 ("the store is the memory") real in a browser
// tab: OPFS is the persistent address space, an in-memory map is its hot cache (RAM-as-cache).
//
// Verify boundary (cc29 / -03- C2): bytes enter ALREADY verified — put() derives the κ (content
// address), putVerified(axis,hex,…) stores under a κ the caller has already proven (the service
// worker's L5-verified path: it has the pinned κ, so it must not re-hash). In-store reads are
// trusted; the κ is the file NAME (re-derivable any time), never re-hashed per read.
//
// Layout is self-evident: <axis>/<hex[0:2]>/<hex[2:4]>/<hex> — a path names exactly one
// byte-sequence, identical bytes dedupe to one file. v1 uses async OPFS (createWritable) on the
// calling thread (works in window AND service-worker contexts); the -04- line-rate upgrade (Worker +
// createSyncAccessHandle + zero-copy SAB→GPU) is a perf swap behind this same contract.

const AXIS = "sha256";
const HOT_MAX = 128;
const KEY = (axis, hex) => `${axis}:${hex}`;
function parse(kappa) { const p = String(kappa).split(":"); const hex = p.pop(); const axis = p.pop() || AXIS; return { axis, hex }; }
async function sha256hex(u8) { const h = await crypto.subtle.digest("SHA-256", u8); return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, "0")).join(""); }

export class OpfsKappaStore {
  #root; #hot = new Map(); #pins = new Set();

  static async open(ns = "holo-kstore") {
    const s = new OpfsKappaStore();
    s.#root = await (await navigator.storage.getDirectory()).getDirectoryHandle(ns, { create: true });
    return s;
  }

  async #shard(axis, hex, create) {
    const a = await this.#root.getDirectoryHandle(axis, { create });
    const b = await a.getDirectoryHandle(hex.slice(0, 2), { create });
    return await b.getDirectoryHandle(hex.slice(2, 4), { create });
  }
  #hotSet(key, u8) {
    this.#hot.set(key, u8);
    if (this.#hot.size > HOT_MAX) for (const k of this.#hot.keys()) { if (!this.#pins.has(k)) { this.#hot.delete(k); break; } }
  }

  // store ALREADY-VERIFIED bytes under a known κ (axis, hex) — no re-derivation. The SW path: it holds
  // the pinned κ and has just re-derived it (Law L5), so re-hashing here would be wasteful and wrong
  // for the blake3 axis. Returns "<axis>:<hex>".
  async putVerified(axis, hex, bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const dir = await this.#shard(axis, hex, true);
    const fh = await dir.getFileHandle(hex, { create: true });
    const w = await fh.createWritable();
    await w.write(u8); await w.close();
    this.#hotSet(KEY(axis, hex), u8);
    return `${axis}:${hex}`;
  }

  // content-addressed put — derives the sha256 κ from the bytes (the KappaStore trait shape).
  async put(axis, bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const hex = await sha256hex(u8);
    return this.putVerified(axis || AXIS, hex, u8);
  }

  async getByKey(axis, hex) {
    const key = KEY(axis, hex);
    if (this.#hot.has(key)) return this.#hot.get(key).slice();
    try {
      const dir = await this.#shard(axis, hex, false);
      const u8 = new Uint8Array(await (await (await dir.getFileHandle(hex)).getFile()).arrayBuffer());
      this.#hotSet(key, u8);
      return u8.slice();
    } catch { return null; }
  }
  async get(kappa) { const { axis, hex } = parse(kappa); return this.getByKey(axis, hex); }

  async hasKey(axis, hex) {
    if (this.#hot.has(KEY(axis, hex))) return true;
    try { const dir = await this.#shard(axis, hex, false); await dir.getFileHandle(hex); return true; } catch { return false; }
  }
  async contains(kappa) { const { axis, hex } = parse(kappa); return this.hasKey(axis, hex); }

  pin(kappa) { const { axis, hex } = parse(kappa); this.#pins.add(KEY(axis, hex)); }
  unpin(kappa) { const { axis, hex } = parse(kappa); this.#pins.delete(KEY(axis, hex)); }

  async evict(kappa) {
    const { axis, hex } = parse(kappa); const key = KEY(axis, hex);
    if (this.#pins.has(key)) return false;
    this.#hot.delete(key);
    try { const dir = await this.#shard(axis, hex, false); await dir.removeEntry(hex); return true; } catch { return false; }
  }
}

// A minimal in-memory reference with the SAME contract + κ derivation — the differential oracle (the
// holospaces MemKappaStore analog).
export class MemKappaStore {
  #m = new Map(); #pins = new Set();
  static async open() { return new MemKappaStore(); }
  async put(axis, bytes) { const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); const hex = await sha256hex(u8); this.#m.set(KEY(axis || AXIS, hex), u8.slice()); return `${axis || AXIS}:${hex}`; }
  async get(kappa) { const { axis, hex } = parse(kappa); const u8 = this.#m.get(KEY(axis, hex)); return u8 ? u8.slice() : null; }
  async contains(kappa) { const { axis, hex } = parse(kappa); return this.#m.has(KEY(axis, hex)); }
  pin(kappa) { const { axis, hex } = parse(kappa); this.#pins.add(KEY(axis, hex)); }
  unpin(kappa) { const { axis, hex } = parse(kappa); this.#pins.delete(KEY(axis, hex)); }
}
