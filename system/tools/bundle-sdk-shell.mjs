#!/usr/bin/env node
// bundle-sdk-shell.mjs — vendor the SDK/World desktop shell (the ONE canonical holospace shell) INTO
// the lean os/ image so a standalone static deploy boots it, not just the dev serve / full deploy. It
// copies the shell's app files + the apps catalog + every app icon from the separate Hologram Apps repo
// (and the one stray runtime module, holo-omni.mjs, from the original os/) to their FHS paths, then
// SEALS each into os/etc/os-closure.json so the content-verify Service Worker serves + re-derives them
// (Law L5). Idempotent: re-run after editing the shell. The other apps still resolve by κ from peers /
// the Apps repo — only the SHELL is enclosed in the image.
//
//   node tools/bundle-sdk-shell.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const APPS = "C:/Users/pavel/Desktop/Hologram Apps";
const ORIG = "C:/Users/pavel/Desktop/hologram-os/os";
const CLOSURE = join(OS, "etc/os-closure.json");

const entry = (buf) => {
  const dig = createHash("sha256").update(buf).digest();
  return { kappa: "did:holo:sha256:" + dig.toString("hex"), sri: "sha256-" + dig.toString("base64"),
    multibase: "u" + Buffer.concat([Buffer.from([0x12, 0x20]), dig]).toString("base64url"), bytes: buf.length };
};

const doc = JSON.parse(readFileSync(CLOSURE, "utf8"));
doc.closure = doc.closure || {};
let copied = 0, sealed = 0, missing = [];

// write `buf` → image `destRel`, and seal it in the closure under `key` (the serve-rel path the SW asks for)
const placeBytes = (buf, destRel, key) => {
  const out = join(OS, destRel);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buf); copied++;
  const e = entry(buf);
  if (!doc.closure[key] || doc.closure[key].kappa !== e.kappa) { doc.closure[key] = e; sealed++; }
};
// copy `src` → image `destRel`, and seal it in the closure under `key` (the serve-rel path the SW asks for)
const place = (src, destRel, key) => {
  if (!existsSync(src) || !statSync(src).isFile()) { missing.push(src); return; }
  placeBytes(readFileSync(src), destRel, key);
};

// 1 · the SDK shell's own files → usr/share/holospaces/sdk/ (key = the flat apps/sdk/* path)
const walk = (root, rel = "") => { const abs = join(root, rel); if (!existsSync(abs)) return [];
  return statSync(abs).isDirectory() ? readdirSync(abs).flatMap((n) => walk(root, rel ? rel + "/" + n : n)) : [rel]; };
for (const rel of walk(join(APPS, "apps/sdk")))
  place(join(APPS, "apps/sdk", rel), join("usr/share/holospaces/sdk", rel), "apps/sdk/" + rel);

// 2 · every app's icon.svg (the launcher tiles) → usr/share/holospaces/<id>/icon.svg.
// An app's bytes resolve by κ from peers / the Apps repo (only the SHELL is enclosed); the icon is the
// one per-app asset vendored into the image, so the set of vendored icons IS the set of launchable tiles.
const vendored = new Set();
for (const id of readdirSync(join(APPS, "apps"))) {
  const icon = join(APPS, "apps", id, "icon.svg");
  if (existsSync(icon) && statSync(icon).isFile()) { place(icon, join("usr/share/holospaces", id, "icon.svg"), `apps/${id}/icon.svg`); vendored.add(id); }
}

// 3 · the apps catalog → usr/share/holospaces/index.jsonld (key = apps/index.jsonld; fhsMap routes it here).
// Filter the live catalog to apps actually vendored above (one with a tile) so the served catalog never
// lists an app the image can't show — and enrich nothing it can: name · description · category · landing ·
// image come straight from the live entry, sorted by name for a stable, golden rhythm in the Play rail.
const PICK = ["@id", "@type", "schema:name", "schema:identifier", "schema:description", "schema:applicationCategory", "dcat:landingPage", "schema:image"];
const slugOf = (a) => String(a["dcat:landingPage"] || "").replace(/^apps\//, "").split("/")[0];
const live = JSON.parse(readFileSync(join(APPS, "apps/index.jsonld"), "utf8"));
// Keep the image's OWN catalog wrapper (the hosfs:Directory descriptor for /usr/share/holospaces) when it
// exists, swapping only the dataset — so the served bytes describe the directory they live in, and re-runs
// are byte-stable. Fall back to the live wrapper on a cold image that has no vendored catalog yet.
const dstCat = join(OS, "usr/share/holospaces/index.jsonld");
const cat = existsSync(dstCat) ? JSON.parse(readFileSync(dstCat, "utf8")) : live;
cat["dcat:dataset"] = (live["dcat:dataset"] || [])
  .filter((a) => vendored.has(slugOf(a)))
  .sort((a, b) => String(a["schema:name"]).localeCompare(String(b["schema:name"])))
  .map((a) => { const o = {}; for (const k of PICK) if (a[k] != null) o[k] = a[k]; o["hosfs:fhs"] = "/usr/share/holospaces/" + slugOf(a); return o; });
placeBytes(Buffer.from(JSON.stringify(cat, null, 2) + "\n"), "usr/share/holospaces/index.jsonld", "apps/index.jsonld");

// 4 · the one stray runtime module the shell imports from the root (../../holo-omni.mjs) → lib/
place(join(ORIG, "holo-omni.mjs"), "lib/holo-omni.mjs", "holo-omni.mjs");

writeFileSync(CLOSURE, JSON.stringify(doc, null, 2) + "\n");
console.log(`✓ copied ${copied} files into the image · sealed ${sealed} into os-closure (${Object.keys(doc.closure).length} κ total)`);
if (missing.length) console.log(`⚠ ${missing.length} source(s) not found: ${missing.slice(0, 6).join(", ")}`);
