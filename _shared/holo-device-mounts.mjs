// holo-device-mounts.mjs — REAL folders in the browser tier (Native Mirror N1). A mount is a
// FileSystemDirectoryHandle the USER granted via the platform's own ceremony (the directory picker,
// or dropping a folder) — persisted in IndexedDB, re-armed with one tap after a restart. The same
// W3C interface the OPFS home speaks, so the Files engine browses/writes mounts with the code it
// already has. Zero-dep, fail-open, honest:
//   • supported() is a fact, not a hope — no picker (Safari/Firefox/mobile) → callers say so.
//   • permission is the OS's ceremony: we never cache beyond what the platform grants; anything
//     not "granted" renders as a quiet re-connect affordance, never an error.
//   • REAL FILES ARE SACRED — this module never writes into a mount; it only stores handles.
//     (Writes happen in the engine, only from explicit user acts.)
//   • test seam: mountAdd(handle, name) accepts ANY directory handle — an OPFS dir IS one, which
//     is how the witness drives this headless (the real picker cannot be automated).

const DB = "holo-mounts", STORE = "mounts";

export const supported = () => { try { return typeof window !== "undefined" && "showDirectoryPicker" in window; } catch { return false; } };

function idb() {
  return new Promise((ok, bad) => {
    const q = indexedDB.open(DB, 1);
    q.onupgradeneeded = () => { q.result.createObjectStore(STORE, { keyPath: "id" }); };
    q.onsuccess = () => ok(q.result);
    q.onerror = () => bad(q.error);
  });
}
const tx = async (mode, fn) => {
  const db = await idb();
  try {
    return await new Promise((ok, bad) => {
      const t = db.transaction(STORE, mode), s = t.objectStore(STORE);
      const out = fn(s);
      t.oncomplete = () => ok(out && out.result !== undefined ? out.result : out);
      t.onerror = () => bad(t.error);
    });
  } finally { db.close(); }
};

// permission state for a handle: "granted" | "prompt" | "denied" — feature-detected (an OPFS/fake
// handle has no queryPermission → treated as granted; it IS same-origin storage).
export async function mountState(handle, mode = "read") {
  try { if (handle.queryPermission) return await handle.queryPermission({ mode }); } catch {}
  return "granted";
}

// ── the registry ─────────────────────────────────────────────────────────────────────────────────
export async function mounts() {
  let rows = [];
  try { rows = await tx("readonly", (s) => new Promise((ok) => { const q = s.getAll(); q.onsuccess = () => ok(q.result || []); })); } catch {}
  const out = [];
  for (const r of rows) out.push({ id: r.id, name: r.name, added: r.added, handle: r.handle, state: await mountState(r.handle) });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
export async function getMount(id) {
  try { const r = await tx("readonly", (s) => new Promise((ok) => { const q = s.get(id); q.onsuccess = () => ok(q.result); })); return r || null; } catch { return null; }
}

// mountAdd(handle, name?) — register ANY directory handle (picker result, drop result, or a test's
// OPFS dir). Dedup by isSameEntry when available; id is stable-random (not content-derived — a
// mount is a grant, not an address).
export async function mountAdd(handle, name) {
  if (!handle || handle.kind !== "directory") throw new Error("not a directory handle");
  try { for (const m of await mounts()) { if (m.handle.isSameEntry && await m.handle.isSameEntry(handle)) return m.id; } } catch {}
  const id = "m" + Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");
  await tx("readwrite", (s) => s.put({ id, name: String(name || handle.name || "Folder"), handle, added: 0 }));
  try { window.dispatchEvent(new CustomEvent("holo-mounts-changed")); } catch {}
  return id;
}

// mountPick() — the platform's own ceremony. readwrite asked up front so rename/new-folder work;
// the browser shows exactly what's granted. User cancel → null (not an error).
export async function mountPick() {
  if (!supported()) return null;
  let handle;
  try { handle = await window.showDirectoryPicker({ mode: "readwrite" }); }
  catch (e) { if (e && (e.name === "AbortError" || e.name === "NotAllowedError")) return null; throw e; }
  return mountAdd(handle);
}

// mountDrop(dataTransfer) — dropping a real folder mounts it (Chromium). Returns mounted ids.
export async function mountDrop(dt) {
  const ids = [];
  try {
    for (const item of (dt && dt.items) || []) {
      if (item.kind !== "file" || !item.getAsFileSystemHandle) continue;
      const h = await item.getAsFileSystemHandle();
      if (h && h.kind === "directory") ids.push(await mountAdd(h));
    }
  } catch {}
  return ids;
}

// remount(id) — one-tap re-arm after a restart (requestPermission needs a user gesture; call from a click).
export async function remount(id, mode = "readwrite") {
  const r = await getMount(id); if (!r) return "missing";
  try { if (r.handle.requestPermission) return await r.handle.requestPermission({ mode }); } catch {}
  return mountState(r.handle);
}

export async function unmount(id) {
  await tx("readwrite", (s) => s.delete(id));
  try { window.dispatchEvent(new CustomEvent("holo-mounts-changed")); } catch {}
}

// resolve a "mount:<id>/<rel/path>" node path → { handle(dir), rest } for the engine's walkers.
export async function mountResolve(path) {
  const m = String(path || "").match(/^mount:([a-z0-9]+)(?:\/(.*))?$/);
  if (!m) return null;
  const row = await getMount(m[1]); if (!row) return null;
  let d = row.handle;
  const parts = (m[2] || "").split("/").filter(Boolean);
  for (const p of parts) d = await d.getDirectoryHandle(p);
  return { id: m[1], dir: d, rest: parts };
}
