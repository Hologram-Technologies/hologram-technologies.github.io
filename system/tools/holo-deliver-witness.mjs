#!/usr/bin/env node
// holo-deliver-witness.mjs — proves NAMELESS, VERIFIED DELIVERY PAST A NAME-SHAPED ISP FILTER (the enclosed
// Virgin Media WebSafe block). The filter reads NAMES (DNS/SNI) and lands the browser on a block page. The
// substrate answers with content it addresses by hash and pulls peer-to-peer: no plaintext DNS query the
// filter can read, no ClientHello carrying the blocked SNI, and NO TRUST in the peer that carries the bytes —
// a tampered byte is refused by BLAKE3/Bao math (Law L5), not by trusting the messenger.
//
// Drives the REAL substrate: real enrolled holo-identity operators, real signed holo-zone/holo-root anchors,
// real holo-bao verified streaming, real holo-block-detect / holo-deliver / holo-relay. No mocks of the crypto.
//
// Checks (all must hold):
//   1 detectBlockPage      — a navigation that LANDS on websafe.virginmedia.com classifies blocked + captures original.
//   2 detectRedirect       — a 3xx toward the filter host classifies blocked one hop early.
//   3 falsePositiveGuard   — a normal same-site 302, a 200, and a deliberate visit TO the filter host are NOT blocks.
//   4 namelessNoDns        — resolveNameless via κ-roots returns the content κ and NEVER touches the DoH/DNS path.
//   5 unboundFailsClosed   — a host bound in no anchor fails closed (no silent plaintext-DNS fallback).
//   6 verifiedPull         — fetchVerified over a peer Bao stream reassembles bytes IDENTICAL to the origin.
//   7 tamperRefused        — one flipped byte in the stream ⇒ refused (L5), nothing admitted.
//   8 relayUntrusted       — a HOSTILE relay serving different bytes under the real κ is refused; honest relay admitted.
//   9 coldThenWarm         — before any peer holds it, deliver() honestly misses; after the relay seeds κ, it succeeds.
//  10 endToEnd             — blocked obs → detect → nameless resolve → verified peer pull → bytes == the wanted page,
//                            with the ISP resolver call-count provably ZERO and the consumer never touching the origin.
//
// Authority: UOR-ADDR (κ = H(canonical_form)) · BLAKE3 tree hash + Bao verified streaming · W3C PROV-O ·
// holospaces Laws L1/L2/L5 · rests on #holo-zone #holo-root #holo-bao #holo-identity. node tools/holo-deliver-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeZone, normTarget } from "../os/usr/lib/holo/holo-zone.mjs";
import { makeRoot } from "../os/sbin/holo-root.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";
import bao from "../os/usr/lib/holo/holo-bao.mjs";
import { detectBlock } from "../os/usr/lib/holo/holo-block-detect.mjs";
import { resolveNameless, fetchVerified, deliver } from "../os/usr/lib/holo/holo-deliver.mjs";
import { makeRelay } from "../os/usr/lib/holo/holo-relay.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = (init = []) => { let s = clone(init); return { load: async () => clone(s), save: async (r) => { s = clone(r); } }; };
let tick = 0; const now = () => `2026-06-25T00:00:${String(tick++).padStart(2, "0")}.000Z`;
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const hexOf = (k) => String(k).split(":").pop();

// ── the page the user actually wanted (multi-chunk so Bao builds a real Merkle tree) ────────────────────────
const WANTED = "https://blocked.example/article";
const HOST = "blocked.example";
const doc = new TextEncoder().encode(
  "<!doctype html><title>The page the filter hid</title>" + "<p>real content. </p>".repeat(220));   // ~4.6 KB → 5 chunks

// ── the UNFILTERED relay: fetches the origin from its vantage, seals to a blake3 root + Bao stream ──────────
let originFetches = 0;                                  // how many times the ORIGIN was actually contacted
const relay = makeRelay({ originFetch: async (u) => { originFetches++; if (u.includes(HOST)) return doc; throw new Error("relay: unknown origin " + u); } });

// the peer byte-store: hex(κ) → the encoded object. openStream() hands the consumer a fresh chunk stream.
const peerStore = new Map();
const openStream = async (kappa) => { const e = peerStore.get(hexOf(kappa)); return e ? e.chunks.map((c) => ({ ...c })) : null; };

