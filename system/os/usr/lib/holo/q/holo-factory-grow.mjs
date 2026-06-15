// holo-factory-grow.mjs — SELF-IMPROVEMENT for Holo Factory (ADR-0097): the factory improves over time by
// OBSERVING ITSELF. This closes the last Factory 2.0 pillar — "a system that improves by observing itself."
//
// The tender already appends a Trace per run (success or failure) to the append-only corpus. Growth reads
// the FAILURE traces and drives Holo Mind's Phase-2 optimizer (evolve, ADR-0081): propose an improved skill
// from the failures, seal it as a GOVERNED, re-derivable SkillRevision (in force only when every condition
// holds — tests pass · within the size ceiling · conscience accepts · operator-ratified · cooling-off
// elapsed). NO new substrate — it composes holo-mind-evolve verbatim; the factory just supplies the trigger.
//
// HONEST (Law L5 + the ADR-0052 boundary): the optimizer's PROPOSAL is a stochastic LLM generation, NOT
// reproducible — L5 holds over the AUDIT TRAIL (which corpus, which optimizer, which gate verdicts), not the
// search. And growth WON'T churn on noise: below a failure threshold it does nothing; with no model it makes
// no proposal; a failing gate seals a revision that is honestly NOT in force. The behavior-change projection
// (an in-force revision → the live propose strategy, holo-mind-evolve.projectSkill) is the consumption seam.

import { failures, evolve, isInForce } from "../holo-mind-evolve.mjs";

// growFromFailures(store, corpusHead, opts) → { grew, revision?, inForce?, failures, reason? }.
// opts: { parentKappa?, parentBytes, optimizerKappa?, sampler, gate, minFailures? }.
export async function growFromFailures(store, corpusHead, { parentKappa = null, parentBytes = "", optimizerKappa = null, sampler = null, gate = {}, minFailures = 2 } = {}) {
  const fails = corpusHead ? failures(store, corpusHead) : [];
  if (fails.length < minFailures) return { grew: false, failures: fails.length, reason: `only ${fails.length} failure(s) — need ${minFailures} (won't churn the skill on noise)` };
  if (typeof sampler !== "function") return { grew: false, failures: fails.length, reason: "no model in context — nothing to propose (the optimizer borrows the existing sampler)" };
  const rev = await evolve(store, { parentKappa, parentBytes, corpusHeadKappa: corpusHead, optimizerKappa, sampler, gate });
  if (!rev) return { grew: false, failures: fails.length, reason: "optimizer returned no proposal (empty) — nothing to govern" };
  return { grew: true, failures: fails.length, revision: rev.id, inForce: isInForce(rev), gate: rev["holo:gate"], proposalBytes: rev["holo:proposalBytes"] };
}

export default { growFromFailures };
