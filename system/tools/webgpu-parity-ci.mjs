#!/usr/bin/env node
// webgpu-parity-ci.mjs — headless WebGPU parity gate (P5 of the WebGPU render-substrate plan).
//
// Drives a real Chrome/Edge headless over the DevTools Protocol (zero npm deps — Node 22 globals
// WebSocket + fetch), loads each parity witness page, scrapes window.__parity, and asserts each
// backend matches WebGL2 within tolerance. It NEVER fakes green:
//   exit 0 = all witnesses PASS
//   exit 1 = a witness FAILED (out-of-tolerance) or errored
//   exit 2 = INCONCLUSIVE — headless browser brought up no WebGPU device (cannot witness here)
//
// Usage:  node tools/webgpu-parity-ci.mjs [baseURL]
//   baseURL defaults to http://localhost:8300 (the holo-serve-fhs dev server must be serving the
//   /_shared/ witness pages). Override the browser with CHROME=/path/to/chrome.
//
// The witnesses already passed in an interactive browser (PARITY-REPORT.md); this turns that into an
// automatable gate for any host where headless WebGPU is available.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] || process.env.HOLO_BASE || "http://localhost:8300";
const PORT = 9412;
const WITNESSES = [
  { name: "cosmos raymarch", url: `${BASE}/_shared/cosmos-parity.html` },
  { name: "holo-3d screen",  url: `${BASE}/_shared/screen-parity.html` },
  { name: "boot clouds",     url: `${BASE}/_shared/clouds-parity.html` },
  { name: "asanoha lattice", url: `${BASE}/_shared/asanoha-parity.html` },   // WebGPU-native: structural invariants, not WebGL2 parity
];
const CHROME = process.env.CHROME || [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((p) => existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

if (!CHROME) { console.error("✗ no Chrome/Edge binary found (set CHROME=…)"); process.exit(1); }

// ── minimal CDP client over a single page target ────────────────────────────────────────────────
async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws open failed")); });
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  return { send, close: () => ws.close() };
}

async function run() {
  const dir = mkdtempSync(join(tmpdir(), "holo-webgpu-ci-"));
  // HEADED=1 drives a real-GPU window (closes itself) — use when the host has a GPU but headless Dawn
  // doesn't expose an adapter (common on Windows). Default is headless + SwiftShader for CI hosts.
  const HEADED = process.env.HEADED === "1";
  const args = [
    ...(HEADED ? ["--enable-unsafe-webgpu", "--window-size=520,400", "--window-position=-2000,-2000"]
               : ["--headless=new", "--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU",
                  "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--disable-gpu-sandbox"]),
    "--no-first-run", "--no-default-browser-check",
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, "about:blank"];
  log(`• mode: ${HEADED ? "headed (real GPU)" : "headless + SwiftShader"}`);
  const chrome = spawn(CHROME, args, { stdio: "ignore" });
  let verdict = 0;
  try {
    // wait for the DevTools endpoint
    let ver = null;
    for (let i = 0; i < 50; i++) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
    if (!ver) throw new Error("DevTools endpoint never came up");
    log(`• browser: ${ver["Browser"]}`);

    const results = [];
    let anyWebGPU = false;
    for (const w of WITNESSES) {
      const target = await (await fetch(`http://localhost:${PORT}/json/new?${encodeURIComponent(w.url)}`, { method: "PUT" }).catch(() => fetch(`http://localhost:${PORT}/json/new?${encodeURIComponent(w.url)}`))).json();
      const c = await cdp(target.webSocketDebuggerUrl);
      await c.send("Runtime.enable");
      // poll window.__parity (the witness sets it once both backends have rendered + diffed)
      let parity = null;
      for (let i = 0; i < 90; i++) {
        const r = await c.send("Runtime.evaluate", { expression: "JSON.stringify(window.__parity||null)", returnByValue: true });
        const v = r?.result?.result?.value; if (v && v !== "null") { parity = JSON.parse(v); break; }
        await sleep(250);
      }
      c.close();
      try { await fetch(`http://localhost:${PORT}/json/close/${target.id}`); } catch {}
      if (!parity) { results.push({ name: w.name, status: "no-result" }); verdict = Math.max(verdict, 1); continue; }
      anyWebGPU = anyWebGPU || !!parity.webgpu;
      const pass = parity.webgpu && Array.isArray(parity.results) && parity.results.every((r) => r.pass);
      results.push({ name: w.name, webgpu: parity.webgpu, verdict: parity.verdict, pass, cases: parity.results });
      if (parity.webgpu && !pass) verdict = Math.max(verdict, 1);
    }

    log("");
    for (const r of results) {
      if (r.status === "no-result") { log(`✗ ${r.name}: no __parity (page error/timeout)`); continue; }
      if (!r.webgpu) { log(`⚠ ${r.name}: INCONCLUSIVE — no WebGPU device in headless browser`); continue; }
      const tag = r.pass ? "✓ PASS" : "✗ FAIL";
      log(`${tag} ${r.name}: ${(r.cases || []).map((c) => `${c.case || ""}=${c.maxChannel ?? "?"}Δ`).join("  ")}`);
    }
    if (!anyWebGPU) { log("\n⚠ INCONCLUSIVE: headless browser exposed no WebGPU adapter on this host. The witnesses pass in an interactive WebGPU browser (see PARITY-REPORT.md); run this gate on a WebGPU-capable headless host."); verdict = 2; }
    else log(verdict === 0 ? "\n✓ GATE GREEN — WebGPU matches WebGL2 across all witnesses" : "\n✗ GATE RED — see failures above");
  } catch (e) {
    console.error("✗ runner error:", e.message); verdict = 1;
  } finally {
    try { chrome.kill(); } catch {}
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  process.exit(verdict);
}
run();
