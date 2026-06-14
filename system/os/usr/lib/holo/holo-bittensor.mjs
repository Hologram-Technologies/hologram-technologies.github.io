#!/usr/bin/env node
// holo-bittensor.mjs — Holo Bittensor (ADR-0071): project the live decentralized intelligence
// market (Bittensor / Subtensor) INTO the κ content-addressable substrate's agent fabric, WITHOUT
// giving up the laws. This is NOT a bridge to a foreign runtime (which would break L1/L4/L5) — it is
// a deterministic PROJECTION, exactly like Holo NANDA (ADR-034), and BETTER than a bridge because
// every artifact is a self-verifying UOR object that re-derives (Law L5).
//
// The key structural fact: a Bittensor SUBNET is already a NANDA registry. `hotkey → neuron → axon
// endpoint → subnet task` IS NANDA's `AgentName → record → AgentFacts → endpoint → capability`. So:
//   • snapshotSubnet / project — the metagraph at block B → a κ-rooted dcat:Catalog of neuron
//     AgentFacts whose root did:holo COMMITS to the whole subnet's state (the block hash is pinned,
//     so the snapshot re-derives against the chain — Bittensor's own Merkle chain is the bridge).
//   • buildAgentFacts — ONE neuron → ONE document that is, on the same bytes, a valid NANDA
//     AgentFacts record, a self-verifying UOR object (id = did:holo over its content INCLUDING the
//     proof), and a W3C VC (a DataIntegrityProof signed by the neuron's hotkey). Dual trust.
//   • neuronDid — composes the Chain Abstraction Layer (holo-chain.mjs): a hotkey ss58 is a
//     CAIP-10 account → a did:pkh principal, so every neuron joins the ONE κ object graph natively.
//   • attest — the neuron's Yuma stake/consensus/incentive at block B → an AgentTrust attestation
//     (ADR-039): a Sybil-resistant, capital-backed reputation signal the substrate cannot mint.
//
// HONEST SCOPE. (1) The `bt` Python SDK is NOT run here — the chain read is an INGEST BOUNDARY
// (Subtensor's public, decentralized JSON-RPC, never a server we run), exactly like Holo Resolve
// fetching the open web; everything crossing in is canonicalized + κ'd at once (L2/L4). This module
// ships the snapshot-and-seal path; `sampleSubnet()` is a deterministic fixture standing in for that
// RPC read so the witness is offline + byte-stable. (2) A stochastic LLM output is NOT re-derivable —
// L5 binds the RECEIPT, not the inference (Holo Q, ADR-0052). (3) The dual-trust signature is modelled
// here with deterministic Ed25519 (node:crypto) so the projection is reproducible; in production the
// proof IS the neuron's real on-chain sr25519 hotkey signature, verified against the metagraph.
// Mint nothing (ADR-024): NANDA's af:, schema.org, PROV-O, DCAT, W3C DID/VC — plus a small PUBLISHED
// bt: namespace (ns/bittensor.jsonld) only where a Bittensor term has no standard equivalent.
// Pure Node, zero dependencies (node:crypto/fs), built ON holo-object + holo-uor + holo-chain.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { createPrivateKey, createPublicKey, sign as nodeSign, verify as nodeVerify } from "node:crypto";
import { address, sealDual, verify, verifyDualAxis, verifyDeep, linkTo, putDual, resolve, jcs } from "./holo-object.mjs";
import { sha256hex } from "./holo-uor.mjs";
import { didPkh } from "./holo-chain.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const hexOf = (did) => String(did).split(":").pop();

// ── constants — the projection is DETERMINISTIC (reproducible builds + the witness's build-twice
//    check). `created` is a fixed build epoch (never Date.now); the chain coordinates (netuid, block,
//    blockHash) come from the snapshot itself. ──────────────────────────────────────────────────────
export const BT = Object.freeze({
  base: "https://hologram.os",
  namespace: "bittensor",                                         // NANDA @DID:bittensor:<handle>
  btNs: "https://hologram.os/ns/bittensor#",                      // the small published bt: vocabulary
  schemaId: "https://agentfacts.org/schema/v1",                   // NANDA AgentFacts $id (reused, not minted)
  factsAuthority: "https://github.com/projnanda/agentfacts-format",
  apiAuthority: "https://docs.learnbittensor.org/sdk/bt-api-ref",
  // Subtensor is a Substrate chain → CAIP-2 namespace "polkadot", reference = genesis-hash prefix
  // (CAIP-13 / chainAgnostic). The prefix below is a stable fixture id for the projection; in
  // production it is read from the chain's genesis hash at the ingest boundary.
  caipNamespace: "polkadot",
  subtensorGenesis: "2f0555cc76fc2840",                           // CAIP-2 reference (genesis-hash prefix)
  created: "2026-06-12T00:00:00Z",                                // fixed build epoch → deterministic proofs
  ttl: 86400,                                                     // record TTL (s); facts are immutable by κ
});

