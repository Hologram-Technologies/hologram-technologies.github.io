#!/usr/bin/env node
// holo-engine-parity-witness.mjs — PROVE CC-1/CC-2 (holospaces Quality Requirements): "Browser and native
// engines must yield identical κ from identical input" (CC-2), and κ-labels achieve "byte-for-byte equality
// with the reference σ-axis" (CC-1). The κ engine pair that the deployed stack DEPENDS ON is the Node
// seal-engine (which mints every os-closure / os-served pin) and the browser runtime (which re-derives them
// in the Service Worker, Law L5). If they disagreed by one bit, every Node-sealed pin would be refused in
// the browser. This witness derives the DUAL-AXIS κ — sha256 (serving) ⊕ BLAKE3 (the substrate σ-axis) — in
// REAL Chromium and in Node, over the SAME real OS objects and edge inputs, and asserts they are identical.
//
// CC-1 (reference σ-axis): the JS BLAKE3 (os/usr/lib/holo/holo-blake3.mjs) is pinned byte-for-byte to the
// substrate's reference σ-axis by holo-blake3-witness (20/20 KAT vectors = the Rust kappa() output). This
// witness shows the BROWSER runs that same engine identically to Node — so browser ≡ Node ≡ reference σ-axis.
// (The live Rust-wasm oracle is a third engine, gated on HOLO_SUBSTRATE_PKG; it is a bonus, not required to
// witness CC-1/CC-2, since the KAT vectors ARE the reference.)
//
//   node tools/holo-engine-parity-witness.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { startServer } from "./holo-serve-fhs.mjs";
import { OS_DIR } from "./holo-paths.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const { blake3hex } = await import(pathToFileURL(join(OS_DIR, "usr/lib/holo/holo-blake3.mjs")));

