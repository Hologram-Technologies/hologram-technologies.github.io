// holo-messenger-share.mjs — TRUENAMES & MAGICAL SHARE for a conversation.
//
// Every conversation (its genesis κ) projects to a human address — three speakable words and an
// IPv6 locator — that are DETERMINISTIC projections of the κ (no registry), so a name can't lie:
// resolving a name re-derives the candidate's own words and admits only an exact match (Law L5,
// namespace-scoped). "Open brass.junior.quiz" finds the right thread among the ones you hold.
//
// Sharing a thread hands a SELF-CONTAINED, verify-before-trust link that grants ATTENUATED READ of
// exactly that one conversation (SEC-2): the payload carries the verified message set (content κ +
// object) and a capability naming ONLY this collection — never the operator's signing key, never
// the account, never another thread. The recipient re-derives every message κ before rendering
// (Law L5) and gets a read-only view; with no signer they cannot append. A tampered message is
// dropped; a capability that doesn't bind to its collection is refused.
//
// Pure assembly over holo-words / holo-locator / holo-pluck — no new naming or crypto.
//
// Authority: holo-words (three-word projection, verified resolve) · holo-locator (κ→IPv6) ·
//   holo-pluck (verify-before-trust) · holospaces SEC-2 (attenuation) · Law L1/L2/L5.

import { kappaToWords, resolveWords, expandWords } from "./holo-words.mjs";
import { kappaToIPv6 } from "./holo-locator.mjs";
import { mountFromPayload, encodePayload, decodePayload } from "./holo-pluck.mjs";

const hexOf = (k) => String(k).split(":").pop();

// threadAddress(genesis, wordlist?) → the human address of a conversation, all derived from its κ.
export function threadAddress(genesis, wordlist = null) {
  return {
    genesis,
    short: hexOf(genesis).slice(0, 8),
    words: wordlist ? kappaToWords(genesis, wordlist) : null,
    ipv6: kappaToIPv6(genesis),
  };
}

// conversationCandidates(conversations) → the candidate set resolveWords/expandWords expect.
// Each conversation is { genesis, chat } or { meta:{ genesis, chat } }.
export const conversationCandidates = (conversations = []) =>
  conversations.map((c) => {
    const genesis = c.genesis || (c.meta && c.meta.genesis);
    const chat = c.chat || (c.meta && c.meta.chat) || "";
    return { id: genesis, "schema:name": chat };
  });

// resolveThreadWords(typed, conversations, wordlist) → [{ kappa, name, words }] (verified, L5).
export function resolveThreadWords(typed, conversations, wordlist) {
  return resolveWords(typed, conversationCandidates(conversations), wordlist);
}
// resolveThreadLink(typed, conversations, wordlist) → "holo://<hex>" iff exactly one match, else null.
export function resolveThreadLink(typed, conversations, wordlist) {
  return expandWords(typed, conversationCandidates(conversations), wordlist);
}

// ── SHARE: an attenuated read-only capability over ONE thread ──────────────────────────────
// shareThreadPayload(thread, { genesis?, platform?, chat?, wordlist? }) → a self-contained payload.
// It carries ONLY the verified message content + a read capability bound to this collection. No
// signer, no operator key, no other thread.
export function shareThreadPayload(thread, { genesis = null, platform = "", chat = "", wordlist = null } = {}) {
  const g = genesis || thread.genesis;
  const messages = (thread.replay({ kind: "message" }) || []).map((r) => {
    const p = r["holstr:payload"] || {};
    return { kappa: p["holo:message"], object: p.object };
  });
  return {
    "@type": "HoloThreadShare",
    "holo:collection": g,
    cap: { read: g },                                       // attenuation: READ of THIS collection only (SEC-2)
    name: { platform, chat, short: hexOf(g).slice(0, 8), words: wordlist ? kappaToWords(g, wordlist) : null, ipv6: kappaToIPv6(g) },
    messages,
  };
}

// shareLinkFor(payload, base) → a serverless link: the κ in the query (so the loader knows the app)
// and the verify-before-trust payload in the #fragment (never sent to a server).
export function shareLinkFor(payload, base = "/holospace.html") {
  return base + "?app=" + hexOf(payload["holo:collection"]) + "&messenger=1#share=" + encodePayload(payload);
}
export function decodeShareLink(link) {
  const tok = String(link).split("#share=")[1];
  return tok ? decodePayload(tok) : null;
}

// mountSharedThread(payload) → { ok, genesis, cap, readOnly, messages, rejected } | { ok:false, why }.
// Verify-before-trust + fail-closed: the capability must bind to its collection, and only messages
// whose bytes re-derive to their κ are admitted (a tampered one is dropped, not trusted).
export function mountSharedThread(payload) {
  if (!payload || payload["@type"] !== "HoloThreadShare" || !payload.cap || !payload.cap.read) return { ok: false, why: "not-a-thread-share" };
  const genesis = payload["holo:collection"];
  if (payload.cap.read !== genesis) return { ok: false, why: "cap-not-bound-to-collection" };  // attenuation integrity
  const messages = []; let rejected = 0;
  for (const m of payload.messages || []) {
    const mounted = mountFromPayload({ kappa: m && m.kappa, object: m && m.object });
    if (mounted.ok) messages.push({ kappa: mounted.kappa, object: mounted.object });
    else rejected++;
  }
  // read-only: a mount carries content + a read cap, never a signer — the holder cannot append.
  return { ok: true, genesis, cap: { read: genesis }, readOnly: true, hasSigner: false, messages, rejected };
}

if (typeof window !== "undefined" && !window.HoloMessengerShare) {
  window.HoloMessengerShare = { threadAddress, resolveThreadWords, resolveThreadLink, shareThreadPayload, shareLinkFor, decodeShareLink, mountSharedThread };
}
