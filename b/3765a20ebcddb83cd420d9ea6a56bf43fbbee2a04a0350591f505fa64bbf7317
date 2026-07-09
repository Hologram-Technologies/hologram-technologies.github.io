// holo-splash.js — the Hologram "streaming" boot screen, shared by EVERY Holo app.
//
//   <holo-splash app="Holo Linux"></holo-splash>
//
// One source of truth for the boot experience: every app streams, κ-verified, like a real hologram —
// same motion, same type, same golden-ratio composition. But the boot screen is now SPECIFIC to each
// app: it materialises that app's OWN icon (its colocated ./icon.svg), painted in the app's own accent
// colour, over the shared dark holo-field — so launching any app is unmistakably THAT app coming up,
// while the "Powered by HOLOGRAM" footer keeps the family mark. The only required per-app input is
// app="…"; the icon and accent are derived automatically (no per-app code), with sane fallbacks so it
// looks impeccable even for an app that ships no icon.
//
// Self-contained custom element: Shadow DOM (styles never leak or clash), zero dependencies, no web
// fonts (system stack), offline-safe — a single file each app vendors. Shows on connect; its progress
// bar tracks REAL work, so the splash lasts exactly as long as that app's boot actually takes. Drive it:
//   • default (no attribute) — AUTO: tracks the page's own load lifecycle (parsing → DOMContentLoaded →
//     window 'load' → network settle) and completes once the app is really up. Zero host code.
//   • manual — the host drives progress(0..1) through boot milestones and calls complete() when
//     streaming starts. For apps that keep booting past page-load (a VM, a model). A gentle trickle
//     keeps the bar moving between milestones.
//   • duration="ms" — a fixed timed fill (generic template / demo).
// Then it fades through black, removes itself, and fires a bubbling "done" event.
//
// PER-APP IDENTITY (override-able, but never required):
//   • icon  — by default the element fetches "./icon.svg" (each app ships one, colocated). Pass
//             icon="path.svg" to point elsewhere. If the icon can't load, the canonical Hologram mark
//             materialises instead — so the screen is always composed.
//   • accent — the glow/bar colour. Pass accent="#rrggbb" (any CSS colour) or hue="222" to set it; with
//             neither, a stable, well-distributed hue is derived from the app name, so each app keeps
//             one consistent signature colour across every boot.
//
// Golden ratio (φ = 1.618) governs every size and position; ONE type unit (--u) governs every text
// node, so the "Streaming …" label and the "Powered by HOLOGRAM" footer are identical in family and
// size (only weight/letter-spacing differ, for emphasis). The mark · label · bar form ONE centred flex
// column and can NEVER overlap on any screen; the mark is bounded by BOTH axes (vmin AND vh) so on a
// short-and-wide or tall-and-narrow viewport it shrinks first, always leaving the label, bar and footer
// their room.

