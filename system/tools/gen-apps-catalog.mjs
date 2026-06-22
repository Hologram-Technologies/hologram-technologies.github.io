#!/usr/bin/env node
// gen-apps-catalog.mjs — generate the Hologram Apps catalog (apps/index.jsonld) by DISCOVERING every
// app package in the repo and reading its holospace.json, so the catalog is OS2's own and always lists
// exactly the apps that exist. Each entry is a schema:SoftwareApplication addressed by its did:holo
// (Law L1 — κ pulled from os/etc/os-closure.json by identifier; slug-addressed if not yet pinned) with
// a dcat:landingPage the OS frame launches. Writes the catalog.
//
//   node tools/gen-apps-catalog.mjs

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { shareCardPage, shareCardSvg } from "../os/usr/lib/holo/holo-share-card.mjs";   // κ-Open Phase 4: per-app unfurl cards
import { kappaToWords } from "../os/usr/lib/holo/holo-words.mjs";                        // Three Words: κ → speakable address

const here = dirname(fileURLToPath(import.meta.url));               // tools/
const APPS = process.env.HOLO_APPS_REPO || join(here, "../../../holo-apps");   // sibling apps repo
const OS2 = process.env.HOLO_OS_DIR || join(here, "../os");                    // holo-os/system/os (the / root)

// identifier → content-address κ, from the OS-wide closure.
const kByIdent = {};
try { for (const a of (JSON.parse(readFileSync(join(OS2, "etc/os-closure.json"), "utf8")).apps || [])) if (a.identifier && a.root) kByIdent[a.identifier] = a.root; } catch {}

