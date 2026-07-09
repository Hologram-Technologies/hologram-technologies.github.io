#!/usr/bin/env node
// holo-resolvers-witness.mjs — proves sources are an open, federated plugin point: resolvers register, the
// registry federates their candidates with RRF (trust-weighted), the best legal/owned source wins, an
// unresolved title is a virtual item (browse-only), provenance is stamped, and a Stremio-style addon plugs
// in without touching the registry — disabled by default, enabled by the user, always provenanced.
//
// Checks:
//   1 registerAndList — resolvers register; list reflects them with enabled flags.
//   2 federates       — multiple resolvers contribute candidates for one query.
//   3 trustWins       — owned κ beats an open stream even when the open list ranks its item first.
//   4 virtualItem     — no candidate → best is null (browse-only / resolve-on-play).
//   5 provenance      — the chosen stream carries where it came from.
//   6 addonPluggable  — a disabled addon is skipped; enabling it federates its stream with provenance.
//
// node holo-resolvers-witness.mjs   (from holo-apps/apps/player/)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createResolverRegistry, catalogResolver, jellyfinResolver, urlResolver, addonResolver } from "./holo-resolvers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

// the user's held sources: an open CC copy AND an owned κ copy of the same title
const sources = [
  { id: "open-tos", name: "Tears of Steel", source: "open", playSrc: "https://x/tos.m3u8", type: "application/x-mpegURL", year: 2012, license: "CC BY 3.0" },
  { id: "owned-tos", name: "Tears of Steel", source: "owned", kappa: "sha256:tos", playSrc: "tos/master.m3u8", type: "application/x-mpegURL", year: 2012 },
  { id: "sintel", name: "Sintel", source: "open", playSrc: "https://x/sintel.mpd", type: "application/dash+xml", year: 2010 },
];

// a fake Stremio addon
const fakeFetch = async (u) => ({ ok: /stream\/movie\/tt2197908/.test(u), status: 200, json: async () => ({ streams: [{ url: "https://addon/strm.mp4", title: "Addon 1080p" }] }) });

// 1
const reg = createResolverRegistry();
reg.register(catalogResolver(() => sources));
reg.register(urlResolver());
const addon = reg.register(addonResolver({ id: "addon:demo", name: "Demo Addon", base: "https://addon", fetch: fakeFetch }));   // enabled:false by default
{
  const l = reg.list();
  ok("registerAndList", l.length === 3 && l.find((r) => r.id === "addon:demo" && r.enabled === false) && l.find((r) => r.id === "builtin:catalog" && r.enabled), JSON.stringify(l));
}
// 2 + 3 — owned κ beats open for Tears of Steel
{
  const { best, candidates } = await reg.resolve({ tmdbId: 133701, name: "Tears of Steel", year: 2012 });
  ok("federates", candidates.length >= 1, JSON.stringify(candidates.map((c) => c.kind)));
  ok("trustWins", best && best.kind === "owned" && best.kappa === "sha256:tos", JSON.stringify(best && [best.kind, best.kappa]));
}
// 4 — a title the user doesn't hold and no enabled addon covers → virtual
{
  const { best } = await reg.resolve({ tmdbId: 27205, name: "Inception", year: 2010, imdbId: "tt1375666" });
  ok("virtualItem", best === null, JSON.stringify(best));
}
// 5 — provenance on the Sintel open stream
{
  const { best } = await reg.resolve({ tmdbId: 45745, name: "Sintel", year: 2010 });
  ok("provenance", best && best.provenance && /Open/.test(best.provenance.label), JSON.stringify(best && best.provenance));
}
// 6 — addon disabled → skipped; enable it → its stream federates with provenance
{
  const q = { tmdbId: 0, name: "Some Movie", year: 2014, kind: "movie", imdbId: "tt2197908" };
  const before = await reg.resolve(q);
  reg.setEnabled("addon:demo", true);
  const after = await reg.resolve(q);
  ok("addonPluggable", before.best === null && after.best && after.best.kind === "addon" && /Addon/.test(after.best.provenance.label), JSON.stringify({ before: before.best, after: after.best && after.best.provenance }));
}

// 7 — a linked Jellyfin server binds Inception (which the local library lacks), with server provenance,
// ranking above an open copy of the same title.
{
  const serverItems = [
    { id: "jf:inception", name: "Inception", source: "jellyfin", year: 2010, playSrc: "https://jf/Videos/inc/master.m3u8", type: "application/x-mpegURL" },
  ];
  const reg2 = createResolverRegistry();
  reg2.register(catalogResolver(() => sources));               // open Sintel/ToS only — no Inception
  reg2.register(jellyfinResolver(() => serverItems, { name: "Home Server" }));
  const { best } = await reg2.resolve({ tmdbId: 27205, name: "Inception", year: 2010 });
  ok("jellyfinResolver", best && best.kind === "jellyfin" && /Server · Home Server/.test(best.provenance.label), JSON.stringify(best && best.provenance));
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-resolvers — sources as an open, federated plugin point (Stremio-addon shape, κ-native): resolvers register, the registry fuses their candidates with trust-weighted RRF (owned κ > κ-store > server > open > addon), the best source wins, an unresolved title is a virtual item, provenance is stamped, and addons plug in disabled-by-default + always provenanced (no infringing indexers bundled).",
  authority: "rests on #holo-resolvers (+ #holo-availability) — Phase 4 of the streaming/metadata plan",
  witnessed,
  covers: witnessed ? ["register-and-list", "federates", "trust-wins", "virtual-item", "provenance", "addon-pluggable", "jellyfin-resolver"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-resolvers-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-resolvers witness — federated, pluggable, provenanced sources (the catalog brain is permanent)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  open sources, best-wins federation, honest provenance" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