// The canonical Hologram mark (boot/boot/icons/os_hologram.svg), inlined so the element is
// self-contained and boots offline — the materialise-fallback when an app ships no loadable icon.
const MARK =
  '<svg viewBox="-104 -104 208 208" fill="currentColor" role="img" aria-label="Hologram"><g><circle cx="0.20" cy="-97.39" r="2.61"/><circle cx="-22.86" cy="-86.55" r="2.71"/><circle cx="22.54" cy="-86.32" r="2.81"/><circle cx="-0.03" cy="-76.01" r="2.71"/><circle cx="45.26" cy="-75.92" r="7.80"/><circle cx="-45.82" cy="-75.86" r="2.61"/><circle cx="68.34" cy="-65.13" r="7.70"/><circle cx="-68.83" cy="-65.00" r="2.61"/><circle cx="-22.91" cy="-64.90" r="2.61"/><circle cx="22.71" cy="-64.88" r="2.51"/><circle cx="91.24" cy="-54.34" r="2.61"/><circle cx="-45.94" cy="-54.25" r="7.83"/><circle cx="-91.17" cy="-54.19" r="2.71"/><circle cx="-0.03" cy="-54.19" r="2.71"/><circle cx="45.35" cy="-54.19" r="7.80"/><circle cx="-22.86" cy="-43.64" r="2.71"/><circle cx="22.71" cy="-43.49" r="2.51"/><circle cx="68.29" cy="-43.47" r="7.73"/><circle cx="-68.60" cy="-43.37" r="7.73"/><circle cx="-45.85" cy="-32.63" r="7.77"/><circle cx="45.36" cy="-32.60" r="7.80"/><circle cx="-91.26" cy="-32.55" r="2.71"/><circle cx="0.10" cy="-32.51" r="2.61"/><circle cx="91.24" cy="-32.51" r="2.61"/><circle cx="68.22" cy="-21.95" r="7.83"/><circle cx="22.67" cy="-21.84" r="7.87"/><circle cx="-22.86" cy="-21.82" r="2.71"/><circle cx="-68.57" cy="-21.80" r="7.80"/><circle cx="45.45" cy="-11.06" r="7.73"/><circle cx="-0.19" cy="-11.04" r="7.87"/><circle cx="91.35" cy="-11.01" r="2.81"/><circle cx="-91.54" cy="-10.97" r="2.51"/><circle cx="-45.87" cy="-10.87" r="7.73"/><circle cx="22.71" cy="-0.27" r="8.06"/><circle cx="-22.89" cy="-0.21" r="7.90"/><circle cx="68.28" cy="-0.15" r="7.87"/><circle cx="-68.62" cy="-0.11" r="8.00"/><circle cx="-0.06" cy="10.98" r="7.87"/><circle cx="45.54" cy="11.00" r="7.83"/><circle cx="-45.85" cy="11.02" r="7.77"/><circle cx="-91.26" cy="11.10" r="2.71"/><circle cx="91.24" cy="11.13" r="2.61"/><circle cx="22.71" cy="21.64" r="2.71"/><circle cx="-68.74" cy="21.66" r="7.87"/><circle cx="-22.86" cy="21.67" r="7.87"/><circle cx="68.28" cy="21.67" r="7.87"/><circle cx="-91.54" cy="32.46" r="2.61"/><circle cx="0.15" cy="32.46" r="2.71"/><circle cx="-45.72" cy="32.50" r="7.73"/><circle cx="45.54" cy="32.59" r="7.83"/><circle cx="91.35" cy="32.63" r="2.81"/><circle cx="-23.01" cy="43.23" r="2.61"/><circle cx="68.25" cy="43.31" r="7.83"/><circle cx="-68.71" cy="43.34" r="7.83"/><circle cx="22.71" cy="43.37" r="2.90"/><circle cx="91.39" cy="53.92" r="2.71"/><circle cx="45.48" cy="53.95" r="7.87"/><circle cx="-45.86" cy="53.97" r="7.80"/><circle cx="-91.34" cy="53.99" r="2.61"/><circle cx="0.20" cy="54.09" r="2.61"/><circle cx="-68.57" cy="64.90" r="7.80"/><circle cx="-22.86" cy="64.92" r="2.71"/><circle cx="68.28" cy="64.92" r="2.71"/><circle cx="22.54" cy="65.15" r="2.81"/><circle cx="-45.88" cy="75.56" r="7.80"/><circle cx="0.10" cy="75.62" r="2.61"/><circle cx="45.32" cy="75.62" r="2.61"/><circle cx="22.53" cy="86.47" r="2.71"/><circle cx="-22.86" cy="86.75" r="2.71"/><circle cx="-0.03" cy="97.29" r="2.71"/></g></svg>';

