// holo-messenger-capture-boot.js — the in-page boot the native CEF host injects into a real
// platform web client (web.whatsapp.com, web.telegram.org, …) so its rendered messages stream
// into Holo Messenger. The native counterpart is the handler.cc inject filter (Phase 7); this is
// the JS half it loads, by absolute holo:// URL, exactly like holo-playground-web-boot.js.
//
// It runs in the PLATFORM tab's world (cross-origin, no operator key): it resolves the per-platform
// adapter, installs the capture observer (holo-bridge-adapters.installBridgeCapture), and for every
// rendered message mints the self-verifying κ and posts it — on the local "holo-messenger"
// BroadcastChannel — to the inbox tab, addressed by the conversation's deterministic genesis κ. The
// platform→inbox hop is a content-addressed κ frame (integrity by its κ); the inbox verifies it and
// seals it into the conversation's post-quantum epoch chain (it holds the key, the platform tab does
// not). Self-gating: on a page no adapter owns, installBridgeCapture is a no-op, so this is inert
// everywhere except real messenger clients.
//
// Authority: holo-bridge-adapters (capture) · holo-pluck (κ) · holo-messenger-thread
//   (conversationGenesis) · holo-messenger-transport (frame) · holospaces Law L1/L5.

import { installBridgeCapture, resolveAdapter } from "holo://os/usr/lib/holo/holo-bridge-adapters.mjs";
import { conversationGenesis } from "holo://os/usr/lib/holo/holo-messenger-thread.mjs";
import { mint } from "holo://os/usr/lib/holo/holo-pluck.mjs";
import { frameMessage } from "holo://os/usr/lib/holo/holo-messenger-transport.mjs";

(function boot() {
  try {
    const adapter = resolveAdapter(location.hostname);
    if (!adapter) return;                                   // not a messenger client → inert
    if (typeof BroadcastChannel === "undefined") return;
    const bc = new BroadcastChannel("holo-messenger");
    installBridgeCapture({
      onMessage: (input) => {
        try {
          const genesis = conversationGenesis({ platform: adapter.id, chat: input.chat });
          const object = mint(input).object;               // self-verifying message κ (no key needed)
          bc.postMessage(frameMessage(genesis, object));   // → the inbox verifies + seals into its epoch chain
        } catch (e) { /* a single unreadable bubble must never break the stream */ }
      },
    });
    console.log("[holo-messenger] capture armed on " + adapter.label + " — messages stream to your inbox");
  } catch (e) { /* inert on any failure — the platform app is never touched */ }
})();
