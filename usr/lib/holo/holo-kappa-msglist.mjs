// holo-kappa-msglist.mjs — HOLO-KAPPA-RENDER-SUBSTRATE phase 5: the GPU message list for Holo Messenger.
//
// Mounts a hardware-accelerated (2D-canvas), TRANSPARENT, virtualized message list into a <canvas> — so bubbles float
// over the app's immersive wallpaper (no second WebGPU context to fight the WebGPU backdrop). Driven by the cores: the scroller
// (O(log N) visible window over variable-height rows), κ-addressed tile caching (a bubble is laid out + rastered ONCE
// and reused while it stays on screen), and O(visible) per-frame work. So a conversation with a MILLION messages
// scrolls at display refresh, at native/retina resolution — and there is no 80-message cap: the whole history is one
// infinite surface. Pure vanilla (no React) so it is decoupled from the app's re-render loop entirely. The app just
// mounts it and feeds it data. Relates: [[holo-kappa-render-substrate]] · holo-kappa-scroller.mjs.

import { makeScroller, tileKeyOf } from "./holo-kappa-scroller.mjs";

// mountKappaMessageList(canvas, opts) -> { refresh, scrollToEnd, atBottom, destroy, invalidate }
//   opts: {
//     count() -> number                         // how many messages
//     getMessage(i) -> { kappa, text, mine, sender, time, media?, daySep? }   // message i (lazy)
//     group?  bool                              // group chat → show sender names on incoming
//     avatarHue?(sender) -> number              // 0..360 for the avatar disc (optional)
//     onReachTop?()                             // user scrolled to the very top (load-earlier hook; optional)
//   }
export function mountKappaMessageList(canvas, opts) {
  const { count, getMessage, group = false, avatarHue = defHue, onReachTop, resolveMedia = null } = opts;
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 2));   // render at ≥2x so text is retina-sharp
  const PAD = 12, AVAT = 36, LH = 22, NAME_H = 19, TIME_H = 18, GAP = 9, RAD = 9, TAIL = 8;   // WhatsApp: tight radius + a tailed top corner
  const FONT = "15px -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif";
  const NAME_FONT = "600 13px -apple-system, system-ui, 'Segoe UI', Roboto";
  const TIME_FONT = "11px -apple-system, system-ui";
  // WhatsApp palette: incoming #202c33, outgoing #005c4b, ink #e9edef, links + read-ticks #53bdeb, muted #8696a0.
  const INK = "#e9edef", LINK = "#53bdeb", DIM = "#8696a0", TIMECLR = "rgba(233,237,239,0.6)", TICK = "#53bdeb";
  const BUB_IN = "#202c33", BUB_OUT = "#005c4b";
  const lay = document.createElement("canvas").getContext("2d");
  // shorten a URL to a clean, readable label (host + /… ) — turns walls of tracking links into legible text
  const shortUrl = (w) => { const u = w.replace(/^https?:\/\//i, "").replace(/^www\./i, ""); const host = u.split(/[/?#]/)[0]; return host + (u.length > host.length + 1 ? "/…" : ""); };
  // one whitespace token → styled run(s): a URL (even wrapped in [ ] ( ) or trailing punctuation) becomes a short,
  // link-coloured label with its brackets/punctuation kept as plain text around it.
  function wordRuns(raw) {
    const m = /^([\[(<"']*)((?:https?:\/\/|www\.)\S+?)([\])>"'.,;:!?]*)$/i.exec(raw);
    if (m) { const runs = []; if (m[1]) runs.push({ s: m[1], link: false }); runs.push({ s: shortUrl(m[2]), link: true }); if (m[3]) runs.push({ s: m[3], link: false }); let w = 0; for (const r of runs) { r.w = lay.measureText(r.s).width; w += r.w; } return { runs, w }; }
    const w = lay.measureText(raw).width; return { runs: [{ s: raw, w, link: false }], w };
  }
  // wrap into LINES of styled RUNS, PRESERVING the message's own line/paragraph breaks (emails read as written, not as
  // one flattened wall). A blank line becomes a paragraph gap; over-long tokens hard-break so nothing overflows.
  function wrapRuns(text, maxW) {
    lay.font = FONT; const sp = lay.measureText(" ").width;
    const out = []; const paras = String(text || "").replace(/\r/g, "").split("\n");
    for (const rawPara of paras) {
      const para = rawPara.replace(/[ \t]+/g, " ").trim();
      if (!para) { if (out.length && out[out.length - 1].length) out.push([]); continue; }   // blank line → one gap
      let line = [], lw = 0; const flush = () => { out.push(line); line = []; lw = 0; };
      for (const tok of para.split(" ").filter(Boolean)) {
        const word = wordRuns(tok);
        if (word.w > maxW) { if (line.length) flush(); const full = word.runs.map((r) => r.s).join(""), link = word.runs.some((r) => r.link); let chunk = ""; for (const ch of full) { if (lay.measureText(chunk + ch).width > maxW && chunk) { out.push([{ s: chunk, w: lay.measureText(chunk).width, link }]); chunk = ""; } chunk += ch; } if (chunk) { line.push({ s: chunk, w: lay.measureText(chunk).width, link }); lw = lay.measureText(chunk).width; } continue; }
        if (line.length && lw + sp + word.w > maxW) flush();
        if (line.length) { line.push({ s: " ", w: sp, sp: true }); lw += sp; }
        for (const r of word.runs) line.push(r); lw += word.w;
      }
      flush();
    }
    while (out.length && !out[out.length - 1].length) out.pop();
    return out.length ? out : [[]];
  }
  let contentW = 520, viewportW = 0, viewportH = 0, scrollTop = 0, pinned = true, alive = true;
  // momentum scroll: scrollTop EASES toward scrollTarget each frame (glide + settle), input moves the target instantly
  // (zero-latency response), a drag-release flings the target ahead by the release velocity (inertia). Natural + human,
  // still fully responsive. EASE=how fast it catches up (higher=snappier), FLING=how far a flick carries.
  let scrollTarget = 0, dragVel = 0, dragging = false, firstPaint = true;
  const EASE = 0.22, FLING = 14;
  const maxScroll = () => Math.max(0, scroller.totalHeight() - viewportH);
  let scroller = makeScroller({ count: count(), rowHeight: 60 });
  let measured = new Uint8Array(Math.max(1, count()));
  const tileCache = new Map(); const CACHE_CAP = 500;
  // ── media tiles: an image bubble decodes its picture ONCE (taint-safe: fetch → blob → ImageBitmap, so κ /
  //    same-origin / CORS-ok bytes give an UNtainted bitmap the GPU lens can upload; a cross-origin opaque
  //    fetch simply fails → the bubble keeps its placeholder). No explicit invalidation: the tile key carries
  //    a media-ready flag, so when the bitmap lands the key flips and the rAF loop re-rasters + re-uploads. ──
  const mediaBmp = new Map();            // url → ImageBitmap (present ⇒ decoded, ready to draw)
  const mediaState = new Map();          // url → "loading" | "failed"  (so we kick each decode once)
  const resolvedRef = new Map();         // bridge ref → object url (lazy media, resolved once via resolveMedia)
  const resolveState = new Map();        // bridge ref → "loading" | "failed"
  const MEDIA_CAP = 120;
  // effective url of a media: a direct url, or the resolved blob url of a lazy bridge ref (once fetched).
  const effUrl = (med) => (med && (med.url || (med.ref && resolvedRef.get(med.ref)))) || "";
  const mediaReady = (med) => { const u = effUrl(med); return !!(med && med.kind === "image" && med.ready && u && mediaBmp.has(u)); };
  // lazy bridged media: resolve its ref → a same-origin blob url (GPU-safe), then decode that url. Once per ref.
  function kickResolve(med) {
    if (!med || med.url || !med.ref || !resolveMedia || resolvedRef.has(med.ref) || resolveState.has(med.ref)) return;
    resolveState.set(med.ref, "loading");
    Promise.resolve(resolveMedia(med.ref, med.kind)).then((u) => {
      const url = typeof u === "string" ? u : (u && (u.url || u.src)) || "";
      if (url) { resolvedRef.set(med.ref, url); resolveState.delete(med.ref); }   // key flips to "M" once its bitmap decodes
      else resolveState.set(med.ref, "failed");
    }).catch(() => resolveState.set(med.ref, "failed"));
  }
  function kickDecode(url) {
    if (!url || mediaBmp.has(url) || mediaState.has(url)) return;
    mediaState.set(url, "loading");
    (async () => {
      try {
        const res = await fetch(url); if (!res.ok) throw new Error("http " + res.status);
        const bmp = await createImageBitmap(await res.blob());
        mediaBmp.set(url, bmp); mediaState.delete(url);
        while (mediaBmp.size > MEDIA_CAP) { const f = mediaBmp.keys().next().value; const b = mediaBmp.get(f); mediaBmp.delete(f); try { b && b.close && b.close(); } catch {} }
      } catch { mediaState.set(url, "failed"); }
    })();
  }
  const mediaLabel = (med) => med.kind === "video" ? "Video" : med.kind === "audio" ? "Voice message" : med.kind === "image" ? "Photo" : "File";
  function drawCover(g, bmp, x, y, w, h) {   // cover-fit (crop to fill) — no letterbox, no stretch
    const ar = bmp.width / bmp.height, boxAr = w / h; let sw, sh, sx, sy;
    if (ar > boxAr) { sh = bmp.height; sw = sh * boxAr; sx = (bmp.width - sw) / 2; sy = 0; } else { sw = bmp.width; sh = sw / boxAr; sx = 0; sy = (bmp.height - sh) / 2; }
    g.drawImage(bmp, sx, sy, sw, sh, x, y, w, h);
  }
  // graceful appearance: each message eases in (fade + slight rise) exactly ONCE, the first time it is drawn (tracked
  // by seq). Applied only when the list is at/near REST — during an active scroll/fling rows stay crisp and instant
  // (no distracting flicker), and on open / settle / a new arrival they materialize softly. Re-viewing is instant.
  const enterT = new Map(); const ENTER_MS = 260; let prevTop = -1;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  // ── layout: wrap into styled runs at the bubble width, measure the row height (once per message, cached by κ) ──
  function layoutMsg(m) {
    const maxW = Math.max(200, Math.min(contentW, 600, viewportW * 0.64));   // cap the reading column (~75 chars) for legibility
    const med = m.media || null;
    const isImg = !!(med && med.kind === "image");
    const isCard = !!(med && !isImg);                                        // video / audio / file → a media card
    const rawLines = wrapRuns(m.text, maxW);
    const hasText = rawLines.length > 1 || (rawLines[0] && rawLines[0].length > 0);
    const lines = hasText ? rawLines : [];                                   // media with no caption reserves NO text line
    const showName = group && !m.mine;
    // media box — image keeps its aspect (capped); a card is a fixed poster/pill so layout is stable pre-decode.
    let mediaBox = null;
    if (isImg) { const mw = Math.min(maxW, med.w || maxW); const ar = (med.w && med.h) ? med.h / med.w : 0.66; mediaBox = { w: mw, h: Math.max(120, Math.min(Math.round(mw * ar), 460)) }; }
    else if (isCard) { const mw = Math.min(maxW, 320); mediaBox = { w: mw, h: med.kind === "video" ? Math.round(mw * 0.5625) : 56 }; }
    const gapMT = (mediaBox && hasText) ? 6 : 0;
    const bubbleH = PAD + (showName ? NAME_H : 0) + (mediaBox ? mediaBox.h : 0) + gapMT + lines.length * LH + TIME_H + PAD;
    const h = (m.daySep ? 36 : 0) + bubbleH + GAP;
    let bw = 0; for (const ln of lines) { let lw = 0; for (const r of ln) lw += r.w; bw = Math.max(bw, lw); }
    lay.font = NAME_FONT; if (showName) bw = Math.max(bw, lay.measureText(m.sender || "").width);
    lay.font = TIME_FONT; bw = Math.max(bw, lay.measureText(m.time || "").width + (m.mine ? 48 : 26));   // room for time (+ read-ticks on outgoing)
    if (mediaBox) bw = Math.max(bw, mediaBox.w);
    return { lines, h, bubbleH, bubbleW: Math.min(maxW, bw) + PAD * 2, showName, dayText: m.daySep || null, mediaBox, med, isImg, hasText };
  }
  function ensureHeights(start, end) { for (let i = start; i < end; i++) if (!measured[i]) { measured[i] = 1; scroller.setHeight(i, layoutMsg(getMessage(i)).h); } }

  // ── raster one bubble to an offscreen canvas, cached by κ (so a visible bubble is drawn once, reused per frame) ──
  function tileFor(i) {
    const m = getMessage(i);
    // media-ready flag in the key: a placeholder tile ("P") and its decoded-image tile ("M") are DISTINCT κ,
    // so when the bitmap lands the key flips → cache miss → re-raster with the picture (the lens re-uploads it).
    const mflag = mediaReady(m.media) ? "M" : (m.media ? "P" : "");
    const k = tileKeyOf(m.kappa || ("i" + i), { width: Math.round(Math.min(contentW, viewportW * 0.72)), dpr }) + (m.mine ? "R" : "L") + mflag;
    if (m.media && m.media.kind === "image" && m.media.ready && !mediaReady(m.media)) { kickResolve(m.media); const u = effUrl(m.media); if (u) kickDecode(u); }   // resolve lazy ref → decode, once
    let c = tileCache.get(k); if (c) { tileCache.delete(k); tileCache.set(k, c); return c; }
    const L = layoutMsg(m); const h = L.h, w = viewportW;
    // In THEATER mode the pane is full-screen wide, so edge-anchoring flings incoming bubbles to the far-left and
    // outgoing to the far-right across a vast empty gap. There, lay them out in a CENTERED reading column matching
    // the theater header/composer cards. Normal mode is untouched (colX = 0) — the fix is scoped to theater only.
    const COL = (w > 780 && canvas.closest(".holo-wa-root.theater")) ? 780 : w, colX = Math.round((w - COL) / 2);
    const SHADOW_PAD = 14;   // headroom so a bubble's soft drop-shadow is never clipped by the tile edge
    const cv = new OffscreenCanvas(Math.max(1, Math.ceil(w * dpr)), Math.max(1, Math.ceil((h + SHADOW_PAD) * dpr)));
    const g = cv.getContext("2d"); g.scale(dpr, dpr); g.textBaseline = "alphabetic"; g.textAlign = "left";
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";   // super-res: high-quality downscale for media (images are capped to intrinsic width → never upscaled/blurred)
    let top = 0;
    if (L.dayText) { g.fillStyle = DIM; g.font = "600 12px -apple-system, system-ui"; g.textAlign = "center"; g.fillText(L.dayText, w / 2, 22); g.textAlign = "left"; top = 36; }
    const hue = avatarHue(m.sender || "");
    const bx = m.mine ? (colX + COL - PAD - L.bubbleW) : (colX + PAD + (group && !m.mine ? AVAT + 8 : 0));
    const avx = colX + PAD + AVAT / 2;   // avatar disc centre, inside the column
    // avatar disc (incoming group only), aligned to the bubble's bottom
    if (group && !m.mine) { g.fillStyle = `hsl(${hue} 50% 47%)`; g.beginPath(); g.arc(avx, top + L.bubbleH - AVAT / 2 - 1, AVAT / 2, 0, 7); g.fill(); g.fillStyle = "#fff"; g.font = "600 15px -apple-system, system-ui"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText((m.sender || "?").trim()[0].toUpperCase(), avx, top + L.bubbleH - AVAT / 2); g.textAlign = "left"; g.textBaseline = "alphabetic"; }
    // WhatsApp bubble — flat fill, a subtle drop shadow, and a TAILED top corner (outgoing → top-right,
    // incoming → top-left) that points toward the sender's side. Under ?wall=1 the fill goes FROSTED GLASS:
    // slightly translucent so the BLURRED wallpaper behind it shows faintly through, with a hair of top light.
    g.save(); g.shadowColor = "rgba(11,20,26,0.30)"; g.shadowBlur = 3; g.shadowOffsetY = 1;
    bubblePath(g, bx, top, L.bubbleW, L.bubbleH, RAD, m.mine, TAIL);
    if (WALL) g.globalAlpha = 0.78;                                   // frosted: let the blurred backdrop bleed through
    g.fillStyle = m.mine ? BUB_OUT : BUB_IN; g.fill();
    g.globalAlpha = 1; g.restore();
    if (WALL) {   // glass top-edge highlight — reads as a polished translucent surface
      g.save(); bubblePath(g, bx, top, L.bubbleW, L.bubbleH, RAD, m.mine, TAIL); g.clip();
      const gh = g.createLinearGradient(0, top, 0, top + 24); gh.addColorStop(0, "rgba(255,255,255,0.12)"); gh.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gh; g.fillRect(bx, top, L.bubbleW, 24); g.restore();
    }
    let ty = top + PAD + 13;
    if (L.showName) { g.fillStyle = `hsl(${hue} 74% 71%)`; g.font = NAME_FONT; g.fillText(m.sender || "", bx + PAD, ty); ty += NAME_H; }
    // media — a rounded, clipped picture (decoded) or a stable placeholder/card (loading / video / audio / file).
    if (L.mediaBox) {
      const mx = bx + PAD, my = top + PAD + (L.showName ? NAME_H : 0), mw = L.mediaBox.w, mh = L.mediaBox.h;
      g.save(); roundRect(g, mx, my, mw, mh, 12); g.clip();
      const iu = L.isImg ? effUrl(L.med) : "";
      if (iu && mediaBmp.has(iu)) { drawCover(g, mediaBmp.get(iu), mx, my, mw, mh); }
      else {
        const grad = g.createLinearGradient(mx, my, mx, my + mh); grad.addColorStop(0, "rgba(255,255,255,0.07)"); grad.addColorStop(1, "rgba(255,255,255,0.03)");
        g.fillStyle = grad; g.fillRect(mx, my, mw, mh);
        g.fillStyle = DIM; g.font = "600 13px -apple-system, system-ui"; g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText((L.med.kind === "video" ? "▶  " : "") + mediaLabel(L.med), mx + mw / 2, my + mh / 2); g.textAlign = "left"; g.textBaseline = "alphabetic";
      }
      g.restore();
      g.strokeStyle = "rgba(255,255,255,0.09)"; g.lineWidth = 1; roundRect(g, mx + 0.5, my + 0.5, mw - 1, mh - 1, 12); g.stroke();
      ty = my + mh + (L.hasText ? 6 + 13 : 0);
    }
    g.font = FONT;
    for (const ln of L.lines) { let tx = bx + PAD; for (const r of ln) { if (!r.sp) { g.fillStyle = r.link ? LINK : INK; g.fillText(r.s, tx, ty + 2); } tx += r.w; } ty += LH; }
    // time (muted) + blue read-ticks on outgoing — bottom-right inside the bubble, WhatsApp-style.
    g.font = TIME_FONT; g.textAlign = "right"; const tby = top + L.bubbleH - 10;
    if (m.mine) { g.fillStyle = TIMECLR; g.fillText(m.time || "", bx + L.bubbleW - PAD - 17, tby); g.fillStyle = TICK; g.fillText("✓✓", bx + L.bubbleW - PAD, tby); }
    else { g.fillStyle = TIMECLR; g.fillText(m.time || "", bx + L.bubbleW - PAD, tby); }
    g.textAlign = "left";
    c = { cv, h, key: k };
    tileCache.set(k, c); if (tileCache.size > CACHE_CAP) { const f = tileCache.keys().next().value; tileCache.delete(f); }
    return c;
  }

  // ── 2D compositor: draw the visible bubbles straight onto the (TRANSPARENT) canvas. GPU-accelerated by the browser,
  //    but NO second WebGPU context — so the immersive WebGPU wallpaper keeps rendering, and the transparent canvas
  //    lets that wallpaper show THROUGH the gaps, behind the opaque message bubbles (chat-wallpaper look). ──
  // Present target. Default = TRANSPARENT Canvas2D (drawImage, GPU-accelerated by the browser). When the
  // page opts in with ?gpu=1 AND WebGPU is available, we instead present through holo-msglist-lens — the
  // same tiles uploaded as κ-addressed GPU textures and drawn as transparent quads on the metal. The GPU
  // path is behind its own flag so the plain ?kappa=1 surface stays the proven 2D path until drive-verified.
  let g2 = null, lens = null, host = null, hostSurf = null;
  const qp = (k) => { try { return new URLSearchParams(location.search).get(k) === "1"; } catch { return false; } };
  // Present target selection (mount-time, fail-soft in this order):
  //   default → the shared PROJECTION HOST (surface "chat") — the unifying GPU substrate everything composites through.
  //   ?gpu=1  → a private GPU lens (bypass the host — for debugging the compositor in isolation).
  //   ?soft=1 → force Canvas2D (skip WebGPU entirely).
  // Any WebGPU probe that fails returns null and we drop to Canvas2D — never a black surface, on any browser.
  const GPU_LENS = qp("gpu");
  const SOFT = qp("soft");
  const WALL = qp("wall");   // ?wall=1 → render the wallpaper as a z-behind LAYER of the same host (one lens owns chat + wallpaper)
  // wallpaper url: the app can inject one via opts.wallpaper(); else fall back to the messenger's saved src / the default.
  const wallSrc = () => { try { return (opts.wallpaper && opts.wallpaper()) || localStorage.getItem("holo-messenger/wallpaper-src") || new URL("../../../apps/holo-messenger/_vendor/wallpaper-default.jpg", import.meta.url).href; } catch { return ""; } };   // module-relative default: correct at the OS root AND on a mounted static host
  const setup2D = () => { g2 = canvas.getContext("2d", { alpha: true }); };

  let dbgErr = null, frameN = 0, renderN = 0, fpsEMA = 0, lastFrameT = 0;
  function frame() {
    if (!alive) return;
    const t = performance.now();
    if (lastFrameT) { const inst = 1000 / Math.max(1, t - lastFrameT); fpsEMA = fpsEMA ? fpsEMA * 0.9 + inst * 0.1 : inst; }   // rAF cadence = display FPS
    lastFrameT = t;
    try { frameBody(); frameN++; } catch (e) { if (!dbgErr) { dbgErr = e; try { console.error("[κ-list] frame error:", e); } catch {} } }
    requestAnimationFrame(frame);
  }
  // stepVisible(): advance the momentum scroll one tick, measure the visible window (O(log N)), and return the
  // visible tiles as [{ key, cv, dy, a }] (device-px top + enter-fade alpha). ONE source of truth for "what is
  // on screen this frame" — the 2D path, the direct-lens path, and the projection-host producer all consume it,
  // so they stay pixel-identical. Pure of any present target (no g2 / no lens calls here).
  function stepVisible() {
    const maxS = maxScroll();
    if (pinned) scrollTarget = maxS;                                  // stay glued to the newest message
    scrollTarget = Math.max(0, Math.min(scrollTarget, maxS));
    if (firstPaint) { scrollTop = scrollTarget; firstPaint = false; } // open at the bottom instantly (no intro animation)
    else if (!dragging) {                                             // glide toward the target, settle smoothly
      scrollTop += (scrollTarget - scrollTop) * EASE;
      if (Math.abs(scrollTarget - scrollTop) < 0.4) scrollTop = scrollTarget;
    }
    scrollTop = Math.max(0, Math.min(scrollTop, maxS));
    const win = scroller.visibleWindow(scrollTop, viewportH, 3);
    ensureHeights(win.start, win.end);
    const nowMs = performance.now();
    const moving = prevTop >= 0 && Math.abs(scrollTop - prevTop) > 3; prevTop = scrollTop;
    const botPad = Math.max(0, viewportH - scroller.totalHeight());   // short conversation → rest at the BOTTOM (by the composer), not stranded at the top
    let y = (win.offsetOfStart - scrollTop + botPad) * dpr;       // device pixels
    const items = [];
    for (let i = win.start; i < win.end; i++) {
      const t = tileFor(i);
      let et = enterT.get(i); if (et === undefined) { et = nowMs; if (enterT.size > 6000) enterT.clear(); enterT.set(i, et); }
      let a = 1, yo = 0;
      if (!moving) { const p = Math.min(1, (nowMs - et) / ENTER_MS); if (p < 1) { const e = easeOut(p); a = e; yo = (1 - e) * 8; } }
      items.push({ key: t.key, cv: t.cv, dy: y + yo * dpr, a });   // device-px top of this tile
      y += (scroller.indexToOffset(i + 1) - scroller.indexToOffset(i)) * dpr;
    }
    if (onReachTop && win.start <= 1 && scrollTop <= 2) { try { onReachTop(); } catch {} }
    return items;
  }
  // own render loop (2D or direct-lens modes). In HOST mode the projection host owns the loop instead.
  function frameBody() {
    if (!viewportW || !viewportH) resize();                       // safety: re-measure if the first observe saw 0
    if (!viewportW || !viewportH || (!g2 && !lens)) return;       // not ready to draw yet (2D ctx or GPU lens)
    const items = stepVisible();
    if (g2) {                                                     // TRANSPARENT Canvas2D → wallpaper shows through
      g2.setTransform(1, 0, 0, 1, 0, 0); g2.clearRect(0, 0, canvas.width, canvas.height);
      for (const it of items) { if (it.a < 1) g2.globalAlpha = it.a; g2.drawImage(it.cv, 0, it.dy); if (it.a < 1) g2.globalAlpha = 1; }
    } else if (lens) {                                            // one metal pass of transparent quads
      const quads = [];
      for (const it of items) { lens.ensureTile(it.key, it.cv); quads.push({ key: it.key, x: 0, y: it.dy, w: it.cv.width, h: it.cv.height, alpha: it.a }); }
      try { lens.frame(quads); } catch (e) { if (!dbgErr) { dbgErr = e; try { console.error("[κ-list] lens present failed:", e); } catch {} } try { lens.destroy(); } catch {} lens = null; }
    }
    renderN++;
  }
  // HOST producer — the same visible tiles as draw items for the shared projection host (surface "chat").
  function hostProduce() {
    if (!viewportW || !viewportH) { resize(); if (!viewportW || !viewportH) return []; }
    renderN++;
    return stepVisible().map((it) => ({ key: it.key, src: it.cv, x: 0, y: it.dy, w: it.cv.width, h: it.cv.height, alpha: it.a }));
  }
  if (typeof window !== "undefined") window.__kappaList = () => ({ err: dbgErr && (dbgErr.message || String(dbgErr)), present: host ? "host" : (lens ? "gpu-lens" : (g2 ? "canvas2d" : "none")), gpuFlag: GPU_LENS, soft: SOFT, hostTier: host && host.tier, ctx2d: !!g2, viewportW, viewportH, count: scroller.count, frames: frameN, renders: renderN, dpr, fps: Math.round(fpsEMA), tiles: tileCache.size });

  // ── input ──
  const setPin = () => { pinned = (maxScroll() - scrollTarget) < 8; };
  // wheel: nudge the TARGET (scrollTop eases to it) — instant to react, smooth to settle, no overshoot.
  const onWheel = (e) => { scrollTarget = Math.max(0, Math.min(scrollTarget + e.deltaY * (e.deltaMode === 1 ? 24 : 1), maxScroll())); setPin(); };
  let drag = null;
  const onDown = (e) => { drag = { y: e.clientY, top: scrollTop, t: performance.now() }; dragging = true; dragVel = 0; try { canvas.setPointerCapture(e.pointerId); } catch {} };
  const onMove = (e) => { if (!drag) return; const ny = Math.max(0, Math.min(drag.top - (e.clientY - drag.y), maxScroll())); dragVel = ny - scrollTop; scrollTop = scrollTarget = ny; };   // 1:1 follow (responsive), capture velocity
  const onUp = () => { if (!drag) return; drag = null; dragging = false; scrollTarget = Math.max(0, Math.min(scrollTop + dragVel * FLING, maxScroll())); setPin(); };   // fling: carry the release velocity, then glide to rest
  canvas.addEventListener("wheel", onWheel, { passive: true });
  canvas.addEventListener("pointerdown", onDown); canvas.addEventListener("pointermove", onMove); addEventListener("pointerup", onUp);

  function resize() { const r = canvas.getBoundingClientRect(); const nw = Math.max(1, r.width); const widthChanged = Math.abs(nw - viewportW) > 0.5; viewportW = nw; viewportH = Math.max(1, r.height); canvas.width = Math.round(viewportW * dpr); canvas.height = Math.round(viewportH * dpr); contentW = Math.min(560, viewportW - 40); if (widthChanged) tileCache.clear(); }   // tiles raster at a fixed width → re-raster when the column width changes (e.g. entering theater)
  const ro = new ResizeObserver(resize); ro.observe(canvas);

  // ── public API ──
  // refresh(): message count/content changed → rebuild the scroller for the new count (heights re-measured lazily on
  // the next frame, only for visible rows — O(visible)), keep the pin-to-bottom state, drop stale rastered tiles.
  function refresh() {
    const keep = pinned, n = count();
    scroller = makeScroller({ count: n, rowHeight: 60 });
    measured = new Uint8Array(Math.max(1, n));
    tileCache.clear();
    pinned = keep;
  }
  function scrollToEnd() { pinned = true; }
  const destroy = () => { alive = false; ro.disconnect(); try { host && host.destroy(); } catch {} try { lens && lens.destroy(); } catch {} canvas.removeEventListener("wheel", onWheel); canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointermove", onMove); removeEventListener("pointerup", onUp); };

  // WALLPAPER LAYER (?wall=1) — register the wallpaper as surface "wallpaper" at z:-1 (behind the chat at z:0),
  // so ONE lens composites wallpaper + bubbles in one pass. Cover-fit to the chat area (exactly where WhatsApp
  // shows wallpaper) and dimmed for calm legibility; the opaque tile covers the page wallpaper in the chat rect,
  // so there is no doubling and no main.jsx change. This is the foundation for true frosted-glass bubbles.
  async function mountWallpaperLayer() {
    try {
      const wp = await import("./holo-wall-producer.mjs");
      const producer = wp.makeWallProducer({
        source: wallSrc,
        size: () => ({ w: canvas.width, h: canvas.height }),
        raster: async (url, w, h) => {
          const res = await fetch(url); if (!res.ok) throw new Error("wallpaper http " + res.status);
          const bmp = await createImageBitmap(await res.blob());
          const cv = new OffscreenCanvas(Math.max(1, w), Math.max(1, h)); const g = cv.getContext("2d");
          g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
          const ar = bmp.width / bmp.height, boxAr = w / h; let sw, sh, sx, sy;
          if (ar > boxAr) { sh = bmp.height; sw = sh * boxAr; sx = (bmp.width - sw) / 2; sy = 0; } else { sw = bmp.width; sh = sw / boxAr; sx = 0; sy = (bmp.height - sh) / 2; }
          // BLUR the wallpaper (so frosted-glass bubbles have a soft backdrop). Overdraw past the edges by `ov`
          // so the blur's transparent bleed falls outside the visible area (no darkened border).
          const ov = Math.round(Math.max(w, h) * 0.06);
          g.filter = "blur(" + Math.round(Math.max(w, h) * 0.018) + "px)";
          g.drawImage(bmp, sx, sy, sw, sh, -ov, -ov, w + 2 * ov, h + 2 * ov);
          g.filter = "none";
          g.fillStyle = "rgba(11,20,26,0.5)"; g.fillRect(0, 0, w, h);   // dim toward WhatsApp's calm chat backdrop
          try { bmp.close && bmp.close(); } catch {}
          return cv;
        },
      });
      host.surface("wallpaper", producer, { z: -1 });
    } catch (e) { try { console.error("[κ-list] wallpaper layer failed:", e); } catch {} }
  }

  // MOUNT-TIME present choice (the real fallback point — a canvas's context type is fixed for its lifetime):
  // size first, then DEFAULT to the shared projection host (surface "chat"); ?gpu=1 forces a private lens;
  // ?soft=1 forces Canvas2D. Each degrades to Canvas2D if its WebGPU probe returns null — never a black surface.
  const ready = (async () => {
    try {
      resize();
      if (!SOFT && !GPU_LENS) {   // DEFAULT: the unifying projection host
        try {
          const m = await import("./holo-projection-host.mjs");
          const h = await m.makeProjectionHost(canvas, {});
          if (h && h.lens) {
            host = h;
            hostSurf = host.surface("chat", hostProduce, { z: 0 });
            if (WALL) await mountWallpaperLayer();   // ?wall=1 → the wallpaper becomes a z-behind layer of THIS host (one lens, one pass)
            host.start();   // host owns the rAF loop
          } else { try { h && h.destroy(); } catch {} }
        } catch (e) { host = null; try { console.error("[κ-list] host unavailable, using 2D:", e); } catch {} }
      }
      if (!host && !SOFT && GPU_LENS) { try { const m = await import("./holo-msglist-lens.mjs"); lens = await m.makeMsglistLens(canvas, {}); } catch (e) { lens = null; try { console.error("[κ-list] lens unavailable, using 2D:", e); } catch {} } }
      if (!host && !lens) setup2D();
      if (!host) requestAnimationFrame(frame);   // own loop only when the host isn't driving
    } catch (e) { dbgErr = e; try { console.error("[κ-list] init failed:", e); } catch {} }
  })();
  return { refresh, scrollToEnd, atBottom: () => pinned, destroy, ready, invalidate: () => tileCache.clear() };
}

function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
// WhatsApp bubble outline: rounded rect with ONE tailed corner — outgoing (mine) → top-right, incoming → top-left.
function bubblePath(g, x, y, w, h, r, mine, tail) {
  g.beginPath();
  if (mine) {
    g.moveTo(x + r, y); g.lineTo(x + w + tail, y); g.lineTo(x + w, y + tail);
    g.lineTo(x + w, y + h - r); g.arcTo(x + w, y + h, x + w - r, y + h, r);
    g.lineTo(x + r, y + h); g.arcTo(x, y + h, x, y + h - r, r);
    g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r); g.closePath();
  } else {
    g.moveTo(x - tail, y); g.lineTo(x + w - r, y); g.arcTo(x + w, y, x + w, y + r, r);
    g.lineTo(x + w, y + h - r); g.arcTo(x + w, y + h, x + w - r, y + h, r);
    g.lineTo(x + r, y + h); g.arcTo(x, y + h, x, y + h - r, r);
    g.lineTo(x, y + tail); g.closePath();
  }
}
function defHue(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; }

export default mountKappaMessageList;
