#!/usr/bin/env node
// gate.mjs — the Hologram OS conformance gate (fail-closed, ADR-024 in spirit). Joins every row of
// os/etc/conformance.jsonld to its witness's result, RE-RUNNING the cheap pure-Node witnesses live
// (the browser witnesses are read from their committed results, exactly like the upstream w3c-gate),
// emits a W3C EARL 1.0 report (os/etc/earl-report.jsonld), and EXITS NON-ZERO if any required row is
// not witnessed. No conformance state is hand-set — the witnesses are the source of truth.
//
//   node tools/gate.mjs

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));     // tools/
const OS2 = join(here, "../os");
const catalog = JSON.parse(readFileSync(join(OS2, "etc/conformance.jsonld"), "utf8"));
const rows = catalog.conforms || [];

// pure-Node witnesses are RUN live; browser witnesses are read from committed results.
const LIVE = new Set(["tools/fhs-graph-witness.mjs", "tools/qml-engine-witness.mjs", "tools/holo-forge-witness.mjs", "tools/holo-forge-registry-witness.mjs", "tools/holo-forge-exec-witness.mjs", "tools/holo-app-witness.mjs", "tools/holo-app-mcp-witness.mjs", "tools/holo-shell-mcp-witness.mjs", "tools/holo-mcp-sdk-witness.mjs", "tools/holo-serverless-mcp-witness.mjs", "tools/holo-api-witness.mjs", "tools/holo-link-witness.mjs", "tools/holo-shared-ref-witness.mjs", "tools/holo-route-witness.mjs", "tools/holo-telemetry-witness.mjs", "tools/holo-telemetry-tap-witness.mjs", "tools/holo-coherence-witness.mjs", "tools/holo-observer-witness.mjs", "tools/holo-courier-witness.mjs", "tools/holo-trust-witness.mjs", "tools/holo-evolve-witness.mjs", "tools/holo-ambient-witness.mjs", "tools/holo-memory-witness.mjs", "tools/holo-brain-floor-witness.mjs", "tools/holo-intent-witness.mjs", "tools/holo-resolve-witness.mjs", "tools/holo-q-faculty-witness.mjs", "tools/holo-fix-proposer-witness.mjs", "tools/holo-control-dsp-witness.mjs", "tools/holo-compose-mcp-witness.mjs", "tools/qml-mcp-witness.mjs", "tools/constitution-enforce-witness.mjs", "tools/boot-constitution-witness.mjs", "tools/holo-rw-witness.mjs", "tools/holo-egress-witness.mjs", "tools/holo-served-coverage-witness.mjs", "tools/holo-arch-witness.mjs", "tools/holo-ipfs-bounds-witness.mjs", "tools/holo-blake3-witness.mjs", "tools/holo-realization-parity-witness.mjs", "tools/holo-own-witness.mjs", "tools/holo-dual-axis-witness.mjs", "tools/holo-perf-witness.mjs", "tools/holo-own-mcp-witness.mjs", "tools/holo-own-demo-witness.mjs", "tools/holo-chain-witness.mjs", "tools/holo-ui-conformance-witness.mjs", "tools/holo-app-ui-conformance-witness.mjs", "tools/holo-app-mobile-witness.mjs", "tools/holo-app-conformance-witness.mjs", "tools/holo-dock-witness.mjs", "tools/holo-app-wired-witness.mjs", "tools/holo-app-token-witness.mjs", "tools/holo-app-composition-witness.mjs", "tools/holo-ux-witness.mjs", "tools/holo-app-ux-witness.mjs", "tools/holo-product-witness.mjs", "tools/holo-pm-witness.mjs", "tools/q-witness.mjs", "tools/holo-code-witness.mjs", "tools/holo-shell-canonical-witness.mjs", "tools/holo-substrate-witness.mjs", "tools/holo-corpus-witness.mjs", "tools/holo-serverless-witness.mjs", "tools/holo-substrate-oracle-witness.mjs", "tools/holo-atlas-coord-witness.mjs", "tools/qvac-witness.mjs", "tools/holo-bittensor-witness.mjs", "tools/holo-bittensor-mcp-witness.mjs", "tools/holo-runtime-witness.mjs", "tools/holo-heal-witness.mjs", "tools/holo-web-witness.mjs", "tools/holo-jupiter-witness.mjs", "tools/holo-app-governed-witness.mjs", "tools/holo-mind-witness.mjs", "tools/holo-mind-evolve-witness.mjs", "tools/holo-mind-soul-witness.mjs", "tools/holo-mind-orchestrate-witness.mjs", "tools/holo-devtools-cdp-witness.mjs", "tools/holo-devtools-domains-witness.mjs", "tools/holo-devtools-shell-witness.mjs", "tools/holo-devtools-live-witness.mjs", "tools/holo-widgets-modes-witness.mjs", "tools/holo-widgets-snap-witness.mjs", "tools/holo-q-fuse-witness.mjs", "tools/holo-q-fuse-panel-witness.mjs", "tools/holo-q-openrouter-witness.mjs", "tools/holo-q-recall-witness.mjs", "tools/holo-playground-agent-witness.mjs", "tools/holo-playground-3-witness.mjs", "tools/holo-playground-forces-witness.mjs", "tools/holo-playground-games-witness.mjs", "tools/holo-onnx-kstore-witness.mjs", "tools/holo-onion-witness.mjs", "tools/holo-session-witness.mjs", "tools/holo-workspace-sync-witness.mjs", "tools/holo-skin-witness.mjs", "tools/holo-homepage-witness.mjs", "tools/holo-tor-host-witness.mjs", "tools/holo-mobile-appearance-witness.mjs", "tools/holo-omni-feed-witness.mjs", "tools/holo-notify-witness.mjs", "tools/holo-anchor-witness.mjs", "tools/holo-cid-boot-witness.mjs"]);

