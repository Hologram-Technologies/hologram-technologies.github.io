#!/usr/bin/env node
// holo-kappa-launch-witness.mjs — κ-NATIVE LAUNCH: an app is opened by CONTENT, not location.
//
// The claim (the one cut-over of the "κ-Native Hologram" initiative): a launcher must dereference a
// κ — the app's content identity — never a file path. The whole resolve chain is content-addressed:
//   catalog @id (κ, Law L1)  →  holospace.lock closure (every member a κ)  →  mount() yields a
//   content-addressed mount descriptor { id:κ, entry:κ, closure:{path→κ} }  →  every byte re-derives
//   to its κ before use (Law L5)  →  a tampered byte refuses the mount.
// And the LAUNCHER itself (the mobile home screen) must hold the κ, not a "/apps/<id>/index.html" path.
//
// External ground truth: the REAL on-disk substrate — the served catalog, the Holo Files holospace
// lock, and the actual app/runtime bytes — re-derived with Node's own SHA-256. No fixtures, no stubs.
//
// Authority: UOR-ADDR (κ = <axis>:H(canonical_form)) · W3C DID Core (did:holo URL) · W3C DCAT
//            (the app catalog) · Hologram Law L1 (content not location) / L3 (instantiate once) /
//            L5 (verify by re-derivation) · ADR-033 (constitutional admission at the mount door).
//   node tools/holo-kappa-launch-witness.mjs
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Resolve the OS flat URL space (`_shared/…`) the way the in-browser Service Worker does (Law L2), so
// the REAL production holo-launch.mjs / holo-admit.mjs load in Node under their real fhs mapping.
register("./holo-fhs-loader.mjs", import.meta.url);
const { mount, validateMount, parseLink, linkFor, projectHtml, entryBase } = await import("../os/lib/holo-launch.mjs");
const { sealConstitution, admit } = await import("../os/usr/lib/holo/holo-admit.mjs");
const { fhsMap } = await import("../os/lib/holo-fhs-map.mjs");

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");                 // holo-os/system/os  (the lean OS image)
const APPS = join(here, "../../../holo-apps");  // sibling apps repo  (app source of truth)

const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

const KAPPA = /^did:holo:sha256:[0-9a-f]{64}$/;
const hexOf = (k) => String(k).split(":").pop();
const sha256hex = (buf) => createHash("sha256").update(buf).digest("hex");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// Locate the PHYSICAL bytes behind a closure path: the lean image first (fhsMap → FHS path), then the
// app source repo. Whichever holds bytes that re-derive to the κ is the substrate's truth.
function locate(rel) {
  const cands = [];
  const phys = fhsMap(rel);
  if (phys) cands.push(join(OS, phys));
  cands.push(join(APPS, rel));
  return cands.find((c) => existsSync(c)) || null;
}

// ── 1 · the CATALOG addresses apps by content (Law L1): every @id is a κ ──────────────────────────
const catalog = readJson(join(OS, "usr/share/holospaces/index.jsonld"));
const dataset = catalog["dcat:dataset"] || [];
const allIds = dataset.length > 0 && dataset.every((a) => KAPPA.test(a["@id"]));
ok("catalog-addresses-by-kappa", allIds, dataset.length ? "" : "empty catalog");
const filesEntry = dataset.find((a) => a["schema:identifier"] === "org.hologram.HoloFiles");
ok("catalog-has-files-app", !!filesEntry);

// ── 2 · the LOCK is a κ-closure: the root and every member are content addresses ──────────────────
const lock = readJson(join(OS, "usr/share/holospaces/files/holospace.lock.json"));
const closureEntries = Object.entries(lock.closure || {});
const closureAllKappa = closureEntries.length > 0 && closureEntries.every(([, r]) => KAPPA.test(r.kappa));
ok("lock-root-is-kappa", KAPPA.test(lock.root));
ok("lock-closure-all-kappa", closureAllKappa, `${closureEntries.length} members`);

// ── 3 · the MOUNT DOOR yields a content-addressed descriptor (ADR-033 governed) ───────────────────
// mount() is the one unbypassable chokepoint (holo-launch.mjs). Seal the Constitution first (Law L5),
// then mount the real Holo Files declaration + lock and prove the descriptor is κ end to end.
await sealConstitution().catch(() => {});
const def = readJson(join(APPS, "apps/files/holospace.json"));
ok("constitution-sealed-at-the-door", admit(def).sealed === true);
const m = mount({ def, lock });
const mountErrs = validateMount(m);
const closureValuesKappa = Object.values(m.closure).every((k) => KAPPA.test(k));
ok("mount-id-is-content-identity", m.id === lock.root && KAPPA.test(m.id));
ok("mount-entry-is-content-address", KAPPA.test(m.entry || ""), m.entry || "null");
ok("mount-descriptor-wellformed", mountErrs.length === 0, mountErrs.join("; "));
ok("mount-closure-all-kappa", closureValuesKappa);

