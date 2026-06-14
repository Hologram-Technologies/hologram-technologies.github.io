#!/usr/bin/env node
// holo-kstore-witness.mjs — PROVE the operational κ-store in a real browser: an object/app resolves by
// its κ through memory → OPFS → the κ-route, VERIFIED by re-derivation (Law L5, tamper refused), and the
// 2nd-and-later open is the SUB-MILLISECOND in-memory rebind. Measures cold vs warm on a real app.
//   node tools/holo-kstore-witness.mjs
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
      const ks = await import("/_shared/holo-kstore.js");
      const closure = (await (await fetch("/etc/os-closure.json")).json()).closure;
      const e = closure["shell.html"]; const k = (e.alsoKnownAs || []).find((x) => /blake3/.test(x));
      let t = performance.now(); const b1 = await ks.resolve(k); const cold = performance.now() - t;
      let N = 20000; t = performance.now(); for (let i = 0; i < N; i++) await ks.resolve(k); const warm = (performance.now() - t) / N;
      let refused = false; try { await ks.resolve("did:holo:blake3:" + "0".repeat(64)); } catch { refused = true; }
      const lock = await (await fetch("/apps/files/holospace.lock.json")).json();
      let t2 = performance.now(); const r1 = await ks.rebind(lock); const coldOpen = performance.now() - t2;
      t2 = performance.now(); const r2 = await ks.rebind(lock); const warmOpen = performance.now() - t2;
      // the CACHE-RESIDENT hot path: κ→view lookup (sync, fast-path by hex) + resident contiguous byte access
      const hex = k.split(":").pop(); const NN = 2e6;
      t = performance.now(); for (let i = 0; i < NN; i++) ks.resolveSync(hex); const lookupNs = (performance.now() - t) / NN * 1e6;
      const v = ks.resolveSync(hex); let acc = 0;
      t = performance.now(); for (let i = 0; i < NN; i++) acc ^= v[i & 8191]; const byteNs = (performance.now() - t) / NN * 1e6;
      return { bytes: b1.length, cold, warm, refused, verified: ks.kstats().verified > 0, coldOpen, warmOpen, objs: r1.objects, warmMem: r2.fromArena, cell: r1.coordinate && r1.coordinate.cell, lookupNs, byteNs, acc: acc & 255 };
    });
    rec("an object resolves by its κ from the κ-route and VERIFIES by re-derivation (Law L5)", m.verified && m.bytes > 0, `${m.bytes} bytes · cold ${m.cold.toFixed(1)} ms`);
    rec("a wrong κ is REFUSED — the origin is one untrusted CDN (Law L5)", m.refused === true);
    rec("the 2nd-and-later resolve is the SUB-MILLISECOND in-memory rebind", m.warm < 1, `warm ${(m.warm * 1000).toFixed(2)} µs (${Math.round(m.cold / m.warm)}× vs cold)`);
    rec("opening a real app the 2nd time rebinds its WHOLE manifest from memory, sub-millisecond", m.warmOpen < 1 && m.warmMem === m.objs, `files (${m.objs} objs, cell ${m.cell}) · cold ${m.coldOpen.toFixed(1)} ms → warm ${m.warmOpen.toFixed(3)} ms`);
    rec("the resident hot path is CACHE-RESIDENT — a κ→view lookup is sub-µs and contiguous-arena byte access is single-digit ns (L1/L2, earned by locality)", m.lookupNs < 300 && m.byteNs < 30, `lookup ${m.lookupNs.toFixed(0)} ns · resident byte ${m.byteNs.toFixed(1)} ns`);
    await browser.close();
  } catch (e) { try { await browser.close(); } catch {} rec("browser run completed", false, String(e && e.message || e)); }
}

close();
const witnessed = failed === 0;
console.log(`\n${witnessed ? "WITNESSED ✓" : "FAILED ✗"} — ${passed}/${passed + failed} · the κ-store: resolve by κ, verify (L5), sub-ms warm rebind`);
writeFileSync(join(here, "holo-kstore-witness.result.json"),
  JSON.stringify({ witnessed, passed, failed, covers: results.filter((r) => r.ok).map((r) => r.name.slice(0, 48)), results,
    spec: "The in-browser content-addressed κ-store (the store IS the memory, Law L3): resolve any object by its κ through memory → OPFS → the κ-route, verified by re-derivation (Law L5); the 2nd-and-later open is the sub-millisecond in-memory rebind" }, null, 2) + "\n");
process.exit(witnessed ? 0 : 1);
