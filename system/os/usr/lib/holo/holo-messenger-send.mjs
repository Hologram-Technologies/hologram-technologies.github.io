// holo-messenger-send.mjs — THE SEND PATH, GATED BY THE CANONICAL HOLOGRAM TEE.
//
// Receiving is automatic; SENDING is a consent-bearing act. Per the operator mandate, every
// outbound message is gated by a TEE step-up (holo-stepup) whose challenge IS the action κ — so
// the biometric the operator approves commits to THIS exact message to THIS exact conversation,
// not a random nonce. The sovereign signature over the action bytes is the non-repudiable proof
// the send was authorized. It rides a trust window (holo-stepup.needsStepUp): the first send asks,
// subsequent sends in the window do not — gated AND seamless, never waving a key through.
//
// Order of operations (fail-closed at every step):
//   1) mint the outgoing message κ (the content the operator is about to send)
//   2) if a step-up is needed, run it bound to { kind: "message.send", payload.message = κ }.
//      A denial / cancel / missing TEE THROWS → the message is NOT delivered and NOT chained.
//   3) deliver to the platform (the in-page compose+send inject — the fragile seam; pluggable,
//      NEVER faked: a delivery that doesn't land returns sent:false).
//   4) echo back: the sent message becomes ONE verified κ on the conversation chain, and the
//      step-up attestation is bound to it as a sibling provenance note (NOT in the content κ, so
//      cross-platform dedup is preserved — the consent is yours, not part of the message).
//
// The step-up gate + platform deliver are INJECTED so the core is Node-witnessable with the real
// holo-stepup build/verify (sovereign axis) and a fake deliver; the browser wires the real
// requireStepUp (WebAuthn + vault unlock) and the createLiveEditor compose-inject.
//
// Authority: holo-stepup (payload-bound TEE step-up) · holo-apps "explicit consent" for consent-
//   bearing kinds · holospaces SEC-2 (authority attenuates) · Law L5 · §2.6 (signed events).

import { mint } from "./holo-pluck.mjs";
import { needsStepUp, verifyStepUp } from "./holo-stepup.mjs";

const APP_ID = "org.hologram.HoloMessenger";

// makeSender({ thread, operator, stepUp, deliver, now, trustWindowMs, appId })
//   thread        : the conversation (holo-messenger-thread) the send echoes into
//   operator      : the operator κ (authorship + step-up subject); null ⇒ ungated (no operator present)
//   stepUp(action): async → a VERIFIED holo-stepup token, or THROWS on deny. (browser: requireStepUp)
//   deliver(arg)  : async → { ok, why? }. The platform compose+send inject. Absent ⇒ local-echo only.
//   now           : () → ISO timestamp (one per send; shared by mint + echo so the κ matches)
export function makeSender({ thread, operator = null, stepUp = null, deliver = null, now = () => "1970-01-01T00:00:00Z", trustWindowMs = 120000, appId = APP_ID } = {}) {
  let last = null;   // { kind, atMs } — the most recent step-up, for the trust window

  // send({ text, chat, platform, source }, { nowMs, force }) → { sent, kappa, gated, consent, why? }
  async function send({ text, chat = "", platform = "", source = "holo" } = {}, { nowMs = 0, force = false } = {}) {
    text = String(text || "").trim();
    if (!text) return { sent: false, why: "empty" };

    const sentAt = now();                                  // ONE timestamp → mint and echo agree on the κ
    const input = { text, sender: "Me", sentAt, chat, source };
    const minted = mint(input);
    const kappa = minted.kappa;
    const kind = "message.send";
    const action = { kind, appId, operator, reason: `Send a message to ${chat || "this chat"}`,
      payload: { "holo:message": kappa, "holo:to": chat, "holo:platform": platform } };

    // ── 2 · TEE step-up gate (consent bound to the action κ) ──
    let consent = null;
    if (operator && stepUp && (force || needsStepUp(kind, { last, nowMs, windowMs: trustWindowMs }))) {
      try { consent = await stepUp(action); }
      catch (e) { return { sent: false, gated: true, why: "step-up-denied:" + (e && e.message), kappa }; }
      // fail-closed: never trust an unverifiable token, and it MUST bind to this exact message κ
      const body = consent ? await verifyStepUp(consent) : null;
      if (!body || body.payload?.["holo:message"] !== kappa) return { sent: false, gated: true, why: "step-up-unverified-or-unbound", kappa };
      last = { kind, atMs: nowMs };
    }

    // ── 3 · deliver to the platform (the fragile in-page inject seam; never faked) ──
    let delivery = { ok: true, note: "local-echo" };
    if (deliver) { try { delivery = await deliver({ genesis: thread.genesis, text, chat, platform, source }); } catch (e) { delivery = { ok: false, why: String(e && e.message) }; } }
    if (!delivery.ok) return { sent: false, gated: !!consent, why: "deliver-failed:" + (delivery.why || ""), kappa, consent: consent ? consent.id : null };

    // ── 4 · echo back: one verified κ on the chain + consent bound as a sibling provenance note ──
    const appended = await thread.ingest(input);           // same input ⇒ same κ as `minted`
    if (consent) await thread.appendNote("message.consent", { "holo:message": kappa, "holo:stepup": consent.id, "holo:to": chat });
    return { sent: true, kappa, gated: !!consent, consent: consent ? consent.id : null, seq: appended.seq, delivery };
  }

  return { send, get lastStepUp() { return last; } };
}

// ── browser binding: window.HoloMessengerSend ──
// In the surface, `stepUp` = holo-stepup.requireStepUp (real WebAuthn + vault unlock, bound to the
// action κ) and `deliver` = the platform compose-inject (createLiveEditor / a connected MCP). When
// no operator/TEE is present (e.g. a guest preview), `operator:null` makes send ungated local-echo —
// honestly NOT a TEE-gated send.
if (typeof window !== "undefined" && !window.HoloMessengerSend) {
  window.HoloMessengerSend = { makeSender };
}
