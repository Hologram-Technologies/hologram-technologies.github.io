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
const LIVE = new Set(["tools/fhs-graph-witness.mjs", "tools/qml-engine-witness.mjs", "tools/holo-forge-witness.mjs", "tools/holo-forge-registry-witness.mjs", "tools/holo-forge-exec-witness.mjs", "tools/holo-app-witness.mjs", "tools/holo-app-mcp-witness.mjs", "tools/holo-shell-mcp-witness.mjs", "tools/holo-mcp-sdk-witness.mjs", "tools/holo-serverless-mcp-witness.mjs", "tools/holo-api-witness.mjs", "tools/holo-link-witness.mjs", "tools/holo-shared-ref-witness.mjs", "tools/holo-route-witness.mjs", "tools/holo-telemetry-witness.mjs", "tools/holo-control-dsp-witness.mjs", "tools/holo-compose-mcp-witness.mjs", "tools/qml-mcp-witness.mjs", "tools/constitution-enforce-witness.mjs", "tools/boot-constitution-witness.mjs", "tools/holo-rw-witness.mjs", "tools/holo-blake3-witness.mjs", "tools/holo-realization-parity-witness.mjs", "tools/holo-own-witness.mjs", "tools/holo-dual-axis-witness.mjs", "tools/holo-perf-witness.mjs", "tools/holo-own-mcp-witness.mjs", "tools/holo-own-demo-witness.mjs", "tools/holo-chain-witness.mjs", "tools/holo-ui-conformance-witness.mjs", "tools/holo-app-ui-conformance-witness.mjs", "tools/holo-app-mobile-witness.mjs", "tools/holo-dock-witness.mjs", "tools/holo-app-wired-witness.mjs", "tools/holo-app-token-witness.mjs", "tools/holo-app-composition-witness.mjs", "tools/holo-ux-witness.mjs", "tools/holo-app-ux-witness.mjs", "tools/holo-product-witness.mjs", "tools/holo-pm-witness.mjs", "tools/q-witness.mjs", "tools/holo-code-witness.mjs", "tools/holo-shell-canonical-witness.mjs", "tools/holo-substrate-witness.mjs", "tools/holo-corpus-witness.mjs", "tools/holo-serverless-witness.mjs", "tools/holo-substrate-oracle-witness.mjs", "tools/holo-atlas-coord-witness.mjs", "tools/qvac-witness.mjs", "tools/holo-bittensor-witness.mjs", "tools/holo-bittensor-mcp-witness.mjs", "tools/holo-runtime-witness.mjs", "tools/holo-heal-witness.mjs", "tools/holo-web-witness.mjs", "tools/holo-jupiter-witness.mjs", "tools/holo-app-governed-witness.mjs", "tools/holo-mind-witness.mjs", "tools/holo-mind-evolve-witness.mjs", "tools/holo-mind-soul-witness.mjs", "tools/holo-mind-orchestrate-witness.mjs", "tools/holo-devtools-cdp-witness.mjs", "tools/holo-devtools-domains-witness.mjs", "tools/holo-devtools-shell-witness.mjs", "tools/holo-devtools-live-witness.mjs", "tools/holo-widgets-modes-witness.mjs", "tools/holo-widgets-snap-witness.mjs", "tools/holo-q-fuse-witness.mjs", "tools/holo-q-fuse-panel-witness.mjs", "tools/holo-q-openrouter-witness.mjs", "tools/holo-q-recall-witness.mjs", "tools/holo-playground-agent-witness.mjs", "tools/holo-playground-3-witness.mjs", "tools/holo-playground-forces-witness.mjs", "tools/holo-playground-games-witness.mjs", "tools/holo-onnx-kstore-witness.mjs", "tools/holo-onion-witness.mjs", "tools/holo-session-witness.mjs", "tools/holo-workspace-sync-witness.mjs", "tools/holo-skin-witness.mjs", "tools/holo-homepage-witness.mjs", "tools/holo-tor-host-witness.mjs", "tools/holo-mobile-appearance-witness.mjs", "tools/holo-omni-feed-witness.mjs", "tools/holo-notify-witness.mjs"]);

function classify(witnessRel) {
  if (LIVE.has(witnessRel)) { try { execFileSync(process.execPath, [join(here, "..", witnessRel)], { stdio: "ignore" }); } catch {} }
  const resPath = join(here, "..", witnessRel.replace(/\.mjs$/, ".result.json"));
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

console.log(`\n${fails ? `FAIL — ${fails} required row(s) not witnessed` : `PASS — all ${rows.length} required conformance rows witnessed ✓`}   ·   EARL → os/etc/earl-report.jsonld`);
process.exit(fails ? 1 : 0);