// ── CAIP identity: a hotkey ss58 IS a chain principal in the one κ graph (composes holo-chain.mjs).
export const caip2 = () => `${BT.caipNamespace}:${BT.subtensorGenesis}`;
export const caip10 = (ss58) => `${caip2()}:${ss58}`;
export const neuronDid = (ss58) => didPkh(caip10(ss58));          // did:pkh:polkadot:<genesis>:<ss58>
export const nandaName = (handle) => `@DID:${BT.namespace}:${handle}`;
const handleOf = (ss58) => String(ss58).replace(/[^A-Za-z0-9]/g, "").slice(0, 10).toLowerCase() || "neuron";

// ── deterministic Ed25519 (models the neuron hotkey; production verifies the real sr25519). A raw
//    32-byte seed is wrapped into a PKCS8 DER (the fixed Ed25519 prefix), so the SAME hotkey always
//    yields the SAME key — the projection re-derives byte-for-byte. ─────────────────────────────────
const ED_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const ED_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
function keyFromSeed(seed32) {
  const priv = createPrivateKey({ key: Buffer.concat([ED_PKCS8_PREFIX, seed32]), format: "der", type: "pkcs8" });
  const spki = createPublicKey(priv).export({ format: "der", type: "spki" });
  const pub = spki.subarray(spki.length - 32);                    // raw 32-byte Ed25519 public key
  return {
    pubHex: pub.toString("hex"),
    did: "did:key:ed25519:" + pub.toString("hex"),                // the proof's verificationMethod
    sign: (msg) => nodeSign(null, Buffer.from(msg, "utf8"), priv).toString("base64"),
  };
}
// the hotkey of a neuron: seeded by its ss58 so the fixture is reproducible (in prod the miner holds it).
const hotkeyOf = (ss58) => keyFromSeed(Buffer.from(sha256hex(Buffer.from("bt-hotkey:" + ss58, "utf8")), "hex"));
export function verifyProofValue(pubHex, msg, b64) {
  try {
    const key = createPublicKey({ key: Buffer.concat([ED_SPKI_PREFIX, Buffer.from(pubHex, "hex")]), format: "der", type: "spki" });
    return nodeVerify(null, Buffer.from(msg, "utf8"), key, Buffer.from(b64, "base64"));
  } catch { return false; }
}

// ── κ ⇆ IPFS CIDv1 (raw, sha2-256): a sha-256 κ IS a CIDv1 (the os-peers law). So an AgentFacts
//    object's content address doubles as its IPFS address — NANDA's private_facts_url is just
//    ipfs://<cid> over the SAME κ, anonymous, no agent host. ────────────────────────────────────────
const B32 = "abcdefghijklmnopqrstuvwxyz234567";
function base32(bytes) { let bits = 0, val = 0, out = ""; for (const b of bytes) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += B32[(val << (5 - bits)) & 31]; return out; }
function base32decode(str) { let bits = 0, val = 0; const out = []; for (const ch of str) { const i = B32.indexOf(ch); if (i < 0) throw new Error("bad base32"); val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; } } return Buffer.from(out); }
export function kappaToCidV1(kappa) { const d = Buffer.from(hexOf(kappa), "hex"); if (d.length !== 32) throw new Error("κ must be sha-256 (32 bytes)"); return "b" + base32(Buffer.concat([Buffer.from([0x01, 0x55, 0x12, 0x20]), d])); }
export function cidV1ToKappa(cid) { if (cid[0] !== "b") throw new Error("expect base32 multibase 'b'"); const b = base32decode(cid.slice(1)); if (b[0] !== 0x01 || b[1] !== 0x55 || b[2] !== 0x12 || b[3] !== 0x20) throw new Error("not a cidv1 raw sha2-256"); return "sha256:" + b.subarray(4).toString("hex"); }

