#!/usr/bin/env node
// seal-shell.mjs — root the ONE canonical holospace shell in the UOR substrate. shell.html is OS
// chrome (a frame loader), so — like every frame — it must be a self-verifying, content-addressed
// object, not a file served by path that escapes verification. This seals it BOTH ways:
//   1 · into the OS-wide κ-route closure (os/etc/os-closure.json), keyed by its serve-rel path →
//       { kappa, sri, multibase, bytes } — so it resolves by content at /.holo/sha256/<hex> and the
//       content-verify Service Worker (holo-fhs-sw.js) re-derives its bytes and REFUSES a mismatch
//       (409, Law L5);
//   2 · into the boot-manifest's loader pins (boot/boot/boot-manifest.json) — so rEFInd re-derives
//       the loader's bytes at boot and REFUSES a κ mismatch (Secure Boot, Law L5).
// Re-run after any edit to shell.html. Mirrors seal-login-closure.mjs (the canonical frame seal).
//
//   node tools/seal-shell.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const SHELL = join(OS, "usr/share/frame/shell.html");
const CLOSURE = join(OS, "etc/os-closure.json");
const MANIFEST = join(OS, "boot/boot/boot-manifest.json");
const KEY = "shell.html";                                   // the serve-rel path (served at /shell.html)
// the substrate σ-axis: BLAKE3 over the raw bytes, byte-identical to the upstream substrate's kappa()
// (KAT-proven in holo-blake3-witness.mjs). Upstream identity is BLAKE3/SPINE-2 (CC-51); the sha256
// did:holo is the OS-serving + interop projection (CC-63). Dual-axis = the gated corpus convention.
const { blake3hex } = await import(pathToFileURL(join(OS, "usr/lib/holo/holo-blake3.mjs")));
const { atlasCoord, ATLAS } = await import(pathToFileURL(join(OS, "usr/lib/holo/holo-atlas-coord.mjs")));

const buf = readFileSync(SHELL);
const dig = createHash("sha256").update(buf).digest();
const hex = dig.toString("hex");
const blakeHex = blake3hex(buf);
const entry = {
  kappa: "did:holo:sha256:" + hex,                          // the OS κ-route serving key (sha256)
  sri: "sha256-" + dig.toString("base64"),
  multibase: "u" + Buffer.concat([Buffer.from([0x12, 0x20]), dig]).toString("base64url"),
  bytes: buf.length,
  alsoKnownAs: ["did:holo:blake3:" + blakeHex],             // the UNIFIED UOR SUBSTRATE anchor (σ-axis, W3C DID Core)
  "holo:within": ATLAS.object,
  "holo:atlasCoordinate": atlasCoord(blakeHex),             // the shell's self-verifying point in the finite torus (a point in — and itself an — atlas)
};

// 1 · seal into the κ-route closure (the content-verify Service Worker, Law L5)
const closure = JSON.parse(readFileSync(CLOSURE, "utf8"));
closure.closure = closure.closure || {};
const hadClosure = !!closure.closure[KEY];
closure.closure[KEY] = entry;
writeFileSync(CLOSURE, JSON.stringify(closure, null, 2) + "\n");

// 2 · pin the loader for Secure Boot (rEFInd re-derives + refuses a mismatch, Law L5)
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
manifest.loaders = manifest.loaders || {};
const hadPin = !!manifest.loaders[KEY];
manifest.loaders[KEY] = "sha256:" + hex;
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");

console.log("sealed the canonical holospace shell → the UOR substrate");
console.log(`  κ (serve)  ${entry.kappa}`);
console.log(`  κ (substrate) did:holo:blake3:${blakeHex}   ← anchored on the unified UOR substrate (σ-axis)`);
console.log(`  closure    ${KEY}  (${hadClosure ? "updated" : "added"}) · ${Object.keys(closure.closure).length} κ · content-verify SW, Law L5`);
console.log(`  boot pin   ${KEY}  (${hadPin ? "updated" : "added"}) · Secure Boot, Law L5`);
