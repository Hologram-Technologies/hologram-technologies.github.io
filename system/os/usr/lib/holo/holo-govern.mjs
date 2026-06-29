// holo-govern.mjs — the GOVERN verb, as ONE registry. A Validator decides whether a κ (a Link, an entry, a
// join) is legal, returning a verdict {ok} or {ok:false, why, warrant}. The many checks (integrity, Social-DNA
// rules, membership, provenance) become ENTRIES behind the SAME validate() contract, and GOVERN is their
// CONJUNCTION: a subject is legal only if ALL validators pass. Validators run CHEAPEST-FIRST — integrity is
// free (the κ self-proves), so a tampered subject is dropped before any rule runs (integrity-is-free law).
// The GOVERN sibling of holo-language (WRAP) and holo-transport (MOVE): same defineX + makeXRegistry pattern.

import { sha256Hex } from "./holo-identity.mjs";

export const GOVERN_CAPS = ["integrity", "provenance", "rules", "membership"];
// cheapest-first cost: integrity is FREE (the hash), provenance cheap, rules/membership are the semantic checks.
const COST = { integrity: 0, provenance: 1, rules: 2, membership: 2 };
const costOf = (caps) => Math.min(99, ...GOVERN_CAPS.filter((c) => caps[c]).map((c) => COST[c]).concat([99]));

// a signed, content-addressed warrant: a re-derivable κ proving the violation and naming the offender.
export async function warrantFor(subject, why, by) {
  const body = { offender: (subject && subject.author) ?? null, reason: why, by: by ?? null, subject: subject ?? null };
  const proof = "did:holo:sha256:" + (await sha256Hex(new TextEncoder().encode(JSON.stringify(body))));
  return { ...body, proof };
}

// defineValidator(spec) — validate(subject, ctx) -> Promise<{ok, why?, warrant?}> | {ok,...}. A Validator MUST
// be pure & re-runnable (consensus-free: same input ⇒ same verdict), so any peer reaches the same decision.
export function defineValidator(spec) {
  if (!spec || !spec.name) throw new Error("a Validator needs a name");
  if (typeof spec.validate !== "function") throw new Error("a Validator needs validate(subject, ctx) -> verdict");
  const capabilities = {};
  for (const c of GOVERN_CAPS) if (spec.capabilities && spec.capabilities[c]) capabilities[c] = true;
  return Object.freeze({ name: String(spec.name), capabilities, validate: spec.validate, cost: spec.cost ?? costOf(capabilities) });
}

export function makeGovernors() {
  const vs = new Map();
  const register = (spec) => { const V = defineValidator(spec); vs.set(V.name, V); return V.name; };
  const byName = (n) => vs.get(n) || null;
  const byCapability = (cap) => [...vs.values()].filter((V) => V.capabilities[cap]);
  const names = () => [...vs.keys()];
  const coveredCapabilities = () => GOVERN_CAPS.filter((c) => byCapability(c).length > 0);

  // validateAll(subject, ctx) — the CONJUNCTION, cheapest-first, short-circuit on first failure. Returns
  // { ok, ran:[names], ruleEvals } on pass, or { ok:false, why, warrant, by, ran, ruleEvals } on the first
  // refusal. ruleEvals counts only the SEMANTIC (rules/membership) checks that actually ran — proves integrity
  // is free: an integrity failure short-circuits with ruleEvals === 0.
  async function validateAll(subject, ctx = {}) {
    const ordered = [...vs.values()].sort((a, b) => a.cost - b.cost);
    const ran = []; let ruleEvals = 0;
    for (const V of ordered) {
      const semantic = V.capabilities.rules || V.capabilities.membership;
      ran.push(V.name);
      if (semantic) ruleEvals++;
      const r = await V.validate(subject, ctx);
      if (!r.ok) {
        const warrant = r.warrant || (await warrantFor(subject, r.why, V.name));
        return { ok: false, why: r.why, warrant, by: V.name, ran, ruleEvals };
      }
    }
    return { ok: true, ran, ruleEvals };
  }

  return { register, byName, byCapability, names, coveredCapabilities, validate: (name, s, c) => { const V = vs.get(name); return V ? V.validate(s, c) : null; }, validateAll, size: () => vs.size };
}

if (typeof window !== "undefined") window.HoloGovern = { makeGovernors, defineValidator, warrantFor, GOVERN_CAPS };
export default { makeGovernors, defineValidator, warrantFor, GOVERN_CAPS };