const TEMPLATE = `
<style>
  /* ── golden-ratio composition ─────────────────────────────────────────────────
     φ = 1.618. ONE type unit --u drives every text node; --g1/--g2/--g3 are φ¹/φ²/φ³
     of it for vertical rhythm. The mark · label · bar form ONE centred flex column, so
     they scale as a unit and can NEVER overlap on any screen or aspect ratio. The stack's
     optical centre rides the upper golden line (38.2%): it lives in the top band (height
     2 × 38.2% = 76.4%), leaving the lower golden band (23.6%) to breathe and carry the
     footer. Every size is φ-derived and bounded by the SHORT axis (vmin) so nothing ever
     outgrows the frame — portrait phone, ultra-wide, or short laptop all stay composed. */
  :host {
    position: fixed; inset: 0; z-index: 2147483000; display: block; overflow: hidden;
    --phi: 1.618;
    --u: clamp(15px, 1.7vmin, 21px);          /* the ONE type size — short-axis-bounded */
    --g1: calc(var(--u) * 1.618);             /* φ¹ */
    --g2: calc(var(--u) * 2.618);             /* φ² */
    --g3: calc(var(--u) * 4.236);             /* φ³ */
    --teal: #7defc9;                          /* the family mark colour (footer) */
    --accent: #7defc9;                        /* the per-app signature colour — set from JS */
    font-family: "Segoe UI", system-ui, -apple-system, "Oxygen", sans-serif;  /* the ONE family */
    color: #fff;
    background: radial-gradient(120% 120% at 20% 0%, #1b2a4a 0%, #0d1117 60%, #05070c 100%);
    opacity: 1; transition: opacity 0.55s ease;     /* the shared black-veil fade-out */
  }
  :host(.gone) { opacity: 0; pointer-events: none; }
  /* aurora — the same wallpaper the OS greeter wears, screen-blended over the black base. Its third
     bloom takes the app's accent, so even the ambient field is tinted to the app coming up. */
  .aurora { position: absolute; inset: 0; mix-blend-mode: screen; pointer-events: none; }
  .aurora i { position: absolute; border-radius: 50%; filter: blur(60px); opacity: 0.5; }
  .aurora .a { left: 8%; top: 12%; width: 42vw; height: 42vw; background: radial-gradient(circle, rgba(52,211,166,0.5), transparent 62%); }
  .aurora .b { right: 6%; bottom: 4%; width: 46vw; height: 46vw; background: radial-gradient(circle, rgba(64,99,214,0.45), transparent 62%); }
  .aurora .c { left: 44%; top: 48%; width: 30vw; height: 30vw;
    background: radial-gradient(circle, color-mix(in srgb, var(--accent) 30%, transparent), transparent 62%); }
  /* the centred stack — fills the upper band (bottom: 23.6%), so its midpoint sits on the
     upper golden line (38.2%). align/justify-center keep mark·label·bar a single composed unit. */
  .stage { position: absolute; left: 0; right: 0; top: 0; bottom: 23.6%;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: var(--g2) var(--g3); box-sizing: border-box; text-align: center; }
  /* the breathing mark frame — a fixed-size square (so the icon's arrival causes NO layout shift),
     bounded by the short axis AND the viewport height (40vh) so on a short/wide or tall/narrow screen
     it shrinks first, always leaving the label · bar · footer their room: the no-overlap guarantee. */
  .mark { position: relative; width: min(31vmin, 16rem, 40vh); aspect-ratio: 1; flex: 0 0 auto;
    color: var(--accent); display: grid; place-items: center;
    animation: breathe 2.618s ease-in-out infinite; }   /* φ²-second cadence */
  /* a soft accent halo, present from the first frame, so the mark area reads as "materialising" even
     before the icon resolves — and gives the glyph its hologram glow once it does. */
  .mark::before { content: ""; position: absolute; inset: -8%; border-radius: 50%; z-index: 0;
    background: radial-gradient(circle, color-mix(in srgb, var(--accent) 34%, transparent) 0%, transparent 66%);
    filter: blur(6px); opacity: 0.9; }
  /* the glyph itself — the app's icon (or the Hologram mark fallback). Fades + lifts in once loaded. */
  .glyph { position: relative; z-index: 1; width: 86%; height: 86%; display: grid; place-items: center;
    opacity: 0; transform: scale(0.94); transition: opacity 0.5s ease, transform 0.5s ease;
    filter: drop-shadow(0 0 16px color-mix(in srgb, var(--accent) 50%, transparent))
            drop-shadow(0 0 40px color-mix(in srgb, var(--accent) 26%, transparent)); }
  .mark.ready .glyph { opacity: 1; transform: scale(1); }
  .glyph svg { width: 100%; height: 100%; display: block; }
  /* the Hologram-mark fallback wants the full frame (it has no built-in padding like the app icons) */
  .glyph.hmark { width: 100%; height: 100%; }
  @keyframes breathe { 0%, 100% { transform: scale(1); opacity: 0.92; }
                       50%       { transform: scale(1.04); opacity: 1; } }
  /* label — φ² below the mark, φ¹ above the bar (the two gaps are themselves in golden ratio). It
     prefers one line, but a long app name on a narrow screen WRAPS (centred, balanced) rather than
     overflowing the frame — so the composition stays contained for any app name. */
  .label { margin: var(--g2) 0 var(--g1); font-size: var(--u); font-weight: 400; line-height: 1.25;
    letter-spacing: 0.06em; max-width: 90vw; text-wrap: balance; color: rgba(255,255,255,0.82); }
  .label b { font-weight: 600; color: #fff; letter-spacing: 0.12em; }
  /* ONE progress bar — φ-derived width, bounded so it never spans an ultra-wide screen. The fill takes
     the app accent, so even the progress reads in the app's colour. */
  .bar { width: min(38.2vw, 30rem); height: 2px; border-radius: 2px; flex: 0 0 auto;
    background: rgba(255,255,255,0.13); overflow: hidden; }
  .fill { height: 100%; width: 0; border-radius: 2px;
    background: color-mix(in srgb, var(--accent) 85%, #fff);
    box-shadow: 0 0 10px color-mix(in srgb, var(--accent) 60%, transparent);
    transition: width 0.3s cubic-bezier(0.3, 0, 0.25, 1); }
  /* footer — φ² inset from the bottom, in the lower golden band. font-size: var(--u) (= the label). */
  .foot { position: absolute; left: 50%; bottom: var(--g2); transform: translateX(-50%);
    font-size: var(--u); font-weight: 400; line-height: 1; letter-spacing: 0.06em; white-space: nowrap;
    color: rgba(231,237,250,0.5); }
  .foot b { font-weight: 600; color: var(--teal); letter-spacing: 0.14em; }
  @media (prefers-reduced-motion: reduce) { .mark { animation: none; }
    .glyph { transition: opacity 0.3s ease; transform: none; } .mark.ready .glyph { transform: none; } }
  /* ── compact mode for SHORT viewports ─────────────────────────────────────────────────────────
     The golden composition is sized for normal aspect ratios; on a short surface (landscape phone, a
     stubby window) the absolute footer would eventually crowd the bar. So below 480px tall we tighten
     the whole rhythm (a smaller --u shrinks every gap with it, and the mark gains a tighter vh bound),
     and below 300px tall — where there is simply no room to seat the brand line without crowding — we
     drop the footer. Together these GUARANTEE the mark · label · bar · footer never overlap at any size. */
  @media (max-height: 480px) {
    :host { --u: clamp(11px, 3vmin, 18px); }
    .mark { width: min(31vmin, 16rem, 36vh); }
  }
  @media (max-height: 300px) { .foot { display: none; } }
</style>
<div class="aurora" aria-hidden="true"><i class="a"></i><i class="b"></i><i class="c"></i></div>
<div class="stage">
  <div class="mark" aria-hidden="true"><div class="glyph"></div></div>
  <div class="label">Streaming <b class="app"></b></div>
  <div class="bar"><div class="fill"></div></div>
</div>
<div class="foot">Powered by <b>HOLOGRAM</b></div>
`;

