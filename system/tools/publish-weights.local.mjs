#!/usr/bin/env node
// publish-weights.local.mjs — stage the DEFAULT model weights (Holo Q brain + OS voice) as κ-NAMED
// assets for GitHub Releases + IPFS, so the heavy bytes that can't live in git / on Pages (>100 MB file,
// >1 GB site) are healed by content. The Service Worker (holo-fhs-sw.js) heals any missing byte by its κ:
// apps-repo raw → κ-named Release asset (WEIGHTS_RELEASE_BASE) → IPFS. The asset filename IS the sha256 κ,
// so heal fetches by content with zero manifest.
//
//   node tools/publish-weights.local.mjs               default brain (Q falcon-e-3b) + default voice
//   node tools/publish-weights.local.mjs --all         every Q model + every voice model
//   node tools/publish-weights.local.mjs --q-all       all Q models, default voice
//   node tools/publish-weights.local.mjs --voice-all   default Q brain, all voice models
//
// It does NOT push or pin (no credentials here) — it stages files + prints the commands you run.
import { readFileSync, existsSync, mkdirSync, linkSync, copyFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");   // repo root
const APPS = join(ROOT, "holo-apps");
const OS = join(ROOT, "holo-os/system/os");
const VOICE = join(OS, "usr/lib/holo/voice");
const TAG = "weights-v1";
const OUT = join(ROOT, "out", "weights-release");

const args = process.argv.slice(2);
const ALL = args.includes("--all");
const Q_ALL = ALL || args.includes("--q-all");
const V_ALL = ALL || args.includes("--voice-all");
const Q_DEFAULT = ["falcon-e-3b"];                                        // smallest = Q's boot brain (loader.defaultModelIndex)
const V_DEFAULT = ["onnx-community/whisper-tiny", "onnx-community/whisper-base",
  "onnx-community/Kokoro-82M-v1.0-ONNX", "onnx-community/silero-vad"];    // ASR (fast+quality) + TTS + VAD

const hexOf = (d) => String(d || "").split(":").pop().toLowerCase();
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const picked = []; const seen = new Set(); let total = 0;
const stage = (absSrc, hex, label) => {
  if (!/^[0-9a-f]{64}$/.test(hex) || seen.has(hex)) return;
  if (!existsSync(absSrc)) { console.warn("  ⚠ missing locally, skipped:", label); return; }
  try { linkSync(absSrc, join(OUT, hex)); } catch { copyFileSync(absSrc, join(OUT, hex)); }
  seen.add(hex); const b = statSync(absSrc).size; total += b; picked.push({ hex, src: label, bytes: b });
};

// ── Holo Q brain (apps/q/holospace.lock.json closure) ──
const qlock = JSON.parse(readFileSync(join(APPS, "apps/q/holospace.lock.json"), "utf8"));
const qWant = (rel) => rel.startsWith("apps/q/models/") && (Q_ALL || Q_DEFAULT.some((m) => rel.startsWith(`apps/q/models/${m}/`)));
for (const [rel, v] of Object.entries(qlock.closure || {})) {
  if (rel.endsWith("/") || !qWant(rel)) continue;
  stage(join(APPS, rel), hexOf(typeof v === "string" ? v : (v.kappa || v["@id"])), rel);
}

// ── OS voice models (usr/lib/holo/voice/models.manifest.json) ──
const vman = JSON.parse(readFileSync(join(VOICE, "models.manifest.json"), "utf8"));
for (const [id, files] of Object.entries(vman.models || {})) {
  if (!(V_ALL || V_DEFAULT.includes(id))) continue;
  for (const [f, k] of Object.entries(files)) stage(join(VOICE, "vendor/models", id, f), hexOf(k), `voice/models/${id}/${f}`);
}
for (const [f, k] of Object.entries(vman.runtime || {})) stage(join(VOICE, "vendor/transformers", f), hexOf(k), `voice/transformers/${f}`);  // small runtime, always

writeFileSync(join(OUT, "manifest.json"), JSON.stringify({ tag: TAG, qScope: Q_ALL ? "all" : Q_DEFAULT, voiceScope: V_ALL ? "all" : V_DEFAULT, count: picked.length, bytes: total, assets: picked }, null, 2) + "\n");

const gb = (n) => (n / 1073741824).toFixed(2);
const out = OUT.replace(/\\/g, "/");
console.log(`staged ${picked.length} κ-named assets · ${gb(total)} GB → ${OUT}`);
console.log(`  Q: ${Q_ALL ? "ALL models" : Q_DEFAULT.join(", ")}   ·   voice: ${V_ALL ? "ALL models" : "whisper-tiny/base, Kokoro, silero + runtime"}\n`);
console.log("1) Publish to GitHub Releases on hologram-apps (asset name = κ → SW heals by content):");
console.log(`   gh release create ${TAG} -R Hologram-Technologies/hologram-apps -t "Holo weights ${TAG}" -n "κ-addressed model weights, healed by content (Law L5)." || true`);
console.log(`   gh release upload ${TAG} -R Hologram-Technologies/hologram-apps ${out}/* --clobber\n`);
console.log("2) Also pin to IPFS (sha256 κ = CIDv1 sha2-256) for a second heal source:");
console.log(`   for f in ${out}/*; do [ "$(basename "$f")" = manifest.json ] || ipfs add -Q --cid-version=1 --raw-leaves "$f"; done\n`);
console.log(`The SW already heals from WEIGHTS_RELEASE_BASE (tag ${TAG}) + IPFS for BOTH Q (apps/q/models/*)`);
console.log(`and voice (usr/lib/holo/voice/vendor/*, via ensureVoiceManifest) — no code change needed.`);
console.log(`Run with --all to publish every model (Q ~13 GB + voice ~3.4 GB).`);