// JSON-LD context for an AgentFacts-over-a-neuron: NANDA fields mapped to schema.org where a term
// exists, NANDA's own af: for the rest, and the small bt: vocabulary for Bittensor-native terms.
export const BT_AGENTFACTS_CONTEXT = Object.freeze({
  schema: "https://schema.org/", dcterms: "http://purl.org/dc/terms/", prov: "http://www.w3.org/ns/prov#",
  af: "https://agentfacts.org/schema/v1#", bt: BT.btNs,
  label: "schema:name", description: "schema:description", version: "schema:version", provider: "schema:provider",
  documentationUrl: "schema:documentation", jurisdiction: "schema:spatialCoverage",
  agent_name: "af:agent_name", endpoints: "af:endpoints", capabilities: "af:capabilities",
  skills: "af:skills", evaluations: "af:evaluations", certification: "af:certification",
});

// ── one neuron, three identities (mirrors ADR-034's buildAgentFacts exactly) ────────────────────────
// Sign the facts (no id, no proof) with the neuron's hotkey → attach the proof → address over
// {facts+proof} → stamp id. verify() re-derives id over {facts+proof}; verifyProof() strips id+proof
// and checks the hotkey signature over {facts}. Both hold on the final object. The axon endpoint is a
// TRANSPORT hint inside `endpoints.static`, NEVER the identity (Law L1 — identity is the hotkey/κ).
export function buildAgentFacts(neuron, { snapshotDid = null, created = BT.created } = {}) {
  const hk = hotkeyOf(neuron.hotkey);
  const facts = {
    "@context": BT_AGENTFACTS_CONTEXT,
    "@type": ["schema:SoftwareApplication", "af:AgentFacts", "bt:Neuron"],
    agent_name: nandaName(handleOf(neuron.hotkey)),
    label: neuron.label || `Bittensor neuron ${neuron.uid} · subnet ${neuron.netuid}`,
    description: neuron.task || `A ${neuron.role || "miner"} on Bittensor subnet ${neuron.netuid}.`,
    version: "1.0",
    documentationUrl: BT.apiAuthority,
    jurisdiction: "decentralized",
    provider: { name: `Bittensor subnet ${neuron.netuid}`, url: BT.base, did: neuronDid(neuron.hotkey) },
    endpoints: {
      static: [neuron.axon ? `bittensor+tcp://${neuron.axon}` : "bittensor+dendrite://", `${BT.base}/mcp`],
      adaptive_resolver: { url: `${BT.base}/.holo/`, policies: ["content-address", "law-l5-reverify"] },
    },
    capabilities: {
      modalities: neuron.modalities || ["text", "application/ld+json"],
      streaming: false, batch: true,
      authentication: { methods: ["none"], requiredScopes: [] },
    },
    skills: [{
      id: `subnet-${neuron.netuid}`, description: neuron.task || `subnet ${neuron.netuid} task`,
      inputModes: ["application/json"], outputModes: ["application/ld+json"], supportedLanguages: ["en"],
    }],
    // Bittensor-native facts (the bt: vocabulary): identity + the live Yuma economy at the snapshot block.
    "bt:netuid": neuron.netuid, "bt:uid": neuron.uid,
    "bt:hotkey": neuron.hotkey, "bt:coldkey": neuron.coldkey || null,
    "bt:axon": neuron.axon || null, "bt:role": neuron.role || "miner",
    "bt:stake": neuron.stake, "bt:rank": neuron.rank, "bt:trust": neuron.trust,
    "bt:consensus": neuron.consensus, "bt:incentive": neuron.incentive,
    "bt:dividends": neuron.dividends, "bt:emission": neuron.emission,
    ...(snapshotDid ? { "schema:isBasedOn": snapshotDid } : {}),
  };
  const proofless = jcs(facts);
  const proof = {
    type: "DataIntegrityProof", cryptosuite: "eddsa-jcs-2022", created,
    verificationMethod: neuronDid(neuron.hotkey), proofPurpose: "assertionMethod",
    // the hotkey signs the canonical facts; in production this IS the on-chain sr25519 signature.
    proofValue: hk.sign(proofless), publicKeyHex: hk.pubHex,
  };
  return sealDual({ ...facts, proof });                           // dual-axis: did:holo:sha256 id ⊕ did:holo:blake3 substrate σ-axis alias
}
// dual trust: strip id+proof, re-canonicalize the facts, verify the hotkey signature over them.
export function verifyProof(factsObj) {
  if (!factsObj || !factsObj.proof) return false;
  const { id, alsoKnownAs, proof, ...facts } = factsObj;          // strip the σ-axis alias too — the proof signs the bare facts
  return verifyProofValue(proof.publicKeyHex, jcs(facts), proof.proofValue);
}