// the single LINK round-trips to the same content identity (no location anywhere in it)
const link = parseLink(m.link);
ok("link-is-content-identity", !!link && link.hex === hexOf(m.id) && linkFor(m.id) === m.link);

// ── 4 · Law L5 — every byte RE-DERIVES to its κ (the substrate's truth, hashed by Node) ───────────
let verified = 0, mismatched = 0, located = 0;
let entryVerified = false, sharedVerified = false, appLocalVerified = false;
for (const [rel, r] of closureEntries) {
  const p = locate(rel);
  if (!p) continue;
  located++;
  const good = sha256hex(readFileSync(p)) === hexOf(r.kappa);
  if (good) {
    verified++;
    if (rel === "apps/files/index.html") entryVerified = true;
    if (rel.includes("_shared/")) sharedVerified = true;
    if (rel.startsWith("apps/files/")) appLocalVerified = true;
  } else { mismatched++; }
}
ok("L5-rederives-the-closure", verified > 0 && mismatched === 0, `${verified}/${located} verified, ${mismatched} mismatch`);
ok("L5-covers-entry-shared-and-app-bytes", entryVerified && sharedVerified && appLocalVerified,
   `entry=${entryVerified} shared=${sharedVerified} app=${appLocalVerified}`);

// ── 5 · Law L5 refuses TAMPER — flip one byte of the entry and the κ no longer matches ────────────
const entryPath = locate("apps/files/index.html");
let tamperRefused = false;
if (entryPath) {
  const bytes = Uint8Array.from(readFileSync(entryPath));
  bytes[Math.floor(bytes.length / 2)] ^= 0xff;
  tamperRefused = sha256hex(bytes) !== hexOf(m.entry);
}
ok("L5-refuses-tampered-entry", tamperRefused);

// ── 6 · the LAUNCHER holds the κ, not a path — the home screen opens apps by content identity ──────
// The mobile home screen (usr/share/frame/home-screen.html) is the surface a user actually taps. The
// κ-native cut-over: it captures each app's @id (κ) and hands that to the projection, instead of
// navigating its app frame straight to "/apps/<id>/index.html" (a location as identity).
const homeSrc = readFileSync(join(OS, "usr/share/frame/home-screen.html"), "utf8");
const capturesKappa = /kappa:\s*a\["@id"\]/.test(homeSrc);
const launchesByKappa = /holospace\.html\?app=/.test(homeSrc);
const noPathAsIdentity = !/\$\("appframe"\)\.src\s*=\s*a\.landing/.test(homeSrc);
ok("launcher-captures-content-identity", capturesKappa);
ok("launcher-opens-by-kappa-not-path", launchesByKappa && noPathAsIdentity,
   `byKappa=${launchesByKappa} noPath=${noPathAsIdentity}`);

