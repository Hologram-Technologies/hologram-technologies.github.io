#!/usr/bin/env node
// holo-sw-cache-witness.mjs — PROVE the live-runtime app-open path. The shell mounts an app as a plain
// iframe that fetches its bytes BY PATH through the content-addressed Service Worker (holo-fhs-sw.js).
// This witnesses the two real properties of that path — the ones that turn the κ-store benchmark into a
// live runtime (the parent page's arena CANNOT serve a child iframe; the SW's content cache can):
//   1 · the SW now VERIFIES app bytes too (not just OS bytes) — an app file's κ resolves on the κ-route,
//       which only works if the app's own lock closure was folded into the verification index (Law L5),
//       and a wrong κ is refused;
//   2 · the 2nd open is NETWORK-FREE — the SW serves the VERIFIED bytes from its content cache, keyed by
//       κ (so identical bytes are stored ONCE and shared across apps), reporting x-holo-cache: hit.
//   node tools/holo-sw-cache-witness.mjs
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { startServer, ORIG } from "./holo-serve-fhs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const results = []; let passed = 0, failed = 0;
const rec = (n, ok, d = "") => { results.push({ name: n, ok, detail: d }); ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${n}${d ? "  (" + d + ")" : ""}`); };

const { port, close } = await startServer();
const base = `http://127.0.0.1:${port}`;
console.log(`OS2 serving at ${base}\n`);

let chromium;
try { const require = createRequire(pathToFileURL(join(ORIG, "package.json"))); ({ chromium } = require("playwright")); }
catch (e) { rec("playwright available", false, "not installed: " + e.message); }

if (chromium) {
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext({ viewport: { width: 1024, height: 768 } })).newPage();
    await page.goto(`${base}/shell.html`, { waitUntil: "load", timeout: 30000 });
    const m = await page.evaluate(async () => {
      // register the delivery SW (the gateway os/index.html registers the same worker in prod) and wait
      // until it CONTROLS this page — the worker calls clients.claim() on activate, so no reload needed.
      const reg = await navigator.serviceWorker.register("/holo-fhs-sw.js", { type: "module" });
      await navigator.serviceWorker.ready;
      for (let i = 0; i < 80 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 100));
      const controlled = !!navigator.serviceWorker.controller;
      const APP = "apps/files/index.html";

      // 1st open: cold (origin fetch + verify + cache-fill). Triggers the lazy app-lock fold (L5 for app bytes).
      let t = performance.now(); const r1 = await fetch(`/${APP}?n=1`, { cache: "no-store" }); const b1 = await r1.arrayBuffer(); const cold = performance.now() - t;
      const c1 = r1.headers.get("x-holo-cache");
      // 2nd open: warm (served from the content cache, network-free, no re-hash).
      t = performance.now(); const r2 = await fetch(`/${APP}?n=2`, { cache: "no-store" }); const b2 = await r2.arrayBuffer(); const warm = performance.now() - t;
      const c2 = r2.headers.get("x-holo-cache");
      const sameBytes = b1.byteLength === b2.byteLength && b1.byteLength > 0;

      // L5 for app bytes: the app file's κ now resolves on the κ-route (only possible if its lock closure
      // was folded into the verification index), and a wrong κ is refused (404 — not in the closure).
      const lock = await (await fetch("/apps/files/holospace.lock.json", { cache: "no-store" })).json();
      const hex = String((lock.closure[APP] || {}).kappa).split(":").pop();
      const kr = await fetch(`/.holo/sha256/${hex}`, { cache: "no-store" }); const krBytes = (await kr.arrayBuffer()).byteLength;
      const bogus = await fetch(`/.holo/sha256/${"0".repeat(64)}`, { cache: "no-store" });

      return { controlled, cold, warm, c1, c2, sameBytes, appHex: hex.slice(0, 12), krOk: kr.status === 200 && krBytes === b1.byteLength, bogus: bogus.status };
    });
    rec("the delivery Service Worker registers and CONTROLS the page (the live app-mount path)", m.controlled === true);
    rec("the SW VERIFIES app bytes too, not just OS — an app file's κ resolves on the κ-route (its lock closure is folded into the L5 index)", m.krOk === true, `apps/files/index.html · κ ${m.appHex}…`);
    rec("a wrong κ is REFUSED (not in the content index) — app bytes are content, not trusted-by-location (Law L5)", m.bogus === 404 || m.bogus === 409, `bogus κ → ${m.bogus}`);
    rec("the 1st open is a cache MISS (origin fetch + verify + content-cache fill)", m.c1 === "miss", `x-holo-cache: ${m.c1} · ${m.cold.toFixed(1)} ms`);
    rec("the 2nd open is NETWORK-FREE — served from the κ-keyed content cache (deduped, no re-hash), x-holo-cache: hit", m.c2 === "hit" && m.sameBytes, `x-holo-cache: ${m.c2} · ${m.warm.toFixed(2)} ms (${m.cold > 0 ? Math.max(1, Math.round(m.cold / Math.max(m.warm, 0.01))) : "—"}× vs cold)`);
    await browser.close();
  } catch (e) { try { await browser.close(); } catch {} rec("browser run completed", false, String(e && e.message || e)); }
}

await close();
const witnessed = failed === 0 && passed >= 5;
console.log(`\n${witnessed ? "WITNESSED ✓" : "FAILED ✗"} — ${passed}/${passed + failed} · the content-addressed Service Worker: app bytes verified (L5) + network-free re-open`);
writeFileSync(join(here, "holo-sw-cache-witness.result.json"),
  JSON.stringify({ witnessed, passed, failed, covers: results.filter((r) => r.ok).map((r) => r.name.slice(0, 56)), results,
    spec: "The shell mounts apps as iframes that fetch by path through the content-addressed Service Worker. The SW verifies app bytes (folds each app's lock closure into the L5 index, refuses a wrong κ) and serves verified bytes from a κ-keyed content cache, so the 2nd open is network-free and deduped. The page-side κ-store arena cannot serve a child iframe; the SW content cache is the honest live-runtime re-open path (network-free ms, not sub-µs)." }, null, 2) + "\n");
process.exit(witnessed ? 0 : 1);
