#!/usr/bin/env node
// seal-gov.mjs — seal the host governance module (holo-gov.js) into the OS-wide κ-route closure, so
// the content-verify Service Worker (holo-fhs-sw.js) re-derives its bytes and REFUSES a mismatch
// (409, Law L5) like every other shared lib. holo-gov.js is the host that ENFORCES Holo Terms +
// Holo Privacy for every mounted holospace (the capability gate + the privacy broker, surfaced as one
// shield per app), so it must itself be a self-verifying, content-addressed object — not a path-served
// file that escapes verification. Closure-only (it is a _shared lib, not a boot loader → no boot pin).
// Adds the key once; thereafter reseal-drift.mjs (sha256 axis) + seal-substrate.mjs (σ-axis) maintain
// it from the served bytes like any other entry. Mirrors seal-shell.mjs. Re-run is idempotent.
//
//   node tools/seal-gov.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const FILE = join(OS, "usr/lib/holo/holo-gov.js");
const CLOSURE = join(OS, "etc/os-closure.json");
const KEY = "_shared/holo-gov.js";                          // the serve-rel path (fhsMap → usr/lib/holo/holo-gov.js)

const { blake3hex } = await import(pathToFileURL(join(OS, "usr/lib/holo/holo-blake3.mjs")));
const { atlasCoord, ATLAS } = await import(pathToFileURL(join(OS, "usr/lib/holo/holo-atlas-coord.mjs")));

const buf = readFileSync(FILE);
const dig = createHash("sha256").update(buf).digest();
const hex = dig.toString("hex");
const blakeHex = blake3hex(buf);
const entry = {
  kappa: "did:holo:sha256:" + hex,
  sri: "sha256-" + dig.toString("base64"),
  multibase: "u" + Buffer.concat([Buffer.from([0x12, 0x20]), dig]).toString("base64url"),
  bytes: buf.length,
  alsoKnownAs: ["did:holo:blake3:" + blakeHex],             // the unified UOR substrate anchor (σ-axis, W3C DID Core)
  "holo:within": ATLAS.object,
  "holo:atlasCoordinate": atlasCoord(blakeHex),
};

const closure = JSON.parse(readFileSync(CLOSURE, "utf8"));
closure.closure = closure.closure || {};
const had = !!closure.closure[KEY];
closure.closure[KEY] = entry;
writeFileSync(CLOSURE, JSON.stringify(closure, null, 2) + "\n");

console.log("sealed the host governance module → the UOR substrate");
console.log(`  κ (serve)     ${entry.kappa}`);
console.log(`  κ (substrate) did:holo:blake3:${blakeHex}   ← σ-axis, dual-axis anchored`);
console.log(`  closure       ${KEY}  (${had ? "updated" : "added"}) · ${Object.keys(closure.closure).length} κ · content-verify SW, Law L5`);
