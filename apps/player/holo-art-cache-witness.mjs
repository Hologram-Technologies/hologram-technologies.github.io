#!/usr/bin/env node
// holo-art-cache-witness.mjs — proves artwork is a content-addressed κ-object: fetched once, served O(1)
// from κ on repeat, deduped across URLs with identical bytes, tamper-refused (Law L5), and offline-capable.
//
// Checks:
//   1 fetchOnce      — first resolve fetches; second resolve serves from κ (0 extra fetches).
//   2 contentAddr    — the κ is sha256 of the exact bytes (stable).
//   3 dedupByBytes   — two URLs with identical bytes store the blob once (deduped at κ).
//   4 verifyBeforeTrust — a tampered stored blob fails to re-derive and is refused.
//   5 worksOffline   — a warm κ serves with the network down.
//
// node holo-art-cache-witness.mjs   (from holo-apps/apps/player/)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { createArtCache, memKV } from "./holo-art-cache.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

const bytesA = new TextEncoder().encode("\x89PNG...poster-A-bytes");
const bytesB = new TextEncoder().encode("\x89PNG...poster-A-bytes");   // identical to A (same image, different URL)
const kappaA = "sha256:" + createHash("sha256").update(Buffer.from(bytesA)).digest("hex");

let calls = 0;
const map = { "https://img/a.jpg": bytesA, "https://img/a-mirror.jpg": bytesB };
const makeFetch = (down = false) => async (url) => { if (down) throw new Error("offline"); calls++; return { ok: true, status: 200, arrayBuffer: async () => map[url].buffer.slice(map[url].byteOffset, map[url].byteOffset + map[url].byteLength) }; };

const kv = memKV();
const cache = createArtCache({ kv, fetch: makeFetch() });

// 1 + 2
{
  const r1 = await cache.resolve("https://img/a.jpg");
  const before = calls;
  const r2 = await cache.resolve("https://img/a.jpg");
  ok("fetchOnce", r1.fromCache === false && r2.fromCache === true && calls === before, JSON.stringify({ r1: r1.fromCache, r2: r2.fromCache, calls }));
  ok("contentAddr", r1.kappa === kappaA, JSON.stringify({ got: r1.kappa, want: kappaA }));
}
// 3 — second URL, identical bytes → blob deduped
{
  const before = cache.stats().dedup;
  const r = await cache.resolve("https://img/a-mirror.jpg");
  ok("dedupByBytes", r.kappa === kappaA && cache.stats().dedup === before + 1, JSON.stringify({ kappa: r.kappa, stats: cache.stats() }));
}
// 4 — forge a stored blob whose bytes no longer match its κ → refused
{
  const forgedKV = memKV();
  forgedKV.set("u:x", kappaA);
  forgedKV.set("b:" + kappaA, Buffer.from(new TextEncoder().encode("not the real bytes")).toString("base64"));
  const forged = createArtCache({ kv: forgedKV, fetch: makeFetch() });
  const got = await forged.get("x");
  ok("verifyBeforeTrust", got === null && forged.stats().refused >= 1, JSON.stringify({ got, stats: forged.stats() }));
}
// 5 — network down, but the κ is warm from check 1 → still serves
{
  const offline = createArtCache({ kv, fetch: makeFetch(true) });
  let r = null, threw = false;
  try { r = await offline.resolve("https://img/a.jpg"); } catch { threw = true; }
  ok("worksOffline", !threw && r && r.kappa === kappaA && r.fromCache === true, JSON.stringify({ threw, kappa: r && r.kappa }));
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-art-cache — every poster/backdrop/logo/still is a content-addressed κ-object: fetched once, served O(1) from κ on repeat (no network), deduped across URLs with identical bytes, tamper-refused (Law L5), and offline-capable. The pipeline that turns a text-on-gradient wall into instant, beautiful artwork.",
  authority: "rests on #holo-art-cache — Phase A of the artwork/rich-metadata plan",
  witnessed,
  covers: witnessed ? ["fetch-once", "content-addr", "dedup-by-bytes", "verify-before-trust", "works-offline"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-art-cache-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-art-cache witness — artwork as a content-addressed κ-object (instant · offline · verifiable)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  beautiful art, fetched once, served from κ forever" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
