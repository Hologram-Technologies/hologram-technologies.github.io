#!/usr/bin/env node
// holo-workspace-witness.mjs — proves Phase A (universal capture seam) + Phase B (per-app time-travel /
// rollback): every app becomes its own persistent workspace on its own chain, with ZERO app code — it
// auto-saves, resumes after "remount", keeps independent per-app history, rewinds read-only, reverts
// without destroying history, and reports a plain change set. Real holo-identity signer; in-memory per-app
// strands (the browser host wires the same core to per-app encrypted κ-stores).
//
// Checks (all must hold):
//   1 captureAndResume   — save state, mount via a FRESH host over the same store → resume returns it (durable).
//   2 perAppIsolation    — two apps keep independent state + independent history.
//   3 lazyNoChange       — saving identical state twice adds no version (cheap/lazy).
//   4 timeTravelVersions — three changes → versions() lists three, in order.
//   5 previewReadOnly    — preview(0) returns the old state and adds NO version (scrub is safe).
//   6 revertKeepsHistory — revert(0) restores the old state as current AND keeps the later versions (nothing lost).
//   7 diffReportsChanges — diff(0,2) reports the added/changed keys in plain terms.
//   8 chainVerifies      — the app's per-app chain verifies (signed, hash-linked).
//   9 autoCaptureNoAppCode — host.capture() turns an app's change signal into a saved version, app writes nothing.
//
// Authority: UOR-ADDR · holospaces Laws L1/L2/L5 (monotonic: never destroy history) · rests on
// #holo-strand + #holo-workspace + #holo-workspace-host + #holo-identity. node tools/holo-workspace-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeStrand } from "../os/usr/lib/holo/holo-strand.mjs";
import { makeWorkspaceHost } from "../os/usr/lib/holo/holo-workspace-host.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
let tick = 0; const now = () => `2026-06-22T00:00:${String(tick++).padStart(2, "0")}.000Z`;

const op = await enroll({ label: "ws-tester", passphrase: "ws pass" });

// per-app in-memory stores (survive a fresh host = a "reload")
const stores = new Map();
const backendFor = (appKappa) => {
  if (!stores.has(appKappa)) stores.set(appKappa, []);
  return { load: async () => clone(stores.get(appKappa)), save: async (e) => { stores.set(appKappa, clone(e)); } };
};
const strandFor = (appKappa) => makeStrand({ backend: backendFor(appKappa), now, signer: op });
const newHost = () => makeWorkspaceHost({ strandFor, now });

const APP_A = "did:holo:sha256:" + "a".repeat(64);
const APP_B = "did:holo:sha256:" + "b".repeat(64);
const APP_C = "did:holo:sha256:" + "c".repeat(64);

// ── 1 · capture then resume after a fresh host (durable across "remount") ────────────────────────────
{
  const ws = newHost().workspace(APP_A);
  await ws.save({ tabs: ["home"] });
  const remount = await newHost().mount(APP_A);          // fresh host, same store
  ok("captureAndResume", JSON.stringify(remount.state) === JSON.stringify({ tabs: ["home"] }), JSON.stringify(remount.state));
}

// ── 2 · per-app isolation ────────────────────────────────────────────────────────────────────────────
{
  const host = newHost();
  await host.workspace(APP_A).save({ tabs: ["home", "wallet"] });   // advance A
  await host.workspace(APP_B).save({ doc: "draft", cursor: 12 });    // B independent
  const a = await host.workspace(APP_A).resume(), b = await host.workspace(APP_B).resume();
  ok("perAppIsolation", a.tabs && a.tabs.length === 2 && b.doc === "draft" && b.cursor === 12, JSON.stringify({ a, b }));
}

// ── 3 · lazy: identical save adds no version ─────────────────────────────────────────────────────────
{
  const ws = newHost().workspace(APP_B);
  const before = (await ws.versions()).length;
  const r = await ws.save({ doc: "draft", cursor: 12 });            // identical to current head
  const after = (await ws.versions()).length;
  ok("lazyNoChange", r === null && after === before, `before=${before} after=${after}`);
}

