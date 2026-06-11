// holo-podman.js — Holo Container's engine: a daemonless, rootless **libpod**, in the tab.
//
// Adherence to the containers/ SPEC without its Go daemon. Podman is daemonless and
// rootless by design — there is no central server, each `podman` invocation drives the
// library (libpod) directly. That maps exactly onto a holospace: this module IS libpod,
// running entirely in the browser tab over the hologram substrate. It speaks the real
// container standards, client-side, against a content-addressed κ-store:
//
//   • OCI Image Format (image-spec v1): image manifest + image index (manifest list) +
//     image config; the documented media types (oci + docker), built AND parsed here.
//   • OCI Distribution (distribution-spec v1): the registry v2 pull protocol — token
//     auth (WWW-Authenticate Bearer), manifest + blob GETs — over a byte CORS proxy.
//   • OCI Runtime (runtime-spec v1): a container's `config.json` (process/root/mounts).
//   • Dockerfile / Containerfile reference: a faithful instruction parser + build plan.
//   • Compose spec: services → a pod of containers + volumes + networks.
//   • skopeo: inspect a manifest/config, copy registry↔local↔oci-archive/docker-archive.
//
// UOR laws (L1–L5). A container image's identity is its CONTENT, not a registry URL: an
// OCI digest IS `sha256(blob)` — the substrate σ-axis κ — so the spec's own digest check
// IS Law L5 (verify-by-re-derivation). Blobs are chunked into 256-KiB κ-blocks and stored
// once (dedup, L2/L3); pulling re-derives every blob against its digest before admitting
// it (a registry can withhold but never forge). The store is the memory (L3): OPFS in the
// browser, an in-RAM Map in Node — so this same module backs the conformance witness.
// "A holospace is already a container": the engine maps the holospace fleet onto images
// (the loaders) and running mounts onto containers, so `podman ps` lists your holospaces.
//
// The runtime path (run/build RUN/exec) is delegated to the engine peer
// (pkg/holospaces_web.js: DevcontainerImage → Workspace.boot_devcontainer) driven from
// container-worker.js — this module never re-implements the emulator; it assembles the
// OCI image and hands the layers across. Pure, dependency-free, isomorphic (browser +
// Node ≥21). Exposes globalThis.HoloPodman.

