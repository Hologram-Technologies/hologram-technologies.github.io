// holo-files.js — Holo Files: the substrate-native filesystem MODEL behind the Holo Files
// explorer (the in-browser "Files" of Hologram OS). It is the engine; apps/files/index.html is
// the chrome. One window onto the OS's whole content-addressed object universe — every node a
// self-verifying UOR object (Law L1: identity = content address) — plus the user's writable
// OPFS home. Pure DOM + Web Crypto + W3C OPFS, no framework, no CDN (Law L4).
//
// Sources unified into ONE navigable tree (a real Files "sidebar"):
//   • Home          — the user's writable space, OPFS-backed (/home/user). read + WRITE.
//   • This Hologram  — the Linux-FHS root as the live content-addressed graph (index.jsonld).
//   • Holospaces     — every app in the catalog; drill in → its holospace.lock.json closure.
//   • OS Runtime     — the OS-wide closure (etc/os-closure.json): every shipped file, path→κ.
//   • Recents        — session history of what you opened.
//
// Everything else is read-only and content-addressed (immutable by definition); only Home is
// mutable. Every file node carries its did:holo κ and re-derives on demand (Law L5: verify by
// re-derivation — a tampered byte refuses). The platform profile (holo-platform.js) makes the
// shell feel NATIVE — Finder on macOS, Explorer/Files on Windows, Files on Android/iOS,
// Nautilus/Dolphin on Linux — same model, host-matched chrome.

import { profileFor } from "./holo-platform.js";

const W = typeof window !== "undefined" ? window : globalThis;
const enc = new TextEncoder();