// ── the NANDA lean Index record (≤120-byte core: agent_name + agent_id + facts pointer + ttl) ───────
export function buildRecord(factsObj, neuron, { ttl = BT.ttl } = {}) {
  const kappa = `sha256:${hexOf(factsObj.id)}`;
  return {
    agent_name: nandaName(handleOf(neuron.hotkey)),
    agent_id: factsObj.id,                                        // = the facts content address (one id)
    primary_facts_url: `holo://${hexOf(factsObj.id)}`,           // content-addressed self-resolution
    private_facts_url: `ipfs://${kappaToCidV1(kappa)}`,          // same κ, anonymous (IPFS), no agent host
    ttl,
  };
}

// ── stake is reputation: the neuron's Yuma weights at block B → an AgentTrust attestation (ADR-039) ──
// Un-gameable + capital-backed: the auditTrail IS the snapshot κ (re-derivable), the auditor is the
// Yuma consensus of the subnet itself, and the rating is the on-chain consensus weight.
export function attest(neuron, { snapshotDid, block, blockHash, created = BT.created }) {
  return sealDual({
    "@context": { schema: "https://schema.org/", prov: "http://www.w3.org/ns/prov#", af: "https://agentfacts.org/schema/v1#", bt: BT.btNs },
    "@type": ["prov:Entity", "schema:Rating", "bt:Attestation"],
    "schema:about": neuronDid(neuron.hotkey),
    "schema:ratingValue": neuron.consensus, "schema:bestRating": 1, "schema:worstRating": 0,
    "prov:wasDerivedFrom": snapshotDid,
    "bt:netuid": neuron.netuid, "bt:block": block, "bt:blockHash": blockHash,
    "bt:stake": neuron.stake, "bt:trust": neuron.trust, "bt:incentive": neuron.incentive, "bt:dividends": neuron.dividends,
    "af:evaluations": {
      performanceScore: neuron.consensus, availability90d: neuron.trust, lastAudited: created,
      auditTrail: snapshotDid,                                    // the re-derivable proof, not a self-reported number
      auditorID: `yuma-consensus@subnet-${neuron.netuid}`,
    },
  });
}

// ── inference is a re-derivable receipt behind the brain seam (Holo Q, ADR-0052) ───────────────────
// Querying a miner is the INGEST BOUNDARY: in production a dendrite call to the neuron's axon over the
// Synapse protocol; here `sampleResponse` is a deterministic fixture so the witness is offline + stable.
// The (prompt, params, neuron hotkey, subnet, block, response) tuple seals to a PROV-O inference receipt
// — the SAME idiom as Holo Q's, bound to the Bittensor provenance. HONEST: a stochastic LLM output is NOT
// re-derivable; L5 binds the RECEIPT (what was asked, what returned, by whom, at which block), and the
// neuron's signature over the response (the chain's real sr25519 in production) — not reproduction.
const kappaOf = (s) => `sha256:${sha256hex(Buffer.from(String(s), "utf8"))}`;

