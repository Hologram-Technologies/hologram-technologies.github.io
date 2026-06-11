// holo-git.js — the native, content-addressed GIT CORE of the Holo Git holospace.
//
// First principles: git is ALREADY a content-addressed object store. Every object
// (blob · tree · commit · tag) is named by H("<type> <len>\0<bytes>") — its oid is
// its content. That is exactly a UOR κ-label (`<axis>:<hex>` = H(canonical_form),
// AGENTS.md): a git repository IS a κ-store. So Holo Git does not emulate git on
// top of some other store — it realises git's object model AS the substrate's
// κ-store, and the laws fall out for free:
//
//   L1 Content, not location — an object is addressed by its oid, never a path/URL.
//   L2 Canonical forms only  — we hold oids (κ), and (de)serialise git's canonical
//                              object encoding at the boundary.
//   L3 The store is memory   — KStore (OPFS-backed) is the address space; RAM caches.
//   L4 Through the substrate  — clone/fetch/push are announce(κ)+fetch(κ) over the
//                              repo's content-blind κ pub/sub (holo-kappa-sync); a
//                              git transfer is just "fetch the reachable oids I lack".
//   L5 Verify by re-derivation— every received object's oid is RE-DERIVED and refused
//                              on mismatch; a lying relay can withhold, never forge.
//
// Strict git conformance: object ids match real `git` byte-for-byte (git-witness.mjs
// uses `git hash-object` / `git mktree` / `git commit-tree` as the external oracle,
// per AGENTS.md "V&V by external ground truth — never self-reference"). Both object
// formats are supported: sha1 (git's default, maximal interop with real git/Gitea)
// and sha256 (git's modern mode + the substrate's σ-axis). Default: sha256.
//
// Pure, dependency-free: WebCrypto (SHA-1/SHA-256), TextEncoder, and OPFS where
// present (memory-only otherwise, so the same module runs in the Node witness).
// Exposes a small global `HoloGit` plus an in-page `selftest()` the witness runs.

