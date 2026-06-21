// holo-telemetry-tap.mjs — THE PERCEPTION TAP (S0 of the autonomy spine: sense → reason → speak).
// Holo Telemetry (holo-telemetry.mjs, ADR-0073) is a complete, witnessed observability RUNTIME — but a
// runtime observes nothing until something flows through it. This is that something: the thin adapter that
// turns the OS's already-live signal seams into content-addressed telemetry, so the system can finally SEE
// its own state. It mints no new measurement and trusts no emitter — it re-expresses facts the seams
// ALREADY produce (the heal loop's health summary, an app's open/close, the conformance gate's verdict) as
// PROV-O spans / metrics / logs whose W3C ids RE-DERIVE from content (Law L5). Tap a fact, get a κ; hold the
// κ, re-derive the fact. Tamper the fact, the id breaks. Perception with no new trust.
//
// THREE SEAMS, the three that already emit signal with zero new instrumentation in the source of truth:
//   • observeHeal(tick)  — the autonomous heal loop (holo-heal-supervisor.mjs tick() → {summary,flaky,…}).
//                          A sweep is a span; healthy/healed/unresolved are gauges; each repair + each
//                          unresolved κ is a log record. The OS's self-healing becomes self-OBSERVING.
//   • observeApp(event)  — an app's lifecycle (open/close/focus), the shell's launch seam. A counter + a
//                          correlated log: which app, when, how it left. Usage made legible, locally.
//   • observeGate(report)— the conformance gate's verdict (gate.mjs rows → {name,ok,required}). Gauges for
//                          passing/failing; a WARN log per failing REQUIRED row. The OS watches its own gate.
//
// Every observe() returns the sealed κ(s) so a caller (or a witness) can verify(κ) and prove the signal
// re-derives. NO snapshot/fold here — folding the stream into a single "what's true now" coherence object
// is S1's job (it reads these κs); the tap's sole contract is: real seam in, verifiable signal out.
//
// Pure + isomorphic + dependency-injected, exactly like holo-telemetry.mjs / holo-heal-supervisor.mjs: the
// witness drives it in Node over an in-memory store; the browser binds it over window.HoloTelemetry once the
// observability plane is ready. No clock in the core (telemetry carries the injected `now`). Local-first —
// the tap WRITES signals to the κ-store; egress stays telemetry's conscience-gated exportTo (default-deny).

// Severity numbers follow the OpenTelemetry SeverityNumber scale (the same logger.emit() takes).
const SEV = { DEBUG: 5, INFO: 9, WARN: 13, ERROR: 17 };