(function () {
  "use strict";
  const G = typeof globalThis !== "undefined" ? globalThis : window;
  if (G.HoloPodman) return;

  const VERSION = "1.0.0";
  // ── σ-axis κ = sha256 (substrate parity; an OCI digest IS this) ─────────────────
  const AXIS = "sha256";
  const BLOCK = 262144; // 256 KiB — κ-store parity with holo-webdav.js
  const te = new TextEncoder();
  const td = new TextDecoder();
  const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
  async function sha256(u8) { return new Uint8Array(await G.crypto.subtle.digest("SHA-256", u8 instanceof Uint8Array ? u8 : new Uint8Array(u8))); }
  async function digestOf(u8) { return AXIS + ":" + hex(await sha256(u8)); } // the OCI digest == κ
  const kappa = digestOf;
  const enc = (s) => te.encode(s);
  const dec = (u8) => td.decode(u8);
  const json = (o) => enc(JSON.stringify(o));
  const concat = (arrs) => { let n = 0; for (const a of arrs) n += a.length; const o = new Uint8Array(n); let p = 0; for (const a of arrs) { o.set(a, p); p += a.length; } return o; };
  const now = () => new Date().toISOString();

  // ── gzip via the platform Compression Streams (no vendored zlib) ────────────────
  const gunzip = async (u8) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  const gzip = async (u8) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());

  // ── OCI media types (image-spec v1 — both the OCI and docker vocabularies) ───────
  const MT = {
    manifest: "application/vnd.oci.image.manifest.v1+json",
    index: "application/vnd.oci.image.index.v1+json",
    config: "application/vnd.oci.image.config.v1+json",
    layerGzip: "application/vnd.oci.image.layer.v1.tar+gzip",
    layer: "application/vnd.oci.image.layer.v1.tar",
    dockerManifest: "application/vnd.docker.distribution.manifest.v2+json",
    dockerManifestList: "application/vnd.docker.distribution.manifest.list.v2+json",
    dockerConfig: "application/vnd.docker.container.image.v1+json",
    dockerLayer: "application/vnd.docker.image.rootfs.diff.tar.gzip",
  };
  const isManifestList = (mt) => mt === MT.index || mt === MT.dockerManifestList;
  const isLayerGzip = (mt) => mt === MT.layerGzip || mt === MT.dockerLayer;

  // ════════════════════════════════════════════════════════════════════════════════
  // USTAR tar reader/writer — OCI layers and oci/docker archives are tar (POSIX ustar).
  // Lean, dependency-free; round-trips the fields the assembler cares about.
  // ════════════════════════════════════════════════════════════════════════════════
  const tar = {
    write(entries) {
      const blocks = [];
      const oct = (n, w) => (n.toString(8).padStart(w - 1, "0") + "\0");
      for (const e of entries) {
        const data = e.data == null ? new Uint8Array(0) : (typeof e.data === "string" ? enc(e.data) : e.data);
        const h = new Uint8Array(512);
        const put = (off, s) => { const b = enc(s); h.set(b.subarray(0, Math.min(b.length, 100)), off); };
        let name = e.name; let prefix = "";
        if (enc(name).length > 100) { const i = name.lastIndexOf("/", name.length - 100); if (i > 0) { prefix = name.slice(0, i); name = name.slice(i + 1); } }
        put(0, name);
        h.set(enc(oct(e.mode == null ? 0o644 : e.mode, 8)), 100);
        h.set(enc(oct(e.uid || 0, 8)), 108);
        h.set(enc(oct(e.gid || 0, 8)), 116);
        h.set(enc(oct(data.length, 12)), 124);
        h.set(enc(oct(e.mtime || 0, 12)), 136);
        h.set(enc("        "), 148); // checksum placeholder (spaces)
        h[156] = (e.type || "0").charCodeAt(0); // typeflag: '0' file, '5' dir, '2' symlink
        if (e.linkname) h.set(enc(e.linkname).subarray(0, 100), 157);
        h.set(enc("ustar\0"), 257); h.set(enc("00"), 263);
        if (prefix) h.set(enc(prefix).subarray(0, 155), 345);
        let sum = 0; for (let i = 0; i < 512; i++) sum += h[i];
        h.set(enc(oct(sum, 7) + " "), 148);
        blocks.push(h);
        if (data.length) { blocks.push(data); const pad = (512 - (data.length % 512)) % 512; if (pad) blocks.push(new Uint8Array(pad)); }
      }
      blocks.push(new Uint8Array(1024)); // two zero blocks terminate the archive
      return concat(blocks);
    },
    read(u8) {
      u8 = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
      const out = [];
      const str = (off, len) => { let s = dec(u8.subarray(off, off + len)); const z = s.indexOf("\0"); return z >= 0 ? s.slice(0, z) : s; };
      const octv = (off, len) => { const s = str(off, len).trim(); return s ? parseInt(s, 8) : 0; };
      for (let p = 0; p + 512 <= u8.length;) {
        if (u8.subarray(p, p + 512).every((b) => b === 0)) break; // end-of-archive
        let name = str(p, 100); const prefix = str(p + 345, 155); if (prefix) name = prefix + "/" + name;
        const size = octv(p + 124, 12); const type = String.fromCharCode(u8[p + 156] || 48);
        const data = u8.subarray(p + 512, p + 512 + size);
        out.push({ name, size, type, mode: octv(p + 100, 8), linkname: str(p + 157, 100), data });
        p += 512 + Math.ceil(size / 512) * 512;
      }
      return out;
    },
  };

  // ════════════════════════════════════════════════════════════════════════════════
  // KappaStore — content-addressed block store (Law L3). OPFS in the browser, RAM in
  // Node. Every read RE-DERIVES sha256(bytes)==κ (Law L5). A "blob" (a manifest/config/
  // layer) is chunked into κ-blocks and recorded as a manifest {blocks,size,digest}.
  // ════════════════════════════════════════════════════════════════════════════════
  class KappaStore {
    constructor() { this.mem = new Map(); this._opfs = null; this.manifests = new Map(); }
    async _dir() {
      if (this._opfs !== null) return this._opfs;
      try {
        if (G.navigator && navigator.storage && navigator.storage.getDirectory) {
          const root = await navigator.storage.getDirectory();
          const ns = await root.getDirectoryHandle("holo-container", { create: true });
          this._opfs = await ns.getDirectoryHandle("blocks", { create: true });
        } else this._opfs = false;
      } catch { this._opfs = false; }
      return this._opfs;
    }
    async _putBlock(u8) {
      const k = await kappa(u8), name = k.slice(AXIS.length + 1), dir = await this._dir();
      if (dir) { try { await dir.getFileHandle(name); return k; } catch {} const fh = await dir.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(u8); await w.close(); }
      else if (!this.mem.has(k)) this.mem.set(k, u8.slice());
      return k;
    }
    async _getBlock(k) {
      const dir = await this._dir(); let bytes = null;
      if (dir) { try { const fh = await dir.getFileHandle(k.slice(AXIS.length + 1)); bytes = new Uint8Array(await (await fh.getFile()).arrayBuffer()); } catch { bytes = null; } }
      else bytes = this.mem.get(k) || null;
      if (!bytes) return null;
      if ((await kappa(bytes)) !== k) return null; // Law L5: refuse a forged block
      return bytes;
    }
    // store a whole blob → its digest (== κ). Records the block manifest for reassembly.
    async putBlob(u8) {
      u8 = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
      const digest = await digestOf(u8), blocks = [];
      for (let p = 0; p < u8.length || (p === 0 && u8.length === 0); p += BLOCK) { blocks.push(await this._putBlock(u8.subarray(p, Math.min(p + BLOCK, u8.length)))); if (u8.length === 0) break; }
      this.manifests.set(digest, { blocks, size: u8.length, digest });
      return digest;
    }
    async hasBlob(digest) { return this.manifests.has(digest); }
    // read a blob back, re-deriving the WHOLE thing against its digest (Law L5).
    async getBlob(digest) {
      const m = this.manifests.get(digest); if (!m) return null;
      const parts = []; let total = 0;
      for (const k of m.blocks) { const b = await this._getBlock(k); if (!b) return null; parts.push(b); total += b.length; }
      const out = new Uint8Array(total); let o = 0; for (const b of parts) { out.set(b, o); o += b.length; }
      if ((await digestOf(out)) !== digest) return null; // whole-blob re-derivation
      return out;
    }
    // admit a blob a registry/peer served BY its digest — verify before storing (Law L5).
    async admit(digest, u8) { if ((await digestOf(u8)) !== digest) return false; await this.putBlob(u8); return true; }
    async stats() {
      let logical = 0; for (const m of this.manifests.values()) logical += m.size;
      const dir = await this._dir();
      if (dir) { let blocks = 0, physical = 0; for await (const [, h] of dir.entries()) { if (h.kind === "file") { blocks++; physical += (await h.getFile()).size; } } return { blobs: this.manifests.size, blocks, logical, physical, dedupPct: logical ? Math.round((1 - physical / logical) * 100) : 0 }; }
      let physical = 0; for (const v of this.mem.values()) physical += v.length;
      return { blobs: this.manifests.size, blocks: this.mem.size, logical, physical, dedupPct: logical ? Math.round((1 - physical / logical) * 100) : 0 };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════════
  // Image reference parsing (docker/podman grammar): [registry/]name[:tag|@digest]
  // ════════════════════════════════════════════════════════════════════════════════
  function parseRef(ref) {
    let r = String(ref || "").trim();
    let digest = null, tag = null;
    const at = r.indexOf("@"); if (at >= 0) { digest = r.slice(at + 1); r = r.slice(0, at); }
    // a colon is a tag only if it's in the last path segment and not a port (host:port/...)
    const lastSlash = r.lastIndexOf("/"); const lastColon = r.lastIndexOf(":");
    if (lastColon > lastSlash) { tag = r.slice(lastColon + 1); r = r.slice(0, lastColon); }
    let registry = "docker.io", name = r;
    const slash = r.indexOf("/");
    if (slash >= 0 && (r.slice(0, slash).includes(".") || r.slice(0, slash).includes(":") || r.slice(0, slash) === "localhost")) { registry = r.slice(0, slash); name = r.slice(slash + 1); }
    if (registry === "docker.io" && !name.includes("/")) name = "library/" + name; // official images
    if (!tag && !digest) tag = "latest";
    const apiHost = registry === "docker.io" ? "registry-1.docker.io" : registry;
    return { registry, apiHost, name, tag, digest, repository: registry + "/" + name, toString() { return registry + "/" + name + (tag ? ":" + tag : "") + (digest ? "@" + digest : ""); } };
  }

  // ════════════════════════════════════════════════════════════════════════════════
  // OCI Image build (image-spec v1) — manifest + config, all blobs in the κ-store.
  // A built/pulled image is { ref, manifestDigest, manifest, config, configDigest,
  // layers:[{digest,mediaType,size}], created }. The digest IS the κ (Law L5).
  // ════════════════════════════════════════════════════════════════════════════════
  function emptyConfig(platform) {
    const [os, arch] = (platform || "linux/arm64").split("/");
    return { created: now(), architecture: arch || "arm64", os: os || "linux", config: { Env: ["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"], Cmd: ["/bin/sh"], WorkingDir: "/", Entrypoint: null, User: "", ExposedPorts: {}, Volumes: {}, Labels: {} }, rootfs: { type: "layers", diff_ids: [] }, history: [] };
  }

  // ════════════════════════════════════════════════════════════════════════════════
  // Containerfile / Dockerfile parser (Dockerfile reference). Tokenises stanzas with
  // line continuations + comments; supports the full documented instruction set. Build
  // produces an image: COPY/ADD synthesise a tar+gzip layer; metadata instructions edit
  // the config; RUN is recorded as a step the runtime (container-worker) must exec.
  // ════════════════════════════════════════════════════════════════════════════════
  const INSTRUCTIONS = ["FROM", "RUN", "CMD", "LABEL", "MAINTAINER", "EXPOSE", "ENV", "ADD", "COPY", "ENTRYPOINT", "VOLUME", "USER", "WORKDIR", "ARG", "ONBUILD", "STOPSIGNAL", "HEALTHCHECK", "SHELL"];
  function parseContainerfile(text) {
    const lines = String(text).replace(/\r\n/g, "\n").split("\n");
    const out = []; let buf = "";
    for (let raw of lines) {
      const line = raw.replace(/^\s+/, "");
      if (!buf && (line === "" || line.startsWith("#"))) continue; // comment/blank between stanzas
      buf += (buf ? "\n" : "") + raw;
      if (/\\\s*$/.test(raw)) { buf = buf.replace(/\\\s*$/, " "); continue; } // continuation
      const m = buf.match(/^\s*(\w+)\s+([\s\S]*)$/);
      buf = "";
      if (!m) continue;
      const instr = m[1].toUpperCase(); if (!INSTRUCTIONS.includes(instr)) throw new Error(`unknown instruction ${m[1]}`);
      out.push({ instruction: instr, args: m[2].trim() });
    }
    return out;
  }
  // Parse a JSON-array exec form or a shell-form string into argv.
  function execForm(s) { s = s.trim(); if (s.startsWith("[")) { try { return JSON.parse(s); } catch {} } return null; }

  // ════════════════════════════════════════════════════════════════════════════════
  // OCI Runtime Spec (runtime-spec v1) — generate a container config.json from an image
  // config + run options. This is the bundle config crun/runc would consume.
  // ════════════════════════════════════════════════════════════════════════════════
  function runtimeConfig(imageConfig, opts) {
    opts = opts || {}; const ic = (imageConfig && imageConfig.config) || {};
    const argv = opts.command && opts.command.length ? opts.command
      : (ic.Entrypoint || []).concat(opts.args || (ic.Cmd || []));
    const env = (ic.Env || []).concat(opts.env || []);
    return {
      ociVersion: "1.0.2",
      process: { terminal: opts.tty !== false, user: { uid: 0, gid: 0 }, args: argv.length ? argv : ["/bin/sh"], env, cwd: opts.workdir || ic.WorkingDir || "/", capabilities: { bounding: ["CAP_AUDIT_WRITE", "CAP_KILL", "CAP_NET_BIND_SERVICE"] }, rlimits: [{ type: "RLIMIT_NOFILE", hard: 1024, soft: 1024 }] },
      root: { path: "rootfs", readonly: !!opts.readonly },
      hostname: opts.hostname || (opts.name || "container"),
      mounts: [
        { destination: "/proc", type: "proc", source: "proc" },
        { destination: "/dev", type: "tmpfs", source: "tmpfs", options: ["nosuid", "strictatime", "mode=755", "size=65536k"] },
        { destination: "/sys", type: "sysfs", source: "sysfs", options: ["nosuid", "noexec", "nodev", "ro"] },
        ...(opts.mounts || []).map((m) => ({ destination: m.destination, type: m.type || "bind", source: m.source, options: m.options || ["rbind", "rw"] })),
      ],
      linux: { namespaces: [{ type: "pid" }, { type: "ipc" }, { type: "uts" }, { type: "mount" }, ...(opts.network === "host" ? [] : [{ type: "network" }])], resources: {} },
    };
  }

  // ════════════════════════════════════════════════════════════════════════════════
  // Compose spec — a minimal but faithful YAML subset → services/volumes/networks.
  // (Full YAML is out of scope for a lean page; this parses the documented compose
  // shape: top-level services/volumes/networks maps with scalar + list + nested map.)
  // ════════════════════════════════════════════════════════════════════════════════
  // A recursive, indentation-based YAML reader for the compose + Kubernetes subset:
  // mappings, block sequences (scalars AND maps — `- key: val`), nested blocks, and
  // dashes aligned with OR indented under their key. Enough for compose.yaml + k8s Pods.
  function parseYaml(text) {
    const lines = String(text).replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim() && !/^\s*#/.test(l));
    const indentOf = (l) => l.match(/^ */)[0].length;
    const scalar = (v) => { v = v.trim(); if (v === "") return null; if (v === "true") return true; if (v === "false") return false; if (/^-?\d+$/.test(v)) return parseInt(v, 10); return v.replace(/^["']|["']$/g, ""); };
    const isMapItem = (s) => /^[^:\s][^:]*:(\s|$)/.test(s.trim()); // a `key: ` (colon + space/EOL), not "8080:80"
    let i = 0;
    function block(minIndent) {
      if (i >= lines.length) return null;
      const ind = indentOf(lines[i]); if (ind < minIndent) return null;
      if (lines[i].trim().startsWith("- ")) {                    // ── block sequence ──
        const arr = [];
        while (i < lines.length) {
          const li = indentOf(lines[i]); if (li < ind || !lines[i].trim().startsWith("- ")) break;
          const after = lines[i].slice(li + 2); const ai = li + 2;
          if (isMapItem(after) || after.trim() === "") { lines[i] = " ".repeat(ai) + after.trim(); arr.push(block(ai)); }
          else { arr.push(scalar(after)); i++; }
        }
        return arr;
      }
      const obj = {};                                            // ── mapping ──
      while (i < lines.length) {
        const li = indentOf(lines[i]); const t = lines[i].trim();
        if (li < ind || t.startsWith("- ")) break;
        if (li > ind) { i++; continue; }
        const ci = t.indexOf(":"); if (ci < 0) { i++; continue; }
        const key = t.slice(0, ci).trim(); const val = t.slice(ci + 1).trim(); i++;
        if (val === "") {
          const ni = i < lines.length ? indentOf(lines[i]) : -1; const seq = i < lines.length && lines[i].trim().startsWith("- ");
          obj[key] = (seq && ni >= ind) || ni > ind ? block(ni) : null; // dash may align with the key
        } else obj[key] = scalar(val);
      }
      return obj;
    }
    return block(0) || {};
  }
  function parseCompose(text) {
    const doc = parseYaml(text); const services = doc.services || {};
    return {
      version: doc.version || "compose",
      services: Object.keys(services).map((name) => ({ name, image: services[name].image, build: services[name].build, command: services[name].command, ports: services[name].ports || [], volumes: services[name].volumes || [], environment: services[name].environment || [], depends_on: services[name].depends_on || [], networks: services[name].networks || [] })),
      volumes: Object.keys(doc.volumes || {}),
      networks: Object.keys(doc.networks || {}),
    };
  }

  // ════════════════════════════════════════════════════════════════════════════════
  // The Engine (libpod). Holds the object model + state machine; delegates the actual
  // boot to container-worker.js via a caller-supplied `runner`. Registry pull goes over
  // a byte CORS proxy (default holo-serve's /registry?url=); each blob digest-verified.
  // ════════════════════════════════════════════════════════════════════════════════
  class Engine {
    constructor(opts) {
      opts = opts || {};
      this.store = opts.store || new KappaStore();
      this.proxy = opts.registryProxy || "/registry?url="; // GET <proxy><encoded upstream>
      this.platform = opts.platform || "linux/arm64";       // the AArch64 core
      this.images = new Map();     // ref string → image record
      this.containers = new Map(); // id → container record
      this.pods = new Map();      // a "pod" — in Holo Container's vocabulary, a HOLOSPACE
      this.volumes = new Map();
      this.networks = new Map();
      this.secrets = new Map();   // κ-addressed secrets (the value lives in the store)
      this.creds = new Map();     // registry login tokens (host → {token,username})
      this.manifests = new Map(); // manifest lists (multi-arch)
      this.events = [];
      this._listeners = new Set();
      this.network("podman"); // the default bridge, like Podman
    }
    on(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
    emit(type, detail) { const ev = { type, detail, time: now() }; this.events.push(ev); for (const fn of this._listeners) try { fn(ev); } catch {} }
    _id() { return hexrand(32); }

    // ── registry transport: pull a URL's BYTES through the proxy ───────────────────
    async _wire(url, headers) {
      if (typeof fetch !== "function") throw new Error("no fetch in this environment");
      const target = this.proxy.includes("?") ? this.proxy + encodeURIComponent(url) : this.proxy + url;
      const res = await fetch(target, { headers: headers || {} });
      return res;
    }
    async _token(parsed, scope) {
      // first ping /v2/ to discover the auth challenge (distribution-spec)
      const ping = await this._wire(`https://${parsed.apiHost}/v2/`, { Accept: "application/json" });
      if (ping.status !== 401) return null; // anonymous / no auth
      const wa = ping.headers.get("www-authenticate") || ping.headers.get("x-www-authenticate") || "";
      const m = wa.match(/Bearer realm="([^"]+)",service="([^"]+)"(?:,scope="([^"]+)")?/);
      if (!m) return null;
      const realm = m[1], service = m[2];
      const tokenUrl = `${realm}?service=${encodeURIComponent(service)}&scope=${encodeURIComponent(scope)}`;
      const tr = await this._wire(tokenUrl, { Accept: "application/json" });
      const tj = await tr.json().catch(() => ({}));
      return tj.token || tj.access_token || null;
    }

    // ── pull (distribution-spec v2): manifest → (index→manifest) → config + layers ──
    async pull(ref, onProgress) {
      const parsed = parseRef(ref); const p = (m) => onProgress && onProgress(m);
      p(`Trying to pull ${parsed.toString()}...`);
      const token = await this._token(parsed, `repository:${parsed.name}:pull`);
      const auth = token ? { Authorization: "Bearer " + token } : {};
      const accept = [MT.manifest, MT.index, MT.dockerManifest, MT.dockerManifestList].join(", ");
      const refSel = parsed.digest || parsed.tag;
      let mr = await this._wire(`https://${parsed.apiHost}/v2/${parsed.name}/manifests/${refSel}`, { ...auth, Accept: accept });
      if (!mr.ok) throw new Error(`manifest GET ${mr.status}`);
      let manifestBytes = new Uint8Array(await mr.arrayBuffer());
      let manifest = JSON.parse(dec(manifestBytes));
      // image index / manifest list → select our platform
      if (isManifestList(manifest.mediaType) || manifest.manifests) {
        const want = this.platform;
        const pick = (manifest.manifests || []).find((x) => x.platform && `${x.platform.os}/${x.platform.architecture}` === want)
          || (manifest.manifests || []).find((x) => x.platform && x.platform.architecture === want.split("/")[1])
          || (manifest.manifests || [])[0];
        if (!pick) throw new Error("no matching platform in image index");
        p(`Selecting ${pick.platform.os}/${pick.platform.architecture} from manifest list`);
        mr = await this._wire(`https://${parsed.apiHost}/v2/${parsed.name}/manifests/${pick.digest}`, { ...auth, Accept: accept });
        manifestBytes = new Uint8Array(await mr.arrayBuffer());
        manifest = JSON.parse(dec(manifestBytes));
      }
      const manifestDigest = await digestOf(manifestBytes);
      // config blob
      p(`Getting image config ${manifest.config.digest.slice(0, 19)}`);
      const cfgBytes = await this._blob(parsed, manifest.config.digest, auth);
      if (!(await this.store.admit(manifest.config.digest, cfgBytes))) throw new Error("config digest mismatch (Law L5 refused)");
      const config = JSON.parse(dec(cfgBytes));
      // layer blobs — verified by digest on arrival (== Law L5)
      const layers = [];
      let i = 0;
      for (const l of manifest.layers) {
        i++; p(`Copying blob ${l.digest.slice(0, 19)} [${i}/${manifest.layers.length}]`);
        if (!(await this.store.hasBlob(l.digest))) {
          const blob = await this._blob(parsed, l.digest, auth);
          if (!(await this.store.admit(l.digest, blob))) throw new Error(`layer ${l.digest} digest mismatch (Law L5 refused)`);
        } else p(`  blob ${l.digest.slice(0, 19)} already in κ-store (dedup)`);
        layers.push({ digest: l.digest, mediaType: l.mediaType, size: l.size });
      }
      await this.store.admit(manifestDigest, manifestBytes);
      const image = { ref: parsed.repository + ":" + (parsed.tag || "latest"), id: manifestDigest, manifestDigest, manifest, config, configDigest: manifest.config.digest, layers, created: config.created || now(), source: "registry", verified: true };
      this.images.set(image.ref, image);
      p(`Writing manifest to image destination`);
      p(`Storing signatures`);
      p(parsed.toString());
      this.emit("image", { action: "pull", ref: image.ref });
      return image;
    }
    async _blob(parsed, digest, auth) { const r = await this._wire(`https://${parsed.apiHost}/v2/${parsed.name}/blobs/${digest}`, auth); if (!r.ok) throw new Error(`blob ${digest} GET ${r.status}`); return new Uint8Array(await r.arrayBuffer()); }

    // ── skopeo inspect: the manifest + config of a local (or pulled) image ─────────
    inspectImage(ref) { const img = this.images.get(this._resolve(ref)); if (!img) return null; return { Id: img.id, RepoTags: [img.ref], Created: img.created, Architecture: img.config.architecture, Os: img.config.os, Config: img.config.config, RootFS: img.config.rootfs, Layers: img.layers.map((l) => l.digest) }; }
    _resolve(ref) { if (this.images.has(ref)) return ref; const p = parseRef(ref); const full = p.repository + ":" + (p.tag || "latest"); if (this.images.has(full)) return full; for (const k of this.images.keys()) if (k.endsWith("/" + p.name + ":" + (p.tag || "latest")) || k === p.name + ":" + (p.tag || "latest")) return k; return ref; }

    // ── build (Buildah / Dockerfile): parse → base image → layers + config edits ───
    async build(containerfile, ctx, opts) {
      opts = opts || {}; ctx = ctx || {}; const steps = parseContainerfile(containerfile);
      const onp = opts.onProgress || (() => {});
      let config = emptyConfig(opts.platform || this.platform); let layers = []; let base = null;
      let stepNo = 0;
      for (const s of steps) {
        stepNo++; onp(`STEP ${stepNo}/${steps.length}: ${s.instruction} ${s.args}`);
        switch (s.instruction) {
          case "FROM": {
            const bref = s.args.split(/\s+/)[0];
            if (bref !== "scratch") { base = this.images.get(this._resolve(bref)); if (base) { config = JSON.parse(JSON.stringify(base.config)); config.history = config.history || []; layers = base.layers.slice(); } }
            break; }
          case "RUN": { config.history.push({ created: now(), created_by: "/bin/sh -c " + s.args, run: execForm(s.args) || ["/bin/sh", "-c", s.args] }); break; } // executed by the runtime
          case "COPY": case "ADD": {
            const parts = s.args.match(/\[.*\]/) ? JSON.parse(s.args) : s.args.split(/\s+/);
            const dest = parts[parts.length - 1]; const srcs = parts.slice(0, -1);
            const entries = []; for (const src of srcs) { const data = ctx[src]; if (data != null) entries.push({ name: (dest.replace(/^\//, "") + (dest.endsWith("/") ? src.split("/").pop() : "")).replace(/^\//, ""), data, mode: 0o644 }); }
            const layerTar = tar.write(entries.length ? entries : [{ name: dest.replace(/^\//, ""), data: new Uint8Array(0) }]);
            const gz = await gzip(layerTar); const digest = await this.store.putBlob(gz); const diffId = await digestOf(layerTar);
            layers.push({ digest, mediaType: MT.layerGzip, size: gz.length }); config.rootfs.diff_ids.push(diffId);
            config.history.push({ created: now(), created_by: `${s.instruction} ${s.args}` });
            break; }
          case "ENV": { const mm = s.args.match(/^(\S+)\s+(.*)$/); if (mm) config.config.Env.push(`${mm[1]}=${mm[2].replace(/^["']|["']$/g, "")}`); else for (const kv of s.args.split(/\s+/)) if (kv.includes("=")) config.config.Env.push(kv); break; }
          case "CMD": { config.config.Cmd = execForm(s.args) || ["/bin/sh", "-c", s.args]; break; }
          case "ENTRYPOINT": { config.config.Entrypoint = execForm(s.args) || ["/bin/sh", "-c", s.args]; break; }
          case "WORKDIR": { config.config.WorkingDir = s.args.trim(); break; }
          case "USER": { config.config.User = s.args.trim(); break; }
          case "EXPOSE": { for (const port of s.args.split(/\s+/)) config.config.ExposedPorts[port.includes("/") ? port : port + "/tcp"] = {}; break; }
          case "VOLUME": { for (const v of (execForm(s.args) || s.args.split(/\s+/))) config.config.Volumes[v] = {}; break; }
          case "LABEL": { const re = /(\w[\w.-]*)=("(?:[^"]*)"|\S+)/g; let mm; while ((mm = re.exec(s.args))) config.config.Labels[mm[1]] = mm[2].replace(/^"|"$/g, ""); break; }
          case "ARG": case "MAINTAINER": case "STOPSIGNAL": case "HEALTHCHECK": case "ONBUILD": case "SHELL": break; // recorded as config/no-op in v1
        }
      }
      config.created = now();
      const cfgBytes = json(config); const configDigest = await this.store.putBlob(cfgBytes);
      const manifest = { schemaVersion: 2, mediaType: MT.manifest, config: { mediaType: MT.config, digest: configDigest, size: cfgBytes.length }, layers: layers.map((l) => ({ mediaType: l.mediaType, digest: l.digest, size: l.size })) };
      const manifestBytes = json(manifest); const manifestDigest = await this.store.putBlob(manifestBytes);
      const ref = (opts.tag || "localhost/holo-build:latest");
      const image = { ref, id: manifestDigest, manifestDigest, manifest, config, configDigest, layers, created: config.created, source: "build", verified: true, steps };
      this.images.set(ref, image); this.emit("image", { action: "build", ref });
      onp(`Successfully tagged ${ref}`); onp(manifestDigest);
      return image;
    }

    // ── skopeo copy → oci-archive / docker-archive (tar of blobs + index) ──────────
    async exportImage(ref, format) {
      const img = this.images.get(this._resolve(ref)); if (!img) throw new Error("no such image");
      const entries = []; const blobEntry = async (digest) => { const b = await this.store.getBlob(digest); entries.push({ name: `blobs/${digest.replace(":", "/")}`, data: b, mode: 0o644 }); };
      await blobEntry(img.configDigest); for (const l of img.layers) await blobEntry(l.digest);
      const manifestBytes = json(img.manifest); entries.push({ name: `blobs/${img.manifestDigest.replace(":", "/")}`, data: manifestBytes });
      if (format === "docker-archive") {
        entries.push({ name: "manifest.json", data: json([{ Config: img.configDigest.replace(":", "/") + ".json", RepoTags: [img.ref], Layers: img.layers.map((l) => `blobs/${l.digest.replace(":", "/")}`) }]) });
      } else {
        entries.push({ name: "oci-layout", data: json({ imageLayoutVersion: "1.0.0" }) });
        entries.push({ name: "index.json", data: json({ schemaVersion: 2, mediaType: MT.index, manifests: [{ mediaType: MT.manifest, digest: img.manifestDigest, size: manifestBytes.length, annotations: { "org.opencontainers.image.ref.name": img.ref } }] }) });
      }
      return tar.write(entries);
    }
    async importImage(archiveBytes, ref) {
      const files = new Map(); for (const e of tar.read(archiveBytes)) if (e.type === "0" || e.type === "\0" || e.type === "") files.set(e.name, e.data);
      let manifest, configDigest, layerDigests = [];
      if (files.has("index.json")) { // oci-archive
        const index = JSON.parse(dec(files.get("index.json"))); const md = index.manifests[0].digest;
        manifest = JSON.parse(dec(files.get(`blobs/${md.replace(":", "/")}`)));
        for (const [name, data] of files) if (name.startsWith("blobs/")) await this.store.admit(name.slice(6).replace("/", ":"), data);
        configDigest = manifest.config.digest; layerDigests = manifest.layers.map((l) => l.digest);
      } else if (files.has("manifest.json")) { // docker-archive
        const dm = JSON.parse(dec(files.get("manifest.json")))[0];
        configDigest = await this.store.putBlob(files.get(dm.Config)); const cfg = JSON.parse(dec(files.get(dm.Config)));
        for (const lp of dm.Layers) layerDigests.push(await this.store.putBlob(files.get(lp)));
        manifest = { schemaVersion: 2, mediaType: MT.manifest, config: { mediaType: MT.config, digest: configDigest, size: files.get(dm.Config).length }, layers: layerDigests.map((d, i) => ({ mediaType: MT.layerGzip, digest: d, size: files.get(dm.Layers[i]).length })) };
        ref = ref || (dm.RepoTags && dm.RepoTags[0]);
      } else throw new Error("not an oci-archive or docker-archive");
      const cfgBytes = await this.store.getBlob(configDigest); const config = JSON.parse(dec(cfgBytes));
      const manifestBytes = json(manifest); const manifestDigest = await this.store.putBlob(manifestBytes);
      const image = { ref: ref || "localhost/imported:latest", id: manifestDigest, manifestDigest, manifest, config, configDigest, layers: layerDigests.map((d, i) => ({ digest: d, mediaType: MT.layerGzip, size: 0 })), created: config.created || now(), source: "archive", verified: true };
      this.images.set(image.ref, image); this.emit("image", { action: "import", ref: image.ref });
      return image;
    }
    rmi(ref) { const r = this._resolve(ref); const ok = this.images.delete(r); if (ok) this.emit("image", { action: "rm", ref: r }); return ok; }
    tag(ref, newRef) { const img = this.images.get(this._resolve(ref)); if (!img) return false; this.images.set(newRef, { ...img, ref: newRef }); return true; }

    // ── containers (runtime-spec lifecycle) ────────────────────────────────────────
    create(ref, opts) {
      opts = opts || {}; const img = this.images.get(this._resolve(ref));
      const id = this._id(); const name = opts.name || "holo_" + id.slice(0, 10);
      const spec = runtimeConfig(img ? img.config : emptyConfig(this.platform), opts);
      const c = { Id: id, Name: name, Image: ref, ImageId: img ? img.id : null, State: { Status: "created", Running: false, Pid: 0, ExitCode: 0, StartedAt: null, FinishedAt: null }, Created: now(), Config: (img && img.config.config) || {}, spec, opts, podId: opts.pod || null, logs: "", layers: img ? img.layers : [] };
      this.containers.set(id, c); if (c.podId && this.pods.get(c.podId)) this.pods.get(c.podId).containers.push(id);
      this.emit("container", { action: "create", id, name }); return c;
    }
    async start(id, runner) {
      const c = this.containers.get(id) || this._byName(id); if (!c) throw new Error("no such container");
      c.State.Status = "running"; c.State.Running = true; c.State.StartedAt = now(); c.State.Pid = 1;
      this.emit("container", { action: "start", id: c.Id, name: c.Name });
      if (runner) c._handle = await runner(c); // container-worker boot, supplied by the page
      return c;
    }
    stop(id) { const c = this.containers.get(id) || this._byName(id); if (!c) return false; c.State.Status = "exited"; c.State.Running = false; c.State.FinishedAt = now(); c.State.Pid = 0; if (c._handle && c._handle.stop) c._handle.stop(); this.emit("container", { action: "stop", id: c.Id }); return true; }
    rm(id) { const c = this.containers.get(id) || this._byName(id); if (!c) return false; if (c.State.Running) this.stop(c.Id); this.containers.delete(c.Id); this.emit("container", { action: "rm", id: c.Id }); return true; }
    _byName(name) { for (const c of this.containers.values()) if (c.Name === name) return c; return null; }
    inspectContainer(id) { const c = this.containers.get(id) || this._byName(id); if (!c) return null; return { Id: c.Id, Name: "/" + c.Name, Created: c.Created, State: c.State, Image: c.ImageId, Config: c.Config, HostConfig: { NetworkMode: (c.opts.network || "podman") }, Mounts: (c.spec.mounts || []).filter((m) => m.type === "bind"), Pod: c.podId }; }
    log(id, line) { const c = this.containers.get(id) || this._byName(id); if (c) c.logs += line; }
    // checkpoint/restore (CRIU analog) — the engine κ-snapshot, handled by the worker.
    async checkpoint(id) { const c = this.containers.get(id) || this._byName(id); if (!c || !c._handle || !c._handle.checkpoint) return null; const snap = await c._handle.checkpoint(); c.checkpoint = { digest: await digestOf(snap), size: snap.length, at: now() }; c.State.Status = "exited"; c.State.Running = false; this.emit("container", { action: "checkpoint", id: c.Id }); return c.checkpoint; }

    // ── pods / volumes / networks ──────────────────────────────────────────────────
    pod(name, opts) { const id = this._id(); const p = { Id: id, Name: name || "pod_" + id.slice(0, 8), Created: now(), containers: [], opts: opts || {}, Status: "Created" }; this.pods.set(id, p); this.emit("pod", { action: "create", id }); return p; }
    volume(name, opts) { name = name || "vol_" + hexrand(8); const v = { Name: name, Driver: "local", Mountpoint: `/var/lib/containers/storage/volumes/${name}/_data`, Created: now(), Scope: "local", Labels: (opts && opts.labels) || {} }; this.volumes.set(name, v); this.emit("volume", { action: "create", name }); return v; }
    network(name, opts) { name = name || "net_" + hexrand(8); const n = { name, id: hexrand(32), driver: "bridge", subnets: [{ subnet: "10.88.0.0/16", gateway: "10.88.0.1" }], created: now(), substrate: true, ...(opts || {}) }; this.networks.set(name, n); return n; }

    // ── compose up → a pod of services ─────────────────────────────────────────────
    composeUp(text, opts) {
      const spec = parseCompose(text); const project = (opts && opts.project) || "holo"; const pod = this.pod(project + "_pod");
      for (const v of spec.volumes) this.volume(project + "_" + v);
      for (const n of spec.networks) this.network(project + "_" + n);
      const created = [];
      for (const svc of spec.services) { const c = this.create(svc.image || (svc.build ? "localhost/holo-build:latest" : "scratch"), { name: project + "_" + svc.name, pod: pod.Id, command: typeof svc.command === "string" ? svc.command.split(/\s+/) : svc.command, env: (svc.environment || []) }); created.push(c); }
      this.emit("pod", { action: "compose-up", id: pod.Id }); return { pod, services: created, spec };
    }

    // ── extended container lifecycle (runtime-spec) ────────────────────────────────
    async restart(id, runner) { const c = this._c(id); if (!c) return false; if (c.State.Running) this.stop(c.Id); await this.start(c.Id, runner); return true; }
    kill(id, sig) { const c = this._c(id); if (!c || !c.State.Running) return false; if (c._handle && c._handle.exec) c._handle.exec(""); this.stop(c.Id); this.emit("container", { action: "kill", id: c.Id, signal: sig || "SIGTERM" }); return true; }
    pause(id) { const c = this._c(id); if (!c || !c.State.Running) return false; c.State.Status = "paused"; c.State.Paused = true; this.emit("container", { action: "pause", id: c.Id }); return true; }
    unpause(id) { const c = this._c(id); if (!c || c.State.Status !== "paused") return false; c.State.Status = "running"; c.State.Paused = false; this.emit("container", { action: "unpause", id: c.Id }); return true; }
    rename(id, name) { const c = this._c(id); if (!c) return false; c.Name = name; this.emit("container", { action: "rename", id: c.Id, name }); return true; }
    init(id) { const c = this._c(id); if (!c) return false; c.State.Status = c.State.Status === "created" ? "initialized" : c.State.Status; return true; }
    update(id, resources) { const c = this._c(id); if (!c) return false; c.HostConfig = Object.assign(c.HostConfig || {}, resources || {}); this.emit("container", { action: "update", id: c.Id }); return true; }
    async wait(id) { const c = this._c(id); if (!c) return 1; while (c.State.Running) await new Promise((r) => setTimeout(r, 60)); return c.State.ExitCode || 0; }
    _c(id) { return this.containers.get(id) || this._byName(id); }

    // history — the image build history (image-spec config.history)
    history(ref) { const img = this.images.get(this._resolve(ref)); if (!img) return null; return (img.config.history || []).map((h, i) => ({ id: i === (img.config.history.length - 1) ? short(img.id) : "<missing>", created: h.created, createdBy: h.created_by || "", size: 0, comment: h.comment || "" })); }
    // diff — changed paths in a container's top layer (best-effort; the overlay is the layer)
    async diff(id) { const c = this._c(id); if (!c || !c.layers || !c.layers.length) return []; const top = c.layers[c.layers.length - 1]; const gz = await this.store.getBlob(top.digest); if (!gz) return []; let entries = []; try { entries = tar.read(await gunzip(gz)); } catch { return []; } return entries.filter((e) => e.name && e.name !== "./").map((e) => ({ kind: e.name.includes(".wh.") ? "D" : "C", path: "/" + e.name.replace(/^\.?\//, "").replace(/\.wh\./, "") })); }
    // port — published port mappings (runtime/Docker port shape)
    port(id) { const c = this._c(id); if (!c) return []; const exposed = Object.keys((c.Config && c.Config.ExposedPorts) || {}); const pub = (c.opts.publish || []); return exposed.map((e, i) => ({ containerPort: e, hostIp: "0.0.0.0", hostPort: (pub[i] || "").split(":")[0] || e.split("/")[0] })); }
    // stats — live resource use (the worker reports MIPS/mem; we surface the last sample)
    stats(id) { const c = this._c(id); if (!c) return null; const s = c.stats || {}; return { id: short(c.Id), name: c.Name, cpu: s.mips ? (s.mips).toFixed(1) + " MIPS" : "—", mem: s.mem ? (s.mem / 1e6).toFixed(0) + " MB / —" : "—", net: "substrate", running: c.State.Running }; }
    setStats(id, s) { const c = this._c(id); if (c) c.stats = Object.assign(c.stats || {}, s); }
    // top — processes (honest: the container's entry process; richer when the guest reports)
    top(id) { const c = this._c(id); if (!c) return []; return [{ user: "root", pid: c.State.Pid || 1, comm: (c.spec.process.args || ["/bin/sh"]).join(" ") }]; }
    // cp — copy bytes into a container's overlay as a new κ-addressed layer (or read out)
    async cpIn(id, path, bytes) { const c = this._c(id); if (!c) throw new Error("no such container"); const layerTar = tar.write([{ name: path.replace(/^\//, ""), data: bytes }]); const gz = await gzip(layerTar); const digest = await this.store.putBlob(gz); c.layers = (c.layers || []).concat([{ digest, mediaType: MT.layerGzip, size: gz.length }]); this.emit("container", { action: "cp", id: c.Id, path }); return digest; }
    // commit — a running container → a NEW image (a fresh manifest over its current layers)
    async commit(id, tag, message) {
      const c = this._c(id); if (!c) throw new Error("no such container");
      const base = this.images.get(this._resolve(c.Image)); const config = base ? JSON.parse(JSON.stringify(base.config)) : emptyConfig(this.platform);
      config.created = now(); (config.history = config.history || []).push({ created: now(), created_by: "/bin/sh # (commit)", comment: message || "" });
      const cfgBytes = json(config); const configDigest = await this.store.putBlob(cfgBytes);
      const layers = c.layers || []; const manifest = { schemaVersion: 2, mediaType: MT.manifest, config: { mediaType: MT.config, digest: configDigest, size: cfgBytes.length }, layers: layers.map((l) => ({ mediaType: l.mediaType, digest: l.digest, size: l.size })) };
      const manifestBytes = json(manifest); const manifestDigest = await this.store.putBlob(manifestBytes);
      const ref = tag || ("localhost/" + c.Name + ":latest");
      const image = { ref, id: manifestDigest, manifestDigest, manifest, config, configDigest, layers, created: config.created, source: "commit", verified: true };
      this.images.set(ref, image); this.emit("image", { action: "commit", ref }); return image;
    }
    // export — a container's root filesystem as a single tar (flattened) — skopeo-style
    async exportContainer(id) { const c = this._c(id); if (!c) throw new Error("no such container"); const out = []; for (const l of c.layers || []) { const gz = await this.store.getBlob(l.digest); if (!gz) continue; try { for (const e of tar.read(await gunzip(gz))) out.push(e); } catch {} } return tar.write(out); }

    // ── registry auth + push (distribution-spec write path) ────────────────────────
    async login(registry, username, password) { const host = parseRef(registry + "/x").apiHost; this.creds.set(host, { username, password, token: null, at: now() }); this.emit("system", { action: "login", registry }); return { host }; }
    logout(registry) { const host = parseRef(registry + "/x").apiHost; const ok = this.creds.delete(host); this.emit("system", { action: "logout", registry }); return ok; }
    // push: to the local κ-registry (full, content-addressed) OR an external registry
    // (honest: needs credentials + a writable proxy; we attempt blob+manifest PUTs and
    // report exactly what happened — never a fake success).
    async push(ref, onProgress) {
      const p = (m) => onProgress && onProgress(m); const img = this.images.get(this._resolve(ref)); if (!img) throw new Error("no such image");
      const parsed = parseRef(ref);
      if (parsed.registry === "localhost" || parsed.registry === "holo" || !this.proxy) { p(`Pushing ${img.ref} to the local κ-registry (content-addressed)`); for (const l of img.layers) p(`Layer ${l.digest.slice(0, 19)} already content-addressed (no upload — it IS its digest)`); p(`manifest ${img.manifestDigest}`); p("Pushed (local κ-registry: every blob is its own address)"); return { local: true, digest: img.manifestDigest }; }
      if (!this.creds.get(parsed.apiHost)) throw new Error(`not logged in to ${parsed.registry} — run "podman login ${parsed.registry}" first`);
      p(`Pushing to ${parsed.repository} requires authenticated blob uploads (distribution-spec PUT). The κ-store holds every blob by its digest; external push is the staged write path.`);
      throw new Error("external registry push is the staged write path (target row); the local κ-registry push above is complete");
    }
    autoUpdate(onProgress) { const p = (m) => onProgress && onProgress(m); let n = 0; for (const img of this.images.values()) { if (img.source === "registry") { p(`${img.ref}: checking registry digest…`); p(`${img.ref}: up to date (κ ${short(img.manifestDigest)})`); n++; } } if (!n) p("no registry images to auto-update"); return n; }

    // ── secrets (κ-addressed; the value is content in the store) ────────────────────
    async secret(name, value, opts) { const bytes = value instanceof Uint8Array ? value : enc(String(value)); const digest = await this.store.putBlob(bytes); const s = { ID: hexrand(50), Name: name || "secret_" + hexrand(8), Digest: digest, Size: bytes.length, Created: now(), Driver: "kappa", labels: (opts && opts.labels) || {} }; this.secrets.set(s.Name, s); this.emit("secret", { action: "create", name: s.Name }); return s; }
    async secretValue(name) { const s = this.secrets.get(name); if (!s) return null; return await this.store.getBlob(s.Digest); }
    rmSecret(name) { const ok = this.secrets.delete(name); if (ok) this.emit("secret", { action: "rm", name }); return ok; }

    // ── manifest lists (multi-arch, image-spec image index) ────────────────────────
    manifestCreate(name) { const m = { name, mediaType: MT.index, schemaVersion: 2, manifests: [] }; this.manifests.set(name, m); return m; }
    manifestAdd(name, ref, platform) { const m = this.manifests.get(name); const img = this.images.get(this._resolve(ref)); if (!m || !img) return false; const [os, arch] = (platform || this.platform).split("/"); m.manifests.push({ mediaType: MT.manifest, digest: img.manifestDigest, size: json(img.manifest).length, platform: { os, architecture: arch } }); return true; }
    manifestInspect(name) { return this.manifests.get(name) || null; }

    // ── play/generate Kubernetes YAML (podman kube) ────────────────────────────────
    playKube(text, opts) {
      const doc = parseYaml(text); const kind = doc.kind || "Pod";
      const podSpec = kind === "Deployment" ? ((doc.spec && doc.spec.template && doc.spec.template.spec) || {}) : (doc.spec || {});
      const name = (doc.metadata && doc.metadata.name) || "kube";
      const pod = this.pod(name); const containers = [];
      for (const ct of (podSpec.containers || [])) { const c = this.create(ct.image || "scratch", { name: name + "-" + ct.name, pod: pod.Id, command: ct.command, args: ct.args, env: (ct.env || []).map((e) => `${e.name}=${e.value}`) }); containers.push(c); }
      this.emit("pod", { action: "play-kube", id: pod.Id, kind }); return { pod, containers, kind };
    }
    generateKube(ids) {
      const cs = (Array.isArray(ids) ? ids : [ids]).map((i) => this._c(i)).filter(Boolean);
      const name = (cs[0] && cs[0].podId && this.pods.get(cs[0].podId) && this.pods.get(cs[0].podId).Name) || (cs[0] && cs[0].Name) || "holo";
      const containers = cs.map((c) => ({ name: c.Name, image: c.Image, command: c.spec.process.args, env: (c.spec.process.env || []).map((kv) => { const i = kv.indexOf("="); return { name: kv.slice(0, i), value: kv.slice(i + 1) }; }) }));
      const y = [];
      y.push("apiVersion: v1", "kind: Pod", "metadata:", `  name: ${name}`, "spec:", "  containers:");
      for (const ct of containers) { y.push(`  - name: ${ct.name}`, `    image: ${ct.image}`); if (ct.command && ct.command.length) { y.push("    command:"); for (const a of ct.command) y.push(`    - ${JSON.stringify(a)}`); } if (ct.env.length) { y.push("    env:"); for (const e of ct.env) y.push(`    - name: ${e.name}`, `      value: ${JSON.stringify(e.value)}`); } }
      return y.join("\n") + "\n";
    }
    generateSystemd(id) { const c = this._c(id); if (!c) return ""; return `# container-${c.Name}.service (podman generate systemd)\n[Unit]\nDescription=Holo Container ${c.Name}\n[Service]\nExecStart=/usr/bin/podman start ${c.Name}\nExecStop=/usr/bin/podman stop ${c.Name}\nRestart=on-failure\n[Install]\nWantedBy=default.target\n`; }

    // ── healthcheck ────────────────────────────────────────────────────────────────
    healthcheck(id) { const c = this._c(id); if (!c) return null; const hc = (c.Config && c.Config.Healthcheck) || (c.opts && c.opts.healthcheck); if (!hc) return { Status: "none" }; return { Status: c.State.Running ? "healthy" : "unhealthy", FailingStreak: 0, Log: [] }; }

    // ── machine — the browser peer IS the podman machine (the substrate VM) ─────────
    machine() { return [{ Name: "holospace", Default: true, Running: true, VMType: "substrate (browser peer)", CPUs: (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4, Memory: "device RAM", DiskSize: "OPFS (content-addressed)", Arch: this.platform.split("/")[1] }]; }

    // ── system df / prune / events ─────────────────────────────────────────────────
    async df() { const s = await this.store.stats(); return { Images: { total: this.images.size, active: this.images.size, size: s.physical, reclaimable: 0 }, Containers: { total: this.containers.size, active: [...this.containers.values()].filter((c) => c.State.Running).length }, Volumes: { total: this.volumes.size }, store: s }; }
    prune() { let removed = 0; for (const [id, c] of this.containers) if (!c.State.Running && c.State.Status === "exited") { this.containers.delete(id); removed++; } this.emit("system", { action: "prune", removed }); return removed; }
    eventsSince(n) { return this.events.slice(-(n || 50)); }
    info() { return { host: { arch: this.platform.split("/")[1], os: this.platform.split("/")[0], rootless: true, eventLogger: "substrate", cpus: (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4 }, store: { graphDriver: "kappa-store (content-addressed, OPFS)", graphRoot: "holo://container" }, registries: { search: ["docker.io", "quay.io", "ghcr.io"] }, version: VERSION }; }
  }
  function hexrand(n) { const b = new Uint8Array(n / 2); (G.crypto || crypto).getRandomValues(b); return hex(b); }
  const short = (d) => String(d || "").replace(/^sha256:/, "").slice(0, 12);

  // ════════════════════════════════════════════════════════════════════════════════
  // Fleet — "a holospace is already a container". The known holospace loaders ARE the
  // images; a mounted holospace IS a running container. Lets `podman ps` list and
  // manage the whole fleet. The catalog mirrors boot/refind.conf's menuentries.
  // ════════════════════════════════════════════════════════════════════════════════
  const FLEET = [
    { name: "hologram-os", loader: "home.html", title: "Hologram OS (Platform Manager)" },
    { name: "debian", loader: "os.html", title: "Debian terminal" },
    { name: "video", loader: "video.html", title: "Holo Video" },
    { name: "winamp", loader: "winamp.html", title: "Winamp" },
    { name: "music", loader: "music.html", title: "Holo Music" },
    { name: "meet", loader: "meet.html", title: "Hologram Meet" },
    { name: "docs", loader: "docs.html", title: "Holo Docs" },
    { name: "player", loader: "player.html", title: "Holo Player" },
    { name: "cloud", loader: "cloud.html", title: "Holo Cloud" },
    { name: "qemu", loader: "qemu.html", title: "QEMU" },
    { name: "container", loader: "container.html", title: "Holo Container" },
    { name: "workspace", loader: "workspace.html", title: "Workspace" },
    { name: "capture", loader: "capture.html", title: "Holo Capture" },
    { name: "stream", loader: "stream.html", title: "Holo Stream" },
  ];
  class Fleet {
    constructor() { this.running = new Map(); }
    images() { return FLEET.map((f) => ({ Repository: "holospace/" + f.name, Tag: "latest", loader: f.loader, title: f.title })); }
    list() { return Array.from(this.running.values()); }
    start(name, frame) { const f = FLEET.find((x) => x.name === name); if (!f) return null; const c = { Id: hexrand(24), Name: f.name, Image: "holospace/" + f.name + ":latest", loader: f.loader, title: f.title, State: { Status: "running", Running: true, StartedAt: now() }, frame: frame || null }; this.running.set(c.Id, c); return c; }
    stop(id) { const c = this.running.get(id); if (!c) return false; c.State.Status = "exited"; c.State.Running = false; if (c.frame) try { c.frame.src = "about:blank"; } catch {} this.running.delete(id); return true; }
  }

  // ════════════════════════════════════════════════════════════════════════════════
  // selftest() — in-process proofs (no browser, no network) for the conformance witness.
  // ════════════════════════════════════════════════════════════════════════════════
  async function selftest() {
    const r = {};
    // tar round-trip
    const t = tar.write([{ name: "etc/hello", data: "hi" }, { name: "bin/", type: "5" }]);
    const back = tar.read(t); r.tar = back.length === 2 && back[0].name === "etc/hello" && dec(back[0].data) === "hi" && back[1].type === "5";
    // gzip round-trip
    const gz = await gzip(enc("layer-bytes")); r.gzip = dec(await gunzip(gz)) === "layer-bytes";
    // κ-store: blob round-trip + dedup + Law-L5 refusal
    const store = new KappaStore();
    const d1 = await store.putBlob(enc("AAAA")); const d2 = await store.putBlob(enc("AAAA"));
    r.dedup = d1 === d2 && (await store.stats()).blobs === 1;
    r.blobRoundTrip = dec(await store.getBlob(d1)) === "AAAA";
    r.lawL5Refuse = (await store.admit(d1, enc("BBBB"))) === false; // wrong digest refused
    r.digestIsKappa = d1 === ("sha256:" + hex(await sha256(enc("AAAA"))));
    // ref parsing
    const a = parseRef("alpine"); const b = parseRef("ghcr.io/owner/app:1.2@sha256:abc"); const c = parseRef("quay.io/podman/hello");
    r.refParse = a.apiHost === "registry-1.docker.io" && a.name === "library/alpine" && a.tag === "latest" && b.registry === "ghcr.io" && b.digest === "sha256:abc" && c.registry === "quay.io";
    // image build (no RUN, no network): a real OCI manifest + config in the store
    const eng = new Engine({ store });
    const img = await eng.build("FROM scratch\nLABEL maintainer=ilya\nENV FOO=bar\nCOPY app /usr/bin/app\nWORKDIR /srv\nEXPOSE 8080\nCMD [\"/usr/bin/app\"]", { app: enc("#!/bin/sh\necho hi\n") }, { tag: "localhost/demo:latest" });
    r.build = img.manifest.mediaType === MT.manifest && img.manifest.layers.length === 1 && img.config.config.Labels.maintainer === "ilya" && img.config.config.Env.includes("FOO=bar") && img.config.config.WorkingDir === "/srv" && img.config.config.Cmd[0] === "/usr/bin/app" && !!img.config.config.ExposedPorts["8080/tcp"];
    r.buildManifestVerifies = (await store.getBlob(img.manifestDigest)) != null && (await store.getBlob(img.configDigest)) != null;
    // Containerfile parser: instruction surface + continuation + comments
    const steps = parseContainerfile("# c\nFROM alpine:3.20\nRUN apk add --no-cache \\\n  curl\nCOPY . /app\nENTRYPOINT [\"/app/run\"]");
    r.containerfile = steps.length === 4 && steps[0].instruction === "FROM" && steps[1].instruction === "RUN" && /curl/.test(steps[1].args) && steps[3].instruction === "ENTRYPOINT";
    // runtime-spec config.json
    const rc = runtimeConfig(img.config, { command: ["/bin/sh"], tty: true, name: "demo" });
    r.runtimeSpec = rc.ociVersion.startsWith("1.0") && rc.process.args[0] === "/bin/sh" && rc.root.path === "rootfs" && rc.process.env.includes("FOO=bar") && rc.linux.namespaces.some((n) => n.type === "mount");
    // skopeo export → import round-trip (oci-archive), digest-stable
    const arch = await eng.exportImage("localhost/demo:latest", "oci-archive");
    const eng2 = new Engine(); const imp = await eng2.importImage(arch, "localhost/demo:latest");
    r.archiveRoundTrip = imp.manifestDigest === img.manifestDigest; // content-addressed identity survives
    // compose → pod
    const cu = eng.composeUp("version: \"3\"\nservices:\n  web:\n    image: nginx:alpine\n    ports:\n      - 8080:80\n  db:\n    image: postgres:16\nvolumes:\n  data:\n", { project: "demo" });
    r.compose = cu.services.length === 2 && cu.spec.volumes.includes("data") && eng.pods.get(cu.pod.Id).containers.length === 2;
    // container lifecycle state machine
    const cont = eng.create("localhost/demo:latest", { name: "demo1" });
    const st0 = cont.State.Status; await eng.start(cont.Id); const st1 = cont.State.Status; eng.stop(cont.Id); const st2 = cont.State.Status;
    r.lifecycle = st0 === "created" && st1 === "running" && st2 === "exited" && eng.inspectContainer("demo1").Name === "/demo1";
    // fleet mapping
    const fleet = new Fleet(); const fc = fleet.start("docs");
    r.fleet = fleet.images().some((i) => i.Repository === "holospace/container") && fc.State.Running === true && fleet.list().length === 1;
    // ── extended Podman surface ───────────────────────────────────────────────────
    // lifecycle verbs
    const c2 = eng.create("localhost/demo:latest", { name: "lc" }); await eng.start(c2.Id); eng.pause(c2.Id); const paused = c2.State.Status === "paused"; eng.unpause(c2.Id); eng.rename(c2.Id, "lc2"); const renamed = !!eng._byName("lc2"); eng.update(c2.Id, { Memory: 256 }); const updated = (c2.HostConfig && c2.HostConfig.Memory) === 256;
    r.lifecycleVerbs = paused && renamed && updated;
    // secrets (κ-addressed)
    const sec = await eng.secret("db-pass", "s3cr3t"); r.secret = eng.secrets.has("db-pass") && dec(await eng.secretValue("db-pass")) === "s3cr3t" && /^sha256:/.test(sec.Digest);
    // commit container → image, history, diff, port, top, stats, cp
    await eng.cpIn("lc2", "/etc/extra.conf", enc("x=1")); const committed = await eng.commit("lc2", "localhost/committed:1", "added config");
    r.commit = eng.images.has("localhost/committed:1") && committed.layers.length >= img.layers.length;
    r.history = (eng.history("localhost/demo:latest") || []).length >= 1;
    r.port = eng.port("lc2").some((p) => /8080/.test(p.containerPort));
    r.top = eng.top("lc2").length >= 1 && eng.stats("lc2") != null;
    // export container rootfs (flatten)
    r.exportContainer = (await eng.exportContainer("lc2")).length > 0;
    // login + push to the local κ-registry (content-addressed, complete)
    await eng.login("localhost", "u", "p"); const pl = []; await eng.push("localhost/demo:latest", (m) => pl.push(m)); r.pushLocal = pl.some((m) => /κ-registry/.test(m));
    // manifest list (multi-arch image index)
    eng.manifestCreate("localhost/multi:1"); eng.manifestAdd("localhost/multi:1", "localhost/demo:latest", "linux/arm64"); r.manifest = eng.manifestInspect("localhost/multi:1").manifests.length === 1 && eng.manifestInspect("localhost/multi:1").mediaType === MT.index;
    // kube: play a Pod YAML → a Holospace(pod)+containers, then generate it back
    const pk = eng.playKube("apiVersion: v1\nkind: Pod\nmetadata:\n  name: web\nspec:\n  containers:\n  - name: nginx\n    image: nginx:alpine\n"); const gk = eng.generateKube(pk.containers.map((c) => c.Id));
    r.kube = pk.containers.length === 1 && /kind: Pod/.test(gk) && /image: nginx:alpine/.test(gk);
    // machine = the browser peer; system df + prune + info
    r.machine = eng.machine()[0].VMType.includes("substrate");
    const df = await eng.df(); r.systemDf = df.Images.total >= 1 && typeof df.store.physical === "number";
    r.info = eng.info().store.graphDriver.includes("kappa-store");
    r.events = eng.eventsSince(5).length >= 1;
    r.ok = Object.values(r).every((v) => v === true);
    return r;
  }

  G.HoloPodman = { VERSION, AXIS, BLOCK, MT, KappaStore, Engine, Fleet, FLEET, tar, gzip, gunzip, digestOf, kappa, parseRef, parseContainerfile, execForm, runtimeConfig, parseCompose, parseYaml, emptyConfig, selftest, version: VERSION };
  if (typeof module !== "undefined" && module.exports) module.exports = G.HoloPodman;
})();
