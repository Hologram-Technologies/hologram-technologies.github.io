#!/usr/bin/env node
// canonical-link.mjs — print the CANONICAL ENTRY for the current OS, per holospaces Law L1 / Q1
// ("identity is a κ-label, never a host/path/URL"). The canonical entry is the content address of the
// boot root (etc/os-closure.json): a sha-256 κ IS a CIDv1(sha2-256). The shareable single link is
// <any-gateway>/#<CID> — holo-cid-boot reads the fragment, resolves the root by κ from the recovery
// chain (κ-store · IPFS · mesh · origin), RE-DERIVES it (Law L5), and boots content-addressed. The
// gateway (repo name, Pages path, custom domain, IPFS) is interchangeable and untrusted — only the κ is
// canonical. Re-run after any os-closure change; the CID updates with the content (Q4 reproducibility).
//
//   node tools/canonical-link.mjs [gateway-base]      default base: the GitHub Pages project URL
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeCIDv1, cidToString, cidToKappa, fromHex, CODEC, HASH } from "../os/usr/lib/holo/holo-ipfs.js";

const OS = join(dirname(fileURLToPath(import.meta.url)), "../os");
const BASE = process.argv[2] || "https://hologram-technologies.github.io/hologram-os";

const bytes = readFileSync(join(OS, "etc/os-closure.json"));
const kappa = createHash("sha256").update(bytes).digest("hex");
const cid = cidToString(makeCIDv1(CODEC.RAW, HASH.SHA2_256, fromHex(kappa)), "base32");
if (cidToKappa(cid) !== kappa) { console.error("CID/κ mismatch — refusing"); process.exit(1); }

console.log("boot root      etc/os-closure.json");
console.log("κ (sha2-256)   " + kappa);
console.log("CID (canonical) " + cid);
console.log("");
console.log("CANONICAL ENTRY (gateway-independent, self-verifying — Law L1/L5):");
console.log("  " + BASE.replace(/\/$/, "") + "/#" + cid);
console.log("");
console.log("Pin the root so the link survives a dead origin:");
console.log("  ipfs add --cid-version=1 --raw-leaves " + join(OS, "etc/os-closure.json").replace(/\\/g, "/"));
console.log("  (durable: pin the same CID to a service, e.g. Pinata, as prior os-closure roots were)");
