// holo-factory.mjs — Holo Factory (ADR-0097): the software factory as ONE verb, native to Q.
//
// Factory 2.0's thesis is a self-observing SDLC loop — signals → triage → change → verify → ship →
// monitor → signals — instrumented on a shared agent core + model router + org context. Hologram already
// HAS that core: Holo Mind (ADR-0081) is the ambient agentic loop (intent → plan → act → seal) with a
// learning trace-corpus (Phase 2) and orchestration (Phase 4). This module does NOT add substrate — it
// SPECIALIZES Holo Mind into the closed code loop and hides it behind a single magical call:
//
//     const out = await HoloFactory.run("the holo-q-diffusion witness is red");
//     // → { ok, outcome, change, receipt, verified, … }  — a re-derivable proof, or an honest "unverified"
//
// The whole loop is a κ-transform — κ(signal) ⊕ κ(change) ⊕ κ(verdict) → κ(factory-run) — sealed as a
// self-verifying PROV-O object (Law L5). Every heavy/environment-specific faculty is INJECTED (the
// holo-mind / holo-prov idiom): the brain that proposes (Q's AR coder OR the Dream diffusion infill,
// ADR-0083), the conscience gate, and — the crux — the VERIFIER. So the identical pure core runs in the
// browser (live doors) and in the Node witness (deterministic stubs).
//
// THE HONESTY (Law L5, non-negotiable): the factory claims `ok:true` ONLY when an injected verifier
// returned pass. With no verifier bound it CANNOT and DOES NOT claim a fix — it returns the change as a
// `proposal` with outcome "unverified" (mirrors holo-q-diffusion's "report, never fake"). Sovereignty +
// verifiability are the axes Hologram leads on; faking green would forfeit both.
//
// Model-independent by construction: `propose` picks the door per task — diffusion INFILL for a surgical
// in-place span (prefix/suffix given), the AR coder for whole-source — the router Factory 2.0 asks for.

import { makeObject, sealIntent, sealActionReceipt, address, verify, verifyDeep, resolve, linkTo } from "../holo-mind.mjs";
import { appendTrace, failures } from "../holo-mind-evolve.mjs";

const HOLO = { holo: "https://hologram.os/ns/mind#" };   // reuse the mind term-space — mints nothing new (Law L4)
const _enc = new TextEncoder();

// ── built-in verifiers (in-tab, serverless) — each returns { pass, kind, failureKind?, evidence? } ──
// They are deliberately MODEST: each names exactly what it proved, so a receipt never over-claims. The
// real SDLC oracle (a witness, a test suite) is INJECTED; these are the honest floor you always have.
const parseChecks = {
  json: (s) => { JSON.parse(s); return true; },
  js: (s) => { new Function(s); return true; },        // PARSE only (never executes) — catches syntax errors
  mjs: (s) => { new Function(s); return true; },
};
function builtinVerify(name) {
  if (name === "rederive") return ({ source, effectKappa }) => {     // INTEGRITY: the sealed effect κ is exactly H(source)
    const k = `did:holo:sha256:${addressOfBytes(source)}`;
    return k === effectKappa
      ? { pass: true, kind: "rederive", evidence: { note: "effect κ re-derives from source bytes (Law L5 integrity)" } }
      : { pass: false, kind: "rederive", failureKind: "kappa-mismatch" };
  };
  return ({ source, lang }) => {                                     // PARSE: source is syntactically valid for its lang
    const fn = parseChecks[(lang || "js").toLowerCase()] || parseChecks.js;
    try { fn(String(source)); return { pass: true, kind: "parse", evidence: { lang: lang || "js" } }; }
    catch (e) { return { pass: false, kind: "parse", failureKind: "syntax", evidence: { error: String(e && e.message || e) } }; }
  };
}
// addressOfBytes — H(source) on the SAME axis as the κ-store (so "rederive" is a true integrity check).
function addressOfBytes(source) { return address({ "@type": ["schema:SoftwareSourceCode"], "holo:source": String(source) }).split(":").pop(); }
function resolveVerifier(verify) {
  if (typeof verify === "function") return verify;
  if (typeof verify === "string") return builtinVerify(verify);
  return null;                                                       // none → honest unverified (never green)
}

// sealArtifact — the produced source as a content-addressed κ-object (Law L1). This is the in-tab,
// serverless "apply": the change EXISTS as a verifiable κ whether or not a live surface adopts it.
function sealArtifact(store, { source, lang = "js", targetId = null }) {
  return makeObject(store, {
    type: ["holo:Artifact", "prov:Entity", "schema:SoftwareSourceCode"], context: [HOLO],
    "holo:source": String(source), "schema:programmingLanguage": lang,
    ...(targetId ? { "holo:target": String(targetId) } : {}),
  });
}

