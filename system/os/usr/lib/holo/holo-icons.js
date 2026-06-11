// holo-icons.js — Holo Icons: a native <holo-icon> that renders open icon libraries from the
// LOCAL κ-pinned data (Material Symbols, Tabler, …) — zero dependency, no CDN (Law L4), each icon
// a content-addressable UOR object (Law L5). The icon arm of Holo UI (ADR-030/ADR-032).
//
//   <holo-icon name="rocket-launch"></holo-icon>            ← active OS set (data-holo-icons)
//   <holo-icon set="material-symbols" name="search"></holo-icon>
//   <holo-icon name="home" size="32" label="Home"></holo-icon>
//
// Renders inline <svg fill="currentColor">, so it inherits color + font-size like text and recolors
// with the accent for free. Sets load lazily (one fetch per set, cached). When no `set` is given the
// element follows the active OS icon theme (data-holo-icons) and re-renders live on theme change.

(function () {
  "use strict";
  var W = window;
  if (W.customElements && customElements.get("holo-icon")) return;
  var root = document.documentElement;
  var DEFAULT_SET = "tabler";

  var me = document.currentScript || document.querySelector('script[src*="holo-icons.js"]');
  // κ-routed (src is /.holo/sha256/<hex>.js): siblings can't be path-resolved → use the canonical _shared mount.
  var SHARED = /\/\.holo\/sha256\//.test((me && me.src) || "") ? "/_shared/" : (me ? me.src.replace(/holo-icons\.js.*$/, "") : "_shared/");

  var setCache = {};   // prefix → Promise<{prefix,width,height,icons,aliases}>
  function loadSet(prefix) {
    if (!prefix) return Promise.resolve(null);
    if (!setCache[prefix]) setCache[prefix] = fetch(SHARED + "icons/" + prefix + "/icons.json")
      .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    return setCache[prefix];
  }
  var _index = null;
  function loadIndex() { return _index || (_index = fetch(SHARED + "icons/index.json").then(function (r) { return r.ok ? r.json() : { sets: [] }; }).catch(function () { return { sets: [] }; })); }

  function lookup(set, name) {
    if (!set || !name) return null;
    if (set.icons[name]) return { body: set.icons[name].body, w: set.icons[name].width || set.width, h: set.icons[name].height || set.height };
    var a = set.aliases && set.aliases[name];
    if (a && set.icons[a.parent]) return { body: set.icons[a.parent].body, w: set.icons[a.parent].width || set.width, h: set.icons[a.parent].height || set.height };
    return null;
  }
  function svgString(set, name) {
    var ic = lookup(set, name); if (!ic) return null;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + ic.w + " " + ic.h + '" width="100%" height="100%" fill="currentColor">' + ic.body + "</svg>";
  }

  var live = new Set();   // mounted <holo-icon>s following the active set (no explicit `set`)
  function activePrefix() { var d = root.getAttribute("data-holo-icons"); return d || DEFAULT_SET; }

  var Base = (W.HTMLElement || function () {});
  var HoloIcon = function () { return Reflect.construct(Base, [], HoloIcon); };
  HoloIcon.prototype = Object.create(Base.prototype);
  HoloIcon.prototype.constructor = HoloIcon;
  HoloIcon.observedAttributes = ["set", "name", "size", "label"];
  Object.defineProperty(HoloIcon, "observedAttributes", { get: function () { return ["set", "name", "size", "label"]; } });

  HoloIcon.prototype.connectedCallback = function () {
    if (!this._init) {
      this._init = true;
      this.style.display = this.style.display || "inline-flex";
      this.style.alignItems = "center"; this.style.justifyContent = "center";
      this.style.lineHeight = "0"; this.style.verticalAlign = "text-bottom";
    }
    if (!this.getAttribute("set")) live.add(this);
    this._render();
  };
  HoloIcon.prototype.disconnectedCallback = function () { live.delete(this); };
  HoloIcon.prototype.attributeChangedCallback = function () {
    if (this.getAttribute("set")) live.delete(this); else if (this.isConnected) live.add(this);
    if (this.isConnected) this._render();
  };
  HoloIcon.prototype._render = function () {
    var name = this.getAttribute("name"); if (!name) { this.innerHTML = ""; return; }
    var prefix = this.getAttribute("set") || activePrefix();
    var size = this.getAttribute("size");
    if (size) { var s = /^\d+$/.test(size) ? size + "px" : size; this.style.width = s; this.style.height = s; }
    else { this.style.width = "1em"; this.style.height = "1em"; }
    var label = this.getAttribute("label");
    if (label) { this.setAttribute("role", "img"); this.setAttribute("aria-label", label); }
    else { this.setAttribute("aria-hidden", "true"); }
    var self = this, token = (this._token = (this._token || 0) + 1);
    loadSet(prefix).then(function (set) {
      if (self._token !== token) return;        // a newer render superseded this one
      var svg = set && svgString(set, name);
      self.innerHTML = svg || "";
      if (!svg) self.setAttribute("data-holo-icon-missing", prefix + ":" + name);
      else self.removeAttribute("data-holo-icon-missing");
    });
  };

  if (W.customElements) customElements.define("holo-icon", HoloIcon);

  // Re-render the active-set icons when the OS icon theme changes (data-holo-icons), live.
  function rerenderLive() { live.forEach(function (el) { el._render(); }); }
  root.addEventListener("holo-lookandfeel-change", rerenderLive);
  root.addEventListener("holo-ui-change", rerenderLive);
  if (W.MutationObserver) new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) if (muts[i].attributeName === "data-holo-icons") { rerenderLive(); break; }
  }).observe(root, { attributes: true, attributeFilter: ["data-holo-icons"] });

  // ── programmatic API ──────────────────────────────────────────────────────────────
  function jcs(v) { return Array.isArray(v) ? "[" + v.map(jcs).join(",") + "]" : (v && typeof v === "object") ? "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + jcs(v[k]); }).join(",") + "}" : JSON.stringify(v); }
  W.HoloIcons = {
    sets: function () { return loadIndex().then(function (i) { return (i && i.sets) || []; }); },
    // every name in a set (icons ⊕ aliases), sorted — the native discovery primitive a picker browses.
    names: function (prefix) { return loadSet(prefix).then(function (s) { return s ? Object.keys(s.icons || {}).concat(Object.keys(s.aliases || {})).sort() : []; }); },
    has: function (prefix, name) { return loadSet(prefix).then(function (s) { return !!lookup(s, name); }); },
    svg: function (prefix, name) { return loadSet(prefix).then(function (s) { return svgString(s, name); }); },
    // Each icon is itself a UOR object: did:holo:sha256:H(jcs({prefix,name,body})).
    kappa: function (prefix, name) {
      return loadSet(prefix).then(function (s) {
        var ic = lookup(s, name); if (!ic || !(W.crypto && W.crypto.subtle)) return null;
        var bytes = new TextEncoder().encode(jcs({ prefix: prefix, name: name, body: ic.body }));
        return W.crypto.subtle.digest("SHA-256", bytes).then(function (buf) {
          return "did:holo:sha256:" + Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, "0"); }).join("");
        });
      });
    },
    activePrefix: activePrefix, DEFAULT_SET: DEFAULT_SET,
  };
})();
