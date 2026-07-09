// holo-meet-ui.mjs - the meeting surface: a self-contained floating overlay (OWN DOM + inline styles → zero React
// conflict) rendering an N-tile GRID (your self-view + every remote participant), an active-speaker highlight, and
// controls (mute / camera / leave). The app owns the mesh (holo-call-mesh.joinMesh) and feeds streams in.

export function openMeetUI({ name = "Meeting", video = true, onLeave = () => {}, onToggleMute = () => {}, onToggleCamera = () => {} } = {}) {
  if (typeof document === "undefined") return { addParticipant() {}, removeParticipant() {}, setActiveSpeaker() {}, attachLocal() {}, setPhase() {}, close() {}, tileCount: () => 0 };
  const el = (t, css, html) => { const n = document.createElement(t); if (css) n.style.cssText = css; if (html != null) n.innerHTML = html; return n; };

  const overlay = el("div", "position:fixed;inset:0;z-index:2147483600;background:#070b0f;display:flex;flex-direction:column;font:14px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#e9f1f5");
  const head = el("div", "display:flex;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px solid #16212b");
  head.innerHTML = `<span style="display:flex;align-items:center;gap:6px;color:#00d09c;font-weight:700;font-size:12px"><span style="width:8px;height:8px;border-radius:50%;background:#00d09c"></span>LIVE</span><b style="font-size:15px">${name}</b><span id="meetCount" style="color:#8aa0ad;font-size:13px"></span><span id="meetStatus" style="margin-left:auto;color:#8aa0ad;font-size:12px"></span>`;
  const grid = el("div", "flex:1;display:grid;gap:10px;padding:16px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));align-content:center;overflow:auto");
  const ctrls = el("div", "display:flex;gap:12px;justify-content:center;padding:14px;border-top:1px solid #16212b");
  const mkBtn = (bg, fg, label) => el("button", `border:0;border-radius:14px;padding:13px 18px;font-size:14px;font-weight:700;cursor:pointer;background:${bg};color:${fg};min-width:104px`, label);
  overlay.append(head, grid, ctrls); document.body.append(overlay);

  const tiles = new Map();   // id → { tile, video, stream }
  function mkTile(id, label, self) {
    const tile = el("div", "position:relative;aspect-ratio:16/9;background:#0c141c;border:2px solid transparent;border-radius:14px;overflow:hidden;transition:border-color .15s");
    const v = el("video", "width:100%;height:100%;object-fit:cover;background:#0c141c" + (self ? ";transform:scaleX(-1)" : "")); v.autoplay = true; v.setAttribute("playsinline", ""); if (self) v.muted = true;
    const avatar = el("div", "position:absolute;inset:0;display:flex;align-items:center;justify-content:center", `<div style="width:72px;height:72px;border-radius:50%;display:grid;place-items:center;font-size:30px;font-weight:700;color:#04110d;background:linear-gradient(135deg,#00d09c,#27e3b3)">${(label.trim()[0] || "·").toUpperCase()}</div>`);
    const tag = el("div", "position:absolute;left:8px;bottom:8px;padding:3px 9px;border-radius:8px;background:rgba(0,0,0,.55);font-size:12px;font-weight:600", label + (self ? " (you)" : ""));
    v.addEventListener("loadeddata", () => { if (v.videoWidth > 0) avatar.style.display = "none"; });
    tile.append(v, avatar, tag); return { tile, video: v, avatar };
  }
  function relayout() { const n = tiles.size; const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3; grid.style.gridTemplateColumns = `repeat(${cols},minmax(220px,1fr))`; head.querySelector("#meetCount").textContent = n + (n === 1 ? " person" : " people"); }

  let muted = false, cameraOff = false;
  const muteBtn = mkBtn("rgba(255,255,255,.12)", "#fff", "🎙 Mute");
  muteBtn.onclick = () => { muted = !muted; onToggleMute(muted); muteBtn.textContent = muted ? "🔇 Unmute" : "🎙 Mute"; };
  ctrls.append(muteBtn);
  if (video) { const cam = mkBtn("rgba(255,255,255,.12)", "#fff", "📷 Camera off"); cam.onclick = () => { cameraOff = !cameraOff; onToggleCamera(cameraOff); cam.textContent = cameraOff ? "📷 Camera on" : "📷 Camera off"; }; ctrls.append(cam); }
  const leaveBtn = mkBtn("#e76f6f", "#0b1014", "Leave"); leaveBtn.onclick = () => { onLeave(); close(); }; ctrls.append(leaveBtn);

  function close() { try { for (const [, t] of tiles) { try { t.video.srcObject = null; } catch {} } } catch {} try { overlay.remove(); } catch {} }

  return {
    overlay,
    attachLocal(stream, label = "You") { let t = tiles.get("__self"); if (!t) { t = mkTile("__self", label, true); tiles.set("__self", t); grid.prepend(t.tile); } try { t.video.srcObject = stream; } catch {} relayout(); },
    addParticipant(id, stream, label = "Guest") { let t = tiles.get(id); if (!t) { t = mkTile(id, label, false); tiles.set(id, t); grid.append(t.tile); } try { t.video.srcObject = stream; } catch {} relayout(); },
    removeParticipant(id) { const t = tiles.get(id); if (t) { try { t.video.srcObject = null; } catch {} t.tile.remove(); tiles.delete(id); relayout(); } },
    setActiveSpeaker(id) { for (const [tid, t] of tiles) t.tile.style.borderColor = (tid === id) ? "#00d09c" : "transparent"; },
    setPhase(p) { const s = head.querySelector("#meetStatus"); if (p === "connecting") s.textContent = "Connecting…"; else if (p === "connected") s.textContent = ""; else if (p === "ended") { s.textContent = "Ended"; setTimeout(close, 700); } },
    tileCount: () => tiles.size,
    close,
  };
}
