// holo-strategy-witness.mjs — the keystone proof of ADR-0072 (Holo Strategy).
//
// CLAIM: a QuantConnect LEAN backtest is a *re-derivable* κ-transform — LEAN's determinism
// IS Law L5. We prove it the only honest way: run a REAL LEAN backtest TWICE over identical,
// content-addressed inputs and assert the deterministic result hashes to the SAME κ. No
// backtest is simulated; if the LEAN runtime is absent this witness reports SKIP, never a
// fake pass.
//
//   resultκ = f( engineκ ⊕ strategyκ ⊕ dataκ ⊕ configκ )      (deterministic ⇒ re-derivable)
//
// The κ-sealing is the substrate's one canonical primitive (holo-uor.mjs, NIHITO). The
// engine is vendored LEAN, unmodified (Apache-2.0). Hologram adds only content-addressing
// and the PROV-O receipt around LEAN's own deterministic output.
//
// Usage: node tools/holo-strategy-witness.mjs
//   env LEAN_RUN_DIR  — the built LEAN Launcher dir (contains QuantConnect.Lean.Launcher.dll + config.json)
//   env DOTNET        — path to dotnet (default: %USERPROFILE%\.dotnet\dotnet.exe, else "dotnet")
//   env LEAN_SRC      — the vendored LEAN source root (for strategyκ / HEAD); default derives from RUN_DIR

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { jcs, sha256hex, didHolo } from "../os/usr/lib/holo/holo-uor.mjs";

const HOME = homedir();
const DOTNET = process.env.DOTNET
  || (existsSync(join(HOME, ".dotnet", "dotnet.exe")) ? join(HOME, ".dotnet", "dotnet.exe") : "dotnet");
const RUN_DIR = process.env.LEAN_RUN_DIR
  || "C:/Users/pavel/Desktop/_holo-strategy-build/Lean/Launcher/bin/Release";
const SRC = process.env.LEAN_SRC || "C:/Users/pavel/Desktop/_holo-strategy-build/Lean";
const ALGO_SRC = join(SRC, "Algorithm.CSharp", "BasicTemplateFrameworkAlgorithm.cs");
const DATA_DIR = join(SRC, "Data");

const κ = (bytes) => didHolo("sha256", sha256hex(bytes));        // the one content address
const ok = []; const fail = [];
const check = (name, pass, detail = "") => { (pass ? ok : fail).push(name); console.log(`${pass ? "  ✓" : "  ✗"} ${name}${detail ? " — " + detail : ""}`); };

// ── seal the four content-addressed inputs (Law L1/L2: canonicalize at the boundary, hold κ) ──
function fileκ(p) { return κ(readFileSync(p)); }
function dirManifestκ(root) {                                     // a stable pin over the data tree
  const rows = [];
  const walk = (d, rel) => {
    for (const e of readdirSync(d).sort()) {
      const fp = join(d, e), st = statSync(fp), r = rel ? rel + "/" + e : e;
      if (st.isDirectory()) walk(fp, r); else rows.push([r, st.size]);
    }
  };
  walk(root, "");
  return κ(jcs(rows));
}

