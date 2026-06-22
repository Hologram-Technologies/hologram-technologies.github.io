// holo-agentpassport-witness.mjs — proves the Agent Passport: a holo-delegate credential carrying BOTH
// roots — substrate (its κ re-derives, hybrid-signed) AND hardware (a holo-stepup attestation bound to the
// exact mandate) — enforced at the one authorizeRequest chokepoint, revoked by a sealed κ revocation set.
// No CA, no coordinator. Additive: plain delegations (no step-up) keep working byte-identically.
// Run: node system/tools/holo-agentpassport-witness.mjs
import { principalFromSeed } from "../os/usr/lib/holo/holo-login.mjs";
import { generateMnemonic, seedFromMnemonic } from "../os/usr/lib/holo/holo-wdk.js";
import { mintNpc, delegate, verifyDelegation, attestationOf, passportOf, authorizeRequest } from "../os/usr/lib/holo/holo-delegate.mjs";
import { buildStepUp } from "../os/usr/lib/holo/holo-stepup.mjs";
import { buildRevocationSet, verifyRevocationSet, isRevoked, freshEnough } from "../os/usr/lib/holo/holo-revocation.mjs";
import { makeWalletAgent } from "../os/usr/lib/holo/holo-wallet-agent.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { (c ? pass++ : fail++); console.log(`  ${c ? "✓" : "✗"}  ${n}`); };

console.log("holo-agentpassport — dual-rooted (TEE × κ-substrate) revocable agent identity\n");

// the human operator (PC) — κ = addressOf(raw ed pubkey), the convention holo-stepup expects
const pc = await principalFromSeed(seedFromMnemonic(generateMnemonic(12)), "Ada");
const npc = mintNpc("Scout");

// ── mint a passport: ONE step-up bound to the mandate, embedded in the delegation ────────────────────────
const caps = ["wallet:read", "wallet:spend"];
const notAfter = "2030-01-01T00:00:00Z";
const mandate = { subject: npc.kappa, capabilities: [...caps].sort(), notAfter };
const action = { "@type": "HoloStepUp", kind: "delegation.issue", appId: "org.hologram.HoloIdentity",
  operator: pc.kappa, reason: `Authorize agent “${npc.label}” for ${caps.join(", ")}`, payload: mandate,
  issuedAt: "2026-06-15T00:00:00Z", nonce: "0011223344556677" };
const stepup = await buildStepUp(action, pc);                           // the PC (operator) signs the mandate at its "TEE"
const { credential: passport } = await delegate(pc, npc, { capabilities: caps, notAfter, stepup });

// ── SUBSTRATE root (existing) ────────────────────────────────────────────────────────────────────────────
const body = verifyDelegation(passport, { nowIso: "2026-06-15T12:00:00Z" });
ok("substrate root: passport verifies (κ re-derives, hybrid Ed25519 ‖ ML-DSA)", !!body);
ok("substrate root: lineage issuer=PC κ, subject=NPC κ", body && body.issuer === pc.kappa && body.subject === npc.kappa);

// ── HARDWARE root (net-new binding) ──────────────────────────────────────────────────────────────────────
ok("passport carries an embedded step-up + attestRoot", !!passport.stepup && !!passport.attestRoot);
const attest = await attestationOf(passport);
ok("hardware root re-derives offline (attestationOf → tee|soft)", attest === "soft" || attest === "tee");
ok("honest degradation: no WebAuthn axis under Node ⇒ attestRoot 'soft'", passport.attestRoot === "soft");

// dual-root binding: a step-up for a DIFFERENT mandate must be refused at mint (the biometric must commit to
// the exact authority granted, not a nonce or another grant)
const wrongMandate = { subject: npc.kappa, capabilities: ["wallet:read"].sort(), notAfter };  // narrower caps ≠ granted
const wrongAction = { ...action, payload: wrongMandate };
const wrongStepup = await buildStepUp(wrongAction, pc);
let boundRefused = false;
try { await delegate(pc, npc, { capabilities: caps, notAfter, stepup: wrongStepup }); } catch { boundRefused = true; }
ok("dual-root: a step-up NOT bound to this mandate is refused at mint", boundRefused);

// a passport whose embedded step-up is swapped for a foreign one fails the hardware-root re-check
const foreign = await attestationOf({ ...passport, stepup: wrongStepup });
ok("dual-root: tampered/foreign step-up ⇒ attestationOf null", foreign === null);

// the one read API both doors use: a dual-rooted passport for the agent, mints nothing
const view = await passportOf(passport, { nowIso: "2026-06-15T12:00:00Z" });
ok("passportOf: dual-rooted view (subject, caps, attestRoot, dualRoot=true)",
  view && view.subject === npc.kappa && view.dualRoot === true && view.attestRoot === "soft" && view.capabilities.includes("wallet:spend"));
