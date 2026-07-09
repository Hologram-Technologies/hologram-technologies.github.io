// holo-youtube.mjs — pure, importable logic for the native YouTube player-swap shim (no DOM, witness-testable).
//
// Phase 0 proved the engine plays a YouTube URL through holo://os/sc/vstream (VP9 video + Opus audio,
// readyState 4) even though YouTube's own MSE player shows "can't play" (this CEF lacks H.264/AAC). This
// module is the decision core: given a page URL + host + YouTube's playabilityStatus, decide whether to swap
// the dead player for a native <video> fed by /sc/vstream, and build the exact proven route string.
//
// The route key is url=<full watch URL> (PROVEN in _cdp-sc-test.ps1), NOT v=<id>.

// Self-gate: only act on YouTube hosts. Anchored to the registrable domain so attacker-youtube.com / a path
// like youtube.com.evil.com do NOT match.
export function isYouTubeHost(hostname) {
  return /(^|\.)youtube\.com$/.test(hostname) || hostname === "youtu.be";
}

// Extract the video id from a watch / shorts / embed / live / youtu.be URL. Returns null if not a video page.
export function extractVideoId(href) {
  let u;
  try { u = new URL(href); } catch { return null; }
  if (u.hostname === "youtu.be") { const id = u.pathname.slice(1).split("/")[0]; return id || null; }
  if (u.pathname === "/watch") return u.searchParams.get("v") || null;
  const m = u.pathname.match(/^\/(shorts|embed|live)\/([^/?#]+)/);
  return m ? (m[2] || null) : null;
}

// The canonical watch URL the /sc/vstream resolver (yt-dlp) expects.
export function canonicalWatchUrl(id) {
  return "https://www.youtube.com/watch?v=" + id;
}

// Build the exact proven route. h = max height (480 / 720 / 1080), mapped to HOLO_SC_MAXH semantics.
export function buildVstreamSrc(id, h = 1080, base = "holo://os/sc/vstream") {
  return base + "?url=" + encodeURIComponent(canonicalWatchUrl(id)) + "&h=" + h;
}

// Classify YouTube's player gate. We swap ONLY clear, playable content; anything requiring login / DRM / age /
// region falls through to YouTube's own player (fail-open). A missing status is treated as "try it" — /sc/vstream
// resolves independently via yt-dlp, and the boot's <video> onerror restores YouTube's player if resolve fails.
export function classifyPlayability(playabilityStatus) {
  if (!playabilityStatus) return { swap: true, reason: "no-status" };
  const s = String(playabilityStatus.status || "").toUpperCase();
  if (s === "OK") return { swap: true, reason: "ok" };
  return { swap: false, reason: s || "not-ok" }; // LOGIN_REQUIRED, UNPLAYABLE, ERROR, AGE_VERIFICATION_REQUIRED, ...
}

// Top-level decision used by the boot. Returns null (no-op) or { id, src }.
export function decideSwap(href, hostname, playabilityStatus, h = 1080, base) {
  if (!isYouTubeHost(hostname)) return null;
  const id = extractVideoId(href);
  if (!id) return null;
  if (!classifyPlayability(playabilityStatus).swap) return null;
  return { id, src: buildVstreamSrc(id, h, base) };
}
