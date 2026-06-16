#!/usr/bin/env node
// holo-tor-fetch.mjs — provision a real Tor for the host, HONESTLY. Downloads the official Tor Expert Bundle,
// verifies it against Tor's published sha256sums (the integrity anchor), extracts the binary, computes its κ,
// and writes a pin file the host launcher (holo-tor-host.mjs) re-derives against before every launch (L5).
//
// WHY THIS IS A SEPARATE STEP (not auto-done in the request path): provisioning means downloading + executing
// a network daemon — a real, outward, one-time action that should be explicit and run where the network can
// actually reach torproject.org. (In some sandboxes *.torproject.org is blocked even when the Tor network
// itself is reachable; run this on the real host.) Nothing here is fabricated: we pin the κ of the exact
// bytes we verified against Tor's own checksums, and the launcher refuses anything that doesn't re-derive.
//
//   node tools/holo-tor-fetch.mjs [--version <v>] [--platform <key>]
//
// Stronger integrity (recommended): also verify the GPG signature of sha256sums-unsigned-build.txt against
// the Tor Browser Developers signing key — left as a documented manual step; the sha256sums match is enforced.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync, createWriteStream } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..");              // repo root (one above system/)
const CACHE = join(ROOT, ".holo-tor");
const DIST = "https://dist.torproject.org/torbrowser";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const PLATFORMS = {
  "win32-x64":  { tri: "windows-x86_64",  bin: "tor/tor.exe" },
  "linux-x64":  { tri: "linux-x86_64",    bin: "tor/tor" },
  "darwin-x64": { tri: "macos-x86_64",    bin: "tor/tor" },
  "darwin-arm64": { tri: "macos-aarch64", bin: "tor/tor" },
};
const platKey = arg("--platform", `${process.platform}-${process.arch}`);
const plat = PLATFORMS[platKey];
if (!plat) { console.error("unsupported platform: " + platKey + " (have: " + Object.keys(PLATFORMS).join(", ") + ")"); process.exit(2); }

async function get(url, asBuffer) {
  const r = await fetch(url, { redirect: "follow", headers: { "user-agent": "holo-tor-fetch" } });
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  return asBuffer ? new Uint8Array(await r.arrayBuffer()) : await r.text();
}
const sha256 = (u8) => createHash("sha256").update(u8).digest("hex");

(async () => {
  // 1 · resolve the version (latest) unless pinned via --version
  let version = arg("--version", null);
  if (!version) {
    try { const j = JSON.parse(await get("https://aus1.torproject.org/torbrowser/update_3/release/downloads.json")); version = j.version; }
    catch { throw new Error("could not resolve latest Tor version — pass --version <v> (and ensure torproject.org is reachable from this host)"); }
  }
  console.log(`[holo-tor] platform=${platKey} tri=${plat.tri} version=${version}`);

  const base = `${DIST}/${version}`;
  const file = `tor-expert-bundle-${plat.tri}-${version}.tar.gz`;
  const url = `${base}/${file}`;

  // 2 · download the bundle + Tor's official checksums, and VERIFY (integrity anchor)
  console.log(`[holo-tor] downloading ${url}`);
  const bundle = await get(url, true);
  const got = sha256(bundle);
  let sums; try { sums = await get(`${base}/sha256sums-unsigned-build.txt`); } catch { sums = ""; }
  const want = (sums.split(/\r?\n/).find((l) => l.includes(file)) || "").trim().split(/\s+/)[0] || "";
  if (!want) throw new Error("could not find " + file + " in sha256sums-unsigned-build.txt — refusing to pin an unverified bundle");
  if (want.toLowerCase() !== got.toLowerCase()) throw new Error(`CHECKSUM MISMATCH for ${file}\n  official: ${want}\n  got:      ${got}\n  refusing (the download does not match Tor's published checksum)`);
  console.log(`[holo-tor] ✓ bundle verified against Tor's sha256sums (${got.slice(0, 16)}…)`);
  console.log(`[holo-tor] NOTE: for full assurance also verify sha256sums-unsigned-build.txt.asc against the Tor Browser Developers GPG key.`);

  // 3 · extract (tar is present on Windows 10+, macOS, Linux) and κ-address the actual executable we'll run
  mkdirSync(CACHE, { recursive: true });
  const archivePath = join(CACHE, file);
  writeFileSync(archivePath, Buffer.from(bundle));
  console.log(`[holo-tor] extracting → ${CACHE}`);
  execFileSync("tar", ["-xzf", archivePath, "-C", CACHE], { stdio: "inherit" });
  const binPath = join(CACHE, plat.bin);
  if (!existsSync(binPath)) throw new Error("extracted bundle has no " + plat.bin);
  const binBytes = new Uint8Array(readFileSync(binPath));
  const kappa = "sha256:" + sha256(binBytes);

  // 4 · write the pin the launcher consumes (it re-derives the binary against this κ before every launch)
  const pin = { platform: platKey, kappa, bin: binPath, version, bundleSha256: got, source: url, verifiedAgainst: "sha256sums-unsigned-build.txt", at: new Date().toISOString() };
  writeFileSync(join(CACHE, "tor-pin.json"), JSON.stringify(pin, null, 2) + "\n");
  console.log(`\n[holo-tor] ✓ provisioned + pinned`);
  console.log(`  bin   : ${binPath}`);
  console.log(`  κ     : ${kappa}`);
  console.log(`  pin   : ${join(CACHE, "tor-pin.json")}`);
  console.log(`\nThe host (holo-serve / native) will now launch this κ-verified Tor on first onion use. Paste an onion in the omnibar to browse.`);
})().catch((e) => { console.error("[holo-tor] FAILED: " + (e && e.message || e)); process.exit(1); });
