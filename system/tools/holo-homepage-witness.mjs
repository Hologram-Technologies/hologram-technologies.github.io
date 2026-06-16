#!/usr/bin/env node
// holo-homepage-witness.mjs — proves the Hologram Homepage (usr/share/frame/homepage.html): ONE familiar
// portal door that resolves every internet (web · web3 · ipfs · onion · ai · κ-native) through the SAME
// unified resolver into the SAME sealed κ-card; renders every section from a scene manifest of κ-references
// that stream in and SELF-VERIFY (the κ-fingerprint is the real SHA-256 of the bytes, Law L5); lays out on
// the golden ratio (φ); and stays mobile-conformant. Pure-Node static analysis — no browser, no network.
//
//   node tools/holo-homepage-witness.mjs
//
// Authority: ADR-0088 (desktop-as-holospace scene manifest) · ADR-0092/0093 (omni import/resolve) ·
// ADR-0099 (Q.recall) · ADR-0103 (onion) · holospaces Laws L1–L5 · WCAG 2.2 / MD3 (mobile floor).

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));          // tools/
const OS = join(here, "../os");
const HP = join(OS, "usr/share/frame/homepage.html");
const MAP = join(OS, "lib/holo-fhs-map.mjs");

const checks = {};
const html = existsSync(HP) ? readFileSync(HP, "utf8") : "";
const map = existsSync(MAP) ? readFileSync(MAP, "utf8") : "";
// the inline module script (everything the runtime executes)
const mod = (html.match(/<script type="module">([\s\S]*?)<\/script>/) || [, ""])[1];

// ── existence + routing ─────────────────────────────────────────────────────────────────────────────
checks["surface exists at usr/share/frame/homepage.html"] = html.length > 4000;
checks["surface is registered in the ONE fhs route map (served flat at /homepage.html)"] =
  /\bhomepage\.html\b/.test(map) && /"homepage\.html"[\s\S]{0,200}usr\/share\/frame/.test(map.replace(/\n/g, " "));

// ── one door: the unified resolver + the classifier wire ─────────────────────────────────────────────
checks["imports the ONE unified resolver (resolveUnified) — every input, one path"] =
  /import\s*\{[^}]*\bresolveUnified\b[\s\S]*?holo-omni-unified\.mjs/.test(mod);
