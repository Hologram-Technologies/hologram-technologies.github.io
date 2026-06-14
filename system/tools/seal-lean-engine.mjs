// seal-lean-engine.mjs — seal the vendored QuantConnect LEAN engine as a self-verifying UOR
// object (ADR-0072, ADR-0025). The descriptor's `head` κ commits to the engine's identity
// (license · upstream commit · the SHA-256 of each core binary). Anchor-by-reference (Law L4):
// the descriptor lives in the repo; the heavy engine bytes live in the operator's vendored build.
// A tampered engine binary changes a hash → changes the head κ → is refused at load (Law L5).
//
// Usage: node tools/seal-lean-engine.mjs   (env LEAN_RUN_DIR, LEAN_SRC as in the witness)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { jcs, sha256hex, didHolo } from "../os/usr/lib/holo/holo-uor.mjs";

const HOME = homedir();
const RUN_DIR = process.env.LEAN_RUN_DIR || "C:/Users/pavel/Desktop/_holo-strategy-build/Lean/Launcher/bin/Release";
const SRC = process.env.LEAN_SRC || "C:/Users/pavel/Desktop/_holo-strategy-build/Lean";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "os", "etc", "holo-strategy", "lean-engine.uor.json");
const CORE = ["QuantConnect.Lean.Engine.dll", "QuantConnect.Common.dll", "QuantConnect.Algorithm.dll", "QuantConnect.Lean.Launcher.dll"];

if (!existsSync(join(RUN_DIR, CORE[0]))) { console.error("LEAN build not found at " + RUN_DIR); process.exit(1); }

const head = (() => { try { return execFileSync("git", ["-C", SRC, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { return "unknown"; } })();
// the sealed body — IDENTICAL shape to the witness's engineκ input, so descriptor.head === witness engineκ
const body = {
  name: "QuantConnect LEAN", license: "Apache-2.0", head,
  binaries: Object.fromEntries(CORE.map((b) => [b, sha256hex(readFileSync(join(RUN_DIR, b)))])),
};
const headκ = didHolo("sha256", sha256hex(jcs(body)));

const descriptor = {
  head: headκ,
  "@context": { schema: "https://schema.org/", prov: "http://www.w3.org/ns/prov#", hostrat: "https://hologram.os/ns/strategy#", spdx: "http://spdx.org/rdf/terms#" },
  "@type": ["prov:Entity", "hostrat:Engine", "schema:SoftwareApplication"],
  "schema:name": "QuantConnect LEAN",
  "schema:softwareVersion": head,
  "schema:license": "https://www.apache.org/licenses/LICENSE-2.0",
  "schema:codeRepository": "https://github.com/QuantConnect/Lean",
  "hostrat:vendoredBy": "anchor-by-reference (Law L4): bytes in the operator's build, identity pinned here",
  "hostrat:sealedBody": body,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(descriptor, null, 2) + "\n");

// re-derive to confirm the seal (Law L5)
const rederived = didHolo("sha256", sha256hex(jcs(JSON.parse(JSON.stringify(body)))));
console.log("sealed LEAN engine →", OUT);
console.log("  head κ      ", headκ);
console.log("  re-derives  ", rederived === headκ ? "✓ (Law L5)" : "✗ MISMATCH");
console.log("  upstream    ", head);
process.exit(rederived === headκ ? 0 : 1);
