// holo-portal-card.mjs — the WhatsApp-feel receive surface for a portal, framework-agnostic so the Messenger
// (and any app) stays a thin skin. Two things: preview a portal link by κ (client-side, L5-verified — like a link
// OG card), and open it IN-APP (a bottom-sheet that covers the chat, splash→experience, back-to-chat) instead of a
// jarring new tab. All the real work stays in the one door (holo-portal-link · holo-dotholo). ──────────────────
import { parse, loaderUrl } from "./holo-portal-link.mjs";
import { openClosureHolo } from "./holo-dotholo.mjs";
import HoloPortal from "./holo-portal-share.mjs";   // the ONE seal verb

// sharePortal(thing, opts) → { ok, link, kappa, name, stage, file? }. THE send helper: turn anything into a
// sendable portal — the universal link + a WhatsApp-style CARD DESCRIPTOR (`stage`) the composer drops straight
// into its tray (same shape a pasted κ produces, so it renders + sends identically). thing = { files } | { lock }
// | { kappa, wire }. opts.as:'file' also returns a self-contained .html (`file`) for platform-agnostic sharing.
export async function sharePortal(thing = {}, opts = {}) {
  const name = opts.name || thing.name || "Portal";
  // seal the name INTO the manifest (schema:name) so the recipient's portalPreview shows the same title the sender saw
  const r = await HoloPortal.share(thing, { ...opts, opts: { name, ...(opts.opts || {}) } });
  const stage = {
    dtype: "kappa", kind: "portal", raw: r.link, kappa: r.link, glyph: "🪟", label: name, short: "self-verifying", canLive: false,
    seal: "🪟 self-verifying · opens in any browser (L5)", sealTip: "A κ-Portal — it verifies before it runs; anyone can open it, even without Hologram",
  };
  return { ok: true, link: r.link, kappa: r.kappa, name, stage, file: r.file || null };
}

// portalPreview(link, { fetchHolo, origin }) → { ok, kappa, name, entry, members } | { ok:false, kappa? }. Resolves
// the portal's closure manifest and VERIFIES it re-derives to the link's κ (L5) before showing a name — a tampered
// or wrong manifest yields a generic card, never a spoofed one. fetchHolo(κ)→wire is injectable (tests / peers);
// else it fetches "<origin>/portal.holo.json" (origin from the link, or the current page).
export async function portalPreview(link, { fetchHolo = null, origin = null } = {}) {
  const p = parse(link);
  if (!p.k) return { ok: false };
  let wire = null;
  try {
    if (fetchHolo) wire = await fetchHolo(p.k);
    else if (typeof fetch !== "undefined") {
      const o = origin != null ? origin : (/^https?:\/\//.test(String(link)) ? new URL(link).origin : (typeof location !== "undefined" ? location.origin : ""));
      wire = await (await fetch(o.replace(/\/$/, "") + "/portal.holo.json", { cache: "no-store" })).json();
    }
  } catch { wire = null; }
  if (!wire || !wire.manifest) return { ok: false, kappa: p.k };
  const oc = openClosureHolo({ kappa: p.k, manifest: wire.manifest, result: wire.result });   // L5: manifest re-derives to κ
  if (!oc.ok) return { ok: false, kappa: p.k, why: oc.error };
  return { ok: true, kappa: p.k, name: wire.manifest["schema:name"] || "Portal", entry: oc.entry, members: Object.keys(oc.members).length };
}

// openInApp(link, { mount, gateway, title }) → { ok, url, close, overlay } | { ok:false, why }. Opens the portal
// loader in a full-screen in-app sheet (slides up over the chat) with a back control — the WhatsApp "tap to view"
// feel, never a context-switching new tab. `target` is a portal LINK (opens the loader) OR a single-file portal
// (a self-contained <!doctype html> string — opens directly via srcdoc, NO gateway, fully serverless). Framework-
// agnostic DOM; returns close() to dismiss.
export function openInApp(target, { mount = null, gateway = null, title = "Portal", srcdoc = null } = {}) {
  const doc = typeof document !== "undefined" ? document : null;
  if (!doc) return { ok: false, why: "no document" };
  const asFile = srcdoc != null ? srcdoc : (typeof target === "string" && /^\s*<!doctype html/i.test(target));   // a single-file portal?
  let url = null;
  if (!asFile) { url = loaderUrl(target, gateway != null ? { gateway } : {}); if (!url) return { ok: false, why: "not a portal link" }; }
  const host = mount || doc.body;
  const overlay = doc.createElement("div");
  overlay.setAttribute("data-holo-portal", "1");
  overlay.style.cssText = "position:fixed;inset:0;z-index:2147483000;background:#07070c;display:flex;flex-direction:column;transform:translateY(100%);transition:transform .32s cubic-bezier(.2,.8,.2,1)";
  const bar = doc.createElement("div");
  bar.style.cssText = "height:52px;flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:0 12px;background:#0f1020;color:#e8e8f0;font:600 15px ui-sans-serif,system-ui;border-bottom:1px solid #1e1e34";
  const back = doc.createElement("button");
  back.textContent = "‹"; back.setAttribute("aria-label", "Back to chat");
  back.style.cssText = "font-size:26px;line-height:1;background:none;border:0;color:#cdd0e6;cursor:pointer;padding:2px 10px";
  const label = doc.createElement("div"); label.textContent = title; label.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
  const pill = doc.createElement("span"); pill.textContent = "self-verifying"; pill.style.cssText = "font:500 11px ui-sans-serif,system-ui;color:#8ab4ff;border:1px solid #2a2a4a;border-radius:999px;padding:2px 10px;flex:0 0 auto";
  const frame = doc.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups");
  frame.setAttribute("title", title);
  frame.style.cssText = "flex:1;width:100%;border:0;background:#07070c";
  if (asFile) frame.srcdoc = String(target);   // the single file IS the portal — mounted directly, no server
  else frame.src = url;
  bar.append(back, label, pill);
  overlay.append(bar, frame);
  host.appendChild(overlay);
  if (typeof requestAnimationFrame !== "undefined") requestAnimationFrame(() => { overlay.style.transform = "translateY(0)"; });
  else overlay.style.transform = "translateY(0)";
  const close = () => { overlay.style.transform = "translateY(100%)"; setTimeout(() => { try { overlay.remove(); } catch {} }, 340); };
  back.addEventListener("click", close);
  return { ok: true, url, close, overlay };
}

// portalActions(link, { onOpen }) → { link, kappa, isPortal, open, copyLink, forwardBody }. The re-share surface.
// The ingenious part: FORWARD needs no new code — a portal is a universal self-verifying link, so re-sending its
// body re-renders as a card in any chat (or any platform), losslessly. Copy/open are the other conveniences.
export function portalActions(link, { onOpen = null } = {}) {
  const p = parse(link);
  return {
    link, kappa: p.k, isPortal: !!p.k,
    open: (opts) => (typeof onOpen === "function" ? onOpen(link) : openInApp(link, opts)),
    forwardBody: () => link,   // forwarding = re-sending the universal link (re-renders as a card, free)
    copyLink: async () => { try { if (typeof navigator !== "undefined" && navigator.clipboard) await navigator.clipboard.writeText(link); } catch {} return link; },
  };
}

export default { portalPreview, openInApp, sharePortal, portalActions };
