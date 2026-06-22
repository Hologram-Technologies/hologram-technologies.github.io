#!/usr/bin/env node
// holo-stage-site.mjs — assemble the EXACT _site that GitHub Pages publishes, in Node, so LOCAL
// verification uses the same bytes as CI. The staging used to be inline bash in .github/workflows/pages.yml;
// that made "what the deploy ships" a thing only CI could produce — itself a dev↔prod asymmetry (the class
// of bug that left the Play panel empty). This is the ONE assembler; pages.yml calls it, and so does the
// cold-machine harness. Same union the cold-app witness reads: vendor (catalog landingPage ids) ∪
// (os/etc/core-surfaces.json surfaces), so a shell surface dropped from the launcher can't silently vanish.
//
// Usage:
//   node tools/holo-stage-site.mjs [--repo <osRepoRoot>] [--apps <dirContaining apps/>] [--out <_site>]
// Defaults are self-located so it works from CI (cwd = repo root, apps checked out at ./apps-src) AND
// locally (cwd = system/, apps repo at ../../holo-apps). Non-OS pieces (built docs, gitignored runtime
// vendors) are best-effort: absent locally → a warning, never a failure; the OS subtree + apps + gateway
// (what the witnesses need) are always assembled. Exits non-zero only if a REQUIRED piece is missing.
import { existsSync, mkdirSync, cpSync, copyFileSync, writeFileSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));        // <repo>/system/tools
const SYSTEM = resolve(here, "..");                          // <repo>/system
const REPO_DEFAULT = resolve(SYSTEM, "..");                  // <repo>  (holo-os) — has index.html, docs/, system/

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const REPO = resolve(arg("--repo", process.env.HOLO_REPO_DIR || REPO_DEFAULT));
const OUT = resolve(arg("--out", process.env.HOLO_SITE_DIR || join(process.cwd(), "_site")));
// apps dir = the directory that CONTAINS an apps/ folder (so <APPS>/apps/index.jsonld exists)
function findApps() {
  const explicit = arg("--apps", process.env.HOLO_APPS_DIR);
  const cands = [
    explicit,
    join(process.cwd(), "apps-src"),     // CI layout
    resolve(REPO, "..", "holo-apps"),    // local layout (sibling repo)
    join(REPO, "apps-src"),
  ].filter(Boolean);
  for (const c of cands) if (existsSync(join(resolve(c), "apps", "index.jsonld"))) return resolve(c);
  return null;
}
const APPS = findApps();

let warns = 0;
const warn = (m) => { warns++; console.warn("  ⚠ " + m); };
const need = (p, what) => { if (!existsSync(p)) { console.error("FATAL — missing required " + what + ": " + p); process.exit(1); } return p; };
const cpDir = (src, dst) => cpSync(src, dst, { recursive: true });
const optDir = (src, dst, what) => { if (existsSync(src)) cpDir(src, dst); else warn(`skip ${what} (absent: ${src})`); };
const optFile = (src, dst, what) => { if (existsSync(src)) copyFileSync(src, dst); else warn(`skip ${what} (absent: ${src})`); };

console.log(`stage-site → ${OUT}\n  repo: ${REPO}\n  apps: ${APPS || "(none found — apps will be omitted)"}\n`);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// ── gateway + root governance docs (served RAW by the host, outside the SW) ──
for (const f of ["index.html", "README.md", "AGENTS.md", "CONSTITUTION.md"]) optFile(join(REPO, f), join(OUT, f), f);
need(join(OUT, "index.html"), "gateway index.html");

