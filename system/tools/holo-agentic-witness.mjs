#!/usr/bin/env node
// holo-agentic-witness.mjs — PROVE S6 (the final slice): the Agentic-Web trust face on the κ-substrate.
//   · OWL 2 RL entailment (TransitiveProperty, equivalentClass) extends the proof-carrying engine; a derived
//     triple's PROOF traces to the source objects' κ (re-derive, Law L5).
//   · the did:holo method resolves a κ to a W3C DID Document (DID Core), structurally valid.
//   · a W3C Verifiable Credential (eddsa-jcs-2022) is issued, verified, and REFUSED on tamper / wrong key.
//   · a credential bound into a UOR object's trust face is doubly protected: the VC signature AND the
//     object's own κ (Law L5) both break on tamper.
// Behavioral definition of holospaces target rows CC-owl, CC-did, CC-vc.
//   node tools/holo-agentic-witness.mjs
import { makeObject, verify } from "../os/usr/lib/holo/holo-object.mjs";
import { hexOf } from "../os/sbin/holo-uri.mjs";
import { materialize, query } from "../os/sbin/holo-rdf.mjs";
import { entail, proofOf, OWL_RL_RULES, ENTAILED_GRAPH } from "../os/sbin/holo-reason.mjs";
import { didDocument, validateDidDocument, parseDid, isDid } from "../os/sbin/holo-did.mjs";
import { generateKey, issueCredential, verifyCredential } from "../os/sbin/holo-vc.mjs";

const r = [];
const ok = (label, pass, d = "") => { r.push({ label, pass: !!pass }); console.log(`${pass ? "PASS" : "FAIL"} — ${label}${d ? "  (" + d + ")" : ""}`); return !!pass; };

// build: an ONTOLOGY object O (OWL axioms) + a FACTS object F, both sealed UOR objects (L5-verified).
const store0 = new Map();
const O = makeObject(store0, { type: ["holo:Ontology"], name: "owl", axioms: [
  ["holo:ancestor", "rdf:type", "owl:TransitiveProperty"],
  ["schema:Dataset", "owl:equivalentClass", "holo:Corpus"],
] });
const F = makeObject(store0, { type: ["holo:Facts"], name: "facts", axioms: [
  ["holo:A", "holo:ancestor", "holo:B"],
  ["holo:B", "holo:ancestor", "holo:C"],
  ["holo:X", "rdf:type", "schema:Dataset"],
] });
const nodes = [O, F].map((obj) => ({ kind: "object", obj }));

// ── OWL 2 RL entailment + proof ──────────────────────────────────────────────────────────────────
const store = materialize(nodes);
const { derived, justify } = entail(store, OWL_RL_RULES);
ok("OWL fixpoint derived new triples beyond RDFS", derived.length > 0, derived.length + " derived");
const ancAC = query(store, [{ s: "holo:A", p: "holo:ancestor", o: "holo:C" }]);
ok("owl:TransitiveProperty: A ancestor B, B ancestor C ⊨ A ancestor C", ancAC.length === 1);
const corpus = query(store, [{ s: "holo:X", p: "rdf:type", o: "holo:Corpus" }]);
ok("owl:equivalentClass: X a Dataset ⊨ X a Corpus", corpus.length === 1);
// proof of the transitive entailment traces to BOTH sources (O declares the property, F supplies the facts)
const { namedNode } = (await import("n3")).DataFactory;
const acQuad = store.getQuads(namedNode("https://hologram.os/ns#A"), namedNode("https://hologram.os/ns#ancestor"), namedNode("https://hologram.os/ns#C"), ENTAILED_GRAPH)[0];
const proof = proofOf(acQuad, justify);
ok("OWL proof traces to source κ {O (property decl), F (facts)} that re-derive (Law L5)", proof.sources.has(O.id) && proof.sources.has(F.id) && [O.id, F.id].every((k) => store0.has(hexOf(k))));

// ── did:holo DID Document (DID Core) ─────────────────────────────────────────────────────────────
const key = generateKey();
ok("the object's id is a did:holo DID; parseDid recovers axis+hex", isDid(O.id) && parseDid(O.id).axis === "sha256");
const doc = didDocument(O.id, { publicKeyMultibase: key.publicKeyMultibase });
const dv = validateDidDocument(doc);
ok("didDocument(κ, key) is a structurally valid DID Document", dv.ok && doc.id === O.id && doc.assertionMethod.length === 1);
const badDoc = { "@context": ["https://www.w3.org/ns/did/v1"], id: O.id, controller: O.id, authentication: [O.id + "#ghost"] };
ok("an authentication ref with no verificationMethod is rejected", !validateDidDocument(badDoc).ok);

// ── Verifiable Credential (VC 2.0 / eddsa-jcs-2022) ──────────────────────────────────────────────
const vc = issueCredential({ issuer: O.id, subject: F.id, type: ["FactsCredential"], claims: { "holo:attests": "the facts graph" }, key, created: "2026-01-01T00:00:00Z" });
ok("issued a VC 2.0 with an eddsa-jcs-2022 Data Integrity proof", vc.type.includes("VerifiableCredential") && vc.proof.cryptosuite === "eddsa-jcs-2022" && /^z/.test(vc.proof.proofValue));
ok("the VC verifies against the issuer's Multikey", verifyCredential(vc, { publicKeyMultibase: key.publicKeyMultibase }).ok);
ok("the VC verifies against the issuer's public key object", verifyCredential(vc, { publicKey: key.publicKey }).ok);
const tampered = { ...vc, credentialSubject: { ...vc.credentialSubject, "holo:attests": "a LIE" } };
ok("a tampered claim FAILS verification", !verifyCredential(tampered, { publicKeyMultibase: key.publicKeyMultibase }).ok);
ok("a wrong issuer key FAILS verification", !verifyCredential(vc, { publicKeyMultibase: generateKey().publicKeyMultibase }).ok);

// ── credential bound into the UOR envelope trust face (doubly protected: VC sig + object κ) ───────
const trustStore = new Map();
const credited = makeObject(trustStore, { type: ["schema:Dataset"], name: "B+cred", credential: vc });
ok("a UOR object carries a VC in its trust face and still re-derives (Law L5)", verify(credited) && verifyCredential(credited.credential, { publicKeyMultibase: key.publicKeyMultibase }).ok);
const forged = { ...credited, credential: tampered };
ok("tampering the bound credential breaks BOTH the object κ (L5) and the VC signature", !verify(forged) && !verifyCredential(forged.credential, { publicKeyMultibase: key.publicKeyMultibase }).ok);

const passed = r.filter((x) => x.pass).length;
console.log(`\n${passed}/${r.length} checks`);
if (passed !== r.length) process.exit(1);
console.log("WITNESSED ✓ — S6: OWL 2 RL entailment + did:holo DID Documents + Verifiable Credentials (Agentic-Web trust face)");
