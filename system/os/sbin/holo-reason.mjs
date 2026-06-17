// holo-reason.mjs — RDFS entailment + SHACL-core validation with PROVENANCE (S5). This is the W3C
// "ladder to proof": metadata (raw triples) → schema (SHACL validation) → entailment (derived triples) →
// PROOF. The rules are the standard W3C RDF 1.1 Semantics RDFS entailment rules (§9.2.1) — config, not a
// hand-rolled semantics. The NOVELTY is provenance: a forward-chaining fixpoint records, for every DERIVED
// triple, the premises it came from, so proofOf() traces an entailment back to the SOURCE OBJECT κ it
// depends on — and those source objects re-derive (Law L5). An inference is therefore not just asserted; it
// is PROVEN against verified content. Node/app-side (over the holo-rdf store; N3.Reasoner is available for a
// full N3-rules cross-check at promotion).

import { DataFactory } from "n3";
const { namedNode, quad } = DataFactory;
import { PREFIXES, expandCurie } from "./holo-rdf.mjs";

export const ENTAILED_GRAPH = namedNode(PREFIXES.holo + "entailed");   // derived triples live here; source graphs are κ

// The standard RDFS entailment rules (RDF 1.1 Semantics §9.2.1), as data. Terms are "?var" or CURIEs.
export const RDFS_RULES = Object.freeze([
  { name: "rdfs9-type-propagation", premises: [["?s", "rdf:type", "?c"], ["?c", "rdfs:subClassOf", "?d"]], conclusion: ["?s", "rdf:type", "?d"] },
  { name: "rdfs11-subClassOf-transitivity", premises: [["?c", "rdfs:subClassOf", "?d"], ["?d", "rdfs:subClassOf", "?e"]], conclusion: ["?c", "rdfs:subClassOf", "?e"] },
  { name: "rdfs7-subPropertyOf", premises: [["?p", "rdfs:subPropertyOf", "?q"], ["?s", "?p", "?o"]], conclusion: ["?s", "?q", "?o"] },
  { name: "rdfs5-subPropertyOf-transitivity", premises: [["?p", "rdfs:subPropertyOf", "?q"], ["?q", "rdfs:subPropertyOf", "?r"]], conclusion: ["?p", "rdfs:subPropertyOf", "?r"] },
  { name: "rdfs2-domain", premises: [["?p", "rdfs:domain", "?c"], ["?s", "?p", "?o"]], conclusion: ["?s", "rdf:type", "?c"] },
  { name: "rdfs3-range", premises: [["?p", "rdfs:range", "?c"], ["?s", "?p", "?o"]], conclusion: ["?o", "rdf:type", "?c"] },
]);

// OWL 2 RL property/class rules (W3C OWL 2 Profiles §4.3) as data — the same {premises, conclusion} form, so
// they run through the same proof-carrying fixpoint and proofOf() traces them to source κ too. A meaningful
// subset beyond RDFS: transitive/symmetric/inverse properties and class equivalence. OWL_RL_RULES extends
// RDFS_RULES — call entail(store, OWL_RL_RULES) for the OWL closure.
export const OWL_RL_RULES = Object.freeze([
  ...RDFS_RULES,
  { name: "prp-trp-transitive", premises: [["?p", "rdf:type", "owl:TransitiveProperty"], ["?x", "?p", "?y"], ["?y", "?p", "?z"]], conclusion: ["?x", "?p", "?z"] },
  { name: "prp-symp-symmetric", premises: [["?p", "rdf:type", "owl:SymmetricProperty"], ["?x", "?p", "?y"]], conclusion: ["?y", "?p", "?x"] },
  { name: "prp-inv-inverseOf", premises: [["?p", "owl:inverseOf", "?q"], ["?x", "?p", "?y"]], conclusion: ["?y", "?q", "?x"] },
  { name: "cax-eqc1-equivalentClass", premises: [["?c", "owl:equivalentClass", "?d"], ["?x", "rdf:type", "?c"]], conclusion: ["?x", "rdf:type", "?d"] },
  { name: "cax-eqc2-equivalentClass", premises: [["?c", "owl:equivalentClass", "?d"], ["?x", "rdf:type", "?d"]], conclusion: ["?x", "rdf:type", "?c"] },
]);

const isVar = (t) => typeof t === "string" && t.startsWith("?");
const bindTerm = (t, b) => (isVar(t) ? (b[t] || null) : namedNode(expandCurie(t)));
// a graph-independent key for a triple (entailment is over the union graph; provenance is tracked separately)
export const spoKey = (s, p, o) => `${s.termType}:${s.value}|${p.value}|${o.termType}:${o.value}`;
const quadKey = (q) => spoKey(q.subject, q.predicate, q.object);

