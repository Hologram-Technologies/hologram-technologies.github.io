// holo-pull-consume-witness.mjs — Phase C proof. The playhead-driven consume loop, in Node, with a mock
// sink standing in for the WebGPU/WebCodecs draw (video) and the layer forward (inference) — so the
// DRIVING LOGIC is proven before any GPU is involved:
//
//   1. consumeInOrder    — every frame is delivered, verified, in order; TTFF lands fast; no stall
//   2. fpsPaced          — with fps set, the loop runs at the cadence (consumer-paced = the flow control)
//   3. prefetchAhead     — a slow (paced) consumer has blocks prefetched ahead of the playhead
//   4. inferenceParity   — a model streamed from the SWARM reassembles BYTE-IDENTICALLY to a local read
//                          (the swarm changes WHEN bytes arrive, never WHICH — so output parity follows)

import { createPull } from "../os/usr/lib/holo/holo-pull.mjs";
import { createSwarmSource } from "../os/usr/lib/holo/holo-swarm-fetch.mjs";
import { consume } from "../os/usr/lib/holo/holo-pull-consume.mjs";
import { createMeshBlocks } from "../os/sbin/holo-mesh-blocks.mjs";
import { cidOf, cidToString } from "../os/usr/lib/holo/holo-ipfs.js";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; let pass = 0, fail = 0, kn = 0;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 56);
const ok = (name, cond, extra = "") => { (cond ? pass++ : fail++); checks[(slug(name) || "c") + "-" + (++kn)] = !!cond; console.log((cond ? "  ok  " : " FAIL ") + name + (extra ? "  — " + extra : "")); };

const eqBytes = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
const concat = (arrs) => { let n = 0; for (const a of arrs) n += a.length; const o = new Uint8Array(n); let p = 0; for (const a of arrs) { o.set(a, p); p += a.length; } return o; };

async function makeStore(n, tag) {
  const store = new Map(), manifest = [];
  for (let i = 0; i < n; i++) { const b = new TextEncoder().encode(`${tag}:block:${i}:` + "x".repeat(8 + (i % 5))); store.set(cidToString(await cidOf(b)), b); manifest.push([...store.keys()][i]); }
  return { store, manifest };
}
function meshPeer(id, store, L = 3) {                                        // real L5-verifying peer over a laggy wire
  let a = null, b = null;
  createMeshBlocks({ send: (m) => setTimeout(() => b && b(m), L), onMessage: (cb) => { a = cb; } }, { getLocalBlock: (cid) => store.get(cid) || null });
  const src = createMeshBlocks({ send: (m) => setTimeout(() => a && a(m), L), onMessage: (cb) => { b = cb; } }, { timeoutMs: 4000 });
  return { id, has: (cid) => store.has(cid), wantBlock: (cid) => src.wantBlock(cid) };
}

async function main() {
  // ── 1. consume drives the playhead: ordered, verified, fast TTFF, no stall ──────────────────
  {
    const N = 20; const { store, manifest } = await makeStore(N, "c");
    const pull = createPull(meshPeer("p", store, 4), { blocks: manifest, strategy: "streaming", window: 8, pipeline: 8 });
    const seen = [];
    const st = await consume(pull, { order: manifest, onFrame: (i, cid, bytes) => { seen.push({ i, cid, ok: !!bytes && new TextDecoder().decode(bytes).startsWith(`c:block:${i}:`) }); } });
    ok("every frame delivered, in order, verified", seen.length === N && seen.every((f, i) => f.i === i && f.ok));
    ok("TTFF lands within ~one round trip", st.ttffMs > 0 && st.ttffMs <= 80, `ttff ${st.ttffMs}ms`);
    ok("no stalls when the pipe keeps up", st.stalls === 0);
  }

  // ── 2. fps pacing: the consumer paces the stream (flow control / backpressure) ───────────────
  {
    const N = 24, fps = 120; const { store, manifest } = await makeStore(N, "v");
    const pull = createPull(meshPeer("p", store, 2), { blocks: manifest, strategy: "streaming", window: 12, pipeline: 12 });
    const st = await consume(pull, { order: manifest, fps, onFrame: () => {} });
    const expected = (N - 1) * (1000 / fps);                                // ~191ms for 24 frames @120fps
    ok("the loop runs at the target cadence, not faster", st.ms >= expected * 0.85, `${st.ms}ms (≈${Math.round(expected)}ms @ ${fps}fps)`);
    ok("paced playback has no stalls on a fast network", st.stalls === 0, `${st.stalls} stalls`);
  }

  // ── 3. prefetch runs ahead of a paced playhead ──────────────────────────────────────────────
  {
    const N = 24, fps = 60; const { store, manifest } = await makeStore(N, "pf");
    const pull = createPull(meshPeer("p", store, 2), { blocks: manifest, strategy: "streaming", window: 10, pipeline: 10 });
    let maxLead = 0;
    await consume(pull, { order: manifest, fps, lookahead: 8, onFrame: (i) => { maxLead = Math.max(maxLead, pull.stats().have - (i + 1)); } });
    ok("blocks are prefetched ahead of the playhead", maxLead >= 2, `max lead = ${maxLead} blocks`);
  }

  // ── 4. inference parity: swarm-streamed model == local read, byte for byte ───────────────────
  {
    const N = 32; const { store, manifest } = await makeStore(N, "model");   // a "model" = ordered weight shards
    const local = concat(manifest.map((c) => store.get(c)));                  // ground truth: read the .holo locally, in order
    const swarm = createSwarmSource([meshPeer("w0", store, 3), meshPeer("w1", store, 4)]);  // 2 honest weight-seeders
    const pull = createPull(swarm, { blocks: manifest, peers: swarm.peers, strategy: "sequential", pipeline: 6 });
    const buf = new Array(N);
    await consume(pull, { order: manifest, onFrame: (i, cid, bytes) => { buf[i] = bytes; } });   // forward pass = consume shards in first-use order
    const streamed = concat(buf);
    ok("swarm-streamed model is byte-identical to a local read", eqBytes(streamed, local), `${streamed.length}B vs ${local.length}B`);
    ok("every shard was present and verified", buf.every((b) => b && b.length));
  }

  const result = { "@type": "holo:WitnessResult", witness: "holo-pull-consume", phase: "C", pass, fail, total: pass + fail, ok: fail === 0, checks };
  writeFileSync(join(here, "holo-pull-consume-witness.result.json"), JSON.stringify(result, null, 2));
  console.log(`\n${fail === 0 ? "PASS" : "FAIL"}  ${pass}/${pass + fail}`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error("witness threw:", e); process.exit(1); });
