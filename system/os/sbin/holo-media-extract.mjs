// holo-media-extract.mjs — the yt-dlp SEAM, made real as a GOVERNED EGRESS tier. Platform media (YouTube,
// Vimeo, …) can't be de-signature-extracted in a sandboxed tab (yt-dlp is Python; the signature cipher isn't
// reproducible in-page). So extraction is an OPT-IN remote tier — the same honest split the OS already uses for
// onion bytes and remote models: the ADDRESS is ours and self-describing, the BYTES need a transport, and that
// transport is PINNED in a sealed receipt. Default OFF with NO baked endpoint (sovereign — no gatekeeper unless
// YOU choose one). Plug an instance you trust (a cobalt / invidious / piped server, or your own) and
// resolveMediaSource lights up the SAME κ-anchored player. Never fabricates a stream: honest null when unset,
// vetoed, or failed → the player's faithful browser fallback. Pure ESM; fetch + clock injected → Node-witnessable.

const HOST = (u) => { try { return new URL(u).host; } catch { return ""; } };

// createExtractor({ kind, endpoint, fetchImpl, allow, now, resolve }) → async (mediaUrl) →
//   { src, mime, media, title, verified:false, via, receipt } | null
//   kind: "cobalt" (POST {url}) | "invidious" | "piped" (GET → streams[]) ; or pass a custom `resolve` fn.
//   allow(url) is the governance veto (a host allow-list, a per-session consent). A sealed hosc:Egress receipt
//   records WHICH service was touched + that this was NOT a direct/in-tab extract (honesty about the tier).
export function createExtractor({ kind = "cobalt", endpoint = null, fetchImpl = (typeof fetch !== "undefined" ? fetch : null), allow = () => true, now = () => Date.now(), resolve = null } = {}) {
  return async function extract(mediaUrl) {
    if (!endpoint || !fetchImpl) return null;                 // sovereign default: no endpoint → no extraction
    if (!allow(mediaUrl)) return null;                        // governance: the caller can veto a host/url
    let out = null;
    try {
      if (typeof resolve === "function") out = await resolve(mediaUrl, { endpoint, fetchImpl });
      else if (kind === "cobalt") {
        const r = await fetchImpl(endpoint, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ url: mediaUrl }) });
        const j = await r.json();
        const src = j.url || (Array.isArray(j.picker) && j.picker[0] && j.picker[0].url) || null;
        if (src) out = { src, mime: /audio/i.test(j.audio || j.status || "") ? "audio/mpeg" : "video/mp4", title: j.filename || null };
      } else if (kind === "invidious" || kind === "piped") {
        const r = await fetchImpl(endpoint, { headers: { accept: "application/json" } });
        const j = await r.json();
        const streams = j.formatStreams || j.videoStreams || [];
        const pick = streams.find((s) => /mp4/i.test(s.type || s.mimeType || "")) || streams[0];
        if (pick && pick.url) out = { src: pick.url, mime: "video/mp4", title: j.title || null };
      }
    } catch { return null; }                                  // honest null on any failure (network, shape, CORS)
    if (!out || !out.src) return null;
    return { ...out, media: (out.mime || "").startsWith("audio") ? "audio" : "video", verified: false, via: kind + "-egress",
             receipt: { "@type": "hosc:Egress", service: HOST(endpoint), source: mediaUrl, directExtract: false, ts: now() } };
  };
}

// a module default so resolveMediaSource can use extraction without each call site wiring it. STILL opt-in:
// stays null until something calls setDefaultExtractor (e.g. a settings panel that records the instance the
// user chose). Unset → platform media keeps its honest browser fallback, exactly as before.
let _default = null;
export const setDefaultExtractor = (fn) => { _default = (typeof fn === "function") ? fn : null; };
export const getDefaultExtractor = () => _default;

export default { createExtractor, setDefaultExtractor, getDefaultExtractor };
