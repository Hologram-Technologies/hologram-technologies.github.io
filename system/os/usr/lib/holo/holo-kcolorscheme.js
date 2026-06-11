// holo-kcolorscheme.js — adopt KDE's published KColorScheme (.colors) format as Holo themes.
//
// A KDE "color scheme" is a KConfig INI file of color SETS — [Colors:Window], [Colors:View],
// [Colors:Button], [Colors:Selection], [Colors:Tooltip] — each carrying RGB roles
// (BackgroundNormal/Alternate · ForegroundNormal/Inactive/Positive/Neutral/Negative ·
// DecorationFocus …). This maps those STANDARD roles onto the 11 canonical Holo Theme tokens
// and emits a W3C Design-Tokens (DTCG) theme — so ANY KDE .colors file is interoperable:
// adopted, not reinvented (the same "adopt a published format" discipline as the KWin
// tile-tree in holo-zones.js). Reading surfaces come from Colors:View, window chrome from
// Colors:Window, the highlight from Colors:Selection; a border is derived the way KDE/Kirigami
// derive a separator — the background shaded toward the foreground.
//
// Pure + dependency-free (Law L4): rgbToHex/mix/parseColors/rolesFor/toTokens are node-testable.
// A derived theme content-addresses through HoloThemeFormat exactly like a hand-authored one
// (Law L5), so importing a KDE scheme yields a shareable holo://κ artifact.

const clamp = (n) => Math.max(0, Math.min(255, n));
const h2 = (n) => clamp(Math.round(n)).toString(16).padStart(2, "0");

function hexToRgb(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// "61,174,233" (KConfig RGB, optional 4th alpha) → "#3daee9". A value already in #hex passes
// through (3- or 6-digit, normalised to lowercase 6-digit). Returns null on anything unparseable.
export function rgbToHex(v) {
  const s = String(v || "").trim();
  if (/^#[0-9a-f]{3}$/i.test(s)) return ("#" + s.slice(1).split("").map((c) => c + c).join("")).toLowerCase();
  if (/^#[0-9a-f]{6,8}$/i.test(s)) return ("#" + s.slice(1, 7)).toLowerCase();
  const p = s.split(",").map((x) => parseInt(x.trim(), 10));
  if (p.length < 3 || p.slice(0, 3).some((n) => Number.isNaN(n))) return null;
  return "#" + h2(p[0]) + h2(p[1]) + h2(p[2]);
}

// mix two #rrggbb by t∈[0,1]: a + (b-a)·t per channel. KDE/Kirigami draw separators as the
// background shaded toward the foreground; this reproduces that derivation purely.
export function mix(a, b, t) {
  const pa = hexToRgb(a), pb = hexToRgb(b);
  if (!pa || !pb) return a;
  return "#" + [0, 1, 2].map((i) => h2(pa[i] + (pb[i] - pa[i]) * t)).join("");
}

// parseColors(text) → { name, scheme, sets }. An INI parse where each [Colors:*] set has its
// RGB roles converted to #hex; comment lines (#, ;) and non-color sections are ignored.
export function parseColors(text) {
  const sets = {}; let cur = null; let name = "", scheme = "";
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === "#" || line[0] === ";") continue;
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) { cur = sec[1]; if (/^Colors:/.test(cur)) sets[cur] = sets[cur] || {}; continue; }
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim(), val = line.slice(eq + 1).trim();
    if (cur === "General") { if (key === "Name") name = val; else if (key === "ColorScheme") scheme = val; }
    else if (cur && /^Colors:/.test(cur)) { const hex = rgbToHex(val); if (hex) sets[cur][key] = hex; }
  }
  return { name, scheme, sets };
}

// The canonical Holo Theme token names, in declaration order.
export const TOKENS = ["bg", "surface", "surface-2", "border", "ink", "ink-dim", "accent", "accent-ink", "ok", "warn", "danger"];

// rolesFor(parsed) → the 11 Holo tokens for ONE palette (a KDE scheme is one mode). The mapping:
//   bg ← Window/BackgroundNormal           surface ← View/BackgroundNormal
//   surface-2 ← View/BackgroundAlternate    border ← mix(bg, ink, 0.22)  (KDE separator)
//   ink ← View/ForegroundNormal             ink-dim ← View/ForegroundInactive
//   accent ← Selection/BackgroundNormal     accent-ink ← Selection/ForegroundNormal
//   ok/warn/danger ← View/Foreground{Positive,Neutral,Negative}
export function rolesFor(parsed) {
  const sets = (parsed && parsed.sets) || {};
  const get = (set, key) => sets["Colors:" + set] && sets["Colors:" + set][key];
  const view = (key, fallback) => get("View", key) || fallback;
  const bg = get("Window", "BackgroundNormal") || "#ffffff";
  const ink = view("ForegroundNormal", "#000000");
  return {
    bg,
    surface: view("BackgroundNormal", "#ffffff"),
    "surface-2": view("BackgroundAlternate") || get("Button", "BackgroundNormal") || view("BackgroundNormal", "#ffffff"),
    border: mix(bg, ink, 0.22),
    ink,
    "ink-dim": view("ForegroundInactive", ink),
    accent: get("Selection", "BackgroundNormal") || view("DecorationFocus", "#3daee9"),
    "accent-ink": get("Selection", "ForegroundNormal") || "#ffffff",
    ok: view("ForegroundPositive", "#27ae60"),
    warn: view("ForegroundNeutral", "#f67400"),
    danger: view("ForegroundNegative", "#da4453"),
  };
}

// toTokens({light, dark}, meta) → a W3C Design-Tokens (DTCG) theme. light/dark are PARSED
// schemes (parseColors output); pass just one for a single-mode scheme (used for both modes).
export function toTokens(modes, meta) {
  const m = meta || {};
  const light = modes.light || modes.dark, dark = modes.dark || modes.light;
  const palette = (parsed) => { const r = rolesFor(parsed); const o = {}; TOKENS.forEach((t) => { o[t] = { $value: r[t] }; }); return o; };
  return {
    $schema: "https://design-tokens.github.io/community-group/format/",
    $description: m.description || ((m.name || "KDE") + " — adopted from the KDE KColorScheme (.colors) format, mapped to Holo Theme tokens."),
    $extensions: {
      "org.hologram.theme": {
        name: m.name || light.name || "KDE",
        author: m.author || "KDE Community",
        license: m.license || "LGPL-2.1-or-later",
        source: m.source || "https://invent.kde.org/plasma/breeze",
      },
    },
    color: { $type: "color", light: palette(light), dark: palette(dark) },
  };
}

// colorsToTheme(text, meta) → import a single dropped .colors file as a Holo theme. Its one
// palette fills BOTH light & dark, so it applies regardless of the system color-scheme.
export function colorsToTheme(text, meta) {
  const p = parseColors(text);
  return toTokens({ light: p, dark: p }, Object.assign({ name: p.name || p.scheme || "KDE scheme" }, meta));
}

const HoloKColorScheme = { rgbToHex, mix, parseColors, rolesFor, toTokens, colorsToTheme, TOKENS };
if (typeof globalThis !== "undefined") globalThis.HoloKColorScheme = globalThis.HoloKColorScheme || HoloKColorScheme;
export default HoloKColorScheme;
