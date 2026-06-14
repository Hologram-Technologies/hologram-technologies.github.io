#!/usr/bin/env node
// holo-render-adoption-witness.mjs — PROVE per-app adoption of the canonical κ→render path (Stage 3):
//   A · the universal wire: holo-theme.js boots window.HoloRender (configured with the substrate κ-route
//       + the single resolver). EVERY app loads holo-theme.js, so EVERY app inherits the SAME renderer
//       with NO per-app script tag (Law L2 — one canonical wire).
//   B · every OBJECT in every app is content-addressed: each app has a single root κ, every closure
//       entry carries a κ, and a sampled leaf RE-DERIVES to its pin (Law L5) — so every object self-
//       resolves and renders from its content address (low-latency, network-free on 2nd open).
//   C · the renderer is bound once and never compiles on the display path.
//   node tools/holo-render-adoption-witness.mjs
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const APPS = process.env.HOLO_APPS_DIR || "C:/Users/pavel/Desktop/Hologram Apps/apps";
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const r = []; const ok = (l, p, d = "") => { r.push({ l, p: !!p }); console.log(`${p ? "PASS" : "FAIL"} — ${l}${d ? "  (" + d + ")" : ""}`); return !!p; };

// ── A · the universal wire ────────────────────────────────────────────────────────────────────
const theme = readFileSync(join(OS, "usr/lib/holo/holo-theme.js"), "utf8");
ok("holo-theme.js boots the renderer (bootHoloRender) — the one universal wire", /function bootHoloRender/.test(theme));
ok("the wire injects holo-render.js + configures the substrate resolver + κ-route", /holo-render\.js/.test(theme) && /resolveByKappa/.test(theme) && /\/\.holo\/sha256\//.test(theme) && /window\.HoloRender = HoloRender/.test(theme));
ok("the renderer is bound once in the OS runtime home", existsSync(join(OS, "usr/lib/holo/holo-render.js")));

// Every app inherits HoloRender if it loads the universal wire — directly via holo-theme.js, OR via
// holo-ui-kernel.js (which injects holo-theme.js), OR through a forwarder page it location.replace()s to.
const allIds = readdirSync(APPS).filter((d) => existsSync(join(APPS, d, "holospace.lock.json")));
// VENDORED FOREIGN apps ship their own self-contained runtime (their own React, bundler, everything) and
// run in their own world — like any sandboxed foreign app, they are NOT a Holo-native render surface, so
// they are exempt from the universal wire (injecting into a generated upstream artifact would be fragile).
const EXEMPT = {};   // (jypyter, vendored JupyterLite, is now wired to the engine like every other app)
const ids = allIds.filter((id) => !(id in EXEMPT));
const hasWire = (html) => /holo-theme\.js/.test(html) || /holo-ui-kernel\.js/.test(html);
const forwardTarget = (html) => { const m = /location\.replace\(\s*["'`]\.?\/?([\w.-]+\.html)/.exec(html); return m ? m[1] : null; };
let withWire = 0, missing = [];
for (const id of ids) {
  const entry = join(APPS, id, "index.html");
  if (!existsSync(entry)) { missing.push(id + ":noindex"); continue; }
  let html = readFileSync(entry, "utf8");
  let wired = hasWire(html);
  if (!wired) { const t = forwardTarget(html); if (t && existsSync(join(APPS, id, t))) wired = hasWire(readFileSync(join(APPS, id, t), "utf8")); }
  wired ? withWire++ : missing.push(id);
}
ok(`EVERY native app inherits the renderer via the universal wire (theme · kernel→theme · forwarded page)`, withWire === ids.length, `${withWire}/${ids.length} native${missing.length ? " · missing: " + missing.slice(0, 4).join(", ") : ""}`);
console.log(`   exempt (vendored foreign, run own runtime): ${Object.entries(EXEMPT).map(([k, v]) => k + " — " + v).join("; ")}`);

// ── B · every object in every app is content-addressed + self-resolves (Law L5) ────────────────
let withRoot = 0, allKappa = 0, leafOk = 0, bad = [];
for (const id of allIds) {   // content-addressing holds for EVERY app, vendored or native
  let lock; try { lock = JSON.parse(readFileSync(join(APPS, id, "holospace.lock.json"), "utf8")); } catch { bad.push(id + ":lock"); continue; }
  if (/^did:holo:sha256:[0-9a-f]{64}$/.test(String(lock.root || ""))) withRoot++;
  const entries = Object.entries(lock.closure || {});
  if (entries.length && entries.every(([, e]) => /^did:holo:sha256:[0-9a-f]{64}$/.test(String(e.kappa || "")))) allKappa++;
  const key = `apps/${id}/index.html`, e = (lock.closure || {})[key], abs = join(APPS, id, "index.html");
  if (e && existsSync(abs)) { (sha256(readFileSync(abs)) === String(e.kappa).split(":").pop()) ? leafOk++ : bad.push(`${id}:leaf`); }
  else bad.push(id + ":noidx");
}
ok("EVERY app collapses to a single content-derived ROOT κ", withRoot === allIds.length, `${withRoot}/${allIds.length}`);
ok("EVERY closure entry of EVERY app carries its κ — no object trusted by location", allKappa === allIds.length, `${allKappa}/${allIds.length}`);
ok("a sampled object (index.html) of EVERY app RE-DERIVES to its pinned κ (Law L5)", leafOk === allIds.length && bad.length === 0, `${leafOk}/${allIds.length}${bad.length ? " · " + bad.slice(0, 4).join(", ") : ""}`);

// ── C · lean + compiler-free ────────────────────────────────────────────────────────────────
const rsrc = readFileSync(join(OS, "usr/lib/holo/holo-render.js"), "utf8");
ok("the renderer never compiles on the display path (no esbuild)", !/esbuild/i.test(rsrc));
ok("React loads lazily via the content-addressed linker (no per-app importmap needed)", /async function react\(\)/.test(rsrc) && /linkBlob/.test(rsrc) && /BARE\b/.test(rsrc) && !/^import .*react/m.test(rsrc));

const passed = r.filter((x) => x.p).length;
console.log(`\n${passed}/${r.length} checks · ${ids.length} apps`);
if (passed !== r.length) process.exit(1);
console.log("WITNESSED ✓ — per-app adoption: every app inherits the ONE κ→render path; every object is content-addressed (Stage 3)");
