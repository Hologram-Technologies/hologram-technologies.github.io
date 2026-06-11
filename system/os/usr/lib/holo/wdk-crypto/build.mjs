// build.mjs — reproducibly rebuild wdk-crypto.bundle.mjs from pinned npm sources.
// One self-contained ESM bundle of the audited scure/noble crypto WDK is built on.
//   usage: node _shared/wdk-crypto/build.mjs
// Isolated under .build/ (its own package.json + node_modules); nothing leaks into the OS.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const build = join(here, ".build");
mkdirSync(build, { recursive: true });

const DEPS = {
  "@scure/bip39": "2.2.0",
  "@scure/bip32": "2.2.0",
  "@scure/base": "2.2.0",
  "micro-key-producer": "0.8.6",
  "@noble/curves": "2.2.0",
  "@noble/hashes": "2.2.0",
  "@noble/ciphers": "2.2.0",
  esbuild: "^0.25.0",
};
writeFileSync(join(build, "package.json"), JSON.stringify({ name: "wdk-crypto-build", private: true, type: "module", dependencies: DEPS }, null, 2));

const ENTRY = `// wdk-crypto entry — audited scure/noble crypto WDK is built on, one bundle, no CDN.
export { generateMnemonic, validateMnemonic, mnemonicToEntropy, entropyToMnemonic, mnemonicToSeedSync, mnemonicToSeed } from "@scure/bip39";
export { wordlist } from "@scure/bip39/wordlists/english.js";
export { HDKey } from "@scure/bip32";                              // BIP-32 secp256k1 HD (EVM, BTC)
export { HDKey as SlipHDKey } from "micro-key-producer/slip10.js"; // SLIP-0010 ed25519 HD (Solana, TON)
export { secp256k1 } from "@noble/curves/secp256k1.js";
export { ed25519 } from "@noble/curves/ed25519.js";
export { sha256, sha512 } from "@noble/hashes/sha2.js";
export { hmac } from "@noble/hashes/hmac.js";
export { pbkdf2 } from "@noble/hashes/pbkdf2.js";
export { secretbox } from "@noble/ciphers/salsa.js";              // libsodium crypto_secretbox (XSalsa20-Poly1305)
export { base58, base58check, bech32, base16 } from "@scure/base";
`;
writeFileSync(join(build, "entry.mjs"), ENTRY);

console.log("installing pinned deps…");
execFileSync("npm", ["i", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: build, stdio: "inherit", shell: process.platform === "win32" });

const out = join(here, "wdk-crypto.bundle.mjs");
const banner = "/* wdk-crypto.bundle.mjs — vendored @scure/bip39+bip32, micro-key-producer/slip10, @noble/curves+hashes+ciphers, @scure/base. Audited paulmillr/scure+noble; no CDN. See PROVENANCE.txt (Law L5). */";
execFileSync(join(build, "node_modules", ".bin", process.platform === "win32" ? "esbuild.cmd" : "esbuild"),
  ["entry.mjs", "--bundle", "--format=esm", "--target=es2022", "--minify", "--legal-comments=none", "--banner:js=" + banner, "--outfile=" + out],
  { cwd: build, stdio: "inherit", shell: process.platform === "win32" });

const pin = createHash("sha256").update(readFileSync(out)).digest("hex");
console.log("\nwrote " + out + "\nsha256: " + pin + "  wdk-crypto.bundle.mjs");
console.log("(update PROVENANCE.txt if this differs)");
