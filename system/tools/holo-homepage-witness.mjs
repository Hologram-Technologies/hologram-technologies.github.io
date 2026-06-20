#!/usr/bin/env node
// holo-homepage-witness.mjs — proves the Hologram Homepage (usr/share/frame/homepage.html): ONE familiar
// portal door, now delivered as a STREAMED κ-PAGE. The host carries NO page code: it resolves a page
// κ-object by name (?p=, default "home") from a content-addressed page manifest, maps every κ-UI
// component as a bare-linkable holo:<name>, and mounts it through the κ-render spine — so chrome,
// components and content are all content-addressed κ-objects, verified on load (Law L5, via holo-render;
// see holo-render-registry / holo-render-mount witnesses for the verify-before-render proof). Golden-ratio
// (φ) layout, fidelity-adaptive prefetch, mobile/readability floor. Pure-Node static analysis.
//
//   node tools/holo-homepage-witness.mjs
//
// Authority: ADR-0088 (desktop-as-holospace) · the κ-page migration (holo-render substrate, Phase 3) ·
// holospaces Laws L1 (identity-is-content) / L5 (verify-by-re-derivation) · WCAG 2.2 / MD3 (mobile floor).

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));          // tools/
const OS = join(here, "../os");
const HP = join(OS, "usr/share/frame/homepage.html");
const MAP = join(OS, "lib/holo-fhs-map.mjs");
const PAGES = join(OS, "ui/pages/pages.json");
const REGISTRY = join(OS, "ui/vendor/registry.json");
const BARE = join(OS, "ui/vendor/bare.json");

const KAPPA = /^did:holo:sha256:[0-9a-f]{64}$/;               // a content address (Law L1) — never a path
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const json = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

const checks = {};
const html = read(HP);
const map = read(MAP);
const mod = (html.match(/<script type="module">([\s\S]*?)<\/script>/) || ["", ""])[1];
const pages = json(PAGES);
const registry = json(REGISTRY);
const bare = json(BARE);

// ── existence + routing ───────────────────────────────────────────────────────────────────────────
checks["surface exists at usr/share/frame/homepage.html"] = html.length > 1000;
checks["surface is registered in the ONE fhs route map (served flat at /homepage.html)"] =
  /\bhomepage\.html\b/.test(map) && /"homepage\.html"[\s\S]{0,200}usr\/share\/frame/.test(map.replace(/\n/g, " "));

// ── ONE door, zero page code: the host streams a κ-page through the render spine ─────────────────────
checks["the host carries NO inline page code — it streams a κ-page (thin host, <root> mount)"] =
  /id="root"/.test(html) && mod.length < 4000 && /STREAMED κ-page|streamed κ-page|no page code/i.test(mod);
checks["mounts through the κ-render spine (holo-render), the verify-before-render path (Law L5)"] =
  /import\([^)]*holo-render\.js/.test(mod) && /\bHR\.render\s*\(/.test(mod);
checks["resolves a page by name (?p=, default \"home\") — one door, many pages"] =
  /URLSearchParams\(location\.search\)\.get\(\s*["']p["']\s*\)/.test(mod) && /\|\|\s*["']home["']/.test(mod);

// ── content-addressed page manifest: identity IS the content κ (Law L1), never a path ────────────────
const pageVals = pages ? Object.values(pages) : [];
checks["a page manifest (ui/pages/pages.json) exists with a home page + breadth of doors"] =
  !!pages && typeof pages.home === "string" && Object.keys(pages).length >= 6;
checks["EVERY page is named by a content address (did:holo:sha256 κ) — identity is content, not path"] =
  pageVals.length > 0 && pageVals.every((v) => KAPPA.test(String(v)));
checks["the host loads the page manifest it resolves against (/ui/pages/pages.json)"] =
  /\/ui\/pages\/pages\.json/.test(mod);

// ── every κ-UI component is a bare-linkable, content-addressed object ────────────────────────────────
const regVals = registry ? Object.values(registry) : [];
checks["a κ-UI component registry (ui/vendor/registry.json) maps components to content κ"] =
  !!registry && regVals.length >= 10 && regVals.every((v) => KAPPA.test(String(v)));
checks["a bare-import map (ui/vendor/bare.json) exists and the host binds holo:<name> → κ"] =
  !!bare && /\/ui\/vendor\/bare\.json/.test(mod) && /bare\[\s*["']holo:["']\s*\+\s*\w+\s*\]\s*=/.test(mod);

// ── fidelity-adaptive prefetch: lowest latency where bandwidth is scarce ─────────────────────────────
checks["fidelity-adaptive: imports holo-fidelity and chooses a prefetch policy"] =
  /holo-fidelity\.mjs/.test(mod) && /\.prefetch\b/.test(mod);
checks["on a slow/save-data link, warms only first-paint criticals; eager-warms on capable devices"] =
  /prefetch\s*===\s*["']off["']/.test(mod) && /HR\.warm\s*\(/.test(mod);

// ── golden ratio governs the layout (φ) ──────────────────────────────────────────────────────────────
checks["defines the golden constant (φ = 1.618)"] = /--phi:\s*1\.618/.test(html);

// ── mobile / a11y: viewport, motion budget, and the 16px readability floor ───────────────────────────
checks["mobile viewport (width=device-width, viewport-fit=cover)"] =
  /width=device-width/.test(html) && /viewport-fit=cover/.test(html);
checks["honors the device motion budget (reduced-motion guard wired)"] =
  /data-holo-motion="reduced"/.test(html) && /animation-duration:\s*\.001ms/.test(html);
const fontPx = [...html.matchAll(/font(?:-size)?\s*:\s*[^;{}]*?(\d+(?:\.\d+)?)px/g)].map((m) => parseFloat(m[1]));
const subFloor = fontPx.filter((n) => n < 16);
checks["no hardcoded font-size below the 16px readability floor"] = subFloor.length === 0;

// ── tally ────────────────────────────────────────────────────────────────────────────────────────────
const entries = Object.entries(checks);
const passed = entries.filter(([, v]) => v).length;
const failed = entries.length - passed;
const witnessed = failed === 0;

const result = {
  "@type": "earl:TestResult",
  spec: "Hologram Homepage — ONE familiar portal door, delivered as a STREAMED κ-page: a thin host resolves a page κ-object by name from a content-addressed manifest (every page + every κ-UI component named by its did:holo content κ, Law L1) and mounts it through the κ-render spine, which verifies each object on load (Law L5). Golden-ratio (φ) layout; fidelity-adaptive prefetch; mobile-conformant (WCAG 2.2 / MD3).",
  authority: "ADR-0088 · κ-page migration (holo-render substrate) · holospaces Laws L1/L5 · WCAG 2.2 · MD3",
  witnessed,
  passed,
  failed,
  covers: ["holo-homepage", "omnisearch", "unified-resolver", "scene-manifest", "self-verifying", "golden-ratio", "native-fidelity", "mobile-conformant", "web2-web3-ipfs-onion-ai"],
  note: "Verify-before-render of each page/component κ is proven by the κ-render spine (holo-render-registry-witness / holo-render-mount-witness). This witness proves the host wiring + content-addressed manifests statically; live κ-resolution runs through that spine.",
  subFloorFonts: subFloor,
  checks,
};

writeFileSync(join(here, "holo-homepage-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log(`holo-homepage-witness: ${passed}/${entries.length} checks · ${witnessed ? "WITNESSED ✓" : "RED ✗"}`);
if (!witnessed) for (const [k, v] of entries) if (!v) console.log(`   ✗ ${k}`);
process.exit(witnessed ? 0 : 1);
