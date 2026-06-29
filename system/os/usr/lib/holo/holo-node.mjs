// holo-node.mjs — THE single door: a Hologram node presents as exactly THREE nouns, mirroring ADAM's client
// (ad4m.agent · ad4m.languages · ad4m.perspectives). Nothing new — a thin composition over the three seams
// that already exist: holo-identity (Agent), holo-language (objective Language registry), holo-ad4m +
// holo-ad4m-dna + holo-ad4m-neighbourhood (subjective Perspective). Apps talk to this, and only this.
//
//   agent        — the who: me() / did()                                   (sovereign node identity)
//   languages    — objective: register · byCapability · resolve · express  (wrap any network → κ)
//   perspectives — subjective: create/open → { link, query, contract, receive, neighbourhood }  (signed graph)

import { makeAd4m } from "./holo-ad4m.mjs";
import { makeLanguages } from "./holo-language.mjs";
import { makeDna, LINK_DNA } from "./holo-ad4m-dna.mjs";
import { makeNeighbourhood } from "./holo-ad4m-neighbourhood.mjs";

export function makeNode({ signer = null, now = () => "1970-01-01T00:00:00Z", store = new Map() } = {}) {
  const ad4m = makeAd4m({ signer, store, now });
  const registry = makeLanguages();

  // ── AGENT (the who) ───────────────────────────────────────────────────────────────────────────────
  const agent = {
    me: () => ad4m.me(),
    did: () => ad4m.me(),                 // a DID is already a content address (Law L1)
  };

  // ── LANGUAGE (objective) — the capability registry, bridged to ad4m's Expression store ──────────────
  const languages = {
    register: (spec) => { const name = registry.register(spec); ad4m.registerLanguage(registry.byName(name)); return name; },
    byCapability: (cap) => registry.byCapability(cap),
    names: () => registry.names(),
    resolve: (ref) => registry.resolve(ref),
    coveredCapabilities: () => registry.coveredCapabilities(),
    express: (name, data) => ad4m.createExpression(name, data),   // wrap data via a Language → an Expression κ
    get: (url) => ad4m.getExpression(url),                        // re-verified on read (Law L5)
  };

  // ── PERSPECTIVE (subjective) — a signed κ-Link graph, governed by a Social-DNA contract ─────────────
  function perspective({ backend = null, ruleset = LINK_DNA, isMember, self = "peer", post = () => {} } = {}) {
    const persp = ad4m.perspective({ backend });
    const dna = makeDna({ perspective: persp, ruleset, me: ad4m.me(), isMember });
    const neighbourhood = makeNeighbourhood({ perspective: persp, me: ad4m.me(), self, post });
    return {
      link: (subject, predicate, object) => dna.addLink({ source: subject, predicate, target: object }),
      query: (q = {}) => persp.links(q),
      contract: () => dna.ruleset(),
      receive: (entry) => dna.receive(entry),       // validating-peer path: integrity-free, warrant on violation
      neighbourhood,
      raw: persp,
      dna,
    };
  }

  return { agent, languages, perspectives: { create: perspective, open: perspective } };
}

if (typeof window !== "undefined") window.HoloNode = { makeNode };
export default { makeNode };