class HoloSplash extends HTMLElement {
  connectedCallback() {
    if (this._init) return;
    this._init = true;
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = TEMPLATE;
    const app = this.getAttribute("app") || "";
    root.querySelector(".app").textContent = app;
    this._mark = root.querySelector(".mark");
    this._glyph = root.querySelector(".glyph");
    this._fill = root.querySelector(".fill");
    this._shown = 0;      // visible bar fraction
    this._milestone = 0;  // highest real milestone reported
    this._cap = 0;        // trickle ceiling (a little above the milestone)

    // ── per-app accent ───────────────────────────────────────────────────────────────────────
    // An explicit accent="…"/hue="…" wins; otherwise derive a stable, well-spread hue from the app
    // name so each app keeps ONE signature colour across every boot. Fixed S/L keep it luminous on
    // the dark field, never muddy.
    this.style.setProperty("--accent", this._accent(app));
    // ── per-app glyph ────────────────────────────────────────────────────────────────────────
    // Materialise the app's own icon; fall back to the Hologram mark if it can't load.
    this._loadGlyph();

    const dur = +this.getAttribute("duration");
    if (this.hasAttribute("manual")) {
      // Manual mode: the host drives progress() to real boot milestones and calls complete() when
      // streaming begins — for apps whose boot runs well past page-load (a VM, a model). A gentle
      // trickle keeps the bar moving between milestones (and through long synchronous work like
      // κ-disk provisioning), so the bar always reflects the actual time taken.
      this._iv = setInterval(() => this._trickle(), 200);
      this._safety = setTimeout(() => this.complete(), 120000);   // never trap the user behind the splash
    } else if (dur > 0) {
      // Timed mode: no boot to track (generic template / demo) — fill smoothly over `duration`,
      // then finish. The first progress()/complete() call switches it to live mode.
      requestAnimationFrame(() => {
        if (this._driven || !this._fill) return;
        this._fill.style.transition = "width " + dur + "ms cubic-bezier(0.3, 0, 0.25, 1)";
        this._fill.style.width = "100%";
      });
      this._timer = setTimeout(() => { if (!this._driven) this.complete(); }, dur);
    } else {
      // Auto mode (the default for every app): no host code needed — the splash tracks THIS app's
      // own real boot, so its lifetime reflects the actual time the app takes to come up. It lifts
      // the bar across the document/resource load milestones (parsing → DOMContentLoaded → load) and
      // finishes a moment after the page is up and the network goes quiet. A host may still override
      // at any time with progress()/complete(). Apps that keep booting past page-load use the
      // `manual` attribute and drive the milestones themselves.
      this._cap = 0.2;
      this._iv = setInterval(() => this._trickle(), 200);
      this._safety = setTimeout(() => this.complete(), 120000);
      this._autoBoot();
    }
  }

