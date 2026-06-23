// holo-pull-pipeline-witness.mjs — Phase A proof for κ-Swarm streaming ("Holo Stream"). Proves, in
// Node against a mock transport (no browser, no network), that the picker + pipeline beat one-at-a-time
// fetch, stream in deadline order, never hand a consumer an unverified byte, and start fast (TTFF).
// Block source = the REAL holo-mesh-blocks (L5 verify-on-receipt) over an in-memory laggy wire pair.
//
//   1. pickerStrategies   — sequential / streaming / rarest / endgame / deadline return documented order
//   2. pipelineSpeedup    — pipeline=8 completes ≥3× faster than pipeline=1 over a fixed RTT
//   3. inflightCapped      — never more than `pipeline` requests in flight
//   4. deadlineFrontRun   — a setDeadline'd block is the FIRST one fetched, even outside the window
//   5. integrityHolds      — a tampered block resolves to null (never reaches the consumer); honest ones do
//   6. streamingDelivers   — every playhead block arrives, verified, with prefetch running ahead
//   7. ttffFast            — first verified block lands within ~one round trip

import { createPull } from "../os/usr/lib/holo/holo-pull.mjs";
import { createPicker } from "../os/usr/lib/holo/holo-pull-picker.mjs";
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

// a linked wire pair that delivers each message after L ms (a simulated one-way latency ⇒ RTT ≈ 2L)
function laggyPair(L = 0) {
  let a = null, b = null;
  return [
    { send: (m) => setTimeout(() => b && b(m), L), onMessage: (cb) => { a = cb; } },
    { send: (m) => setTimeout(() => a && a(m), L), onMessage: (cb) => { b = cb; } },
  ];
}
// a server holding `store`, and the client's verified wantBlock source over it
function net(store, L = 0, timeoutMs = 5000) {
  const [ws, wc] = laggyPair(L);
  createMeshBlocks(ws, { getLocalBlock: (cid) => store.get(cid) || null });   // serve
  return createMeshBlocks(wc, { timeoutMs });                                  // fetch (has wantBlock)
}
async function makeStore(n, tag) {
  const store = new Map(), manifest = [];
  for (let i = 0; i < n; i++) {
    const bytes = new TextEncoder().encode(`${tag}:block:${i}:` + "x".repeat(8 + (i % 5)));
    const cid = cidToString(await cidOf(bytes));
    store.set(cid, bytes); manifest.push(cid);
  }
  return { store, manifest };
}

