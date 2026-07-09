// holo-together-media.mjs - turn a content URL into a SYNC-READY media surface for "Watch / Listen together".
//
// The high-quality co-watch model (Teleparty / GroupWatch): every peer loads the SAME content LOCALLY at full quality;
// only tiny play/pause/seek control messages cross the wire (holo-together-sync.mjs). So this module's only job is to
// mount the right player for a URL and hand back a media-like object that makeWatchSync can drive uniformly:
//   { currentTime (get/set), paused, play(), pause(), addEventListener('play'|'pause'|'seeked'), removeEventListener }
// A native <video>/<audio> already IS that interface. YouTube gets a thin shim over its IFrame API. Spotify/Vimeo/other
// embeds can't be driven cross-origin reliably, so they degrade to a shared "in the room together" embed (the 3s sync
// heartbeat still keeps direct-media + YouTube rooms locked; embeds are honest about being best-effort). Node-guarded.

// ── classify a content URL → how we'll play it ──
export function classifyContent(url) {
  const u = String(url || "");
  if (/youtube\.com\/watch|youtu\.be\/|music\.youtube\.com/i.test(u)) return "youtube";
  if (/open\.spotify\.com\//i.test(u)) return "spotify";
  if (/vimeo\.com\/\d/i.test(u)) return "vimeo";
  if (/\.(mp4|webm|mov|m4v|m3u8)(\?|#|$)/i.test(u)) return "video";
  if (/\.(mp3|m4a|aac|wav|flac|ogg|opus)(\?|#|$)/i.test(u)) return "audio";
  return "embed";
}
// is this URL drivable in true lockstep (we control currentTime), vs a best-effort shared embed?
export function isSyncable(url) { const t = classifyContent(url); return t === "video" || t === "audio" || t === "youtube"; }

function ytId(url) { try { const u = new URL(url); if (/youtu\.be/.test(u.hostname)) return u.pathname.slice(1); return u.searchParams.get("v"); } catch { return null; } }
function vimeoId(url) { const m = String(url).match(/vimeo\.com\/(\d+)/); return m ? m[1] : null; }
function spotifyEmbed(url) { try { const u = new URL(url); return "https://open.spotify.com/embed" + u.pathname + "?utm_source=holo"; } catch { return url; } }

// ── mount content into `container`; resolve to { type, media, el, destroy } ──
// onReady(media) fires when the media is drivable (metadata loaded / player ready) - bind makeWatchSync there.
export async function mountContent(container, { kind, content } = {}, { onReady = () => {}, autoplay = false, type: typeOverride = null } = {}) {
  const type = typeOverride || classifyContent(content);   // caller may know the MIME (e.g. a blob with no extension)
  container.innerHTML = "";

  if (type === "video" || type === "audio") {
    const el = document.createElement(type === "video" ? "video" : "audio");
    el.src = content; el.controls = true; el.preload = "auto"; el.playsInline = true; el.setAttribute("playsinline", "");
    el.crossOrigin = "anonymous";
    if (autoplay) el.autoplay = true;
    el.style.cssText = type === "video"
      ? "width:100%;height:100%;object-fit:contain;background:#000;display:block"
      : "width:100%;display:block";
    container.appendChild(el);
    let fired = false; const ready = () => { if (fired) return; fired = true; onReady(el); };
    el.addEventListener("loadedmetadata", ready, { once: true });
    if (el.readyState >= 1) ready();
    return { type, media: el, el, destroy() { try { el.pause(); el.removeAttribute("src"); el.load && el.load(); } catch {} container.innerHTML = ""; } };
  }

  if (type === "youtube") return mountYouTube(container, ytId(content), { onReady, autoplay });

  // spotify / vimeo / generic embed - shared room, best-effort (no cross-origin seek control)
  const src = type === "spotify" ? spotifyEmbed(content)
            : type === "vimeo" ? "https://player.vimeo.com/video/" + vimeoId(content)
            : content;
  const f = document.createElement("iframe");
  f.src = src; f.allow = "autoplay; encrypted-media; picture-in-picture; clipboard-write; fullscreen"; f.allowFullscreen = true;
  f.style.cssText = "width:100%;height:100%;border:0;background:#000;display:block";
  container.appendChild(f);
  const media = _passiveShim();
  onReady(media);
  return { type, media, el: f, embed: true, destroy() { container.innerHTML = ""; } };
}

// a no-op media object so makeWatchSync can call play/pause/seek safely on an embed we can't drive
function _passiveShim() {
  let t = 0, paused = true;
  return {
    get currentTime() { return t; }, set currentTime(v) { t = v; },
    get paused() { return paused; },
    play() { paused = false; }, pause() { paused = true; },
    addEventListener() {}, removeEventListener() {},
    _passive: true,
  };
}

// ── makeRemoteMedia - a makeWatchSync-compatible surface for players you DON'T hold a <video> for ──
// Some engines (the Hologram Player) live in an <iframe> driven by postMessage: you can't touch the element, you PUSH
// playback state in and SEND control out. This wraps that model so bindVideo()/makeWatchSync drive it like a native
// element. `control(cmd)` applies a {type:"play"|"pause"|"seek",time} to the real engine (used when this peer FOLLOWS).
// `pushState({time,playing})` feeds authoritative state from the engine; we diff it and fire play/pause/seeked so a
// HOST's bindHost emits them. Returns { media, pushState }.
export function makeRemoteMedia({ control = () => {}, seekEps = 1.2 } = {}) {
  let _time = 0, _paused = true;
  const L = { play: [], pause: [], seeked: [] };
  const fire = (ev) => (L[ev] || []).slice().forEach((fn) => { try { fn(); } catch {} });
  const media = {
    get currentTime() { return _time; },
    set currentTime(v) { _time = v; try { control({ type: "seek", time: v }); } catch {} },
    get paused() { return _paused; },
    play() { if (_paused) { _paused = false; try { control({ type: "play" }); } catch {} } },
    pause() { if (!_paused) { _paused = true; try { control({ type: "pause" }); } catch {} } },
    addEventListener(ev, fn) { if (L[ev]) L[ev].push(fn); },
    removeEventListener(ev, fn) { if (L[ev]) L[ev] = L[ev].filter((x) => x !== fn); },
    _remote: true,
  };
  function pushState({ time, playing } = {}) {
    if (typeof time === "number") { if (Math.abs(time - _time) > seekEps) { _time = time; fire("seeked"); } else _time = time; }
    if (typeof playing === "boolean" && playing === _paused) { _paused = !playing; fire(playing ? "play" : "pause"); }
  }
  return { media, pushState };
}

// ── YouTube IFrame API → a makeWatchSync-compatible shim ──
let _ytLoading = null;
function _loadYT() {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (_ytLoading) return _ytLoading;
  _ytLoading = new Promise((res) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { try { prev && prev(); } catch {} res(); };
    const s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api"; s.async = true; document.head.appendChild(s);
  });
  return _ytLoading;
}
async function mountYouTube(container, id, { onReady, autoplay } = {}) {
  const host = document.createElement("div"); host.style.cssText = "width:100%;height:100%"; container.appendChild(host);
  if (!id) { onReady(_passiveShim()); return { type: "youtube", media: _passiveShim(), el: host, destroy() { container.innerHTML = ""; } }; }
  await _loadYT();
  let player = null; const L = { play: [], pause: [], seeked: [] };
  const fire = (ev) => (L[ev] || []).slice().forEach((fn) => { try { fn(); } catch {} });
  const shim = {
    get currentTime() { try { return player ? player.getCurrentTime() : 0; } catch { return 0; } },
    set currentTime(v) { try { player && player.seekTo(v, true); } catch {} },
    get paused() { try { return !player || player.getPlayerState() !== 1; } catch { return true; } },
    play() { try { player && player.playVideo(); } catch {} },
    pause() { try { player && player.pauseVideo(); } catch {} },
    addEventListener(ev, fn) { if (L[ev]) L[ev].push(fn); },
    removeEventListener(ev, fn) { if (L[ev]) L[ev] = L[ev].filter((x) => x !== fn); },
    _youtube: true,
  };
  await new Promise((res) => {
    player = new window.YT.Player(host, {
      videoId: id, width: "100%", height: "100%",
      playerVars: { autoplay: autoplay ? 1 : 0, modestbranding: 1, rel: 0, playsinline: 1 },
      events: {
        onReady: () => { onReady(shim); res(); },
        onStateChange: (e) => { if (e.data === 1) fire("play"); else if (e.data === 2) fire("pause"); },
      },
    });
  });
  return { type: "youtube", media: shim, el: host, destroy() { try { player && player.destroy(); } catch {} container.innerHTML = ""; } };
}