  // Resolve the app's signature accent colour. Explicit attribute wins; else a stable hue from the name.
  _accent(app) {
    const a = (this.getAttribute("accent") || "").trim();
    if (a) return a;
    const hAttr = this.getAttribute("hue");
    let hue;
    if (hAttr != null && hAttr !== "" && isFinite(+hAttr)) hue = ((+hAttr % 360) + 360) % 360;
    else {
      // FNV-style hash → golden-angle spread for maximally distinct neighbours.
      let h = 2166136261 >>> 0;
      const s = app || "Hologram";
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
      hue = Math.round(((h % 1000) / 1000) * 360 + (s.length * 137.508)) % 360;
    }
    return `hsl(${hue} 70% 66%)`;
  }

  // Fetch and inline the app's own icon (./icon.svg by default), painted in the accent via currentColor.
  // Same-origin, tiny, cached. On any failure (no icon, off-http, parse error) the Hologram mark
  // materialises instead — the screen is always composed. The fade-in is reserved-space, so the icon's
  // arrival never shifts the layout.
  _loadGlyph() {
    const src = this.getAttribute("icon") || "./icon.svg";
    const fallback = () => this._setGlyph(MARK, true);
    let settled = false;
    const guard = setTimeout(() => { if (!settled) { settled = true; fallback(); } }, 1500);  // never wait on a slow/missing icon
    fetch(src, { cache: "force-cache" })
      .then(r => (r.ok && /svg|xml/.test(r.headers.get("content-type") || "") ? r.text()
                 : r.ok ? r.text() : Promise.reject()))
      .then(txt => {
        if (settled) return; settled = true; clearTimeout(guard);
        const svg = this._extractSvg(txt);
        if (svg) this._setGlyph(svg, false); else fallback();
      })
      .catch(() => { if (settled) return; settled = true; clearTimeout(guard); fallback(); });
  }
  // Pull just the <svg>…</svg> out of the file and confirm it parses — never inject arbitrary markup.
  _extractSvg(txt) {
    try {
      const doc = new DOMParser().parseFromString(String(txt), "image/svg+xml");
      const svg = doc.querySelector("svg");
      if (!svg || doc.querySelector("parsererror")) return null;
      // make it fill its frame regardless of authored width/height
      svg.removeAttribute("width"); svg.removeAttribute("height");
      svg.setAttribute("aria-hidden", "true");
      return svg.outerHTML;
    } catch (_) { return null; }
  }
  _setGlyph(svgHtml, isHmark) {
    if (!this._glyph || this._done) return;
    this._glyph.innerHTML = svgHtml;
    this._glyph.classList.toggle("hmark", !!isHmark);
    // trigger the fade/scale-in once initial styles have applied. A timer (not just rAF) so the reveal
    // still fires when the tab is backgrounded — rAF is throttled there; setTimeout is not.
    const reveal = () => { if (this._mark) this._mark.classList.add("ready"); };
    requestAnimationFrame(reveal);
    setTimeout(reveal, 60);
  }

