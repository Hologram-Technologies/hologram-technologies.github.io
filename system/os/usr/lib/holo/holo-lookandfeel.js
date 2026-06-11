// holo-lookandfeel.js — adopt KDE's published Look-and-Feel (Global Theme) package as ONE
// self-verifying κ-object that drives Holo Theme.
//
// A KDE Global Theme (KPackage type Plasma/LookAndFeel, e.g. org.kde.breeze.desktop) is a
// `metadata.json` + a `contents/defaults` KConfig file that REFERENCES the constituent themes:
// the color scheme, widget style, icon theme, plasma desktop theme, window decoration, cursor
// and splash. This adapter parses that published package and builds a Holo Global Theme — a W3C
// Design-Tokens (DTCG) theme (so its color + font + shape flow through HoloTheme.importTheme,
// keeping Holo Theme the single source of truth, ADR-023) PLUS an `$extensions
// "org.hologram.lookandfeel"` block carrying the rest of the look for the shell to consume.
//
// "Adopt a published format" discipline (ADR-029), the sibling of holo-zones (KWin tile-tree) and
// holo-kcolorscheme (.colors). Pure + dependency-free (Law L4): parseDefaults / toGlobalTheme are
// node-testable; the result content-addresses through HoloThemeFormat like any theme (Law L5).
//
// The widget style implies shape/typography the `defaults` file does not carry numerically; that
// mapping (STYLE_SHAPE) is an explicit, documented adoption decision — Breeze is square (small
// radius) and ships Noto Sans — kept separate from the values read verbatim from the package.

// widgetStyle → shape + typeface. Our adoption of each KDE widget style's feel. Extend per style.
export const STYLE_SHAPE = {
  breeze: {
    radius: { sm: "2px", md: "3px", lg: "5px" }, density: 1,
    font: { sans: ["Noto Sans", "Segoe UI", "system-ui", "sans-serif"], mono: ["Hack", "Noto Sans Mono", "ui-monospace", "monospace"] },
  },
};
const DEFAULT_SHAPE = {
  radius: { sm: "4px", md: "8px", lg: "12px" }, density: 1,
  font: { sans: ["system-ui", "sans-serif"], mono: ["ui-monospace", "monospace"] },
};

// parseDefaults(text) → a nested map of the KConfig `defaults` file. KDE uses grouped headers
// like [kdeglobals][General] (two levels) and [Wallpaper] (one level); both nest by their path.
export function parseDefaults(text) {
  const root = {}; let path = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === "#" || line[0] === ";") continue;
    if (line[0] === "[") { path = []; const re = /\[([^\]]*)\]/g; let m; while ((m = re.exec(line))) path.push(m[1]); continue; }
    const eq = line.indexOf("="); if (eq < 0 || !path.length) continue;
    let node = root; for (const p of path) node = (node[p] = node[p] || {});
    node[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return root;
}

const at = (o, ...ks) => ks.reduce((n, k) => (n && typeof n === "object" ? n[k] : undefined), o);

// toGlobalTheme({ metadata, defaults, colorTheme }, opts) → a Holo Global Theme (DTCG superset).
//   • color  ← colorTheme.color (a DTCG theme, e.g. from holo-kcolorscheme — single source)
//   • font / radius ← STYLE_SHAPE[widgetStyle] (the style's feel)
//   • $extensions["org.hologram.lookandfeel"] ← the package's references, read verbatim
export function toGlobalTheme(input, opts) {
  opts = opts || {};
  const meta = input.metadata || {}, kp = meta.KPlugin || {};
  const d = input.defaults || {}, kg = d.kdeglobals || {};
  const widgetStyle = at(kg, "KDE", "widgetStyle") || "";
  const shape = STYLE_SHAPE[widgetStyle.toLowerCase()] || DEFAULT_SHAPE;
  const name = opts.name || kp.Name || "KDE Global Theme";
  const author = opts.author || at(kp, "Authors", 0, "Name") || "KDE Community";
  const license = opts.license || kp.License || "";
  const source = opts.source || kp.Website || "";
  const laf = {
    id: kp.Id || "",
    name,
    widgetStyle,
    colorScheme: at(kg, "General", "ColorScheme") || "",
    icons: at(kg, "Icons", "Theme") || "",
    plasmaTheme: at(d, "plasmarc", "Theme", "name") || "",
    decoration: { library: at(d, "kwinrc", "org.kde.kdecoration2", "library") || "", theme: at(d, "kwinrc", "org.kde.kdecoration2", "theme") || "" },
    cursor: at(d, "kcminputrc", "Mouse", "cursorTheme") || "",
    splash: at(d, "ksplashrc", "KSplash", "Theme") || "",
    wallpaper: at(d, "Wallpaper", "Image") || "",
    layout: opts.layout || "floating",   // Breeze: floating windows + a panel (not a tiling)
    source, license,
  };
  return {
    $schema: "https://design-tokens.github.io/community-group/format/",
    $description: opts.description || (name + " — adopted from the KDE Look-and-Feel (Global Theme) package; one self-verifying κ-object that drives Holo Theme."),
    $extensions: {
      "org.hologram.theme": { name, author, license, source },
      "org.hologram.lookandfeel": laf,
    },
    color: (input.colorTheme && input.colorTheme.color) || { $type: "color", light: {}, dark: {} },
    font: { family: { $type: "fontFamily", sans: { $value: shape.font.sans }, mono: { $value: shape.font.mono } } },
    radius: { $type: "dimension", sm: { $value: shape.radius.sm }, md: { $value: shape.radius.md }, lg: { $value: shape.radius.lg } },
  };
}

// fromKde(metadataText, defaultsText, colorTheme, opts) — convenience: parse the package files.
export function fromKde(metadataText, defaultsText, colorTheme, opts) {
  let metadata = {}; try { metadata = JSON.parse(metadataText); } catch (e) {}
  return toGlobalTheme({ metadata, defaults: parseDefaults(defaultsText), colorTheme }, opts);
}

const HoloLookAndFeel = { STYLE_SHAPE, parseDefaults, toGlobalTheme, fromKde };
if (typeof globalThis !== "undefined") globalThis.HoloLookAndFeel = globalThis.HoloLookAndFeel || HoloLookAndFeel;
export default HoloLookAndFeel;