// LIVE_EXIT — pure-Node witnesses that gate on their EXIT CODE (0 = witnessed), no committed .result.json
// needed. Used by the κ-render/spatial substrate witnesses (self-contained, fast, deterministic).
const LIVE_EXIT = new Set([
  "tools/holo-q-manifest-pin-witness.mjs", "tools/holo-dev-fresh-gate-witness.mjs",
  "tools/holo-memo-witness.mjs", "tools/holo-surface-witness.mjs", "tools/holo-surface-input-witness.mjs", "tools/holo-cc-surface-layout-witness.mjs",
  "tools/holo-xr-witness.mjs", "tools/holo-three-mesh-ui-witness.mjs", "tools/holo-aframe-witness.mjs",
  "tools/holo-render-registry-witness.mjs",
  "tools/holo-render-hub-witness.mjs",
  "tools/holo-erasure-witness.mjs",
  "tools/holo-heal-erasure-witness.mjs",
  "tools/holo-tile-witness.mjs",
  "tools/holo-terms-witness.mjs",
  "tools/holo-catalog-terms-witness.mjs",
  "tools/holo-ui-terms-witness.mjs",
  "tools/holo-tube-witness.mjs",
  "tools/holo-closure-anchor-witness.mjs",   // G1/SEC-1 — pin set verified against a baked anchor
  "tools/holo-delegate-witness.mjs",         // G4/SEC-2 — delegation attenuates, escalation refused
  "tools/holo-catalog-identity-witness.mjs", // G6/SEC-6 — every catalog @id is a content κ, never a slug
  "tools/holo-stepup-witness.mjs",           // explicit-consent — payload-bound TEE step-up; no signature without a fresh, action-κ-bound biometric proof
  "tools/holo-stepup-wiring-witness.mjs",    // explicit-consent — credPub captured at enrol round-trips (record→credentialOf) and verifies the step-up authenticator axis
  "tools/holo-stepup-gate-witness.mjs",      // explicit-consent — the ONE enforcement seam: classify→require→verify host-side→trust-window→fail-closed→unforgeable bridge
  "tools/holo-vault-rewrap-witness.mjs",     // key-custody — vault TEE-only rewrap: PRF vault passphrase-proof, κ-stable upgrade, S1–S4 guards (lockout-safe)
]);

