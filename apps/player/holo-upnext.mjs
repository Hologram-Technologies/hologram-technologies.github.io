// holo-upnext.mjs — binge flow: pick the next episode and decide when to surface the "Up next" card with a
// countdown (Netflix autoplay-next). Pure ordering logic over an episode list; the player drives the UI and
// the actual auto-advance. Works for any series whose episodes are loaded (TMDb season fetch).

// nextEpisode(current, episodes) → the next episode after `current` in season/episode order, or null at the
// end. `episodes` may span multiple seasons; we sort by (season, episode) and step forward.
export function nextEpisode(current, episodes) {
  if (!current || !Array.isArray(episodes) || !episodes.length) return null;
  const key = (e) => (e.seasonNumber || 0) * 1000 + (e.episodeNumber || 0);
  const sorted = [...episodes].sort((a, b) => key(a) - key(b));
  const i = sorted.findIndex((e) => e.id === current.id || (e.seasonNumber === current.seasonNumber && e.episodeNumber === current.episodeNumber));
  if (i < 0 || i + 1 >= sorted.length) return null;
  return sorted[i + 1];
}

// shouldPromptNext(status, opts) → true when the playhead is within `leadSec` of the end (so the card slides
// in over the credits). Honest guards: needs a known duration and a meaningful runtime.
export function shouldPromptNext(status, { leadSec = 22 } = {}) {
  const { currentTime = 0, duration = 0 } = status || {};
  if (!duration || duration < 60) return false;
  return duration - currentTime <= leadSec && currentTime > 0;
}

// countdown(status, opts) → whole seconds remaining until auto-advance (clamped ≥ 0).
export function countdown(status, { leadSec = 22 } = {}) {
  const rem = Math.max(0, (status.duration || 0) - (status.currentTime || 0));
  return Math.max(0, Math.ceil(Math.min(rem, leadSec)));
}

export default { nextEpisode, shouldPromptNext, countdown };
if (typeof window !== "undefined") window.HoloUpNext = { nextEpisode, shouldPromptNext, countdown };
