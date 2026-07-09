// holo-messenger-keys.mjs — the NATIVE CEF keyboard layer, brought to the web messenger (github.io/Q).
//
// The Hologram native browser (shell.html + shell-main.mjs) has a full keyboard system: a spotlight
// (Ctrl K), a command palette (Ctrl ⇧ P), a `?` cheat sheet, an ambient "hold-Ctrl" hint dot, and Esc
// to dismiss — all driven by the ONE dependency-free engine `/usr/lib/holo/holo-keys.js` (createKeymap).
// The web messenger shipped without any of it. This module ports the SAME system, populated with
// messenger-appropriate commands, and mounts it ONLY in desktop mode (wide viewport + a real pointer).
//
// Design, faithful to the native:
//   · one keymap → every action a content-addressed command, O(1) resolution, the whole map hashable.
//   · the hint dot is a single breathing point of light; HOLD the OS modifier → it blooms a live legend
//     projected from the keymap (every command flagged `hint`); long-press to banish (persisted); tap → cheat.
//   · additive + fail-soft: a missing DOM hook makes a command a quiet no-op, never an error.
//
// It never loads inside the native shell (which already owns these keys) or inside an embedded frame.

import { createKeymap } from "../../usr/lib/holo/holo-keys.js";

(function () {
  "use strict";
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const W = window, D = document;

  // ── activation gate ───────────────────────────────────────────────────────────────────────────
  // Desktop only: a wide viewport AND a fine pointer (a phone has no keyboard, so the layer is inert
  // there and the dot stays hidden — "desktop mode only"). Skip when the native shell already provides
  // the layer, and skip when embedded (the host frame owns the keys). Idempotent.
  try {
    if (W.__holoKeysMounted) return;
    if (W.top !== W.self) return;                                              // embedded → host owns keys
    if (W.cefQuery || W.__world || D.documentElement.classList.contains("native-chrome")) return; // native shell
    const wide = W.matchMedia && W.matchMedia("(min-width: 760px)").matches;
    const fine = W.matchMedia && W.matchMedia("(pointer: fine)").matches;
    if (!wide || !fine) return;
    W.__holoKeysMounted = true;
  } catch (e) { return; }

  const apple = (() => { try { return /mac|iphone|ipad|ipod/i.test(navigator.platform || "") || /mac os/i.test(navigator.userAgent || ""); } catch { return false; } })();
  const modSymbol = apple ? "⌘" : "Ctrl";
  const $ = (s, r) => (r || D).querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ── styles — the messenger's dark-glass vocabulary (teal accent), matching the shell's shapes ────
  const ACCENT = "#7defc9";
  const style = D.createElement("style");
  style.id = "hk-css";
  style.textContent = `
  :root{ --hk-accent:${ACCENT}; }
  #hk-scrim,#hk-cheat{ position:fixed; inset:0; z-index:2147482000; display:none; background:rgba(4,7,12,.52);
    backdrop-filter:blur(3px); align-items:flex-start; justify-content:center; font-family:"Segoe UI",system-ui,-apple-system,sans-serif; }
  #hk-scrim.open,#hk-cheat.open{ display:flex; }
  #hk-scrim .hk-sheet{ width:min(40rem,94vw); margin-top:14vh; background:#0d1117; border:1px solid #30363d;
    border-radius:14px; box-shadow:0 24px 80px rgba(0,0,0,.6); overflow:hidden; animation:hk-rise .16s cubic-bezier(.4,0,.2,1); }
  @keyframes hk-rise{ from{ opacity:0; transform:translateY(-6px) scale(.99); } to{ opacity:1; transform:none; } }
  #hk-scrim .hk-title{ padding:9px 16px 0; font-size:12px; letter-spacing:.04em; text-transform:uppercase; color:#6e7681; }
  #hk-scrim input{ width:100%; box-sizing:border-box; background:transparent; border:0; outline:0; color:#e6edf3;
    font-size:18px; padding:14px 16px; font-family:inherit; }
  #hk-scrim .hk-results{ max-height:52vh; overflow:auto; border-top:1px solid #21262d; }
  #hk-scrim .hk-row{ display:flex; align-items:center; gap:12px; padding:10px 16px; cursor:pointer; color:#c9d1d9; font-size:15px; }
  #hk-scrim .hk-row .hk-ic{ width:22px; text-align:center; opacity:.9; flex:0 0 auto; }
  #hk-scrim .hk-row .hk-grp{ margin-left:auto; color:#6e7681; font-size:12px; }
  #hk-scrim .hk-row kbd,#hk-cheat kbd{ background:#21262d; border:1px solid #30363d; border-radius:6px; padding:2px 8px;
    font:600 12px ui-monospace,monospace; color:#e6edf3; white-space:nowrap; }
  #hk-scrim .hk-row.sel{ background:color-mix(in srgb,var(--hk-accent) 16%,transparent); color:#fff; }
  #hk-scrim .hk-row.sel .hk-grp{ color:#b9c2cf; }
  #hk-scrim .hk-empty{ padding:16px; color:#6e7681; font-size:14px; }
  /* cheat sheet */
  #hk-cheat .hk-sheet{ width:min(56rem,94vw); margin-top:8vh; background:#0d1117; border:1px solid #30363d;
    border-radius:14px; box-shadow:0 24px 80px rgba(0,0,0,.6); overflow:hidden; animation:hk-rise .16s cubic-bezier(.4,0,.2,1); }
  #hk-cheat .cheat-h{ padding:14px 18px; border-bottom:1px solid #21262d; font:600 16px inherit; color:#e6edf3; }
  #hk-cheat .cheat-h .muted{ color:#8b949e; font-weight:400; }
  #hk-cheat .cheat-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(15rem,1fr)); gap:16px; padding:16px; max-height:60vh; overflow:auto; }
  #hk-cheat .cheat-col h4{ margin:0 0 8px; font:600 12px inherit; color:var(--hk-accent); text-transform:uppercase; letter-spacing:.05em; }
  #hk-cheat .cheat-row{ display:flex; justify-content:space-between; align-items:center; gap:12px; padding:5px 0; font-size:14px; color:#c9d1d9; }
  #hk-cheat .cheat-f{ padding:12px 18px; border-top:1px solid #21262d; font-size:13px; color:#8b949e; }
  #hk-cheat .cheat-f .k{ color:#58a6ff; font-family:ui-monospace,monospace; }
  #hk-cheat .cheat-link{ background:0; border:0; padding:0; cursor:pointer; font:inherit; color:#58a6ff; text-decoration:underline; text-underline-offset:2px; }

  /* ambient which-key dot — one breathing point of light; hold the modifier → it blooms a legend. */
  #hk-dot{ position:fixed; left:50%; bottom:16px; transform:translateX(-50%); z-index:2147481900; display:none;
    align-items:center; gap:9px; pointer-events:none; }
  #hk-dot.show{ display:inline-flex; }
  #hk-dot .hk-core{ display:block; width:8px; height:8px; padding:0; border:0; border-radius:50%; cursor:pointer; pointer-events:auto;
    background:var(--hk-accent); box-shadow:0 0 10px 0 color-mix(in srgb,var(--hk-accent) 70%,transparent); animation:hk-breathe 3.6s ease-in-out infinite; }
  @keyframes hk-breathe{ 0%,100%{ opacity:.5; transform:scale(1); } 50%{ opacity:1; transform:scale(1.25); } }
  #hk-dot .hk-core.arming{ animation:none; transform:scale(.55); opacity:.85; transition:transform .6s ease,opacity .6s ease; }
  #hk-dot .hk-tag{ white-space:nowrap; pointer-events:auto; cursor:pointer; opacity:.82; color:#9aa4b2; font:13px "Segoe UI",system-ui,sans-serif;
    transition:opacity .2s ease,transform .2s ease; }
  #hk-dot .hk-tag kbd{ background:#21262d; border:1px solid #30363d; border-radius:5px; margin:0 1px; padding:1px 6px; font:600 12px ui-monospace,monospace; color:#e6edf3; }
  #hk-dot.bloom .hk-tag{ opacity:0; transform:translateX(4px); pointer-events:none; }
  #hk-dot .hk-legend{ position:absolute; left:50%; bottom:calc(100% + 10px); transform:translate(-50%,6px) scale(.96); transform-origin:50% 100%;
    display:flex; gap:6px; flex-wrap:wrap; justify-content:center; width:max-content; max-width:min(92vw,58rem);
    background:#0d1117; border:1px solid #30363d; border-radius:12px; padding:8px 10px; box-shadow:0 16px 50px rgba(0,0,0,.55);
    opacity:0; pointer-events:none; transition:opacity .16s ease,transform .16s ease; }
  #hk-dot.bloom .hk-legend{ opacity:1; transform:translate(-50%,0) scale(1); pointer-events:auto; }
  #hk-dot.bloom .hk-core{ opacity:.35; }
  #hk-dot .hk-chip{ display:inline-flex; align-items:center; gap:7px; background:0; border:0; cursor:pointer; color:#9aa4b2; font:13px inherit;
    padding:3px 6px; border-radius:8px; opacity:.0; transform:translateY(3px); transition:opacity .18s ease,transform .18s ease,color .15s ease; }
  #hk-dot.bloom .hk-chip{ opacity:1; transform:translateY(0); }
  #hk-dot .hk-chip:hover{ color:#e8edf6; }
  #hk-dot .hk-chip kbd{ background:#21262d; border:1px solid #30363d; border-radius:6px; padding:2px 7px; font:600 12px ui-monospace,monospace; color:#e6edf3; white-space:nowrap; }
  @media (prefers-reduced-motion:reduce){ #hk-dot .hk-core{ animation:none; } #hk-dot .hk-legend,#hk-dot .hk-chip{ transition:opacity .16s ease; transform:none; } }
  @media (max-width:760px){ #hk-dot{ display:none !important; } }
  `;
  (D.head || D.documentElement).appendChild(style);

  // ── overlay DOM ──────────────────────────────────────────────────────────────────────────────
  const mk = (html) => { const d = D.createElement("div"); d.innerHTML = html; return d.firstElementChild; };
  const scrim = mk(`<div id="hk-scrim"><div class="hk-sheet"><div class="hk-title"></div><input autocomplete="off" spellcheck="false"/><div class="hk-results"></div></div></div>`);
  const cheat = mk(`<div id="hk-cheat"><div class="hk-sheet"></div></div>`);
  const dot = mk(`<div id="hk-dot"><button class="hk-core" type="button" aria-label="Keyboard shortcuts" title="Shortcuts"></button><span class="hk-tag"></span><div class="hk-legend"></div></div>`);
  D.body.appendChild(scrim); D.body.appendChild(cheat); D.body.appendChild(dot);
  const sTitle = $(".hk-title", scrim), sInput = $("input", scrim), sResults = $(".hk-results", scrim);
  // click the backdrop to dismiss
  [scrim, cheat].forEach((s) => s.addEventListener("click", (e) => { if (e.target === s) closeAll(); }));

  // ── messenger actions — every one fail-soft (a missing hook is a quiet no-op) ────────────────────
  const clickFirst = (sels) => { for (const sel of sels) { const el = $(sel); if (el) { el.click(); return true; } } return false; };
  const focusSearch = () => {
    const el = $('.cs-search input, input[type="search"], input[placeholder*="search" i], input[aria-label*="search" i]');
    if (el) { el.focus(); try { el.select(); } catch {} return true; } return false;
  };
  const newChat = () => clickFirst(['[data-hk="new-chat"]', '[title*="new chat" i]', '[aria-label*="new chat" i]', '[title*="new message" i]', '.cs-button--new']);
  const summonQ = () => {
    if (clickFirst([".holo-home-orb", ".holo-global-orb", ".holo-hero-orb"])) return true;
    try { if (W.HoloQ && W.HoloQ.summon) { W.HoloQ.summon(); return true; } } catch {}
    return false;
  };
  const convRows = () => [...D.querySelectorAll(".cs-conversation, [role='listitem'].cs-conversation, .holo-conv, [data-conversation]")];
  const cycleChat = (dir) => {
    const rows = convRows(); if (!rows.length) return false;
    let i = rows.findIndex((r) => /(--active|\bactive\b|selected)/.test(r.className) || r.getAttribute("aria-selected") === "true");
    if (i < 0) i = dir > 0 ? -1 : 0;
    const next = rows[((i + dir) % rows.length + rows.length) % rows.length];
    if (next) { next.click(); try { next.scrollIntoView({ block: "nearest" }); } catch {} return true; }
    return false;
  };
  const signOut = () => { try { if (W.holo && W.holo.signOut) { W.holo.signOut(); return true; } } catch {} return false; };
  // open a sibling Hologram app — "../<dir>/" from /apps/holo-messenger/app.html resolves to /apps/<dir>/,
  // correct whether the bundle is served at the origin root or a subpath (e.g. /Q/).
  const openApp = (dir) => { try { W.open(new URL("../" + dir + "/", location.href).href, "_blank", "noopener"); return true; } catch { return false; } };

  // ── the keymap — messenger-appropriate commands (mirrors the shell's binding style) ──────────────
  const km = createKeymap({ apple, seqMs: 900 });
  km.bind("mod+k", () => openSpot(), { id: "spotlight", title: "Search & open…", group: "Go", hint: "Search" });
  km.bind("mod+shift+p", () => openPalette(), { id: "palette", title: "Command palette", group: "Go" });
  km.bind("mod+f", () => focusSearch(), { id: "find", title: "Search messages", group: "Go", hint: "Find" });
  km.bind("?", () => openCheat(), { id: "help", title: "Keyboard shortcuts", group: "Help", hint: "Shortcuts" });
  km.bind("esc", () => closeAll(), { id: "escape", title: "Close / dismiss", group: "Help", global: true });
  km.bind("mod+]", () => cycleChat(1), { id: "chat-next", title: "Next conversation", group: "Chats", hint: "Chats" });
  km.bind("mod+[", () => cycleChat(-1), { id: "chat-prev", title: "Previous conversation", group: "Chats" });
  km.bind(["mod+shift+m", "g c"], () => newChat(), { id: "new-chat", title: "New chat", group: "Chats" });
  km.bind(["mod+shift+q", "g q"], () => summonQ(), { id: "ask-q", title: "Ask Q", group: "Q", hint: "Ask Q" });
  // open Hologram apps — command-only (no raw chord), so they surface in the spotlight + palette + legend of ?.
  const APPS = [
    ["Holo Q", "q", "◍"], ["Holo Browser", "browser", "🌐"], ["Holo Tube", "video", "▶"],
    ["Holo Music", "music", "♪"], ["Holo Hub", "hub", "⬡"], ["Holo Games", "holo-games", "🎮"],
    ["Holo Wallet", "holo-money", "💳"], ["Holo Spaces", "spaces", "▦"],
  ];
  for (const [name, dir, ic] of APPS) km.bind([], () => openApp(dir), { id: "app:" + dir, title: "Open " + name, group: "Open", icon: ic });
  km.bind([], () => signOut(), { id: "sign-out", title: "Lock & sign out", group: "Session" });

  km.attach(W);

  // Standalone/PWA: the browser's own Ctrl+Tab is free → honour it too (km can't express a non-mod Ctrl).
  const standalone = (() => { try { return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; } catch { return false; } })();
  if (standalone) addEventListener("keydown", (e) => { if (e.ctrlKey && e.key === "Tab") { e.preventDefault(); cycleChat(e.shiftKey ? -1 : 1); } }, true);

  // ── the content address of the whole keymap (share the link → a peer re-derives your shortcuts) ──
  let keymapDid = "";
  (async () => { try {
    const buf = new TextEncoder().encode(km.canonical());
    const h = await crypto.subtle.digest("SHA-256", buf);
    keymapDid = "holo://" + [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 30) + "…";
  } catch {} })();

  // ── spotlight + command palette — one overlay, searchable, arrow-key driven ──────────────────────
  let mode = "spot", list = [], sel = 0;
  const commandsFor = (m) => km.registry.filter((c) => c.title && (m === "pal" ? true : c.group !== "Session"));
  function render(term) {
    const t = (term || "").toLowerCase();
    list = commandsFor(mode).filter((c) => (c.title + " " + c.group).toLowerCase().includes(t));
    sel = 0; paint();
  }
  function paint() {
    sResults.innerHTML = list.length ? list.map((c, i) =>
      `<div class="hk-row${i === sel ? " sel" : ""}" data-i="${i}"><span class="hk-ic">${c.icon || "›"}</span><span>${esc(c.title)}</span>`
      + (km.label(c.spec) && !/^app:/.test(c.id) ? `<kbd class="hk-grp">${esc(km.label(c.spec))}</kbd>` : `<span class="hk-grp">${esc(c.group)}</span>`)
      + `</div>`).join("") : `<div class="hk-empty">No matches</div>`;
    [...sResults.querySelectorAll(".hk-row[data-i]")].forEach((r) => {
      r.onmouseenter = () => { sel = +r.dataset.i; mark(); };
      r.onclick = () => runSel(+r.dataset.i);
    });
  }
  const mark = () => [...sResults.querySelectorAll(".hk-row[data-i]")].forEach((r, i) => r.classList.toggle("sel", i === sel));
  function runSel(i) { const c = list[i != null ? i : sel]; closeAll(); if (c) try { c.run(); } catch {} }
  function openOverlay(m) { mode = m; scrim.classList.add("open"); sTitle.textContent = m === "pal" ? "Command palette" : "Search & open"; sInput.value = ""; sInput.placeholder = m === "pal" ? "Run a command…" : "Search commands, open an app…"; render(""); sInput.focus(); }
  const openSpot = () => openOverlay("spot");
  const openPalette = () => openOverlay("pal");
  sInput.addEventListener("input", () => render(sInput.value));
  sInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(sel + 1, list.length - 1); mark(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(sel - 1, 0); mark(); }
    else if (e.key === "Enter") { e.preventDefault(); runSel(); }
    else if (e.key === "Escape") { e.preventDefault(); closeAll(); }
  });

  // ── the cheat sheet (press ?), OS-adapted, with the keymap's content address ─────────────────────
  function openCheat() {
    const groups = {};
    for (const c of km.registry) { if (!c.title) continue; (groups[c.group] = groups[c.group] || []).push(c); }
    const hidden = dotHidden();
    $(".hk-sheet", cheat).innerHTML =
      `<div class="cheat-h">Keyboard shortcuts <span class="muted">· ${apple ? "macOS" : "Windows"}</span></div><div class="cheat-grid">`
      + Object.entries(groups).map(([g, cs]) => `<div class="cheat-col"><h4>${esc(g)}</h4>`
        + cs.map((c) => `<div class="cheat-row"><span>${esc(c.title)}</span>${km.label(c.spec) && !/^app:/.test(c.id) && c.id !== "sign-out" ? `<kbd>${esc(km.label(c.spec))}</kbd>` : ""}</div>`).join("")
        + `</div>`).join("")
      + `</div><div class="cheat-f">your keymap is content-addressed <span class="k">${esc(keymapDid || "…")}</span>`
      + ` · <button type="button" class="cheat-link" data-hint-toggle>${hidden ? "show the hint dot" : "hide the hint dot"}</button></div>`;
    cheat.classList.add("open");
  }
  cheat.addEventListener("click", (e) => { if (!e.target.closest("[data-hint-toggle]")) return; setDotHidden(!dotHidden()); openCheat(); });

  function closeAll() { scrim.classList.remove("open"); cheat.classList.remove("open"); bloom(false); }

  // ── the ambient hint dot — hold the modifier → bloom the live legend (projected from the keymap) ──
  const legend = $(".hk-legend", dot), core = $(".hk-core", dot), tag = $(".hk-tag", dot);
  legend.innerHTML = km.registry.filter((c) => c.hint).map((c) =>
    `<button class="hk-chip" type="button" tabindex="-1" data-run="${c.id}" title="${esc(c.title)}"><kbd>${esc(km.label(c.spec))}</kbd><span>${esc(c.hint)}</span></button>`).join("");
  core.title = "Shortcuts — hold " + modSymbol;
  tag.innerHTML = `<kbd>${modSymbol}</kbd> for shortcuts`;

  const DKEY = "holo.hints.dismissed.v1";
  const dotHidden = () => { try { return localStorage.getItem(DKEY) === "1"; } catch { return false; } };
  const setDotHidden = (on) => { try { localStorage.setItem(DKEY, on ? "1" : "0"); } catch {} syncDot(); };
  const syncDot = () => dot.classList.toggle("show", !dotHidden());

  let bloomed = false;
  const bloom = (on) => { if (on === bloomed) return; bloomed = on; dot.classList.toggle("bloom", on); };
  const isMod = (e) => (apple ? e.key === "Meta" : e.key === "Control");
  addEventListener("keydown", (e) => { if (!e.repeat && isMod(e) && dot.classList.contains("show") && !scrim.classList.contains("open") && !cheat.classList.contains("open")) bloom(true); }, true);
  addEventListener("keyup", (e) => { if (isMod(e)) bloom(false); }, true);
  addEventListener("blur", () => bloom(false));
  D.addEventListener("visibilitychange", () => { if (D.hidden) bloom(false); });

  // long-press the dot to banish it (persisted); a short tap opens the cheat sheet; a chip runs its command.
  let pressT = null, didLong = false;
  const disarm = () => { clearTimeout(pressT); pressT = null; core.classList.remove("arming"); };
  core.addEventListener("pointerdown", (e) => {
    if (e.button) return; didLong = false; core.classList.add("arming");
    pressT = setTimeout(() => { didLong = true; disarm(); bloom(false); setDotHidden(true); }, 600);
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((t) => core.addEventListener(t, disarm));
  dot.addEventListener("click", (e) => {
    if (didLong) { didLong = false; e.preventDefault(); e.stopPropagation(); return; }
    const chip = e.target.closest(".hk-chip");
    if (chip) { try { km.run(chip.dataset.run); } catch {} return; }
    openCheat();
  });
  syncDot();

  // ── test surface (a headless witness / the console can drive the layer) ──────────────────────────
  W.HoloKeys = { km, openSpot, openPalette, openCheat, closeAll, get keymapDid() { return keymapDid; },
    actions: { focusSearch, newChat, summonQ, cycleChat, openApp, signOut } };
  try { console.info("[holo-keys] desktop keyboard layer live ·", km.registry.filter((c) => c.title).length, "commands ·", modSymbol + " K spotlight · ? shortcuts"); } catch {}
})();
