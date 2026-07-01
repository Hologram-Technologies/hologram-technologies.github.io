// holo-user-adapter.mjs — the LIFECYCLE for YOUR private per-user LoRA adapter: persist it ENCRYPTED at rest
// (session cipher → OPFS), load it back to bind into Q's brain (holo-brain-engine cfg.adapter, inference
// proven), and reset it. The adapter is a κ-object (κ = BLAKE3 of its .holo bytes = its identity); the stored
// blob is AES-GCM sealed under the operator's vault key, so a same-origin app reads only ciphertext. 100%
// local; nothing egresses. Pure + injectable (cipher + store) → Node-witnessable; browser defaults to
// holo-session.activeCipher + an OPFS file.
import { didHolo } from "./holo-uor.mjs";
import { blake3hex } from "./holo-blake3.mjs";

const OPFS_FILE = "holo.user-adapter.v1";   // one file in the origin's private OPFS

// browser OPFS store (read/write/remove a single sealed blob). Node/no-OPFS → null (caller injects a store).
function opfsStore() {
  const dir = async () => { try { return await navigator.storage.getDirectory(); } catch (e) { return null; } };
  return {
    async read() { try { const d = await dir(); if (!d) return null; const h = await d.getFileHandle(OPFS_FILE).catch(() => null); if (!h) return null; const f = await h.getFile(); return new Uint8Array(await f.arrayBuffer()); } catch (e) { return null; } },
    async write(blob) { try { const d = await dir(); if (!d) return false; const h = await d.getFileHandle(OPFS_FILE, { create: true }); const w = await h.createWritable(); await w.write(blob); await w.close(); return true; } catch (e) { return false; } },
    async remove() { try { const d = await dir(); if (d) await d.removeEntry(OPFS_FILE).catch(() => {}); return true; } catch (e) { return false; } },
  };
}
async function sessionCipher() { try { const m = await import("./holo-session.mjs"); return m.activeCipher ? (await m.activeCipher()).cipher : null; } catch (e) { return null; } }

// makeUserAdapterStore({ cipher, store }) — cipher() → {seal,open} (default: holo-session.activeCipher);
// store → {read,write,remove} (default: OPFS). Both injectable so the loop is Node-testable.
export function makeUserAdapterStore({ cipher = sessionCipher, store = null } = {}) {
  const S = store || opfsStore();
  return {
    // save(adapterBytes) — the .holo adapter bytes (from the training run). Sealed before storage. FAIL-CLOSED:
    // no cipher (locked) → returns null and writes NOTHING (never plaintext). Returns the adapter κ.
    async save(adapterBytes) {
      const u8 = adapterBytes instanceof Uint8Array ? adapterBytes : new Uint8Array(adapterBytes);
      const c = await cipher(); if (!c) return null;
      const blob = await c.seal(u8);
      const okw = await S.write(blob); if (!okw) return null;
      return { kappa: didHolo("blake3", blake3hex(u8)), bytes: u8.length };
    },
    // load() → { bytes, kappa } | null. Decrypts under the operator key; wrong key / tamper → null (L5).
    async load() {
      const blob = await S.read(); if (!blob) return null;
      const c = await cipher(); if (!c) return null;
      const bytes = await c.open(blob); if (!bytes) return null;          // can't decrypt → no adapter (correct)
      return { bytes, kappa: didHolo("blake3", blake3hex(bytes)) };
    },
    async has() { return !!(await S.read()); },
    async reset() { return S.remove(); },                                  // "reset what Q learned about me"
  };
}

// browser singleton + window surface (Q / the scheduler call save(); the brain-load calls load()).
let _store = null;
export const userAdapter = () => (_store || (_store = makeUserAdapterStore()));
if (typeof window !== "undefined" && !window.HoloUserAdapter) {
  window.HoloUserAdapter = Object.freeze({
    load: () => userAdapter().load(), has: () => userAdapter().has(), reset: () => userAdapter().reset(),
    save: (b) => userAdapter().save(b),
  });
}
export default makeUserAdapterStore;
