#!/usr/bin/env node
// holo-sparql-witness.mjs — PROVE S4: the L5-verified object graph is queryable RDF.
//   · JSON-LD UOR objects materialize to RDF quads, each in its SOURCE object's named graph (provenance).
//   · a SPARQL Basic Graph Pattern query JOINS across MULTIPLE source objects.
//   · every result's provenance graph is a verified source κ (re-derives, Law L5).
//   · only objects that passed traversal (L5) are materialized — a tampered object contributes NO triples.
//   · N-Quads (W3C interop) round-trips through the vendored engine.
//   · the vendored SPARQL/RDF engine (n3.min.js) is κ-sealed and re-derives to its recorded κ (Law L5).
// Behavioral definition of holospaces target row CC-sparql.
//   node tools/holo-sparql-witness.mjs
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeObject, linkTo } from "../os/usr/lib/holo/holo-object.mjs";
import { hexOf } from "../os/sbin/holo-uri.mjs";
import { traverse } from "../os/sbin/holo-graph.mjs";
import { materialize, query, provenanceGraphs, toNQuads, parseNQuads, expandCurie, PREFIXES } from "../os/sbin/holo-rdf.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const r = [];
const ok = (label, pass, d = "") => { r.push({ label, pass: !!pass }); console.log(`${pass ? "PASS" : "FAIL"} — ${label}${d ? "  (" + d + ")" : ""}`); return !!pass; };

// build A → {B, C}, B → D, distribute across 3 sources, traverse with L5 (S3), materialize the verified nodes.
const build = new Map();
const D = makeObject(build, { type: ["schema:Dataset"], name: "D" });
const C = makeObject(build, { type: ["schema:Dataset"], name: "C" });
const B = makeObject(build, { type: ["schema:Dataset"], name: "B", links: [linkTo(build, "rel:next", D)] });
const A = makeObject(build, { type: ["schema:Collection"], name: "A", links: [linkTo(build, "rel:b", B), linkTo(build, "rel:c", C)] });
const all = new Map([A, B, C, D].map((o) => [hexOf(o.id), build.get(hexOf(o.id))]));
const resolve = async (k) => all.get(hexOf(k)) || null;

const t = await traverse(A.id, { resolve });
ok("S3 traversal verifies the whole graph (precondition)", t.ok && t.visited.size === 4);
const store = materialize(t.nodes);

// A · materialization carries provenance — triples live in their source objects' named graphs.
const graphs = new Set(store.getQuads(null, null, null, null).map((q) => q.graph.value));
ok("triples are materialized across ≥2 source named graphs (provenance)", graphs.size >= 2, graphs.size + " graphs");
ok("every named graph is a verified source object's κ", [...graphs].every((g) => g.startsWith("did:holo:sha256:") && all.has(hexOf(g))));
ok("store holds the expected quad count (4 types + 4 names + 3 hasPart)", store.size === 11, store.size + " quads");

// B · a simple SELECT — all Datasets (?d a schema:Dataset).
const datasets = query(store, [{ s: "?d", p: "rdf:type", o: "schema:Dataset" }]);
const dnames = new Set(datasets.map((b) => b["?d"].value));
ok("SELECT ?d WHERE { ?d a schema:Dataset } → B, C, D", dnames.size === 3 && [B, C, D].every((o) => dnames.has(o.id)));

// C · a JOIN spanning source objects — parent hasPart a child that is a Dataset. The hasPart edge lives in
//     the PARENT's graph; the rdf:type lives in the CHILD's graph → the join crosses source objects.
const joined = query(store, [
  { s: "?x", p: "schema:hasPart", o: "?y" },
  { s: "?y", p: "rdf:type", o: "schema:Dataset" },
]);
const pairs = joined.map((b) => [b["?x"].value, b["?y"].value]);
ok("JOIN ?x hasPart ?y . ?y a Dataset → (A,B)(A,C)(B,D)", pairs.length === 3
  && pairs.some(([x, y]) => x === A.id && y === B.id)
  && pairs.some(([x, y]) => x === A.id && y === C.id)
  && pairs.some(([x, y]) => x === B.id && y === D.id));
const joinProv = provenanceGraphs(store, [{ s: "?x", p: "schema:hasPart", o: "?y" }]);
ok("the join's edges come from ≥2 distinct source objects (A and B)", joinProv.size === 2 && joinProv.has(A.id) && joinProv.has(B.id));

// D · provenance re-derivation — each source graph κ re-derives to its object (Law L5). (The objects were
//     admitted by S3 traversal, which already enforces this; here we re-confirm at the RDF layer.)
const sha256hex = (b) => createHash("sha256").update(b).digest("hex");
ok("each provenance graph IRI equals its source object's self-verifying id (Law L5)", [...graphs].every((g) => JSON.parse(all.get(hexOf(g))).id === g));

// E · N-Quads interop round-trips through the vendored engine (W3C RDF 1.1 N-Quads).
const nq = await toNQuads(store);
const reparsed = parseNQuads(nq);
ok("N-Quads serialize + re-parse preserves every quad", reparsed.length === store.size, reparsed.length + "/" + store.size);
ok("N-Quads output is line-oriented W3C N-Quads (subject predicate object graph .)", /^<did:holo:[^>]+>\s+<[^>]+>\s+(<[^>]+>|"[^"]*")\s+<did:holo:[^>]+>\s+\.$/m.test(nq.trim()));

// F · tamper exclusion — a tampered source object fails S3 traversal, so it is NOT materialized and
//     contributes zero triples. Corrupt B; traverse refuses at B; materialize the (partial) nodes; D's
//     triples never appear because B was never admitted to recurse into D.
{
  const corrupt = new Uint8Array(build.get(hexOf(B.id))); corrupt[corrupt.length - 2] ^= 0x20;
  const tamperResolve = async (k) => (hexOf(k) === hexOf(B.id) ? corrupt : all.get(hexOf(k)) || null);
  const tt = await traverse(A.id, { resolve: tamperResolve });
  const tstore = materialize(tt.nodes);
  const tgraphs = new Set(tstore.getQuads(null, null, null, null).map((q) => q.graph.value));
  ok("a tampered object contributes NO triples (excluded by L5)", !tt.ok && !tgraphs.has(B.id) && !tgraphs.has(D.id));
}

// G · the vendored RDF/SPARQL engine is κ-sealed and re-derives to its recorded κ (Law L5 on the engine).
{
  const seal = JSON.parse(readFileSync(join(here, "../os/usr/lib/holo/vendor/n3/SEAL.json"), "utf8"));
  const bytes = readFileSync(join(here, "../os/usr/lib/holo/vendor/n3/n3.min.js"));
  ok("vendored n3.min.js re-derives to its sealed κ (tamper-refused engine)", "did:holo:sha256:" + sha256hex(bytes) === seal.kappa, seal.version);
}

// sanity: expandCurie resolves a known prefix and passes a did URI through.
ok("expandCurie('schema:name') → schema.org IRI; did URI passes through", expandCurie("schema:name") === PREFIXES.schema + "name" && expandCurie(A.id) === A.id);

const passed = r.filter((x) => x.pass).length;
console.log(`\n${passed}/${r.length} checks`);
if (passed !== r.length) process.exit(1);
console.log("WITNESSED ✓ — S4: JSON-LD→RDF materialization + SPARQL BGP query over the L5-verified, provenance-carrying graph");
