// holo-push-config.mjs — the PUBLIC push config the client ships. The VAPID PUBLIC key is genuinely public
// (it rides inside every device's push subscription); the matching PRIVATE key is the relay operator's
// secret and NEVER leaves the server. The relay base is where the content-blind push relay listens.
//
// Content-blindness recap: a subscription authorizes the relay to POST a wake-ping to the browser vendor's
// push service; the payload the relay forwards is holo-push-route.pushEnvelope (tag + type only — no
// plaintext, no κ, no sender). The message itself is pulled + decrypted ON the device, never by the relay.
export const VAPID_PUBLIC_KEY = "BKO-B-EWjmGx-zQVMOjhHzg4syU3XVRxuYGsdRgUiJE6ueco1HKDSAkVL26KlcLaXD_yySZLu35-7ztuAY-Q73Q";

// the content-blind push relay (server-side infra, like TURN / the mailbox). Override per-deploy.
// A same-origin default lets a self-hosted deploy answer /push/* itself; the hosted relay is set at ship.
export const PUSH_RELAY_BASE = (() => { try { return localStorage.getItem("holo.push.relay") || ""; } catch { return ""; } })();
