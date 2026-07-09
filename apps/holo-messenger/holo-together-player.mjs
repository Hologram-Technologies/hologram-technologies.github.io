// holo-together-player.mjs - the HOST side of "Watch / Listen together", reusable in ANY Hologram surface.
//
// The off-Hologram viewer (together-view.html) follows; SOMEONE has to drive. This is that driver, in-app - no popup
// browser tab. Two entry points, same engine (hostSession control-only + makeWatchSync.bindHost):
//   • bindVideo(videoEl, {intent})   - you ALREADY have a player (the Hologram Player's <video>): host the room and
//                                       drive sync straight from that element. One line to make any player co-op.
//   • openOverlay({intent})          - you DON'T: pop a self-contained floating player (its OWN DOM - never touches a
//                                       framework tree, so it's conflict-free) that loads intent.content and drives.
// Both return { close }. Control-only room ⇒ no screen-share prompt; each peer plays the content locally in lockstep.

import { hostSession } from "./holo-together.mjs";
import { makeWatchSync } from "./holo-together-sync.mjs";
import { mountContent } from "./holo-together-media.mjs";

// Bind an EXISTING media element as the room's driver. Returns { handle, close }.
export async function bindVideo(videoEl, { intent, driftSec = 0.7, onState = () => {} } = {}) {
  const handle = await hostSession(intent, { control: true, onState });
  const sync = makeWatchSync(videoEl, { driftSec });
  const stop = handle && handle.broadcast ? sync.bindHost(handle) : () => {};
  return {
    handle, sync,
    peers: () => (handle && handle.peers ? handle.peers() : 0),
    close() { try { stop(); } catch {} try { handle && handle.stop && handle.stop(); } catch {} },
  };
}

// Mount the content into `container` AND drive it. Returns { mounted, close }.
export async function hostInPlace(container, { intent, driftSec = 0.7, autoplay = false, onState = () => {} } = {}) {
  const mounted = await mountContent(container, { kind: intent.kind, content: intent.content }, { autoplay });
  const bound = await bindVideo(mounted.media, { intent, driftSec, onState });
  return { mounted, ...bound, close() { try { bound.close(); } catch {} try { mounted.destroy(); } catch {} } };
}

// ── self-contained floating overlay (own DOM, inline styles - no CSS file, no framework) ──
export async function openOverlay({ intent, link = null, onClose = () => {} } = {}) {
  if (typeof document === "undefined") return { close: () => {} };
  const css = (o) => Object.assign(document.createElement("div"), o);
  const overlay = css({ className: "holo-together-overlay" });
  overlay.style.cssText = "position:fixed;inset:0;z-index:2147483000;background:rgba(4,7,11,.72);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:24px;font:14px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
  const card = css({});
  card.style.cssText = "width:min(960px,96vw);background:#0e1620;border:1px solid #1f2c35;border-radius:18px;box-shadow:0 32px 90px rgba(0,0,0,.6);overflow:hidden";
  const head = css({});
  head.style.cssText = "display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid #1f2c35;color:#e9f1f5";
  const isListen = intent.kind === "listen";
  head.innerHTML = "<span style='display:flex;align-items:center;gap:6px;color:#00d09c;font-weight:700;font-size:12px'><span style='width:8px;height:8px;border-radius:50%;background:#00d09c;box-shadow:0 0 0 0 rgba(0,208,156,.6);animation:htPulse 1.6s infinite'></span>LIVE</span>"
    + "<b style='font-size:14px'>" + (isListen ? "Listening" : "Watching") + " together</b>"
    + "<span id='htTitle' style='color:#8aa0ad;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'></span>"
    + "<span id='htPeers' style='margin-left:auto;color:#8aa0ad;font-size:12px'>waiting for friends…</span>";
  const stage = css({});
  stage.style.cssText = "width:100%;aspect-ratio:16/9;background:#000;display:flex;align-items:center;justify-content:center";
  const foot = css({});
  foot.style.cssText = "display:flex;align-items:center;gap:10px;padding:11px 16px;border-top:1px solid #1f2c35;color:#8aa0ad;font-size:12px";
  foot.innerHTML = "<span>🔒 You're the host. Play, pause, seek and everyone follows. Closing ends the room.</span>";
  const spacer = css({}); spacer.style.cssText = "margin-left:auto;display:flex;gap:8px";
  const copyBtn = css({}); copyBtn.textContent = "Copy invite link";
  copyBtn.style.cssText = "background:rgba(255,255,255,.06);color:#e9f1f5;border:1px solid #1f2c35;border-radius:9px;padding:7px 12px;font-size:12px;cursor:pointer";
  const closeBtn = css({}); closeBtn.textContent = "End";
  closeBtn.style.cssText = "background:#e76f6f;color:#0b1014;border:0;border-radius:9px;padding:7px 14px;font-size:12px;font-weight:700;cursor:pointer";
  spacer.append(copyBtn, closeBtn); foot.append(spacer);
  card.append(head, stage, foot); overlay.append(card); document.body.append(overlay);
  if (!document.getElementById("htKeyframes")) { const s = document.createElement("style"); s.id = "htKeyframes"; s.textContent = "@keyframes htPulse{0%{box-shadow:0 0 0 0 rgba(0,208,156,.5)}70%{box-shadow:0 0 0 9px rgba(0,208,156,0)}100%{box-shadow:0 0 0 0 rgba(0,208,156,0)}}"; document.head.append(s); }
  head.querySelector("#htTitle").textContent = intent.title ? "· " + intent.title : "";

  let session;
  try {
    session = await hostInPlace(stage, {
      intent, autoplay: false,
      onState: (st) => { const p = head.querySelector("#htPeers"); if (st && st.count != null) p.textContent = st.count ? (st.count + (st.count === 1 ? " friend watching" : " friends watching")) : "waiting for friends…"; },
    });
  } catch (e) { stage.innerHTML = "<div style='color:#e76f6f;padding:24px'>Couldn't start the player: " + (e && e.message || e) + "</div>"; }

  const close = () => { try { session && session.close(); } catch {} try { overlay.remove(); } catch {} onClose(); };
  closeBtn.onclick = close;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  copyBtn.onclick = async () => { try { await navigator.clipboard.writeText(link || ""); copyBtn.textContent = "Copied ✓"; setTimeout(() => (copyBtn.textContent = "Copy invite link"), 1500); } catch {} };

  // peers poller (in case onState count isn't emitted by the adapter)
  const poll = setInterval(() => { if (!document.body.contains(overlay)) { clearInterval(poll); return; } const n = session && session.peers ? session.peers() : 0; const p = head.querySelector("#htPeers"); if (n) p.textContent = n + (n === 1 ? " friend watching" : " friends watching"); }, 1500);

  return { close, overlay, session };
}
