#!/usr/bin/env node
// copy-content.mjs — fill the FHS graph with the manifest's 154 files, copied from the original
// os/ to their FHS paths, then PROVE each copied byte re-derives to its closure κ (Law L5) — i.e.
// the app's identity is identical at the new path (Law L1, location independence). _shared is
// copied once (deduped). The VM image is written as /boot κ-pins, not bytes. Reads os/, writes OS2.
//
//   node tools/copy-content.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sha256hex, sriOf } from "../os/usr/lib/holo/holo-uor.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = "C:/Users/pavel/Desktop/hologram-os/os";
const OS2 = join(here, "../os");
const hexOf = (k) => String(k).split(":").pop();

let copied = 0, bytes = 0, verified = 0, mismatches = [], missing = [];
const copy = (srcRel, destRel) => {
  const src = join(SRC, srcRel);
  if (!existsSync(src)) { missing.push(srcRel); return null; }
  const b = readFileSync(src);
  const out = join(OS2, destRel);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, b);
  copied++; bytes += b.length;
  return b;
};

// ── 1 · core holospace closures → FHS, verified against the lock κ ──
const CORE = ["world", "os", "browser", "search", "notepad", "docs", "workspace", "wallet", "ipfs"];
const sharedDone = new Set();
const destFor = (rel, id) => {
  if (rel.startsWith("_shared/")) return join("usr/lib/holo", rel.slice("_shared/".length));
  if (rel.startsWith(`apps/${id}/`)) { const sub = rel.slice(`apps/${id}/`.length); return id === "boot" ? join("boot", sub) : join("usr/share/holospaces", id, sub); }
  return null;
};
for (const id of [...CORE, "boot"]) {
  const lockPath = join(SRC, "apps", id, "holospace.lock.json");
  if (!existsSync(lockPath)) continue;
  const closure = JSON.parse(readFileSync(lockPath, "utf8")).closure || {};
  for (const [rel, meta] of Object.entries(closure)) {
    if (rel.startsWith("_shared/")) { if (sharedDone.has(rel)) continue; sharedDone.add(rel); }
    const destRel = destFor(rel, id);
    if (!destRel) continue;
    const b = copy(rel, destRel);
    if (!b) continue;
    if (meta.kappa && sha256hex(b) === hexOf(meta.kappa) && (!meta.sri || sriOf(b) === meta.sri)) verified++;
    else if (meta.kappa) mismatches.push(`${id}:${rel}`);
  }
}

// ── 2 · OS-level spine (src rel → FHS dest dir) ──
const walk = (rel) => { const abs = join(SRC, rel); if (!existsSync(abs)) return []; const s = statSync(abs);
  return s.isFile() ? [rel] : readdirSync(abs).flatMap((n) => walk(join(rel, n).replace(/\\/g, "/"))); };
const SPINE = [
  ["usr/share/frame", ["holospace.html", "home.html", "find.html"]],
  ["boot", ["holo-boot-sw.js", "coi-serviceworker.min.js"]],
  ["lib", ["holo-sw.js", "holo-launch.mjs", "holo-boot-sw-register.mjs", "browser-sw.js"]],
  ["sbin", ["holo-resolver.mjs", "holo-sources.mjs", "holo-peers.mjs", "holo-uor.mjs", "holo-object.mjs", "holo-wire.mjs"]],
  ["etc", ["manifest.webmanifest", "os-closure.json"]],
  ["usr/share/icons", ["icon-192.png", "icon-512.png"]],
];
for (const [destDir, items] of SPINE)
  for (const item of items)
    for (const rel of walk(item)) copy(rel, join(destDir, rel.split("/").pop()));
for (const rel of walk(".well-known")) copy(rel, join(".well-known", rel.slice(".well-known/".length)));
for (const rel of walk("pkg")) copy(rel, join("usr/lib/pkg", rel.slice("pkg/".length)));

// ── 3 · /boot κ-pins: descriptors for the VM image (resolved at boot, not shipped) ──
const PIN_CTX = ["https://www.w3.org/ns/did/v1", { schema: "https://schema.org/", prov: "http://www.w3.org/ns/prov#", dcterms: "http://purl.org/dc/terms/", hosfs: "https://hologram.os/ns/fs#" }];
const pin = (hex, name, type, file) => {
  const digest = Buffer.from(hex, "hex");
  const obj = { "@context": PIN_CTX, "@id": `did:holo:sha256:${hex}`, "@type": [type, "prov:Entity"],
    "schema:name": name, "hosfs:fhs": `/boot/${file}`, "hosfs:kind": "pin",
    "dcterms:description": "Resolved by content from cache → peers/IPFS → origin at boot; re-derived to this κ before use (Law L5). Not shipped in the image.",
    digestSRI: "sha256-" + digest.toString("base64"),
    digestMultibase: "u" + Buffer.concat([Buffer.from([0x12, 0x20]), digest]).toString("base64url") };
  writeFileSync(join(OS2, "boot", file), JSON.stringify(obj, null, 2) + "\n"); copied++;
};
pin("a7bb1f02a5ac96371ecb402645d25e1cc7cda18c5280f0828f0e31c4fb16162e", "Linux kernel", "schema:SoftwareApplication", "kernel.uor.json");
pin("352acc3ce0e18a8eecba8cebabbfac8f5d264e89513a883c1566d91d15491462", "Root filesystem", "schema:MediaObject", "rootfs.uor.json");

const fmt = (b) => (b / 1048576).toFixed(2) + " MB";
console.log(`✓ copied ${copied} files (${fmt(bytes)})`);
console.log(`✓ Law-L5 content verification: ${verified} closure files re-derive to their κ at the new FHS path${mismatches.length ? ` · ${mismatches.length} MISMATCH` : " · 0 mismatches"}`);
if (mismatches.length) console.log(`  mismatches: ${mismatches.slice(0, 8).join(", ")}`);
if (missing.length) console.log(`⚠ ${missing.length} closure files not found on disk: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? " …" : ""}`);
