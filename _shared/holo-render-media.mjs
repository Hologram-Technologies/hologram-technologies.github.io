// holo-render-media.mjs — substrate-native media renderers (video · audio · image) for the κ render
// registry (holo-render.js). Each mount(el, bytes, ctx) takes L5-verified bytes — a holo:Video /
// holo:Audio / holo:Image JSON spec — and mounts the matching HTML media element. Registered via
// register(HoloRender), the SAME additive pattern as the png/surface builtins, so a media object renders
// through the ONE render(κ) path with no format-specific bypass (Law L4). The media SOURCE is itself a κ
// ("src":"did:holo:sha256:…") resolved through the substrate route the shell wires into ctx, so playback
// is content-addressed too. Lean: zero deps; document is touched only at mount time (Node-importable).
const dec = new TextDecoder();
const specOf = (bytes) => { try { return JSON.parse(dec.decode(bytes)); } catch { return null; } };

// a κ source → the substrate κ-route (content-addressed media); an http/blob/data src passes through.
function srcUrl(s, ctx) {
  if (!s) return "";
  if (/^(https?:|blob:|data:|\/)/.test(s)) return s;
  const hex = String(s).replace(/^did:holo:/, "").replace(/^sha256:/, "");
  return (ctx && typeof ctx.route === "function") ? ctx.route(hex) : "/.holo/sha256/" + hex;
}

export function mountVideo(el, bytes, ctx = {}) {
  const spec = specOf(bytes) || {};
  const v = document.createElement("video");
  v.src = srcUrl(spec.src || spec.url, ctx);
  v.controls = spec.controls !== false; v.style.maxWidth = "100%";
  if (spec.poster) v.poster = srcUrl(spec.poster, ctx);
  if (spec.autoplay) { v.autoplay = true; v.muted = spec.muted !== false; }
  if (spec.loop) v.loop = true;
  el.replaceChildren(v); return { kind: "holo:Video", el: v };
}
export function mountAudio(el, bytes, ctx = {}) {
  const spec = specOf(bytes) || {};
  const a = document.createElement("audio");
  a.src = srcUrl(spec.src || spec.url, ctx); a.controls = spec.controls !== false;
  if (spec.loop) a.loop = true;
  el.replaceChildren(a); return { kind: "holo:Audio", el: a };
}
export function mountImage(el, bytes, ctx = {}) {
  const spec = specOf(bytes) || {};
  const img = document.createElement("img");
  img.src = srcUrl(spec.src || spec.url, ctx); img.alt = spec.alt || ""; img.style.maxWidth = "100%";
  el.replaceChildren(img); return { kind: "holo:Image", el: img };
}

// register the media kinds onto a HoloRender instance (inline-fn handlers — same shape as png/surface).
export function register(HoloRender) {
  HoloRender.register("holo:Video", mountVideo);
  HoloRender.register("holo:Audio", mountAudio);
  HoloRender.register("holo:Image", mountImage);
  return ["holo:Video", "holo:Audio", "holo:Image"];
}

export default { mountVideo, mountAudio, mountImage, register };
