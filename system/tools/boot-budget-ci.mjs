#!/usr/bin/env node
// boot-budget-ci.mjs — boot working-set budget gate (lever ⑤ of the instant-desktop pass).
//
// Drives a real Chrome/Edge headless over the DevTools Protocol (zero npm deps — Node 22 globals
// WebSocket + fetch), cold-boots the canonical shell in a FRESH profile (empty cache = worst case),
// and asserts the BOOT working set stays within tools/boot-budget.json:
//   • requests  — network requests started before the load event
//   • transferKB — wire bytes (encodedDataLength) of those requests
//   • domInteractive — ms to interactive (Navigation Timing)
// These are exactly the levers the instant-boot pass moved: lazy verb carriages, off-boot media
// prewarm, the right-sized wallpaper. The gate locks them in so a future eager import / boot-time
// fetch / oversized asset trips CI instead of silently shipping.
//
// It NEVER fakes green:
//   exit 0 = within budget
//   exit 1 = OVER budget (a regression) — prints which metric and by how much
//   exit 2 = INCONCLUSIVE — the shell never reached the desktop here (bounced / no browser / no load)
//
// Usage:  node tools/boot-budget-ci.mjs [baseURL]
//   baseURL defaults to http://localhost:8377 (holo-serve-fhs must be serving the shell).
//   --update  re-baselines: writes the current measurement (× headroom) to boot-budget.json. Review the diff.
//   Override the browser with CHROME=/path/to/chrome ; HEADED=1 uses a real-GPU window.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BUDGET_FILE = join(here, "boot-budget.json");
const BASE = process.argv.find((a) => /^https?:\/\//.test(a)) || process.env.HOLO_BASE || "http://localhost:8377";
const UPDATE = process.argv.includes("--update");
const SHELL_URL = `${BASE}/usr/share/frame/shell.html?desktop=1`;
const PORT = 9414;
const HEADROOM = 1.15;   // re-baseline budgets sit 15% above the measured boot — absorbs run-to-run jitter, still catches real regressions

const CHROME = process.env.CHROME || [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((p) => existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
if (!CHROME) { console.error("⚠ no Chrome/Edge binary found (set CHROME=…) — INCONCLUSIVE"); process.exit(2); }

// ── self-contained: reuse a dev server already serving BASE, else spawn holo-serve-fhs and kill it after ──
async function serverUp(url) { try { return (await fetch(url, { redirect: "manual" })).status > 0; } catch { return false; } }
async function ensureServer() {
  const probe = `${BASE}/usr/share/frame/shell.html`;
  if (await serverUp(probe)) { log("• dev server: reusing the one already serving " + BASE); return { kill: () => {} }; }
  const port = new URL(BASE).port || "8377";
  log(`• dev server: spawning holo-serve-fhs on :${port} (none was running)`);
  const srv = spawn(process.execPath, [join(here, "holo-serve-fhs.mjs"), port], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) { if (await serverUp(probe)) return { kill: () => { try { srv.kill(); } catch {} } }; await sleep(250); }
  try { srv.kill(); } catch {}
  throw new Error(`dev server never came up on ${BASE}`);
}

// ── minimal CDP client: responses keyed by id, plus an event tap ──────────────────────────────────
async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws open failed")); });
  let id = 0; const pending = new Map(); const listeners = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    else if (m.method) for (const l of listeners) l(m.method, m.params);
  };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  return { send, on: (cb) => listeners.push(cb), close: () => ws.close() };
}

function readBudget() {
  try { return JSON.parse(readFileSync(BUDGET_FILE, "utf8")); } catch { return null; }
}

async function run() {
  let server = null;
  try { server = await ensureServer(); }
  catch (e) { console.error("⚠ INCONCLUSIVE:", e.message); process.exit(2); }
  const dir = mkdtempSync(join(tmpdir(), "holo-bootbudget-"));
  const HEADED = process.env.HEADED === "1";
  const args = [
    ...(HEADED ? ["--window-size=1440,900", "--window-position=-2400,-2400"]
               : ["--headless=new", "--disable-gpu", "--enable-unsafe-swiftshader", "--window-size=1440,900"]),
    "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, "about:blank"];
  log(`• boot-budget gate — ${HEADED ? "headed" : "headless"} · ${SHELL_URL}`);
  const chrome = spawn(CHROME, args, { stdio: "ignore" });
  let verdict = 2;
  try {
    let ver = null;
    for (let i = 0; i < 50; i++) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
    if (!ver) throw new Error("DevTools endpoint never came up");
    log(`• browser: ${ver["Browser"]}`);

    const target = await (await fetch(`http://localhost:${PORT}/json/new?about:blank`, { method: "PUT" }).catch(() => fetch(`http://localhost:${PORT}/json/new?about:blank`))).json();
    const c = await cdp(target.webSocketDebuggerUrl);

    const reqs = new Map();   // requestId → { url, startMs, bytes }
    let loadMs = null;
    c.on((method, p) => {
      if (method === "Network.requestWillBeSent") reqs.set(p.requestId, { url: p.request.url, startMs: p.timestamp * 1000, bytes: 0 });
      else if (method === "Network.loadingFinished") { const r = reqs.get(p.requestId); if (r) r.bytes = p.encodedDataLength || 0; }
      else if (method === "Network.responseReceived") { const r = reqs.get(p.requestId); if (r && !r.bytes) r.bytes = (p.response && p.response.encodedDataLength) || 0; }
      else if (method === "Page.loadEventFired") loadMs = p.timestamp * 1000;
    });
    await c.send("Network.enable");
    await c.send("Page.enable");
    await c.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await c.send("Page.navigate", { url: SHELL_URL });

    for (let i = 0; i < 100 && loadMs === null; i++) await sleep(200);   // ≤20s for the load event
    await sleep(1000);   // drain in-flight finishes for the boot window

    // confirm we actually reached the DESKTOP shell (a fresh profile can bounce to home-screen / greeter)
    const nb = await c.send("Runtime.evaluate", { expression: "JSON.stringify({nav:!!document.getElementById('navbar'), url:location.href, w:innerWidth})", returnByValue: true });
    const probe = (() => { try { return JSON.parse(nb.result.value); } catch { return {}; } })();
    const onShell = !!probe.nav;
    const di = await c.send("Runtime.evaluate", { expression: "Math.round((performance.getEntriesByType('navigation')[0]||{}).domInteractive||0)", returnByValue: true });
    const domInteractive = (di && di.result && di.result.value) || 0;
    c.close();

    if (loadMs === null) { log("\n⚠ INCONCLUSIVE: shell never fired `load` here (slow/hung host)."); verdict = 2; return; }
    if (!onShell) { log(`\n⚠ INCONCLUSIVE: landed off the desktop shell (no #navbar). url=${probe.url} innerWidth=${probe.w}`); verdict = 2; return; }

    const boot = [...reqs.values()].filter((r) => r.startMs <= loadMs);
    const requests = boot.length;
    const transferKB = Math.round(boot.reduce((s, r) => s + r.bytes, 0) / 1024);
    const measured = { requests, transferKB, domInteractiveMs: domInteractive };
    log(`\n• measured boot working set (to load event):`);
    log(`    requests        ${requests}`);
    log(`    transferKB      ${transferKB}`);
    log(`    domInteractive  ${domInteractive} ms`);

    if (UPDATE) {
      const budget = {
        _comment: "Boot working-set ceiling for the canonical shell. Regenerated with `node tools/boot-budget-ci.mjs --update` (measured × headroom). Lower is better; raising a ceiling should be a reviewed, intentional change.",
        maxRequests: Math.ceil(requests * HEADROOM),
        maxTransferKB: Math.ceil(transferKB * HEADROOM),
        maxDomInteractiveMs: Math.max(1200, Math.ceil(domInteractive * HEADROOM)),
        baseline: measured,
      };
      writeFileSync(BUDGET_FILE, JSON.stringify(budget, null, 2) + "\n");
      log(`\n✓ re-baselined → ${BUDGET_FILE} (ceilings = measured × ${HEADROOM})`);
      verdict = 0; return;
    }

    const budget = readBudget();
    if (!budget) { log(`\n⚠ INCONCLUSIVE: no budget file. Create it once with: node tools/boot-budget-ci.mjs --update`); verdict = 2; return; }

    const checks = [
      ["requests", requests, budget.maxRequests],
      ["transferKB", transferKB, budget.maxTransferKB],
      ["domInteractiveMs", domInteractive, budget.maxDomInteractiveMs],
    ];
    let over = false;
    log("");
    for (const [name, val, max] of checks) {
      const ok = val <= max;
      if (!ok) over = true;
      log(`${ok ? "✓" : "✗"} ${name.padEnd(16)} ${val} / ${max}${ok ? "" : `  ← OVER by ${val - max}`}`);
    }
    verdict = over ? 1 : 0;
    log(verdict === 0 ? "\n✓ GATE GREEN — boot working set within budget" : "\n✗ GATE RED — boot working set regressed (see ✗ above)");
  } catch (e) {
    console.error("✗ runner error:", e.message); verdict = 2;
  } finally {
    try { chrome.kill(); } catch {}
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
    try { server && server.kill(); } catch {}
  }
  process.exit(verdict);
}
run();
