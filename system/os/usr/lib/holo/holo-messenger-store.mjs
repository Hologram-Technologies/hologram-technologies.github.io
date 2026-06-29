// holo-messenger-store.mjs — the conversation's durable home: an OPFS-backed κ-store backend for
// holo-messenger-thread (Law L3 — the store IS the memory). Each conversation's signed source chain is
// AEAD-sealed under the operator's at-rest key and written to the Origin Private File System, so the
// conversation survives a reload / relaunch — on device, serverless, encrypted at rest (SEC-5).
//
// `holo-messenger-thread.makeThread({ backend })` already takes a { load, save } backend; this provides the
// OPFS one. The bytes are content-addressed (the file is named by the conversation's genesis κ tail);
// nothing in cleartext touches disk. Browser-only (OPFS); on a host without OPFS the caller falls back to
// the in-memory/IDB backend (honest degradation).
//
// At-rest key: PRODUCTION uses the operator's sovereign vault key (holo-session.activeCipher / the TEE-
// unlocked key), so only the operator can open it. The caller passes that 32-byte key in.
//
// Authority: holo-pqc (AES-256-GCM at rest) · OPFS (FileSystemSyncAccessHandle / createWritable) ·
//   holospaces Law L3 (store-as-memory) · SEC-5 (confidentiality at rest).

import { aeadSeal, aeadOpen } from "./holo-pqc.mjs";

const te = new TextEncoder();
const td = new TextDecoder();
const AAD = te.encode("holo-messenger/opfs/v1");
const DIR = "holo-messenger";
const hexTail = (genesis) => String(genesis).split(":").pop();

async function opfsDir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIR, { create: true });
}

export function opfsAvailable() {
  return typeof navigator !== "undefined" && navigator.storage && typeof navigator.storage.getDirectory === "function";
}

// makeOpfsBackend({ genesis, atRestKey }) → { load, save } for makeThread. The chain (array of signed
// entries) is sealed under atRestKey and written to OPFS as <genesis-tail>.holo; load opens it (fail-soft
// to [] if absent/unreadable — a fresh conversation).
export function makeOpfsBackend({ genesis, atRestKey } = {}) {
  if (!genesis || !atRestKey) throw new Error("opfs backend: genesis + atRestKey required");
  const name = hexTail(genesis) + ".holo";
  return {
    async load() {
      try {
        const dir = await opfsDir();
        const fh = await dir.getFileHandle(name);              // throws if absent → caught → []
        const bytes = new Uint8Array(await (await fh.getFile()).arrayBuffer());
        if (!bytes.length) return [];
        const sealed = JSON.parse(td.decode(bytes));
        const pt = await aeadOpen(atRestKey, sealed, AAD);      // throws on tamper / wrong key (fail-closed)
        const entries = JSON.parse(td.decode(pt));
        return Array.isArray(entries) ? entries : [];
      } catch (e) { return []; }
    },
    async save(entries) {
      try {
        const sealed = await aeadSeal(atRestKey, te.encode(JSON.stringify(entries || [])), AAD);
        const bytes = te.encode(JSON.stringify(sealed));
        const dir = await opfsDir();
        const fh = await dir.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        await w.write(bytes);
        await w.close();
      } catch (e) { /* best-effort; the in-memory chain is still authoritative this session */ }
    },
  };
}

if (typeof window !== "undefined" && !window.HoloMessengerStore) {
  window.HoloMessengerStore = { opfsAvailable, makeOpfsBackend };
}
