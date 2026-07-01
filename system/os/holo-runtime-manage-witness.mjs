// holo-runtime-manage-witness.mjs — §6: ONE management plane over every runtime tier. Proves the manager
// unifies holospace + VM runtimes into one list, routes snapshot/suspend/resume/stop to the owning tier,
// treats snapshots as κ-objects, is fail-closed (unknown/unsupported/tampered), and passes REAL telemetry
// through while returning null where a tier has none (never a fabricated number). Pure → Node-witnessed.
import { makeRuntimeManager, holospaceBackend, vmBackend, daemonClient } from "./usr/lib/holo/holo-runtime-manage.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ok  " + m); } else { fail++; console.log("  XX  " + m); } };

// a fake holo-residency (warm LRU + snapshot-on-evict + resume), matching the real API shape.
function fakeResidency() {
  let warm = ["spaceA"], snaps = ["spaceB"];
  return {
    warmKeys: () => warm.slice(),
    snapshotKeys: () => snaps.slice(),
    evict: async (id) => { if (!warm.includes(id)) return null; warm = warm.filter((k) => k !== id); snaps.push(id); return "kappaOf_" + id; },
    open: async (id) => { if (snaps.includes(id)) { snaps = snaps.filter((k) => k !== id); warm.push(id); return { hit: "resume", handle: {} }; } if (warm.includes(id)) return { hit: "warm", handle: {} }; warm.push(id); return { hit: "cold", handle: {} }; },
    close: (id) => warm.includes(id),
  };
}
const fakeDaemon = {
  list: () => [{ id: "vm1", state: "running", telemetry: { cpu: 12, ram: 512, io: 3 } }],
  snapshot: async (id) => ({ ok: true, kappa: "vmsnap_" + id }),
  resume: async () => ({ ok: true }),
  stop: async () => ({ ok: true }),
};

const res = fakeResidency();
const mgr = makeRuntimeManager({ backends: { holospace: holospaceBackend(res), vm: vmBackend(fakeDaemon) } });

// ── A. unified view across tiers ──
const l = mgr.list();
ok(l.length === 3, "list() unifies tiers → 3 runtimes (resident + suspended holospaces + a VM)");
ok(l.find((r) => r.id === "spaceA")?.tier === "holospace" && l.find((r) => r.id === "spaceA")?.state === "resident", "resident holospace tagged {tier:holospace, state:resident}");
ok(l.find((r) => r.id === "spaceB")?.state === "suspended", "suspended (snapshot) holospace tagged");
ok(l.find((r) => r.id === "vm1")?.tier === "vm", "VM tagged {tier:vm}");

// ── B. real telemetry passthrough vs honest null ──
ok(mgr.telemetry("vm1")?.ram === 512, "VM telemetry → REAL numbers (daemon passthrough)");
ok(mgr.telemetry("spaceA") === null, "holospace telemetry → null (honest — no daemon, never faked)");

// ── C. control routes to the owning tier; snapshots are κ ──
const s = await mgr.suspend("spaceA");
ok(s.ok && s.kappa === "kappaOf_spaceA", "suspend(holospace) → a snapshot κ (content-addressed object)");
ok(mgr.status("spaceA")?.state === "suspended", "after suspend, the unified view shows spaceA suspended");
const r = await mgr.resume("spaceA");
ok(r.ok && r.resumed === true, "resume(holospace) restores from its κ (verify-before-use)");
const vs = await mgr.snapshot("vm1");
ok(vs.ok && vs.kappa === "vmsnap_vm1", "snapshot(vm) → κ via the daemon (same interface, different tier)");

// ── D. fail-closed everywhere ──
ok((await mgr.resume("ghost")).ok === false, "unknown runtime → fail-closed { ok:false }");
const mgr2 = makeRuntimeManager({ backends: { holospace: { list: () => [{ id: "x", state: "resident" }] } } });
ok((await mgr2.stop("x")).ok === false, "a verb the tier doesn't implement → fail-closed (never a fake success)");
const resT = { warmKeys: () => [], snapshotKeys: () => ["t"], evict: async () => null, open: async () => ({ hit: "cold", handle: {} }), close: () => false };
const rt = await makeRuntimeManager({ backends: { holospace: holospaceBackend(resT) } }).resume("t");
ok(rt.ok && rt.resumed === false, "resume of a REFUSED/tampered snapshot cold-mounts clean (ok, resumed:false) — never wrong state");

// ── E. resilience: a broken tier can't sink the whole view ──
const mgr3 = makeRuntimeManager({ backends: { bad: { list: () => { throw new Error("boom"); } }, vm: vmBackend(fakeDaemon) } });
ok(mgr3.list().length === 1 && mgr3.list()[0].id === "vm1", "a tier whose list() throws never sinks the unified view");

// ── F. daemonClient — the REAL vm backend over HTTP (mock fetch) ──
const calls = [];
const mockFetch = async (url, opt = {}) => {
  calls.push({ url, method: opt.method || "GET", body: opt.body ? JSON.parse(opt.body) : null });
  if (url.endsWith("/telemetry.json")) return { ok: true, status: 200, json: async () => ({ vms: [{ id: "vm7", running: true, cpuPct: 33, memMiB: 1024, diskIoMBs: 5 }], nodes: [], fleet: {} }) };
  if (/\/vm\/vm7\/snapshot$/.test(url)) return { ok: true, status: 200, json: async () => ({ ok: true, kappa: "vmk_vm7" }) };
  if (/\/vm\/vm7\/(stop|start)$/.test(url)) return { ok: true, status: 200, json: async () => ({ ok: true }) };
  return { ok: false, status: 500, json: async () => ({}) };
};
const dc = daemonClient({ base: "http://d:8620", fetch: mockFetch });
ok((await dc.refresh()) === true, "daemonClient.refresh() caches the /telemetry.json frame");
const dl = dc.list();
ok(dl.length === 1 && dl[0].id === "vm7" && dl[0].state === "running", "daemonClient.list() maps frame.vms synchronously (from cache)");
ok(dl[0].telemetry.cpu === 33 && dl[0].telemetry.ram === 1024, "daemonClient.list() carries REAL telemetry (cpu/ram/io)");
ok((await dc.snapshot("vm7")).kappa === "vmk_vm7", "daemonClient.snapshot → POST /vm/:id/snapshot → κ");
calls.length = 0;
const susp = await dc.suspend("vm7");
ok(susp.ok && calls.some((c) => /snapshot$/.test(c.url) && c.method === "POST") && calls.some((c) => /stop$/.test(c.url) && c.method === "POST"), "daemonClient.suspend = snapshot THEN stop (the daemon's real verbs; no pause/cont)");
ok((await dc.snapshot("bad")).ok === false, "daemonClient fail-closed on an http error (never a fake ok)");

const mgrReal = makeRuntimeManager({ backends: { vm: vmBackend(dc) } });
ok(mgrReal.list().some((r) => r.id === "vm7" && r.tier === "vm") && mgrReal.telemetry("vm7").cpu === 33, "manager over vmBackend(daemonClient) → unified VM row + real telemetry passthrough");
ok((await mgrReal.resume("vm7")).ok, "manager.resume(vm) drives the real daemon (POST /vm/:id/start)");

console.log(`\n${fail ? "FAIL" : "ALL_PASS"}  ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
