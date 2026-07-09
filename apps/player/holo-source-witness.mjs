#!/usr/bin/env node
// holo-source-witness.mjs — proves the SourceProvider hub federates any catalogue uniformly, and that the
// Internet Archive adapter (a real, legal, key-free provider) normalizes + resolves through the same shape.
//
// Checks:
//   1 discoverShelves   — register two providers → discover() returns shelves from both, items tagged with source.
//   2 searchDedups      — the same title from two providers collapses to one (dedup by id).
//   3 resolveDelegates  — resolve(item) returns the owning provider's ranked streams (best first).
//   4 disabledExcluded  — a disabled provider contributes nothing.
//   5 iaBrowse          — Internet Archive docs normalize to the shape (title/year/poster).
//   6 iaResolve         — Internet Archive resolves to a quality-ranked HTTP download URL (instant-play).
//
// node holo-source-witness.mjs   (from holo-apps/apps/player/)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createSourceHub } from "./holo-source.mjs";
import { createIA } from "./holo-source-ia.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

const prov = (id, items, streams) => ({
  id, name: id, kind: "open",
  async catalogs() { return [{ id: "c", type: "movie", name: "Shelf " + id }]; },
  async browse() { return items; },
  async resolve() { return streams; },
});
const dune = { id: "x", name: "Dune", year: 2021, imdbId: "tt1160419" };
const A = prov("A", [dune], [{ playSrc: "a.mp4", quality: 1080, httpDirect: true }]);
const B = prov("B", [dune, { id: "y", name: "Arrival", year: 2016, imdbId: "tt2543164" }], []);

const hub = createSourceHub();
hub.register(A); hub.register(B);

// 1
{
  const shelves = await hub.discover();
  ok("discoverShelves", shelves.length === 2 && shelves[0].items[0]._sourceId === "A" && shelves[0].items[0].provenance.label === "A", JSON.stringify(shelves.map((s) => s.title)));
}
// 2
{
  const res = await hub.search("d");
  ok("searchDedups", res.length === 2 && res.filter((x) => x.name === "Dune").length === 1, JSON.stringify(res.map((x) => x.name)));
}
// 3
{
  const item = { ...dune, _sourceId: "A" };
  const r = await hub.resolve(item);
  ok("resolveDelegates", r.best && r.best.playSrc === "a.mp4", JSON.stringify(r.best));
}
// 4
{
  hub.setEnabled("A", false);
  const shelves = await hub.discover();
  hub.setEnabled("A", true);
  ok("disabledExcluded", shelves.length === 1 && shelves[0].source === "B", JSON.stringify(shelves.map((s) => s.source)));
}

// ── Internet Archive adapter (fake IA fetch) ─────────────────────────────────────────────────────────────
const IA_DOCS = { response: { docs: [{ identifier: "night_of_the_living_dead", title: "Night of the Living Dead", year: "1968", description: "A classic horror." }] } };
const IA_META = { files: [{ name: "notld.ogv", format: "Ogg Video", size: "50" }, { name: "notld.mp4", format: "h.264", size: "300" }, { name: "notld_512kb.mp4", format: "512Kb MPEG4", size: "120" }] };
const iaFetch = async (url) => ({ ok: true, status: 200, json: async () => (/advancedsearch/.test(url) ? IA_DOCS : /\/metadata\//.test(url) ? IA_META : {}) });
const ia = createIA({ fetch: iaFetch });

// 5
{
  const cats = await ia.catalogs();
  const items = await ia.browse(cats[0].id, {});
  const it = items[0];
  ok("iaBrowse", cats.length >= 1 && it && it.name === "Night of the Living Dead" && it.year === 1968 && /services\/img\/night_of_the_living_dead/.test(it.posterUrl) && it.availability.playable === false, JSON.stringify({ cats: cats.length, name: it && it.name, year: it && it.year }));
}
// 6
{
  const cands = await ia.resolve({ _iaId: "night_of_the_living_dead" });
  ok("iaResolve", cands.length >= 1 && cands[0].httpDirect && /\/download\/night_of_the_living_dead\//.test(cands[0].playSrc) && cands[0].kind === "open", JSON.stringify(cands.map((c) => c.playSrc)));
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-source — the SourceProvider hub federates any catalogue (Stremio addon, Jellyfin, Internet Archive, …) through ONE interface: discover() builds rails, search() merges + dedups by id, resolve() delegates to the owning provider; a disabled source contributes nothing. The Internet Archive adapter (legal, key-free) normalizes + resolves to instant HTTP through the same shape.",
  authority: "rests on #holo-source (+ #holo-source-ia) — Steps 1 & 6 of the universal-catalog action plan",
  witnessed,
  covers: witnessed ? ["discover-shelves", "search-dedups", "resolve-delegates", "disabled-excluded", "ia-browse", "ia-resolve"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-source-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-source witness — one provider interface, federated; Internet Archive as a legal key-free source\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  any catalogue, one shape, instant + legal-by-default" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
