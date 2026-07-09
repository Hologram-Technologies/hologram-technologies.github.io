// holo-edit.js — the REMIX layer. Everything in a holospace is a κ-addressed, self-verifying object
// rendered live in the browser, so any object can be inspected, edited, forked and shared in place —
// with no server, low latency, and the SAME surface for humans (right-click) and agents (window.HoloEdit.api).
//
// One gesture, one panel — no persistent chrome, nothing to learn:
//   right-click any object → Edit · Share · Move · Hide · Delete
//   the panel bundles INSPECT (κ · type · what it's composed of) + EDIT (source). Save mints a NEW κ
//   (a fork, not a mutation — Law L1), auto-persists it (survives reload, Law L2/L5), re-renders live,
//   and hands you a self-verifying share link. Effortless: persistence + the link are automatic.
//
// Agents get the identical powers through window.HoloEdit.api (inspect/source/edit/render/share/spawn) —
// every step is a κ they can re-derive and verify, so a human and an agent remix the same live objects.
(function () {
  "use strict";
  if (window.HoloEdit && window.HoloEdit.api) return;
  var HR = function () { return window.HoloRender; };
  var menu = null, panel = null, undo = [];
  var short = function (k) { var h = String(k || "").split(":").pop(); return h ? h.slice(0, 8) + "…" + h.slice(-6) : "—"; };
  var kHex = function (k) { return "holo://sha256:" + String(k || "").split(":").pop(); };

  function css() {
    if (document.getElementById("holo-edit-css")) return;
    var s = document.createElement("style"); s.id = "holo-edit-css";
    s.textContent = [
      ".holo-mx{--mx-bg:var(--holo-bg,#0d1117);--mx-fg:var(--holo-fg,#e6edf3);--mx-bd:var(--holo-border,#30363d);--mx-mut:var(--holo-muted,#8b949e);--mx-acc:var(--holo-accent,#1f6feb)}",
      ".holo-mx-menu{position:fixed;z-index:2147483600;min-width:184px;background:var(--mx-bg);color:var(--mx-fg);border:1px solid var(--mx-bd);border-radius:12px;padding:5px;font:16px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 14px 44px #000b;user-select:none}",
      ".holo-mx-menu .hdr{display:flex;align-items:center;gap:7px;padding:6px 9px 8px;color:var(--mx-mut);font:16px ui-monospace,monospace;border-bottom:1px solid var(--mx-bd);margin-bottom:4px}",
      ".holo-mx-menu .hdr .dot{width:7px;height:7px;border-radius:50%;background:var(--mx-acc)}",
      ".holo-mx-menu .it{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:8px;cursor:pointer}",
      ".holo-mx-menu .it:hover{background:color-mix(in srgb,var(--mx-acc) 18%,transparent)}",
      ".holo-mx-menu .it .ic{width:16px;text-align:center;opacity:.85} .holo-mx-menu .it .sc{margin-left:auto;color:var(--mx-mut);font:16px ui-monospace,monospace}",
      ".holo-mx-menu .sep{height:1px;background:var(--mx-bd);margin:4px 2px}",
      ".holo-mx-hi{outline:2px solid var(--holo-accent,#1f6feb)!important;outline-offset:1px!important}",
      ".holo-mx-panel{position:fixed;right:18px;bottom:18px;z-index:2147483602;width:min(580px,94vw);height:min(460px,72vh);display:flex;flex-direction:column;background:var(--mx-bg);color:var(--mx-fg);border:1px solid var(--mx-bd);border-radius:14px;box-shadow:0 26px 80px #000c;overflow:hidden}",
      ".holo-mx-panel .top{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--mx-bd)}",
      ".holo-mx-panel .tab{padding:5px 11px;border-radius:8px;cursor:pointer;font:16px system-ui;color:var(--mx-mut)} .holo-mx-panel .tab.on{background:color-mix(in srgb,var(--mx-acc) 18%,transparent);color:var(--mx-fg)}",
      ".holo-mx-panel .kpill{margin-left:auto;font:16px ui-monospace,monospace;color:var(--mx-mut);cursor:pointer} .holo-mx-panel .x{cursor:pointer;padding:2px 6px;color:var(--mx-mut)}",
      ".holo-mx-panel .body{flex:1;overflow:auto;min-height:0}",
      ".holo-mx-panel textarea{width:100%;height:100%;border:0;outline:0;resize:none;padding:12px;box-sizing:border-box;background:#010409;color:#e6edf3;font:16px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;tab-size:2}",
      ".holo-mx-panel .insp{padding:12px;font:16px/1.7 system-ui} .holo-mx-panel .insp .row{display:flex;gap:8px;padding:3px 0} .holo-mx-panel .insp .lab{color:var(--mx-mut);min-width:80px} .holo-mx-panel .insp .mono{font:16px ui-monospace,monospace;word-break:break-all}",
      ".holo-mx-panel .child{display:inline-flex;align-items:center;gap:6px;margin:3px 6px 3px 0;padding:3px 8px;border:1px solid var(--mx-bd);border-radius:999px;font:16px ui-monospace,monospace;cursor:pointer}",
      ".holo-mx-panel .ft{display:flex;align-items:center;gap:8px;padding:9px 12px;border-top:1px solid var(--mx-bd);font:16px system-ui}",
      ".holo-mx-panel .lin{color:var(--mx-mut);font:16px ui-monospace,monospace} .holo-mx-panel .sp{margin-left:auto}",
      ".holo-mx-panel button{border:1px solid var(--mx-bd);background:#161b22;color:var(--mx-fg);border-radius:8px;padding:6px 13px;font:16px system-ui;cursor:pointer}",
      ".holo-mx-panel button.pr{background:var(--mx-acc);border-color:transparent;color:#fff}",
      ".holo-mx-toast{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:2147483603;background:#11181c;color:#e6edf3;border:1px solid #30363d;border-radius:9px;padding:8px 14px;font:16px system-ui;box-shadow:0 8px 24px #0009;opacity:0;transition:opacity .15s} .holo-mx-toast.in{opacity:1}",
      ".holo-mx-lib{position:fixed;left:18px;bottom:18px;z-index:2147483602;width:min(340px,92vw);height:min(440px,70vh);display:flex;flex-direction:column;background:var(--mx-bg);color:var(--mx-fg);border:1px solid var(--mx-bd);border-radius:14px;box-shadow:0 26px 80px #000c;overflow:hidden}",
      ".holo-mx-lib .lh{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--mx-bd);font:16px system-ui}",
      ".holo-mx-lib .lh .q{flex:1;background:#010409;color:var(--mx-fg);border:1px solid var(--mx-bd);border-radius:7px;padding:5px 9px;font:16px system-ui;outline:none} .holo-mx-lib .lh .x{cursor:pointer;color:var(--mx-mut)}",
      ".holo-mx-lib .lg{flex:1;overflow:auto;padding:8px;display:grid;grid-template-columns:1fr 1fr;gap:6px;align-content:start}",
      ".holo-mx-lib .lc{display:flex;flex-direction:column;gap:2px;padding:8px 9px;border:1px solid var(--mx-bd);border-radius:9px;cursor:grab;background:#0f141a} .holo-mx-lib .lc:hover{border-color:var(--mx-acc)} .holo-mx-lib .lc b{font:16px system-ui;font-weight:600} .holo-mx-lib .lc span{font:16px ui-monospace,monospace;color:var(--mx-mut)}",
      ".holo-mx-lib .lf{padding:8px 12px;border-top:1px solid var(--mx-bd);font:16px system-ui;color:var(--mx-mut)}",
    ].join("");
    (document.head || document.documentElement).appendChild(s);
    document.documentElement.classList.add("holo-mx");
  }
  var toastEl, toastT;
  function toast(m) { css(); if (!toastEl) { toastEl = document.createElement("div"); toastEl.className = "holo-mx-toast"; document.body.appendChild(toastEl); } toastEl.textContent = m; toastEl.classList.add("in"); clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove("in"); }, 2000); }
  var copy = function (t) { try { navigator.clipboard && navigator.clipboard.writeText(t); } catch (e) {} };

  function objectAt(t) { return (t.closest && t.closest("[data-holo-kappa]")) || t; }
  function kappaOf(el) { var k = el && el.closest && el.closest("[data-holo-kappa]"); return k ? k.getAttribute("data-holo-kappa") : null; }
  // a remixed object is shareable as a self-verifying link — the canonical κ-viewer renders any κ.
  // Cross-device share — the link carries the OBJECT, not a reference to a server. We pack the (gzipped)
  // bytes into the URL FRAGMENT (never sent to any host) next to its κ; the recipient re-derives the κ
  // from the bytes (Law L5) before rendering, so the link is self-verifying + serverless + works on any
  // device/browser. Big objects fall back to a κ-only link (resolved via a peer/gateway source).
  var b64u = { enc: function (u8) { var b = ""; for (var i = 0; i < u8.length; i++) b += String.fromCharCode(u8[i]); return btoa(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); } };
  async function packBytes(u8) {
    var data = u8, mode = "r";
    try { if (self.CompressionStream) { var cs = new CompressionStream("gzip"); var w = cs.writable.getWriter(); w.write(u8); w.close(); data = new Uint8Array(await new Response(cs.readable).arrayBuffer()); mode = "g"; } } catch (e) {}
    return mode + b64u.enc(data);
  }
  async function shareLink(k) {
    var url = location.origin + "/apps/ui/render.html#k=" + encodeURIComponent(kHex(k));
    try { var bytes = await HR().resolve(k); if (bytes && bytes.length <= 131072) return url + "&o=" + await packBytes(bytes); } catch (e) {}
    return url;                                                       // >128KB or unresolved → κ-only (needs a source)
  }
  async function doShare(k) { var u = await shareLink(k); copy(u); toast(u.indexOf("&o=") > 0 ? "self-verifying link copied — opens on any device" : "κ link copied"); return u; }

  // ── React components: edit the readable .tsx, recompile VIA THE FORGE → a new module κ ──────────────
  // A compiled component object's bytes are minified JS; editing should be on its SOURCE. We reverse-map
  // module-κ → its .tsx (via the ui registry), and on Save lazily load the Forge's esbuild compiler (12MB,
  // ONLY when compiling — never on the render hot path) and bundle it exactly as the registry does (deps
  // inlined; react/motion external for the linker) → a new module κ that renders instantly. Authoring is
  // the one-time slow step; rendering stays the fast resolve-by-κ path.
  var FT = "/apps/forge/ts", _eb;
  var VENDOR = { "class-variance-authority": FT + "/vendor/cva.js", clsx: FT + "/vendor/clsx.js", "tailwind-merge": FT + "/vendor/tw-merge.js", "radix-ui": FT + "/vendor/radix.js" };
  var EXT = { react: 1, "react-dom": 1, "react/jsx-runtime": 1, "react-dom/client": 1, "motion/react": 1 };
  async function compiler() { if (_eb) return _eb; var m = await import(FT + "/esbuild.js"); try { await m.initialize({ wasmURL: FT + "/esbuild.wasm" }); } catch (e) {} _eb = m; return m; }
  function holoPlugin() { return { name: "holo", setup: function (b) {
    b.onResolve({ filter: /.*/ }, function (a) { var p = a.path; if (a.kind === "entry-point") return;
      if (EXT[p]) return { path: p, external: true };
      if (VENDOR[p]) return { path: VENDOR[p], namespace: "h" };
      if (p.indexOf("@/") === 0) return { path: FT + "/ui-src/" + p.slice(2), namespace: "h" };
      if (p[0] === "." || p[0] === "/") { var base = (a.importer || "/").replace(/[^/]*$/, ""); return { path: new URL(p, "http://x" + base).pathname, namespace: "h" }; }
      return { path: p, external: true }; });
    b.onLoad({ filter: /.*/, namespace: "h" }, async function (a) { var u = a.path;
      var cands = /\.(tsx?|jsx?|mjs)$/.test(u) ? [u] : [u + ".ts", u + ".tsx", u + ".js", u + "/index.ts"];
      for (var i = 0; i < cands.length; i++) { var r = await fetch(cands[i]); if (r.ok) { var s = await r.text(), e = cands[i].split(".").pop(); return { contents: s, loader: e === "tsx" ? "tsx" : e === "jsx" ? "jsx" : e === "ts" ? "ts" : "js" }; } }
      return { errors: [{ text: "not found " + u }] }; }); } }; }
  async function compileTsx(tsx, name) { var eb = await compiler();
    var o = await eb.build({ stdin: { contents: tsx, loader: "tsx", sourcefile: (name || "c") + ".tsx", resolveDir: "/" }, bundle: true, format: "esm", platform: "browser", minify: true, jsx: "automatic", external: Object.keys(EXT), plugins: [holoPlugin()], write: false, define: { "process.env.NODE_ENV": '"production"' } });
    return o.outputFiles[0].text; }
  async function reactSrc(k) { var hk = kHex(k);
    for (var i = 0; i < 2; i++) { var base = ["/apps/ui", "/ui"][i];
      try { var idx = await (await fetch(base + "/registry/index.json")).json(); var c = (idx.components || []).find(function (x) { return kHex(x.holo || x.import) === hk; });
        if (c) { try { return { name: c.name, tsx: await (await fetch(base + "/registry/src/" + c.name + ".tsx")).text() }; } catch (e) { return null; } } } catch (e) {} }
    return null; }

  // ── time-travel: an edit mints a κ, so old→new IS the history. One tiny map (childκ→parentκ) makes
  // a remix's whole lineage walkable, branchable, diffable — infinite undo that's shareable + verifiable.
  // Complexity hidden behind: chainOf(κ) → [genesis…κ]. (The objects themselves are already κ-addressed +
  // durable, so each version re-renders instantly; we only persist the cheap parent links.)
  var LIN = "holo:lineage";
  function linMap() { try { return JSON.parse(localStorage.getItem(LIN) || "{}"); } catch (e) { return {}; } }
  function recordFork(parent, child) { if (!parent || !child) return; var pk = kHex(parent), ck = kHex(child); if (pk === ck) return;
    try { var m = linMap(); m[ck] = { p: pk, t: Date.now() }; localStorage.setItem(LIN, JSON.stringify(m)); } catch (e) {} }
  function chainOf(k) { var m = linMap(), cur = kHex(k), chain = [cur], seen = {}; while (m[cur] && m[cur].p && !seen[cur]) { seen[cur] = 1; cur = m[cur].p; chain.unshift(cur); } return chain; }
  function lineDiff(a, b) { var A = (a || "").split("\n"), B = (b || "").split("\n"), sA = new Set(A), sB = new Set(B);
    return { added: B.filter(function (l) { return !sA.has(l); }), removed: A.filter(function (l) { return !sB.has(l); }) }; }

  // ── turtles all the way down: the tools are κ-objects too. The editor stashes its OWN source (and the
  // renderer's) so resolve(κ) works on them like any object → you can Inspect · Edit (fork) · Share the
  // editor itself. Right-clicking the editor's own panel/library opens it ON itself. Lazy + cached.
  var _self = null;
  async function selfKappa() {
    if (_self) return _self;
    async function k(url) { try { var b = new Uint8Array(await (await fetch(url)).arrayBuffer()); return await HR().stash(b); } catch (e) { return null; } }
    _self = { editor: await k("/_shared/holo-edit.js"), renderer: await k("/_shared/holo-render.js") };
    return _self;
  }

  function closeMenu() { if (menu) { menu.remove(); menu = null; } document.querySelectorAll(".holo-mx-hi").forEach(function (e) { if (!panel) e.classList.remove("holo-mx-hi"); }); }
  function openMenu(x, y, el) {
    closeMenu(); css(); var k = kappaOf(el);
    // Every object gets the SAME menu (Inspect · Edit · Share · Move · Hide · Delete) — identical in the
    // shell and every app. On a shell-MANAGED window, move/hide/delete DELEGATE to the shell's own window
    // manager (window.__world, by node id) so they actually stick; in a plain app they act on the DOM (⌘Z
    // undo). Abstract the difference, deliver one consistent gesture.
    var sid = (window.__world && el.id && typeof window.__world.setState === "function" && el.closest && el.closest("[data-holo-managed]")) ? el.id : null;
    var chrome = !!(el.closest && el.closest("[data-holo-chrome]"));   // a wired shell region (dock/tabs/omni/verbs) — κ-ops only
    menu = document.createElement("div"); menu.className = "holo-mx-menu";
    var items = [
      { ic: "◉", label: "Inspect", sc: "κ", dis: !k, fn: function () { openPanel(el, k, "inspect"); } },
      { ic: "✎", label: "Edit", sc: "source", dis: !k, fn: function () { openPanel(el, k, "edit"); } },
      { ic: "↗", label: "Share", sc: k ? short(k) : "", dis: !k, fn: function () { doShare(k); } }];
    if (!chrome) items.push(
      { sep: 1 },
      { ic: "✥", label: "Move", fn: function () { enableDrag(el, sid); } },
      { ic: "◐", label: "Hide", fn: function () { if (sid) { window.__world.setState(sid, "min"); toast("hidden"); } else { undo.push({ el: el, prev: el.style.display }); el.style.display = "none"; toast("hidden · ⌘Z"); } } },
      { ic: "✕", label: "Delete", fn: function () { if (sid) { window.__world.removeNode(sid); toast("deleted"); } else { var ph = document.createComment("holo"); el.replaceWith(ph); undo.push({ ph: ph, el: el }); toast("deleted · ⌘Z"); } } });
    var hdr = document.createElement("div"); hdr.className = "hdr"; hdr.innerHTML = '<span class="dot"></span>' + (k ? short(k) : "object");
    menu.appendChild(hdr);
    items.forEach(function (it) {
      if (it.sep) { var s = document.createElement("div"); s.className = "sep"; menu.appendChild(s); return; }
      var d = document.createElement("div"); d.className = "it"; d.innerHTML = '<span class="ic">' + it.ic + "</span>" + it.label + (it.sc ? '<span class="sc">' + it.sc + "</span>" : "");
      if (it.dis) { d.style.opacity = ".4"; d.style.cursor = "default"; } else d.onclick = function () { closeMenu(); it.fn(); };
      menu.appendChild(d);
    });
    document.body.appendChild(menu);
    var r = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, innerWidth - r.width - 8) + "px"; menu.style.top = Math.min(y, innerHeight - r.height - 8) + "px";
    el.classList.add("holo-mx-hi");
  }

  // ── the one panel: INSPECT (κ · type · composition) ⊕ EDIT (source) ──────────────────────────────
  async function openPanel(el, k, tab) {
    css(); if (panel) panel.remove();
    panel = document.createElement("div"); panel.className = "holo-mx-panel";
    panel.innerHTML =
      '<div class="top"><span class="tab" data-tab="inspect">Inspect</span><span class="tab" data-tab="edit">Edit</span>' +
      '<span class="kpill" title="copy κ">' + short(k) + '</span><span class="x">✕</span></div>' +
      '<div class="body"></div>' +
      '<div class="ft"><span class="lin"></span><span class="sp"></span><button class="gh" data-share>↗ Share</button><button class="pr" data-save>Save → new κ</button></div>';
    document.body.appendChild(panel);
    var body = panel.querySelector(".body"), lin = panel.querySelector(".lin");
    panel.querySelector(".x").onclick = function () { panel.remove(); panel = null; el.classList.remove("holo-mx-hi"); };
    panel.querySelector(".kpill").onclick = function () { copy(kHex(k)); toast("κ copied"); };
    panel.querySelector("[data-share]").onclick = function () { doShare(k); };
    var ta, _tsx = null;
    async function showInspect() {
      setTab("inspect"); var info = await window.HoloEdit.api.inspect(k); var chain = chainOf(k), ci = chain.indexOf(kHex(k));
      body.innerHTML = '<div class="insp"><div class="row"><span class="lab">κ</span><span class="mono">' + kHex(k) + '</span></div>' +
        '<div class="row"><span class="lab">type</span><b>' + info.type + '</b></div>' +
        '<div class="row"><span class="lab">bytes</span>' + info.bytes + '</div>' +
        (info.exports && info.exports.length ? '<div class="row"><span class="lab">exports</span>' + info.exports.join(", ") + '</div>' : "") +
        (info.children && info.children.length ? '<div class="row" style="display:block"><span class="lab">composed of</span><div style="margin-top:5px">' + info.children.map(function (c) { return '<span class="child" data-k="' + c + '">◆ ' + short(c) + "</span>"; }).join("") + "</div></div>" : "") +
        // history: scrub versions (each is a κ → re-renders instantly); diff previous→now; Edit any = branch
        '<div class="row" style="display:block"><span class="lab">history</span><div style="margin-top:5px;display:flex;flex-wrap:wrap;align-items:center;gap:4px">' +
        chain.map(function (c, i) { return '<span class="child" data-k="' + c + '" data-ver="1"' + (i === ci ? ' style="border-color:var(--mx-acc);color:var(--mx-fg)"' : "") + '>v' + (i + 1) + (i === ci ? " ·now" : "") + "</span>" + (i < chain.length - 1 ? '<span style="color:var(--mx-mut)">→</span>' : ""); }).join("") +
        (chain.length > 1 ? ' <span class="child" id="hmx-diff" title="what changed">⇄ diff</span>' : ' <span style="color:var(--mx-mut);font:16px ui-monospace">the original · edit to branch my own</span>') +
        "</div></div></div>";
      body.querySelectorAll(".child[data-k]").forEach(function (c) { var ver = c.hasAttribute("data-ver");
        c.onclick = function () { var nk2 = c.getAttribute("data-k"); if (ver) HR().render(el, nk2).catch(function () {}); openPanel(el, nk2, "inspect"); }; });   // version → scrub (time-travel) + drill; child → drill
      var dd = body.querySelector("#hmx-diff"); if (dd) dd.onclick = async function () {
        try { var prev = chain[ci > 0 ? ci - 1 : 0]; var d = lineDiff(await window.HoloEdit.api.source(prev), await window.HoloEdit.api.source(k));
          lin.innerHTML = "v" + (ci > 0 ? ci : 1) + " → v" + (ci + 1) + " · <b style='color:#3fb950'>+" + d.added.length + "</b> <b style='color:#f85149'>−" + d.removed.length + "</b> lines changed"; }
        catch (e) { toast("diff: " + (e.message || e)); } };
    }
    async function showEdit() {
      setTab("edit"); var src = null, info = {}; _tsx = null;
      try { info = await window.HoloEdit.api.inspect(k); } catch (e) {}
      if (info.type === "module") { try { var rc = await reactSrc(k); if (rc) { _tsx = rc; src = rc.tsx; } } catch (e) {} }   // readable .tsx
      if (src == null) { try { src = await window.HoloEdit.api.source(k); } catch (e) { src = "// source unavailable: " + (e.message || e); } }
      body.innerHTML = '<textarea spellcheck="false"></textarea>'; ta = body.querySelector("textarea"); ta.value = src; ta.focus();
      if (_tsx) lin.textContent = ".tsx — Save recompiles via Forge → new module κ";
    }
    function setTab(t) { panel.querySelectorAll(".tab").forEach(function (x) { x.classList.toggle("on", x.getAttribute("data-tab") === t); }); }
    panel.querySelectorAll(".tab").forEach(function (x) { x.onclick = function () { x.getAttribute("data-tab") === "edit" ? showEdit() : showInspect(); }; });
    panel.querySelector("[data-save]").onclick = async function () {
      if (!ta) { await showEdit(); return; }
      try {
        var bytes = ta.value;
        if (_tsx) { toast("compiling .tsx via Forge…"); bytes = await compileTsx(ta.value, _tsx.name); }   // recompile (lazy, off the hot path)
        var nk = await HR().stash(bytes);                                   // fork → new κ (auto-persisted)
        recordFork(k, nk);                                                  // remember old→new → the lineage is walkable
        el.setAttribute("data-holo-kappa", nk);
        if (el.__holoRoot) { try { el.__holoRoot.unmount(); } catch (e) {} el.__holoRoot = null; el.innerHTML = ""; }
        if (!(el.getAttribute && el.getAttribute("data-holo-chrome"))) { try { await HR().render(el, nk); } catch (e) {} }   // re-render live (non-fatal); chrome regions fork+share WITHOUT replacing the running shell
        lin.innerHTML = (_tsx ? "recompiled .tsx → " : "forked ") + short(k) + " → <b style='color:var(--holo-accent,#1f6feb)'>" + short(nk) + "</b> · saved · <span style='cursor:pointer;text-decoration:underline' id='holo-mx-sl'>copy link</span>";
        var sl = lin.querySelector("#holo-mx-sl"); if (sl) sl.onclick = function () { doShare(nk); };
        k = nk; _tsx = null; panel.querySelector(".kpill").textContent = short(nk); toast("remixed → " + short(nk));
      } catch (e) { toast("build error: " + (e.message || e)); }
    };
    (tab === "edit" ? showEdit : showInspect)();
    el.classList.add("holo-mx-hi");
  }

  function enableDrag(el, sid) {
    var cs = getComputedStyle(el); if (cs.position === "static") el.style.position = "relative"; el.classList.add("holo-mx-hi");
    var sx, sy, ox = parseFloat(el.style.left) || 0, oy = parseFloat(el.style.top) || 0;
    function move(e) { el.style.left = ox + (e.clientX - sx) + "px"; el.style.top = oy + (e.clientY - sy) + "px"; }
    function up() { ox = parseFloat(el.style.left) || 0; oy = parseFloat(el.style.top) || 0; document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); el.classList.remove("holo-mx-hi");
      if (sid && window.__world && window.__world.moveNode) { try { var w = document.getElementById("world") || el.offsetParent || document.body; var wr = w.getBoundingClientRect(), r = el.getBoundingClientRect(); el.style.left = ""; el.style.top = ""; window.__world.moveNode(sid, Math.round(r.left - wr.left), Math.round(r.top - wr.top)); } catch (e) {} }   // commit to the scene so it sticks
      toast("moved"); }
    function down(e) { sx = e.clientX; sy = e.clientY; e.preventDefault(); document.addEventListener("pointermove", move); document.addEventListener("pointerup", up); }
    el.addEventListener("pointerdown", down); toast("drag to move");
  }

  // ── the AGENT API — identical powers, programmatic. Humans right-click; agents call these. ──────────
  // ── the Library: every κ-object, draggable. Drag onto the screen to PLACE it, or onto another object
  // to COMPOSE a new one. Lego from content addresses — the result is itself a shareable κ. Loaded lazily.
  var lib = null, _items = null;
  async function libraryItems() {
    if (_items) return _items;
    for (var i = 0; i < 2; i++) { var base = ["/apps/ui", "/ui"][i];
      try { var idx = await (await fetch(base + "/registry/index.json")).json(); var comps = (idx.components || []).map(function (c) { return { name: c.name, k: c.holo || c.import }; });
        var bun = []; try { var bi = await (await fetch(base + "/registry/bundles/index.json")).json(); bun = (bi.bundles || []).map(function (b) { return { name: "▣ " + b.name, k: b.holo }; }); } catch (e) {}
        _items = bun.concat(comps); return _items; } catch (e) {} }
    return (_items = []);
  }
  function openLibrary() {
    css(); if (lib) { lib.remove(); lib = null; return; }
    lib = document.createElement("div"); lib.className = "holo-mx-lib";
    lib.innerHTML = '<div class="lh"><b>Library</b><input class="q" placeholder="search…" spellcheck="false"><span class="x">✕</span></div><div class="lg"></div><div class="lf">drag onto the screen to place · onto an object to compose</div>';
    document.body.appendChild(lib);
    lib.querySelector(".x").onclick = function () { lib.remove(); lib = null; };
    var grid = lib.querySelector(".lg");
    libraryItems().then(function (items) {
      function paint(f) { grid.innerHTML = items.filter(function (it) { return !f || it.name.toLowerCase().indexOf(f) >= 0; }).slice(0, 240).map(function (it) { return '<div class="lc" draggable="true" data-k="' + it.k + '"><b>' + it.name + '</b><span>' + short(it.k) + "</span></div>"; }).join("");
        grid.querySelectorAll(".lc").forEach(function (c) { c.ondragstart = function (e) { e.dataTransfer.setData("text/holo-kappa", c.getAttribute("data-k")); e.dataTransfer.effectAllowed = "copy"; lib && (lib.style.opacity = ".5"); }; c.ondragend = function () { lib && (lib.style.opacity = ""); }; c.onclick = function () { api.spawn(c.getAttribute("data-k"), document.body).then(function () { toast("placed " + short(c.getAttribute("data-k"))); }); }; }); }
      paint(""); lib.querySelector(".q").oninput = function (e) { paint(e.target.value.trim().toLowerCase()); };
      lib.querySelector(".q").focus();
    });
  }

  var api = {
    async inspect(k) {
      var src = "", bytes = 0, type = "object", children = [], exports = [];
      try { var b = await HR().resolve(k); bytes = b.length; src = new TextDecoder().decode(b.slice(0, 65536)); } catch (e) {}
      var head = src.trimStart();
      if (head.startsWith("<svg") || head.startsWith("<?xml")) type = "svg";
      else if (head[0] === "{" || head[0] === "[") { try { var j = JSON.parse(src); if (j && j["@type"] === "holo:Bundle") { type = "bundle"; children = await HR().unbundle(k).catch(function () { return []; }); } else type = "json"; } catch (e) { type = "text"; } }
      else if (/\b(export|import)\b/.test(src)) { type = "module"; (src.match(/export\s*\{([^}]+)\}/) ? RegExp.$1.split(",") : []).forEach(function (x) { var n = x.split(/\s+as\s+/).pop().trim(); if (n) exports.push(n); }); }
      else type = "text";
      return { kappa: kHex(k), type: type, bytes: bytes, children: (children || []).map(kHex), exports: exports };
    },
    source: function (k) { return HR().source(k); },                          // bytes as text
    edit: function (k, newSource) { return HR().stash(newSource); },           // fork → new κ (auto-persisted)
    render: function (k, target) { return HR().render(typeof target === "string" ? document.querySelector(target) : target, k); },
    share: function (k) { return shareLink(k); },                              // self-verifying cross-device link
    spawn: async function (k, target) { var t = (typeof target === "string" ? document.querySelector(target) : target) || document.body; var slot = document.createElement("div"); slot.setAttribute("data-holo-kappa", kHex(k)); t.appendChild(slot); await api.render(k, slot); return slot; },
    // compose κ-objects into a NEW bundle κ (the agent side of drag-to-compose; humans drag, agents call)
    compose: function (kappas, opts) { opts = opts || {}; var b = { "@type": "holo:Bundle", layout: opts.layout || "row", children: (kappas || []).map(function (k) { return { kappa: kHex(k) }; }) }; return HR().stash(JSON.stringify(b)); },
    library: function () { return libraryItems(); },
    self: selfKappa,                                                           // the tool's own κ's {editor, renderer} — turtles
    menu: openMenu, panel: openPanel, openLibrary: openLibrary,
  };

  // Right-click activates the remix menu ONLY on an actual κ-object — every other element keeps its
  // native/app/shell menu (the desktop "New" menu, text fields, links). No hijacking, no noise: the
  // remix surface appears exactly where there is an object to remix. (As more chrome is rendered as
  // κ-objects, more becomes remixable — and the shell's "Build" mode can opt-in any element later.)
  document.addEventListener("contextmenu", function (e) {
    if (e.target.closest && e.target.closest(".holo-mx-menu")) return;                 // don't recurse on the menu
    var tool = e.target.closest && (e.target.closest(".holo-mx-panel") || e.target.closest(".holo-mx-lib"));
    if (tool) {                                                                        // turtles: right-click the editor → edit the editor
      e.preventDefault(); selfKappa().then(function (s) { if (s && s.editor) { tool.setAttribute("data-holo-kappa", s.editor); openMenu(e.clientX, e.clientY, tool); } });
      return;
    }
    var obj = e.target.closest && e.target.closest("[data-holo-kappa]");
    if (!obj) return;                                   // not an object → let the native menu handle it
    e.preventDefault(); openMenu(e.clientX, e.clientY, obj);
  }, true);
  document.addEventListener("click", function (e) { if (menu && !(e.target.closest && e.target.closest(".holo-mx-menu"))) closeMenu(); }, true);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { closeMenu(); if (lib) { lib.remove(); lib = null; } }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "l") { e.preventDefault(); openLibrary(); }   // open the Library
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && undo.length) { var u = undo.pop(); if (u.ph) u.ph.replaceWith(u.el); else if (u.el) u.el.style.display = u.prev || ""; toast("undone"); }
  }, true);
  // drag-to-compose: drop a Library object onto another κ-object → COMPOSE a new bundle κ; onto empty → PLACE it.
  document.addEventListener("dragover", function (e) { try { if (e.dataTransfer && [].indexOf.call(e.dataTransfer.types, "text/holo-kappa") >= 0) e.preventDefault(); } catch (x) {} });
  document.addEventListener("drop", async function (e) {
    var k = e.dataTransfer && e.dataTransfer.getData("text/holo-kappa"); if (!k) return; e.preventDefault();
    var t = document.elementFromPoint(e.clientX, e.clientY); var obj = t && t.closest && t.closest("[data-holo-kappa]");
    if (obj && !(t.closest && t.closest(".holo-mx-lib"))) {                       // compose into a new bundle κ
      try { var nb = await api.compose([obj.getAttribute("data-holo-kappa"), k]);
        obj.setAttribute("data-holo-kappa", nb); if (obj.__holoRoot) { try { obj.__holoRoot.unmount(); } catch (x) {} obj.__holoRoot = null; obj.innerHTML = ""; }
        await HR().render(obj, nb); toast("composed → " + short(nb)); } catch (x) { toast("compose: " + (x.message || x)); }
    } else if (!(t && t.closest && t.closest(".holo-mx-lib"))) {                  // place the object at the drop point
      try { var slot = await api.spawn(k, document.body); slot.style.cssText = "position:fixed;left:" + e.clientX + "px;top:" + e.clientY + "px;z-index:2147483500"; toast("placed " + short(k)); } catch (x) {}
    }
  });

  window.HoloEdit = { api: api, open: openMenu, version: "2.0.0" };
})();
