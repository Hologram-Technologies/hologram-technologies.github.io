// holo-meet-ui.mjs - the IMMERSIVE call surface, Claude-desktop premium. Full-bleed video (the focused
// participant fills the whole screen), your self-view a draggable picture-in-picture, controls that FADE and
// return on tap, and a front/back camera flip - the real mobile-video-call feel (FaceTime / WhatsApp) in a
// clean, sharp, monochrome skin: one type size, hairline-thin lines, glass control pill, line icons (no
// emoji). Own DOM + inline styles (zero React / main.jsx conflict). The app owns the mesh, feeds streams.
//
//   1 remote  → that person fills the screen, you are the PiP.  N remotes → active speaker fills, the rest a
//   thin filmstrip (tap to pin), you are the PiP.  audio → every remote via its own hidden <audio>.

// ── Claude-desktop tokens: one size, one weight scale, 11% hairlines, glass panel, single quiet live accent ──
const FS = "13px";                                   // ONE font size, everywhere
const INK = "#f5f5f4", DIM = "rgba(245,245,244,.55)";
const HAIR = "rgba(255,255,255,.11)", GLASS = "rgba(20,20,19,.66)", GLASS2 = "rgba(255,255,255,.08)";
const LIVE = "#4ade80", DANGER = "#e5484d";
const IC = {
  mic: '<path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="19" x2="12" y2="22"/>',
  micOff: '<line x1="3" y1="3" x2="21" y2="21"/><path d="M9 9v2a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.9-.6"/><path d="M17 16.9A7 7 0 0 1 5 12v-1M19 10v1a7 7 0 0 1-.1 1.2"/><line x1="12" y1="19" x2="12" y2="22"/>',
  cam: '<path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="3"/>',
  camOff: '<path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.7 0H14a2 2 0 0 1 2 2v3.3l1 1L23 7v10"/><line x1="3" y1="3" x2="21" y2="21"/>',
  flip: '<polyline points="22 5 22 10 17 10"/><polyline points="2 19 2 14 7 14"/><path d="M4 9a8 8 0 0 1 13.3-3L22 10M2 14l4.7 4A8 8 0 0 0 20 15"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  present: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  blur: '<circle cx="12" cy="9" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/><path d="M19 4h.01M21 7h.01M17 6h.01"/>',
  end: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
};
const svg = (name, sz = 21) => `<svg viewBox="0 0 24 24" width="${sz}" height="${sz}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${IC[name]}</svg>`;

