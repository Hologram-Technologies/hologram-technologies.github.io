// HOLO HALO — the floating mini-theatre. Leave Holo TV while something is playing and the SAME living
// iframe (never reparented — a reparent reloads the app and kills the playback) morphs into a draggable,
// resizable glass pill that floats over the whole OS: Home, chats, every app. Hover = controls
// (play/pause · expand · close · title · progress hairline); drag anywhere (soft edge-snap, remembered);
// the corner grip resizes; expand morphs it back into the full canvas through the shell's own
// holo-open-space door. Additive + fail-soft: no layer / no player / nothing playing → nothing mounts.
//
// How it works (all same-origin, the same reach the shell already uses for Q grounding):
//  · film/trailer playback lives in the player's NESTED Holo Video iframe → we listen for its
//    holo-video-status on the player window and drive it with holo-video-control;
//  · music is window.__musicBar on the player window (its audio is a background YT frame that keeps
//    playing when the app hides — Halo gives that sound a visible surface);
//  · the pill IS the .holo-space-frame: position:fixed escapes the layer's overflow clip (the layer has
//    no transform, so the containing block stays the viewport); a data-halo attribute (React never
//    manages data-attrs, so re-renders keep it) holds the layer visible-but-inert while it hosts a pill.

const LS = "holo.halo.v1";
const MORPH = "left .42s cubic-bezier(.32,.72,.28,1), top .42s cubic-bezier(.32,.72,.28,1), width .42s cubic-bezier(.32,.72,.28,1), height .42s cubic-bezier(.32,.72,.28,1), border-radius .42s cubic-bezier(.32,.72,.28,1)";
const FRAME_STYLES = ["transition", "display", "position", "inset", "left", "top", "width", "height", "zIndex", "borderRadius", "boxShadow", "opacity", "transform", "pointerEvents", "background"];

let on = false;              // pill engaged
let assumePlay = true;       // playback assumption for embeds that emit no status (YT fallback)
let lastVid = { playing: false, time: 0, dur: 0, at: 0 };
let nullSince = 0;           // state() has been empty since (ms) — a pill of nothing dissolves
let ui = null, els = {};
let g = null;                // pill geometry {x,y,w,h}

const $$ = (s) => [...document.querySelectorAll(s)];
const frameEl = () => $$(".holo-space-frame").find((f) => (f.getAttribute("src") || "").includes("/apps/player/"));
const layerEl = () => document.querySelector(".holo-space-layer");
const stageEl = () => document.querySelector(".holo-space-stage");
const pwin = (f) => { try { const w = f && f.contentWindow; return (w && w.document) ? w : null; } catch { return null; } };

// ── the honest live snapshot: what is REALLY playing inside the player ─────────────────────────────
function hook(w) {
  if (!w || w.__haloHooked) return;
  w.__haloHooked = true;
  try {
    w.addEventListener("message", (e) => {
      const m = e.data; if (!m || typeof m !== "object" || m.type !== "holo-video-status") return;
      try { const main = w.document.querySelector("#player iframe"); if (!main || e.source !== main.contentWindow) return; } catch {}
      lastVid = { playing: m.state === "playing", time: m.currentTime || 0, dur: m.duration || lastVid.dur || 0, at: Date.now() };
    });
  } catch {}
  dress(w);
}
function state(f) {
  const w = pwin(f); if (!w) return null;
  hook(w);
  try {
    const d = w.document;
    const mainFr = d.querySelector("#player iframe");
    if (d.body.classList.contains("playing") && mainFr) {
      const title = ((d.getElementById("ptopTitle") || {}).textContent || "").trim() || "Now playing";
      const native = (mainFr.getAttribute("src") || "").includes("/video/index.html");
      return { kind: "video", playing: native ? lastVid.playing : assumePlay, title, sub: "Holo TV", time: lastVid.time, dur: lastVid.dur, native };
    }
    const mb = w.__musicBar;
    if (mb && mb.cur) return { kind: "music", playing: !!mb.playing, title: mb.cur.name || "", sub: mb.cur.artist || "", art: mb.cur.art || mb.cur.artSmall || "" };
  } catch {}
  return null;
}
function togglePlay(f) {
  const st = state(f), w = pwin(f); if (!st || !w) return;
  try {
    if (st.kind === "music") { w.__musicBar.toggle(); }
    else {
      const fr = w.document.querySelector("#player iframe"); if (!fr) return;
      if (st.native) { fr.contentWindow.postMessage({ type: "holo-video-control", action: st.playing ? "pause" : "play" }, "*"); lastVid.playing = !st.playing; }
      else { fr.contentWindow.postMessage(JSON.stringify({ event: "command", func: st.playing ? "pauseVideo" : "playVideo", args: [] }), "*"); assumePlay = !st.playing; }
    }
  } catch {}
  paint(state(f));
}

