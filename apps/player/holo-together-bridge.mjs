// holo-together-bridge.mjs — unify the Hologram Player's "Watch party" onto the shared Together primitive.
//
// The Player already syncs in-app via HoloWatch (rich: reaction cameras over its own /room relay) — but that room only
// opens in the Player, on Hologram. THIS adds the universal layer: host a holo-together room driven by the Player's
// playback, so one invite opens in ANY browser (together-view.html, off-Hologram) — the SAME Together used in the
// messenger and across the OS. The Player's media is an <iframe>+postMessage engine (no <video> to hold), so we drive
// it through a makeRemoteMedia surface and bindVideo() it: the Player FEEDS playback via onPlayback(); bindVideo turns
// that into the room's play/pause/seek for everyone. Cross-app import of the shared primitives is intentional — these
// are the OS's one Together (they live under holo-messenger today; referenced, not duplicated).
import * as Together from "../holo-messenger/holo-together.mjs";
import "../holo-messenger/holo-together-rtc.mjs";                 // installs window.HoloTogether (host/join over /signal)
import { bindVideo } from "../holo-messenger/holo-together-player.mjs";
import { makeRemoteMedia } from "../holo-messenger/holo-together-media.mjs";

export function createPlayerTogether({ control = () => {}, hostName = "" } = {}) {
  let remote = null, session = null, link = null, intent = null;

  // begin hosting a universal Together room bound to the Player's playback. content = a URL an off-Hologram viewer can
  // play (a plain http(s) media URL); omit for premium/κ sources they can't fetch — they still join the room view-only.
  async function host({ kind = "watch", title = "", content = "" } = {}) {
    if (session) stop();
    remote = makeRemoteMedia({ control });
    intent = await Together.createSession({ kind, title, hostName, content });
    link = Together.buildLink(intent);
    session = await bindVideo(remote.media, { intent });
    return { link: link.https, holo: link.holo, room: intent.room, kappa: intent.kappa };
  }
  // the Player calls this on every playback tick with { time, playing } → drives the room (echo-guarded inside).
  function onPlayback(state) { if (remote && state) remote.pushState(state); }
  function stop() { try { session && session.close(); } catch {} session = null; remote = null; link = null; intent = null; }

  return { host, onPlayback, stop, isLive: () => !!session, link: () => (link ? link.https : null), peers: () => (session ? session.peers() : 0) };
}