export function sealInferenceReceipt({ neuron, snapshotDid = null, block, blockHash, prompt, params = {}, response, created = BT.created }) {
  const hk = hotkeyOf(neuron.hotkey);
  const body = {
    "@context": { schema: "https://schema.org/", dcterms: "http://purl.org/dc/terms/", prov: "http://www.w3.org/ns/prov#", af: "https://agentfacts.org/schema/v1#", bt: BT.btNs },
    "@type": ["prov:Activity", "bt:Inference"],
    "dcterms:created": created,
    "prov:wasAttributedTo": neuronDid(neuron.hotkey),
    "prov:used": {
      "bt:neuron": neuronDid(neuron.hotkey), "bt:hotkey": neuron.hotkey,
      "bt:netuid": neuron.netuid, "bt:block": block, "bt:blockHash": blockHash,
      ...(snapshotDid ? { "bt:snapshot": snapshotDid } : {}),
      "bt:promptKappa": kappaOf(prompt), "bt:params": params,
    },
    "prov:generated": { "bt:responseKappa": kappaOf(response), "schema:text": response },
  };
  const proof = {
    type: "DataIntegrityProof", cryptosuite: "eddsa-jcs-2022", created,
    verificationMethod: neuronDid(neuron.hotkey), proofPurpose: "assertionMethod",
    proofValue: hk.sign(jcs(body)), publicKeyHex: hk.pubHex,        // the neuron signs the activity (chain sr25519 in prod)
  };
  return sealDual({ ...body, proof });                              // dual-axis: sha256 id ⊕ blake3 substrate σ-axis alias
}

// verify an inference receipt three ways: (1) integrity — the id re-derives over {body+proof} (Law L5);
// (2) provenance — the neuron's hotkey signature verifies over the canonical activity; (3) binding — the
// recorded responseKappa actually IS the hash of the recorded answer text. Any tampered byte breaks all three.
export function verifyInferenceReceipt(r) {
  if (!r || !r.proof || !verify(r)) return false;
  const { id, alsoKnownAs, proof, ...body } = r;
  if (!verifyProofValue(proof.publicKeyHex, jcs(body), proof.proofValue)) return false;
  const gen = body["prov:generated"] || {};
  return gen["bt:responseKappa"] === kappaOf(gen["schema:text"]);
}

// queryNeuron(neuron, prompt, params, ctx) → ask a miner and seal the receipt. The response crosses the
// ingest boundary (dendrite→axon in production; the deterministic fixture here), then becomes a UOR object.
export function queryNeuron(neuron, prompt, params = {}, { snapshotDid = null, block = null, blockHash = null } = {}) {
  const response = sampleResponse(neuron, prompt);                  // ingest boundary (fixture; prod = Synapse call)
  return sealInferenceReceipt({ neuron, snapshotDid, block: block ?? neuron.block ?? 0, blockHash, prompt, params, response });
}

// a deterministic stand-in "miner": a fixed answer keyed by (subnet task, prompt) so the witness re-runs
// byte-stable. In production this is the neuron's real, signed response over the Bittensor Synapse protocol.
export function sampleResponse(neuron, prompt) {
  const canned = { "What is the capital of France?": "Paris.", "And of Japan?": "Tokyo." };
  return canned[prompt] || `Response from subnet ${neuron.netuid} neuron ${neuron.uid} to: ${prompt}`;
}

// ── Holo Orchestrate (ADR-045) + Holo Settle (ADR-048): pay TAO ONLY against PROVEN work ─────────────
// A WORK RECEIPT is a PROV-O collaboration DAG whose members are the inference receipts (the proven
// steps); its κ proves the whole multi-agent job. SETTLEMENT releases a TAO voucher per step ONLY IF the
// work receipt re-derives AND that step's inference receipt verifies three-ways AND the conscience gate
// accepts — tampered work pays nothing. The voucher idiom mirrors holo-own.settle (value releases only
// against a re-derivable κ). HONEST: TAO is real money — settlement is TESTNET-GATED (mainnet throws
// without explicit authorization); a voucher is a signed settlement object (the payment intent + txId),
// NOT a live mainnet transfer (production routes the release through the wallet seam, holo-chain payTo).

// a payer principal (the job's client). Deterministic Ed25519 here; production = the operator's wallet key.
export function payerFromSeed(label = "holo-bittensor-payer") {
  return keyFromSeed(Buffer.from(sha256hex(Buffer.from("bt-payer:" + label, "utf8")), "hex"));
}

export function buildWorkReceipt({ receipts, store = new Map(), client = null, created = BT.created }) {
  const links = receipts.map((r) => { putDual(store, r); return linkTo(store, "prov:hadMember", r); });
  const body = {
    "@context": { schema: "https://schema.org/", dcterms: "http://purl.org/dc/terms/", prov: "http://www.w3.org/ns/prov#", bt: BT.btNs,
      rel: "schema:additionalType", links: { "@id": "schema:hasPart", "@container": "@set" } },
    "@type": ["prov:Activity", "prov:Collection", "bt:WorkReceipt"],
    "dcterms:created": created,
    ...(client ? { "bt:client": client } : {}),
    "bt:stepCount": receipts.length,
    links,
  };
  return { receipt: putDual(store, body), store };
}

