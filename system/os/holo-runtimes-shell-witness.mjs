// holo-runtimes-shell-witness.mjs — §6 shell wiring: the render-model is honest (only real telemetry, correct
// per-state controls) and installRuntimesSurface assembles the ONE plane from the shell's real backends, binds
// it to Q, and reflects the daemon after a refresh. Pure/assembly → Node-witnessed (the DOM render is host-only).
import { runtimesModel, installRuntimesSurface } from "./usr/lib/holo/holo-runtimes-shell.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ok  " + m); } else { fail++; console.log("  XX  " + m); } };

// ── A. runtimesModel (pure) ──
const rows = runtimesModel([
  { id: "a", tier: "holospace", state: "resident", telemetry: null },
  { id: "b", tier: "holospace", state: "suspended", telemetry: null },
  { id: "vm1", tier: "vm", state: "running", telemetry: { cpu: 20, ram: 256, io: null } },
]);
ok(rows.find((r) => r.id === "a").actions.join(",") === "snapshot,suspend,stop", "resident runtime → snapshot/suspend/stop controls");
ok(rows.find((r) => r.id === "b").actions.join(",") === "resume", "suspended runtime → resume control");
ok(rows.find((r) => r.id === "a").telemetry === "", "no telemetry → blank text (honest, never fabricated)");
ok(rows.find((r) => r.id === "vm1").telemetry === "CPU 20% · RAM 256MB", "vm telemetry text; io:null omitted (no fake 0)");

// ── B. installRuntimesSurface — assemble the plane from real backends + bind Q + reflect the daemon ──
const fakeRes = { warmKeys: () => ["a"], snapshotKeys: () => ["b"], evict: async () => "k", open: async () => ({ hit: "resume", handle: {} }), close: () => true };
let boundMgr = null; const fakeQ = { configureRuntimes: (m) => { boundMgr = m; } };
const mockFetch = async () => ({ ok: true, status: 200, json: async () => ({ vms: [{ id: "vm1", running: true, cpuPct: 20, memMiB: 256 }], nodes: [], fleet: {} }) });
const surf = installRuntimesSurface({ residency: fakeRes, daemonBase: "http://d", fetch: mockFetch, Q: fakeQ });
ok(!!surf.manager && boundMgr === surf.manager, "installRuntimesSurface binds the assembled manager to Q (Q.configureRuntimes)");
ok(surf.model().some((r) => r.id === "a" && r.tier === "holospace"), "assembled plane lists holospace runtimes (from the shell residency)");
await surf.refresh();
const m1 = surf.model();
ok(m1.some((r) => r.id === "vm1" && r.tier === "vm"), "after refresh() the plane lists the VM (daemon frame cached)");
ok(m1.find((r) => r.id === "vm1").telemetry === "CPU 20% · RAM 256MB", "assembled plane carries REAL VM telemetry end-to-end");
ok(surf.render() !== undefined, "render() is node-safe (no document → returns the model)");

console.log(`\n${fail ? "FAIL" : "ALL_PASS"}  ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
