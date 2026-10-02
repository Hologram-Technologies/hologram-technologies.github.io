// holo-home-ingest.mjs — THE ONE WRITE DOOR into the user's home (the Files "one plane" weld, F1).
// Any surface that produces bytes a person would call "my file" — a received chat image, a saved
// attachment, a downloaded page — calls homeIngest() and the file exists in the SAME OPFS home the
// Files explorer lists (Home = the OPFS root; holo-files.js listHome). Three layers, guest-first:
//
//   1. bytes → a REAL file at /<dir>/<name> (visible in Files with zero UI work, works for guests)
//   2. κ-index (.holo-kappa-index.json at the OPFS root, dot-hidden from listings): path →
//      { kappa:"sha256:<hex>", bytes, mtime } — how listHome EARNS a κ chip (freshness-checked:
//      a file edited outside the door loses its chip rather than wearing a stale one)
//   3. save-first, seal-async: the write NEVER waits on (or fails for) hashing — a user's byte is
//      never lost to ceremony. The returned `sealed` promise resolves when the κ is recorded.
//
// Deliberately ZERO-dep (crypto.subtle only) so the messenger bundle imports it for pennies and it
// ships to a static mount as one file. The signed personal-cloud manifest (holo-home.mjs, operator
// strand) can layer ABOVE this door later — it must never gate a guest save.

const INDEX = ".holo-kappa-index.json";
const HOME_PREFIX = "/home/user";   // how holo-files.js names the OPFS root in node paths

const enc = new TextEncoder();
const toU8 = async (input) => {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof Blob !== "undefined" && input instanceof Blob) return new Uint8Array(await input.arrayBuffer());
  if (typeof input === "string") return enc.encode(input);
  throw new Error("homeIngest: unsupported byte source");
};
async function sha256hex(u8) {
  const h = await crypto.subtle.digest("SHA-256", u8);
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, "0")).join("");
}

const root = () => navigator.storage.getDirectory();
async function ensureDir(parts) {
  let d = await root();
  for (const p of parts) if (p) d = await d.getDirectoryHandle(p, { create: true });
  return d;
}

// ── the κ-index: one small JSON at the OPFS root. Writes serialize through the Web Locks API when
// available (this module is served under TWO path aliases — /_shared/ and /usr/lib/holo/ — so two
// instances can coexist; a named lock makes read-modify-write atomic across them AND across tabs),
// with a same-instance promise chain as the fallback. Corruption tolerated → fresh index.
let _chain = Promise.resolve();
const withIndex = (fn) => {
  const run = (navigator.locks && navigator.locks.request)
    ? () => navigator.locks.request("holo-kappa-index", fn)
    : fn;
  return (_chain = _chain.catch(() => {}).then(run));
};
async function readIndex() {
  try {
    const fh = await (await root()).getFileHandle(INDEX);
    return JSON.parse(await (await fh.getFile()).text()) || {};
  } catch { return {}; }
}
async function writeIndex(idx) {
  const fh = await (await root()).getFileHandle(INDEX, { create: true });
  const w = await fh.createWritable();
  await w.write(JSON.stringify(idx)); await w.close();
}

// sanitize a filename: strip path separators + control chars, keep it honest and short.
const cleanName = (n) => [...String(n || "file")].filter((c) => c.charCodeAt(0) > 31 && c !== "/" && c !== "\\").join("").slice(0, 180) || "file";

