// holo-dock.js — Holo Dock (ADR-0059): a native-feel dock for Hologram OS — and a live BUNDLE of objects.
//
// Drop-in:  <script src="_shared/holo-dock.js" defer></script>   (exposes window.HoloDock)
//
// The bar is a grouping of objects: each tile is an app/object reference, and any objects can be
// BUNDLED into a group (drag one onto another) that reads as a single stacked tile and opens into a
// flyout of its members; ungroup spreads them back out. Everything is an object — a group carries a
// content fingerprint over its members. It is OS chrome, built from existing engines, not a foreign
// runtime (ADR-0029): SHAPE = a zebar zpack placement; GLASS = TranslucentTB's accent model as the
// --holo-glass-* tokens; PROPORTION = the golden ratio (holo-phi); FEEL = the host OS (HoloPlatform);
// LAUNCHERS = the content-addressed app catalog. The editable content (pins/groups, glass, …) is a
// κ-object (holo-dock-config.json, /usr read-only) with a writable OPFS override (/home). Pure DOM +
// Web APIs, no framework, no CDN (Law L4) — every byte editable in the Holo Workspace IDE.

(function () {
  "use strict";
  var W = typeof window !== "undefined" ? window : globalThis;
  if (W.HoloDock) return;
  if (typeof document === "undefined") return;
  try { if (W.top !== W.self) return; } catch (e) { return; }   // top-level desktop chrome only

  var DOC = document, root = DOC.documentElement;

  // ── resolve our own location → siblings (css · config · platform · catalog · logo) ──
  var SELF = (DOC.currentScript && DOC.currentScript.src) ||
    (DOC.querySelector('script[src*="holo-dock.js"]') || {}).src ||
    new URL("_shared/holo-dock.js", location.href).href;
  var base = SELF.replace(/holo-dock\.js.*$/, "");                 // .../_shared/
  var ROOT = new URL("../", base).href;                           // the OS root (one level up from _shared/)
  var LOGO_URL = new URL("usr/share/icons/hologram-light.svg", ROOT).href;  // the Hologram mark (dark ink — reads on the light frosted dock)
  var CSS_URL = base + "holo-dock.css";
  var CONFIG_URL = base + "holo-dock-config.json";
  var PLATFORM_URL = base + "holo-platform.js";
  var CATALOG_URL = new URL("apps/index.jsonld", ROOT).href;
  var OPFS_NAME = "holo.dock.config.json";

  // ── helpers ──────────────────────────────────────────────────────────────────────────────────
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
  function letterIcon(name) {
    var ch = (name || "?").trim().charAt(0).toUpperCase() || "?";
    var svg = '<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="40" rx="9" fill="currentColor" opacity="0.16"/><text x="20" y="27" font-size="20" font-family="system-ui,sans-serif" text-anchor="middle" fill="currentColor">' + ch + "</text></svg>";
    return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
  }
  function actionBtn(label, svg, fn) {
    var b = el("button", { "class": "holo-dock-action", title: label, "aria-label": label, html: svg });
    b.addEventListener("click", fn);
    return b;
  }
  var HOME_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" fill="currentColor"><path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z"/></svg>';
  var LIB_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 5h7v14H4zM13 5h7v6h-7zM13 13h7v6h-7z"/></svg>';
  var NEW_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
  var KBD_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/></svg>';
  function dirOf(s) { var m = String(s || "").match(/([^\/]+)\/[^\/]*$/); return m ? m[1] : ""; }

  // ── the bundle model — a pin entry is an app id (string) OR a group {id,name,items:[id…]} ──
  function isGroup(e) { return e && typeof e === "object" && Array.isArray(e.items); }
  function entryKey(e) { return isGroup(e) ? e.id : e; }
  function gid() { return "g" + Math.random().toString(36).slice(2, 8); }
  function fnv(str) { var h = 0x811c9dc5; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 0x01000193) >>> 0; } return ("0000000" + h.toString(16)).slice(-8); }
  function groupFp(g) { return fnv((g.items || []).slice().sort().join(",")); }   // content fingerprint of the bundle

  // ── platform (the native feel) ─────────────────────────────────────────────────────────────
  function fallbackProfile() {
    var ua = String(navigator.userAgent || ""), os = "linux";
    if (/Windows/i.test(ua)) os = "windows";
    else if (/Android/i.test(ua)) os = "android";
    else if (/iPhone|iPod/i.test(ua)) os = "ios";
    else if (/iPad/i.test(ua)) os = "ipados";
    else if (/CrOS/i.test(ua)) os = "chromeos";
    else if (/Mac OS X|Macintosh/i.test(ua)) os = (navigator.maxTouchPoints || 0) > 1 ? "ipados" : "macos";
    var apple = os === "macos" || os === "ios" || os === "ipados";
    return { os: os, apple: apple, touch: (apple && os !== "macos") || /Mobi|Android/i.test(ua), mobile: /Mobi|Android|iPhone|iPad|iPod/i.test(ua) };
  }
  function detectPlatform() {
    if (W.HoloPlatform && W.HoloPlatform.profileFor) return Promise.resolve(W.HoloPlatform.profileFor(navigator));
    return import(PLATFORM_URL).then(function (m) {
      var fn = (m && (m.profileFor || (m.default && m.default.profileFor))) || (W.HoloPlatform && W.HoloPlatform.profileFor);
      return fn ? fn(navigator) : fallbackProfile();
    }).catch(function () { return fallbackProfile(); });
  }

  // ── config (default κ-object ⊕ OPFS user override) ───────────────────────────────────────────
  function loadDefault() { return fetch(CONFIG_URL, { cache: "no-store" }).then(function (r) { return r.json(); }).catch(function () { return null; }); }
  function loadOverride() {
    if (!(navigator.storage && navigator.storage.getDirectory)) return Promise.resolve({});
    return navigator.storage.getDirectory()
      .then(function (d) { return d.getFileHandle(OPFS_NAME); })
      .then(function (h) { return h.getFile(); })
      .then(function (f) { return f.text(); })
      .then(function (t) { return JSON.parse(t) || {}; })
      .catch(function () { return {}; });
  }
  function saveOverride(holo) {
    if (!(navigator.storage && navigator.storage.getDirectory)) return Promise.resolve();
    return navigator.storage.getDirectory()
      .then(function (d) { return d.getFileHandle(OPFS_NAME, { create: true }); })
      .then(function (h) { return h.createWritable(); })
      .then(function (w) { return Promise.resolve(w.write(JSON.stringify(holo, null, 2))).then(function () { return w.close(); }); })
      .catch(function () {});
  }

  // ── catalog (the launchers) ──────────────────────────────────────────────────────────────────
  function loadCatalog() {
    return fetch(CATALOG_URL, { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (j) {
      var apps = (j && j["dcat:dataset"]) || [], map = {};
      apps.forEach(function (a) {
        var id = a["schema:identifier"]; if (!id) return;
        var landing = a["dcat:landingPage"] || "";
        map[id] = {
          id: id, name: a["schema:name"] || id,
          icon: a["schema:image"] ? new URL(a["schema:image"], ROOT).href : null,
          landing: landing ? new URL(landing, ROOT).href : null,
          dir: dirOf(landing),
        };
      });
      return map;
    }).catch(function () { return {}; });
  }
  function appInfo(id) { return STATE.catalog[id] || { id: id, name: String(id).split(".").pop(), icon: null }; }
  function iconSrc(id) { var i = appInfo(id); return i.icon || letterIcon(i.name); }

  // ── shell adaptation (World/SDK vs Platform Manager) ───────────────────────────────────────────
  function inSdk() { return !!(W.__world && W.__world.launchById); }
  function isFullscreen() {
    try {
      if (DOC.fullscreenElement || DOC.webkitFullscreenElement) return true;
      if (W.matchMedia && W.matchMedia("(display-mode: fullscreen)").matches) return true;
    } catch (e) {}
    return false;
  }
  function orientNow() { return isFullscreen() ? "bottom" : "left"; }
  function frame() { return DOC.getElementById("holoframe"); }
  function hf() { return DOC.getElementById("hf-frame"); }
  function isFramed() { var f = frame(); return !!(f && f.classList.contains("open")); }
  function clickEl(id) { var e = DOC.getElementById(id); if (e) e.click(); }
  function sdkOpenSrcs() { try { return (W.__world.desktop.doc().world || []).filter(function (n) { return n.kind === "app"; }).map(function (n) { return n.src || ""; }); } catch (e) { return []; } }
  function currentAppId() {
    var i = hf(); if (!i || !isFramed()) return null;
    try { return new URL(i.src, location.href).searchParams.get("app"); } catch (e) { return null; }
  }
  function launch(id) {
    closeFlyout();
    if (inSdk()) { try { W.__world.launchById(id); } catch (e) {} setTimeout(updateRunning, 60); return; }
    var i = hf(), f = frame(); if (!i || !f) return;
    i.src = "holospace.html?app=" + encodeURIComponent(id);
    f.classList.add("open"); f.setAttribute("aria-hidden", "false");
    root.classList.add("framed");
    updateRunning();
  }
  function revealDesktop() {
    var i = hf(), f = frame(); if (!f) return;
    f.classList.remove("open"); f.setAttribute("aria-hidden", "true");
    root.classList.remove("framed");
    if (i) i.src = "about:blank";
    updateRunning();
  }
  function startAction() {
    if (inSdk()) { if (W.__world.openSpot) { try { W.__world.openSpot(); return; } catch (e) {} } clickEl("open"); return; }
    if (isFramed()) revealDesktop();
  }

  // ── state ────────────────────────────────────────────────────────────────────────────────────
  var STATE = { def: null, holo: null, catalog: {}, profile: null, orient: "left", renderedSdk: false };

  function effectiveHolo() {
    var base0 = (STATE.def && STATE.def.holo) || {};
    var ov = STATE.holo || {};
    var holo = Object.assign({}, base0, ov);
    holo.pins = (ov.pins || base0.pins || []).slice();
    if (!ov.glass && base0.glassByPlatform && STATE.profile && base0.glassByPlatform[STATE.profile.os]) holo.glass = base0.glassByPlatform[STATE.profile.os];
    return holo;
  }
  function persist() {
    STATE.holo = STATE.holo || {};
    var h = effectiveHolo();
    STATE.holo.pins = h.pins; STATE.holo.glass = h.glass; STATE.holo.magnify = h.magnify; STATE.holo.showClock = h.showClock; STATE.holo.showHome = h.showHome;
    return saveOverride(STATE.holo);
  }
  function setPins(pins) { STATE.holo = STATE.holo || {}; STATE.holo.pins = pins.slice(); render(); persist(); }
  function setGlass(g) { STATE.holo = STATE.holo || {}; STATE.holo.glass = g; if (dockEl) dockEl.setAttribute("data-glass", g); persist(); }

  // ── bundle / unbundle operations (the magic) ───────────────────────────────────────────────────
  function pins() { return effectiveHolo().pins; }
  function indexOfKey(arr, key) { for (var i = 0; i < arr.length; i++) if (entryKey(arr[i]) === key) return i; return -1; }
  function reorder(srcKey, dstKey, after) {
    var arr = pins(), si = indexOfKey(arr, srcKey); if (si < 0) return;
    var moved = arr.splice(si, 1)[0];
    var di = indexOfKey(arr, dstKey); if (di < 0) { arr.push(moved); return setPins(arr); }
    arr.splice(after ? di + 1 : di, 0, moved);
    setPins(arr);
  }
  // membersOf(entry) → flat list of app ids the entry contributes.
  function membersOf(e) { return isGroup(e) ? e.items.slice() : [e]; }
  function bundle(srcKey, dstKey) {
    if (srcKey === dstKey) return;
    var arr = pins(), si = indexOfKey(arr, srcKey), di = indexOfKey(arr, dstKey);
    if (si < 0 || di < 0) return;
    var src = arr[si], dst = arr[di];
    var items = membersOf(dst).concat(membersOf(src)).filter(function (v, i, a) { return a.indexOf(v) === i; });
    var group = isGroup(dst) ? Object.assign({}, dst, { items: items }) : { id: gid(), name: "Group", items: items };
    arr[di] = group;
    arr.splice(si, 1);                                   // remove the source (di shifts only if si<di; recompute via key)
    setPins(arr);
    // a little delight: pop the new group tile
    setTimeout(function () { var li = dockEl && dockEl.querySelector('[data-key="' + group.id + '"]'); if (li) { li.classList.add("just-bundled"); setTimeout(function () { li.classList.remove("just-bundled"); }, 420); } }, 20);
  }
  function ungroup(groupId) {
    var arr = pins(), i = indexOfKey(arr, groupId); if (i < 0 || !isGroup(arr[i])) return;
    var items = arr[i].items.slice();
    arr.splice.apply(arr, [i, 1].concat(items));         // spread members in place
    closeFlyout(); setPins(arr);
  }
  function addToGroup(groupId, appId) {
    var arr = pins(), gi = indexOfKey(arr, groupId); if (gi < 0 || !isGroup(arr[gi])) return;
    if (arr[gi].items.indexOf(appId) < 0) arr[gi] = Object.assign({}, arr[gi], { items: arr[gi].items.concat([appId]) });
    var ai = indexOfKey(arr, appId); if (ai >= 0) arr.splice(ai, 1);   // remove from top level if it was a sibling
    setPins(arr);
  }
  function removeFromGroup(groupId, appId) {
    var arr = pins(), gi = indexOfKey(arr, groupId); if (gi < 0 || !isGroup(arr[gi])) return;
    var rest = arr[gi].items.filter(function (x) { return x !== appId; });
    if (rest.length <= 1) { arr.splice.apply(arr, [gi, 1].concat(rest)); closeFlyout(); }   // dissolve to a single pin / nothing
    else arr[gi] = Object.assign({}, arr[gi], { items: rest });
    setPins(arr);
    if (openGroupId && openGroupId !== groupId) {} else if (rest.length > 1) reopenGroup(groupId);
  }
  function renameGroup(groupId, name) {
    var arr = pins(), i = indexOfKey(arr, groupId); if (i < 0 || !isGroup(arr[i])) return;
    arr[i] = Object.assign({}, arr[i], { name: name || "Group" }); setPins(arr);
  }
  function groupById(id) { var arr = pins(), i = indexOfKey(arr, id); return i >= 0 && isGroup(arr[i]) ? arr[i] : null; }

  // ── magnify + glass policy ─────────────────────────────────────────────────────────────────────
  function wantsMagnify(holo) {
    if (holo.magnify === false) return false;
    var p = STATE.profile || {};
    if (!p.apple || p.touch) return false;
    if (root.getAttribute("data-holo-tier") === "lean") return false;
    if (root.getAttribute("data-holo-motion") === "reduced") return false;
    try { if (W.matchMedia && W.matchMedia("(prefers-reduced-motion: reduce)").matches) return false; } catch (e) {}
    return true;
  }

  // ── render ────────────────────────────────────────────────────────────────────────────────────
  var dockEl = null, ro = null;
  function render() {
    closeFlyout();                                      // a flyout is anchored to the old dock — rebuild fresh
    var holo = effectiveHolo();
    var prev = DOC.getElementById("holo-dock");
    var wasReady = prev && prev.classList.contains("ready");
    var dock = el("nav", { id: "holo-dock", "class": "holo-dense" + (wasReady ? " ready" : ""), "aria-label": "Dock", "data-glass": holo.glass || "blur" });
    STATE.orient = orientNow();
    dock.setAttribute("data-orient", STATE.orient);
    if (wantsMagnify(holo)) dock.classList.add("holo-dock--magnify");
    var inner = el("div", { "class": "holo-dock-inner" });

    var sdk = inSdk();
    STATE.renderedSdk = sdk;
    if (holo.showHome !== false) {
      var startLabel = sdk ? "Open holospace" : "Show desktop";
      var logoImg = el("img", { "class": "holo-dock-icon holo-dock-logo", src: LOGO_URL, alt: "Hologram", draggable: "false" });
      logoImg.addEventListener("error", function () { var s = el("span", { "class": "holo-dock-icon", html: HOME_SVG }); if (this.parentNode) this.parentNode.replaceChild(s, this); });
      var home = el("button", { "class": "holo-dock-tile holo-dock-home", title: startLabel, "aria-label": startLabel }, [logoImg]);
      home.addEventListener("click", startAction);
      inner.appendChild(home);
    }

    var list = el("ol", { "class": "holo-dock-items" });
    (holo.pins || []).forEach(function (entry) { list.appendChild(isGroup(entry) ? groupTile(entry) : item(entry)); });
    inner.appendChild(list);

    inner.appendChild(el("span", { "class": "holo-dock-sep" }));

    var tray = el("div", { "class": "holo-dock-tray" });
    if (sdk) {
      var actions = el("div", { "class": "holo-dock-actions" });
      actions.appendChild(actionBtn("Component library", LIB_SVG, function () { clickEl("library"); }));
      actions.appendChild(actionBtn("New component", NEW_SVG, function () { clickEl("author"); }));
      actions.appendChild(actionBtn("Virtual keyboard", KBD_SVG, function () { clickEl("keyboard-btn"); }));
      tray.appendChild(actions);
    }
    var add = el("button", { "class": "holo-dock-add", title: "Add an app", "aria-label": "Add an app", text: "+" });
    add.addEventListener("click", function (e) { openAddMenu(e); });
    tray.appendChild(add);
    if (holo.showClock !== false) { var clock = el("time", { "class": "holo-dock-clock" }); tray.appendChild(clock); }
    inner.appendChild(tray);

    dock.appendChild(inner);
    if (prev) prev.replaceWith(dock); else DOC.body.appendChild(dock);
    dockEl = dock;
    wireDrag(list);
    tick();
    updateRunning();
    measure();
    requestAnimationFrame(measure);
    if (W.ResizeObserver) { try { if (ro) ro.disconnect(); ro = new ResizeObserver(measure); ro.observe(inner); } catch (e) {} }
  }

  // single object tile
  function item(id) {
    var info = appInfo(id);
    var li = el("li", { "class": "holo-dock-item", "data-app": id, "data-key": id, draggable: "true" });
    var img = el("img", { "class": "holo-dock-icon", src: iconSrc(id), alt: "", draggable: "false" });
    img.addEventListener("error", function () { this.src = letterIcon(info.name); });
    var tile = el("button", { "class": "holo-dock-tile", title: info.name, "aria-label": info.name }, [img]);
    tile.addEventListener("click", function (e) { if (ctrlMenu(e, function () { openItemMenu(e, id); })) return; launch(id); });
    li.appendChild(tile);
    li.appendChild(el("span", { "class": "holo-dock-dot" }));
    li.appendChild(el("span", { "class": "holo-dock-label", text: info.name }));
    li.addEventListener("contextmenu", function (e) { e.preventDefault(); openItemMenu(e, id); });
    bindLongPress(li, function (e) { openItemMenu(e, id); });
    return li;
  }

  // group (bundle) tile — a 2×2 stack of the first members; opens a flyout
  function groupTile(group) {
    var li = el("li", { "class": "holo-dock-item holo-dock-group", "data-key": group.id, "data-group": group.id, draggable: "true" });
    var grid = el("span", { "class": "holo-dock-stack" });
    group.items.slice(0, 4).forEach(function (mid) { grid.appendChild(el("img", { "class": "holo-dock-mini", src: iconSrc(mid), alt: "", draggable: "false" })); });
    var n = group.items.length;
    var tile = el("button", { "class": "holo-dock-tile holo-dock-stack-tile", title: group.name + " · " + n + " items", "aria-label": group.name }, [grid]);
    if (n > 4) tile.appendChild(el("span", { "class": "holo-dock-stack-more", text: "+" + (n - 4) }));
    tile.addEventListener("click", function (e) { if (ctrlMenu(e, function () { openGroupMenu(e, group.id); })) return; toggleGroup(group.id, li); });
    li.appendChild(tile);
    li.appendChild(el("span", { "class": "holo-dock-dot" }));
    li.appendChild(el("span", { "class": "holo-dock-label", text: group.name }));
    li.addEventListener("contextmenu", function (e) { e.preventDefault(); openGroupMenu(e, group.id); });
    bindLongPress(li, function (e) { openGroupMenu(e, group.id); });
    return li;
  }
  function ctrlMenu(e, openFn) { if (STATE.profile && STATE.profile.apple && e.ctrlKey) { e.preventDefault(); e.stopImmediatePropagation(); openFn(); return true; } return false; }

  function updateRunning() {
    if (!dockEl) return;
    if (inSdk() !== STATE.renderedSdk) { render(); return; }
    var run = {};
    if (inSdk()) { var dirs = sdkOpenSrcs().map(dirOf); Object.keys(STATE.catalog).forEach(function (id) { var i = STATE.catalog[id]; if (i.dir && dirs.indexOf(i.dir) >= 0) run[id] = 1; }); }
    else { var cur = currentAppId(); if (cur) run[cur] = 1; }
    dockEl.querySelectorAll(".holo-dock-item").forEach(function (li) {
      var running = false;
      if (li.getAttribute("data-app")) running = !!run[li.getAttribute("data-app")];
      else if (li.getAttribute("data-group")) { var g = groupById(li.getAttribute("data-group")); running = !!(g && g.items.some(function (m) { return run[m]; })); }
      if (running) li.setAttribute("data-running", ""); else li.removeAttribute("data-running");
    });
    var fly = DOC.querySelector(".holo-dock-flyout");
    if (fly) fly.querySelectorAll(".holo-dock-item[data-app]").forEach(function (li) { if (run[li.getAttribute("data-app")]) li.setAttribute("data-running", ""); else li.removeAttribute("data-running"); });
  }

  // ── clock ────────────────────────────────────────────────────────────────────────────────────
  var clockFmt = null;
  function tick() {
    var c = dockEl && dockEl.querySelector(".holo-dock-clock"); if (!c) return;
    try { clockFmt = clockFmt || new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }); c.textContent = clockFmt.format(new Date()); }
    catch (e) { c.textContent = ""; }
  }

  // ── measure (publish --holo-dock-h/w so other chrome clears the bar) ───────────────────────────
  function measure() {
    var inner = dockEl && dockEl.querySelector(".holo-dock-inner");
    var rect = inner ? inner.getBoundingClientRect() : { width: 0, height: 0 };
    if (STATE.orient === "left") {
      root.style.setProperty("--holo-dock-w", Math.round(rect.width) + "px");
      root.style.setProperty("--holo-dock-h", "0px");
    } else {
      var p = STATE.profile || {}, floating = p.os === "macos" || p.os === "ipados";
      root.style.setProperty("--holo-dock-h", Math.round(floating ? 0 : rect.height) + "px");
      root.style.setProperty("--holo-dock-w", "0px");
    }
  }
  function reorient() { if (!dockEl) return; var o = orientNow(); if (o !== STATE.orient) { STATE.orient = o; dockEl.setAttribute("data-orient", o); } measure(); }
  function reveal() { if (dockEl) { measure(); requestAnimationFrame(function () { if (dockEl) dockEl.classList.add("ready"); }); } }

  // ── drag: reorder at the edges, BUNDLE at the center (the iOS-home gesture) ─────────────────────
  function wireDrag(list) {
    var dragKey = null;
    function clear() { list.querySelectorAll(".holo-dock-item").forEach(function (n) { n.classList.remove("drop-before", "drop-after", "merge-target"); }); }
    list.addEventListener("dragstart", function (e) {
      var li = e.target.closest(".holo-dock-item"); if (!li) return;
      dragKey = li.getAttribute("data-key"); li.classList.add("dragging");
      try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", dragKey); } catch (x) {}
    });
    list.addEventListener("dragend", function () { dragKey = null; list.querySelectorAll(".holo-dock-item").forEach(function (n) { n.classList.remove("dragging"); }); clear(); });
    list.addEventListener("dragover", function (e) {
      e.preventDefault();
      var li = e.target.closest(".holo-dock-item"); if (!li || li.getAttribute("data-key") === dragKey) { clear(); return; }
      clear();
      var r = li.getBoundingClientRect();
      var vertical = STATE.orient === "left";
      var frac = vertical ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
      if (frac > 0.32 && frac < 0.68) li.classList.add("merge-target");        // center → bundle
      else li.classList.add((frac >= 0.68) ? "drop-after" : "drop-before");    // edge → reorder
    });
    list.addEventListener("drop", function (e) {
      e.preventDefault();
      var li = e.target.closest(".holo-dock-item"); if (!li || !dragKey) { clear(); return; }
      var dstKey = li.getAttribute("data-key"); if (dstKey === dragKey) { clear(); return; }
      if (li.classList.contains("merge-target")) bundle(dragKey, dstKey);
      else { var r = li.getBoundingClientRect(), vertical = STATE.orient === "left"; var frac = vertical ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width; reorder(dragKey, dstKey, frac >= 0.5); }
      clear();
    });
  }

  // ── long-press (touch menus) ───────────────────────────────────────────────────────────────────
  function bindLongPress(node, cb) {
    var t = null, sx = 0, sy = 0;
    node.addEventListener("touchstart", function (e) { var p = e.touches[0]; sx = p.clientX; sy = p.clientY; t = setTimeout(function () { cb({ clientX: sx, clientY: sy, preventDefault: function () {} }); }, 480); }, { passive: true });
    function cancel() { if (t) { clearTimeout(t); t = null; } }
    node.addEventListener("touchend", cancel); node.addEventListener("touchcancel", cancel);
    node.addEventListener("touchmove", function (e) { var p = e.touches[0]; if (Math.abs(p.clientX - sx) > 10 || Math.abs(p.clientY - sy) > 10) cancel(); }, { passive: true });
  }

  // ── group flyout (open a bundle into its members) ──────────────────────────────────────────────
  var openGroupId = null;
  function closeFlyout() { var f = DOC.querySelector(".holo-dock-flyout"); if (f) f.remove(); openGroupId = null; DOC.removeEventListener("pointerdown", onFlyDown, true); if (dockEl) dockEl.querySelectorAll(".holo-dock-group.open").forEach(function (n) { n.classList.remove("open"); }); }
  function onFlyDown(e) { if (!e.target.closest(".holo-dock-flyout") && !e.target.closest(".holo-dock-group")) closeFlyout(); }
  function toggleGroup(id, li) { if (openGroupId === id) { closeFlyout(); return; } openGroup(id, li); }
  function reopenGroup(id) { var li = dockEl && dockEl.querySelector('[data-group="' + id + '"]'); if (li) openGroup(id, li); }
  function openGroup(id, li) {
    closeMenu(); closeFlyout();
    var g = groupById(id); if (!g) return;
    openGroupId = id; if (li) li.classList.add("open");
    var fly = el("div", { "class": "holo-dock-flyout", role: "menu" });
    var head = el("div", { "class": "holo-dock-fly-head" });
    var title = el("input", { "class": "holo-dock-fly-name", value: g.name, "aria-label": "Group name", spellcheck: "false" });
    title.addEventListener("change", function () { renameGroup(id, title.value.trim() || "Group"); });
    title.addEventListener("keydown", function (e) { if (e.key === "Enter") this.blur(); });
    head.appendChild(title);
    head.appendChild(el("span", { "class": "holo-dock-fly-k", title: "the bundle's content fingerprint — everything is an object", text: "holo://" + groupFp(g) }));
    fly.appendChild(head);
    var grid = el("div", { "class": "holo-dock-fly-grid" });
    g.items.forEach(function (mid) {
      var info = appInfo(mid);
      var m = el("div", { "class": "holo-dock-item", "data-app": mid, title: info.name });
      var img = el("img", { "class": "holo-dock-icon", src: iconSrc(mid), alt: "", draggable: "false" });
      img.addEventListener("error", function () { this.src = letterIcon(info.name); });
      var t = el("button", { "class": "holo-dock-tile", "aria-label": info.name }, [img]);
      t.addEventListener("click", function () { launch(mid); });
      m.appendChild(t); m.appendChild(el("span", { "class": "holo-dock-dot" }));
      m.appendChild(el("span", { "class": "holo-dock-fly-label", text: info.name }));
      m.addEventListener("contextmenu", function (e) { e.preventDefault(); memberMenu(e, id, mid); });
      grid.appendChild(m);
    });
    // an "add" cell to bundle more into the group
    var addCell = el("button", { "class": "holo-dock-tile holo-dock-fly-add", title: "Add to group", text: "+" });
    addCell.addEventListener("click", function (e) { openAddMenu(e, id); });
    grid.appendChild(addCell);
    fly.appendChild(grid);
    var foot = el("div", { "class": "holo-dock-fly-foot" });
    foot.appendChild(mbtnPlain("Ungroup", function () { ungroup(id); }));
    fly.appendChild(foot);

    DOC.body.appendChild(fly);
    positionFly(fly, li);
    updateRunning();
    setTimeout(function () { DOC.addEventListener("pointerdown", onFlyDown, true); }, 0);
  }
  function positionFly(fly, li) {
    var r = li ? li.getBoundingClientRect() : { left: 60, top: 80, right: 60, bottom: 120 };
    var fr = fly.getBoundingClientRect();
    var vertical = STATE.orient === "left";
    var x, y;
    if (vertical) { x = r.right + 10; y = Math.min(Math.max(8, r.top + r.height / 2 - fr.height / 2), W.innerHeight - fr.height - 8); }
    else { y = r.top - fr.height - 10; x = Math.min(Math.max(8, r.left + r.width / 2 - fr.width / 2), W.innerWidth - fr.width - 8); }
    fly.style.left = Math.max(8, x) + "px"; fly.style.top = Math.max(8, y) + "px";
  }
  function mbtnPlain(label, fn) { var b = el("button", { type: "button", text: label }); b.addEventListener("click", function () { fn(); }); return b; }

  // ── menus ────────────────────────────────────────────────────────────────────────────────────
  function closeMenu() { var m = DOC.querySelector(".holo-dock-menu"); if (m) m.remove(); DOC.removeEventListener("pointerdown", onDocDown, true); }
  function onDocDown(e) { if (!e.target.closest(".holo-dock-menu")) closeMenu(); }
  function placeMenu(menu, x, y) {
    DOC.body.appendChild(menu);
    var r = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(x, W.innerWidth - r.width - 8)) + "px";
    menu.style.top = Math.max(8, Math.min(y, W.innerHeight - r.height - 8)) + "px";
    if (y > W.innerHeight - r.height - 16) menu.style.top = Math.max(8, y - r.height) + "px";
    setTimeout(function () { DOC.addEventListener("pointerdown", onDocDown, true); }, 0);
  }
  function mbtn(label, fn, opts) { var b = el("button", Object.assign({ type: "button", text: label }, opts || {})); b.addEventListener("click", function () { closeMenu(); fn(); }); return b; }
  function openItemMenu(e, id) {
    closeMenu();
    var info = appInfo(id), arr = pins(), isPinned = indexOfKey(arr, id) >= 0;
    var menu = el("div", { "class": "holo-dock-menu", role: "menu" }, [el("div", { "class": "holo-dock-menu-head", text: info.name })]);
    menu.appendChild(mbtn("Open", function () { launch(id); }));
    // bundle this with another pinned object
    var others = arr.filter(function (en) { return entryKey(en) !== id; });
    if (others.length) {
      menu.appendChild(el("hr"));
      menu.appendChild(el("div", { "class": "holo-dock-menu-head", text: "Bundle with…" }));
      others.slice(0, 8).forEach(function (en) {
        var label = isGroup(en) ? (en.name + " ▸") : appInfo(en).name;
        menu.appendChild(mbtn(label, function () { isGroup(en) ? addToGroup(en.id, id) : bundle(id, en); }));
      });
    }
    menu.appendChild(el("hr"));
    if (isPinned) menu.appendChild(mbtn("Remove from dock", function () { setPins(arr.filter(function (x) { return entryKey(x) !== id; })); }));
    else menu.appendChild(mbtn("Pin to dock", function () { setPins(arr.concat([id])); }));
    menu.appendChild(el("hr"));
    menu.appendChild(el("div", { "class": "holo-dock-menu-head", text: "Glass" }));
    ["opaque", "clear", "blur", "acrylic"].forEach(function (gl) { menu.appendChild(mbtn((effectiveHolo().glass === gl ? "● " : "○ ") + gl, function () { setGlass(gl); })); });
    placeMenu(menu, e.clientX, e.clientY);
  }
  function openGroupMenu(e, id) {
    closeMenu(); var g = groupById(id); if (!g) return;
    var menu = el("div", { "class": "holo-dock-menu", role: "menu" }, [el("div", { "class": "holo-dock-menu-head", text: g.name + " · holo://" + groupFp(g) })]);
    menu.appendChild(mbtn("Open group", function () { reopenGroup(id); }));
    menu.appendChild(mbtn("Add to group…", function () { openAddMenu(e, id); }));
    menu.appendChild(mbtn("Ungroup", function () { ungroup(id); }));
    menu.appendChild(el("hr"));
    menu.appendChild(mbtn("Remove from dock", function () { setPins(pins().filter(function (x) { return entryKey(x) !== id; })); }));
    placeMenu(menu, e.clientX, e.clientY);
  }
  function memberMenu(e, groupId, appId) {
    closeMenu(); var info = appInfo(appId);
    var menu = el("div", { "class": "holo-dock-menu", role: "menu" }, [el("div", { "class": "holo-dock-menu-head", text: info.name })]);
    menu.appendChild(mbtn("Open", function () { launch(appId); }));
    menu.appendChild(mbtn("Take out of group", function () { removeFromGroup(groupId, appId); }));
    placeMenu(menu, e.clientX, e.clientY);
  }
  // openAddMenu(e[, groupId]) — pick an app to pin, or to add into a group.
  function openAddMenu(e, groupId) {
    closeMenu();
    var arr = pins();
    var pinned = {}; arr.forEach(function (en) { membersOf(en).forEach(function (m) { pinned[m] = 1; }); });
    var ids = Object.keys(STATE.catalog).filter(function (id) { return !pinned[id]; }).sort(function (a, b) { return (STATE.catalog[a].name || "").localeCompare(STATE.catalog[b].name || ""); });
    var menu = el("div", { "class": "holo-dock-menu", role: "menu" }, [el("div", { "class": "holo-dock-menu-head", text: groupId ? "Add to group" : (ids.length ? "Add an app" : "All apps are pinned") })]);
    ids.slice(0, 28).forEach(function (id) {
      var info = STATE.catalog[id];
      var b = mbtn(info.name, function () { groupId ? addToGroup(groupId, id) : setPins(pins().concat([id])); if (groupId) reopenGroup(groupId); });
      b.insertBefore(el("img", { src: info.icon || letterIcon(info.name), alt: "", width: "18", height: "18", style: "border-radius:5px" }), b.firstChild);
      menu.appendChild(b);
    });
    var r = e && e.currentTarget && e.currentTarget.getBoundingClientRect ? e.currentTarget.getBoundingClientRect() : { left: (e && e.clientX) || 60, top: (e && e.clientY) || 60 };
    placeMenu(menu, r.left, r.top);
  }

  // ── boot ──────────────────────────────────────────────────────────────────────────────────────
  function ensureCss() { if (!DOC.querySelector('link[href*="holo-dock.css"]')) { var l = DOC.createElement("link"); l.rel = "stylesheet"; l.href = CSS_URL; (DOC.head || root).appendChild(l); } }
  function waitForShell(ms) {
    // On the World/SDK desktop, wait briefly for window.__world so the FIRST render already includes
    // the SDK actions — no visible re-render/resize jerk on load. Elsewhere, resolve immediately.
    var likelySdk = /\/apps\/sdk\b/.test(location.pathname) || !!W.__world;
    if (!likelySdk || W.__worldReady) return Promise.resolve();
    return new Promise(function (res) { var t0 = Date.now(); var iv = setInterval(function () { if (W.__worldReady || inSdk() || Date.now() - t0 > ms) { clearInterval(iv); res(); } }, 40); });
  }

  var clockTimer = null, runTimer = null;
  function start() {
    ensureCss();
    Promise.all([loadDefault(), loadOverride(), loadCatalog(), detectPlatform()]).then(function (res) {
      STATE.def = res[0] || { holo: { pins: [], glass: "acrylic", magnify: true, showClock: true, showHome: true } };
      STATE.holo = res[1] || {};
      STATE.catalog = res[2] || {};
      STATE.profile = res[3] || fallbackProfile();
      root.setAttribute("data-holo-platform", STATE.profile.os);
      if (STATE.profile.apple) root.setAttribute("data-holo-apple", "");
      if (STATE.profile.touch) root.setAttribute("data-holo-touch", "");
      return waitForShell(900);
    }).then(function () {
      render();          // hidden (no .ready) — fades in once stable to avoid any load reflow being seen
      reveal();
      clockTimer = setInterval(tick, 15000);
      runTimer = setInterval(updateRunning, 700);
      W.addEventListener("resize", reorient);
      DOC.addEventListener("fullscreenchange", reorient);
      DOC.addEventListener("webkitfullscreenchange", reorient);
      try { var mq = W.matchMedia("(display-mode: fullscreen)"); mq.addEventListener ? mq.addEventListener("change", reorient) : mq.addListener(reorient); } catch (e) {}
      W.addEventListener("keydown", function (e) { if (e.key === "Escape") { closeMenu(); closeFlyout(); } });
    });
  }
  if (DOC.readyState === "loading") DOC.addEventListener("DOMContentLoaded", start); else start();

  // ── public API (scriptable + IDE-inspectable) ────────────────────────────────────────────────
  W.HoloDock = {
    version: "0.2",
    pin: function (id) { if (indexOfKey(pins(), id) < 0) setPins(pins().concat([id])); },
    unpin: function (id) { setPins(pins().filter(function (x) { return entryKey(x) !== id; })); },
    remove: function (id) { setPins(pins().filter(function (x) { return entryKey(x) !== id; })); },
    setPins: setPins, setGlass: setGlass,
    bundle: bundle, ungroup: ungroup, addToGroup: addToGroup, removeFromGroup: removeFromGroup,
    launch: launch, revealDesktop: revealDesktop,
    config: function () { return { default: STATE.def, override: STATE.holo, effective: effectiveHolo(), profile: STATE.profile }; },
    refresh: render,
  };
})();
