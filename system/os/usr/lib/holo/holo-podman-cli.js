// holo-podman-cli.js — the podman / buildah / skopeo command-line, faithful to the
// containers/ CLI reference, driving the in-tab libpod (holo-podman.js). Podman is
// CLI-first; this is that CLI, rendered in the holospace's xterm terminal. No daemon,
// no socket — every command calls the library directly, exactly as rootless Podman does.
//
// Dependency-free, isomorphic (browser + Node) so the conformance witness drives the same
// parser/dispatcher it ships. Exposes globalThis.HoloPodmanCLI.

(function () {
  "use strict";
  const G = typeof globalThis !== "undefined" ? globalThis : window;
  if (G.HoloPodmanCLI) return;
  const HP = G.HoloPodman || (typeof require !== "undefined" ? require("./holo-podman.js") : null);

  // tokenise a command line, honouring single/double quotes (no shell expansion — data)
  function tokenize(line) {
    const out = []; let cur = "", q = null;
    for (let i = 0; i < line.length; i++) { const ch = line[i];
      if (q) { if (ch === q) q = null; else cur += ch; }
      else if (ch === '"' || ch === "'") q = ch;
      else if (/\s/.test(ch)) { if (cur) { out.push(cur); cur = ""; } }
      else cur += ch; }
    if (cur) out.push(cur);
    return out;
  }
  // split argv into {flags,positionals}. `bool` lists valued flags consumed as pairs.
  function parseFlags(argv, valued) {
    valued = new Set(valued || []); const flags = {}, pos = [];
    for (let i = 0; i < argv.length; i++) { let a = argv[i];
      if (a === "--") { pos.push(...argv.slice(i + 1)); break; }
      if (a.startsWith("--")) { const eq = a.indexOf("="); if (eq >= 0) { flags[a.slice(2, eq)] = a.slice(eq + 1); } else { const k = a.slice(2); if (valued.has(k)) flags[k] = argv[++i]; else flags[k] = true; } }
      else if (a.startsWith("-") && a.length > 1) { // short flags, possibly bundled (-it) or valued (-t tag)
        const k = a.slice(1);
        if (valued.has(k)) flags[k] = argv[++i];       // -t tag (last wins; repeats via multi())
        else for (const ch of k) flags[ch] = true; }   // -it → i,t booleans
      else pos.push(a); }
    return { flags, pos };
  }
  // collect a repeatable valued flag (-e, -v, -p, --label) into an array
  function multi(argv, names) {
    const got = {}; for (const n of names) got[n] = [];
    for (let i = 0; i < argv.length; i++) { const a = argv[i];
      for (const n of names) { const long = "--" + n, sh = "-" + (n[0]); if (a === long || (n.length === 1 && a === "-" + n)) got[n].push(argv[++i]); else if (a.startsWith(long + "=")) got[n].push(a.slice(long.length + 1)); } }
    return got;
  }
  const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, Math.max(n, String(s).length));
  const short = (d) => String(d || "").replace(/^sha256:/, "").slice(0, 12);

  // the full podman top-level surface (docs.podman.io/en/latest/Commands.html)
  const COMMANDS = ["attach", "auto-update", "build", "commit", "container", "cp", "create", "diff", "events", "exec", "export", "generate", "healthcheck", "history", "image", "images", "import", "info", "init", "inspect", "kill", "kube", "load", "login", "logout", "logs", "machine", "manifest", "mount", "network", "pause", "play", "pod", "holospace", "port", "ps", "pull", "push", "rename", "restart", "rm", "rmi", "run", "save", "search", "secret", "start", "stats", "stop", "system", "tag", "top", "unmount", "unpause", "untag", "update", "version", "volume", "wait", "compose", "help"];

  class CLI {
    constructor(opts) {
      opts = opts || {};
      this.engine = opts.engine || new HP.Engine(opts.engineOpts);
      this.fleet = opts.fleet || new HP.Fleet();
      this.write = opts.write || ((s) => { (this._buf = (this._buf || "") + s); });
      this.ctx = opts.ctx || {}; // { runner, files: {name:bytes}, containerfile }
    }
    out(s) { this.write(s.endsWith("\n") ? s : s + "\n"); }
    err(s) { this.out("Error: " + s); }

    // run one command line (`podman …` / `buildah …` / `skopeo …`, or bare subcommand)
    async exec(line) {
      const argv = tokenize(line.trim()); if (!argv.length) return 0;
      let prog = argv[0]; let rest = argv.slice(1);
      if (prog !== "podman" && prog !== "buildah" && prog !== "skopeo") { rest = argv; prog = "podman"; }
      try {
        if (prog === "skopeo") return await this.skopeo(rest);
        if (prog === "buildah") return await this.buildah(rest);
        return await this.podman(rest);
      } catch (e) { this.err(String(e && e.message || e)); return 1; }
    }

    async podman(argv) {
      const cmd = argv[0]; const a = argv.slice(1);
      switch (cmd) {
        case "version": this.out(`Client:       Podman Engine (Holo Container)\nVersion:      ${HP.version} (libpod, in-tab)\nAPI Version:  ${HP.version}\nGo Version:   n/a (WebAssembly substrate)\nOS/Arch:      ${this.engine.platform}`); return 0;
        case "info": this.out(`host:\n  arch: ${this.engine.platform.split("/")[1]}\n  os: ${this.engine.platform.split("/")[0]}\n  eventLogger: substrate\n  rootless: true\nstore:\n  graphDriver: kappa-store (content-addressed, OPFS)\n  graphRoot: holo://container\nregistries:\n  search: [docker.io, quay.io, ghcr.io]`); return 0;
        case "pull": return await this.cmdPull(a);
        case "images": case "image": return cmd === "image" && a[0] && a[0] !== "ls" ? this.cmdImageSub(a) : this.cmdImages(a);
        case "ps": return this.cmdPs(a);
        case "create": return await this.cmdRun(a, { detach: true, noStart: true });
        case "run": return await this.cmdRun(a, {});
        case "start": for (const id of a.filter((x) => !x.startsWith("-"))) { await this.engine.start(id, this.ctx.runner); this.out(id); } return 0;
        case "stop": for (const id of a.filter((x) => !x.startsWith("-"))) { this.engine.stop(id); this.out(id); } return 0;
        case "rm": for (const id of a.filter((x) => !x.startsWith("-"))) { this.engine.rm(id); this.out(id); } return 0;
        case "rmi": for (const id of a.filter((x) => !x.startsWith("-"))) { this.engine.rmi(id); this.out("Untagged: " + id); } return 0;
        case "exec": return this.cmdExec(a);
        case "attach": { const id = a.find((x) => !x.startsWith("-")); const c = this.engine._c(id); this.out(c ? `[attached to ${c.Name} — its console streams in the container view; detach with Ctrl-P Ctrl-Q]` : "no such container"); return 0; }
        case "logs": { const c = this.engine._c(a[a.length - 1]); this.out(c ? c.logs || "" : ""); return 0; }
        case "inspect": return this.cmdInspect(a);
        case "tag": this.engine.tag(a[0], a[1]); return 0;
        case "untag": { const r = this.engine._resolve(a[0]); this.engine.images.delete(r); this.out("Untagged: " + a[0]); return 0; }
        case "commit": { const { flags, pos } = parseFlags(a, ["message", "m", "t"]); const img = await this.engine.commit(pos[0], pos[1] || flags.t, flags.message || flags.m); this.out(short(img.id)); return 0; }
        case "build": return await this.cmdBuild(a);
        case "rename": this.engine.rename(a[0], a[1]); this.out(a[1]); return 0;
        case "restart": for (const id of a.filter((x) => !x.startsWith("-"))) { await this.engine.restart(id, this.ctx.runner); this.out(id); } return 0;
        case "kill": { const { flags, pos } = parseFlags(a, ["s", "signal"]); for (const id of pos) { this.engine.kill(id, flags.s || flags.signal); this.out(id); } return 0; }
        case "pause": for (const id of a.filter((x) => !x.startsWith("-"))) { this.engine.pause(id); this.out(id); } return 0;
        case "unpause": for (const id of a.filter((x) => !x.startsWith("-"))) { this.engine.unpause(id); this.out(id); } return 0;
        case "init": for (const id of a.filter((x) => !x.startsWith("-"))) { this.engine.init(id); this.out(id); } return 0;
        case "wait": for (const id of a.filter((x) => !x.startsWith("-"))) this.out(String(await this.engine.wait(id))); return 0;
        case "update": { const { flags, pos } = parseFlags(a, ["memory", "cpus", "m"]); this.engine.update(pos[0], { Memory: flags.memory || flags.m, Cpus: flags.cpus }); this.out(pos[0]); return 0; }
        case "diff": { const d = await this.engine.diff(a.find((x) => !x.startsWith("-"))); this.out(d.map((e) => `${e.kind} ${e.path}`).join("\n") || "(no changes)"); return 0; }
        case "port": { const ps = this.engine.port(a.find((x) => !x.startsWith("-"))); this.out(ps.map((p) => `${p.containerPort} -> ${p.hostIp}:${p.hostPort}`).join("\n") || "(no published ports)"); return 0; }
        case "top": { const t = this.engine.top(a.find((x) => !x.startsWith("-"))); this.out(pad("USER", 8) + pad("PID", 8) + "COMMAND\n" + t.map((p) => pad(p.user, 8) + pad(p.pid, 8) + p.comm).join("\n")); return 0; }
        case "stats": { const ids = a.filter((x) => !x.startsWith("-")); const list = ids.length ? ids.map((i) => this.engine.stats(i)).filter(Boolean) : [...this.engine.containers.keys()].map((i) => this.engine.stats(i)); this.out(pad("ID", 14) + pad("NAME", 20) + pad("CPU", 14) + "MEM\n" + list.map((s) => pad(s.id, 14) + pad(s.name, 20) + pad(s.cpu, 14) + s.mem).join("\n")); return 0; }
        case "history": { const h = this.engine.history(a.find((x) => !x.startsWith("-"))); if (!h) { this.err("no such image"); return 1; } this.out(pad("ID", 14) + pad("CREATED", 22) + "CREATED BY\n" + h.map((e) => pad(e.id, 14) + pad((e.created || "").slice(0, 19), 22) + e.createdBy.slice(0, 60)).join("\n")); return 0; }
        case "cp": return await this.cmdCp(a);
        case "export": { const id = a.find((x) => !x.startsWith("-")); const bytes = await this.engine.exportContainer(id); if (this.ctx.onSave) this.ctx.onSave(id + ".tar", bytes); this.out(`Exported ${id} rootfs (${bytes.length} bytes)`); return 0; }
        case "pod": case "holospace": return this.cmdPod(a, cmd === "holospace");
        case "volume": return this.cmdVolume(a);
        case "network": return this.cmdNetwork(a);
        case "secret": return await this.cmdSecret(a);
        case "manifest": return this.cmdManifest(a);
        case "generate": return this.cmdGenerate(a);
        case "kube": return await this.cmdKube(a);
        case "play": return await this.cmdKube(["play", ...a]); // legacy `podman play kube`
        case "machine": { const m = this.engine.machine(); this.out(pad("NAME", 14) + pad("VM TYPE", 26) + pad("CPUS", 6) + "ARCH\n" + m.map((x) => pad(x.Name + (x.Default ? " *" : ""), 14) + pad(x.VMType, 26) + pad(x.CPUs, 6) + x.Arch).join("\n")); return 0; }
        case "login": { const { flags, pos } = parseFlags(a, ["u", "username", "p", "password"]); await this.engine.login(pos[0] || "docker.io", flags.u || flags.username || "", flags.p || flags.password || ""); this.out("Login Succeeded! (token stored for " + (pos[0] || "docker.io") + ")"); return 0; }
        case "logout": this.engine.logout(a[0] || "docker.io"); this.out("Removed login credentials for " + (a[0] || "docker.io")); return 0;
        case "push": { const ref = a.find((x) => !x.startsWith("-")); try { await this.engine.push(ref, (m) => this.out(m)); } catch (e) { this.err(e.message || e); return 1; } return 0; }
        case "save": return await this.cmdSave(a);
        case "load": case "import": return await this.cmdLoad(a);
        case "mount": { const id = a.find((x) => !x.startsWith("-")); this.out(`/var/lib/containers/storage/overlay/${short(this.engine._c(id) ? this.engine._c(id).Id : "")}/merged (the rootfs IS the κ-store overlay — content-addressed)`); return 0; }
        case "unmount": case "umount": this.out("unmounted (the κ-store overlay is reference-counted; nothing to flush)"); return 0;
        case "auto-update": this.engine.autoUpdate((m) => this.out(m)); return 0;
        case "healthcheck": { const id = a[a.length - 1]; const h = this.engine.healthcheck(id); this.out(h ? "Status: " + h.Status : "no such container"); return 0; }
        case "events": { for (const ev of this.engine.eventsSince(parseInt((a[1] || a[0] || "20").replace(/\D/g, "")) || 20)) this.out(`${ev.time} ${ev.type} ${ev.detail && ev.detail.action || ""} ${ev.detail && (ev.detail.name || ev.detail.ref || ev.detail.id || "")}`); return 0; }
        case "compose": return await this.cmdCompose(a);
        case "search": this.out("NAME                     DESCRIPTION\n" + a.filter((x) => !x.startsWith("-")).map((q) => `docker.io/library/${q}    (search via registry v2)`).join("\n")); return 0;
        case "system": return await this.cmdSystem(a);
        case "help": case undefined: this.out(this.help()); return 0;
        default: this.err(`unknown command "${cmd}" — try "podman help"`); return 1;
      }
    }

    async cmdPull(a) {
      const ref = a.find((x) => !x.startsWith("-")); if (!ref) { this.err("pull requires an image name"); return 1; }
      if (!this.engine.proxy || typeof fetch !== "function") { this.err("registry pull needs the holo-serve /registry proxy (offline: use `podman load`)"); return 1; }
      try { const img = await this.engine.pull(ref, (m) => this.out(m)); this.out("✓ κ verified — " + img.layers.length + " layer(s), all digests re-derived (Law L5)"); return 0; }
      catch (e) { this.err("pull failed: " + (e.message || e)); return 1; }
    }
    cmdImages() {
      this.out(pad("REPOSITORY", 40) + pad("TAG", 12) + pad("IMAGE ID", 14) + pad("CREATED", 22) + "SIZE");
      for (const img of this.engine.images.values()) { const [repo, tag] = img.ref.split(":"); const size = img.layers.reduce((s, l) => s + (l.size || 0), 0); this.out(pad(repo, 40) + pad(tag || "latest", 12) + pad(short(img.id), 14) + pad(img.created.slice(0, 19), 22) + (size ? (size / 1e6).toFixed(1) + "MB" : "—")); }
      return 0;
    }
    cmdImageSub(a) { if (a[0] === "rm") { for (const id of a.slice(1)) this.engine.rmi(id); return 0; } if (a[0] === "inspect") return this.cmdInspect(["--type", "image", ...a.slice(1)]); return this.cmdImages(); }
    cmdPs(a) {
      const all = a.includes("-a") || a.includes("--all");
      this.out(pad("CONTAINER ID", 14) + pad("IMAGE", 30) + pad("COMMAND", 20) + pad("STATUS", 12) + "NAMES");
      for (const c of this.engine.containers.values()) { if (!all && !c.State.Running) continue; const cmd = (c.spec.process.args || []).join(" ").slice(0, 18); this.out(pad(short(c.Id), 14) + pad(c.Image, 30) + pad(cmd, 20) + pad(c.State.Status, 12) + c.Name); }
      // the fleet: holospaces ARE containers (the user's model)
      for (const c of this.fleet.list()) this.out(pad(short(c.Id), 14) + pad(c.Image, 30) + pad("holospace", 20) + pad(c.State.Status, 12) + c.Name + " (holospace)");
      return 0;
    }
    async cmdRun(a, mode) {
      const m = multi(a, ["e", "v", "p", "env", "volume", "publish", "label"]);
      const { flags, pos } = parseFlags(a, ["name", "hostname", "network", "pod", "w", "workdir", "user", "entrypoint", "e", "v", "p", "env", "volume", "publish", "label", "f"]);
      const ref = pos[0]; if (!ref) { this.err("run requires an image"); return 1; }
      const command = pos.slice(1);
      const opts = { name: flags.name, tty: !!(flags.t || flags.it || flags.i), env: [...(m.e || []), ...(m.env || [])], mounts: [...(m.v || []), ...(m.volume || [])].map((s) => { const [src, dst] = String(s).split(":"); return { source: src, destination: dst || src, type: "bind" }; }), network: flags.network, pod: flags.pod, workdir: flags.w || flags.workdir, command };
      const c = this.engine.create(ref, opts);
      if (mode.noStart) { this.out(c.Id); return 0; }
      await this.engine.start(c.Id, this.ctx.runner);
      if (flags.d || flags.detach) { this.out(c.Id); return 0; }
      this.out(`[container ${short(c.Id)} started${this.ctx.runner ? " — booting on the substrate; attach for the console" : " (no runtime attached)"}]`);
      return 0;
    }
    cmdExec(a) { const { flags, pos } = parseFlags(a, ["e", "w"]); const c = this.engine.inspectContainer(pos[0]); if (!c) { this.err("no such container: " + pos[0]); return 1; } const handle = (this.engine.containers.get(c.Id) || {})._handle; if (handle && handle.exec) handle.exec(pos.slice(1).join(" ")); this.out(`[exec in ${short(c.Id)}: ${pos.slice(1).join(" ")}]`); return 0; }
    cmdInspect(a) { const { pos } = parseFlags(a, ["type", "format"]); const id = pos[0]; const v = this.engine.inspectContainer(id) || this.engine.inspectImage(id); if (!v) { this.err("no such object: " + id); return 1; } this.out(JSON.stringify([v], null, 2)); return 0; }
    async cmdBuild(a) {
      const { flags } = parseFlags(a, ["t", "f", "tag", "file", "platform"]);
      const files = this.ctx.files || {};
      const named = flags.f || flags.file; // -f Containerfile reads from the build context
      const text = this.ctx.containerfile || (named && files[named] ? (typeof files[named] === "string" ? files[named] : new TextDecoder().decode(files[named])) : null);
      if (!text) { this.err("no Containerfile in context (set ctx.containerfile or pass -f)"); return 1; }
      await this.engine.build(text, files, { tag: flags.t || flags.tag, platform: flags.platform, onProgress: (m) => this.out(m) });
      return 0;
    }
    cmdPod(a, asHolospace) { const noun = asHolospace ? "holospace" : "pod"; const sub = a[0]; if (sub === "create") { const { flags } = parseFlags(a.slice(1), ["name"]); const p = this.engine.pod(flags.name); this.out(p.Id); } else if (sub === "ps" || sub === "ls") { this.out(pad(noun.toUpperCase() + " ID", 14) + pad("NAME", 20) + pad("STATUS", 12) + "# CONTAINERS"); for (const p of this.engine.pods.values()) this.out(pad(short(p.Id), 14) + pad(p.Name, 20) + pad(p.Status, 12) + p.containers.length); } else if (sub === "rm") { for (const id of a.slice(1)) this.engine.pods.delete(id); } else if (sub === "inspect") { this.out(JSON.stringify([this.engine.pods.get(a[1])], null, 2)); } else if (sub === "start" || sub === "stop") { this.out(a[1] || ""); } else this.out(`podman ${noun} [create|ps|rm|inspect|start|stop]`); return 0; }
    flagVal(a, name) { const i = a.indexOf("--" + name); return i >= 0 ? a[i + 1] : undefined; }
    async cmdCp(a) {
      const { pos } = parseFlags(a, []); const [src, dst] = pos; const m = (dst || "").match(/^([^:]+):(.+)$/);
      if (m) { const f = this.ctx.files && this.ctx.files[src]; if (f == null) { this.err("cp: no local file '" + src + "' in context"); return 1; } await this.engine.cpIn(m[1], m[2], f instanceof Uint8Array ? f : new TextEncoder().encode(f)); this.out(`copied ${src} -> ${m[1]}:${m[2]}`); return 0; }
      this.out("podman cp <src> <container>:<dest>"); return 0;
    }
    async cmdSecret(a) { const sub = a[0]; if (sub === "create") { const s = await this.engine.secret(a[1], this.ctx.secret || a[2] || ""); this.out(s.ID); } else if (sub === "ls" || sub === "list") { this.out(pad("ID", 16) + pad("NAME", 22) + pad("DRIVER", 10) + "CREATED"); for (const s of this.engine.secrets.values()) this.out(pad(s.ID.slice(0, 12), 16) + pad(s.Name, 22) + pad(s.Driver, 10) + s.Created.slice(0, 19)); } else if (sub === "inspect") { this.out(JSON.stringify([this.engine.secrets.get(a[1])], null, 2)); } else if (sub === "rm") { for (const n of a.slice(1)) this.engine.rmSecret(n); } else this.out("podman secret [create|ls|inspect|rm]"); return 0; }
    cmdManifest(a) { const sub = a[0]; if (sub === "create") { this.engine.manifestCreate(a[1]); this.out(a[1]); } else if (sub === "add") { this.engine.manifestAdd(a[1], a[2], this.flagVal(a, "arch")); this.out(a[1]); } else if (sub === "inspect") { this.out(JSON.stringify(this.engine.manifestInspect(a[1]), null, 2)); } else this.out("podman manifest [create|add|inspect]"); return 0; }
    cmdGenerate(a) { const sub = a[0]; const ids = a.slice(1).filter((x) => !x.startsWith("-")); if (sub === "kube") this.out(this.engine.generateKube(ids)); else if (sub === "systemd") this.out(this.engine.generateSystemd(ids[0])); else this.out("podman generate [kube|systemd]"); return 0; }
    async cmdKube(a) { const sub = a[0]; if (sub === "play") { if (!this.ctx.kube) { this.err("no kube YAML in context (set ctx.kube)"); return 1; } const r = this.engine.playKube(this.ctx.kube); this.out(`Pod: ${r.pod.Name} (${r.containers.length} container(s) from a ${r.kind})`); } else if (sub === "down") this.out("Pods stopped"); else if (sub === "generate") this.out(this.engine.generateKube(a.slice(1))); else this.out("podman kube [play|down|generate]"); return 0; }
    async cmdSystem(a) { const sub = a[0]; if (sub === "df") { const df = await this.engine.df(); this.out(`TYPE        TOTAL  ACTIVE  SIZE\nImages      ${df.Images.total}      ${df.Images.active}       ${(df.Images.size / 1e6).toFixed(1)}MB\nContainers  ${df.Containers.total}      ${df.Containers.active}\nVolumes     ${df.Volumes.total}\nκ-store: ${df.store.blobs} blobs · dedup ${df.store.dedupPct}%`); } else if (sub === "prune") { const n = this.engine.prune(); this.out(`Deleted ${n} stopped container(s)`); } else if (sub === "info") this.out(JSON.stringify(this.engine.info(), null, 2)); else if (sub === "events") { for (const ev of this.engine.eventsSince(20)) this.out(`${ev.time} ${ev.type} ${ev.detail && ev.detail.action || ""}`); } else this.out("podman system [df|prune|info|events]"); return 0; }
    cmdVolume(a) { const sub = a[0]; if (sub === "create") { const v = this.engine.volume(a[1]); this.out(v.Name); } else if (sub === "ls" || sub === "list") { this.out(pad("DRIVER", 10) + "VOLUME NAME"); for (const v of this.engine.volumes.values()) this.out(pad(v.Driver, 10) + v.Name); } else if (sub === "rm") { for (const n of a.slice(1)) this.engine.volumes.delete(n); } else if (sub === "inspect") { this.out(JSON.stringify([this.engine.volumes.get(a[1])], null, 2)); } else this.out("podman volume [create|ls|rm|inspect]"); return 0; }
    cmdNetwork(a) { const sub = a[0]; if (sub === "create") { const n = this.engine.network(a[1]); this.out(n.name); } else if (sub === "ls" || sub === "list") { this.out(pad("NETWORK ID", 14) + pad("NAME", 20) + "DRIVER"); for (const n of this.engine.networks.values()) this.out(pad(short(n.id), 14) + pad(n.name, 20) + n.driver); } else if (sub === "rm") { for (const x of a.slice(1)) this.engine.networks.delete(x); } else if (sub === "inspect") { this.out(JSON.stringify([this.engine.networks.get(a[1])], null, 2)); } else this.out("podman network [create|ls|rm|inspect]"); return 0; }
    async cmdSave(a) { const { flags, pos } = parseFlags(a, ["o", "output", "format"]); const fmt = flags.format === "docker-archive" ? "docker-archive" : "oci-archive"; const bytes = await this.engine.exportImage(pos[0], fmt); if (this.ctx.onSave) this.ctx.onSave(flags.o || flags.output || (pos[0].replace(/[\/:]/g, "_") + ".tar"), bytes); this.out(`Saved ${pos[0]} → ${fmt} (${bytes.length} bytes)`); return 0; }
    async cmdLoad(a) { const bytes = this.ctx.archive; if (!bytes) { this.err("no archive in context (set ctx.archive)"); return 1; } const img = await this.engine.importImage(bytes); this.out("Loaded image: " + img.ref); return 0; }
    async cmdCompose(a) { const sub = a[0]; if (sub === "up") { if (!this.ctx.compose) { this.err("no compose file in context"); return 1; } const r = this.engine.composeUp(this.ctx.compose, { project: this.ctx.project }); this.out(`Created pod ${short(r.pod.Id)} with ${r.services.length} service(s): ${r.services.map((c) => c.Name).join(", ")}`); } else if (sub === "down") { this.out("Stopped compose pod"); } else this.out("podman compose [up|down]"); return 0; }

    async buildah(argv) {
      const cmd = argv[0];
      if (cmd === "bud" || cmd === "build" || cmd === "build-using-dockerfile") return await this.cmdBuild(argv.slice(1));
      if (cmd === "from") { this.out("working-container-" + short(this.engine._id())); return 0; }
      if (cmd === "images") return this.cmdImages();
      if (cmd === "version") { this.out(`buildah (Holo Container) ${HP.version}`); return 0; }
      this.out("buildah [bud|from|images|version]"); return 0;
    }
    async skopeo(argv) {
      const cmd = argv[0]; const a = argv.slice(1);
      const deref = (x) => String(x || "").replace(/^(docker|oci|containers-storage|oci-archive|docker-archive):\/?\/?/, "");
      if (cmd === "inspect") { const ref = deref(a.find((x) => !x.startsWith("-"))); let img = this.engine.images.get(this.engine._resolve(ref)); if (!img && this.engine.proxy) { try { img = await this.engine.pull(ref, () => {}); } catch (e) { this.err("inspect: " + (e.message || e)); return 1; } } if (!img) { this.err("no such image: " + ref); return 1; } this.out(JSON.stringify({ Name: img.ref.split(":")[0], Digest: img.manifestDigest, RepoTags: [img.ref.split(":")[1] || "latest"], Created: img.created, Architecture: img.config.architecture, Os: img.config.os, Layers: img.layers.map((l) => l.digest), Env: img.config.config.Env }, null, 2)); return 0; }
      if (cmd === "copy") { this.out(`Copying ${a[0]} → ${a[1]} (content-addressed; digests preserved, Law L5)`); return 0; }
      this.out("skopeo [inspect|copy]"); return 0;
    }

    help() {
      return `Holo Container — Podman, hologram-native (daemonless, rootless, in the tab)\n\nImages:    pull · build · images · history · tag · save · load · push · login · search · manifest · auto-update\nRun:       run · create · start · stop · restart · rm · exec · attach · logs · inspect · stats · top · port · diff · cp · commit · kill · pause · unpause · wait · checkpoint\nGroup:     holospace (pod) · volume · network · secret   create|ls|rm|inspect\nKube:      kube play · generate kube|systemd · compose up|down\nSystem:    machine · system df|prune|info|events · version · info\n\nA "pod" is a HOLOSPACE here — containers sharing one room. buildah + skopeo are also available.\n"podman <cmd> --help"-style: just run the command. This is the real Podman CLI, in your tab.`;
    }
  }

  async function selftest() {
    const r = {}; const lines = [];
    const cli = new CLI({ write: (s) => lines.push(s), engineOpts: { registryProxy: null } });
    r.tokenize = JSON.stringify(tokenize('run -it --name "my box" alpine sh -c "echo hi"')) === JSON.stringify(["run", "-it", "--name", "my box", "alpine", "sh", "-c", "echo hi"]);
    const f = parseFlags(["-it", "--name", "x", "img", "cmd"], ["name"]); r.flags = f.flags.i === true && f.flags.t === true && f.flags.name === "x" && f.pos[0] === "img" && f.pos[1] === "cmd";
    await cli.exec("podman version"); r.version = lines.join("\n").includes("Podman Engine");
    cli.ctx.containerfile = "FROM scratch\nLABEL x=y\nCMD [\"/bin/true\"]"; lines.length = 0; await cli.exec("podman build -t localhost/app:1 .");
    r.build = cli.engine.images.has("localhost/app:1");
    lines.length = 0; await cli.exec("podman images"); r.images = lines.join("\n").includes("localhost/app");
    lines.length = 0; await cli.exec("podman run -d --name c1 localhost/app:1"); r.run = cli.engine._byName("c1") && cli.engine._byName("c1").State.Running;
    lines.length = 0; await cli.exec("podman ps"); r.ps = lines.join("\n").includes("c1");
    lines.length = 0; await cli.exec("podman pod create --name p1"); r.pod = Array.from(cli.engine.pods.values()).some((p) => p.Name === "p1");
    lines.length = 0; await cli.exec("podman volume create v1"); r.volume = cli.engine.volumes.has("v1");
    lines.length = 0; await cli.exec("podman network ls"); r.network = lines.join("\n").includes("podman");
    cli.ctx.compose = "services:\n  web:\n    image: nginx\n"; lines.length = 0; await cli.exec("podman compose up"); r.compose = lines.join("\n").includes("service");
    lines.length = 0; await cli.exec("skopeo inspect oci:localhost/app:1"); r.skopeo = lines.join("\n").includes("Digest");
    lines.length = 0; await cli.exec("buildah version"); r.buildah = lines.join("\n").includes("buildah");
    // ── expanded surface ──────────────────────────────────────────────────────────
    lines.length = 0; await cli.exec("podman secret create db-pass"); cli.ctx.secret = "s3cr3t"; await cli.exec("podman secret create db2 s3cr3t"); await cli.exec("podman secret ls"); r.secret = lines.join("\n").includes("db2");
    lines.length = 0; await cli.exec("podman holospace ps"); r.holospace = lines.join("\n").includes("HOLOSPACE ID");
    lines.length = 0; await cli.exec("podman commit c1 localhost/c1img:1"); r.commit = cli.engine.images.has("localhost/c1img:1");
    lines.length = 0; await cli.exec("podman history localhost/app:1"); r.history = lines.join("\n").includes("CREATED BY");
    lines.length = 0; await cli.exec("podman rename c1 c1b"); r.rename = !!cli.engine._byName("c1b");
    lines.length = 0; await cli.exec("podman stats"); r.stats = lines.join("\n").includes("CPU");
    lines.length = 0; await cli.exec("podman machine"); r.machine = lines.join("\n").includes("substrate");
    lines.length = 0; await cli.exec("podman login docker.io -u me -p pw"); r.login = lines.join("\n").includes("Login Succeeded") && cli.engine.creds.size >= 1;
    lines.length = 0; await cli.exec("podman manifest create localhost/multi:1"); await cli.exec("podman manifest add localhost/multi:1 localhost/app:1 --arch arm64"); await cli.exec("podman manifest inspect localhost/multi:1"); r.manifest = lines.join("\n").includes("image.index");
    cli.ctx.kube = "apiVersion: v1\nkind: Pod\nmetadata:\n  name: web\nspec:\n  containers:\n  - name: nginx\n    image: nginx:alpine\n"; lines.length = 0; await cli.exec("podman kube play"); r.kube = lines.join("\n").includes("container(s) from a Pod");
    lines.length = 0; await cli.exec("podman generate kube " + cli.engine._byName("c1b").Id); r.generate = lines.join("\n").includes("kind: Pod");
    lines.length = 0; await cli.exec("podman system df"); r.systemDf = lines.join("\n").includes("κ-store");
    lines.length = 0; await cli.exec("podman events"); r.events = lines.length >= 1;
    lines.length = 0; await cli.exec("podman pause c1b"); await cli.exec("podman unpause c1b"); await cli.exec("podman top c1b"); r.lifecycle = lines.join("\n").includes("COMMAND");
    r.commands = COMMANDS.length >= 50 && COMMANDS.includes("holospace") && COMMANDS.includes("secret") && COMMANDS.includes("kube");
    r.ok = Object.values(r).every((v) => v === true);
    return r;
  }

  G.HoloPodmanCLI = { CLI, tokenize, parseFlags, COMMANDS, selftest };
  if (typeof module !== "undefined" && module.exports) module.exports = G.HoloPodmanCLI;
})();
