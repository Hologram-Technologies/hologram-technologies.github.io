// holo-strand-rules.mjs — P4 of the unification: VALIDATION RULES AS CHAIN-REFERENCED κ. Holochain's
// integrity zome makes "what counts as valid" an explicit, versioned artifact — not implicit code. This
// brings that to the spine: a RULESET is a content-addressed κ-object (declarative, data-only, so it
// re-derives anywhere), ADOPTING one is itself a `ruleset` entry on the source chain (ordered: it says
// "from here on, ruleset κX governs"), and every later entry is provably validated under the ruleset that
// governed it. Change any rule → a new κ (forkable); tamper an adopted ruleset → its κ stops re-deriving
// (caught). So the operator can PROVE which definition of valid applied to which act, and fork it openly.
//
// Additive + projection-only: holo-strand is unchanged; rules ride as ordinary `ruleset`/payload entries
// and validation is a pure read over the chain. Rules are DATA (require/enum/maxBytes), never functions,
// so a ruleset is content-addressable and re-checkable by anyone — Law L1/L2/L5.

import { seal, verify as verifyObj, UOR_CONTEXT } from "./holo-object.mjs";

const NS = "https://hologram.os/ns/rules#";

// defineRuleset({ name, version, rules }) → a content-addressed ruleset object (κ = its own content).
// `rules` maps a strand KIND → a declarative spec: { require:[field…], enum:{field:[allowed…]}, maxBytes:n }.
// Same rules → same κ (deterministic); any change → a new κ. THIS is "what counts as valid", forkable.
export function defineRuleset({ name = "default", version = 1, rules = {} } = {}) {
  return seal({ "@context": [...UOR_CONTEXT, { holrule: NS }], "@type": ["holrule:Ruleset"], name, version, rules });
}

// forkRuleset(base, { name, rules }) → a NEW ruleset = base merged with the patch (per-kind override),
// version bumped. Its κ differs from base by construction — an open, provable fork of the rules.
export function forkRuleset(base, { name = null, rules = {} } = {}) {
  return defineRuleset({ name: name || (base.name + "+fork"), version: (base.version || 1) + 1, rules: { ...(base.rules || {}), ...rules } });
}

// validate(entry, ruleset) → { ok, violations }. Interprets the declarative spec for the entry's kind.
// A kind the ruleset does not mention is PERMITTED (advisory) — note it rather than deny silently.
export function validate(entry, ruleset) {
  const kind = entry["holstr:kind"];
  const spec = (ruleset && ruleset.rules && ruleset.rules[kind]) || null;
  const violations = [];
  if (!spec) return { ok: true, violations, ungoverned: true };
  const p = entry["holstr:payload"] || {};
  for (const f of spec.require || []) if (p[f] === undefined || p[f] === null) violations.push(`missing:${f}`);
  for (const [field, allowed] of Object.entries(spec.enum || {})) if (p[field] != null && !allowed.includes(p[field])) violations.push(`enum:${field}=${p[field]}`);
  if (spec.maxBytes != null && typeof p.bytes === "number" && p.bytes > spec.maxBytes) violations.push(`maxBytes:${p.bytes}>${spec.maxBytes}`);
  return { ok: violations.length === 0, violations };
}

// adoptRuleset(strand, ruleset) — record adoption on the spine: a signed `ruleset` entry carrying the
// ruleset κ AND the full (re-derivable) ruleset object. From this seq onward it is the governing ruleset.
export async function adoptRuleset(strand, ruleset) {
  return strand.append({ kind: "ruleset", payload: { rulesetKappa: ruleset.id, ruleset } });
}

// governingRuleset(strand, atSeq) — the ruleset in force at a given seq: the most recent adopted ruleset
// at-or-before it (or null if none adopted yet). This is how an entry knows which definition validated it.
export function governingRuleset(strand, atSeq) {
  let gov = null;
  for (const e of strand.replay({ kind: "ruleset" })) {
    if (e["holstr:seq"] <= atSeq) gov = (e["holstr:payload"] || {}).ruleset || gov; else break;
  }
  return gov;
}

// validateChain(strand) — the P4 guarantee: walk the whole chain; each adopted ruleset must re-derive to
// its recorded κ (tamper check, Law L5); every governed entry must satisfy the ruleset in force. Returns
// { ok, govKappaOk, results, violations } — a provable conformance report keyed to content-addressed rules.
export function validateChain(strand) {
  let gov = null, govKappaOk = true;
  const results = [];
  for (const e of strand.replay({})) {
    if (e["holstr:kind"] === "ruleset") {
      const p = e["holstr:payload"] || {};
      if (!p.ruleset || !verifyObj(p.ruleset) || p.rulesetKappa !== p.ruleset.id) govKappaOk = false;  // rules tampered
      gov = p.ruleset || gov;
      continue;
    }
    if (!gov) { results.push({ seq: e["holstr:seq"], kind: e["holstr:kind"], governed: false, ok: true, violations: [] }); continue; }
    const v = validate(e, gov);
    results.push({ seq: e["holstr:seq"], kind: e["holstr:kind"], ruleset: gov.id, ok: v.ok, violations: v.violations });
  }
  return { ok: govKappaOk && results.every((r) => r.ok), govKappaOk, results, violations: results.filter((r) => !r.ok) };
}

// browser binding: one seam over the live operator strand. Fail-soft; callers degrade if absent.
if (typeof window !== "undefined") {
  window.HoloStrandRules = { defineRuleset, forkRuleset, validate, adoptRuleset, governingRuleset, validateChain };
}