const KAPPA_RE = /^did:holo:sha256:[0-9a-f]{64}$/;
// the pinned BIP-39 wordlist (its sha256 IS its κ) → each app's deterministic three-word address.
const WORDLIST = readFileSync(join(OS2, "usr/lib/holo/words/bip39-english.txt"), "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
// the app's TRUE root κ is the content address sealed in its own holospace.lock.json (Law L1) —
// the authoritative source. os-closure is a secondary mirror; slug is the honest last resort.
const lockRoot = (dir) => {
  try { const r = JSON.parse(readFileSync(join(APPS, "apps", dir, "holospace.lock.json"), "utf8")).root;
    return KAPPA_RE.test(r) ? r : null; } catch { return null; }
};

// Individual bootable OS images (FreeDOS, Windows 95, KolibriOS, …) are NOT top-level launcher apps —
// they boot from inside the emulator MENU apps (Holo V86 / X86 / 3D / QEMU), each of which has its own
// catalog.json. Listing all ~100 here would bury the real apps and flood search with near-duplicate OS
// names. They stay fully κ-addressable by their own root (a κ link still opens them); they're just not
// top-level icons. Discriminator: a `org.hologram.V86*` id or an "<OS> on (the) v86 —" summary.
const isOsImage = (d) => /^org\.hologram\.V86/.test(d.id || "") || /\bon (?:the )?v86\b/i.test(d.summary || "");

// Category corrections (catalog-only — applicationCategory is index metadata, never part of the app's
// κ identity, so this re-tags WITHOUT changing any κ). Fixes clear mis-tags so each category chip shows
// apps that genuinely belong (e.g. miners/explorers are Finance, storage is Utilities — not "Comms").
const CATEGORY_FIX = {
  // web3 → Finance
  "org.hologram.HoloBrc": "FinanceApplication",        // BRC miner
  "org.hologram.HoloBtc": "FinanceApplication",        // BTC miner
  "org.hologram.HoloEtherscan": "FinanceApplication",  // chain explorer
  "org.hologram.HoloEVM": "FinanceApplication",        // EVM, not generic Dev
  "org.hologram.HoloTrade": "FinanceApplication",
  // storage / infra → Utilities
  "org.hologram.HoloIpfs": "UtilitiesApplication",
  "org.hologram.HoloCloud": "UtilitiesApplication",
  "org.hologram.HoloHub": "UtilitiesApplication",      // the app hub, not Business
  "org.kde.PlasmaDesktop": "UtilitiesApplication",     // a desktop env, not its own "System"
  // AI (a real category, not a lonely "Productivity")
  "org.hologram.HoloQ": "AIApplication",
  "org.hologram.QvacSdk": "AIApplication",
  // docs/notes are Work, not "Business"
  "org.hologram.HoloDocs": "ProductivityApplication",
  "org.hologram.HoloNotepad": "ProductivityApplication",
  // misc
  "org.hologram.HoloGuide": "ReferenceApplication",    // a guide → Reference, not Social
};

// Display-name corrections (catalog-only, no κ change) — disambiguate duplicate names.
const NAME_FIX = {
  "org.hologram.HoloCodeDesktop": "Holo Code Desktop", // distinguish from the in-browser "Holo Code"
};

const dirs = readdirSync(join(APPS, "apps")).filter((d) => { try { return statSync(join(APPS, "apps", d)).isDirectory(); } catch { return false; } }).sort();
const dataset = []; const slug = []; let osImages = 0;
for (const dir of dirs) {
  const defPath = join(APPS, "apps", dir, "holospace.json");
  if (!existsSync(defPath)) { console.log(`  ⚠ ${dir} has no holospace.json — skipped`); continue; }
  const d = JSON.parse(readFileSync(defPath, "utf8"));
  if (isOsImage(d)) { osImages++; continue; }    // a sub-image of an emulator menu, not a launcher app
  const kappa = lockRoot(dir) || kByIdent[d.id] || `did:holo:slug:${d.id}`;
  if (!KAPPA_RE.test(kappa)) slug.push(dir);
  // three words a human can say — a deterministic projection of the κ (holo-words). Stamped only for a
  // real content κ (a slug has no bytes to derive from). schema:alternateName carries it for W3C agents;
  // it is a LABEL, never the identity (Law L1). The full κ stays @id and resolves directly.
  const words = KAPPA_RE.test(kappa) ? kappaToWords(kappa, WORDLIST) : null;
  dataset.push({
    "@id": kappa,                                 // identity = the app's content root κ (Law L1)
    "holo:root": kappa,                           // the standard's named single-address discovery key (SEC-6)
    "@type": d.type || ["schema:SoftwareApplication", "schema:WebApplication"],
    "schema:name": NAME_FIX[d.id] || d.name,
    "schema:identifier": d.id,                    // the human slug — a label, never the identity
    ...(words ? { "holo:words": words, "schema:alternateName": words } : {}),
    "schema:description": d.summary || "",
    "schema:applicationCategory": CATEGORY_FIX[d.id] || d.applicationCategory || "Utility",
    ...(Array.isArray(d.categories) && d.categories.length ? { "holo:categories": d.categories } : {}),
    ...(Array.isArray(d.keywords) && d.keywords.length ? { "schema:keywords": d.keywords } : {}),
    "dcat:landingPage": `apps/${dir}/${d.entry || "index.html"}`,
    ...(d.icon ? { "schema:image": `apps/${dir}/${d.icon}` } : {}),
    ...(Array.isArray(d.shared) && d.shared.length ? { "schema:softwareRequirements": d.shared } : {}),
  });
}

const catalog = {
  "@context": { schema: "https://schema.org/", dcat: "http://www.w3.org/ns/dcat#", dcterms: "http://purl.org/dc/terms/", holo: "https://hologram.os/ns#" },
  "@id": "https://hologram.os/apps",
  "@type": ["dcat:Catalog", "schema:DataCatalog"],
  "dcterms:title": "Hologram Apps — the content-addressed app catalog",
  "dcterms:description": "Each app is a self-contained holospace addressed by the did:holo of its content (Law L1); the OS indexes addresses, not locations; any byte re-derives (Law L5). Pin an app anywhere and it boots in the Hologram OS holospace frame from a single κ.",
  "dcat:dataset": dataset,
};
const body = JSON.stringify(catalog, null, 2) + "\n";
writeFileSync(join(APPS, "apps", "index.jsonld"), body);
console.log(`✓ wrote Hologram Apps/apps/index.jsonld — ${dataset.length} apps, each with did:holo + dcat:landingPage (${osImages} emulator OS images excluded — they boot from the menu apps)`);
// VENDOR the served copy into the OS image. fhsMap aliases the launcher's `apps/index.jsonld` to
// `usr/share/holospaces/index.jsonld`, so this is the file the Service Worker (and any static prod host)
// actually serves — the dev server prefers the live Apps-repo copy via readRel, but the SW does not.
// Without this, the SW serves a stale 9-app FHS dir manifest and every app icon opens an empty tab.
const served = join(OS2, "usr/share/holospaces/index.jsonld");
writeFileSync(served, body);
console.log(`✓ vendored served catalog → os/usr/share/holospaces/index.jsonld (what the SW/prod serves)`);
if (slug.length) console.log(`  slug-addressed (not yet κ-pinned in os-closure): ${slug.join(", ")}`);

// ── VENDOR EACH APP'S LOCK CLOSURE (so apps STREAM by κ on the SW/static-prod path) ───────────────
// A launcher app's BODY is never copied into the OS image — at 16 GB+ across the 49 apps (OS images,
// model weights) that's impossible, and it would defeat content addressing. Instead each app streams
// by κ: the Service Worker re-derives every app byte against the κ pinned in that app's
// holospace.lock.json, recovering it from any source (the apps-holo CDN, IPFS, a mesh peer) and
// refusing a mismatch (Law L5). For that the SW needs the PINS, so it folds `apps/<id>/holospace.lock.json`
// (ensureAppLock) — which fhsMap routes to `usr/share/holospaces/<id>/holospace.lock.json`. The dev
// server masks the gap (it serves app bytes live from the Apps repo), but on the SW/static host an app
// with NO vendored lock has NO κ pins: its bytes can't stream, can't verify, and coherence reports them
// as "unresolved pins" — the broken-pane symptom. holo-linux already ships its lock here and boots
// serverlessly; this vendors the SAME artifact for every launcher app so they all stream identically.
let vendoredLocks = 0; const noLock = []; const lockMismatch = [];
for (const a of dataset) {
  const dir = String(a["dcat:landingPage"]).split("/")[1];                 // apps/<dir>/index.html → <dir>
  const src = join(APPS, "apps", dir, "holospace.lock.json");
  if (!existsSync(src)) { noLock.push(dir); continue; }                    // unpinned app → can't stream by κ (built but not sealed)
  const lock = JSON.parse(readFileSync(src, "utf8"));
  // the vendored lock MUST pin the same root the catalog advertises, or the SW would fold pins for a
  // different build than the icon/launch entry — refuse the divergence rather than ship a split identity.
  if (KAPPA_RE.test(a["@id"]) && lock.root && lock.root !== a["@id"]) { lockMismatch.push(`${dir} (catalog ${a["@id"].slice(-12)} ≠ lock ${String(lock.root).slice(-12)})`); }
  const outDir = join(OS2, "usr/share/holospaces", dir);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "holospace.lock.json"), JSON.stringify(lock, null, 2) + "\n");
  vendoredLocks++;
}
if (lockMismatch.length) throw new Error(`gen-apps-catalog: vendored lock root ≠ catalog root for: ${lockMismatch.join("; ")} — re-run relock-app + gen so the κ pins agree.`);
console.log(`✓ vendored ${vendoredLocks} app lock(s) → os/usr/share/holospaces/<id>/holospace.lock.json (the κ pins that let each app STREAM by content address)`);
if (noLock.length) console.log(`  ⚠ no holospace.lock.json (can't stream by κ until sealed): ${noLock.join(", ")}`);

