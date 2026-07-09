// make-space.mjs — assemble a SELF-CONTAINED static Q Live bundle for a Hugging Face static Space by TRACING the
// actual import closure from q-live's entry modules (not copying whole trees — apps/q is GBs of forge scratch).
// Weights (brain + ear + voice) κ-stream from HOLOGRAMTECH at runtime, so the bundle is code+small-assets only.
//
//   node make-space.mjs   → ./q-live-space/ (sibling)   then serve statically; open / → NO 404s, weights from HF.
//
// Served-path model: "/apps/X" → holo-apps/apps/X ; "/_shared/X" → holo-os/system/os/usr/lib/holo/X (see _live-serve).

import { mkdirSync, copyFileSync, rmSync, existsSync, statSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";

const HERE = import.meta.dirname;                                   // …/holo-apps/apps/q
const REPO = join(HERE, "../../..");
const APPS = join(REPO, "holo-apps/apps");
const HOLO = join(REPO, "holo-os/system/os/usr/lib/holo");          // "/_shared/*" root
const OUT = join(APPS, "q-live-space");

// map a SERVED path ("/apps/..", "/_shared/..") → filesystem path
const fsOf = (served) => served.startsWith("/apps/") ? join(APPS, served.slice(6))
  : served.startsWith("/_shared/") ? join(HOLO, served.slice(9))
  : null;
const bareMap = {   // import-map bare specifiers (kokoro) → served path
  "@huggingface/transformers": "/_shared/voice/vendor/kokoro/transformers/transformers.js",
  "phonemizer": "/_shared/voice/vendor/kokoro/phonemizer.js",
  "path": "/_shared/voice/vendor/kokoro/stub.js", "fs": "/_shared/voice/vendor/kokoro/stub.js", "fs/promises": "/_shared/voice/vendor/kokoro/stub.js",
};
// files whose "imports" are bundled-in string noise, not real edges — trace stops here (leaves)
const LEAF = /vendor\/kokoro\/transformers\/transformers\.js$/;

// entry JS modules (served paths) q-live dynamically loads
const ENTRIES = [
  "/apps/q/q-live.mjs", "/apps/q/core/q-brain-fast.mjs",
  "/_shared/voice/holo-voice-tts.mjs", "/_shared/voice/holo-voice-asr.mjs",
  "/_shared/voice/holo-voice-vad.mjs", "/_shared/voice/holo-voice-turn.mjs",
  "/apps/q/forge/gpu/holo-moonshine-ear.mjs", "/apps/q/forge/gpu/holo-onnx-kserve.mjs",
];

// resolve an import specifier found inside servedFile → a served path (or null to skip)
function resolveSpec(spec, servedFile) {
  spec = spec.split("?")[0].split("#")[0];
  if (bareMap[spec]) return bareMap[spec];
  if (spec.startsWith("/apps/") || spec.startsWith("/_shared/")) return spec;
  if (spec.startsWith(".")) {                                        // relative → resolve in served-path space
    const p = "/" + relative(REPO, resolve(dirname(fsOf(servedFile)), spec)).replace(/\\/g, "/");
    // rebuild as a served path: map back through APPS/HOLO
    const abs = resolve(dirname(fsOf(servedFile)), spec);
    if (abs.startsWith(APPS)) return "/apps/" + relative(APPS, abs).replace(/\\/g, "/");
    if (abs.startsWith(HOLO)) return "/_shared/" + relative(HOLO, abs).replace(/\\/g, "/");
    return null;                                                     // escapes the served roots → not bundle-able
  }
  return null;                                                       // other bare specifier → ignore
}

const IMPORT_RE = /(?:from\s*|import\s*\(\s*|new\s+URL\s*\(\s*)["']([^"']+)["']/g;
const seen = new Set(), toCopy = new Set(), missing = new Set();
const queue = [...ENTRIES];
while (queue.length) {
  const served = queue.shift();
  if (seen.has(served)) continue; seen.add(served);
  const fp = fsOf(served);
  if (!fp || !existsSync(fp)) { if (/\.(mjs|js|json|wasm)$/.test(served)) missing.add(served); continue; }
  if (statSync(fp).isDirectory()) continue;                          // `new URL("./",…)` base dirs → handled by asset copy, not tracing
  toCopy.add(served);
  if (!/\.(mjs|js)$/.test(served) || LEAF.test(served)) continue;    // non-JS or leaf → don't parse for edges
  const src = readFileSync(fp, "utf8"); let m;
  while ((m = IMPORT_RE.exec(src))) { const r = resolveSpec(m[1], served); if (r) queue.push(r); }
}

// copy the traced closure
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
copyFileSync(join(HERE, "q-live.html"), join(OUT, "index.html"));
copyFileSync(join(HERE, "q-live-sw.js"), join(OUT, "q-live-sw.js"));
for (const served of toCopy) { const fp = fsOf(served), dst = join(OUT, served.slice(1)); mkdirSync(dirname(dst), { recursive: true }); copyFileSync(fp, dst); }

// copy known RUNTIME assets that tracing can't see (fetched, not imported): kokoro ort wasm, pkg wasm, Kokoro
// model config/tokenizer/voices (NOT the .onnx — those come from HF), Silero VAD onnx + its ort runtime.
const cpDir = (servedDir, skip = []) => { const src = fsOf(servedDir); if (!existsSync(src)) return; (function w(d) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) w(p); else { const rel = relative(fsOf(servedDir), p).replace(/\\/g, "/"); if (skip.some((r) => r.test(p.replace(/\\/g, "/")))) continue; const dst = join(OUT, servedDir.slice(1), rel); mkdirSync(dirname(dst), { recursive: true }); copyFileSync(p, dst); } } })(src); };
cpDir("/_shared/voice/vendor/kokoro");                              // kokoro.js + phonemizer + stub + transformers.js + ort-wasm (loaded via variable URLs, not traceable)
cpDir("/_shared/voice/vendor/transformers");                        // the transformers instance the Silero VAD runs on (turn-taking)
cpDir("/_shared/voice/vendor/models/onnx-community/silero-vad");    // 2MB Silero VAD onnx (INCLUDE the .onnx — small + needed)
cpDir("/apps/q/pkg");                                               // holospaces_web_bg.wasm
cpDir("/_shared/voice/vendor/models/onnx-community/Kokoro-82M-v1.0-ONNX", [/\.onnx$/, /\.onnx_data$/]);
cpDir("/_shared/voice/vendor/silero", []);                          // Silero VAD (if present)
for (const f of ["silero_vad.onnx", "vad.onnx"]) { const s = fsOf("/_shared/voice/" + f); if (s && existsSync(s)) copyFileSync(s, join(OUT, "_shared/voice/" + f)); }

const du = (p) => { let n = 0; (function w(d) { for (const e of readdirSync(d, { withFileTypes: true })) { const fp = join(d, e.name); if (e.isDirectory()) w(fp); else n += statSync(fp).size; } })(p); return n; };
console.log(`traced ${toCopy.size} modules · bundle ${(du(OUT) / 1e6).toFixed(1)} MB`);
if (missing.size) { console.log("UNRESOLVED entries (" + missing.size + "):"); [...missing].forEach((x) => console.log("  " + x)); }