// ── content-addressing primitive (Law L2: one canonical hash) ─────────────────────────────
// Prefer the engine's HoloObject if present; else Web Crypto directly. sha256 hex of bytes.
async function sha256hex(bytes) {
  if (W.HoloObject && W.HoloObject.sha256hex) return W.HoloObject.sha256hex(bytes);
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.prototype.map.call(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
const hexOf = (kappa) => String(kappa || "").split(":").pop();
const noStore = { cache: "no-store" };

// ── the FHS skeleton — name · role · kind, mirrored from tools/gen-fhs-graph.mjs (the LABEL
// layer). The live κ + members (apps/files) are fetched from each dir's index.jsonld at runtime,
// so the address shown is the real, verifiable object — the path is only a projection. ───────
const FHS = {
  name: "Hologram OS", fhs: "/", kind: "content", role: "the OS root — one did:holo, one self-verifying Merkle-DAG; boots from a single κ",
  children: [
    { name: ".well-known", fhs: "/.well-known", kind: "content", role: "RFC 8615 — the interop & agent doors (agents.json · mcp.json · did.json)" },
    { name: "boot", fhs: "/boot", kind: "content", role: "boot loader + kernel → boot-from-κ: the κ-route service worker + the Linux VM image as pins" },
    { name: "bin", fhs: "/bin", kind: "content", role: "essential user commands → core command κ-objects every holospace can invoke" },
    { name: "sbin", fhs: "/sbin", kind: "content", role: "essential system binaries → the resolution spine (resolver · sources · peers)" },
    { name: "lib", fhs: "/lib", kind: "content", role: "libraries for /bin and /sbin → the boot-critical runtime (κ-route SW, launch)" },
    { name: "etc", fhs: "/etc", kind: "content", role: "host configuration, no secrets → manifests · capability policy · the Constitution" },
    { name: "home", fhs: "/home", kind: "state", role: "user home directories → per-user OPFS namespace, default-deny holospace sandbox",
      children: [{ name: "user", fhs: "/home/user", kind: "state", role: "the user's writable space — OPFS-backed, content sealed on write", opfs: true }] },
    { name: "usr", fhs: "/usr", kind: "content", role: "shareable, READ-ONLY data ≡ the content-addressed (κ) hierarchy — identical on any peer",
      children: [
        { name: "bin", fhs: "/usr/bin", kind: "content", role: "non-essential user commands → app launchers · hologram-mcp" },
        { name: "lib", fhs: "/usr/lib", kind: "content", role: "/usr libraries",
          children: [{ name: "holo", fhs: "/usr/lib/holo", kind: "content", role: "the _shared OS runtime kit (ui-kernel · theme · object · icons)" }] },
        { name: "share", fhs: "/usr/share", kind: "content", role: "architecture-independent data → the apps + assets as κ-containers",
          children: [
            { name: "frame", fhs: "/usr/share/frame", kind: "content", role: "the desktop template — world · holospace · home · find" },
            { name: "holospaces", fhs: "/usr/share/holospaces", kind: "content", role: "the core holospaces — each a self-contained, portable κ-container" },
            { name: "icons", fhs: "/usr/share/icons", kind: "content", role: "content-addressed icon sets" },
            { name: "ns", fhs: "/usr/share/ns", kind: "content", role: "the minted OWL ontologies (hosfs: · hosc:) — dereferenceable vocabularies" },
            { name: "shapes", fhs: "/usr/share/shapes", kind: "content", role: "the W3C SHACL shapes the witnesses validate against" },
          ] },
      ] },
    { name: "opt", fhs: "/opt", kind: "pin", role: "add-on application packages → optional holospaces, installed BY κ on demand" },
    { name: "srv", fhs: "/srv", kind: "state", role: "data served by this system → the holospaces this node serves to peers (IPFS/mesh)" },
    { name: "var", fhs: "/var", kind: "state", role: "variable data → mutable substrate state",
      children: [
        { name: "cache", fhs: "/var/cache", kind: "ephemeral", role: "the κ-cache (Cache API, read-through, re-derived)" },
        { name: "lib", fhs: "/var/lib", kind: "state", role: "persistent holospace state" },
        { name: "log", fhs: "/var/log", kind: "state", role: "run / witness / telemetry logs" },
      ] },
    { name: "root", fhs: "/root", kind: "state", role: "superuser home → the operator (Platform Manager) space" },
    { name: "mnt", fhs: "/mnt", kind: "mount", role: "temporary mount point → attach a peer κ-store or a guest rootfs at runtime" },
    { name: "media", fhs: "/media", kind: "mount", role: "removable media → peer / IPFS volumes mounted live" },
    { name: "run", fhs: "/run", kind: "ephemeral", role: "run-time state since boot (tmpfs) → live sessions · sockets · the mesh" },
    { name: "tmp", fhs: "/tmp", kind: "ephemeral", role: "temporary files (tmpfs) — cleared on boot" },
    { name: "dev", fhs: "/dev", kind: "virtual", role: "device nodes — synthesized by the VM (virtio: blk→κ-disk · net→relay · 9p→workspace)" },
    { name: "proc", fhs: "/proc", kind: "virtual", role: "process/kernel info — the live holospace process model" },
    { name: "sys", fhs: "/sys", kind: "virtual", role: "hardware/resource tree — the CapabilitySet budgets (resource management)" },
  ],
};
const fhsIndex = (() => { const m = new Map(); (function walk(n) { m.set(n.fhs, n); (n.children || []).forEach(walk); })(FHS); return m; })();

// ── MIME / type classification — by extension; drives the file glyph + preview mode ─────────
const EXT_KIND = {
  html: "code", htm: "code", js: "code", mjs: "code", ts: "code", css: "code", json: "data", jsonld: "data",
  md: "text", txt: "text", csv: "data", xml: "code", yaml: "data", yml: "data", hc: "code", rs: "code", toml: "data",
  svg: "image", png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", ico: "image", avif: "image",
  mp3: "audio", wav: "audio", ogg: "audio", flac: "audio", mp4: "video", webm: "video", mov: "video",
  wasm: "binary", gz: "archive", zip: "archive", tar: "archive", pdf: "doc", woff: "font", woff2: "font", ttf: "font",
};
const MIME = {
  html: "text/html", htm: "text/html", js: "text/javascript", mjs: "text/javascript", css: "text/css",
  json: "application/json", jsonld: "application/ld+json", md: "text/markdown", txt: "text/plain", csv: "text/csv",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  ico: "image/x-icon", wasm: "application/wasm", pdf: "application/pdf", mp4: "video/mp4", webm: "video/webm",
  mp3: "audio/mpeg", wav: "audio/wav", woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf",
};
export const extOf = (name) => { const m = /\.([a-z0-9]+)$/i.exec(name || ""); return m ? m[1].toLowerCase() : ""; };
export const kindOf = (name) => EXT_KIND[extOf(name)] || "file";
export const mimeOf = (name) => MIME[extOf(name)] || "application/octet-stream";
export function fmtBytes(n) {
  if (n == null || n < 0) return "";
  if (n < 1024) return n + " B";
  const u = ["KB", "MB", "GB", "TB"]; let i = -1, v = n;
  do { v /= 1024; i++; } while (v >= 1024 && i < u.length - 1);
  return (v < 10 ? v.toFixed(1) : Math.round(v)) + " " + u[i];
}

// ── node model — one shape for every source. `kind`: location|dir|file|app. ─────────────────
let _id = 0;
const node = (o) => ({ id: "n" + ++_id, name: "", path: "", kind: "file", source: "", did: "", bytes: null, mime: "", writable: false, role: "", ...o });

// ── OPFS (Home) — the one writable plane (W3C File System Access / OPFS) ─────────────────────
async function opfsRoot() { if (!(navigator.storage && navigator.storage.getDirectory)) throw new Error("OPFS unavailable"); return navigator.storage.getDirectory(); }
async function opfsResolve(parts) { let dir = await opfsRoot(); for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: false }); return dir; }
// path under home, e.g. "/home/user/docs" → ["docs"]
const homeParts = (path) => path.replace(/^\/home\/user\/?/, "").split("/").filter(Boolean);

