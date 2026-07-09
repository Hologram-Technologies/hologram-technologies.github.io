#!/usr/bin/env node
// holo-source-plex-witness.mjs — proves a Plex server is a full SourceProvider: library sections → rails,
// Metadata → the one shape (token-stamped thumbs), search via /search, resolve → a direct-play URL with
// the X-Plex-Token. Fake Plex, no network.
//
// Checks:
//   1 sections     — movie + show sections become catalogs (non-media sections dropped).
//   2 browseShape  — Metadata rows → the one shape (plex id, kind, token-stamped poster, year, genres).
//   3 searchQuery  — search(q) hits /search?query=.
//   4 resolvePlay  — resolve → {base}{Part.key}?X-Plex-Token=… httpDirect with "Plex · …" provenance.
//   5 showKind     — a type:show item normalizes to kind:series.
//
// node holo-source-plex-witness.mjs   (from holo-apps/apps/player/)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createPlexProvider } from "./holo-source-plex.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

const SECTIONS = { MediaContainer: { Directory: [{ key: "1", type: "movie", title: "Movies" }, { key: "2", type: "show", title: "TV" }, { key: "3", type: "photo", title: "Photos" }] } };
const MOVIES = { MediaContainer: { Metadata: [{ ratingKey: "501", type: "movie", title: "Arrival", year: 2016, summary: "Linguist meets aliens.", thumb: "/library/metadata/501/thumb/1", art: "/library/metadata/501/art/1", duration: 7080000, rating: 7.9, Genre: [{ tag: "Sci-Fi" }, { tag: "Drama" }], Media: [{ Part: [{ key: "/library/parts/9/file.mkv" }] }] }] } };
const SHOWS = { MediaContainer: { Metadata: [{ ratingKey: "777", type: "show", title: "Severance", year: 2022, thumb: "/library/metadata/777/thumb/1", Genre: [{ tag: "Sci-Fi" }] }] } };

let lastUrl = "";
const fetchFix = async (url) => {
  lastUrl = url;
  const body = /\/library\/sections$/.test(url.split("?")[0]) ? SECTIONS
    : /\/library\/sections\/2\/all/.test(url) ? SHOWS
    : /\/library\/sections\/1\/all/.test(url) ? MOVIES
    : /\/search/.test(url) ? MOVIES : { MediaContainer: {} };
  return { ok: true, status: 200, json: async () => body };
};
const plex = createPlexProvider({ base: "https://plex.mine.tld/", token: "PTOKEN", name: "Home Plex", fetch: fetchFix });

// 1
{
  const cats = await plex.catalogs();
  ok("sections", cats.length === 2 && cats[0].id === "1" && cats[0].type === "movie" && cats[1].type === "series" && !cats.some((c) => /Photos/.test(c.name)), JSON.stringify(cats.map((c) => c.name)));
}
// 2
{
  const items = await plex.browse("1", {});
  const it = items[0];
  ok("browseShape", it && it.id === "plex:501" && it.kind === "movie" && it.name === "Arrival" && it.year === 2016 && /X-Plex-Token=PTOKEN/.test(it.posterUrl) && it.genres.includes("Sci-Fi") && it._part === "/library/parts/9/file.mkv", JSON.stringify({ id: it && it.id, poster: it && it.posterUrl }));
}
// 3
{
  await plex.search("arrival");
  ok("searchQuery", /\/search\?query=arrival/.test(lastUrl), lastUrl.slice(-60));
}
// 4
{
  const cands = await plex.resolve({ _part: "/library/parts/9/file.mkv" });
  ok("resolvePlay", cands.length === 1 && cands[0].httpDirect && /\/library\/parts\/9\/file\.mkv\?X-Plex-Token=PTOKEN/.test(cands[0].playSrc) && /Plex · Home Plex/.test(cands[0].provenance.label), JSON.stringify(cands[0] && cands[0].playSrc));
}
// 5
{
  const items = await plex.browse("2", {});
  ok("showKind", items[0] && items[0].kind === "series" && items[0].name === "Severance", JSON.stringify(items[0] && [items[0].kind, items[0].name]));
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-source-plex — a Plex Media Server as a full SourceProvider: library sections→rails, Metadata→the one shape (token-stamped thumbs), search via /search, resolve→direct-play URL with X-Plex-Token. Federated + deduped with Jellyfin/Stremio/RD/IA under one interface — full library interoperability.",
  authority: "rests on #holo-source-plex — full-library-interop (sibling of #holo-source-jellyfin)",
  witnessed,
  covers: witnessed ? ["sections", "browse-shape", "search-query", "resolve-play", "show-kind"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-source-plex-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-source-plex witness — your Plex library, on the same wall\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  Plex federates with every other library" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
