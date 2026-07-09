// holo-push.mjs - the client side of Holo Reach: register the service worker, subscribe to web push (and hand the
// subscription to the content-blind push relay), and route notification clicks back into the app. showLocal() displays
// a notification directly via the SW registration - the path used to verify the notification/deep-link UX without a
// real push service (which a headless/offscreen renderer can't exercise).
import { notificationFor } from "./holo-push-route.mjs";

// scope defaults to the SW's own directory (no special header needed). Pass scope:"/" only if the server sends
// Service-Worker-Allowed: / (the OS host can, so the SW governs the whole app; the dev preview uses the dir scope).
export async function registerSW(path = "/apps/holo-messenger/holo-sw.js", scope = null) {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  const opts = scope ? { type: "module", scope } : { type: "module" };
  try { return await navigator.serviceWorker.register(path, opts); }
  catch { try { return await navigator.serviceWorker.register(path, scope ? { scope } : undefined); } catch { return null; } }
}

// ask (gracefully) + subscribe. `tag` = the recipient's opaque push address (derive it the same way both sides do).
export async function subscribePush(reg, { vapidPublicKey, relayBase = null, tag } = {}) {
  if (!reg || !reg.pushManager) return { ok: false, error: "no pushManager" };
  let perm = (typeof Notification !== "undefined") ? Notification.permission : "denied";
  if (perm === "default") { try { perm = await Notification.requestPermission(); } catch {} }
  if (perm !== "granted") return { ok: false, error: "permission " + perm };
  let sub; try { sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: _urlB64ToU8(vapidPublicKey) }); }
  catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  const base = relayBase || (typeof location !== "undefined" ? location.origin : "");
  try { await fetch(base + "/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tag, sub }) }); } catch {}
  return { ok: true, sub };
}
export async function unsubscribePush(reg, { relayBase = null, tag } = {}) {
  try { const sub = reg && (await reg.pushManager.getSubscription()); if (sub) { await sub.unsubscribe(); const base = relayBase || location.origin; await fetch(base + "/push/unsubscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tag, endpoint: sub.endpoint }) }); } } catch {}
  return { ok: true };
}

// show a notification NOW via the SW registration (no push service needed) - used to verify the content-blind
// notification + deep-link UX locally.
export async function showLocal(reg, payload) {
  const n = notificationFor(payload); if (!n || !reg) return false;
  try { await reg.showNotification(n.title, { body: n.body, tag: n.tag, data: n.data, requireInteraction: !!n.requireInteraction, renotify: !!n.renotify }); return true; } catch { return false; }
}

// a notification was clicked → the SW posts the route here; the app opens the surface.
export function onRoute(cb) {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return;
  navigator.serviceWorker.addEventListener("message", (e) => { if (e.data && e.data.type === "holo-notif-route") { try { cb(e.data.route); } catch {} } });
}

function _urlB64ToU8(b64) {
  if (!b64) return new Uint8Array();
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const s = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(s); const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