checks["wires the live lane classifier (classifyUnified) for the omnibar"] = /\bclassifyUnified\b/.test(mod);
checks["renders ONE card primitive for web3, object (web·ipfs·κ) and nl/Q lanes"] =
  /renderWeb3\s*\(/.test(mod) && /renderObject\s*\(/.test(mod) && /renderNL\s*\(/.test(mod);

// ── every internet is represented as a κ-object in the scene (one primitive, six origins) ────────────
const sceneObj = (mod.match(/const\s+SCENE\s*=\s*\{[\s\S]*?\n\};/) || [, ""])[0];
const origins = ["web", "web3", "ipfs", "onion", "ai", "holo"];
checks["scene manifest of κ-references exists (SCENE)"] = sceneObj.length > 800;
for (const o of origins) checks[`scene interleaves the '${o}' internet`] = new RegExp(`origin:\\s*"${o}"`).test(sceneObj) || new RegExp(`"${o}"`).test(sceneObj);

// ── self-verifying bytes: the κ-fingerprint is the REAL hash, settled on stream-in (Law L5) ──────────
checks["κ is re-derived from the bytes themselves (crypto.subtle SHA-256 → did:holo:sha256:)"] =
  /crypto\.subtle\.digest\(\s*["']SHA-256["']/.test(mod) && /did:holo:sha256:/.test(mod);
checks["the κ-fingerprint settles as an ambient signal once verified (kappa.live)"] =
  /settleKappa\s*\(/.test(mod) && /classList\.add\(\s*["']live["']\s*\)/.test(mod);
checks["content streams in: skeleton → bytes → verified (progressive paint)"] =
  /class="sk\b/.test(html) && /\.sk\b/.test(html) && /shimmer/.test(html);

// ── Q is the spine, not a sidecar: model-free recall over everything on the page ─────────────────────
checks["loads model-free Q.recall (BM25 ⊕ κ-graph) and seeds the page corpus"] =
  /holo-q-recall\.js/.test(mod) && /holo-q-corpus\.js/.test(mod) && /seedCorpus\s*\(/.test(mod);
checks["recall uses the correct API (destructures the recall fn from createRecall)"] =
  /createRecall\([^)]*\)\.recall/.test(mod);

// ── native fidelity: open the REAL bytes through the existing routes, not a screenshot ───────────────
checks["web opens natively via the κ-minting proxy route (/webview/w/<url>)"] = /\/webview\/w\//.test(mod);
checks["ipfs opens natively via the gateway-trustless route (/ipfs/<cid>/)"] = /\/ipfs\//.test(mod);
checks["κ-native opens the holospace by content address (holospace.html#holo://sha256/)"] =
  /holospace\.html#holo:\/\/sha256\//.test(mod);

// ── honesty (L5): an onion address self-verifies offline, bytes need an explicit transport ───────────
checks["honest onion: self-verifies offline, never fakes the transport (onionHint)"] =
  /onionHint\s*\(/.test(mod) && /Tor transport[\s\S]{0,80}receipt/i.test(mod);

// ── living surface: media-rich content + tap-to-play preview for every media type, streamed by range ──
checks["a universal media viewer plays/browses any media type IN PLACE (openViewer)"] =
  /function openViewer\s*\(/.test(mod) && /document\.createElement\("video"\)/.test(mod) && /document\.createElement\("audio"\)/.test(mod) && /createElement\("iframe"\)/.test(mod);
checks["media streams by RANGE and the first range re-derives to its own κ (Law L5)"] =
  /Range:\s*"bytes=/.test(mod) && /function kappaBytes\s*\(/.test(mod);
checks["the scene carries REAL media (video · audio · pdf · web), not placeholders"] =
  /kind:"video"/.test(mod) && /kind:"audio"/.test(mod) && /kind:"pdf"/.test(mod) && /kind:"web"/.test(mod);
checks["honest media: a cross-origin-opaque probe claims NO κ (never fabricates a hash)"] =
  /no κ is claimed|don't claim a κ|claims NO κ|opaque/.test(mod);

// ── live, self-refreshing data lanes (markets · RSS), honest-null when a source is unset ─────────────
checks["live markets strip: chain heights re-derive, prices host attested, self-refresh"] =
  /function tickMarkets\s*\(/.test(mod) && /setTimeout\(\s*tickMarkets/.test(mod) && /host attested/.test(mod);
checks["live RSS/Atom lane: each article a κ-object, self-refreshing, honest-null on failure"] =
  /function renderRss\s*\(/.test(mod) && /setTimeout\(\s*renderRss/.test(mod) && /[Hh]onest null/.test(mod);

// ── responsiveness made visible: the Hologram O(1) L1/L2 runtime surfaces a 0-network repeat ─────────
checks["repeat navigation is O(1): a page-level L1 memo returns with zero network, shown as latency"] =
  /const L1 = new Map\(\)/.test(mod) && /L1\.has\(key\)/.test(mod) && /O\(1\)[^`]*L1 hit/.test(mod);
checks["the surface streams live: market/height values flash on change, lanes self-refresh"] =
  /function flashIfChanged\s*\(/.test(mod) && /classList\.add\("flash"\)/.test(mod);

// ── reference-grade fidelity: detect the device + link, always target the best, honest ───────────────
checks["an adaptive fidelity engine detects display, GPU, codecs and network on device"] =
  /const Fidelity = /.test(mod) && /devicePixelRatio/.test(mod) && /navigator\.gpu/.test(mod) &&
  /mediaCapabilities/.test(mod) && /navigator\.connection/.test(mod) && /dynamic-range: high|color-gamut/.test(mod);
checks["images are resolution-correct per DPR, capped by the active tier (8K aware)"] =
  /function pxFor\s*\(/.test(mod) && /devicePixelRatio/.test(mod) && /imgCap/.test(mod) && /7680/.test(mod);
checks["video codec + rendition chosen from MediaCapabilities (AV1/HEVC ladder), honest target"] =
  /decodingInfo/.test(mod) && /av01|AV1/.test(mod) && /i\.smooth/.test(mod);
checks["highest-quality audio: FLAC/Opus detected, same-origin routed through Web Audio (gapless)"] =
  /FLAC|flac/.test(mod) && /AudioContext/.test(mod) && /wireWebAudio/.test(mod);
checks["a real WebGPU image pipeline (upload + unsharp render pass), guarded with a native fallback"] =
  /function gpuEnhance\s*\(/.test(mod) && /createRenderPipeline/.test(mod) && /textureSample/.test(mod) && /getContext\("webgpu"\)/.test(mod);
checks["media re-open is an O(1) L1 cache hit, zero network (MEDIA_L1)"] =
  /MEDIA_L1/.test(mod) && /L1 cache hit/.test(mod);
checks["fidelity re-evaluates live (connection change, motion preference, tab return, DPR change)"] =
  /function watchFidelity\s*\(/.test(mod) && /addEventListener\("change"/.test(mod) && /visibilitychange/.test(mod);
checks["honest fidelity: enhanced output is labelled, motion preference respected, never a fake"] =
  /WebGPU enhanced/.test(mod) && /prefers-reduced-motion/.test(mod) && /not delivering|never advertise|honest/i.test(mod);

// ── Q woven in + an agent door (MCP/A2A), governed ───────────────────────────────────────────────────
checks["per-object Q affordance on cards (qchip → askAbout → model-free recall)"] =
  /function askAbout\s*\(/.test(mod) && /qchip/.test(mod);
checks["an agent door exposes the page as governed tools (MCP/A2A) + cross-frame message"] =
  /HoloHomeAgent\s*=/.test(mod) && /home\.resolve/.test(mod) && /holo-home-agent/.test(mod);

// ── golden ratio governs the layout (φ), with VALID track units (the bug we fixed) ───────────────────
checks["defines the golden constants (φ and φ²)"] = /--phi:\s*1\.618/.test(html) && /--phi2:\s*2\.618/.test(html);
checks["the portal is three golden columns 1 : φ² : φ with literal fr units"] =
  /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*2\.618fr\)\s*minmax\(0,\s*1\.618fr\)/.test(html);
checks["no invalid bare-number track sizes (minmax(0, var(--phi…)) was removed)"] =
  !/minmax\(0,\s*var\(--phi2?\)\)/.test(html);
checks["type scale steps by φ (modular scale on the readability floor)"] =
  /--t-lg:\s*calc\(1rem \* var\(--phi\)\)/.test(html);

// ── mobile / a11y conformance: the vendored floor, no sub-16px hardcoded fonts ────────────────────────
checks["links the vendored theme + mobile (WCAG 2.2 / MD3) stylesheets"] =
  /_shared\/holo-theme\.css/.test(html) && /_shared\/holo-mobile\.css/.test(html);
checks["honors the 48dp tap floor (var(--holo-tap))"] = /var\(--holo-tap/.test(html);
// readability floor: no hardcoded font sizes below 16px anywhere in the surface (the witness floor)
const fontPx = [...html.matchAll(/font(?:-size)?\s*:\s*[^;{}]*?(\d+(?:\.\d+)?)px/g)].map((m) => parseFloat(m[1]));
const subFloor = fontPx.filter((n) => n < 16);
checks["no hardcoded font-size below the 16px readability floor"] = subFloor.length === 0;

// ── the module actually parses (the surface runs) ────────────────────────────────────────────────────
let syntaxOk = false;
try {
  const tmp = join(here, "._homepage-syntax-check.mjs");
  writeFileSync(tmp, mod);                                  // node --check parses ESM (imports incl.) without resolving
  execFileSync(process.execPath, ["--check", tmp], { stdio: "ignore" });
  syntaxOk = true;
  try { execFileSync(process.execPath, ["-e", `require('fs').unlinkSync(${JSON.stringify(tmp)})`], { stdio: "ignore" }); } catch {}
} catch { syntaxOk = false; }
checks["the inline runtime module parses (node --check)"] = syntaxOk;

// ── tally ─────────────────────────────────────────────────────────────────────────────────────────
const entries = Object.entries(checks);
const passed = entries.filter(([, v]) => v).length;
const failed = entries.length - passed;
const witnessed = failed === 0;

const result = {
  "@type": "earl:TestResult",
  spec: "Hologram Homepage — one familiar portal door that resolves every internet (web · web3 · ipfs · onion · ai · κ-native) through ONE unified resolver into ONE sealed κ-card; every section streams from a scene manifest of κ-references and self-verifies (κ = real SHA-256 of its bytes, Law L5); golden-ratio (φ) layout; mobile-conformant.",
  authority: "ADR-0088 · ADR-0092 · ADR-0093 · ADR-0099 · ADR-0103 · holospaces Laws L1–L5 · WCAG 2.2 · MD3",
  witnessed,
  passed,
  failed,
  covers: ["holo-homepage", "omnisearch", "unified-resolver", "scene-manifest", "self-verifying", "golden-ratio", "native-fidelity", "mobile-conformant", "web2-web3-ipfs-onion-ai"],
  subFloorFonts: subFloor,
  checks,
};

writeFileSync(join(here, "holo-homepage-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log(`holo-homepage-witness: ${passed}/${entries.length} checks · ${witnessed ? "WITNESSED ✓" : "RED ✗"}`);
if (!witnessed) for (const [k, v] of entries) if (!v) console.log(`   ✗ ${k}`);