// ── κ-roots: an anchor binds the human host → the content κ. Pure math; NO DNS. ─────────────────────────────
const opA = await enroll({ label: "deliver-anchor", passphrase: "kilo lima mike november 7" });

// ── 1 · LAND on the filter host → blocked, original captured ────────────────────────────────────────────────
const d1 = detectBlock({ requestedUrl: WANTED, finalUrl: "https://websafe.virginmedia.com/childsafe-blocked.html", status: 200 });
ok("detectBlockPage", d1.blocked && d1.signal === "isp-block-page" && d1.original === WANTED, JSON.stringify(d1));

// ── 2 · a 3xx toward the filter host → blocked one hop early ─────────────────────────────────────────────────
const d2 = detectBlock({ requestedUrl: WANTED, status: 302, location: "https://websafe.virginmedia.com/childsafe-blocked.html" });
ok("detectRedirect", d2.blocked && d2.signal === "isp-redirect", JSON.stringify(d2));

// ── 3 · false-positive guard: normal 302, 200, and visiting the filter host are NOT blocks ──────────────────
const g1 = detectBlock({ requestedUrl: WANTED, status: 302, location: "https://blocked.example/login" });
const g2 = detectBlock({ requestedUrl: WANTED, finalUrl: WANTED, status: 200 });
const g3 = detectBlock({ requestedUrl: "https://websafe.virginmedia.com/help", finalUrl: "https://websafe.virginmedia.com/help", status: 200 });
ok("falsePositiveGuard", !g1.blocked && !g2.blocked && !g3.blocked, JSON.stringify({ legit302: g1.blocked, ok200: g2.blocked, visitFilter: g3.blocked }));

// seal the wanted page through the relay, publish its κ under the host name in a κ-root anchor
const sealed = await relay.serve(WANTED);                 // { kappa(blake3 hex), len, stream }
peerStore.set(hexOf(sealed.kappa), { chunks: sealed.stream });
const anchorA = makeZone({ owner: opA, backend: arrayBackend(), now });
await anchorA.bind(HOST, sealed.kappa);                    // name → content κ (math, no registrar)
const openZone = async (hex) => (hex === hexOf(opA.kappa) ? anchorA : null);
const root = makeRoot({ anchors: [anchorA], openZone });

// a DoH transport spy — the ENCRYPTED fallback. The κ-roots path must make it UNNECESSARY (never called).
let dohCalls = 0;
const doh = { fetch: async () => { dohCalls++; return { dohJson: { Status: 0, AD: true, Answer: [] }, holoTxt: "" }; } };

// ── 4 · resolveNameless via κ-roots returns the κ and touches NO DNS ────────────────────────────────────────
const r4 = await resolveNameless(HOST, { root, doh });
ok("namelessNoDns", r4.ok && hexOf(r4.kappa) === sealed.kappa && r4.via === "kappa-roots" && dohCalls === 0,
   JSON.stringify({ ok: r4.ok, via: r4.via, kappaMatch: hexOf(r4.kappa) === sealed.kappa, dohCalls }));

// ── 5 · a host in no anchor fails closed (no silent plaintext-DNS escape hatch) ──────────────────────────────
const r5 = await resolveNameless("never.bound.example", { root });   // no doh ⇒ nowhere to fall back to
ok("unboundFailsClosed", r5.ok === false, JSON.stringify(r5));

// ── 6 · verified pull: peer Bao stream reassembles to the EXACT origin bytes ─────────────────────────────────
const p6 = await fetchVerified(sealed.kappa, { stream: await openStream(sealed.kappa) });
ok("verifiedPull", p6.ok && eq([...p6.bytes], [...doc]), JSON.stringify({ ok: p6.ok, bytesMatch: p6.ok && eq([...p6.bytes], [...doc]) }));

// ── 7 · tamper one byte in the stream ⇒ refused, nothing admitted (L5) ───────────────────────────────────────
const tampered = (await openStream(sealed.kappa)).map((c) => ({ ...c, bytes: c.bytes.slice() }));
tampered[1].bytes[0] = tampered[1].bytes[0] ^ 0xff;       // flip a bit in chunk 1
const p7 = await fetchVerified(sealed.kappa, { stream: tampered });
ok("tamperRefused", p7.ok === false && p7.why === "verify-refused", JSON.stringify(p7));