// ── pill dressing INSIDE the player: chrome melts away; music gets an ambient blurred-art face ─────
function dress(w) {
  try {
    const d = w.document;
    if (!d.getElementById("haloCss")) {
      const st = d.createElement("style"); st.id = "haloCss";
      st.textContent = [
        "html.halo #top,html.halo nav,html.halo .player-top,html.halo .enhud,html.halo .skipbtn,html.halo .upnext,html.halo .watchpanel,html.halo .music-bar{display:none !important}",
        "html.halo main{width:100% !important;margin:0 !important}",
        "html.halo body{overflow:hidden}",
        "#haloFace{position:fixed;inset:0;z-index:940;display:none;align-items:center;justify-content:center;background:#1a1918;overflow:hidden}",
        "html.halo.halo-music #haloFace{display:flex}",
        "#haloFace .hfBg{position:absolute;inset:-14%;background-size:cover;background-position:center;filter:blur(46px) saturate(1.2) brightness(.5);transform:scale(1.15)}",
        "#haloFace .hfArt{position:relative;height:60%;aspect-ratio:1/1;border-radius:10px;background-size:cover;background-position:center;box-shadow:0 14px 44px rgba(0,0,0,.6);background-color:#1f1f1e}",
      ].join("\n");
      d.head.appendChild(st);
    }
    if (!d.getElementById("haloFace")) {
      const face = d.createElement("div"); face.id = "haloFace";
      face.innerHTML = '<div class="hfBg"></div><div class="hfArt"></div>';
      d.body.appendChild(face);
    }
  } catch {}
}
const artWrap = (u) => { if (!u) return ""; try { return /^(data:|blob:|\.{0,2}\/)/.test(u) || u.startsWith(location.origin) ? u : "https://images.weserv.nl/?url=" + encodeURIComponent(u.replace(/^https?:\/\//, "")) + "&w=640"; } catch { return u; } };
function dressMode(w, st, active) {
  try {
    const de = w.document.documentElement;
    de.classList.toggle("halo", !!active);
    de.classList.toggle("halo-music", !!active && !!st && st.kind === "music");
    if (active && st && st.kind === "music" && st.art) {
      const a = artWrap(st.art), d = w.document;
      const bg = d.querySelector("#haloFace .hfBg"), ar = d.querySelector("#haloFace .hfArt");
      if (bg && bg.dataset.u !== a) { bg.dataset.u = a; bg.style.backgroundImage = 'url("' + a + '")'; }
      if (ar && ar.dataset.u !== a) { ar.dataset.u = a; ar.style.backgroundImage = 'url("' + a + '")'; }
    }
  } catch {}
}

// ── geometry (remembered per device) ───────────────────────────────────────────────────────────────
function geom() {
  if (!g) { let s = null; try { s = JSON.parse(localStorage.getItem(LS) || "null"); } catch {} g = s && s.w ? s : { w: 420 }; }
  g.w = Math.max(280, Math.min(g.w || 420, Math.round(innerWidth * 0.7), 920));
  g.h = Math.round(g.w * 9 / 16);
  if (typeof g.x !== "number") g.x = innerWidth - g.w - 20;
  if (typeof g.y !== "number") g.y = innerHeight - g.h - 20;
  g.x = Math.max(8, Math.min(g.x, innerWidth - g.w - 8));
  g.y = Math.max(8, Math.min(g.y, innerHeight - g.h - 8));
  return g;
}
const save = () => { try { localStorage.setItem(LS, JSON.stringify({ x: g.x, y: g.y, w: g.w })); } catch {} };
function applyGeom(f, animate) {
  const s = f.style;
  s.transition = animate ? MORPH : "none";
  s.left = g.x + "px"; s.top = g.y + "px"; s.width = g.w + "px"; s.height = g.h + "px";
  ui.style.left = g.x + "px"; ui.style.top = g.y + "px"; ui.style.width = g.w + "px"; ui.style.height = g.h + "px";
}

// ── the glass chrome above the pill (the iframe never needs pointer events — this owns them all) ───
const I = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h3.6v14H7zm6.4 0H17v14h-3.6z"/></svg>',
  expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7.5 7.5M3 21l7.5-7.5"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};
function buildUI() {
  if (ui) return;
  const css = document.createElement("style"); css.id = "holoHaloCss";
  css.textContent = [
    // while a pill lives here, the layer stays visible-but-inert (no chrome, no backdrop, no pointer wall)
    ".holo-space-layer[data-halo]{opacity:1 !important}",
    ".holo-space-layer[data-halo]:not(.space-open){pointer-events:none;background:transparent;box-shadow:none;border-radius:0}",
    ".holo-space-layer[data-halo]:not(.space-open):before{display:none}",
    ".holo-space-layer[data-halo]:not(.space-open) .holo-space-bar{display:none}",
    ".holo-space-layer[data-halo]:not(.space-open) .holo-space-stage{background:transparent}",
    "#holoHalo{position:fixed;z-index:64;border-radius:14px;border:1px solid rgba(255,255,255,.11);box-shadow:0 24px 64px rgba(0,0,0,.6),0 2px 10px rgba(0,0,0,.38);overflow:hidden;user-select:none;touch-action:none;opacity:0;pointer-events:none;transition:opacity .24s ease;cursor:grab;font:500 13px/1.35 inherit}",
    "#holoHalo.on{opacity:1;pointer-events:auto}",
    "#holoHalo.drag{cursor:grabbing}",
    // ── the now-playing FACE: for music we paint the art here, in the pill's OWN chrome (never inside the
    //    iframe) so no app UI can ever leak through — only the cover art shows. Video leaves this hidden and
    //    the living video frame shows through underneath.
    "#holoHalo .hhFace{position:absolute;inset:0;display:none;overflow:hidden;background:#0e0e10}",
    "#holoHalo.music .hhFace{display:block}",
    "#holoHalo .hhBg{position:absolute;inset:-18%;background:#0e0e10 center/cover no-repeat;filter:blur(52px) saturate(1.35) brightness(.48);transform:scale(1.18)}",
    "#holoHalo .hhVeil{position:absolute;inset:0;background:radial-gradient(120% 92% at 50% 40%,rgba(8,8,10,0),rgba(8,8,10,.44)),linear-gradient(180deg,rgba(8,8,10,.24),rgba(8,8,10,.62))}",
    "#holoHalo .hhCover{position:absolute;top:47%;left:50%;transform:translate(-50%,-50%);height:60%;aspect-ratio:1;border-radius:11px;background:#1f1f1e center/cover no-repeat;box-shadow:0 18px 46px rgba(0,0,0,.55),inset 0 0 0 1px rgba(255,255,255,.06);transition:transform .34s cubic-bezier(.32,.72,.28,1),box-shadow .34s ease}",
    "#holoHalo.music:hover .hhCover,#holoHalo.music.show .hhCover{transform:translate(-50%,-50%) scale(.965);box-shadow:0 22px 54px rgba(0,0,0,.62),inset 0 0 0 1px rgba(255,255,255,.06)}",
    "#holoHalo .hhS{position:absolute;left:0;right:0;pointer-events:none;opacity:0;transition:opacity .22s ease}",
    "#holoHalo .hhST{top:0;height:34%;background:linear-gradient(to bottom,rgba(14,13,12,.6),transparent)}",
    "#holoHalo .hhSB{bottom:0;height:46%;background:linear-gradient(to top,rgba(14,13,12,.72),transparent)}",
    "#holoHalo:hover .hhS,#holoHalo.show .hhS,#holoHalo:hover .hhC,#holoHalo.show .hhC{opacity:1}",
    // for music the title/artist + its scrim stay lit at rest (there is nothing else on the surface to read)
    "#holoHalo.music .hhSB,#holoHalo.music .hhMeta{opacity:1}",
    "#holoHalo .hhC{opacity:0;transition:opacity .22s ease}",
    "#holoHalo .hhBtn{position:absolute;display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:rgba(31,31,30,.78);backdrop-filter:blur(10px) saturate(1.1);-webkit-backdrop-filter:blur(10px) saturate(1.1);color:#f5f4ef;border:1px solid rgba(255,255,255,.11);cursor:pointer;pointer-events:auto;transition:background .16s ease,border-color .16s ease}",
    "#holoHalo .hhBtn:hover{background:rgba(48,48,46,.92);border-color:rgba(255,255,255,.18)}",
    "#holoHalo .hhBtn svg{width:15px;height:15px}",
    "#holoHalo .hhX{top:10px;right:10px}",
    "#holoHalo .hhE{top:10px;right:48px}",
    "#holoHalo .hhP{width:46px;height:46px;top:50%;left:50%;transform:translate(-50%,-50%)}",
    "#holoHalo .hhP svg{width:20px;height:20px}",
    "#holoHalo .hhMeta{position:absolute;left:14px;right:14px;bottom:12px;color:#fff;text-shadow:0 1px 8px rgba(0,0,0,.7);pointer-events:none}",
    "#holoHalo .hhT{font-weight:600;font-size:13px;letter-spacing:.01em;color:#f5f4ef;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    "#holoHalo .hhA{font-weight:500;font-size:11.5px;color:rgba(245,244,239,.64);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    "#holoHalo .hhProg{position:absolute;left:0;right:0;bottom:0;height:3px;background:rgba(255,255,255,.12);display:none}",
    "#holoHalo .hhProg i{display:block;height:100%;width:0;background:#8b5cf6}",
    "#holoHalo .hhGrip{position:absolute;right:2px;bottom:2px;width:18px;height:18px;cursor:nwse-resize;pointer-events:auto;opacity:0;transition:opacity .22s ease}",
    "#holoHalo:hover .hhGrip,#holoHalo.show .hhGrip{opacity:.8}",
    "#holoHalo .hhGrip:before{content:'';position:absolute;right:4px;bottom:4px;width:8px;height:8px;border-right:2px solid rgba(245,244,239,.7);border-bottom:2px solid rgba(245,244,239,.7);border-radius:1px}",
  ].join("\n");
  document.head.appendChild(css);
  ui = document.createElement("div"); ui.id = "holoHalo";
  ui.innerHTML =
    '<div class="hhFace"><div class="hhBg"></div><div class="hhVeil"></div><div class="hhCover"></div></div>' +
    '<div class="hhS hhST"></div><div class="hhS hhSB"></div>' +
    '<button class="hhBtn hhP hhC" title="Play / pause" aria-label="Play or pause"></button>' +
    '<button class="hhBtn hhE hhC" title="Back to fullscreen" aria-label="Back to fullscreen">' + I.expand + "</button>" +
    '<button class="hhBtn hhX hhC" title="Close" aria-label="Close">' + I.close + "</button>" +
    '<div class="hhMeta hhC"><div class="hhT"></div><div class="hhA"></div></div>' +
    '<div class="hhProg"><i></i></div><div class="hhGrip hhC" title="Resize"></div>';
  document.body.appendChild(ui);
  els = { play: ui.querySelector(".hhP"), exp: ui.querySelector(".hhE"), x: ui.querySelector(".hhX"), t: ui.querySelector(".hhT"), a: ui.querySelector(".hhA"), prog: ui.querySelector(".hhProg"), fill: ui.querySelector(".hhProg i"), grip: ui.querySelector(".hhGrip"), bg: ui.querySelector(".hhBg"), cover: ui.querySelector(".hhCover") };
  els.play.innerHTML = I.pause;
  els.play.addEventListener("click", (e) => { e.stopPropagation(); const f = frameEl(); f && togglePlay(f); });
  els.exp.addEventListener("click", (e) => { e.stopPropagation(); expand(); });
  els.x.addEventListener("click", (e) => { e.stopPropagation(); const f = frameEl(); f && dismiss(f); });

  // drag (the whole glass) + single-tap = play/pause (delayed so a double-tap = expand)
  let d0 = null, moved = 0, tapT = 0;
  ui.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".hhBtn") || e.target.closest(".hhGrip")) return;
    d0 = { px: e.clientX, py: e.clientY, x: g.x, y: g.y }; moved = 0;
    try { ui.setPointerCapture(e.pointerId); } catch {} ui.classList.add("drag", "show");
  });
  ui.addEventListener("pointermove", (e) => {
    if (!d0) return;
    const dx = e.clientX - d0.px, dy = e.clientY - d0.py; moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
    g.x = Math.max(8, Math.min(d0.x + dx, innerWidth - g.w - 8));
    g.y = Math.max(8, Math.min(d0.y + dy, innerHeight - g.h - 8));
    const f = frameEl(); if (f) applyGeom(f, false);
  });
  ui.addEventListener("pointerup", (e) => {
    if (!d0) return; d0 = null; ui.classList.remove("drag");
    if (moved < 5) {   // a tap, not a drag
      const now = Date.now();
      if (now - tapT < 300) { tapT = 0; expand(); }
      else { tapT = now; setTimeout(() => { if (tapT && Date.now() - tapT >= 300) { tapT = 0; const f = frameEl(); f && togglePlay(f); } }, 310); }
    } else {
      // soft edge-snap: near an edge → rest flush at a calm 16px margin
      if (g.x < 36) g.x = 16; if (g.x > innerWidth - g.w - 36) g.x = innerWidth - g.w - 16;
      if (g.y < 36) g.y = 16; if (g.y > innerHeight - g.h - 36) g.y = innerHeight - g.h - 16;
      const f = frameEl(); if (f) applyGeom(f, true);
      save();
    }
    setTimeout(() => ui.classList.remove("show"), 2600);
  });
  // resize (SE grip, 16:9 kept)
  let r0 = null;
  els.grip.addEventListener("pointerdown", (e) => { e.stopPropagation(); r0 = { px: e.clientX, w: g.w }; try { els.grip.setPointerCapture(e.pointerId); } catch {} });
  els.grip.addEventListener("pointermove", (e) => {
    if (!r0) return;
    g.w = Math.round(Math.max(280, Math.min(r0.w + (e.clientX - r0.px), innerWidth * 0.7, 920)));
    g.h = Math.round(g.w * 9 / 16);
    g.x = Math.min(g.x, innerWidth - g.w - 8); g.y = Math.min(g.y, innerHeight - g.h - 8);
    const f = frameEl(); if (f) applyGeom(f, false);
  });
  els.grip.addEventListener("pointerup", () => { r0 = null; save(); });
  addEventListener("resize", () => { if (on) { geom(); const f = frameEl(); if (f) applyGeom(f, false); } });
}
function paint(st) {
  if (!ui) return;
  const music = !!st && st.kind === "music";
  ui.classList.toggle("music", music);
  if (st) {
    els.t.textContent = st.title || ""; els.a.textContent = st.sub || "";
    els.play.innerHTML = st.playing ? I.pause : I.play;
    if (music) {   // paint the cover into the pill's own face — bulletproof, never touches the iframe
      const a = artWrap(st.art || "");
      if (a && els.bg.dataset.u !== a) { els.bg.dataset.u = a; els.bg.style.backgroundImage = 'url("' + a + '")'; }
      if (a && els.cover.dataset.u !== a) { els.cover.dataset.u = a; els.cover.style.backgroundImage = 'url("' + a + '")'; }
    }
    const p = st.dur > 0 ? Math.min(1, st.time / st.dur) : 0;
    els.prog.style.display = st.kind === "video" && st.dur > 0 ? "block" : "none";
    els.fill.style.width = (p * 100).toFixed(2) + "%";
  }
}

