// holo-swarm-fetch-witness.mjs — Phase B proof. Multi-peer scheduling over the Phase-A pipeline:
// parallelism scales with peers, one slow/lying peer never stalls the stream, rarest works end-to-end
// with real have-maps, the scheduler never asks a non-holder, and per-κ rendezvous (PEX) discovers the
// swarm with no tracker — all in Node against mock peers (timing) and the REAL holo-mesh-blocks L5
// layer (integrity).
//
//   1. parallelScales      — completion time strictly falls 1 → 2 → 4 peers
//   2. slowPeerNoStall     — one +10× peer barely slows the stream and serves < its fair share
//   3. reassignPastLiar    — a peer that serves garbage is routed around; honest peers complete it (L5)
//   4. rarestEndToEnd      — partial, overlapping have-maps: every block resolves from a real holder
//   5. neverAsksNonHolder  — the scheduler only requests a block from a peer that advertises it
//   6. rendezvousPEX       — 3 announcers + 1 joiner learn the whole set transitively, idempotently

import { createPull } from "../os/usr/lib/holo/holo-pull.mjs";
import { createSwarmSource } from "../os/usr/lib/holo/holo-swarm-fetch.mjs";
import { createRendezvous } from "../os/usr/lib/holo/holo-pull-rendezvous.mjs";
import { createMeshBlocks } from "../os/sbin/holo-mesh-blocks.mjs";
import { cidOf, cidToString } from "../os/usr/lib/holo/holo-ipfs.js";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; let pass = 0, fail = 0, kn = 0;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 56);
const ok = (name, cond, extra = "") => { (cond ? pass++ : fail++); checks[(slug(name) || "c") + "-" + (++kn)] = !!cond; console.log((cond ? "  ok  " : " FAIL ") + name + (extra ? "  — " + extra : "")); };
const until = (fn, ms = 20000) => new Promise((res, rej) => { const t0 = Date.now(); const iv = setInterval(() => { if (fn()) { clearInterval(iv); res(); } else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error("timeout")); } }, 2); });

async function makeStore(n, tag) {
  const store = new Map(), manifest = [];
  for (let i = 0; i < n; i++) {
    const bytes = new TextEncoder().encode(`${tag}:block:${i}:` + "x".repeat(8 + (i % 5)));
    store.set(cidToString(await cidOf(bytes)), bytes); manifest.push([...store.keys()][i]);
  }
  return { store, manifest };
}
// a bandwidth-modelled peer: serves one block at a time, serviceMs each (the timing signal). Tracks how
// many it served and whether it was ever asked for a block it does not hold.
function fastPeer(id, store, { serviceMs = 6, holds = null } = {}) {
  const q = []; let active = false; const peer = { id, served: 0, violations: 0 };
  const has = (cid) => (holds ? holds.has(cid) : store.has(cid));
  function drain() { if (active || !q.length) return; active = true; const job = q.shift(); setTimeout(() => { active = false; peer.served++; job.res(store.get(job.cid) || null); drain(); }, serviceMs); }
  peer.has = has;
  peer.wantBlock = (cid) => new Promise((res) => { if (!has(cid)) peer.violations++; q.push({ cid, res }); drain(); });
  return peer;
}
// a real-transport peer (L5 verify) over an in-memory wire; `store` may be tampered to model a liar.
function meshPeer(id, store, { holds = null, timeoutMs = 250 } = {}) {
  let a = null, b = null;
  const ws = { send: (m) => setTimeout(() => b && b(m), 3), onMessage: (cb) => { a = cb; } };
  const wc = { send: (m) => setTimeout(() => a && a(m), 3), onMessage: (cb) => { b = cb; } };
  createMeshBlocks(ws, { getLocalBlock: (cid) => store.get(cid) || null });
  const src = createMeshBlocks(wc, { timeoutMs });
  return { id, has: (cid) => (holds ? holds.has(cid) : store.has(cid)), wantBlock: (cid) => src.wantBlock(cid) };
}
const drive = async (swarm, manifest, opts) => { const pull = createPull(swarm, { blocks: manifest, peers: swarm.peers, ...opts }); const t = Date.now(); pull.start(); await until(() => pull.stats().done, 30000); return { ms: Date.now() - t, pull }; };

