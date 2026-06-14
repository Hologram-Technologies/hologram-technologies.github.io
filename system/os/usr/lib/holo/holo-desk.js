// holo-desk.js — Holo Desk: the substrate-native DESKTOP for Hologram OS. A wallpaper plane + an
// icon grid over the user's writable OPFS Home (/home/user/Desktop) that replicates the native
// desktop folder/icon experience in any browser — and makes it MAGICAL by leaning all the way into
// the UOR content-addressed substrate:
//   • CREATE   — right-click "New ▸ Folder / Text / App shortcut"; folders pop in with a focused
//                inline-rename field, exactly like Windows/macOS.
//   • PIN ANYTHING — drop or paste ANY app, file, URL, or κ/did:holo onto the desktop and it becomes
//                a self-verifying icon (files import + content-address on write; κ/identifiers become
//                object pins; apps become launchers; URLs become web pins).
//   • ORGANISE — drag to arrange (snaps + persists), NEST by dropping onto a folder, marquee multi-
//                select, copy/cut/paste, and a safety net: delete → Trash, with Undo (⌘/Ctrl+Z).
//   • PROVE    — every icon carries its did:holo κ (a verify badge re-derives on hover, Law L5),
//                "Copy holo:// link" shares an object by content address, and "Copy desktop κ" turns
//                your WHOLE arrangement into one shareable address. Quick Look (Space) shows the live κ.
//   • FEEL     — it reskins to the host OS (Windows folders/selection vs macOS) via HoloPlatform,
//                insets around the dock, and animates with taste (honouring reduced-motion).
// It REUSES the OS engines and runs no foreign runtime (ADR-0029). Pure DOM + Web APIs, no CDN.
//
// Drop-in:  <script src="_shared/holo-desk.js" defer></script>   (exposes window.HoloDesk)

