// holo-call-ui.mjs - the call surface. One self-contained floating overlay (its OWN DOM + inline styles → zero React/
// main.jsx conflict) for BOTH outgoing and incoming, voice AND video. The app owns the transport (holo-call.joinCall)
// and wires phase / remote-stream / local-stream into it. Returns controls.
//   audio call → a compact card (avatar, name, status, mute + end).
//   video call → a 16:9 stage: remote video fills, your self-view is a PiP, controls overlay (mute, camera, end).

export function openCallUI({ mode = "outgoing", name = "Someone", video = false, localStream = null,
  onAccept = () => {}, onDecline = () => {}, onHangup = () => {}, onToggleMute = () => {}, onToggleCamera = () => {} } = {}) {
  if (typeof document === "undefined") return { setPhase() {}, attachRemote() {}, attachLocal() {}, setMuted() {}, close() {} };
  const el = (tag, css, html) => { const n = document.createElement(tag); if (css) n.style.cssText = css; if (html != null) n.innerHTML = html; return n; };
  if (!document.getElementById("hcKf")) { const s = document.createElement("style"); s.id = "hcKf"; s.textContent = "@keyframes hcB{0%,80%,100%{opacity:.25;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}"; document.head.appendChild(s); }

  const overlay = el("div", "position:fixed;inset:0;z-index:2147483600;background:rgba(4,7,11,.85);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:24px;font:14px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif");
  const initial = (name.trim()[0] || "·").toUpperCase();

  // ── shared bits ──
  let muted = false, cameraOff = false, timer = null, secs = 0, connected = false;
  const fmt = (s) => (s / 60 | 0).toString().padStart(2, "0") + ":" + (s % 60).toString().padStart(2, "0");
  const remoteAudio = el("audio", "display:none"); remoteAudio.autoplay = true; remoteAudio.setAttribute("playsinline", "");
  const remoteVideo = el("video", "width:100%;height:100%;object-fit:cover;background:#05080b;display:" + (video ? "block" : "none")); remoteVideo.autoplay = true; remoteVideo.setAttribute("playsinline", "");
  const localVideo = el("video", "width:100%;height:100%;object-fit:cover;transform:scaleX(-1)"); localVideo.autoplay = true; localVideo.muted = true; localVideo.setAttribute("playsinline", "");

  // ── card / stage ──
  const card = el("div", video
    ? "width:min(880px,96vw);background:#0e1620;border:1px solid #1f2c35;border-radius:20px;box-shadow:0 32px 90px rgba(0,0,0,.6);overflow:hidden;color:#e9f1f5"
    : "width:min(360px,94vw);background:#0e1620;border:1px solid #1f2c35;border-radius:22px;box-shadow:0 32px 90px rgba(0,0,0,.6);padding:30px 24px 22px;text-align:center;color:#e9f1f5");

  const statusEl = el("div", video ? "" : "color:#8aa0ad;font-size:14px;margin-top:6px;min-height:20px");
  statusEl.textContent = mode === "incoming" ? (video ? "Incoming video call…" : "Incoming voice call…") : (video ? "Video calling…" : "Calling…");
  const btnRow = el("div", "display:flex;gap:12px;justify-content:center");
  const mkBtn = (bg, fg, label) => el("button", `border:0;border-radius:14px;padding:13px 16px;font-size:14px;font-weight:700;cursor:pointer;background:${bg};color:${fg};min-width:96px`, label);

  if (video) {
    const stage = el("div", "position:relative;width:100%;aspect-ratio:16/9;background:#05080b");
    const avatarBig = el("div", "position:absolute;inset:0;display:flex;align-items:center;justify-content:center", `<div style='width:96px;height:96px;border-radius:50%;display:grid;place-items:center;font-size:40px;font-weight:700;color:#04110d;background:linear-gradient(135deg,#00d09c,#27e3b3)'>${initial}</div>`);
    const pip = el("div", "position:absolute;right:14px;bottom:14px;width:148px;height:96px;border-radius:12px;overflow:hidden;border:2px solid rgba(255,255,255,.25);background:#000;box-shadow:0 8px 22px rgba(0,0,0,.5)");
    pip.append(localVideo);
    const topbar = el("div", "position:absolute;left:0;top:0;right:0;padding:12px 16px;display:flex;align-items:center;gap:10px;background:linear-gradient(180deg,rgba(0,0,0,.5),transparent);color:#fff");
    topbar.append(el("b", "font-size:15px", name), statusEl); statusEl.style.cssText = "color:#cfe;opacity:.85;font-size:13px";
    const ctrls = el("div", "position:absolute;left:0;right:0;bottom:0;padding:16px;display:flex;gap:12px;justify-content:center;background:linear-gradient(0deg,rgba(0,0,0,.55),transparent)");
    ctrls.append(btnRow);
    stage.append(remoteVideo, avatarBig, pip, topbar, ctrls, remoteAudio);
    card.append(stage);
    // remote video present → hide the avatar fallback
    remoteVideo.addEventListener("loadeddata", () => { avatarBig.style.display = "none"; });
    if (localStream) { try { localVideo.srcObject = localStream; } catch {} } else pip.style.display = "none";
  } else {
    const avatar = el("div", "width:88px;height:88px;border-radius:50%;margin:0 auto 14px;display:grid;place-items:center;font-size:36px;font-weight:700;color:#04110d;background:linear-gradient(135deg,#00d09c,#27e3b3);box-shadow:0 10px 30px rgba(0,208,156,.3)", initial);
    const nameEl = el("div", "font-size:21px;font-weight:700;letter-spacing:-.2px", name);
    const ring = el("div", "margin:18px auto 0;width:64px;height:8px", "<div style='display:flex;gap:6px;justify-content:center'><i></i><i></i><i></i></div>");
    ring.querySelectorAll("i").forEach((d, i) => { d.style.cssText = `width:8px;height:8px;border-radius:50%;background:#00d09c;animation:hcB 1.2s ${i * 0.16}s infinite ease-in-out`; });
    card._ring = ring;
    btnRow.style.marginTop = "24px";
    card.append(avatar, nameEl, statusEl, ring, btnRow, remoteAudio);
  }
  overlay.append(card); document.body.append(overlay);

  function startTimer() { if (timer) return; connected = true; stopRing(); const set = () => statusEl.textContent = (video ? "" : "Voice call · ") + fmt(secs); if (!video) set(); timer = setInterval(() => { secs++; if (!video) statusEl.textContent = "Voice call · " + fmt(secs); else statusEl.textContent = fmt(secs); }, 1000); if (video) statusEl.textContent = "00:00"; if (card._ring) card._ring.style.display = "none"; }
  function close() { stopRing(); try { clearInterval(timer); } catch {} try { remoteAudio.srcObject = null; remoteVideo.srcObject = null; localVideo.srcObject = null; } catch {} try { overlay.remove(); } catch {} }

  // ── THE RING (WhatsApp's identity is the sound) — WebAudio-generated, zero bytes shipped, fully fail-soft. ──
  // incoming = a warm two-tone "ding-dong" every 2s + vibration; outgoing = the classic soft ringback (1s on/3s off).
  // Autoplay policy may keep the context suspended until a gesture → resume() is retried on first pointer/keydown;
  // the visual ring + vibration never depend on the sound. Everything stops the instant the call connects or ends.
  let _ac = null, _ringTimer = null, _vibTimer = null, _resumeHook = null;
  function _beep(freq, at, dur, gain) { try { const o = _ac.createOscillator(), g = _ac.createGain(); o.type = "sine"; o.frequency.value = freq; g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(gain, at + 0.02); g.gain.setValueAtTime(gain, at + dur - 0.06); g.gain.linearRampToValueAtTime(0, at + dur); o.connect(g).connect(_ac.destination); o.start(at); o.stop(at + dur + 0.02); } catch {} }
  function startRing(kind) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      _ac = new AC();
      const kick = () => { try { _ac.resume && _ac.resume().catch(() => {}); } catch {} };
      kick();
      if (_ac.state === "suspended") { _resumeHook = () => kick(); document.addEventListener("pointerdown", _resumeHook, { once: true }); document.addEventListener("keydown", _resumeHook, { once: true }); }
      const cycle = kind === "incoming"
        ? () => { const t = _ac.currentTime + 0.03; _beep(784, t, 0.32, 0.14); _beep(587, t + 0.36, 0.4, 0.14); }        // G5→D5 ding-dong
        : () => { const t = _ac.currentTime + 0.03; _beep(425, t, 1.0, 0.05); };                                          // soft ringback
      cycle(); _ringTimer = setInterval(cycle, kind === "incoming" ? 2000 : 4000);
      if (kind === "incoming" && navigator.vibrate) { const vib = () => { try { navigator.vibrate([400, 240, 400]); } catch {} }; vib(); _vibTimer = setInterval(vib, 2000); }
    } catch {}
  }
  function stopRing() {
    try { clearInterval(_ringTimer); clearInterval(_vibTimer); _ringTimer = _vibTimer = null; } catch {}
    try { navigator.vibrate && navigator.vibrate(0); } catch {}
    try { if (_resumeHook) { document.removeEventListener("pointerdown", _resumeHook); document.removeEventListener("keydown", _resumeHook); _resumeHook = null; } } catch {}
    try { if (_ac) { _ac.close(); _ac = null; } } catch {}
  }

  function renderInCall() {
    btnRow.innerHTML = "";
    const muteBtn = mkBtn("rgba(255,255,255,.12)", "#fff", muted ? "🔇 Unmute" : "🎙 Mute");
    muteBtn.onclick = () => { muted = !muted; onToggleMute(muted); muteBtn.textContent = muted ? "🔇 Unmute" : "🎙 Mute"; };
    btnRow.append(muteBtn);
    if (video) { const camBtn = mkBtn("rgba(255,255,255,.12)", "#fff", "📷 Camera"); camBtn.onclick = () => { cameraOff = !cameraOff; onToggleCamera(cameraOff); camBtn.textContent = cameraOff ? "📷 Camera on" : "📷 Camera off"; localVideo.style.opacity = cameraOff ? ".25" : "1"; }; btnRow.append(camBtn); }
    const hangBtn = mkBtn("#e76f6f", "#0b1014", "End"); hangBtn.onclick = () => { onHangup(); close(); }; btnRow.append(hangBtn);
  }
  if (mode === "incoming") {
    const declineBtn = mkBtn("#e76f6f", "#0b1014", "Decline");
    const acceptBtn = mkBtn("#00d09c", "#04110d", "Accept");
    declineBtn.onclick = () => { stopRing(); onDecline(); close(); };
    acceptBtn.onclick = () => { stopRing(); statusEl.textContent = "Connecting…"; renderInCall(); onAccept(); };
    btnRow.append(declineBtn, acceptBtn);
    startRing("incoming");
  } else { renderInCall(); startRing("outgoing"); }

  return {
    overlay,
    setPhase(phase) {
      if (phase === "connecting") statusEl.textContent = "Connecting…";
      else if (phase === "connected") { const wasReconn = connected && timer; startTimer(); if (wasReconn && video) statusEl.textContent = ""; }
      // a network change (Wi-Fi↔cellular) → the mesh/peer restarts ICE under us. Show it, never auto-close.
      else if (phase === "reconnecting" || phase === "disconnected") { statusEl.textContent = "Reconnecting…"; }
      else if (phase === "ended" || phase === "failed") { statusEl.textContent = phase === "failed" ? "Call failed" : "Call ended"; setTimeout(close, 900); }
      else if (phase === "declined") { stopRing(); statusEl.textContent = "Declined"; setTimeout(close, 900); }
      else if (phase === "no-answer") { stopRing(); statusEl.textContent = "No answer"; setTimeout(close, 1200); }
      else if (phase === "missed") { stopRing(); statusEl.textContent = "Missed call"; setTimeout(close, 1200); }
    },
    attachRemote(stream) { try { remoteAudio.srcObject = stream; remoteAudio.play && remoteAudio.play().catch(() => {}); if (video) { remoteVideo.srcObject = stream; remoteVideo.play && remoteVideo.play().catch(() => {}); } } catch {} },
    attachLocal(stream) { try { localVideo.srcObject = stream; } catch {} },
    setMuted(m) { muted = !!m; },
    close,
  };
}
