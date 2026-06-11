// holo-boot-sw-register.mjs — boot the WHOLE OS gateway-free (ADR-026). Loads the OS-wide closure
// (os-closure.json), re-derives the single OS root κ (os-root.jsonld) to verify it (Law L5), then
// registers the OS-wide κ Service Worker (holo-boot-sw.js) at root scope and hands it the closure —
// after which every subresource of every holospace resolves BY CONTENT from cache → peers → origin,
// re-derived on arrival. The origin is demoted to one CDN among peers.
//
// GUARDED: a no-op unless explicitly enabled (?sovereign=1, or localStorage.holoSovereign="1"), so
// importing it from a shell page changes nothing by default. Flipping it on — and broadening it to
// every frame — is the strict-ramp step gated by the browser witness (SPEC-BUNDLES invariant 5).
// Non-blocking; never awaits serviceWorker.ready (it can hang for a page outside the SW's scope).

import { verify } from "./_shared/holo-object.js";
import { hexOf } from "./holo-resolver.mjs";

// serveMeshToSw(sync) — the page side of the SW↔client bridge: answer the OS-wide Service Worker's
// κ requests from the live WebRTC mesh (holo-rtc's content-blind κ pub/sub). Call this once with the
// room's `sync` object; the worker then resolves blocks from mesh peers when the origin is denied.
// The worker re-derives the reply, so this is an untrusted fast path (Law L5).
export function serveMeshToSw(sync) {
  if (!sync || typeof sync.fetch !== "function" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("message", async (e) => {
    const kappa = e.data && e.data.holoPeerRequest, port = e.ports && e.ports[0];
    if (!kappa || !port) return;
    try { const b = await sync.fetch("sha256:" + hexOf(kappa)); const u = b ? (b instanceof Uint8Array ? b : new Uint8Array(b)) : null;
      port.postMessage({ bytes: u ? u.buffer : null }, u ? [u.buffer] : []); }
    catch { port.postMessage({ bytes: null }); }
  });
}

const enabled = () => {
  try {
    const p = new URLSearchParams(location.search);
    if (p.get("sovereign") === "1") return true;
    if (p.get("sovereign") === "0") return false;
    return localStorage.getItem("holoSovereign") === "1";
  } catch { return false; }
};

// bootSovereign({ base, peers, sync }) — boot the OS gateway-free. `peers` are transport names the
// SW wires (default ["ipfs"], always-on, needs no room). Pass a holo-rtc `sync` to also resolve from
// the WebRTC mesh: it adds "mesh" and installs the page-side bridge the worker calls.
export async function bootSovereign({ base = "./", peers, sync, peerConfig, precache, relay } = {}) {
  if (!("serviceWorker" in navigator)) return { ok: false, why: "no service worker" };
  if (relay) peerConfig = { ...(peerConfig || {}), relay };          // cross-device LAN relay (ADR-027)
  const transports = peers && peers.length ? peers.slice() : ["ipfs"];
  if (sync && !transports.includes("mesh")) transports.push("mesh");
  if (sync) serveMeshToSw(sync);
  // 1. The OS root: a self-verifying UOR object whose id IS the content address of the whole OS.
  const root = await fetch(base + "os-root.jsonld").then((r) => r.json()).catch(() => null);
  if (!root || !(await verify(root))) return { ok: false, why: "OS root does not re-derive (Law L5)" };
  // 2. The OS-wide closure (path → κ), bound to that root.
  const lock = await fetch(base + "os-closure.json").then((r) => r.json()).catch(() => null);
  if (!lock || lock.root !== root.id) return { ok: false, why: "closure not committed by the OS root" };
  const closure = Object.fromEntries(Object.entries(lock.closure).map(([p, r]) => [p, r.kappa]));
  // 3. Register the OS-wide κ-SW at root scope; hand it the closure + peer transports. The SW
  //    re-derives every byte it serves, so a wrong byte from any source (incl. origin) is refused.
  try {
    const reg = await navigator.serviceWorker.register(base + "holo-boot-sw.js", { type: "module", scope: base });
    const msg = { closure, peers: transports, peerConfig };
    // Wait for an ACTIVE worker (the OS-wide SW is at root scope, so ready resolves — no hang), then
    // hand it the closure and AWAIT its ack, so resolve is live before the first intercepted fetch.
    const active = reg.active
      || (await navigator.serviceWorker.ready.then((r) => r.active).catch(() => null))
      || await new Promise((res) => { const w = reg.installing || reg.waiting; if (!w) return res(null);
           w.addEventListener("statechange", function h() { if (this.state === "activated") { w.removeEventListener("statechange", h); res(reg.active); } }); });
    const configured = await new Promise((res) => {
      const ch = new MessageChannel(); const to = setTimeout(() => res(false), 4000);
      ch.port1.onmessage = (e) => { clearTimeout(to); res(!!(e.data && e.data.ready)); };
      (active || navigator.serviceWorker.controller)?.postMessage(msg, [ch.port2]);
    });
    // re-arm on controller handover (a newer SW taking over) so the closure is never lost.
    navigator.serviceWorker.addEventListener("controllerchange", () => navigator.serviceWorker.controller?.postMessage(msg));
    // optionally precache the WHOLE OS into the Cache API, so a later cold boot works fully offline
    // (survive the switch). Awaits the worker's tally; the SW keeps itself alive during the fetch.
    let precached = null;
    if (precache) precached = await new Promise((res) => {
      const ch = new MessageChannel(); const to = setTimeout(() => res(null), 120000);
      ch.port1.onmessage = (e) => { clearTimeout(to); res(e.data && e.data.precached); };
      (active || navigator.serviceWorker.controller)?.postMessage({ precache: true }, [ch.port2]);
    });
    return { ok: true, root: root.id, files: Object.keys(closure).length, peers: transports, configured, precached };
  } catch (e) { return { ok: false, why: String(e && e.message || e) }; }
}

// ?lan=<relay-url> (or ?lan=1 for the same-origin relay) auto-joins the LAN mesh — scanning the
// "Share on my LAN" QR opens the OS already sharing. Implies sovereign delivery.
const lanParam = (() => { try { return new URLSearchParams(location.search).get("lan"); } catch { return null; } })();
if (lanParam) bootSovereign({ relay: lanParam === "1" ? location.origin + "/holo-lan" : lanParam }).then((r) => console.log("[holo] LAN join:", r));
else if (enabled()) bootSovereign().then((r) => console.log("[holo] sovereign boot:", r));