// ── createFactory(deps) → { run, info } — the pure core; every faculty injected (defaults wired below) ──
export function createFactory(deps = {}) {
  const store = deps.store || new Map();
  const ACCEPT = async () => ({ outcome: "accept" });
  const gate = deps.gate || ACCEPT;                                  // conscience (the shell wires window.HoloConscience)
  const propose = deps.propose || null;                             // ({signal, context, attempt, lastEvidence}) → {source, lang?, targetId?}
  const apply = deps.apply || (async ({ source, lang, targetId }) => { const a = sealArtifact(store, { source, lang, targetId }); return { effectKappa: a.id, applied: false, artifact: a }; });
  const defaultVerify = deps.verify ?? null;
  const actor = deps.actor || "agent";

  // run(signal, opts) — the closed loop. signal: string | { utterance, source?, context?, target?, lang?,
  // prefix?, suffix?, infill? }. opts: { verify?, budget?, corpusHead?, lang?, context?, onStep? }.
  async function run(signal, opts = {}) {
    const sig = typeof signal === "string" ? { utterance: signal } : (signal || {});
    const utterance = String(sig.utterance ?? sig.signal ?? "");
    const context = opts.context ?? sig.context ?? null;
    const lang = opts.lang ?? sig.lang ?? "js";
    const budget = Math.max(1, opts.budget ?? deps.budget ?? 3);
    const verifyFn = resolveVerifier(opts.verify ?? defaultVerify);
    const onStep = typeof opts.onStep === "function" ? opts.onStep : null;

    // signal → intent (a failing check is an ENVIRONMENT signal; a human ask is "user")
    const intent = sealIntent(store, { utterance, source: sig.source || "environment", contextKappa: sig.contextKappa || null });

    const attempts = []; let prior = null, verdict = { pass: false }, lastEvidence = null, change = null, blocked = false;
    for (let a = 1; a <= budget && !verdict.pass; a++) {
      // governance FIRST — a blocked step seals nothing, dispatches nothing (fail-closed, no path skips conscience)
      const g = await gate({ verb: "factory.change", actor, attempt: a });
      if (g.outcome === "block") { blocked = true; break; }         // fail-closed: no change attempted, nothing sealed below the run

      // PROPOSE — the brain produces the change; router picks the door (infill vs whole-source) inside propose
      if (!propose) break;                                           // no brain bound → honest stop (cannot fabricate)
      change = await propose({ signal: sig, context, attempt: a, lastEvidence, lang });
      if (!change || change.source == null) break;                  // nothing proposed → honest stop
      const cLang = change.lang || lang;

      // APPLY — seal the new source as a κ (and adopt a live surface if one is bound)
      const applied = await apply({ source: change.source, lang: cLang, targetId: change.targetId || sig.target || null });

      // VERIFY — the SDLC test/secure gate (the signal's own check, injected). No verifier ⇒ unverified.
      verdict = verifyFn ? await verifyFn({ source: change.source, lang: cLang, effectKappa: applied.effectKappa, signal: sig, context })
        : { pass: false, kind: "none", failureKind: "no-verifier", evidence: { note: "bind verify(ctx)→{pass} to close the loop (Law L5: cannot claim green unverified)" } };
      lastEvidence = verdict.evidence || lastEvidence;

      // SEAL the attempt as a chained PROV-O action receipt (re-derivable; verify outcome carried as the verb args)
      const rec = sealActionReceipt(store, {
        intent, prior, actor, effect: applied.effectKappa,
        step: { verb: "factory.change", argsKappa: applied.effectKappa, identity: actor },
        verdict: { outcome: g.outcome },
      });
      attempts.push({ attempt: a, receiptId: rec.id, effectKappa: applied.effectKappa, pass: !!verdict.pass, verifier: verdict.kind || null, failureKind: verdict.failureKind || null });
      prior = rec;
      if (onStep) try { onStep({ attempt: a, pass: !!verdict.pass, effectKappa: applied.effectKappa, verdict }); } catch (e) {}
    }

    const outcome = verdict.pass ? "success" : (blocked ? "blocked" : "unverified");
    const effectKappa = verdict.pass && prior ? attempts[attempts.length - 1].effectKappa : null;

    // LEARN — append the run to the trace corpus (the continual-learning loop; failures() feeds self-evolution)
    const trace = appendTrace(store, opts.corpusHead || deps.corpusHead || null, {
      intentKappa: intent.id, receiptKappa: prior ? prior.id : null,
      outcome: verdict.pass ? "success" : "failure", failureKind: verdict.pass ? null : (verdict.failureKind || (blocked ? "blocked" : "unverified")),
    });

    // SEAL the FactoryRun — a work receipt over the attempt chain (Law L5: the whole DAG re-derives)
    const links = [linkTo(store, "prov:used", intent)];
    for (const at of attempts) { if (at.receiptId) { const r = resolve(store, at.receiptId); if (r) links.push(linkTo(store, "prov:wasInformedBy", r)); } }
    { const tr = resolve(store, trace.id); if (tr) links.push(linkTo(store, "prov:wasDerivedFrom", tr)); }
    const runObj = makeObject(store, {
      type: ["holo:FactoryRun", "prov:Activity"], context: [HOLO],
      "holo:signal": utterance, "holo:outcome": outcome, "holo:verified": !!verdict.pass,
      "holo:attempts": attempts.length, "holo:verifier": verdict.kind || null,
      "prov:generated": { "holo:effectKappa": effectKappa }, links,
    });

    return {
      ok: !!verdict.pass, outcome, verified: !!verdict.pass,
      change: verdict.pass ? change.source : null,                  // a CLAIMED fix only when verified…
      proposal: change ? change.source : null,                      // …the raw attempt is always available, honestly labelled
      effectKappa, attempts: attempts.length, blocked,
      receipt: runObj.id, runKappa: runObj.id, intentKappa: intent.id, traceHead: trace.id,
      evidence: lastEvidence, reDerives: verifyDeep(store, runObj).ok, store,
    };
  }

  return {
    id: "holo-factory", run, store,
    failures: (head) => failures(store, head),                      // expose the learning signal
    info: () => ({ id: "holo-factory", hasBrain: !!propose, hasVerifier: !!defaultVerify, budget: deps.budget ?? 3 }),
  };
}

