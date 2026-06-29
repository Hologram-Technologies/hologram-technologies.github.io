#!/usr/bin/env node
// holo-home-journey-witness.mjs — the MOTHER-TEST gate for Holo Home (P8, the host-free half). It does not
// test pixels (beauty is verified live in the browser); it tests that the personal-cloud JOURNEY coheres:
// a non-technical person, cold, can land on Home, see their stuff, open it, and ask about it — through ONE
// path, with NO jargon, and that every pillar fails CLOSED the same way. Drives the real modules end to end
// (holo-home + front + apps + ask + reach + guard) with a real enrolled operator. Uses the SAME banned-term
// set as holo-jargon-witness so the simplicity bar is identical across the OS.
//
// Checks (all must hold):
//   1 coldStartComposes   — fresh owner: init → add file → pin app → it shows in Files/Apps → Ask finds it.
//   2 fourPillarsPresent   — the front door yields Files · Apps · Spaces and an Ask entry (the whole home).
//   3 oneOpenPath          — front taps AND Ask's open_app both route through the injected holo-open seam.
//   4 ambientByDefault     — ordinary acts (add file, pin app) are NEVER gated; only pair/revoke/export ask.
//   5 noJargonAnywhere     — every user-facing string (section titles, Ask title, tool descriptions, boot
//                            copy) is free of κ/kappa/install/sync/manifest/reseal/did:holo/... (canonical set).
//   6 failsClosedTogether  — a tampered manifest makes Files show nothing, Apps none, AND Ask unavailable.
//
// Authority: holospaces Laws L1/L2/L5 · mirrors #holo-jargon + #holo-streaming-journey · rests on the whole
// holo-home logic layer. node tools/holo-home-journey-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeHome } from "../os/usr/lib/holo/holo-home.mjs";
import { homeView, openHomeItem, FRONT_SECTIONS, ASK_TITLE } from "../os/usr/lib/holo/holo-home-front.mjs";
import { appsModel } from "../os/usr/lib/holo/holo-home-apps.mjs";
import { makeHomeAsk } from "../os/usr/lib/holo/holo-home-ask.mjs";
import { verbNeedsStepUp } from "../os/usr/lib/holo/holo-home-guard.mjs";
import { BOOT_COPY } from "../os/usr/lib/holo/holo-home-boot.mjs";
import { makeOpen } from "../os/usr/lib/holo/holo-open.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = (init = []) => { let store = clone(init); return { load: async () => clone(store), save: async (r) => { store = clone(r); }, dump: () => clone(store) }; };

// the SAME banned-term set as holo-jargon-witness (the OS-wide simplicity bar).
const BANNED = /(κ\b|kappa|\bsync\b|\binstall\b|\bmanifest\b|\breseal\b|\brendezvous\b|content address|source chain|did:holo)/i;

let tick = 0;
const now = () => `2026-06-24T07:00:${String(tick++).padStart(2, "0")}.000Z`;
const op = await enroll({ label: "journey-owner", passphrase: "a mother could use this" });

const FILE = "did:holo:sha256:" + "a".repeat(64);
const APP = "holo://org.hologram.atlas";
const catalog = [{ id: "org.hologram.atlas", name: "Holo Atlas", icon: "atlas.svg" }];

// ── a cold start: the first things anyone does ───────────────────────────────────────────────────────
const backend = arrayBackend();
const home = makeHome({ backend, now, signer: op });
await home.init({ owner: op.kappa, title: "My Home" });
await home.addFile(FILE, "welcome.md");
await home.pinApp(APP, "web");

const view = await homeView(home);
const apps = await appsModel(home, catalog);
const ask = makeHomeAsk({ home, open: null });
const found = await ask.invoke("find_files", { query: "welcome" });

// ── 1 · cold start composes end-to-end ───────────────────────────────────────────────────────────────
const fileShown = view.ok && view.sections.find((s) => s.id === "files").items.some((f) => f.label === "welcome.md");
const appNamed = apps.ok && apps.apps.some((a) => a.label === "Holo Atlas");
ok("coldStartComposes",
  view.ok && view.title === "My Home" && fileShown && appNamed && found.ok && found.files.length === 1,
  JSON.stringify({ titled: view.title, fileShown, appNamed, askFound: found.files.length }));

