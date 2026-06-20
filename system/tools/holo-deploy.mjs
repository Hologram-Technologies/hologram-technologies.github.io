#!/usr/bin/env node
// holo-deploy.mjs — one command to turn the repo into the single magical link(s). Seals the OS, mints
// BOTH link forms with their REAL CIDs, and (opt-in) publishes to IPFS so the gateway link actually
// resolves. SAFE BY DEFAULT: with no flags it only COMPUTES + reports (offline `ipfs add --only-hash`,
// no network, no writes, no pinning). Every outward action is explicit.
//
//   node tools/holo-deploy.mjs                 # DRY — seal + mint both links offline, write a manifest
//   node tools/holo-deploy.mjs --dir <path>    # publish dir for the gateway/UnixFS CID (default: ../os)
//   node tools/holo-deploy.mjs --add           # add to the LOCAL ipfs repo (your node becomes a provider)
//   node tools/holo-deploy.mjs --pin           # pin every closure object to Pinata (recover-by-κ) — needs JWT + internet
//   node tools/holo-deploy.mjs --host <url>    # base URL for the friendly link (default: https://<host>)
//
// THE TWO FORMS (same OS, different roles):
//   friendly : <host>/#<closure-κ-CID>          host serves HTML+loader; loader self-verifies by that κ
//   gateway  : <site-dir-CID>.ipfs.dweb.link    gateway serves the UnixFS site directly (needs --add/--pin)

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { makeCIDv1, cidToString } from "../os/usr/lib/holo/holo-ipfs.js";

const here = dirname(fileURLToPath(import.meta.url));
const OS2 = join(here, "../os");
const argv = process.argv.slice(2);
const flag = (n) => argv.includes("--" + n);
const opt = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const fromHex = (h) => Uint8Array.from(Buffer.from(h, "hex"));
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" }).trim();
const log = (...a) => console.log(...a);

const PUBLISH_DIR = resolve(opt("dir", OS2));
const HOST = opt("host", "https://hologram.computer");

log("HOLOGRAM deploy\n");

// ── 1 · SEAL — bring the closure in step with the bytes on disk (so every κ re-derives) ──
try { execFileSync(process.execPath, [join(here, "reseal-drift.mjs")], { stdio: "ignore" }); log("✓ sealed — os-closure.json in step with disk"); }
catch { log("⚠ reseal-drift skipped/failed — continuing with the closure as-is"); }

// ── 2 · MINT the FRIENDLY link — the boot-root content address (the closure manifest's κ as a CIDv1) ──
const rootBytes = readFileSync(join(OS2, "etc/os-closure.json"));
const rootKappa = createHash("sha256").update(rootBytes).digest("hex");
const rootCid = cidToString(makeCIDv1(0x55, 0x12, fromHex(rootKappa)));   // raw block — what the loader recovers by κ
const friendly = `${HOST.replace(/\/$/, "")}/#${rootCid}`;
const dagRoot = (() => { try { return JSON.parse(rootBytes).root; } catch { return null; } })();
log(`\n✓ boot-root κ : ${rootKappa}`);
log(`✓ boot-root CID: ${rootCid}`);
if (dagRoot) log(`  (closure DAG root field: ${dagRoot})`);

// ── 3 · MINT the GATEWAY link — the UnixFS site-directory CID (what a subdomain gateway renders) ──
let siteCid = null, addMode = flag("add") ? "stored in local ipfs repo" : "computed offline (--only-hash)";
try {
  if (!existsSync(PUBLISH_DIR)) throw new Error("publish dir not found: " + PUBLISH_DIR);
  const addArgs = ["add", "-r", "-Q", "--cid-version=1", ...(flag("add") ? [] : ["--only-hash"]), PUBLISH_DIR];
  siteCid = sh("ipfs", addArgs).split("\n").pop().trim();
  log(`\n✓ site UnixFS CID: ${siteCid}  (${addMode})`);
} catch (e) {
  log(`\n⚠ could not compute the UnixFS site CID via ipfs: ${(e && e.message || e).toString().split("\n")[0]}`);
  log("  install/init Kubo (ipfs init) then re-run; the friendly link below works without it.");
}

// ── 4 · PIN (opt-in, needs internet) — make providers exist so the links resolve from anywhere ──
if (flag("pin")) {
  log("\n→ pinning every closure object to Pinata (recover-by-κ for the friendly form)…");
  try { execFileSync(process.execPath, [join(here, "holo-pin-closure.mjs")], { stdio: "inherit" }); }
  catch { log("⚠ closure pin failed (JWT at ~/.pinata.jwt? internet?)"); }
  if (siteCid && flag("add")) {
    log("→ pinning the site DAG locally (gateway form)…");
    try { sh("ipfs", ["pin", "add", siteCid]); log(`✓ pinned ${siteCid} on the local node`); }
    catch { log("⚠ local pin failed (is the ipfs daemon running?)"); }
  } else log("  (for the gateway-form CID, re-run with --add to store it, then pin via your node or a Pinata CAR upload)");
}

// ── 5 · EMIT the manifest + the two links + the go-live checklist ──
const gateway = siteCid ? `https://${siteCid}.ipfs.dweb.link/` : null;
const manifest = { at: new Date().toISOString?.() || null, host: HOST, publishDir: PUBLISH_DIR, rootKappa, rootCid, siteCid, dagRoot, friendly, gateway, added: flag("add"), pinned: flag("pin") };
writeFileSync(join(here, "holo-deploy.manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

log("\n────────────────────────────────────────────────────────");
log("THE LINK(S):\n");
log(`  friendly (any browser, deploy ${PUBLISH_DIR} to a host):\n    ${friendly}\n`);
if (gateway) log(`  gateway (host-agnostic, after --add + pin):\n    ${gateway}\n    ipfs://${siteCid}\n`);
log("GO LIVE:");
log(`  1. friendly: push ${PUBLISH_DIR} to GitHub Pages (or any static host) → the link above boots + self-verifies.`);
log("  2. gateway : node tools/holo-deploy.mjs --add --pin   (stores the site DAG + pins closure objects)");
log("  3. anchor  : node tools/holo-anchor-witness.mjs proves the verifier; submit the OTS proof on a networked box.");
log("\nmanifest → tools/holo-deploy.manifest.json");