async function listHome(path) {
  const dir = await opfsResolve(homeParts(path));
  const out = [];
  for await (const [name, h] of dir.entries()) {
    if (h.kind === "directory") out.push(node({ name, path: path.replace(/\/$/, "") + "/" + name, kind: "dir", source: "opfs", writable: true, role: "folder" }));
    else { let bytes = null, did = ""; try { const f = await h.getFile(); bytes = f.size; } catch {} out.push(node({ name, path: path.replace(/\/$/, "") + "/" + name, kind: "file", source: "opfs", bytes, did, mime: mimeOf(name), writable: true })); }
  }
  return sortNodes(out);
}
async function readHome(pathParts, name) { const dir = await opfsResolve(pathParts); const fh = await dir.getFileHandle(name, { create: false }); return (await fh.getFile()); }
export async function mkdir(parentPath, name) { const dir = await opfsResolve(homeParts(parentPath)); await dir.getDirectoryHandle(name, { create: true }); }
export async function createFile(parentPath, name, contents = "") {
  const dir = await opfsResolve(homeParts(parentPath)); const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable(); await w.write(typeof contents === "string" ? contents : new Blob([contents])); await w.close();
}
export async function writeFile(path, contents) {
  const parts = homeParts(path); const name = parts.pop(); const dir = await opfsResolve(parts);
  const fh = await dir.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(contents); await w.close();
}
export async function remove(parentPath, name) { const dir = await opfsResolve(homeParts(parentPath)); await dir.removeEntry(name, { recursive: true }); }
export async function rename(parentPath, oldName, newName) {
  const dir = await opfsResolve(homeParts(parentPath));
  let h, isFile = true;
  try { h = await dir.getFileHandle(oldName); } catch { h = await dir.getDirectoryHandle(oldName); isFile = false; }
  if (h.move) { try { await h.move(newName); return; } catch { /* move() can reject for directories on some engines → copy fallback */ } }
  if (isFile) { const f = await h.getFile(); await createFile(parentPath, newName, await f.arrayBuffer()); await dir.removeEntry(oldName); return; }
  // directory fallback: recursively copy into a fresh dir, then drop the old (no move() needed).
  const dst = await dir.getDirectoryHandle(newName, { create: true });
  await copyDirInto(h, dst);
  await dir.removeEntry(oldName, { recursive: true });
}
async function copyDirInto(src, dst) {
  for await (const [name, handle] of src.entries()) {
    if (handle.kind === "directory") { const sub = await dst.getDirectoryHandle(name, { create: true }); await copyDirInto(handle, sub); }
    else { const f = await handle.getFile(); const fh = await dst.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(await f.arrayBuffer()); await w.close(); }
  }
}
// move a Home entry into another Home directory (drag-and-drop). Uses the W3C move() fast path
// when available, else copy-then-delete for files.
export async function moveHome(srcPath, destDirPath) {
  const sp = homeParts(srcPath); const name = sp.pop(); const srcDir = await opfsResolve(sp);
  const destDir = await opfsResolve(homeParts(destDirPath));
  let h, isFile = true; try { h = await srcDir.getFileHandle(name); } catch { h = await srcDir.getDirectoryHandle(name); isFile = false; }
  if (h.move) { try { await h.move(destDir, name); return; } catch { /* move() can reject for directories on some engines → copy fallback */ } }
  if (isFile) { const f = await h.getFile(); const nh = await destDir.getFileHandle(name, { create: true }); const w = await nh.createWritable(); await w.write(await f.arrayBuffer()); await w.close(); await srcDir.removeEntry(name); return; }
  // directory fallback: recursively copy into the destination, then drop the source (nesting).
  const sub = await destDir.getDirectoryHandle(name, { create: true });
  await copyDirInto(h, sub);
  await srcDir.removeEntry(name, { recursive: true });
}
// copy a Home entry (file or folder) into a Home directory, optionally under a new name (paste).
export async function copyHome(srcPath, destDirPath, asName) {
  const sp = homeParts(srcPath); const name = sp.pop(); const srcDir = await opfsResolve(sp);
  const destDir = await opfsResolve(homeParts(destDirPath)); const target = asName || name;
  let h, isFile = true; try { h = await srcDir.getFileHandle(name); } catch { h = await srcDir.getDirectoryHandle(name); isFile = false; }
  if (isFile) { const f = await h.getFile(); const nh = await destDir.getFileHandle(target, { create: true }); const w = await nh.createWritable(); await w.write(await f.arrayBuffer()); await w.close(); return; }
  const sub = await destDir.getDirectoryHandle(target, { create: true });
  await copyDirInto(h, sub);
}