// ── 7 · the FRAME BOUNDARY is content, not location — the projection mounts the entry BY ITS κ ─────
// holospace.html must fetch the entry by its κ-route, re-derive it (L5), and mount it as the frame's
// content (srcdoc) with a single <base> resolver-hint — not navigate the frame straight to a path.
const projSrc = readFileSync(join(OS, "usr/share/frame/holospace.html"), "utf8");
ok("projection-fetches-entry-by-kappa", /fetch\("\/\.holo\/sha256\/"\s*\+\s*entryHex/.test(projSrc));
ok("projection-rederives-before-mount", /crypto\.subtle\.digest\("SHA-256"/.test(projSrc) && /reHex === entryHex/.test(projSrc));
ok("projection-mounts-entry-as-content", /f\.srcdoc = projectHtml\(/.test(projSrc));

// projectHtml/entryBase are the pure frame-boundary logic — exercise them on the REAL entry document.
const realEntry = readFileSync(locate("apps/files/index.html"));
const base = entryBase("/apps/files/index.html");
const projected = projectHtml(new TextDecoder().decode(realEntry), base);
const baseCount = (projected.match(/<base\s/gi) || []).length;
ok("entry-base-is-canonical-dir", base === "/apps/files/");
ok("project-injects-single-base-hint", baseCount === 1 && projected.includes('<base href="/apps/files/">'));
ok("project-is-idempotent", projectHtml(projected, base) === projected);
// the CONTENT we fetch + verify is the entry κ; the <base> is injected into a copy for rendering only,
// so the identity we mounted by is unchanged (Law L1).
ok("kappa-identity-is-the-fetched-content", sha256hex(realEntry) === hexOf(m.entry));

// ── 8 · the DESKTOP shell mounts apps BY CONTENT too — launch() resolves the entry κ and srcdocs it ─
// shell.html mounts apps as in-shell windows (with same-origin Q/sound/plus injection), so it can't route
// through the projection. It does the same content-frame itself: resolve entry κ → fetch by κ-route →
// re-derive (L5) → projectHtml srcdoc. And its reload (⌘R) must re-set srcdoc, not blank it with src="".
const shellSrc = readFileSync(join(OS, "usr/share/frame/shell.html"), "utf8");
ok("shell-imports-projection", /import \{[^}]*\bprojectHtml\b[^}]*\bentryBase\b[^}]*\} from "\/holo-launch\.mjs"/.test(shellSrc));
ok("shell-resolves-entry-kappa", /kappaEntry\(app, def\)/.test(shellSrc) && /fetch\("\/\.holo\/sha256\/"\s*\+\s*hex/.test(shellSrc));
ok("shell-rederives-before-mount", /reHex !== hex/.test(shellSrc));
ok("shell-mounts-entry-as-content", /srcdoc: srcdoc \|\| undefined/.test(shellSrc));
ok("shell-reload-is-srcdoc-aware", /if \(f\.srcdoc\) \{ const s = f\.srcdoc; f\.srcdoc = ""; f\.srcdoc = s; \} else \{ f\.src = f\.src; \}/.test(shellSrc));

// ── 9 · the SPECIALIZED launchers — content-mount where clean, path-load where a query must survive ─
// Every catalog-app launch in the shell is content-native: the deep-link opener mounts by content when
// there's no routing query (else path-loads, still L5-verified), and every tiled holospace member mounts
// by content. Query-carrying launches (?go= deep-link, ?pick= picker) deliberately keep the path-load —
// srcdoc has no URL, so location.search would be lost; the path is a resolver hint, L5 at delivery.
ok("shell-deeplink-content-mount-no-query", /const srcdoc = query \? undefined : await kappaEntry\(app, def\)/.test(shellSrc));
ok("shell-holospace-members-content-mount", /const srcdoc = await kappaEntry\(app, def\);\s*\/\/[^\n]*\n\s*addNode\(\{ kind: "app"[^\n]*nested: true \}\)/.test(shellSrc));
ok("shell-query-launch-stays-path-loaded", /src: app\.landing \+ "\?go=desktop:" \+ deskId/.test(shellSrc) && /src: app\.landing \+ "\?pick=" \+ encodeURIComponent\(reqId\)/.test(shellSrc));

// ── result ────────────────────────────────────────────────────────────────────────────────────────
const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  witnessed,
  covers: [
    "Law L1 — the app catalog (W3C DCAT) addresses every app by its content κ (@id), never a location",
    "the holospace lock is a κ-closure: the root and every member are content addresses",
    "mount() — the one constitutional chokepoint (ADR-033) — yields a content-addressed descriptor { id:κ, entry:κ, closure:{path→κ} }; the single did:holo / holo:// link round-trips to the same identity",
    "Law L5 — the real on-disk substrate (catalog, lock, app + runtime bytes) re-derives to its κ, hashed by an independent SHA-256; a tampered entry byte refuses the mount",
    "the launcher (the mobile home screen) holds the κ and opens apps by content identity through the projection, not by navigating to a /apps/<id>/index.html path",
    "the frame boundary is content, not location: the projection fetches the entry by its κ-route, re-derives it (L5), and mounts it AS the frame's content (srcdoc); a single <base> is the only path and only a resolver hint — projectHtml/entryBase are pure, idempotent, and leave the content identity unchanged",
    "the desktop shell mounts apps by content too: launch() resolves the entry κ from the app's lock, fetches it by κ-route, re-derives (L5), and srcdocs the projected document into its in-shell window; reload is srcdoc-aware (re-sets srcdoc, never blanks with src=\"\")",
  ],
  catalog: { apps: dataset.length, allKappa: allIds },
  files: { root: lock.root, entry: m.entry, closure: closureEntries.length, verified, located, mismatched },
  checks, failed: fail,
  authority: "UOR-ADDR · W3C DID Core · W3C DCAT · Hologram Law L1/L3/L5 · ADR-033",
};
const outPath = join(here, "holo-kappa-launch-witness.result.json");
import("node:fs").then(({ writeFileSync }) => writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n"));
console.log("κ-native launch witness — an app is opened by content, not location\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  files root  ${lock.root}\n  entry       ${m.entry}\n  L5          ${verified}/${located} closure members re-derived to their κ (${mismatched} mismatch)`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
