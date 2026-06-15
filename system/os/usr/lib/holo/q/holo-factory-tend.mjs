// holo-factory-tend.mjs — the AUTONOMOUS driver for Holo Factory (ADR-0097). Turns the one-shot verb into
// a SELF-OBSERVING loop, and closes the keystone gap: signal → verified fix, hands-off.
//
// THE INSIGHT: a CHECK is simultaneously the monitor AND the oracle. When a check is red it IS the signal
// ("X is broken"); re-running that same check on a candidate IS the verification. So #1 (auto-signal) and #2
// (witness-verified) collapse into one object — the witness idiom. The tender runs every registered check;
// each RED one drives a factory.run whose verifier is that very check; GREEN ones are left untouched (no
// run, no fabrication). A verified fix is SHIPPED durably through the check's own write().
//
// DRIVEN ONLY BY USER INTENT (the hard constraint): nothing fires until the user expresses a standing intent
// via watch(). That sealed holo:Intent (source "user") is the authority every autonomous tend links; the
// conscience gates every change (inherited from the factory — no path skips it); the user stops it. No timer
// arms itself, no act happens, without the user's intent. This is Holo Mind's GoalStack + opt-in scheduler
// discipline (ADR-0081): autonomy is AUTHORIZED, never assumed.

import { sealIntent, makeObject, resolve, linkTo } from "../holo-mind.mjs";

const HOLO = { holo: "https://hologram.os/ns/mind#" };

// A CHECK: { name, read?() → source, verify(source) → { pass, failureKind?, evidence? }, write?(source),
//            signal?, lang?, target?, signalFields? }. read()/write() bind it to a real target (a κ-object,
//            a liveEdit surface, a fetched file). verify() is the pure oracle (parse · a test · a witness).
export function createTender({ factory, store, triage, onSignal } = {}) {
  if (!factory || typeof factory.run !== "function") throw new Error("tender needs a factory (createFactory)");
  const S = store || factory.store || new Map();
  const checks = new Map();
  let intent = null, timer = null, ticking = false;

  const register = (name, spec) => { checks.set(name, { name, ...spec }); return name; };
  const unregister = (name) => checks.delete(name);
  const list = () => [...checks.values()].map((c) => c.name);

  // discover(signal, candidates, opts) — SEMANTIC TRIAGE: locate the target(s) the signal refers to BY MEANING
  // (the injected triage / EmbeddingGemma) and REGISTER a check for each, so the factory fixes what the user
  // DESCRIBED without being told which surface. A candidate carries its own check faculties when it has them
  // (verify/read/write); otherwise it gets a parse-check over its source. Honest: nothing located ⇒ nothing
  // registered + the reason (never guesses a target — Law L5).
  async function discover(signal, candidates = [], opts = {}) {
    if (!triage || typeof triage.locate !== "function") throw new Error("tender has no triage bound (createTender{ triage })");
    const loc = await triage.locate(signal, candidates, opts);
    if (!loc.target) return { located: null, registered: [], reason: loc.reason };
    const registered = [];
    for (const m of loc.matches) {
      const c = m.candidate;
      const name = c.name || ("triage:" + c.id);
      if (typeof c.verify === "function") register(name, { name, verify: c.verify, read: c.read, write: c.write, lang: c.lang, signal: c.signal });
      else register(name, parseCheck(name, { read: c.read, write: c.write, lang: c.lang || "js" }));
      registered.push({ name, id: c.id, score: m.score });
    }
    return { located: loc.target.id, score: loc.score, registered };
  }

  // one pass: monitor every check; each RED one ⇒ a factory.run verified by that same check; ship on green.
  async function tend(opts = {}) {
    const budget = opts.budget ?? 3;
    const results = [];
    for (const c of checks.values()) {
      const cur = c.read ? await c.read() : (c.context ?? null);
      const probe = await c.verify(cur);                              // MONITOR — already green?
      if (probe && probe.pass) { results.push({ name: c.name, status: "green" }); continue; }
      if (onSignal) try { onSignal({ name: c.name, failureKind: probe && probe.failureKind || null }); } catch (e) {}
      // RED ⇒ a SIGNAL. The factory fixes it; the VERIFIER is this very check, re-run on each candidate.
      const res = await factory.run(
        { utterance: c.signal || `${c.name} is red${probe && probe.failureKind ? " (" + probe.failureKind + ")" : ""}`,
          source: "environment", target: c.target || c.name, lang: c.lang, ...(c.signalFields || {}) },
        { verify: async (ctx) => c.verify(ctx.source), budget, context: cur, intent });
      // SHIP — a verified fix is persisted durably through the check's own write() (the loop closes)
      let shipped = false;
      if (res.ok && c.write && res.change != null) { try { await c.write(res.change); shipped = true; } catch (e) { res.shipError = String(e && e.message || e); } }
      results.push({ name: c.name, status: res.ok ? "fixed" : res.outcome, receipt: res.receipt, shipped, runKappa: res.runKappa });
    }
    // seal a FactoryTend receipt over the standing intent + this pass (re-derivable, Law L5)
    const links = [];
    if (intent) { const i = resolve(S, intent.id) || intent; links.push(linkTo(S, "prov:used", i)); }
    const rec = makeObject(S, {
      type: ["holo:FactoryTend", "prov:Activity"], context: [HOLO],
      "holo:checks": results.length, "holo:red": results.filter((r) => r.status !== "green").length,
      "holo:fixed": results.filter((r) => r.status === "fixed").length, "holo:results": results,
      ...(links.length ? { links } : {}),
    });
    return { results, receipt: rec.id, intentKappa: intent ? intent.id : null, green: results.every((r) => r.status === "green" || r.status === "fixed") };
  }

  // watch(utterance, { intervalMs, onTend }) — the OPT-IN autonomous loop. Seals the user's standing intent
  // (the authority every tend links), then — and only then — arms an EDGE-clock ticker (now read at the edge,
  // never inside a sealed object, so the core stays re-derivation-safe). Returns a handle; the user stops it.
  function watch(utterance, { intervalMs = 0, onTend } = {}) {
    intent = sealIntent(S, { utterance: String(utterance || "tend my holospace — keep every check green"), source: "user" });
    const tendNow = async (o) => { if (ticking) return null; ticking = true; try { const r = await tend(o); if (onTend) try { onTend(r); } catch (e) {} return r; } finally { ticking = false; } };
    stop();
    if (intervalMs > 0 && typeof setInterval !== "undefined") timer = setInterval(() => { tendNow(); }, intervalMs);
    return { intent: intent.id, tendNow, stop };
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; return true; } return false; }

  return { register, unregister, list, discover, tend, watch, stop, intent: () => intent && intent.id, store: S };
}

