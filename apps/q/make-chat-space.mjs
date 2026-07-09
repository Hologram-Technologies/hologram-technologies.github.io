// make-chat-space.mjs — assemble a SELF-CONTAINED static Q CHAT bundle for the HF "Q" Space by TRACING the import
// closure from q-chat.html's entry modules on the CANONICAL apps/q engine (warm-KV). Weights κ-stream from
// HOLOGRAMTECH at runtime → the bundle is code+small-assets only. Sibling of make-space.mjs (the q-live voice bundler).
//
//   node make-chat-space.mjs   → ./q-chat-space/ (sibling)   then serve statically; open / → NO 404s, weights from HF.
//
// Served-path model: "/apps/X" → holo-apps/apps/X ; "/_shared/X" → holo-os/system/os/usr/lib/holo/X (see _live-serve).

import { mkdirSync, copyFileSync, rmSync, existsSync, statSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";

const HERE = import.meta.dirname;                                   // …/holo-apps/apps/q
const REPO = join(HERE, "../../..");
const APPS = join(REPO, "holo-apps/apps");
const HOLO = join(REPO, "holo-os/system/os/usr/lib/holo");          // "/_shared/*" root
const OUT = join(APPS, "q-chat-space");

const fsOf = (served) => served.startsWith("/apps/") ? join(APPS, served.slice(6))
  : served.startsWith("/_shared/") ? join(HOLO, served.slice(9)) : null;
const bareMap = {
  "@huggingface/transformers": "/_shared/voice/vendor/kokoro/transformers/transformers.js",
  "phonemizer": "/_shared/voice/vendor/kokoro/phonemizer.js",
  "path": "/_shared/voice/vendor/kokoro/stub.js", "fs": "/_shared/voice/vendor/kokoro/stub.js", "fs/promises": "/_shared/voice/vendor/kokoro/stub.js",
};
const LEAF = /vendor\/(kokoro|transformers)\/transformers\.js$/;    // bundled transformers = leaf (its "imports" are string noise)

// entry JS modules q-chat.html loads (5 static + 2 dynamic on ./core/)
const ENTRIES = [
  "/apps/q/core/loader.js", "/apps/q/core/engine.js", "/apps/q/core/q-self.mjs",
  "/apps/q/core/holo-q-guards.mjs", "/apps/q/core/holo-orb.js",
  "/apps/q/core/voice-out.js", "/apps/q/core/listen.js",
];

function resolveSpec(spec, servedFile) {
  spec = spec.split("?")[0].split("#")[0];
  if (bareMap[spec]) return bareMap[spec];
  if (spec.startsWith("/apps/") || spec.startsWith("/_shared/")) return spec;
  if (spec.startsWith(".")) {
    const abs = resolve(dirname(fsOf(servedFile)), spec);
    if (abs.startsWith(APPS)) return "/apps/" + relative(APPS, abs).replace(/\\/g, "/");
    if (abs.startsWith(HOLO)) return "/_shared/" + relative(HOLO, abs).replace(/\\/g, "/");
    return null;
  }
  return null;
}

const IMPORT_RE = /(?:from\s*|import\s*\(\s*|new\s+URL\s*\(\s*)["']([^"']+)["']/g;
const seen = new Set(), toCopy = new Set(), missing = new Set();
const queue = [...ENTRIES];
while (queue.length) {
  const served = queue.shift();
  if (seen.has(served)) continue; seen.add(served);
  const fp = fsOf(served);
  if (!fp || !existsSync(fp)) { if (/\.(mjs|js|json|wasm)$/.test(served)) missing.add(served); continue; }
  if (statSync(fp).isDirectory()) continue;
  toCopy.add(served);
  if (!/\.(mjs|js)$/.test(served) || LEAF.test(served)) continue;
  const src = readFileSync(fp, "utf8"); let m;
  while ((m = IMPORT_RE.exec(src))) { const r = resolveSpec(m[1], served); if (r) queue.push(r); }
}

// q-chat.html uses RELATIVE imports (./core/…, ../qvac-gpu.js from core/) → the app must sit FLAT at the bundle
// root (like the fork's layout): index.html + core/ + qvac-*.js + pkg/ next to each other. So STRIP the "/apps/q/"
// prefix; "/_shared/…" stays absolute (the vendor imports were rewritten to /_shared/voice/vendor/…).
const bundleRel = (served) => served.startsWith("/apps/q/") ? served.slice(8) : served.slice(1);
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
copyFileSync(join(HERE, "q-chat.html"), join(OUT, "index.html"));
copyFileSync(join(HERE, "wallpaper.jpg"), join(OUT, "wallpaper.jpg"));   // referenced relative to the html (next to index.html)
for (const served of toCopy) { const fp = fsOf(served), dst = join(OUT, bundleRel(served)); mkdirSync(dirname(dst), { recursive: true }); copyFileSync(fp, dst); }

// runtime assets the tracer can't see (loaded via variable URLs / fetched): kokoro + VAD vendors, pkg wasm, Kokoro configs
const cpDir = (servedDir, skip = []) => { const src = fsOf(servedDir); if (!existsSync(src)) return; (function w(d) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) w(p); else { const rel = relative(fsOf(servedDir), p).replace(/\\/g, "/"); if (skip.some((r) => r.test(p.replace(/\\/g, "/")))) continue; const dst = join(OUT, bundleRel(servedDir), rel); mkdirSync(dirname(dst), { recursive: true }); copyFileSync(p, dst); } } })(src); };
cpDir("/_shared/voice/vendor/kokoro");                              // Kokoro TTS runtime (voice-out.js)
cpDir("/_shared/voice/vendor/transformers");                        // Whisper ASR + Silero VAD runtime (listen.js)
cpDir("/_shared/voice/vendor/models/onnx-community/silero-vad");    // 2MB Silero VAD onnx
cpDir("/apps/q/pkg");                                               // holospaces_web_bg.wasm (tokenizer + κ)
cpDir("/_shared/voice/vendor/models/onnx-community/Kokoro-82M-v1.0-ONNX", [/\.onnx$/, /\.onnx_data$/]);   // Kokoro config/voices (weights from HF)

const du = (p) => { let n = 0; (function w(d) { for (const e of readdirSync(d, { withFileTypes: true })) { const fp = join(d, e.name); if (e.isDirectory()) w(fp); else n += statSync(fp).size; } })(p); return n; };
console.log(`traced ${toCopy.size} modules · bundle ${(du(OUT) / 1e6).toFixed(1)} MB`);
if (missing.size) { console.log("UNRESOLVED (" + missing.size + "):"); [...missing].forEach((x) => console.log("  " + x)); }
