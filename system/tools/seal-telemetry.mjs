#!/usr/bin/env node
// seal-telemetry.mjs — materialize the Holo Telemetry doctrine (ADR-0073) into the substrate as a
// SELF-VERIFYING UOR object, the observability analogue of how Holo UX's doctrine is the one canonical
// source. It writes TWO files from the one source (holo-telemetry.mjs):
//
//   1 · os/usr/share/ns/telemetry.jsonld        — the dereferenceable hostel: OWL/SKOS ontology that
//        maps the OpenTelemetry data model + W3C Trace Context onto re-derivable UOR terms.
//   2 · os/etc/holo-telemetry/telemetry.uor.json — the sealed canonical telemetry object: it declares
//        the adopted standards + the honest-split rule and Merkle-LINKS the canonical source files by
//        content address. Its did re-derives (Law L5) and a tampered linked byte breaks the address.
//
// Deterministic + re-runnable (no timestamps / no randomness), like seal-ux-doctrine.mjs. ONLY COLD
// source files are linked — never a HOT file the gate rewrites (e.g. conformance.jsonld).
//   node tools/seal-telemetry.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { toOntology } from "../os/usr/lib/holo/holo-telemetry.mjs";
import { sha256hex } from "../os/usr/lib/holo/holo-uor.mjs";
import { makeObject, contentLink } from "../os/usr/lib/holo/holo-object.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const read = (rel) => readFileSync(join(OS, rel));

// 1 · the ontology materialization (the dereferenceable hostel: vocabulary) ───────────────────────
const ontology = toOntology();
mkdirSync(join(OS, "usr/share/ns"), { recursive: true });
writeFileSync(join(OS, "usr/share/ns/telemetry.jsonld"), JSON.stringify(ontology, null, 2) + "\n");

// 2 · the sealed telemetry object ──────────────────────────────────────────────────────────────────
const store = new Map();
const leaf = (rel, p, type = "schema:SoftwareSourceCode") => contentLink(rel, `did:holo:sha256:${sha256hex(read(p))}`, type);
// the canonical, COLD source files this doctrine binds — change any byte and this object's did changes (L5).
const links = [
  leaf("hostel:ontology", "usr/share/ns/telemetry.jsonld", "schema:DigitalDocument"),
  leaf("hostel:runtime", "usr/lib/holo/holo-telemetry.mjs", "schema:SoftwareSourceCode"),
  leaf("hostel:store", "usr/lib/holo/holo-store.js", "schema:SoftwareSourceCode"),
  leaf("hostel:address", "usr/lib/holo/holo-uor.mjs", "schema:SoftwareSourceCode"),
];

const obj = makeObject(store, {
  type: ["schema:CreativeWork", "prov:Entity", "skos:Collection"],
  context: [{ skos: "http://www.w3.org/2004/02/skos/core#", hostel: "https://hologram.os/ns/telemetry#", hosc: "https://hologram.os/ns/conformance#" }],
  "schema:name": "Holo Telemetry — system-wide observability native to the UOR substrate",
  "schema:description": "Why: a system should be observable without trusting whatever number an emitter reports, and without running a foreign scraper. How: adopt the OpenTelemetry data model (Span · Metric · LogRecord · Resource · Scope) and W3C Trace Context as content-addressed UOR objects — a span IS a PROV-O Activity whose W3C trace-id / span-id are DERIVED from the operation's content (re-derivable, Law L5); the κ-store is the collector, graph traversal is the query, Pin/Own is the exporter, the conscience gate is the privacy boundary; Prometheus's central scraper is rejected. The honest split: wall-clock measurements are marked hostel:rederivable=false and host-attested — never claimed as re-derived. What: every holospace binds this object's κ and emits via window.HoloTelemetry (auto-wired system-wide by the theme runtime, Law L2); re-derive this did and each linked source κ to verify (Law L5).",
  "schema:softwareVersion": "1.0",
  "dcterms:conformsTo": "https://hologram.os/ns/telemetry",
  "dcterms:license": "https://creativecommons.org/publicdomain/zero/1.0/",
  "hostel:adopts": [
    { "@id": "https://opentelemetry.io/", prefLabel: "OpenTelemetry data model + OTLP", rel: "data model + wire" },
    { "@id": "https://www.w3.org/TR/trace-context/", prefLabel: "W3C Trace Context", rel: "trace propagation (traceparent)" },
    { "@id": "http://www.w3.org/ns/prov#", prefLabel: "W3C PROV-O", rel: "a span is a prov:Activity; a trace is a PROV-O DAG" },
  ],
  "hostel:rejects": { "@id": "https://prometheus.io/", prefLabel: "Prometheus central scraper", reason: "a long-running server that trusts the emitter — a foreign runtime the substrate forbids (verify, don't trust)" },
  "hostel:honestSplit": "STRUCTURAL/provenance facts re-derive under Law L5 (hostel:rederivable=true); WALL-CLOCK measurements are host-attested, never re-derived (hostel:rederivable=false).",
  "hostel:signals": ontology["@graph"].filter((t) => t["@type"] === "rdfs:Class").map((t) => t["@id"]),
  "hosc:authority": "ADR-0073 (Holo Telemetry) · OpenTelemetry data model + OTLP · W3C Trace Context · W3C PROV-O + DID Core · IETF RFC 8785 (JCS) · UOR-ADDR (κ = H(canonical_form)) · the Holo Constitution (ADR-0033) · verify by re-derivation (Law L5) · private-first (Law L1)",
  "hosc:witness": "tools/holo-telemetry-witness.mjs",
  links,
});

mkdirSync(join(OS, "etc/holo-telemetry"), { recursive: true });
writeFileSync(join(OS, "etc/holo-telemetry/telemetry.uor.json"), JSON.stringify(obj, null, 2) + "\n");

console.log(`sealed Holo Telemetry doctrine`);
console.log(`  ns/telemetry.jsonld      — ${ontology["@graph"].length} terms`);
console.log(`  telemetry.uor.json       — ${obj.id}`);
console.log(`  source links             — ${links.length} (re-derive to verify, Law L5)`);