// ── built-in check builders ─────────────────────────────────────────────────────────────────────────
// parseCheck — the in-tab oracle: a target whose source must PARSE for its language (never executes it).
// read/write bind it to a real target (a liveEdit surface, a κ-store entry, an editor buffer).
export function parseCheck(name, { read, write, lang = "js", signal } = {}) {
  const verify = (s) => {
    try { if (lang === "json") JSON.parse(String(s)); else new Function(String(s)); return { pass: true, evidence: { lang } }; }
    catch (e) { return { pass: false, failureKind: "syntax", evidence: { error: String(e && e.message || e) } }; }
  };
  return { name, lang, read, write, verify, signal: signal || `${name}: source does not parse` };
}

// witnessCheck — verify by re-running an injected witness predicate (the SDLC oracle). `run(source) →
// {pass, failureKind?, evidence?}` is the witness's own logic, made browser-runnable. This is how a red
// gate row becomes a closed loop: the row's witness IS the verifier.
export function witnessCheck(name, { read, write, run, lang = "js", signal } = {}) {
  return { name, lang, read, write, signal: signal || `${name}: witness is red`, verify: async (s) => { try { return await run(s); } catch (e) { return { pass: false, failureKind: "witness-error", evidence: { error: String(e && e.message || e) } }; } } };
}

// gateChecks — ingest the OS conformance gate's own output (the EARL report) into checks: every FAILED row
// is a signal. `resolveSource(row)` provides the target's current source + write (when in-tab editable);
// `witnessFor(row)` (optional) provides a browser-runnable verifier so the loop CLOSES — without it the row
// surfaces as an honest unverified PROPOSAL (a repo-file row can't be written from a serverless tab). Pure
// given the injected report + resolvers (the browser fetches /os/etc/earl-report.jsonld; the witness stubs it).
export function gateChecks(report, { resolveSource, witnessFor } = {}) {
  const g = (report && (report["@graph"] || report.assertions || report["earl:assertions"])) || [];
  const out = [];
  for (const a of g) {
    const res = a["earl:result"] || a.result; if (!res) continue;
    const outcome = (res["earl:outcome"] && (res["earl:outcome"]["@id"] || res["earl:outcome"])) || res.outcome || "";
    if (!String(outcome).includes("failed")) continue;               // GREEN rows are not signals
    const test = a["earl:test"] || a.test || {};
    const id = (test["@id"] || "").split("#").pop() || (test["dcterms:title"] || "row");
    const src = resolveSource ? resolveSource(test) : null;          // { read, write } | null (read-only repo row)
    const run = witnessFor ? witnessFor(test) : null;
    const base = { name: "gate:" + id, signal: `conformance row #${id} is red`, lang: "js", target: id,
      read: src && src.read, write: src && src.write };
    const proposalOnly = async () => ({ pass: false, failureKind: "no-in-tab-oracle", evidence: { note: "repo-level row — surfaces as a proposal; bind witnessFor(row) to close it" } });
    out.push(run ? witnessCheck(base.name, { ...base, run }) : { ...base, verify: proposalOnly });
  }
  return out;
}

export default { createTender, parseCheck, witnessCheck, gateChecks };