// makeTap({ telemetry, service }) → { observeHeal, observeApp, observeGate, tracer, meter, logger }.
//   telemetry : a makeTelemetry() instance (the observability runtime — the κ-store IS the collector).
//   service   : a label for this tap's scope (default "holo.tap"); names the tracer/meter/logger.
export function makeTap({ telemetry, service = "holo.tap" } = {}) {
  if (!telemetry || typeof telemetry.tracer !== "function") throw new Error("makeTap needs a makeTelemetry() instance");
  const tracer = telemetry.tracer(service, "1.0");
  const meter = telemetry.meter(service);
  const logger = telemetry.logger(service);

  // ── SEAM 1 · the autonomous heal loop ──────────────────────────────────────────────────────────────
  // observeHeal(tick) — re-express one supervisor tick (its {summary, flaky, at, attestation}) as telemetry.
  // The sweep is a single span (so a trace of sweeps is a PROV-O DAG over time); the counts are gauges; each
  // repair receipt and each still-unresolved κ is a correlated log record. Returns every sealed κ for proof.
  async function observeHeal(tick = {}) {
    const s = tick.summary || {};
    const total = s.total | 0, healthy = s.healthy | 0, healed = s.healed | 0;
    const unresolved = s.unresolved | 0, cooling = s.cooling | 0, deferred = s.deferred | 0;
    const whole = unresolved === 0 && deferred === 0 && cooling === 0;       // every reachable non-anchor object healthy
    // the sweep span — its structural core (reason · the counts) re-derives; its timing is attested.
    const span = tracer.startSpan("heal.sweep", { kind: "internal", attributes: {
      reason: String((tick.attestation && tick.attestation.reason) || "tick"),
      total, healthy, healed, unresolved, cooling, deferred, whole,
    } });
    const sealed = await span.end({ status: unresolved > 0 ? "degraded" : "ok" });
    const metrics = {};
    metrics.healthy = await meter.gauge("heal.healthy", { unit: "1" }).record(healthy, { reason: "sweep" });
    metrics.healed = await meter.counter("heal.healed", { unit: "1" }).record(healed, { reason: "sweep" });
    metrics.unresolved = await meter.gauge("heal.unresolved", { unit: "1" }).record(unresolved, { reason: "sweep" });
    metrics.flaky = await meter.gauge("heal.flaky", { unit: "1" }).record((tick.flaky || []).length, { reason: "sweep" });
    const corr = { traceId: sealed.traceId, spanId: sealed.spanId };
    const logs = [];
    // one INFO per repair (the verifiable PROV-O heal trail, now correlated to the sweep span)…
    for (const r of (s.receipts || [])) {
      logs.push(await logger.emit(SEV.INFO, "heal.repaired", { ...corr,
        attributes: { kappa: String((r && (r.kappa || r["@id"])) || ""), path: String((r && r.path) || "") } }));
    }
    // …and one WARN per still-unresolved κ (the honest negative signal — what the OS could NOT recover).
    for (const u of (s.unresolvedList || [])) {
      logs.push(await logger.emit(SEV.WARN, "heal.unresolved", { ...corr, attributes: { kappa: String(u || "") } }));
    }
    return { span: sealed, metrics, logs, whole };
  }

  // ── SEAM 2 · an app's lifecycle ─────────────────────────────────────────────────────────────────────
  // observeApp({ app, phase, route, at }) — phase ∈ open|close|focus|blur|error. A counter (so usage
  // aggregates) plus one correlated log (so a session reads as a sequence). The app is named, never the
  // content of what the user did — usage shape, not surveillance.
  async function observeApp(event = {}) {
    const app = String(event.app || "unknown"), phase = String(event.phase || "open"), route = String(event.route || "");
    const count = await meter.counter("app." + phase, { unit: "1", attributes: { app } }).record(1, { route });
    const sev = phase === "error" ? SEV.ERROR : SEV.INFO;
    const log = await logger.emit(sev, "app." + phase, { attributes: { app, route } });
    return { count, log };
  }

  // ── SEAM 3 · the conformance gate's verdict ─────────────────────────────────────────────────────────
  // observeGate(report) — report = { rows: [{ name, ok, required }] } (the shape gate.mjs already iterates).
  // Gauges for passing/failing/required-failing; a WARN log per failing REQUIRED row (the rows that block a
  // ship). The OS observes its own conformance, so S2 can reason over a red row as a signal.
  async function observeGate(report = {}) {
    const rows = Array.isArray(report.rows) ? report.rows : [];
    const passing = rows.filter((r) => r && r.ok).length;
    const failingReq = rows.filter((r) => r && !r.ok && r.required);
    const m = {};
    m.total = await meter.gauge("gate.total", { unit: "1" }).record(rows.length);
    m.passing = await meter.gauge("gate.passing", { unit: "1" }).record(passing);
    m.failing = await meter.gauge("gate.failing", { unit: "1" }).record(rows.length - passing);
    m.failingRequired = await meter.gauge("gate.failing_required", { unit: "1" }).record(failingReq.length);
    const logs = [];
    for (const r of failingReq) logs.push(await logger.emit(SEV.WARN, "gate.red", { attributes: { row: String(r.name || "") } }));
    return { metrics: m, logs, green: failingReq.length === 0 };
  }

  // ── SEAM 4 · "the +" ingest → MAP ────────────────────────────────────────────────────────────────────
  // observeIngest(graph) — re-express one ingested source's mapping (holo-map's HyperGraph) as telemetry.
  // This is the REFLEX TRIGGER of "the +": the act of ingesting+mapping emits a verifiable signal that the
  // REASON layer (Q) subscribes to, so a brief is produced with NO query. The span carries the REAL graph
  // stats (entity/claim counts, the graphClosure κ, the source κ) — adoption, not a mock — and re-derives
  // from content (Law L5). Gauges aggregate ingestion volume; one INFO log per source names what arrived.
  // graph = a holo-map HyperGraph ({ "holo:source"|"holo:sources", "holo:stats", "holo:graphClosure" }).
  async function observeIngest(graph = {}) {
    const st = graph["holo:stats"] || {};
    const entities = st.entities | 0, claims = st.claims | 0, provenance = st.provenance | 0;
    const sources = Array.isArray(graph["holo:sources"]) ? graph["holo:sources"]
                   : (graph["holo:source"] ? [graph["holo:source"]] : []);
    const closure = String(graph["holo:graphClosure"] || "");
    // the mapping span — its structural core (the counts + the closure κ) re-derives; timing is attested.
    const span = tracer.startSpan("ingest.mapped", { kind: "internal", attributes: {
      entities, claims, provenance, sources: sources.length, graphClosure: closure,
    } });
    const sealed = await span.end({ status: entities > 0 ? "ok" : "empty" });
    const corr = { traceId: sealed.traceId, spanId: sealed.spanId };
    const metrics = {};
    metrics.entities = await meter.gauge("ingest.entities", { unit: "1" }).record(entities, { reason: "mapped" });
    metrics.claims = await meter.counter("ingest.claims", { unit: "1" }).record(claims, { reason: "mapped" });
    metrics.sources = await meter.counter("ingest.sources", { unit: "1" }).record(sources.length, { reason: "mapped" });
    const logs = [];
    for (const s of sources) logs.push(await logger.emit(SEV.INFO, "ingest.source", { ...corr, attributes: { source: String(s), closure } }));
    return { span: sealed, metrics, logs, closure, hasContent: entities > 0 };
  }

  // ── SEAM 5 · a content-address REFUSAL (the SW's 409 Safety-Stop) ─────────────────────────────────────
  // observeRefusal({ kind, rel, want, got, axis }) — re-express a Service-Worker refusal (Law L5, fail-closed)
  // as telemetry, so the OS SEES its own fail-closed events instead of them being invisible — the exact gap
  // the 2026-06-21 Safety-Stop exposed. kind ∈ "path" (one object didn't re-derive → possible tamper / partial
  // transfer) | "closure" (the whole pin set is untrusted → a mis-sealed deploy). A counter per kind (so
  // refusals aggregate) + one WARN log naming what was refused. want/got are content κ, not PII. Returns the
  // sealed κ(s) so a witness can verify the signal re-derives, like every other seam.
  async function observeRefusal(event = {}) {
    const kind = String(event.kind || "path"), rel = String(event.rel || ""), axis = String(event.axis || "sha256");
    const count = await meter.counter("refusal." + kind, { unit: "1" }).record(1, { rel });
    const log = await logger.emit(SEV.WARN, "safety.refusal", { attributes: { kind, rel, axis, want: String(event.want || ""), got: String(event.got || "") } });
    return { count, log };
  }

  return { observeHeal, observeApp, observeGate, observeIngest, observeRefusal, tracer, meter, logger, SEV };
}