// settle: release a voucher per proven step. Returns { released:[voucher…], withheld:[{step,payee,reason}…] }.
export function settle({ workReceipt, store, payer = payerFromSeed(), taoPerStep = 1.0, conscience = () => true, network = "testnet", created = BT.created }) {
  if (network !== "testnet") throw new Error(`Holo Bittensor settlement is TESTNET-GATED (ADR-0071) — refusing network "${network}" without explicit mainnet authorization`);
  const released = [], withheld = [];
  // pay-for-proven at the DAG level: an unprovable work receipt releases NOTHING (Law L5).
  if (!verifyDeep(store, workReceipt).ok) return { released, withheld: [{ step: workReceipt.id, reason: "work receipt does not re-derive — tampered work pays nothing" }] };
  for (const link of workReceipt.links || []) {
    const step = resolve(store, link.id);                             // the inference receipt
    const payee = step && step["prov:wasAttributedTo"];               // the neuron's did:pkh
    const proven = step && verifyInferenceReceipt(step) && conscience(step) === true;
    if (!proven) { withheld.push({ step: link.id, payee, reason: "step failed re-derivation or the conscience gate" }); continue; }
    const orderBody = {
      "@context": { schema: "https://schema.org/", prov: "http://www.w3.org/ns/prov#", bt: BT.btNs },
      "@type": ["bt:Voucher", "schema:Order", "prov:Entity"],
      "bt:workReceipt": workReceipt.id, "bt:step": step.id, "bt:payee": payee,
      "schema:price": taoPerStep, "schema:priceCurrency": "TAO", "bt:network": network,
      "prov:wasDerivedFrom": step.id, "dcterms:created": created, "bt:payer": payer.did,
    };
    const payerProof = { type: "DataIntegrityProof", cryptosuite: "eddsa-jcs-2022", verificationMethod: payer.did, proofPurpose: "assertionMethod", proofValue: payer.sign(jcs(orderBody)), publicKeyHex: payer.pubHex };
    released.push(sealDual({ ...orderBody, payerProof }));            // voucher κ = txId · dual-axis substrate-anchored
  }
  return { released, withheld };
}

// verify a settlement voucher: it re-derives (Law L5), the payer signature checks out, and the step it
// pays for is itself a re-deriving inference receipt in the store (no payment without proven work).
export function verifySettlement(voucher, store) {
  if (!voucher || !voucher.payerProof || !verify(voucher)) return false;
  const { id, alsoKnownAs, payerProof, ...body } = voucher;
  if (!verifyProofValue(payerProof.publicKeyHex, jcs(body), payerProof.proofValue)) return false;
  const step = resolve(store, voucher["bt:step"]);
  return !!step && verifyInferenceReceipt(step);
}

// ── snapshotSubnet / project: the metagraph at block B → a κ-rooted dcat:Catalog of neuron AgentFacts.
// Reading the metagraph is the INGEST BOUNDARY (Subtensor RPC in production; sampleSubnet() here). The
// returned catalog's root did:holo commits to every neuron's facts AND the pinned block hash, so it
// re-derives against the chain (Law L5). Pure + deterministic.
export function project(snapshot) {
  const { netuid, block, blockHash, neurons, created = BT.created } = snapshot;
  const store = new Map();
  const built = neurons.map((n) => {
    const neuron = { ...n, netuid };
    const facts = buildAgentFacts(neuron, { created });
    putDual(store, facts);                                        // index under BOTH axes' hex (the EXACT bytes the link commits to)
    const attestation = attest(neuron, { snapshotDid: null, block, blockHash, created });
    putDual(store, attestation);
    return { neuron, facts, attestation, record: buildRecord(facts, neuron) };
  });

  // the κ-rooted catalogue: a dcat:Catalog whose links are integrity-checked Merkle edges to every
  // neuron's AgentFacts AND its stake attestation, with the chain coordinates pinned into the body.
  const links = [];
  for (const { facts, attestation } of built) {
    links.push(linkTo(store, "dcat:dataset", facts));
    links.push(linkTo(store, "bt:attestation", attestation));
  }
  const catalogBody = {
    "@context": {
      schema: "https://schema.org/", dcterms: "http://purl.org/dc/terms/", dcat: "http://www.w3.org/ns/dcat#",
      prov: "http://www.w3.org/ns/prov#", bt: BT.btNs,
      rel: "schema:additionalType", links: { "@id": "schema:hasPart", "@container": "@set" },
    },
    "@type": ["dcat:Catalog", "schema:DataCatalog", "bt:MetagraphSnapshot", "prov:Entity"],
    "dcterms:title": `Holo Bittensor — subnet ${netuid} metagraph @ block ${block} (content-addressed Internet-of-Agents catalogue)`,
    "dcterms:conformsTo": BT.schemaId,
    "dcterms:source": `subtensor json-rpc · ${BT.caipNamespace}:${BT.subtensorGenesis} · block ${block}`,
    "dcterms:created": created,
    "bt:netuid": netuid, "bt:block": block, "bt:blockHash": blockHash,
    "bt:caip": caip2(), "bt:neuronCount": neurons.length,
    links,
  };
  const catalog = putDual(store, catalogBody);
  return { store, catalog, neurons: built, records: built.map((b) => b.record) };
}