// evalRule(store, rule) → [{ binding, prem:[matchedQuad…] }] — BGP join of the rule's premises, keeping the
// matched quads (needed for the proof chain).
function evalRule(store, rule) {
  let sols = [{ binding: {}, prem: [] }];
  for (const [ps, pp, po] of rule.premises) {
    const next = [];
    for (const sol of sols) {
      for (const q of store.getQuads(bindTerm(ps, sol.binding), bindTerm(pp, sol.binding), bindTerm(po, sol.binding), null)) {
        const b = { ...sol.binding };
        if (isVar(ps)) b[ps] = q.subject;
        if (isVar(pp)) b[pp] = q.predicate;
        if (isVar(po)) b[po] = q.object;
        next.push({ binding: b, prem: [...sol.prem, q] });
      }
    }
    sols = next;
  }
  return sols;
}

// entail(store) → forward-chaining RDFS fixpoint. Derived triples are added to ENTAILED_GRAPH (so they are
// distinguishable from asserted source triples); a justification map records each derived triple's rule +
// premises for proofOf(). Mutates and returns the store, plus { derived:[quad], justify:Map }.
export function entail(store, rules = RDFS_RULES) {
  const justify = new Map();
  const present = new Set(store.getQuads(null, null, null, null).map(quadKey));   // asserted spo keys (any graph)
  const derived = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const rule of rules) {
      for (const { binding, prem } of evalRule(store, rule)) {
        const [cs, cp, co] = rule.conclusion;
        const s = bindTerm(cs, binding), p = bindTerm(cp, binding), o = bindTerm(co, binding);
        if (!s || !p || !o) continue;
        const key = spoKey(s, p, o);
        if (present.has(key)) continue;                       // already known (asserted or previously derived)
        store.addQuad(quad(s, p, o, ENTAILED_GRAPH));
        present.add(key);
        justify.set(key, { rule: rule.name, premiseKeys: prem.map(quadKey), premiseQuads: prem });
        derived.push(quad(s, p, o, ENTAILED_GRAPH));
        changed = true;
      }
    }
  }
  return { store, derived, justify };
}

// proofOf(quad, justify) → { sources:Set<κ>, steps:[{rule, conclusion}] } — trace a derived triple to the
// SOURCE OBJECT κ it depends on. An asserted premise's named graph IS its source κ; a derived premise
// recurses. Acyclic: the fixpoint never re-derives a present triple, so justifications form a DAG.
export function proofOf(q, justify) {
  const sources = new Set();
  const steps = [];
  const seen = new Set();
  const visit = (key) => {
    if (seen.has(key)) return;
    seen.add(key);
    const j = justify.get(key);
    if (!j) return;                                           // asserted leaf (its source graph is added by the caller)
    steps.push({ rule: j.rule, conclusion: key });
    for (const pq of j.premiseQuads) {
      const pk = quadKey(pq);
      if (justify.has(pk)) { visit(pk); continue; }            // derived premise → recurse
      const g = pq.graph && pq.graph.value;                   // asserted premise → its named graph is the source κ
      if (g && g.startsWith("did:holo:sha256:")) sources.add(g);
    }
  };
  visit(quadKey(q));
  return { sources, steps };
}

// ── SHACL-core (the "schema" rung): validate node shapes over the store. A shape targets a class and
// constrains properties (sh:minCount, sh:class). Returns { conforms, results:[{focusNode, path, message}] }.
// Full W3C SHACL test-suite conformance attaches when a SHACL engine is vendored at promotion.
export function validateShapes(store, shapes) {
  const TYPE = namedNode(PREFIXES.rdf + "type");
  const results = [];
  for (const shape of shapes) {
    const targets = store.getQuads(null, TYPE, namedNode(expandCurie(shape.targetClass)), null).map((q) => q.subject);
    for (const focus of targets) {
      for (const c of shape.properties || []) {
        const objs = store.getQuads(focus, namedNode(expandCurie(c.path)), null, null).map((q) => q.object);
        if (c.minCount != null && objs.length < c.minCount)
          results.push({ focusNode: focus.value, path: c.path, message: `minCount ${c.minCount} (got ${objs.length})` });
        if (c.class) {
          for (const o of objs) {
            const isType = store.getQuads(o, TYPE, namedNode(expandCurie(c.class)), null).length > 0;
            if (!isType) results.push({ focusNode: focus.value, path: c.path, message: `value ${o.value} not a ${c.class}` });
          }
        }
      }
    }
  }
  return { conforms: results.length === 0, results };
}
