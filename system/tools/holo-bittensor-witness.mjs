#!/usr/bin/env node
// holo-bittensor-witness.mjs — proves Holo Bittensor (ADR-0071): the live decentralized intelligence
// market (Bittensor / Subtensor) is projected into the substrate's agent fabric as SELF-VERIFYING UOR
// objects, NOT a parallel runtime. Against the laws and the NANDA AgentFacts schema, it witnesses:
//   · the metagraph snapshot is a κ-rooted dcat:Catalog whose root re-derives + PINS the block hash;
//   · every neuron is a dual-trust AgentFacts (valid NANDA record · self-verifying UOR object · W3C VC);
//   · tampering ANY byte breaks BOTH the content address AND the hotkey signature (Law L5, dual trust);
//   · each neuron is a chain principal (did:pkh) in the one κ graph (composes the Chain Abstraction Layer);
//   · Yuma stake → a re-derivable AgentTrust attestation whose auditTrail IS the snapshot κ (un-gameable);
//   · κ ⇆ IPFS CIDv1 equivalence (the os-peers law) · the build is deterministic · mints nothing.
//
// Imports the SAME engine the OS ships (holo-bittensor.mjs) over the SAME holo-object envelope, so the
// re-derivation logic under test is exactly the shipped logic. Emits
// tools/holo-bittensor-witness.result.json = { witnessed, checks, failed, covers, authority } and exits 0/1.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const LIB = new URL("../os/usr/lib/holo/", import.meta.url);
const { project, buildAgentFacts, verifyProof, attest, buildRecord, neuronDid, sampleSubnet, kappaToCidV1, cidV1ToKappa, queryNeuron, verifyInferenceReceipt, buildWorkReceipt, settle, verifySettlement, BT } = await import(new URL("holo-bittensor.mjs", LIB));
const { verify, verifyDualAxis, verifyDeep, address, jcs } = await import(new URL("holo-object.mjs", LIB));

const checks = {}, failed = [];
const ok = (name, cond, detail) => { checks[name] = !!cond; if (!cond) failed.push(name + (detail ? ` — ${detail}` : "")); return !!cond; };
const hexOf = (did) => String(did).split(":").pop();

