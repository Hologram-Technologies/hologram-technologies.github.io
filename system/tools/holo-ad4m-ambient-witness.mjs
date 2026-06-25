#!/usr/bin/env node
// holo-ad4m-ambient-witness.mjs — THE NERVOUS SYSTEM: every AD4M organ registered as a faculty of the ONE
// ambient heartbeat (holo-ambient.mjs), so the web stays coherent on its own. Driven by hand (deterministic
// tick replay — no real timer): organs run at their cadence; a throwing organ is isolated; sync CONVERGES two
// real Perspectives across ticks; ingest drains a queue into real Expressions; the index grows; re-wiring is
// idempotent; pause halts all dispatch; unwire removes only the AD4M faculties.
//
// Authority: Coasys "Digital Nervous System" (spanning layer) · holospaces Law L2 (one wire) / L5 (heal by
// re-derive) · composes #holo-ambient + #holo-ad4m + #holo-ad4m-neighbourhood + #holo-ad4m-synergy.
// node tools/holo-ad4m-ambient-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeAmbient } from "../os/usr/lib/holo/holo-ambient.mjs";
import { wireAd4mFaculties } from "../os/usr/lib/holo/holo-ad4m-ambient.mjs";
import { makeAd4m } from "../os/usr/lib/holo/holo-ad4m.mjs";
import { makeNeighbourhood } from "../os/usr/lib/holo/holo-ad4m-neighbourhood.mjs";
import { makeSynergy } from "../os/usr/lib/holo/holo-ad4m-synergy.mjs";
import { verify as verifyObj } from "../os/usr/lib/holo/holo-object.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = (init = []) => { let s = clone(init); return { load: async () => clone(s), save: async (r) => { s = clone(r); }, dump: () => clone(s) }; };
let tk = 0; const now = () => `2026-06-25T00:00:${String(tk++).padStart(2, "0")}.000Z`;
const hub = { peers: [], inflight: [], post(from, m) { for (const p of this.peers) if (p.self !== from) this.inflight.push(Promise.resolve(p.onMessage(m))); }, async settle() { const f = this.inflight; this.inflight = []; await Promise.all(f); } };

// ── a REAL web: two agents, two Neighbourhoods over a hub, a Synergy index, a queue, and heal/peers counters ─
const ana = await enroll({ label: "amb-ana", passphrase: "it just works" });
const ben = await enroll({ label: "amb-ben", passphrase: "no buttons" });
const adA = makeAd4m({ signer: ana, store: new Map(), now });
const adB = makeAd4m({ signer: ben, store: new Map(), now });
const perspA = adA.perspective({ backend: arrayBackend() });
const perspB = adB.perspective({ backend: arrayBackend() });
const nbA = makeNeighbourhood({ perspective: perspA, me: ana.kappa, self: "A", post: (m) => hub.post("A", m) });
const nbB = makeNeighbourhood({ perspective: perspB, me: ben.kappa, self: "B", post: (m) => hub.post("B", m) });
hub.peers.push({ self: "A", onMessage: nbA.onMessage }, { self: "B", onMessage: nbB.onMessage });

const syn = makeSynergy({});
const queue = [];                       // pending content to ingest (a dropped file / pasted blob / linked url)
const fresh = [];                       // Expressions created but not yet indexed
let peersKept = 0, healed = 0, provReconciled = 0;

const web = {
  neighbourhoods: () => [nbA, nbB],
  drainIngest: async (max) => { let c = 0; while (queue.length && c < max) { const item = queue.shift(); const { url } = adA.createExpression("literal", item); await nbA.addLink({ source: ana.kappa, predicate: "posted", target: url }); fresh.push({ url, text: item.text || "", owner: ana.kappa }); c++; } return c; },
  indexNew: async () => { const n = fresh.length; while (fresh.length) syn.index(fresh.shift()); return n; },
  wan: { keepAlive: async () => { peersKept++; } },
  reconcileProvenance: () => { provReconciled++; return { unprovenanced: [] }; },
  heal: async () => { healed++; return await perspA.verify(); },
};

// small, deterministic cadences for a clean replay
const ambient = makeAmbient();
const preExisting = ambient.register("os:pre-existing", async () => {}, { everyTicks: 1 }); // a non-AD4M faculty already present
const unwire = wireAd4mFaculties(ambient, web, { cadence: { sync: 2, ingest: 1, index: 2, peers: 3, provenance: 3, heal: 1 }, ingestBatch: 4 });

// ── drive the heartbeat by hand: queue one item, then run 6 ticks, settling the wire after each ─────────
queue.push({ text: "the wise web coheres", note: "first post" });
const ranLog = [];
for (let i = 0; i < 6; i++) { const r = await ambient.tick(); ranLog.push(r.ran); await hub.settle(); }
const count = (name) => ranLog.filter((ran) => ran.includes(name)).length;

