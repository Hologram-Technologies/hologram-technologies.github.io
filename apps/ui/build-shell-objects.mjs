// build-shell-objects.mjs — register the canonical SHELL objects (first-party Holo primitives that
// every app composes for a consistent UX: tile, statusbar, …) as content-addressed UOR objects.
//
// Like build-bundles.mjs this is APP-OWNED (it writes the in-app importmap), so the shell set survives
// the external component-catalog rebuild. Each object is a self-contained ESM module (only `react`,
// linker-rewritten) authored exactly like box.js — parameterized by props, themed by --holo-* tokens,
// rendered from its κ by holo-render.js with no compile on the hot path.
//
//   node build-shell-objects.mjs
import { kappaOfBytes } from "./vendor/runtime/holo-render.js";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const APP = dirname(fileURLToPath(import.meta.url));
const sri = (buf) => "sha256-" + createHash("sha256").update(buf).digest("base64");
const norm = (k) => k.replace(/^did:holo:sha256:/, "").replace(/^holo:\/\/sha256:/, "").replace(/^sha256:/, "");

// the shell objects — each a self-contained component module + its render export + a one-line spec.
const SHELL = [
  { name: "holo-tile",       module: "vendor/components/holo-tile.js",       renderExport: "Tile",       exports: ["default", "Tile"],       spec: "clickable tile — icon · title · subtitle · trailing" },
  { name: "holo-statusbar",  module: "vendor/components/holo-statusbar.js",  renderExport: "StatusBar",  exports: ["default", "StatusBar"],  spec: "app status bar — count · selection · spacer · content-addressed trust" },
  { name: "holo-commandbar", module: "vendor/components/holo-commandbar.js", renderExport: "CommandBar", exports: ["default", "CommandBar"], spec: "top action bar — left actions · center · right actions" },
  { name: "holo-rail",       module: "vendor/components/holo-rail.js",       renderExport: "Rail",       exports: ["default", "Rail"],       spec: "sidebar nav rail — grouped, selectable items" },
  { name: "holo-listrow",    module: "vendor/components/holo-listrow.js",    renderExport: "ListRow",    exports: ["default", "ListRow"],    spec: "list row — icon · label · meta · trailing" },
  { name: "holo-emptystate", module: "vendor/components/holo-emptystate.js", renderExport: "EmptyState", exports: ["default", "EmptyState"], spec: "centered empty state — icon · title · message · action" },
  { name: "holo-dialog",     module: "vendor/components/holo-dialog.js",     renderExport: "Dialog",     exports: ["default", "Dialog"],     spec: "modal dialog — overlay · titled card · body · footer actions" },
];

const importmap = JSON.parse(readFileSync(join(APP, "vendor", "importmap.json"), "utf8"));
const index = [];
for (const s of SHELL) {
  const bytes = readFileSync(join(APP, s.module));                 // the EXACT served bytes == identity
  const k = norm(await kappaOfBytes(bytes));                       // moduleκ = sha256(module bytes)
  const holo = `holo://sha256:${k}`;
  importmap.imports[holo] = `./${s.module}`;
  importmap.integrity[`./${s.module}`] = sri(bytes);
  index.push({ name: s.name, tier: "shell", library: "holo", category: "Shell", holo, kappa: `sha256:${k}`, moduleKappa: `sha256:${k}`, integrity: sri(bytes), renderExport: s.renderExport, exports: s.exports, bytes: bytes.length, spec: s.spec });
}
writeFileSync(join(APP, "vendor", "importmap.json"), JSON.stringify(importmap, null, 2) + "\n");
mkdirSync(join(APP, "registry", "shell"), { recursive: true });
writeFileSync(join(APP, "registry", "shell", "index.json"),
  JSON.stringify({ spec: "Canonical shell objects — first-party Holo primitives every app composes for a consistent UX. Each is a κ-addressed component module themed by --holo-* tokens.", count: index.length, objects: index }, null, 2) + "\n");

console.log(`✓ ${index.length} shell objects registered → importmap + registry/shell`);
for (const o of index) console.log(`  ${o.name.padEnd(16)} ${o.holo}  (${o.bytes} B, export ${o.renderExport})`);