try {
  const snap = sampleSubnet();
  const p = project(snap);

  // 1 · the snapshot catalogue is a κ-rooted UOR object that re-derives (Law L1/L5)
  ok("snapshot-catalog-rederives", verify(p.catalog), "catalog.id != address(catalog)");

  // 2 · the catalogue PINS the block hash — mutate it and the root no longer re-derives (commits to chain state)
  const movedHash = { ...p.catalog, "bt:blockHash": "0x" + "0".repeat(64) };
  ok("snapshot-pins-blockhash", p.catalog["bt:blockHash"] === snap.blockHash && address(movedHash) !== p.catalog.id, "block hash not committed");

  // 3 · the whole catalogue verifies top-to-bottom as a Merkle-DAG (every neuron facts + attestation)
  const deep = verifyDeep(p.store, p.catalog);
  ok("snapshot-merkle-verifies", deep.ok, deep.why ? `${deep.why} @ ${deep.at}` : "");

  // 4 · tamper a neuron's facts in the store → verifyDeep refuses and points at the break
  const victim = hexOf(p.neurons[0].facts.id);
  const good = p.store.get(victim);
  const bad = JSON.parse(good.toString("utf8")); bad.label = "Hijacked validator"; p.store.set(victim, Buffer.from(jcs(bad), "utf8"));
  const tampered = verifyDeep(p.store, p.catalog);
  ok("snapshot-tamper-refused", tampered.ok === false, "tamper not detected");
  p.store.set(victim, good);                                       // restore for the remaining checks

  // 5 · every neuron's AgentFacts self-verifies (id = did:holo over its own content INCLUDING the proof)
  ok("agentfacts-self-verify", p.neurons.every((x) => verify(x.facts)), "an AgentFacts did not re-derive");

  // 6 · every AgentFacts is a valid NANDA record — the nine required fields, right shapes
  const required = ["agent_name", "label", "description", "version", "provider", "endpoints", "capabilities", "skills", "@type"];
  const schemaValid = p.neurons.every(({ facts }) =>
    required.every((k) => k in facts) && /^@DID:bittensor:/.test(facts.agent_name) &&
    facts["@type"].includes("af:AgentFacts") && Array.isArray(facts.skills) && facts.skills.length > 0 &&
    facts.endpoints.adaptive_resolver.policies.includes("law-l5-reverify"));
  ok("agentfacts-nanda-schema-valid", schemaValid, "a required AgentFacts field is missing or malformed");

  // 7 · dual trust — the hotkey's W3C VC proof verifies on every neuron (works for a vanilla NANDA resolver TODAY)
  ok("agentfacts-dual-trust-proof", p.neurons.every((x) => verifyProof(x.facts)), "a hotkey proof failed to verify");

  // 8 · one mutated byte breaks BOTH the content address AND the signature (the two trust models are one bytes)
  const f = p.neurons[1].facts;
  const forged = JSON.parse(JSON.stringify(f)); forged.label = "Spoofed miner";
  ok("agentfacts-tamper-breaks-both", verify(forged) === false && verifyProof(forged) === false, "tamper survived one of the two trust models");

  // 9 · every neuron IS a chain principal in the one κ graph — did:pkh over its hotkey (composes holo-chain.mjs)
  const principalOk = p.neurons.every(({ neuron, facts }) => {
    const did = neuronDid(neuron.hotkey);
    return did.startsWith(`did:pkh:${BT.caipNamespace}:`) && did.endsWith(neuron.hotkey) && facts.provider.did === did;
  });
  ok("neuron-is-chain-principal", principalOk, "a neuron's did:pkh principal is wrong");

  // 10 · stake is reputation — each attestation re-derives, and its auditTrail IS the snapshot's authority (un-gameable)
  const attOk = p.neurons.every(({ neuron, attestation }) =>
    verify(attestation) && attestation["af:evaluations"].auditTrail === attestation["prov:wasDerivedFrom"] &&
    attestation["af:evaluations"].auditorID === `yuma-consensus@subnet-${neuron.netuid}`);
  ok("stake-attestation-rederives", attOk, "an attestation did not re-derive or has a self-reported rating");

  // 11 · the attestation's rating IS the on-chain Yuma consensus weight (capital-backed, not asserted)
  ok("attestation-binds-consensus", p.neurons.every(({ neuron, attestation }) => attestation["schema:ratingValue"] === neuron.consensus), "rating != on-chain consensus");

  // 12 · κ ⇆ IPFS CIDv1 round-trips (a sha-256 κ IS a CIDv1 — the os-peers law); the NANDA record uses it
  const kappa = `sha256:${hexOf(p.neurons[0].facts.id)}`;
  ok("kappa-cidv1-equiv", cidV1ToKappa(kappaToCidV1(kappa)) === kappa, "κ ⇆ CIDv1 did not round-trip");
  const rec = p.neurons[0].record;
  ok("nanda-record-shape", rec.agent_id === p.neurons[0].facts.id && rec.primary_facts_url.startsWith("holo://") && rec.private_facts_url.startsWith("ipfs://b") && rec.ttl > 0, "lean index record malformed");

  // 13 · the projection is deterministic — build twice → identical catalogue root + identical bytes (build-twice-equal)
  const p2 = project(sampleSubnet());
  ok("determinism-build-twice-equal", p2.catalog.id === p.catalog.id && jcs(p2.catalog) === jcs(p.catalog), "non-deterministic projection");

  // 14 · mint nothing (ADR-024) — every @context term resolves to a published vocabulary (schema.org / PROV-O /
  //      DCAT / DCMI / NANDA af: / W3C), the ONLY hologram.os namespace being the published bt: ontology.
  const allowed = ["https://schema.org/", "http://purl.org/dc/terms/", "http://www.w3.org/ns/prov#", "http://www.w3.org/ns/dcat#", "https://agentfacts.org/schema/v1#", BT.btNs];
  const ctxValues = (o) => Object.values(o["@context"] || {}).filter((v) => typeof v === "string" && /^https?:\/\//.test(v));
  const mintOk = [p.catalog, ...p.neurons.flatMap((x) => [x.facts, x.attestation])].every((o) =>
    ctxValues(o).every((v) => allowed.includes(v) || v.startsWith("https://schema.org/")));
  ok("mint-nothing", mintOk, "an unrecognized (minted) vocabulary IRI appeared in an @context");

  // ── inference is a re-derivable receipt behind the brain seam (Holo Q idiom, ADR-0052) ──────────────
  const validator = p.neurons[0].neuron;
  const ir = queryNeuron(validator, "What is the capital of France?", { decode: "greedy-argmax" }, { snapshotDid: p.catalog.id, block: snap.block, blockHash: snap.blockHash });

  // 15 · the inference receipt verifies three ways — id re-derives + hotkey signature + response κ binds (Law L5)
  ok("inference-receipt-verifies", verifyInferenceReceipt(ir) && ir["prov:generated"]["schema:text"] === "Paris.", "receipt did not verify");

  // 16 · it BINDS the Bittensor provenance — the neuron, subnet, block and snapshot κ the answer came from
  const used = ir["prov:used"];
  ok("inference-receipt-binds-provenance", used["bt:neuron"] === neuronDid(validator.hotkey) && used["bt:netuid"] === snap.netuid && used["bt:block"] === snap.block && used["bt:snapshot"] === p.catalog.id && ir["prov:wasAttributedTo"] === neuronDid(validator.hotkey), "provenance not bound");

  // 17 · deterministic — the same (neuron ⊕ prompt ⊕ params) seals to the same receipt κ (greedy/fixture, replayable)
  const ir2 = queryNeuron(validator, "What is the capital of France?", { decode: "greedy-argmax" }, { snapshotDid: p.catalog.id, block: snap.block, blockHash: snap.blockHash });
  ok("inference-receipt-deterministic", ir2.id === ir.id, "non-deterministic receipt");

  // 18 · tamper the answer → ALL THREE break (the id no longer re-derives, the signature fails, the response κ mismatches)
  const forgedR = JSON.parse(JSON.stringify(ir)); forgedR["prov:generated"]["schema:text"] = "London.";
  ok("inference-receipt-tamper-refused", verifyInferenceReceipt(forgedR) === false, "a forged answer still verified");

  // ── Holo Orchestrate (ADR-045) + Holo Settle (ADR-048): pay TAO ONLY against proven work ────────────
  const wstore = new Map();
  const steps = [
    queryNeuron(p.neurons[0].neuron, "What is the capital of France?", { decode: "greedy-argmax" }, { snapshotDid: p.catalog.id, block: snap.block, blockHash: snap.blockHash }),
    queryNeuron(p.neurons[1].neuron, "And of Japan?", { decode: "greedy-argmax" }, { snapshotDid: p.catalog.id, block: snap.block, blockHash: snap.blockHash }),
  ];
  const { receipt: work } = buildWorkReceipt({ receipts: steps, store: wstore });

  // 19 · the work receipt is a PROV-O DAG that re-derives + every member inference step re-derives (Merkle, Law L5)
  ok("work-receipt-merkle", verify(work) && verifyDeep(wstore, work).ok && work["bt:stepCount"] === 2, "work receipt did not verify");

  // 20 · settlement pays EVERY proven step — each voucher re-derives, is payer-signed, binds the work κ + TAO + testnet
  const s1 = settle({ workReceipt: work, store: wstore, taoPerStep: 0.5 });
  ok("settlement-pays-proven", s1.released.length === 2 && s1.withheld.length === 0 && s1.released.every((v) => verifySettlement(v, wstore) && v["bt:workReceipt"] === work.id && v["bt:network"] === "testnet" && v["schema:priceCurrency"] === "TAO"), "not every proven step paid");

  // 21 · the voucher binds the amount + the right payee (the neuron that did the work)
  ok("settlement-amount-payee-binds", s1.released.every((v, i) => v["schema:price"] === 0.5 && v["bt:payee"] === steps[i]["prov:wasAttributedTo"]), "amount/payee mismatch");

  // 22 · a tampered voucher (amount inflated) is refused — the payer signature + content address both break
  const fv = JSON.parse(JSON.stringify(s1.released[0])); fv["schema:price"] = 999;
  ok("settlement-voucher-tamper-refused", verifySettlement(fv, wstore) === false, "tampered voucher still verified");

  // 23 · the conscience gate (ADR-033) withholds a step PER-STEP — reject the "Tokyo." answer, the other still pays
  const s2 = settle({ workReceipt: work, store: wstore, taoPerStep: 0.5, conscience: (step) => step["prov:generated"]["schema:text"] !== "Tokyo." });
  ok("settlement-conscience-withholds", s2.released.length === 1 && s2.withheld.length === 1 && s2.released[0]["prov:wasDerivedFrom"] === steps[0].id, "conscience gate did not withhold exactly one step");

  // 24 · TAMPERED WORK PAYS NOTHING — corrupt a step's answer in the store → the DAG fails to re-derive → zero released
  const wstore2 = new Map();
  const steps2 = [
    queryNeuron(p.neurons[0].neuron, "What is the capital of France?", { decode: "greedy-argmax" }, { snapshotDid: p.catalog.id, block: snap.block, blockHash: snap.blockHash }),
    queryNeuron(p.neurons[1].neuron, "And of Japan?", { decode: "greedy-argmax" }, { snapshotDid: p.catalog.id, block: snap.block, blockHash: snap.blockHash }),
  ];
  const { receipt: work2 } = buildWorkReceipt({ receipts: steps2, store: wstore2 });
  const vkey = steps2[0].id.split(":").pop();
  const corrupt = JSON.parse(wstore2.get(vkey).toString("utf8")); corrupt["prov:generated"]["schema:text"] = "London.";
  wstore2.set(vkey, Buffer.from(jcs(corrupt), "utf8"));
  const s3 = settle({ workReceipt: work2, store: wstore2, taoPerStep: 0.5 });
  ok("settlement-tampered-work-pays-nothing", s3.released.length === 0, "tampered work still released a voucher");

  // 25 · TESTNET-GATED — settling on mainnet throws without explicit authorization (TAO is real money)
  let mainnetRefused = false;
  try { settle({ workReceipt: work, store: wstore, network: "mainnet" }); } catch { mainnetRefused = true; }
  ok("settlement-testnet-gated", mainnetRefused, "mainnet settlement was not refused");

  // 26 · SUBSTRATE-ANCHORED — EVERY Holo Bittensor object is DUAL-AXIS: alongside its did:holo:sha256 id it
  //      carries a did:holo:blake3 σ-axis alias (BLAKE3 over the SAME canonical bytes ≡ hologram's kappa()),
  //      so every object — snapshot catalogue, AgentFacts, attestation, inference receipt, work receipt,
  //      settlement voucher — resolves on the SHARED UOR substrate, not just the OS serving axis, and
  //      re-derives on BOTH (the OS-wide #substrate-anchored / #dual-axis law, ADR-026).
  const allObjs = [p.catalog, ...p.neurons.flatMap((x) => [x.facts, x.attestation]), ir, work, ...s1.released];
  ok("substrate-anchored-dual-axis", allObjs.length >= 8 && allObjs.every((o) => verifyDualAxis(o) && (o.alsoKnownAs || []).some((a) => /^did:holo:blake3:[0-9a-f]{64}$/.test(a))), "a Holo Bittensor object is not dual-axis anchored on the UOR substrate");

} catch (e) {
  ok("witness-ran", false, String((e && e.stack) || e));
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult", witnessed, checks, failed,
  covers: [
    "The Bittensor metagraph at a block is a κ-rooted dcat:Catalog that re-derives + pins the block hash (Law L5)",
    "A subnet IS a NANDA registry: each neuron projects to a valid AgentFacts record on the same bytes",
    "Dual trust — each AgentFacts is a self-verifying UOR object AND a W3C VC signed by the neuron's hotkey",
    "Tampering any byte breaks BOTH the content address and the hotkey signature (they are one bytes)",
    "Each neuron is a did:pkh chain principal in the one κ graph (composes the Chain Abstraction Layer)",
    "Yuma stake/consensus → a re-derivable AgentTrust attestation whose auditTrail is the snapshot κ (un-gameable)",
    "Querying a miner seals a re-derivable PROV-O inference receipt (Holo Q idiom) bound to the neuron/subnet/block — a stochastic answer is receipt-verifiable, tamper refused (the receipt binds, not the inference)",
    "Inference receipts compose into a PROV-O work receipt (Orchestrate, ADR-045); settlement pays TAO per step ONLY against proven work (Settle, ADR-048) — tampered work pays nothing, the conscience gate withholds per-step, every voucher re-derives + is payer-signed, and mainnet is refused (testnet-gated)",
    "EVERY Holo Bittensor object is DUAL-AXIS anchored on the shared UOR substrate — alongside its did:holo:sha256 id it carries a did:holo:blake3 σ-axis alias (BLAKE3 ≡ hologram's kappa()), re-deriving on both (the #substrate-anchored / #dual-axis law)",
    "κ ⇆ IPFS CIDv1 equivalence (os-peers law) · the projection is deterministic · mints nothing",
  ],
  authority: "Bittensor SDK (bt-api-ref) · Subtensor / Yuma consensus · ss58 · Project NANDA AgentFacts (arXiv:2507.14263) · W3C DID Core + VC Data Integrity (eddsa-jcs-2022) + PROV-O + DCAT + schema.org · IETF RFC 8785 (JCS) · IPLD/multiformats CIDv1 · verify-by-re-derivation (Law L1/L2/L4/L5)",
};
writeFileSync(join(here, "holo-bittensor-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log(`holo-bittensor-witness — ${witnessed ? "WITNESSED ✓" : "NOT witnessed ✗"}`);
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"} ${k}`);
if (failed.length) console.log("  failed:\n   - " + failed.join("\n   - "));
process.exit(witnessed ? 0 : 1);