// ── 4 · time-travel: three changes → three versions, in order ────────────────────────────────────────
{
  const ws = newHost().workspace(APP_C);
  await ws.save({ tabs: ["home"] });
  await ws.save({ tabs: ["home", "wallet"] });
  await ws.save({ tabs: ["home", "wallet", "atlas"], theme: "dark" });
  const vs = await ws.versions();
  ok("timeTravelVersions", vs.length === 3 && vs[0].n === 0 && vs[2].n === 2, `versions=${vs.length}`);
}

// ── 5 · preview is read-only ─────────────────────────────────────────────────────────────────────────
{
  const ws = newHost().workspace(APP_C);
  const before = (await ws.versions()).length;
  const old = await ws.preview(0);
  const after = (await ws.versions()).length;
  ok("previewReadOnly", JSON.stringify(old) === JSON.stringify({ tabs: ["home"] }) && after === before, `after=${after} before=${before}`);
}

// ── 6 · revert restores old state as current AND keeps history (nothing destroyed) ───────────────────
{
  const ws = newHost().workspace(APP_C);
  const lenBefore = (await ws.versions()).length;            // 3
  await ws.revert(0);                                        // restore v0 ({tabs:["home"]})
  const cur = await ws.resume();
  const lenAfter = (await ws.versions()).length;             // 4 — grew, nothing lost
  const stillThere = (await ws.preview(2)).theme === "dark"; // the later version is still rewind-able
  ok("revertKeepsHistory", JSON.stringify(cur) === JSON.stringify({ tabs: ["home"] }) && lenAfter === lenBefore + 1 && stillThere, JSON.stringify({ lenBefore, lenAfter, cur }));
}

// ── 7 · diff reports plain changes between versions ──────────────────────────────────────────────────
{
  const ws = newHost().workspace(APP_C);
  const d = await ws.diff(0, 2);   // {tabs:[home]} → {tabs:[home,wallet,atlas], theme:dark}
  ok("diffReportsChanges", d.added.includes("theme") && d.changed.includes("tabs") && d.count >= 2, JSON.stringify(d));
}

// ── 8 · the per-app chain verifies (signed, hash-linked) ─────────────────────────────────────────────
{
  const v = await strandFor(APP_C).verify();   // a fresh strand over APP_C's store
  ok("chainVerifies", v.ok === true && v.length >= 3, JSON.stringify(v));
}

// ── 9 · auto-capture with ZERO app code: a change signal becomes a saved version ─────────────────────
{
  const host = newHost();
  let live = { panel: "left" }; let cb = null;
  const subscribe = (fn) => { cb = fn; return () => { cb = null; }; };
  const off = host.capture(APP_A, () => live, subscribe);   // the frame wires this; the app does nothing
  const lenBefore = (await host.workspace(APP_A).versions()).length;
  live = { panel: "right", scroll: 90 }; await cb();         // an app state change fires the listener
  const lenAfter = (await host.workspace(APP_A).versions()).length;
  const resumed = await host.workspace(APP_A).resume();
  off();
  ok("autoCaptureNoAppCode", lenAfter === lenBefore + 1 && resumed.panel === "right" && resumed.scroll === 90, JSON.stringify({ lenBefore, lenAfter, resumed }));
}

await forget(op.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-workspace A+B — every holospace tab/app is its own persistent workspace on its own source chain, with ZERO app code: the OS host auto-captures + resumes (Phase A), and each app gets deterministic, atomic, never-destroyed history with read-only preview and append-restore revert (Phase B). Per-app isolation, lazy saves, plain-language diff. Monotonic (rollback never deletes). Pure assembly over holo-strand + holo-identity; browser host wires per-app encrypted κ-stores. No new crypto.",
  authority: "UOR-ADDR · holospaces Laws L1/L2/L5 (monotonic) · rests on #holo-strand + #holo-workspace + #holo-workspace-host + #holo-identity",
  witnessed,
  covers: witnessed ? ["capture-resume", "per-app-isolation", "lazy", "time-travel", "preview-readonly", "revert-keeps-history", "diff", "chain-verifies", "auto-capture-zero-app-code"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-workspace-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-workspace witness — every app a persistent, time-travelable workspace (zero app code)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  every window remembers itself, rewinds safely, and never loses history" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
