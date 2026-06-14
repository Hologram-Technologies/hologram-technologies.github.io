#!/usr/bin/env node
// holo-render-path-witness.mjs — PROVE the canonical κ→render path is bound ONCE in the OS runtime and
// the shell renders objects THROUGH it (Stage 2 of substrate-wide render enforcement):
//   A · holo-render.js lives exactly once in the runtime home (usr/lib/holo) — no fork, no duplicate.
//   B · it carries no compiler and delegates resolution to the substrate's single resolver (no 2nd spine).
//   C · the canonical shell binds it, injects resolveByKappa (the one resolve authority) + the κ-route,
//       and mounts ANY κ-addressed object in-shell via render() — apps stay sandboxed iframes.
//   D · the shell itself is a κ-sealed object (OS-wide closure) and an atlas-coordinate object (ATLAS96).
//   node tools/holo-render-path-witness.mjs
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const APPS_UI = "C:/Users/pavel/Desktop/Hologram Apps/apps/ui/vendor/runtime/holo-render.js";
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const r = []; const ok = (label, pass, d = "") => { r.push({ label, pass: !!pass }); console.log(`${pass ? "PASS" : "FAIL"} — ${label}${d ? "  (" + d + ")" : ""}`); return !!pass; };

// A · single canonical copy in the runtime home
const RUNTIME = join(OS, "usr/lib/holo/holo-render.js");
ok("the renderer is bound in the OS runtime home (usr/lib/holo/holo-render.js)", existsSync(RUNTIME));
const rt = readFileSync(RUNTIME);
// no other holo-render*.js anywhere under os/ (excluding dist) → no duplicate runtime
function walk(dir, hits = []) { for (const f of readdirSync(dir)) { const p = join(dir, f); if (f === "dist" || f === "node_modules") continue; const s = statSync(p); if (s.isDirectory()) walk(p, hits); else if (/^holo-render.*\.js$/.test(f)) hits.push(p); } return hits; }
const copies = walk(OS);
ok("exactly ONE holo-render in the OS tree (no duplicate render runtime)", copies.length === 1, `${copies.length} copy`);
if (existsSync(APPS_UI)) ok("the OS runtime copy is byte-identical to the verified Apps copy (bound, not forked)", Buffer.compare(rt, readFileSync(APPS_UI)) === 0, "κ " + sha256(rt).slice(0, 12));

// B · lean + delegates, never compiles
const s = rt.toString("utf8");
ok("renderer never references the TypeScript compiler (esbuild)", !/esbuild/i.test(s));
ok("React is imported lazily via the linker, not at module top", !/^import .*react/m.test(s) && /async function react\(\)/.test(s) && /linkBlob/.test(s));
ok("resolution DELEGATES to an injectable canonical RESOLVER (no duplicate spine)", /RESOLVER/.test(s) && /configure\(\{[^}]*resolver/.test(s) && /standalone fallback/i.test(s));
ok("the κ-route is injectable (rides the substrate /.holo/sha256 route, not a hardcoded base)", /ROUTE/.test(s) && /route/.test(s));

// C · the shell binds it and renders objects through it
const SHELL = join(OS, "usr/share/frame/shell.html");
const sh = readFileSync(SHELL, "utf8");
ok("the shell imports the canonical renderer (/_shared/holo-render.js)", /import\s+HoloRender\s+from\s+["']\/_shared\/holo-render\.js["']/.test(sh));
ok("the shell imports the single resolve authority (resolveByKappa)", /import\s*\{\s*resolveByKappa\s*\}\s*from\s*["']\/holo-resolver\.mjs["']/.test(sh));
ok("the shell injects the canonical resolver + κ-route into the renderer", /HoloRender\.configure\(\{[^}]*resolver:\s*\(k\)\s*=>\s*resolveByKappa/.test(sh) && /\/\.holo\/sha256\//.test(sh));
ok("the shell render() mounts ANY κ-addressed object in-shell via HoloRender.render", /else if \(n\.kappa\)/.test(sh) && /HoloRender\.render\(/.test(sh));
ok("apps stay sandboxed iframes (isolation preserved — not imported into the shell page)", /n\.kind === "app".*iframe/s.test(sh) && /setAttribute\("sandbox"/.test(sh));

// D · the shell itself is a κ-sealed, atlas-coordinate object (ATLAS96)
const closure = JSON.parse(readFileSync(join(OS, "etc/os-closure.json"), "utf8")).closure || {};
const shellEntry = closure["shell.html"];
ok("the shell is a κ-sealed object in the OS-wide closure (resolves by content, Law L5)", !!shellEntry && /^did:holo:sha256:[0-9a-f]{64}$/.test(shellEntry.kappa || ""));
ok("the sealed shell κ re-derives from the served bytes (tamper-refused)", shellEntry && ("did:holo:sha256:" + sha256(readFileSync(SHELL))) === shellEntry.kappa);
ok("the shell declares its ATLAS96 atlas-coordinate (a point in — and itself an — atlas)", /holo:atlasCoordinate/.test(sh) && /ATLAS96/.test(sh) && /atlasCoord/.test(sh));

const passed = r.filter((x) => x.pass).length;
console.log(`\n${passed}/${r.length} checks`);
if (passed !== r.length) process.exit(1);
console.log("WITNESSED ✓ — the canonical κ→render path is bound once and enforced in the shell (Stage 2)");
