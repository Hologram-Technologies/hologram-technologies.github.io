// holo-messenger-thread.mjs — A CONVERSATION IS A COLLECTION; A MESSAGE IS AN EVENT.
//
// Beeper relays each platform's messages into a Matrix room on a homeserver. Holo Messenger
// has no homeserver: a conversation IS a holo-apps §2.6 Collection — a genesis κ that names
// it — and each message is an immutable, hash-linked, operator-signed EVENT on a per-
// conversation source chain (holo-strand). The head κ attests the WHOLE ordered history:
// drop, reorder, insert or mutate any message and verify() refuses (Law L5 over the
// sequence, not just per record). This is the truth of a conversation, serverless.
//
// We invent NO new primitive. The §2.6 event schema is satisfied entirely by what a strand
// entry already carries — we only name it and stamp the collection:
//   header.author (identity κ)      = entry "holstr:op"   (signer's content-addressed pubkey)
//   header.collection (genesis κ)   = "holo:collection"   (stamped here, = this conversation)
//   header.parents (frontier κs)    = entry "holstr:prev"  (one parent: the prior event κ; a
//                                       device observes a linear order — concurrent multi-device
//                                       frontiers reconcile via strand.adopt fast-forward)
//   header.clock (Lamport)          = entry "holstr:seq"   (monotonic, 0 at genesis)
//   body                            = entry "holstr:payload" (the plucked message κ + object)
//   SignatureAxis over header+body  = entry "holstr:sig/alg/pub" (Ed25519/ECDSA, verifiable from op)
//
// Confidentiality (§2.8): at-rest the chain is AES-GCM-sealed under the operator's sovereign
// vault key (holo-strand's browser backend, fail-closed when locked). The per-collection
// EPOCH key + post-quantum wrapping (X25519 + ML-KEM-1024 hybrid, holo-vault-sync) and the
// TEE step-up gate on SEND are the Phase 4/5 confidentiality layer — rooted in the canonical
// Hologram TEE (holo-stepup), not bolted on here.
//
// Authority: holo-apps §2.6/§2.7/§2.8 · holospaces SEC-1 (verify-on-receipt) · SEC-3 (one κ
//   network-wide / idempotent) · Law L1/L2/L5 · RFC 8785 JCS · schema.org Conversation/Message.

import { seal } from "./holo-object.mjs";
import { makeStrand } from "./holo-strand.mjs";
import { mint, mountFromPayload, renderModel } from "./holo-pluck.mjs";

const NS = "https://hologram.os/ns#";

// conversationGenesis({ platform, chat, participants? }) → the Collection's genesis κ.
// Content-addressed (Law L2): the same conversation on the same platform reduces to the same
// genesis everywhere; a different chat/platform is a different collection. Participants (if
// known) are sorted so the κ is independent of capture order.
export function conversationGenesis({ platform = "", chat = "", participants = [] } = {}) {
  const obj = seal({
    "@context": ["https://schema.org/", { holo: NS }],
    "@type": ["schema:Conversation", "holo:Collection"],
    "holo:platform": String(platform),
    "schema:name": String(chat),
    ...(participants.length ? { "schema:participant": participants.map(String).slice().sort() } : {}),
  });
  return obj.id;
}