// ── fetch helpers — every substrate read goes through paths that map to OS2/Apps (never the
// legacy origin), so navigation stays gateway-free and self-contained. ──────────────────────
async function getJSON(path) { const r = await fetch(path, noStore); if (!r.ok) throw new Error(path + " → " + r.status); return r.json(); }
async function getBytes(path) { const r = await fetch(path, noStore); if (!r.ok) throw new Error(path + " → " + r.status); return new Uint8Array(await r.arrayBuffer()); }

// FHS directory → live index.jsonld (its real κ + dcat:dataset members). Root has no path-mapped
// index.jsonld, so it lists its embedded children directly.
async function listFHS(spec) {
  const kids = (spec.children || []).map((c) => node({ name: c.name, path: c.fhs, kind: "dir", source: "fhs", role: c.role }));
  let members = [];
  if (spec.fhs !== "/") {
    try {
      const doc = await getJSON(spec.fhs.replace(/\/$/, "") + "/index.jsonld");
      spec.__did = doc.id || "";
      members = (doc["dcat:dataset"] || []).map((d) => {
        const isApp = (Array.isArray(d["@type"]) ? d["@type"] : [d["@type"]]).some((t) => /Application/.test(String(t)));
        return node({ name: d["schema:name"] || d["schema:identifier"], path: d["hosfs:fhs"] || (spec.fhs + "/" + d["schema:name"]),
          kind: isApp ? "app" : "file", source: "fhs-member", did: d["@id"] || "", role: d["schema:identifier"] || "", _appId: appIdFromIdent(d["schema:identifier"]) });
      });
    } catch { /* virtual / not-yet-minted dir — show the skeleton only */ }
  }
  return [...sortNodes(kids), ...members];
}
const appIdFromIdent = (ident) => { const m = /Holo([A-Z][a-z]+)/.exec(ident || ""); return m ? m[1].toLowerCase() : ""; };

// Holospaces (the app catalog) → each app; drill into one → its holospace.lock.json closure.
async function listHolospaces() {
  const cat = await getJSON("/apps/index.jsonld");
  return (cat["dcat:dataset"] || []).map((a) => {
    const id = (a["dcat:landingPage"] || "").split("/")[1] || "";
    return node({ name: a["schema:name"] || id, path: "holospace:" + id, kind: "app", source: "catalog", did: a["@id"] || "", role: a["schema:identifier"] || "", _appId: id, _landing: a["dcat:landingPage"] });
  }).sort((x, y) => x.name.localeCompare(y.name));
}
async function listHolospaceFiles(appId) {
  const lock = await getJSON(`/apps/${appId}/holospace.lock.json`);
  const cl = lock.closure || {};
  return treeFromClosure(cl, "holospace:" + appId + "/");
}
async function listOSRuntime(prefix) {
  const lock = await getJSON("/etc/os-closure.json");
  return treeFromClosure(lock.closure || {}, "os:", prefix);
}
// Build ONE directory level from a flat {path → {kappa,bytes}} closure (a real path tree). At a
// given prefix, fold deeper paths into sub-dirs and surface the files at this level.
function treeFromClosure(closure, scheme, prefix = "") {
  const pre = prefix ? prefix.replace(/\/$/, "") + "/" : "";
  const dirs = new Map(); const files = [];
  for (const [p, v] of Object.entries(closure)) {
    if (pre && !p.startsWith(pre)) continue;
    const rest = p.slice(pre.length); const slash = rest.indexOf("/");
    if (slash === -1) {
      const kappa = typeof v === "string" ? v : (v.kappa || v.did || v["@id"] || "");
      files.push(node({ name: rest, path: scheme + p, kind: "file", source: "closure", did: kappa, bytes: typeof v === "object" ? v.bytes : null, mime: mimeOf(rest), _realPath: "/" + p }));
    } else { const seg = rest.slice(0, slash); if (!dirs.has(seg)) dirs.set(seg, 0); dirs.set(seg, dirs.get(seg) + 1); }
  }
  const dirNodes = [...dirs.entries()].map(([name, count]) => node({ name, path: scheme + pre + name, kind: "dir", source: "closure-dir", role: count + " items", _scheme: scheme, _prefix: pre + name }));
  return [...sortNodes(dirNodes), ...sortNodes(files)];
}

