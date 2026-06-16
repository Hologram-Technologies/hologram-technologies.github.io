#!/usr/bin/env node
// holo-workspace-sync-witness.mjs — PROVE Share Holospace (ADR-0105): the in-shell icon shares ONE
// holospace — ISOLATED, app-carrying, serverless. Drives the real sealer with in-memory blocks + a fetch
// spy, asserting:
//   • ISOLATION    — a bundle of holospace A contains NONE of holospace B's data (no window id, no app
//                    bytes, no appState, no board widget, no address) — selective, anchored to one instance;
//   • shareable    — the bundle carries NO operator / device / timestamp / global settings (it is not the
//                    whole session, and it leaks nothing about who or which machine made it);
//   • apps travel  — an AUTHORED app's own bytes (srcdoc/content) AND its saved appState survive the round
//                    trip byte-for-byte, so it runs in the imported holospace;
//   • honest tiers — analyzeHolospace counts self-contained vs built-in (linked κ) vs web surfaces;
//   • dedup        — the SAME holospace seals to the SAME root CID (content address, no nonce);
//   • round-trip   — seal → restore re-derives byte-for-byte (Law L5) across all three destinations
//                    (Local CAR · Sovereign-cloud token recognition · Share-as-a-link URL fragment);
//   • Law L5       — a tampered block is refused → null; an empty source → transport-honest null;
//   • no egress    — the whole loop never touches the network (the fetch spy is never called).

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildHolospaceManifest, analyzeHolospace, sealHolospace, restoreHolospace, verifiedBlockSource,
  exportCar, importCar, encodeResumeLink, decodeResumeLink, looksLikeToken } from "../os/sbin/holo-workspace-sync.mjs";
import { jcs } from "../os/usr/lib/holo/holo-uor.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); };
const eq = (a, b) => jcs(a) === jcs(b);

// ── no-egress guard ──
let fetched = false;
globalThis.fetch = () => { fetched = true; throw new Error("Share Holospace must never touch the network"); };

// ── two ISOLATED holospaces. A carries: an AUTHORED app (its bytes are in srcdoc) + state · a BUILT-IN app
//    (linked by appId/appDid) · a WEB surface · a widget board. B carries entirely different, private data.
const A_WORLD = [
  { id: "a-win1", kind: "app", srcdoc: "<!doctype html><h1>My App A</h1><script>window.MYAPP=1<\/script>", appState: { count: 3, note: "alpha-state" }, x: 10, y: 10, w: 420, h: 300, state: "normal" },
  { id: "a-files", kind: "app", appId: "org.hologram.files", appDid: "did:holo:sha256:f11e5", src: "/apps/files/?go=desktop:a", x: 60, y: 60, w: 900, h: 600, state: "normal" },
  { id: "a-web", kind: "app", browser: true, webAddr: "https://example.com", src: "/web?url=https%3A%2F%2Fexample.com", x: 80, y: 80, state: "max" },
];
const A = buildHolospaceManifest({ title: "Holospace A", addr: "holo://alpha", snap: { world: A_WORLD, layout: null, focusedId: "a-win1" }, board: [{ id: "w-a", type: "clock", x: 40, y: 40 }] });

const B_WORLD = [
  { id: "b-secret", kind: "app", srcdoc: "<!doctype html><h1>SECRET B</h1>", appState: { token: "bbbb-private-token" }, x: 0, y: 0 },
];
const B = buildHolospaceManifest({ title: "Holospace B", addr: "holo://bravo", snap: { world: B_WORLD, layout: null, focusedId: "b-secret" }, board: [{ id: "w-b", type: "note", text: "private B note" }] });

// ── ISOLATION: A's serialized bundle contains NONE of B's identifying data ──
const aText = jcs(A);
const bMarkers = ["b-secret", "SECRET B", "bbbb-private-token", "w-b", "private B note", "holo://bravo", "Holospace B"];
ok("isolation-no-other-holospace-data", bMarkers.every((m) => !aText.includes(m)), bMarkers.filter((m) => aText.includes(m)).join(","));
ok("isolation-only-this-world", A["holo:holospace"].snap.world.length === A_WORLD.length && A["holo:holospace"].snap.world.every((n) => n.id.startsWith("a-")));
ok("isolation-only-this-board", A["holo:holospace"].board.length === 1 && A["holo:holospace"].board[0].id === "w-a");

// ── shareable: no operator / device / timestamp / global-settings / session shape ──
ok("shareable-no-operator", !("holo:operator" in A));
ok("shareable-no-device", !("holo:device" in A));
ok("shareable-no-timestamp", !("prov:generatedAtTime" in A));
ok("shareable-not-session", !("holo:experience" in A) && A["@type"].includes("holo:HolospaceShare"));

// ── honest tiers ──
const an = analyzeHolospace(A);
ok("analysis-counts", an.surfaces === 3 && an.selfContained === 1 && an.linkedApp === 1 && an.web === 1 && an.widgets === 1 && an.withState === 1, JSON.stringify(an));

