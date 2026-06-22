#!/usr/bin/env node
// holo-cold-machine.mjs — the ONE readiness gate: boot Hologram OS exactly as a cold stranger does and
// prove every surface it advertises actually opens. The two outages (Safety-Stop, empty Play) were both
// the same asymmetry: the dev server is more capable than a new user's machine, and nothing tested the
// user's side. This rig removes that blind spot — it stages the deploy bytes, serves them from a DUMB
// static host (serve-pages.mjs --site, real 404s, no re-derivation), and runs the cold witnesses against
// it. Same harness used locally and in CI, so a green gate means "a fresh visitor can open the OS."
//
// It is BOTH a library (imported by the per-dimension witnesses) and an orchestrator (run directly):
//   exports: stageSite(), serveArtifact(dir, port), withColdPage({engine, base, caps}, fn), assertNoHostError(page)
//   run:     node tools/holo-cold-machine.mjs [--live <url>] [--no-stage] [--site _site] [--with-browser]
//            [--engines chromium,webkit,firefox] [--prefix /hologram-os]
//   --live <url>  skip staging/serving and gate a real deployed URL (sealed bytes).
//   default       stage _site → serve it static → run cold-boot + cold-app witnesses → aggregate, exit 1 on any fail.
import { spawn, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const SYSTEM = resolve(here, "..");
const flag = (k, d = null) => { const i = process.argv.indexOf(k); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : (process.argv.includes(k) ? true : d); };

// ── library ──────────────────────────────────────────────────────────────────────────────────────────
export function stageSite(out) {
  return new Promise((res, rej) => {
    const args = [join(SYSTEM, "tools/holo-stage-site.mjs")];
    if (out) args.push("--out", out);
    const p = spawn("node", args, { stdio: "inherit" });
    p.on("exit", (c) => (c === 0 ? res(out || join(process.cwd(), "_site")) : rej(new Error("stage-site exit " + c))));
  });
}
// Spawn the dumb static host on `port`, serving the assembled artifact. Resolves once it answers.
export async function serveArtifact(dir, port = 8390, prefix = "") {
  const args = [join(SYSTEM, "tools/serve-pages.mjs"), "--site", dir, String(port)];
  if (prefix) args.push("--prefix", prefix);
  const srv = spawn("node", args, { stdio: "ignore" });
  const url = `http://127.0.0.1:${port}${prefix}/`;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(url, { cache: "no-store" }); if (r.ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return { url, close: () => { try { srv.kill(); } catch {} } };
}
// Launch a genuinely cold context (fresh profile) on `engine`, navigate `base`, register the prod SW, wait
// for control, then run fn(page). `caps` strips capabilities to test honest degradation (P3): pass any of
// {webgpu:false, storage:false} to deny them via an init script before the page's own code runs.
export async function withColdPage({ engine = "chromium", base, caps = {} }, fn) {
  const pw = await import("playwright");
  const browser = await pw[engine].launch();
  try {
    const ctx = await browser.newContext();
    if (caps.webgpu === false) await ctx.addInitScript(() => { try { Object.defineProperty(navigator, "gpu", { get: () => undefined }); } catch {} });
    if (caps.storage === false) await ctx.addInitScript(() => { for (const k of ["localStorage", "sessionStorage"]) { try { Object.defineProperty(window, k, { get() { throw new DOMException("denied", "SecurityError"); } }); } catch {} } try { Object.defineProperty(navigator, "storage", { get: () => undefined }); } catch {} });
    const page = await ctx.newPage();
    await page.goto(base, { waitUntil: "load", timeout: 60000 }).catch(() => {});
    // Best-effort register, then poll control from Node tolerating the boot navigation (a single long
    // in-page wait would throw "context destroyed" on a fast boot — a false negative). Register both the
    // os/-scoped worker (sub-path deploys) and the root one; whichever the layout uses takes control.
    await page.evaluate(async () => { try { if (navigator.serviceWorker && !navigator.serviceWorker.controller) { try { await navigator.serviceWorker.register("./os/holo-fhs-sw.js", { type: "module", scope: "./os/" }); } catch {} try { await navigator.serviceWorker.register("./holo-fhs-sw.js", { type: "module" }); } catch {} } } catch {} }).catch(() => {});
    for (let i = 0; i < 200; i++) { if (await page.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller)).catch(() => false)) break; await page.waitForTimeout(100).catch(() => {}); }
    return await fn(page, ctx);
  } finally { await browser.close(); }
}
// A surface must NEVER strand a user on a raw host error / white frame / dead spinner. Returns "" if OK,
// else a short reason. (The boot Safety-Stop is a CALM in-OS 409 page — that is allowed; a raw host 404 is not.)
export async function assertNoHostError(page) {
  return await page.evaluate(() => {
    const t = (document.title || "").toLowerCase();
    const body = (document.body && document.body.innerText || "").toLowerCase();
    if (/file not found|404|there isn.t a github pages site|site configured at this address/.test(body) && /github/.test(body)) return "raw GitHub 404 page";
    const root = document.querySelector("#world, #desktop, main, [data-holo-mount], .mount") || document.body;
    const text = (root && root.innerText || "").trim();
    const stillBusy = !!document.querySelector("[aria-busy='true'], .spinner:not([hidden]), .loading:not([hidden])");
    if (!text && stillBusy) return "empty surface with an unresolved spinner";
    if (!text && (!root || root.children.length === 0)) return "blank surface (no content rendered)";
    return "";
  }).catch((e) => "evaluate failed: " + e.message);
}

