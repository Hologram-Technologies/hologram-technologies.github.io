#!/usr/bin/env node
// holo-omni-resolve-witness.mjs — proves the Phase 0 de-risk for "unify the chrome" (Strategy A): the omnibox,
// lifted out of omniGo as a PURE destination resolver, maps any human input to ONE canonical navigable URL +
// a human NAME — deterministically, offline, refusing to invent what it cannot derive. This is the seam the
// native CEF OnBeforeBrowse interception calls and that Strategy B's shell-drawn chrome reuses.
//
// Checks (all must hold):
//   1 nameToCanonicalLoc   — "home"/"login"/"find" → the OS front-door loc, name = the place's NAME.
//   2 appNameAndWords      — an app NAME and its three-word κ-address both → the SAME app location.
//   3 kappaFormsUnify      — did:holo:sha256: · bare 64hex · holo://<hex> → the SAME holo://<hex>/ destination.
//   4 webProjects          — a bare domain and an https URL → the projection-lens URL, name = the domain.
//   5 mediaPlays           — a .mp4 URL → the κ-anchored player, not a web browse.
//   6 cidAndOnion          — an IPFS ref → the native gateway path; a .onion → the validated onion path.
//   7 textToFind           — free text → Holo Find with the query carried.
//   8 defersLiveShapes     — *.eth, 0x…, holo://zone/… → { defer:true } (never a fabricated destination).
//   9 deterministic        — same input twice → byte-identical result (pure + total).
//  10 namesNeverPaths      — every emitted NAME for a place/app contains no "/" and no ".html" (a name, not a path).
//
// Authority: mirrors omniGo's precedence (shell-main.mjs) over the real holo-open + holo-address modules.
// node tools/holo-omni-resolve-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveDestination, DEST, route } from "../os/usr/lib/holo/holo-omni-resolve.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

// a realistic apps catalog (the shape holo-address.index reads: schema:name, @id κ, landingPage, holo:words).
const BROWSER_K = "did:holo:sha256:" + "b".repeat(64);
const ATLAS_K   = "did:holo:sha256:" + "c".repeat(64);
const catalog = { "dcat:dataset": [
  { "@id": BROWSER_K, "schema:name": "Holo Browser", "dcat:landingPage": "holo://os/apps/browser/index.html", "holo:words": "brass.junior.quiz" },
  { "@id": ATLAS_K,   "schema:name": "Atlas",        "dcat:landingPage": "holo://os/apps/atlas/index.html",   "holo:words": "amber.cedar.violet" },
] };
const R = (typed, opts) => resolveDestination(typed, { catalog, ...(opts || {}) });

// 1 — a typed place name → its canonical OS location, named.
{
  const home = R("home"), login = R("login"), find = R("find");
  ok("nameToCanonicalLoc",
    home && home.url === "holo://os/shell.html" && home.name === "Home" &&
    login && login.url === "holo://os/login.html" && login.name === "Login" &&
    find && find.url === "holo://os/find.html" && find.name === "Find",
    JSON.stringify({ home, login, find }));
}

// 2 — an app name and its three speakable words resolve to the same app.
{
  const byName = R("browser");          // de-prefixed "Holo Browser"
  const byWords = R("brass.junior.quiz");
  ok("appNameAndWords",
    byName && byWords && byName.url === byWords.url &&
    byName.url === "holo://os/apps/browser/index.html" &&
    byName.name === "Holo Browser" && byWords.name === "Holo Browser",
    JSON.stringify({ byName, byWords }));
}

// 3 — every κ spelling unifies to one content-address destination.
{
  const hex = "a".repeat(64);
  const a = R("did:holo:sha256:" + hex), b = R(hex), c = R("holo://" + hex);
  const want = DEST.kappa(hex);
  ok("kappaFormsUnify",
    a && b && c && a.url === want && b.url === want && c.url === want &&
    a.kind === "kappa" && b.kind === "kappa" && c.kind === "kappa",
    JSON.stringify({ a, b, c, want }));
}

// 4 — a bare domain and a full URL both project, named by domain.
{
  const bare = R("news.ycombinator.com");
  const full = R("https://example.com/path?x=1");
  ok("webProjects",
    bare && bare.kind === "web" && bare.url === DEST.web("https://news.ycombinator.com") && bare.name === "news.ycombinator.com" &&
    full && full.kind === "web" && full.url === DEST.web("https://example.com/path?x=1") && full.name === "example.com",
    JSON.stringify({ bare, full }));
}