// ── dedup: the SAME holospace → the SAME root CID ──
const sealedA = await sealHolospace({ manifest: A, transport: "file", now: () => "2026-06-16T00:00:00.000Z" });
const sealedA2 = await sealHolospace({ manifest: buildHolospaceManifest({ title: "Holospace A", addr: "holo://alpha", snap: { world: A_WORLD, layout: null, focusedId: "a-win1" }, board: [{ id: "w-a", type: "clock", x: 40, y: 40 }] }), transport: "link", now: () => "2030-01-01T00:00:00.000Z" });
ok("seal-returns-cid", /^bafy[0-9a-z]+$/.test(sealedA.rootCid), sealedA.rootCid);
ok("dedup-same-holospace-same-cid", sealedA.rootCid === sealedA2.rootCid);
ok("receipt-shape", sealedA.receipt["holo:directIPFS"] === false && sealedA.receipt["holo:surfaces"] === 3 && sealedA.receipt["holo:selfContainedApps"] === 1 && sealedA.receipt["@type"].includes("holo:HolospaceShareReceipt"));

// ── DESTINATION 1 (Local device, CAR): export → import → restore byte-identical ──
const car = exportCar(sealedA.rootCid, sealedA.blocks);
const imported = importCar(car);
const fromCar = await restoreHolospace(sealedA.rootCid, verifiedBlockSource(imported.blocks));
ok("local-car-round-trip", fromCar && eq(fromCar.manifest, A));

// ── APPS TRAVEL: the authored app's bytes + appState survive in the restored world ──
const rWorld = fromCar.manifest["holo:holospace"].snap.world;
const rApp = rWorld.find((n) => n.id === "a-win1");
ok("authored-app-bytes-travel", !!rApp && rApp.srcdoc === A_WORLD[0].srcdoc);
ok("app-state-travels", !!rApp && rApp.appState && rApp.appState.count === 3 && rApp.appState.note === "alpha-state");
ok("built-in-app-linked", rWorld.some((n) => n.appId === "org.hologram.files" && n.appDid === "did:holo:sha256:f11e5"));

// ── DESTINATION 2 (Sovereign cloud): a did:holo / CIDv1 token is recognized (routes to cloud) ──
ok("token-recognized", looksLikeToken(sealedA.did) && looksLikeToken(sealedA.rootCid));
ok("link-not-a-token", !looksLikeToken(`https://host/#wks=AAAA`));

// ── DESTINATION 3 (Share as a link): CAR → URL #fragment → decode → restore byte-identical ──
const payload = encodeResumeLink(sealedA.rootCid, sealedA.blocks);
ok("link-payload-url-safe", typeof payload === "string" && /^[A-Za-z0-9\-_]+$/.test(payload));
const decoded = decodeResumeLink(`https://host/shell.html#wks=${payload}`);
ok("link-decode-from-url", !!(decoded && decoded.roots[0] === sealedA.rootCid));
const fromLink = await restoreHolospace(decoded.roots[0], verifiedBlockSource(decoded.blocks));
ok("link-round-trip", fromLink && eq(fromLink.manifest, A));
ok("link-decode-garbage-null", decodeResumeLink("not a link") === null);

// ── Law L5: a tampered block is refused → null ──
const tampered = new Map([...sealedA.blocks]); tampered.set([...tampered.keys()][0], new TextEncoder().encode("tampered"));
ok("L5-tamper-refused", (await restoreHolospace(sealedA.rootCid, verifiedBlockSource(tampered))) === null);
// ── transport-honest: an empty source → null (not reachable here) ──
ok("transport-honest-null", (await restoreHolospace(sealedA.rootCid, verifiedBlockSource(new Map()))) === null);

// ── a B bundle restores B (and is a DIFFERENT cid than A) — the two never cross ──
const sealedB = await sealHolospace({ manifest: B, now: () => "2026-06-16T00:00:00.000Z" });
ok("distinct-holospaces-distinct-cid", sealedB.rootCid !== sealedA.rootCid);
const fromB = await restoreHolospace(sealedB.rootCid, verifiedBlockSource(sealedB.blocks));
ok("b-restores-b-only", fromB && fromB.manifest["holo:holospace"].addr === "holo://bravo" && !jcs(fromB.manifest).includes("alpha"));

// ── no egress (asserted last) ──
ok("no-network-egress", fetched === false);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  witnessed,
  covers: [
    "a bundle of one holospace contains NONE of another holospace's data — no window id, app bytes, appState, board widget, or address (isolation; selective sharing anchored to one instance)",
    "the bundle carries no operator / device / timestamp / global settings and is not the whole-session shape — it leaks nothing about who or which machine made it",
    "an authored app's own bytes (srcdoc/content) AND its saved appState survive the round trip byte-for-byte, so it runs fully in the imported holospace; a built-in app travels linked by its κ",
    "analyzeHolospace honestly counts self-contained vs built-in (linked κ) vs web surfaces",
    "the same holospace seals to the same root CID (content address, no nonce) — dedup",
    "seal → restore re-derives byte-for-byte (Law L5) across all three destinations: Local-device CAR, Sovereign-cloud token recognition, and Share-as-a-link URL fragment",
    "a tampered block is refused → null; an empty source returns a transport-honest null",
    "two distinct holospaces seal to distinct CIDs and never cross; no network egress on any path (Law L4)",
  ],
  checks,
  failed: fail,
  authority: "W3C PROV-O · W3C EARL 1.0 · IETF RFC 8785 (JCS) · FIPS 180-4 (SHA-256) · IPLD CIDv1 / UnixFS / CAR · UOR-ADDR · Laws L1/L4/L5",
  sample: { rootCidA: sealedA.rootCid, rootCidB: sealedB.rootCid, analysisA: an, carBytes: car.length },
};
writeFileSync(join(here, "holo-workspace-sync-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("share-holospace witness\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
