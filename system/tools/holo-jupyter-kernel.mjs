#!/usr/bin/env node
// holo-jupyter-kernel.mjs — headless, κ-addressed execution of Python in the SEALED Holo Jupyter
// environment, for agents (copilot / autonomous research). Runs the EXACT vendored Pyodide 0.29.3
// bytes (the same ones users get in-browser — Law L5 parity), seals { code -> stdout/result } as a
// content-addressed PROV-O receipt, and returns it. No cloud, no separate runtime.
//
// As a library (used by the MCP tool holo_jupyter_run):
//   import { runHoloJupyter } from "./holo-jupyter-kernel.mjs";
//   const r = await runHoloJupyter({ code, installs });   // → { ok, stdout, result, codeKappa, ... }
// As a CLI:
//   node tools/holo-jupyter-kernel.mjs --code "import numpy as np; print(np.arange(5).sum())"
//   echo "<python>" | node tools/holo-jupyter-kernel.mjs --installs cirq-core,kingdon
import { createServer } from "node:http";
import { readFileSync, statSync, existsSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const APP = process.env.HOLO_JUPYTER_APP || "C:/Users/pavel/Desktop/Hologram Apps/apps/jypyter";
const OSPRIM = process.env.HOLO_OS_PRIM || "C:/Users/pavel/Desktop/hologram-os/os";   // hashing + playwright
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
  ".wasm": "application/wasm", ".whl": "application/octet-stream", ".tar": "application/x-tar", ".data": "application/octet-stream",
  ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ttf": "font/ttf", ".woff2": "font/woff2", ".zip": "application/zip" };

// runHoloJupyter({ code, installs }) → execute Python in the sealed env, return a κ-sealed result.
export async function runHoloJupyter({ code, installs = [] } = {}) {
  if (!code || !String(code).trim()) return { ok: false, error: "no code" };
  const { sha256hex } = await import(pathToFileURL(join(OSPRIM, "holo-uor.mjs")));
  const { makeObject } = await import(pathToFileURL(join(OSPRIM, "holo-object.mjs")));

  // a tiny static server for the sealed app, so the real pyodide + wheel index resolve by content
  const server = createServer((req, res) => {
    try {
      const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
      const abs = normalize(join(APP, rel));
      if (!abs.startsWith(normalize(APP)) || !existsSync(abs) || !statSync(abs).isFile()) { res.writeHead(404); return res.end("nf"); }
      res.writeHead(200, { "content-type": MIME[extname(abs).toLowerCase()] || "application/octet-stream" });
      res.end(readFileSync(abs));
    } catch { res.writeHead(500); res.end("err"); }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const ORIGIN = `http://127.0.0.1:${server.address().port}`;

  const require = createRequire(pathToFileURL(join(OSPRIM, "package.json")));
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  let run;
  try {
    const page = await browser.newPage();
    await page.goto(ORIGIN + "/__kernel__", { waitUntil: "domcontentloaded" }).catch(() => {});  // same-origin so the worker may importScripts
    run = await page.evaluate(async ({ origin, code, installs }) => {
      return await new Promise((resolve) => {
        const wsrc = `
          importScripts('${origin}/static/pyodide/pyodide.js');
          const CODE = ${JSON.stringify(code)};
          const INSTALLS = ${JSON.stringify(installs)};
          (async () => {
            try {
              const py = await loadPyodide({ indexURL: '${origin}/static/pyodide/' });
              await py.loadPackage(['micropip']);
              await py.loadPackagesFromImports(CODE);                                 // auto-load dist deps
              if (INSTALLS.length) {                                                   // bundled wheels by URL via micropip (offline)
                const idx = await (await fetch('${origin}/pypi/all.json')).json();
                const urls = [];
                for (const pkg of Object.values(idx)) for (const rels of Object.values(pkg.releases || {})) for (const f of rels) urls.push('${origin}/pypi/' + f.filename);
                await py.runPythonAsync('import micropip\\nawait micropip.install(' + JSON.stringify(urls) + ', deps=True, keep_going=True)');
              }
              const wrapped = [
                'import sys, io, json, traceback',
                '_o = io.StringIO(); _e = io.StringIO(); _r = None; _ok = True; _err = None',
                'sys.stdout = _o; sys.stderr = _e',
                'try:',
                '    _ns = {}',
                '    exec(compile(' + JSON.stringify(CODE) + ', "<agent>", "exec"), _ns)',
                '    _r = _ns.get("result", None)',
                'except Exception:',
                '    _ok = False; _err = traceback.format_exc()',
                'finally:',
                '    sys.stdout = sys.__stdout__; sys.stderr = sys.__stderr__',
                'json.dumps({"ok": _ok, "stdout": _o.getvalue(), "stderr": _e.getvalue(), "result": (str(_r) if _r is not None else None), "error": _err})',
              ].join('\\n');
              self.postMessage(await py.runPythonAsync(wrapped));
            } catch (e) { self.postMessage(JSON.stringify({ ok: false, error: String(e), stdout: '', stderr: '' })); }
          })();
        `;
        const w = new Worker(URL.createObjectURL(new Blob([wsrc], { type: "text/javascript" })));
        w.onmessage = (e) => resolve(e.data);
        w.onerror = (e) => resolve(JSON.stringify({ ok: false, error: e.message, stdout: "", stderr: "" }));
        setTimeout(() => resolve(JSON.stringify({ ok: false, error: "timeout", stdout: "", stderr: "" })), 180000);
      });
    }, { origin: ORIGIN, code, installs });
  } finally { await browser.close().catch(() => {}); server.close(); }

  const out = JSON.parse(run);
  // κ-seal the provenance: code (input) → output, as a content-addressed PROV-O activity (Law L5).
  const appRoot = JSON.parse(readFileSync(join(APP, "holospace.lock.json"), "utf8")).root;
  const codeKappa = "did:holo:sha256:" + sha256hex(Buffer.from(String(code), "utf8"));
  const outBytes = Buffer.from(JSON.stringify({ stdout: out.stdout, result: out.result, ok: out.ok }), "utf8");
  const outputKappa = "did:holo:sha256:" + sha256hex(outBytes);
  const receipt = makeObject(new Map(), {
    type: ["prov:Activity", "schema:Action"],
    context: [{ prov: "http://www.w3.org/ns/prov#" }],
    "schema:name": "Holo Jupyter agent execution",
    "prov:used": codeKappa,
    "prov:generated": outputKappa,
    "prov:wasAssociatedWith": appRoot,            // the sealed Holo Jupyter environment (κ)
    "hosc:engine": "Pyodide 0.29.3 (WebAssembly)",
    "hosc:deterministic": out.ok,
  });
  return { ok: out.ok, stdout: out.stdout, stderr: out.stderr, result: out.result, error: out.error || null,
    codeKappa, outputKappa, receiptKappa: receipt.id, environmentKappa: appRoot };
}

// CLI
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const getArg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  let code = getArg("--code");
  const installs = (getArg("--installs") || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!code) code = readFileSync(0, "utf8");
  const r = await runHoloJupyter({ code, installs });
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
}