// makeThread({ genesis, backend, now, signer }) → one conversation's append-only chain.
// backend/now/signer are injected (Node-testable; the browser binding wires the encrypted
// κ-store + the live operator as signer). Everything else delegates to the strand.
export function makeThread({ genesis = null, backend = null, now = () => "1970-01-01T00:00:00Z", signer = null } = {}) {
  const strand = makeStrand({ backend, now, signer });

  async function ready() { await strand.ready(); }
  function setSigner(s) { strand.setSigner(s); }

  // append a verified message object as an EVENT (the shared write path). Idempotent (SEC-3):
  // the same κ is never double-appended, so a re-scan or a re-delivery is safe.
  async function appendObject(object, kappa) {
    const dup = strand.replay({ kind: "message" }).some((r) => r["holstr:payload"] && r["holstr:payload"]["holo:message"] === kappa);
    if (dup) return { appended: false, kappa, duplicate: true };
    const rec = await strand.append({
      kind: "message",
      payload: {
        "holo:collection": genesis,                          // §2.6 header.collection
        "holo:message": kappa,                               // the message event body's κ (content address)
        object,                                              // the self-verifying message object (verify-before-trust on mount)
        "schema:dateSent": object["schema:dateSent"] || "",
        "holo:capturedFrom": object["holo:capturedFrom"] || "",
      },
    });
    return { appended: true, kappa, seq: rec["holstr:seq"], author: rec["holstr:op"] || null, entry: rec };
  }

  // ingest(input) — a captured message (from a bridge adapter) becomes an EVENT on the chain.
  // Mints the κ from the rendered fields, then admits it. Returns { appended, kappa, seq?, author? }.
  async function ingest(input) {
    await ready();
    const m = mint(input);
    return appendObject(m.object, m.kappa);
  }

  // ingestObject(object) — the RECEPTION path (§2.6 verified reception, SEC-1): admit a message
  // object that arrived over the wire. Re-derives it verify-before-trust (Law L5) BEFORE appending;
  // a forged/tampered object is refused fail-closed and never reaches the chain.
  async function ingestObject(object) {
    await ready();
    const mounted = mountFromPayload({ kappa: object && object.id, object });
    if (!mounted.ok) return { appended: false, why: mounted.why };
    return appendObject(mounted.object, mounted.kappa);
  }

  // appendNote(kind, payload) — record a NON-message event on the chain (e.g. a send-consent
  // proof). It is signed + hash-linked like any entry (tamper-evident) but is NOT message content,
  // so it never enters view() and never affects a message's content κ (dedup stays intact). This is
  // where a TEE step-up attestation (holo-stepup) is durably bound to the send that produced it.
  async function appendNote(kind, payload) {
    await ready();
    return strand.append({ kind: String(kind || "note"), payload });
  }

  // view({ wordlist? }) — the REDUCER (§2.7): reduce the chain's message events to the ordered
  // bubble list the surface paints. Each row re-derives from its own object (verify-before-
  // trust); a row whose bytes don't re-derive to its κ is dropped (fail-closed, Law L5).
  function view({ wordlist = null } = {}) {
    return strand.replay({ kind: "message" }).flatMap((r) => {
      const p = r["holstr:payload"] || {};
      const mounted = mountFromPayload({ kappa: p["holo:message"], object: p.object });
      if (!mounted.ok) return [];
      const model = renderModel(mounted.object, { wordlist });
      return [{ ...model, seq: r["holstr:seq"], author: r["holstr:op"] || null, collection: p["holo:collection"] || genesis }];
    });
  }

  // summarize({ platform, chat, wordlist? }) — the unified-inbox ROW (a WhatsApp-style list
  // entry): last message text/time + unread-agnostic count. The inbox is many of these.
  function summarize({ platform = "", chat = "", wordlist = null } = {}) {
    const msgs = view({ wordlist });
    const last = msgs[msgs.length - 1] || null;
    return {
      genesis, platform, chat,
      count: msgs.length,
      lastText: last ? last.text : "",
      lastSentAt: last ? last.sentAt : "",
      lastSender: last ? last.sender : "",
      lastKappa: last ? last.kappa : null,
    };
  }

  return {
    genesis, ready, setSigner, ingest, ingestObject, appendNote, view, summarize,
    verify: () => strand.verify(),          // whole-history tamper-evidence (Law L5)
    adopt: (c) => strand.adopt(c),          // cross-device fast-forward (verify-before-adopt)
    head: () => strand.head(),
    length: () => strand.length(),
    replay: (o) => strand.replay(o),
  };
}

// ── browser binding: window.HoloThread — open a thread over the encrypted κ-store ──────────
// One IndexedDB-backed strand per conversation (keyed by genesis), AES-GCM at rest under the
// sovereign vault key (same as holo-strand). The live operator is attached as signer so every
// message event gains non-repudiable authorship. Until unlocked it still hash-links.
if (typeof window !== "undefined" && !window.HoloThread) {
  window.HoloThread = { conversationGenesis, makeThread };
}
