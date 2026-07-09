#!/usr/bin/env node
// holo-source-jellyfin-witness.mjs — proves a linked Jellyfin server is a full SourceProvider: its catalogs
// become rails, its items normalize to the one shape (with poster/backdrop/genres), search uses SearchTerm,
// and resolve yields a playable master.m3u8 with server provenance. Fake Jellyfin, no network.
//
// Checks:
//   1 catalogs       — Movies + Shows shelves.
//   2 browseNormalizes — /Items rows → the one shape (jf id, kind, poster, year, genres).
//   3 searchTerm     — search(q) issues a SearchTerm query.
//   4 resolveStream  — resolve → master.m3u8 httpDirect with "Server · …" provenance.
//   5 seriesKind     — a Series item normalizes to kind:series.
//
// node holo-source-jellyfin-witness.mjs   (from holo-apps/apps/player/)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createJellyfinProvider } from "./holo-source-jellyfin.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

const MOVIES = { Items: [{ Id: "m1", Type: "Movie", Name: "Blade Runner 2049", ProductionYear: 2017, Overview: "K uncovers a secret.", ImageTags: { Primary: "tagP" }, BackdropImageTags: ["tagB"], RunTimeTicks: 99480000000, CommunityRating: 8, Genres: ["Sci-Fi", "Drama"] }] };
const SERIES = { Items: [{ Id: "s1", Type: "Series", Name: "The Expanse", ProductionYear: 2015, ImageTags: { Primary: "tagS" }, Genres: ["Sci-Fi"] }] };

let lastUrl = "";
const fetchFix = async (url) => { lastUrl = url; const body = /IncludeItemTypes=Series/.test(url) ? SERIES : MOVIES; return { ok: true, status: 200, json: async () => body }; };
const jf = createJellyfinProvider({ base: "https://jelly.mine.tld/", token: "TK", userId: "U1", name: "Home Server", fetch: fetchFix });

// 1
{
  const cats = await jf.catalogs();
  ok("catalogs", cats.length === 2 && cats[0].id === "Movie" && /Movies · Home Server/.test(cats[0].name) && cats[1].id === "Series", JSON.stringify(cats.map((c) => c.name)));
}
// 2
{
  const items = await jf.browse("Movie", {});
  const it = items[0];
  ok("browseNormalizes", it && it.id === "jf:m1" && it.kind === "movie" && it.name === "Blade Runner 2049" && it.year === 2017 && /Images\/Primary\?tag=tagP/.test(it.posterUrl) && it.genres.includes("Sci-Fi") && Math.round(it.runtimeSec) === 9948, JSON.stringify({ id: it && it.id, poster: it && it.posterUrl }));
}
// 3
{
  await jf.search("blade");
  ok("searchTerm", /SearchTerm=blade/.test(lastUrl), lastUrl.slice(-80));
}
// 4
{
  const cands = await jf.resolve({ _jfId: "m1" });
  ok("resolveStream", cands.length === 1 && cands[0].httpDirect && /\/Videos\/m1\/master\.m3u8/.test(cands[0].playSrc) && /Server · Home Server/.test(cands[0].provenance.label), JSON.stringify(cands[0] && cands[0].playSrc));
}
// 5
{
  const items = await jf.browse("Series", {});
  ok("seriesKind", items[0] && items[0].kind === "series" && items[0].name === "The Expanse", JSON.stringify(items[0] && [items[0].kind, items[0].name]));
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-source-jellyfin — a linked Jellyfin/Emby server as a full SourceProvider: catalogs→rails, /Items→the one shape, search via SearchTerm, resolve→master.m3u8 with server provenance. Federated + deduped with every other library under one interface.",
  authority: "rests on #holo-source-jellyfin — Phase 3 of the Stremio+RD+Jellyfin plan (full library interop)",
  witnessed,
  covers: witnessed ? ["catalogs", "browse-normalizes", "search-term", "resolve-stream", "series-kind"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-source-jellyfin-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-source-jellyfin witness — a Jellyfin server as a full, federated source\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  your server's whole library, on the same wall" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
