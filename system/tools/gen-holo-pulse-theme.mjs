#!/usr/bin/env node
// gen-holo-pulse-theme.mjs — build "Hologram Pulse", a Plymouth 'script' theme that animates the
// Hologram dot-mark (the exact traced 70 dots) with a radial pulse wave — dots brighten in rings
// expanding from the centre (the dot-illumination style of adi1090x/plymouth-themes "Hexagon Dots",
// GPL-3.0; artwork = the original Hologram mark, animation original + procedural). No frame PNGs:
// the engine animates 70 sprites live at 50fps from ONE dot image, so the theme is tiny + sharp.
//
//   node tools/gen-holo-pulse-theme.mjs   (reads the traced logo, writes usr/share/plymouth/themes/holo-pulse/*)

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const THEME = join(OS, "usr/share/plymouth/themes/holo-pulse");
mkdirSync(THEME, { recursive: true });

// the exact traced dots (viewBox -104..104, centred on 0,0)
const svg = readFileSync(join(OS, "usr/share/icons/hologram-dark.svg"), "utf8");
const dots = [...svg.matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([-\d.]+)"\/>/g)]
  .map((m) => ({ x: +m[1], y: +m[2], r: +m[3] }));
if (dots.length < 10) throw new Error("no dots parsed from hologram-dark.svg");

const bake = dots.map((d, i) => `d.x[${i}] = ${d.x.toFixed(2)}; d.y[${i}] = ${d.y.toFixed(2)}; d.r[${i}] = ${d.r.toFixed(2)};`).join("\n");

const script = `# Hologram Pulse — the Hologram dot-mark pulsing in a radial wave.
# Artwork: the original Hologram mark (traced to ${dots.length} dots, system/tools/trace-logo.mjs).
# Animation: original + procedural, in the dot-illumination style of adi1090x/plymouth-themes (GPL-3.0).
# Background: the SHARED Hologram background (the same for every Holo Splash theme).
screen.width = Window.GetWidth(0);
screen.height = Window.GetHeight(0);
Window.SetBackgroundTopColor(0.043, 0.027, 0.118);
Window.SetBackgroundBottomColor(0.027, 0.020, 0.075);

dot.image = Image("dot.png");
N = ${dots.length};
${bake}

# place the mark centred, sized to ~46% of the smaller screen side (the trace spans 208 units)
field = Math.Min(screen.width, screen.height) * 0.46;
scale = field / 208;
cx = screen.width / 2;
cy = screen.height * 0.42;
for (i = 0; i < N; i++) {
  sz = d.r[i] * 2 * scale;
  d.sprite[i] = Sprite(dot.image.Scale(sz, sz));
  d.sprite[i].SetX(cx + d.x[i] * scale - sz / 2);
  d.sprite[i].SetY(cy + d.y[i] * scale - sz / 2);
  d.sprite[i].SetZ(3);
  d.dist[i] = Math.Sqrt(d.x[i] * d.x[i] + d.y[i] * d.y[i]);
}

# a radial wave: brightness rings expand from the centre outward, looping (the dots never fully
# vanish, so the mark always reads; the wave just breathes light across it).
frame = 0;
fun refresh_callback () {
  for (i = 0; i < N; i++) {
    wave = 0.5 + 0.5 * Math.Sin(frame * 0.09 - d.dist[i] * 0.055);
    d.sprite[i].SetOpacity(0.20 + 0.80 * wave);
  }
  frame++;
}
Plymouth.SetRefreshFunction(refresh_callback);

# the shared boot progress bar (driven by SetBootProgressFunction)
bar.image = Image("bar.png");
bar.width = screen.width * 0.42;
bar.x = screen.width / 2 - bar.width / 2;
bar.y = screen.height * 0.80;
bar.track = Sprite(bar.image.Scale(bar.width, 3));
bar.track.SetX(bar.x);
bar.track.SetY(bar.y);
bar.track.SetZ(2);
bar.track.SetOpacity(0.16);
bar.fill = Sprite();
bar.fill.SetX(bar.x);
bar.fill.SetY(bar.y);
bar.fill.SetZ(3);
fun progress_callback (time, progress) {
  w = bar.width * progress;
  if (w < 1) w = 1;
  bar.fill.SetImage(bar.image.Scale(w, 3));
  bar.fill.SetX(bar.x);
  bar.fill.SetY(bar.y);
}
Plymouth.SetBootProgressFunction(progress_callback);
`;

const plymouth = `[Plymouth Theme]
Name=Hologram Pulse
Description=The Hologram mark — its dot-field pulsing in a radial wave.
ModuleName=script

[script]
ImageDir=/usr/share/plymouth/themes/holo-pulse
ScriptFile=/usr/share/plymouth/themes/holo-pulse/holo-pulse.script
`;

writeFileSync(join(THEME, "holo-pulse.script"), script);
writeFileSync(join(THEME, "holo-pulse.plymouth"), plymouth);
// reuse the shared progress-bar pixel (1×1 white) from holo-logo
copyFileSync(join(OS, "usr/share/plymouth/themes/holo-logo/bar.png"), join(THEME, "bar.png"));
console.log(`wrote holo-pulse theme (${dots.length} dots) → ${THEME}`);
console.log("still need: dot.png (rasterized separately) + themes.json entry + manifest/closure seal");
