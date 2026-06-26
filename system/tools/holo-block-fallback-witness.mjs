#!/usr/bin/env node
// holo-block-fallback-witness.mjs — proves the FACULTY the native host delegates to: given a URL an ISP filter
// blocked, resolveForBlock() returns its content κ resolved NAMELESS (κ-roots math, zero plaintext DNS), and
// fails closed for an unbound host. This is the seam between the C++ redirect-intercept and the JS name-resolve.
//
// Drives the REAL substrate: real enrolled holo-identity operator, a real signed holo-root anchor, the real
// holo-block-fallback faculty over the real holo-deliver/holo-block-detect. No mocks of the crypto.
//
// Checks:
//   1 resolvesNameless  — a host bound in a κ-root anchor resolves to its κ via "kappa-roots"; the DoH spy is NEVER called.
//   2 stripsUrlToHost   — resolveForBlock takes a full URL (path/query) and resolves on its HOST.
//   3 unboundFailsClosed— a host in no anchor and no DoH ⇒ ok:false (no silent plaintext-DNS fallback).
//   4 classifyWired     — classify() forwards to holo-block-detect (a WebSafe landing is blocked; a clean 200 is not).
//
// Authority: UOR-ADDR (κ = H(canonical_form)) · holospaces Laws L1/L5 · rests on #holo-root #holo-deliver
// #holo-block-detect. node tools/holo-block-fallback-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeZone } from "../os/usr/lib/holo/holo-zone.mjs";
import { makeRoot } from "../os/sbin/holo-root.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";
import { makeBlockFallback } from "../os/usr/lib/holo/holo-block-fallback.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = (init = []) => { let s = clone(init); return { load: async () => clone(s), save: async (r) => { s = clone(r); } }; };
let tick = 0; const now = () => `2026-06-25T00:00:${String(tick++).padStart(2, "0")}.000Z`;
const hexOf = (k) => String(k).split(":").pop();

const HOST = "blocked.example";
const kappa = "9f".repeat(32);                                  // the content κ a peer holds for the page

const op = await enroll({ label: "block-anchor", passphrase: "oscar papa quebec romeo 8" });
const anchor = makeZone({ owner: op, backend: arrayBackend(), now });
await anchor.bind(HOST, kappa);                                 // κ-roots: host → content κ (math, no DNS)
const openZone = async (hex) => (hex === hexOf(op.kappa) ? anchor : null);
const root = makeRoot({ anchors: [anchor], openZone });

let dohCalls = 0;
const doh = { fetch: async () => { dohCalls++; return { dohJson: { Status: 0, AD: true, Answer: [] }, holoTxt: "" }; } };

const fb = makeBlockFallback({ root, doh });

// ── 1 · resolves a blocked host to its κ, nameless, DoH never touched ──────────────────────────────────────
const r1 = await fb.resolveForBlock(`https://${HOST}/article?ref=x`);
ok("resolvesNameless", r1.ok && hexOf(r1.kappa) === kappa && r1.via === "kappa-roots" && dohCalls === 0,
   JSON.stringify({ ok: r1.ok, via: r1.via, kappaMatch: hexOf(r1.kappa) === kappa, dohCalls }));

// ── 2 · strips a full URL to its host ──────────────────────────────────────────────────────────────────────
ok("stripsUrlToHost", r1.host === HOST, JSON.stringify({ host: r1.host }));

// ── 3 · an unbound host fails closed (no plaintext-DNS escape) ─────────────────────────────────────────────
const fbNoDoh = makeBlockFallback({ root });                   // no doh ⇒ nowhere to fall back to
const r3 = await fbNoDoh.resolveForBlock("https://never.bound.example/x");
ok("unboundFailsClosed", r3.ok === false, JSON.stringify(r3));

// ── 4 · classify() forwards to holo-block-detect ───────────────────────────────────────────────────────────
const b = fb.classify({ requestedUrl: `https://${HOST}/a`, finalUrl: "https://websafe.virginmedia.com/childsafe-blocked.html", status: 200 });
const c = fb.classify({ requestedUrl: `https://${HOST}/a`, finalUrl: `https://${HOST}/a`, status: 200 });
ok("classifyWired", b.blocked === true && c.blocked === false, JSON.stringify({ block: b.blocked, clean: c.blocked }));

await forget(op.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-block-fallback — the faculty the native host delegates to when an ISP filter blocks a page and no peer holds that exact URL's κ: resolveForBlock(url) resolves the wanted host to a content κ NAMELESS (κ-roots math / encrypted DoH; the ISP resolver is never queried) and fails closed when unbound. The single seam between the C++ redirect-intercept and the JS κ-roots/DoH name-resolve.",
  authority: "UOR-ADDR (κ = H(canonical_form)) · holospaces Laws L1/L5 · rests on #holo-root #holo-deliver #holo-block-detect",
  witnessed,
  covers: witnessed ? ["nameless-resolve-no-dns", "url-to-host", "unbound-fail-closed", "classify-wired"] : [],
  sample: { host: HOST, kappa },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-block-fallback-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-block-fallback witness — the faculty the native host delegates to for nameless resolve\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  blocked host → κ resolved nameless (0 ISP-DNS), unbound fails closed" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
