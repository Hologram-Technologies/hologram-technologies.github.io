#!/usr/bin/env node
// holo-home-apps-witness.mjs — proves THE APPS PILLAR (holo-home-apps): CasaOS's one-click app store with
// no "install" — a pinned app is a κ-ref in the manifest, "open" is a projection, and the renderer picks
// HOW by the app's class (kappa→project · web→web · alpine→boot-in-tab · ext→install). A pin is trusted
// only if it's in the SIGNED catalog or is a self-verifying content κ; a bare unknown app-id is surfaced
// as untrusted (catalog divergence), never silently opened. Drives the real substrate: holo-home over
// holo-strand, the real holo-bar catalog join, and the real holo-open classifier.
//
// Checks (all must hold):
//   1 onlyPinnedAppsInOrder — appsModel returns exactly the manifest's pinned apps (nothing fabricated).
//   2 catalogJoinForDisplay  — a pin matching a catalog id gets the catalog's display name + icon.
//   3 classRoutesOpen        — kappa→project · web→web · alpine→boot · ext→install (the three-class+ routing).
//   4 contentKappaTrusted    — a content-κ pin is trusted (self-verifying) even if absent from the catalog.
//   5 unknownIdUntrusted     — a bare unknown holo://app-id (not in catalog, not a κ) is untrusted.
//   6 brokenChainNoApps      — a tampered manifest ⇒ { ok:false }, no apps (fail-closed).
//
// Authority: holospaces Laws L1/L2/L5 · rests on #holo-home + #holo-bar + #holo-open + #holo-strand.
// node tools/holo-home-apps-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeHome } from "../os/usr/lib/holo/holo-home.mjs";
import { appsModel, appOpenStrategy } from "../os/usr/lib/holo/holo-home-apps.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = (init = []) => { let store = clone(init); return { load: async () => clone(store), save: async (r) => { store = clone(r); }, dump: () => clone(store) }; };

let tick = 0;
const now = () => `2026-06-24T03:00:${String(tick++).padStart(2, "0")}.000Z`;
const op = await enroll({ label: "apps-owner", passphrase: "correct horse battery staple four" });

// ── the signed catalog (gen-apps-catalog shape: id/name/icon, optionally did) ───────────────────────
const KAPPA_APP = "did:holo:sha256:" + "c".repeat(64);     // a content-addressed app (self-verifying)
const catalog = [
  { id: "org.hologram.atlas", name: "Holo Atlas", icon: "atlas.svg" },
  { id: "org.hologram.jelly", name: "Jellyfin",   icon: "jelly.svg" },
  { id: "org.hologram.ublock", name: "uBlock",    icon: "ublock.svg" },
];

// ── a Home pinning one of each class + an unknown id ─────────────────────────────────────────────────
const backend = arrayBackend();
const home = makeHome({ backend, now, signer: op });
await home.init({ owner: op.kappa, title: "Apps Home" });
await home.pinApp("holo://org.hologram.atlas", "web");      // a catalog web app
await home.pinApp("holo://org.hologram.jelly", "alpine");   // a Docker-ecosystem app (boots in-tab)
await home.pinApp("holo://org.hologram.ublock", "ext");     // a Chrome extension
await home.pinApp(KAPPA_APP, "kappa");                      // a content-κ app, not in catalog
await home.pinApp("holo://org.unknown.thing", "web");       // unknown id — NOT in catalog, not a κ

const m = await appsModel(home, catalog);
const byRef = Object.fromEntries(m.apps.map((a) => [a.ref, a]));

// ── 1 · exactly the pinned apps, in order ────────────────────────────────────────────────────────────
ok("onlyPinnedAppsInOrder",
  m.ok && m.apps.length === 5
  && m.apps[0].ref === "holo://org.hologram.atlas" && m.apps[3].ref === KAPPA_APP && m.apps[4].ref === "holo://org.unknown.thing",
  JSON.stringify({ ok: m.ok, n: m.apps.length }));

// ── 2 · catalog join supplies display name + icon ────────────────────────────────────────────────────
ok("catalogJoinForDisplay",
  byRef["holo://org.hologram.atlas"].label === "Holo Atlas" && byRef["holo://org.hologram.atlas"].icon === "atlas.svg"
  && byRef["holo://org.hologram.jelly"].label === "Jellyfin",
  JSON.stringify({ atlas: byRef["holo://org.hologram.atlas"].label, jelly: byRef["holo://org.hologram.jelly"].label }));

// ── 3 · class → open strategy ────────────────────────────────────────────────────────────────────────
ok("classRoutesOpen",
  byRef["holo://org.hologram.atlas"].strategy === "web"
  && byRef["holo://org.hologram.jelly"].strategy === "boot"
  && byRef["holo://org.hologram.ublock"].strategy === "install"
  && byRef[KAPPA_APP].strategy === "project"
  && appOpenStrategy("kappa") === "project" && appOpenStrategy("weird") === "project",
  JSON.stringify(m.apps.map((a) => `${a.class}:${a.strategy}`)));

// ── 4 · a content-κ app is trusted even though it's not in the catalog ───────────────────────────────
ok("contentKappaTrusted", byRef[KAPPA_APP].trusted === true, JSON.stringify({ kappaTrusted: byRef[KAPPA_APP].trusted }));

// ── 5 · a bare unknown app-id (not catalog, not κ) is untrusted (divergence surfaced) ────────────────
ok("unknownIdUntrusted",
  byRef["holo://org.unknown.thing"].trusted === false && byRef["holo://org.hologram.atlas"].trusted === true,
  JSON.stringify({ unknown: byRef["holo://org.unknown.thing"].trusted, known: byRef["holo://org.hologram.atlas"].trusted }));

// ── 6 · a tampered manifest yields no apps (fail-closed) ─────────────────────────────────────────────
const tampered = clone(backend.dump());
tampered[2]["holstr:payload"].class = "kappa";              // mutate a pin's class
const mt = await appsModel(makeHome({ backend: arrayBackend(tampered) }), catalog);
ok("brokenChainNoApps", mt.ok === false && !mt.apps, JSON.stringify(mt));

await forget(op.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-home-apps — THE APPS PILLAR: CasaOS's one-click app store with no install. A pinned app is a κ-ref in the manifest, 'open' is a projection, and the renderer picks HOW by the app's class (kappa→project · web→web · alpine→boot-in-tab · ext→install). Display name/icon come from the signed catalog (holo-bar join); a pin is trusted only if it's in that catalog OR is a self-verifying content κ, so a bare unknown app-id is surfaced as untrusted (catalog divergence) rather than silently opened. No new catalog and no new store — the manifest's pins joined to the existing one.",
  authority: "holospaces Laws L1/L2/L5 · rests on #holo-home + #holo-bar + #holo-open + #holo-strand",
  witnessed,
  covers: witnessed ? ["only-pinned-in-order", "catalog-join-display", "class-routes-open", "content-kappa-trusted", "unknown-id-untrusted", "broken-chain-fail-closed"] : [],
  sample: { apps: m.ok ? m.apps.map((a) => `${a.label}(${a.class}→${a.strategy}${a.trusted ? "" : "·untrusted"})`) : [] },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-home-apps-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-home-apps witness — the apps pillar (no install: a pin is a κ-ref, open is a projection)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
if (m.ok) console.log(`\n  apps: ${m.apps.map((a) => `${a.label} ${a.class}→${a.strategy}${a.trusted ? "" : " ⚠untrusted"}`).join(" · ")}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  one tile store, no install — open is a projection, and only trusted pins open" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
