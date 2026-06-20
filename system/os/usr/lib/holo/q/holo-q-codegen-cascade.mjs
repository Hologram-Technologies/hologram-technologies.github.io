// holo-q-codegen-cascade.mjs — make Create's FIRST build progressive instead of a one-shot heavy-model wait.
// Today Create renders an instant template, then jumps straight to the full coder (Coder-1.5B/7B) — so the
// user stares at the template until ~1.5GB has loaded. This wires the cascade + per-device tiering into
// codegen: the same intent flows through ORDERED tiers, each producing a COMPLETE document that REPLACES the
// last (blurry→sharp), so the user sees real model output as soon as the FASTEST-resident coder can speak,
// upgrading to the full coder when it lands — and the tier set is chosen per device (planTiers), so a phone
// never waits on a desktop-sized model.
//
//   createTieredCodegen({ tiers, template, maxTokens }) → { generate({ prompt, current, onDoc, signal }) }
//     tiers   : ordered [{ name, sampler, whenReady? }]  — sampler:(messages,opts)->async-iter of text deltas
//               (the EXACT holo-q-codegen `device` shape); whenReady?: async ()->void resolves when that tier's
//               model is resident (draft fast, target slow). A tier with no sampler/ready is skipped.
//     template: (prompt,current)->string — the instant deterministic floor (no model). Always emitted first.
//     onDoc(doc, tier): called with each progressively-better FULL document (the caller renders/replaces it).
//   → { source, tier }  — the best (last successful) document + which tier produced it.
//
//   tiersFromPlan(plan, samplers) → ordered tiers from a planTiers() result + the caller's per-tier samplers.
//
// Pure controller — samplers + readiness are INJECTED, so the progression/fallback are witnessed in Node; the
// heavy model loads happen only in the browser. Reuses holo-q-codegen's prompt + HTML extraction (one source).

import { buildMessages, extractHTML } from "./holo-q-codegen.js";

export function createTieredCodegen({ tiers = [], template = null, maxTokens = 2048 } = {}) {
  async function generate({ prompt, current = null, onDoc = null, signal = null } = {}) {
    const aborted = () => !!(signal && signal.aborted);
    const emit = (doc, tier) => { if (doc && onDoc) { try { onDoc(doc, tier); } catch (e) {} } };

    let best = null, bestTier = "none";
    // 1) instant template floor — zero model, renders immediately (this is the part that's already "instant").
    if (template) { let f = ""; try { f = template(prompt, current) || ""; } catch (e) { f = ""; } if (f) { best = f; bestTier = "template"; emit(f, "template"); } }

    // 2) walk the ordered tiers. For each: wait until its model is resident (draft → fast, target → slow), then
    // stream a FULL build, emitting the improving document live; the next tier replaces it when it lands.
    const messages = buildMessages(prompt, current);
    for (const t of tiers) {
      if (aborted()) break;
      if (!t || typeof t.sampler !== "function") continue;
      if (typeof t.whenReady === "function") { try { await t.whenReady(); } catch (e) { continue; } }   // load this tier (the user keeps the best-so-far on screen meanwhile)
      if (aborted()) break;
      let raw = "", streamedDoc = "";
      try {
        for await (const d of t.sampler(messages, { maxTokens, signal })) {
          if (aborted()) break;
          raw += (d && d.delta != null ? d.delta : d);
          const partial = extractHTML(raw);
          if (partial && partial !== streamedDoc) { streamedDoc = partial; emit(partial, t.name); }   // live, this tier
        }
      } catch (e) { continue; }                                   // tier failed mid-stream → keep best-so-far, try next tier
      const doc = extractHTML(raw);
      if (doc) { best = doc; bestTier = t.name; }                 // this tier succeeded → it's the new best (upgrade)
    }
    return { source: best, tier: bestTier };
  }
  return { generate };
}

// createCascadeSampler — the MINIMAL-WIRE form: a single sampler in the EXACT holo-q-codegen `device` shape
// (messages,opts)->async-iter, that internally streams the ordered tiers. It leads with the fastest-resident
// tier and, when a better tier lands, emits a `{ replace: "" }` marker (which holo-q-codegen now honors) so the
// next tier's document REPLACES the prior one in the accumulator — no change to createCodegen or the Create
// specialist; just pass this as `device`. The reset is LAZY (emitted only when a later tier actually starts
// producing), so a tier that fails to load/throw never destroys the document already on screen.
export function createCascadeSampler({ tiers = [] } = {}) {
  return async function* cascadeSampler(messages, opts = {}) {
    const aborted = () => !!(opts.signal && opts.signal.aborted);
    let priorStreamed = false;
    for (const t of tiers) {
      if (aborted()) break;
      if (!t || typeof t.sampler !== "function") continue;
      if (typeof t.whenReady === "function") { try { await t.whenReady(); } catch (e) { continue; } }   // load this tier (draft fast, target slow)
      if (aborted()) break;
      let thisStarted = false;
      try {
        for await (const d of t.sampler(messages, opts)) {
          if (aborted()) break;
          if (!thisStarted) { thisStarted = true; if (priorStreamed) yield { replace: "" }; }   // reset ONLY once a later tier truly produces output
          yield d;
        }
      } catch (e) { if (!thisStarted) continue; }                 // threw before producing → keep the prior tier's doc; else fall through
      if (thisStarted) priorStreamed = true;
    }
  };
}

// tiersFromPlan — turn a planTiers() result + the caller's samplers into the ordered tier list. The plan
// decides WHICH tiers (draft-first on slow/constrained, full target, optional background upgrade) per device;
// the samplers map a tier id → { sampler, whenReady }. Missing samplers are simply dropped (graceful).
export function tiersFromPlan(plan = {}, samplers = {}) {
  const out = [];
  const add = (spec, kind) => {
    if (!spec) return;
    const s = samplers[spec.id] || samplers[kind];
    if (s && typeof (s.sampler || s) === "function") out.push({ name: kind + ":" + spec.id, sampler: s.sampler || s, whenReady: s.whenReady || null });
  };
  if (plan.useCascade) add(plan.draft, "draft");                  // the fast tier the device plan chose to lead with
  add(plan.target, "target");                                     // the device-sized target (low-bit on phones, full on desktops)
  add(plan.upgrade, "upgrade");                                   // optional background-better tier (ample devices only)
  return out;
}

export default { createTieredCodegen, tiersFromPlan };