const results = []; let passed = 0, failed = 0;
const rec = (n, ok, d = "") => { results.push({ name: n, ok, detail: d }); ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${n}${d ? "  (" + d + ")" : ""}`); };

let chromium; try { ({ chromium } = await import("playwright")); } catch { console.log("playwright not installed"); process.exit(2); }

// real, stable served OS files (deterministic content) + edge literals
const FILES = ["usr/lib/holo/holo-arch.mjs", "lib/holo-fhs-map.mjs", "usr/lib/holo/holo-blake3.mjs", ".well-known/mcp.json"];
const LITERALS = { "lit:empty": "", "lit:abc": "abc", "lit:unicode": "κ ☃ holospace — dual-axis", "lit:long": "x".repeat(5000) };
const sha256hex = (buf) => createHash("sha256").update(Buffer.from(buf)).digest("hex");

// ── NODE engine (the seal-engine): dual-axis κ for every object ──
const nodeK = {};
for (const rel of FILES) { const b = readFileSync(join(OS_DIR, rel)); nodeK[rel] = { sha: sha256hex(b), blake: blake3hex(new Uint8Array(b)) }; }
for (const [k, s] of Object.entries(LITERALS)) { const b = new TextEncoder().encode(s); nodeK[k] = { sha: sha256hex(b), blake: blake3hex(b) }; }

// ── BROWSER engine: derive the same dual-axis κ in real Chromium (same holo-blake3.mjs + WebCrypto sha256) ──
const { port, close } = await startServer();
const origin = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
let browserK = null, perr = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => perr.push(String(e)));
  await page.goto(`${origin}/shell.html`, { waitUntil: "domcontentloaded", timeout: 40000 });
  browserK = await page.evaluate(async ({ files, literals }) => {
    const { blake3hex } = await import("/usr/lib/holo/holo-blake3.mjs");   // the SAME engine module the SW uses
    const sha = async (buf) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const out = {};
    for (const rel of files) { const buf = await (await fetch("/" + rel, { cache: "no-store" })).arrayBuffer(); out[rel] = { sha: await sha(buf), blake: blake3hex(new Uint8Array(buf)) }; }
    const enc = new TextEncoder();
    for (const [k, s] of Object.entries(literals)) { const b = enc.encode(s); out[k] = { sha: await sha(b), blake: blake3hex(b) }; }
    return out;
  }, { files: FILES, literals: LITERALS });
  await browser.close();
} catch (e) { await browser.close().catch(() => {}); rec("witness completed without throwing", false, String((e && e.message) || e)); }
await close();

if (browserK) {
  rec("the browser engine produced a κ for every object (WebCrypto + the served holo-blake3.mjs ran)", Object.keys(browserK).length === FILES.length + Object.keys(LITERALS).length);
  // CC-2 — browser ≡ Node (native seal-engine), both axes, every object
  let shaBad = 0, blakeBad = 0; const ex = [];
  for (const k of Object.keys(nodeK)) {
    const n = nodeK[k], b = browserK[k] || {};
    if (n.sha !== b.sha) { shaBad++; ex.push(k + " sha"); }
    if (n.blake !== b.blake) { blakeBad++; if (ex.length < 8) ex.push(k + " blake3"); }
  }
  rec("CC-2 · sha256 (serving axis): browser ≡ Node for every object", shaBad === 0, `${Object.keys(nodeK).length - shaBad}/${Object.keys(nodeK).length}`);
  rec("CC-2 · BLAKE3 (substrate σ-axis): browser ≡ Node for every object", blakeBad === 0, `${Object.keys(nodeK).length - blakeBad}/${Object.keys(nodeK).length}`);
  if (ex.length) console.log("   mismatches:", ex);
  // non-vacuous: different inputs yield different κ in the browser (the engine isn't a constant)
  rec("non-vacuous: distinct inputs yield distinct browser κ (engine is real, not a stub)", browserK["lit:empty"].blake !== browserK["lit:abc"].blake && browserK["lit:empty"].sha !== browserK["lit:abc"].sha);
  // CC-1 linkage: the empty-input BLAKE3 equals the published reference σ-axis vector (the Rust kappa() output)
  const B3_EMPTY = "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262";
  rec("CC-1 · the σ-axis matches the reference BLAKE3 KAT (browser ≡ Node ≡ reference)", browserK["lit:empty"].blake === B3_EMPTY && nodeK["lit:empty"].blake === B3_EMPTY, `BLAKE3("") = ${B3_EMPTY.slice(0, 16)}…`);
  rec("no fatal page errors", perr.length === 0, perr.slice(0, 2).join(" | ") || "clean");
}

const witnessed = failed === 0 && passed >= 5;
console.log(`\n${witnessed ? "WITNESSED ✓ — browser and native (Node) engines yield identical dual-axis κ" : "NOT WITNESSED ✗"} · ${passed}/${passed + failed}`);
writeFileSync(join(here, "holo-engine-parity-witness.result.json"), JSON.stringify({
  witnessed, passed, failed, objects: Object.keys(nodeK).length,
  covers: results.filter((x) => x.ok).map((x) => x.name.slice(0, 70)), results,
  spec: "CC-1/CC-2 — in real Chromium and in Node, the dual-axis κ (sha256 serving ⊕ BLAKE3 σ-axis) is byte-for-byte identical over the same real OS objects and edge inputs. The deployment-critical engine pair (Node seal-engine ↔ browser runtime) agrees, so a Node-sealed pin always re-derives in the SW. The σ-axis matches the reference BLAKE3 KAT; browser ≡ Node ≡ reference. The Rust-wasm oracle (a third engine) stays gated on HOLO_SUBSTRATE_PKG and is not required, since the KAT vectors are the reference.",
  authority: "holospaces docs/10-Quality-Requirements CC-1 (byte-for-byte equality with the reference σ-axis) · CC-2 (browser and native engines yield identical κ) · BLAKE3 reference KAT · W3C WebCrypto — tools/holo-engine-parity-witness.mjs; engine os/usr/lib/holo/holo-blake3.mjs; reference holo-blake3-witness.mjs (20/20 KAT)",
}, null, 2) + "\n");
process.exit(witnessed ? 0 : 1);
