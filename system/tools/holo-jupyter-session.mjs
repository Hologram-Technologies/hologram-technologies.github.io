#!/usr/bin/env node
// holo-jupyter-session.mjs — a PERSISTENT, κ-DAG-anchored Holo Jupyter kernel for agents.
// Boots the sealed Pyodide 0.29.3 bytes ONCE (headless, kept warm) so subsequent runs are fast
// (no per-call cold start), keeps a PERSISTENT Python namespace across runs (define x now, use it
// later — a real stateful research session), and chains every run into a content-addressed
// PROV-O provenance DAG (each step links the previous: prov:wasInformedBy). The session root κ
// commits to the whole ordered research trace (Law L5 — reproducible).
//
//   import { HoloJupyterSession } from "./holo-jupyter-session.mjs";
//   const s = new HoloJupyterSession(); await s.start();
//   await s.run("import numpy as np; x = np.arange(10)");   // step 0
//   await s.run("print(int(x.sum()))");                      // step 1 — x persists
//   s.sessionRoot();  await s.close();
//
// Demo / smoke:  node tools/holo-jupyter-session.mjs --demo
import { createServer } from "node:http";
import { readFileSync, statSync, existsSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const APP = process.env.HOLO_JUPYTER_APP || "C:/Users/pavel/Desktop/Hologram Apps/apps/jypyter";
const OSPRIM = process.env.HOLO_OS_PRIM || "C:/Users/pavel/Desktop/hologram-os/os";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
  ".wasm": "application/wasm", ".whl": "application/octet-stream", ".tar": "application/x-tar", ".data": "application/octet-stream",
  ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ttf": "font/ttf", ".woff2": "font/woff2", ".zip": "application/zip" };

export class HoloJupyterSession {
  constructor() { this.dag = []; this.started = false; }

  async start() {
    if (this.started) return this;
    const { sha256hex } = await import(pathToFileURL(join(OSPRIM, "holo-uor.mjs")));
    const { makeObject } = await import(pathToFileURL(join(OSPRIM, "holo-object.mjs")));
    this._sha = sha256hex; this._make = makeObject;
    this.appRoot = JSON.parse(readFileSync(join(APP, "holospace.lock.json"), "utf8")).root;

    this.server = createServer((req, res) => {
      try {
        const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
        const abs = normalize(join(APP, rel));
        if (!abs.startsWith(normalize(APP)) || !existsSync(abs) || !statSync(abs).isFile()) { res.writeHead(404); return res.end("nf"); }
        res.writeHead(200, { "content-type": MIME[extname(abs).toLowerCase()] || "application/octet-stream" });
        res.end(readFileSync(abs));
      } catch { res.writeHead(500); res.end("err"); }
    });
    await new Promise((r) => this.server.listen(0, "127.0.0.1", r));
    this.origin = `http://127.0.0.1:${this.server.address().port}`;

    const require = createRequire(pathToFileURL(join(OSPRIM, "package.json")));
    const { chromium } = require("playwright");
    this.browser = await chromium.launch({ headless: true });
    this.page = await this.browser.newPage();
    await this.page.goto(this.origin + "/__session__", { waitUntil: "domcontentloaded" }).catch(() => {});
    await this.page.addScriptTag({ url: this.origin + "/static/pyodide/pyodide.js" });
    // boot pyodide ONCE; define a persistent runner on window (kept warm across run() calls).
    await this.page.evaluate(async (origin) => {
      const py = await loadPyodide({ indexURL: origin + "/static/pyodide/" });
      await py.loadPackage(["micropip"]);
      window.__installed = new Set();
      window.__holoRun = async (code, installs) => {
        await py.loadPackagesFromImports(code);                                  // auto-load dist deps
        if (installs && installs.length) {
          const need = installs.filter((p) => !window.__installed.has(p));
          if (need.length) {
            const idx = await (await fetch(origin + "/pypi/all.json")).json();
            const urls = [];
            for (const pkg of Object.values(idx)) for (const rels of Object.values(pkg.releases || {})) for (const f of rels) urls.push(origin + "/pypi/" + f.filename);
            await py.runPythonAsync("import micropip\nawait micropip.install(" + JSON.stringify(urls) + ", deps=True, keep_going=True)");
            installs.forEach((p) => window.__installed.add(p));
          }
        }
        const w = [
          "import sys, io, json, traceback",
          "_o=io.StringIO(); _e=io.StringIO(); _r=None; _ok=True; _err=None",
          "_ns = globals().setdefault('__holo_ns', {})",                          // PERSISTENT namespace across runs
          "sys.stdout=_o; sys.stderr=_e",
          "try:",
          "    exec(compile(" + JSON.stringify(code) + ", '<agent>', 'exec'), _ns)",
          "    _r = _ns.get('result', None)",
          "except Exception:",
          "    _ok=False; _err=traceback.format_exc()",
          "finally:",
          "    sys.stdout=sys.__stdout__; sys.stderr=sys.__stderr__",
          "json.dumps({'ok':_ok,'stdout':_o.getvalue(),'stderr':_e.getvalue(),'result':(str(_r) if _r is not None else None),'error':_err})",
        ].join("\n");
        return await py.runPythonAsync(w);
      };
    }, this.origin);
    this.started = true;
    for (const sig of ["exit", "SIGINT", "SIGTERM"]) process.once(sig, () => { try { this.browser?.close(); this.server?.close(); } catch {} });
    return this;
  }

  async run(code, installs = []) {
    if (!this.started) await this.start();
    if (!code || !String(code).trim()) return { ok: false, error: "no code" };
    const raw = await this.page.evaluate(({ code, installs }) => window.__holoRun(code, installs), { code: String(code), installs });
    const out = JSON.parse(raw);
    const codeKappa = "did:holo:sha256:" + this._sha(Buffer.from(String(code), "utf8"));
    const outputKappa = "did:holo:sha256:" + this._sha(Buffer.from(JSON.stringify({ stdout: out.stdout, result: out.result, ok: out.ok }), "utf8"));
    const prev = this.dag.length ? this.dag[this.dag.length - 1].receiptKappa : null;
    const receipt = this._make(new Map(), {
      type: ["prov:Activity", "schema:Action"],
      context: [{ prov: "http://www.w3.org/ns/prov#" }],
      "schema:name": "Holo Jupyter session step",
      step: this.dag.length,
      "prov:used": codeKappa,
      "prov:generated": outputKappa,
      ...(prev ? { "prov:wasInformedBy": prev } : {}),       // link the chain
      "prov:wasAssociatedWith": this.appRoot,
      "hosc:engine": "Pyodide 0.29.3 (WebAssembly, warm)",
    });
    const node = { ok: out.ok, stdout: out.stdout, stderr: out.stderr, result: out.result, error: out.error || null,
      step: this.dag.length, codeKappa, outputKappa, receiptKappa: receipt.id, prevReceipt: prev, environmentKappa: this.appRoot };
    this.dag.push(node);
    return node;
  }

  // the whole research trace as one content-addressed object — its κ commits to the ordered chain.
  sessionRoot() {
    return this._make(new Map(), {
      type: ["prov:Bundle", "schema:Dataset"],
      "schema:name": "Holo Jupyter research session",
      "prov:wasAssociatedWith": this.appRoot,
      steps: this.dag.length,
      chain: this.dag.map((n) => n.receiptKappa),
    });
  }

  async close() { try { await this.browser?.close(); } catch {} try { this.server?.close(); } catch {} this.started = false; }
}

// demo / smoke
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes("--demo")) {
  const ms = () => Number(process.hrtime.bigint() / 1000000n);
  const s = new HoloJupyterSession();
  let t = ms(); await s.start(); console.log(`boot (cold, once): ${ms() - t} ms`);
  const steps = [
    { code: "import numpy as np\nx = np.arange(1000)\nprint('defined x, sum =', int(x.sum()))" },
    { code: "print('x persists across runs:', int(x.mean()))" },                       // uses x from step 0
    { code: "import cirq\nq=cirq.LineQubit.range(2)\nsv=cirq.Simulator().simulate(cirq.Circuit([cirq.H(q[0]),cirq.CNOT(q[0],q[1])])).final_state_vector\nprint('Bell:', cirq.dirac_notation(sv))", installs: ["cirq-core"] },
    { code: "print('still warm, x[42] =', int(x[42]))" },                              // warm + state
  ];
  for (const st of steps) { t = ms(); const r = await s.run(st.code, st.installs || []); console.log(`step ${r.step}: ${String(ms() - t).padStart(6)} ms | ok=${r.ok} | ${JSON.stringify(r.stdout.trim())} | receipt ${r.receiptKappa.slice(15, 31)}… prev ${r.prevReceipt ? r.prevReceipt.slice(15, 27) + "…" : "—"}`); }
  console.log("session root κ:", s.sessionRoot().id);
  await s.close();
}