// ── orchestrator ─────────────────────────────────────────────────────────────────────────────────────
// Probe whether an engine can actually launch HERE. Some environments can't spawn a given browser (e.g.
// Playwright Firefox under git-bash on Windows → "spawn UNKNOWN"); that's an environment limit, not an OS
// bug, so locally we SKIP it with a clear note. In CI (CI=1) we never skip — the witnesses themselves FAIL
// on a launch error, so a genuinely broken engine still reddens the deploy.
async function launchable(engine) {
  try { const pw = await import("playwright"); const b = await pw[engine].launch(); await b.close(); return true; }
  catch (e) { console.log(`  ⚠ ${engine} not launchable in this environment (${String(e.message).split("\n")[0]}) — skipped locally; CI runs it`); return false; }
}
function runWitness(file, env) {
  return new Promise((res) => {
    const p = execFile("node", [join(SYSTEM, "tools", file)], { env: { ...process.env, ...env }, maxBuffer: 1 << 24 }, () => {});
    let out = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
    p.on("exit", (code) => { const tail = out.trim().split("\n").slice(-3).join("\n"); console.log(`  ↳ ${file}: ${code === 0 ? "PASS" : "FAIL"}\n${tail.replace(/^/gm, "      ")}`); res(code === 0); });
  });
}

async function main() {
  const live = flag("--live");
  const withBrowser = flag("--with-browser") ? "1" : "";
  const engines = (typeof flag("--engines") === "string" ? flag("--engines") : "chromium").split(",").map((s) => s.trim()).filter(Boolean);
  const prefix = typeof flag("--prefix") === "string" ? flag("--prefix") : "";
  let base, server = null;

  if (live && typeof live === "string") {
    base = live.replace(/\/?$/, "/");
    console.log(`cold-machine → LIVE ${base}\n`);
  } else {
    const site = typeof flag("--site") === "string" ? resolve(flag("--site")) : join(SYSTEM, "_site");
    if (!flag("--no-stage")) { console.log("cold-machine → staging _site …\n"); await stageSite(site); }
    else if (!existsSync(site)) { console.error("no _site to serve — run without --no-stage, or `npm run stage`"); process.exit(2); }
    server = await serveArtifact(site, 8390, prefix);
    base = server.url;
    console.log(`cold-machine → static artifact ${base}\n`);
  }

  let ok = true;
  // Deterministic FS gate FIRST when we assembled the artifact: the exhaustive code-closure check (every
  // code byte every app declares is on disk) runs with no browser, so it's the fastest, strongest signal.
  if (server) {
    const site = typeof flag("--site") === "string" ? resolve(flag("--site")) : join(SYSTEM, "_site");
    ok = (await runWitness("holo-cold-app-witness.mjs", { HOLO_OS_DIR: join(site, "os") })) && ok;
  }
  // Cross-engine matrix (P4): the OS must boot on Chromium, WebKit AND Firefox. Locally, skip an engine that
  // can't spawn here (env limit, not an OS bug); in CI run all (a launch failure there is a real red).
  let runEngines = engines;
  if (engines.length > 1 || withBrowser) {
    const usable = [];
    for (const e of engines) { if (process.env.CI || await launchable(e)) usable.push(e); }
    runEngines = usable.length ? usable : engines;
  }
  // The cold witnesses take a deploy URL and (with WITH_BROWSER) drive a real worker. Engine is exported to
  // them via PW_ENGINE so the cross-engine matrix (P4) reuses the same checks across chromium/webkit/firefox.
  for (const engine of runEngines) {
    console.log(`\n── engine: ${engine} ──`);
    const env = { HOLO_DEPLOY: base, WITH_BROWSER: withBrowser, PW_ENGINE: engine };
    ok = (await runWitness("holo-cold-boot-witness.mjs", env)) && ok;
    ok = (await runWitness("holo-cold-app-witness.mjs", env)) && ok;
  }

  // P7 · subpath parity: GitHub project sites serve under /<repo>/. Re-serve the SAME artifact under a
  // sub-path and assert it still boots (the SW re-roots when BASE !== "/"). The loop above covered root; a
  // live project deploy already exercises the real subpath. One engine is enough — re-rooting is engine-blind.
  if (server) {
    const site = typeof flag("--site") === "string" ? resolve(flag("--site")) : join(SYSTEM, "_site");
    const sub = await serveArtifact(site, 8391, "/hologram-os");
    console.log(`\n── subpath parity: ${sub.url} ──`);
    ok = (await runWitness("holo-cold-boot-witness.mjs", { HOLO_DEPLOY: sub.url, WITH_BROWSER: withBrowser, PW_ENGINE: runEngines[0] || "chromium" })) && ok;
    sub.close();
  }

  if (server) server.close();
  console.log(`\n${ok ? "PASS" : "FAIL"} — cold-machine ${ok ? "green: a cold visitor can open the OS" : "RED: a fresh visitor would hit a broken surface"}`);
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && process.argv[1].endsWith("holo-cold-machine.mjs")) main().catch((e) => { console.error(e); process.exit(1); });
