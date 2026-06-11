#!/usr/bin/env node
// build-holo-evm.mjs — reproducibly (re)builds the vendored Holo EVM engine bundle.
//
// Holo EVM's engine is the EthereumJS reference implementation (Ethereum Foundation,
// passes ethereum/tests). We vendor it as ONE self-contained browser ES-module so the
// holospace is content-addressed, CDN-free and re-derivable byte-for-byte (Law L5).
//
// Usage:  node build-holo-evm.mjs
//   1. installs the pinned @ethereumjs v10 reference packages into build-evm/
//   2. bundles entry.mjs (namespace re-exports) → one minified browser ESM
//   3. copies it + the MPL-2.0 LICENSE into web/_shared/holo-evm/
//   4. prints the sha256 pins to paste into _shared/holo-evm/PROVENANCE.txt
//
// After running, refresh the κ pins:  node web/hub/make-hub.mjs   (re-pins evm.html)
// and re-run the witness:             node web/evm-witness.mjs

import { execSync } from "node:child_process";
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));     // …/crates/holospaces-web
const build = join(here, "build-evm");
const dest = join(here, "..", "..", "os", "_shared", "holo-evm");
const V = "10.1.2";                                       // pinned EthereumJS reference version
const PKGS = ["vm", "evm", "common", "statemanager", "mpt", "util", "tx", "block", "rlp"].map((p) => `@ethereumjs/${p}@${V}`);

mkdirSync(build, { recursive: true });
mkdirSync(dest, { recursive: true });

const ENTRY = `// Holo EVM engine entry — re-exports the EthereumJS reference implementation
// as stable namespaces so the holospace is insulated from per-symbol API churn.
export * as VM from "@ethereumjs/vm";
export * as EVM from "@ethereumjs/evm";
export * as Common from "@ethereumjs/common";
export * as StateManager from "@ethereumjs/statemanager";
export * as MPT from "@ethereumjs/mpt";
export * as Util from "@ethereumjs/util";
export * as Tx from "@ethereumjs/tx";
export * as Block from "@ethereumjs/block";
export * as RLP from "@ethereumjs/rlp";
export { keccak256 } from "ethereum-cryptography/keccak.js";
export { secp256k1 } from "ethereum-cryptography/secp256k1.js";
`;
writeFileSync(join(build, "entry.mjs"), ENTRY);
if (!existsSync(join(build, "package.json"))) writeFileSync(join(build, "package.json"), '{\n  "name": "holo-evm-build",\n  "private": true,\n  "type": "module",\n  "version": "0.0.0"\n}\n');

console.log("• installing EthereumJS v" + V + " reference packages + esbuild …");
execSync(`npm install --no-audit --no-fund ${PKGS.join(" ")} ethereum-cryptography@latest esbuild@latest`, { cwd: build, stdio: "inherit" });

console.log("• bundling → one browser ESM …");
execSync(`node ./node_modules/esbuild/bin/esbuild entry.mjs --bundle --format=esm --platform=browser --target=es2020 --minify --legal-comments=none --outfile=holo-evm.bundle.mjs`, { cwd: build, stdio: "inherit" });

copyFileSync(join(build, "holo-evm.bundle.mjs"), join(dest, "holo-evm.bundle.mjs"));
const lic = join(build, "node_modules", "@ethereumjs", "vm", "LICENSE");
if (existsSync(lic)) copyFileSync(lic, join(dest, "LICENSE"));

const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
console.log("\nκ pins (paste into _shared/holo-evm/PROVENANCE.txt):");
console.log(`  ${sha(join(dest, "holo-evm.bundle.mjs"))}  holo-evm.bundle.mjs`);
if (existsSync(join(dest, "LICENSE"))) console.log(`  ${sha(join(dest, "LICENSE"))}  LICENSE`);
console.log("\nDone. Next: node web/hub/make-hub.mjs  &&  node web/evm-witness.mjs");
