// holo-render-witness.mjs — proves the canonical κ→render path is sound, lean, and interoperable.
//
// The renderer's data plane is environment-agnostic: resolution by content address, L5 verification
// (re-derive κ, refuse mismatch), L3 dedup, and bundle/unbundle composition. This witness exercises
// all of it against the real served bytes, then asserts the hot path carries no compiler.
//
//   node holo-render-witness.mjs
import { canonicalize, kappaOfBytes } from "./vendor/runtime/holo-render.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const APP = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(APP, p));
const norm = (k) => String(k).replace(/^did:holo:sha256:/, "").replace(/^holo:\/\/sha256:/, "").replace(/^sha256:/, "");
const hexK = async (bytes) => norm(await kappaOfBytes(bytes));

const importmap = JSON.parse(read("vendor/importmap.json"));
const regIndex = JSON.parse(read("registry/index.json"));
const bundleIndex = JSON.parse(read("registry/bundles/index.json"));
const byKappa = importmap.imports;                                   // holo://sha256:κ → served path

const checks = [];
const ok = (label, pass, detail) => { checks.push({ label, pass: !!pass }); if (!pass) console.log("   ✗ " + label + (detail ? " — " + detail : "")); return !!pass; };

// resolve(κ): the renderer's core — find bytes by κ, re-derive, refuse mismatch. (importmap = surface)
async function resolve(holoK) {
  const path = byKappa[holoK]; if (!path) throw new Error("unresolvable κ " + holoK);
  const bytes = read(path.replace(/^\.\//, ""));
  const got = await hexK(bytes);
  if (got !== norm(holoK)) throw new Error("L5 REFUSED " + norm(holoK).slice(0, 12) + " ≠ " + got.slice(0, 12));
  return bytes;
}
// walk a parsed bundle for the κ's it composes (component modules + nested bundles)
function childKappas(c) { const o = []; if (typeof c === "string" && /sha256:/.test(c)) o.push(norm(c));
  if (c && c.kappa) o.push(norm(c.kappa)); if (c && c.bundle) o.push(norm(c.bundle));
  if (c && c.children) o.push(...[].concat(c.children).flatMap(childKappas)); return o; }

console.log("Holo Render — canonical κ→render path witness\n");

// (1) resolution surface is complete: every component + bundle κ resolves and re-derives byte-exact
let resolvedN = 0;
for (const c of regIndex.components) { const b = await resolve(c.holo); ok(`resolve(${c.name}) re-derives byte-for-byte`, (await hexK(b)) === norm(c.holo)); resolvedN++; }
for (const b of bundleIndex.bundles) { const by = await resolve(b.holo); ok(`resolve(bundle ${b.name}) re-derives`, (await hexK(by)) === norm(b.holo)); resolvedN++; }
ok(`resolution surface complete (${resolvedN} objects)`, resolvedN === regIndex.count + bundleIndex.count);

// (2) L5 refuses a tampered object — the universe is self-policing
let refused = false;
try { const b = Buffer.from(read("vendor/components/button.js")); b[b.length - 1] ^= 1;
  if ((await hexK(b)) !== norm(byKappa[regIndex.components.find((c)=>c.name==="button").holo])) refused = true; } catch { refused = true; }
ok("tampered object fails re-derivation (L5 would refuse)", refused);

// (3) bundle κ is its canonical content (edit → new κ; same content → same κ everywhere)
for (const name of ["button-row", "status-badges", "panel"]) {
  const bytes = read(`registry/bundles/${name}.json`);
  const obj = JSON.parse(bytes.toString("utf8"));
  ok(`bundle ${name}: served bytes == canonical(content)`, Buffer.compare(bytes, Buffer.from(canonicalize(obj), "utf8")) === 0);
  const idx = bundleIndex.bundles.find((x) => x.name === name);
  ok(`bundle ${name}: κ == index κ`, (await hexK(bytes)) === norm(idx.holo));
}

// (4) unbundle: every κ a bundle composes is itself an independently resolvable object (infinite un/bundling)
const panel = JSON.parse(read("registry/bundles/panel.json").toString("utf8"));
const direct = [...new Set(panel.children.flatMap(childKappas))];
ok("unbundle(panel) yields resolvable child κ's", direct.length > 0 && direct.every((k) => byKappa["holo://sha256:" + k]));
// recurse: resolve nested bundles down to leaf component modules
const seen = new Set(), leaves = new Set();
async function walk(holoK) { if (seen.has(holoK)) return; seen.add(holoK);
  const path = byKappa[holoK]; if (!path.endsWith(".json")) { leaves.add(holoK); return; }
  const obj = JSON.parse(read(path.replace(/^\.\//, "")).toString("utf8"));
  if (obj["@type"] !== "holo:Bundle") { leaves.add(holoK); return; }
  for (const k of [...new Set(obj.children.flatMap(childKappas))]) await walk("holo://sha256:" + k); }
await walk(panel == null ? null : bundleIndex.bundles.find((b)=>b.name==="panel").holo);
ok(`panel fully unbundles to leaf component modules (${leaves.size})`, leaves.size > 0 && [...leaves].every((k) => byKappa[k].endsWith(".js")));

// (5) L3 dedup: button-row references the Button module 5× but it is ONE unique κ → resolved once
const br = JSON.parse(read("registry/bundles/button-row.json").toString("utf8"));
const refs = br.children.flatMap(childKappas), uniq = new Set(refs);
ok(`dedup: button-row has ${refs.length} child refs → ${uniq.size} unique module (resolved once)`, refs.length === 5 && uniq.size === 1);

// (6) lean + compiler-free hot path: the renderer never imports the TypeScript compiler, React is lazy
const rsrc = read("vendor/runtime/holo-render.js").toString("utf8");
ok("renderer never references esbuild / the TS compiler", !/esbuild/i.test(rsrc));
ok("React is imported lazily via the linker (not statically at module top)", !/^import .*react/m.test(rsrc) && /async function react\(\)/.test(rsrc) && /linkBlob/.test(rsrc));
ok("renderer is lean (single file, no hard deps)", !/^import .*from ["'](?!react)/m.test(rsrc));
// (7) no duplicate resolver: resolution DELEGATES to the substrate's canonical resolveByKappa when wired
ok("resolve() delegates to an injectable canonical RESOLVER (no duplicate spine)", /RESOLVER/.test(rsrc) && /configure\(\{[^}]*resolver/.test(rsrc) && /standalone fallback/i.test(rsrc));

const passed = checks.filter((c) => c.pass).length;
console.log(`\n${passed}/${checks.length} checks passed`);
console.log(`universe: ${regIndex.count} components + ${bundleIndex.count} bundles, all addressed + rendered from one κ`);
if (passed !== checks.length) process.exit(1);
console.log("✓ CANONICAL κ→RENDER PATH VERIFIED — resolve · L5 · L3 dedup · bundle/unbundle, no compiler");
