// holo-telemetry.mjs — HOLO TELEMETRY: system-wide observability, native to the UOR substrate
// (ADR-0073). The observability plane, beside Holo Route's *data* boundary (ADR-0069) and Holo
// Orchestrate's *collaboration* boundary (ADR-0045). Adopts the OpenTelemetry data model (Resource ·
// Scope · Span · Metric · LogRecord) and W3C Trace Context as the vocabulary — and REJECTS the
// Prometheus server architecture (a long-running scraper that *trusts* whatever number it is handed,
// a foreign runtime the substrate forbids). Every signal is a content-addressed UOR object: the
// κ-store is the collector, graph traversal (Holo Resolve) is the query, Pin/Own is the exporter,
// the conscience gate is the privacy boundary. No new infrastructure is minted.
//
// THE HONEST SPLIT — the substrate's real differentiator over trust-the-emitter telemetry:
//   • STRUCTURAL / provenance facts (which operation ran, its inputs→outputs, the conscience verdict)
//     are RE-DERIVABLE: a span's W3C trace-id / span-id are DERIVED from the content of the operation,
//     not random — tamper the structural content and the id no longer re-derives (Law L5). marked
//     `hostel:rederivable: true`.
//   • WALL-CLOCK numbers (start/end time, duration, a measured metric value) are NOT re-derivable;
//     they are ATTESTED — signed by the local host key — never re-derived. marked `rederivable: false`.
// Telemetry never claims to verify a latency it cannot; it states honestly which facts re-derive.
//
//   tracer(name).startSpan(name, opts) → span; span.end() finalizes it; tracer.seal() → one trace κ
//   meter(name).counter|gauge|histogram(name).record(v, attrs) → a metric data-point κ
//   logger(name).emit(severity, body, opts) → a log-record κ
//   inject(ctx) / extract(header) → W3C `traceparent` propagation (00-trace-span-flags)
//   verify(κ) → re-derive a signal's id (Law L5); exportTo(target,{consent}) → conscience-gated egress
//
// A THIN layer, dependency-injected (Map-backed store in Node, IndexedDB in the browser) so the whole
// contract is provable without a browser, exactly like holo-route / holo-app.

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b instanceof Uint8Array ? b : new Uint8Array(b));
const u8 = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b));
// RFC 8785 JSON Canonicalization Scheme — the canonical form every signal id derives from.
const jcs = (v) => Array.isArray(v) ? "[" + v.map(jcs).join(",") + "]"
  : (v && typeof v === "object") ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}"
  : JSON.stringify(v);

const NS = "https://hologram.os/ns/telemetry";

// W3C Trace Context constants: trace-id is 16 bytes (32 hex), span-id is 8 bytes (16 hex), and the
// all-zero id is invalid per the Recommendation. Our ids are the LOW bytes of a content address, so a
// W3C-conformant 128/64-bit id is simultaneously a UOR content address — the semantic-web bridge.
const ZERO_TRACE = "0".repeat(32), ZERO_SPAN = "0".repeat(16);
const TRACEPARENT = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

