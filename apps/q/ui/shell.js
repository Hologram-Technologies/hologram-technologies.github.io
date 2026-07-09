// ui/shell.js — builds the three-zone DOM skeleton (nav · main · panel) plus the shared
// chrome: toasts, backdrop, modals root. Returns the element handles the feature modules
// mount into. No business logic here — layout + zone toggling only.

export const SVG = {
  plus: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  search: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  menu: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  dots: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  edit: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.5 3.5a1.6 1.6 0 0 1 2.3 2.3L12 14.5l-3 .8.8-3z"/><path d="M12 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>',
  copy: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  ok: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  regen: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>',
  fork: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="5" r="2.2"/><circle cx="18" cy="5" r="2.2"/><circle cx="12" cy="19" r="2.2"/><path d="M6 7v2a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4V7"/><path d="M12 13v4"/></svg>',
  up: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 11l5-5 5 5"/><path d="M12 6v13"/></svg>',
  down: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 13l-5 5-5-5"/><path d="M12 18V5"/></svg>',
  speak: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  mic: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>',
  star: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="m12 2 3 6.6 7 .7-5.2 4.8 1.5 7-6.3-3.7L5.7 21l1.5-7L2 9.3l7-.7z"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.7l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.7-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.7.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.7 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.7.3h.1a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 1 1.5h.1a1.6 1.6 0 0 0 1.7-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.7v.1a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.5 1z"/></svg>',
  share: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"/><path d="M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>',
  panel: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></svg>',
  chev: '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 6.5 8 3.5l3 3"/><path d="M5 9.5 8 12.5l3-3"/></svg>',
  right: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>',
  left1: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  right1: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
  archive: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/></svg>',
  thumbU: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12"/><path d="M15 5.9 14 10h5.5a2 2 0 0 1 1.9 2.6l-2.2 7A2 2 0 0 1 17.3 21H7V10l4.5-7a2.4 2.4 0 0 1 3.5 2.9z"/></svg>',
  thumbD: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V2"/><path d="M9 18.1 10 14H4.5a2 2 0 0 1-1.9-2.6l2.2-7A2 2 0 0 1 6.7 3H17v11l-4.5 7a2.4 2.4 0 0 1-3.5-2.9z"/></svg>',
  chat: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-8 8H4l2.5-2.5A8 8 0 1 1 21 12z"/></svg>',
  cowork: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/></svg>',
  codeMode: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 7-5 5 5 5"/><path d="m16 7 5 5-5 5"/></svg>',
  box: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/></svg>',
  book: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4a2 2 0 0 0-2-2H6.5A2.5 2.5 0 0 0 4 4.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/></svg>',
  spark: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 2c.6 4.8 2.4 7.4 5 8.6 1.6.8 3.3 1.2 5 1.4-4.8.6-7.4 2.4-8.6 5-.8 1.6-1.2 3.3-1.4 5-.6-4.8-2.4-7.4-5-8.6-1.6-.8-3.3-1.2-5-1.4 4.8-.6 7.4-2.4 8.6-5 .8-1.6 1.2-3.3 1.4-5z"/></svg>',
};