ok("passportOf: a plain delegation reads as NOT dual-rooted", (await passportOf((await delegate(pc, mintNpc("P"), { capabilities: ["wallet:read"] })).credential)).dualRoot === false);

// L5 substrate tamper still refused (changing caps breaks the signature/id)
ok("substrate tamper: mutated capabilities refused (L5)", !verifyDelegation({ ...passport, capabilities: [...passport.capabilities, "wallet:admin"] }));

// ── ADDITIVE: a plain delegation (no step-up) still works, byte-identical (no attestRoot/stepup fields) ──
const { credential: plain } = await delegate(pc, mintNpc("Viewer"), { capabilities: ["wallet:read"], notAfter });
ok("additive: plain delegation still verifies", !!verifyDelegation(plain));
ok("additive: plain delegation has NO passport fields (back-compat)", !("attestRoot" in plain) && !("stepup" in plain));
ok("additive: plain delegation has no hardware root", (await attestationOf(plain)) === null);

// ── ENFORCEMENT at the one chokepoint: capability + κ-native revocation, fail-closed ─────────────────────
const fresh = "2026-06-15T00:00:30Z";                                   // 30s after the set's issuedAt
const emptySet = await buildRevocationSet(pc, [], { epoch: 1, issuedAt: "2026-06-15T00:00:00Z" });
ok("revocation set verifies (sealed, owner-signed, κ re-derives)", !!verifyRevocationSet(emptySet));
ok("passport admitted for a send (has wallet:spend, not revoked, fresh set)",
  authorizeRequest(passport, { kind: "send", revocationSet: emptySet, nowIso: fresh }).ok === true);

const denySet = await buildRevocationSet(pc, [npc.kappa], { epoch: 2, issuedAt: "2026-06-15T00:00:00Z" });
ok("revoked agent denied (subject in the set)",
  authorizeRequest(passport, { kind: "send", revocationSet: denySet, nowIso: fresh }).reason === "agent has been revoked");
ok("isRevoked direct check", isRevoked(verifyRevocationSet(denySet), npc.kappa));

// fail-closed: a STALE set (older than the wallet:spend window of 60s) denies even a non-revoked agent
const stale = "2026-06-15T01:00:00Z";                                   // 1h later ≫ 60s spend window
ok("fail-closed: stale revocation set denies (freshness window)",
  authorizeRequest(passport, { kind: "send", revocationSet: emptySet, nowIso: stale }).reason === "revocation set stale");
ok("freshEnough: fresh within window true, stale false",
  freshEnough(verifyRevocationSet(emptySet), { nowIso: fresh, ttlMs: 60000 }) === true &&
  freshEnough(verifyRevocationSet(emptySet), { nowIso: stale, ttlMs: 60000 }) === false);

// fail-closed: a TAMPERED set (mutated revoked list) fails verification → deny
const tampered = { ...denySet, revoked: [] };                            // strip the revocation, keep the old signature
ok("fail-closed: tampered revocation set fails verification",
  authorizeRequest(passport, { kind: "send", revocationSet: tampered, nowIso: fresh }).reason === "revocation set failed verification");

// per-capability freshness: a read (1h window) is still fresh where a spend (60s) is stale — TTL_FOR_CAP
ok("per-capability TTL: read admitted at +1h where spend would be stale",
  authorizeRequest(passport, { kind: "address", revocationSet: emptySet, nowIso: "2026-06-15T00:30:00Z" }).ok === true);

// ── AGENT DOOR: the same passport, reached through the wallet-agent surface (one model, two callers) ──────
const seam = { address: async () => ({ address: "0xWALLET" }) };       // stub of the human-gated holo-wallet-bridge
const agent = makeWalletAgent({ seam });
const view2 = await agent.passport(passport, { nowIso: "2026-06-15T12:00:00Z" });
ok("agent door: passport() reads its own dual-rooted mandate (mints nothing)", !!view2 && view2.dualRoot === true && view2.subject === npc.kappa);

const agentCtx = (set) => ({ caller: { kind: "agent", label: "Scout" }, delegation: passport, revocationSet: set, nowIso: fresh });
const admitted = await agent.invoke("wallet_get_address", { chain: "ethereum" }, agentCtx(emptySet));
ok("agent door: a non-revoked passport is admitted for a read (κ-revocation set consulted)", admitted.ok === true);
const denied = await agent.invoke("wallet_get_address", { chain: "ethereum" }, agentCtx(denySet));
ok("agent door: a revoked passport is refused at the wallet seam (revocation reaches the door)", denied.ok === false && denied.refused === true);

console.log(`\n${fail ? "WITNESS FAILED" : "WITNESSED ✓"}  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