// makeTelemetry({ store, hash, conscience, host, resource, scope, now }) → the telemetry runtime.
//   store: the κ-store { put, get, verify }.   hash: bytes→hex (the content-address axis).
//   conscience (optional): the constitution gate { evaluate(decision) → { outcome } } (egress boundary).
//   host (optional): the local attester { id, sign(bytes)→hex|null, verify(bytes,sig)→bool } for the
//     wall-clock measurements that cannot re-derive.   now: injectable clock (the witness pins it).
export function makeTelemetry({ store, hash, conscience = null, host = null,
  resource = { "service.name": "hologram.os" }, scope = { name: "holo", version: "1.0" },
  now = () => (typeof Date !== "undefined" ? Date.now() : 0) } = {}) {
  if (!store || !hash) throw new Error("makeTelemetry needs { store, hash }");
  const attester = host || { id: "local", sign: () => null, verify: () => true };

  const hex = async (s) => hash(enc(s));
  // a content-address-derived W3C id: the LOW bytes of H(canonical structural content).
  const traceIdOf = async (core) => (await hex(jcs(core))).slice(0, 32);
  const spanIdOf = async (core) => (await hex(jcs(core))).slice(0, 16);

  // ── attest a non-re-derivable measurement (wall-clock): the value is carried, the local host signs
  // it. honest — it is NOT re-derived; it is a host claim, exactly what a latency/duration actually is.
  function attest(measurement) {
    const sig = attester.sign(enc(jcs(measurement)));
    return { "hostel:rederivable": false, ...measurement, "hostel:attestedBy": attester.id, ...(sig ? { "hostel:signature": sig } : {}) };
  }

  // ════════════════════════════ TRACES (spans) ════════════════════════════
  // A span IS a PROV-O Activity (ADR-0045's work-receipt shape). Its STRUCTURAL core — name · kind ·
  // attributes · the operation's used/generated κ · its parent — derives the W3C span-id (re-derivable,
  // Law L5). Its timing is a separate ATTESTED block (rederivable:false). A trace is the DAG of spans
  // sharing one trace-id, each `prov:wasInformedBy` its parent — the OTel trace as a PROV-O receipt.
  function tracer(name = scope.name, version = scope.version) {
    const spans = [];
    function startSpan(spanName, { kind = "internal", attributes = {}, parent = null, used = null, generated = null, start = now() } = {}) {
      const core = { "hostel:name": spanName, "hostel:kind": kind, "hostel:attributes": attributes,
        "prov:used": used, "prov:generated": generated, parentSpanId: parent ? parent.spanId : null };
      const handle = { name: spanName, kind, attributes, core, start, _parent: parent, _ended: false,
        traceId: null, spanId: null,
        setAttribute(k, v) { attributes[k] = v; return handle; },
        async end({ status = "ok", end = now() } = {}) {
          if (handle._ended) return handle._sealed;
          handle._ended = true;
          // derive the W3C ids from the structural content (the parent's trace-id is inherited).
          handle.traceId = parent ? parent.traceId : await traceIdOf(core);
          handle.spanId = await spanIdOf({ ...core, traceId: handle.traceId });
          const obj = {
            "@type": ["prov:Activity", "hostel:Span"],
            "hostel:traceId": handle.traceId, "hostel:spanId": handle.spanId,
            ...core, "hostel:status": status,
            "hostel:measurement": attest({ "hostel:startTimeUnixNano": start, "hostel:endTimeUnixNano": end, "hostel:durationNano": end - start }),
          };
          const kappa = await store.put(enc(jcs(obj)));
          handle._sealed = { kappa, traceId: handle.traceId, spanId: handle.spanId, object: obj };
          spans.push(handle._sealed);
          return handle._sealed;
        },
      };
      return handle;
    }
    // SEAL: the whole trace is one self-verifying PROV-O κ — the set of span κs sharing the trace-id,
    // each linking its parent (prov:wasInformedBy). Any peer re-derives every span-id from its content.
    async function seal() {
      const traceId = spans.length ? spans[0].traceId : ZERO_TRACE;
      const obj = {
        "@type": ["prov:Entity", "hostel:Trace"], "hostel:traceId": traceId,
        "hostel:resource": resource, "hostel:scope": { name, version },
        "hostel:spans": spans.map((s) => ({ spanId: s.spanId, "hostel:name": s.object["hostel:name"],
          "prov:wasInformedBy": s.object.parentSpanId, kappa: s.kappa })),
      };
      const kappa = await store.put(enc(jcs(obj)));
      return { kappa, traceId, spanCount: spans.length, object: obj };
    }
    return { startSpan, seal, spans, name, version };
  }

  // ════════════════════════════ METRICS ════════════════════════════
  // A metric's IDENTITY (name · unit · kind · labels) is structural and re-derives; its VALUE is an
  // observed measurement — attested (rederivable:false), never claimed as re-derived.
  function meter(meterName = scope.name) {
    const make = (kind) => (metricName, { unit = "1", attributes = {} } = {}) => ({
      async record(value, extraAttrs = {}, { time = now() } = {}) {
        const core = { "hostel:name": metricName, "hostel:unit": unit, "hostel:kind": kind,
          "hostel:meter": meterName, "hostel:attributes": { ...attributes, ...extraAttrs } };
        const metricId = (await hex(jcs(core))).slice(0, 16);
        const obj = { "@type": ["prov:Entity", "hostel:Metric"], "hostel:metricId": metricId, ...core,
          "hostel:point": attest({ "hostel:value": value, "hostel:timeUnixNano": time }) };
        const kappa = await store.put(enc(jcs(obj)));
        return { kappa, metricId, value, object: obj };
      },
    });
    return { counter: make("sum"), gauge: make("gauge"), histogram: make("histogram") };
  }

  // ════════════════════════════ LOGS ════════════════════════════
  // A log record's CONTENT (severity · body · correlation ids) is structural and re-derives; only its
  // wall-clock timestamp is attested. Correlates to a span via W3C trace-id / span-id.
  function logger(loggerName = scope.name) {
    return {
      async emit(severityNumber, body, { attributes = {}, traceId = null, spanId = null, time = now() } = {}) {
        const core = { "hostel:severityNumber": severityNumber, "hostel:body": body,
          "hostel:attributes": attributes, "hostel:logger": loggerName, "hostel:traceId": traceId, "hostel:spanId": spanId };
        const logId = (await hex(jcs(core))).slice(0, 16);
        const obj = { "@type": ["prov:Entity", "hostel:LogRecord"], "hostel:logId": logId, ...core,
          "hostel:observed": attest({ "hostel:timeUnixNano": time }) };
        const kappa = await store.put(enc(jcs(obj)));
        return { kappa, logId, object: obj };
      },
    };
  }

  // ════════════════════════════ W3C TRACE CONTEXT ════════════════════════════
  // inject/extract the `traceparent` header (version-traceid-spanid-flags). The ids are content
  // addresses, so propagation carries verifiable identity, not an opaque random correlation token.
  function inject(ctx, { sampled = true } = {}) {
    const traceId = (ctx.traceId || "").toLowerCase(), spanId = (ctx.spanId || "").toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(traceId) || !/^[0-9a-f]{16}$/.test(spanId)) throw new Error("traceparent: ids are not W3C-conformant (16-byte trace / 8-byte span)");
    return `00-${traceId}-${spanId}-${sampled ? "01" : "00"}`;
  }
  function extract(header) {
    const m = TRACEPARENT.exec(String(header || "").trim().toLowerCase());
    if (!m) return { valid: false };
    const [, version, traceId, spanId, flags] = m;
    if (traceId === ZERO_TRACE || spanId === ZERO_SPAN) return { valid: false };   // W3C: all-zero is invalid
    return { valid: true, version, traceId, spanId, flags, sampled: (parseInt(flags, 16) & 1) === 1 };
  }

  // ════════════════════════════ VERIFY (Law L5) ════════════════════════════
  // Hold ONLY a signal's κ → re-derive its structural id and compare. A tampered structural field
  // breaks the id; a tampered byte breaks the κ. Timing/values are attested, checked separately.
  async function verify(kappa) {
    const bytes = await store.get(kappa);
    if (!bytes) return { ok: false, reason: "unresolved" };
    if (store.verify && !(await store.verify(kappa, u8(bytes)))) return { ok: false, reason: "L5 — κ does not re-derive from bytes" };
    let obj; try { obj = JSON.parse(dec(bytes)); } catch { return { ok: false, reason: "not a signal" }; }
    const type = obj["@type"] || [];
    if (type.includes("hostel:Span")) {
      const core = { "hostel:name": obj["hostel:name"], "hostel:kind": obj["hostel:kind"], "hostel:attributes": obj["hostel:attributes"],
        "prov:used": obj["prov:used"], "prov:generated": obj["prov:generated"], parentSpanId: obj.parentSpanId };
      const spanId = await spanIdOf({ ...core, traceId: obj["hostel:traceId"] });
      const ok = spanId === obj["hostel:spanId"];
      return { ok, kind: "Span", reason: ok ? "span-id re-derives" : "span-id mismatch (structural tamper)", traceId: obj["hostel:traceId"], spanId: obj["hostel:spanId"] };
    }
    if (type.includes("hostel:Trace")) {
      for (const s of obj["hostel:spans"] || []) {                         // every span κ re-derives + shares the trace-id
        const sb = await store.get(s.kappa);
        if (!sb || (store.verify && !(await store.verify(s.kappa, u8(sb))))) return { ok: false, kind: "Trace", reason: "a span κ does not re-derive" };
        const so = JSON.parse(dec(sb));
        if (so["hostel:traceId"] !== obj["hostel:traceId"] || so["hostel:spanId"] !== s.spanId) return { ok: false, kind: "Trace", reason: "span/trace id mismatch" };
        const v = await verify(s.kappa); if (!v.ok) return { ok: false, kind: "Trace", reason: "span " + s.spanId + ": " + v.reason };
      }
      return { ok: true, kind: "Trace", reason: "every span re-derives + shares the trace-id (PROV-O DAG)", traceId: obj["hostel:traceId"] };
    }
    if (type.includes("hostel:Metric")) {
      const core = { "hostel:name": obj["hostel:name"], "hostel:unit": obj["hostel:unit"], "hostel:kind": obj["hostel:kind"],
        "hostel:meter": obj["hostel:meter"], "hostel:attributes": obj["hostel:attributes"] };
      const metricId = (await hex(jcs(core))).slice(0, 16);
      const ok = metricId === obj["hostel:metricId"];
      return { ok, kind: "Metric", reason: ok ? "metric identity re-derives (value is attested, not re-derived)" : "metric-id mismatch" };
    }
    if (type.includes("hostel:LogRecord")) {
      const core = { "hostel:severityNumber": obj["hostel:severityNumber"], "hostel:body": obj["hostel:body"],
        "hostel:attributes": obj["hostel:attributes"], "hostel:logger": obj["hostel:logger"], "hostel:traceId": obj["hostel:traceId"], "hostel:spanId": obj["hostel:spanId"] };
      const logId = (await hex(jcs(core))).slice(0, 16);
      const ok = logId === obj["hostel:logId"];
      return { ok, kind: "LogRecord", reason: ok ? "log identity re-derives" : "log-id mismatch" };
    }
    return { ok: false, reason: "unknown signal type" };
  }

  // verify a measurement's host attestation (the wall-clock claim) — it is signed, not re-derived.
  function verifyAttestation(measurement) {
    const { "hostel:signature": sig, "hostel:attestedBy": by, "hostel:rederivable": _r, ...claim } = measurement || {};
    if (!sig) return { ok: true, attested: false, reason: "no signature (host key absent)" };
    return { ok: !!attester.verify(enc(jcs(claim)), sig), attested: true, by };
  }

  // ════════════════════════════ EXPORT (Law L1 — private-first) ════════════════════════════
  // Telemetry is LOCAL-ONLY by default. Egress is a conscience-gated decision (default-deny). The
  // wire shape is genuine OTLP/JSON so any OpenTelemetry collector can ingest it; the transport itself
  // is Pin/Own (ADR-0053) or an explicit OTLP sink — never a silent phone-home.
  function toOtlp(spanObjs) {
    return { resourceSpans: [{ resource: { attributes: resource }, scopeSpans: [{ scope, spans: spanObjs.map((o) => ({
      traceId: o["hostel:traceId"], spanId: o["hostel:spanId"], parentSpanId: o.parentSpanId || "", name: o["hostel:name"],
      kind: o["hostel:kind"], startTimeUnixNano: o["hostel:measurement"]["hostel:startTimeUnixNano"],
      endTimeUnixNano: o["hostel:measurement"]["hostel:endTimeUnixNano"], attributes: o["hostel:attributes"] })) }] }] };
  }
  async function exportTo(target, { spans = [], consent = false } = {}) {
    if (!consent) return { ok: false, exported: 0, reason: "local-only — egress requires explicit consent (Law L1, private-first)" };
    if (conscience && typeof conscience.evaluate === "function") {
      const v = conscience.evaluate({ action: "telemetry.export", target, count: spans.length });
      if (!v || v.outcome === "block") return { ok: false, exported: 0, reason: `refused by conscience — ${(v && v.reason) || "blocked"}` };
    }
    return { ok: true, exported: spans.length, target, transport: "pin/own (ADR-0053)", otlp: toOtlp(spans) };
  }

  return { tracer, meter, logger, inject, extract, verify, verifyAttestation, exportTo, toOtlp, toOntology, resource, scope };
}

