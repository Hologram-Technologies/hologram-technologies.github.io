// machine-web.mjs — the `web` machine adapter for mount(κ).
//
// realize(imageκ, params, snapshot, surface) → run an app as a holospace. THE BROWSER IS THE MACHINE
// (holospace.mjs's own definition of `web`): when the surface is the whole tab, the tab BECOMES the app —
// its own origin, its own service-worker scope, its full boot ceremony. That is a HAND-OFF, not a wrapper:
// no extra document, no diminished surface, no ceremony pushed a level down. When the surface is a TILE
// (a compositor mounted this child into a sub-pane), the app runs in a sandboxed iframe — the only way to
// place N surfaces at once. One machine, two realizations, chosen by whether it owns the tab.
//
// The κ is the IDENTITY (Law L1); `params.url` is the entry the signed index DERIVED from that κ
// (launching = resolving) — a convenience, never a trust input (bytes are content-verified, Law L5).

import { Machines } from "./holospace.mjs";

// the machine κ — the stable content-address of this adapter's contract (a manifest's `machine` field).
// mnemonic hex: 0x77='w' 0x65='e' 0x62='b', zero-padded to a 64-hex κ core (stable, axis-agnostic).
export const WEB = "did:holo:blake3:" + "776562".padEnd(64, "0");

// a tiled pane's capability grant — a first-class surface, not a diminished one: sovereign sign-in,
// clipboard for share/paste, media for calls, autoplay+fullscreen for immersive surfaces. `*` delegates
// the powerful-feature policy INTO the same-origin pane (a sandboxed frame is otherwise policy-restricted).
const ALLOW = "publickey-credentials-get *; publickey-credentials-create *; clipboard-read; clipboard-write; " +
  "camera; microphone; autoplay; fullscreen; encrypted-media; picture-in-picture";
const SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads";

// does this surface own the whole tab? Then the browser is the machine → navigate. A sub-pane → iframe.
const ownsTab = (surface) => { const d = surface.ownerDocument || document; return surface === d.body || surface === d.documentElement; };

export const adapter = {
  realize(imageKappa, params = {}, snapshot = null, surface) {
    const doc = surface.ownerDocument || document;
    const url = String(params.url || "");

    // FULL SURFACE → the browser IS the machine: the tab becomes this holospace (hand-off). params.fill
    // === false forces the iframe form even at the top (used to preview a surface without leaving).
    if (params.fill !== false && ownsTab(surface)) {
      if (url) { try { location.replace(url); } catch (e) { location.href = url; } }
      return { mode: "navigate", url, dispose: () => {} };
    }

    // TILE → an isolated, sandboxed iframe pane (the compositor placed us in a sub-surface).
    surface.textContent = "";
    if (!url) { surface.style.cssText = (surface.style.cssText || "") + ";display:grid;place-items:center;color:#8696a0;font:14px system-ui"; surface.textContent = "Nothing to mount here."; return { mode: "iframe", iframe: null, url: "", dispose: () => {} }; }
    const f = doc.createElement("iframe");
    f.setAttribute("sandbox", SANDBOX);
    f.setAttribute("allow", ALLOW);
    f.setAttribute("title", params.name || "holospace");
    f.style.cssText = "display:block;width:100%;height:100%;border:0;background:transparent;";
    f.src = url;
    surface.appendChild(f);
    return { mode: "iframe", iframe: f, url, dispose: () => f.remove() };
  },
};

// register into the process-wide registry (browser only). Importing this module wires the `web` machine.
if (typeof window !== "undefined") Machines.register(WEB, adapter);

export default adapter;
