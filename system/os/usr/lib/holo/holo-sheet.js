// holo-sheet.js — the ONE Hologram OS modal primitive (window.HoloSheet).
//
// Every OS popup — a choice ("how much time…"), a confirm, an alert — routes through this single
// component instead of bespoke dialogs or the browser's raw confirm(). It is the launcher-clean
// sheet: a centred card with a big rounded radius, one question, and a 2-up grid of ≥48px tap
// targets — subtraction, not decoration.
//
// 100% W3C primitives, zero deps (Law L4): the native <dialog> element gives focus-trap, Esc-to-
// dismiss, the top layer and aria-modal for free; appearance is pure --holo-* tokens (so it wears
// the active palette / immersive theme automatically) and the holo-mobile.css tap floor; motion
// honours prefers-reduced-motion. Resolution-independent → razor-sharp at any density (8K/Retina).
//
// API (all return a Promise; dismiss = scrim / Esc / close ⇒ resolves the dismiss value):
//   HoloSheet.open({ title, message?, options?, actions?, kebab?, dismissible? }) → chosen value | null
//   HoloSheet.ask(title, options)        → value | null     options: ["A","B"] | [{label,value,sub?}]
//   HoloSheet.confirm(message, opts?)    → boolean           opts: { title, ok, cancel, danger }
//   HoloSheet.alert(message, opts?)      → true              opts: { title, ok }
(function () {
  "use strict";
  var W = window;
  if (W.HoloSheet) return;
  var DOC = document;

  // ── styles, injected once ──────────────────────────────────────────────────────
  var CSS = [
    "dialog.holo-sheet{",
    "  border:1px solid var(--holo-border-emphasized,#3f3f46);border-radius:max(20px,var(--holo-radius-lg,22px));",
    "  padding:0;color:var(--holo-ink,#fafafa);max-width:min(92vw,34rem);width:max-content;min-width:min(88vw,20rem);",
    "  background:color-mix(in srgb, var(--holo-surface,#111) 86%, transparent);",
    "  -webkit-backdrop-filter:blur(28px) saturate(1.3);backdrop-filter:blur(28px) saturate(1.3);",
    "  box-shadow:0 24px 80px -16px rgba(0,0,0,.6);margin:auto;overflow:hidden;}",
    "dialog.holo-sheet::backdrop{background:rgba(0,0,0,.5);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);}",
    "dialog.holo-sheet .hs-body{padding:clamp(1.2rem,4vw,1.8rem);display:flex;flex-direction:column;gap:clamp(1rem,3.5vw,1.5rem);}",
    "dialog.holo-sheet .hs-head{display:flex;align-items:flex-start;gap:.75rem;}",
    "dialog.holo-sheet h2{margin:0;flex:1;text-align:center;font:600 max(16px,var(--holo-text-lg,1.25rem))/1.25 var(--holo-font-sans,system-ui);letter-spacing:-.01em;}",
    "dialog.holo-sheet .hs-msg{margin:0;text-align:center;color:var(--holo-ink-dim,#a1a1aa);font:max(16px,var(--holo-text,1rem))/1.5 var(--holo-font-sans,system-ui);}",
    // kebab (overflow) — present only when given items; otherwise a quiet close affordance.
    "dialog.holo-sheet .hs-kebab{flex:0 0 auto;width:var(--holo-tap,48px);height:var(--holo-tap,48px);display:grid;place-items:center;",
    "  background:none;border:0;border-radius:50%;color:var(--holo-ink-dim,#a1a1aa);font-size:1.4rem;cursor:pointer;}",
    "dialog.holo-sheet .hs-kebab:hover{background:var(--holo-hover,rgba(255,255,255,.08));color:var(--holo-ink,#fafafa);}",
    // the 2-up grid of big choices — every target ≥48px (WCAG 2.5.8 / Material 3); launcher feel.
    "dialog.holo-sheet .hs-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:clamp(.6rem,2.5vw,1rem);}",
    "dialog.holo-sheet .hs-grid.one{grid-template-columns:1fr;}",
    "dialog.holo-sheet .hs-opt{min-height:clamp(56px,14vw,72px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.15rem;",
    "  padding:.7rem 1rem;border:1px solid var(--holo-border,#27272a);border-radius:var(--holo-radius,14px);cursor:pointer;",
    "  background:var(--holo-surface-2,#18181b);color:var(--holo-ink,#fafafa);",
    "  font:600 max(16px,var(--holo-text,1rem))/1.2 var(--holo-font-sans,system-ui);transition:background .12s ease,border-color .12s ease,transform .08s ease;}",
    "dialog.holo-sheet .hs-opt:hover{background:var(--holo-surface-emphasized,#27272a);border-color:var(--holo-border-emphasized,#3f3f46);}",
    "dialog.holo-sheet .hs-opt:active{transform:scale(.97);}",
    "dialog.holo-sheet .hs-opt .hs-sub{font-weight:400;color:var(--holo-ink-dim,#a1a1aa);font-size:max(16px,.82em);}",
    // thumbnail options (e.g. a wallpaper chooser): image card with the label beneath.
    "dialog.holo-sheet .hs-opt.has-thumb{padding:0;gap:0;overflow:hidden;justify-content:flex-start;min-height:clamp(104px,28vw,140px);}",
    "dialog.holo-sheet .hs-opt.has-thumb img{width:100%;height:clamp(68px,19vw,96px);object-fit:cover;display:block;}",
    "dialog.holo-sheet .hs-opt.has-thumb>span{padding:.45rem .6rem 0;}",
    "dialog.holo-sheet .hs-opt.has-thumb .hs-sub{padding:.1rem .6rem .5rem;}",
    // confirm / alert action row — cancel quiet, primary accent, danger red.
    "dialog.holo-sheet .hs-actions{display:flex;gap:.6rem;}",
    "dialog.holo-sheet .hs-actions .hs-opt{flex:1;min-height:var(--holo-tap,48px);flex-direction:row;}",
    "dialog.holo-sheet .hs-opt.primary{background:var(--holo-accent,#5b8cff);border-color:transparent;color:var(--holo-accent-ink,#fff);}",
    "dialog.holo-sheet .hs-opt.primary:hover{filter:brightness(1.08);}",
    "dialog.holo-sheet .hs-opt.danger{background:var(--holo-danger,#ef4444);border-color:transparent;color:#fff;}",
    "@media (prefers-reduced-motion:no-preference){dialog.holo-sheet[open]{animation:hs-in .18s cubic-bezier(.2,.7,.2,1);}",
    "  @keyframes hs-in{from{opacity:0;transform:translateY(8px) scale(.98);}to{opacity:1;transform:none;}}}"
  ].join("\n");

  function injectCss() {
    if (DOC.getElementById("holo-sheet-css")) return;
    var s = DOC.createElement("style"); s.id = "holo-sheet-css"; s.textContent = CSS;
    (DOC.head || DOC.documentElement).appendChild(s);
  }

  function el(tag, cls, text) {
    var n = DOC.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // Normalise an options list: strings or {label,value,sub} → {label,value,sub}.
  function normOpts(list) {
    return (list || []).map(function (o) {
      if (o && typeof o === "object") return { label: o.label, value: ("value" in o ? o.value : o.label), sub: o.sub || "", thumb: o.thumb || "" };
      return { label: String(o), value: o, sub: "", thumb: "" };
    });
  }

  // ── core ─────────────────────────────────────────────────────────────────────
  function open(spec) {
    injectCss();
    spec = spec || {};
    var dismissible = spec.dismissible !== false;            // default: scrim/Esc/close dismisses
    var dismissValue = ("dismissValue" in spec) ? spec.dismissValue : null;

    var dlg = el("dialog", "holo-sheet");
    dlg.setAttribute("aria-modal", "true");
    var body = el("div", "hs-body"); dlg.appendChild(body);

    return new Promise(function (resolve) {
      var done = false;
      function settle(v) { if (done) return; done = true; try { dlg.close(); } catch (e) {} try { dlg.remove(); } catch (e) {} resolve(v); }

      // head: title + (kebab | close)
      if (spec.title || spec.kebab || dismissible) {
        var head = el("div", "hs-head");
        head.appendChild(el("h2", null, spec.title || ""));
        if (spec.kebab && spec.kebab.length) {
          var kb = el("button", "hs-kebab", "⋮"); kb.type = "button"; kb.setAttribute("aria-label", "More");
          kb.onclick = function () {                          // route overflow through a nested sheet
            open({ title: spec.title, options: spec.kebab.map(function (k) { return { label: k.label, value: k }; }) })
              .then(function (k) { if (k && typeof k.act === "function") k.act(); });
          };
          head.appendChild(kb);
        } else if (dismissible) {
          var cl = el("button", "hs-kebab", "×"); cl.type = "button"; cl.setAttribute("aria-label", "Close");
          cl.onclick = function () { settle(dismissValue); };
          head.appendChild(cl);
        }
        body.appendChild(head);
      }

      if (spec.message) body.appendChild(el("p", "hs-msg", spec.message));

      // option grid (a choice sheet)
      var opts = normOpts(spec.options);
      if (opts.length) {
        var grid = el("div", "hs-grid" + (opts.length === 1 ? " one" : ""));
        opts.forEach(function (o) {
          var b = el("button", "hs-opt" + (o.thumb ? " has-thumb" : "")); b.type = "button";
          if (o.thumb) { var im = el("img"); im.src = o.thumb; im.alt = ""; im.loading = "lazy"; b.appendChild(im); }
          b.appendChild(el("span", null, o.label));
          if (o.sub) b.appendChild(el("span", "hs-sub", o.sub));
          b.onclick = function () { settle(o.value); };
          grid.appendChild(b);
        });
        body.appendChild(grid);
      }

      // explicit actions (confirm/alert)
      if (spec.actions && spec.actions.length) {
        var row = el("div", "hs-actions");
        spec.actions.forEach(function (a) {
          var b = el("button", "hs-opt" + (a.variant ? " " + a.variant : "")); b.type = "button";
          b.textContent = a.label;
          b.onclick = function () { settle(a.value); };
          row.appendChild(b);
        });
        body.appendChild(row);
      }

      // native dismissal: Esc fires `cancel`, scrim click is detected by target===dialog.
      dlg.addEventListener("cancel", function (e) { e.preventDefault(); if (dismissible) settle(dismissValue); });
      dlg.addEventListener("click", function (e) { if (e.target === dlg && dismissible) settle(dismissValue); });

      (DOC.body || DOC.documentElement).appendChild(dlg);
      try { dlg.showModal(); } catch (e) { dlg.setAttribute("open", ""); }   // <dialog> fallback
    });
  }

  // ── sugar ────────────────────────────────────────────────────────────────────
  function ask(title, options) { return open({ title: title, options: options }); }

  function confirm(message, opts) {
    opts = opts || {};
    return open({
      title: opts.title || "", message: message, dismissValue: false,
      actions: [
        { label: opts.cancel || "Cancel", value: false },
        { label: opts.ok || "OK", value: true, variant: opts.danger ? "danger" : "primary" }
      ]
    });
  }

  function alert(message, opts) {
    opts = opts || {};
    return open({ title: opts.title || "", message: message, dismissValue: true,
      actions: [{ label: opts.ok || "OK", value: true, variant: "primary" }] });
  }

  W.HoloSheet = { open: open, ask: ask, confirm: confirm, alert: alert };
})();
