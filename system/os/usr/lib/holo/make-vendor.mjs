// make-vendor.mjs — import ANY external library into Hologram OS, content-addressed.
// Crawls the esm.sh module graph for the given package(s), rewrites every absolute import
// to a local path, stores every file under _shared/vendor/<name>/, and emits an import map
// (bare specifier → local facade) + a κ manifest (sha256 per file, Law L5). After this any
// holospace boots the library offline from holo://<κ>/ — deduped, integrity-verifiable, no CDN.
//
// Usage:
//   node _shared/make-vendor.mjs <name> <pkg[@ver]> [more pkgs…] [--external=react,react-dom]
// Examples:
//   node _shared/make-vendor.mjs confetti canvas-confetti@1
//   node _shared/make-vendor.mjs charts recharts@2 --external=react,react-dom
import { writeFileSync, mkdirSync, readdirSync, statSync, readFileSync, rmSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));          // …/web/_shared
const args = process.argv.slice(2);
const name = args[0];
const externals = ((args.find((a) => a.startsWith("--external=")) || "").split("=")[1] || "").split(",").filter(Boolean);
const specs = args.slice(1).filter((a) => !a.startsWith("--"));
if (!name || !specs.length) { console.error("usage: node _shared/make-vendor.mjs <name> <pkg[@ver]> [more…] [--external=a,b]"); process.exit(2); }

const OUTDIR = join(here, "vendor", name);
const PREFIX = `/_shared/vendor/${name}`;
const ROOT = "https://esm.sh";
const bareOf = (spec) => spec.replace(/@[\^~>=<0-9][^/]*$/, "").replace(/(@[^/]+\/[^@]+)@.*/, "$1"); // strip trailing @version
const extQ = externals.length ? `&external=${externals.join(",")}` : "";

function localize(esmPath) {
  let [base, query] = esmPath.split("?");
  let p = base;
  if (query) p += ".q-" + query.replace(/[\/@:,*<>|"?=&.]/g, "_");
  if (!/\.(m?js)$/.test(p)) p += ".js";
  return PREFIX + p;
}
const rewrite = (code) => code.replace(/(\bfrom\s*|\bimport\s*\(?\s*|\bexport\s*(?:\*|\{[^}]*\})\s*from\s*)(["'])(\/[^"']+)\2/g,
  (_m, pre, q, path) => `${pre}${q}${path.startsWith(PREFIX) ? path : localize(path)}${q}`);
function refsIn(code) {
  const out = []; const re = /(?:\bfrom\s*|\bimport\s*\(?\s*|\bexport\s*(?:\*|\{[^}]*\})\s*from\s*)["']([^"'\n]+)["']/g; let m;
  while ((m = re.exec(code))) out.push(m[1]);
  return out;
}
function toAbs(spec, fromPath) {
  if (spec.startsWith("/")) return spec;
  if (spec.startsWith("./") || spec.startsWith("../")) { const u = new URL(spec, "https://esm.sh" + fromPath); return u.pathname + u.search; }
  return null;
}
async function fetchText(url) { for (let i = 0; i < 4; i++) { try { const r = await fetch(url, { redirect: "follow" }); if (r.ok) return await r.text(); } catch {} } throw new Error("fetch failed: " + url); }
const FACADE = (s) => bareOf(s).replace(/[@/]/g, "-").replace(/^-/, "") + ".js";

let files = 0, bytes = 0; const seen = new Set(); const queue = [];
const enqueue = (orig) => { if (!seen.has(orig)) { seen.add(orig); queue.push(orig); } };
function save(localPath, code) { const abs = join(OUTDIR, localPath.slice(PREFIX.length + 1)); mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, code); files++; bytes += Buffer.byteLength(code); }

if (existsSync(OUTDIR)) rmSync(OUTDIR, { recursive: true, force: true });
mkdirSync(OUTDIR, { recursive: true });
const importmap = { imports: {} };
for (const spec of specs) {
  const url = `${ROOT}/${spec}?bundle&target=es2022${extQ}`;
  const raw = await fetchText(url);
  for (const r of refsIn(raw)) { const a = toAbs(r, "/" + spec); if (a && !a.startsWith(PREFIX)) enqueue(a); }
  const facade = FACADE(spec);
  save(`${PREFIX}/${facade}`, rewrite(raw));
  importmap.imports[bareOf(spec)] = `${PREFIX}/${facade}`;
  console.log("facade", bareOf(spec).padEnd(22), "→", facade);
}
while (queue.length) {
  if (files > 4000) throw new Error("graph too large (>4000) — aborting");
  const orig = queue.shift();
  const raw = await fetchText(ROOT + orig);
  for (const r of refsIn(raw)) { const a = toAbs(r, orig); if (a && !a.startsWith(PREFIX)) enqueue(a); }
  save(localize(orig), rewrite(raw));
  if (files % 10 === 0) process.stdout.write(`\r  vendored ${files} files…   `);
}
console.log(`\nvendored ${files} files (${(bytes / 1048576).toFixed(2)} MiB) → _shared/vendor/${name}`);

writeFileSync(join(OUTDIR, "importmap.json"), JSON.stringify(importmap, null, 2) + "\n");
const man = { algo: "sha256", name, specs, externals, files: {} };
(function walk(d, rel) {
  for (const n of readdirSync(d)) {
    const abs = join(d, n), r = rel ? rel + "/" + n : n;
    if (statSync(abs).isDirectory()) walk(abs, r);
    else if (/\.(js|mjs)$/.test(n)) man.files[r] = "sha256:" + createHash("sha256").update(readFileSync(abs)).digest("hex");
  }
})(OUTDIR, "");
writeFileSync(join(OUTDIR, "manifest.json"), JSON.stringify(man, null, 2) + "\n");
console.log(`wrote importmap.json (${Object.keys(importmap.imports).length} specifiers) + manifest.json (${Object.keys(man.files).length} κ pins)`);
console.log(`\nUse it:  add an import map pointing the specifier(s) at _shared/vendor/${name}/, then \`import … from "<spec>"\`.`);
