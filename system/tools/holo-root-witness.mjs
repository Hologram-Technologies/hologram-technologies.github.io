#!/usr/bin/env node
// holo-root-witness.mjs — proves THERE IS NO ROOT (holo-root): the single DNS root zone + KSK is replaced
// by a PLURAL, pinnable set of self-verifying anchors and a default of pure math. A bare name resolves by
// walking pinned anchors in order, first VERIFIED hit winning (per-anchor scarcity — honest, deterministic).
// An anchor IS a zone (holo-zone) whose targets are other zones' names or content κ — a "zone of zones", so
// no new storage/crypto. Every anchor read is re-derived (Law L5); a tampered anchor is skipped, never
// trusted. holo-root also supplies the openZone seam the one omni door uses, and plugs into it for bare names.
//
// Drives the REAL substrate: real enrolled holo-identity operators, real signed holo-strand zones, real
// seal/verify — and the REAL one door (holo-omni-unified.resolveUnified) for the integration check.
//
// Checks (all must hold):
//   1 mathDefaultNoAnchor   — a holo://zone/<owner>/<label> resolves with ZERO anchors pinned (the math is the root).
//   2 contentPassthrough    — a did:holo κ returns itself (already an address), via "content-address".
//   3 bareNameTwoHop        — pin an anchor mapping "ilya.deck" → a zone-name → content; bare name resolves to content κ.
//   4 bareNameDirectKappa   — an anchor mapping a name straight to a content κ resolves in one hop.
//   5 fallthroughSkipsMiss  — anchor A lacks the name, anchor B has it ⇒ B answers (first verified hit wins).
//   6 pinOrderScarcity      — two anchors both bind "acme"; [A,B] ⇒ A wins, [B,A] ⇒ B wins (deterministic, per-anchor).
//   7 anchorVerifyB4Trust   — a tampered anchor chain is skipped ⇒ the name fails closed (never a forged answer).
//   8 unboundFailsClosed    — a name in no pinned anchor ⇒ ok:false, why "unbound".
//   9 provenanceReported    — a bare-name result names WHICH anchor (owner κ) answered; math default reports via "math".
//  10 oneDoorUsesRoot       — resolveUnified(bareName, {root}) routes through the root and returns lane "name" + the κ.
//
// Authority: UOR-ADDR (κ = H(canonical_form)) · IETF RFC 8785 (JCS) · W3C PROV-O · holospaces Laws L1/L2/L3/L5
// · rests on #holo-zone + #holo-strand + #holo-identity. node tools/holo-root-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeZone, normTarget } from "../os/usr/lib/holo/holo-zone.mjs";
import { makeRoot } from "../os/sbin/holo-root.mjs";
import { resolveUnified } from "../os/sbin/holo-omni-unified.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = (init = []) => { let store = clone(init); return { load: async () => clone(store), save: async (r) => { store = clone(r); }, dump: () => clone(store) }; };
let tick = 0; const now = () => `2026-06-23T00:01:${String(tick++).padStart(2, "0")}.000Z`;
const hexOf = (k) => k.split(":").pop();

const kX = "a1".repeat(32), kY = "b2".repeat(32), kZ = "c3".repeat(32);   // content targets
const tX = normTarget(kX), tY = normTarget(kY), tZ = normTarget(kZ);

// operators: a name owner (deck), and two anchor operators (A, B)
const ownerDeck = await enroll({ label: "deck-owner", passphrase: "alpha beta gamma 1" });
const opA = await enroll({ label: "anchor-A", passphrase: "delta echo foxtrot 2" });
const opB = await enroll({ label: "anchor-B", passphrase: "golf hotel india 3" });

// ilya's content zone: "deck" → kX
const deckZone = makeZone({ owner: ownerDeck, backend: arrayBackend(), now });
await deckZone.bind("deck", kX);
const deckName = deckZone.qualified("deck");                                // holo://zone/<ownerDeck>/deck

// anchor A: "ilya.deck" → ilya's zone-name (2-hop); "logo" → kY directly (1-hop); "acme" → kX
const anchorA = makeZone({ owner: opA, backend: arrayBackend(), now });
await anchorA.bind("ilya.deck", deckName);
await anchorA.bind("logo", kY);
await anchorA.bind("acme", kX);

// anchor B: "acme" → kZ (a DIFFERENT meaning, the collision)
const anchorB = makeZone({ owner: opB, backend: arrayBackend(), now });
await anchorB.bind("acme", kZ);

// openZone resolves an owner hex → its opened zone (the live-spine/gossip seam, here a static map)
const zonesByHex = { [hexOf(ownerDeck.kappa)]: deckZone, [hexOf(opA.kappa)]: anchorA, [hexOf(opB.kappa)]: anchorB };
const openZone = async (hex) => zonesByHex[hex] || null;

// ── 1 · the MATH default: a fully-qualified name needs no anchor ──────────────────────────────────────
const rootBare = makeRoot({ anchors: [], openZone });
const m1 = await rootBare.resolveName(deckName);
ok("mathDefaultNoAnchor", m1.ok && m1.kappa === tX && m1.via === "math", JSON.stringify(m1));

// ── 2 · a content address returns itself ──────────────────────────────────────────────────────────────
const m2 = await rootBare.resolveName("did:holo:sha256:" + kY);
ok("contentPassthrough", m2.ok && m2.kappa === tY && m2.via === "content-address", JSON.stringify(m2));

