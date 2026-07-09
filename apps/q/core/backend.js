// core/backend.js — the durable byte backend for the κ-object store: IndexedDB via the OS
// runtime's _shared/holo-store.js (Law L3: the store is the memory; RAM is a bounded cache).
// Keys are κ hex strings (plus the one well-known boot-index pointer key). Same async shape
// as the witness's Map backend, so the L5 contract exercises identical code in both runtimes.

import { idbBackend } from "../_shared/holo-store.js";

export function kappaBackend() {
  const idb = idbBackend({ db: "holo-q", store: "kappa" });
  return {
    get: async (hex) => (await idb.get(hex)) || undefined,
    put: (hex, bytes) => idb.set(hex, bytes),
    getRaw: async (k) => (await idb.get(k)) || undefined,
    putRaw: (k, bytes) => idb.set(k, bytes),
    has: (k) => idb.has(k),
  };
}

// Storage usage for the Settings → Data tab (W3C StorageManager).
export async function storageEstimate() {
  try { const e = await navigator.storage.estimate(); return { usage: e.usage || 0, quota: e.quota || 0 }; }
  catch { return { usage: 0, quota: 0 }; }
}
