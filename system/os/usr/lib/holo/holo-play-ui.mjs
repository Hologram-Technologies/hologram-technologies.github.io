// holo-play-ui.mjs — Play IS the Living Map. Opening ▶ Play fills the desktop canvas with the
// honeycomb of every Hologram app (apps/spaces, embedded), not a scroll-list in a drawer. The map
// owns its own controls (category chips · filter/ask · Playground · zoom — all themed to the OS);
// this module just HOSTS it full-canvas and bridges a hex-dive to the OS's real κ-launch so an app
// opens as a proper tab. Mounts once and stays warm — reopening is instant.
//
//   mountPlay(verbBtn, { launch })  — launch(it) opens it.id (a κ) as a real shell tab.

export function mountPlay(trigger, { launch } = {}) {
  injectStyles();
  let overlay = null, frame = null, open = false, wired = false;

  function build() {
    overlay = document.createElement("div"); overlay.id = "holo-play-overlay"; overlay.className = "holo-play-ov";
    frame = document.createElement("iframe"); frame.className = "holo-play-frame"; frame.title = "Play — the Living Map of every app";
    frame.setAttribute("allow", "fullscreen; clipboard-write");
    frame.src = "/apps/spaces/index.html?embed=play";
    overlay.appendChild(frame);
    document.body.appendChild(overlay);
    frame.addEventListener("load", wire);
  }
  // Bridge the map's hex-dive → the OS's real κ-launch (open the app as a tab, then close Play).
  function wire() {
    // Give the Play frame the OS's per-app Q — the SAME bridge the shell injects into every app frame
    // (holo-q-app.js auto-installs window.Q in a sub-frame, routed to the one Q over the governed
    // postMessage channel). This lights up the map's "ask" filter (its Q upgrade) inside Play.
    try {
      const d = frame.contentDocument;
      if (d && !d.getElementById("holo-q-app")) {
        const s = d.createElement("script"); s.id = "holo-q-app"; s.type = "module";
        s.setAttribute("data-holo-ephemeral", ""); s.src = "/_shared/q/holo-q-app.js";
        (d.head || d.documentElement).appendChild(s);
      }
    } catch (e) {}
    let tries = 0;
    (function bind() {
      let w = null; try { w = frame.contentWindow; } catch (e) {}
      const map = w && w.HoloSpacesMap;
      if (map) { map.onOpen = (info) => { close(); try { launch && launch(info || {}); } catch (e) {} }; wired = true; return; }
      if (++tries < 80) setTimeout(bind, 80);
    })();
  }
  function show() {
    if (!overlay) build();
    open = true; overlay.classList.add("on"); document.documentElement.classList.add("holo-play-on");
    if (!wired) wire();
    if (trigger) { trigger.classList.add("on"); trigger.setAttribute("aria-expanded", "true"); }
  }
  function close() {
    open = false; if (overlay) overlay.classList.remove("on"); document.documentElement.classList.remove("holo-play-on");
    if (trigger) { trigger.classList.remove("on"); trigger.setAttribute("aria-expanded", "false"); }
  }
  function toggle() { open ? close() : show(); }

  if (trigger) { trigger.setAttribute("aria-expanded", "false"); trigger.addEventListener("click", (e) => { e.preventDefault(); toggle(); }); }
  window.addEventListener("keydown", (e) => { if (e.key === "Escape" && open) { close(); } });

  return { open: show, close, toggle, isOpen: () => open };
}

function injectStyles() {
  if (document.getElementById("holo-play-styles")) return;
  const s = document.createElement("style"); s.id = "holo-play-styles";
  // The map fills the same canvas the live app occupies (below the top chrome), with the OS's rounded
  // bottom corners — so Play reads as the desktop blooming into a map, not a panel sliding in.
  s.textContent = `
  .holo-play-ov{ position:fixed; top:var(--chrome-h); z-index:50;
    left:calc(var(--holo-dock-w,0px) + var(--holo-aside-l,0px) + var(--gap));
    right:calc(var(--gap) + var(--holo-aside-w,0px));
    bottom:calc(var(--holo-dock-h,0px) + var(--gap-b));
    border-radius:0 0 var(--card-r,22px) var(--card-r,22px); overflow:hidden; background:#07040f;
    opacity:0; transform:scale(.997); pointer-events:none; transition:opacity .28s ease, transform .28s cubic-bezier(.2,.8,.2,1); }
  .holo-play-ov.on{ opacity:1; transform:none; pointer-events:auto; }
  .holo-play-frame{ width:100%; height:100%; border:0; background:#07040f; display:block; }`;
  document.head.appendChild(s);
}

export default { mountPlay };
