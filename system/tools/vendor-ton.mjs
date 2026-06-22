#!/usr/bin/env node
// vendor-ton.mjs — reproducibly vendor @ton/core into a single κ-sealable ESM bundle (mirrors the WDK
// vendor pattern). Installs the exact pinned version in a temp dir, bundles it with esbuild (browser
// target, Buffer shimmed via the bundled `buffer` package), copies it to vendor/ton/, and updates the
// sha256 pin in vendor.pins.json. Re-run to refresh; the witness checks the bundle re-derives to the pin.
//
//   node system/tools/vendor-ton.mjs
//
// Why @ton/core (not @ton/ton): a TON address is hash(wallet StateInit cell), so we need cells + BoC +
// the representation hash — that is @ton/core. The v4r2 wallet code BoC is pinned in holo-ton.mjs, and the
// derivation + transfer-message format are validated against @ton/ton (browser cross-check) + a fixed vector.

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, copyFileSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const VERSION = "0.59.1";
const here = dirname(fileURLToPath(import.meta.url));
const VENDOR = join(here, "../os/usr/lib/holo/vendor/ton");
const tmp = mkdtempSync(join(tmpdir(), "ton-vendor-"));
const run = (cmd, args, cwd) => { const r = spawnSync(cmd, args, { cwd, encoding: "utf8", shell: process.platform === "win32" }); if (r.status !== 0) throw new Error((r.stderr || r.stdout || "").slice(0, 400)); return r; };

console.log("vendor-ton — bundling @ton/core@" + VERSION + " …");
writeFileSync(join(tmp, "package.json"), JSON.stringify({ name: "ton-vendor", private: true, type: "module" }));
writeFileSync(join(tmp, "shim.js"), 'import { Buffer } from "buffer";\nif (typeof globalThis.Buffer === "undefined") globalThis.Buffer = Buffer;\nexport { Buffer };\n');
writeFileSync(join(tmp, "entry.mjs"), 'import "./shim.js";\nexport { Cell, Address, beginCell, contractAddress, storeStateInit, loadStateInit, BitString, Slice, Builder, external, internal, SendMode, storeMessageRelaxed, loadMessageRelaxed, storeMessage, comment, Dictionary } from "@ton/core";\n');
run("npm", ["install", "--no-audit", "--no-fund", `@ton/core@${VERSION}`, "buffer@6.0.3"], tmp);
run("npx", ["esbuild", "entry.mjs", "--bundle", "--format=esm", "--platform=browser", "--target=es2022", "--outfile=ton-core.bundle.mjs"], tmp);

copyFileSync(join(tmp, "ton-core.bundle.mjs"), join(VENDOR, "ton-core.bundle.mjs"));
const sha = createHash("sha256").update(readFileSync(join(VENDOR, "ton-core.bundle.mjs"))).digest("hex");
const pins = JSON.parse(readFileSync(join(VENDOR, "vendor.pins.json"), "utf8"));
pins["@ton/core"].version = VERSION; pins["@ton/core"].sha256 = sha;
writeFileSync(join(VENDOR, "vendor.pins.json"), JSON.stringify(pins, null, 2) + "\n");
rmSync(tmp, { recursive: true, force: true });
console.log("vendored @ton/core@" + VERSION + " → vendor/ton/ton-core.bundle.mjs  sha256 " + sha.slice(0, 16) + "…");
console.log("run `node tools/holo-ton-witness.mjs` to verify the bundle re-derives + the vector matches.");
