#!/usr/bin/env node
// gen-apps-catalog.local.mjs — IDENTICAL to gen-apps-catalog.mjs (same discovery/entry/catalog logic,
// byte-for-byte), with ONLY the two path constants repointed at THIS consolidated mirror tree. The
// shipped gen-apps-catalog.mjs hardcodes sibling folders ("Hologram Apps" · "Hologram OS2") that exist
// on the canonical authoring machine but not on this checkout; the apps + os-closure they need both
// live here under holo-apps/apps and holo-os/system/os. No logic is changed.
//
//   node tools/gen-apps-catalog.local.mjs

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const APPS = "C:/Users/pavel/Desktop/HOLOGRAM/holo-apps";
const OS2 = "C:/Users/pavel/Desktop/HOLOGRAM/holo-os/system/os";

// identifier → content-address κ, from the OS-wide closure.
const kByIdent = {};
try { for (const a of (JSON.parse(readFileSync(join(OS2, "etc/os-closure.json"), "utf8")).apps || [])) if (a.identifier && a.root) kByIdent[a.identifier] = a.root; } catch {}

const dirs = readdirSync(join(APPS, "apps")).filter((d) => { try { return statSync(join(APPS, "apps", d)).isDirectory(); } catch { return false; } }).sort();
const dataset = []; const slug = [];
for (const dir of dirs) {
  const defPath = join(APPS, "apps", dir, "holospace.json");
  if (!existsSync(defPath)) { console.log(`  ⚠ ${dir} has no holospace.json — skipped`); continue; }
  const d = JSON.parse(readFileSync(defPath, "utf8"));
  const kappa = kByIdent[d.id] || `did:holo:slug:${d.id}`;
  if (!kByIdent[d.id]) slug.push(dir);
  dataset.push({
    "@id": kappa,
    "@type": d.type || ["schema:SoftwareApplication", "schema:WebApplication"],
    "schema:name": d.name,
    "schema:identifier": d.id,
    "schema:description": d.summary || "",
    "schema:applicationCategory": d.applicationCategory || "Utility",
    "dcat:landingPage": `apps/${dir}/${d.entry || "index.html"}`,
    ...(d.icon ? { "schema:image": `apps/${dir}/${d.icon}` } : {}),
    ...(Array.isArray(d.shared) && d.shared.length ? { "schema:softwareRequirements": d.shared } : {}),
  });
}

const catalog = {
  "@context": { schema: "https://schema.org/", dcat: "http://www.w3.org/ns/dcat#", dcterms: "http://purl.org/dc/terms/" },
  "@id": "https://hologram.os/apps",
  "@type": ["dcat:Catalog", "schema:DataCatalog"],
  "dcterms:title": "Hologram Apps — the content-addressed app catalog",
  "dcterms:description": "Each app is a self-contained holospace addressed by the did:holo of its content (Law L1); the OS indexes addresses, not locations; any byte re-derives (Law L5). Pin an app anywhere and it boots in the Hologram OS holospace frame from a single κ.",
  "dcat:dataset": dataset,
};
writeFileSync(join(APPS, "apps", "index.jsonld"), JSON.stringify(catalog, null, 2) + "\n");
console.log(`✓ wrote holo-apps/apps/index.jsonld — ${dataset.length} apps, each with did:holo + dcat:landingPage`);
if (slug.length) console.log(`  slug-addressed (not yet κ-pinned in os-closure): ${slug.join(", ")}`);
