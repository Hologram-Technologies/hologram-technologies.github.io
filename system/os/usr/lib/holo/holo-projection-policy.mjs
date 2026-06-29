// holo-projection-policy.mjs — THE ONE policy for the unified projection.
//
// Every surface in Hologram — a web document, a holo app, a 3D holospace, a streamed video — is projected from
// the SAME κ-tile substrate. This module is the single decision that makes them one: given whatever is known
// about a surface at open time, it returns HOW to project it. There is exactly one rule, applied at both call
// sites (the web open path `shell-main.projectOpen` and the app path `run.html`), so projection is one concept,
// not two parallel ones.
//
// THE RULE (the honest core): a web DOCUMENT projects PIXEL-NATIVE — render at native res, no super-res, so DOM
// text and chrome stay perfectly crisp (super-res would BLUR text — the opposite of hyper-real). A GPU surface —
// app / 3D / video — projects RENDER-CHEAP + super-res + SSAA: it draws at an internal resolution and the lens
// upscales it sharp, because that content looks great upscaled and the saved pixels are the whole win. Mixed
// pages (a video inside a text article) are handled per-tile by `classifyTile`.
//
// Pure + node-witnessed (see holo-projection-policy-witness.mjs). No DOM, no GPU here — just the decision.

export const KINDS = Object.freeze(["doc", "app", "3d", "video"]);

// treatment: "pixel-native" = native res, no upscale (text/chrome MUST stay crisp).
//            "super-res"     = render cheap at internalScale, Catmull-Rom upscale + SSAA (GPU/3D/video).
const BASE = Object.freeze({
  doc:   { treatment: "pixel-native", internalScale: 1.0,  ssaa: 1.0 },
  app:   { treatment: "super-res",    internalScale: 0.85, ssaa: 1.5 },
  "3d":  { treatment: "super-res",    internalScale: 0.85, ssaa: 1.5 },
  video: { treatment: "super-res",    internalScale: 0.7,  ssaa: 1.3 },   // decode/draw cheaper; video upscales beautifully
});

const VIDEO_EXT = /\.(mp4|webm|m3u8|mpd|mkv|mov|avi|ogv)(\?|#|$)/i;
const VIDEO_HOST = /(?:^|[/.])(youtube\.com|youtu\.be|vimeo\.com|twitch\.tv|dailymotion\.com)(?:[/:?#]|$)/i;

// detectKind(surface) → "doc" | "app" | "3d" | "video". Explicit declaration wins; then MIME, URL, GPU signals.
function detectKind(s) {
  const hint = String(s.surfaceKind || "").toLowerCase();
  if (KINDS.includes(hint)) return hint;                                  // an app/holospace may DECLARE its kind
  const mime = String(s.mime || "").toLowerCase();
  if (mime.startsWith("video/")) return "video";
  const url = String(s.url || "");
  if (url && (VIDEO_EXT.test(url) || VIDEO_HOST.test(url))) return "video";
  if (s.hasWebGPU || s.hasWebGL) return "3d";                             // a GPU canvas surface
  return "doc";                                                          // default: a web document ⇒ PIXEL-NATIVE
}

// classify(surface, tier?) → { kind, treatment, internalScale, ssaa, reason }
//   surface: { surfaceKind?, url?, mime?, hasWebGL?, hasWebGPU? } — any signal available when the surface opens.
//   tier:    optional GPU tier { internalScale?, ssaa? } (from holo-canvas detectGPU). Applied to SUPER-RES kinds
//            only — a weaker GPU renders cheaper; a stronger one supersamples more. NEVER applied to pixel-native.
export function classify(surface = {}, tier = null) {
  const kind = detectKind(surface);
  const base = BASE[kind];
  const out = { kind, treatment: base.treatment, internalScale: base.internalScale, ssaa: base.ssaa, reason: kind };
  if (base.treatment === "super-res" && tier) {
    if (typeof tier.internalScale === "number") out.internalScale = tier.internalScale;
    if (typeof tier.ssaa === "number") out.ssaa = tier.ssaa;
  }
  return out;
}

// classifyTile(stats) → { region, superRes } — the per-tile rule for a MIXED page (e.g. a <video> in an article).
// The lens computes cheap per-tile stats (edge density) on the bytes it already has; high edge density = sharp
// text strokes on a flat ground ⇒ keep NATIVE; smooth/gradient ⇒ media ⇒ super-res is safe. Pure.
//   stats: { edgeDensity: 0..1 (fraction of high-gradient pixels) }
export function classifyTile(stats = {}) {
  const edge = Number(stats.edgeDensity) || 0;
  const region = edge > 0.10 ? "text" : "media";
  return { region, superRes: region === "media" };
}

export default { KINDS, classify, classifyTile };
