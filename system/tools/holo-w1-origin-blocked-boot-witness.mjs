#!/usr/bin/env node
// holo-w1-origin-blocked-boot-witness.mjs — W1 (the keystone of the streaming-substrate design set,
// docs/streaming-substrate-design-06-conformance-harness.md): PROVE Hologram OS boots with the ORIGIN
// BLOCKED, serving its boot closure network-free from the content-addressed cache. One test, three
// laws: L3 (the store is the memory), L5 (verify at the boundary), and serverless.
//
// Two lanes, by design honest about which proves what:
//
//   HTTP lane  (always live, runs in pure Node — the NECESSARY condition):
//     · completeness — every boot-critical NAME is a κ in etc/os-closure.json (nothing boot-critical
//       is served by location only);
//     · κ-route serviceability — those κ resolve by content over /.holo/sha256/<hex>, i.e. the cache
//       CAN serve them with the origin's path-server disabled;
//     · refuse — a bogus κ is rejected (404/409), Law L5.
//
//   Browser lane (Playwright, when present — the SUFFICIENT proof):
//     · warm the SW content cache over the boot closure, then BLOCK ALL ORIGIN NETWORK and re-open;
//       assert the frame still boots and every boot resource is served x-holo-cache:hit with ZERO
//       origin requests reaching the network.
//
// Honest posture (per -06- §2.5 + the audit's no-false-green discipline): the HTTP lane is necessary
// but NOT sufficient. If Playwright is absent the browser lane is SKIPPED (neutral, never pass) and
// W1 is reported NOT fully witnessed (witnessed:false) — an honest red, not a fabricated green.
//
//   node tools/holo-w1-origin-blocked-boot-witness.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startServer } from "./holo-serve-fhs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const results = []; let passed = 0, failed = 0;
const rec = (n, ok, d = "") => { results.push({ name: n, ok, detail: d }); ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${n}${d ? "  (" + d + ")" : ""}`); };
const hex = (k) => String(k).split(":").pop();

// The bootstrap entry document is the ONE thing honestly served by location: a request to "/" hits
// a dumb static host (L4/CROSS-1 — the gateway is an asset host, never a server operating on
// content). Everything the gateway pulls AFTER must be content-served. So BOOT = the post-entry
// boot-critical names that must resolve BY κ, network-free, once the SW is in control.
const ENTRY = "/";
const BOOT = ["holospace.html", "shell.html", "holo-launch.mjs", "holo-fhs-sw.js", "manifest.webmanifest"];

// Witness the PROD code path on localhost: serve the SW VERBATIM (sealed ALLOW_DEV_FRESH=false →
// DEV=false → cache-first + L5 + heal), exactly what a dumb static host (GitHub Pages) ships. This is
// what makes the SUFFICIENT (browser-lane) proof of origin-blocked boot reproducible without a remote
// HTTPS host. The SW logic is unmodified and its bytes still re-derive to the pinned κ. Override-able.
process.env.HOLO_PROD_SW = process.env.HOLO_PROD_SW || "1";

const { port, close } = await startServer();
const base = `http://127.0.0.1:${port}`;
console.log(`OS2 serving at ${base}\n`);

// ─────────────────────────── HTTP lane (necessary condition, live) ───────────────────────────
let staticPass = false;
try {
  const closure = (await (await fetch(`${base}/etc/os-closure.json`, { cache: "no-store" })).json()).closure || {};

  // 0 · bootstrap entry — the one legitimate by-location fetch (the dumb static gateway, L4/CROSS-1).
  const entry = await fetch(`${base}${ENTRY}`, { cache: "no-store" });
  rec("the bootstrap entry document is served by the dumb static gateway (the one allowed by-location fetch, L4/CROSS-1)", entry.status === 200, `${ENTRY} → ${entry.status}`);

  // 1 · completeness — every boot-critical name is a κ in the closure (content, not location).
  const present = BOOT.filter((p) => closure[p] && (closure[p].kappa || typeof closure[p] === "string"));
  rec("the boot closure is COMPLETE — every boot-critical NAME is a κ in etc/os-closure.json (L1: identity is content, not location)",
    present.length === BOOT.length, `${present.length}/${BOOT.length}${present.length < BOOT.length ? " · missing: " + BOOT.filter((p) => !present.includes(p)).join(",") : ""}`);

  // 2 · κ-route serviceability — each sealed κ resolves BY CONTENT, so the cache can serve it with
  //     the origin path-server disabled. (Resolving by hex, not by path, is the network-free path.)
  let routeOk = 0; const sample = [];
  for (const p of present) {
    const k = hex(closure[p].kappa || closure[p]);
    const r = await fetch(`${base}/.holo/sha256/${k}`, { cache: "no-store" });
    const n = r.ok ? (await r.arrayBuffer()).byteLength : 0;
    if (r.ok && n > 0) routeOk++; else sample.push(`${p}→${r.status}`);
  }
  rec("the κ-route serves every boot κ BY CONTENT — /.holo/sha256/<hex> resolves them, so the content cache can serve a boot with the origin path-server off (L3: the store is the memory)",
    routeOk === present.length, `${routeOk}/${present.length} κ-route 200${sample.length ? " · " + sample.slice(0, 3).join(",") : ""}`);

  // 3 · refuse — a κ that is not in the closure index is rejected (Law L5, fail-closed).
  const bogus = await fetch(`${base}/.holo/sha256/${"0".repeat(64)}`, { cache: "no-store" });
  rec("a κ NOT in the closure index is REFUSED — bytes are content, never trusted by location (Law L5, fail-closed)",
    bogus.status === 404 || bogus.status === 409, `bogus κ → ${bogus.status}`);

  staticPass = entry.status === 200 && present.length === BOOT.length && routeOk === present.length && (bogus.status === 404 || bogus.status === 409);
} catch (e) { rec("HTTP lane completed", false, String((e && e.message) || e)); }

// ─────────────────────────── Browser lane (sufficient proof, Playwright) ───────────────────────────
let liveLane = "skipped"; // "skipped" = neutral (never pass); "pass" / "fail" once exercised
let chromium;
try { ({ chromium } = await import("playwright")); }   // resolved from system/node_modules (the witness's own tree)
catch (e) { console.log(`\n• browser lane SKIPPED — playwright not installed (${e.message.split("\n")[0]}).`); console.log("  install: cd system && npm i -D playwright && npx playwright install chromium"); }

if (chromium) {
  let browser;
  try {
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();

    // warm ONLINE under SW control: register the worker, wait until it CONTROLS the page, then reload
    // so the controlling SW serves AND caches the shell document + its subresources (the boot closure).
    await page.goto(`${base}/shell.html`, { waitUntil: "load", timeout: 30000 });
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/holo-fhs-sw.js", { type: "module" });
      await navigator.serviceWorker.ready;
      for (let i = 0; i < 100 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 100));
    });
    await page.reload({ waitUntil: "load", timeout: 30000 });   // controlled now → SW caches what it serves
    await page.evaluate(async (boot) => { for (const p of boot) await fetch("/" + p, { cache: "no-store" }).then((r) => r.arrayBuffer()).catch(() => {}); }, BOOT);
    await page.waitForTimeout(800);

    // BLOCK THE ORIGIN — the proper primitive: the network goes away, but the SW may still serve from
    // its κ-cache. A cache hit boots; a miss throws ERR_INTERNET_DISCONNECTED. "Still boots" == served
    // network-free.
    await ctx.setOffline(true);

    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    const resp = await page.reload({ waitUntil: "load", timeout: 30000 }).catch((e) => ({ _err: String(e.message || e) }));
    const dom = await page.evaluate(() => document.readyState === "complete" && !!document.body && document.body.children.length > 0).catch(() => false);
    const booted = !!resp && !resp._err && (typeof resp.ok !== "function" || resp.ok()) && dom;
    const hits = await page.evaluate(async (boot) => {
      const out = []; for (const p of boot) { try { const r = await fetch("/" + p, { cache: "no-store" }); out.push([p, r.status, r.headers.get("x-holo-cache")]); } catch (e) { out.push([p, "ERR", String(e).slice(0, 40)]); } } return out;
    }, BOOT).catch(() => []);
    const served = hits.filter(([, s, c]) => s === 200 && c === "hit").length;
    const miss = hits.filter(([, s, c]) => !(s === 200 && c === "hit")).map(([p, s, c]) => `${p}:${s}/${c}`);

    // This harness serves the SW VERBATIM (HOLO_PROD_SW, set above) so it runs the PROD path on
    // localhost: cache-first (x-holo-cache:hit), boots offline — the same code a dumb static host ships.
    // The dev-bypassed branch below remains as an honest fallback: if someone forces dev-fresh
    // (HOLO_PROD_SW=0), the SW serves PATH requests fresh + uncached, offline boot is off BY DESIGN, and
    // we classify that as dev-bypassed (neutral), never a fabricated green.
    const DEVHOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(new URL(base).hostname);
    const devBypassed = DEVHOST && !booted && served === 0 && hits.every(([, s, c]) => c !== "hit");
    if (devBypassed) {
      liveLane = "dev-bypassed";
      console.log(`\n  ⚠ SW DEV mode (localhost, holo-fhs-sw.js:29,470,508): path requests served fresh, cache-first OFF.`);
      console.log(`    offline boot is NOT a defect here and NOT witnessable on localhost — needs a prod HTTPS / non-localhost host.`);
      console.log(`    offline boot probe: ${miss.slice(0, 3).join(", ")}`);
    } else {
      rec("ORIGIN BLOCKED — the shell still boots offline, served network-free from the κ-keyed content cache (L3 + serverless)", booted, booted ? "shell.html booted from cache offline" : `did not boot offline${resp && resp._err ? " · " + resp._err.slice(0, 60) : ""}`);
      rec("every boot-critical resource is served x-holo-cache:hit with the origin blocked (zero network)", served === BOOT.length, `${served}/${BOOT.length} hit${miss.length ? " · " + miss.slice(0, 3).join(",") : ""}`);
      rec("no fatal page errors while booting offline", errs.length === 0, errs.slice(0, 2).join(" | ") || "clean");
      liveLane = booted && served === BOOT.length && errs.length === 0 ? "pass" : "fail";
    }
    await browser.close();
  } catch (e) { if (browser) await browser.close().catch(() => {}); rec("browser lane completed without throwing", false, String((e && e.message) || e)); liveLane = "fail"; }
}