(function () {
  "use strict";
  const G = typeof globalThis !== "undefined" ? globalThis : window;
  if (G.HoloGit) return;

  const te = new TextEncoder();
  const td = new TextDecoder();
  const subtle = (G.crypto && G.crypto.subtle) || null;

  // ── byte helpers ──────────────────────────────────────────────────────────────
  const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
  function hexToBytes(h) { const u = new Uint8Array(h.length / 2); for (let i = 0; i < u.length; i++) u[i] = parseInt(h.substr(i * 2, 2), 16); return u; }
  function concat(arrs) { let n = 0; for (const a of arrs) n += a.length; const out = new Uint8Array(n); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; }
  const asU8 = (x) => x instanceof Uint8Array ? x : typeof x === "string" ? te.encode(x) : new Uint8Array(x);
  const eq = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };

  const ALGO = { sha1: "SHA-1", sha256: "SHA-256" };
  async function digest(algo, bytes) {
    if (subtle) return new Uint8Array(await subtle.digest(ALGO[algo], bytes));
    const { createHash } = await import("node:crypto");           // Node fallback
    return new Uint8Array(createHash(algo === "sha1" ? "sha1" : "sha256").update(bytes).digest());
  }

  // ── git canonical object encoding ───────────────────────────────────────────────
  // storeBytes = "<type> <len>\0" ++ <content>.  oid = H(storeBytes). κ = "<algo>:<oid>".
  function frame(type, content) { content = asU8(content); return concat([te.encode(`${type} ${content.length}\0`), content]); }
  async function oidOf(type, content, algo) { return hex(await digest(algo || "sha256", frame(type, content))); }
  const kappa = (algo, oid) => `${algo}:${oid}`;
  const oidLen = (algo) => (algo === "sha1" ? 40 : 64);

  // parse a framed object → {type, content}
  function unframe(bytes) {
    bytes = asU8(bytes);
    let i = 0; while (i < bytes.length && bytes[i] !== 0x20) i++;       // space
    const type = td.decode(bytes.subarray(0, i));
    let j = ++i; while (j < bytes.length && bytes[j] !== 0x00) j++;     // NUL
    const len = parseInt(td.decode(bytes.subarray(i, j)), 10);
    const content = bytes.subarray(j + 1);
    if (content.length !== len) throw new Error(`object length mismatch: header ${len}, body ${content.length}`);
    return { type, content };
  }

  // ── KStore — the content-addressed object store (L3) ────────────────────────────
  // Keys are git oids (per algo). Backed by an in-memory Map + OPFS (persist across
  // reloads) + an optional κ pub/sub `sync` for serverless peer transfer (L4). Every
  // get RE-DERIVES the oid and refuses a mismatch (L5).
  class KStore {
    constructor(opts = {}) {
      this.algo = opts.algo || "sha256";
      this.mem = new Map();              // oid → framed bytes (plaintext, local)
      this.sync = opts.sync || null;     // KappaSync (announce/subscribe/fetch) — optional
      this.topic = opts.topic || null;   // repo's content-blind κ channel
      this.dir = opts.dir || "holo-git"; // OPFS subdir
      // Optional transport sealing: the κ label announced is the object's oid (a hash —
      // reveals nothing but equality), but the BYTES on the wire are AES-GCM ciphertext,
      // so a public broker/relay stays content-blind even for code (E2E). Local mem/OPFS
      // copies stay plaintext (it's your own browser). seal/unseal operate on Uint8Array.
      this.seal = opts.seal || null;
      this.unseal = opts.unseal || null;
      this._opfs = null;
      this._announced = new Set();
    }
    async _objDir() {
      if (this._opfs !== null) return this._opfs;
      try {
        const root = await G.navigator.storage.getDirectory();
        const base = await root.getDirectoryHandle(this.dir, { create: true });
        this._opfs = await base.getDirectoryHandle("objects", { create: true });
      } catch { this._opfs = false; }
      return this._opfs;
    }
    async _opfsGet(oid) {
      const d = await this._objDir(); if (!d) return null;
      try { const fh = await d.getFileHandle(oid); return new Uint8Array(await (await fh.getFile()).arrayBuffer()); } catch { return null; }
    }
    async _opfsPut(oid, bytes) {
      const d = await this._objDir(); if (!d) return;
      try { const fh = await d.getFileHandle(oid, { create: true }); const w = await fh.createWritable(); await w.write(bytes); await w.close(); } catch {}
    }
    // re-derive the oid of framed bytes (L5)
    async verify(oid, framed) { return (await digest(this.algo, framed)) && hex(await digest(this.algo, framed)) === oid; }
    has(oid) { return this.mem.has(oid); }
    // store framed object bytes; returns its oid (idempotent, dedup by content)
    async putFramed(framed) {
      framed = asU8(framed);
      const oid = hex(await digest(this.algo, framed));
      if (!this.mem.has(oid)) { this.mem.set(oid, framed); this._opfsPut(oid, framed); }
      if (this.sync && this.topic && !this._announced.has(oid)) {
        this._announced.add(oid);
        try { const wire = this.seal ? await this.seal(framed) : framed; await this.sync.announce(this.topic, kappa(this.algo, oid), wire); } catch {}
      }
      return oid;
    }
    // store an object given (type, content) — the common path
    async put(type, content) { return this.putFramed(frame(type, content)); }
    // resolve an oid → framed bytes: mem → OPFS → sync.fetch (verified). null on miss.
    async getFramed(oid) {
      let b = this.mem.get(oid);
      if (b) return b;
      b = await this._opfsGet(oid);
      if (b && await this.verify(oid, b)) { this.mem.set(oid, b); return b; }
      if (this.sync) {
        const k = kappa(this.algo, oid);
        const got = await this.sync.fetch(k, { verify: async (_k, bytes) => { const p = this.unseal ? await this.unseal(asU8(bytes)) : asU8(bytes); return p ? this.verify(oid, p) : false; } });
        if (got) { const plain = this.unseal ? await this.unseal(asU8(got)) : asU8(got); if (plain && await this.verify(oid, plain)) { this.mem.set(oid, plain); this._opfsPut(oid, plain); return plain; } }
      }
      return null;
    }
    async get(oid) { const f = await this.getFramed(oid); return f ? unframe(f) : null; }
    async loadTree() { /* OPFS objects are loaded lazily; mem warms on demand */ }
    // export a loose object exactly as git stores it on disk: zlib-deflate(framed).
    async loose(oid) {
      const f = await this.getFramed(oid); if (!f) return null;
      if (typeof G.CompressionStream === "function") {
        const cs = new G.CompressionStream("deflate"); const w = cs.writable.getWriter(); w.write(f); w.close();
        return new Uint8Array(await new Response(cs.readable).arrayBuffer());
      }
      try { const { deflateSync } = await import("node:zlib"); return new Uint8Array(deflateSync(f)); } catch { return f; }
    }
  }

  // ── object constructors / readers ───────────────────────────────────────────────
  const MODE = { file: "100644", exec: "100755", symlink: "120000", tree: "40000", gitlink: "160000" };

  // tree entries are sorted by name, with a trailing '/' appended for subtrees — git's
  // exact ordering (base_name_compare). Encoding: "<mode> <name>\0" ++ raw oid bytes.
  function treeSortKey(e) { return e.name + (e.mode === MODE.tree ? "/" : ""); }
  function cmpTreeEntries(a, b) { const ka = treeSortKey(a), kb = treeSortKey(b); return ka < kb ? -1 : ka > kb ? 1 : 0; }
  function encodeTree(entries, algo) {
    const sorted = entries.slice().sort(cmpTreeEntries);
    const parts = [];
    for (const e of sorted) {
      if (e.oid.length !== oidLen(algo)) throw new Error(`tree entry ${e.name}: oid len ${e.oid.length} ≠ ${oidLen(algo)}`);
      parts.push(te.encode(`${e.mode} ${e.name}\0`), hexToBytes(e.oid));
    }
    return concat(parts);
  }
  function decodeTree(content, algo) {
    content = asU8(content); const entries = []; let i = 0; const ol = oidLen(algo) / 2;
    while (i < content.length) {
      let s = i; while (content[i] !== 0x20) i++; const mode = td.decode(content.subarray(s, i)); i++;
      s = i; while (content[i] !== 0x00) i++; const name = td.decode(content.subarray(s, i)); i++;
      const oid = hex(content.subarray(i, i + ol)); i += ol;
      entries.push({ mode, name, oid, type: mode === MODE.tree ? "tree" : "blob" });
    }
    return entries;
  }

  const tz = (off) => { const s = off <= 0 ? "+" : "-"; off = Math.abs(off); return s + String((off / 60) | 0).padStart(2, "0") + String(off % 60).padStart(2, "0"); };
  function sig(p) { // {name,email,when(sec),tzOffset(min, JS getTimezoneOffset sign)}
    const when = p.when != null ? p.when : Math.floor(Date.now() / 1000);
    const off = p.tzOffset != null ? p.tzOffset : (new Date().getTimezoneOffset());
    return `${p.name} <${p.email}> ${when} ${tz(off)}`;
  }
  function encodeCommit(c) {
    let s = `tree ${c.tree}\n`;
    for (const p of (c.parents || [])) s += `parent ${p}\n`;
    s += `author ${typeof c.author === "string" ? c.author : sig(c.author)}\n`;
    s += `committer ${typeof c.committer === "string" ? c.committer : sig(c.committer || c.author)}\n`;
    if (c.gpgsig) s += `gpgsig ${c.gpgsig.replace(/\n/g, "\n ")}\n`;
    s += "\n" + c.message + (c.message.endsWith("\n") ? "" : "\n");   // git ensures trailing \n
    return te.encode(s);
  }
  function parsePerson(line) {
    const m = line.match(/^(.*) <(.*)> (\d+) ([+-]\d{4})$/);
    if (!m) return { name: line, email: "", when: 0, tz: "+0000" };
    return { name: m[1], email: m[2], when: +m[3], tz: m[4] };
  }
  function decodeCommit(content) {
    const text = td.decode(asU8(content)); const nl = text.indexOf("\n\n");
    const head = text.slice(0, nl < 0 ? text.length : nl); const message = nl < 0 ? "" : text.slice(nl + 2);
    const c = { parents: [], message }; let inGpg = false; const gpg = [];
    for (const line of head.split("\n")) {
      if (inGpg) { if (line.startsWith(" ")) { gpg.push(line.slice(1)); continue; } else inGpg = false; }
      if (line.startsWith("tree ")) c.tree = line.slice(5);
      else if (line.startsWith("parent ")) c.parents.push(line.slice(7));
      else if (line.startsWith("author ")) c.author = parsePerson(line.slice(7));
      else if (line.startsWith("committer ")) c.committer = parsePerson(line.slice(10));
      else if (line.startsWith("gpgsig ")) { inGpg = true; gpg.push(line.slice(7)); }
    }
    if (gpg.length) c.gpgsig = gpg.join("\n");
    return c;
  }
  function encodeTag(t) {
    let s = `object ${t.object}\n` + `type ${t.type}\n` + `tag ${t.tag}\n`;
    if (t.tagger) s += `tagger ${typeof t.tagger === "string" ? t.tagger : sig(t.tagger)}\n`;
    s += "\n" + t.message + (t.message.endsWith("\n") ? "" : "\n");
    return te.encode(s);
  }
  function decodeTag(content) {
    const text = td.decode(asU8(content)); const nl = text.indexOf("\n\n");
    const head = text.slice(0, nl < 0 ? text.length : nl); const message = nl < 0 ? "" : text.slice(nl + 2);
    const t = { message };
    for (const line of head.split("\n")) {
      if (line.startsWith("object ")) t.object = line.slice(7);
      else if (line.startsWith("type ")) t.type = line.slice(5);
      else if (line.startsWith("tag ")) t.tag = line.slice(4);
      else if (line.startsWith("tagger ")) t.tagger = parsePerson(line.slice(7));
    }
    return t;
  }

  // ── Repo — refs + the porcelain Gitea drives ────────────────────────────────────
  class Repo {
    constructor(opts = {}) {
      this.algo = opts.algo || "sha256";
      this.store = opts.store || new KStore({ algo: this.algo, sync: opts.sync, topic: opts.topic, dir: opts.dir });
      this.refs = new Map();             // "refs/heads/main" → oid   (mutable name→κ pointers)
      this.head = opts.head || "refs/heads/main"; // symbolic HEAD
      this.name = opts.name || "repo";
    }
    // ── object I/O ──────────────────────────────────────────────────────────────
    writeBlob(bytes) { return this.store.put("blob", asU8(bytes)); }
    async readBlob(oid) { const o = await this.store.get(oid); return o && o.type === "blob" ? o.content : null; }
    writeTreeEntries(entries) { return this.store.putFramed(frame("tree", encodeTree(entries, this.algo))); }
    async readTree(oid) { const o = await this.store.get(oid); return o && o.type === "tree" ? decodeTree(o.content, this.algo) : null; }
    writeCommit(c) { return this.store.putFramed(frame("commit", encodeCommit(c))); }
    async readCommit(oid) { const o = await this.store.get(oid); return o && o.type === "commit" ? decodeCommit(o.content) : null; }
    writeTag(t) { return this.store.putFramed(frame("tag", encodeTag(t))); }
    async readTag(oid) { const o = await this.store.get(oid); return o && o.type === "tag" ? decodeTag(o.content) : null; }
    async objectType(oid) { const o = await this.store.get(oid); return o ? o.type : null; }

    // ── build a tree from a flat {path: bytes|{oid,mode}} working set (nested) ─────
    async writeTreeFromFiles(files) {
      const root = { dirs: new Map(), files: [] };
      for (const path in files) {
        const segs = path.split("/").filter(Boolean); let node = root;
        for (let i = 0; i < segs.length - 1; i++) { const d = segs[i]; if (!node.dirs.has(d)) node.dirs.set(d, { dirs: new Map(), files: [] }); node = node.dirs.get(d); }
        node.files.push({ name: segs[segs.length - 1], val: files[path] });
      }
      const buildDir = async (node) => {
        const entries = [];
        for (const f of node.files) {
          if (f.val && f.val.oid) entries.push({ mode: f.val.mode || MODE.file, name: f.name, oid: f.val.oid });
          else { const oid = await this.writeBlob(asU8(f.val)); entries.push({ mode: MODE.file, name: f.name, oid }); }
        }
        for (const [name, child] of node.dirs) { const oid = await buildDir(child); entries.push({ mode: MODE.tree, name, oid }); }
        return this.writeTreeEntries(entries);
      };
      return buildDir(root);
    }
    // flatten a tree → {path: {oid, mode, type}} (recursive)
    async listTree(treeOid, prefix = "") {
      const out = {}; const entries = await this.readTree(treeOid); if (!entries) return out;
      for (const e of entries) {
        const path = prefix + e.name;
        if (e.mode === MODE.tree) Object.assign(out, await this.listTree(e.oid, path + "/"));
        else out[path] = { oid: e.oid, mode: e.mode, type: "blob" };
      }
      return out;
    }
    // resolve a path within a commit's tree → entry | null
    async pathEntry(treeOid, path) {
      const segs = String(path).split("/").filter(Boolean); let cur = treeOid;
      for (let i = 0; i < segs.length; i++) {
        const entries = await this.readTree(cur); if (!entries) return null;
        const e = entries.find((x) => x.name === segs[i]); if (!e) return null;
        if (i === segs.length - 1) return e;
        if (e.mode !== MODE.tree) return null; cur = e.oid;
      }
      return { mode: MODE.tree, name: "", oid: treeOid, type: "tree" };
    }

    // ── refs ───────────────────────────────────────────────────────────────────
    setRef(name, oid) { this.refs.set(name, oid); return oid; }
    getRef(name) { return this.refs.get(name) || null; }
    deleteRef(name) { return this.refs.delete(name); }
    listRefs(prefix) { const out = []; for (const [n, o] of this.refs) if (!prefix || n.startsWith(prefix)) out.push({ name: n, oid: o }); return out; }
    branches() { return this.listRefs("refs/heads/").map((r) => ({ name: r.name.slice("refs/heads/".length), oid: r.oid })); }
    tags() { return this.listRefs("refs/tags/").map((r) => ({ name: r.name.slice("refs/tags/".length), oid: r.oid })); }
    resolveHead() { return this.getRef(this.head); }
    setHeadBranch(branch) { this.head = "refs/heads/" + branch; return this.head; }
    defaultBranch() { return this.head.replace("refs/heads/", ""); }

    // commit a working set on top of a branch; advances the ref. Returns the commit oid.
    async commit(branch, files, meta) {
      const ref = "refs/heads/" + branch; const parentOid = this.getRef(ref);
      let baseFiles = {};
      if (parentOid) { const pc = await this.readCommit(parentOid); if (pc) baseFiles = await this.listTree(pc.tree); }
      const merged = { ...baseFiles };
      for (const p in files) { if (files[p] === null) delete merged[p]; else merged[p] = files[p]; } // null = delete
      const tree = await this.writeTreeFromFiles(merged);
      const author = meta.author || { name: meta.name || "Holo", email: meta.email || "holo@local" };
      const oid = await this.writeCommit({ tree, parents: parentOid ? [parentOid] : [], author, committer: meta.committer || author, message: meta.message || "" });
      this.setRef(ref, oid);
      return oid;
    }

    // ── history / diff / merge ───────────────────────────────────────────────────
    async log(startOid, limit = 100) {
      const out = []; const seen = new Set(); const q = [startOid].filter(Boolean);
      while (q.length && out.length < limit) {
        const oid = q.shift(); if (!oid || seen.has(oid)) continue; seen.add(oid);
        const c = await this.readCommit(oid); if (!c) continue;
        out.push({ oid, ...c });
        for (const p of c.parents) if (!seen.has(p)) q.push(p);
      }
      out.sort((a, b) => (b.committer ? b.committer.when : 0) - (a.committer ? a.committer.when : 0));
      return out.slice(0, limit);
    }
    async ancestors(oid, set = new Set()) {
      const q = [oid].filter(Boolean);
      while (q.length) { const o = q.shift(); if (!o || set.has(o)) continue; set.add(o); const c = await this.readCommit(o); if (c) for (const p of c.parents) q.push(p); }
      return set;
    }
    async mergeBase(a, b) {
      if (!a || !b) return null; if (a === b) return a;
      const aset = await this.ancestors(a);
      const seen = new Set(); const q = [b];
      while (q.length) { const o = q.shift(); if (!o || seen.has(o)) continue; seen.add(o); if (aset.has(o)) return o; const c = await this.readCommit(o); if (c) for (const p of c.parents) q.push(p); }
      return null;
    }
    async isAncestor(a, b) { return (await this.ancestors(b)).has(a); }

    // tree-vs-tree diff → [{path, status:'A'|'M'|'D', a, b}]
    async diffTrees(aTreeOid, bTreeOid) {
      const A = aTreeOid ? await this.listTree(aTreeOid) : {};
      const B = bTreeOid ? await this.listTree(bTreeOid) : {};
      const paths = new Set([...Object.keys(A), ...Object.keys(B)]); const out = [];
      for (const p of [...paths].sort()) {
        const a = A[p], b = B[p];
        if (a && !b) out.push({ path: p, status: "D", a, b: null });
        else if (!a && b) out.push({ path: p, status: "A", a: null, b });
        else if (a.oid !== b.oid) out.push({ path: p, status: "M", a, b });
      }
      return out;
    }
    // commit-vs-commit diff (against first parent / given base)
    async diffCommits(baseOid, headOid) {
      const bt = baseOid ? (await this.readCommit(baseOid))?.tree : null;
      const ht = headOid ? (await this.readCommit(headOid))?.tree : null;
      const changes = await this.diffTrees(bt, ht); const files = [];
      for (const ch of changes) {
        const aTxt = ch.a ? td.decode(await this.readBlob(ch.a.oid) || new Uint8Array()) : "";
        const bTxt = ch.b ? td.decode(await this.readBlob(ch.b.oid) || new Uint8Array()) : "";
        files.push({ ...ch, patch: unifiedDiff(ch.path, aTxt, bTxt) });
      }
      return files;
    }

    // file history — commits where the blob at `path` changed vs its first parent.
    async _pathOid(treeOid, path) { const e = await this.pathEntry(treeOid, path); return e ? e.oid : null; }
    async logByPath(startOid, path, limit = 50) {
      const out = []; const all = await this.log(startOid, 2000);
      for (const c of all) {
        const cur = await this._pathOid(c.tree, path);
        const parent = c.parents && c.parents[0] ? await this.readCommit(c.parents[0]) : null;
        const prev = parent ? await this._pathOid(parent.tree, path) : null;
        if (cur !== prev) out.push(c);
        if (out.length >= limit) break;
      }
      return out;
    }
    // commits reachable from head but not base, oldest-first (rebase replay order).
    async _commitsBetween(base, head) {
      const baseSet = base ? await this.ancestors(base) : new Set();
      const set = await this.ancestors(head); const list = [];
      for (const oid of set) if (!baseSet.has(oid)) { const c = await this.readCommit(oid); if (c) list.push({ oid, ...c }); }
      list.sort((a, b) => (a.committer ? a.committer.when : 0) - (b.committer ? b.committer.when : 0));
      return list;
    }
    // 3-way merge of two trees → { tree, conflicts }. The integration primitive.
    async _mergeTrees(base, intoOid, fromOid) {
      const baseFiles = base ? await this.listTree((await this.readCommit(base)).tree) : {};
      const ours = await this.listTree((await this.readCommit(intoOid)).tree);
      const theirs = await this.listTree((await this.readCommit(fromOid)).tree);
      const result = {}; const conflicts = [];
      const paths = new Set([...Object.keys(baseFiles), ...Object.keys(ours), ...Object.keys(theirs)]);
      for (const p of paths) {
        const bo = baseFiles[p]?.oid, oo = ours[p]?.oid, to = theirs[p]?.oid;
        if (oo === to) { if (oo) result[p] = ours[p]; continue; }
        if (oo === bo) { if (to) result[p] = theirs[p]; continue; }
        if (to === bo) { if (oo) result[p] = ours[p]; continue; }
        const baseT = bo ? td.decode(await this.readBlob(bo) || new Uint8Array()) : "";
        const ourT = oo ? td.decode(await this.readBlob(oo) || new Uint8Array()) : "";
        const theirT = to ? td.decode(await this.readBlob(to) || new Uint8Array()) : "";
        const m = merge3(ourT, baseT, theirT);
        result[p] = { oid: await this.writeBlob(te.encode(m.text)), mode: (ours[p] || theirs[p]).mode };
        if (m.conflict) conflicts.push(p);
      }
      return { tree: await this.writeTreeFromFiles(result), conflicts };
    }
    // merge `fromOid` into branch `into` by `method` (merge | squash | rebase) — the
    // three Gitea merge styles. Returns { oid, conflicts, <style flag> }.
    async merge(intoBranch, fromOid, meta, opts = {}) {
      const method = opts.method || "merge";
      const intoRef = "refs/heads/" + intoBranch; const intoOid = this.getRef(intoRef);
      const author = meta.author || { name: meta.name || "Holo", email: meta.email || "holo@local" };
      const committer = meta.committer || author;
      if (!intoOid) { this.setRef(intoRef, fromOid); return { oid: fromOid, fastForward: true, conflicts: [] }; }
      if (await this.isAncestor(fromOid, intoOid)) return { oid: intoOid, alreadyUpToDate: true, conflicts: [] };
      const base = await this.mergeBase(intoOid, fromOid);
      if (method === "rebase") {
        const chain = await this._commitsBetween(base, fromOid); let parent = intoOid; let conflicts = [];
        for (const c of chain) { parent = await this.writeCommit({ tree: c.tree, parents: [parent], author: c.author, committer: c.committer, message: c.message }); }
        this.setRef(intoRef, parent); return { oid: parent, conflicts, rebased: true };
      }
      const { tree, conflicts } = await this._mergeTrees(base, intoOid, fromOid);
      if (method === "squash") {
        const oid = await this.writeCommit({ tree, parents: [intoOid], author, committer, message: meta.message || "Squashed commit" });
        this.setRef(intoRef, oid); return { oid, conflicts, squashed: true };
      }
      // default — a merge commit (Gitea "Create merge commit", --no-ff)
      const oid = await this.writeCommit({ tree, parents: [intoOid, fromOid], author, committer, message: meta.message || "Merge" });
      this.setRef(intoRef, oid); return { oid, conflicts, merged: true };
    }

    // ── transfer (serverless clone/fetch/push) — L4 over the κ pub/sub ────────────
    // The set of oids reachable from a commit/tree (closure). Fetching is "pull the
    // reachable oids I don't already have" — content-addressing makes it dedup-exact.
    async reachable(oids, into = new Set()) {
      const q = Array.isArray(oids) ? oids.slice() : [oids];
      while (q.length) {
        const oid = q.pop(); if (!oid || into.has(oid)) continue;
        const o = await this.store.get(oid); if (!o) { into.add(oid); continue; }
        into.add(oid);
        if (o.type === "commit") { const c = decodeCommit(o.content); q.push(c.tree, ...c.parents); }
        else if (o.type === "tree") { for (const e of decodeTree(o.content, this.algo)) q.push(e.oid); }
        else if (o.type === "tag") { const t = decodeTag(o.content); q.push(t.object); }
      }
      return into;
    }
    // fetch every object reachable from a set of tip oids (each verified on receipt).
    async fetchReachable(tipOids, onProgress) {
      const want = Array.isArray(tipOids) ? tipOids.slice() : [tipOids];
      const done = new Set(); let n = 0;
      while (want.length) {
        const oid = want.pop(); if (!oid || done.has(oid)) continue; done.add(oid);
        const o = await this.store.get(oid);                 // get → sync.fetch + L5 verify
        if (!o) continue; n++; onProgress && onProgress(n, oid);
        if (o.type === "commit") { const c = decodeCommit(o.content); want.push(c.tree, ...c.parents); }
        else if (o.type === "tree") { for (const e of decodeTree(o.content, this.algo)) want.push(e.oid); }
        else if (o.type === "tag") { const t = decodeTag(o.content); want.push(t.object); }
      }
      return n;
    }
    // announce every object reachable from the current refs (push). Objects are also
    // announced lazily as written; this is the explicit "publish my repo" pass.
    async push(onProgress) {
      const tips = [...this.refs.values()]; const set = await this.reachable(tips); let n = 0;
      for (const oid of set) { const f = await this.store.getFramed(oid); if (f) { await this.store.putFramed(f); n++; onProgress && onProgress(n, oid); } }
      return n;
    }
  }

  // ── line diff (Myers O(ND)) + unified patch ─────────────────────────────────────
  function splitLines(s) { if (s === "") return []; const a = s.split("\n"); if (a[a.length - 1] === "") a.pop(); return a; }
  // returns ops: [{t:' '|'-'|'+', line}]
  function diffLines(aLines, bLines) {
    const N = aLines.length, M = bLines.length, MAX = N + M;
    const v = new Map(); v.set(1, 0); const trace = [];
    let found = -1;
    for (let d = 0; d <= MAX; d++) {
      const vd = new Map();
      for (let k = -d; k <= d; k += 2) {
        let x; const down = (k === -d || (k !== d && (v.get(k - 1) || 0) < (v.get(k + 1) || 0)));
        x = down ? (v.get(k + 1) || 0) : (v.get(k - 1) || 0) + 1;
        let y = x - k;
        while (x < N && y < M && aLines[x] === bLines[y]) { x++; y++; }
        vd.set(k, x);
        if (x >= N && y >= M) { found = d; break; }
      }
      trace.push(vd); for (const [k, x] of vd) v.set(k, x);
      if (found >= 0) break;
    }
    // backtrack
    const ops = []; let x = N, y = M;
    for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
      const vp = trace[d - 1] || new Map([[1, 0]]); const k = x - y;
      const down = (k === -d || (k !== d && (vp.get(k - 1) || 0) < (vp.get(k + 1) || 0)));
      const pk = down ? k + 1 : k - 1; const px = vp.get(pk) || 0; const py = px - pk;
      while (x > px && y > py) { ops.push({ t: " ", line: aLines[x - 1] }); x--; y--; }
      if (d > 0) { if (down) { ops.push({ t: "+", line: bLines[y - 1] }); y--; } else { ops.push({ t: "-", line: aLines[x - 1] }); x--; } }
    }
    ops.reverse(); return ops;
  }
  function unifiedDiff(path, aText, bText, ctx = 3) {
    const a = splitLines(aText), b = splitLines(bText);
    const ops = diffLines(a, b);
    if (!ops.some((o) => o.t !== " ")) return { path, hunks: [], binary: false, additions: 0, deletions: 0 };
    // group into hunks with context
    const hunks = []; let i = 0; let ai = 0, bi = 0; let add = 0, del = 0;
    while (i < ops.length) {
      while (i < ops.length && ops[i].t === " ") { i++; ai++; bi++; }
      if (i >= ops.length) break;
      let start = i, sAi = ai, sBi = bi;
      // include leading context
      let lead = Math.min(ctx, start - (hunks.length ? 0 : 0));
      const back = Math.min(ctx, start); start -= back; sAi -= back; sBi -= back;
      let j = i, eAi = ai, eBi = bi;
      while (j < ops.length) { if (ops[j].t === " ") { let run = 0, k = j; while (k < ops.length && ops[k].t === " ") { run++; k++; } if (run > ctx * 2 || k >= ops.length) { j += Math.min(ctx, run); if (ops[j - 1]) {} break; } } j++; }
      // recompute slice [start, end)
      let end = j; const slice = ops.slice(start, end);
      let aCount = 0, bCount = 0, ah = 0, bh = 0;
      const lines = slice.map((o) => { if (o.t === " ") { aCount++; bCount++; } else if (o.t === "-") { aCount++; del++; } else { bCount++; add++; } return o; });
      hunks.push({ aStart: sAi + 1, aCount, bStart: sBi + 1, bCount, lines });
      // advance counters past this slice
      for (let p = i; p < end; p++) { if (ops[p].t !== "+") ai++; if (ops[p].t !== "-") bi++; }
      i = end;
    }
    return { path, hunks, binary: false, additions: add, deletions: del };
  }

  // ── diff3 3-way text merge ───────────────────────────────────────────────────────
  function merge3(ours, base, theirs) {
    const O = splitLines(ours), B = splitLines(base), T = splitLines(theirs);
    const dO = diffLines(B, O), dT = diffLines(B, T);
    // map each base line index → change on each side, then walk base
    const out = []; let conflict = false;
    let i = 0, j = 0;            // pointers in dO, dT
    // helper: collect a side's edit at current base position
    function take(diff, p) { // returns {consumedBase, added:[]}
      const added = []; let q = p;
      while (q < diff.length && diff[q].t === "+") { added.push(diff[q].line); q++; }
      return { added, next: q };
    }
    // Walk base lines synchronously across both diffs
    const oOps = dO, tOps = dT;
    while (i < oOps.length || j < tOps.length) {
      const oAdd = take(oOps, i), tAdd = take(tOps, j); i = oAdd.next; j = tAdd.next;
      if (oAdd.added.length || tAdd.added.length) {
        if (JSON.stringify(oAdd.added) === JSON.stringify(tAdd.added)) out.push(...oAdd.added);
        else if (!tAdd.added.length) out.push(...oAdd.added);
        else if (!oAdd.added.length) out.push(...tAdd.added);
        else { conflict = true; out.push("<<<<<<< ours", ...oAdd.added, "=======", ...tAdd.added, ">>>>>>> theirs"); }
      }
      const oc = oOps[i], tc = tOps[j];
      if (!oc && !tc) break;
      const ot = oc ? oc.t : " ", tt = tc ? tc.t : " ";
      if (ot === " " && tt === " ") { out.push(oc.line); i++; j++; }
      else if (ot === "-" && tt === "-") { i++; j++; }                          // both delete
      else if (ot === "-" && tt === " ") { i++; j++; }                          // ours deletes
      else if (ot === " " && tt === "-") { i++; j++; }                          // theirs deletes
      else { // divergent (one keeps, one deletes) — conservative: keep present line
        if (oc && ot !== "-") { out.push(oc.line); i++; if (tc) j++; }
        else if (tc && tt !== "-") { out.push(tc.line); j++; if (oc) i++; }
        else { i++; j++; }
      }
    }
    return { text: out.join("\n") + (out.length ? "\n" : ""), conflict };
  }

  // ── high-level: open a repo wired to a κ pub/sub channel ────────────────────────
  async function open(opts = {}) {
    const repo = new Repo(opts);
    await repo.store.loadTree();
    return repo;
  }

  // ── in-page selftest (the witness runs this; pure, no network) ───────────────────
  async function selftest() {
    const R = (algo) => new Repo({ algo, dir: "holo-git-selftest" });
    const results = {};
    // 1 · git object-id KATs (external ground truth — match real git exactly)
    const r1 = R("sha1");
    results.emptyBlobSha1 = (await r1.writeBlob(new Uint8Array())) === "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391";
    results.helloBlobSha1 = (await r1.writeBlob(te.encode("hello\n"))) === "ce013625030ba8dba906f756967f9e9ca394464a";
    results.emptyTreeSha1 = (await r1.writeTreeEntries([])) === "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
    const r256 = R("sha256");
    results.emptyBlobSha256 = (await r256.writeBlob(new Uint8Array())) === "473a0f4c3be8a93681a267e3b1e9a7dcda1185436fe141f7749120a303721813";
    results.emptyTreeSha256 = (await r256.writeTreeEntries([])) === "6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321";
    // 2 · round-trip blob/tree/commit
    const r = R("sha256");
    const bo = await r.writeBlob(te.encode("alpha\nbeta\n"));
    results.blobRoundTrip = td.decode(await r.readBlob(bo)) === "alpha\nbeta\n";
    const c1 = await r.commit("main", { "a.txt": te.encode("alpha\nbeta\n"), "dir/b.txt": te.encode("two\n") }, { message: "init", author: { name: "T", email: "t@x", when: 1000, tzOffset: 0 } });
    const files = await r.listTree((await r.readCommit(c1)).tree);
    results.treeNesting = !!files["a.txt"] && !!files["dir/b.txt"];
    results.commitRoundTrip = (await r.readCommit(c1)).message === "init\n";
    // 3 · dedup — identical content stored once
    const before = r.store.mem.size; await r.writeBlob(te.encode("alpha\nbeta\n"));
    results.dedup = r.store.mem.size === before;
    // 4 · L5 — a forged byte is refused
    const framed = await r.store.getFramed(bo); const forged = framed.slice(); forged[forged.length - 1] ^= 0xff;
    results.l5refuse = !(await r.store.verify(bo, forged)) && (await r.store.verify(bo, framed));
    // 5 · diff
    const ud = unifiedDiff("x", "a\nb\nc\n", "a\nB\nc\n");
    results.diff = ud.additions === 1 && ud.deletions === 1 && ud.hunks.length === 1;
    // 6 · 3-way merge: non-overlapping changes merge clean; overlapping conflict
    const clean = merge3("X\nb\nc\n", "a\nb\nc\n", "a\nb\nY\n");
    const conf = merge3("X\nb\nc\n", "a\nb\nc\n", "Y\nb\nc\n");
    results.merge3clean = !clean.conflict && clean.text.includes("X") && clean.text.includes("Y");
    results.merge3conflict = conf.conflict;
    // 7 · history walk + merge-base
    const c2 = await r.commit("main", { "a.txt": te.encode("alpha\nbeta\ngamma\n") }, { message: "more", author: { name: "T", email: "t@x", when: 2000, tzOffset: 0 } });
    const lg = await r.log(c2); results.log = lg.length === 2 && lg[0].oid === c2;
    results.mergeBase = (await r.mergeBase(c1, c2)) === c1;
    results.ok = Object.values(results).every(Boolean);
    return results;
  }

  G.HoloGit = {
    Repo, KStore, open, selftest,
    // primitives (used by holo-gitea.js + witnesses)
    frame, unframe, oidOf, kappa, MODE, encodeTree, decodeTree, encodeCommit, decodeCommit,
    encodeTag, decodeTag, unifiedDiff, diffLines, merge3, digest, hex, hexToBytes, sig,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = G.HoloGit;
})();