// ── a deterministic sample subnet — the fixture standing in for the Subtensor RPC ingest read, so the
//    witness is offline + byte-stable. Realistic shape: ss58 hotkeys, axon endpoints, the Yuma economy.
export function sampleSubnet() {
  return {
    netuid: 1, block: 4210000,
    blockHash: "0x" + sha256hex(Buffer.from("subtensor:netuid1:block4210000", "utf8")),
    neurons: [
      { uid: 0, hotkey: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY", coldkey: "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty", axon: "192.0.2.10:8091", role: "validator", task: "Text prompting — instruct/chat completion", modalities: ["text"], stake: 12840.5, rank: 0.93, trust: 0.98, consensus: 0.91, incentive: 0.0, dividends: 0.041, emission: 0.0 },
      { uid: 1, hotkey: "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty", coldkey: "5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy", axon: "192.0.2.11:8091", role: "miner", task: "Text prompting — instruct/chat completion", modalities: ["text"], stake: 980.2, rank: 0.71, trust: 0.88, consensus: 0.69, incentive: 0.073, dividends: 0.0, emission: 0.061 },
      { uid: 2, hotkey: "5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy", coldkey: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY", axon: "192.0.2.12:8091", role: "miner", task: "Text embeddings — semantic vectors", modalities: ["text", "application/json"], stake: 1450.0, rank: 0.64, trust: 0.82, consensus: 0.62, incentive: 0.058, dividends: 0.0, emission: 0.049 },
    ],
  };
}

export { here as OS_DIR };

// paneData(snapshot) → the full content-addressed projection a human pane renders (subnet map, a
// queried miner's inference receipt, the settlement) — every object self-verifying + dual-axis. Pure.
export function paneData(snapshot = sampleSubnet()) {
  const p = project(snapshot);
  const prompts = ["What is the capital of France?", "And of Japan?"];
  const store = new Map();
  const receipts = prompts.map((q, i) => queryNeuron({ ...snapshot.neurons[i % snapshot.neurons.length], netuid: snapshot.netuid }, q, { decode: "greedy-argmax" }, { snapshotDid: p.catalog.id, block: snapshot.block, blockHash: snapshot.blockHash }));
  const { receipt: work } = buildWorkReceipt({ receipts, store });
  const { released, withheld } = settle({ workReceipt: work, store, taoPerStep: 0.5 });
  return {
    netuid: snapshot.netuid, block: snapshot.block, blockHash: snapshot.blockHash,
    catalog: p.catalog,
    neurons: p.neurons.map((x) => ({ uid: x.neuron.uid, role: x.neuron.role, hotkey: x.neuron.hotkey, did: neuronDid(x.neuron.hotkey), task: x.neuron.task, stake: x.neuron.stake, consensus: x.neuron.consensus, trust: x.neuron.trust, incentive: x.neuron.incentive, facts: x.facts, attestation: x.attestation })),
    inferences: receipts.map((r, i) => ({ prompt: prompts[i], answer: r["prov:generated"]["schema:text"], receipt: r })),
    settlement: { workReceipt: work, released, withheld, network: "testnet" },
    authority: BT.apiAuthority,
  };
}

// ── build — write the deterministic on-disk artifacts (the projection, content-addressed) ────────────
export function build({ root = here, snapshot = sampleSubnet() } = {}) {
  const p = project(snapshot);
  const outDir = join(root, "bittensor"), agentsDir = join(outDir, "agents");
  mkdirSync(agentsDir, { recursive: true });
  const written = [];
  const writeJson = (path, obj) => { writeFileSync(path, JSON.stringify(obj, null, 2) + "\n"); written.push(path); };
  for (const { neuron, facts } of p.neurons) writeJson(join(agentsDir, `${handleOf(neuron.hotkey)}.json`), facts);
  writeJson(join(outDir, "index.jsonld"), {
    "@context": p.catalog["@context"],
    root: p.catalog.id, source: p.catalog["dcterms:source"], conformsTo: { agentFactsSchema: BT.schemaId, bittensorApi: BT.apiAuthority },
    "@graph": [p.catalog, ...p.neurons.flatMap((x) => [x.facts, x.attestation])],
    records: p.records,
  });
  return { written, root: p.catalog.id, neurons: p.neurons.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cmd = process.argv[2] || "build";
  if (cmd === "build") {
    const r = build();
    console.log(`Holo Bittensor — wrote ${r.written.length} artifact(s) · ${r.neurons} neurons · catalogue root ${r.root}`);
    for (const f of r.written) console.log(`  ${f.replace(here, "os/usr/lib/holo")}`);
  } else if (cmd === "verify") {
    const p = project(sampleSubnet());
    const ok = verifyDeep(p.store, p.catalog).ok && p.neurons.every((x) => verify(x.facts) && verifyProof(x.facts) && verify(x.attestation));
    console.log(ok ? `✓ ${p.neurons.length} neurons re-derive + hotkey proofs verify · catalogue ${p.catalog.id}` : "✗ verification FAILED");
    process.exit(ok ? 0 : 1);
  } else if (cmd === "infer") {
    const snap = sampleSubnet();
    const neuron = { ...snap.neurons[0], netuid: snap.netuid };
    const prompt = process.argv[3] || "What is the capital of France?";
    const r = queryNeuron(neuron, prompt, { decode: "greedy-argmax" }, { block: snap.block, blockHash: snap.blockHash });
    const okR = verifyInferenceReceipt(r);
    console.log(`Holo Bittensor inference receipt — ${r.id}`);
    console.log(`  neuron ${r["prov:used"]["bt:hotkey"]} · subnet ${r["prov:used"]["bt:netuid"]} · block ${r["prov:used"]["bt:block"]}`);
    console.log(`  prompt: ${prompt}\n  answer: ${r["prov:generated"]["schema:text"]}`);
    console.log(okR ? "  ✓ receipt re-derives + hotkey signature verifies + response κ binds (Law L5)" : "  ✗ receipt verification FAILED");
    process.exit(okR ? 0 : 1);
  } else if (cmd === "settle") {
    const snap = sampleSubnet();
    const prompts = ["What is the capital of France?", "And of Japan?"];
    const store = new Map();
    const receipts = prompts.map((q, i) => queryNeuron({ ...snap.neurons[i], netuid: snap.netuid }, q, { decode: "greedy-argmax" }, { block: snap.block, blockHash: snap.blockHash }));
    const { receipt: work } = buildWorkReceipt({ receipts, store });
    const { released, withheld } = settle({ workReceipt: work, store, taoPerStep: 0.5 });
    console.log(`Holo Bittensor settlement — work receipt ${work.id}`);
    console.log(`  steps ${receipts.length} · released ${released.length} · withheld ${withheld.length} · network testnet`);
    for (const v of released) console.log(`  → pay ${v["schema:price"]} ${v["schema:priceCurrency"]} to ${v["bt:payee"]}  ·  voucher ${v.id}  ·  verify ${verifySettlement(v, store)}`);
    const okS = released.length === receipts.length && released.every((v) => verifySettlement(v, store));
    console.log(okS ? "  ✓ every proven step paid · each voucher re-derives + payer-signed (pay-for-proven, Law L5)" : "  ✗ settlement FAILED");
    process.exit(okS ? 0 : 1);
  } else { console.error(`holo-bittensor: unknown verb "${cmd}" (build | verify | infer | settle)`); process.exit(2); }
}
