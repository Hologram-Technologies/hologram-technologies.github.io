#!/usr/bin/env node
// holo-bar-witness.mjs — proves the κ-addressable chrome bar: a bar is a κ-list, an item is a κ-reference,
// rendering is projection. Pure over holo-bar + holo-bar-store (the DOM rail is browser-verified).
//
// Checks:
//   1 modelDeterministic   — buildBarModel from fixed items+catalog is stable across calls.
//   2 reorderMintsKappa    — reordering items changes canonical bytes AND the bar κ (a bar IS an ordering).
//   3 verifyL5             — verifyBar passes the true κ and FAILS a tampered list (fail-closed, Law L1/L5).
//   4 emptyIsEmpty         — an empty bar builds an empty model (no throw → a new user sees a clean bar).
//   5 labelNotIdentity     — display label/icon are projections; the ref (identity) is preserved (Law L1).
//   6 seedFromCatalog      — defaultBookmarks maps catalog apps → items whose ref is the app's content κ.
//   7 storeRoundTrip       — saveBar→loadBar (mem backend) returns the same items and a stable κ.
//   8 openTarget           — an item's explicit `open` is honored; otherwise the ref is the open target.
//
// Authority: rests on #holo-bar + #holo-bar-store. node tools/holo-bar-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { canonicalBar, barKappa, verifyBar, barShareToken, verifyBarToken, buildBarModel } from "../os/usr/lib/holo/holo-bar.mjs";
import { loadBar, saveBar, defaultBookmarks } from "../os/usr/lib/holo/holo-bar-store.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const digest = async (s) => createHash("sha256").update(s).digest("hex");

const catalog = [
  { id: "org.hologram.Meet", did: "did:holo:sha256:" + "a".repeat(64), name: "Google Meet", words: "alpha.bravo.charlie", icon: "apps/meet/icon.svg" },
  { id: "org.hologram.WhatsApp", did: "did:holo:sha256:" + "b".repeat(64), name: "WhatsApp", words: "delta.echo.foxtrot", icon: "apps/wa/icon.svg" },
  { id: "org.hologram.Email", did: "did:holo:sha256:" + "c".repeat(64), name: "Email", words: "golf.hotel.india", icon: "" },
];
const items = [
  { ref: catalog[0].did },                                   // resolves label/icon from catalog
  { ref: catalog[1].did, label: "WA" },                      // explicit display overrides catalog
  { ref: catalog[2].did, open: "holo://org.hologram.Email" },// explicit open target
];

// ── 1 · deterministic model ──────────────────────────────────────────────────────────────────────────
{
  const a = buildBarModel(items, { catalog });
  const b = buildBarModel(items, { catalog });
  ok("modelDeterministic", JSON.stringify(a) === JSON.stringify(b) && a.length === 3, JSON.stringify(a.map((r) => r.label)));
}
// ── 2 · reorder mints a different κ ──────────────────────────────────────────────────────────────────
{
  const k1 = await barKappa(items, digest);
  const k2 = await barKappa([items[1], items[0], items[2]], digest);
  ok("reorderMintsKappa", canonicalBar(items) !== canonicalBar([items[1], items[0], items[2]]) && k1 !== k2 && /^did:holo:sha256:[0-9a-f]{64}$/.test(k1), k1);
}
// ── 3 · verify-before-trust (L5, fail-closed) ────────────────────────────────────────────────────────
{
  const k = await barKappa(items, digest);
  const good = await verifyBar(items, k, digest);
  const tampered = items.map((x) => ({ ...x })); tampered[0].ref = catalog[1].did;   // swap identity
  const bad = await verifyBar(tampered, k, digest);
  ok("verifyL5", good === true && bad === false);
}
// ── 4 · empty is empty ───────────────────────────────────────────────────────────────────────────────
ok("emptyIsEmpty", buildBarModel([], { catalog }).length === 0 && canonicalBar([]) === "[]");
// ── 5 · label/icon are projections; ref preserved ────────────────────────────────────────────────────
{
  const m = buildBarModel(items, { catalog });
  ok("labelNotIdentity", m[0].label === "Google Meet" && m[0].ref === catalog[0].did && m[1].label === "WA" && m[1].ref === catalog[1].did, JSON.stringify(m.map((r) => [r.label, r.ref.slice(-4)])));
}
// ── 6 · seed from catalog ────────────────────────────────────────────────────────────────────────────
{
  const seed = defaultBookmarks(catalog, { pick: ["Google Meet", "WhatsApp"] });
  ok("seedFromCatalog", seed.length === 2 && seed[0].ref === catalog[0].did && seed[0].label === "Google Meet" && seed[1].words === "delta.echo.foxtrot", JSON.stringify(seed));
}
// ── 7 · store round-trip ─────────────────────────────────────────────────────────────────────────────
{
  const m = new Map(); const backend = { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v) };
  const saved = await saveBar("bookmarks", items, { backend, digest });
  const loaded = await loadBar("bookmarks", { backend, digest });
  ok("storeRoundTrip", JSON.stringify(loaded.items) === JSON.stringify(items) && loaded.kappa === saved.kappa && !!loaded.kappa, loaded.kappa);
}
// ── 8 · open target ──────────────────────────────────────────────────────────────────────────────────
{
  const m = buildBarModel(items, { catalog });
  ok("openTarget", m[2].open === "holo://org.hologram.Email" && m[0].open === catalog[0].did, JSON.stringify([m[0].open.slice(-4), m[2].open]));
}

// ── 9 · share-a-bar token round-trips ────────────────────────────────────────────────────────────────
{
  const token = await barShareToken(items, digest);
  const v = await verifyBarToken(token, digest);
  ok("tokenRoundTrip", v.ok === true && JSON.stringify(v.items) === JSON.stringify(items) && /^did:holo:sha256:[0-9a-f]{64}$/.test(v.kappa), JSON.stringify({ ok: v.ok, n: v.items.length }));
}
// ── 10 · share token is fail-closed (tampered items, stale κ → rejected) ─────────────────────────────
{
  const token = await barShareToken(items, digest);
  const obj = JSON.parse(Buffer.from(token.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  obj.items[0].ref = catalog[1].did;                          // tamper, keep the old κ
  const tampered = Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
  const v = await verifyBarToken(tampered, digest);
  ok("tokenTamperRejected", v.ok === false && v.items.length === 0);
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-bar — the κ-addressable chrome bar: bookmarks bar + action rail as ONE schema (an ordered κ-list of κ-references) and ONE renderer. Identity follows bytes (Law L1); a reorder mints a new κ; a tampered list fails verify-before-trust (Law L5). Display (label/icon/words) is a projection resolved against the app catalog; seeds from the catalog so a new user opens to a populated bar. Pure over holo-bar + holo-bar-store; the DOM is browser-verified.",
  authority: "rests on #holo-bar + #holo-bar-store",
  witnessed,
  covers: witnessed ? ["model-deterministic", "reorder-mints-kappa", "verify-l5", "empty-safe", "label-not-identity", "seed-from-catalog", "store-round-trip", "open-target", "token-round-trip", "token-tamper-rejected"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-bar-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-bar witness — a chrome bar is a κ-list; an icon is a κ-reference; rendering is projection\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  bookmarks bar + action rail, κ-addressable, fail-closed" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