async function main() {
  // ── 1. picker strategies (pure, deterministic) ────────────────────────────────────────────
  {
    const { manifest: m } = await makeStore(12, "p");
    const seq = createPicker({ blocks: m, strategy: "sequential" });
    ok("sequential picks manifest order", JSON.stringify(seq.next(3)) === JSON.stringify(m.slice(0, 3)));
    const str = createPicker({ blocks: m, strategy: "streaming", window: 8 });
    ok("streaming picks the window head", JSON.stringify(str.next(3)) === JSON.stringify(m.slice(0, 3)));
    str.setDeadline(m[10], 1);
    ok("a deadline front-runs the window", str.next(1)[0] === m[10], "→ " + m[10].slice(0, 10) + "…");
    const peers = [{ blocks: new Set(m) }, { blocks: new Set(m.filter((c) => c !== m[5])) }, { blocks: new Set(m.filter((c) => c !== m[5])) }];
    const rar = createPicker({ blocks: m, strategy: "rarest" });
    ok("rarest picks the least-available block", rar.next(1, peers)[0] === m[5], "rarest = idx 5 (held by 1 peer)");
    const eg = createPicker({ blocks: m, strategy: "sequential", endgameThreshold: 4 });
    eg.setHave(m.filter((c) => c !== m[2] && c !== m[7]));
    ok("endgame returns the stragglers", JSON.stringify(eg.next(8)) === JSON.stringify([m[2], m[7]]));
  }

  // ── 2 + 3. pipeline speedup + in-flight cap ────────────────────────────────────────────────
  let t1 = 0, t8 = 0, inflightMax = 0;
  {
    const N = 32, L = 8;
    const a = await makeStore(N, "t1");
    const p1 = createPull(net(a.store, L), { blocks: a.manifest, strategy: "sequential", pipeline: 1 });
    let tA = Date.now(); p1.start(); await until(() => p1.stats().done); t1 = Date.now() - tA;

    const b = await makeStore(N, "t8");
    const p8 = createPull(net(b.store, L), { blocks: b.manifest, strategy: "sequential", pipeline: 8 });
    p8.onBlock(() => { inflightMax = Math.max(inflightMax, p8.stats().inflight); });
    tA = Date.now(); p8.start(); await until(() => p8.stats().done); t8 = Date.now() - tA;
    ok("pipeline=8 is ≥3× faster than pipeline=1", t1 / Math.max(1, t8) >= 3, `${t1}ms vs ${t8}ms = ${(t1 / Math.max(1, t8)).toFixed(1)}×`);
    ok("never more than `pipeline` requests in flight", inflightMax <= 8, `max inflight = ${inflightMax}`);
  }

  // ── 4. deadline front-run over the real transport ──────────────────────────────────────────
  {
    const { store, manifest } = await makeStore(28, "d");
    const reqOrder = []; const inner = net(store, 4);
    const src = { wantBlock: (cid) => { reqOrder.push(cid); return inner.wantBlock(cid); } };
    const pull = createPull(src, { blocks: manifest, strategy: "streaming", window: 4, pipeline: 1 });
    pull.setDeadline(manifest[20], 1); pull.start();
    await until(() => pull.has(manifest[20]));
    ok("the deadline'd block is fetched FIRST", reqOrder[0] === manifest[20], "first req = idx " + manifest.indexOf(reqOrder[0]));
    pull.stop();
  }

  // ── 5. integrity: a tampered block never reaches the consumer ───────────────────────────────
  {
    const { store, manifest } = await makeStore(6, "i");
    const target = manifest[3];
    const tampered = new Map(store); tampered.set(target, new TextEncoder().encode("WRONG-BYTES-do-not-match-cid"));
    const src = net(tampered, 4, 250);
    const bad = await src.wantBlock(target);
    ok("a tampered block resolves to null (L5)", bad === null, "got " + (bad === null ? "null" : "BYTES — LEAK"));
    const honest = await src.wantBlock(manifest[0]);
    ok("an honest block from the same source verifies", honest !== null && new TextDecoder().decode(honest).startsWith("i:block:0"));

    // and through the FULL driver: a tampered block is never stored, never surfaced to getBlock,
    // and does not block delivery of the honest blocks around it.
    const dt = await makeStore(5, "di"); const badCid = dt.manifest[2];
    const tam2 = new Map(dt.store); tam2.set(badCid, new TextEncoder().encode("WRONG"));
    const pull = createPull(net(tam2, 4, 150), { blocks: dt.manifest, strategy: "sequential", pipeline: 4 });
    pull.start();
    await until(() => dt.manifest.filter((_, i) => i !== 2).every((c) => pull.has(c)), 6000);
    const raced = await Promise.race([pull.getBlock(badCid).then(() => "SURFACED"), new Promise((r) => setTimeout(() => r("withheld"), 400))]);
    ok("the driver never surfaces a tampered block to a consumer", raced === "withheld" && !pull.has(badCid), raced);
    pull.stop();
  }

  // ── 6. streaming delivers every playhead block, prefetching ahead ───────────────────────────
  {
    const N = 24, L = 4;
    const { store, manifest } = await makeStore(N, "s");
    const pull = createPull(net(store, L), { blocks: manifest, strategy: "streaming", window: 8, pipeline: 6 });
    pull.start();
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    let stalls = 0, maxAhead = 0;
    for (let i = 0; i < N; i++) {
      pull.setPlayhead(i);
      const b = await pull.getBlock(manifest[i]);
      if (!b || !new TextDecoder().decode(b).startsWith(`s:block:${i}:`)) stalls++;
      maxAhead = Math.max(maxAhead, pull.stats().have - (i + 1));     // verified blocks already past the playhead
      await delay(3);                                                 // a consumer-paced playhead (slower than the pipe)
    }
    ok("streaming delivers every playhead block, verified, no stall", stalls === 0, stalls + " stalls / " + N);
    ok("the picker prefetches ahead of the playhead", maxAhead >= 1, "max lead = " + maxAhead + " blocks");
  }

  // ── 7. time-to-first-frame ≈ one round trip ─────────────────────────────────────────────────
  {
    const L = 10; const { store, manifest } = await makeStore(16, "f");
    const pull = createPull(net(store, L), { blocks: manifest, strategy: "streaming", pipeline: 8 });
    pull.start(); await until(() => pull.stats().have >= 1);
    const ttff = pull.stats().ttffMs;
    ok("TTFF lands within ~one round trip", ttff > 0 && ttff <= 4 * L + 80, `ttff ${ttff}ms (RTT≈${2 * L}ms)`);
  }

  const result = { "@type": "holo:WitnessResult", witness: "holo-pull-pipeline", phase: "A",
    speedup: +(t1 / Math.max(1, t8)).toFixed(2), inflightMax, pass, fail, total: pass + fail, ok: fail === 0, checks };
  writeFileSync(join(here, "holo-pull-pipeline-witness.result.json"), JSON.stringify(result, null, 2));
  console.log(`\n${fail === 0 ? "PASS" : "FAIL"}  ${pass}/${pass + fail}  ·  speedup ${result.speedup}×  ·  inflight≤${inflightMax}`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error("witness threw:", e); process.exit(1); });