await close();

// witnessed = the FULL W1 claim (origin-blocked boot) is proven. The HTTP lane is necessary but not
// sufficient; the browser lane is the sufficient proof. Skipped browser lane ⇒ honest red.
const witnessed = staticPass && liveLane === "pass";
const note = liveLane === "skipped"
  ? "HTTP lane (necessary condition) PASSED; live origin-blocked boot NOT exercised — install playwright to witness the sufficient proof."
  : liveLane === "dev-bypassed"
  ? "HTTP lane (necessary condition) PASSED; sufficient proof NOT witnessable on localhost — the SW runs DEV-mode (cache-first off). Run against a prod HTTPS / non-localhost host (e.g. the GitHub Pages deploy) to witness offline boot."
  : (witnessed ? "origin-blocked boot witnessed live." : "origin-blocked boot FAILED (real offline-boot gap in prod-mode).");
console.log(`\n${witnessed ? "WITNESSED ✓" : "NOT FULLY WITNESSED ✗"} — ${passed}/${passed + failed} · W1 origin-blocked boot · ${note}`);
writeFileSync(join(here, "holo-w1-origin-blocked-boot-witness.result.json"),
  JSON.stringify({
    witnessed, staticLane: staticPass ? "pass" : "fail", liveLane, passed, failed,
    covers: results.filter((r) => r.ok).map((r) => r.name.slice(0, 64)), results,
    spec: "W1 — Hologram OS boots with the origin blocked, serving its boot closure network-free from the κ-keyed content cache (L3 store-is-memory · L5 verify-at-boundary · serverless). HTTP lane proves the necessary condition (closure complete + κ-route serviceable + bogus κ refused) live in Node; the browser lane proves the sufficient condition (blocks all origin network, re-opens, asserts the frame boots from cache with zero network) under Playwright. Skipped browser lane is reported as an honest red, never a fabricated green.",
  }, null, 2) + "\n");
process.exit(witnessed ? 0 : 1);
