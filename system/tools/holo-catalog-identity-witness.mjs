// holo-catalog-identity-witness.mjs — G6/SEC-6: identity is content, not location. EVERY app-catalog @id
// MUST be a content κ (did:holo:sha256:…), never a did:holo:slug:… placeholder (a name/location is the
// REQUEST, never the IDENTITY — SEC-6). Fails CLOSED if any catalog reintroduces a slug @id. Pure-Node,
// gates on exit code. Run: node system/tools/holo-catalog-identity-witness.mjs
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const CATALOGS = [
  ["DEPLOYED (Pages)", "holo-os/system/os/usr/share/holospaces/index.jsonld", true],   // required: this is what ships
  ["SOURCE",            "holo-apps/apps/index.jsonld",                          true],
  ["TAURI mirror",      "holo-apps/apps/tauri/dist/apps/index.jsonld",          true],
];
let pass = 0, fail = 0;
const ok = (n, c) => { (c ? pass++ : fail++); console.log(`  ${c ? "✓" : "✗"}  ${n}`); };

console.log("holo-catalog-identity — every catalog @id is a content κ, never a slug (G6/SEC-6)\n");
for (const [tag, rel, required] of CATALOGS) {
  const p = join(REPO, rel);
  if (!existsSync(p)) { if (required) ok(`${tag}: catalog present`, false); continue; }
  const cat = JSON.parse(readFileSync(p, "utf8"));
  const ds = cat.dataset || cat["dcat:dataset"] || cat.datasets || [];
  const ids = ds.map((d) => d["@id"] || "");
  const slug = ids.filter((i) => /did:holo:slug/.test(i));
  const kappa = ids.filter((i) => /did:holo:sha256:[0-9a-f]{64}/.test(i));
  ok(`${tag}: ${ds.length} apps, 0 slug @id (got ${slug.length})`, slug.length === 0);
  ok(`${tag}: every @id is a content κ (${kappa.length}/${ids.length})`, ids.length > 0 && kappa.length === ids.length);
  if (slug.length) slug.slice(0, 5).forEach((s) => console.log("        ✗ slug: " + s));
}
console.log(`\n${fail ? "WITNESS FAILED" : "WITNESSED ✓"}  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
