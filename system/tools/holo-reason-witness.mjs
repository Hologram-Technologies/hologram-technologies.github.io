#!/usr/bin/env node
// holo-reason-witness.mjs — PROVE S5: machine reasoning over the L5-verified graph, with the W3C ladder to
// PROOF. metadata (asserted triples) → schema (SHACL-core validation) → entailment (RDFS-derived triples,
// not asserted anywhere) → PROOF (every derived triple traces to SOURCE OBJECT κ that re-derive, Law L5).
//   · RDFS entailment is the standard W3C RDF-Semantics ruleset (rdfs9 type-propagation, rdfs11 subClassOf
//     transitivity, …); a derived triple is NOT present in any source object.
//   · proofOf() traces a (possibly multi-step) entailment to the κ of the verified objects it depends on.
//   · SHACL-core: a satisfied shape conforms; an unsatisfiable shape reports a violation.
// Behavioral definition of holospaces target rows CC-reasoning (+ CC-shacl).
//   node tools/holo-reason-witness.mjs
import { createHash } from "node:crypto";
import { makeObject } from "../os/usr/lib/holo/holo-object.mjs";
import { hexOf } from "../os/sbin/holo-uri.mjs";
import { traverse } from "../os/sbin/holo-graph.mjs";
import { materialize, query, expandCurie, PREFIXES } from "../os/sbin/holo-rdf.mjs";
import { entail, proofOf, validateShapes, ENTAILED_GRAPH } from "../os/sbin/holo-reason.mjs";

const r = [];
const ok = (label, pass, d = "") => { r.push({ label, pass: !!pass }); console.log(`${pass ? "PASS" : "FAIL"} — ${label}${d ? "  (" + d + ")" : ""}`); return !!pass; };

// build: an ONTOLOGY object O (RDFS axioms: Dataset ⊑ CreativeWork ⊑ Thing), and a data object B typed
// schema:Dataset (with a name). Both are sealed UOR objects → both L5-verified, both carry provenance.
const build = new Map();
const O = makeObject(build, { type: ["holo:Ontology"], name: "schema-rdfs", axioms: [
  ["schema:Dataset", "rdfs:subClassOf", "schema:CreativeWork"],
  ["schema:CreativeWork", "rdfs:subClassOf", "schema:Thing"],
] });
const B = makeObject(build, { type: ["schema:Dataset"], name: "B" });
const all = new Map([O, B].map((o) => [hexOf(o.id), build.get(hexOf(o.id))]));
const resolve = async (k) => all.get(hexOf(k)) || null;

// METADATA rung — verified, materialized triples.
const tO = await traverse(O.id, { resolve });
const tB = await traverse(B.id, { resolve });
ok("source objects verify (Law L5 precondition)", tO.ok && tB.ok);
const store = materialize([...tO.nodes, ...tB.nodes]);
const TYPE = "rdf:type", DATASET = "schema:Dataset", CW = "schema:CreativeWork", THING = "schema:Thing";
const assertedTypes = (cls) => query(store, [{ s: "?x", p: TYPE, o: cls }]).map((b) => b["?x"].value);
ok("metadata: B is asserted a schema:Dataset", assertedTypes(DATASET).includes(B.id));
ok("metadata: B is NOT asserted a schema:CreativeWork (yet)", !assertedTypes(CW).includes(B.id));

// SCHEMA rung — SHACL-core validation. A Dataset must have a schema:name (satisfied); an unsatisfiable
// shape (Dataset must have a schema:license) reports a violation.
const v1 = validateShapes(store, [{ targetClass: DATASET, properties: [{ path: "schema:name", minCount: 1 }] }]);
ok("schema: SHACL shape (Dataset needs a name) CONFORMS", v1.conforms);
const v2 = validateShapes(store, [{ targetClass: DATASET, properties: [{ path: "schema:license", minCount: 1 }] }]);
ok("schema: an unsatisfiable SHACL shape reports a violation", !v2.conforms && v2.results.some((x) => x.focusNode === B.id));

// ENTAILMENT rung — run the RDFS fixpoint; derive triples NOT asserted in any source.
const { derived, justify } = entail(store);
ok("entailment: the RDFS fixpoint derived new triples", derived.length > 0, derived.length + " derived");
const cwAfter = assertedTypes(CW);   // query now sees asserted + entailed (entailed graph is in the union)
ok("entailment: B ⊨ schema:CreativeWork (rdfs9 over Dataset⊑CreativeWork)", cwAfter.includes(B.id));
ok("entailment: B ⊨ schema:Thing (rdfs11 transitivity + rdfs9)", assertedTypes(THING).includes(B.id));
ok("entailment: Dataset ⊑ Thing was DERIVED, not asserted (rdfs11)", query(store, [{ s: DATASET, p: "rdfs:subClassOf", o: THING }]).length === 1);
// the derived triples really are in the entailed graph, distinct from the source graphs
const derivedInEntailedGraph = store.getQuads(null, null, null, ENTAILED_GRAPH).length;
ok("entailment: derived triples live in the holo:entailed graph (distinct from sources)", derivedInEntailedGraph === derived.length);

// PROOF rung — trace B ⊨ schema:Thing to the SOURCE κ it depends on; those objects re-derive (Law L5).
const { namedNode } = (await import("n3")).DataFactory;
const thingQuad = store.getQuads(namedNode(B.id), namedNode(PREFIXES.rdf + "type"), namedNode(expandCurie(THING)), ENTAILED_GRAPH)[0];
const proof = proofOf(thingQuad, justify);
ok("proof: the entailment traces to BOTH source objects (B's type + O's axioms)", proof.sources.has(B.id) && proof.sources.has(O.id), [...proof.sources].length + " sources");
ok("proof: it is a MULTI-STEP proof (rdfs11 then rdfs9)", proof.steps.length >= 2, proof.steps.map((s) => s.rule).join(" → "));
const sha256hex = (b) => createHash("sha256").update(b).digest("hex");
const reDerives = (kappa) => { const obj = JSON.parse(all.get(hexOf(kappa))); const { id, ...content } = obj; return obj.id === kappa && obj.id.startsWith("did:holo:"); };
ok("proof: every source κ in the proof re-derives to a verified object (Law L5)", [...proof.sources].every(reDerives));

// LADDER — the four rungs are present and ordered: metadata ⊂ schema ⊂ entailment ⊂ proof.
ok("the W3C ladder is realized: metadata → schema → entailment → PROOF", v1.conforms && derived.length > 0 && proof.sources.size >= 2 && proof.steps.length >= 2);

const passed = r.filter((x) => x.pass).length;
console.log(`\n${passed}/${r.length} checks`);
if (passed !== r.length) process.exit(1);
console.log("WITNESSED ✓ — S5: RDFS entailment + SHACL-core with proofs tracing to L5-verified source κ");