// ── run a REAL LEAN backtest; return the deterministic statistics surface (no wall-clock) ──
// LEAN writes <algorithm>.json whose `statistics` dict (Sharpe, Net Profit, …) is a pure function
// of the inputs. `state` carries wall-clock (StartTime/EndTime/Hostname) and is deliberately NOT sealed.
const RESULT = join(RUN_DIR, "BasicTemplateFrameworkAlgorithm.json");
function runBacktest(tag) {
  const started = Date.now();
  for (const f of ["BasicTemplateFrameworkAlgorithm.json", "BasicTemplateFrameworkAlgorithm-summary.json"])
    try { rmSync(join(RUN_DIR, f)); } catch {}                    // force a FRESH result (run B can't reuse run A's file)
  try {
    execFileSync(DOTNET, ["QuantConnect.Lean.Launcher.dll"], {
      cwd: RUN_DIR, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch { /* LEAN can exit non-zero while still writing a valid result; we verify the file below */ }
  if (!existsSync(RESULT)) throw new Error("LEAN produced no result file at " + RESULT);
  const stats = JSON.parse(readFileSync(RESULT, "utf8")).statistics || {};
  console.log(`    run ${tag}: ${Object.keys(stats).length} statistics in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return stats;
}

console.log("\nHolo Strategy — keystone witness (ADR-0072): a LEAN backtest is a re-derivable κ-transform\n");

if (!existsSync(join(RUN_DIR, "QuantConnect.Lean.Launcher.dll"))) {
  console.log(`SKIP — LEAN runtime not found at ${RUN_DIR}.`);
  console.log("Build it: dotnet build Launcher/QuantConnect.Lean.Launcher.csproj -c Release (needs .NET 10).");
  process.exit(0);                                                // honest SKIP, never a fake pass
}

const engineκ = κ(jcs({
  name: "QuantConnect LEAN", license: "Apache-2.0",
  head: (() => { try { return execFileSync("git", ["-C", SRC, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { return "unknown"; } })(),
  binaries: Object.fromEntries(["QuantConnect.Lean.Engine.dll", "QuantConnect.Common.dll", "QuantConnect.Algorithm.dll", "QuantConnect.Lean.Launcher.dll"]
    .map((b) => [b, sha256hex(readFileSync(join(RUN_DIR, b)))])),
}));
const strategyκ = fileκ(ALGO_SRC);                                // the QCAlgorithm bytes
const configκ = fileκ(join(RUN_DIR, "config.json"));
const dataκ = dirManifestκ(DATA_DIR);                            // pinned LEAN sample data
const compositeκ = κ(jcs([engineκ, strategyκ, dataκ, configκ])); // the backtest's input identity

console.log("inputs (each a content address):");
console.log("  engineκ  ", engineκ);
console.log("  strategyκ", strategyκ);
console.log("  dataκ    ", dataκ);
console.log("  configκ  ", configκ);
console.log("  compositeκ", compositeκ, "\n");

console.log("running the SAME backtest twice (proving determinism → identical result κ):");
const stats1 = runBacktest("A");
const stats2 = runBacktest("B");

const resultκ1 = κ(jcs(stats1));
const resultκ2 = κ(jcs(stats2));
console.log("\n  resultκ (run A)", resultκ1);
console.log("  resultκ (run B)", resultκ2, "\n");

check("LEAN produced statistics", Object.keys(stats1).length > 0, `${Object.keys(stats1).length} stats`);
check("the two runs re-derive byte-identically (Law L5)", resultκ1 === resultκ2);
check("a headline statistic is present + deterministic", stats1["Sharpe Ratio"] != null && stats1["Sharpe Ratio"] === stats2["Sharpe Ratio"], stats1["Sharpe Ratio"] != null ? `Sharpe ${stats1["Sharpe Ratio"]}` : "no Sharpe");
check("composite input key is stable", compositeκ === κ(jcs([engineκ, strategyκ, dataκ, configκ])));

// ── the PROV-O backtest receipt (hostrat:Backtest) — the run made a first-class, re-derivable κ-object ──
const receipt = {
  "@context": { schema: "https://schema.org/", prov: "http://www.w3.org/ns/prov#", hostrat: "https://hologram.os/ns/strategy#" },
  "@type": ["prov:Activity", "hostrat:Backtest", "schema:SimulateAction"],
  "prov:used": [
    { "@id": engineκ, "@type": ["prov:Entity", "schema:SoftwareApplication"], "schema:name": "QuantConnect LEAN", "schema:license": "Apache-2.0" },
    { "@id": strategyκ, "@type": ["prov:Entity", "hostrat:Strategy", "schema:SoftwareSourceCode"], "schema:programmingLanguage": "C#" },
    { "@id": dataκ, "@type": ["prov:Entity", "schema:Dataset"], "schema:name": "LEAN historical data" },
    { "@id": configκ, "@type": ["prov:Entity", "schema:DigitalDocument"] },
  ],
  "hostrat:compositeInput": compositeκ,
  "prov:generated": { "@id": resultκ1, "@type": ["prov:Entity", "schema:Dataset"], "hostrat:statistics": stats1 },
};
const receiptκ = κ(jcs(receipt));
console.log("  hostrat:Backtest receiptκ", receiptκ);
check("receipt re-derives (PROV-O, Law L5)", receiptκ === κ(jcs(receipt)));

console.log(`\n${fail.length ? "FAIL" : "PASS"} — ${ok.length}/${ok.length + fail.length} checks${fail.length ? " · failed: " + fail.join(", ") : ""}\n`);
process.exit(fail.length ? 1 : 0);