export function mountShell(root, { t }) {
  root.innerHTML = `
    <div class="app">
      <nav class="nav" id="nav" aria-label="Conversations">
        <div class="nav-head">
          <span class="brand"><img src="./icon.svg" alt="" /><span class="word">Holo Q</span></span>
        </div>
        <div class="mode-switch" id="modeswitch" role="tablist" aria-label="Mode">
          <button data-mode="chat" role="tab">${SVG.chat} ${t("com_mode_chat")}</button>
          <button data-mode="cowork" role="tab">${SVG.cowork} ${t("com_mode_cowork")}</button>
          <button data-mode="code" role="tab">${SVG.codeMode} ${t("com_mode_code")}</button>
        </div>
        <button class="newchat-btn" id="newchat"><span class="plus">${SVG.plus}</span> ${t("com_nav_new_chat")} <span class="kbd">Alt+N</span></button>
        <div class="nav-links">
          <button id="navartifacts">${SVG.box} ${t("com_nav_artifacts")}</button>
          <button id="navlibrary">${SVG.book} ${t("com_nav_library")}</button>
          <button id="navcustomize">${SVG.gear} ${t("com_nav_customize")}</button>
        </div>
        <div class="nav-search"><span class="mag">${SVG.search}</span><input id="navsearch" placeholder="${t("com_nav_search")}" aria-label="${t("com_nav_search")}" /></div>
        <div class="nav-group recents-label">${t("com_nav_recents")}</div>
        <div class="nav-list" id="navlist"></div>
        <div class="nav-foot">
          <button id="navarchived">${SVG.archive} ${t("com_nav_show_archived")}</button>
        </div>
      </nav>

      <main class="main" id="main">
        <header class="chat-head">
          <button class="iconbtn" id="navtoggle" title="Sidebar (Alt+S)" aria-label="Toggle sidebar">${SVG.menu}</button>
          <span class="spacer"></span>
          <span class="chat-title" id="chattitle"></span>
          <span class="spacer"></span>
          <button class="iconbtn" id="sharebtn" title="${t("com_ui_share")}" disabled>${SVG.share}</button>
          <button class="iconbtn" id="paneltoggle" title="Panel">${SVG.panel}</button>
        </header>

        <div class="scroller" id="scroller">
          <div class="landing" id="landing" hidden></div>
          <div class="thread" id="thread"></div>
        </div>

        <div class="composer"><div class="inner" style="position:relative">
          <div class="greet" id="greet" hidden><span class="gspark">${SVG.spark}</span><span id="greettext"></span><div class="gtag" id="greettag"></div></div>
          <div class="status" id="status"></div>
          <div class="cmd-menu" id="cmdmenu" hidden></div>
          <div class="model-menu" id="modelmenu" hidden role="menu"></div>
          <div class="cbox">
            <textarea id="user" placeholder="${t("com_ui_ask_anything")}" rows="1" aria-label="${t("com_ui_ask_anything")}"></textarea>
            <div class="crow">
              <button class="iconbtn" id="plusbtn" title="${t("com_ui_plus_tip")}">${SVG.plus}</button>
              <button class="iconbtn mic" id="micbtn" title="${t("com_ui_speech_input")}">${SVG.mic}</button>
              <span class="grow"></span>
              <button class="model-chip" id="modelbtn" aria-haspopup="menu"><span class="vbadge" id="modelbadge" hidden></span><span class="nm" id="modelname">${t("com_ui_choose_model")}</span><span class="chev">${SVG.chev}</span></button>
              <button class="send" id="submit" title="${t("com_ui_send")}" disabled>↑</button>
            </div>
          </div>
          <div class="chips" id="chips" hidden></div>
        </div></div>
      </main>

      <aside class="panel" id="panel" aria-label="Details">
        <div class="panel-tabs" id="paneltabs"></div>
        <div class="panel-body" id="panelbody"></div>
      </aside>
    </div>
    <div class="backdrop" id="backdrop" hidden></div>
    <div class="shroud" id="modals" hidden></div>
    <div class="toast-host" id="toasts"></div>`;

  const $ = (id) => root.querySelector("#" + id);
  const els = {};
  for (const id of ["nav","modeswitch","newchat","navartifacts","navlibrary","navcustomize","navsearch","navlist","navarchived","main","navtoggle","modelbtn","modelbadge","modelname","modelmenu","chattitle","sharebtn","paneltoggle","scroller","landing","thread","greet","greettext","greettag","status","cmdmenu","user","plusbtn","micbtn","submit","chips","panel","paneltabs","panelbody","backdrop","modals","toasts"]) els[id] = $(id);

  const syncBackdrop = () => {
    const navDrawer = window.innerWidth <= 900 && !document.body.classList.contains("nav-closed");
    const panelSheet = window.innerWidth <= 1100 && document.body.classList.contains("panel-open");
    els.backdrop.hidden = !(navDrawer || panelSheet);
  };
  const setNav = (open) => { document.body.classList.toggle("nav-closed", !open); syncBackdrop(); };
  const setPanel = (open) => { document.body.classList.toggle("panel-open", open); syncBackdrop(); };
  els.backdrop.onclick = () => { setNav(false); setPanel(false); };

  const toast = (msg) => { const d = document.createElement("div"); d.className = "toast"; d.textContent = msg; els.toasts.appendChild(d); setTimeout(() => d.remove(), 2600); };

  return { els, setNav, setPanel, toast };
}