// ── browser binding: window.HoloTap over window.HoloTelemetry, once the observability plane is ready. Like
// holo-telemetry.mjs's own auto-wire — no per-app script tag (Law L2, one canonical wire). The LIVE seam
// wiring (supervisor.tick → HoloTap.observeHeal, the shell's launch → observeApp) is done by their owners
// where they already run; this just makes the tap reachable. Fail-soft: if telemetry is absent, stay unset.
if (typeof window !== "undefined") {
  const wire = () => {
    try {
      if (!window.HoloTelemetry || window.HoloTap) return;
      window.HoloTap = makeTap({ telemetry: window.HoloTelemetry, service: (location && location.pathname) || "holo.tap" });
      if (document.documentElement) document.documentElement.dispatchEvent(new Event("holo-tap-ready"));
    } catch (e) { /* leave unset; callers fail-soft */ }
  };
  if (window.HoloTelemetry) wire();
  else if (document.documentElement) document.documentElement.addEventListener("holo-telemetry-ready", wire, { once: true });
}

// ── REFUSAL SIGNAL ─────────────────────────────────────────────────────────────────────────────────────
// Hear the Service Worker's "holo:refusal" postMessage (it fires on every 409 Safety-Stop, holo-fhs-sw.js)
// and (1) feed it to the tap so the OS OBSERVES its own fail-closed events — the gap the 2026-06-21 Safety-
// Stop exposed — and (2) surface a SINGLE-PATH refusal (the real-tamper case the design is for) in the Inbox,
// but only where HoloNotify is mounted (the shell). A UNIVERSAL "closure" refusal means the whole site is
// down, so there is no live client/Inbox to file into — its own page self-reports there. Registered
// independent of telemetry readiness so a message is never missed; everything best-effort and try-wrapped, so
// this can never throw onto the boot path. If the tap isn't wired yet, observeRefusal simply no-ops (the SW's
// own console.error stays the floor).
if (typeof navigator !== "undefined" && navigator.serviceWorker && typeof navigator.serviceWorker.addEventListener === "function") {
  try {
    navigator.serviceWorker.addEventListener("message", (ev) => {
      const d = ev && ev.data;
      if (!d || d.type !== "holo:refusal") return;
      try { if (window.HoloTap && window.HoloTap.observeRefusal) window.HoloTap.observeRefusal(d); } catch (e) { /* observe is best-effort */ }
      try {
        if (d.kind === "path" && window.HoloNotify && window.HoloNotify.notify) {
          window.HoloNotify.notify({
            id: "holo-refusal:" + String(d.rel || ""),   // collapse repeats of the SAME object into one living note
            category: "action", severity: "warn", sender: "Safety", icon: "🛡",
            title: "An object failed verification",
            body: "“" + String(d.rel || "an object") + "” didn’t match its fingerprint and was refused. Nothing unverified was loaded.",
          });
        }
      } catch (e) { /* Inbox is best-effort; absent in app frames */ }
    });
  } catch (e) { /* serviceWorker messaging unavailable → the SW's console.error remains the floor */ }
}