// ── 1 · cadence: each organ ran at its declared rate over 6 ticks ────────────────────────────────────
ok("cadenceSchedule", count("ad4m:ingest") === 6 && count("ad4m:heal") === 6 && count("ad4m:sync") === 3 && count("ad4m:index") === 3 && count("ad4m:peers") === 2 && count("ad4m:provenance") === 2,
  JSON.stringify({ ingest: count("ad4m:ingest"), sync: count("ad4m:sync"), peers: count("ad4m:peers") }));

// ── 2 · ingest drained the queue into a REAL Expression that re-derives (Law L5) ─────────────────────
const anaPosts = perspA.links({ predicate: "posted" });
const firstExpr = anaPosts.length ? adA.getExpression(anaPosts[0].target) : null;
ok("ingestDrains", queue.length === 0 && anaPosts.length === 1 && firstExpr && verifyObj(firstExpr), JSON.stringify({ q: queue.length, posts: anaPosts.length }));

// ── 3 · sync CONVERGED the two Perspectives with no user action (the heartbeat did it) ───────────────
ok("syncConverges", nbB.sharedLinks().some((l) => l.author === ana.kappa) && nbB.members().includes(ana.kappa), JSON.stringify({ bSees: nbB.sharedLinks().length }));

// ── 4 · index grew as the Expression appeared (search stays current on its own) ──────────────────────
ok("indexUpdates", syn.corpusSize() === 1, `corpus=${syn.corpusSize()}`);

// ── 5 · peers + heal organs fired; heal verified the spine (self-healing) ────────────────────────────
ok("peersAndHeal", peersKept === 2 && healed === 6 && (await perspA.verify()).ok && provReconciled === 2, JSON.stringify({ peersKept, healed, provReconciled }));

// ── 6 · fault isolation: a throwing organ is reported, the heartbeat + siblings keep running ─────────
ambient.register("ad4m:boom", async () => { throw new Error("organ failure"); }, { everyTicks: 1 });
const rb = await ambient.tick(); await hub.settle();
ok("faultIsolated", rb.errored.some((e) => e.name === "ad4m:boom") && rb.ran.includes("ad4m:ingest") && rb.ran.includes("ad4m:heal"), JSON.stringify({ errored: rb.errored.map((e) => e.name), ran: rb.ran.length }));

// ── 7 · idempotent: re-wiring does NOT duplicate faculties (one entry per name) ──────────────────────
const before = ambient.faculties().length;
const unwire2 = wireAd4mFaculties(ambient, web, { cadence: { sync: 2 } });
const names = ambient.faculties().map((f) => f.name);
const dupes = names.filter((n, i) => n.startsWith("ad4m:") && n !== "ad4m:boom" && names.indexOf(n) !== i);
ok("idempotentReregister", dupes.length === 0 && ambient.faculties().length === before, JSON.stringify({ before, after: ambient.faculties().length, dupes }));
unwire2();

// ── 8 · pause halts ALL dispatch; resume restores it ─────────────────────────────────────────────────
ambient.pause();
const rp = await ambient.tick();
ambient.resume();
const rr = await ambient.tick(); await hub.settle();
ok("pauseStopsAll", rp.ran.length === 0 && rp.paused === true && rr.ran.length > 0, JSON.stringify({ pausedRan: rp.ran.length, resumedRan: rr.ran.length }));

// ── 9 · unwire removes ONLY the AD4M faculties; the pre-existing OS faculty survives ─────────────────
unwire();
const after = ambient.faculties().map((f) => f.name);
ok("unwireClean", !after.some((n) => n.startsWith("ad4m:") && n !== "ad4m:boom") && after.includes("os:pre-existing"), JSON.stringify(after));

preExisting();
await forget(ana.kappa); await forget(ben.kappa);

const n = Object.keys(checks).length;
const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-ad4m-ambient — the AD4M web as a nervous system: every organ (sync, ingest, index, peers, provenance, heal) registered as a faculty of the ONE ambient heartbeat (holo-ambient). On unlock the whole web is alive and self-coherent with zero configuration — spaces converge, content ingests into Expressions, the index stays fresh, peers re-dial, the spine self-heals — no second timer, fault-isolated, idempotent, fail-soft. It just works.",
  authority: "Coasys Digital Nervous System (spanning layer) · holospaces Laws L2/L5 · composes #holo-ambient + #holo-ad4m + #holo-ad4m-neighbourhood + #holo-ad4m-synergy",
  witnessed,
  checks, failed: fail,
};
writeFileSync(join(here, "holo-ad4m-ambient-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-ad4m AMBIENT witness — the nervous system (one heartbeat, many organs; it just works)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? `WITNESSED ✓  ${n}/${n} GREEN — unlock and the web is alive, with nothing to configure` : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