// ── 3 · bare name → anchor → zone-name → content (two hops) ──────────────────────────────────────────
const rootA = makeRoot({ anchors: [anchorA], openZone });
const m3 = await rootA.resolveName("ilya.deck");
ok("bareNameTwoHop", m3.ok && m3.kappa === tX && m3.hops.length === 2 && m3.via === opA.kappa, JSON.stringify({ ok: m3.ok, kappa: m3.kappa, hops: m3.hops.length, via: m3.via === opA.kappa }));

// ── 4 · bare name → content κ directly (one hop) ─────────────────────────────────────────────────────
const m4 = await rootA.resolveName("logo");
ok("bareNameDirectKappa", m4.ok && m4.kappa === tY && m4.hops.length === 1, JSON.stringify({ kappa: m4.kappa, hops: m4.hops.length }));

// ── 5 · fall through an anchor that lacks the name to one that has it ─────────────────────────────────
const rootBthenA = makeRoot({ anchors: [anchorB, anchorA], openZone });    // B has no "logo"; A does
const m5 = await rootBthenA.resolveName("logo");
ok("fallthroughSkipsMiss", m5.ok && m5.kappa === tY && m5.via === opA.kappa, JSON.stringify({ kappa: m5.kappa, via: m5.via === opA.kappa }));

// ── 6 · pin order decides a collision (per-anchor scarcity, deterministic) ───────────────────────────
const ab = await makeRoot({ anchors: [anchorA, anchorB], openZone }).resolveName("acme");   // A wins → kX
const ba = await makeRoot({ anchors: [anchorB, anchorA], openZone }).resolveName("acme");   // B wins → kZ
ok("pinOrderScarcity", ab.ok && ab.kappa === tX && ab.via === opA.kappa && ba.ok && ba.kappa === tZ && ba.via === opB.kappa, JSON.stringify({ AB: ab.kappa === tX, BA: ba.kappa === tZ }));

// ── 7 · a tampered anchor is skipped (verify-before-trust) ⇒ name fails closed ───────────────────────
const dumpA = anchorA.entries();
const tampered = clone(dumpA);
const li = tampered.findIndex((e) => (e["holstr:payload"] || {}).label === "logo");
tampered[li]["holstr:payload"].target = tZ;                                // try to redirect "logo" → kZ
const badAnchor = makeZone({ owner: opA.kappa, backend: arrayBackend(tampered) });
const rootBad = makeRoot({ anchors: [badAnchor], openZone });
const m7 = await rootBad.resolveName("logo");
ok("anchorVerifyB4Trust", m7.ok === false && m7.why === "unbound", JSON.stringify(m7));

// ── 8 · a name in no anchor fails closed ─────────────────────────────────────────────────────────────
const m8 = await rootA.resolveName("does.not.exist");
ok("unboundFailsClosed", m8.ok === false && m8.why === "unbound", JSON.stringify(m8));

// ── 9 · provenance: which anchor answered ────────────────────────────────────────────────────────────
ok("provenanceReported", m3.via === opA.kappa && m1.via === "math" && m2.via === "content-address", JSON.stringify({ bare: m3.via === opA.kappa, math: m1.via, content: m2.via }));

// ── 10 · the ONE door routes a bare name through the root ─────────────────────────────────────────────
const u = await resolveUnified("ilya.deck", { root: rootA });
ok("oneDoorUsesRoot", u.ok && u.lane === "name" && u.kappa === tX, JSON.stringify({ ok: u.ok, lane: u.lane, kappa: u.kappa === tX }));

await forget(ownerDeck.kappa); await forget(opA.kappa); await forget(opB.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-root — THERE IS NO ROOT: the single DNS root zone + KSK is replaced by a plural, pinnable set of self-verifying anchors and a default of pure math. A bare name resolves by walking pinned anchors in order, first verified hit winning (per-anchor scarcity — honest + deterministic). An anchor IS a zone (a zone of zones), so no new storage/crypto; every anchor read is re-derived (Law L5) and a tampered anchor is skipped, never trusted. Supplies the openZone seam the one omni door uses and plugs into it for bare names. The math default (a fully-qualified holo://zone/<owner>/<label>) needs no anchor at all.",
  authority: "UOR-ADDR (κ = H(canonical_form)) · IETF RFC 8785 (JCS) · W3C PROV-O · holospaces Laws L1/L2/L3/L5 · rests on #holo-zone + #holo-strand + #holo-identity",
  witnessed,
  covers: witnessed ? ["no-single-root", "math-default", "content-passthrough", "bare-name-multi-hop", "first-verified-hit", "pin-order-scarcity", "anchor-verify-before-trust", "unbound-fail-closed", "provenance", "one-door-integration"] : [],
  sample: { deckName, bare: "ilya.deck", target: tX },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-root-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-root witness — there is no root: plural pinnable anchors + a default of pure math\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  bare "ilya.deck" → ${tX.slice(0, 28)}…  via anchor ${hexOf(opA.kappa).slice(0, 12)}…  (${"2 hops"})`);
console.log(`  collision "acme": pin [A,B]→kX · pin [B,A]→kZ  (your order, your namespace)`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  no root to capture; names resolve by pinned, re-derivable anchors" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