// ── engage · release · dismiss (the morphs) ────────────────────────────────────────────────────────
function engage(f, st) {
  const layer = layerEl(); if (!layer) return;
  buildUI(); geom(); on = true; assumePlay = true; nullSince = 0;
  window.__holoHalo = { spaceId: "tv" };
  layer.setAttribute("data-halo", "on");
  const from = (stageEl() || layer).getBoundingClientRect();
  const s = f.style;
  s.transition = "none"; s.display = "block"; s.position = "fixed"; s.inset = "auto";
  s.left = from.left + "px"; s.top = from.top + "px"; s.width = from.width + "px"; s.height = from.height + "px";
  s.zIndex = "63"; s.borderRadius = "0px"; s.boxShadow = "none"; s.pointerEvents = "none"; s.background = "#0b0b0c";
  dressMode(pwin(f), st, true);
  ui.style.transition = "none";
  ui.style.left = from.left + "px"; ui.style.top = from.top + "px"; ui.style.width = from.width + "px"; ui.style.height = from.height + "px";
  paint(st);
  void f.offsetWidth;   // commit the start frame synchronously (rAF starves in hidden/embedded panes)
  s.transition = MORPH;
  ui.style.transition = "opacity .24s ease," + MORPH;
  s.left = g.x + "px"; s.top = g.y + "px"; s.width = g.w + "px"; s.height = g.h + "px"; s.borderRadius = "14px";
  ui.style.left = g.x + "px"; ui.style.top = g.y + "px"; ui.style.width = g.w + "px"; ui.style.height = g.h + "px";
  ui.classList.add("on", "show");
  setTimeout(() => ui.classList.remove("show"), 2600);
}
function release(f) {   // the space is fronted again → morph home, hand the frame back untouched
  const layer = layerEl(); on = false;
  try { delete window.__holoHalo; } catch {}
  const to = (stageEl() || layer).getBoundingClientRect();
  if (ui) { ui.classList.remove("on"); ui.style.transition = "opacity .24s ease"; }
  const s = f.style;
  s.transition = MORPH;
  s.left = to.left + "px"; s.top = to.top + "px"; s.width = to.width + "px"; s.height = to.height + "px"; s.borderRadius = "0px";
  setTimeout(() => {
    FRAME_STYLES.forEach((p) => { s[p] = ""; });
    layer && layer.removeAttribute("data-halo");
    dressMode(pwin(f), null, false);
  }, 440);
}
function expand() {
  const f = frameEl(); if (!f) return;
  try { window.dispatchEvent(new CustomEvent("holo-open-space", { detail: { id: "tv", name: "Holo TV", url: f.getAttribute("src") || "/apps/player/index.html", immersive: true } })); } catch {}
  // the observer sees the frame go active and runs release() — the morph and the shell fade land together
}
function dismiss(f) {
  const w = pwin(f), st = state(f);
  try { if (st && st.playing) { if (st.kind === "music") w.__musicBar.pause(); else togglePlay(f); } } catch {}
  on = false; try { delete window.__holoHalo; } catch {}
  if (ui) ui.classList.remove("on");
  const s = f.style;
  s.transition = "opacity .26s ease, transform .26s ease"; s.opacity = "0"; s.transform = "scale(.94)";
  setTimeout(() => {
    FRAME_STYLES.forEach((p) => { s[p] = ""; });
    s.display = "none";
    const layer = layerEl(); layer && layer.removeAttribute("data-halo");
    dressMode(w, null, false);
  }, 280);
}
function hardOff() {
  on = false; try { delete window.__holoHalo; } catch {}
  if (ui) ui.classList.remove("on");
  const layer = layerEl(); layer && layer.removeAttribute("data-halo");
}