// ── the dereferenceable hostel: ontology (materialized to os/usr/share/ns/telemetry.jsonld by
// seal-telemetry.mjs). A top-level export so it is derivable with NO runtime instance — mints only the
// genuinely-new substrate terms; every OTel/W3C near-equivalent declares skos:closeMatch to its
// ratified authority (the W3C-semantic-web bridge). Re-exposed on the instance for convenience.
export function toOntology() {
  const term = (id, type, label, comment, extra = {}) => ({ "@id": `hostel:${id}`, "@type": type, label, comment, isDefinedBy: NS, ...extra });
  return {
      "@context": {
        rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#", rdfs: "http://www.w3.org/2000/01/rdf-schema#",
        owl: "http://www.w3.org/2002/07/owl#", xsd: "http://www.w3.org/2001/XMLSchema#",
        skos: "http://www.w3.org/2004/02/skos/core#", dcterms: "http://purl.org/dc/terms/",
        schema: "https://schema.org/", prov: "http://www.w3.org/ns/prov#", otel: "https://opentelemetry.io/schemas/",
        hostel: "https://hologram.os/ns/telemetry#",
        label: "rdfs:label", comment: "rdfs:comment",
        domain: { "@id": "rdfs:domain", "@type": "@id" }, range: { "@id": "rdfs:range", "@type": "@id" },
        subClassOf: { "@id": "rdfs:subClassOf", "@type": "@id" }, closeMatch: { "@id": "skos:closeMatch", "@type": "@id" },
        seeAlso: { "@id": "rdfs:seeAlso", "@type": "@id" }, isDefinedBy: { "@id": "rdfs:isDefinedBy", "@type": "@id" },
      },
      "@id": NS, "@type": "owl:Ontology",
      label: "Hologram OS — Holo Telemetry vocabulary (hostel:)",
      comment: "System-wide observability as content-addressed UOR objects (ADR-0073): the OpenTelemetry data model (Span · Metric · LogRecord · Resource · Scope) and W3C Trace Context, made self-verifying. A span IS a PROV-O Activity and its W3C trace-id / span-id are DERIVED from the content of the operation (re-derivable, Law L5); wall-clock measurements are honestly marked hostel:rederivable=false and host-attested. Mints only the genuinely-new substrate terms; every OpenTelemetry / W3C near-equivalent declares skos:closeMatch to its ratified authority. This document is itself valid JSON-LD, re-derived from holo-telemetry.mjs (no drift).",
      "dcterms:license": "https://creativecommons.org/publicdomain/zero/1.0/",
      "@graph": [
        term("Span", "rdfs:Class", "Span", "A single timed operation in a trace. A specialization of a PROV-O Activity whose W3C span-id is derived from its structural content (re-derivable, Law L5).", { subClassOf: "prov:Activity", closeMatch: "otel:Span" }),
        term("Trace", "rdfs:Class", "Trace", "The DAG of spans sharing one W3C trace-id, each prov:wasInformedBy its parent. The OpenTelemetry trace expressed as a self-verifying PROV-O receipt.", { subClassOf: "prov:Entity", closeMatch: "otel:Trace" }),
        term("Metric", "rdfs:Class", "Metric data point", "An observed measurement (sum · gauge · histogram). Its identity (name·unit·kind·labels) re-derives; its value is host-attested, not re-derived.", { subClassOf: "prov:Entity", closeMatch: "otel:Metric" }),
        term("LogRecord", "rdfs:Class", "Log record", "A structured log event, optionally correlated to a span via W3C trace-id / span-id.", { subClassOf: "prov:Entity", closeMatch: "otel:LogRecord" }),
        term("traceId", "rdf:Property", "trace id", "The W3C Trace Context 16-byte trace identifier, here the low bytes of a content address.", { range: "xsd:hexBinary", seeAlso: "https://www.w3.org/TR/trace-context/" }),
        term("spanId", "rdf:Property", "span id", "The W3C Trace Context 8-byte span identifier, derived from the span's structural content (re-derivable).", { range: "xsd:hexBinary", seeAlso: "https://www.w3.org/TR/trace-context/" }),
        term("rederivable", "rdf:Property", "re-derivable", "TRUE if a fact re-derives under Law L5 (structural / provenance); FALSE if it is a wall-clock measurement carried as a host-attested claim. The honest-split flag — no W3C equivalent.", { domain: "hostel:Metric", range: "xsd:boolean" }),
        term("measurement", "rdf:Property", "attested measurement", "A wall-clock measurement block (start/end/duration or value) signed by the local host key — NOT re-derived. Honest provenance for the one thing telemetry cannot recompute.", { range: "xsd:string" }),
        term("durationNano", "rdf:Property", "duration (ns)", "A span's wall-clock duration in nanoseconds — an attested measurement, never re-derived.", { range: "xsd:long", closeMatch: "schema:Duration" }),
      ],
    };
}

