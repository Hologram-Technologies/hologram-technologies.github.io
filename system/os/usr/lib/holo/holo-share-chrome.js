// holo-share-chrome.js — the share-to-run chrome (ADR-064, Phase 0).
//
// The growth loop's spine. When a GUEST opens a shared holospace link
// (holospace.html?app=<id>#k=<κ>) the projection mounts the app FULLSCREEN and lays
// this thin, OS-level chrome OVER it — outside the app's sandboxed iframe, so it is the
// substrate speaking, not the app (the app can never forge it). It carries one continuous
// story across the whole guest journey:
//
//   arrive  →  "this is a Hologram app, running live on your device — private, yours"
//   remix   →  one tap opens YOUR editable copy in the World shell (build)
//   share   →  your version is its own link; send it, your recipient arrives here
//   save    →  "keep it forever, open your Space on any device" — the pull to sign up
//
// Signup is PULLED by the user's own creation, never pushed before value. Guest work is
// real and local; signing in binds it to a self-sovereign key so it travels (Law L1).
//
// Self-contained: no build step, no framework. Renders only when the projection asks
// (a shared landing), so bare kiosk embeds stay clean. Token-driven (--holo-*, the 16px
// readability floor, ADR-0057) and reduced-motion aware (ADR-0062).

(function () {
  "use strict";
  const W = window;
  if (W.HoloShareChrome) return;

  const NS = "holo-sc";
  const $ = (sel, root) => (root || document).querySelector(sel);
  const el = (tag, attrs, kids) => {
    const e = document.createElement(tag);
    for (const k in (attrs || {})) {
      if (k === "class") e.className = attrs[k];
      else if (k === "html") e.innerHTML = attrs[k];
      else if (k === "text") e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    for (const c of (kids || [])) e.appendChild(c);
    return e;
  };
  const reduceMotion = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

  // ── inline glyphs (no dependency on <holo-icon> being defined in the frame) ──────────
  const ICON = {
    remix: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M10 20H4v-6"/><path d="M20 4 4 20"/></svg>',
    share: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5 8.6 10.5"/></svg>',
    save: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    spark: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2l1.9 5.6L19.5 9l-4.6 3.3L16.4 18 12 14.8 7.6 18l1.5-5.7L4.5 9l5.6-1.4L12 2z"/></svg>',
  };

  function injectStyle() {
    if (document.getElementById(NS + "-css")) return;
    const s = document.createElement("style"); s.id = NS + "-css";
    // A dark glass palette with --holo-* fallbacks (colors are identity; fonts ride the
    // token floor so the cascade can never drop below 16px — ADR-0057).
    s.textContent = `
      .${NS}-root{position:fixed;inset:auto 0 0 0;z-index:2147483002;pointer-events:none;
        font:var(--holo-text-sm,1rem)/1.4 system-ui,-apple-system,sans-serif;color:var(--holo-fg,#e8e6f0)}
      .${NS}-bar{pointer-events:auto;display:flex;align-items:center;gap:.7rem;flex-wrap:wrap;
        margin:0 auto;max-width:min(980px,96vw);padding:.55rem .7rem;
        background:color-mix(in srgb, var(--holo-bg,#0b071e) 78%, transparent);
        border:1px solid var(--holo-border,#2a2347);border-bottom:0;border-radius:var(--holo-radius,16px) var(--holo-radius,16px) 0 0;
        backdrop-filter:blur(14px) saturate(1.2);box-shadow:0 -10px 40px rgba(0,0,0,.45)}
      .${NS}-id{display:flex;align-items:center;gap:.45rem;min-width:0;flex:1 1 auto}
      .${NS}-chip{display:inline-flex;align-items:center;gap:.35rem;padding:.28rem .6rem;border-radius:999px;
        background:color-mix(in srgb, var(--holo-accent,#7c5cff) 16%, transparent);
        border:1px solid color-mix(in srgb, var(--holo-accent,#7c5cff) 45%, transparent);
        color:var(--holo-accent-fg,#cdbfff);font:var(--holo-text-sm,1rem)/1 ui-monospace,monospace;white-space:nowrap}
      .${NS}-chip.ok{background:color-mix(in srgb,#2dd4bf 14%,transparent);border-color:#2dd4bf66;color:#7defc9}
      .${NS}-name{font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:38vw}
      .${NS}-sub{opacity:.62;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .${NS}-acts{display:flex;align-items:center;gap:.45rem;flex:0 0 auto}
      .${NS}-btn{pointer-events:auto;display:inline-flex;align-items:center;gap:.4rem;cursor:pointer;
        padding:.5rem .85rem;border-radius:calc(var(--holo-radius,16px) * .7);border:1px solid var(--holo-border,#2a2347);
        background:color-mix(in srgb, var(--holo-fg,#e8e6f0) 6%, transparent);color:inherit;
        font:inherit;font-weight:600;transition:transform .12s ease,background .15s ease,border-color .15s ease}
      .${NS}-btn:hover{background:color-mix(in srgb, var(--holo-fg,#e8e6f0) 12%, transparent);border-color:var(--holo-accent,#7c5cff)}
      .${NS}-btn:active{transform:translateY(1px)}
      .${NS}-btn.pri{background:var(--holo-accent,#7c5cff);border-color:var(--holo-accent,#7c5cff);color:var(--holo-on-accent,#0b071e)}
      .${NS}-btn.pri:hover{filter:brightness(1.08)}
      .${NS}-btn.ghost{background:transparent;border-color:transparent;opacity:.82}
      .${NS}-btn.ghost:hover{opacity:1;background:color-mix(in srgb, var(--holo-fg,#e8e6f0) 8%, transparent)}
      .${NS}-brand{display:inline-flex;align-items:center;gap:.35rem;text-decoration:none;color:inherit;opacity:.6;
        white-space:nowrap;font-weight:600}
      .${NS}-brand:hover{opacity:.92}
      /* κ-Open Phase 3 — RECEDE: the OS chrome must never dominate the app. When idle the bar dims to a faint
         icon strip that peeks at the bottom edge; any pointer/key activity (or hover) wakes it to full labels,
         then it re-dims after a beat. Safe-area aware so it clears the home bar. The app stays full-bleed. */
      .${NS}-root{transition:opacity .55s ease}
      .${NS}-bar{transition:transform .45s cubic-bezier(.2,.85,.25,1),filter .45s ease,background .3s ease,box-shadow .45s ease;
        padding-bottom:calc(.55rem + env(safe-area-inset-bottom,0px))}
      .${NS}-name,.${NS}-sub,.${NS}-chip span,.${NS}-btn span,.${NS}-brand span{
        transition:max-width .38s ease,opacity .3s ease,margin .3s ease;max-width:42vw;overflow:hidden}
      .${NS}-root.recede{opacity:.2}
      .${NS}-root.recede .${NS}-bar{transform:translateY(42%);filter:saturate(.55);
        background:color-mix(in srgb, var(--holo-bg,#0b071e) 40%, transparent);box-shadow:none}
      .${NS}-root.recede .${NS}-name,.${NS}-root.recede .${NS}-sub,.${NS}-root.recede .${NS}-chip span,
      .${NS}-root.recede .${NS}-btn span,.${NS}-root.recede .${NS}-brand span{max-width:0;opacity:0;margin:0}
      .${NS}-root.recede:hover{opacity:1}
      .${NS}-root.recede:hover .${NS}-bar{transform:none;filter:none}
      /* arrival banner */
      .${NS}-hello{pointer-events:none;position:fixed;left:50%;top:14px;transform:translateX(-50%) translateY(-6px);
        z-index:2147483003;display:flex;align-items:center;gap:.5rem;max-width:92vw;
        padding:.55rem .95rem;border-radius:999px;opacity:0;
        background:color-mix(in srgb, var(--holo-bg,#0b071e) 82%, transparent);border:1px solid var(--holo-border,#2a2347);
        backdrop-filter:blur(12px);box-shadow:0 12px 40px rgba(0,0,0,.5);color:var(--holo-fg,#e8e6f0);
        transition:opacity .4s ease,transform .4s ease}
      .${NS}-hello.in{opacity:1;transform:translateX(-50%) translateY(0)}
      .${NS}-hello b{font-weight:700}.${NS}-hello span{opacity:.7}
      /* save sheet */
      .${NS}-scrim{pointer-events:auto;position:fixed;inset:0;z-index:2147483004;display:grid;place-items:center;
        background:rgba(6,4,18,.62);backdrop-filter:blur(3px);opacity:0;transition:opacity .2s ease}
      .${NS}-scrim.in{opacity:1}
      .${NS}-sheet{width:min(440px,92vw);padding:1.6rem 1.5rem;border-radius:var(--holo-radius,16px);
        background:var(--holo-bg,#120c2e);border:1px solid var(--holo-border,#2a2347);
        box-shadow:0 30px 80px rgba(0,0,0,.6);transform:translateY(8px) scale(.99);transition:transform .2s ease}
      .${NS}-scrim.in .${NS}-sheet{transform:none}
      .${NS}-sheet h3{margin:.2rem 0 .5rem;font-size:1.35rem;font-weight:750;letter-spacing:-.01em}
      .${NS}-sheet p{margin:.3rem 0;opacity:.78;line-height:1.5}
      .${NS}-sheet ul{margin:.7rem 0;padding:0;list-style:none;display:grid;gap:.45rem}
      .${NS}-sheet li{display:flex;align-items:flex-start;gap:.55rem;opacity:.9}
      .${NS}-sheet li svg{flex:0 0 auto;margin-top:.15rem;color:#7defc9}
      .${NS}-sheet .${NS}-actions{margin-top:1.1rem;display:flex;gap:.6rem}
      .${NS}-sheet .${NS}-btn{flex:1;justify-content:center;padding:.7rem 1rem}
      /* toast */
      .${NS}-toast{pointer-events:none;position:fixed;left:50%;bottom:5.2rem;transform:translateX(-50%);
        z-index:2147483005;max-width:90vw;padding:.6rem .95rem;border-radius:12px;
        background:#11181c;color:#e6edf3;border:1px solid #243038;box-shadow:0 12px 36px rgba(0,0,0,.5);
        opacity:0;transition:opacity .18s}
      .${NS}-toast.in{opacity:1}
      @media (prefers-reduced-motion: reduce){
        .${NS}-hello,.${NS}-scrim,.${NS}-sheet,.${NS}-toast,.${NS}-btn{transition:none !important}
        .${NS}-hello{transform:translateX(-50%)}
        .${NS}-root,.${NS}-bar,.${NS}-name,.${NS}-sub,.${NS}-chip span,.${NS}-btn span,.${NS}-brand span{transition:none !important}
        .${NS}-root.recede .${NS}-bar{transform:none}      /* dim, never slide */
      }`;
    document.head.appendChild(s);
  }

  let toastT;
  function toast(msg) {
    injectStyle();
    let t = $("." + NS + "-toast");
    if (!t) { t = el("div", { class: NS + "-toast" }); document.body.appendChild(t); }
    t.textContent = msg; requestAnimationFrame(() => t.classList.add("in"));
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("in"), 3400);
  }

  // short κ: did:holo:sha256:abcd… → "sha256:abcd…"
  const shortK = (k) => {
    const str = String(k || "");
    const hex = str.split(":").pop() || "";
    const alg = /sha256/.test(str) ? "sha256" : /blake3/.test(str) ? "blake3" : (str.split(":")[0] || "κ");
    return alg + ":" + hex.slice(0, 8) + "…";
  };

  // ── the share link: the app referenced by content address + stamped with #k= so the
  //    recipient re-enters the magic (the frame routes any #k= link to the fullscreen mount
  //    + this chrome). Built explicitly so it resolves even if THIS landing used a hash. ──
  function shareUrl(ctx) {
    const ref = ctx.link || ctx.raw || ctx.kappa || "";   // holo://hex (Law L1) preferred
    const u = new URL(location.pathname, location.origin);
    if (ref) u.searchParams.set("app", ref);
    return u.href + "#k=" + encodeURIComponent(ctx.kappa || "");
  }
  async function doShare(ctx) {
    const url = shareUrl(ctx);
    const data = { title: (ctx.name || "A Hologram app") + " · on hologram",
      text: "Opens on any device and runs instantly — no install, always verified.", url };
    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare(data))) { await navigator.share(data); return; }
    } catch (e) { if (e && e.name === "AbortError") return; }
    try { await navigator.clipboard.writeText(url); toast("Link copied — anyone can open it instantly, no sign-in ✦"); }
    catch { W.prompt && W.prompt("Share this Hologram link:", url); }
  }

  // ── remix: open YOUR editable copy in the World shell (the build surface). ────────────
  function doRemix(ctx) {
    const u = new URL("/shell.html", location.href);
    u.searchParams.set("open", ctx.raw || ctx.kappa || "");
    u.searchParams.set("remix", "1");
    location.href = u.href;
  }

  // ── save: the conversion. Guest → "create your Space" (the proven biometric sign-in,
  //    with a return path back here); already signed in → it's yours, mark it saved. ─────
  async function hasIdentity() {
    try {
      const mod = await import(new URL("_shared/holo-identity.mjs", location.href).href);
      const r = await mod.roster();
      return Array.isArray(r) && r.length > 0;
    } catch { return false; }
  }
  function gotoSignup(ctx) {
    const u = new URL("login.html", location.href);
    u.searchParams.set("next", location.href);
    u.searchParams.set("intent", "save");
    location.href = u.href;
  }
  function openSaveSheet(ctx, signedIn) {
    injectStyle();
    const li = (t) => el("li", {}, [Object.assign(el("span", { html: ICON.check }), {}), el("span", { text: t })]);
    const sheet = el("div", { class: NS + "-sheet" }, [
      el("h3", { text: signedIn ? "Save to your Space" : "Keep this — create your Space" }),
      el("p", { text: signedIn
        ? "This app lives in your Space, on every device you sign in to. Private, yours, and always verified."
        : "You’re running this as a guest. Create your Space to keep it forever and open it on any device — it takes one tap with your device’s passkey. No password, no email." }),
      el("ul", {}, [li("Your apps, saved and synced to your key"), li("Open your Space on any device"), li("Private by default — your key never leaves the device")]),
      el("div", { class: NS + "-actions" }, [
        el("button", { class: NS + "-btn pri", html: ICON.save + "<span>" + (signedIn ? "Save it" : "Create my Space") + "</span>" }),
        el("button", { class: NS + "-btn ghost", text: "Not now" }),
      ]),
    ]);
    const scrim = el("div", { class: NS + "-scrim" }, [sheet]);
    const close = () => { scrim.classList.remove("in"); setTimeout(() => scrim.remove(), reduceMotion() ? 0 : 220); };
    scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
    const [primary, secondary] = sheet.querySelectorAll("." + NS + "-btn");
    secondary.onclick = close;
    primary.onclick = () => {
      if (signedIn) { close(); toast("Saved to your Space ✓"); /* Phase 3: pin/publish the κ so it resolves anywhere */ }
      else { gotoSignup(ctx); }
    };
    document.body.appendChild(scrim);
    requestAnimationFrame(() => scrim.classList.add("in"));
  }
  async function onSave(ctx) { openSaveSheet(ctx, await hasIdentity()); }

  // ── the arrival moment: a brief, warm "you’re running on Hologram" then it settles. ───
  function arrival(ctx) {
    injectStyle();
    const hello = el("div", { class: NS + "-hello", html:
      ICON.spark + "<span><b>Running on Hologram</b> — live on your device. Private. No install.</span>" });
    document.body.appendChild(hello);
    requestAnimationFrame(() => hello.classList.add("in"));
    setTimeout(() => { hello.classList.remove("in"); setTimeout(() => hello.remove(), 500); }, reduceMotion() ? 2200 : 3600);
  }

  function bar(ctx) {
    injectStyle();
    const brandHref = new URL("find.html", location.href).href;
    const root = el("div", { class: NS + "-root" }, [
      el("div", { class: NS + "-bar" }, [
        el("div", { class: NS + "-id" }, [
          el("span", { class: NS + "-chip ok", html: ICON.check + " <span>" + shortK(ctx.kappa) + "</span>" }),
          el("span", { class: NS + "-name", text: ctx.name || "Hologram app" }),
          el("span", { class: NS + "-sub", text: "· yours to remix" }),
        ]),
        el("div", { class: NS + "-acts" }, [
          el("button", { class: NS + "-btn pri", title: "Make your own editable copy", html: ICON.remix + "<span>Remix</span>" }),
          el("button", { class: NS + "-btn", title: "Send this as a link", html: ICON.share + "<span>Share</span>" }),
          el("button", { class: NS + "-btn", title: "Keep it forever, on any device", html: ICON.save + "<span>Save</span>" }),
          el("a", { class: NS + "-brand", href: brandHref, title: "What is Hologram?", html: ICON.spark + "<span>Made on Hologram</span>" }),
        ]),
      ]),
    ]);
    const [remixB, shareB, saveB] = root.querySelectorAll("." + NS + "-btn");
    remixB.onclick = () => doRemix(ctx);
    shareB.onclick = () => doShare(ctx);
    saveB.onclick = () => onSave(ctx);
    document.body.appendChild(root);
    recede(root);
  }

  // recede(root) — keep the OS chrome from dominating the app. After a grace (so the arrival moment reads),
  // the bar dims to a faint icon strip; any pointer/key activity wakes it to full labels for a beat, then it
  // re-dims. Hover holds it awake. Pure presentation — the remix/share/save actions are always reachable.
  function recede(root) {
    const AWAKE = 2600, GRACE = 4200;
    let t = 0;
    const sleep = () => root.classList.add("recede");
    const wake = () => { root.classList.remove("recede"); clearTimeout(t); t = setTimeout(sleep, AWAKE); };
    t = setTimeout(sleep, GRACE);                                   // settle into recede shortly after arrival
    for (const ev of ["pointermove", "pointerdown", "keydown", "focusin"]) W.addEventListener(ev, wake, { passive: true });
    root.addEventListener("pointerenter", () => { root.classList.remove("recede"); clearTimeout(t); });
    root.addEventListener("pointerleave", wake);
  }

  // mount({ name, kappa, link, raw }) — called by the projection (holospace.html) once the
  // app is mounted on a SHARED landing. Idempotent.
  function mount(ctx) {
    ctx = ctx || {};
    if (document.querySelector("." + NS + "-root")) return;
    bar(ctx);
    arrival(ctx);
  }

  W.HoloShareChrome = { mount, toast };
})();