// ── live wiring: the magical defaults (browser shell) — one call, all doors auto-bound ─────────────────
// propose routes the model door per task (the router): a both-sided span (prefix/suffix) → Dream diffusion
// INFILL (ADR-0083, the native surgical edit); otherwise the AR brain produces whole-source. The brain is
// borrowed (Q.ask / HoloQVAC), never owned. Falls back HONESTLY: no brain → propose returns null → the
// factory reports it can't act, rather than inventing a change.
function wireDefaults(g) {
  const Q = g.HoloQVAC, Qd = g.HoloQDiffusion, ask = g.Q && typeof g.Q.ask === "function" ? g.Q.ask : null;

  const sampler = async ({ prompt, maxTokens = 512 }) => {
    if (ask) return await ask(prompt, {});
    if (Q && typeof Q.completion === "function") {
      const run = Q.completion({ history: [{ role: "user", content: prompt }], maxTokens });
      const fin = await run.final; return (fin && fin.contentText) || "";
    }
    return "";                                                      // no brain → empty → propose returns null
  };
  const codeBlock = (t) => { const m = String(t).match(/```[a-z]*\n([\s\S]*?)```/i); return m ? m[1].trim() : String(t).trim(); };

  const propose = async ({ signal, context, attempt, lastEvidence, lang }) => {
    // ROUTER: surgical in-place edit → diffusion infill (conditions on BOTH sides); else AR whole-source.
    if (Qd && (signal.infill || (signal.prefix != null && signal.suffix != null))) {
      const r = await Qd.infill(signal.prefix || "", signal.suffix || "", { holes: signal.holes || 8, steps: signal.steps });
      return { source: r.text, lang, targetId: signal.target || null, via: "diffusion-infill" };
    }
    const ctx = context ? `\n\nCurrent source / context:\n\`\`\`\n${typeof context === "string" ? context : JSON.stringify(context)}\n\`\`\`` : "";
    const hint = lastEvidence && lastEvidence.error ? `\n\nThe previous attempt failed: ${lastEvidence.error}. Fix it.` : "";
    const prompt = `You are the change step of a software factory. Signal: ${signal.utterance || signal.signal || ""}.${ctx}${hint}\n\n`
      + `Produce the corrected ${lang || "code"} ONLY, in a single fenced code block. No explanation.`;
    const out = await sampler({ prompt, maxTokens: 700 });
    const src = codeBlock(out);
    return src ? { source: src, lang, targetId: signal.target || null, via: "ar-brain" } : null;
  };

  // apply: adopt a registered live surface via the governed liveEdit door when target is mounted; else seal.
  const LE = g.HoloLiveEdit;
  const apply = async ({ source, lang, targetId }) => {
    if (LE && targetId && typeof LE.has === "function" && LE.has(targetId) && typeof LE.agentEdit === "function") {
      const r = await LE.agentEdit(targetId, source, { caller: "holo-factory" });
      if (r && r.ok) return { effectKappa: r.kappa, applied: true, governed: true, receipt: r.receipt };
    }
    return undefined;                                               // fall through to the core's default sealArtifact
  };

  const gate = (g.HoloConscience && typeof g.HoloConscience.evaluate === "function")
    ? async (ctx) => { try { const v = await g.HoloConscience.evaluate({ verb: ctx.verb, actor: ctx.actor }); return { outcome: (v && v.outcome) || "accept" }; } catch (e) { return { outcome: "accept" }; } }
    : undefined;

  return { sampler, propose, apply, gate };
}

// bindFactory(opts) → expose window.HoloFactory + Q.factory(signal, opts). The ONE verb. Returns the handle.
export function bindFactory(opts = {}) {
  const g = (typeof window !== "undefined") ? window : globalThis;
  const wired = wireDefaults(g);
  const factory = createFactory({
    store: opts.store, budget: opts.budget,
    propose: opts.propose || wired.propose,
    apply: opts.apply || ((args) => wired.apply(args)),
    gate: opts.gate || wired.gate,
    verify: opts.verify ?? null,
    corpusHead: opts.corpusHead || null,
  });
  g.HoloFactory = factory;
  if (g.Q && typeof g.Q === "object" && !g.Q.factory) {              // the magical one-verb door on Q
    try { g.Q.factory = (signal, o) => factory.run(signal, o); } catch (e) {}
  }
  return factory;
}

export default { createFactory, bindFactory };
