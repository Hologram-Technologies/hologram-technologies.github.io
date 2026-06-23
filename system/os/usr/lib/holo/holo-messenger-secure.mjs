// holo-messenger-secure.mjs — THE LIVE STREAM, SEALED. Composes the epoch (§2.8) with the
// transport so what actually crosses the wire is a CIPHERTEXT envelope, never a plaintext message.
//
// This closes the gap left by the transport demo (which moved plaintext objects): a platform tab
// seals each captured message under the conversation's post-quantum epoch key BEFORE publishing,
// and the inbox opens it AFTER the transport has already verified the envelope's own κ. A content-
// blind relay (SEC-7) now forwards genuinely opaque bytes; the recipient does verify-before-trust
// twice over — first the envelope re-derives (L5), then the decrypted body re-derives to its
// content κ — before anything is ingested or rendered. A non-member (no epoch key) sees only
// ciphertext; a tampered envelope or a wrong key is refused fail-closed.
//
// Pure composition over holo-messenger-epoch + holo-messenger-transport + holo-messenger-thread —
// no new crypto, no new frame format (the envelope IS a sealed κ object the transport already
// verifies). Node-witnessable with an in-process hub; the browser wires it to BroadcastChannel.
//
// Authority: holo-apps §2.8 · holospaces SEC-1 (verify-on-receipt) · SEC-7 (content-blind) · Law L5.

import { sealMessage, openMessage } from "./holo-messenger-epoch.mjs";
import { makePublisher, makeSubscriber } from "./holo-messenger-transport.mjs";

// makeSecureLink({ genesis, epoch, epochKey, send, thread, onRender, onRefused })
//   genesis  : the conversation topic
//   epoch    : the PUBLIC epoch (its key seals outgoing bodies)         — needed to SEND
//   epochKey : the UNWRAPPED secret epoch key (this member's)           — needed to RECEIVE
//   send     : transport sink (BroadcastChannel.postMessage / a hub)
//   thread   : local conversation; opened messages are ingested verify-before-trust
//   onRender : (opened) → void, fired after a fresh verified message is admitted
//   onRefused: (why) → void, fired when an envelope fails to open/verify (fail-closed)
export function makeSecureLink({ genesis, epoch = null, epochKey = null, send = () => {}, thread = null, onRender = () => {}, onRefused = () => {} } = {}) {
  const publisher = makePublisher({ send });

  // publishSecure(messageObject) — seal the body under the epoch key, publish the ciphertext envelope.
  async function publishSecure(object) {
    if (!epoch) throw new Error("secure: no epoch to seal under");
    const envelope = await sealMessage(epoch, object);     // AEAD body under the epoch key; envelope is a sealed κ
    return publisher.publish(genesis, envelope);           // the wire carries ONLY the ciphertext envelope
  }

  // the transport subscriber: it has ALREADY verified the envelope's own κ (L5) before calling us;
  // we then decrypt + re-verify the inner content κ before ingest (verify-before-trust, twice).
  const subscriber = makeSubscriber({
    topics: [genesis],
    onMessage: async ({ object: envelope }) => {
      const opened = epochKey ? await openMessage(epochKey, envelope) : { ok: false, why: "no-epoch-key" };
      if (!opened.ok) { onRefused(opened.why); return; }   // non-member / wrong key / tamper → fail-closed
      if (thread) await thread.ingestObject(opened.object);
      onRender(opened);
    },
  });

  return { publishSecure, receive: subscriber.receive, subscriber };
}

if (typeof window !== "undefined" && !window.HoloMessengerSecure) {
  window.HoloMessengerSecure = { makeSecureLink };
}