// ── the watcher: pre-arm while playing, engage on hide, release on re-open ─────────────────────────
// While the pill is on, the frame's style.display is OURS (we forced block), so "is the TV fronted?"
// must be read from the shell's own truth instead: the layer is .space-open AND the space bar names
// Holo TV. Before the pill engages, React alone owns display — the style check is exact there.
function tvFronted(layer) {
  if (!layer.classList.contains("space-open")) return false;
  const n = layer.querySelector(".holo-space-name");
  return !!n && /holo tv/i.test(n.textContent || "");
}
function tick() {
  const f = frameEl(), layer = layerEl();
  if (!f || !layer) { if (on) hardOff(); return; }
  ensureMo(layer);
  const st = state(f);
  if (!on) {
    // pre-arm: the CSS that keeps the layer visible applies the INSTANT the space closes — no flicker
    if (st && st.playing && !layer.hasAttribute("data-halo")) layer.setAttribute("data-halo", "armed");
    else if ((!st || !st.playing) && layer.getAttribute("data-halo") === "armed") layer.removeAttribute("data-halo");
    if (f.style.display === "none" && st && st.playing) engage(f, st);
  } else {
    if (tvFronted(layer)) { release(f); return; }
    if (!st) { if (!nullSince) nullSince = Date.now(); else if (Date.now() - nullSince > 10000) dismiss(f); }
    else { nullSince = 0; paint(st); dressMode(pwin(f), st, true); }
  }
}
let moLayer = null;
const mo = new MutationObserver(() => { try { tick(); } catch {} });
function ensureMo(layer) {
  if (moLayer === layer) return; moLayer = layer;
  try { mo.disconnect(); mo.observe(layer, { attributes: true, subtree: true, attributeFilter: ["style", "class"] }); } catch {}
}
setInterval(() => { try { tick(); } catch {} }, 500);

// a small public handle (Q / verification): read the pill's truth, drive it by hand
window.HoloHalo = {
  get on() { return on; },
  state: () => { const f = frameEl(); return f ? state(f) : null; },
  expand,
  dismiss: () => { const f = frameEl(); f && dismiss(f); },
  toggle: () => { const f = frameEl(); f && togglePlay(f); },
};
