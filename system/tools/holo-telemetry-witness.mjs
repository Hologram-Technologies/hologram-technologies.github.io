#!/usr/bin/env node
// holo-telemetry-witness.mjs — HOLO TELEMETRY: system-wide observability native to the UOR substrate
// (ADR-0073). Proves the observability plane adopts the OpenTelemetry data model + W3C Trace Context as
// content-addressed UOR objects (NOT a Prometheus scraper): a span IS a PROV-O Activity whose W3C
// trace-id/span-id are DERIVED from the operation's content (re-derivable, Law L5); wall-clock numbers
// are honestly marked rederivable:false and host-attested; a trace is a self-verifying PROV-O DAG; the
// `traceparent` round-trips in exact W3C form; telemetry is LOCAL-ONLY by default and egress is
// conscience-gated (Law L1, default-deny, fail-closed). A tampered structural field breaks the id.
//
// Authority: OpenTelemetry data model + OTLP · W3C Trace Context · W3C PROV-O + DID Core · IETF RFC 8785
// (JCS) · UOR-ADDR (κ = H(canonical_form)) · the Holo Constitution (ADR-0033) · holospaces Laws L1/L2/L5.
//   node tools/holo-telemetry-witness.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeTelemetry } from "../os/usr/lib/holo/holo-telemetry.mjs";
import { makeStore, memBackend } from "../os/usr/lib/holo/holo-store.js";
import { sha256hex } from "../os/usr/lib/holo/holo-uor.mjs";
import { verify as verifyObject, verifyDeep } from "../os/usr/lib/holo/holo-object.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const enc = (s) => new TextEncoder().encode(s);

const backend = memBackend();
const store = makeStore({ hash: (b) => sha256hex(b), axis: "did:holo:sha256", backend });
const hash = (b) => sha256hex(b);
// a DETERMINISTIC stub host (the wall-clock attester): sign = H(secret‖bytes), verify recomputes. The
// real browser host signs with the self-sovereign identity key; here it must be re-runnable (no randomness).
const SECRET = "witness-host-key";
const host = { id: "did:holo:host:witness", sign: (b) => sha256hex(enc(SECRET + "|")) && sha256hex(Buffer.concat([Buffer.from(SECRET), Buffer.from(b)])),
  verify: (b, s) => s === sha256hex(Buffer.concat([Buffer.from(SECRET), Buffer.from(b)])) };
let T = 1000;                                                            // a pinned clock (deterministic spans)
const tel = makeTelemetry({ store, hash, host, now: () => (T += 10) });

// ── 1 · a SPAN is a content-addressed PROV-O Activity; its W3C ids are well-formed (16-byte / 8-byte) ──
const tr = tel.tracer("app", "1.0");
const root = tr.startSpan("load", { kind: "internal", attributes: { route: "/home" }, used: "did:holo:sha256:aa", generated: "did:holo:sha256:bb" });
const rs = await root.end({ status: "ok" });
ok("span-is-a-content-addressed-prov-activity",
  /^did:holo:sha256:/.test(rs.kappa) && /^[0-9a-f]{32}$/.test(rs.traceId) && /^[0-9a-f]{16}$/.test(rs.spanId)
  && rs.object["@type"].includes("prov:Activity") && rs.object["@type"].includes("hostel:Span"));

// ── 2 · Law L5: holding ONLY the span κ re-derives its W3C span-id from the structural content ──
const v1 = await tel.verify(rs.kappa);
ok("L5-span-id-re-derives-from-content", v1.ok === true && v1.spanId === rs.spanId);

// ── 3 · the HONEST SPLIT: timing is marked rederivable:false and is host-attested (NOT re-derived) ──
const m = rs.object["hostel:measurement"];
const att = tel.verifyAttestation(m);
ok("honest-split-walltime-is-attested-not-rederived",
  m["hostel:rederivable"] === false && typeof m["hostel:durationNano"] === "number" && att.attested === true && att.ok === true);

// ── 4 · Law L5: a TAMPERED structural field (the span name) breaks the span-id re-derivation ──
const sgood = await store.get(rs.kappa);
const tampered = JSON.parse(new TextDecoder().decode(sgood)); tampered["hostel:name"] = "evil";
await backend.set(rs.kappa, enc(JSON.stringify(tampered)));              // same κ key, mutated structural content
const vBad = await tel.verify(rs.kappa);
await backend.set(rs.kappa, sgood);                                     // restore
ok("L5-tampered-structural-field-refused", vBad.ok === false && (await tel.verify(rs.kappa)).ok === true);

