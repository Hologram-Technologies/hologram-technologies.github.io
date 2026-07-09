/* holo-discord-proxy.js — SERVERLESS URL-mapping proxy for the Discord Activity host.
 *
 * WHY. A Discord Activity is a sandboxed iframe served from <app>.discordsays.com. Every
 * external origin an app reaches must be routed through Discord's proxy under a URL-Mapping
 * prefix declared in the Developer Portal, or the request is CSP-refused — and a top-level
 * navigation to a disallowed origin CLOSES the activity. The Embedded App SDK ships
 * `patchUrlMappings` for exactly this, but our vendored SDK tree-shook it away. This is the
 * self-contained equivalent, with two deliberate properties the SDK helper lacks:
 *   • it also rewrites the src/poster of <img>/<video>/<source> (the SDK only touches
 *     fetch/XHR/WebSocket — but Holo TV loads posters + streams as element attributes), and
 *   • it is a CLASSIC (non-module) script so it runs BEFORE any app module and patches the
 *     globals before the first request fires.
 *
 * OFF-DISCORD IT IS A STRICT NO-OP — the open-web build (hologram-technologies.github.io/Q)
 * is byte-for-byte unaffected. Load it as the first <script> in <head> of any holospace that
 * reaches external hosts (Holo TV / Holo Video); sub-apps open as same-origin iframes, so
 * each carries its own copy.
 *
 * ONE SOURCE OF TRUTH: the MAP below MUST mirror, entry-for-entry, the Discord Developer
 * Portal → Activities → URL Mappings table (prefix → target host). Drift = a dead host.
 */
