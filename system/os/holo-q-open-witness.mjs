// holo-q-open-witness.mjs — §7.3: Q OPERATES the one verb. Q.open(ref) is a first-class operator verb that
// drives the host-bound open executor (→ window.HoloOpen → holo://space/<κ> → the §0 derive portal). Governed
// like act/agent (external callers gated, fail-closed); the human orb is sovereign. Pure → Node-witnessed.
import { createQ } from "./usr/lib/holo/q/holo-q.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ok  " + m); } else { fail++; console.log("  XX  " + m); } };
const stubT = { create: async () => ({ kappa: "x", value: "v" }), state: () => ({}), improve: () => {}, startImproving: () => {}, stopImproving: () => {} };
const K = "holo://space/" + "a".repeat(64);

const q = createQ({ trinity: stubT, mux: { routeTask: () => null } });
ok(typeof q.open === "function", "Q.open is a first-class verb on the door");
ok(q.capabilities().some((c) => c.id === "open" && /κ|portal/.test(c.what)), "capabilities() advertises open as the κ/portal operator");

let opened = null;
q.configureActions({ open: async (ref) => { opened = ref; return { tab: 1 }; } });
const r = await q.open(K);
ok(r.ok && r.kind === "open" && opened === K, "Q.open(κ) drives the bound open executor (→ HoloOpen → derive portal)");
ok(r.result && r.result.tab === 1, "Q.open returns the executor's result");
ok((await q.open("files")).ok, "Q.open sovereign (no caller) → allowed (the human orb is ungoverned)");
ok((await q.open("")).ok === false, "Q.open('') → honest error (a ref is required)");

const r3 = await q.open(K, { governed: true });          // external/governed, no conscience gate present
ok(r3.refused === true, "Q.open governed + no gate → fail-closed (refused, never a silent act)");

const q2 = createQ({ trinity: stubT, mux: { routeTask: () => null } });   // no configureActions
const r2 = await q2.open("files");
ok(!r2.ok && /no open executor/.test(r2.error || ""), "Q.open with no executor bound → honest error (no fake open)");

// ── §6↔§7.3: Q OPERATES THE RUNTIME PLANE (observe + snapshot/suspend/resume/stop, governed) ──
ok(typeof q.runtimes === "function" && typeof q.manage === "function", "Q.runtimes + Q.manage are first-class verbs");
ok(q.runtimes().length === 0, "Q.runtimes() with no plane bound → [] (honest, not a throw)");
const seen = [];
q.configureRuntimes({
  list: () => [{ id: "spaceA", tier: "holospace", state: "resident" }],
  snapshot: async (id) => { seen.push(id); return { ok: true, kappa: "k_" + id }; },
  resume: async () => ({ ok: true }),
});
ok(q.runtimes()[0] && q.runtimes()[0].id === "spaceA", "Q.runtimes() lists the bound management plane");
const m = await q.manage("snapshot", "spaceA");
ok(m.ok && m.kappa === "k_spaceA" && seen[0] === "spaceA", "Q.manage('snapshot', id) drives the plane → κ (Q operates the hypervisor)");
ok((await q.manage("bogus", "x")).ok === false, "Q.manage(unknown verb) → fail-closed");
ok((await q.manage("snapshot", "spaceA", { governed: true })).refused === true, "Q.manage governed + no gate → fail-closed (refused, receipted control)");
ok(q.capabilities().some((c) => c.id === "runtimes"), "capabilities() advertises the runtimes verb");
const q3 = createQ({ trinity: stubT, mux: { routeTask: () => null } });
ok((await q3.manage("resume", "x")).ok === false, "Q.manage with no plane bound → honest error (no fake)");

console.log(`\n${fail ? "FAIL" : "ALL_PASS"}  ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
