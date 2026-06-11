#!/usr/bin/env node
// holo-own-witness.mjs — PROVE Holo Own (ADR-053): verifiable, self-sovereign ownership on the
// content-addressable substrate. Uses REAL principals (holo-identity: WebCrypto Ed25519/ECDSA)
// and substrate-parity κ (holo-blake3 + holo-realization). Proves: a Title re-derives to its κ
// (Law L5); mint → transfer → resolveOwner; a non-owner transfer is refused; a delegated transfer
// succeeds in-scope and is refused on escalation (wrong asset / recipient constraint); a
// double-transfer FORK is detected and "anchor wins" resolves it; value settles only against a
// re-derivable Title (idempotent voucher κ); tamper is refused. Pure-Node; the chain rail mocked.
//
//   node tools/holo-own-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const L = (p) => new URL("../os/usr/lib/holo/" + p, import.meta.url);
const { enroll } = await import(L("holo-identity.mjs"));
const { kappaBlake3 } = await import(L("holo-blake3.mjs"));
const OWN = await import(L("holo-own.mjs"));
const { mint, transfer, grant, verifyChain, resolveOwner, detectForks, anchor, resolveForkByAnchor, settle, toDid } = OWN;
const { mockRail, declineRail, settleVia } = await import(L("holo-own-rail.js"));

