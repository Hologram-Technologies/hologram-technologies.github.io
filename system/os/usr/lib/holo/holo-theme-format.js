// holo-theme-format.js — the Holo Theme portable format: W3C Design Tokens (DTCG) ⇄
// CSS custom properties. This is what makes a theme a SHAREABLE ARTIFACT — author or
// import a DTCG token file (the format the open-source community publishes), compile it
// to the runtime `--holo-*` custom properties, and export the current theme back out.
//
// Conforms to the W3C Design Tokens Community Group format:
//   • a token is an object with `$value` (+ optional `$type`, `$description`, `$extensions`)
//   • groups nest; `$type` is inherited from the nearest ancestor group
//   • aliases: `$value: "{group.token}"` references another token
//   • types used here: color · fontFamily · number · dimension
//
// Light/dark: DTCG has no built-in mode axis, so a Holo theme carries `color.light.*`
// and `color.dark.*` groups; the compiler emits CSS Color-4 `light-dark(light, dark)`
// for each — one token, both modes, switched by the engine's color-scheme.
//
// Runtime-agnostic: attaches to globalThis so the browser (window.HoloThemeFormat) and
// the node witness (import → globalThis.HoloThemeFormat) share one implementation.

(function () {
  "use strict";

  // The canonical Holo Theme token names → their `--holo-*` CSS custom property.
  var COLORS = ["bg", "surface", "surface-2", "border", "ink", "ink-dim", "accent", "accent-ink", "ok", "warn", "danger"];
  var RESERVED = { $value: 1, $type: 1, $description: 1, $extensions: 1, $schema: 1, $deprecated: 1, $tokens: 1 };

  function isToken(node) { return node && typeof node === "object" && Object.prototype.hasOwnProperty.call(node, "$value"); }

  // Walk the DTCG tree → flat map { "a.b.c": { type, value, description } }, inheriting
  // $type from ancestor groups. Does NOT resolve aliases yet (done in a second pass).
  function flatten(json) {
    var flat = {};
    (function walk(node, path, inheritedType) {
      if (!node || typeof node !== "object") return;
      var type = node.$type || inheritedType;
      if (isToken(node)) { flat[path] = { type: node.$type || inheritedType, value: node.$value, description: node.$description }; }
      for (var k in node) {
        if (RESERVED[k] || !Object.prototype.hasOwnProperty.call(node, k)) continue;
        if (node[k] && typeof node[k] === "object") walk(node[k], path ? path + "." + k : k, type);
      }
    })(json, "", undefined);
    return flat;
  }

  // Resolve `{a.b.c}` aliases (with a depth guard against cycles).
  function resolveAliases(flat) {
    function deref(v, depth) {
      if (typeof v === "string" && /^\{[^}]+\}$/.test(v.trim())) {
        if (depth > 20) throw new Error("alias cycle at " + v);
        var ref = v.trim().slice(1, -1);
        if (!flat[ref]) throw new Error("unresolved alias {" + ref + "}");
        return deref(flat[ref].value, depth + 1);
      }
      return v;
    }
    var out = {};
    for (var p in flat) out[p] = { type: flat[p].type, value: deref(flat[p].value, 0), description: flat[p].description };
    return out;
  }

  function fontValue(v) { return Array.isArray(v) ? v.join(", ") : String(v); }

  // ── validate ──────────────────────────────────────────────────────────────────
  function validate(json) {
    var errors = [];
    if (!json || typeof json !== "object" || Array.isArray(json)) return { ok: false, errors: ["root must be a JSON object"] };
    var flat;
    try { flat = resolveAliases(flatten(json)); }
    catch (e) { return { ok: false, errors: [String(e.message || e)] }; }
    var n = 0;
    for (var p in flat) {
      n++;
      var t = flat[p];
      if (t.value === undefined || t.value === null) errors.push(p + ": missing $value");
      if (t.type && !/^(color|fontFamily|fontFace|number|dimension|duration|fontWeight|shadow|cubicBezier|strokeStyle|border|transition|typography)$/.test(t.type))
        errors.push(p + ": unknown $type \"" + t.type + "\"");
    }
    if (n === 0) errors.push("no tokens found ($value)");
    // A Holo theme should define at least one color and the accent.
    var hasColor = Object.keys(flat).some(function (p) { return /^color\.(light|dark)\.accent$/.test(p); });
    if (!hasColor) errors.push("a Holo theme must define color.light.accent and/or color.dark.accent");
    return { ok: errors.length === 0, errors: errors };
  }

  // ── DTCG → CSS custom properties ───────────────────────────────────────────────
  function toVars(json) {
    var flat = resolveAliases(flatten(json));
    var get = function (p) { return flat[p] ? flat[p].value : undefined; };
    var vars = {};
    // colors → light-dark(light, dark)
    COLORS.forEach(function (name) {
      var l = get("color.light." + name), d = get("color.dark." + name);
      if (l == null && d == null) return;
      vars["--holo-" + name] = (l != null && d != null) ? "light-dark(" + l + ", " + d + ")" : String(l != null ? l : d);
    });
    // typography
    if (get("font.family.sans") != null) vars["--holo-font-sans"] = fontValue(get("font.family.sans"));
    if (get("font.family.serif") != null) vars["--holo-font-serif"] = fontValue(get("font.family.serif"));
    if (get("font.family.mono") != null) vars["--holo-font-mono"] = fontValue(get("font.family.mono"));
    if (get("font.scale") != null) vars["--holo-font-scale"] = String(get("font.scale"));
    if (get("font.variation") != null) vars["--holo-font-variation"] = String(get("font.variation")); // variable-font axes
    // shape + density
    if (get("radius.sm") != null) vars["--holo-radius-sm"] = String(get("radius.sm"));
    if (get("radius.md") != null) vars["--holo-radius"] = String(get("radius.md"));
    if (get("radius.lg") != null) vars["--holo-radius-lg"] = String(get("radius.lg"));
    if (get("density") != null) vars["--holo-density"] = String(get("density"));
    return vars;
  }

  // CSS Fonts Module: an array of face descriptors {family, src, weight, style, display,
  // unicodeRange} → @font-face rules (font-display:swap by default). One builder, shared by
  // theme import (font.face) and the live font registry (holo-theme.js). unicode-range is
  // honoured so a font can be SEGMENTED (fetch-per-range on demand) instead of subset away —
  // the right move for an OS that must render arbitrary content (no tofu).
  function faceCss(faces) {
    if (!Array.isArray(faces)) return "";
    return faces.map(function (f) {
      if (!f || !f.family || !f.src) return "";
      var p = ["  font-family: " + JSON.stringify(f.family) + ";", "  src: " + f.src + ";", "  font-display: " + (f.display || "swap") + ";"];
      if (f.weight) p.push("  font-weight: " + f.weight + ";");   // a range like "100 900" = variable font
      if (f.style) p.push("  font-style: " + f.style + ";");
      if (f.unicodeRange) p.push("  unicode-range: " + f.unicodeRange + ";");
      return "@font-face {\n" + p.join("\n") + "\n}";
    }).filter(Boolean).join("\n");
  }
  // A theme may carry web fonts: font.face → @font-face. This is how a shared theme ships a
  // typeface; the font file itself rides along as a κ asset (path URL) or, for an imported
  // font, an inline data: URL so it travels with the CSS to every isolated holospace.
  function toFontFace(json) {
    var flat = resolveAliases(flatten(json));
    return faceCss(flat["font.face"] && flat["font.face"].value);
  }

  // ── Import a raw font file → a registry descriptor (pure; no DOM) ────────────────
  // The bytes arrive base64-encoded; we wrap them in a self-contained data: URL so the
  // @font-face has NO external dependency and propagates intact across the holospace tree.
  // Variable WOFF2 is the house rule, so the default weight is the full 100–900 range.
  var FONT_FMT = { woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype" };
  var FONT_MIME = { woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf" };
  function fontExt(filename, mime) {
    var m = /\.([a-z0-9]+)$/i.exec(filename || "");
    var e = m && m[1].toLowerCase();
    if (e && FONT_FMT[e]) return e;
    if (/woff2/.test(mime || "")) return "woff2";
    if (/woff/.test(mime || "")) return "woff";
    if (/(ttf|truetype)/.test(mime || "")) return "ttf";
    if (/(otf|opentype)/.test(mime || "")) return "otf";
    return "woff2";
  }
  function familyFromFilename(name) {
    return String(name || "").replace(/\.[a-z0-9]+$/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\b(variable|vf|regular|latin|italic|normal|subset|web)\b/ig, "")
      .replace(/\s+/g, " ").trim() || "Imported font";
  }
  function importDescriptor(opts) {
    opts = opts || {};
    if (!opts.base64) throw new Error("importDescriptor: base64 bytes required");
    var ext = fontExt(opts.filename, opts.mime);
    var mime = opts.mime || FONT_MIME[ext] || "font/woff2";
    var family = opts.family || familyFromFilename(opts.filename);
    var src = 'url("data:' + mime + ';base64,' + opts.base64 + '") format("' + FONT_FMT[ext] + '")';
    var face = { family: family, src: src, weight: opts.weight || "100 900", style: opts.style || "normal", display: "swap" };
    if (opts.unicodeRange) face.unicodeRange = opts.unicodeRange;
    return { family: family, faces: [face], origin: "import" };
  }

  function toCss(json, selector) {
    var vars = toVars(json);
    var body = Object.keys(vars).map(function (k) { return "  " + k + ": " + vars[k] + ";"; }).join("\n");
    var ff = toFontFace(json);
    return (ff ? ff + "\n\n" : "") + (selector || ":root") + " {\n" + body + "\n}\n";
  }

  // ── CSS custom properties → DTCG (export the current/edited theme) ──────────────
  function splitLightDark(v) {
    var m = /^\s*light-dark\(\s*([^,]+?)\s*,\s*(.+?)\s*\)\s*$/i.exec(v || "");
    return m ? { light: m[1], dark: m[2] } : { light: v, dark: v };
  }
  function fromVars(varsMap, meta) {
    var get = function (n) { return (varsMap[n] || "").trim(); };
    var theme = {
      $schema: "https://design-tokens.github.io/community-group/format/",
      $description: (meta && meta.description) || "Hologram OS theme (DTCG).",
      color: { $type: "color", light: {}, dark: {} },
      font: { family: { $type: "fontFamily" }, scale: { $type: "number", $value: 1 } },
      radius: { $type: "dimension" }
    };
    if (meta && meta.name) theme.$extensions = { "org.hologram.theme": { name: meta.name, author: meta.author || "" } };
    COLORS.forEach(function (name) {
      var raw = get("--holo-" + name); if (!raw) return;
      var ld = splitLightDark(raw);
      theme.color.light[name] = { $value: ld.light };
      theme.color.dark[name] = { $value: ld.dark };
    });
    var sans = get("--holo-font-sans"), serif = get("--holo-font-serif"), mono = get("--holo-font-mono");
    if (sans) theme.font.family.sans = { $value: sans.split(",").map(function (s) { return s.trim(); }) };
    if (serif) theme.font.family.serif = { $value: serif.split(",").map(function (s) { return s.trim(); }) };
    if (mono) theme.font.family.mono = { $value: mono.split(",").map(function (s) { return s.trim(); }) };
    var scale = get("--holo-font-scale"); if (scale) theme.font.scale.$value = parseFloat(scale) || 1;
    ["sm", "md", "lg"].forEach(function (k) {
      var v = get("--holo-radius" + (k === "md" ? "" : "-" + k)); if (v) theme.radius[k] = { $value: v };
    });
    return theme;
  }

  globalThis.HoloThemeFormat = {
    validate: validate, toVars: toVars, toCss: toCss, toFontFace: toFontFace, fromVars: fromVars,
    faceCss: faceCss, importDescriptor: importDescriptor, familyFromFilename: familyFromFilename, fontExt: fontExt,
    flatten: flatten, resolveAliases: resolveAliases, COLORS: COLORS
  };
})();
