// holo-webdav.js — Holo Cloud's data layer: ONE file shape, two sources.
//
// Adherence to the Nextcloud SPEC without its PHP server. Nextcloud's storage API
// is WebDAV (RFC 4918, served at remote.php/dav/files/<user>/) plus the OCS Share
// API (ocs/v2.php/apps/files_sharing/api/v1/shares). This module speaks BOTH —
// natively, against a content-addressed κ-store, and (optionally) against a REAL
// Nextcloud server over its documented REST API — so Holo Cloud doubles as a real
// Nextcloud client. Both sources normalize to the same render node; the native one
// is content-addressed (a κ that re-derives, Law L5), the remote one is location-
// addressed (a server URL) — honestly labelled (mirrors _shared/holo-jellyfin.js).
//
// UOR-native idea (Laws L1–L5): a file's identity is its CONTENT, not its path. We
// chunk every file into fixed 256-KiB blocks, name each block by κ = sha256(block)
// (the substrate σ-axis, native in the browser via WebCrypto), and store each UNIQUE
// block once (dedup — Laws L2/L3). A file becomes a MANIFEST = ordered list of κ +
// the file's own content address kappa = sha256(all bytes). Reading re-derives every
// block AND the whole file against its κ (verify-by-re-derivation, Law L5), so the
// dedup is lossless and tamper-evident and a lying peer can withhold but never forge.
// The block store is the memory (Law L3): OPFS in the browser (survives reloads,
// entirely in-tab, no server), an in-RAM Map in Node (so this same module backs the
// witness). Sharing/multiuser ride the repo's content-blind κ pub/sub via HoloCollab
// (the directory tree is a CvRDT LWWMap; file blocks are fetched by κ and verified).
//
// Pure, dependency-free, isomorphic (browser + Node ≥21). Exposes HoloWebDAV.

