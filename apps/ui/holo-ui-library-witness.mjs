// holo-ui-library-witness.mjs — proves the consolidated Hologram UI library is real: one catalog, every
// component discoverable, addressed by a stable holo://ui/<name> specifier, and streamable by its κ from
// the OS content route — each byte re-derivable (Law L5). Legacy os/ui κ alias to the canonical ones.
//
//   node holo-ui-library-witness.mjs
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const APP = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(APP, p));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const hex = (k) => String(k).replace(/^did:holo:sha256:|^holo:\/\/sha256:|^sha256:|^\/\.holo\/sha256\//, "");

const lib = JSON.parse(read("ui-library.json"));
const map = JSON.parse(read("vendor/ui-importmap.json")).imports;
const idx = JSON.parse(read("registry/index.json"));
const lock = JSON.parse(read("holospace.lock.json"));

// invert the sealed closure → hex κ → app-local path, so we can read the bytes a κ streams and re-derive.
const hexToLocal = {};
for (const [rel, e] of Object.entries(lock.closure)) hexToLocal[hex(e.kappa)] = rel.replace(/^apps\/ui\//, "");

const checks = [];
const ok = (label, pass, detail) => { checks.push(pass); if (!pass) console.log("   ✗ " + label + (detail ? " — " + detail : "")); return pass; };

console.log("Hologram UI library — consolidation witness\n");

// (1) the catalog IS the whole library: one entry per registered component, nothing dropped or invented.
ok(`catalog covers every component (${lib.count})`, lib.count === idx.components.length && lib.components.length === idx.components.length, `${lib.count} vs ${idx.components.length}`);

// (2) every component streams by its κ: the route resolves to a sealed object whose bytes re-derive (L5).
let streamed = 0, l5 = 0;
for (const c of lib.components) {
  const h = hex(c.route);
  const local = hexToLocal[h];
  if (!local) { ok(`stream ${c.name}: κ in sealed closure`, false, h.slice(0, 12)); continue; }
  streamed++;
  if (sha(read(local)) === h) l5++; else ok(`L5 ${c.name}: bytes re-derive to κ`, false);
}
ok(`every component κ is in the sealed closure (streamable by /.holo/sha256/<κ>)`, streamed === lib.components.length, `${streamed}/${lib.components.length}`);
ok(`every component re-derives byte-exact from its κ (Law L5)`, l5 === lib.components.length, `${l5}/${lib.components.length}`);

// (3) the global import map addresses every module component by a stable holo://ui/<name> specifier,
//     pointing at the same κ-route the catalog records (discover ⇄ import agree).
let spec = 0, agree = 0;
for (const c of lib.components) {
  if (c.format === "css") continue;          // css layers are adopted as stylesheets, not import()ed
  if (!c.specifier || !map[c.specifier]) { ok(`specifier ${c.name} in import map`, false); continue; }
  spec++;
  if (map[c.specifier] === c.route) agree++; else ok(`specifier ${c.name} routes to its κ`, false);
}
const jsCount = lib.components.filter((c) => c.format !== "css").length;
ok(`every module component has a holo://ui/<name> specifier (${spec})`, spec === jsCount, `${spec}/${jsCount}`);
ok(`specifier route == catalog κ route for all`, agree === jsCount);

// (4) the shared runtime travels with the library (so a component's `import "react"` resolves anywhere).
const rt = Object.keys(lib.runtime);
ok(`shared runtime carried (${rt.length}: ${rt.slice(0, 3).join(", ")}…)`, rt.length > 0 && rt.every((k) => map[k] === lib.runtime[k]));
ok(`runtime κ are sealed + streamable`, rt.every((k) => hexToLocal[hex(lib.runtime[k])]));

// (5) legacy os/ui consumers can migrate: each alias maps a legacy κ → a real canonical component κ.
const al = Object.entries(lib.aliases);
const canonSet = new Set(lib.components.map((c) => hex(c.route)));
ok(`legacy aliases present (${al.length} os/ui → canonical)`, al.length > 0);
ok(`every alias targets a real canonical component κ`, al.every(([, v]) => canonSet.has(hex(v.canonical))));
ok(`aliases are genuine remaps (legacy κ ≠ canonical κ)`, al.every(([k, v]) => k !== hex(v.canonical)));

const passed = checks.filter(Boolean).length;
console.log(`\n${passed}/${checks.length} checks passed`);
console.log(`one library: ${lib.count} components — discoverable in ui-library.json, addressed by holo://ui/<name>, streamed by κ from /.holo/sha256/<hex>`);
if (passed !== checks.length) process.exit(1);
console.log("✓ HOLOGRAM UI LIBRARY CONSOLIDATED — one catalog · κ-addressed · streamable by any app/tab · L5-verified");
