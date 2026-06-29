// holo-nostr.mjs — a Nostr link-language (WRAP). A Nostr event wrapped as an Expression on κ — the SAME pattern
// as activitypub (holo-ad4m-fediverse). This proves the WRAP registry IS the coasys link-language family seam:
// adding a network is ONE object (the "evolvable" property), and the event's address is did:holo:sha256(content)
// from the ONE substrate hasher (Law L4 — a Language never re-hashes). Mirrors coasys' nostr-link-language.

import { seal, verify as verifyObj, UOR_CONTEXT } from "./holo-object.mjs";
import { defineLanguage } from "./holo-language.mjs";

const NOSTR = "https://github.com/nostr-protocol/nostr";
const NS = "https://hologram.os/ns/ad4m#";

// a Nostr event sealed as an Expression: Nostr + UOR on ONE content-addressed object (Law L1).
export function eventExpression(event, prov = {}) {
  return seal({
    "@context": [...UOR_CONTEXT, { ad4m: NS, nostr: NOSTR }],
    "@type": ["nostr:Event", "ad4m:Expression"],
    "ad4m:language": "nostr",
    "ad4m:data": event,
    "ad4m:provenance": prov,
  });
}

// the nostr Language for the facade: ad4m.createExpression("nostr", { event, prov }).
export const nostrLanguage = Object.freeze({
  name: "nostr",
  create: ({ event, prov }) => eventExpression(event, prov || {}),
  get: (e) => (verifyObj(e) ? e : null),
});

// foldNostr(node) — register the nostr link-language onto the ONE capability-typed registry (storage+transport).
export function foldNostr(node) {
  node.languages.register(defineLanguage({ ...nostrLanguage, capabilities: { storage: true, transport: true } }));
  return ["nostr"];
}

if (typeof window !== "undefined") window.HoloNostr = { nostrLanguage, eventExpression, foldNostr };
export default { nostrLanguage, eventExpression, foldNostr };
