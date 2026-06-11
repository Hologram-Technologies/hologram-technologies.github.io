// holo-fx.js — unicode motion + ASCII wordmark for hologram. Zero dependencies,
// content-addressable. One tiny module so every surface — boot, loading, progress,
// transitions — feels crisp and alive (the lean equivalent of unicode-animations).
//
//   HoloFX.spin(el, "braille")   → a running loader; .stop("✓") to resolve it
//   HoloFX.bar(pct)              → "███████░░░░░░" progress string
//   HoloFX.scramble(el, text)    → decode/glitch text into place (Promise)
//   HoloFX.type(el, text)        → typewriter (Promise)
//   HoloFX.BANNER.HOLOGRAM       → the ANSI-Shadow wordmark (string)

(function () {
  "use strict";
  if (window.HoloFX) return;

  const FRAMES = {
    braille: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
    dots:    [".  ", ".. ", "...", " ..", "  .", "   "],
    line:    ["|", "/", "-", "\\"],
    bars:    ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█", "▇", "▆", "▅", "▄", "▃", "▂"],
    pulse:   ["·", "•", "●", "•"],
    arrow:   ["▹▹▹", "▸▹▹", "▸▸▹", "▸▸▸"],
  };

  function spin(el, style, speed) {
    const f = FRAMES[style] || FRAMES.braille; let i = 0;
    const id = setInterval(() => { el.textContent = f[i = (i + 1) % f.length]; }, speed || 80);
    return { stop: (final) => { clearInterval(id); if (final != null) el.textContent = final; } };
  }

  function bar(pct, width) {
    width = width || 24; pct = Math.max(0, Math.min(100, pct));
    const fill = Math.round((pct / 100) * width);
    return "█".repeat(fill) + "░".repeat(width - fill);
  }

  const GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789/\\<>#*+=-·";
  function scramble(el, text, dur) {
    dur = dur || 700; const start = performance.now();
    return new Promise((res) => {
      const tick = (t) => {
        const p = Math.min(1, (t - start) / dur);
        const lock = Math.floor(p * text.length);
        let s = text.slice(0, lock);
        for (let i = lock; i < text.length; i++) s += text[i] === " " ? " " : GLYPHS[(Math.random() * GLYPHS.length) | 0];
        el.textContent = s;
        if (p < 1) requestAnimationFrame(tick); else { el.textContent = text; res(); }
      };
      requestAnimationFrame(tick);
    });
  }

  function type(el, text, cps) {
    cps = cps || 48; let i = 0;
    return new Promise((res) => {
      const id = setInterval(() => { el.textContent = text.slice(0, ++i); if (i >= text.length) { clearInterval(id); res(); } }, 1000 / cps);
    });
  }

  // ANSI-Shadow wordmark (column-aligned; renders crisp in any monospace <pre>).
  const BANNER = {
    HOLOGRAM: [
      "██╗  ██╗ ██████╗ ██╗      ██████╗  ██████╗ ██████╗  █████╗ ███╗   ███╗",
      "██║  ██║██╔═══██╗██║     ██╔═══██╗██╔════╝ ██╔══██╗██╔══██╗████╗ ████║",
      "███████║██║   ██║██║     ██║   ██║██║  ███╗██████╔╝███████║██╔████╔██║",
      "██╔══██║██║   ██║██║     ██║   ██║██║   ██║██╔══██╗██╔══██║██║╚██╔╝██║",
      "██║  ██║╚██████╔╝███████╗╚██████╔╝╚██████╔╝██║  ██║██║  ██║██║ ╚═╝ ██║",
      "╚═╝  ╚═╝ ╚═════╝ ╚══════╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝",
    ].join("\n"),
    SOVEREIGN: "SOVEREIGN OS",
  };

  // Universal loading indicator: a subtle braille spinner while the page loads,
  // faded out on window.load. Zero per-page wiring. Skipped on the dashboard
  // (it has the full boot splash) and on any page with data-holo-boot="off".
  function autoBoot() {
    if (document.getElementById("bootsplash")) return;
    if (document.documentElement.getAttribute("data-holo-boot") === "off") return;
    if (document.readyState === "complete") return;
    const css = document.createElement("style");
    css.textContent = "#holo-load{position:fixed;left:14px;bottom:14px;z-index:2147482000;display:flex;gap:8px;align-items:center;font:600 var(--holo-text-sm, 1rem)/1 ui-monospace,Menlo,Consolas,monospace;color:#7b5cff;background:#0d1117cc;border:1px solid #2b3440;border-radius:999px;padding:7px 12px;backdrop-filter:blur(6px);transition:opacity .4s}#holo-load.done{opacity:0}#holo-load .t{color:#8b949e;letter-spacing:.08em}";
    document.head.appendChild(css);
    const chip = document.createElement("div"); chip.id = "holo-load";
    chip.innerHTML = '<span class="s">⠋</span><span class="t">loading</span>';
    const attach = () => { if (document.body) document.body.appendChild(chip); else requestAnimationFrame(attach); };
    attach();
    const sp = spin(chip.querySelector(".s"), "braille", 70);
    window.addEventListener("load", () => { sp.stop("◆"); chip.classList.add("done"); setTimeout(() => chip.remove && chip.remove(), 600); }, { once: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", autoBoot); else autoBoot();

  window.HoloFX = { FRAMES, spin, bar, scramble, type, BANNER };
})();
