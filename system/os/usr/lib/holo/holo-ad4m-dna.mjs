// holo-ad4m-dna.mjs — AD4M's SOCIAL DNA on κ: the rules that decide what counts as a valid Link in a
// Neighbourhood, made an explicit, forkable, content-addressed artifact — exactly Holochain's integrity
// zome, which already lives on the spine as `holo-strand-rules`. "Social DNA" = a ruleset κ adopted onto
// the Perspective's strand; from that seq on, every Link is provably validated under the rules that
// governed it, and a fork of the rules is a new κ that produces a divergent — but still verifiable —
// Neighbourhood. Tamper an adopted ruleset and its κ stops re-deriving (Law L5); the fork is open and provable.
//
// Two gates, because rules are declarative DATA over an entry's PAYLOAD (re-checkable by anyone, Law L1/L2):
//   • declarative — validate(link, ruleset): require/enum/maxBytes over {source,predicate,target}.
//   • membership  — isMember(author): a Link's author must belong (authorship lives on the entry, not payload).
// Both run at ADD (before append) and at ADOPT (before trusting an inbound chain) — fail-closed.
//
// Additive + projection-only: holo-strand and holo-ad4m are unchanged; the DNA rides as ordinary `ruleset`
// entries and validation is a pure read. Reuses holo-strand-rules wholesale — no new rule engine.

import { defineRuleset, forkRuleset, validate, adoptRuleset, governingRuleset, validateChain } from "./holo-strand-rules.mjs";

export { defineRuleset, forkRuleset };

// A sensible default Social DNA for a Neighbourhood: a Link must carry all three triple fields. Callers
// tighten it (enum the predicate, cap sizes) by passing their own ruleset — every change is a new κ.
export const LINK_DNA = defineRuleset({
  name: "ad4m-link-default",
  version: 1,
  rules: { "ad4m:link": { require: ["source", "predicate", "target"] } },
});

// makeDna({ perspective, ruleset, isMember }) → a rule-gated Perspective.
//   perspective : a makeAd4m().perspective(...) handle (its strand carries the Links AND the ruleset entry).
//   ruleset     : a defineRuleset(...) κ. Default LINK_DNA.
//   isMember    : (authorκ) → bool. Default: everyone (open Neighbourhood). Pass neighbourhood.members-based.
export function makeDna({ perspective, ruleset = LINK_DNA, isMember = () => true, me = null } = {}) {
  if (!perspective) throw new Error("Social DNA needs a perspective to govern");
  let rules = ruleset;
  let installed = false;

  // ready() — record the governing ruleset on the spine once (an ordered `ruleset` entry). Idempotent.
  async function ready() {
    await perspective.ready();
    if (!installed) { await adoptRuleset(perspective.raw, rules); installed = true; }
  }

  // gate(link) → { ok, why?, violations? } — both checks, fail-closed. Used at add and per-entry at adopt.
  function gate(link) {
    const v = validate({ "holstr:kind": "ad4m:link", "holstr:payload": link }, rules);
    if (!v.ok) return { ok: false, why: "rule-violation", violations: v.violations };
    if (link.author != null && !isMember(link.author)) return { ok: false, why: "not-a-member", author: link.author };
    return { ok: true };
  }

  // addLink(link) — validate BEFORE append; a violating Link never reaches the chain (fail-closed).
  async function addLink(link) {
    await ready();
    const g = gate({ ...link, author: link.author ?? me });   // the local signer is the author
    if (!g.ok) return g;
    const added = await perspective.addLink(link);
    return { ok: true, link: added };
  }

  // adopt(entries) — validate an inbound chain against the DNA before trusting it: every ad4m:link entry
  // must pass BOTH gates, then the strand's own verify-before-adopt (Law L5) runs. Any violation ⇒ refuse whole.
  async function adopt(entries) {
    await ready();
    if (!Array.isArray(entries)) return { ok: false, why: "not-a-chain" };
    for (const e of entries) {
      if (e["holstr:kind"] !== "ad4m:link") continue;
      const link = { ...(e["holstr:payload"] || {}), author: e["holstr:op"] || null };
      const g = gate(link);
      if (!g.ok) return { ok: false, why: g.why, violations: g.violations, atSeq: e["holstr:seq"] };
    }
    return perspective.adopt(entries); // strand re-derives + links end-to-end (L5) or refuses
  }

  // fork({name, rules}) — open, provable fork: a NEW ruleset κ governing a fresh DNA over the same kind of
  // Perspective. Divergent rules, still fully verifiable (each side re-derives under its own governing κ).
  function fork({ name = null, rules: patch = {} } = {}) {
    return { ruleset: forkRuleset(rules, { name, rules: patch }) };
  }

  return {
    ready,
    addLink,
    adopt,
    gate,
    fork,
    ruleset: () => rules,
    governingAt: (seq) => governingRuleset(perspective.raw, seq),
    conformance: () => validateChain(perspective.raw),
    perspective,
  };
}

// browser binding: one seam over the live operator's AD4M perspective. Fail-soft.
if (typeof window !== "undefined") {
  window.HoloAd4mDna = { makeDna, defineRuleset, forkRuleset, LINK_DNA };
}

export default { makeDna, LINK_DNA, defineRuleset, forkRuleset };
