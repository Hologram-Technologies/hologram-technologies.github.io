// holo-store.js — the browser κ store. Durable, content-addressed storage keyed by κ.
// Same contract as holo-realization's memStore { put, get, has, verify } so the kernel
// is storage-agnostic and World gets a place to persist edits (the gap today: edits
// publish a κ with nowhere durable to land).
//
//   put(bytes) → κ   RE-DERIVES the address from the bytes (Law L2); identity is content.
//   get(κ)     → bytes | null   (verify with verify() before trusting — Law L5).
//   verify(κ, bytes) → bool      re-derive and compare; a tampered/mis-keyed blob fails.
//
// The durability backend is INJECTED (IndexedDB in the browser, a Map in tests), so the
// L5 contract is provable without a browser. The hash is the same SEAM as the kernel —
// pass the substrate's BLAKE3 for κ-parity; a structural hash works meanwhile.

export function makeStore({ hash, axis = "blake3", backend }) {
  const kappaOf = async (bytes) => `${axis}:${await hash(bytes)}`;
  return {
    async put(bytes) { const k = await kappaOf(bytes); await backend.set(k, bytes); return k; },
    async get(k) { return (await backend.get(k)) || null; },
    async has(k) { return backend.has ? await backend.has(k) : (await backend.get(k)) != null; },
    async verify(k, bytes) { return k === await kappaOf(bytes); },   // Law L5
  };
}

// IndexedDB backend (browser). One object store: κ-string → Uint8Array. Durable across
// reloads and tabs — the missing persistence layer under the World shell.
export function idbBackend({ db = "holo", store = "kappa" } = {}) {
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open(db, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(store)) r.result.createObjectStore(store); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = (mode, run) => open().then((d) => new Promise((res, rej) => {
    const t = d.transaction(store, mode), s = t.objectStore(store), rq = run(s);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  }));
  return {
    get: (k) => tx("readonly", (s) => s.get(k)),
    set: (k, bytes) => tx("readwrite", (s) => s.put(bytes, k)),
    has: (k) => tx("readonly", (s) => s.getKey(k)).then((v) => v != null),
    del: (k) => tx("readwrite", (s) => s.delete(k)),   // evict by κ (for content-addressed GC)
  };
}

// Map backend (Node witness / tests). Same async shape as IndexedDB so the kernel and
// the L5 contract exercise the identical code path.
export function memBackend() {
  const m = new Map();
  return {
    get: async (k) => m.get(k) || null,
    set: async (k, bytes) => { m.set(k, bytes); },
    has: async (k) => m.has(k),
    del: async (k) => { m.delete(k); },
  };
}
