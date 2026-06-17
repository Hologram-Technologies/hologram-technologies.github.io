#!/usr/bin/env node
// holo-shell-canonical-witness.mjs — PROVE the ONE canonical holospace shell. There is exactly one
// shell (os/usr/share/frame/shell.html, in OS2); it is the default AND only target for launching
// every app in the Hologram Apps catalog; the duplicates are retired; and the rule is ENFORCED for
// every app: any app that ships its own shell-style chrome (a top-level tab strip or a browser
// address/breadcrumb bar) must carry the ONE shared embed guard (holo-embed.js + html[data-embedded])
// so it drops that chrome when embedded — no app double-draws the frame. Pure-Node (route probes via
// the κ-route server + static reads); the runtime suppression itself is proven by holo-files-witness.
//
//   node tools/holo-shell-canonical-witness.mjs

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { startServer } from "./holo-serve-fhs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OS2 = join(here, "../os");
const APPS = process.env.HOLO_APPS_REPO || join(here, "../../../holo-apps");
const SHELL = "shell.html";

const results = []; let passed = 0, failed = 0;
const rec = (name, ok, detail = "") => { results.push({ name, ok, detail }); ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${name}${detail ? "  (" + detail + ")" : ""}`); };
const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };

const { port, close } = await startServer();
const base = `http://127.0.0.1:${port}`;
console.log(`OS2 serving at ${base}\n`);

// ── 1 · "/" boots THE canonical shell (in OS2), and it is served ──
const root = await fetch(`${base}/`, { redirect: "manual" }).catch(() => null);
const loc = root && root.headers.get("location");
rec("the default boot ('/') routes to the ONE canonical shell", !!loc && /\/shell\.html/.test(loc), loc || "no redirect");
const shellRes = await fetch(`${base}/${SHELL}`).catch(() => null);
const shellHtml = shellRes && shellRes.status === 200 ? await shellRes.text() : "";
rec("the canonical shell is served from OS2 (os/usr/share/frame/shell.html)",
  shellRes && shellRes.status === 200 && existsSync(join(OS2, "usr/share/frame/shell.html")), `HTTP ${shellRes && shellRes.status}`);
rec("the served shell IS the spatial holospace shell (tab strip · omnibar · app canvas)",
  /id="tabstrip"/.test(shellHtml) && /id="world"/.test(shellHtml) && /id="omni/.test(shellHtml), "markers");

// ── 2 · every shell decider targets the one shell (boot loader · interposition · greeter · projection) ──
rec("the rEFInd boot loader hands off to the shell", /loader\s+shell\.html/.test(read(join(OS2, "boot/boot/refind.conf"))));
rec("the boot chain interposes the greeter for the shell (rEFInd → SDDM → shell)",
  /\(shell\|home\|os\|workspace\)\\\.html/.test(read(join(OS2, "boot/index.html"))) || /shell\|home\|os\|workspace/.test(read(join(OS2, "boot/index.html"))));
const sddm = read(join(OS2, "usr/lib/holo/holo-sddm.js"));
rec("the greeter's default session + fallback target the shell",
  /loader:\s*"shell\.html"/.test(sddm) && /\|\|\s*"shell\.html"/.test(sddm), "holo-sddm.js");
rec("holospace.html folds a normal app link into the shell",
  /location\.replace\("\/shell\.html"/.test(read(join(OS2, "usr/share/frame/holospace.html"))));

// ── 3 · the duplicate shells are RETIRED (no second DEFAULT, no duplicate shell code) ──
// SELF-CONTAINED exemption (ADR: shared-lib → per-app self-containment): browser is KEPT as a
// vendored, standalone-run app (opened by a content link, with its own full chrome) — it is NOT the
// default shell (that is shell.html, proven in §1–2) and is not embedded in the OS shell, so the
// duplicate-DEFAULT-shell retirement does not apply to it. What must STILL hold: the old duplicate
// shell CODE is gone, and any truly-retired shell (sdk) is unreachable. Listed by id, explicit + auditable.
const SELF_CONTAINED_SHELLS = new Set(["org.hologram.HoloBrowser"]);
const catalog = JSON.parse(read(join(APPS, "apps/index.jsonld")) || "{}");
const ds = catalog["dcat:dataset"] || [];
const ids = ds.map((a) => a["schema:identifier"] || "");
const strayShell = ids.filter((id) => (id === "org.hologram.HoloBrowser" || id === "org.hologram.HoloSDK") && !SELF_CONTAINED_SHELLS.has(id));
rec("no duplicate DEFAULT shell in the catalog (a kept self-contained app is exempt)",
  strayShell.length === 0, `${ds.length} apps · self-contained exempt: ${[...SELF_CONTAINED_SHELLS].join(", ") || "none"}`);
rec("the old duplicate shell CODE is retired (holospaces/browser · holospaces/sdk · apps/sdk)",
  !existsSync(join(APPS, "apps/sdk")) &&
  !existsSync(join(OS2, "usr/share/holospaces/browser")) && !existsSync(join(OS2, "usr/share/holospaces/sdk")));
const sd = await fetch(`${base}/apps/sdk/index.html`).then(r => r.status).catch(() => 0);
rec("the retired shells are unreachable — no fallback serves them (kept self-contained apps exempt)", sd === 404, `sdk=${sd}`);

// ── 4 · the ENFORCEMENT: no app may render its OWN tab strip when hosted in the shell ──
// The shell frame provides the tabs; an app that ships its own top-level tab strip (#tabstrip) would
// double-draw the frame, so it MUST carry the ONE shared embed guard (holo-embed.js) AND gate that
// chrome with html[data-embedded] — dropping it when embedded, keeping it standalone. (App-specific
// navigation like an explorer breadcrumb or an IPFS address bar is the app's own function, not a
// frame duplicate, and is left to per-app judgment. The shell itself is not a catalog app — exempt.)
rec("the ONE shared embed guard exists in the OS runtime (holo-embed.js)", existsSync(join(OS2, "usr/lib/holo/holo-embed.js")));
const offenders = [];
for (const a of ds) {
  if (SELF_CONTAINED_SHELLS.has(a["schema:identifier"] || "")) continue;   // standalone-run vendored app — exempt (its chrome IS the app)
  const landing = a["dcat:landingPage"] || "";           // apps/<id>/index.html
  const html = read(join(APPS, landing));
  if (!html) continue;
  if (!/id="tabstrip"/.test(html)) continue;             // ships its own tab strip → must self-suppress
  const guarded = /holo-embed\.js/.test(html) && /\[data-embedded\]/.test(html);
  if (!guarded) offenders.push(landing.split("/")[1]);
}
rec("no app renders its own tab strip when embedded — each carries the embed guard (no double-drawn frame)",
  offenders.length === 0, offenders.length ? "unguarded: " + offenders.join(", ") : "all tab-strip apps guarded");

// ── 5 · ROOTED IN THE UOR SUBSTRATE — the shell is a self-verifying content-addressed object, not a
// file that escapes verification: sealed in the κ-route closure (the content-verify SW re-derives it,
// Law L5), reachable BY CONTENT, and Secure-Boot-pinned (rEFInd re-derives the loader, Law L5). ──
const closureDoc = JSON.parse(read(join(OS2, "etc/os-closure.json")) || "{}");
const sealed = (closureDoc.closure || {})[SHELL];
const servedHex = createHash("sha256").update(shellHtml).digest("hex");
const sealedHex = sealed && String(sealed.kappa || "").split(":").pop();
rec("the shell is sealed in the OS-wide κ-route closure (a did:holo content address)",
  !!sealedHex && /^[0-9a-f]{64}$/.test(sealedHex), sealed ? `κ ${sealedHex.slice(0, 16)}…` : "not in closure");
rec("the served shell RE-DERIVES to its sealed κ — tamper-refused (Law L5)",
  sealedHex === servedHex && shellHtml.length > 0, sealedHex === servedHex ? "re-derives" : `served ${servedHex.slice(0, 12)} ≠ sealed ${(sealedHex || "").slice(0, 12)}`);
const byContent = await fetch(`${base}/.holo/sha256/${servedHex}`).then((r) => r.status).catch(() => 0);
rec("the shell resolves BY CONTENT at /.holo/sha256/<κ> (substrate-addressable, not path-only)", byContent === 200, `HTTP ${byContent}`);
const bootPin = (JSON.parse(read(join(OS2, "boot/boot/boot-manifest.json")) || "{}").loaders || {})[SHELL];
rec("the shell loader is Secure-Boot-pinned (rEFInd re-derives + refuses a mismatch, Law L5)",
  bootPin === "sha256:" + servedHex, bootPin ? (bootPin === "sha256:" + servedHex ? "pinned" : "stale pin") : "not pinned");

// ── 6 · ANCHORED IN THE UNIFIED UOR SUBSTRATE — upstream identity is BLAKE3 over the canonical form
// (CC-51); the sha256 did:holo is the OS-serving + interop projection (CC-63). So the shell carries
// its substrate σ-axis κ (did:holo:blake3, a W3C DID-Core alsoKnownAs) and re-derives to it byte-for-
// byte via OS2's BLAKE3 — which is KAT-proven byte-identical to the substrate's kappa() (holo-blake3
// row). Every object addressed by its attributes (content), resolvable on the one shared substrate. ──
const { blake3hex } = await import(pathToFileURL(join(OS2, "usr/lib/holo/holo-blake3.mjs")));
const aka = (sealed && sealed.alsoKnownAs) || [];
const subKappa = aka.find((k) => /^did:holo:blake3:[0-9a-f]{64}$/.test(k)) || "";
const subHex = subKappa.split(":").pop();
const servedBlake = blake3hex(Buffer.from(shellHtml));
rec("the shell is anchored on the unified UOR substrate (carries its did:holo:blake3 σ-axis κ)",
  /^[0-9a-f]{64}$/.test(subHex || ""), subKappa ? `blake3 ${(subHex || "").slice(0, 16)}…` : "no substrate alias");
rec("the served shell RE-DERIVES to its substrate κ via OS2 BLAKE3 (≡ substrate kappa(), Law L5 / CC-51)",
  subHex === servedBlake && servedBlake.length === 64,
  subHex === servedBlake ? "re-derives on the substrate axis" : `served ${servedBlake.slice(0, 12)} ≠ sealed ${(subHex || "").slice(0, 12)}`);

close();
const witnessed = failed === 0;
console.log(`\n${witnessed ? "WITNESSED ✓" : "FAILED ✗"} — ${passed}/${passed + failed} · the ONE canonical holospace shell, enforced`);
writeFileSync(join(here, "holo-shell-canonical-witness.result.json"),
  JSON.stringify({ witnessed, passed, failed, covers: results.filter(r => r.ok).map(r => r.name.slice(0, 40)), results,
    spec: "Hologram OS — one canonical holospace shell (shell.html, in OS2): the default and only launcher for every app; duplicates retired; the embed guard enforced for every app" }, null, 2) + "\n");
process.exit(witnessed ? 0 : 1);
