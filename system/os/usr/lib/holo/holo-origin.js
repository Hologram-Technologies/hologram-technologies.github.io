// holo-origin.js — κ-Machine Origin redirect (reusable, app-agnostic).
//
// Any holospace that needs OPFS createSyncAccessHandle (a writable κ-disk) or SharedArrayBuffer
// (crossOriginIsolated) cannot run on the holo:// custom scheme — those APIs are http/https-only
// and throw a SecurityError under holo://. The native host runs a loopback static server
// (broker_server.cc) that serves the safelisted app + the wasm engine WITH COOP/COEP, i.e. a TRUE
// http origin where both work. This script bounces holo:// → that origin, preserving the path+query.
//
// OPT-IN: include this as the FIRST element in <head>, before any other script or worker:
//     <script src="/_shared/holo-origin.js"></script>
// It is a CLASSIC, SYNCHRONOUS script on purpose — it must run and redirect BEFORE the page spawns
// the worker that would otherwise hit the OPFS error. (An ES module is deferred/async = too late.)
// Off holo:// (dumb static host, dev server, or already on the loopback origin) it is a no-op.
//
// The app id is read from location.pathname (/apps/<id>/…) so this file needs no per-app edits; the
// host's safelist (broker_server.cc::MachineOriginApp) decides which ids actually resolve here.
//
// HOST: localhost, NEVER 127.0.0.1 — the WebAuthn spec forbids IP literals as RP IDs
// (http://127.0.0.1 throws on credential ceremonies; http://localhost is a valid secure-context
// origin). The broker listens on ::1 + 127.0.0.1 so "localhost" resolves either way. Keeping the
// host stable here is what lets the TEE/biometric seal key bind to a consistent origin.
(function () {
  try {
    if (location.protocol !== "holo:") return;            // already a real origin (or static host) → no-op
    var port = (typeof self !== "undefined" && (self.HOLO_BROKER_PORT | 0)) || 8495;
    location.replace("http://localhost:" + port + location.pathname + location.search);
  } catch (_) { /* never let the redirect shim break a page */ }
})();
