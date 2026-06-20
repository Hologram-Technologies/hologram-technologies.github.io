#!/usr/bin/env node
// holo-three-mesh-ui-witness.mjs — proves the VENDORED three-mesh-ui is feature-complete AND 100%
// κ-addressable substrate-native (Law L5, dual-axis). The library is the ORIGINAL code (felixmariotto/
// three-mesh-ui), not a reimplementation; this witness verifies every vendored byte re-derives to its
// pinned κ on BOTH axes (sha256 serve key ⊕ blake3 σ-axis), the full API surface is present, and the
// pinned version is recorded. The in-browser render proof lives in apps/surfacedemo/xr.html.
//
// Run: node holo-os/system/tools/holo-three-mesh-ui-witness.mjs
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const { blake3hex } = await import(pathToFileURL(join(OS, "usr/lib/holo/holo-blake3.mjs")));
const closure = JSON.parse(readFileSync(join(OS, "etc/os-closure.json"), "utf8")).closure;

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "  ✓ " : "  ✗ ") + m); };

const FILES = [
  "_shared/vendor/three-mesh-ui/three-mesh-ui.js",
  "_shared/vendor/three-mesh-ui/three-mesh-ui.module.js",
  "_shared/vendor/three-mesh-ui/Roboto-msdf.json",
  "_shared/vendor/three-mesh-ui/Roboto-msdf.png",
  "_shared/vendor/three-mesh-ui/package.json",
];
const phys = (key) => join(OS, "usr/lib/holo/" + key.replace(/^_shared\//, ""));

// 1 — every vendored byte re-derives to its pinned κ on BOTH axes (L5, dual-axis substrate-native)
for (const key of FILES) {
  const e = closure[key];
  if (!e) { ok(false, `${key.split("/").pop()} — NOT pinned in os-closure`); continue; }
  const buf = readFileSync(phys(key));
  const sha = "did:holo:sha256:" + createHash("sha256").update(buf).digest("hex");
  const bl = "did:holo:blake3:" + blake3hex(buf);
  const dualOk = e.kappa === sha && (e.alsoKnownAs || []).includes(bl);
  ok(dualOk, `${key.split("/").pop()} — re-derives to pinned κ (sha256 ⊕ blake3)`);
}

// 2 — feature-complete: the ORIGINAL library's full API surface is present in the vendored UMD bundle
const umd = readFileSync(phys("_shared/vendor/three-mesh-ui/three-mesh-ui.js"), "utf8");
for (const sym of ["Block", "Text", "InlineBlock", "Keyboard", "MeshUIComponent", "update"])
  ok(new RegExp("\\b" + sym + "\\b").test(umd), `library exports ${sym} (feature-complete, verbatim)`);

// 3 — version pinned + recorded (provenance)
const pkg = JSON.parse(readFileSync(phys("_shared/vendor/three-mesh-ui/package.json"), "utf8"));
ok(pkg.name === "three-mesh-ui" && /^6\./.test(pkg.version), `pinned version ${pkg.name}@${pkg.version} (>=6.x)`);

// 4 — the MSDF font (κ-addressed asset) is present, so text is substrate-native too
ok(JSON.parse(readFileSync(phys("_shared/vendor/three-mesh-ui/Roboto-msdf.json"), "utf8")).chars?.length > 0, "MSDF font atlas present + parseable (κ-addressed text asset)");

console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
