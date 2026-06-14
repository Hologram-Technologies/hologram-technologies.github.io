#!/usr/bin/env node
// holo-render-noduplicate-witness.mjs — PROVE the per-app bespoke render glue is RETIRED (Stage 3 finish):
//   A · Forge's render-from-κ ("the κ is the compiled bytes") no longer has its own React root / import —
//       it routes through the ONE canonical renderer (window.HoloRender), addressing components by κ.
//   B · Forge KEEPS its compiler path (esbuild build → run) — that is Forge's reason to exist; only the
//       duplicate RENDER path was retired, not the compile demo.
//   C · corpus audit: NO app imports a component object BY CONTENT ADDRESS into its own React root while
//       bypassing HoloRender. The sole allowed exception is the ui app's gallery — the registry's native
//       reference renderer (one self-consistent React instance for shell + previews), documented as such.
//   node tools/holo-render-noduplicate-witness.mjs
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const APPS = process.env.HOLO_APPS_DIR || "C:/Users/pavel/Desktop/Hologram Apps/apps";
const r = []; const ok = (l, p, d = "") => { r.push({ l, p: !!p }); console.log(`${p ? "PASS" : "FAIL"} — ${l}${d ? "  (" + d + ")" : ""}`); return !!p; };

// ── A · Forge's render-from-κ is retired onto the canonical renderer ──
const forge = readFileSync(join(APPS, "forge/index.html"), "utf8");
ok("Forge: the private render-from-κ root (kRoot) is gone", !/\bkRoot\b/.test(forge));
ok("Forge: render-from-κ no longer fetches/imports the component module itself", !/\/ui\/vendor\/components\//.test(forge));
ok("Forge: fromK routes through the canonical renderer (window.HoloRender.render)", /HR\.render\(/.test(forge) && /holoReady/.test(forge));
ok("Forge: it addresses components by CONTENT ADDRESS (holo:// κ map), not a serving path", /KMAP/.test(forge) && /holo:\/\/sha256:/.test(forge));

// ── B · Forge keeps its compiler (we retired the duplicate render, not Forge's purpose) ──
ok("Forge: the compiler path is intact (esbuild build → run)", /esbuild/.test(forge) && /esbuild\.build\(/.test(forge));

// ── C · corpus audit: no app has an un-routed render-from-κ duplicate ──
const EXEMPT = { ui: "the registry's native reference renderer — one self-consistent React instance for shell + previews" };
const ids = readdirSync(APPS).filter((d) => existsSync(join(APPS, d)) && statSync(join(APPS, d)).isDirectory());
const files = (dir, out = []) => { for (const n of readdirSync(dir)) { if (["node_modules", "dist", "vendor", "build", "webamp", "ts"].includes(n)) continue; const p = join(dir, n); const s = statSync(p); if (s.isDirectory()) files(p, out); else if (/\.(html|js|mjs)$/.test(n)) out.push(p); } return out; };
// signature of a render-from-κ DUPLICATE: imports a component object by content address AND mounts its
// own React root AND does not go through HoloRender.
const importsComponentByK = (c) => /import\s*\(\s*[`'"]?\s*holo:\/\//.test(c) || /import\s*\(\s*comp\.holo/.test(c) || /import\s*\(\s*[`'"][^`'"]*\/vendor\/components\//.test(c);
const mountsOwnRoot = (c) => /\bcreateRoot\s*\(/.test(c);
const usesHoloRender = (c) => /HoloRender/.test(c);
const offenders = [];
for (const id of ids) {
  if (id in EXEMPT) continue;
  for (const f of files(join(APPS, id))) {
    const c = readFileSync(f, "utf8");
    if (importsComponentByK(c) && mountsOwnRoot(c) && !usesHoloRender(c)) offenders.push(`${id}:${f.split(/[\\/]/).pop()}`);
  }
}
ok("no app has an un-routed render-from-κ duplicate (bypassing HoloRender)", offenders.length === 0, offenders.length ? offenders.slice(0, 5).join(", ") : "clean");
console.log(`   exempt (reference renderer): ${Object.entries(EXEMPT).map(([k, v]) => k + " — " + v).join("; ")}`);

const passed = r.filter((x) => x.p).length;
console.log(`\n${passed}/${r.length} checks`);
if (passed !== r.length) process.exit(1);
console.log("WITNESSED ✓ — per-app bespoke render glue retired; the canonical renderer is the one render path (Stage 3 complete)");
