// holo-together-sync.mjs - synced "watch together": bind a media element to a Together mesh control channel.
// Model (Teleparty/GroupWatch-style, high quality): each peer loads the SAME content locally; only tiny play/pause/seek
// control messages cross the wire, so everyone decodes at full resolution and stays in lockstep. The HOST drives; viewers
// FOLLOW (apply incoming control, correct drift past a tolerance). Echo-guarded so an applied change doesn't re-broadcast.
// Works on a real <video>/<audio> element OR any object exposing { currentTime, paused, play(), pause(), addEventListener }.

export function makeWatchSync(media, { driftSec = 0.6 } = {}) {
  let applying = false;   // true while we're applying a remote command → don't echo it back

  // VIEWER side (and late-joiner correction): apply a control message to the local media.
  function apply(m) {
    if (!m || typeof m.t !== "string") return;
    applying = true;
    try {
      if (m.t === "play") { if (m.time != null && Math.abs(media.currentTime - m.time) > driftSec) media.currentTime = m.time; if (media.paused) media.play && media.play(); }
      else if (m.t === "pause") { if (m.time != null) media.currentTime = m.time; if (!media.paused) media.pause && media.pause(); }
      else if (m.t === "seek") { media.currentTime = m.time; }
      else if (m.t === "sync") {   // periodic heartbeat → correct drift + state for everyone, incl. late joiners
        if (m.time != null && Math.abs(media.currentTime - m.time) > driftSec) media.currentTime = m.time;
        if (m.playing && media.paused) media.play && media.play();
        if (!m.playing && !media.paused) media.pause && media.pause();
      }
    } catch {}
    setTimeout(() => { applying = false; }, 60);
  }

  // HOST side: broadcast local play/pause/seek + a heartbeat. Returns a stop() that clears the heartbeat.
  function bindHost(mesh, { heartbeatMs = 3000 } = {}) {
    const emit = (t, extra = {}) => { if (applying) return; try { mesh.broadcast && mesh.broadcast({ t, time: media.currentTime, ...extra }); } catch {} };
    const onPlay = () => emit("play"), onPause = () => emit("pause"), onSeek = () => emit("seek");
    media.addEventListener("play", onPlay); media.addEventListener("pause", onPause); media.addEventListener("seeked", onSeek);
    const hb = setInterval(() => { if (!applying) try { mesh.broadcast && mesh.broadcast({ t: "sync", time: media.currentTime, playing: !media.paused }); } catch {} }, heartbeatMs);
    return () => { clearInterval(hb); try { media.removeEventListener("play", onPlay); media.removeEventListener("pause", onPause); media.removeEventListener("seeked", onSeek); } catch {} };
  }

  return { onControl: apply, bindHost, isApplying: () => applying };
}
