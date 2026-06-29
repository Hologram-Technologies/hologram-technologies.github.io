#!/usr/bin/env node
// holo-kappa-bridge-witness.mjs — P7 of the canonical-κ cutover: the REGRESSION GUARD. BLAKE3 is the one
// canonical κ (ADR-0115); SHA-256 survives only as a labeled bridge for foreign protocols. This lint holds
// that line: it FAILS the build if a NEW file mints a `did:holo:sha256` κ that is not on the sanctioned
// baseline AND is not `// BRIDGE:`-marked — so future code mints the canonical κ through kappo() or
// explicitly declares a bridge. A future grep for "sha" then reads "these are bridges," not "incomplete
// migration." It also POSITIVELY asserts the cutover landed: the canonical spine emits blake3.
// (Distinct from holo-bridge-witness.mjs, which proves the USD₮0 cross-chain bridge — unrelated.)
//
//   node tools/holo-kappa-bridge-witness.mjs

import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const SYSTEM = join(here, "..");

const checks = {}; let passed = 0, failed = 0;
const rec = (name, ok, detail) => { checks[name] = !!ok; ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${name}${detail ? "  " + detail : ""}`); };

// the κ-MINT pattern: CONSTRUCTING a did:holo:sha256 DID (template interpolation or string concat). Parsing
// / regex-matching a sha κ is NOT a mint and is ignored.
const MINT = /(`did:holo:sha256:\$\{|["']did:holo:sha256:["']\s*\+|did:holo:sha256:\$\{)/;
// Scope to PRODUCTION + seal code. Witnesses / benches construct sha κ as TEST FIXTURES (not production
// κ-mints), so they are noise for a regression guard — exclude them; the guard targets shipped modules and
// the seal/gen tooling, where a new sha κ would be a real cutover regression.
const skip = /(\/devtools\/vendor\/|\.result\.json$|holowhat\/|\.min\.|node_modules|_gen-bridge-baseline|-witness\.|-bench\.|[\\/]q-witness\.)/;
const roots = ["os/usr/lib/holo", "os/lib", "tools"];
const minted = new Set();
function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n); let s; try { s = statSync(p); } catch { continue; }
    const rp = p.replace(/\\/g, "/");
    if (s.isDirectory()) walk(p);
    else if (/\.(mjs|js|ts)$/.test(n) && !skip.test(rp)) {
      if (MINT.test(readFileSync(p, "utf8"))) minted.add(relative(SYSTEM, p).replace(/\\/g, "/"));
    }
  }
}
for (const r of roots) walk(join(SYSTEM, r));

const baseline = JSON.parse(readFileSync(join(here, "holo-kappa-bridge-baseline.json"), "utf8"));
const sanctioned = new Set(baseline.files);

// a NEW mint site is allowed ONLY if it carries a // BRIDGE: marker (an explicitly-declared foreign boundary).
const hasBridgeMarker = (relPath) => /\/\/\s*BRIDGE:/.test(readFileSync(join(SYSTEM, relPath), "utf8"));
const newMints = [...minted].filter((f) => !sanctioned.has(f));
const unsanctioned = newMints.filter((f) => !hasBridgeMarker(f));
rec("no NEW unsanctioned sha256 κ-mint (canonical-κ regression guard)", unsanctioned.length === 0,
  unsanctioned.length ? "→ route through kappo() or add // BRIDGE:: " + unsanctioned.join(", ") : `(${minted.size} sanctioned mints; baseline ${sanctioned.size})`);
if (newMints.length && !unsanctioned.length) console.log("    note: NEW but BRIDGE-marked (allowed): " + newMints.join(", "));

// migration progress: sanctioned files that no longer mint sha (the set may shrink, must not silently grow).
const migrated = [...sanctioned].filter((f) => !minted.has(f));
if (migrated.length) console.log(`    migration progress: ${migrated.length} baseline file(s) no longer mint a sha256 κ`);

// ── positive: the cutover actually landed on the canonical spine ──
const has = (rel, re) => re.test(readFileSync(join(SYSTEM, rel), "utf8"));
rec("canonical seam holo-kappa.mjs mints did:holo:blake3 (kappo)", has("os/usr/lib/holo/holo-kappa.mjs", /KAPPA_PREFIX = "did:holo:blake3:"/));
rec("sealer reseal-drift emits the canonical blake3 primary", has("tools/reseal-drift.mjs", /blake3: "did:holo:blake3:"/));
rec("sealer seal-served carries the canonical blake3", has("tools/seal-served.mjs", /blake3: `did:holo:blake3:/));
rec("app-CAS relock-app carries the canonical blake3", has("tools/relock-app.mjs", /blake3: `did:holo:blake3:/));
rec("the anchor (holo-anchor-sw) is blake3(os-closure.json)", has("tools/holo-anchor-sw.mjs", /blake3hex\(readFileSync\(closurePath\)\)/));
rec("identity exposes the canonical kappaOf seam", has("os/usr/lib/holo/holo-identity.mjs", /kappo as kappaOf/));

// ── positive: the named external bridges are present + self-documenting ──
rec("IPFS bridge self-documents sha2-256 CID", has("os/usr/lib/holo/holo-ipfs.js", /sha2-256|multihash/));
rec("SW marks the IPFS/GitHub-asset heal boundary // BRIDGE:", has("os/holo-fhs-sw.js", /BRIDGE: IPFS CIDv1/));
rec("SW marks the CSP source-hash boundary // BRIDGE:", has("os/holo-fhs-sw.js", /BRIDGE: CSP source-hash/));
rec("credential/present disclosure leaves marked // BRIDGE: SD-JWT-VC",
  has("os/usr/lib/holo/holo-credential.mjs", /BRIDGE: SD-JWT-VC/) && has("os/usr/lib/holo/holo-present.mjs", /BRIDGE: SD-JWT-VC/));

const witnessed = failed === 0;
writeFileSync(join(here, "holo-kappa-bridge-witness.result.json"), JSON.stringify({
  spec: "P7 — the canonical-κ regression guard. Fails on a NEW unsanctioned sha256 κ-mint (not baselined, not // BRIDGE:-marked); positively asserts the cutover landed on the canonical spine and the named external bridges are self-documenting.",
  witnessed, mintedNow: minted.size, baseline: sanctioned.size, newMints, unsanctioned, migrated: migrated.length,
  covers: ["bridge-line", "regression-guard", "blake3-canonical", "ipfs", "ens", "sri", "sd-jwt", "lint"],
  checks, passed, failed,
}, null, 2) + "\n");
console.log(`\nholo-kappa-bridge-witness: ${passed} passed, ${failed} failed · ${minted.size} sanctioned sha-mints, ${unsanctioned.length} unsanctioned`);
process.exit(witnessed ? 0 : 1);