  // Drive the bar from the page's own load lifecycle so the splash lasts as long as the app's real
  // boot. Lifts to milestones at DOMContentLoaded and window 'load', then completes once the on-load
  // network burst settles (bounded, so a continuously-streaming app is never trapped behind it).
  _autoBoot() {
    const lift = (m, cap) => {
      if (this._done || this._completing || this._driven) return;
      this._milestone = Math.max(this._milestone, m);
      if (this._shown < m) this._shown = m;
      this._cap = Math.max(this._cap, cap);
      this._apply();
    };
    if (document.readyState === "loading")
      document.addEventListener("DOMContentLoaded", () => lift(0.55, 0.9), { once: true });
    else lift(0.55, 0.9);

    const settle = () => {
      lift(0.9, 0.97);
      if (this._done || this._completing) return;
      const QUIET = 500, MAX = 1500;     // finish 0.5s after the network quiets, but never wait > 1.5s
      let quiet = null;
      const finish = () => { try { this._po && this._po.disconnect(); } catch (_) {} this._po = null;
        clearTimeout(quiet); clearTimeout(hard); this.complete(); };
      const arm = () => { clearTimeout(quiet); quiet = setTimeout(finish, QUIET); };
      const hard = setTimeout(finish, MAX);
      try { this._po = new PerformanceObserver(() => arm()); this._po.observe({ type: "resource", buffered: false }); } catch (_) {}
      arm();
    };
    if (document.readyState === "complete") settle();
    else window.addEventListener("load", settle, { once: true });
  }
  // Report a real milestone in [0,1). Monotonic; lifts the trickle ceiling a little above it.
  progress(f) {
    this._driven = true;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    f = Math.max(0, Math.min(0.999, +f || 0));
    this._milestone = Math.max(this._milestone, f);
    this._cap = Math.min(0.97, this._milestone + 0.1);
    if (this._shown < this._milestone) this._shown = this._milestone;
    this._apply();
  }
  _trickle() {
    if (this._done) return;
    if (this._shown < this._cap) { this._shown += (this._cap - this._shown) * 0.08; this._apply(); }
  }
  _apply() { if (this._fill) this._fill.style.width = (Math.min(this._shown, 0.999) * 100).toFixed(2) + "%"; }
  // Boot reached the streaming point: fill to 100%, then fade out.
  complete() {
    if (this._completing || this._done) return;
    this._completing = true; this._driven = true;
    clearInterval(this._iv); clearTimeout(this._timer); clearTimeout(this._safety);
    try { this._po && this._po.disconnect(); } catch (_) {} this._po = null;
    this._shown = 1;
    if (this._fill) { this._fill.style.transition = "width 0.35s ease-out"; this._fill.style.width = "100%"; }
    setTimeout(() => this.dismiss(), 380);   // let the bar visibly complete before fading
  }
  // Get out of the way immediately (e.g. on a boot error) so what's underneath shows.
  dismiss() {
    if (this._done) return;
    this._done = true;
    clearInterval(this._iv); clearTimeout(this._timer); clearTimeout(this._safety);
    const done = () => { this.dispatchEvent(new CustomEvent("done", { bubbles: true })); this.remove(); };
    this.addEventListener("transitionend", (e) => { if (e.propertyName === "opacity") done(); }, { once: true });
    setTimeout(done, 700);                  // fallback if transitionend doesn't fire (> the 0.55s fade)
    this.classList.add("gone");
  }
  disconnectedCallback() { clearInterval(this._iv); clearTimeout(this._timer); clearTimeout(this._safety);
    try { this._po && this._po.disconnect(); } catch (_) {} this._po = null; }
}

if (!customElements.get("holo-splash")) customElements.define("holo-splash", HoloSplash);