const ref = (p) => p.kappa.replace(/^did:holo:/, "");                 // a principal's σ-axis κ ref
const checks = {}; let passed = 0, failed = 0;
const rec = (name, ok) => { checks[name] = !!ok; ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${name}`); };
const te = new TextEncoder();

// real, self-sovereign principals (keys minted + held on "device"; never a server account)
const alice = await enroll({ label: "alice", passphrase: "a" });
const bob = await enroll({ label: "bob", passphrase: "b" });
const carol = await enroll({ label: "carol", passphrase: "c" });
const mallory = await enroll({ label: "mallory", passphrase: "m" });
const owned = kappaBlake3(te.encode("org.hologram.MyApp"));           // the owned object's κ (content)
const owned2 = kappaBlake3(te.encode("org.hologram.Other"));

// 1 · mint (genesis) — Alice asserts initial title; it re-derives + self-verifies
const g = await mint({ owned }, alice);
rec("Title is substrate-parity κ (blake3:) over the owner/owned/prior frame", g["@id"].startsWith("blake3:") && g.owner.startsWith("sha256:"));
let r = await verifyChain([g]);
rec("genesis Title verifies (Law L5) and resolves its owner", r.ok && r.owner === ref(alice) && r.ownerDid === toDid(ref(alice)));

// 2 · transfer by the owner — Alice → Bob
const t1 = await transfer({ title: g, to: bob }, alice);
r = await verifyChain([g, t1]);
rec("owner can transfer; the chain re-derives and the head resolves to Bob", r.ok && (await resolveOwner([g, t1])) === ref(bob));

// 3 · a non-owner cannot transfer
let refused = false;
try { await transfer({ title: t1, to: mallory }, mallory); } catch (e) { refused = /refused/.test(e.message); }
rec("a non-owner transfer is refused (SEC-2)", refused);

// 4 · delegated transfer IN SCOPE — Bob grants Carol (toOnly Alice); Carol transfers t1 → Alice
const gBob = await grant({ to: carol, owned, toOnly: [ref(alice)] }, bob);
const t2 = await transfer({ title: t1, to: alice }, carol, { proof: gBob });
r = await verifyChain([g, t1, t2], { delegations: { [gBob["@id"]]: gBob } });
rec("a UCAN-attenuated delegate transfers in-scope; chain verifies to Alice", r.ok && r.owner === ref(alice));

// 5 · ESCALATION refused — wrong asset, and recipient outside the delegation's constraint
let escWrongAsset = false, escToOnly = false;
const gWrong = await grant({ to: carol, owned: owned2 }, alice);      // delegation for a DIFFERENT κ
try { await transfer({ title: t2, to: mallory }, carol, { proof: gWrong }); } catch (e) { escWrongAsset = /refused/.test(e.message); }
const gToBob = await grant({ to: carol, owned, toOnly: [ref(bob)] }, alice); // may only send to Bob
try { await transfer({ title: t2, to: mallory }, carol, { proof: gToBob }); } catch (e) { escToOnly = /refused/.test(e.message); }
rec("escalation beyond the delegation is refused (wrong asset)", escWrongAsset);
rec("escalation beyond the delegation is refused (recipient constraint)", escToOnly);

// 6 · double-transfer FORK detected, "anchor wins" resolves it
const t2a = await transfer({ title: t1, to: carol }, bob);           // Bob also tries t1 → Carol …
const t2b = await transfer({ title: t1, to: mallory }, bob);         // … and t1 → Mallory (double-spend)
const forks = detectForks([g, t1, t2a, t2b]);
rec("a double-transfer is detected as a fork (two heads share one prior)", forks.length === 1 && forks[0].heads.length === 2);
const anc = await anchor(t2a["@id"]);                                // anchor one head (mock chain commitment)
rec("'anchor wins' resolves the fork to the anchored head", resolveForkByAnchor([t2a["@id"], t2b["@id"]], { [t2a["@id"]]: anc }) === t2a["@id"]);

// 7 · settlement — value releases only against a re-derivable Title; voucher κ is idempotent
const order = { subject: t2["@id"], amount: { value: 100, currency: "NP" } };
const v1 = await settle({ order, chain: { titles: [g, t1, t2], delegations: { [gBob["@id"]]: gBob } } });
const v2 = await settle({ order, chain: { titles: [g, t1, t2], delegations: { [gBob["@id"]]: gBob } } });
rec("settlement releases a voucher to the proven owner, idempotently (ADR-048)", !!v1 && v1.payee === ref(alice) && v1["@id"] === v2["@id"]);
const broken = JSON.parse(JSON.stringify([g, t1, t2])); broken[1].owner = ref(mallory); // tamper the chain
const vBad = await settle({ order, chain: { titles: broken } });
rec("settlement on a tampered/unproven Title pays nothing", vBad === null);

// 8 · tamper anywhere is refused on verify (Law L5)
const tampered = JSON.parse(JSON.stringify(t1)); tampered.owner = ref(mallory);
r = await verifyChain([g, tampered]);
rec("a tampered Title fails chain verification (Law L5)", r.ok === false);

// 9 · real-rail wiring (the Holo Wallet seam → chain kit, mocked offline) — anchor + settle via rail
const rail = mockRail();
const anc2 = await anchor(t2["@id"], "ethereum", rail);
rec("anchor goes through the wallet rail and commits the head κ", anc2.headKappa === t2["@id"] && /sig/.test(anc2.txid));
let declined = false;
try { await anchor(t2["@id"], "ethereum", declineRail()); } catch (e) { declined = /declin/i.test(e.message); }
rec("a declining wallet refuses the anchor (default-deny — value never moves alone)", declined);
const order2 = { subject: t2["@id"], amount: { value: 50, currency: "ethereum" } };
const paid = await settleVia(OWN, { order: order2, chain: { titles: [g, t1, t2], delegations: { [gBob["@id"]]: gBob } } }, rail);
rec("settleVia releases a voucher AND a real-shaped tx on a proven Title", !!paid && paid.payee === ref(alice) && /tx/.test(paid.txid));
const brokenChain = JSON.parse(JSON.stringify([g, t1, t2])); brokenChain[2].owner = ref(mallory);
const paidBad = await settleVia(OWN, { order: order2, chain: { titles: brokenChain } }, rail);
rec("settleVia pays nothing on a tampered Title (no value leaves on bad proof)", paidBad === null);

const witnessed = failed === 0;
writeFileSync(join(here, "holo-own-witness.result.json"), JSON.stringify({
  spec: "Holo Own (ADR-053) — verifiable, self-sovereign ownership on the content-addressed substrate: a Title is a signed, content-addressed claim (owner ⊕ owned κ ⊕ prior, rights as ODRL, a W3C VC); transfer is a UCAN-attenuated, conscience-gated capability op; scarcity is anchored to an existing chain by reference (never minted, Law L4); value settles against proven title (ADR-048); community ownership is a multi-principal Title",
  authority: "W3C DID Core · Verifiable Credentials + VC Data Integrity · UCAN · ODRL 2.2 · PROV-O · JSON-LD 1.1 · UOR-ADDR (κ = H(canonical_form), BLAKE3 σ-axis) · BTC/ETH/Solana by reference · holospaces Laws L1/L2/L4/L5 + SEC-2 (attenuate-only)",
  witnessed,
  covers: ["own", "title", "self-sovereign-ownership", "transfer-capability", "attenuation", "fork-detection", "anchor-by-reference", "settlement", "law-l5", "web2-web3-ai"],
  checks, passed, failed,
}, null, 2) + "\n");

console.log(`\nholo-own-witness: ${passed} passed, ${failed} failed`);
process.exit(witnessed ? 0 : 1);
