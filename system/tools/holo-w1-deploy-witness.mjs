#!/usr/bin/env node
// holo-w1-deploy-witness.mjs — W1 SUFFICIENT proof, against the LIVE deploy (prod mode). The localhost
// harness can only witness the necessary condition (the SW runs DEV/cache-first-off on 127.0.0.1).
// The deployed OS is HTTPS + non-localhost ⇒ holo-fhs-sw.js runs PROD (cache-first) ⇒ the real
// origin-blocked offline boot is witnessable. Flow: full online boot under SW control (caches the boot
// closure) → setOffline(true) → reload → assert the OS still boots and boot-critical virtual paths
// serve x-holo-cache:hit with ZERO network. Proves L3 (store is the memory) · L5 (verify-at-boundary,
// already done online) · serverless — live, not asserted.
//   W1_DEPLOY=https://host/os/ node tools/holo-w1-deploy-witness.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const URL = (process.env.W1_DEPLOY || "https://hologram-technologies.github.io/hologram-os/os/").replace(/\/?$/, "/");
// boot-critical CONTENT the desktop loads (must serve from the κ cache offline). Excluded by design:
// holo-fhs-sw.js (the active worker persists across offline — the browser never re-fetches it to run)
// and etc/manifest.webmanifest (PWA install metadata, not a boot dependency) — both legitimately 502
// offline without blocking the boot.
const BOOT = ["shell.html", "holo-launch.mjs"];
const results = []; let passed = 0, failed = 0;
const rec = (n, ok, d = "") => { results.push({ name: n, ok, detail: d }); ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${n}${d ? "  (" + d + ")" : ""}`); };

let chromium; try { ({ chromium } = await import("playwright")); }
catch { console.log("playwright not installed (cd system && npm i -D playwright && npx playwright install chromium)"); process.exit(2); }

console.log(`W1 deploy target: ${URL}\n`);
const browser = await chromium.launch();
let liveLane = "fail";
try {
  const ctx = await browser.newContext();           // fresh profile ⇒ first visit is genuinely cold
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));

  // ── online boot under SW control (populate the κ cache) ──
  await page.goto(URL, { waitUntil: "load", timeout: 60000 });
  const reg = await page.evaluate(async () => {
    const sleep = (m) => new Promise((r) => setTimeout(r, m));
    if (navigator.serviceWorker && !navigator.serviceWorker.controller) { try { await navigator.serviceWorker.register("./holo-fhs-sw.js", { type: "module" }); } catch {} }
    for (let i = 0; i < 150 && !(navigator.serviceWorker && navigator.serviceWorker.controller); i++) await sleep(100);
    return { secure: isSecureContext, controlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller), host: location.hostname };
  });
  rec("the deployed OS is a secure context and the κ Service Worker takes control (prod runtime)", reg.secure && reg.controlled, `secure:${reg.secure} controlled:${reg.controlled} host:${reg.host}`);

  await page.reload({ waitUntil: "networkidle", timeout: 60000 });   // controlled now → SW serves + caches the boot closure
  await page.waitForTimeout(4000);                                    // let the boot chain settle/cache
  const online = await page.evaluate(() => fetch("shell.html", { cache: "no-store" }).then((r) => ({ s: r.status, c: r.headers.get("x-holo-cache") })).catch((e) => ({ err: String(e).slice(0, 40) })));
  rec("PROD cache-first confirmed — a boot path serves from the κ cache while online (x-holo-cache:hit, not DEV-fresh)", online.c === "hit", `shell.html → ${online.s}/${online.c || online.err}`);

  // ── BLOCK THE ORIGIN ──
  await ctx.setOffline(true);
  const resp = await page.reload({ waitUntil: "load", timeout: 60000 }).catch((e) => ({ _err: String(e.message || e) }));
  const dom = await page.evaluate(() => ({ ready: document.readyState, kids: (document.body && document.body.children.length) || 0 })).catch(() => ({ ready: "err", kids: 0 }));
  const booted = !!resp && !resp._err && (typeof resp.ok !== "function" || resp.ok()) && dom.ready === "complete" && dom.kids > 0;
  rec("ORIGIN BLOCKED — the OS still boots offline from the κ-keyed content cache (L3 + serverless)", booted, booted ? `booted offline · body.children=${dom.kids}` : `did not boot${resp && resp._err ? " · " + resp._err.slice(0, 60) : ` · ready=${dom.ready}`}`);

  const hits = await page.evaluate(async (boot) => {
    const out = []; for (const p of boot) { try { const r = await fetch(p, { cache: "no-store" }); out.push([p, r.status, r.headers.get("x-holo-cache")]); } catch (e) { out.push([p, "ERR", String(e).slice(0, 30)]); } } return out;
  }, BOOT).catch(() => []);
  const served = hits.filter(([, s, c]) => s === 200 && (c === "hit" || c === "kstore")).length;
  const miss = hits.filter(([, s, c]) => !(s === 200 && (c === "hit" || c === "kstore"))).map(([p, s, c]) => `${p}:${s}/${c}`);
  rec("every boot-critical path serves from cache with the origin blocked (zero network)", served === BOOT.length, `${served}/${BOOT.length}${miss.length ? " · " + miss.slice(0, 3).join(",") : ""}`);
  rec("no fatal page errors while booting offline", errs.length === 0, errs.slice(0, 2).join(" | ") || "clean");

  liveLane = booted && served === BOOT.length ? "pass" : "fail";
  await browser.close();
} catch (e) { await browser.close().catch(() => {}); rec("deploy run completed without throwing", false, String((e && e.message) || e)); }

const witnessed = liveLane === "pass";
console.log(`\n${witnessed ? "WITNESSED ✓ — origin-blocked offline boot proven LIVE on the deploy" : "NOT WITNESSED ✗ — offline boot gap on the deploy (real finding)"} · ${passed}/${passed + failed}`);
writeFileSync(join(here, "holo-w1-deploy-witness.result.json"),
  JSON.stringify({ witnessed, target: URL, liveLane, passed, failed, covers: results.filter((r) => r.ok).map((r) => r.name.slice(0, 64)), results,
    spec: "W1 sufficient proof against the live deploy (prod cache-first mode): full online boot under SW control, then origin blocked (setOffline) + reload — the OS must still boot from the κ-keyed content cache with zero network. Proves L3 + serverless live, the strongest re-runnable serverless proof (vs the gate's committed boolean)." }, null, 2) + "\n");
process.exit(witnessed ? 0 : 1);