// ── BAKE PER-APP SHARE CARDS (κ-Open Phase 4) ──────────────────────────────────────────────────────
// The dev server injects the /~<app> unfurl dynamically; a static prod host (GitHub Pages) cannot. So bake
// a STATIC /~<app>/index.html (OG head + boot into the live κ projection) + /~<app>/og.svg (content-derived
// κ-identicon) per app into the served os/ tree. fhsMap routes /~<app> → these; a crawler reads the OG head,
// a human is booted into the app. Uses the SAME holo-share-card module as the dev server → byte-no-drift
// (Law L2). Origin-relative URLs (most crawlers resolve og:image against the page URL; strict ones can be
// served absolute by a host that injects an origin — the dev server does).
let bakedCards = 0;
for (const a of dataset) {
  const dir = String(a["dcat:landingPage"]).split("/")[1];
  if (!dir) continue;
  const id = dir, name = a["schema:name"], summary = a["schema:description"] || "", kappa = a["@id"];
  const outDir = join(OS2, "~" + id);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "index.html"), shareCardPage({ id, name, summary, kappa }));
  writeFileSync(join(outDir, "og.svg"), shareCardSvg({ kappa, name }));
  bakedCards++;
}
console.log(`✓ baked ${bakedCards} per-app share card(s) → os/~<app>/{index.html,og.svg} (prod static unfurl, served by fhsMap)`);

