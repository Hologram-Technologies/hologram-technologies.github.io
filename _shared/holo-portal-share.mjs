// holo-portal-share.mjs — THE ONE DOOR to κ-Portal across Hologram. OS Share, the omnibar, Holo Messenger, and Q
// all call the SAME two verbs: mint a shareable self-verifying link for anything, and open/detect one. Everything
// underneath — closures (holo-portal), the seed loader (holo-seed), PQC capability tokens (holo-portal-token),
// serverless transport — is abstracted away. This is the "unify, abstract complexity, deliver simplicity" seam:
// every surface gets the same behaviour from one place. Pure core + a browser self-registration (window.HoloPortal).

import { closureFromFiles, closureFromLock, portalWire, portalLink } from "./holo-portal.mjs";
import { parse as parseLink, detect as detectLink, loaderUrl } from "./holo-portal-link.mjs";   // the ONE link codec

// share(thing, opts) → { kappa, link, wire, members, blobs, tp, file? }. THE seal verb — turn anything into ONE
// self-verifying shareable. `thing` is anything:
//   { files }            → seal the CURRENT bytes (honest: κ derived from what's streamed)
//   { lock }             → reuse an already-sealed holospace (holospace.lock.json)
//   { kappa, wire }      → an already-sealed portal
// opts: { as?, capabilities?, sharer?, gateway?, loaderKappa?, blake3Source?, opts? }. `as:"link"` (default) or
//   `as:"file"` (ALSO returns a single self-verifying .html in `.file` — needs a {files} thing). The PQC token
//   (capabilities) and the packer both load LAZILY — you pay for them only when you use them.
export async function share(thing = {}, opts = {}) {
  let sealed;
  if (thing.files) sealed = closureFromFiles(thing.files, thing.opts || opts.opts || {});
  else if (thing.lock) sealed = closureFromLock(thing.lock, thing.opts || opts.opts || {});
  else if (thing.kappa && thing.wire) sealed = { kappa: thing.kappa, manifest: thing.wire.manifest, result: thing.wire.result, members: thing.members || {}, blobs: thing.blobs || {} };
  else throw new Error("holo-portal-share.share: give { files } | { lock } | { kappa, wire }");

  let tp = null;
  if (opts.capabilities && opts.capabilities.length) {
    const { makeSharer, mintPortalToken } = await import("./holo-portal-token.mjs");   // lazy: PQC only for a capability link
    tp = (await mintPortalToken(opts.sharer || makeSharer(), { capabilities: opts.capabilities })).tp;
  }
  const name = opts.name || (sealed.manifest && sealed.manifest["schema:name"]) || null;   // a human name → a self-descriptive /open/<name> path
  const link = portalLink(sealed.kappa, { loader: opts.loaderKappa || null, tp, base: opts.gateway || "", name });
  const out = { kappa: sealed.kappa, link, wire: portalWire(sealed), members: sealed.members || {}, blobs: sealed.blobs || {}, tp };

  if (opts.as === "file") {                            // ALSO render the single self-verifying .html (needs bytes)
    if (!Object.keys(out.blobs).length) throw new Error("share {as:'file'} needs a { files } thing (bytes to inline)");
    const { packSingleFile } = await import("./holo-portal-pack.mjs");
    let src = opts.blake3Source, shell = opts.shellHtml;
    if (typeof fetch !== "undefined") {
      if (!src) { try { src = await (await fetch("/_shared/holo-blake3.mjs")).text(); } catch {} }
      if (!shell) { try { shell = await (await fetch("/portal.html")).text(); } catch {} }   // the ONE shell (portal.html)
    }
    out.file = packSingleFile({ blobs: out.blobs, members: out.members, manifest: out.wire.manifest }, { blake3Source: src, shellHtml: shell });
  }
  return out;
}
// mint — back-compat alias of the seal verb. Prefer share().
export const mint = share;

// parse(str) / isPortal(str) — from the ONE codec (holo-portal-link). parse returns null when there's no link.
export function parse(str) { const p = parseLink(str); return p.k ? p : null; }
export function isPortal(str) { return detectLink(str); }

// open(link, opts) → { ok, url, kappa, via }. The ONE open. The codec resolves the loader URL; in a browser we
// hand it to the OS opener if present, else open a tab. Source-agnostic — L5 verifies on arrival.
export function open(link, { gateway = null, navigate = null } = {}) {
  const url = loaderUrl(link, gateway != null ? { gateway } : {});
  if (!url) return { ok: false, why: "not a portal link" };
  const k = parseLink(link).k;
  if (typeof navigate === "function") { navigate(url); return { ok: true, url, kappa: k, via: "navigate" }; }
  if (typeof window !== "undefined") {
    try { if (window.HoloOpen) { window.HoloOpen(url); return { ok: true, url, kappa: k, via: "HoloOpen" }; } } catch {}
    try { window.open(url, "_blank", "noopener"); return { ok: true, url, kappa: k, via: "window.open" }; } catch {}
  }
  return { ok: true, url, kappa: k, via: "descriptor" };
}

export function describe() {
  return { is: "the one door to κ-Portal — two verbs: share(thing)→a self-verifying link (or single-file), open(link)→running",
    used_by: "OS Share · omnibar · Holo Messenger · Q", verbs: ["share", "open", "parse", "isPortal"] };
}

// browser self-registration — window.HoloPortal is the OS-wide handle (mirrors window.HoloResolve). Two verbs:
// HoloPortal.share(thing[, {as}]) and HoloPortal.open(link); parse/isPortal for detection; mint kept as an alias.
if (typeof window !== "undefined" && !window.HoloPortal) window.HoloPortal = { share, open, parse, isPortal, mint, describe };

export default { share, open, parse, isPortal, mint, describe };
