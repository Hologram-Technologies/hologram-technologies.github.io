#!/usr/bin/env node
// holo-own-adversarial.test.mjs — adversarial conformance for the Own engine (ADR-053).
//
// Unlike holo-own-demo-witness.mjs (which constructs forgeries that trip a *different* guard than
// the one it credits), this suite attacks each load-bearing property independently and names the
// guard that catches it. Run from system/:
//
//     node tools/holo-own-adversarial.test.mjs
//
// SCOPE — issuer-binding is ADDITIVE:
//   Provenance Title  (mint{ owned })  — title over a pre-existing κ. Still valid (legacy).
//   Asset Title       (mint{ asset  })  — originator mints a NEW asset whose κ commits to the
//                                          creator's key; a foreign genesis cannot re-derive to it.
//   Layer 1 (asset genesis authenticity) — CLOSED by issuer-binding; asserted PASS below.
//   Layer 2 (double-genesis fork / transfer double-spend) — NOT closeable without a global ordering
//     anchor. Encoded as KNOWN-OPEN probes (clearly labelled); informational, never fail the run.

import { makeServer } from "../os/usr/lib/holo/mcp/holo-mcp.mjs";
import { enroll } from "../os/usr/lib/holo/holo-identity.mjs";
import * as own from "../os/usr/lib/holo/holo-own.mjs";
import { verify as verifyObject } from "../os/usr/lib/holo/holo-object.mjs";

const srv = makeServer({ manifests: [] });
const mcp = async (n, a) =>
  JSON.parse((await srv.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: n, arguments: a } })).result.content[0].text);
const ref = (p) => p.kappa.replace(/^did:holo:/, "");

let passed = 0, failed = 0;
const ok = (name, cond, detail = "") => {
  cond ? passed++ : failed++;
  console.log(`   ${cond ? "✓" : "✗ FAIL"}  ${name}${detail && !cond ? `  — ${detail}` : ""}`);
};
const note = (s) => console.log(`\n• ${s}`);

const maya    = await enroll({ label: "Maya (creator)",      passphrase: "m" });
const mallory = await enroll({ label: "Mallory (attacker)",  passphrase: "x" });
const atlas   = await enroll({ label: "Atlas (buyer agent)", passphrase: "a" });
const bob     = await enroll({ label: "Bob (second buyer)",  passphrase: "b" });

console.log("\n══ adversarial conformance: Holo Own (ADR-053) ══");

// ── baseline (asset Title) ────────────────────────────────────
note("Baseline: Maya mints an ISSUER-BOUND asset and it verifies to her.");
const g = await own.mint(
  { asset: { id: "org.hologram.StudioWorld", name: "Studio World" }, rights: { "odrl:action": "use" } },
  maya
);
const v0 = await mcp("own_verify", { titles: [g] });
ok("asset genesis verifies, owner = Maya, result re-derives", v0.ok && v0.owner === ref(maya) && verifyObject(v0.result));
const MAYA_ASSET = g.owned;

// ── A · tamper an un-inspected field, keep id + sig (κ re-derivation must catch it) ─
note("Attack A: silently tamper `rights`, keep @id + sig.");
const tA = JSON.parse(JSON.stringify(g)); tA.rights = { "odrl:action": "sell", escalated: true };
const rA = await mcp("own_verify", { titles: [tA] });
ok("A: tampered title refused (κ does not re-derive)", rA.ok === false, JSON.stringify(rA.errors));

// ── B · issuer-binding: no foreign genesis can re-derive to Maya's asset κ ───────
note("Attack B: a non-creator tries to mint a competing genesis to Maya's ASSET.");
//  B1 — legacy provenance Title STILL VALID (additive: raw-owned is not refused).
const b1 = await own.mint({ owned: "sha256:" + "0".repeat(64), rights: { "odrl:action": "use" } }, mallory);
const rB1 = await mcp("own_verify", { titles: [b1] });
ok("B1: legacy provenance genesis still verifies (coexistence)", rB1.ok === true && rB1.owner === ref(mallory));
//  B2 — minting the "same" asset yields a DIFFERENT κ (collision dissolves; not Maya's).
const b2 = await own.mint({ asset: { id: "org.hologram.StudioWorld", name: "Studio World" } }, mallory);
const rB2 = await mcp("own_verify", { titles: [b2] });
ok("B2: Mallory's same-name asset is a DISTINCT κ, not Maya's", rB2.ok === true && b2.owned !== MAYA_ASSET);
//  B3 — copy Maya's asset descriptor but claim self: dies at re-derive / issuer-binding.
const b3 = JSON.parse(JSON.stringify(g));
b3.owner = ref(mallory); b3.issuer = { pub: mallory.pub, alg: mallory.alg };
const rB3 = await mcp("own_verify", { titles: [b3] });
ok("B3: descriptor-copy forgery refused", rB3.ok === false, JSON.stringify(rB3.errors));
//  B4 — issuer-bound asset: a foreign asset Title with the SAME fields can never share Maya's κ.
const b4 = await own.mint({ asset: { id: "org.hologram.StudioWorld", name: "Studio World" } }, mallory);
ok("B4: no foreign issuer can produce Maya's exact asset κ", b4.owned !== MAYA_ASSET);