// ── built docs site (Astro output). Absent locally unless `npm run build` ran — best-effort. ──
optDir(join(REPO, "docs"), join(OUT, "docs"), "docs site");
if (existsSync(join(OUT, "docs"))) {
  optFile(join(SYSTEM, "docs/site/public/manifesto.html"), join(OUT, "docs/manifesto.html"), "manifesto.html");
  optFile(join(SYSTEM, "docs/site/public/download.html"), join(OUT, "docs/download.html"), "download.html");
  try { execFileSync("node", [join(SYSTEM, "tools/changelog-feed.mjs"), join(REPO, "CHANGELOG.md"), join(OUT, "feed.xml"), join(OUT, "docs/changelog.html")], { stdio: "ignore" }); }
  catch { warn("changelog-feed skipped"); }
}
optFile(join(REPO, "CHANGELOG.md"), join(OUT, "CHANGELOG.md"), "CHANGELOG.md");
optFile(join(SYSTEM, "llms.txt"), join(OUT, "llms.txt"), "llms.txt");

// ── the OS subtree (REQUIRED) ──
cpDir(need(join(SYSTEM, "os"), "system/os"), join(OUT, "os"));
optDir(join(SYSTEM, "os/.well-known"), join(OUT, ".well-known"), ".well-known mirror");

// ── vendor apps at their flat serve path: (catalog ids) ∪ (core-surfaces) ──
if (APPS) {
  const appsApps = join(APPS, "apps");
  mkdirSync(join(OUT, "os/apps"), { recursive: true });
  optFile(join(appsApps, "index.jsonld"), join(OUT, "os/apps/index.jsonld"), "apps/index.jsonld");
  optFile(join(appsApps, "holospaces.jsonld"), join(OUT, "os/apps/holospaces.jsonld"), "apps/holospaces.jsonld");
  const ids = new Set();
  try { for (const a of JSON.parse(readFileSync(join(appsApps, "index.jsonld"), "utf8"))["dcat:dataset"] || []) { const id = String(a["dcat:landingPage"] || "").split("/")[1]; if (id) ids.add(id); } }
  catch (e) { warn("could not read catalog: " + e.message); }
  try { for (const s of (JSON.parse(readFileSync(join(SYSTEM, "os/etc/core-surfaces.json"), "utf8")).surfaces || [])) ids.add(s); }
  catch { warn("core-surfaces.json unreadable — vendoring catalog only"); }
  let vend = 0, miss = [];
  for (const id of [...ids].filter(Boolean)) {
    const sd = join(appsApps, id);
    if (existsSync(sd)) { cpDir(sd, join(OUT, "os/apps", id)); vend++; } else miss.push(id);
  }
  console.log(`  vendored ${vend} app dirs (catalog ∪ core-surfaces${miss.length ? `; absent in source: ${miss.join(", ")}` : ""})`);
} else {
  warn("no apps source found — _site/os/apps not populated (launcher + Play will 404). Pass --apps <dir>.");
}

// ── gateway runtime assets it references raw (vendored cloudscape + FX + statically-imported GPU modules) ──
mkdirSync(join(OUT, "system/vendor"), { recursive: true });
mkdirSync(join(OUT, "system/os/usr/lib/holo"), { recursive: true });
optDir(join(SYSTEM, "vendor"), join(OUT, "system/vendor"), "system/vendor");
for (const f of ["holo-fx.js", "holo-clouds-gpu.js", "holo-clouds-volumetric-gpu.js", "holo-conscience.js"]) optFile(join(SYSTEM, "os/usr/lib/holo", f), join(OUT, "system/os/usr/lib/holo", f), f);
optFile(join(SYSTEM, "llms.txt"), join(OUT, "system/llms.txt"), "system/llms.txt");

// ── build marker (root, raw-served): lets the post-deploy witness wait for THIS build before asserting ──
writeFileSync(join(OUT, "build-id.json"), JSON.stringify({ commit: process.env.GITHUB_SHA || "local", run: process.env.GITHUB_RUN_ID || "local" }) + "\n");

const appCount = existsSync(join(OUT, "os/apps")) ? readdirSync(join(OUT, "os/apps")).filter((n) => existsSync(join(OUT, "os/apps", n, "holospace.json"))).length : 0;
console.log(`\nstaged → ${OUT}  (os subtree + ${appCount} apps${warns ? `, ${warns} best-effort warnings` : ""})`);
