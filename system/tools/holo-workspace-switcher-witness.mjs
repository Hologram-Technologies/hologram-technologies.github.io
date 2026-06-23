#!/usr/bin/env node
// holo-workspace-switcher-witness.mjs — proves the Phase C switcher LOGIC (the DOM is browser-verified
// separately): named desktop arrangements over the real holo-workspaces core. Each workspace stores its
// whole-desktop experience manifest on its own chain (DESKTOP_KEY); switching auto-saves the current
// arrangement and restores the target. Real holo-identity signer; in-memory per-scope strands.
//
// Checks (all must hold):
//   1 seedNamesCurrent   — ensureSeed names the current desktop as workspace #1 (active, stored).
//   2 createSwitchesFresh — createWorkspace saves current, switches, and opens the fresh manifest.
//   3 autoSaveOnSwitch   — switching back saves the workspace you LEFT (its edits persist).
//   4 restoresTarget     — switching to a workspace restores ITS stored arrangement (not the other's).
//   5 renameStableActive — rename changes the label; identity + active selection are unaffected.
//   6 noopSameWorkspace  — switching to the already-active workspace is a no-op (no churn).
//
// Authority: holospaces Laws L1/L2/L5 (monotonic) · rests on #holo-workspaces + #holo-workspace-host +
// #holo-strand + #holo-identity. node tools/holo-workspace-switcher-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeStrand } from "../os/usr/lib/holo/holo-strand.mjs";
import { makeWorkspaces } from "../os/usr/lib/holo/holo-workspaces.mjs";
import { makeSwitcher } from "../os/usr/lib/holo/holo-workspace-switcher-ui.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
let tick = 0; const now = () => `2026-06-23T00:00:${String(tick++).padStart(2, "0")}.000Z`;

const op = await enroll({ label: "switcher-tester", passphrase: "switch pass" });
const stores = new Map();
const strandFor = (k) => { if (!stores.has(k)) stores.set(k, []); const s = stores.get(k); return makeStrand({ backend: { load: async () => clone(s), save: async (e) => { stores.set(k, clone(e)); } }, now, signer: op }); };
const registryStrand = makeStrand({ backend: (() => { let s = []; return { load: async () => clone(s), save: async (e) => { s = clone(e); } }; })(), now, signer: op });
const sets = makeWorkspaces({ registryStrand, strandFor, operator: op.kappa, now });

// the "shell" the switcher drives: a live desktop = a manifest; applying one swaps it in.
let DESKTOP = { name: "manifest", tabs: ["home", "wallet"] };          // current arrangement
const FRESH = { name: "manifest", tabs: ["home"] };
const getManifest = async () => clone(DESKTOP);
const applyManifest = async (m) => { DESKTOP = clone(m); };
const freshManifest = async () => clone(FRESH);

const sw = makeSwitcher({ sets, getManifest, applyManifest, freshManifest });

// ── 1 · seed names the current desktop ───────────────────────────────────────────────────────────────
const mainId = await sw.ensureSeed("Main");
{
  const { workspaces, active } = await sw.list();
  ok("seedNamesCurrent", workspaces.length === 1 && workspaces[0].name === "Main" && active === mainId, JSON.stringify({ n: workspaces.length, active: active === mainId }));
}

// edit Main's desktop, then create a fresh "Research"
DESKTOP = { name: "manifest", tabs: ["home", "wallet", "scan"] };       // Main now has 3 tabs
const research = await sw.createWorkspace("Research");

// ── 2 · create switched to a FRESH desktop ───────────────────────────────────────────────────────────
ok("createSwitchesFresh", DESKTOP.tabs.length === 1 && DESKTOP.tabs[0] === "home" && (await sw.active()) === research.id, JSON.stringify(DESKTOP.tabs));

// edit Research, then switch back to Main
DESKTOP = { name: "manifest", tabs: ["home", "docs", "mail"] };          // Research now has 3 tabs
await sw.switchTo(mainId);

// ── 3+4 · switching restored Main's saved 3-tab arrangement (auto-saved earlier) ────────────────────
ok("restoresTarget", DESKTOP.tabs.join(",") === "home,wallet,scan", JSON.stringify(DESKTOP.tabs));

// switch to Research again → its edited arrangement comes back (it was auto-saved on the switch away)
await sw.switchTo(research.id);
ok("autoSaveOnSwitch", DESKTOP.tabs.join(",") === "home,docs,mail", JSON.stringify(DESKTOP.tabs));

// ── 5 · rename keeps identity + active ───────────────────────────────────────────────────────────────
{
  await sw.rename(research.id, "Deep Research");
  const { workspaces, active } = await sw.list();
  const r = workspaces.find((w) => w.id === research.id);
  ok("renameStableActive", r && r.name === "Deep Research" && active === research.id, JSON.stringify({ name: r && r.name, active: active === research.id }));
}

// ── 6 · switching to the active workspace is a no-op ──────────────────────────────────────────────────
{
  const before = clone(DESKTOP);
  const r = await sw.switchTo(research.id);
  ok("noopSameWorkspace", r === false && JSON.stringify(DESKTOP) === JSON.stringify(before), String(r));
}

await forget(op.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-workspace-switcher C — named desktop arrangements over holo-workspaces: each workspace stores its whole-desktop manifest on its own chain; ensureSeed names the current desktop, createWorkspace opens a fresh one, and switching auto-saves the arrangement you leave and restores the target's. Rename keeps identity + active; switching to the active workspace is a no-op. Monotonic; zero app code; no κ surfaced. DOM browser-verified separately.",
  authority: "holospaces Laws L1/L2/L5 (monotonic) · rests on #holo-workspaces + #holo-workspace-host + #holo-strand + #holo-identity",
  witnessed,
  covers: witnessed ? ["seed-names-current", "create-switches-fresh", "auto-save-on-switch", "restores-target", "rename-stable-active", "noop-same-workspace"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-workspace-switcher-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-workspace-switcher witness — named desktop arrangements you switch between\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  switch rooms: each desktop saved + restored on its own chain" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