// ── browser binding: window.HoloTelemetry over the shared κ-store, once window.HoloApp is ready. The
// SDK (holo-sdk.js) lazily wraps this into flat verbs; the theme runtime auto-boots it system-wide
// (Law L2, one canonical wire — no per-app script tag). Conscience + host identity are wired if present.
if (typeof window !== "undefined") {
  const wire = async () => {
    try {
      if (!window.HoloApp || window.HoloTelemetry) return;
      const sha256hex = async (b) => { const d = await crypto.subtle.digest("SHA-256", u8(b)); return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join(""); };
      const host = window.HoloIdentity ? { id: (window.HoloIdentity.did || "local"),
        sign: (b) => (window.HoloIdentity.sign ? window.HoloIdentity.sign(b) : null),
        verify: (b, s) => (window.HoloIdentity.verify ? window.HoloIdentity.verify(b, s) : true) } : null;
      window.HoloTelemetry = makeTelemetry({ store: window.HoloApp.store, hash: sha256hex,
        conscience: window.HoloConscience || null, host,
        resource: { "service.name": (location && location.pathname) || "hologram.os" } });
      if (document.documentElement) document.documentElement.dispatchEvent(new Event("holo-telemetry-ready"));
    } catch (e) { /* leave unset; SDK verbs fail-soft */ }
  };
  if (window.HoloApp) wire();
  else if (document.documentElement) document.documentElement.addEventListener("holo-app-ready", wire, { once: true });
}