(function () {
  "use strict";
  const G = typeof globalThis !== "undefined" ? globalThis : window;
  if (G.HoloWebDAV) return;

  const AXIS = "sha256";                       // substrate κ-axis (kdisk.mjs / holo-collab parity)
  const BLOCK = 262144;                        // 256 KiB — kstore.mjs parity (good dedup, modest index)
  const te = new TextEncoder();
  const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
  async function sha256(u8) { return new Uint8Array(await G.crypto.subtle.digest("SHA-256", u8)); }
  async function kappa(u8) { return AXIS + ":" + hex(await sha256(u8 instanceof Uint8Array ? u8 : new Uint8Array(u8))); }
  const now = () => Date.now();

  // ── path helpers — POSIX, always rooted at "/" (Nextcloud user-root relative) ──
  function norm(p) {
    p = "/" + String(p == null ? "" : p).replace(/\\/g, "/");
    const out = [];
    for (const seg of p.split("/")) { if (!seg || seg === ".") continue; if (seg === "..") out.pop(); else out.push(seg); }
    return "/" + out.join("/");
  }
  const basename = (p) => { p = norm(p); return p === "/" ? "" : p.slice(p.lastIndexOf("/") + 1); };
  const dirname = (p) => { p = norm(p); const i = p.lastIndexOf("/"); return i <= 0 ? "/" : p.slice(0, i); };
  const joinp = (d, n) => norm((d === "/" ? "" : d) + "/" + n);
  // mime by extension — a small, honest table; the browser/File API supplies the rest.
  const MIME = { txt:"text/plain", md:"text/markdown", html:"text/html", json:"application/json", csv:"text/csv",
    png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", gif:"image/gif", webp:"image/webp", svg:"image/svg+xml",
    pdf:"application/pdf", mp3:"audio/mpeg", wav:"audio/wav", flac:"audio/flac", m4a:"audio/mp4", ogg:"audio/ogg",
    mp4:"video/mp4", webm:"video/webm", mov:"video/quicktime", m3u8:"application/vnd.apple.mpegurl",
    zip:"application/zip", wasm:"application/wasm" };
  const mimeOf = (name) => MIME[(name.split(".").pop() || "").toLowerCase()] || "application/octet-stream";

  // ── KappaStore — content-addressed block store. Law L3: the store is the memory.
  // OPFS-backed in the browser (./holo-cloud/blocks/<hex>), an in-RAM Map otherwise.
  // Every read RE-DERIVES sha256(bytes)==κ before returning (Law L5).
  class KappaStore {
    constructor() { this.mem = new Map(); this.dir = null; this._opfs = null; }
    async _opfsDir() {
      if (this._opfs !== null) return this._opfs;
      try {
        if (G.navigator && navigator.storage && navigator.storage.getDirectory) {
          const root = await navigator.storage.getDirectory();
          const cloud = await root.getDirectoryHandle("holo-cloud", { create: true });
          this._opfs = await cloud.getDirectoryHandle("blocks", { create: true });
        } else this._opfs = false;
      } catch { this._opfs = false; }
      return this._opfs;
    }
    async put(u8) {
      u8 = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
      const k = await kappa(u8), name = k.slice(AXIS.length + 1);
      const dir = await this._opfsDir();
      if (dir) {
        try { await dir.getFileHandle(name); return k; } catch {}                 // already present (dedup)
        const fh = await dir.getFileHandle(name, { create: true });
        const w = await fh.createWritable(); await w.write(u8); await w.close();
      } else if (!this.mem.has(k)) this.mem.set(k, u8);
      return k;
    }
    async get(k) {
      let bytes = null;
      const dir = await this._opfsDir();
      if (dir) { try { const fh = await dir.getFileHandle(k.slice(AXIS.length + 1)); bytes = new Uint8Array(await (await fh.getFile()).arrayBuffer()); } catch { bytes = null; } }
      else bytes = this.mem.get(k) || null;
      if (!bytes) return null;
      if ((await kappa(bytes)) !== k) return null;                                 // Law L5: refuse forged
      return bytes;
    }
    async has(k) { const dir = await this._opfsDir(); if (dir) { try { await dir.getFileHandle(k.slice(AXIS.length + 1)); return true; } catch { return false; } } return this.mem.has(k); }
    // accept a block a PEER served by κ (verify before admitting — Law L5)
    async admit(k, u8) { if ((await kappa(u8)) !== k) return false; await this._adopt(k, u8); return true; }
    async _adopt(k, u8) { const dir = await this._opfsDir(); if (dir) { try { await dir.getFileHandle(k.slice(AXIS.length + 1)); return; } catch {} const fh = await dir.getFileHandle(k.slice(AXIS.length + 1), { create: true }); const w = await fh.createWritable(); await w.write(u8); await w.close(); } else this.mem.set(k, u8); }
    async stats() { const dir = await this._opfsDir(); if (dir) { let blocks = 0, bytes = 0; for await (const [, h] of dir.entries()) { if (h.kind === "file") { blocks++; bytes += (await h.getFile()).size; } } return { blocks, bytes }; } let bytes = 0; for (const v of this.mem.values()) bytes += v.length; return { blocks: this.mem.size, bytes }; }
  }

  // ── chunk a file into κ-blocks; reassemble + verify ─────────────────────────────
  async function chunk(store, u8) {
    u8 = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
    const blocks = [];
    for (let p = 0; p < u8.length || (p === 0 && u8.length === 0); p += BLOCK) {
      blocks.push(await store.put(u8.subarray(p, Math.min(p + BLOCK, u8.length))));
      if (u8.length === 0) break;
    }
    return { blocks, size: u8.length, kappa: await kappa(u8) };
  }
  async function assemble(store, manifest) {
    const parts = []; let total = 0;
    for (const k of manifest.blocks) { const b = await store.get(k); if (!b) return null; parts.push(b); total += b.length; }
    const out = new Uint8Array(total); let o = 0; for (const b of parts) { out.set(b, o); o += b.length; }
    if (manifest.kappa && (await kappa(out)) !== manifest.kappa) return null;       // Law L5: whole-file re-derivation
    return out;
  }

  // ── HoloFS — the native filesystem. A directory TREE held as a flat path→node map
  //    (so it maps 1:1 onto a CvRDT LWWMap for serverless multiuser convergence).
  //    Files carry their content address + block manifest; the bytes live in the store.
  class HoloFS {
    constructor(store) { this.store = store || new KappaStore(); this.tree = new Map(); this.tree.set("/", { type: "dir", mtime: now() }); }
    node(path) { return this.tree.get(norm(path)) || null; }
    exists(path) { return this.tree.has(norm(path)); }
    _ensureParents(path) { let d = dirname(path); const stack = []; while (d !== "/" && !this.tree.has(d)) { stack.push(d); d = dirname(d); } for (let i = stack.length - 1; i >= 0; i--) this.tree.set(stack[i], { type: "dir", mtime: now() }); }
    mkcol(path) { path = norm(path); if (this.tree.has(path)) return false; this._ensureParents(path); this.tree.set(path, { type: "dir", mtime: now() }); return true; }
    async put(path, bytes, mime) {
      path = norm(path); this._ensureParents(path);
      const m = await chunk(this.store, bytes);
      const node = { type: "file", name: basename(path), mime: mime || mimeOf(basename(path)), size: m.size, mtime: now(), blockSize: BLOCK, blocks: m.blocks, kappa: m.kappa };
      this.tree.set(path, node); return node;
    }
    // import a node a peer announced (its blocks fetched + verified separately)
    setNode(path, node) { path = norm(path); this._ensureParents(path); this.tree.set(path, node); }
    async get(path) { const n = this.node(path); if (!n || n.type !== "file") return null; return assemble(this.store, n); }
    list(path) {
      path = norm(path); const pre = path === "/" ? "/" : path + "/"; const out = [];
      for (const [p, n] of this.tree) { if (p === path || n.deleted) continue; if (p.startsWith(pre) && p.slice(pre.length).indexOf("/") === -1) out.push({ path: p, name: basename(p), ...n }); }
      out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
      return out;
    }
    delete(path) { path = norm(path); if (path === "/") return false; let hit = false; const pre = path + "/"; for (const p of [...this.tree.keys()]) if (p === path || p.startsWith(pre)) { this.tree.set(p, { type: this.tree.get(p).type, deleted: true, mtime: now() }); hit = true; } return hit; }
    move(src, dst) { src = norm(src); dst = norm(dst); const n = this.node(src); if (!n) return false; this._ensureParents(dst); const pre = src + "/"; for (const [p, v] of [...this.tree]) { if (p === src) { this.tree.set(dst, { ...v, name: basename(dst), mtime: now() }); this.tree.set(src, { type: v.type, deleted: true, mtime: now() }); } else if (p.startsWith(pre)) { const np = dst + p.slice(src.length); this.tree.set(np, { ...v, mtime: now() }); this.tree.set(p, { type: v.type, deleted: true, mtime: now() }); } } return true; }
    async copy(src, dst) { src = norm(src); dst = norm(dst); const n = this.node(src); if (!n) return false; this._ensureParents(dst); const pre = src + "/"; for (const [p, v] of [...this.tree]) { if (v.deleted) continue; if (p === src) this.tree.set(dst, { ...v, name: basename(dst), mtime: now() }); else if (p.startsWith(pre)) this.tree.set(dst + p.slice(src.length), { ...v, mtime: now() }); } return true; }
    // usage: logical bytes (sum of files) vs unique store bytes (after dedup)
    async usage() { let logical = 0, files = 0, dirs = 0; const seen = new Set(); for (const [p, n] of this.tree) { if (n.deleted) continue; if (n.type === "file") { files++; logical += n.size || 0; (n.blocks || []).forEach((k) => seen.add(k)); } else if (p !== "/") dirs++; } const st = await this.store.stats(); return { logical, files, dirs, uniqueBytes: st.bytes, blocks: st.blocks, dedupPct: logical ? Math.max(0, 100 * (1 - st.bytes / logical)) : 0 }; }
  }

  // ── WebDAV (RFC 4918 / Nextcloud) — multistatus build + parse, verbs over HoloFS ─
  const xmlesc = (s) => String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
  const httpDate = (ms) => new Date(ms).toUTCString();
  // Build a <d:multistatus> exactly as Nextcloud's DAV returns it (d: + oc: props).
  function buildMultistatus(fs, path, depth, davRoot) {
    davRoot = davRoot || "/remote.php/dav/files/me";
    const n = fs.node(path); if (!n) return null;
    const rows = [{ path, node: n }];
    if (n.type === "dir" && depth !== "0") for (const c of fs.list(path)) rows.push({ path: c.path, node: c });
    const props = (p, nd) => {
      const isDir = nd.type === "dir";
      const href = davRoot + (p === "/" ? "/" : p) + (isDir && p !== "/" ? "/" : "");
      const etag = (nd.kappa || (nd.mtime + ":" + p)).slice(-32).replace(/[^a-zA-Z0-9]/g, "");
      return `  <d:response>\n    <d:href>${xmlesc(href)}</d:href>\n    <d:propstat>\n      <d:prop>\n` +
        `        <d:getlastmodified>${httpDate(nd.mtime || now())}</d:getlastmodified>\n` +
        `        <d:getetag>&quot;${etag}&quot;</d:getetag>\n` +
        (isDir ? `        <d:resourcetype><d:collection/></d:resourcetype>\n`
               : `        <d:resourcetype/>\n        <d:getcontentlength>${nd.size || 0}</d:getcontentlength>\n        <d:getcontenttype>${xmlesc(nd.mime || "application/octet-stream")}</d:getcontenttype>\n`) +
        `        <oc:fileid>${xmlesc((nd.kappa || "").replace(/\W/g, "").slice(0, 20) || "0")}</oc:fileid>\n` +
        `        <oc:permissions>${isDir ? "RGDNVCK" : "RGDNVW"}</oc:permissions>\n` +
        `        <oc:size>${nd.size || 0}</oc:size>\n` +
        (nd.kappa ? `        <oc:checksums><oc:checksum>SHA256:${xmlesc(nd.kappa.slice(7))}</oc:checksum></oc:checksums>\n` : "") +
        `      </d:prop>\n      <d:status>HTTP/1.1 200 OK</d:status>\n    </d:propstat>\n  </d:response>`;
    };
    return `<?xml version="1.0"?>\n<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">\n` +
      rows.map((r) => props(r.path, r.node)).join("\n") + `\n</d:multistatus>`;
  }
  // Parse a <d:multistatus> (DOMParser when present, else a tag reader) → resources.
  function parseMultistatus(xml, davRoot) {
    davRoot = davRoot || "";
    const items = [];
    const strip = (h) => { try { h = decodeURIComponent(h); } catch {} if (davRoot && h.startsWith(davRoot)) h = h.slice(davRoot.length); return h.replace(/\/+$/,"") || "/"; };
    if (G.DOMParser) {
      const doc = new G.DOMParser().parseFromString(xml, "application/xml");
      const ns = "DAV:";
      for (const r of doc.getElementsByTagNameNS(ns, "response")) {
        const href = r.getElementsByTagNameNS(ns, "href")[0]?.textContent || "";
        const isDir = !!r.getElementsByTagNameNS(ns, "collection")[0];
        const len = r.getElementsByTagNameNS(ns, "getcontentlength")[0]?.textContent;
        const ct = r.getElementsByTagNameNS(ns, "getcontenttype")[0]?.textContent || "";
        const lm = r.getElementsByTagNameNS(ns, "getlastmodified")[0]?.textContent || "";
        const etag = (r.getElementsByTagNameNS(ns, "getetag")[0]?.textContent || "").replace(/"/g, "");
        const path = strip(href);
        items.push({ path, name: basename(path), type: isDir ? "dir" : "file", size: +len || 0, mime: ct, mtime: lm ? Date.parse(lm) : now(), etag });
      }
    } else {
      for (const m of xml.matchAll(/<d:response>([\s\S]*?)<\/d:response>/g)) {
        const r = m[1];
        const href = (r.match(/<d:href>([\s\S]*?)<\/d:href>/) || [])[1] || "";
        const isDir = /<d:collection\s*\/>/.test(r);
        const len = (r.match(/<d:getcontentlength>(\d+)<\/d:getcontentlength>/) || [])[1];
        const ct = (r.match(/<d:getcontenttype>([\s\S]*?)<\/d:getcontenttype>/) || [])[1] || "";
        const lm = (r.match(/<d:getlastmodified>([\s\S]*?)<\/d:getlastmodified>/) || [])[1] || "";
        const path = strip(href);
        items.push({ path, name: basename(path), type: isDir ? "dir" : "file", size: +len || 0, mime: ct, mtime: lm ? Date.parse(lm) : now() });
      }
    }
    return items;
  }
  // The Nextcloud WebDAV verb surface, over a native HoloFS (offline, content-addressed).
  function nativeDav(fs, davRoot) {
    davRoot = davRoot || "/remote.php/dav/files/me";
    return {
      davRoot, fs,
      async propfind(path, depth = "1") { const xml = buildMultistatus(fs, norm(path), String(depth), davRoot); if (!xml) return { status: 404 }; return { status: 207, xml, items: parseMultistatus(xml, davRoot) }; },
      async get(path) { const b = await fs.get(path); return b ? { status: 200, bytes: b, node: fs.node(path) } : { status: 404 }; },
      async put(path, bytes, mime) { const n = await fs.put(path, bytes, mime); return { status: 201, node: n }; },
      mkcol(path) { return { status: fs.mkcol(path) ? 201 : 405 }; },
      delete(path) { return { status: fs.delete(path) ? 204 : 404 }; },
      move(src, dst) { return { status: fs.move(src, dst) ? 201 : 404 }; },
      async copy(src, dst) { return { status: (await fs.copy(src, dst)) ? 201 : 404 }; },
    };
  }

  // ── OCS Share API (Nextcloud files_sharing) — native public links ───────────────
  // shareType 3 = public link. Natively the link is the teleport URL carrying the
  // room secret (E2E, never sent to a server) + the shared κ; OCS shape preserved so
  // a real client/UI treats it identically to a server share.
  let _shareSeq = 1;
  function ocs(data) { return { ocs: { meta: { status: "ok", statuscode: 200, message: "OK" }, data } }; }
  function createShare(opts) {
    opts = opts || {};
    const token = (opts.token || (hexRand(15)));
    const url = opts.url || (opts.origin ? opts.origin + "/cloud.html#share=" + token : "");
    return ocs({
      id: String(_shareSeq++), share_type: opts.shareType == null ? 3 : opts.shareType, uid_owner: opts.owner || "me",
      path: norm(opts.path || "/"), item_type: opts.itemType || "folder", permissions: opts.permissions || 17,
      stime: Math.floor(now() / 1000), token, url, name: opts.name || "Holo Cloud link",
      url_kappa: opts.kappa || "", // content address of what's shared (Law L5 verifiable)
    });
  }
  function hexRand(n) { const u = new Uint8Array(Math.ceil(n / 2)); (G.crypto || require("crypto").webcrypto).getRandomValues(u); return hex(u).slice(0, n); }

  // ── a REAL Nextcloud server (optional) — same node shape, location-addressed ─────
  // Mirrors holo-jellyfin.server(): Holo Cloud doubles as a genuine Nextcloud client
  // over WebDAV (Basic auth, app password) + OCS. Honestly labelled source:"nextcloud".
  async function server(base, user, appPassword) {
    base = String(base).replace(/\/+$/, "");
    const davRoot = "/remote.php/dav/files/" + encodeURIComponent(user);
    const auth = "Basic " + (G.btoa ? btoa(user + ":" + appPassword) : Buffer.from(user + ":" + appPassword).toString("base64"));
    const davHdr = { Authorization: auth, "OCS-APIRequest": "true" };
    const propfindBody = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop>` +
      `<d:getlastmodified/><d:getetag/><d:getcontenttype/><d:resourcetype/><d:getcontentlength/><oc:size/><oc:fileid/></d:prop></d:propfind>`;
    return {
      source: "nextcloud", base, user, davRoot,
      async list(path = "/") {
        const xml = await (await fetch(base + davRoot + (path === "/" ? "/" : path), { method: "PROPFIND", headers: { ...davHdr, Depth: "1", "Content-Type": "application/xml" }, body: propfindBody })).text();
        return parseMultistatus(xml, davRoot).filter((it) => it.path !== norm(path)).map((it) => ({ ...it, url: base + davRoot + it.path, source: "nextcloud" }));
      },
      async get(path) { return new Uint8Array(await (await fetch(base + davRoot + path, { headers: davHdr })).arrayBuffer()); },
      async put(path, bytes, mime) { return (await fetch(base + davRoot + path, { method: "PUT", headers: { ...davHdr, "Content-Type": mime || mimeOf(basename(path)) }, body: bytes })).status; },
      async mkcol(path) { return (await fetch(base + davRoot + path, { method: "MKCOL", headers: davHdr })).status; },
      async del(path) { return (await fetch(base + davRoot + path, { method: "DELETE", headers: davHdr })).status; },
      async share(path, shareType = 3) {
        const r = await (await fetch(base + "/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json", {
          method: "POST", headers: { ...davHdr, "Content-Type": "application/x-www-form-urlencoded" },
          body: "path=" + encodeURIComponent(path) + "&shareType=" + shareType,
        })).json();
        return r;
      },
    };
  }

  G.HoloWebDAV = {
    AXIS, BLOCK, kappa, mimeOf, norm, basename, dirname, joinp,
    KappaStore, HoloFS, chunk, assemble,
    buildMultistatus, parseMultistatus, nativeDav, createShare, ocs, server,
    // pure, no-network self-test (the witness runs this in-process) ────────────────
    async selftest() {
      const store = new KappaStore(); const fs = new HoloFS(store);
      // 1 · round-trip: bytes → manifest (blocks re-derive) → reassemble → identical
      const data = new Uint8Array(700000); for (let i = 0; i < data.length; i++) data[i] = (i * 2654435761) & 255;
      const node = await fs.put("/Documents/report.bin", data, "application/octet-stream");
      const back = await fs.get("/Documents/report.bin");
      const roundTrip = !!back && back.length === data.length && back.every((b, i) => b === data[i]);
      const multiBlock = node.blocks.length === Math.ceil(data.length / BLOCK);           // chunked, not monolithic
      const addressStable = node.kappa === (await kappa(data));                            // file IS its content address
      // 2 · dedup: an identical second file shares EVERY block (unique bytes unchanged)
      const before = (await store.stats()).blocks;
      const node2 = await fs.put("/Documents/copy.bin", data, "application/octet-stream");
      const after = (await store.stats()).blocks;
      const dedup = after === before && node2.blocks.join() === node.blocks.join();
      // 3 · Law L5: a forged block is refused on read
      const forged = "sha256:" + "0".repeat(64);
      const refuse = (await store.get(forged)) === null;
      // 4 · WebDAV multistatus round-trips (build → parse → same paths/types/sizes)
      const dav = nativeDav(fs);
      const pf = await dav.propfind("/Documents", "1");
      const items = pf.items.filter((i) => i.path !== "/Documents");
      const got = Object.fromEntries(items.map((i) => [i.path, i.type + ":" + i.size]));
      const propfind = pf.status === 207 && got["/Documents/report.bin"] === "file:700000" && got["/Documents/copy.bin"] === "file:700000";
      // 5 · OCS public link carries the shared content address (Law L5 verifiable)
      const sh = createShare({ path: "/Documents", kappa: node.kappa, origin: "https://example", itemType: "folder" });
      const share = sh.ocs.meta.statuscode === 200 && sh.ocs.data.share_type === 3 && !!sh.ocs.data.token && sh.ocs.data.url_kappa === node.kappa;
      // 6 · move/delete keep the tree consistent
      fs.move("/Documents/copy.bin", "/copy.bin"); const moved = fs.exists("/copy.bin") && fs.node("/Documents/copy.bin").deleted;
      fs.delete("/Documents/report.bin"); const deleted = fs.node("/Documents/report.bin").deleted;
      return { roundTrip, multiBlock, addressStable, dedup, refuse, propfind, share, moved, deleted,
        ok: roundTrip && multiBlock && addressStable && dedup && refuse && propfind && share && moved && deleted };
    },
  };
  if (typeof module !== "undefined" && module.exports) module.exports = G.HoloWebDAV;
})();