// ── C · theft by unauthorized transfer ─────────────────────────────
note("Attack C: a non-owner signs a transfer of Maya's title to herself.");
let cBlocked;
try {
  const stolen = await own.transfer({ title: g, to: mallory }, mallory);
  const rC = await mcp("own_verify", { titles: [g, stolen] });
  cBlocked = rC.ok === false;
} catch { cBlocked = true; }
ok("C: non-owner transfer blocked (SEC-2)", cBlocked);

// ── D · settlement against an unproven title ───────────────────────
note("Attack D: settle a payment against a broken/forged title.");
const order = { subject: g["@id"], amount: { value: 500, currency: "NP" }, buyer: ref(mallory) };
const rD = await mcp("own_settle", { order, titles: [b3] });
ok("D: settle against a broken title releases nothing", rD.released === false);

// ── regression · legitimate sale still works end-to-end ─────────────────
note("Regression: Maya legitimately transfers to Atlas; settlement pays Maya.");
const settled = await mcp("own_settle", { order: { subject: g["@id"], amount: { value: 500, currency: "NP" }, buyer: ref(atlas) }, titles: [g] });
ok("legit settle releases against Maya's proven title, payee = Maya", settled.released === true && settled.voucher.payee === ref(maya));
const t1 = await own.transfer({ title: g, to: atlas }, maya);
const v1 = await mcp("own_verify", { titles: [g, t1] });
ok("legit transfer verifies, owner = Atlas", v1.ok && v1.owner === ref(atlas) && verifyObject(v1.result));

// ── Layer 2 · KNOWN-OPEN: double-genesis fork (no global ordering) ────────────
note("Layer-2 probe (KNOWN-OPEN): two provenance genesis for one `owned` are a FORK.");
const sharedK = "sha256:" + "a".repeat(64);
const gA = await own.mint({ owned: sharedK }, maya);
const gB = await own.mint({ owned: sharedK }, mallory);
const forks = own.detectForks([gA, gB]);
const forkSeen = forks.some((f) => f.prior === ("genesis:" + sharedK) && f.heads.length === 2);
console.log(`   ${forkSeen ? "⚠ OPEN" : "✗"}  L2a: double-genesis on one κ detected as a fork (resolve via anchor)`);
console.log("        Two parties each claim the SAME pre-existing κ; exclusivity needs an ordering anchor.");

note("Layer-2 probe (KNOWN-OPEN): Maya signs TWO conflicting transfers of the same title.");
const toAtlas = await own.transfer({ title: g, to: atlas }, maya);
const toBob   = await own.transfer({ title: g, to: bob },   maya);
const forkA = await mcp("own_verify", { titles: [g, toAtlas] });
const forkB = await mcp("own_verify", { titles: [g, toBob] });
const bothVerify = forkA.ok && forkB.ok && forkA.owner !== forkB.owner;
console.log(`   ${bothVerify ? "⚠ OPEN" : "✓ closed"}  L2b: two conflicting transfers each verify in isolation` +
            `${bothVerify ? ` (→ ${forkA.owner === ref(atlas) ? "Atlas" : forkA.owner} AND ${forkB.owner === ref(bob) ? "Bob" : forkB.owner})` : ""}`);
console.log("        Layer-2 requires an ordering anchor (notary / transparency log / chain).");
console.log("        These probes are informational and do not affect the pass/fail total.");

// ── tally ────────────────────────────────────────
console.log(`\n══ ${passed} passed, ${failed} failed ══`);
process.exit(failed === 0 ? 0 : 1);