export function openMeetUI({ name = "Call", video = true, inviteLink = "", onLeave = () => {}, onToggleMute = () => {}, onToggleCamera = () => {}, onFlipCamera = null, onShareScreen = null, onToggleBlur = null } = {}) {
  if (typeof document === "undefined") return { addParticipant() {}, removeParticipant() {}, setActiveSpeaker() {}, setLabel() {}, attachLocal() {}, setSelfMirror() {}, setSharing() {}, setBlurring() {}, setPeerState() {}, setPhase() {}, close() {}, tileCount: () => 0 };
  const el = (t, css, html) => { const n = document.createElement(t); if (css) n.style.cssText = css; if (html != null) n.innerHTML = html; return n; };
  const coarse = (typeof matchMedia !== "undefined" && matchMedia("(pointer:coarse)").matches) || (typeof window !== "undefined" && "ontouchstart" in window);
  const ini = (s) => (String(s || "").trim()[0] || "·").toUpperCase();
  const orbCss = "display:grid;place-items:center;font-weight:600;color:#0a0a0a;background:linear-gradient(150deg,#e9e9e7,#b9b9b5)";

  const overlay = el("div", `position:fixed;inset:0;z-index:2147483600;background:#0a0a0b;overflow:hidden;font:500 ${FS}/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,system-ui,sans-serif;color:${INK};-webkit-tap-highlight-color:transparent;touch-action:none;letter-spacing:-.01em`);

  // ── STAGE: the focused participant, edge to edge ──
  const stage = el("div", "position:absolute;inset:0;background:#0a0a0b"); stage.dataset.holo = "stage";
  const stageVideo = el("video", "width:100%;height:100%;object-fit:cover;background:#0a0a0b;display:none"); stageVideo.autoplay = true; stageVideo.muted = true; stageVideo.setAttribute("playsinline", "");
  const stageAvatar = el("div", "position:absolute;inset:0;display:flex;align-items:center;justify-content:center");
  const stageOrb = el("div", "width:104px;height:104px;border-radius:50%;font-size:40px;" + orbCss, "·");
  stageAvatar.append(stageOrb);
  const stageName = el("div", `position:absolute;left:16px;bottom:calc(env(safe-area-inset-bottom,0px) + 106px);padding:6px 12px;border-radius:10px;background:${GLASS};border:1px solid ${HAIR};font-weight:600;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);opacity:0;transition:opacity .22s`);
  stage.append(stageVideo, stageAvatar, stageName);

  // ── SELF PiP (draggable) ──
  const pipW = coarse ? 104 : 172, pipH = coarse ? 148 : 112;
  const pip = el("div", `position:absolute;right:16px;top:calc(env(safe-area-inset-top,0px) + 68px);width:${pipW}px;height:${pipH}px;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,.22);background:#141413;box-shadow:0 8px 34px rgba(0,0,0,.5);cursor:grab;z-index:7;touch-action:none;display:none`); pip.dataset.holo = "pip";
  const pipVideo = el("video", "width:100%;height:100%;object-fit:cover;transform:scaleX(-1);background:#141413"); pipVideo.autoplay = true; pipVideo.muted = true; pipVideo.setAttribute("playsinline", "");
  const pipOrb = el("div", "position:absolute;inset:0;font-size:22px;border-radius:14px;" + orbCss, "·");
  pip.append(pipVideo, pipOrb);

  // ── TOP BAR (fades): live dot · name · count ──
  const topbar = el("div", "position:absolute;left:0;right:0;top:0;padding:calc(env(safe-area-inset-top,0px) + 14px) 18px 26px;display:flex;align-items:center;gap:9px;background:linear-gradient(180deg,rgba(0,0,0,.5),transparent);transition:opacity .22s;z-index:8;pointer-events:none");
  const dot = el("span", `width:8px;height:8px;border-radius:50%;background:${LIVE};box-shadow:0 0 8px ${LIVE};flex:0 0 auto`);
  const titleEl = el("b", "font-weight:600;max-width:52vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", name);
  const countEl = el("span", `color:${DIM}`);
  const statusEl = el("span", `margin-left:auto;color:${DIM}`);
  topbar.append(dot, titleEl, countEl, statusEl);

  // ── FILMSTRIP (fades): the non-focused remotes — thumbnails only, no redundant labels ──
  const strip = el("div", "position:absolute;left:0;right:0;bottom:calc(env(safe-area-inset-bottom,0px) + 98px);display:flex;gap:8px;padding:0 14px;overflow-x:auto;justify-content:center;transition:opacity .22s;z-index:6");

  // ── CONTROLS (fade): one glass pill, monochrome line icons ──
  const controls = el("div", "position:absolute;left:0;right:0;bottom:calc(env(safe-area-inset-bottom,0px) + 18px);display:flex;justify-content:center;transition:opacity .22s;z-index:8"); controls.dataset.holo = "controls";
  const pill = el("div", `display:flex;gap:8px;align-items:center;padding:8px;border-radius:999px;background:${GLASS};border:1px solid ${HAIR};backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);box-shadow:0 8px 34px rgba(0,0,0,.45)`);
  controls.append(pill);
  const btn = (icon, title, danger) => { const b = el("button", `border:0;border-radius:50%;width:52px;height:52px;cursor:pointer;background:${danger ? DANGER : GLASS2};color:${danger ? "#fff" : INK};display:grid;place-items:center;transition:background .15s,transform .08s`, svg(icon)); b.title = title; b.onpointerdown = (e) => e.stopPropagation(); b.onmousedown = (e) => e.stopPropagation(); b.onmouseenter = () => { if (!danger) b.style.background = "rgba(255,255,255,.16)"; }; b.onmouseleave = () => { if (!danger) b.style.background = GLASS2; }; return b; };

  let muted = false, camOff = false, _bShare = null, _bBlur = null, blurring = false;
  const bMute = btn("mic", "Mute");
  bMute.onclick = () => { muted = !muted; onToggleMute(muted); bMute.innerHTML = svg(muted ? "micOff" : "mic"); bMute.style.background = muted ? DANGER : GLASS2; bMute.style.color = muted ? "#fff" : INK; };
  pill.append(bMute);
  if (video) {
    const bCam = btn("cam", "Camera");
    bCam.onclick = () => { camOff = !camOff; onToggleCamera(camOff); bCam.innerHTML = svg(camOff ? "camOff" : "cam"); bCam.style.background = camOff ? DANGER : GLASS2; bCam.style.color = camOff ? "#fff" : INK; pip.style.opacity = camOff ? ".35" : "1"; };
    pill.append(bCam);
    if (onToggleBlur) { _bBlur = btn("blur", "Blur background"); _bBlur.onclick = () => { try { onToggleBlur(); } catch {} }; pill.append(_bBlur); }
    if (onFlipCamera) { const bFlip = btn("flip", "Flip camera"); bFlip.onclick = () => { try { onFlipCamera(); } catch {} }; pill.append(bFlip); }
    if (onShareScreen) { _bShare = btn("present", "Share screen"); _bShare.onclick = () => { try { onShareScreen(); } catch {} }; pill.append(_bShare); }
  }
  if (inviteLink) {
    const bInv = btn("link", "Invite");
    bInv.onclick = async () => {
      let done = false; try { await navigator.clipboard.writeText(inviteLink); done = true; } catch {}
      if (!done) { try { const ta = el("textarea", "position:fixed;opacity:0"); ta.value = inviteLink; document.body.append(ta); ta.select(); done = document.execCommand("copy"); ta.remove(); } catch {} }
      bInv.innerHTML = svg(done ? "check" : "link"); bInv.style.color = done ? LIVE : INK; setTimeout(() => { bInv.innerHTML = svg("link"); bInv.style.color = INK; }, 1500);
    };
    pill.append(bInv);
  }
  const bLeave = btn("end", "Leave", true); bLeave.onclick = () => { onLeave(); close(); }; pill.append(bLeave);

  overlay.append(stage, pip, strip, topbar, controls); document.body.append(overlay);

  // ── chrome auto-fade: tap the stage toggles; any move brings it back; hides after a few seconds ──
  let hideT = null, chromeOn = false;
  const chrome = [topbar, controls, strip];
  function showChrome() { chromeOn = true; for (const c of chrome) c.style.opacity = "1"; controls.style.pointerEvents = "auto"; strip.style.pointerEvents = "auto"; stageName.style.opacity = stageVideo.style.display === "block" ? "1" : "0"; overlay.style.cursor = "default"; clearTimeout(hideT); hideT = setTimeout(hideChrome, 3800); }
  function hideChrome() { chromeOn = false; for (const c of chrome) c.style.opacity = "0"; controls.style.pointerEvents = "none"; strip.style.pointerEvents = "none"; stageName.style.opacity = "0"; overlay.style.cursor = "none"; }
  stage.addEventListener("click", () => { chromeOn ? hideChrome() : showChrome(); });
  overlay.addEventListener("pointermove", () => { if (!dragging) { if (!chromeOn) showChrome(); else { clearTimeout(hideT); hideT = setTimeout(hideChrome, 3800); } } });

  // ── self PiP drag ──
  let dragging = false, dx = 0, dy = 0;
  pip.addEventListener("pointerdown", (e) => { dragging = true; pip.style.cursor = "grabbing"; const r = pip.getBoundingClientRect(); dx = e.clientX - r.left; dy = e.clientY - r.top; pip.style.right = "auto"; pip.setPointerCapture && pip.setPointerCapture(e.pointerId); e.stopPropagation(); });
  pip.addEventListener("pointermove", (e) => { if (!dragging) return; const w = pip.offsetWidth, h = pip.offsetHeight; const left = Math.min(Math.max(6, e.clientX - dx), window.innerWidth - w - 6); const top = Math.min(Math.max(6, e.clientY - dy), window.innerHeight - h - 6); pip.style.left = left + "px"; pip.style.top = top + "px"; e.preventDefault(); });
  const endDrag = () => { dragging = false; pip.style.cursor = "grab"; };
  pip.addEventListener("pointerup", endDrag); pip.addEventListener("pointercancel", endDrag);

  // ── participant model ──
  const remotes = new Map();   // id → { stream, label, audio }
  const _reconn = new Set();   // peer ids currently reconnecting (network dropped, ICE restarting)
  let selfLabel = "You", focusId = null, pinned = false, alone = true;

  function playAudio(id, stream) { const r = remotes.get(id); if (!r) return; let a = r.audio; if (!a) { a = el("audio"); a.autoplay = true; a.setAttribute("playsinline", ""); overlay.append(a); r.audio = a; } try { a.srcObject = stream; a.play && a.play().catch(() => {}); } catch {} }
  function hasLiveVideo(stream) { try { return !!stream && stream.getVideoTracks().some((t) => t.enabled && t.readyState === "live"); } catch { return false; } }

  function paintStage() {
    const r = focusId && remotes.get(focusId);
    if (r && r.stream) {
      try { if (stageVideo.srcObject !== r.stream) stageVideo.srcObject = r.stream; } catch {}
      stageVideo.style.display = "block"; stageOrb.textContent = ini(r.label); stageName.textContent = r.label || "Guest";
      stageAvatar.style.display = hasLiveVideo(r.stream) ? "none" : "flex"; if (chromeOn) stageName.style.opacity = "1";
    } else { stageVideo.style.display = "none"; stageAvatar.style.display = "flex"; stageOrb.textContent = ini(selfLabel); stageName.style.opacity = "0"; }
  }
  stageVideo.addEventListener("loadeddata", () => { if (stageVideo.videoWidth > 0) stageAvatar.style.display = "none"; });

  function rebuildStrip() {
    strip.innerHTML = "";
    const others = [...remotes.keys()].filter((id) => id !== focusId);
    strip.style.display = others.length ? "flex" : "none";
    for (const id of others) {
      const r = remotes.get(id);
      const tile = el("div", `position:relative;flex:0 0 auto;width:76px;height:100px;border-radius:12px;overflow:hidden;background:#141413;border:1px solid ${HAIR};cursor:pointer`);
      const v = el("video", "width:100%;height:100%;object-fit:cover;background:#141413"); v.autoplay = true; v.muted = true; v.setAttribute("playsinline", ""); try { v.srcObject = r.stream; } catch {}
      const orb = el("div", "position:absolute;inset:0;font-size:20px;" + orbCss, ini(r.label));
      v.addEventListener("loadeddata", () => { if (v.videoWidth > 0) orb.style.display = "none"; });
      tile.append(v, orb);
      tile.onclick = (e) => { e.stopPropagation(); pinned = true; focusId = id; paintStage(); rebuildStrip(); };
      strip.append(tile);
    }
  }

  function relayout() { const n = remotes.size; alone = n === 0; pip.style.display = alone ? "none" : "block"; countEl.textContent = "· " + (n + 1) + (n + 1 === 1 ? " person" : " people"); }
  function close() { try { for (const [, r] of remotes) { try { r.audio && (r.audio.srcObject = null); } catch {} } } catch {} try { stageVideo.srcObject = null; pipVideo.srcObject = null; } catch {} clearTimeout(hideT); try { overlay.remove(); } catch {} }

  showChrome();

  return {
    overlay,
    attachLocal(stream, label = "You", mirror = true) {
      selfLabel = label; pipOrb.textContent = ini(label); if (!focusId) stageOrb.textContent = ini(label);
      pipVideo.style.transform = mirror ? "scaleX(-1)" : "none";
      try { pipVideo.srcObject = stream; } catch {}
      pipVideo.addEventListener("loadeddata", () => { if (pipVideo.videoWidth > 0) pipOrb.style.display = "none"; }, { once: true });
      if (!hasLiveVideo(stream)) pipOrb.style.display = "grid";
      paintStage();
    },
    setSelfMirror(on) { pipVideo.style.transform = on ? "scaleX(-1)" : "none"; },
    setSharing(on) { if (_bShare) { _bShare.style.background = on ? LIVE : GLASS2; _bShare.style.color = on ? "#0a0a0a" : INK; _bShare.title = on ? "Stop sharing" : "Share screen"; } titleEl.textContent = on ? "You're presenting" : name; },
    setBlurring(on) { blurring = on; if (_bBlur) { _bBlur.style.background = on ? LIVE : GLASS2; _bBlur.style.color = on ? "#0a0a0a" : INK; _bBlur.title = on ? "Background blurred" : "Blur background"; } },
    addParticipant(id, stream, label = "Guest") {
      const r = remotes.get(id) || {}; r.stream = stream; if (label) r.label = label; remotes.set(id, r);
      playAudio(id, stream);
      if (!focusId || !remotes.has(focusId)) { focusId = id; pinned = false; }
      paintStage(); rebuildStrip(); relayout();
    },
    removeParticipant(id) {
      const r = remotes.get(id); if (r && r.audio) { try { r.audio.srcObject = null; r.audio.remove(); } catch {} }
      remotes.delete(id);
      if (focusId === id) { focusId = remotes.keys().next().value || null; pinned = false; }
      paintStage(); rebuildStrip(); relayout();
    },
    setActiveSpeaker(id) { if (!remotes.has(id) || pinned || id === focusId) return; focusId = id; paintStage(); rebuildStrip(); },
    setLabel(id, label) { const r = remotes.get(id); if (r && label) { r.label = label; if (id === focusId) { stageName.textContent = label; stageOrb.textContent = ini(label); } rebuildStrip(); } },
    setPhase(p) { if (p === "connecting") statusEl.textContent = "Connecting"; else if (p === "connected") { if (!_reconn.size) statusEl.textContent = ""; } else if (p === "ended") { statusEl.textContent = "Ended"; setTimeout(close, 600); } },
    // a peer's network dropped → show it honestly (never a silent freeze); the mesh is restarting ICE under it
    setPeerState(id, state) {
      if (state === "reconnecting") _reconn.add(id); else _reconn.delete(id);
      statusEl.textContent = _reconn.size ? "Reconnecting" : "";
      stageVideo.style.filter = _reconn.has(focusId) ? "grayscale(.5) brightness(.72)" : "none";
    },
    tileCount: () => remotes.size + 1,
    close,
  };
}