// 5 — a media file plays, even at an http URL (matches omniGo: media before web).
{
  const m = R("https://cdn.test/clip.mp4");
  ok("mediaPlays", m && m.kind === "media" && m.url === DEST.media("https://cdn.test/clip.mp4") && m.name === "clip.mp4", JSON.stringify(m));
}

// 6 — IPFS + onion route to their native verified paths.
{
  const cid = R("ipfs://bafybeigdyrabc");
  const onion = R("http://expyuzz4wqqyqhjn.onion/about");
  ok("cidAndOnion",
    cid && cid.kind === "cid" && cid.url === DEST.ipfs("bafybeigdyrabc") &&
    onion && onion.kind === "onion" && onion.url === DEST.onion("expyuzz4wqqyqhjn.onion"),
    JSON.stringify({ cid, onion }));
}

// 7 — free text becomes a Find query.
{
  const t = R("how tall is everest");
  ok("textToFind", t && t.kind === "text" && t.url === DEST.find("how tall is everest") && t.name === "how tall is everest", JSON.stringify(t));
}

// 8 — live shapes defer (never invent). web3 ENS/0x; an owned holo-zone name; a bare token when an anchor is pinned.
{
  const ens = R("vitalik.eth");
  const acct = R("0x" + "d".repeat(40));
  const zone = R("holo://zone/owner/handle");
  const bareNoAnchor = R("myname");                 // no anchor → free text (Find), NOT defer
  const bareAnchor = R("myname", { hasAnchor: true }); // anchor pinned → defer (might be an owned name)
  ok("defersLiveShapes",
    ens && ens.defer === true && ens.kind === "web3" &&
    acct && acct.defer === true && acct.kind === "web3" &&
    zone && zone.defer === true && zone.kind === "holoname" &&
    bareNoAnchor && bareNoAnchor.kind === "text" &&
    bareAnchor && bareAnchor.defer === true && bareAnchor.kind === "holoname",
    JSON.stringify({ ens, acct, zone, bareNoAnchor, bareAnchor }));
}

// 9 — pure + total: identical input → identical output.
{
  const inputs = ["home", "browser", "a".repeat(64), "news.ycombinator.com", "vitalik.eth", "how tall is everest"];
  const same = inputs.every((i) => JSON.stringify(R(i)) === JSON.stringify(R(i)));
  ok("deterministic", same);
}

// 10 — names are NAMES, never paths.
{
  const named = ["home", "login", "find", "browser", "atlas", "brass.junior.quiz"].map(R).filter((r) => r && r.name);
  const clean = named.every((r) => !r.name.includes("/") && !/\.html?$/i.test(r.name));
  ok("namesNeverPaths", clean && named.length >= 6, JSON.stringify(named.map((r) => r.name)));
}

// 11 — route(): the chrome action descriptor. Deterministic dest → navigate; live shape → open; the split is exact.
{
  const nav = route("home", { catalog });
  const openEns = route("vitalik.eth", { catalog });
  const navWeb = route("news.ycombinator.com", { catalog });
  const navKappa = route("a".repeat(64), { catalog });
  const empty = route("", { catalog });
  ok("routeActions",
    nav && nav.action === "navigate" && nav.url === "holo://os/shell.html" && nav.name === "Home" &&
    openEns && openEns.action === "open" && openEns.input === "vitalik.eth" &&
    navWeb && navWeb.action === "navigate" && navWeb.kind === "web" &&
    navKappa && navKappa.action === "navigate" && navKappa.kind === "kappa" &&
    empty === null,
    JSON.stringify({ nav, openEns, navWeb, navKappa, empty }));
}

const pass = Object.values(checks).every(Boolean);
const total = Object.keys(checks).length;
const result = { ok: pass, passed: Object.values(checks).filter(Boolean).length, total, checks, fail };
writeFileSync(join(here, "holo-omni-resolve-witness.result.json"), JSON.stringify(result, null, 2));
console.log(`holo-omni-resolve-witness: ${result.passed}/${total} ${pass ? "GREEN ✓" : "RED ✗"}`);
if (!pass) { console.log("  failed:", fail.join("; ")); process.exit(1); }
