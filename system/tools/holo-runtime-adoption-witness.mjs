#!/usr/bin/env node
// holo-runtime-adoption-witness.mjs — PROVE two things end-to-end, so a holo app is shareable by ONE
// content-derived link that runs fast in any browser:
//   A · EVERY app (all 34) is content-addressed end-to-end — it has a single root κ (its whole
//       self-describing identity), every closure entry carries a κ, and its bytes RE-DERIVE to that κ
//       (a sampled leaf per app re-hashes to its pin — Law L5). So every app SELF-RESOLVES from its
//       content address: you do not trust a path, you re-derive the bytes.
//   B · a SAMPLE of apps, driven in real Chromium, actually take advantage of the ultra-low-latency
//       Holo Runtime: each is delivered through the ONE content-verify Service Worker (holo-fhs-sw.js),
//       its bytes are L5-verified (its index resolves BY ITS κ on the κ-route; a wrong κ is refused),
//       and the 2nd open is NETWORK-FREE from the κ-keyed content cache (x-holo-cache: hit). No app
//       opts in — the gateway registers the worker at root scope, so every app inherits it.
//   node tools/holo-runtime-adoption-witness.mjs
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { startServer, ORIG } from "./holo-serve-fhs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const APPS = process.env.HOLO_APPS_DIR || join(here, "../../../holo-apps/apps");
const SAMPLE = ["files", "notepad", "btc", "search", "git", "forge"];   // representative sealed apps (wallet was retired — replaced with btc)
const results = []; let passed = 0, failed = 0;
const rec = (n, ok, d = "") => { results.push({ name: n, ok, detail: d }); ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${n}${d ? "  (" + d + ")" : ""}`); };
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// ── PART A · every app is content-addressed end-to-end (structural, all 34) ──
const ids = readdirSync(APPS).filter((d) => existsSync(join(APPS, d, "holospace.lock.json")));
let withRoot = 0, allEntriesKappa = 0, leafRederive = 0, badLeaf = [];
for (const id of ids) {
  let lock; try { lock = JSON.parse(readFileSync(join(APPS, id, "holospace.lock.json"), "utf8")); } catch { badLeaf.push(id + ":lock"); continue; }
  if (/^did:holo:sha256:[0-9a-f]{64}$/.test(String(lock.root || ""))) withRoot++;
  const entries = Object.entries(lock.closure || {});
  if (entries.length && entries.every(([, e]) => /^did:holo:sha256:[0-9a-f]{64}$/.test(String(e.kappa || "")))) allEntriesKappa++;
  // re-derive ONE app-unique leaf (the entry index.html) from disk → it must re-hash to its pin (Law L5)
  const key = `apps/${id}/index.html`; const e = (lock.closure || {})[key]; const abs = join(APPS, id, "index.html");
  if (e && existsSync(abs)) { const got = sha256(readFileSync(abs)); const want = String(e.kappa).split(":").pop(); got === want ? leafRederive++ : badLeaf.push(`${id}:${got.slice(0, 8)}≠${want.slice(0, 8)}`); }
  else badLeaf.push(id + ":noindex");
}
rec("EVERY app has a single content-derived ROOT κ — the whole app collapses to one address you can share", withRoot === ids.length && ids.length > 0, `${withRoot}/${ids.length} apps`);
rec("EVERY closure entry of EVERY app carries its κ — no app byte is trusted by location (Law L1)", allEntriesKappa === ids.length, `${allEntriesKappa}/${ids.length} apps fully κ-pinned`);
rec("a sampled leaf of EVERY app RE-DERIVES to its pinned κ — apps self-resolve from content, not path (Law L5)", leafRederive === ids.length && badLeaf.length === 0, `${leafRederive}/${ids.length} re-derive${badLeaf.length ? " · " + badLeaf.slice(0, 3).join(", ") : ""}`);

// ── PART B · a sample of apps take advantage of the runtime, live in real Chromium ──
const { port, close } = await startServer();
const base = `http://127.0.0.1:${port}`;
console.log(`\nOS2 serving at ${base} — driving ${SAMPLE.length} apps through the runtime SW\n`);
let chromium;
try { const require = createRequire(pathToFileURL(join(ORIG, "package.json"))); ({ chromium } = require("playwright")); }
catch (e) { rec("playwright available", false, "not installed: " + e.message); }

if (chromium) {
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext({ viewport: { width: 1024, height: 768 } })).newPage();
    await page.goto(`${base}/shell.html`, { waitUntil: "load", timeout: 30000 });
    const out = await page.evaluate(async (apps) => {
      const reg = await navigator.serviceWorker.register("/holo-fhs-sw.js", { type: "module" });
      await navigator.serviceWorker.ready;
      for (let i = 0; i < 80 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 100));
      const controlled = !!navigator.serviceWorker.controller;
      const rows = [];
      for (const id of apps) {
        const path = `apps/${id}/index.html`;
        const r1 = await fetch(`/${path}?cb=1`, { cache: "no-store" }); const b1 = (await r1.arrayBuffer()).byteLength; const c1 = r1.headers.get("x-holo-cache");
        const r2 = await fetch(`/${path}?cb=2`, { cache: "no-store" }); const b2 = (await r2.arrayBuffer()).byteLength; const c2 = r2.headers.get("x-holo-cache");
        const lock = await (await fetch(`/apps/${id}/holospace.lock.json`, { cache: "no-store" })).json();
        const hex = String((lock.closure[path] || {}).kappa).split(":").pop();
        const kr = await fetch(`/.holo/sha256/${hex}`, { cache: "no-store" }); const krLen = (await kr.arrayBuffer()).byteLength;
        const bogus = await fetch(`/.holo/sha256/${"0".repeat(64)}`, { cache: "no-store" });
        rows.push({ id, controlled, c1, c2, b1, b2, selfResolve: kr.status === 200 && krLen === b1, refused: bogus.status === 404 || bogus.status === 409, root: String(lock.root || "").slice(0, 22) });
      }
      return rows;
    }, SAMPLE);

    const allControlled = out.every((r) => r.controlled);
    rec("the ONE Holo Runtime Service Worker controls the page — every app is delivered through it (no per-app opt-in)", allControlled, `${out.length} apps`);
    const allCold = out.every((r) => r.c1 === "miss");
    const allWarm = out.every((r) => r.c2 === "hit" && r.b1 === r.b2 && r.b1 > 0);
    rec("each sampled app's 1st open verifies + fills the κ-cache (cache MISS, Law L5)", allCold, out.map((r) => `${r.id}:${r.c1}`).join(" "));
    rec("each sampled app's 2nd open is NETWORK-FREE from the κ-keyed content cache (x-holo-cache: hit) — the runtime advantage", allWarm, out.map((r) => `${r.id}:${r.c2}`).join(" "));
    const allSelf = out.every((r) => r.selfResolve);
    const allRef = out.every((r) => r.refused);
    rec("each sampled app SELF-RESOLVES by its content address — its index returns from the κ-route and the bytes match its κ", allSelf, out.map((r) => `${r.id}:${r.selfResolve ? "✓" : "✗"}`).join(" "));
    rec("a wrong κ is REFUSED for every sampled app — the origin is one untrusted CDN (Law L5)", allRef);
    await browser.close();
  } catch (e) { try { await browser.close(); } catch {} rec("browser run completed", false, String(e && e.message || e)); }
}
await close();

const witnessed = failed === 0 && passed >= 7;
console.log(`\n${witnessed ? "WITNESSED ✓" : "FAILED ✗"} — ${passed}/${passed + failed} · every app is content-addressed + the sample runs on the ultra-low-latency Holo Runtime`);
writeFileSync(join(here, "holo-runtime-adoption-witness.result.json"),
  JSON.stringify({ witnessed, passed, failed, apps: ids.length, sample: SAMPLE,
    covers: results.filter((r) => r.ok).map((r) => r.name.slice(0, 60)), results,
    spec: "Every holo app (all 34) is content-addressed end-to-end — one root κ, every closure entry κ-pinned, leaves re-derive (Law L5) — so it self-resolves from its content address and is shareable by one link. A sample driven in real Chromium proves each is delivered through the ONE content-verify Holo Runtime Service Worker (no per-app opt-in), L5-verified, self-resolving by κ, with a network-free 2nd open from the κ-keyed content cache." }, null, 2) + "\n");
process.exit(witnessed ? 0 : 1);