(function () {
  "use strict";

  var host = "";
  try { host = location.hostname || ""; } catch (e) {}
  // Gate on the sandbox origin. A sub-app iframe inside the Activity is itself on
  // *.discordsays.com, so this fires there too. Anywhere else → return, patch nothing.
  if (!/(^|\.)discordsays\.com$/i.test(host)) return;
  if (window.__holoProxyInstalled) return;
  window.__holoProxyInstalled = true;

  // host → proxy prefix. MIRROR EXACTLY in the Developer Portal URL Mappings.
  //   Root  "/"   → hologram-technologies.github.io/Q   (serves the whole shell + all apps)
  //   "/hf"       → huggingface.co                       (Q brain weights — already present)
  // The "/px/*" rows below are what this change adds — every host Holo TV / Holo Video reach.
  var MAP = [
    ["huggingface.co",         "/hf"],
    ["test-streams.mux.dev",   "/px/mux"],       // Holo TV — HLS demo streams
    ["dash.akamaized.net",     "/px/akamai"],    // Holo TV — DASH demo streams
    ["storage.googleapis.com", "/px/gcs"],       // Holo TV — HLS/DASH demo streams (Shaka assets)
    ["upload.wikimedia.org",   "/px/wikimedia"], // Holo TV — WebM demo streams
    ["commons.wikimedia.org",  "/px/wmcommons"], // Holo TV — media pages / stills
    ["i.ytimg.com",            "/px/ytimg"],      // Holo TV — poster thumbnails
    ["image.tmdb.org",         "/px/tmdbimg"],    // Holo TV — posters + backdrops
    ["api.themoviedb.org",     "/px/tmdbapi"],    // Holo TV — discovery metadata
    ["images.metahub.space",   "/px/metahub"],    // Holo TV — Stremio/Cinemeta art
    ["archive.org",            "/px/ia"]          // Holo TV — Internet Archive playback
  ];

  // rewrite(input) → a same-origin proxy path when `input` names a mapped external host,
  // else `input` unchanged. Idempotent: an already-rewritten "/px/…" path is root-relative
  // (starts with a single "/") and is returned as-is, so double-patching is safe.
  function rewrite(input) {
    if (input == null) return input;
    var s = String(input);
    if (s.charAt(0) === "/" && s.charAt(1) !== "/") return input;   // relative / already-proxied
    var u;
    try { u = new URL(s, location.href); } catch (e) { return input; }
    if (/(^|\.)discordsays\.com$/i.test(u.hostname)) return input;   // already same-origin
    for (var i = 0; i < MAP.length; i++) {
      if (u.hostname === MAP[i][0]) return MAP[i][1] + u.pathname + u.search + u.hash;
    }
    return input;   // unmapped host — leave it (Discord will refuse; that surfaces the gap honestly)
  }

  // 1) fetch ------------------------------------------------------------------------------
  var _fetch = window.fetch;
  if (_fetch) {
    window.fetch = function (input, init) {
      try {
        if (typeof input === "string") input = rewrite(input);
        else if (input && input.url) {
          var r = rewrite(input.url);
          if (r !== input.url) input = new Request(r, input);
        }
      } catch (e) {}
      return _fetch.call(this, input, init);
    };
  }

  // 2) XMLHttpRequest (video.js HLS/DASH segment loads go through here) --------------------
  var _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try { arguments[1] = rewrite(url); } catch (e) {}
    return _open.apply(this, arguments);
  };

  // 3) WebSocket --------------------------------------------------------------------------
  try {
    var _WS = window.WebSocket;
    if (_WS) {
      var WS = function (url, protocols) {
        try { url = rewrite(url); } catch (e) {}
        return protocols === undefined ? new _WS(url) : new _WS(url, protocols);
      };
      WS.prototype = _WS.prototype;
      WS.CONNECTING = _WS.CONNECTING; WS.OPEN = _WS.OPEN; WS.CLOSING = _WS.CLOSING; WS.CLOSED = _WS.CLOSED;
      window.WebSocket = WS;
    }
  } catch (e) {}

  // 4) element attributes — patch the property setters so the browser NEVER issues the
  //    un-rewritten request, and a MutationObserver backstop catches attributes set via markup.
  function patchProp(proto, prop) {
    try {
      if (!proto) return;
      var d = Object.getOwnPropertyDescriptor(proto, prop);
      if (!d || !d.set || !d.get) return;
      Object.defineProperty(proto, prop, {
        configurable: true, enumerable: d.enumerable,
        get: function () { return d.get.call(this); },
        set: function (v) { try { v = rewrite(v); } catch (e) {} d.set.call(this, v); }
      });
    } catch (e) {}
  }
  patchProp(window.HTMLImageElement && HTMLImageElement.prototype, "src");
  patchProp(window.HTMLMediaElement && HTMLMediaElement.prototype, "src");   // <video>/<audio>
  patchProp(window.HTMLVideoElement && HTMLVideoElement.prototype, "poster");
  patchProp(window.HTMLSourceElement && HTMLSourceElement.prototype, "src");
  patchProp(window.HTMLScriptElement && HTMLScriptElement.prototype, "src");

  var _setAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    try {
      var n = String(name).toLowerCase();
      if (n === "src" || n === "poster" || n === "href") value = rewrite(value);
    } catch (e) {}
    return _setAttr.call(this, name, value);
  };

  function scrub(node) {
    if (!node || node.nodeType !== 1) return;
    var attrs = ["src", "poster", "href"];
    for (var i = 0; i < attrs.length; i++) {
      try {
        if (node.hasAttribute && node.hasAttribute(attrs[i])) {
          var cur = node.getAttribute(attrs[i]), nx = rewrite(cur);
          if (nx !== cur) node.setAttribute(attrs[i], nx);
        }
      } catch (e) {}
    }
    if (node.querySelectorAll) {
      var kids = node.querySelectorAll("[src],[poster],[href]");
      for (var j = 0; j < kids.length; j++) scrub(kids[j]);
    }
  }
  try {
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === "attributes") scrub(m.target);
        else for (var j = 0; j < m.addedNodes.length; j++) scrub(m.addedNodes[j]);
      }
    }).observe(document.documentElement, {
      subtree: true, childList: true, attributes: true, attributeFilter: ["src", "poster", "href"]
    });
  } catch (e) {}

  try {
    console.log("%cHOLO-PROXY", "background:#5865F2;color:#fff;padding:2px 6px;border-radius:3px;font-weight:bold",
      "URL mapping active · " + MAP.length + " hosts routed through Discord proxy");
  } catch (e) {}
})();
