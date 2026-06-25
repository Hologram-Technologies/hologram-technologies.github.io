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

// CANONICAL-κ cutover (P2): BLAKE3 is the substrate's kappo() — the ONE canonical κ. Every entry now
// carries a top-level `blake3` PRIMARY (the address the verifier trusts), with sha256 demoted to a
// re-derivable BRIDGE alias (kappa/sri/multibase) kept ONLY so foreign-protocol boundaries and legacy
// `.holo/sha256/<hex>` links keep resolving. The blake3 κ is emitted on EVERY entry (not just ones that
// already had it) and additionally in W3C `alsoKnownAs` for legacy readers (SW BYBLAKE / cross-tool).
// The native Rust verifier already reads this top-level `blake3` field (kappa-route lib.rs); the SW reads
// it as of the P3 serve-authority change. Additive: sha stays, so no reader breaks before the cut-over.
const entry = (buf, old = {}) => {
  const dig = createHash("sha256").update(buf).digest();
  const blakeHex = blake3hex(buf);
  const e = {
    blake3: "did:holo:blake3:" + blakeHex,                 // canonical κ (Law L1) — PRIMARY axis
    kappa: "did:holo:sha256:" + dig.toString("hex"),       // BRIDGE alias (IPFS CID / GitHub asset / SRI / legacy .holo/sha256)
    sri: "sha256-" + dig.toString("base64"),               // BRIDGE: Subresource Integrity (browser-mandated)
    multibase: "u" + Buffer.concat([Buffer.from([0x12, 0x20]), dig]).toString("base64url"),  // BRIDGE: IPLD multihash (sha2-256)
    bytes: buf.length,
    alsoKnownAs: ["did:holo:blake3:" + blakeHex],          // W3C alias — legacy blake3 readers
  };
  // preserve (and freshly re-derive on the canonical axis) the atlas placement when the old entry carried it
  if (old["holo:within"]) e["holo:within"] = ATLAS.object;
  if (old["holo:atlasCoordinate"]) e["holo:atlasCoordinate"] = atlasCoord(blakeHex);
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
  // Drift on EITHER axis: the canonical did:holo:blake3 κ OR the did:holo:sha256 bridge alias. A file
  // resealed for one but not the other leaves an axis stale — which the verifier rejects (Law L5). The
  // canonical κ is the TOP-LEVEL `blake3` field; an OLD entry that predates the cutover (string, sha-only,
  // or carrying blake3 only in alsoKnownAs) is treated as drifted so it is UPGRADED to carry it. Skip only
  // when both axes already match AND the canonical top-level field is present — else both describe the bytes.
  const oldKappa = typeof old === "string" ? old : old.kappa;
  const oldTopBlake = (old && typeof old === "object" && typeof old.blake3 === "string") ? old.blake3 : null;
  if (e.kappa === oldKappa && e.blake3 === oldTopBlake) continue;
  drifted++;
  const axis = e.kappa !== oldKappa ? (e.blake3 !== oldTopBlake ? "blake3+sha256" : "sha256") : "blake3";
  const oldShow = (oldTopBlake || oldKappa || "(pre-cutover)");   // legacy string / sha-only / alsoKnownAs-only entries upgrade cleanly
  console.log(`  ↻ ${key} [${axis}]\n      ${oldShow.slice(0, 30)}… → ${e.blake3.slice(0, 30)}…`);
  if (!checkOnly) { closure[key] = e; resealed++; }
}
if (!checkOnly && resealed) writeFileSync(CLOSURE, JSON.stringify(doc, null, 2) + "\n");
console.log(`\n${drifted} drifted${checkOnly ? " (check only — nothing written)" : `, ${resealed} resealed`} · ${Object.keys(closure).length} κ in the closure`);
process.exit(checkOnly && drifted ? 1 : 0);
