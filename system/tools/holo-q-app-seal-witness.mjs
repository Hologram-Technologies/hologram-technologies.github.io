// holo-q-app-seal-witness.mjs — Stage G proof: an app seals to a single manifest κ (= its identity); opening it
// anywhere from its κ-keyed bundle RE-DERIVES every block (manifest→reducer→projection) and REFUSES tampering
// (SEC-1/L5/SEC-6); sharing is just the κ; a fresh store with only the bundle opens (serverless — no shared
// server state); a version/fork is a NEW manifest κ while the origin κ still opens to the original (immutable);
// the unchanged reducer dedups across versions (SEC-3). Composes the REAL app-spec compiler. Pure Node, the
// substrate hash. Run: node holo-q-app-seal-witness.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const imp = (rel) => import(pathToFileURL(resolve(HERE, rel)).href);
const { compileSpec } = await imp("../os/usr/lib/holo/q/holo-q-app-spec.mjs");
const { sealApp, openApp, shareLink, parseShareLink, openFromLink, mergeStores } = await imp("../os/usr/lib/holo/q/holo-q-app-seal.mjs");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

const SPEC = {
  name: "Flat Expenses", identity: "required",
  ui: { type: "page", children: [{ type: "hero", props: { title: "Flat Expenses", subtitle: "Split costs" } }, { type: "footer", props: { text: "On-device · yours" } }] },
  collections: [{ name: "expenses", kind: "expense", fields: [{ name: "title", type: "string" }] }],
  capabilities: [{ collection: "expenses", ops: ["read", "write"] }],
};

console.log("\nholo-q app seal — one κ, opens + verifies in any browser, serverless\n");

// ── 1) seal → a κ-keyed bundle; the manifest κ is the app identity ────────────────────────────────────────
const app = compileSpec(SPEC);
const sealed = sealApp(app);
console.log("seal → a κ-addressed bundle:");
ok(sealed.manifestK === app.manifestK && /^[0-9a-f]{64}$/.test(sealed.manifestK), "the app identity is its manifest κ");
ok(sealed.store[app.manifestK] && sealed.store[app.reducerK] && sealed.store[app.projectionK], "the bundle holds the manifest, reducer, and projection blocks (the app's code)");

// ── 2) open by κ, re-deriving every block; serverless (only the bundle, no shared state) ──────────────────
console.log("\nopen by κ — re-derives every block (any browser, serverless):");
{
  const opened = openApp(sealed.manifestK, sealed.store);
  ok(opened.manifest.name === "Flat Expenses" && opened.manifest.reducer === app.reducerK, "the manifest resolves and names its reducer + projection");
  ok(opened.projectionHtml === app.projectionHtml && opened.projectionHtml.includes("Flat Expenses"), "the projection resolves to the exact UI bytes");
  // a FRESH store with only the bundle (simulating a different device / no server) opens fine
  const fresh = JSON.parse(JSON.stringify(sealed.store));
  ok(openApp(sealed.manifestK, fresh).manifest.name === "Flat Expenses", "opens from a clean store with no shared server state (serverless)");
}

// ── 3) SEC-1: a tampered or missing block is REFUSED on load ──────────────────────────────────────────────
console.log("\nverified-on-load — tamper/absence refused (SEC-1/L5):");
{
  const bad = { ...sealed.store }; bad[app.projectionK] = sealed.store[app.projectionK].replace("Flat Expenses", "EVIL");
  let refused = false; try { openApp(sealed.manifestK, bad); } catch (e) { refused = /L5 REFUSE/.test(e.message); }
  ok(refused, "a tampered projection block is REFUSED (does not re-derive to its κ)");
  const missing = { ...sealed.store }; delete missing[app.reducerK];
  let missed = false; try { openApp(sealed.manifestK, missing); } catch (e) { missed = /MISSING/.test(e.message); }
  ok(missed, "a missing block fails loudly (never silently trusted)");
}

// ── 4) share = the κ; the link round-trips and opens ──────────────────────────────────────────────────────
console.log("\nshare is just the κ:");
{
  const link = shareLink(sealed.manifestK);
  ok(link === "holo://sha256/" + sealed.manifestK && parseShareLink(link) === sealed.manifestK, "the share link is the manifest κ; it round-trips");
  ok(openFromLink(link, sealed.store).manifest.name === "Flat Expenses", "opening the shared link resolves + verifies the app");
}

// ── 5) version/fork = a NEW manifest κ; the origin stays immutable; the reducer dedups ────────────────────
console.log("\nversion/fork — new κ, origin immutable, dedup:");
{
  const v2spec = { ...SPEC, ui: { type: "page", children: [{ type: "hero", props: { title: "Flat Expenses 2.0", subtitle: "Now with logins" } }] } };
  const app2 = compileSpec(v2spec);
  const sealed2 = sealApp(app2);
  ok(sealed2.manifestK !== sealed.manifestK, "the edited app has a NEW manifest κ (a distinct version)");
  const both = mergeStores(sealed.store, sealed2.store);
  ok(openApp(sealed.manifestK, both).projectionHtml.includes("Split costs"), "the ORIGINAL κ still opens to the original app (immutable)");
  ok(openApp(sealed2.manifestK, both).projectionHtml.includes("2.0"), "the new κ opens to the edited app");
  ok(app.reducerK === app2.reducerK && both[app.reducerK], "the unchanged reducer is ONE κ shared across both versions (SEC-3 dedup)");
}

console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