function classify(witnessRel) {
  if (LIVE_EXIT.has(witnessRel)) {
    try { execFileSync(process.execPath, [join(here, "..", witnessRel)], { stdio: "ignore" }); return { ok: true, detail: "witnessed live (exit 0)" }; }
    catch { return { ok: false, detail: "witness failed (nonzero exit)" }; }
  }
  // G5/SEC-integrity: a LIVE witness is RE-RUN; if it errors we must NOT silently fall back to a stale
  // committed .result.json (the old `catch {}` did exactly that → green that was never reproduced). On a
  // live error the row fails closed. A clean exit 0 freshly rewrites the result we then read below.
  let liveFailed = false;
  if (LIVE.has(witnessRel)) {
    try { execFileSync(process.execPath, [join(here, "..", witnessRel)], { stdio: "ignore" }); }
    catch { liveFailed = true; }
  }
  const resPath = join(here, "..", witnessRel.replace(/\.mjs$/, ".result.json"));
  if (liveFailed) return { ok: false, detail: "FAILED LIVE — re-run errored; committed result not trusted (G5)", live: "failed" };
  if (!existsSync(resPath)) return { ok: false, detail: "no result (run the witness)" };
  const r = JSON.parse(readFileSync(resPath, "utf8"));
  if (witnessRel.includes("audit-apps")) {                 // pass = every app 0 fallbacks
    const apps = r.apps || []; const clean = apps.filter((a) => a.fallbacks === 0).length;
    return { ok: apps.length > 0 && clean === apps.length, detail: `${clean}/${apps.length} apps · 0 fallbacks` };
  }
  return { ok: r.witnessed === true, detail: (r.covers && r.covers.length) ? r.covers.join(", ") : (r.witnessed ? "ok" : "red") };
}

console.log("Hologram OS — conformance gate\n");
let fails = 0; const earl = [];
for (const row of rows) {
  const { ok, detail } = classify(row["hosc:witness"]);
  const required = row["hosc:required"] === true;
  if (required && !ok) fails++;
  console.log(`  ${ok ? "✓" : "✗"}  ${row.name}\n        ${row["hosc:witness"]} — ${detail}`);
  earl.push({
    "@type": "earl:Assertion",
    "earl:assertedBy": { "@id": "https://hologram.os/tools/gate" },
    "earl:subject": { "@id": "https://hologram.os", "dcterms:title": "Hologram OS" },
    "earl:test": { "@id": row["@id"], "dcterms:title": row.name },
    "earl:result": { "@type": "earl:TestResult", "earl:outcome": { "@id": ok ? "earl:passed" : "earl:failed" } },
    "earl:mode": { "@id": "earl:automatic" },
  });
}
writeFileSync(join(OS2, "etc/earl-report.jsonld"),
  JSON.stringify({ "@context": "http://www.w3.org/ns/earl", "dcterms:title": "Hologram OS — EARL conformance report", "@graph": earl }, null, 2) + "\n");

// ── performance gate (not a conformance row) — the boot working-set budget. It needs a headless browser
// + dev server, so it can't live in the host-agnostic conformance witness set (like webgpu-parity-ci, it
// stays out of the EARL rows). Enforced here so `npm run gate` catches a boot regression WHERE a browser
// exists, and SKIPS — never spuriously fails — where one doesn't: exit 0 pass · 1 over-budget · 2 skip.
console.log("\nPerformance gate:");
if (process.env.GATE_SKIP_PERF === "1") {
  console.log("  ⚠  boot-budget — SKIPPED (GATE_SKIP_PERF=1)");
} else {
  let code = 0;
  try { execFileSync(process.execPath, [join(here, "boot-budget-ci.mjs")], { stdio: "ignore" }); }
  catch (e) { code = (e && typeof e.status === "number") ? e.status : 1; }
  if (code === 2) console.log("  ⚠  boot-budget — SKIPPED (no browser/server here · run `npm run boot-budget` on a browser host)");
  else if (code === 0) console.log("  ✓  boot-budget — boot working set within tools/boot-budget.json");
  else { console.log("  ✗  boot-budget — boot working set OVER budget (run `npm run boot-budget` for detail)"); fails++; }
}

console.log(`\n${fails ? `FAIL — ${fails} required check(s) not witnessed` : `PASS — all ${rows.length} conformance rows witnessed + boot budget ✓`}   ·   EARL → os/etc/earl-report.jsonld`);
process.exit(fails ? 1 : 0);
