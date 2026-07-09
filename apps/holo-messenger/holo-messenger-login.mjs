// holo-messenger-login.mjs — thin adapter: the messenger mounts the ONE sovereign sign-in primitive.
//
// The whole sign-in stack — TEE ceremony · sovereign κ · SSO · guest · roam/recovery · Deep Resume · warm
// paint — now lives ONCE in /usr/lib/holo/holo-signin.mjs, so every holospace (and, next, the OS greeter)
// inherits it from a single call. This file supplies only the messenger's specifics: its session label, the
// shell it opens, and a warm-paint thunk that pulls the messenger's M1 shell bytes during the biometric tap.

import { signIn } from "../../usr/lib/holo/holo-signin.mjs";

// warm the messenger shell (M1 SHELL_MANIFEST) during the human's look-and-tap, so post-auth boot is cache-hot.
function warmMessengerShell() {
  try {
    import("./holo-m1-boot.mjs")
      .then((m) => { for (const p of (m.SHELL_MANIFEST || [])) { try { fetch(p, { cache: "force-cache" }).catch(() => {}); } catch {} } })
      .catch(() => {});
  } catch {}
}

// mountLogin({ root, params }) — unchanged contract for app.html: resolves { principal, operator, secret }.
export const mountLogin = (opts = {}) => signIn({
  app: "messenger", appName: "Holo Messenger", nextPath: "/apps/holo-messenger/app.html",
  warmPaint: warmMessengerShell, ...opts,
});
export default mountLogin;