// ── HOLOSPACE TEMPLATES (First Light) ────────────────────────────────────────────────────────────
// A holospace template is a curated COMPOSITION: one κ that opens a single tab nesting several apps.
// Members are referenced by the app's own identifier; here we STAMP each member's root κ (holo:appRoot)
// from the app set we just built (compose by reference — never copy bytes) and REFUSE any member that
// is not a real app, so a template can never point at a phantom. Same generate→vendor discipline as the
// app catalog: the served copy under usr/share/holospaces/ is what the SW/prod actually serves.
const idToRoot = {};                                  // schema:identifier → root κ (or slug), from the apps above
for (const a of dataset) if (a["schema:identifier"]) idToRoot[a["schema:identifier"]] = a["@id"];
const tplSrc = join(APPS, "apps", "holospaces.jsonld");
if (existsSync(tplSrc)) {
  const tpl = JSON.parse(readFileSync(tplSrc, "utf8"));
  const LAYOUTS = new Set(["split-h", "split-v", "primary-rail", "grid-2x2", "stack", "single"]);
  let missing = 0, stamped = 0;
  for (const t of (tpl["dcat:dataset"] || [])) {
    if (!LAYOUTS.has(t["holo:layout"])) { console.log(`  ⚠ holospace "${t["schema:name"]}" has unknown layout "${t["holo:layout"]}"`); }
    for (const m of (t["holo:members"] || [])) {
      const ref = m["holo:app"];
      const root = idToRoot[ref];
      if (!root) { console.log(`  ✗ holospace "${t["schema:name"]}" references unknown app "${ref}"`); missing++; continue; }
      m["holo:appRoot"] = root;                       // stamp the content address (Law L1) — the member is now κ-pinned to a real app
      stamped++;
    }
  }
  if (missing) throw new Error(`gen-apps-catalog: ${missing} holospace member(s) reference an app that does not exist — refusing to write a broken composition.`);
  const tplBody = JSON.stringify(tpl, null, 2) + "\n";
  writeFileSync(tplSrc, tplBody);                                                   // source, with member κs stamped
  writeFileSync(join(OS2, "usr/share/holospaces/holospaces.jsonld"), tplBody);      // vendored served copy (SW/prod)
  console.log(`✓ wrote Hologram Holospaces/apps/holospaces.jsonld + vendored served copy — ${(tpl["dcat:dataset"] || []).length} templates, ${stamped} members κ-stamped`);
} else {
  console.log("  (no apps/holospaces.jsonld — skipping holospace templates)");
}