async function main() {
  // ── 1. parallel scales with peers ───────────────────────────────────────────────────────────
  let t1, t2, t4;
  {
    const N = 48;
    const a = await makeStore(N, "s1");
    t1 = (await drive(createSwarmSource([fastPeer("p", a.store)]), a.manifest, { strategy: "sequential", pipeline: 16 })).ms;
    const b = await makeStore(N, "s2");
    t2 = (await drive(createSwarmSource([0, 1].map((i) => fastPeer("p" + i, b.store))), b.manifest, { strategy: "sequential", pipeline: 16 })).ms;
    const c = await makeStore(N, "s4");
    t4 = (await drive(createSwarmSource([0, 1, 2, 3].map((i) => fastPeer("p" + i, c.store))), c.manifest, { strategy: "sequential", pipeline: 16 })).ms;
    ok("completion time falls as peers are added", t1 > t2 && t2 > t4, `1p ${t1}ms > 2p ${t2}ms > 4p ${t4}ms`);
    ok("4 peers are ≥2.5× faster than 1", t1 / Math.max(1, t4) >= 2.5, `${(t1 / Math.max(1, t4)).toFixed(1)}×`);
  }

  // ── 2. one slow peer must not stall the stream ──────────────────────────────────────────────
  {
    const N = 40; const { store, manifest } = await makeStore(N, "slow");
    const slow = fastPeer("slow", store, { serviceMs: 60 });
    const fast = [fastPeer("f0", store), fastPeer("f1", store), fastPeer("f2", store)];
    const swarm = createSwarmSource([slow, ...fast]);
    const { ms } = await drive(swarm, manifest, { strategy: "sequential", pipeline: 16 });
    ok("the stream completes despite a 10× slow peer", ms < N * 12, `${ms}ms for ${N} blocks`);
    ok("the slow peer serves less than its fair share", slow.served < N / 4, `slow served ${slow.served}/${N} (fair≈${N / 4})`);
  }

  // ── 3. reassign past a liar (Phase-A finding #1, solved here) ────────────────────────────────
  {
    const N = 12; const { store, manifest } = await makeStore(N, "liar");
    const tampered = new Map(); for (const c of manifest) tampered.set(c, new TextEncoder().encode("GARBAGE"));
    const liar = meshPeer("liar", tampered, { holds: new Set(manifest) });   // claims everything, serves garbage
    const honest = meshPeer("honest", store, { holds: new Set(manifest) });
    const swarm = createSwarmSource([liar, honest]);
    const { ms, pull } = await drive(swarm, manifest, { strategy: "sequential", pipeline: 4 });
    const st = swarm.stats();
    ok("every block completes despite a lying peer", pull.stats().done, `${ms}ms`);
    ok("the liar's bytes never count; honest peer carries it (L5)", st.find((s) => s.id === "liar").ok === 0 && st.find((s) => s.id === "honest").ok === N);
  }

  // ── 4 + 5. rarest end-to-end with partial have-maps; never ask a non-holder ──────────────────
  {
    const N = 18; const { store, manifest } = await makeStore(N, "rare");
    // three peers, overlapping but partial: each holds 2/3 of the blocks; union = all; block 7 is rare (1 holder)
    const holdsA = new Set(manifest.filter((_, i) => i % 3 !== 0 || i === 7));
    const holdsB = new Set(manifest.filter((_, i) => i % 3 !== 1 && i !== 7));
    const holdsC = new Set(manifest.filter((_, i) => i % 3 !== 2 && i !== 7));
    const pa = fastPeer("A", store, { holds: holdsA }), pb = fastPeer("B", store, { holds: holdsB }), pc = fastPeer("C", store, { holds: holdsC });
    const swarm = createSwarmSource([pa, pb, pc]);
    const { pull } = await drive(swarm, manifest, { strategy: "rarest", pipeline: 8 });
    ok("rarest completes from partial, overlapping have-maps", pull.stats().done);
    ok("the scheduler never asked a peer for a block it lacks", pa.violations + pb.violations + pc.violations === 0, `${pa.violations + pb.violations + pc.violations} violations`);
  }

  // ── 6. serverless per-κ rendezvous (PEX) ────────────────────────────────────────────────────
  {
    const subs = new Map();
    const relay = {
      publish: (topic, msg) => setTimeout(() => (subs.get(topic) || []).forEach((cb) => cb(msg)), 0),
      subscribe: (topic, cb) => { const a = subs.get(topic) || []; a.push(cb); subs.set(topic, a); return () => { const x = subs.get(topic) || []; const i = x.indexOf(cb); if (i >= 0) x.splice(i, 1); }; },
    };
    const kappa = "did:holo:sha256:" + "a".repeat(64);
    const nodes = ["n1", "n2", "n3", "joiner"].map((id) => createRendezvous(relay, kappa, { id }));
    nodes.slice(0, 3).forEach((n) => n.announce());                 // only the 3 holders announce
    await until(() => nodes.every((n) => n.peers().length === 3), 4000);   // let PEX fully converge
    ok("a joiner learns all holders transitively (PEX)", nodes[3].peers().length === 3, nodes[3].peers().map((p) => p.id).join(","));
    nodes[1].announce(); nodes[2].announce();                       // re-announce after convergence
    await new Promise((r) => setTimeout(r, 120));
    ok("learning is idempotent (re-announce adds no duplicates)", nodes.every((n) => n.peers().length === 3), nodes.map((n) => n.peers().length).join(","));
    nodes.forEach((n) => n.close());
  }

  const result = { "@type": "holo:WitnessResult", witness: "holo-swarm-fetch", phase: "B",
    scaling: { t1, t2, t4, speedup4: +(t1 / Math.max(1, t4)).toFixed(2) }, pass, fail, total: pass + fail, ok: fail === 0, checks };
  writeFileSync(join(here, "holo-swarm-fetch-witness.result.json"), JSON.stringify(result, null, 2));
  console.log(`\n${fail === 0 ? "PASS" : "FAIL"}  ${pass}/${pass + fail}  ·  4-peer speedup ${result.scaling.speedup4}×`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error("witness threw:", e); process.exit(1); });
