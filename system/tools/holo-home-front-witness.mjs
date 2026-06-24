#!/usr/bin/env node
// holo-home-front-witness.mjs — proves THE FRONT DOOR (holo-home-front): the personal-cloud manifest
// rendered as a view-model and opened through THE one open path (holo-open). The CasaOS dashboard
// reframed — the home screen is a projection of one owned κ, "tap → it plays" is a single seam, and a
// broken manifest paints NOTHING (fail-closed). Drives the real substrate: holo-home over holo-strand
// with a real enrolled holo-identity operator, and holo-open's actual classifier + makeOpen seam.
//
// Checks (all must hold):
//   1 showsExactlyManifest    — the view's sections carry exactly the projected files/apps/spaces.
//   2 classifiesEachKind      — a file κ-ref→kappa, a space ref→space, an app-id ref→app (open taxonomy).
//   3 opensThroughOnePath     — openHomeItem routes each item through makeOpen to the RIGHT channel.
//   4 missingRefNeverOpens    — an item with no ref opens nothing (no channel fires).
//   5 brokenChainShowsNothing — a tampered manifest ⇒ homeView { ok:false }, zero items (fail-closed).
//   6 noJargonOnSurface       — section titles + the Ask title contain no κ/manifest/anchor/strand jargon.
//
// Authority: holospaces Laws L1/L2/L5 · rests on #holo-home + #holo-open + #holo-strand + #holo-identity.
// node tools/holo-home-front-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeHome } from "../os/usr/lib/holo/holo-home.mjs";
import { homeView, openHomeItem, FRONT_SECTIONS, ASK_TITLE } from "../os/usr/lib/holo/holo-home-front.mjs";
import { makeOpen } from "../os/usr/lib/holo/holo-open.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = (init = []) => { let store = clone(init); return { load: async () => clone(store), save: async (r) => { store = clone(r); }, dump: () => clone(store) }; };

let tick = 0;
const now = () => `2026-06-24T01:00:${String(tick++).padStart(2, "0")}.000Z`;
const op = await enroll({ label: "front-owner", passphrase: "correct horse battery staple two" });

// ── a Home with one of each openable shape: a file (κ-ref), a space (holo://space/), an app (holo://id)
const FILE = "did:holo:sha256:" + "a".repeat(64);
const SPACE = "holo://space/work";
const APP = "holo://org.hologram.atlas";
const backend = arrayBackend();
const home = makeHome({ backend, now, signer: op });
await home.init({ owner: op.kappa, title: "Ilya's Home" });
await home.addFile(FILE, "notes.md");
await home.addSpace(SPACE, "Work");
await home.pinApp(APP, "kappa");

// ── 1 · the view shows exactly the manifest's items ──────────────────────────────────────────────────
const view = await homeView(home);
const sec = (id) => view.sections.find((s) => s.id === id);
ok("showsExactlyManifest",
  view.ok && view.title === "Ilya's Home"
  && sec("files").items.length === 1 && sec("files").items[0].ref === FILE && sec("files").items[0].label === "notes.md"
  && sec("spaces").items.length === 1 && sec("spaces").items[0].ref === SPACE
  && sec("apps").items.length === 1 && sec("apps").items[0].ref === APP,
  JSON.stringify({ files: sec("files").items.length, apps: sec("apps").items.length, spaces: sec("spaces").items.length }));

// ── 2 · each item classifies to the right open kind ──────────────────────────────────────────────────
ok("classifiesEachKind",
  sec("files").items[0].kind === "kappa" && sec("spaces").items[0].kind === "space" && sec("apps").items[0].kind === "app",
  JSON.stringify({ file: sec("files").items[0].kind, space: sec("spaces").items[0].kind, app: sec("apps").items[0].kind }));

// ── 3 · openHomeItem routes through THE one path to the right channel ────────────────────────────────
const seen = { space: null, app: null, fallback: null };
const open = makeOpen({
  space: async (id) => { seen.space = id; return "opened-space"; },
  app: async (id) => { seen.app = id; return "opened-app"; },
  fallback: async (ref) => { seen.fallback = ref; return "opened-fallback"; },
});
const rFile = await openHomeItem(sec("files").items[0], open);   // κ-ref → fallback (the resolver)
const rSpace = await openHomeItem(sec("spaces").items[0], open); // holo://space/work → space("work")
const rApp = await openHomeItem(sec("apps").items[0], open);     // holo://org… → app("org.hologram.atlas")
ok("opensThroughOnePath",
  rFile === "opened-fallback" && seen.fallback === FILE
  && rSpace === "opened-space" && seen.space === "work"
  && rApp === "opened-app" && seen.app === "org.hologram.atlas",
  JSON.stringify(seen));

// ── 4 · a missing ref never opens ────────────────────────────────────────────────────────────────────
const seen2 = { hit: false };
const open2 = makeOpen({ space: async () => { seen2.hit = true; }, app: async () => { seen2.hit = true; }, fallback: async () => { seen2.hit = true; } });
const rNull = await openHomeItem({ label: "ghost" }, open2);
ok("missingRefNeverOpens", rNull === null && seen2.hit === false, JSON.stringify({ rNull, hit: seen2.hit }));

// ── 5 · a broken chain shows NOTHING (fail-closed) ───────────────────────────────────────────────────
const tampered = clone(backend.dump());
tampered[1]["holstr:payload"].name = "evil.exe";
const brokenView = await homeView(makeHome({ backend: arrayBackend(tampered) }));
ok("brokenChainShowsNothing", brokenView.ok === false && !brokenView.sections, JSON.stringify(brokenView));

// ── 6 · no κ jargon on the surface strings ───────────────────────────────────────────────────────────
const JARGON = /(κ|kappa|manifest|rederive|anchor|strand|substrate|did:holo)/i;
const titles = [...FRONT_SECTIONS.map((s) => s.title), ASK_TITLE, view.title];
ok("noJargonOnSurface", titles.every((t) => !JARGON.test(t)), JSON.stringify(titles));

await forget(op.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-home-front — THE FRONT DOOR: the personal-cloud manifest (holo-home) rendered as a view-model and opened through THE one open path (holo-open). The CasaOS dashboard reframed — the home screen is a projection of one owned κ, 'tap → it plays' is a single seam (makeOpen) for files, apps and spaces alike, and a broken/tampered manifest paints nothing (fail-closed). The surface stays a thin painter; the logic that must be correct lives here, node-witnessed.",
  authority: "holospaces Laws L1/L2/L5 · rests on #holo-home + #holo-open + #holo-strand + #holo-identity",
  witnessed,
  covers: witnessed ? ["shows-exactly-manifest", "classifies-open-kind", "opens-through-one-path", "missing-ref-no-open", "broken-chain-fail-closed", "no-jargon-surface"] : [],
  sample: { title: view.title, sections: view.sections.map((s) => `${s.title}:${s.items.length}`) },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-home-front-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-home-front witness — the front door (manifest → view-model → the one open path)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  view: "${view.title}" · ${view.sections.map((s) => `${s.title} ${s.items.length}`).join(" · ")} · Ask`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  the front door shows only your stuff, and one seam opens all of it" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
