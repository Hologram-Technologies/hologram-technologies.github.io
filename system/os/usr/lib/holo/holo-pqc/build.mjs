// build.mjs — reproducibly rebuild holo-pqc.bundle.mjs from a pinned npm source.
// One self-contained ESM bundle of the AUDITED @noble/post-quantum NIST PQC primitives, NO CDN:
//   • ML-KEM-1024  (FIPS 203, key-encapsulation, ~AES-256)
//   • ML-DSA-65/87 (FIPS 204, lattice signatures)
//   • SLH-DSA      (FIPS 205, hash-based signatures — defence-in-depth backup, different math)
//   usage: node _shared/holo-pqc/build.mjs
// Isolated under .build/ (its own package.json + node_modules); nothing leaks into the OS.
// Same lineage as wdk-crypto (paulmillr/@noble), same bundling discipline (Law L4: vendored, no server).
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const build = join(here, ".build");
mkdirSync(build, { recursive: true });

const DEPS = { "@noble/post-quantum": "0.6.1", "@noble/curves": "2.2.0", esbuild: "^0.25.0" };
writeFileSync(join(build, "package.json"), JSON.stringify({ name: "holo-pqc-build", private: true, type: "module", dependencies: DEPS }, null, 2));

const ENTRY = `// holo-pqc entry — audited @noble/post-quantum NIST PQC + @noble/curves x25519 for HYBRID, one
// bundle, no CDN (FIPS 203/204/205). Same lineage as wdk-crypto (paulmillr/@noble).
export { ml_kem1024 } from "@noble/post-quantum/ml-kem.js";    // FIPS 203 ML-KEM-1024 (key establishment)
export { ml_dsa65, ml_dsa87 } from "@noble/post-quantum/ml-dsa.js"; // FIPS 204 ML-DSA (signatures)
export { slh_dsa_sha2_256f } from "@noble/post-quantum/slh-dsa.js"; // FIPS 205 SLH-DSA (backup signatures)
export { x25519 } from "@noble/curves/ed25519.js";            // classical ECDH half of the hybrid KEM
`;
writeFileSync(join(build, "entry.mjs"), ENTRY);

console.log("installing pinned deps…");
execFileSync("npm", ["i", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: build, stdio: "inherit", shell: process.platform === "win32" });

const out = join(here, "holo-pqc.bundle.mjs");
// esbuild via a config file (avoids Windows shell mangling of the banner's punctuation).
const banner = "/* holo-pqc.bundle.mjs - vendored @noble/post-quantum@0.6.1 (MIT, audited paulmillr). FIPS 203 ML-KEM-1024, FIPS 204 ML-DSA-65/87, FIPS 205 SLH-DSA. No CDN, no server. See PROVENANCE.txt (Law L5). */";
writeFileSync(join(build, "esbuild.run.mjs"), `import { build } from "esbuild";\nawait build({ entryPoints: ["entry.mjs"], bundle: true, format: "esm", target: "es2022", minify: true, legalComments: "none", banner: { js: ${JSON.stringify(banner)} }, outfile: ${JSON.stringify(out)} });\n`);
execFileSync("node", ["esbuild.run.mjs"], { cwd: build, stdio: "inherit", shell: process.platform === "win32" });

const pin = createHash("sha256").update(readFileSync(out)).digest("hex");
console.log("\nwrote " + out + "\nsha256: " + pin + "  holo-pqc.bundle.mjs");
console.log("(record this in PROVENANCE.txt — Law L5)");
