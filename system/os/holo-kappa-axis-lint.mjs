// holo-kappa-axis-lint.mjs — §1.2 GUARD (whole-tree). The OS mints κ on ONE axis (BLAKE3). This scans EVERY
// κ-module (not a hand-picked list — a guard that only looks where you already fixed can't catch drift), and:
//   • HARD-FAILS if a module in ENFORCED (already migrated) reintroduces a sha256 mint (regression gate);
//   • REPORTS every other sha256-mint candidate as REMAINING §1.2 work (the honest, authoritative scope);
//   • SKIPS sanctioned foreign bridges (Bitcoin/OTS, Substrate/Bittensor, the σ-axis module) — sha256 there
//     is a foreign-protocol hash, NOT a κ (§1.2 permits a NAMED bridge).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename, relative } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OS = dirname(fileURLToPath(import.meta.url));                    // holo-os/system/os
const ROOTS = [join(OS, "usr/lib/holo"), join(OS, "..", "..", "..", "holo-apps", "apps", "spaces")];

// migrated → MUST stay clean (a mint here fails the build). Grow this as modules are migrated.
const ENFORCED = new Set([
  "holo-derive.mjs", "holo-holospace-host.mjs", "holo-agent-registry.mjs", "holo-spaces.mjs",
  "holo-q-app-spec.mjs", "holo-q-app-seal.mjs", "holo-q-app-dag.mjs", "holo-q-create-loop.mjs",
  "holo-agent-surface.mjs", "holo-scene.mjs",
  // §1.2 parallel migration sweep (sha256 → blake3)
  "holo-mcp.mjs", "holo-session.mjs", "holo-q-create-fullstack.mjs", "holo-forge-bundle.mjs",
  "holo-hub-kernel.mjs", "holo-kappa-persist.mjs", "holo-app.mjs", "holo-import-agent.mjs",
  "holo-proof.mjs", "holo-user-adapter.mjs", "holo-workspace-share.mjs", "holo-hf-ingest.mjs",
  "holo-q-receipt.mjs", "holo-voice-orb-gpu.mjs", "holo-voice-orb.mjs", "holo-spaces-plan.mjs",
  "holo-ad4m-dna.mjs", "holo-ad4m.mjs", "holo-bar.mjs", "holo-blocks-repo.mjs",
  "holo-foresight-feed.mjs", "holo-kstore.mjs", "holo-govern.mjs", "holo-kappa-timeline.mjs",
  "holo-openbank.mjs", "holo-shard.mjs", "holo-wallet-agent.mjs", "holo-code-explorer.mjs",
  "holo-import.mjs",   // parity-migrated to blake3 to match holo-blocks-repo.addressOf
  "holo-omni-resolve.mjs", "holo-rank.mjs",   // omni: removed a dead sha256 PREFIX; rank: self-test synthetic keys → blake3
]);
// sanctioned foreign bridges — sha256 is ANOTHER protocol's addressing format, never a Holo content κ:
//   holo-anchor=Bitcoin/OTS · holo-bittensor=Substrate chain · holo-uor=the σ-axis SRI module · holo-cid=IPFS CID ·
//   holo-voice-holo-brain=GGUF model-pack manifest (parts + packKappa addressed by the pack format's own sha256).
const BRIDGES = new Set(["holo-anchor.mjs", "holo-bittensor.mjs", "holo-uor.mjs", "holo-cid.mjs", "holo-voice-holo-brain.mjs"]);
// CC-1 IDENTITY DID standard — did:holo:sha256:H(pubkey) is the STABLE principal NAME every credential, delegation,
// passport, signature and revocation is ISSUED OVER. It is NOT content-κ drift: migrating it would re-address every
// signed artifact (auth-breaking), and holo-identity ALREADY exposes kappaOf (blake3) as the canonical CONTENT κ
// alongside. A documented, scoped exception — revisit ONLY via a coordinated credential re-issue (DECIDED 2026-07-01).
const IDENTITY = new Set([
  "holo-identity.mjs", "holo-pair.mjs", "holo-delegate.mjs", "holo-revocation.mjs", "holo-q-passport.mjs",
  "holo-teleport.mjs", "holo-zone-net.mjs", "holo-self.mjs", "holo-pqc.mjs",
]);

const MINT = [
  { re: /didHolo\(\s*["']sha256["']/, name: "sha256 DID mint" },
  { re: /["']did:holo:sha256:["']\s*\+/, name: "sha256 DID literal mint" },
  { re: /=\s*sha256(?:hex|Hex)\s*\(/, name: "sha256 κ assignment" },
  { re: /(?:const|let|var)\s+\w*PREFIX\w*\s*=\s*["']did:holo:sha256:/, name: "sha256 mint DID prefix" },
  { re: /(?:const|let|var)\s+\w*PREFIX\w*\s*=\s*["']holo:\/\/sha256\//, name: "sha256 mint share prefix" },
];
// a line is exempt if it is a comment, a legacy/bridge reader, a PARSER/reference, or a test fixture.
const EXEMPT = /^\s*(\/\/|\*)|legacy|dual-read|dual read|LEGACY_PREFIX|bridge|σ-axis|foreign|transition|reference|\.replace\(|\.split\(|\.test\(|match\(|repeat\(|expectSubject|expectClosure|bait|tamper|forged/i;

function walk(dir) {
  let out = [];
  let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (/node_modules|vendor|devtools|\.git/.test(e.name)) continue; out = out.concat(walk(p)); }
    else if (e.isFile() && e.name.endsWith(".mjs") && !/witness|\.test\./.test(e.name)) out.push(p);
  }
  return out;
}

let enforcedFail = 0; const remaining = []; let identityScoped = 0;
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const base = basename(file);
    if (BRIDGES.has(base)) continue;                                  // sanctioned foreign-protocol bridge → not scanned
    if (IDENTITY.has(base)) { identityScoped++; continue; }           // CC-1 identity DID standard → documented scoped exception
    let src; try { src = readFileSync(file, "utf8"); } catch (e) { continue; }
    if (/�/.test(src.slice(0, 200))) continue;                   // binary/bundled → skip
    src.split(/\r?\n/).forEach((ln, i) => {
      if (EXEMPT.test(ln)) return;
      for (const m of MINT) if (m.re.test(ln)) {
        const rec = { file: relative(OS, file), line: i + 1, what: m.name, snip: ln.trim().slice(0, 66) };
        if (ENFORCED.has(base)) { enforcedFail++; console.log(`  XX  ENFORCED REGRESSION ${rec.file}:${rec.line} — ${rec.what}`); }
        else remaining.push(rec);
        break;
      }
    });
  }
}

const byFile = new Map();
for (const r of remaining) byFile.set(r.file, (byFile.get(r.file) || 0) + 1);
console.log(`\n§1.2 ENFORCED (migrated content-κ) — ${enforcedFail === 0 ? "CLEAN ✓" : enforcedFail + " REGRESSION(S) ✗"}  (${ENFORCED.size} modules)`);
console.log(`§1.2 documented exceptions: ${BRIDGES.size} foreign-protocol bridge(s) + ${identityScoped} CC-1 identity-DID module(s) (scoped, not content drift)`);
console.log(`§1.2 REMAINING content-κ DRIFT: ${remaining.length} hit(s) in ${byFile.size} module(s)${remaining.length ? " — TRUE nonconformances to migrate:" : " ✓ (every content κ is BLAKE3)"}`);
for (const [f, n] of [...byFile.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${n.toString().padStart(2)}  ${f}`);
process.exit(enforcedFail === 0 ? 0 : 1);   // gate = the migrated core stays clean; remaining is the tracked scope
