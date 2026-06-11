#!/usr/bin/env node
// seal-login-closure.mjs — make the canonical login gateway 100% UOR content-addressable: add
// every new login-chain file to the OS-wide κ-route closure (os/etc/os-closure.json) keyed by
// its serve-rel path → { kappa, sri, multibase, bytes }, exactly the shape the existing closure
// uses. Once sealed, each byte resolves by content at /.holo/sha256/<hex> and re-derives to its
// κ (Law L5) — the greeter, its runtime, the self-sovereign identity layer, and the real SDDM
// maldives theme are all addressed by what they ARE, not where they live.
//
//   node tools/seal-login-closure.mjs

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const CLOSURE = join(OS, "etc/os-closure.json");

// serve-rel key → physical FHS path (mirrors holo-serve-fhs fhsOf, inverted).
const FILES = {
  "login.html": "usr/share/frame/login.html",
  "splash.html": "usr/share/frame/splash.html",                 // Plymouth splash (absorbed into OS2)
  "workspace.html": "usr/share/frame/workspace.html",           // the Monaco workspace loader (absorbed)
  "_shared/holo-qml.mjs": "usr/lib/holo/holo-qml.mjs",          // the QML engine the greeter runs on
  "_shared/holo-sddm.js": "usr/lib/holo/holo-sddm.js",
  "_shared/holo-identity.mjs": "usr/lib/holo/holo-identity.mjs",
  "_shared/holo-host.mjs": "usr/lib/holo/holo-host.mjs",
  "etc/sddm.conf": "etc/sddm.conf",
  "usr/share/sddm/greeter.uor.json": "usr/share/sddm/greeter.uor.json",   // the agent-facing greeter descriptor
};
// the real SDDM theme + components are addressed at their true FHS path (key === physical).
const walk = (rel) => { const abs = join(OS, rel); if (!existsSync(abs)) return [];
  return statSync(abs).isDirectory() ? readdirSync(abs).flatMap((n) => walk(rel + "/" + n)) : [rel]; };
for (const rel of [...walk("usr/share/sddm/themes/maldives"), ...walk("usr/share/sddm/themes/holo"), ...walk("usr/share/sddm/components/2.0"), ...walk("usr/share/plymouth/themes")]) FILES[rel] = rel;

const entry = (buf) => {
  const dig = createHash("sha256").update(buf).digest();
  return {
    kappa: "did:holo:sha256:" + dig.toString("hex"),
    sri: "sha256-" + dig.toString("base64"),
    multibase: "u" + Buffer.concat([Buffer.from([0x12, 0x20]), dig]).toString("base64url"),
    bytes: buf.length,
  };
};

const doc = JSON.parse(readFileSync(CLOSURE, "utf8"));
doc.closure = doc.closure || {};
let added = 0, updated = 0;
for (const [key, rel] of Object.entries(FILES)) {
  const abs = join(OS, rel);
  if (!existsSync(abs) || !statSync(abs).isFile()) continue;
  const e = entry(readFileSync(abs));
  if (doc.closure[key]) { if (doc.closure[key].kappa !== e.kappa) { doc.closure[key] = e; updated++; } }
  else { doc.closure[key] = e; added++; }
  console.log(`${doc.closure[key].kappa.slice(0, 26)}…  ${key}`);
}
writeFileSync(CLOSURE, JSON.stringify(doc, null, 2) + "\n");
console.log(`\nsealed ${added} new + ${updated} updated → ${Object.keys(doc.closure).length} κ in the closure`);
