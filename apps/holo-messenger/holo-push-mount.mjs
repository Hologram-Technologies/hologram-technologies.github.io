// holo-push-mount.mjs — REACH-YOU P2/P5 client: wire background Web Push into the LIVE messenger, ADDITIVELY
// (the q-summon / holo-direct-mount idiom — self-mounting, fail-soft, never touches the engine). Gated:
// ?push=1 or localStorage["holo.push"]="1". Registers the SW, subscribes this device to push under the
// operator's OWN opaque push tag (derived from their box key, exactly like the mailbox tag), publishes the
// subscription to the content-blind relay, and routes a notification tap back into the right chat.
//
// The relay is the ONE content-blind pipe (server infra, like TURN). Set it per-device without a re-ship:
//   ?pushrelay=<https url>   → stored in localStorage["holo.push.relay"]   (a cloudflared tunnel while testing)
//
// window.HoloPush = { subscribe(), test(recipientTagOrNull), notify(box,meta), status(), tag() } for driving
// the reach test from the console / a settings button. The ACTUAL send-time ping is HoloPush.notify(box,meta)
// — call it from a send site with the recipient's box key; here it's exposed so the reach path is provable
// end-to-end on a real phone (P6) before per-message wiring.

import { VAPID_PUBLIC_KEY } from "./holo-push-config.mjs";
import { registerSW, subscribePush, showLocal, onRoute } from "./holo-push.mjs";
import { pushEnvelope } from "./holo-push-route.mjs";

const _q = (k) => { try { return new URLSearchParams(location.search).get(k); } catch { return null; } };
const _ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } };
const ENABLED = () => { try { return _q("push") === "1" || _ls("holo.push") === "1"; } catch { return false; } };

// the relay base: a ?pushrelay= param wins (and is persisted), else the stored value, else the shipped default
// (a cloudflared tunnel to the operator's local relay — EPHEMERAL; after a tunnel restart, open once with
// ?pushrelay=<new url> and it persists to localStorage for that device).
const DEFAULT_RELAY = "https://sue-hewlett-citizenship-dual.trycloudflare.com";
function relayBase() {
  const p = _q("pushrelay"); if (p) { _ls("holo.push.relay", p); return p.replace(/\/$/, ""); }
  const stored = _ls("holo.push.relay"); return (stored || DEFAULT_RELAY).replace(/\/$/, "");
}

// the opaque push TAG = the same content-blind address both sides derive from a box key (mailboxTag).
let _mailboxTag = null;
async function tagFor(boxPub) {
  if (!_mailboxTag) { try { _mailboxTag = (await import("./holo-dm.mjs?v=n8")).mailboxTag; } catch { _mailboxTag = async (b) => { const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("holo-mbox-v1|" + b)); return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join(""); }; } }
  return _mailboxTag(boxPub);
}
async function myBox() { try { const c = JSON.parse(await window.HoloDirect.code()); return c && c.box; } catch { return null; } }

let _reg = null, _subscribed = false, _myTag = null;

async function subscribe() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return { ok: false, error: "push unsupported on this browser" };
  const base = relayBase(); if (!base) return { ok: false, error: "no relay set — open with ?pushrelay=<https url>" };
  _reg = _reg || await registerSW("/apps/holo-messenger/holo-sw.js").catch(() => null) || await navigator.serviceWorker.ready.catch(() => null);
  if (!_reg) return { ok: false, error: "no service worker" };
  const box = await myBox(); if (!box) return { ok: false, error: "Holo Direct not ready (no box key yet)" };
  _myTag = await tagFor(box);
  const r = await subscribePush(_reg, { vapidPublicKey: VAPID_PUBLIC_KEY, relayBase: base, tag: _myTag });
  _subscribed = !!r.ok;
  return { ...r, tag: _myTag, relay: base };
}

// send a content-blind wake to a recipient (by their box key) — the send-time ping. Fire-and-forget.
async function notify(recipientBox, meta = {}) {
  const base = relayBase(); if (!base || !recipientBox) return false;
  try {
    const tag = await tagFor(recipientBox);
    const payload = pushEnvelope({ t: "dm", chat: meta.chat || "", name: meta.name || "", sealed: true });
    await fetch(base + "/push/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tag, payload }) });
    return true;
  } catch { return false; }
}

// the reach test: wake MY OWN device (or a given tag). Close the tab first → the notification proves the path.
async function test(toTag) {
  const base = relayBase(); if (!base) return { ok: false, error: "no relay set" };
  const tag = toTag || _myTag || (await tagFor(await myBox()));
  const payload = pushEnvelope({ t: "dm", chat: "", name: "Hologram", sealed: true });
  try { const r = await (await fetch(base + "/push/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tag, payload }) })).json(); return { ...r, tag }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
}

function status() { return { enabled: ENABLED(), subscribed: _subscribed, relay: relayBase() || null, tag: _myTag, permission: (typeof Notification !== "undefined") ? Notification.permission : "unsupported" }; }

// tap a notification → open the chat. The SW posts {type:"holo-notif-route", route}; hand it to the app.
onRoute((route) => { try { window.dispatchEvent(new CustomEvent("holo-open-chat", { detail: route })); } catch {} });

window.HoloPush = { subscribe, notify, test, status, tag: async () => _myTag || (await tagFor(await myBox())), showLocal: (payload) => showLocal(_reg, payload) };

// auto-subscribe on load when enabled + a relay is configured (permission is asked here — a real, gated
// signal, not on cold boot of the whole OS). Fail-soft: any hiccup leaves the messenger exactly as it was.
if (ENABLED()) {
  const go = async () => { try { for (let i = 0; i < 40 && !window.HoloDirect; i++) await new Promise((r) => setTimeout(r, 250)); if (relayBase()) { const r = await subscribe(); try { console.log("[holo-push] subscribe:", JSON.stringify(r)); } catch {} } } catch (e) { try { console.warn("[holo-push]", e.message); } catch {} } };
  if (document.readyState === "complete") go(); else window.addEventListener("load", go, { once: true });
}
