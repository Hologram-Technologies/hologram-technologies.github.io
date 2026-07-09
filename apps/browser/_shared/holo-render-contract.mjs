// holo-render-contract.mjs — the render contract (S1): a UOR object MAY declare HOW a browser instantiates
// it. This module is DEPENDENCY-FREE (no node:crypto, no Buffer, no top-level effects) so it is safe to
// import in the browser service worker AND in Node. holo-object.mjs builds renderable objects with these;
// the IPFS gateway / SW reads them with selectRender to dispatch a served object. Trust is NOT decided here
// — dispatch is a VIEW over bytes already verified by re-derivation (Law L5) upstream.

// The render-contract @context fragment, APPENDED only to renderable objects (never folded into the base
// UOR_CONTEXT), so a non-renderable object's content address stays byte-stable (Laws L1/L2 — no churn).
export const RENDER_CONTEXT = Object.freeze({
  holo: "https://hologram.os/ns#",
  render: { "@id": "holo:render" },
  renderKind: "holo:renderKind",
  contentType: "schema:encodingFormat",   // reuse schema.org's MIME term — interpretable by any agent
  entry: "holo:entry",
});

// Three kinds, named once: "doc" (a static document), "media" (a streamed media object), "experience"
// (a live/interactive surface).
export const RENDER_KINDS = Object.freeze(["doc", "media", "experience"]);

// renderContract({kind, contentType, entry}) — a typed render descriptor. `entry` names the link rel (or
// relative path) the renderer instantiates; `contentType` is its MIME. Throws on an unknown kind.
export function renderContract({ kind, contentType, entry } = {}) {
  if (!RENDER_KINDS.includes(kind)) throw new Error("render kind must be one of " + RENDER_KINDS.join("|"));
  return { "@type": "holo:RenderContract", renderKind: kind,
    ...(contentType ? { contentType } : {}), ...(entry ? { entry } : {}) };
}

// kindOfContentType(ct) — the deterministic fallback dispatch when no contract is declared: video/audio
// instantiate as "media"; everything else (html/json/text/image/…) renders as a "doc". "experience" is
// never inferred — a live surface must declare itself explicitly.
export function kindOfContentType(ct) {
  const s = String(ct || "").toLowerCase();
  return (s.startsWith("video/") || s.startsWith("audio/")) ? "media" : "doc";
}

// selectRender(obj) — the SINGLE render-dispatch authority. Honor a declared contract; else fall back to
// content-type → kind inference. Returns { kind, contentType, entry }; never throws.
export function selectRender(obj) {
  const c = obj && obj.render;
  if (c && RENDER_KINDS.includes(c.renderKind))
    return { kind: c.renderKind, contentType: c.contentType || null, entry: c.entry || null };
  const ct = obj && (obj.contentType || obj.encodingFormat) || null;
  return { kind: kindOfContentType(ct), contentType: ct, entry: null };
}