// ── 2 · the four pillars are present ─────────────────────────────────────────────────────────────────
const ids = view.sections.map((s) => s.id);
ok("fourPillarsPresent",
  ids.includes("files") && ids.includes("apps") && ids.includes("spaces") && !!view.ask && view.ask.title === ASK_TITLE,
  JSON.stringify({ sections: ids, ask: view.ask && view.ask.title }));

// ── 3 · one open path — front + ask both route through the same seam ─────────────────────────────────
const seen = { fallback: null, app: null };
const open = makeOpen({ app: async (id) => { seen.app = id; return "A"; }, fallback: async (ref) => { seen.fallback = ref; return "F"; } });
const fileItem = view.sections.find((s) => s.id === "files").items[0];
await openHomeItem(fileItem, open);                          // front tap → fallback (κ-ref)
const ask2 = makeHomeAsk({ home, open });
await ask2.invoke("open_app", { query: "atlas" });           // ask → app() via the SAME seam
ok("oneOpenPath", seen.fallback === FILE && seen.app === "org.hologram.atlas", JSON.stringify(seen));

// ── 4 · ambient by default — normal acts never ask; only the dangerous few do ────────────────────────
ok("ambientByDefault",
  verbNeedsStepUp("home.files.add", { nowMs: 0 }) === false
  && verbNeedsStepUp("home.app.pin", { nowMs: 0 }) === false
  && verbNeedsStepUp("home.space.add", { nowMs: 0 }) === false
  && verbNeedsStepUp("home.device.pair", { nowMs: 0 }) === true
  && verbNeedsStepUp("home.export", { nowMs: 0 }) === true,
  "ordinary verbs ambient; pair/export gated");

// ── 5 · no jargon anywhere a person reads ────────────────────────────────────────────────────────────
const strings = [
  ...FRONT_SECTIONS.map((s) => s.title), ASK_TITLE, view.title,
  ...Object.values(BOOT_COPY),
  ...ask.listTools().map((t) => t.desc),
  ask.describe().title,
];
const offenders = strings.filter((s) => BANNED.test(String(s)));
ok("noJargonAnywhere", offenders.length === 0, JSON.stringify(offenders));

// ── 6 · fails closed together — one tampered manifest, every pillar refuses consistently ─────────────
const tampered = clone(backend.dump()); tampered[1]["holstr:payload"].name = "evil.md";
const tHome = makeHome({ backend: arrayBackend(tampered) });
const tView = await homeView(tHome);
const tApps = await appsModel(tHome, catalog);
const tAsk = await makeHomeAsk({ home: tHome, open: null }).invoke("find_files", {});
ok("failsClosedTogether", tView.ok === false && tApps.ok === false && tAsk.ok === false, JSON.stringify({ view: tView.ok, apps: tApps.ok, ask: tAsk.ok }));

await forget(op.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-home-journey — the mother-test gate for Holo Home (the host-free half of P8): a non-technical person, cold, lands on Home, sees their stuff (Files · Apps · Spaces), opens it through ONE path, and asks about it — with NO jargon (the same banned set as holo-jargon) and every pillar failing closed the same way. It drives the whole holo-home logic layer end to end; pixel-level beauty is verified live in the browser, not here.",
  authority: "holospaces Laws L1/L2/L5 · mirrors #holo-jargon + #holo-streaming-journey · rests on the holo-home logic layer",
  witnessed,
  covers: witnessed ? ["cold-start-composes", "four-pillars-present", "one-open-path", "ambient-by-default", "no-jargon-anywhere", "fails-closed-together"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-home-journey-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-home-journey witness — the mother test: land, see your stuff, open it, ask — no jargon, fail-closed\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  the personal cloud coheres cold: one path, four pillars, plain words, fail-closed" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
