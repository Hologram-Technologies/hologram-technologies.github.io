// holo-warrant.mjs — THE κ-IMMUNE SYSTEM. Holochain's highest-leverage multi-agent idea on the κ
// substrate: a WARRANT is a signed, content-addressed proof-of-invalid — "entry X is invalid under
// ruleset κR" — that can be shared (gossiped) so the network rejects bad data and bad actors WITHOUT a
// server or global consensus. Hologram already fails-closed LOCALLY (Law L5); this adds the missing
// leg: propagating the refusal so a peer rejects X too — and, crucially, NEVER on the accuser's say-so.
//
// THE IMMUNE PROPERTY: receiving a warrant proves nothing. The recipient RE-DERIVES the offending entry
// (L5), RE-DERIVES its governing ruleset, and RE-RUNS validation itself. The accusation holds ONLY if
// the entry truly violates — a false warrant is rejected, a forged evidence/ruleset is rejected. The
// verdict depends on re-derivation, not on trusting the issuer (the issuer signature is recorded as
// AUTHORSHIP, never as authority). This is "don't trust, verify" made into a network reflex.
//
// Pure assembly — no new crypto, no new canonical form:
//   • seal/verify (holo-object)        — the warrant + embedded evidence are self-verifying κ-objects.
//   • verifyEntry (holo-strand)        — the offending entry's κ re-derives (and its signature, if any).
//   • validate    (holo-strand-rules)  — re-run the SAME content-addressed ruleset that governed it (P4).
//   • addressOf   (holo-identity)      — the issuer/actor are κs (content addresses of pubkeys).
// Additive, projection-only. Reachable by humans (a Q verb) and agents (window.HoloWarrant) alike.

import { seal, verify as verifyObj, UOR_CONTEXT } from "./holo-object.mjs";
import { verifyEntry } from "./holo-strand.mjs";
import { validate } from "./holo-strand-rules.mjs";

const NS = "https://hologram.os/ns/warrant#";

// raiseWarrant({ entry, ruleset }, signer, { now }) → a signed, content-addressed warrant that EMBEDS the
// offending entry and the governing ruleset, so a recipient can verify it standalone (gossip-ready). The
// issuer signature (detached, outside the addressed body) records WHO raised it; it is never the basis of
// the verdict. Returns the warrant κ-object, or null if the entry actually conforms (nothing to warrant).
export async function raiseWarrant({ entry, ruleset } = {}, signer = null, { now = () => "1970-01-01T00:00:00Z" } = {}) {
  if (!entry || !ruleset) throw new Error("raiseWarrant needs the offending entry and its ruleset");
  const v = validate(entry, ruleset);
  if (v.ok) return null;                                              // it conforms — refuse to raise a false warrant
  const body = seal({
    "@context": [...UOR_CONTEXT, { holwar: NS }],
    "@type": ["prov:Entity", "holwar:Warrant"],
    "holwar:subject": entry.id,                                       // the accused entry κ
    "holwar:actor": entry["holstr:op"] || null,                      // the operator who authored it
    "holwar:object": entry,                                           // embedded evidence (re-derivable)
    "holwar:rulesetKappa": ruleset.id,
    "holwar:ruleset": ruleset,                                        // embedded ruleset (re-derivable)
    "holwar:violations": v.violations,
    "prov:generatedAtTime": now(),
  });
  if (signer && typeof signer.sign === "function") {
    return { ...body, "holwar:sig": await signer.sign(body.id), "holwar:alg": signer.alg, "holwar:pub": signer.pub, "holwar:issuer": signer.kappa };
  }
  return body;
}

// confirmWarrant(warrant) → { confirmed, why?, subject, actor, violations, issuer }. INDEPENDENT re-check:
// warrant re-derives, embedded ruleset re-derives & matches its κ, embedded entry re-derives to the
// claimed subject κ, and re-running validation actually fails. No step trusts the issuer.
export async function confirmWarrant(warrant) {
  try {
    const { "holwar:sig": sig, "holwar:alg": alg, "holwar:pub": pub, "holwar:issuer": issuer, ...body } = warrant || {};
    if (!verifyObj(body)) return { confirmed: false, why: "warrant-not-rederive" };
    const rs = body["holwar:ruleset"];
    if (!rs || !verifyObj(rs) || rs.id !== body["holwar:rulesetKappa"]) return { confirmed: false, why: "ruleset-tampered" };
    const obj = body["holwar:object"];
    const ev = await verifyEntry(obj);
    if (!ev.ok || !obj || obj.id !== body["holwar:subject"]) return { confirmed: false, why: "evidence-mismatch" };
    const v = validate(obj, rs);                                      // THE immune check — re-run validation ourselves
    if (v.ok) return { confirmed: false, why: "object-is-valid" };    // false accusation → rejected
    return { confirmed: true, subject: body["holwar:subject"], actor: body["holwar:actor"], violations: v.violations, issuer: issuer || null };
  } catch (e) { return { confirmed: false, why: "confirm-threw:" + (e && e.message) }; }
}

// makeImmunity() → the network reflex: receive(warrant) confirms it INDEPENDENTLY, and only a confirmed
// warrant marks the actor blocked. blocked(κ)/blocklist() are the immune memory a peer consults before
// trusting an actor's data. (Wire blocked κs into holo-revocation to attenuate their delegations.)
export function makeImmunity() {
  const blocked = new Map();                                          // actor κ → { subject, violations, at }
  return {
    async receive(warrant) {
      const r = await confirmWarrant(warrant);
      if (r.confirmed && r.actor) blocked.set(r.actor, { subject: r.subject, violations: r.violations, at: warrant["prov:generatedAtTime"] || null });
      return r;
    },
    isBlocked: (kappa) => blocked.has(kappa),
    blocklist: () => [...blocked.entries()].map(([actor, info]) => ({ actor, ...info })),
  };
}

// browser binding: the agent seam (window.HoloWarrant). A human reaches the same capability through a Q
// verb wired in the boot faculties; both are the SAME κ-rooted reflex, no privileged path.
if (typeof window !== "undefined") {
  window.HoloWarrant = { raiseWarrant, confirmWarrant, makeImmunity };
}