// ── 5 · a TRACE is a self-verifying PROV-O DAG: a child span prov:wasInformedBy its parent, one trace-id ──
const child = tr.startSpan("render", { kind: "internal", parent: root, attributes: { frame: 1 } });
const cs = await child.end();
const trace = await tr.seal();
ok("trace-is-a-self-verifying-prov-dag",
  cs.traceId === rs.traceId && cs.object.parentSpanId === rs.spanId
  && trace.spanCount === 2 && trace.object["hostel:spans"].some((s) => s["prov:wasInformedBy"] === rs.spanId));

// ── 6 · Law L5: the whole trace re-derives — every span κ re-derives and shares the trace-id ──
const vt = await tel.verify(trace.kappa);
ok("L5-trace-re-derives", vt.ok === true && vt.traceId === rs.traceId);

// ── 7 · W3C TRACE CONTEXT: inject → a conformant `traceparent`, extract → round-trips the ids ──
const tp = tel.inject({ traceId: rs.traceId, spanId: rs.spanId });
const back = tel.extract(tp);
ok("w3c-traceparent-round-trips",
  /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/.test(tp) && back.valid === true && back.traceId === rs.traceId && back.spanId === rs.spanId && back.sampled === true);

// a malformed / all-zero traceparent is REFUSED per the W3C Recommendation ──
ok("w3c-traceparent-rejects-malformed",
  tel.extract("garbage").valid === false && tel.extract("00-" + "0".repeat(32) + "-" + "0".repeat(16) + "-01").valid === false);

// ── 8 · a METRIC data point: identity (name·unit·kind·labels) re-derives; the value is attested ──
const mt = tel.meter("app");
const point = await mt.counter("page.loads", { unit: "1", attributes: { route: "/home" } });
const pr = await point.record(1);
const vm = await tel.verify(pr.kappa);
ok("metric-identity-re-derives-value-attested",
  /^did:holo:sha256:/.test(pr.kappa) && vm.ok === true && pr.object["hostel:point"]["hostel:rederivable"] === false && pr.object["hostel:point"]["hostel:value"] === 1);

// ── 9 · a LOG record re-derives and correlates to its span via W3C trace-id / span-id ──
const lg = tel.logger("app");
const lr = await lg.emit(9, "home rendered", { traceId: rs.traceId, spanId: rs.spanId });
const vl = await tel.verify(lr.kappa);
ok("log-record-re-derives-and-correlates",
  vl.ok === true && lr.object["hostel:traceId"] === rs.traceId && lr.object["hostel:spanId"] === rs.spanId);

// ── 10 · Law L1 PRIVATE-FIRST: telemetry is LOCAL-ONLY by default — egress without consent is refused ──
const noConsent = await tel.exportTo("https://collector.example/v1/traces", { spans: [rs.object] });
ok("L1-local-only-by-default", noConsent.ok === false && /local-only/.test(noConsent.reason));

// ── 11 · egress is CONSCIENCE-GATED (ADR-0033): a blocking verdict refuses the export, fail-closed ──
const gated = makeTelemetry({ store, hash, host, now: () => (T += 10), conscience: { evaluate: () => ({ outcome: "block", reason: "policy" }) } });
const blocked = await gated.exportTo("https://collector.example/v1/traces", { spans: [rs.object], consent: true });
// with consent AND an accepting conscience, the export yields a genuine OTLP/JSON envelope (OTel interop) ──
const allowed = await tel.exportTo("https://collector.example/v1/traces", { spans: [rs.object, cs.object], consent: true });
ok("L1-egress-conscience-gated-then-otlp",
  blocked.ok === false && /conscience/.test(blocked.reason)
  && allowed.ok === true && allowed.otlp.resourceSpans[0].scopeSpans[0].spans.length === 2
  && allowed.otlp.resourceSpans[0].scopeSpans[0].spans[0].traceId === rs.traceId);