function sortNodes(list) {
  const dir = (n) => n.kind === "dir" || n.kind === "app" ? 0 : 1;
  return list.sort((a, b) => dir(a) - dir(b) || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

// ── the public VFS — list any node's children, read bytes, verify (Law L5) ──────────────────
export const ROOTS = () => [
  node({ name: "Home", path: "/home/user", kind: "location", source: "opfs", writable: true, role: "your writable space · OPFS", glyph: "home" }),
  node({ name: "This Hologram", path: "/", kind: "location", source: "fhs", role: "the OS as a content-addressed graph", glyph: "drive" }),
  node({ name: "Holospaces", path: "holospaces:", kind: "location", source: "holospaces", role: "every app, by κ", glyph: "apps" }),
  node({ name: "OS Runtime", path: "os:", kind: "location", source: "osruntime", role: "the OS-wide closure · path → κ", glyph: "chip" }),
  node({ name: "Holo Cloud", path: "cloud:", kind: "location", source: "cloud", writable: true, role: "your private, end-to-end-encrypted cloud · synced with Holo Cloud", glyph: "cloud", _cloudPath: "/" }),
];

export async function list(n) {
  switch (n.source) {
    case "opfs": return listHome(n.path === "/home/user" || n.kind === "location" ? "/home/user" : n.path);
    case "fhs": { const spec = fhsIndex.get(n.path) || FHS; return listFHS(spec); }
    case "fhs-member": return n.kind === "app" && n._appId ? listHolospaceFiles(n._appId) : [];
    case "holospaces": return listHolospaces();
    case "catalog": return n._appId ? listHolospaceFiles(n._appId) : [];
    case "osruntime": return listOSRuntime("");
    case "closure-dir": return treeFromClosure(await loadClosureFor(n._scheme), n._scheme, n._prefix);
    case "cloud": return listCloud(n._cloudPath || "/");
    default: return [];
  }
}
const _closureCache = {};
async function loadClosureFor(scheme) {
  if (_closureCache[scheme]) return _closureCache[scheme];
  if (scheme === "os:") { const l = await getJSON("/etc/os-closure.json"); return (_closureCache[scheme] = l.closure || {}); }
  if (scheme.startsWith("holospace:")) { const id = scheme.slice("holospace:".length).replace(/[:/]+$/, ""); const l = await getJSON(`/apps/${id}/holospace.lock.json`); return (_closureCache[scheme] = l.closure || {}); }
  return {};
}

// realPath(node) — the fetchable os-relative URL whose bytes ARE this node (for read + verify).
export function realPath(n) {
  if (n._realPath) return n._realPath;
  if (n.source === "opfs") return null;                                  // OPFS handled separately
  if (n.source === "closure" && n.path.startsWith("holospace:")) return "/" + n.path.slice("holospace:".length);
  if (n.source === "closure" && n.path.startsWith("os:")) return "/" + n.path.slice("os:".length);
  return null;
}

// read(node) → { bytes, text?, mime } — for preview. OPFS via handle; everything else by path.
export async function read(n, max = 512 * 1024) {
  if (n.source === "opfs") {
    const parts = homeParts(n.path); const name = parts.pop(); const f = await readHome(parts, name);
    const bytes = new Uint8Array(await f.slice(0, max).arrayBuffer()); return { bytes, mime: n.mime || mimeOf(n.name), size: f.size };
  }
  if (n.source === "cloud") {
    const cw = await cloud(); const bytes = await cw.fs.get(n._cloudPath); if (!bytes) throw new Error("not resolvable in cloud store");
    return { bytes: bytes.slice(0, max), mime: n.mime || mimeOf(n.name), size: bytes.length };
  }
  const rp = realPath(n); if (!rp) throw new Error("not readable");
  const bytes = await getBytes(rp); return { bytes: bytes.slice(0, max), mime: n.mime || mimeOf(n.name), size: bytes.length };
}

// verify(node) → { ok, derived, expected } — re-derive the content address and compare (Law L5).
// A tampered byte yields a different κ ⇒ ok:false. The heart of "trust by re-derivation".
export async function verify(n) {
  let bytes, expected = hexOf(n.did);
  if (n.source === "cloud") { const cw = await cloud(); bytes = await cw.fs.get(n._cloudPath); if (!bytes) return { ok: false, reason: "not resolvable in cloud store (or refused — tampered)" }; const derived = await sha256hex(bytes); return { ok: expected ? derived === expected : true, derived, expected }; }
  if (n.source === "opfs") { const parts = homeParts(n.path); const name = parts.pop(); const f = await readHome(parts, name); bytes = new Uint8Array(await f.arrayBuffer()); }
  else { const rp = realPath(n); if (!rp) { // a dir/jsonld node: re-derive its object address
      if (n.source === "fhs" && n.path !== "/") { const doc = await getJSON(n.path.replace(/\/$/, "") + "/index.jsonld"); const ok = W.HoloObject ? await W.HoloObject.verify(doc) : null; return { ok: !!ok, derived: hexOf(doc.id), expected: hexOf(doc.id), kind: "object" }; }
      return { ok: null, reason: "no addressable bytes" }; }
    bytes = await getBytes(rp); }
  const derived = await sha256hex(bytes);
  if (!expected) return { ok: null, derived, reason: "no pinned κ" };
  return { ok: derived === expected, derived, expected };
}

// ── platform feel — the same model, the host's native chrome ────────────────────────────────
export function platform() { try { return profileFor(); } catch { return { os: "linux", label: "Linux", apple: false, touch: false, modSymbol: "Ctrl", controlsSide: "right", font: "system-ui, sans-serif", accent: "#3584e4", shortcuts: {} }; } }
// the file-manager "skin" a host expects, by OS family.
export function skinFor(p) {
  const map = {
    macos: { name: "Finder", defaultView: "columns", side: "left", translucent: true, accentText: false },
    ios: { name: "Files", defaultView: "grid", side: "left", translucent: true, accentText: false },
    ipados: { name: "Files", defaultView: "grid", side: "left", translucent: true, accentText: false },
    windows: { name: "File Explorer", defaultView: "details", side: "left", translucent: false, accentText: false },
    android: { name: "Files", defaultView: "list", side: "left", translucent: false, accentText: true },
    chromeos: { name: "Files", defaultView: "list", side: "left", translucent: false, accentText: true },
    linux: { name: "Files", defaultView: "grid", side: "left", translucent: false, accentText: false },
  };
  return map[p.os] || map.linux;
}

// ── Holo Cloud mount — the SAME content-addressed OPFS store + tree the Holo Cloud app uses
//    (HoloWebDAV over OPFS holo-cloud/{blocks,tree.json}): a file sent here appears in Holo Cloud
//    and vice versa. Seamless because it is the SAME substrate (one κ-block store), not a bridge. ──
let _cloud = null;
async function cloud() {
  if (_cloud) return _cloud;
  const HW = W.HoloWebDAV; if (!HW) throw new Error("HoloWebDAV unavailable — load _shared/holo-webdav.js");
  const store = new HW.KappaStore(), fs = new HW.HoloFS(store), dav = HW.nativeDav(fs);
  try { const c = await (await opfsRoot()).getDirectoryHandle("holo-cloud", { create: true }); const fh = await c.getFileHandle("tree.json"); fs.tree = new Map(JSON.parse(await (await fh.getFile()).text())); } catch {}
  if (fs.tree && !fs.tree.has("/")) fs.tree.set("/", { type: "dir", mtime: 0 });
  const save = async () => { try { const c = await (await opfsRoot()).getDirectoryHandle("holo-cloud", { create: true }); const fh = await c.getFileHandle("tree.json", { create: true }); const w = await fh.createWritable(); await w.write(JSON.stringify([...fs.tree])); await w.close(); } catch {} };
  return (_cloud = { HW, store, fs, dav, save });
}
const cloudDid = (k) => k ? "did:holo:sha256:" + String(k).split(":").pop() : "";
async function listCloud(path = "/") {
  const cw = await cloud();
  const entries = cw.fs.list(path) || [];
  return sortNodes(entries.map((e) => node({
    name: e.name, path: "cloud:" + e.path, kind: e.type === "dir" ? "dir" : "file", source: "cloud",
    did: cloudDid(e.kappa), bytes: e.size != null ? e.size : null, mime: e.mime || mimeOf(e.name), writable: true,
    role: e.type === "dir" ? "folder" : "", _cloudPath: e.path,
  })));
}
// send any readable node's bytes into Holo Cloud (chunked, deduped, E2E-ready); persist the shared tree.
export async function sendToCloud(n, destDir = "/") {
  const cw = await cloud();
  const { bytes } = await read(n, 256 * 1024 * 1024);
  const path = cw.HW.joinp(destDir, n.name);
  await cw.dav.put(path, bytes, cw.HW.mimeOf(n.name));
  await cw.save();
  const nd = cw.fs.node(path);
  return { path, did: cloudDid(nd && nd.kappa) };
}
export const cloudShareLink = (cloudPath) => `/apps/cloud/index.html#path=${encodeURIComponent(cloudPath || "/")}`;

// ── unified search across the whole substrate (Holo Search · the local plane) ─────────────
export async function searchAll(query, { limit = 80 } = {}) {
  const q = String(query || "").trim().toLowerCase(); if (!q) return [];
  const out = []; const add = (n, where) => { if (out.length < limit) out.push(Object.assign(n, { _where: where })); };
  try { await walkHome("/home/user", (n) => { if (n.name.toLowerCase().includes(q)) add(n, "Home"); }); } catch {}
  try { for (const a of await listHolospaces()) if (a.name.toLowerCase().includes(q) || (a.role || "").toLowerCase().includes(q)) add(a, "Holospaces"); } catch {}
  try { const cl = await loadClosureFor("os:"); for (const p of Object.keys(cl)) { if (out.length >= limit) break; if (p.toLowerCase().includes(q)) { const v = cl[p]; add(node({ name: p.split("/").pop(), path: "os:" + p, kind: "file", source: "closure", did: typeof v === "object" ? v.kappa : v, bytes: typeof v === "object" ? v.bytes : null, mime: mimeOf(p), _realPath: "/" + p }), "OS Runtime"); } } } catch {}
  try { if (W.HoloWebDAV) await walkCloud("/", (n) => { if (n.kind === "file" && n.name.toLowerCase().includes(q)) add(n, "Holo Cloud"); }); } catch {}
  return out;
}
async function walkHome(path, cb, depth = 0) {
  if (depth > 6) return; let dir; try { dir = await opfsResolve(homeParts(path)); } catch { return; }
  for await (const [name, h] of dir.entries()) {
    const p = path.replace(/\/$/, "") + "/" + name;
    if (h.kind === "directory") { cb(node({ name, path: p, kind: "dir", source: "opfs", writable: true })); await walkHome(p, cb, depth + 1); }
    else { let bytes = null; try { bytes = (await h.getFile()).size; } catch {} cb(node({ name, path: p, kind: "file", source: "opfs", bytes, mime: mimeOf(name), writable: true })); }
  }
}
async function walkCloud(path, cb, depth = 0) {
  if (depth > 8) return; for (const n of await listCloud(path)) { cb(n); if (n.kind === "dir") await walkCloud(n._cloudPath, cb, depth + 1); }
}

// resolve a typed identifier (κ · did:holo · CID · DOI · URL · path) → a local node or a web query.
export async function resolveInput(str) {
  str = String(str || "").trim(); if (!str) return null;
  if (str.startsWith("/")) return { kind: "path", path: str };
  // any content-address form (did:holo:sha256:HEX · holo://HEX · sha256:HEX · bare 64-hex) → scan
  // the OS-wide closure for that hex and return the object it names (the omnibox-as-window).
  const hm = /([0-9a-f]{64})/i.exec(str);
  if (hm) {
    const hex = hm[1].toLowerCase();
    try { const cl = await loadClosureFor("os:"); for (const p of Object.keys(cl)) { const v = cl[p]; if (hexOf(typeof v === "object" ? v.kappa : v).toLowerCase() === hex) return { kind: "node", node: node({ name: p.split("/").pop(), path: "os:" + p, kind: "file", source: "closure", did: typeof v === "object" ? v.kappa : v, bytes: typeof v === "object" ? v.bytes : null, mime: mimeOf(p), _realPath: "/" + p }) }; } } catch {}
  }
  let cls; try { cls = (await import("./holo-resolve.js")).classify(str); } catch { cls = { kind: "freetext", id: str }; }
  return { kind: "web", id: cls.id || str, classified: cls };
}

// materialize a dropped κ / holo:// link / 64-hex into a real file in Home (drop-to-materialize):
// resolve it to its object, read the verified bytes, and write them into destDir.
export async function materialize(input, destDir = "/home/user") {
  const r = await resolveInput(input); if (!r) throw new Error("nothing to resolve");
  if (r.kind === "node") { const { bytes } = await read(r.node, 256 * 1024 * 1024); const name = r.node.name || ("object-" + hexOf(r.node.did).slice(0, 8)); await createFile(destDir, name, bytes); return { name, did: r.node.did }; }
  if (r.kind === "path") throw new Error("that's a path, not a content object");
  throw new Error("not a local κ — open-web objects open in Holo Search");
}

// open-web unified search (Holo Search · resolve → federate → answer; no AI). Lazy — never on load.
export async function webSearch(query) { const m = await import("./holo-find.js"); return m.find(query, { fetchJson: m.browserFetchJson }); }

// storage usage for the writable plane (W3C StorageManager).
export async function freeSpace() { try { const e = await navigator.storage.estimate(); return { usage: e.usage || 0, quota: e.quota || 0 }; } catch { return null; } }

// ── archives (.zip) — real DEFLATE via the W3C Compression Streams API (no CDN, Law L4) ────
const CRCT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRCT[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
async function deflateRaw(u8) { const cs = new CompressionStream("deflate-raw"); const w = cs.writable.getWriter(); w.write(u8); w.close(); return new Uint8Array(await new Response(cs.readable).arrayBuffer()); }
async function inflateRaw(u8) { const ds = new DecompressionStream("deflate-raw"); const w = ds.writable.getWriter(); w.write(u8); w.close(); return new Uint8Array(await new Response(ds.readable).arrayBuffer()); }
async function zip(entries) {                              // entries: [{ name, bytes }] → a .zip Uint8Array
  const te = new TextEncoder(), parts = [], central = []; let off = 0;
  for (const e of entries) {
    const nameB = te.encode(e.name), data = e.bytes instanceof Uint8Array ? e.bytes : new Uint8Array(e.bytes);
    const crc = crc32(data), comp = await deflateRaw(data);
    const lh = new Uint8Array(30 + nameB.length), dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(8, 8, true);
    dv.setUint32(14, crc, true); dv.setUint32(18, comp.length, true); dv.setUint32(22, data.length, true); dv.setUint16(26, nameB.length, true); lh.set(nameB, 30);
    parts.push(lh, comp); central.push({ nameB, crc, comp: comp.length, size: data.length, off }); off += lh.length + comp.length;
  }
  const cdStart = off, cd = [];
  for (const c of central) {
    const ch = new Uint8Array(46 + c.nameB.length), dv = new DataView(ch.buffer);
    dv.setUint32(0, 0x02014b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 20, true); dv.setUint16(10, 8, true);
    dv.setUint32(16, c.crc, true); dv.setUint32(20, c.comp, true); dv.setUint32(24, c.size, true); dv.setUint16(28, c.nameB.length, true); dv.setUint32(42, c.off, true); ch.set(c.nameB, 46);
    cd.push(ch); off += ch.length;
  }
  const eocd = new Uint8Array(22), dv = new DataView(eocd.buffer);
  dv.setUint32(0, 0x06054b50, true); dv.setUint16(8, central.length, true); dv.setUint16(10, central.length, true); dv.setUint32(12, off - cdStart, true); dv.setUint32(16, cdStart, true);
  const all = [...parts, ...cd, eocd]; let total = 0; for (const c of all) total += c.length; const out = new Uint8Array(total); let o = 0; for (const c of all) { out.set(c, o); o += c.length; } return out;
}
async function unzip(u8) {                                 // → [{ name, bytes }] (files only)
  u8 = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8); const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), tdz = new TextDecoder();
  let eo = -1; for (let i = u8.length - 22; i >= 0; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eo = i; break; } }
  if (eo < 0) throw new Error("not a zip archive");
  const count = dv.getUint16(eo + 10, true); let p = dv.getUint32(eo + 16, true); const out = [];
  for (let i = 0; i < count && dv.getUint32(p, true) === 0x02014b50; i++) {
    const method = dv.getUint16(p + 10, true), comp = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
    const name = tdz.decode(u8.subarray(p + 46, p + 46 + nlen));
    const lnlen = dv.getUint16(lho + 26, true), lelen = dv.getUint16(lho + 28, true), dstart = lho + 30 + lnlen + lelen, cdata = u8.subarray(dstart, dstart + comp);
    if (!name.endsWith("/")) { let data; if (method === 0) data = cdata.slice(); else if (method === 8) data = await inflateRaw(cdata); else { p += 46 + nlen + elen + clen; continue; } out.push({ name, bytes: data }); }
    p += 46 + nlen + elen + clen;
  }
  return out;
}
async function opfsWriteDeep(rootParts, relPath, bytes) {
  const segs = [...rootParts, ...relPath.split("/").filter(Boolean)], name = segs.pop();
  let dir = await opfsRoot(); for (const s of segs) dir = await dir.getDirectoryHandle(s, { create: true });
  const fh = await dir.getFileHandle(name, { create: true }), w = await fh.createWritable(); await w.write(bytes); await w.close();
}
// extract a .zip object into destDir/<archive-name>/ (preserving the archive's subpaths)
export async function extractZip(node, destDirPath = "/home/user") {
  const { bytes } = await read(node, 512 * 1024 * 1024), entries = await unzip(bytes);
  const folder = (node.name || "archive").replace(/\.zip$/i, ""), rootParts = homeParts(destDirPath).concat(folder);
  for (const e of entries) await opfsWriteDeep(rootParts, e.name, e.bytes);
  return { folder, count: entries.length };
}
// compress the given file nodes into a single .zip written to destDir
export async function compressToZip(nodes, destDirPath = "/home/user", zipName = "archive.zip") {
  const entries = []; for (const n of nodes) { if (n.kind !== "file") continue; try { const { bytes } = await read(n, 512 * 1024 * 1024); entries.push({ name: n.name, bytes }); } catch {} }
  if (!entries.length) throw new Error("no files to compress");
  const z = await zip(entries); await createFile(destDirPath, zipName, z);
  return { name: zipName, count: entries.length, bytes: z.length };
}

export const HoloFiles = { ROOTS, list, read, verify, realPath, platform, skinFor, mkdir, createFile, writeFile, rename, remove, moveHome, copyHome, fmtBytes, mimeOf, kindOf, extOf, FHS,
  sendToCloud, cloudShareLink, searchAll, resolveInput, materialize, webSearch, freeSpace, extractZip, compressToZip };
if (typeof window !== "undefined") window.HoloFiles = HoloFiles;
export default HoloFiles;