(function () {
  "use strict";
  var W = window, DOC = document, root = DOC.documentElement;
  if (W.HoloDesk) return;
  if (typeof DOC === "undefined") return;
  try { if (W.top !== W.self) return; } catch (e) { return; }   // never inside a nested holospace frame

  var SELF = (DOC.currentScript && DOC.currentScript.src) ||
    (DOC.querySelector('script[src*="holo-desk.js"]') || {}).src ||
    new URL("_shared/holo-desk.js", location.href).href;
  var SHARED = /\/\.holo\/sha256\//.test(SELF) ? "/_shared/" : SELF.replace(/holo-desk\.js.*$/, "");
  var CSS_URL = SHARED + "holo-desk.css";

  var HOME = "/home/user";
  var DESK_ROOT = "/home/user/Desktop";
  var META_FILE = "/home/user/.desktop/desk.uor.json";
  var TRASH = "/home/user/.Trash";
  var SHORTCUT_EXT = ".holospace";   // an app launcher
  var OBJREF_EXT = ".holoref";       // a content-addressed object / web pin

  var WALLPAPERS = [
    { id: "aurora", name: "Aurora" }, { id: "bloom", name: "Bloom" }, { id: "mojave", name: "Dusk" },
    { id: "graphite", name: "Graphite" }, { id: "accent", name: "Accent" },
  ];
  var ICON_BY_KIND = { code: "file-code", text: "file-text", data: "file-database", image: "photo",
    audio: "music", video: "movie", doc: "file-text", archive: "file-zip", font: "typography", binary: "binary", file: "file" };
  var DEFAULT_SET = "tabler";

  // ── tiny DOM helpers ──────────────────────────────────────────────────────────────────────────
  function el(tag, attrs, kids) {
    var n = DOC.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === "class") n.className = attrs[k];
      else if (k === "text") n.textContent = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function holoIcon(set, name) { var ic = DOC.createElement("holo-icon"); ic.setAttribute("set", set); ic.setAttribute("name", name); return ic; }
  function imgEl(src, fallbackIcon) { var im = el("img", { src: src, alt: "", loading: "lazy" }); im.addEventListener("error", function () { var f = holoIcon(DEFAULT_SET, fallbackIcon || "app-window"); if (im.parentNode) im.replaceWith(f); }); return im; }
  function hexOf(k) { return String(k || "").replace(/^holo:\/\//i, "").split(":").pop().replace(/^sha256\//i, ""); }
  function extOfName(name) { var m = /(\.[a-z0-9]+)$/i.exec(name || ""); return m ? m[1] : ""; }
  function stripExt(name) { return String(name || "").replace(/\.[a-z0-9]+$/i, "") || name; }
  function nowId() { try { return Date.now().toString(36); } catch (e) { return "x" + (nowId._n = (nowId._n || 0) + 1); } }

  // ── deps (existing substrate engines) ─────────────────────────────────────────────────────────
  function loadScript(url) {
    return new Promise(function (res) {
      if (DOC.querySelector('script[data-holodep="' + url + '"]')) return res();
      var s = DOC.createElement("script"); s.src = url; s.async = false; s.setAttribute("data-holodep", url);
      s.onload = function () { res(); }; s.onerror = function () { res(); }; (DOC.head || root).appendChild(s);
    });
  }
  var Files = null, Obj = null, profileFor = null, CATALOG = {};
  function loadDeps() {
    var p = [];
    if (!W.HoloIcons) p.push(loadScript(SHARED + "holo-icons.js"));
    p.push(import(SHARED + "holo-files.js").then(function (m) { Files = W.HoloFiles || (m && (m.HoloFiles || m.default)); }).catch(function () { Files = W.HoloFiles; }));
    p.push(import(SHARED + "holo-object.js").then(function (m) { Obj = W.HoloObject || m; }).catch(function () { Obj = W.HoloObject; }));
    p.push(import(SHARED + "holo-platform.js").then(function (m) { profileFor = (m && (m.profileFor || (m.default && m.default.profileFor))) || (W.HoloPlatform && W.HoloPlatform.profileFor); }).catch(function () {}));
    p.push(loadCatalog());
    return Promise.all(p);
  }
  function loadCatalog() {
    return fetch(new URL("apps/index.jsonld", location.href), { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      ((j && j["dcat:dataset"]) || []).forEach(function (a) {
        var id = a["schema:identifier"]; if (!id) return;
        CATALOG[id] = { id: id, name: a["schema:name"] || id, icon: a["schema:image"] ? new URL(a["schema:image"], location.href).href : null, landing: a["dcat:landingPage"] || "" };
      });
    }).catch(function () {});
  }

  // ── state ─────────────────────────────────────────────────────────────────────────────────────
  var ST = { profile: null, cwd: DESK_ROOT, manifest: { version: 1, wallpaper: "aurora", items: {} },
    nodes: [], sel: new Set(), deskEl: null, surfEl: null, barEl: null, clip: null, undo: [], typeBuf: "", typeAt: 0 };

  // ── boot ────────────────────────────────────────────────────────────────────────────────────────
  function ensureCss() { if (!DOC.querySelector('link[href*="holo-desk.css"]')) { var l = DOC.createElement("link"); l.rel = "stylesheet"; l.href = CSS_URL; (DOC.head || root).appendChild(l); } }
  function detectProfile() {
    try { if (profileFor) return profileFor(navigator); } catch (e) {}
    try { if (W.HoloPlatform && W.HoloPlatform.profileFor) return W.HoloPlatform.profileFor(navigator); } catch (e) {}
    var ua = String(navigator.userAgent || ""), os = "linux";
    if (/Windows/i.test(ua)) os = "windows"; else if (/Android/i.test(ua)) os = "android";
    else if (/CrOS/i.test(ua)) os = "chromeos"; else if (/Mac OS X|Macintosh/i.test(ua)) os = "macos";
    return { os: os, apple: os === "macos" };
  }
  function start() {
    if (new URLSearchParams(location.search).has("manage")) return;
    ensureCss();
    loadDeps().then(function () {
      ST.profile = detectProfile();
      buildLayer();
      return ensureDirs();
    }).then(loadManifest).then(function () {
      applyWallpaper();
      return refresh();
    }).catch(function (e) { try { console.warn("HoloDesk:", e); } catch (x) {} });
  }
  function ensureDirs() {
    if (!Files) return Promise.resolve();
    return Promise.resolve(Files.mkdir(HOME, "Desktop")).catch(function () {})
      .then(function () { return Promise.resolve(Files.mkdir(HOME, ".desktop")).catch(function () {}); })
      .then(function () { return Promise.resolve(Files.mkdir(HOME, ".Trash")).catch(function () {}); });
  }

  // ── the desktop layer ─────────────────────────────────────────────────────────────────────────
  function buildLayer() {
    var prev = DOC.getElementById("holo-desk"); if (prev) prev.remove();
    var desk = el("div", { id: "holo-desk", "data-holo-platform": ST.profile.os });
    var bar = el("div", { "class": "holo-desk-bar" });
    var surf = el("div", { "class": "holo-desk-surface", tabindex: "-1" });
    desk.appendChild(bar); desk.appendChild(surf);
    surf.addEventListener("contextmenu", function (e) { if (e.target === surf) { e.preventDefault(); openDeskMenu(e.clientX, e.clientY); } });
    surf.addEventListener("pointerdown", function (e) { if (e.target === surf && e.button === 0) { closeMenu(); startMarquee(e); } });
    surf.addEventListener("dblclick", function (e) { if (e.target === surf && ST.cwd !== DESK_ROOT) navigateTo(DESK_ROOT); });
    // drop ANYTHING — native files, a URL, a κ/did:holo, an app link — onto the desktop.
    desk.addEventListener("dragover", function (e) { e.preventDefault(); try { e.dataTransfer.dropEffect = "copy"; } catch (x) {} desk.classList.add("drag-over"); });
    desk.addEventListener("dragleave", function (e) { if (e.target === desk || e.target === surf) desk.classList.remove("drag-over"); });
    desk.addEventListener("drop", function (e) { e.preventDefault(); desk.classList.remove("drag-over"); handleDrop(e); });
    DOC.body.appendChild(desk);
    ST.deskEl = desk; ST.surfEl = surf; ST.barEl = bar;
    DOC.addEventListener("keydown", onKey, false);
    DOC.addEventListener("paste", onPaste, false);
    watchFrame();
    W.addEventListener("resize", function () { if (ST.deskEl) renderIcons(true); });
  }
  function watchFrame() {
    var f = DOC.getElementById("holoframe"); if (!f || !W.MutationObserver) return;
    new MutationObserver(function () { if (!isFramed()) refresh(); }).observe(f, { attributes: true, attributeFilter: ["class"] });
  }
  function isFramed() { var f = DOC.getElementById("holoframe"); return !!(f && f.classList.contains("open")); }
  function modalOpen() { return !!DOC.querySelector(".holo-desk-scrim"); }
  function editingActive() { return !!DOC.querySelector(".holo-desk-rename") || modalOpen(); }
  function applyWallpaper() { if (ST.deskEl) ST.deskEl.setAttribute("data-wallpaper", ST.manifest.wallpaper || "aurora"); }

  // ── manifest — the desktop LAYOUT as a self-verifying UOR object (Law L5) ──────────────────────
  function normalizeManifest(o) { o = o || {}; return { version: o.version || 1, wallpaper: o.wallpaper || "aurora", items: (o.items && typeof o.items === "object") ? o.items : {} }; }
  function loadManifest() {
    if (!Files) return Promise.resolve();
    return Promise.resolve(Files.read({ source: "opfs", path: META_FILE, name: "desk.uor.json", mime: "application/json" }))
      .then(function (r) { return new TextDecoder().decode(r.bytes); })
      .then(function (txt) {
        var obj = JSON.parse(txt);
        try { if (Obj && Obj.verify) Obj.verify(obj).then(function (ok) { ST.layoutVerified = ok; }); } catch (e) {}
        ST.manifest = normalizeManifest(obj);
      }).catch(function () { /* first run */ });
  }
  function sealedLayout() {
    var base = { "@type": "hosc:DesktopLayout", version: ST.manifest.version || 1, wallpaper: ST.manifest.wallpaper || "aurora", items: ST.manifest.items || {} };
    // fold the live Holo Widgets board into the SAME address, so one κ carries icons AND widgets.
    try { var snap = (W.HoloWidgets && W.HoloWidgets.snapshot) ? W.HoloWidgets.snapshot() : null; if (snap && snap.length) base.widgets = snap; } catch (e) {}
    return Obj.address(base).then(function (id) { var sealed = { id: id }; for (var k in base) sealed[k] = base[k]; return sealed; });
  }
  function saveManifest() {
    if (!Files || !Obj || !Obj.address) return Promise.resolve();
    return sealedLayout().then(function (sealed) { return Files.writeFile(META_FILE, JSON.stringify(sealed, null, 2)); }).catch(function () {});
  }

  // ── list + render ─────────────────────────────────────────────────────────────────────────────
  function refresh() {
    if (!Files) return Promise.resolve();
    return Promise.resolve(Files.list({ source: "opfs", path: ST.cwd, kind: "dir" }))
      .then(function (kids) { ST.nodes = (kids || []).filter(function (n) { return n.name !== ".Trash" && n.name !== ".desktop"; }); return augmentPins(ST.nodes); })
      .then(function () { renderBar(); renderIcons(); })
      .catch(function () { ST.nodes = []; renderBar(); renderIcons(); });
  }
  // a "<name>.holospace" file is an app launcher; "<name>.holoref" is a content-addressed object / web pin.
  function augmentPins(nodes) {
    var ps = nodes.filter(function (n) { return isShortcutName(n.name) || isObjRefName(n.name); }).map(function (n) {
      return Promise.resolve(Files.read(n, 16384)).then(function (r) {
        var o = {}; try { o = JSON.parse(new TextDecoder().decode(r.bytes)); } catch (e) {}
        if (isShortcutName(n.name)) { n._shortcut = true; n.kind = "app"; n._appId = o["schema:identifier"] || o.app || ""; n._appName = baseName(n.name, SHORTCUT_EXT); }
        else { n._objref = true; n.kind = "object"; n._oid = o.id || ""; n._holo = o.holo || ""; n._url = o.url || ""; n._oicon = o.icon || null; n._appName = baseName(n.name, OBJREF_EXT); }
      }).catch(function () { n.kind = isShortcutName(n.name) ? "app" : "object"; n._appName = baseName(n.name, isShortcutName(n.name) ? SHORTCUT_EXT : OBJREF_EXT); });
    });
    return Promise.all(ps);
  }
  function reExt(ext) { return new RegExp("\\" + ext + "$", "i"); }
  function isShortcutName(name) { return reExt(SHORTCUT_EXT).test(name || ""); }
  function isObjRefName(name) { return reExt(OBJREF_EXT).test(name || ""); }
  function baseName(name, ext) { return String(name || "").replace(reExt(ext), ""); }
  function displayName(node) { return (node._shortcut || node._objref) ? node._appName : node.name; }
  function renderBar() {
    var bar = ST.barEl; if (!bar) return; bar.innerHTML = "";
    if (ST.cwd === DESK_ROOT) { ST.deskEl.removeAttribute("data-nav"); return; }
    ST.deskEl.setAttribute("data-nav", "");
    var back = el("button", { title: "Back to Desktop", text: "← Desktop" });
    back.addEventListener("click", function () { navigateTo(DESK_ROOT); }); bar.appendChild(back);
    var rel = ST.cwd.slice(DESK_ROOT.length).split("/").filter(Boolean), acc = DESK_ROOT;
    rel.forEach(function (seg, i) {
      bar.appendChild(el("span", { "class": "crumb", text: "›" }));
      acc += "/" + seg; var path = acc;
      var c = el("button", { "class": "crumb" + (i === rel.length - 1 ? " cur" : ""), text: seg });
      c.addEventListener("click", function () { navigateTo(path); }); bar.appendChild(c);
    });
  }

  var CW = 100, CH = 106, MX = 18, MY = 14;
  function baseY() { return ST.cwd !== DESK_ROOT ? 56 : MY; }
  function dockInset() {
    var ins = { left: MX, right: MX, bottom: 84 };
    var d = DOC.getElementById("holo-dock"); if (!d) return ins;
    try {
      var r = d.getBoundingClientRect(), vw = W.innerWidth || 1280, vh = W.innerHeight || 800;
      if (!r.width || !r.height) return ins;
      if (r.bottom > vh - 12 && r.width > vw * 0.35) ins.bottom = Math.max(ins.bottom, vh - r.top + 12);
      if (r.left < 12 && r.height > vh * 0.35) ins.left = Math.max(ins.left, r.right + 12);
      if (r.right > vw - 12 && r.height > vh * 0.35) ins.right = Math.max(ins.right, vw - r.left + 12);
    } catch (e) {}
    return ins;
  }
  function autoSlots(count) {
    var ins = dockInset(), top = baseY();
    var avail = (W.innerHeight || 800) - top - ins.bottom;
    var rows = Math.max(1, Math.floor(avail / CH));
    var rightOrigin = ST.profile && (ST.profile.os === "macos" || ST.profile.os === "ipados");
    var vw = W.innerWidth || 1280, out = [];
    for (var i = 0; i < count; i++) {
      var col = Math.floor(i / rows), row = i % rows;
      var x = rightOrigin ? (vw - CW - ins.right - col * CW) : (ins.left + col * CW);
      out.push({ x: Math.max(8, x), y: top + row * CH });
    }
    return out;
  }
  function posFor(node) { var it = ST.manifest.items[node.path]; return it && it.pos ? it.pos : null; }
  function renderIcons(noAnim) {
    var surf = ST.surfEl; if (!surf) return;
    surf.querySelectorAll(".holo-desk-icon").forEach(function (n) { n.remove(); });
    var slots = autoSlots(ST.nodes.length), anim = !noAnim && !reducedMotion();
    ST.nodes.forEach(function (node, i) {
      var cell = iconCell(node);
      var pos = posFor(node) || slots[i];
      cell.style.left = pos.x + "px"; cell.style.top = pos.y + "px";
      if (anim) { cell.classList.add("enter"); cell.style.animationDelay = Math.min(i * 18, 260) + "ms"; }
      surf.appendChild(cell);
    });
  }
  function reducedMotion() { try { return root.getAttribute("data-holo-motion") === "reduced" || (W.matchMedia && W.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } }

  function defaultIconName(node) {
    if (node.kind === "dir") return "folder";
    if (node.kind === "app") return "app-window";
    if (node.kind === "object") return node._url ? "world" : "box";
    var k = (Files && Files.kindOf) ? Files.kindOf(node.name) : "file";
    return ICON_BY_KIND[k] || "file";
  }
  function glyphFor(node) {
    var it = ST.manifest.items[node.path];
    if (it && it.icon && it.icon.img) return imgEl(it.icon.img, "app-window");
    if (it && it.icon && it.icon.name) return holoIcon(it.icon.set || DEFAULT_SET, it.icon.name);
    if (node.kind === "dir") return folderGlyph(node);
    if (node.kind === "app") { var cat = node._appId && CATALOG[node._appId]; return cat && cat.icon ? imgEl(cat.icon, "app-window") : holoIcon(DEFAULT_SET, "app-window"); }
    if (node.kind === "object" && node._oicon && node._oicon.name) return holoIcon(node._oicon.set || DEFAULT_SET, node._oicon.name);
    return holoIcon(DEFAULT_SET, defaultIconName(node));
  }
  function folderGlyph(node) {
    var wrap = el("div", { "class": "holo-desk-folder" });
    wrap.appendChild(el("div", { "class": "fold-base" }, [holoIcon(DEFAULT_SET, "folder-filled")]));
    var prev = el("div", { "class": "fold-prev" }); wrap.appendChild(prev);
    Promise.resolve(Files.list({ source: "opfs", path: node.path, kind: "dir" })).then(function (kids) {
      kids = kids || []; if (!kids.length) { wrap.classList.add("empty"); return; }
      wrap.classList.add("filled");
      kids.slice(0, 4).forEach(function (c) {
        var mini = el("div", { "class": "mini" });
        if (c.kind !== "dir" && Files.kindOf && Files.kindOf(c.name) === "image") {
          mini.classList.add("thumb");
          Promise.resolve(Files.read(c, 768 * 1024)).then(function (r) {
            var u = URL.createObjectURL(new Blob([r.bytes], { type: r.mime || "image/png" }));
            var im = el("img", { src: u, alt: "" }); im.addEventListener("load", function () { setTimeout(function () { URL.revokeObjectURL(u); }, 20000); }); mini.appendChild(im);
          }).catch(function () { mini.appendChild(holoIcon(DEFAULT_SET, "photo")); });
        } else { mini.appendChild(holoIcon(DEFAULT_SET, c.kind === "dir" ? "folder" : (ICON_BY_KIND[Files.kindOf ? Files.kindOf(c.name) : "file"] || "file"))); }
        prev.appendChild(mini);
      });
    }).catch(function () {});
    return wrap;
  }
  function iconCell(node) {
    var kindClass = node.kind === "dir" ? "folder" : node.kind === "app" ? "app" : node.kind === "object" ? "object" : "file";
    var cell = el("div", { "class": "holo-desk-icon", tabindex: "0", "data-path": node.path, title: displayName(node) });
    var glyph = el("div", { "class": "holo-desk-glyph holo-desk-glyph--" + kindClass }); glyph.appendChild(glyphFor(node));
    // every object carries its content address — a verify badge that re-derives on hover (Law L5).
    if (node.kind !== "dir") glyph.appendChild(el("span", { "class": "vbadge", title: "Verified — hover to check" }, [holoIcon(DEFAULT_SET, "shield-check")]));
    var label = el("div", { "class": "holo-desk-label", text: displayName(node) });
    cell.appendChild(glyph); cell.appendChild(label);
    if (ST.sel.has(node.path)) cell.classList.add("is-selected");
    cell.addEventListener("dblclick", function (e) { e.preventDefault(); openNode(node); });
    cell.addEventListener("contextmenu", function (e) { e.preventDefault(); e.stopPropagation(); if (!ST.sel.has(node.path)) selectOnly(node.path); openItemMenu(e.clientX, e.clientY, node); });
    cell.addEventListener("mouseenter", function () { lazyVerify(cell, node); });
    wireDrag(cell, node);
    cell._node = node; cell._label = label;
    return cell;
  }
  function lazyVerify(cell, node) {
    if (cell._verified || node.kind === "dir") return; cell._verified = true;
    Promise.resolve(Files.verify(node)).then(function (v) {
      var b = cell.querySelector(".vbadge"); if (!b) return;
      if (v && v.derived) { cell.classList.add("verified"); b.title = "Verified ✓ — " + v.derived; }
    }).catch(function () {});
  }

  // ── selection ─────────────────────────────────────────────────────────────────────────────────
  function selectCell(node, e) {
    if (e && (e.ctrlKey || e.metaKey)) { if (ST.sel.has(node.path)) ST.sel.delete(node.path); else ST.sel.add(node.path); }
    else if (!ST.sel.has(node.path)) ST.sel = new Set([node.path]);
    syncSel();
  }
  function selectOnly(path) { ST.sel = new Set([path]); syncSel(); }
  function clearSel() { ST.sel = new Set(); syncSel(); }
  function syncSel() { if (ST.surfEl) ST.surfEl.querySelectorAll(".holo-desk-icon").forEach(function (c) { c.classList.toggle("is-selected", ST.sel.has(c.getAttribute("data-path"))); }); }
  function nodeByPath(p) { for (var i = 0; i < ST.nodes.length; i++) if (ST.nodes[i].path === p) return ST.nodes[i]; return null; }
  function findCellByPath(p) { if (!ST.surfEl) return null; var cs = ST.surfEl.querySelectorAll(".holo-desk-icon"); for (var i = 0; i < cs.length; i++) if (cs[i].getAttribute("data-path") === p) return cs[i]; return null; }

  // ── marquee (rubber-band multi-select) ────────────────────────────────────────────────────────
  function startMarquee(e) {
    var surf = ST.surfEl, sr = surf.getBoundingClientRect();
    var add = e.ctrlKey || e.metaKey, baseSel = add ? new Set(ST.sel) : new Set();
    if (!add) clearSel();
    var box = el("div", { "class": "holo-desk-marquee" }); surf.appendChild(box);
    var sx = e.clientX, sy = e.clientY, moved = false;
    try { surf.setPointerCapture(e.pointerId); } catch (x) {}
    function move(ev) {
      var x = Math.min(ev.clientX, sx), y = Math.min(ev.clientY, sy), w = Math.abs(ev.clientX - sx), h = Math.abs(ev.clientY - sy);
      if (!moved && w + h < 4) return; moved = true;
      box.style.left = (x - sr.left) + "px"; box.style.top = (y - sr.top) + "px"; box.style.width = w + "px"; box.style.height = h + "px";
      var rect = { left: x, top: y, right: x + w, bottom: y + h }, next = new Set(baseSel);
      surf.querySelectorAll(".holo-desk-icon").forEach(function (c) {
        var r = c.getBoundingClientRect();
        if (!(r.right < rect.left || r.left > rect.right || r.bottom < rect.top || r.top > rect.bottom)) next.add(c.getAttribute("data-path"));
      });
      ST.sel = next; syncSel();
    }
    function up(ev) { surf.removeEventListener("pointermove", move); surf.removeEventListener("pointerup", up); surf.removeEventListener("pointercancel", up); try { surf.releasePointerCapture(ev.pointerId); } catch (x) {} box.remove(); }
    surf.addEventListener("pointermove", move); surf.addEventListener("pointerup", up); surf.addEventListener("pointercancel", up);
  }

  // ── open / navigate ───────────────────────────────────────────────────────────────────────────
  function openNode(node) {
    var cell = findCellByPath(node.path); if (cell && !reducedMotion()) { cell.classList.remove("bounce"); void cell.offsetWidth; cell.classList.add("bounce"); }
    if (node.kind === "app") return launchApp(node);
    if (node.kind === "object") { if (node._url) { W.open(node._url, "_blank"); return; } return openQuickLook(node); }
    if (node.kind === "dir") return navigateTo(node.path);
    return openFile(node);
  }
  function navigateTo(path) { ST.cwd = path; ST.sel = new Set(); closeMenu(); refresh(); }
  function openFile(node) {
    if (Files.kindOf && /^(image|text|code|data|doc)$/.test(Files.kindOf(node.name))) return openQuickLook(node);
    Promise.resolve(Files.read(node, 16 * 1024 * 1024)).then(function (r) {
      var url = URL.createObjectURL(new Blob([r.bytes], { type: r.mime || "application/octet-stream" }));
      W.open(url, "_blank"); setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    }).catch(function () { openProps(node); });
  }
  function launchApp(node) {
    var id = node._appId;
    try { if (W.HoloDock && W.HoloDock.launch && id) { W.HoloDock.launch(id); return; } } catch (e) {}
    if (id) {
      var f = DOC.getElementById("holoframe"), hf = DOC.getElementById("hf-frame");
      if (f && hf) { hf.src = "holospace.html?app=" + encodeURIComponent(id); f.classList.add("open"); f.setAttribute("aria-hidden", "false"); root.classList.add("framed"); return; }
      W.open("holospace.html?app=" + encodeURIComponent(id), "_blank");
    } else openProps(node);
  }

  // ── create (the native "New") ─────────────────────────────────────────────────────────────────
  function uniqueName(base, ext) {
    var taken = {}; ST.nodes.forEach(function (n) { taken[n.name.toLowerCase()] = 1; });
    var name = base + ext, i = 2;
    while (taken[name.toLowerCase()]) { name = base + " " + i + ext; i++; }
    return name;
  }
  function newFolder() {
    var name = uniqueName("New folder", "");
    Promise.resolve(Files.mkdir(ST.cwd, name)).then(refresh).then(function () { beginRenameByName(name); }).catch(function () { toast("Could not create folder"); });
  }
  function newTextDoc() {
    var name = uniqueName("New Text Document", ".txt");
    Promise.resolve(Files.createFile(ST.cwd, name, "")).then(refresh).then(function () { beginRenameByName(name); }).catch(function () { toast("Could not create file"); });
  }
  function beginRenameByName(name) { for (var i = 0; i < ST.surfEl.children.length; i++) { var c = ST.surfEl.children[i]; if (c._node && c._node.name === name) { startInlineRename(c); return; } } }

  // ── app shortcuts + object pins (save any app OR object to the desktop) ────────────────────────
  function newAppShortcut() { if (!Object.keys(CATALOG).length) { toast("App catalog not loaded yet"); return; } openAppPicker(createShortcut); }
  function createShortcut(app) {
    var base = (app.name || "App").replace(/[\\/:*?"<>|]/g, "").trim() || "App";
    var name = uniqueName(base, SHORTCUT_EXT);
    var body = JSON.stringify({ "@type": "hosc:AppShortcut", "schema:identifier": app.id, "schema:name": app.name, "dcat:landingPage": app.landing || "" }, null, 2);
    return Promise.resolve(Files.createFile(ST.cwd, name, body)).then(refresh).then(function () { toast("Added " + app.name + " to the desktop"); });
  }
  function createObjectPin(o) {
    var label = String(o.label || "object").replace(/[\\/:*?"<>|]/g, "").trim() || "object";
    var name = uniqueName(label, OBJREF_EXT);
    var body = JSON.stringify({ "@type": "hosc:ObjectRef", id: o.id || "", "schema:name": o.label || label, holo: o.kappa ? ("holo://" + hexOf(o.kappa)) : "", url: o.url || "", icon: o.icon || null }, null, 2);
    return Promise.resolve(Files.createFile(ST.cwd, name, body)).then(refresh).then(function () { toast("Pinned " + (o.label || "object") + " to the desktop"); });
  }
  function dockPins() { try { return (W.HoloDock.config().effective.pins) || []; } catch (e) { return []; } }
  function openAppPicker(cb) {
    closeMenu();
    var apps = Object.keys(CATALOG).map(function (id) { return CATALOG[id]; }).sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });
    var scrim = el("div", { "class": "holo-desk-scrim" });
    var pick = el("div", { "class": "holo-desk-picker", role: "dialog", "aria-label": "Add an app to the desktop" });
    var head = el("div", { "class": "pk-head" }, [el("div", { "class": "pk-title", text: "Add an app to the desktop" })]);
    var close = el("button", { "class": "pk-close", text: "✕", "aria-label": "Close" }); close.addEventListener("click", function () { scrim.remove(); }); head.appendChild(close);
    var search = el("input", { "class": "pk-search", type: "search", placeholder: "Search apps…", spellcheck: "false" });
    var controls = el("div", { "class": "pk-controls" }, [search]);
    var list = el("div", { "class": "pk-apps" });
    pick.appendChild(head); pick.appendChild(controls); pick.appendChild(list);
    scrim.appendChild(pick); DOC.body.appendChild(scrim);
    scrim.addEventListener("pointerdown", function (e) { if (e.target === scrim) scrim.remove(); });
    function render() {
      var q = (search.value || "").trim().toLowerCase(); list.innerHTML = "";
      apps.filter(function (a) { return !q || (a.name || "").toLowerCase().indexOf(q) >= 0 || (a.id || "").toLowerCase().indexOf(q) >= 0; }).forEach(function (a) {
        var b = el("button", { "class": "pk-app", type: "button", title: a.id });
        b.appendChild(a.icon ? imgEl(a.icon, "app-window") : holoIcon(DEFAULT_SET, "app-window"));
        b.appendChild(el("div", { "class": "nm", text: a.name }));
        b.addEventListener("click", function () { scrim.remove(); cb(a); });
        list.appendChild(b);
      });
      if (!list.children.length) list.appendChild(el("div", { "class": "pk-count", text: "No apps match." }));
    }
    search.addEventListener("input", render); render(); setTimeout(function () { search.focus(); }, 30);
  }

  // ── drop & paste anything → import + content-address (the substrate magic) ─────────────────────
  function handleDrop(e) {
    var dt = e.dataTransfer; if (!dt) return;
    if (dt.files && dt.files.length) return importFiles(dt.files);
    var uri = "";
    try { uri = dt.getData("text/uri-list") || dt.getData("text/plain") || ""; } catch (x) {}
    if (uri) resolveDrop(uri.split(/\r?\n/)[0].trim());
  }
  function onPaste(e) {
    if (isFramed() || editingActive() || ST.clip) return;     // internal clipboard handled by ⌘V in onKey
    var cd = e.clipboardData; if (!cd) return;
    if (cd.files && cd.files.length) { e.preventDefault(); return importFiles(cd.files); }
    var t = ""; try { t = cd.getData("text/plain") || ""; } catch (x) {}
    if (t && t.trim()) { e.preventDefault(); resolveDrop(t.trim()); }
  }
  function importFiles(files) {
    var arr = [].slice.call(files), chain = Promise.resolve(), made = [];
    arr.forEach(function (f) {
      chain = chain.then(function () {
        var name = uniqueName(stripExt(f.name), extOfName(f.name));
        return f.arrayBuffer().then(function (buf) { return Files.createFile(ST.cwd, name, buf); }).then(function () { made.push(name); });
      });
    });
    chain.then(refresh).then(function () { pushUndo({ type: "create", names: made }); toast("Imported " + made.length + " item" + (made.length === 1 ? "" : "s")); }).catch(function () { toast("Import failed"); });
  }
  function resolveDrop(str) {
    str = String(str || "").trim(); if (!str) return;
    var appM = str.match(/[?&#]app=([^&#]+)/);
    if (appM) { var id = decodeURIComponent(appM[1]); createShortcut(CATALOG[id] || { id: id, name: id.split(".").pop(), landing: str }); return; }
    if (CATALOG[str]) { createShortcut(CATALOG[str]); return; }
    if (/^holo:\/\//i.test(str) || /^did:holo:/i.test(str) || /^(sha256|blake3):[0-9a-f]{8}/i.test(str) || /^(bafy|Qm)[1-9A-Za-z]{8}/.test(str)) {
      return createObjectPin({ id: str, label: shortId(str), kappa: hexOf(str) });
    }
    if (/^https?:\/\//i.test(str)) { var host = str.replace(/^https?:\/\//i, "").split("/")[0]; return createObjectPin({ id: str, label: host, url: str, icon: { set: DEFAULT_SET, name: "world" } }); }
    var name = uniqueName("Dropped text", ".txt");
    Promise.resolve(Files.createFile(ST.cwd, name, str)).then(refresh).then(function () { toast("Saved dropped text"); });
  }
  function shortId(s) { var h = hexOf(s); return (/^https?:/i.test(s) ? s : (s.split(":")[0] + " " + h.slice(0, 8))).slice(0, 28); }

  // ── inline rename ─────────────────────────────────────────────────────────────────────────────
  function startInlineRename(cell) {
    if (!cell || cell._editing) return;
    var node = cell._node, old = node.name, ext = node._shortcut ? SHORTCUT_EXT : node._objref ? OBJREF_EXT : "", isPin = !!ext;
    cell._editing = true; selectOnly(node.path);
    var editVal = isPin ? node._appName : old;
    var input = el("input", { "class": "holo-desk-rename", value: editVal, spellcheck: "false" });
    cell._label.replaceWith(input); cell._label = input; input.focus();
    var dot = (!isPin && node.kind === "file") ? editVal.lastIndexOf(".") : -1;
    try { input.setSelectionRange(0, dot > 0 ? dot : editVal.length); } catch (e) { input.select(); }
    var done = false;
    function commit(save) {
      if (done) return; done = true;
      var nv = (input.value || "").trim();
      var span = el("div", { "class": "holo-desk-label", text: (save && nv) ? nv : editVal });
      input.replaceWith(span); cell._label = span; cell._editing = false;
      var newFull = isPin ? (nv + ext) : nv;
      if (save && nv && newFull !== old && validName(nv)) {
        if (nameTaken(newFull)) { toast("“" + nv + "” already exists"); return; }
        Promise.resolve(Files.rename(ST.cwd, old, newFull)).then(function () { migrateItemKey(node.path, joinPath(ST.cwd, newFull)); pushUndo({ type: "rename", dir: ST.cwd, from: newFull, to: old }); }).then(refresh).catch(function () { toast("Rename failed"); refresh(); });
      }
    }
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); commit(true); } else if (e.key === "Escape") { e.preventDefault(); commit(false); } e.stopPropagation(); });
    input.addEventListener("blur", function () { commit(true); });
    input.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
  }
  function validName(n) { return !/[\\/:*?"<>|]/.test(n) && n !== "." && n !== ".."; }
  function nameTaken(n) { return ST.nodes.some(function (x) { return x.name.toLowerCase() === n.toLowerCase(); }); }
  function joinPath(dir, name) { return dir.replace(/\/$/, "") + "/" + name; }
  function migrateItemKey(oldPath, newPath) { var it = ST.manifest.items[oldPath]; if (it) { delete ST.manifest.items[oldPath]; ST.manifest.items[newPath] = it; saveManifest(); } }

  // ── clipboard (copy / cut / paste) ────────────────────────────────────────────────────────────
  function copySelection(cut) { var paths = Array.from(ST.sel); if (!paths.length) return; ST.clip = { op: cut ? "cut" : "copy", dir: ST.cwd, paths: paths, names: paths.map(function (p) { var n = nodeByPath(p); return n ? n.name : p.split("/").pop(); }) }; toast((cut ? "Cut " : "Copied ") + paths.length + " item" + (paths.length === 1 ? "" : "s")); }
  function paste() {
    var clip = ST.clip; if (!clip || !clip.names.length) return;
    var chain = Promise.resolve(), made = [];
    clip.names.forEach(function (nm) {
      chain = chain.then(function () {
        var src = joinPath(clip.dir, nm);
        if (clip.op === "cut") { return Promise.resolve(Files.moveHome(src, ST.cwd)).then(function () { made.push(nm); }).catch(function () {}); }
        var target = uniqueName(stripExt(nm), extOfName(nm));
        return Promise.resolve(Files.copyHome(src, ST.cwd, target)).then(function () { made.push(target); }).catch(function () {});
      });
    });
    chain.then(function () { if (clip.op === "cut") ST.clip = null; pushUndo({ type: "create", names: made }); return refresh(); }).then(function () { toast("Pasted " + made.length + " item" + (made.length === 1 ? "" : "s")); });
  }

  // ── delete → Trash (recoverable) + Undo ────────────────────────────────────────────────────────
  function deleteSelected() {
    var paths = Array.from(ST.sel); if (!paths.length) return;
    var entries = paths.map(function (p) { var n = nodeByPath(p); return n ? { name: n.name, path: p } : null; }).filter(Boolean);
    var chain = Promise.resolve(), trashed = [];
    entries.forEach(function (en) {
      chain = chain.then(function () {
        var tname = nameInTrashFor(en.name);
        return Promise.resolve(Files.moveHome(en.path, TRASH)).then(function () {
          if (tname !== en.name) return Promise.resolve(Files.rename(TRASH, en.name, tname));
        }).then(function () { trashed.push({ from: ST.cwd, orig: en.name, trash: tname }); delete ST.manifest.items[en.path]; }).catch(function () {});
      });
    });
    chain.then(function () { ST.sel = new Set(); pushUndo({ type: "trash", items: trashed }); return saveManifest(); }).then(refresh).then(function () { toast((trashed.length === 1 ? "“" + entries[0].name + "” moved" : trashed.length + " items moved") + " to Trash · ⌘Z to undo"); });
  }
  function nameInTrashFor(name) { return stripExt(name) + " " + nowId() + extOfName(name); }
  function pushUndo(op) { ST.undo.push(op); if (ST.undo.length > 25) ST.undo.shift(); }
  function undo() {
    var op = ST.undo.pop(); if (!op) { toast("Nothing to undo"); return; }
    if (op.type === "trash") {
      var chain = Promise.resolve();
      op.items.forEach(function (it) { chain = chain.then(function () { return Promise.resolve(Files.moveHome(joinPath(TRASH, it.trash), it.from)).then(function () { if (it.trash !== it.orig) return Promise.resolve(Files.rename(it.from, it.trash, it.orig)); }).catch(function () {}); }); });
      chain.then(refresh).then(function () { toast("Restored from Trash"); });
    } else if (op.type === "rename") {
      Promise.resolve(Files.rename(op.dir, op.from, op.to)).then(refresh).then(function () { toast("Rename undone"); }).catch(function () {});
    } else if (op.type === "create") {
      var chain2 = Promise.resolve();
      (op.names || []).forEach(function (nm) { chain2 = chain2.then(function () { return Promise.resolve(Files.remove(ST.cwd, nm)).catch(function () {}); }); });
      chain2.then(refresh).then(function () { toast("Undone"); });
    } else if (op.type === "move") {
      var chain3 = Promise.resolve();
      (op.items || []).forEach(function (it) { chain3 = chain3.then(function () { return Promise.resolve(Files.moveHome(joinPath(it.into, it.name), it.from)).catch(function () {}); }); });
      chain3.then(refresh).then(function () { toast("Move undone"); });
    }
  }

  // ── drag: arrange · group-move · NEST onto a folder ───────────────────────────────────────────
  function wireDrag(cell, node) {
    cell.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 || cell._editing) return;
      e.stopPropagation(); selectCell(node, e);
      if (e.ctrlKey || e.metaKey) return;
      startGroupDrag(e, cell, node);
    });
  }
  function startGroupDrag(e, originCell, originNode) {
    var group = Array.from(ST.sel).map(findCellByPath).filter(Boolean);
    if (group.indexOf(originCell) < 0) group = [originCell];
    var sx = e.clientX, sy = e.clientY, moved = false, dropTarget = null;
    var starts = group.map(function (c) { return { c: c, x: parseFloat(c.style.left) || 0, y: parseFloat(c.style.top) || 0 }; });
    try { originCell.setPointerCapture(e.pointerId); } catch (x) {}
    function move(ev) {
      var dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 5) return;
      moved = true;
      starts.forEach(function (s) { s.c.classList.add("dragging"); s.c.style.left = Math.max(4, s.x + dx) + "px"; s.c.style.top = Math.max(4, s.y + dy) + "px"; });
      group.forEach(function (g) { g.style.pointerEvents = "none"; });
      var under = DOC.elementFromPoint(ev.clientX, ev.clientY);
      group.forEach(function (g) { g.style.pointerEvents = ""; });
      var overCell = under && under.closest && under.closest(".holo-desk-icon");
      var tgt = (overCell && overCell._node && overCell._node.kind === "dir" && group.indexOf(overCell) < 0) ? overCell : null;
      if (tgt !== dropTarget) { if (dropTarget) dropTarget.classList.remove("drop-target"); dropTarget = tgt; if (tgt) tgt.classList.add("drop-target"); }
    }
    function up(ev) {
      originCell.removeEventListener("pointermove", move); originCell.removeEventListener("pointerup", up); originCell.removeEventListener("pointercancel", up);
      try { originCell.releasePointerCapture(ev.pointerId); } catch (x) {}
      group.forEach(function (g) { g.classList.remove("dragging"); });
      if (dropTarget) { var folderNode = dropTarget._node; dropTarget.classList.remove("drop-target"); if (!reducedMotion()) { dropTarget.classList.add("absorb"); setTimeout(function () { dropTarget.classList.remove("absorb"); }, 320); } moveIntoFolder(group.map(function (g) { return g._node; }), folderNode); return; }
      if (moved) { group.forEach(function (g) { savePos(g._node, parseFloat(g.style.left), parseFloat(g.style.top)); }); saveManifest(); }
    }
    originCell.addEventListener("pointermove", move); originCell.addEventListener("pointerup", up); originCell.addEventListener("pointercancel", up);
  }
  function savePos(node, x, y) { var it = ST.manifest.items[node.path] || (ST.manifest.items[node.path] = {}); it.pos = { x: Math.round(x), y: Math.round(y) }; }
  function moveIntoFolder(nodes, folderNode) {
    var chain = Promise.resolve(), moved = [];
    nodes.forEach(function (n) {
      if (!n || n.path === folderNode.path) return;
      chain = chain.then(function () {
        return Promise.resolve(Files.moveHome(n.path, folderNode.path)).then(function () {
          var it = ST.manifest.items[n.path]; if (it) { delete it.pos; delete ST.manifest.items[n.path]; ST.manifest.items[joinPath(folderNode.path, n.name)] = it; }
          moved.push({ name: n.name, from: ST.cwd, into: folderNode.path });
        }).catch(function () { toast("Could not move " + displayName(n)); });
      });
    });
    chain.then(function () { ST.sel = new Set(); pushUndo({ type: "move", items: moved }); return saveManifest(); }).then(refresh).then(function () { toast("Moved into " + folderNode.name + " · ⌘Z to undo"); });
  }

  // ── context menus ─────────────────────────────────────────────────────────────────────────────
  function closeMenu() { DOC.querySelectorAll(".holo-desk-menu, .holo-desk-submenu").forEach(function (m) { m.remove(); }); DOC.removeEventListener("pointerdown", onDocDown, true); }
  function onDocDown(e) { if (!e.target.closest(".holo-desk-menu") && !e.target.closest(".holo-desk-submenu")) closeMenu(); }
  function placeMenu(menu, x, y) {
    DOC.body.appendChild(menu);
    var r = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(x, (W.innerWidth || 1280) - r.width - 8)) + "px";
    menu.style.top = Math.max(8, Math.min(y, (W.innerHeight || 800) - r.height - 8)) + "px";
    setTimeout(function () { DOC.addEventListener("pointerdown", onDocDown, true); }, 0);
  }
  function mItem(label, fn, opts) {
    var b = el("button", Object.assign({ type: "button" }, opts || {}));
    b.appendChild(DOC.createTextNode(label));
    if (fn) b.addEventListener("click", function (e) { e.stopPropagation(); closeMenu(); fn(); });
    else b.setAttribute("disabled", "");
    return b;
  }
  function subMenuBtn(label, items) {
    var b = el("button", { type: "button", "class": "has-sub" });
    b.appendChild(DOC.createTextNode(label)); b.appendChild(el("span", { "class": "chev", text: "›" }));
    b.addEventListener("mouseenter", function () { openSub(b, items); });
    b.addEventListener("click", function (e) { e.stopPropagation(); openSub(b, items); });
    return b;
  }
  function openSub(parentBtn, items) {
    DOC.querySelectorAll(".holo-desk-submenu").forEach(function (m) { m.remove(); });
    parentBtn.classList.add("open");
    var sub = el("div", { "class": "holo-desk-menu holo-desk-submenu", role: "menu" });
    items.forEach(function (it) {
      var b = el("button", { type: "button" });
      if (it.icon) b.appendChild(holoIcon(DEFAULT_SET, it.icon));
      b.appendChild(DOC.createTextNode(it.label));
      b.addEventListener("click", function (e) { e.stopPropagation(); closeMenu(); it.fn && it.fn(); });
      sub.appendChild(b);
    });
    DOC.body.appendChild(sub);
    var r = parentBtn.getBoundingClientRect(), rw = sub.getBoundingClientRect();
    var left = r.right + 2; if (left + rw.width > (W.innerWidth || 1280) - 8) left = r.left - rw.width - 2;
    var top = r.top; if (top + rw.height > (W.innerHeight || 800) - 8) top = (W.innerHeight || 800) - rw.height - 8;
    sub.style.left = Math.max(8, left) + "px"; sub.style.top = Math.max(8, top) + "px";
  }
  function openDeskMenu(x, y) {
    closeMenu();
    var menu = el("div", { "class": "holo-desk-menu", role: "menu" });
    menu.appendChild(subMenuBtn("New", [
      { icon: "folder", label: "Folder", fn: newFolder },
      { icon: "file-text", label: "Text Document", fn: newTextDoc },
      { icon: "apps", label: "App shortcut…", fn: newAppShortcut },
      { icon: "link", label: "Pin by link or URL…", fn: pinByPrompt },
    ]));
    // editable holo-native widgets (clock · weather · tasks · focus · the vinyl disc · …) — open the
    // visual gallery for seamless discovery + one-click add, right from the desktop right-click.
    menu.appendChild(mItem("Add widget…", function () { try { (W.HoloWidgets && W.HoloWidgets.openGallery) ? W.HoloWidgets.openGallery() : toast("Holo Widgets unavailable"); } catch (e) {} }));
    if (ST.clip) menu.appendChild(mItem("Paste", function () { paste(); }));
    menu.appendChild(el("hr"));
    menu.appendChild(subMenuBtn("Change wallpaper", WALLPAPERS.map(function (w) { return { label: (ST.manifest.wallpaper === w.id ? "● " : "○ ") + w.name, fn: function () { setWallpaper(w.id); } }; })));
    menu.appendChild(mItem("Sort by name", function () { sortBy(); }));
    menu.appendChild(mItem("Refresh", function () { refresh(); }));
    menu.appendChild(el("hr"));
    menu.appendChild(mItem("Copy desktop κ", function () { copyDeskKappa(); }));
    menu.appendChild(mItem("Display settings…", function () { try { W.HoloTheme && W.HoloTheme.openSettings(); } catch (e) {} }));
    placeMenu(menu, x, y);
  }
  function openItemMenu(x, y, node) {
    closeMenu();
    var menu = el("div", { "class": "holo-desk-menu", role: "menu" });
    menu.appendChild(mItem(node.kind === "object" && node._url ? "Open link" : "Open", function () { openNode(node); }));
    if (node.kind !== "dir" && node.kind !== "app") menu.appendChild(mItem("Quick Look", function () { openQuickLook(node); }));
    if (node.kind === "app") {
      var pinned = dockPins().indexOf(node._appId) >= 0;
      menu.appendChild(mItem(pinned ? "Unpin from dock" : "Pin to dock", function () { try { pinned ? W.HoloDock.unpin(node._appId) : W.HoloDock.pin(node._appId); } catch (e) {} toast(pinned ? "Unpinned from the dock" : "Pinned to the dock"); }));
    }
    menu.appendChild(el("hr"));
    menu.appendChild(mItem("Copy", function () { copySelection(false); }));
    menu.appendChild(mItem("Cut", function () { copySelection(true); }));
    menu.appendChild(mItem("Copy holo:// link", function () { copyLink(node); }));
    menu.appendChild(el("hr"));
    menu.appendChild(mItem("Rename", function () { var c = findCellByPath(node.path); if (c) startInlineRename(c); }));
    menu.appendChild(mItem("Change icon…", function () { openPicker(node); }));
    menu.appendChild(mItem("Delete", function () { deleteSelected(); }));
    menu.appendChild(el("hr"));
    menu.appendChild(mItem("Properties", function () { openProps(node); }));
    placeMenu(menu, x, y);
  }
  function setWallpaper(id) { ST.manifest.wallpaper = id; applyWallpaper(); saveManifest(); }
  function sortBy() { ST.nodes.forEach(function (n) { var it = ST.manifest.items[n.path]; if (it) delete it.pos; }); saveManifest(); renderIcons(); }
  function pinByPrompt() { var s = W.prompt("Pin any object — paste a holo:// κ, did:holo, CID, or a URL:"); if (s && s.trim()) resolveDrop(s.trim()); }

  // ── κ everywhere: copy an object's link, and the WHOLE desktop as one address ──────────────────
  function clip(text, label) { try { (navigator.clipboard && navigator.clipboard.writeText) ? navigator.clipboard.writeText(text).then(function () { toast(label); }, function () { toast(text); }) : toast(text); } catch (e) { toast(text); } }
  function copyLink(node) {
    if (node._holo) return clip(node._holo, "Copied " + node._holo);
    if (node._oid) return clip(node._oid, "Copied " + node._oid);
    if (node.kind === "app" && node._appId) return clip("holospace.html?app=" + node._appId, "Copied app link");
    Promise.resolve(Files.verify(node)).then(function (v) { if (v && v.derived) clip("holo://" + v.derived, "Copied a verifiable link to this item"); else toast("No link available"); }).catch(function () { toast("No link available"); });
  }
  function copyDeskKappa() { sealedLayout().then(function (s) { clip("holo://" + hexOf(s.id), "Copied a link to your whole desktop layout"); }).catch(function () { toast("Could not copy desktop link"); }); }

  // ── icon picker ───────────────────────────────────────────────────────────────────────────────
  function openPicker(node) {
    closeMenu();
    if (!W.HoloIcons) return;
    var current = ST.manifest.items[node.path] && ST.manifest.items[node.path].icon;
    var scrim = el("div", { "class": "holo-desk-scrim" });
    var pick = el("div", { "class": "holo-desk-picker", role: "dialog", "aria-label": "Choose an icon" });
    var head = el("div", { "class": "pk-head" }, [el("div", { "class": "pk-title", text: "Choose an icon — " + displayName(node) })]);
    var close = el("button", { "class": "pk-close", "aria-label": "Close", text: "✕" }); close.addEventListener("click", function () { scrim.remove(); }); head.appendChild(close);
    var search = el("input", { "class": "pk-search", type: "search", placeholder: "Search icons…", spellcheck: "false" });
    var setSel = el("select", { "class": "pk-set", "aria-label": "Icon set" });
    var count = el("span", { "class": "pk-count" });
    var controls = el("div", { "class": "pk-controls" }, [search, setSel, count]);
    var grid = el("div", { "class": "pk-grid" });
    var kappa = el("div", { "class": "pk-kappa", text: "Each icon is its own verifiable object" });
    var def = el("button", { "class": "pk-btn ghost", type: "button", text: "Use default" });
    var apply = el("button", { "class": "pk-btn primary", type: "button", text: "Apply", disabled: "" });
    var foot = el("div", { "class": "pk-foot" }, [kappa, def, apply]);
    pick.appendChild(head); pick.appendChild(controls); pick.appendChild(grid); pick.appendChild(foot);
    scrim.appendChild(pick); DOC.body.appendChild(scrim);
    scrim.addEventListener("pointerdown", function (e) { if (e.target === scrim) scrim.remove(); });
    var prefix = (current && current.set) || DEFAULT_SET, allNames = [], chosen = current ? { set: current.set, name: current.name } : null;
    W.HoloIcons.sets().then(function (sets) {
      (sets || []).forEach(function (s) { var o = el("option", { value: s.prefix, text: s.name + (s.count ? " (" + s.count + ")" : "") }); if (s.prefix === prefix) o.selected = true; setSel.appendChild(o); });
      loadNames(prefix);
    });
    function loadNames(pfx) { prefix = pfx; count.textContent = "loading…"; grid.innerHTML = ""; W.HoloIcons.names(pfx).then(function (names) { allNames = names || []; renderGrid(); }); }
    function renderGrid() {
      var q = (search.value || "").trim().toLowerCase();
      var list = q ? allNames.filter(function (n) { return n.indexOf(q) >= 0; }) : allNames;
      var cap = 320, shown = list.slice(0, cap); grid.innerHTML = "";
      shown.forEach(function (nm) {
        var cell = el("button", { "class": "pk-cell", type: "button", title: nm });
        cell.appendChild(holoIcon(prefix, nm));
        if (chosen && chosen.set === prefix && chosen.name === nm) cell.classList.add("sel");
        cell.addEventListener("click", function () {
          grid.querySelectorAll(".pk-cell.sel").forEach(function (c) { c.classList.remove("sel"); });
          cell.classList.add("sel"); chosen = { set: prefix, name: nm }; apply.removeAttribute("disabled");
          kappa.textContent = "deriving κ…"; W.HoloIcons.kappa(prefix, nm).then(function (k) { kappa.textContent = prefix + ":" + nm + "  ·  " + (k || "—"); });
        });
        grid.appendChild(cell);
      });
      count.textContent = list.length + " icon" + (list.length === 1 ? "" : "s") + (list.length > cap ? " · showing " + cap : "");
    }
    search.addEventListener("input", renderGrid);
    setSel.addEventListener("change", function () { loadNames(setSel.value); });
    def.addEventListener("click", function () { assignIcon(node, null); scrim.remove(); });
    apply.addEventListener("click", function () { if (chosen) { W.HoloIcons.kappa(chosen.set, chosen.name).then(function (k) { assignIcon(node, { set: chosen.set, name: chosen.name, kappa: k || null }); }); scrim.remove(); } });
    setTimeout(function () { search.focus(); }, 30);
  }
  function assignIcon(node, icon) {
    var it = ST.manifest.items[node.path] || (ST.manifest.items[node.path] = {});
    if (icon) it.icon = icon; else delete it.icon;
    if (!it.icon && !it.pos) delete ST.manifest.items[node.path];
    saveManifest(); renderIcons(true);
  }

  // ── Quick Look (Space) — preview an object + its LIVE content address (Law L5) ─────────────────
  function openQuickLook(node) {
    closeMenu();
    var scrim = el("div", { "class": "holo-desk-scrim" });
    var card = el("div", { "class": "holo-desk-picker holo-desk-ql", role: "dialog", "aria-label": "Quick Look" });
    var head = el("div", { "class": "pk-head" }, [el("div", { "class": "pk-title", text: displayName(node) })]);
    var close = el("button", { "class": "pk-close", text: "✕" }); close.addEventListener("click", function () { scrim.remove(); }); head.appendChild(close);
    var body = el("div", { "class": "ql-body" });
    var foot = el("div", { "class": "ql-foot" }, [el("span", { "class": "pr-badge pend", text: "deriving κ…" })]);
    card.appendChild(head); card.appendChild(body); card.appendChild(foot);
    scrim.appendChild(card); DOC.body.appendChild(scrim);
    scrim.addEventListener("pointerdown", function (e) { if (e.target === scrim) scrim.remove(); });
    var esc = function (ev) { if (ev.key === "Escape" || ev.key === " ") { ev.preventDefault(); scrim.remove(); DOC.removeEventListener("keydown", esc, true); } };
    DOC.addEventListener("keydown", esc, true);

    if (node.kind === "object") { body.appendChild(el("div", { "class": "ql-meta", html: "<b>Object reference</b><br>" + esc2(node._oid || node._holo || node._url) })); }
    var kind = Files.kindOf ? Files.kindOf(node.name) : "file";
    Promise.resolve(Files.read(node, 2 * 1024 * 1024)).then(function (r) {
      if (kind === "image") { var u = URL.createObjectURL(new Blob([r.bytes], { type: r.mime || "image/png" })); body.appendChild(el("img", { "class": "ql-img", src: u })); }
      else if (/^(text|code|data|doc)$/.test(kind)) { var t = new TextDecoder().decode(r.bytes).slice(0, 4000); body.appendChild(el("pre", { "class": "ql-pre", text: t || "(empty)" })); }
      else if (node.kind !== "object") { body.appendChild(el("div", { "class": "ql-meta", text: (Files.fmtBytes ? Files.fmtBytes(r.size) : r.size + " B") + " · " + (r.mime || "binary") })); }
    }).catch(function () {});
    Promise.resolve(Files.verify(node)).then(function (v) {
      foot.innerHTML = "";
      if (v && v.derived) foot.appendChild(el("span", { "class": "pr-badge ok", text: "verified ✓" })), foot.appendChild(el("code", { "class": "ql-k", text: "did:holo:sha256:" + v.derived }));
      else foot.appendChild(el("span", { "class": "pr-badge no", text: "no content address" }));
    }).catch(function () { foot.innerHTML = ""; foot.appendChild(el("span", { "class": "pr-badge no", text: "unverifiable" })); });
  }
  function esc2(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }

  // ── properties ────────────────────────────────────────────────────────────────────────────────
  function openProps(node) {
    closeMenu();
    var scrim = el("div", { "class": "holo-desk-scrim" });
    var card = el("div", { "class": "holo-desk-picker holo-desk-props", role: "dialog" });
    var head = el("div", { "class": "pk-head" }, [el("div", { "class": "pk-title", text: displayName(node) })]);
    var close = el("button", { "class": "pk-close", text: "✕" }); close.addEventListener("click", function () { scrim.remove(); }); head.appendChild(close);
    var dl = el("dl");
    function rowEl(dt, ddHtml, cls) { var r = el("div", { "class": "pr-row" }, [el("dt", { text: dt }), el("dd", { "class": cls || "", html: ddHtml })]); dl.appendChild(r); return r; }
    rowEl("Type", esc2(node.kind === "dir" ? "Folder" : node.kind === "app" ? "App shortcut" : node.kind === "object" ? "Object pin" : (node.mime || (Files.mimeOf ? Files.mimeOf(node.name) : "file"))));
    rowEl("Path", esc2(node.path));
    if (node.kind === "app" && node._appId) rowEl("App", esc2(node._appId));
    if (node.kind === "object" && (node._oid || node._url)) rowEl("Reference", esc2(node._oid || node._url));
    if (node.bytes != null) rowEl("Size", esc2(Files.fmtBytes ? Files.fmtBytes(node.bytes) : node.bytes + " B"));
    var it = ST.manifest.items[node.path];
    if (it && it.icon) rowEl("Icon κ", esc2(it.icon.kappa || (it.icon.set + ":" + it.icon.name)));
    var kRow = rowEl("Content κ", "<span class='pr-badge pend'>deriving…</span>");
    card.appendChild(head); card.appendChild(dl);
    scrim.appendChild(card); DOC.body.appendChild(scrim);
    scrim.addEventListener("pointerdown", function (e) { if (e.target === scrim) scrim.remove(); });
    if (node.kind === "dir") { kRow.querySelector("dd").innerHTML = "<span class='pr-badge pend'>folder (container)</span>"; return; }
    Promise.resolve(Files.verify(node)).then(function (v) {
      var dd = kRow.querySelector("dd");
      if (v && v.derived) dd.innerHTML = "<span class='pr-badge ok'>verified ✓</span> did:holo:sha256:" + esc2(v.derived);
      else dd.innerHTML = "<span class='pr-badge no'>unverifiable</span>";
    }).catch(function () { kRow.querySelector("dd").innerHTML = "<span class='pr-badge no'>unverifiable</span>"; });
  }

  // ── keyboard (native nav · type-ahead · clipboard · undo · Quick Look) ─────────────────────────
  function onKey(e) {
    if (!ST.deskEl || isFramed() || editingActive()) return;
    var tag = (e.target && e.target.tagName) || "";
    if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
    var mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === "a" || e.key === "A")) { e.preventDefault(); ST.sel = new Set(ST.nodes.map(function (n) { return n.path; })); syncSel(); return; }
    if (mod && (e.key === "c" || e.key === "C")) { e.preventDefault(); copySelection(false); return; }
    if (mod && (e.key === "x" || e.key === "X")) { e.preventDefault(); copySelection(true); return; }
    if (mod && (e.key === "v" || e.key === "V")) { if (ST.clip) { e.preventDefault(); paste(); } return; }
    if (mod && (e.key === "z" || e.key === "Z")) { e.preventDefault(); undo(); return; }
    if (e.key === "F2" && ST.sel.size === 1) { var c = findCellByPath(Array.from(ST.sel)[0]); if (c) { e.preventDefault(); startInlineRename(c); } return; }
    if (e.key === "Delete" && ST.sel.size) { e.preventDefault(); deleteSelected(); return; }
    if (e.key === "Enter" && ST.sel.size === 1) { var n = nodeByPath(Array.from(ST.sel)[0]); if (n) { e.preventDefault(); openNode(n); } return; }
    if (e.key === " " && ST.sel.size === 1) { var nq = nodeByPath(Array.from(ST.sel)[0]); if (nq && nq.kind !== "dir") { e.preventDefault(); openQuickLook(nq); } return; }
    if (e.key === "Escape") { clearSel(); closeMenu(); return; }
    if (e.key === "F5") { e.preventDefault(); refresh(); return; }
    if (/^Arrow/.test(e.key)) { e.preventDefault(); moveSel(e.key); return; }
    if (e.key.length === 1 && !mod && !e.altKey) typeAhead(e.key);
  }
  function moveSel(key) {
    if (!ST.nodes.length) return;
    var cells = [].slice.call(ST.surfEl.querySelectorAll(".holo-desk-icon"));
    if (!cells.length) return;
    var curPath = Array.from(ST.sel)[0], cur = curPath ? findCellByPath(curPath) : null;
    if (!cur) { selectOnly(cells[0].getAttribute("data-path")); cells[0].scrollIntoView({ block: "nearest" }); return; }
    var cr = cur.getBoundingClientRect(), best = null, bestD = Infinity;
    cells.forEach(function (c) {
      if (c === cur) return; var r = c.getBoundingClientRect(), dx = r.left - cr.left, dy = r.top - cr.top;
      var ok = key === "ArrowRight" ? dx > 6 : key === "ArrowLeft" ? dx < -6 : key === "ArrowDown" ? dy > 6 : dy < -6;
      if (!ok) return; var d = dx * dx + dy * dy; if (d < bestD) { bestD = d; best = c; }
    });
    if (best) { selectOnly(best.getAttribute("data-path")); best.focus(); }
  }
  function typeAhead(ch) {
    var t = nowId(); if (t !== ST.typeAt) {} ST.typeBuf += ch.toLowerCase();
    clearTimeout(typeAhead._t); typeAhead._t = setTimeout(function () { ST.typeBuf = ""; }, 700);
    var hit = ST.nodes.find(function (n) { return displayName(n).toLowerCase().indexOf(ST.typeBuf) === 0; });
    if (hit) { selectOnly(hit.path); var c = findCellByPath(hit.path); if (c) c.scrollIntoView({ block: "nearest" }); }
  }

  function toast(m) { try { var t = DOC.getElementById("toast"); if (t) { t.textContent = m; t.style.display = "block"; clearTimeout(toast._t); toast._t = setTimeout(function () { t.style.display = "none"; }, 3200); return; } } catch (e) {} try { console.log("HoloDesk:", m); } catch (x) {} }

  // ── public API ────────────────────────────────────────────────────────────────────────────────
  W.HoloDesk = {
    refresh: refresh, newFolder: newFolder, newTextDoc: newTextDoc, open: openNode, navigate: navigateTo,
    setWallpaper: setWallpaper, manifest: function () { return ST.manifest; }, catalog: function () { return CATALOG; },
    addApp: function (idOrApp) { var app = typeof idOrApp === "string" ? CATALOG[idOrApp] : idOrApp; return app ? createShortcut(app) : Promise.resolve(); },
    pinObject: function (o) { return resolveDrop(typeof o === "string" ? o : (o && o.id) || ""); },
    pinApp: function (id) { try { W.HoloDock.pin(id); } catch (e) {} },
    moveInto: function (srcPaths, folderPath) { var ns = [].concat(srcPaths).map(function (p) { return nodeByPath(p) || { path: p, name: p.split("/").pop() }; }); return moveIntoFolder(ns, { path: folderPath, name: folderPath.split("/").pop(), kind: "dir" }); },
    copy: function () { copySelection(false); }, cut: function () { copySelection(true); }, paste: paste, undo: undo,
    quickLook: function (p) { var n = nodeByPath(p); if (n) openQuickLook(n); }, deskKappa: function () { return sealedLayout().then(function (s) { return "holo://" + hexOf(s.id); }); },
    importFiles: importFiles, trash: deleteSelected,
    show: function () { if (ST.deskEl) ST.deskEl.removeAttribute("hidden"); refresh(); },
    hide: function () { if (ST.deskEl) ST.deskEl.setAttribute("hidden", ""); },
    _state: ST,
  };

  if (DOC.readyState === "loading") DOC.addEventListener("DOMContentLoaded", start); else start();
})();