// ── homeIngest(bytes|Blob|string, {name, dir="Downloads", from}) → {path, name, dir, sealed}
// `sealed` resolves to { kappa, did, hex, deduped } once the κ is derived + indexed (or null on a
// hashing failure — the FILE is still saved; chips are earned, saves are unconditional).
// Identical bytes already at the same destination name → dedup (no " (2)" copy); a name collision
// with DIFFERENT bytes gets " (2)", " (3)", … (the WhatsApp/desktop convention).
export async function homeIngest(input, opts = {}) {
  const u8 = await toU8(input);
  const dir = String(opts.dir || "Downloads").replace(/^\/+|\/+$/g, "");
  const parts = dir.split("/").filter(Boolean);
  const d = await ensureDir(parts);

  // pick the final name: dedup identical bytes, suffix differing collisions.
  let name = cleanName(opts.name);
  const stem = name.replace(/(\.[^.]{1,8})$/, ""), ext = (name.match(/(\.[^.]{1,8})$/) || ["", ""])[1];
  let deduped = false;
  for (let i = 2; i < 100; i++) {
    let existing = null;
    try { existing = await (await d.getFileHandle(name)).getFile(); } catch {}
    if (!existing) break;
    if (existing.size === u8.byteLength) {
      const hex = await sha256hex(new Uint8Array(await existing.arrayBuffer())).catch(() => null);
      if (hex && hex === await sha256hex(u8)) { deduped = true; break; }   // same bytes already home
    }
    name = `${stem} (${i})${ext}`;
  }

  const path = `${HOME_PREFIX}/${parts.join("/")}/${name}`.replace(/\/+/g, "/");
  let file;
  if (!deduped) {
    const fh = await d.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(u8); await w.close();
    file = await fh.getFile();
  } else {
    file = await (await d.getFileHandle(name)).getFile();
  }

  // seal async — never blocks, never throws out of the save.
  const sealed = (async () => {
    try {
      const hex = await sha256hex(u8);
      await withIndex(async () => {
        const idx = await readIndex();
        idx[path] = { kappa: "sha256:" + hex, bytes: file.size, mtime: file.lastModified, from: String(opts.from || "") };
        await writeIndex(idx);
      });
      try { window.dispatchEvent(new CustomEvent("holo-home-ingest", { detail: { path, name, hex } })); } catch {}
      return { kappa: "sha256:" + hex, did: "did:holo:sha256:" + hex, hex, deduped };
    } catch { return null; }
  })();

  return { path, name, dir: parts.join("/"), sealed };
}

// ── homeSeal(path, file) — record the seal for an ALREADY-written home file (the Files engine's own
// write primitives call this fire-and-forget after their own createWritable). Never throws.
export async function homeSeal(path, file) {
  try {
    const u8 = new Uint8Array(await file.arrayBuffer());
    const hex = await sha256hex(u8);
    await withIndex(async () => {
      const idx = await readIndex();
      idx[path] = { kappa: "sha256:" + hex, bytes: file.size, mtime: file.lastModified, from: "files" };
      await writeIndex(idx);
    });
    return "did:holo:sha256:" + hex;
  } catch { return ""; }
}

// ── homeIndex() → the current path→{kappa,bytes,mtime} map (listHome consults this for chips).
export async function homeIndex() { return readIndex(); }

// ── homeKappaOf(path, {size, mtime}) → "did:holo:sha256:<hex>" IFF the index entry is still fresh
// (size+mtime match) — a chip is earned, never assumed. Freshness args optional (then trusted).
export function kappaFromIndex(idx, path, size, mtime) {
  const e = idx && idx[path];
  if (!e || !e.kappa) return "";
  if (size != null && e.bytes !== size) return "";
  if (mtime != null && e.mtime !== mtime) return "";
  return "did:holo:" + e.kappa;
}

// ── homeResolve(kappaOrHex) → { bytes, path, name, verified } — find the file by κ, RE-DERIVE
// before returning (file-level Law L5: a renamed/edited file can never impersonate its old κ).
export async function homeResolve(kappaOrHex) {
  const hex = String(kappaOrHex || "").split(":").pop().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  const idx = await readIndex();
  for (const [path, e] of Object.entries(idx)) {
    if (String(e.kappa || "").split(":").pop() !== hex) continue;
    try {
      const parts = path.replace(HOME_PREFIX, "").split("/").filter(Boolean);
      const name = parts.pop();
      let d = await root();
      for (const p of parts) d = await d.getDirectoryHandle(p);
      const file = await (await d.getFileHandle(name)).getFile();
      const u8 = new Uint8Array(await file.arrayBuffer());
      if (await sha256hex(u8) !== hex) return { bytes: null, path, name, verified: false };   // refuse: drifted
      return { bytes: u8, path, name, verified: true };
    } catch { /* stale index row → keep scanning */ }
  }
  return null;
}