// ── 8 · a HOSTILE relay serving DIFFERENT bytes under the real κ is refused; the honest one is admitted ──────
const evil = bao.encode(new TextEncoder().encode("totally different content the relay tried to inject")).chunks;
const p8bad = await fetchVerified(sealed.kappa, { stream: evil });          // evil proofs ≠ honest root
const p8good = await fetchVerified(sealed.kappa, { stream: await openStream(sealed.kappa) });
ok("relayUntrusted", p8bad.ok === false && p8good.ok === true, JSON.stringify({ hostileRefused: !p8bad.ok, honestAdmitted: p8good.ok }));

// ── 9 · cold (no peer holds it) misses honestly; after the relay seeds κ, deliver() succeeds ─────────────────
const coldStore = new Map();
const coldOpen = async (kappa) => { const e = coldStore.get(hexOf(kappa)); return e ? e.chunks.map((c) => ({ ...c })) : null; };
const cold = await deliver(HOST, { root, openStream: coldOpen });           // κ resolves, but no peer has the bytes
const seed = await relay.serve(WANTED); coldStore.set(hexOf(seed.kappa), { chunks: seed.stream });
const warm = await deliver(HOST, { root, openStream: coldOpen });
ok("coldThenWarm", cold.ok === false && cold.stage === "transport" && warm.ok === true && eq([...warm.bytes], [...doc]),
   JSON.stringify({ cold: cold.ok, coldStage: cold.stage, warm: warm.ok }));

// ── 10 · END TO END: blocked obs → detect → nameless → verified peer pull → the wanted page ─────────────────
const observed = { requestedUrl: WANTED, finalUrl: "https://websafe.virginmedia.com/childsafe-blocked.html", status: 200 };
const det = detectBlock(observed);
const fetchesBefore = originFetches;                       // the CONSUMER must add ZERO origin fetches
const e2e = det.blocked ? await deliver(new URL(det.original).host, { root, doh, openStream }) : { ok: false };
ok("endToEnd", det.blocked && e2e.ok && eq([...e2e.bytes], [...doc]) && dohCalls === 0 && originFetches === fetchesBefore,
   JSON.stringify({ blocked: det.blocked, delivered: e2e.ok, pageMatch: e2e.ok && eq([...e2e.bytes], [...doc]), ispResolverCalls: dohCalls, consumerOriginFetches: originFetches - fetchesBefore }));

await forget(opA.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-deliver — nameless, verified delivery past a name-shaped ISP filter (Virgin Media WebSafe). The filter reads names (DNS/SNI) and lands the browser on a block page; the substrate detects that landing, resolves the wanted host to a content κ with ZERO plaintext DNS (κ-roots math / encrypted DoH bridge), and pulls the bytes peer-to-peer addressed by hash and Bao-verified per chunk (Law L5). The carrying peer is UNTRUSTED: a tampered or substituted byte is refused by BLAKE3 math, not by trusting the messenger — the guarantee a VPN/Tor exit cannot give. Honest boundary: cold first-contact still touches the origin from an UNFILTERED relay's vantage (who-wanted-it is hidden from the ISP; the relay sees the fetch), and a fully severed link is not defeated — this routes around name-filtering, it does not beat the wire.",
  authority: "UOR-ADDR (κ = H(canonical_form)) · BLAKE3 tree hash + Bao verified streaming · W3C PROV-O · holospaces Laws L1/L2/L5 · rests on #holo-zone #holo-root #holo-bao #holo-identity",
  witnessed,
  covers: witnessed ? ["block-detect-landing", "block-detect-redirect", "false-positive-guard", "nameless-resolve-no-dns", "unbound-fail-closed", "verified-peer-pull", "tamper-refused-L5", "untrusted-relay", "cold-then-warm", "end-to-end-zero-isp-dns"] : [],
  sample: { wanted: WANTED, host: HOST, kappa: sealed.kappa, len: sealed.len, chunks: sealed.stream.length },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-deliver-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-deliver witness — nameless, verified delivery past a name-shaped ISP filter (WebSafe)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  wanted "${HOST}" → κ ${sealed.kappa.slice(0, 28)}…  (${sealed.len} B, ${sealed.stream.length} Bao chunks)`);
console.log(`  blocked landing detected → resolved nameless (0 ISP-DNS queries) → ${doc.length} B pulled + verified from a peer`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  the filter reads names; our delivery is nameless and self-verifying" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
