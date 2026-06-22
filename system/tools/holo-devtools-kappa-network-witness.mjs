// holo-devtools-kappa-network-witness.mjs — Stage A4 proof (#holo-devtools-network): the Network panel re-read as
// the κ-stream timeline. Each κ-fetch maps to faithful CDP Network events the vendored frontend renders, carrying
// the κ, the axis, the CACHE-HIT (O(1) κ-memo, L3), the L5 verify badge (pass→200; tampered→loadingFailed/RED),
// and provenance. The requestId is a stable content-derived alias of the κ (L1). Pure Node.
//   node holo-devtools-kappa-network-witness.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const imp = (rel) => import(pathToFileURL(resolve(HERE, rel)).href);
const { kappaToNetworkEvents, trackKappaFetches } = await imp("../os/usr/lib/holo/devtools/holo-devtools-kappa-network.mjs");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const byMethod = (evs, m) => evs.find((e) => e.method === m);

console.log("\nholo-devtools Network — the κ-stream timeline (#holo-devtools-network)\n");

const K = "a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00";

// ── 1) a served κ-fetch → a well-formed CDP request the panel renders ─────────────────────────────────────
console.log("a κ-fetch is a Network request:");
{
  const evs = kappaToNetworkEvents({ kappa: K, axis: "sha256", bytes: 4096, cacheHit: false, verified: true, provenance: ["src1"], renderMs: 12, ts: 100, seq: 0 });
  const will = byMethod(evs, "Network.requestWillBeSent"), resp = byMethod(evs, "Network.responseReceived"), fin = byMethod(evs, "Network.loadingFinished");
  ok(will && resp && fin, "emits requestWillBeSent → responseReceived → loadingFinished (the panel's lifecycle)");
  ok(will.params.request.url === "holo://sha256/" + K, "the request URL is the κ itself (holo://sha256/<κ>) — address = content");
  ok(resp.params.response.status === 200 && resp.params.response.headers["x-holo-verify"] === "L5-pass", "verified fetch → 200 + x-holo-verify:L5-pass");
  ok(resp.params.response.headers["x-holo-kappa"] === K && resp.params.response.headers["x-holo-axis"] === "sha256", "response carries the κ + axis (sha256/blake3)");
  ok(resp.params.response.headers["x-holo-prov"] === "src1", "provenance (wasDerivedFrom) is surfaced on the response");
  ok(fin.params.encodedDataLength === 4096, "loadingFinished reports the real byte cost");
}

// ── 2) a CACHE-HIT is the O(1) κ-memo (L3) — 0 bytes on the wire ──────────────────────────────────────────
console.log("\ncache-hit = the O(1) κ-memo (L3):");
{
  const evs = kappaToNetworkEvents({ kappa: K, bytes: 4096, cacheHit: true, verified: true, ts: 100, seq: 1 });
  const resp = byMethod(evs, "Network.responseReceived");
  ok(resp.params.response.fromDiskCache === true, "a re-fetched κ shows fromCache (served from the κ-memo, not re-streamed)");
  ok(resp.params.response.encodedDataLength === 0 && resp.params.response.headers["x-holo-cache"] === "hit", "cache-hit costs 0 bytes + x-holo-cache:hit (dedup is visible)");
}

// ── 3) a TAMPERED κ → loadingFailed (RED) — never a 200 ───────────────────────────────────────────────────
console.log("\ntamper → RED (L5/SEC-1):");
{
  const evs = kappaToNetworkEvents({ kappa: K, bytes: 4096, cacheHit: false, verified: false, ts: 100, seq: 2 });
  const failed = byMethod(evs, "Network.loadingFailed"), resp = byMethod(evs, "Network.responseReceived");
  ok(failed && /L5 REFUSE/.test(failed.params.errorText), "a content that does not re-derive → loadingFailed 'L5 REFUSE' (red row)");
  ok(!resp, "a tampered κ NEVER produces a 200/responseReceived (refused, not shown as served)");
}

// ── 4) the requestId is a stable alias of the κ (L1) ──────────────────────────────────────────────────────
console.log("\nrequestId ⇄ κ (content-derived alias, L1):");
{
  const a = kappaToNetworkEvents({ kappa: K, verified: true, seq: 7 })[0].params.requestId;
  const b = kappaToNetworkEvents({ kappa: K, verified: true, seq: 7 })[0].params.requestId;
  ok(a === b && a.includes(K.slice(0, 16)), "same (κ,seq) → same requestId, derived from the κ (deterministic, not random)");
}

// ── 5) the tap emits the lifecycle on the :delta channel ──────────────────────────────────────────────────
console.log("\nthe live tap (Network.enable → :delta):");
{
  const sent = [];
  const onFetch = trackKappaFetches((e) => sent.push(e.method));
  onFetch({ kappa: K, bytes: 10, verified: true });
  onFetch({ kappa: K, cacheHit: true, verified: true });
  ok(sent.filter((m) => m === "Network.requestWillBeSent").length === 2, "every κ-fetch emits its request lifecycle through the tap");
  ok(sent.includes("Network.responseReceived"), "served fetches reach the panel as responses");
}

console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
