#!/usr/bin/env node
// fetch-space-splash.mjs — vendor 12 beautiful, public-domain space photos for the κ-Open splash rotation.
//
// The splash must stay SERVERLESS + INSTANT + OFFLINE, so backgrounds are VENDORED into the sealed tree
// (never hotlinked). Source = NASA's image library (images-api.nasa.gov) — public domain (no licensing /
// attribution burden) and genuinely gorgeous (Hubble/Webb/planetary). Each image is web-optimized with
// sharp (cover-cropped to a 16:9-ish 2560×1440, mozjpeg q82) so 12 backgrounds add only a few MB.
//
//   node tools/fetch-space-splash.mjs        # writes os/usr/share/wallpapers/space/01..12.jpg
//
// Re-runnable: overwrites the set. After running, the splash picks one at random per boot.

import sharp from "sharp";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "../os/usr/share/wallpapers/space");
mkdirSync(OUT, { recursive: true });

const W = 2560, H = 1440, QUALITY = 82, NEED = 12;

// Curated search terms → beautiful, photographic deep-space + planetary imagery (avoid diagrams/charts).
const TERMS = [
  "carina nebula", "pillars of creation", "spiral galaxy", "orion nebula", "helix nebula",
  "andromeda galaxy", "star cluster", "saturn cassini", "jupiter", "earth from space aurora",
  "horsehead nebula", "milky way", "supernova remnant", "galaxy cluster hubble", "crab nebula",
  "ring nebula", "lagoon nebula", "tarantula nebula",
];

const api = (q) => `https://images-api.nasa.gov/search?q=${encodeURIComponent(q)}&media_type=image`;
const toOrig = (href) => href.replace(/~(thumb|small|medium|large)\.(jpg|jpeg|png)/i, "~orig.$2");

async function fetchJson(url) { const r = await fetch(url, { signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }
async function fetchBuf(url) { const r = await fetch(url, { signal: AbortSignal.timeout(45000) }); if (!r.ok) throw new Error("HTTP " + r.status); return Buffer.from(await r.arrayBuffer()); }

// gather candidate image URLs (deduped by nasa_id), a few per term, best-size first
async function candidates() {
  const seen = new Set(), out = [];
  for (const term of TERMS) {
    try {
      const j = await fetchJson(api(term));
      const items = (j.collection && j.collection.items) || [];
      for (const it of items.slice(0, 4)) {
        const id = it.data && it.data[0] && it.data[0].nasa_id;
        const href = it.links && it.links[0] && it.links[0].href;
        if (!id || !href || seen.has(id)) continue;
        seen.add(id);
        out.push({ id, term, orig: toOrig(href), preview: href });
      }
    } catch (e) { console.log(`  · search "${term}" failed: ${e.message}`); }
  }
  return out;
}

// download → cover-crop to W×H → mozjpeg. Reject anything that isn't a decent landscape photo.
async function makeImage(c, idx) {
  let buf;
  try { buf = await fetchBuf(c.orig); } catch { buf = await fetchBuf(c.preview); }   // ~orig may 404 → preview
  const meta = await sharp(buf).metadata();
  if (!meta.width || meta.width < 1600 || meta.height < 900) throw new Error(`too small (${meta.width}×${meta.height})`);
  const out = join(OUT, String(idx).padStart(2, "0") + ".jpg");
  await sharp(buf)
    .resize(W, H, { fit: "cover", position: "attention" })   // smart crop toward the salient region
    .jpeg({ quality: QUALITY, mozjpeg: true })
    .toFile(out);
  return out;
}

console.log("fetch-space-splash — vendoring public-domain space photos for the κ-Open splash\n");
const cands = await candidates();
console.log(`gathered ${cands.length} candidates; making ${NEED}…\n`);

let made = 0;
for (const c of cands) {
  if (made >= NEED) break;
  const idx = made + 1;
  try {
    const out = await makeImage(c, idx);
    made++;
    console.log(`  ✓ ${String(idx).padStart(2, "0")}.jpg  ←  ${c.id} (${c.term})`);
  } catch (e) { console.log(`  · skip ${c.id}: ${e.message}`); }
}

if (made < NEED) { console.error(`\nONLY ${made}/${NEED} images made — re-run or add terms.`); process.exit(1); }
console.log(`\n✓ ${made} space backgrounds → os/usr/share/wallpapers/space/  (web-optimized ${W}×${H} q${QUALITY})`);
console.log("Next: reseal so they ship; the splash picks one at random per boot.");
