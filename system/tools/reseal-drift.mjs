#!/usr/bin/env node
// reseal-drift.mjs — bring os/etc/os-closure.json back in step with the OS image it pins. The
// content-verify Service Worker (holo-fhs-sw.js) re-derives every in-scope byte to its κ and
// REFUSES a mismatch (409, Law L5). So after any served file is edited — or after a generator
// like repin-boot-loaders.mjs rewrites boot-manifest.json — that file's pin in the closure goes
// stale and the SW refuses the (legitimately) new bytes. This recomputes, for EVERY closure key,
// the κ of the bytes the κ-route actually serves (resolved by the one shared fhsMap), and reseals
// ONLY the keys that drifted — printing old→new for each so the change is auditable. Missing files
// (apps that live in the separate Apps repo, not this lean image) are left untouched: they 404 /
// fall back, they never 409. Pass --check to report drift without writing (exit 1 if any).
//
//   node tools/reseal-drift.mjs            # reseal drifted keys
//   node tools/reseal-drift.mjs --check    # report only (CI / pre-commit)

import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { fhsMap } from "../os/lib/holo-fhs-map.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// Target the source os/ by default; HOLO_RESEAL_DIR points it at a mirror (the tauri dist) so the SAME
// dual-axis drift logic reseals that tree against ITS OWN bytes — used by reseal.mjs's dist-mirror phase.
const OS = process.env.HOLO_RESEAL_DIR ? resolve(process.env.HOLO_RESEAL_DIR) : join(here, "../os");
const CLOSURE = join(OS, "etc/os-closure.json");
const checkOnly = process.argv.includes("--check");
// the substrate σ-axis + finite-torus coordinate, so a reseal PRESERVES the dual-axis anchoring
// (did:holo:sha256 serve key ⊕ did:holo:blake3 substrate anchor ⊕ atlas placement), never strips it.
const { blake3hex } = await import(pathToFileURL(join(OS, "usr/lib/holo/holo-blake3.mjs")));
const { atlasCoord, ATLAS } = await import(pathToFileURL(join(OS, "usr/lib/holo/holo-atlas-coord.mjs")));

const entry = (buf, old = {}) => {
  const dig = createHash("sha256").update(buf).digest();
  const e = {
    kappa: "did:holo:sha256:" + dig.toString("hex"),
    sri: "sha256-" + dig.toString("base64"),
    multibase: "u" + Buffer.concat([Buffer.from([0x12, 0x20]), dig]).toString("base64url"),
    bytes: buf.length,
  };
  // preserve (and freshly re-derive) the σ-axis anchor + atlas coordinate when the old entry carried them
  if (Array.isArray(old.alsoKnownAs) && old.alsoKnownAs.some((a) => /blake3/.test(String(a)))) {
    const blakeHex = blake3hex(buf);
    e.alsoKnownAs = [...old.alsoKnownAs.filter((a) => !/blake3/.test(String(a))), "did:holo:blake3:" + blakeHex];
    if (old["holo:within"]) e["holo:within"] = ATLAS.object;
    if (old["holo:atlasCoordinate"]) e["holo:atlasCoordinate"] = atlasCoord(blakeHex);
  }
  return e;
};

const doc = JSON.parse(readFileSync(CLOSURE, "utf8"));
const closure = doc.closure || {};
let drifted = 0, resealed = 0;
for (const [key, old] of Object.entries(closure)) {
  const phys = fhsMap(key) || key;   // null-mapped paths (e.g. splash/splash-manifest.json) serve literally
  const abs = join(OS, phys);
  if (!existsSync(abs) || !statSync(abs).isFile()) continue;     // missing → not served → never 409
  const e = entry(readFileSync(abs), old);
  // Drift on EITHER axis: the did:holo:sha256 serve key OR the did:holo:blake3 substrate anchor
  // (alsoKnownAs). A file resealed for sha256 but not blake3 (or carrying a blake3 anchor from an
  // older byte-state) leaves the σ-axis stale — which the substrate witness rejects (Law L5 on the
  // unified axis). Reseal when either differs so both axes always describe the SAME current bytes.
  const ob = (old.alsoKnownAs || []).find((a) => /blake3/.test(String(a))) || null;
  const nb = (e.alsoKnownAs || []).find((a) => /blake3/.test(String(a))) || null;
  if (e.kappa === old.kappa && ob === nb) continue;
  drifted++;
  const axis = e.kappa !== old.kappa ? (ob !== nb ? "sha256+blake3" : "sha256") : "blake3";
  console.log(`  ↻ ${key} [${axis}]\n      ${old.kappa.slice(0, 30)}… → ${e.kappa.slice(0, 30)}…`);
  if (!checkOnly) { closure[key] = e; resealed++; }
}
if (!checkOnly && resealed) writeFileSync(CLOSURE, JSON.stringify(doc, null, 2) + "\n");
console.log(`\n${drifted} drifted${checkOnly ? " (check only — nothing written)" : `, ${resealed} resealed`} · ${Object.keys(closure).length} κ in the closure`);
process.exit(checkOnly && drifted ? 1 : 0);