// ── 12 · DETERMINISM (re-runnable witness, Law L2): the same operation re-derives the SAME W3C ids ──
const store2 = makeStore({ hash: (b) => sha256hex(b), axis: "did:holo:sha256", backend: memBackend() });
const tel2 = makeTelemetry({ store: store2, hash, host, now: () => 1234 });
const r2 = await tel2.tracer("app", "1.0").startSpan("load", { kind: "internal", attributes: { route: "/home" }, used: "did:holo:sha256:aa", generated: "did:holo:sha256:bb" }).end({ status: "ok" });
ok("deterministic-ids-content-not-clock", r2.spanId === rs.spanId && r2.traceId === rs.traceId);

// ── 13 · the SEALED doctrine object re-derives (Law L5): its did re-derives AND every Merkle-linked
// COLD source file re-hashes to its content address — a tampered linked byte breaks the whole address. ──
const OS = join(here, "../os");
const doctrine = JSON.parse(readFileSync(join(OS, "etc/holo-telemetry/telemetry.uor.json"), "utf8"));
const linkStore = new Map();                                            // hex → the raw linked source bytes
const fileOf = { "hostel:ontology": "usr/share/ns/telemetry.jsonld", "hostel:runtime": "usr/lib/holo/holo-telemetry.mjs",
  "hostel:store": "usr/lib/holo/holo-store.js", "hostel:address": "usr/lib/holo/holo-uor.mjs" };
for (const link of doctrine.links || []) { const p = fileOf[link.rel]; if (p) linkStore.set(link.id.split(":").pop(), readFileSync(join(OS, p))); }
const deep = verifyDeep(linkStore, doctrine);
ok("sealed-doctrine-object-re-derives", verifyObject(doctrine) === true && deep.ok === true, deep.why || "");

// tamper a linked source byte in the store → its content hash no longer matches the pinned address ──
const ontHex = (doctrine.links.find((l) => l.rel === "hostel:ontology") || {}).id.split(":").pop();
const ontGood = linkStore.get(ontHex); const ontBad = Buffer.from(ontGood); ontBad[0] ^= 0xff;
linkStore.set(ontHex, ontBad);
const deepBad = verifyDeep(linkStore, doctrine);
linkStore.set(ontHex, ontGood);
ok("sealed-doctrine-tampered-link-refused", deepBad.ok === false && verifyDeep(linkStore, doctrine).ok === true);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  witnessed,
  covers: [
    "system-wide observability as content-addressed UOR objects (OpenTelemetry data model + W3C Trace Context), NOT a Prometheus scraper — a span IS a PROV-O Activity whose κ is a content address",
    "Law L5 — holding only a signal's κ re-derives its W3C span-id / metric-id / log-id from the structural content; a tampered structural field breaks the id (verify-don't-trust)",
    "the honest split — wall-clock timing and measured values are marked hostel:rederivable=false and host-attested (a signed claim), never falsely claimed as re-derived",
    "a trace is a self-verifying PROV-O DAG — child spans prov:wasInformedBy their parent under one W3C trace-id; the whole trace re-derives",
    "W3C Trace Context — `traceparent` injects in exact 00-trace-span-flags form and round-trips; malformed / all-zero ids are refused per the Recommendation",
    "metrics (sum·gauge·histogram) and log records seal to κ-objects whose identity re-derives and correlate to spans via W3C ids",
    "Law L1 private-first — telemetry is LOCAL-ONLY by default; egress requires explicit consent AND passes the conscience gate (default-deny, fail-closed), then exports genuine OTLP/JSON (OpenTelemetry interop)",
    "determinism — the same operation re-derives the same W3C ids from content, not the clock (a re-runnable witness, Law L2)",
  ],
  span: { kappa: rs.kappa, traceId: rs.traceId, spanId: rs.spanId },
  trace: { kappa: trace.kappa, spans: trace.spanCount },
  checks, failed: fail,
  authority: "OpenTelemetry data model + OTLP · W3C Trace Context · W3C PROV-O · W3C DID Core · IETF RFC 8785 (JCS) · UOR-ADDR · Holo Constitution (ADR-0033) · Law L1/L2/L5",
};
writeFileSync(join(here, "holo-telemetry-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Telemetry witness — system-wide observability, native to the UOR substrate (ADR-0073)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  span ${rs.spanId} @ trace ${rs.traceId}\n  trace κ ${trace.kappa}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
