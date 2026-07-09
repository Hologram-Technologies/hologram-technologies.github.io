// scan-space.mjs — flag any local JS import in dist-space/ whose target isn't in the bundle (completeness check).
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
const OUT = join(import.meta.dirname, "../q-live-space");
const files = [];
(function walk(d) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(mjs|js)$/.test(e.name)) files.push(p); } })(OUT);
const missing = new Set();
const re = /(?:from\s*|import\s*\(\s*)["'](\.[^"']*?|\/apps\/[^"']*?|\/_shared\/[^"']*?)["']/g;
for (const f of files) {
  const src = readFileSync(f, "utf8"); let m;
  while ((m = re.exec(src))) {
    const spec = m[1].split("?")[0];
    if (!/\.(mjs|js)$/.test(spec)) continue;
    const target = spec.startsWith("/") ? join(OUT, spec.slice(1)) : resolve(dirname(f), spec);
    if (!existsSync(target)) missing.add(spec + "   <- " + f.slice(OUT.length + 1).replace(/\\/g, "/"));
  }
}
if (missing.size === 0) console.log("all local JS imports resolve inside the bundle");
else { console.log("MISSING (" + missing.size + "):"); [...missing].sort().forEach((x) => console.log("  " + x)); }
