// vendor.mjs — reproducibly fetch the @tetherto WDK source VERBATIM (Law L5).
//   usage: node _shared/wdk/vendor.mjs
//
// The @tetherto/wdk orchestrator + @tetherto/wdk-wallet base classes + protocol base
// classes are pure ESM. We vendor them byte-for-byte, applying ONLY the standard
// "localize bare specifiers" transform (the same transform make-vendor.mjs / the btc-lib
// vendoring apply): bare npm specifiers -> the local files that satisfy them. Every
// transform is listed per file below; everything else is upstream-exact.
//
// NOT fetched here: @tetherto/wdk-secret-manager (its b4a / sodium-native / node:crypto
// runtime deps are not browser-portable). It is re-encoded byte-compatibly in
// ./wdk-secret-manager.js over the audited @noble secretbox/pbkdf2 — see that file.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const WDK = "37559b173f7273b8c65adbab741c30dd10378ce5";        // tetherto/wdk @ 2026-06-04
const WALLET = "dd8bb7ef85587f3ed5563f18f37c0663841684ef";     // tetherto/wdk-wallet @ 2026-05-25
const raw = (repo, sha, p) => `https://raw.githubusercontent.com/tetherto/${repo}/${sha}/${p}`;

// [url, outRelPath, transforms[[from,to]...]] — transforms apply in order (longest specifier first).
const FILES = [
  [raw("wdk", WDK, "index.js"), "core/index.js", []],
  [raw("wdk", WDK, "src/wdk-manager.js"), "core/src/wdk-manager.js", [
    ["'@tetherto/wdk-wallet/protocols'", "'../../wallet/src/protocols/index.js'"],
    ["'@tetherto/wdk-wallet'", "'../../wallet/index.js'"],
  ]],
  [raw("wdk", WDK, "src/wallet-account-with-protocols.js"), "core/src/wallet-account-with-protocols.js", [
    ["'@tetherto/wdk-wallet/protocols'", "'../../wallet/src/protocols/index.js'"],
  ]],
  [raw("wdk-wallet", WALLET, "index.js"), "wallet/index.js", []],
  [raw("wdk-wallet", WALLET, "src/wallet-manager.js"), "wallet/src/wallet-manager.js", [
    ["from 'bip39'", "from '../../bip39-shim.js'"],
  ]],
  [raw("wdk-wallet", WALLET, "src/wallet-account.js"), "wallet/src/wallet-account.js", []],
  [raw("wdk-wallet", WALLET, "src/wallet-account-read-only.js"), "wallet/src/wallet-account-read-only.js", []],
  [raw("wdk-wallet", WALLET, "src/errors.js"), "wallet/src/errors.js", []],
  [raw("wdk-wallet", WALLET, "src/protocols/index.js"), "wallet/src/protocols/index.js", []],
  [raw("wdk-wallet", WALLET, "src/protocols/swap-protocol.js"), "wallet/src/protocols/swap-protocol.js", []],
  [raw("wdk-wallet", WALLET, "src/protocols/bridge-protocol.js"), "wallet/src/protocols/bridge-protocol.js", []],
  [raw("wdk-wallet", WALLET, "src/protocols/lending-protocol.js"), "wallet/src/protocols/lending-protocol.js", []],
  [raw("wdk-wallet", WALLET, "src/protocols/fiat-protocol.js"), "wallet/src/protocols/fiat-protocol.js", []],
  [raw("wdk-wallet", WALLET, "src/protocols/swidge-protocol.js"), "wallet/src/protocols/swidge-protocol.js", []],
];

const pins = {};
for (const [url, out, transforms] of FILES) {
  let code = await fetch(url).then((r) => { if (!r.ok) throw new Error(r.status + " " + url); return r.text(); });
  for (const [from, to] of transforms) {
    if (!code.includes(from)) throw new Error(`transform target not found in ${out}: ${from}`);
    code = code.split(from).join(to);
  }
  const abs = join(here, out);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, code);
  pins[out] = "sha256:" + createHash("sha256").update(readFileSync(abs)).digest("hex");
  console.log("vendored", out.padEnd(46), transforms.length ? "(" + transforms.length + " localizations)" : "");
}

writeFileSync(join(here, "vendor.pins.json"), JSON.stringify({ repos: { wdk: WDK, "wdk-wallet": WALLET }, files: pins }, null, 2) + "\n");
console.log(`\nwrote ${Object.keys(pins).length} files + vendor.pins.json`);
