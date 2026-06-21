#!/usr/bin/env node
// install-hooks.mjs — wire the tracked .githooks/ as this repo's hooks dir, so the pre-push seal check
// is active after a normal `npm install` (no manual step to forget). FAST FEEDBACK only — the CI
// verify-boot job is the actual guarantee; this just catches an unsealed push to main before it leaves
// the machine. Runs from package.json "prepare".
//
// Safe by construction — it can NEVER break `npm install`:
//   · exits 0 on every path (a throw in "prepare" would fail the whole install);
//   · no-op when there is no .githooks/pre-push (e.g. this package vendored into another project);
//   · no-op when not inside THIS repo's own work tree, or when git is absent.
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

try {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "../..");                  // system/tools → repo root (holo-os/)
  if (!existsSync(join(repoRoot, ".githooks", "pre-push"))) process.exit(0);   // nothing to wire
  let top = "";
  try { top = execSync("git rev-parse --show-toplevel", { cwd: repoRoot, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { process.exit(0); }                                 // not a git repo / git absent → skip
  if (resolve(top) !== resolve(repoRoot)) process.exit(0);   // vendored inside another repo → don't touch its config
  const current = (() => { try { return execSync("git config --get core.hooksPath", { cwd: repoRoot, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; } })();
  if (current !== ".githooks") {
    execSync("git config core.hooksPath .githooks", { cwd: repoRoot });
    console.log("hooks wired → .githooks (pre-push seal check active for pushes to main; bypass with --no-verify)");
  }
} catch { /* never fail the install */ }
process.exit(0);
