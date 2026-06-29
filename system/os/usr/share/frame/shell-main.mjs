      // ── the spatial self-authoring shell with a native window manager (A27 + A30) ────────
      import { defineBlock, defineBlockFromSource } from "/_shared/holo-blocks.js";
      import { HoloRepo } from "/_shared/holo-blocks-repo.mjs";
      import { createLiveEditor } from "/_shared/holo-live-edit.mjs";   // liveEdit: the ONE primitive chat·DevTools·agents edit through
      import * as HoloSkin from "/_shared/holo-skin.js";   // Holo Browser SKINS (holo:BrowserSkin): hot-swappable vintage chrome (NCSA Mosaic …), κ-addressed, state-preserving, browser-tabs only
      import { createPlaygroundHost, createPlaygroundAgent } from "/_shared/holo-playground-agent.mjs";   // Holo Playground: in-app (iframe) AND in-shell element edits route to that ONE primitive
      import { capabilitiesToSandbox, linkFor, projectHtml, entryBase } from "/holo-launch.mjs";
      import { classify, matches } from "/holo-omni.mjs";
      import { resolveAny, parseRef } from "/sbin/holo-omni-object.mjs";   // the discovery-backed κ-resolver (trustless gateways + Delegated Routing V1)
      import { record as omniRemember, search as omniRecent, recents as omniRecents } from "/sbin/holo-omni-index.mjs";   // the omnibar's MEMORY: it remembers + ranks everything you've opened (private, instant, holo-rank-aware)
      import { buildContinueModel, renderContinueRail } from "/_shared/holo-continue-ui.mjs";   // Continue watching — recent apps + spaces as a poster rail (the streaming front door)
      import * as HoloRecommend from "/_shared/holo-recommend.mjs";   // "Because you've been exploring…" — recommendations row (private, on-device)
      import { makeOpen as makeHoloOpen, classifyOpen as classifyHoloOpen } from "/_shared/holo-open.mjs";   // S2: the ONE open path (press play) — wraps omniGo + the named app/space forms
      import "/_shared/holo-address.mjs";   // the address is a NAME, never a path: window.HoloAddress.nameSync(loc)/resolveSync(typed) — a verified projection of the κ (Law L5), warmed at boot
      import "/_shared/holo-omni-resolve.mjs";   // unify-the-chrome (Strategy A): window.HoloResolve.resolve/route — the omnibox as a pure destination resolver, shared by the home hero + the native omnibox interception
      import { askPrivate as omniAsk, indexObject as omniIndexObject } from "/sbin/holo-omni-q.mjs";   // the omnibar's PRIVATE INTELLIGENCE: Q.recall (model-free BM25 ⊕ κ-graph) over your resolved corpus — ask a question, get YOUR stuff, on-device
      // PERF — the omnibar's HEAVY resolver legs are NOT loaded at boot. web3 (→ holo-eth · holo-solana ·
      // holo-ipfs), onion (→ Tor transport), onion-discover and media are only needed once you FOCUS the
      // omnibar and type/submit an address of that kind. They're lazy-loaded on first omnibar focus (and
      // awaited at every resolve/dispatch entry point as a safety net), keeping the blockchain/onion/media
      // stack (~0.3MB + its transitive chain crypto) off the boot path of a shell that hosts every app. The
      // lightweight classifier (holo-omni.mjs · holo-omni-object.mjs) stays eager so as-you-type stays instant.
      let parseWeb3Ref, resolveWeb3, web3CardDoc, parseOnionRef, validateOnion, resolveOnion, searchOnionWeb, classifyMedia, resolveMediaSource, mediaMime, searchDirectory;
      let _omniLegsP = null;
      function ensureOmniLegs() {
        if (_omniLegsP) return _omniLegsP;
        _omniLegsP = Promise.all([
          import("/sbin/holo-omni-web3.mjs"), import("/sbin/holo-omni-web3-card.mjs"),
          import("/sbin/holo-omni-onion.mjs"), import("/sbin/holo-onion-discover.mjs"), import("/sbin/holo-media.mjs"),
          import("/_shared/holo-dweb.js"),   // the federated directory lane (knowledge · ENS · dapps · apps) — pulls holo-ipfs; only used in as-you-type suggestions, so off the boot path
        ]).then(([w3, w3c, on, ond, md, dw]) => {
          ({ parseWeb3Ref, resolveWeb3 } = w3); ({ web3CardDoc } = w3c);
          ({ parseOnionRef, validateOnion, resolveOnion } = on); ({ searchOnionWeb } = ond);
          ({ classifyMedia, resolveMediaSource, mediaMime } = md); ({ searchDirectory } = dw);
        }).catch((e) => { console.warn("[omni] resolver legs failed to load:", (e && e.message) || e); });
        return _omniLegsP;
      }
      import { mountEgressConnect } from "/usr/share/holo-web-recorder/holo-egress-connect.mjs";   // "Connect the web" icon by the omnibar: live egress status + simplest install path
      import { resolveBootResume } from "/_shared/holo-workspace-sync-ui.mjs";   // Holo Workspace Sync (ADR-0105): boot-resume a #wks link / ?wks token (the sealer is dynamic-imported on use)
      import { createAside, registerAsideCloser, closeAllAsides, syncDockWidth } from "/_shared/holo-aside.mjs";   // Holo Aside: the ONE right side-carriage template shared by Create · Play · Share · Notify · Wallet (golden scale · slide · collapse chevron · single-open)
      import { mountNotifications } from "/_shared/holo-notify.mjs";   // Holo Notify: the ONE notification surface — quiet toast → persistent Center carriage; home for Q's notes (window.HoloNotify). Eager: it paints the unread badge at boot.
      // PERF — Play (▶) and Share (❤️) are CARRIAGES: never needed until their verb is engaged. Their UI
      // bundles (the browse rail + the QR/social-card sealer and their transitive deps) are kept OFF the boot
      // path and lazy-loaded on first hover/focus/click of the verb (lazyVerb, below) — same discipline as the
      // omnibar's resolver legs (ensureOmniLegs). mountShare/mountPlay are dynamic-imported at that point.
      // searchDirectory (holo-dweb, → holo-ipfs) is loaded lazily with the omnibar legs (ensureOmniLegs, above) —
      // it's only used in as-you-type suggestions, so it no longer pulls holo-ipfs onto the boot path.
      import { profileFor } from "/_shared/holo-platform.js";
      import { createKeymap, renderKeyboard } from "/_shared/holo-keys.js";
      import { createAutomation } from "/_shared/holo-auto.js";
      import { scene as holoManimScene } from "/_shared/holo-manim.js";
      import { gpuInfo, gpuLabel, createSurface } from "/_shared/holo-gfx.js";
      import HoloCosmos from "/_shared/holo-cosmos.js";   // ADR-0080 L1: κ-seed procedural infinite space
      import HoloSpace from "/_shared/holo-space3d.js";   // ADR-0080 L5+L6: navigable-scene surface + κ-chunk streamer
      import { LAYOUTS, LAYOUT_ORDER, zonesFor, zoneAt } from "/_shared/holo-zones.js";
      import { makeStore, idbBackend } from "/_shared/holo-store.js";
      import { persist as holoPersist, splitNode, fuseNode } from "/_shared/holo-world-rw.mjs";
      import * as HoloOwn from "/_shared/holo-own-ui.js";
      import * as HoloProv from "/_shared/holo-prov-ui.js";   // Holo Prov (ADR-0082): provenance hypergraph, binding on every holospace
      import * as HoloMind from "/_shared/holo-mind-ui.js";   // Holo Mind (ADR-0081): the live, gate-enforced ambient loop, exposed OS-wide as window.HoloMind
      import "/_shared/q/holo-q-trinity-ui.js";               // Holo Trinity (ADR-0087): the OS-wide create·exist·perceive loop, installed as window.HoloTrinity (invisible, self-improving)
      import "/_shared/q/holo-q-vision-boot.mjs";             // Holo Vision (raster edge): ambient perception of non-κ pixels (canvas/img/video/cross-origin) → sealed κ; rides window.HoloAmbient, inert until an OCR engine is ready
      import "/_shared/devtools/holo-devtools-ui.js";         // Holo DevTools (ADR-0095): installs window.HoloDevToolsServe — the κ-CDP backend holo-gov.js routes the DevTools frame's CDP to (serverless, fail-closed)
      import { installGlobalDevDock } from "/_shared/devtools/holo-devtools-dock.mjs";   // Holo DevTools (ADR-0095): GLOBAL F12 dock over the ACTIVE tab (Chrome-parity), built on the live κ-CDP backend
      import { createRemoteBroker as holoQCreateRemoteBroker, serveRpc as holoQServeRpc } from "/_shared/q/holo-q-remote.mjs";   // Holo Q Remote (ADR-0090): the ONE governed remote-model host broker
      import { roster as identRoster, unlock as identUnlock } from "/_shared/holo-identity.mjs";
      import * as HoloSession from "/_shared/holo-session.mjs";   // Holo Session (ADR-0104): per-operator, device-local experience continuity
      import HoloRender from "/_shared/holo-render.js";          // the ONE canonical κ→render path (lean, no compiler)
      import { resolveByKappa } from "/holo-resolver.mjs";       // the substrate's single resolve authority (Law L5)
      import * as HoloWB from "/_shared/holo-workspace-bridge.mjs";   // Phase A: every app/tab is its own per-app source chain (zero app code) — rides the existing collectAppState signal
      import * as HoloRewind from "/_shared/holo-rewind-ui.mjs";   // Phase B: per-window "rewind" timeline (plain time) over its per-app chain
      import * as HoloWSwitch from "/_shared/holo-workspace-switcher-ui.mjs";   // Phase C: named desktop workspaces — one pill in the tab strip
      import * as HoloRoam from "/_shared/holo-roam-ui.mjs";   // Phase E: ⇄ Roam toggle — mirror open windows across tabs/devices (BroadcastChannel; WAN out-of-band)
      import * as HoloRoamWan from "/_shared/holo-roam-wan.mjs";   // AMBIENT roam: auto-on at boot, tabs (BroadcastChannel) + devices (relay/WAN); seamless, no toggle

      // NEVER-BLANK SIGNAL (Boot-integrity M2): the engine module loaded and ALL its static imports resolved —
      // fire it HERE (right after the import block, before the body's long-lived top-level boot) so a healthy
      // boot signals immediately. If shell-main.mjs 404s, fails to parse, or any import above fails, this line
      // never runs → shell.html's dependency-free watchdog reveals the recovery overlay. Never a dead-end desktop.
      try { document.documentElement.classList.add("holo-shell-ready"); window.dispatchEvent(new Event("holo-shell-ready")); } catch (e) {}

      // ── Holo Q Remote (ADR-0090): install the ONE host broker for the governed remote-model capability.
      // The key/URL live ONLY in this broker's vault (in its closure) — never in a κ, never posted to an
      // app frame. Apps reach it over holo-gov.js's holo-privacy:rpc bus (which delegates q.remote.* to
      // window.HoloQRemoteServe), holding nothing; boost (the shell frame) registers into this SAME broker
      // so there is one vault for the shell and every iframe app. The conscience is resolved LAZILY at call
      // time, so load-order can't matter and egress fails closed until the constitution is sealed.
      (function installHoloQRemote() {
        try {
          const lazyConscience = {
            evaluate: (d, o) => (window.HoloConscience ? window.HoloConscience.evaluate(d, o) : { outcome: "block", blocked: ["*"], caveats: [], verdicts: [], sealed: false }),
            scanPii: (t) => (window.HoloConscience && window.HoloConscience.scanPii ? window.HoloConscience.scanPii(t) : []),
          };
          const broker = holoQCreateRemoteBroker({ fetchImpl: (...a) => window.fetch(...a), conscience: lazyConscience, clock: () => new Date().toISOString() });
          window.HoloQRemote = broker;                                  // host-only handle (vault in the closure)
          window.HoloQRemoteServe = (req) => holoQServeRpc(broker, req);  // holo-gov.js delegates q.remote.* here
        } catch (e) { /* fail-closed: no broker ⇒ holo-gov.js replies "no remote authority" */ }
      })();

      const $ = (s, r = document) => r.querySelector(s);
      const world = $("#world"), snapEl = $("#snap");
      // the CANVAS is #world's own content box — already inset by the chrome (top) and the LIVE Holo Dock
      // footprint (--holo-dock-w on a left pin · --holo-dock-h on a bottom pin · 0 when the dock floats).
      // Reading it directly is what makes every window fit the dock-free area EXACTLY, wherever the dock sits.
      const usableH = () => world.clientHeight;

      // ── native-OS adaptation — the same shell, tuned to the host ────────────────────────
      const P = profileFor();
      // Accent stays the ONE Holo brand accent (--holo-accent from holo-theme.css) so the chrome reads as a single
      // colour — badge, focus rings, snap outline and the Share verb all match. We adopt the host's TYPEFACE for
      // native feel, but not its accent (that split the chrome into two competing blues). P.accent is kept for apps
      // that want a host-tinted surface.
      document.documentElement.style.setProperty("--win-font", P.font);
      $("#os").textContent = P.label;
      gpuInfo().then((g) => { $("#gpu").textContent = gpuLabel(g); }).catch(() => { $("#gpu").textContent = "2D"; });
      $("#kk").textContent = P.shortcuts.spotlight;   // hint-bar labels are now projected live from km.registry (see mountHintBar)
      const modDown = (e) => (P.apple ? e.metaKey : e.ctrlKey);

      // ── load real OSS web components IN-SHELL (no iframe) → first-class objects ──────────
      // A "pure" object is a content-addressed loading recipe { tag, modules, css, attrs, … }.
      // We inject the library's CSS + import its module(s) into the shell (once, deduped), then
      // instantiate the genuine custom element directly — so it lives in the desktop DOM, not a frame.
      const _css = new Set(), _mod = new Set();
      const ensureCss = (urls) => { for (const u of urls || []) { if (_css.has(u)) continue; _css.add(u); const l = document.createElement("link"); l.rel = "stylesheet"; l.href = u; document.head.appendChild(l); } };
      const ensureModules = (urls) => { for (const u of urls || []) { if (_mod.has(u)) continue; _mod.add(u); import(/* @vite-ignore */ u).catch((e) => console.warn("holo-world: module load failed", u, e.message)); } };
      function buildPure(d) {
        ensureCss(d.css); ensureModules(d.modules);
        const el = document.createElement(d.tag);
        for (const [k, v] of Object.entries(d.attrs || {})) el.setAttribute(k, v);
        if (d.text) el.textContent = d.text;
        if (d.style) el.style.cssText = d.style;
        const wrap = document.createElement("div"); wrap.className = ((d.theme || "") + " pure-wrap").trim(); wrap.appendChild(el);
        return wrap;
      }

      // ── the scene graph IS a content-addressed CvRDT — geometry + state included, so move/
      //    resize/min/max/snap all converge across tabs ────────────────────────────────────
      const repo = new HoloRepo();
      const desktop = await repo.create({ world: [] });
      // Durable κ store (IndexedDB) under the scene: every published object survives a reload,
      // and a node can be SPLIT into its own atomic κ-object or FUSED back. Defensive — a
      // store failure must never break boot (the shell still runs in-memory as before).
      const holoStore = makeStore({ axis: "sha256", backend: idbBackend(),
        hash: async (u8) => { const d = await crypto.subtle.digest("SHA-256", u8); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join(""); } });
      try { holoPersist(repo, holoStore); } catch (e) { console.warn("holo: durable store unavailable, in-memory only", e); }
      // ── the ONE canonical render path: every κ-addressed object mounts in-shell through holo-render,
      //    riding the substrate's single resolver (resolveByKappa, Law L5). No compiler on the hot path;
      //    the κ IS the bytes. Apps stay sandboxed iframes (isolation); objects render in-shell from κ.
      const _kRoute = (hex) => "/.holo/sha256/" + hex;
      const _kStore = new Map();
      const _kSource = async (kappa) => { try { const r = await fetch(_kRoute(String(kappa).split(":").pop())); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; } catch { return null; } };
      try { await HoloRender.configure({ base: "/", route: _kRoute, resolver: (k) => resolveByKappa(k, [_kSource], _kStore) }); } catch (e) { console.warn("holo-render: configure failed", e); }
      // Ownership is AMBIENT (ADR-053, layer 2): every object can be owned · transferred · anchored · sold,
      // self-verifying, through the wallet's human-approval gate. The signer is the operator's self-sovereign
      // key, unlocked on demand (the human approves once). Reads (owner badges) need no unlock.
      const ownedOf = (n) => HoloOwn.ownedKappaOf((n && (n.content || n.src || n.tag || n.title || n.id)) || "");
      HoloOwn.onUnlock(async () => {
        const ops = await identRoster(); if (!ops.length) throw new Error("no identity on this device enroll first");
        const pass = prompt("Unlock " + (ops[0].label || "your identity") + " to sign this ownership change"); if (!pass) throw new Error("unlock cancelled");
        return identUnlock(ops[0].kappa, pass);
      });
      const refreshOwnTitle = async (n, el) => { if (!el) return; try { const s = await HoloOwn.ownState(ownedOf(n)); el.setAttribute("title", (n.title || "Window") + (s.unowned ? "" : "  ·  👤 " + (s.owner || "").split(":").pop().slice(0, 6))); } catch {} };
      const nid = () => "win-" + Math.random().toString(36).slice(2, 9);
      let focusedId = null;
      let gridOn = false, shiftHeld = false, dragZone = null; // window-zones state (declared early; used below)

      function addNode(node) {
        const id = nid(), n = desktop.doc().world.length;
        // every object is PURE (frameless) by default — a bare citizen on the desktop; chrome
        // appears on hover, and right-click → "Show frame" pins it. (node can override.)
        desktop.change((d) => d.world.push({ id, x: 90 + n * 30, y: 80 + n * 26, w: 560, h: 380, state: "normal", locked: false, frameless: true, ...node }));
        focusedId = id; return id;
      }
      const patch = (id, fn) => desktop.change((d) => { const x = d.world.find((w) => w.id === id); if (x) fn(x); });
      const moveNode = (id, x, y) => patch(id, (n) => { n.x = x; n.y = y; });
      const resizeNode = (id, g) => patch(id, (n) => Object.assign(n, g));
      const removeNode = (id) => desktop.change((d) => { d.world = d.world.filter((w) => w.id !== id); });
      function setState(id, state) {
        patch(id, (n) => {
          if (state !== "normal" && n.state === "normal") n.prev = { x: n.x, y: n.y, w: n.w, h: n.h }; // remember to restore
          if (state === "normal" && n.prev) { Object.assign(n, n.prev); delete n.prev; }
          n.state = state;
        });
      }
      const toggleMax = (id) => { const n = desktop.doc().world.find((w) => w.id === id); setState(id, n && n.state === "max" ? "normal" : "max"); };
      const setLocked = (id, v) => patch(id, (n) => { n.locked = v; });

      // ── <holo-window> — native chrome + move + resize + min/max + snap + lock + fill ─────
      defineBlock("holo-window", {
        init() {
          const host = this.$el, sr = host.shadowRoot, nav = sr.querySelector(".nav");
          host.style.position = "absolute"; host.style.left = "0"; host.style.top = "0"; // placed via transform
          const setPos = (x, y) => { host.dataset.x = x; host.dataset.y = y; host.style.transform = `translate3d(${x}px,${y}px,0)`; }; // GPU-composited move (no layout)
          const emit = (t, detail) => host.dispatchEvent(new CustomEvent(t, { bubbles: true, composed: true, detail: { id: host.id, ...detail } }));
          const focus = () => { window.__z = (window.__z || 10) + 1; host.style.zIndex = String(window.__z); emit("win-focus", {}); };
          host.addEventListener("pointerdown", focus, true);
          // peek — reveal a nested pane's grip + ring on hover / touch / keyboard focus, hide otherwise.
          // Drives `data-peek` from JS so the reveal is reliable (CSS :focus-within inside :host() is
          // flaky) and works for pointer AND focus. Only meaningful while [nested]; harmless elsewhere.
          const peek = (on) => {
            on = !!on || host.dataset.busy === "1";                         // keep revealed mid-drag
            if (on) host.setAttribute("data-peek", ""); else host.removeAttribute("data-peek");   // drives the [data-peek] ring
            // The grip's opacity is set inline for nested panes: the frameless `opacity:0` rule and the
            // peek rule tie under this engine's :host() specificity, so inline (which always wins) is the
            // reliable lever. Non-nested windows keep their pure-CSS hover behavior (clear the inline).
            nav.style.opacity = host.hasAttribute("nested") ? (on ? "1" : "") : "";
          };
          host.addEventListener("pointerenter", () => peek(true));
          host.addEventListener("pointerleave", () => peek(false));
          host.addEventListener("focusin", () => peek(true));
          host.addEventListener("focusout", () => peek(false));

          // controls (both styles in the DOM; CSS shows the host's) + lock
          sr.querySelectorAll(".act-close").forEach((b) => b.onclick = (e) => { e.stopPropagation(); emit("win-close", {}); });
          sr.querySelectorAll(".act-min").forEach((b) => b.onclick = (e) => { e.stopPropagation(); emit("win-state", { state: "min" }); });
          sr.querySelectorAll(".act-max").forEach((b) => b.onclick = (e) => { e.stopPropagation(); emit("win-max", {}); });
          sr.querySelector(".act-lock").onclick = (e) => { e.stopPropagation(); emit("win-lock", { toggle: true }); };
          { const _rb = sr.querySelector(".act-rewind"); if (_rb) _rb.onclick = (e) => { e.stopPropagation(); emit("win-rewind", {}); }; }
          sr.querySelector(".act-edit").onclick = (e) => { e.stopPropagation(); emit("win-edit", {}); };
          sr.querySelector(".act-pure").onclick = (e) => { e.stopPropagation(); emit("win-pure", {}); };

          // ── move (titlebar) + edge-snap preview ──────────────────────────────────────────
          let mv = null;
          nav.addEventListener("pointerdown", (e) => {
            if (e.target.closest("button") || host.hasAttribute("locked")) return;
            if (host.dataset.state === "max") return;     // don't drag a maximized window
            mv = { sx: e.clientX, sy: e.clientY, ox: +host.dataset.x || 0, oy: +host.dataset.y || 0 };
            host.dataset.busy = "1"; nav.setPointerCapture(e.pointerId);
          });
          nav.addEventListener("pointermove", (e) => {
            if (!mv) return;
            let nx = Math.max(0, mv.ox + e.clientX - mv.sx), ny = Math.max(0, mv.oy + e.clientY - mv.sy);
            // SHARED snap engine (interact-vendored, window.HoloSnap): align this window to sibling windows ·
            // widgets · icons · the golden anchors, and paint guide lines. Guarded — never breaks the drag.
            try {
              if (window.HoloSnap) {
                const po = host.offsetParent ? host.offsetParent.getBoundingClientRect() : { left: 0, top: 0 };
                const s = window.HoloSnap.snapRect({ left: po.left + nx, top: po.top + ny, width: host.offsetWidth, height: host.offsetHeight }, host);
                nx = Math.max(0, s.left - po.left); ny = Math.max(0, s.top - po.top);
                window.HoloSnap.showGuides(s.v, s.h);
              }
            } catch (x) {}
            setPos(nx, ny);
            emit("win-draghint", { x: e.clientX, y: e.clientY });
          });
          const endMove = (e) => {
            if (!mv) return; mv = null; host.dataset.busy = "";
            try { window.HoloSnap && window.HoloSnap.clearGuides(); } catch (x) {}
            emit("win-dragend", { x: e.clientX, y: e.clientY, left: +host.dataset.x || 0, top: +host.dataset.y || 0 });
          };
          nav.addEventListener("pointerup", endMove); nav.addEventListener("pointercancel", endMove);
          nav.addEventListener("dblclick", (e) => { if (!e.target.closest("button")) emit("win-max", {}); });

          // ── resize (8 handles) ────────────────────────────────────────────────────────────
          const EDGES = { n: { t: 1 }, s: { b: 1 }, e: { r: 1 }, w: { l: 1 }, ne: { t: 1, r: 1 }, nw: { t: 1, l: 1 }, se: { b: 1, r: 1 }, sw: { b: 1, l: 1 } };
          sr.querySelectorAll(".rh").forEach((h) => {
            const ed = EDGES[h.dataset.dir]; let rz = null;
            h.addEventListener("pointerdown", (e) => {
              if (host.hasAttribute("locked") || host.dataset.state === "max") return;
              e.stopPropagation();
              rz = { sx: e.clientX, sy: e.clientY, L: +host.dataset.x || 0, T: +host.dataset.y || 0, W: host.offsetWidth, H: host.offsetHeight };
              host.dataset.busy = "1"; h.setPointerCapture(e.pointerId);
            });
            h.addEventListener("pointermove", (e) => {
              if (!rz) return; const dx = e.clientX - rz.sx, dy = e.clientY - rz.sy;
              let { L, T, W, H } = rz;
              if (ed.r) W = Math.max(240, rz.W + dx);
              if (ed.l) { W = Math.max(240, rz.W - dx); L = rz.L + (rz.W - W); }
              if (ed.b) H = Math.max(150, rz.H + dy);
              if (ed.t) { H = Math.max(150, rz.H - dy); T = rz.T + (rz.H - H); }
              setPos(L, T); host.style.width = W + "px"; host.style.height = H + "px";
            });
            const endR = () => { if (!rz) return; rz = null; host.dataset.busy = ""; emit("win-resize", { x: +host.dataset.x || 0, y: +host.dataset.y || 0, w: host.offsetWidth, h: host.offsetHeight }); };
            h.addEventListener("pointerup", endR); h.addEventListener("pointercancel", endR);
          });
        },
      }, {
        template: `<div class="frame">
          <div class="nav">
            <span class="ctl traffic"><button class="t-close act-close" title="Close"></button><button class="t-min act-min" title="Minimize"></button><button class="t-max act-max" title="Maximize"></button></span>
            <span class="title" data-text="props.title"></span>
            <span class="navright">
              <button class="act-rewind io" title="Rewind this window">&#x21BA;</button>
              <button class="act-edit io" title="Edit source → a new version">&#x270E;</button>
              <button class="act-pure io" title="Frameless / pure object">&#x25C7;</button>
              <button class="act-lock lock" title="Lock window"></button>
              <span class="ctl win"><button class="w-min act-min" title="Minimize">&#x2012;</button><button class="w-max act-max" title="Maximize">&#x25A1;</button><button class="w-close act-close" title="Close">&#x2715;</button></span>
            </span>
          </div>
          <div class="body"><slot></slot></div>
          <i class="rh rh-n" data-dir="n"></i><i class="rh rh-s" data-dir="s"></i><i class="rh rh-e" data-dir="e"></i><i class="rh rh-w" data-dir="w"></i>
          <i class="rh rh-ne" data-dir="ne"></i><i class="rh rh-nw" data-dir="nw"></i><i class="rh rh-se" data-dir="se"></i><i class="rh rh-sw" data-dir="sw"></i>
        </div>`,
        style: `:host{display:block;filter:drop-shadow(0 14px 34px #000b);will-change:transform;contain:layout}
          .frame{position:relative;display:flex;flex-direction:column;width:100%;height:100%;background:#0d1117;border:1px solid #30363d;border-radius: var(--holo-radius, 12px);overflow:hidden}
          .nav{flex:none;display:flex;align-items:center;gap:10px;height:36px;padding:0 10px;background:#161b22;border-bottom:1px solid #21262d;cursor:grab;touch-action:none;user-select:none}
          .nav:active{cursor:grabbing} :host([locked]) .nav{cursor:default}
          .title{flex:1;font-size: var(--holo-text-sm, 1rem);color:#c9d1d9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
          .navright{display:flex;align-items:center;gap:8px} .ctl{display:flex;align-items:center;gap:8px}
          .lock{width:22px;height:22px;border:0;border-radius:var(--holo-radius, 6px);background:transparent;color:#6e7681;cursor:pointer;font-size: var(--holo-text-sm, 1rem)}
          .lock::before{content:"\\1F513"} :host([locked]) .lock::before{content:"\\1F512"} :host([locked]) .lock{color:var(--accent,#1f6feb)}
          .lock:hover{background:#ffffff14}
          /* macOS traffic-lights (left) vs Windows/Linux min/max/close (right) */
          :host([cstyle="win"]) .traffic{display:none} :host([cstyle="traffic"]) .win{display:none}
          .t-close,.t-min,.t-max{width:12px;height:12px;border-radius:50%;border:0;cursor:pointer;padding:0}
          .t-close{background:#ff5f57}.t-min{background:#febc2e}.t-max{background:#28c840}
          .w-min,.w-max,.w-close{width:30px;height:36px;border:0;background:transparent;color:#c9d1d9;cursor:pointer;font-size: var(--holo-text-sm, 1rem);line-height:1}
          .w-min:hover,.w-max:hover{background:#ffffff1a}.w-close:hover{background:#e81123;color:#fff}
          .io{width:26px;height:36px;border:0;background:transparent;color:#8b949e;cursor:pointer;font-size: var(--holo-text-sm, 1rem)}.io:hover{background:#ffffff14;color:#c9d1d9}
          .body{flex:1;min-height:0;background:#010409;overflow:auto}
          /* FRAMELESS / pure: a bare object on the desktop — chrome fades in only on hover */
          :host([frameless]){filter:none}
          :host([frameless]) .frame{background:transparent;border:0;border-radius:0}
          :host([frameless]) .nav{position:absolute;top:0;left:0;right:0;z-index:8;opacity:0;transition:opacity .12s;background:#161b22e6;backdrop-filter:blur(6px);border-radius: var(--holo-radius-sm, 8px);border-bottom:0}
          :host([frameless]:hover) .nav{opacity:1}
          :host([frameless]) .body{background:transparent}
          /* NESTED tiled pane (a holospace template member): borderless and seamless at rest — a hairline
             seam delineates siblings without framing them — and a clean accent ring + the floating drag/
             controls grip fade in only on hover or focus. The body fills the tile (the app paints its own
             background). Repositioning + tear-off reuse the same drag the framed window has. */
          :host([nested]) .frame{background:#0b0f14;box-shadow:inset 0 0 0 1px rgba(255,255,255,.05)}
          :host([nested]) .body{background:#0b0f14}
          :host([nested]:hover) .frame,:host([nested][data-peek]) .frame{box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--accent, #2dd4bf) 55%, transparent), 0 8px 30px rgba(0,0,0,.35)}
          :host([nested]) .nav{transition:opacity .12s}
          :host([nested]:hover) .nav,:host([nested][data-peek]) .nav{opacity:1}
          /* browser content (web · IPFS · κ object) renders on a SOLID page like a real browser tab — never
             transparent over the wallpaper. The OS tab + omnibar are the browser chrome; this is the viewport. */
          :host([browser]) .frame{background:#fff;border:0}
          :host([browser]) .body{background:#fff}
          :host([browser]) iframe,:host([browser]) ::slotted(iframe){background:#fff}
          /* TAB-FILLING holospace — a maximized app fills its tab as the tab's own content, so it drops
             ALL inner window chrome (no titlebar, border, shadow or resize handles): one frame = the tab,
             the Chrome model. The isolated window frame returns when the tab is detached (state → normal). */
          :host([data-kind="app"][data-state="max"]){filter:none}
          :host([data-kind="app"][data-state="max"]) .frame{background:transparent;border:0;border-radius:0}
          :host([data-kind="app"][data-state="max"]) .nav{display:none}
          :host([data-kind="app"][data-state="max"]) .body{background:transparent}
          :host([data-kind="app"][data-state="max"]) .rh{display:none}
          .body ::slotted(*){display:block;width:100%;height:100%;border:0}
          .rh{position:absolute;z-index:6} :host([locked]) .rh{display:none}
          .rh-n{top:-3px;left:10px;right:10px;height:7px;cursor:ns-resize}.rh-s{bottom:-3px;left:10px;right:10px;height:7px;cursor:ns-resize}
          .rh-e{right:-3px;top:10px;bottom:10px;width:7px;cursor:ew-resize}.rh-w{left:-3px;top:10px;bottom:10px;width:7px;cursor:ew-resize}
          .rh-ne{top:-3px;right:-3px;width:14px;height:14px;cursor:nesw-resize}.rh-nw{top:-3px;left:-3px;width:14px;height:14px;cursor:nwse-resize}
          .rh-se{bottom:-3px;right:-3px;width:14px;height:14px;cursor:nwse-resize}.rh-sw{bottom:-3px;left:-3px;width:14px;height:14px;cursor:nesw-resize}`,
      });

      // ── reconcile the live scene graph → windows, applying geometry by state ─────────────
      const mounted = new Map();
      const worldRect = () => { const r = world.getBoundingClientRect(); return { x: r.left, y: r.top, W: r.width, H: r.height }; };
      // tab layout tracks the dock's own signal: WINDOWED → address bar on top with tabs nested under it; FULLSCREEN → Chrome (tabs on top)
      const isFS = () => !!(document.fullscreenElement || document.webkitFullscreenElement || (window.matchMedia && window.matchMedia("(display-mode: fullscreen)").matches));
      const reflectFS = () => document.documentElement.toggleAttribute("data-fs", isFS());
      reflectFS();
      addEventListener("fullscreenchange", reflectFS); addEventListener("resize", reflectFS);
      try { window.matchMedia("(display-mode: fullscreen)").addEventListener("change", reflectFS); } catch {}
      function geomFor(n) {
        const W = world.clientWidth, H = world.clientHeight, hw = Math.round(W / 2), rw = Math.floor(W / 2), hh = Math.round(H / 2), bh = Math.floor(H / 2);   // the dock-free canvas box
        switch (n.state) {
          case "max":   return { left: 0, top: 0, width: W, height: H };           // tab-filling: the holospace IS the tab's content — fits the canvas EXACTLY (one frame = the tab)
          case "left":  return { left: 0, top: 0, width: hw, height: H };
          case "right": return { left: hw, top: 0, width: rw, height: H };
          case "top":    return { left: 0, top: 0, width: W, height: hh };          // top / bottom halves
          case "bottom": return { left: 0, top: hh, width: W, height: bh };
          case "tl":    return { left: 0, top: 0, width: hw, height: hh };          // quarters — the Aero-snap corners
          case "tr":    return { left: hw, top: 0, width: rw, height: hh };
          case "bl":    return { left: 0, top: hh, width: hw, height: bh };
          case "br":    return { left: hw, top: hh, width: rw, height: bh };
          default:      return { left: n.x, top: n.y, width: n.w, height: n.h };
        }
      }
      // a snap target painted in SCREEN coords, aligned to exactly where the window will land
      const ghostScreen = (state) => { const g = geomFor({ state }), r = worldRect(); return { left: g.left + r.x, top: g.top + r.y, width: g.width, height: g.height }; };
      function applyGeom(el, n) {
        if (el.dataset.busy === "1") return;            // don't fight a live drag/resize
        const g = geomFor(n);
        el.dataset.x = g.left; el.dataset.y = g.top; el.style.transform = `translate3d(${g.left}px,${g.top}px,0)`; el.style.width = g.width + "px"; el.style.height = g.height + "px";
      }
      // Make the shell's OWN objects remixable: tag each window with its content-address (the app's did,
      // a split object's κ, a κ-object node, or — for inline content — a stashed κ so Edit resolves) and
      // mark it shell-MANAGED. The universal remix layer (holo-edit, loaded via the wire) then offers
      // Inspect · Edit · Share on the shell's chrome, while the shell keeps authority over window layout.
      function holoTag(el, n) {
        try {
          el.setAttribute("data-holo-managed", "1");
          let k = n.appDid || n.contentRef || n.kappa || null;
          if (k) { el.setAttribute("data-holo-kappa", String(k).replace(/^did:holo:/, "holo://")); return; }
          if (n.content && window.HoloRender && window.HoloRender.stash && el.__hsrc !== n.content) {
            el.__hsrc = n.content;
            window.HoloRender.stash(n.content).then((kk) => el.setAttribute("data-holo-kappa", kk)).catch(() => {});
          }
        } catch (e) {}
      }
      function render(doc) {
        const nodes = doc.world || [];
        const want = new Set(nodes.map((n) => n.id));
        for (const [id, el] of mounted) if (!want.has(id)) { el.querySelectorAll && el.querySelectorAll("svg").forEach((s) => s._stop && s._stop()); el.remove(); mounted.delete(id); }
        const tb = [];
        for (const n of nodes) {
          let el = mounted.get(n.id);
          if (!el) {
            el = document.createElement("holo-window"); el.id = n.id;
            el.setAttribute("title", n.title || "Window");
            el.setAttribute("cstyle", P.controlStyle); el.setAttribute("cside", P.controlsSide);
            // Playground-edited IN-SHELL surface: re-render from the edited HTML κ (additive — only when set by a
            // Playground edit; existing surfaces are byte-unchanged). The wrapper is display:contents so layout is unaffected.
            if (n.htmlOverride != null) { const wrap = document.createElement("div"); wrap.className = "holo-play-html"; wrap.style.cssText = "display:contents"; try { wrap.innerHTML = n.htmlOverride; } catch (e) {} el.appendChild(wrap); }
            else if (n.kind === "app") { const f = document.createElement("iframe"); if (n.sandbox) f.setAttribute("sandbox", n.sandbox); if (n.allow) f.setAttribute("allow", n.allow); if (n.browser) f.style.background = "#fff"; if (n.srcdoc) f.srcdoc = n.srcdoc; else f.src = n.src; el.appendChild(f);
              // Holo governance (holo-gov.js): bind this frame's VERIFIED identity so the host privacy
              // broker stamps disclosures AS this app (un-forgeable) and the shields reflect it. Every app.
              const idn = govIdentity(n); f.addEventListener("load", () => { try { if (window.HoloGov && f.contentWindow) { window.HoloGov.register(f.contentWindow, idn); if (focusedId === n.id) window.HoloGov.focus(idn); } } catch (e) {}
                // Ambient Q (ADR-0091): inject the cross-frame client into every same-origin holo app on mount,
                // so window.Q + the in-app summon work INSIDE the app — true omnipresence from ONE point, no per-app edit.
                // (marked data-holo-ephemeral so the Playground agent's serialise strips this injected runtime — the sealed κ stays pristine, Law L5.)
                try { const _d = f.contentDocument; if (_d && !_d.getElementById("holo-q-app")) { const _s = _d.createElement("script"); _s.id = "holo-q-app"; _s.type = "module"; _s.setAttribute("data-holo-ephemeral", ""); _s.src = "/_shared/q/holo-q-app.js"; (_d.head || _d.documentElement).appendChild(_s); } } catch (e) {}
                // Holo Sound (universal audio): inject the audio router into every app frame so any music · audiobook ·
                // podcast · or the audio of streamed video is automatically routed through the Holo Audio engine
                // (Hi-Fi + EBU-R128 loudness + HRTF spatial for music). One point, no per-app edit. Ephemeral (Law L5).
                try { const _d = f.contentDocument; if (_d && !_d.getElementById("holo-sound-app")) { const _s = _d.createElement("script"); _s.id = "holo-sound-app"; _s.type = "module"; _s.setAttribute("data-holo-ephemeral", ""); _s.src = "/_shared/holo-sound.mjs"; (_d.head || _d.documentElement).appendChild(_s); } } catch (e) {}
                // The + Everywhere (ambient ingest, ADR "The + Everywhere"): inject the ambient "+" into every app frame
                // so any text input · the omni bar gets the near-invisible "+" → upload/link/holo-object-by-κ → a
                // proactive, context-ranked, provenance-backed brief, fused into Q. One point, no per-app edit. Ephemeral (Law L5).
                try { const _d = f.contentDocument; if (_d && !_d.getElementById("holo-plus-app")) { const _s = _d.createElement("script"); _s.id = "holo-plus-app"; _s.type = "module"; _s.setAttribute("data-holo-ephemeral", ""); _s.src = "/_shared/holo-plus-boot.mjs"; (_d.head || _d.documentElement).appendChild(_s); } } catch (e) {}
                try { const _d = f.contentDocument; if (_d && !_d.getElementById("holo-proof-app")) { const _s = _d.createElement("script"); _s.id = "holo-proof-app"; _s.type = "module"; _s.setAttribute("data-holo-ephemeral", ""); _s.src = "/_shared/holo-proof.mjs"; (_d.head || _d.documentElement).appendChild(_s); } } catch (e) {}
                // Mobile conformance (ADR-0057 · MD3/WCAG): mark this surface as the container-query host
                // (data-holo-surface → the `holoapp` container, so the app reflows to its WINDOW width, not the
                // device viewport — Compact whether maximized on a phone OR floated small on desktop) and ensure
                // the mobile layer is present even for an app that never linked it. Ephemeral: never sealed (Law L5).
                try { const _d = f.contentDocument; if (_d) { const _h = _d.documentElement;
                  if (_h && !_h.hasAttribute("data-holo-surface")) _h.setAttribute("data-holo-surface", "");
                  if (!_d.querySelector('link[href*="holo-mobile.css"]') && !_d.getElementById("holo-mobile-inject")) { const _m = _d.createElement("link"); _m.id = "holo-mobile-inject"; _m.rel = "stylesheet"; _m.href = "/_shared/holo-mobile.css"; _m.setAttribute("data-holo-ephemeral", ""); (_d.head || _h).appendChild(_m); } } } catch (e) {}
                // Holo Playground: inject the in-frame agent so EVERY element in this app is right-click-editable; its edits
                // serialise (ephemeral-stripped) and post UP to createPlaygroundHost → the ONE primitive HoloLiveEdit.edit. No second sealer.
                try { const _d = f.contentDocument; if (_d && !_d.getElementById("holo-playground-app")) { const _p = _d.createElement("script"); _p.id = "holo-playground-app"; _p.type = "module"; _p.setAttribute("data-holo-ephemeral", ""); _p.dataset.surface = n.id; if (pgActive()) _p.dataset.pgActive = "1"; _p.src = "/_shared/holo-playground-app.js"; (_d.head || _d.documentElement).appendChild(_p); } } catch (e) {}
                // Deep Resume: re-apply this surface's saved scroll + drafts (generic, no per-app code), AFTER the
                // app's own load so its content exists. Only fills EMPTY draft fields (never clobbers). Twice, to
                // catch apps that render slightly late; idempotent. Gated on a restored node carrying the snapshot.
                try { const _rs = n.appState && n.appState.__holoResumeDom; if (_rs && _ResumeDom) { const _go = () => { try { _ResumeDom.apply(f.contentWindow, _rs); } catch (e) {} }; setTimeout(_go, 120); setTimeout(_go, 480); } } catch (e) {} }); }
            else if (n.kind === "manim") el.appendChild(holoManimScene(n.scene)); // native Manim-flavored animation, in-shell
            else if (n.pure) el.appendChild(buildPure(n.pure));   // real OSS web component, in-shell — first-class
            else if (n.kappa) { const slot = document.createElement("div"); slot.className = "kappa-object"; el.appendChild(slot); HoloRender.render(slot, n.kappa, n.ctx || {}).catch((err) => { slot.textContent = "⚠ " + (err && err.message || err); }); }   // ANY UOR object, mounted in-shell from its κ via the ONE render path
            else if (n.tag) el.appendChild(document.createElement(n.tag)); // native holo-block element
            world.appendChild(el); mounted.set(n.id, el);
            refreshOwnTitle(n, el);                               // ambient ownership cue in the titlebar
            try { HoloProv.register(n, el); } catch {}            // Holo Prov (ADR-0082): bind the provenance hypergraph + titlebar lineage cue (binding on every holospace)
          }
          if (n.kind === "folder") {   // collapsed (or app-assigned) → a compact desktop ICON; open → the tiles view
            const asIcon = n.appRef || n.collapsed;
            el.classList.toggle("as-icon", !!asIcon);
            const old = el.querySelector(".folder-body, .folder-icon"); const nu = asIcon ? buildFolderIcon(n) : buildFolder(n);
            if (old) old.replaceWith(nu); else el.appendChild(nu);
          }
          el.toggleAttribute("locked", !!n.locked);
          el.toggleAttribute("frameless", !!n.frameless);       // bare object on the desktop (chrome on hover)
          el.toggleAttribute("nested", !!n.nested);             // a tiled holospace pane: borderless, hairline seam, accent ring + grip on hover
          el.toggleAttribute("browser", !!n.browser);           // web/IPFS/κ content → a solid browser-page viewport (never transparent)
          try { skinSync(el, n); } catch (e) {}                  // mount/keep the active vintage skin chrome (browser tabs only); no-op when "modern"
          // MD3 Compact (≤600dp): present every framed window as one full surface — no free-drag/resize on a
          // 360px screen. Desktop icons (frameless / folder icons) and min/hidden windows are untouched, and the
          // node's saved geometry is preserved (only the live presentation maxes; it restores on a wider screen).
          const _compact = !!(window.matchMedia && window.matchMedia("(max-width: 600px)").matches);
          const _maxable = _compact && !n.frameless && n.kind !== "folder" && n.state !== "min" && n.state !== "hidden";
          const _eff = _maxable ? "max" : (n.state || "normal");
          el.dataset.state = _eff;
          el.dataset.kind = n.kind || "";                        // so a tab-filling app (max) drops its inner chrome (the tab is its frame)
          holoTag(el, n);                                        // content-address the object → remixable (Inspect · Edit · Share)
          if (n.state === "min") { el.style.display = "none"; tb.push(n); }
          else if (n.state === "hidden") { el.style.display = "none"; }   // hidden → off-canvas but kept (restore via Show hidden)
          else { el.style.display = ""; applyGeom(el, _eff === (n.state || "normal") ? n : Object.assign({}, n, { state: _eff })); }
        }
        $("#taskbar").innerHTML = tb.map((n) => `<div class="chip" data-id="${n.id}"><span class="d"></span>${(n.title || "Window").slice(0, 28)}</div>`).join("");
        [...$("#taskbar").querySelectorAll(".chip")].forEach((c) => c.onclick = () => setState(c.dataset.id, "normal"));
        const hd = nodes.filter((n) => n.state === "hidden"); const ht = $("#hiddentray");
        ht.innerHTML = hd.length ? `<span class="lbl">👁 ${hd.length} hidden</span>` + hd.map((n) => `<div class="chip" data-id="${n.id}" title="Restore">${String(n.title || "object").replace(/^🌐\s*/, "").slice(0, 24)}</div>`).join("") : "";
        ht.style.display = hd.length ? "flex" : "none";
        [...ht.querySelectorAll(".chip")].forEach((c) => c.onclick = () => setState(c.dataset.id, "normal"));
        $("#empty").style.display = nodes.length ? "none" : "";
        document.body.classList.toggle("app-max", nodes.some((n) => n.kind === "app" && n.state === "max"));   // inside a maximized app → hide the desktop Privacy shield
        const live = nodes.filter((n) => n.state !== "min").length;
        $("#count").textContent = nodes.length + (nodes.length === 1 ? " window" : " windows");
        desktop.kappa().then((k) => ($("#k").textContent = (k || "").split(":").pop().slice(0, 16) + "…"));
        renderGrid(); // keep the zone grid in sync (layout changes converge across tabs too)
      }
      desktop.onChange(render); render(desktop.doc());
      // ── tabs: each tab is its OWN editable holospace canvas — a saved scene over the one window
      //    manager. Switching tabs swaps the live world; render() rebuilds its windows. New Tab = a
      //    fresh Build·Run·Share canvas; opening an app gives it its own tab (Chrome-like). ──
      const tabs = [{ id: "t0", title: "Home", home: true, addr: "", snap: null }];
      let activeTab = 0;
      // each tab carries its OWN address — κ (holo://·did) · web2 (http) · web3 (.eth) · ipfs · local —
      // shown in its favicon + the omnibox, so moving between holospaces feels like a real browser.
      const schemeOf = (a) => { a = String(a || ""); if (/^(holo:\/\/|did:holo|sha256:)/i.test(a)) return { k: "kappa", ic: "◆" }; if (/^(ipfs:\/\/|ipns:\/\/)/i.test(a)) return { k: "ipfs", ic: "⬡" }; if (/(^|\.)eth(\/|$)|^eth:/i.test(a)) return { k: "eth", ic: "◈" }; if (/^https?:\/\//i.test(a)) return { k: "web", ic: "🌐" }; return { k: "local", ic: "⌂" }; };
      const TAB_COLORS = ["hsl(217 91% 62%)", "hsl(160 84% 42%)", "hsl(38 92% 55%)", "hsl(0 84% 63%)", "hsl(271 81% 62%)", "hsl(330 81% 62%)", "hsl(173 80% 44%)", "hsl(239 84% 70%)"];
      let tabGroups = {}, tgN = 0;
      const cloneWorld = (w) => { try { return JSON.parse(JSON.stringify(w || [])); } catch { return []; } };
      const snapshotWorld = () => { const d = desktop.doc(); return { world: cloneWorld(d.world), layout: d.layout, focusedId }; };
      function restoreWorld(snap) {
        desktop.change((d) => { if (d.world.length) d.world.splice(0, d.world.length); for (const n of cloneWorld(snap && snap.world)) d.world.push(n); if (snap && snap.layout) d.layout = snap.layout; });
        focusedId = (snap && snap.focusedId) || null;
      }
      // ── per-holospace widgets: each tab owns a κ-addressed widget board that swaps WITH the tab,
      //    exactly like the world above. Added from the canvas right-click ("Add widget" / "Focus
      //    space"). Home persists to localStorage; other holospaces are session + κ scoped. The runtime
      //    loads `defer`, so guard every call behind withHW(). onChange mirrors any board mutation into
      //    the live tab (the save side); applyWidgets(i) mounts a tab's board on switch (the restore side).
      function withHW(fn) { const h = window.HoloWidgets; if (h) return fn(h); let n = 0; const t = setInterval(() => { if (window.HoloWidgets) { clearInterval(t); fn(window.HoloWidgets); } else if (++n > 60) clearInterval(t); }, 80); }
      // Persistence keyed by HOLOSPACE IDENTITY (the tab's κ/address), so a holospace's widgets survive
      // reload: reopen the same app and its board returns. Home uses the runtime's own localStorage
      // (`holo-widgets.v1`); every other addressed holospace is keyed here by `tab.addr`. A blank tab
      // (no addr) is session-only. This is what makes per-holospace boards reload-persistent.
      const HW_SPACES = "holo-widgets.spaces.v1";
      const spaceKey = (t) => (t && !t.home && t.addr) ? t.addr : null;
      const loadSpaces = () => { try { return JSON.parse(localStorage.getItem(HW_SPACES) || "{}"); } catch (e) { return {}; } };
      const loadSpace = (t) => { const k = spaceKey(t); if (!k) return null; const b = loadSpaces()[k]; return Array.isArray(b) ? b : null; };
      const persistSpace = (t, snap) => { const k = spaceKey(t); if (!k) return; try { const all = loadSpaces(); all[k] = snap; localStorage.setItem(HW_SPACES, JSON.stringify(all)); } catch (e) {} };
      const applyWidgets = (i) => withHW((h) => {
        const t = tabs[i]; if (!h.setBoard || !t) return;
        if (t.home) { if (t.widgets && t.widgets.length) { try { h.setBoard(t.widgets, { persist: true }); } catch (e) {} } return; }   // Home → runtime localStorage; NEVER persist an empty board over the seeded/saved one (that wiped the greeting + day-ring clock)
        const board = loadSpace(t) || t.widgets || [];                                                 // addressed holospace → keyed store (reload-stable)
        t.widgets = board;
        try { h.setBoard(board, { persist: false }); } catch (e) {}
      });
      withHW((h) => {
        if (h.onChange) h.onChange((snap) => { const t = tabs[activeTab]; if (t) { t.widgets = snap; persistSpace(t, snap); } try { scheduleSave(); } catch (e) {} });   // mirror live + persist by holospace key + autosave the session
        if (h.snapshot) tabs[0].widgets = h.snapshot();
      });
      // ── Share Holospace (ADR-0105): capture THIS ONE holospace (isolated) + open a shared one as a NEW
      //    tab. captureHolospace reads ONLY the active tab's world (every window carries its own bytes via
      //    srcdoc/content + its saved appState) and ONLY this holospace's board slice (loadSpace) — never
      //    another holospace's data, never operator/device/global settings. The sealer (holo-workspace-
      //    sync.mjs) turns it into a content-addressed bundle; applyHolospace re-opens it here, apps live.
      function captureHolospace() {
        const t = tabs[activeTab];
        if (t) { try { t.snap = snapshotWorld(); } catch (e) {} }
        let board = null; try { board = loadSpace(t) || (t && t.widgets) || null; } catch (e) {}
        return { title: t ? cleanName(t.title) : "Holospace", addr: (t && t.addr) || "", snap: t ? t.snap : { world: [] }, board: Array.isArray(board) ? board : [] };
      }
      // captureWorkspace() — the WHOLE experience (every holospace + order + active + open surfaces + each
      // adopting app's state + the settings allowlist) as one PLAINTEXT holo:SessionManifest, for the portable
      // backup (ADR-0105 sealWorkspace). Distinct from captureHolospace (one tab): this is "carry my entire OS".
      async function captureWorkspace() {
        try { await collectAppState(); } catch (e) {}                 // fold each adopting app's state into its node first
        try { if (tabs[activeTab]) tabs[activeTab].snap = snapshotWorld(); } catch (e) {}
        return HoloSession.currentExperienceManifest({ tabs, activeTab });
      }
      // everythingAuthGate() — "Everything" exports the WHOLE OS (every holospace + settings), so a SIGNED-IN
      // operator must re-prove presence to this device's biometric (Windows Hello · Touch/Face ID · fingerprint)
      // before it proceeds. A GUEST has no operator/biometric and no cross-holospace secret to protect → no
      // gate (their data is already device-local). Fail-closed: signed-in + no biometric available → refuse.
      async function everythingAuthGate() {
        let op = null; try { op = HoloSession.signedInOperator(); } catch (e) {}
        if (!op || !op.kappa) return true;                            // guest → no gate
        try {
          // PAYLOAD-BOUND step-up through the one seam (was bare teeAssert presence). "everything.open" is
          // authority-tier → a fresh open prompts; a re-open within the trust window is suppressed (effortless).
          const { enforce } = await import("/_shared/holo-stepup-gate.mjs");
          const g = await enforce({ kind: "everything.open", appId: "org.hologram.shell", operator: op.kappa,
            reason: "Open Everything — your full cross-app search", payload: null }, { credentialId: op.cred });
          if (!g.ok) { try { toast("Confirm with biometrics — " + (g.reason || "denied")); } catch (_) {} return false; }
          return true;
        } catch (e) { try { toast("Step-up unavailable: " + ((e && e.message) || e)); } catch (_) {} return false; }
      }
      // onImportShared(m) — route an opened bundle by its type: a whole-experience SessionManifest RESUMES the
      // full session (replaces the current one — that's "resume my exact workspace"); a HolospaceShare opens as
      // a new isolated tab. Both already re-derive every block (L5) in the sealer.
      function onImportShared(m) {
        try {
          if (m && Array.isArray(m["@type"]) && m["@type"].includes("holo:SessionManifest")) {
            applyBody(m).then((ok) => { if (ok) { try { renderTabs(); reflectOmni(); } catch (e) {} flushSession(); } });
            return true;
          }
        } catch (e) {}
        return applyHolospace(m);
      }
      function applyHolospace(m) {
        try {
          const hs = m && m["holo:holospace"]; if (!hs) return false;
          exitStudio(true);
          if (tabs[activeTab]) tabs[activeTab].snap = snapshotWorld();
          const snap = (hs.snap && typeof hs.snap === "object") ? hs.snap : { world: [], layout: null, focusedId: null };
          const t = { id: "t" + tabs.length + Math.random().toString(36).slice(2, 5), title: hs.title || "Shared holospace", addr: hs.addr || "", snap };
          try { for (const n of (snap.world || [])) { if (n && n.appState != null && n.id) _appPending.set(n.id, n.appState); } } catch (e) {}   // imported apps' saved state → re-applied by the handshake
          const board = Array.isArray(hs.board) ? hs.board : []; t.widgets = board;
          try { if (t.addr) { const all = loadSpaces(); if (!Array.isArray(all[t.addr])) { all[t.addr] = board; localStorage.setItem(HW_SPACES, JSON.stringify(all)); } } } catch (e) {}   // no clobber: keep a local board for the same addr if present
          tabs.push(t); activeTab = tabs.length - 1;
          restoreWorld(snap); applyWidgets(activeTab); renderTabs(); reflectOmni(); updateNav(); scheduleSave();
          try { toast("App opened in a new tab"); } catch (e) {}
          return true;
        } catch (e) { console.warn("applyHolospace:", e); return false; }
      }
      // Create mode is a transient overlay on #world (NOT a tab). Any tab change / navigation dissolves
      // it first, so a new or switched tab never lands you in the creator. (apply=true saves edits.)
      function exitStudio(apply) {
        if (!studio) return; const s = studio; studio = null; document.body.classList.remove("cs-active");
        try { if (apply && s.editable && s.node && s.ta) applyEdit(s.node.id, s.ta.value); } catch (e) {}
        try { s.ov.remove(); } catch (e) {}
      }
      // ── per-holotab navigation history (browser-grade) ───────────────────────────────────────────
      //   Each tab keeps a stack of view snapshots. recordNav() pushes the current view (truncating any
      //   forward history); Back/Forward walk it; Home returns to the tab's FIRST view — its original
      //   app · page · desktop. Snapshots are the same {world,layout,focusedId} a tab switch round-trips,
      //   so navigation is seamless and self-contained per tab.
      function updateNav() {
        const t = tabs[activeTab] || {}, len = (t.hist && t.hist.length) || 0, hi = t.hi || 0;
        const b = $("#nav-back"), f = $("#nav-fwd"); if (b) b.disabled = !(len && hi > 0); if (f) f.disabled = !(len && hi < len - 1);
      }
      function recordNav() {
        const t = tabs[activeTab]; if (!t) return; const snap = snapshotWorld();
        if (!t.hist) { t.hist = [snap]; t.hi = 0; } else { t.hist = t.hist.slice(0, (t.hi || 0) + 1); t.hist.push(snap); t.hi = t.hist.length - 1; }
        updateNav();
      }
      function goNav(delta) {
        exitStudio(true); const t = tabs[activeTab]; if (!t || !t.hist) return;
        const ni = Math.max(0, Math.min(t.hist.length - 1, (t.hi || 0) + delta)); if (ni === t.hi) return;
        t.hi = ni; restoreWorld(t.hist[ni]); renderTabs(); reflectOmni(); updateNav();
      }
      function goHome() {   // the holotab's ORIGINAL view — app, page, or desktop
        exitStudio(true); const t = tabs[activeTab]; if (!t) return;
        if (t.hist && t.hist.length) { t.hi = 0; restoreWorld(t.hist[0]); } else restoreWorld(null);
        renderTabs(); reflectOmni(); updateNav();
      }
      // ── Holo Browser SKINS (holo:BrowserSkin) — hot-swappable vintage chrome (NCSA Mosaic, …) mounted
      // INSIDE each browser <holo-window> shadow root and bound to THIS tab's live nav state. Default
      // "modern" = today's chrome (no skin). A skin can ONLY dress a browser tab — never OS chrome (the
      // engine refuses appliesTo≠browser). A swap never touches the iframe (only sibling chrome rows), so
      // history / URL / scroll / back-forward survive with no reload (state-preserving, Stage 0 witnessed).
      // The catalogue of browser skins (id → display title) — the SINGLE source of truth, shared by the
      // boot default-guard here and the skin picker below. First entry is the default. "modern" = the
      // native Holo chrome (no skin).
      const SKINS = [{ id: "modern", title: "Modern (Holo)" }, { id: "mosaic", title: "NCSA Mosaic" }, { id: "netscape", title: "Netscape Navigator" }, { id: "ie", title: "Internet Explorer" }, { id: "opera", title: "Opera" }, { id: "winxp", title: "Windows XP" }, { id: "win98", title: "Windows 98" }, { id: "win11", title: "Windows 11" }, { id: "aqua", title: "Mac OS X Aqua" }, { id: "bigsur", title: "macOS Big Sur" }, { id: "crt", title: "CRT Terminal (Amber)" }, { id: "lcars", title: "LCARS (Star Trek)" }, { id: "holographic", title: "Holographic" }, { id: "lotr", title: "Lord of the Rings" }, { id: "foundation", title: "Foundation" }, { id: "hhgttg", title: "Hitchhiker's Guide" }];
      const SKIN_IDS = new Set(SKINS.map((s) => s.id));
      // First-time boot (no stored choice) ⇒ Modern (Holo). A stored id is honoured ONLY if it is still a
      // known skin; anything unrecognized (corrupted, or a retired skin) falls back to modern — so the
      // shell can never boot dressed in a skin that no longer exists.
      let activeSkin = (() => { try { const s = localStorage.getItem("holo.skin"); return (s && SKIN_IDS.has(s)) ? s : "modern"; } catch { return "modern"; } })();
      const _skinCache = Object.create(null);
      function ensureSkin(id) {
        if (!id || id === "modern") return Promise.resolve(null);
        if (_skinCache[id]) return _skinCache[id];
        const base = "/_shared/skins/" + id + "/";
        const read = async (rel) => new Uint8Array(await (await fetch(base + rel, { cache: "force-cache" })).arrayBuffer());
        return (_skinCache[id] = HoloSkin.resolveSkin(id, { read }).catch((e) => { console.warn("holo-skin:", id, e); _skinCache[id] = null; return null; }));
      }
      // a WebContents-shaped view of the active tab (what the skin throbber / status / nav buttons read).
      function skinState() {
        const t = tabs[activeTab] || {}, len = (t.hist && t.hist.length) || 0, hi = t.hi || 0;
        return { loading: !!t.loading, securityState: t.security || "neutral",
          nav: { current: { url: t.addr || "" }, canGoBack: !!(len && hi > 0), canGoForward: !!(len && hi < len - 1) } };
      }
      const skinBind = {
        "nav.back": () => goNav(-1), "nav.forward": () => goNav(1), "nav.home": () => goHome(),
        "nav.reload": () => reloadBrowser(), "nav.stop": () => setTabLoading(false),
        "omni.focus": () => { const i = $("#omni input") || $("#omni"); if (i && i.focus) { i.focus(); i.select && i.select(); } },
        "tab.new": () => newTab(), "tab.close": () => { try { closeTab(activeTab); } catch {} },
        "about": () => toast("NCSA Mosaic — re-authored as a Holo Browser skin"), "noop": () => {},
      };
      function skinTick() { const st = skinState(); for (const [, el] of mounted) { const h = el.__skinHost; if (h && h.__skinBinder) try { h.__skinBinder.update(st); } catch {} } }
      function setTabLoading(on) { const t = tabs[activeTab]; if (t) t.loading = !!on; skinTick(); }
      function reloadBrowser() { setTabLoading(true); for (const [, el] of mounted) { if (el.hasAttribute("browser")) { const f = el.querySelector("iframe"); if (f) try { f.src = f.src; } catch {} } } }
      // AUTONOMY (C5): a seam Q's evolve loop uses to RELOAD a crashed app frame — a real, REVERSIBLE fix
      // (the app reopens; nothing is destroyed). Matches an open app node by name/title/appId; re-sets the
      // iframe (src or srcdoc) to remount it. Returns true if an app was reloaded. Used only behind Q.trust.
      try {
        window.__holoAppReload = function (name) {
          try {
            const want = String(name || "").toLowerCase().replace(/\s+·.*$/, "").trim();
            const world = (typeof desktop !== "undefined" && desktop.doc) ? desktop.doc().world : [];
            for (const n of world) {
              if (!n || n.kind !== "app") continue;
              const nm = String(n.title || n.name || n.appId || "").toLowerCase().replace(/\s+·.*$/, "").trim();
              if (nm !== want && String(n.appId || "").toLowerCase() !== want) continue;
              const el = mounted.get(n.id); const f = el && el.querySelector("iframe");
              if (f) { try { if (f.srcdoc) { const s = f.srcdoc; f.srcdoc = ""; f.srcdoc = s; } else { f.src = f.src; } return true; } catch (e) {} }
            }
          } catch (e) {}
          return false;
        };
      } catch (e) {}
      // applyShellSkin(resolved) — EVERY holospace tab IS a Holo Browser (like Chrome, one site per tab), so a
      // skin re-dresses the browser's WHOLE chrome — the tab strip, toolbar + omnibox, the LEFT dock/rail, and
      // the BOTTOM status bar — into the era's palette + font (derived from the manifest, no new asset). Ink is
      // CONTRAST-CORRECT off the chrome luminance (black on light skins, white on dark), so text never washes
      // out. A short colour morph makes the switch feel like a time machine. Reversible — modern removes it all.
      function applyShellSkin(resolved) {
        let st = document.getElementById("holo-skin-shell");
        if (!resolved) { if (st) st.remove(); document.documentElement.removeAttribute("data-skin"); return; }
        if (!st) { st = document.createElement("style"); st.id = "holo-skin-shell"; document.head.appendChild(st); }
        const p = resolved.palette || {}, f = resolved.font || {};
        const chrome = p.chrome || "#c0c0c0", bl = p.bevelLight || "#fff", bd = p.bevelDark || "#808080", ui = f.ui || "sans-serif";
        // contrast: pick ink from the chrome's perceived luminance (handles future dark skins too).
        const hx = String(chrome).replace("#", ""); const R = parseInt(hx.slice(0, 2), 16) || 192, G = parseInt(hx.slice(2, 4), 16) || 192, B = parseInt(hx.slice(4, 6), 16) || 192;
        const light = (0.299 * R + 0.587 * G + 0.114 * B) > 150;
        const ink = light ? "#101010" : "#f4f4f4", dim = light ? "#3a3a3a" : "#c8c8c8", hover = light ? "#00000016" : "#ffffff22", iconFilter = light ? "brightness(0)" : "brightness(0) invert(1)";
        const I = " !important";
        st.textContent = [
          "#tabstrip,#navbar,#holo-dock,#holo-dock .holo-dock-inner,#holo-credit{transition:background-color .3s ease,color .3s ease,box-shadow .3s ease}",
          "#tabstrip{background:" + chrome + I + ";font-family:" + ui + I + "}",
          "#tabstrip .tab,#tabstrip button,#newtab{color:" + ink + I + ";font-family:" + ui + I + "}",
          "#tabstrip .tab:not(.active){background:" + chrome + I + "}",
          "#tabstrip .tab.active{background:" + bl + I + ";color:" + ink + I + ";box-shadow:inset 1px 1px 0 #fff,inset -1px -1px 0 " + bd + I + "}",
          "#tabstrip .tab.active::before,#tabstrip .tab.active::after{background:" + bl + I + "}",
          "#navbar{background:" + chrome + I + ";border-bottom:2px solid " + bd + I + ";box-shadow:inset 0 1px 0 " + bl + I + ";font-family:" + ui + I + "}",
          "#navbar .nav,#navbar button,#verb-build,#verb-run,#share-btn,#navbar .vl{color:" + ink + I + "}",
          "#navbar .nav:hover:not(:disabled),#navbar button:hover{background:" + hover + I + "}",
          "#omni{background:#fff" + I + ";border:1px solid " + bd + I + ";border-radius:3px" + I + ";box-shadow:inset 1px 1px 0 " + bd + I + "}",
          "#omni input{color:#101010" + I + ";font-family:" + ui + I + "}",
          "#omni input::placeholder{color:#666" + I + "}",
          "#holo-dock{--hd-opaque-bg:" + chrome + I + ";--hd-blur-bg:" + chrome + I + ";--hd-acrylic-bg:" + chrome + I + ";--hd-clear-bg:" + chrome + I + ";--hd-blur-fx:none" + I + ";--hd-ink:" + ink + I + ";--hd-ink-dim:" + dim + I + ";--hd-border:" + bd + I + ";--hd-hover:" + hover + I + ";border-right:2px solid " + bd + I + ";box-shadow:inset -1px 0 0 " + bl + I + "}",
          "#holo-dock .holo-dock-inner{background:" + chrome + I + "}",
          "#holo-dock .holo-dock-icon,#holo-dock .holo-dock-mini{filter:" + iconFilter + I + ";opacity:.92" + I + "}",
          "#holo-credit{background:" + chrome + I + ";border-top:2px solid " + bd + I + ";box-shadow:inset 0 1px 0 " + bl + I + ";font-family:" + ui + I + "}",
          "#holo-credit,#holo-credit *{color:" + ink + I + "}",
          "#holo-credit .cv-pill{border-color:" + bd + I + "}",
          // the skin's OWN shell stylesheet (κ-pinned) layers last → full control: gradients, glass, curves, textures
          resolved.shellCss || "",
        ].join("");
        document.documentElement.setAttribute("data-skin", resolved.id);
      }
      // skinSync(el,n) — idempotent per window: mount / unmount the active skin's chrome to match state.
      async function skinSync(el, n) {
        const want = (n && n.browser && activeSkin && activeSkin !== "modern") ? activeSkin : null;
        if (el.__skinId === want) { if (want) skinTick(); return; }
        const frame = el.shadowRoot && el.shadowRoot.querySelector(".frame"); if (!frame) return;
        el.__skinId = want;
        if (!want) { HoloSkin.unmountChrome(frame); el.__skinHost = null; el.removeAttribute("skin"); return; }
        const resolved = await ensureSkin(want); if (!resolved) { el.__skinId = null; return; }
        if (el.__skinId !== want) return;   // active skin changed while awaiting
        el.setAttribute("skin", want);
        el.__skinHost = HoloSkin.mountChrome(frame, resolved, { bind: skinBind, getState: skinState });
      }
      // setActiveSkin(id) — the switch: re-skin every live browser window (state-preserving), persist,
      // seal a holo:SkinActivation receipt (pins the manifest-κ, re-derivable Law L5).
      async function setActiveSkin(id) {
        id = id || "modern"; activeSkin = id; try { localStorage.setItem("holo.skin", id); } catch {}
        const resolved = await ensureSkin(id);
        applyShellSkin(resolved);   // the WHOLE browser chrome (tab strip + omnibar) goes vintage on every tab
        for (const [, el] of mounted) {
          const frame = el.shadowRoot && el.shadowRoot.querySelector(".frame"); if (!frame) continue;
          if (!el.hasAttribute("browser") || !resolved) { HoloSkin.unmountChrome(frame); el.__skinHost = null; el.__skinId = resolved ? null : "modern"; el.removeAttribute("skin"); continue; }
          el.__skinId = id; el.setAttribute("skin", id);
          el.__skinHost = await HoloSkin.swap(frame, resolved, { bind: skinBind, getState: skinState });
        }
        skinTick();
        if (resolved) { try { await HoloSkin.activationReceipt(id, resolved.manifestKappa); } catch {} }
        toast(id === "modern" ? "Holo Browser · modern chrome" : "Holo Browser · " + (resolved ? resolved.manifest["holo:title"] : id) + " skin");
      }
      // SW load-END edge → stop the throbber + reflect the seam's verify verdict on the matching tab (L5).
      try {
        navigator.serviceWorker.addEventListener("message", (e) => {
          const m = e && e.data; if (!m || m.type !== "committed") return;
          const t = tabs[activeTab]; if (t) { t.loading = false;
            t.security = m.refused ? "dangerous" : (m.verified ? ((m.scheme === "https" || m.scheme === "holo" || m.scheme === "ipfs") ? "secure" : "neutral") : (m.scheme === "http" ? "warning" : "neutral")); }
          skinTick();
        });
      } catch {}
      ensureSkin(activeSkin).then(applyShellSkin);   // warm-preload + dress the browser chrome on boot (no FOUC)
      // openSkinPicker() — the one affordance to change skins, with a live sealed preview of each.
      function openSkinPicker() {
        if (!document.getElementById("skinpick-css")) { const st = document.createElement("style"); st.id = "skinpick-css"; st.textContent =
          ".skinpick-back{position:fixed;inset:0;z-index:1000;background:rgba(2,4,8,.62);backdrop-filter:blur(7px);display:grid;place-items:center;padding:3vh 2vw}" +
          // the panel is golden-ratio landscape (φ:1) and fills the screen — a wide gallery, not a tall modal
          // a true golden rectangle (φ:1) that always fits: width = smallest of 1680px / 96vw / (94vh·φ); height derives from aspect-ratio
          ".skinpick{position:relative;width:min(1680px,96vw,calc(94vh*1.618));aspect-ratio:1.618;max-height:94vh;display:flex;flex-direction:column;background:linear-gradient(180deg,#10151f,#0a0e16);border:1px solid var(--holo-border,#2a313c);border-radius:20px;box-shadow:0 50px 140px #000d,0 0 0 1px #ffffff0a;color:var(--holo-ink,#e6edf6);font:var(--holo-text-sm, 0.875rem) var(--win-font);overflow:hidden}" +
          ".skinpick-head{flex:0 0 auto;display:flex;align-items:baseline;gap:14px;padding:22px 30px 16px;border-bottom:1px solid #ffffff0d}" +
          ".skinpick-head h3{margin:0;font-size:22px;font-weight:650;letter-spacing:.2px}.skinpick-sub{color:var(--holo-ink-dim,#8b949e);font-size: var(--holo-text-sm, 0.813rem)}" +
          // a fluid grid that fills the width — more columns on wider screens; each card is golden-ratio (φ:1)
          ".skinpick-grid{flex:1;min-height:0;overflow:auto;padding:24px 30px 32px;display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:26px;align-content:start}" +
          ".skinpick-card{display:flex;flex-direction:column;gap:11px;padding:0;background:transparent;border:0;cursor:pointer;color:inherit;font:inherit;text-align:left}" +
          ".skinpick-prev{aspect-ratio:1.618;border-radius:13px;overflow:hidden;background:#fff;display:flex;flex-direction:column;box-shadow:0 8px 26px #0008,0 0 0 1px #ffffff12;transition:transform .2s cubic-bezier(.2,.8,.2,1),box-shadow .2s}" +
          ".skinpick-card:hover .skinpick-prev{transform:translateY(-5px) scale(1.012);box-shadow:0 20px 46px #000b,0 0 0 1px var(--accent,#1f6feb)}" +
          ".skinpick-card.sel .skinpick-prev{box-shadow:0 12px 30px #000a,0 0 0 2.5px var(--accent,#1f6feb)}" +
          ".skinpick-name{display:flex;align-items:center;gap:7px;font-weight:600;font-size: var(--holo-text-sm, 0.906rem);padding:0 3px;color:var(--holo-ink,#e6edf6)}" +
          ".skinpick-name .chk{margin-left:auto;color:#fff;background:var(--accent,#1f6feb);width:19px;height:19px;border-radius:50%;display:grid;place-items:center;font-size: var(--holo-text-sm, 0.75rem);flex:0 0 auto}" +
          ".skinpick-modern{flex:0 0 auto;display:flex;align-items:center;gap:8px;height:40px;padding:0 13px;background:#1F1F21;color:#c9d1d9;font:var(--holo-text-sm, 0.781rem) var(--win-font)}.skinpick-modern .pill{margin-left:auto;background:#0c111b;border:1px solid #30363d;border-radius:8px;padding:3px 12px;opacity:.85}" +
          ".skinpick-x{position:absolute;top:18px;right:22px;width:34px;height:34px;border:0;border-radius:10px;background:#ffffff10;color:inherit;font-size:16px;cursor:pointer;transition:background .15s}.skinpick-x:hover{background:#ffffff22}" +
          "@media (max-width:720px){.skinpick{aspect-ratio:auto;height:92vh}.skinpick-grid{grid-template-columns:1fr}}";
          document.head.appendChild(st); }
        // (SKINS is the hoisted single source of truth defined above.)
        // a faux page so every preview reads like a real tab in that skin — the chrome wraps a live little site.
        const fauxPage = (pal) => { const lu = (pal && pal.linkUnvisited) || "#0000ee", lv = (pal && pal.linkVisited) || "#551a8b"; const d = document.createElement("div");
          d.style.cssText = "flex:1;min-height:0;background:#fff;overflow:hidden;padding:13px 16px;font:var(--holo-text-sm, 0.813rem) Georgia,'Times New Roman',serif;color:#222;line-height:1.5";
          d.innerHTML = "<div style=\"font:700 17px Georgia,serif;margin-bottom:5px;color:#111\">The Hologram Web</div><div style=\"color:#555;margin-bottom:9px\">Every page is content-addressed and re-derived before it paints.</div><a href=\"#\" style=\"color:" + lu + ";text-decoration:underline\">An unvisited link</a> &nbsp;·&nbsp; <a href=\"#\" style=\"color:" + lv + ";text-decoration:underline\">a visited one</a>"; return d; };
        const back = document.createElement("div"); back.className = "skinpick-back";
        back.innerHTML = '<div class="skinpick"><div class="skinpick-head"><h3>Browser Skin</h3><span class="skinpick-sub">A κ-addressed dress for the whole browser — every tab, every era. Switches live, no reload.</span></div><div class="skinpick-grid"></div><button class="skinpick-x" title="Close">✕</button></div>';
        const grid = back.querySelector(".skinpick-grid");
        for (const s of SKINS) {
          const card = document.createElement("button"); card.type = "button"; card.className = "skinpick-card" + (s.id === activeSkin ? " sel" : "");
          card.innerHTML = '<div class="skinpick-prev" data-prev></div><div class="skinpick-name">' + s.title + (s.id === activeSkin ? '<span class="chk">✓</span>' : "") + "</div>";
          card.onclick = async () => { document.body.removeChild(back); await setActiveSkin(s.id); };
          grid.appendChild(card);
          const prev = card.querySelector("[data-prev]");
          if (s.id === "modern") { prev.innerHTML = '<div class="skinpick-modern">⌂ &nbsp; <span style="opacity:.6">◀ ▶ ↻</span> <span class="pill">holo://…</span></div>'; prev.appendChild(fauxPage(null)); }
          else ensureSkin(s.id).then((r) => { if (!r) { prev.textContent = "(unavailable)"; return; }
            const f = document.createElement("div"); f.className = "frame"; f.style.cssText = "display:flex;flex-direction:column;height:100%"; f.appendChild(fauxPage(r.palette)); prev.appendChild(f);
            HoloSkin.mountChrome(f, r, { bind: {}, getState: () => ({ loading: true, securityState: "secure", nav: { current: { url: "https://www.hologram.os/" }, canGoBack: true, canGoForward: false } }) }); });
        }
        back.querySelector(".skinpick-x").onclick = () => document.body.removeChild(back);
        back.addEventListener("click", (e) => { if (e.target === back) document.body.removeChild(back); });
        document.body.appendChild(back);
      }
      function renderTabs() {
        const strip = $("#tabstrip"), nt = $("#newtab");
        [...strip.querySelectorAll(".tab")].forEach((t) => t.remove());
        tabs.forEach((t, i) => {
          const el = document.createElement("button"); el.type = "button"; el.className = "tab" + (i === activeTab ? " active" : "") + (t.pinned ? " pinned" : "") + (t.dev ? " dev" : ""); el.setAttribute("role", "tab");
          const title = dropHolo((t.title || "New Tab").replace(/^🌐\s*/, ""));
          const fav = document.createElement("span"); fav.className = "t-fav"; fav.textContent = t.home ? "⌂" : (t.play ? "▶" : (t.startHere ? "✦" : (t.dev ? "✦" : (t.addr ? schemeOf(t.addr).ic : "✦"))));
          el.append(fav); el.title = (t.dev ? "Dev — building, not yet published · " : "") + (t.addr ? t.addr + " " : "") + title;
          if (!t.pinned) { const ttl = document.createElement("span"); ttl.className = "t-ttl"; ttl.textContent = title; el.append(ttl); }   // pinned = favicon only
          if (t.group && tabGroups[t.group]) { el.classList.add("grouped"); el.style.setProperty("--tg", tabGroups[t.group].color); }   // a Chrome-style colored tab group
          if (t.home) el.classList.add("home");   // the Home tab is permanent — no close button (selection + drag are delegated)
          else if (!t.pinned) { const x = document.createElement("span"); x.className = "t-x"; x.title = "Close tab"; x.textContent = "✕"; x.onclick = (e) => { e.stopPropagation(); closeTab(i); }; el.append(x); }   // pinned tabs have no close (Chrome)
          strip.insertBefore(el, nt);
        });
        publishNav();
        try { window.__syncHints && window.__syncHints(); } catch (e) {}   // keep the Home-tab hint bar Home-only
      }
      // bridge to the dock navigator: publish the open holospaces (each by its κ/address) + an opener,
      // so the expanded dock renders a live, κ-anchored Recents list and switches holospaces instantly.
      function publishNav() {
        try {
          window.__holoNav = tabs.map((t) => ({ k: t.addr || ("holo:tab:" + t.id), name: dropHolo((t.title || "Holospace").replace(/^🌐\s*/, "")), kind: "holospace", fav: !!t.pinned }));
          window.dispatchEvent(new Event("holo-nav"));
        } catch (e) {}
      }
      const navApp = (id) => { try { const a = catalog.find((x) => x.id === id); if (a) launch(a); else toast("Not available offline"); } catch (e) {} };
      window.HoloShell = Object.assign(window.HoloShell || {}, {
        open: function (k) { const i = tabs.findIndex((t) => (t.addr || ("holo:tab:" + t.id)) === k); if (i >= 0) selectTab(i); return i >= 0; },
        nav: function () { return window.__holoNav || []; },
        // native categories → their real κ-addressed holospaces/apps (the dock navigator calls these)
        home: function () { selectTab(0); },
        search: function () { const o = $("#omni-addr"); if (o) { o.focus(); o.select && o.select(); } },
        files: function () { navApp("org.hologram.HoloFiles"); },
        apps: function () { try { openSpot(); } catch (e) {} },
        tools: function () { navApp("org.hologram.HoloForge"); },
        settings: function () { navApp("org.hologram.HoloControl"); },
        resources: function () { navApp("org.hologram.HoloDocs"); },
        // generic openers the desktop launch tiles (Holo Widgets, ADR-0095/modes) call by app id
        openApp: function (appId, title) { try { return openHolospaceApp(appId, "", title || ""); } catch (e) {} },
        // ── new-tab openers — the left NAV routes every launch through these so a click ALWAYS opens a
        //    fresh, focused holospace tab (never hijacks the current surface) ──
        openTab: function (appId, title, query) { try { newTab(title || ""); return openHolospaceApp(appId, query || "", title || ""); } catch (e) {} },
        newTab: function () { try { newTab(); recordNav(); const o = $("#omni-addr"); if (o) o.focus(); } catch (e) {} },           // a fresh empty holospace tab, omnibar focused
        searchTab: function () { try { newTab(""); recordNav(); } catch (e) {} const o = $("#omni-addr"); if (o) { o.focus(); o.select && o.select(); } },   // a fresh tab, ready to search
        wallet: function () { try { return window.HoloWallet && window.HoloWallet.open(); } catch (e) {} },   // the wallet is core OS chrome (the docked sovereign vault), not a catalog app — always opens the same surface
        q: function () { try { return window.Q && window.Q.summon && window.Q.summon(); } catch (e) {} },
      });
      const omniAddr = { words: null, kappa: null, revealed: false };   // the focused app's human + machine address, for the copy/reveal icons
      const reflectOmni = () => {
        const t = tabs[activeTab] || {}; const o = $("#omni-addr"); const omni = $("#omni");
        let words = null, kappa = null, name = null;
        const m = /^holo:\/\/(.+)$/.exec(t.addr || "");
        if (m) { const a = catalog.find((c) => c.id === m[1] || String(c.did || "").endsWith(m[1])); if (a && a.words) { words = a.words; kappa = "holo://" + String(a.did || "").split(":").pop(); } }
        // THE ADDRESS IS A NAME: anything not matched as a three-word app above (the OS front door —
        // login/shell/home — and every landing-page app) gets its clean human name from HoloAddress, a
        // verified projection of the κ. The leak (raw holo://os/…html in the bar) becomes "Login" / "Home".
        if (!words && t.addr) { try { name = window.HoloAddress && window.HoloAddress.nameSync ? window.HoloAddress.nameSync(t.addr) : null; } catch (e) {} }
        const friendly = words || name;
        if (kappa !== omniAddr.kappa || name !== omniAddr.name) omniAddr.revealed = false;   // a new place → default to the friendly name
        omniAddr.words = words; omniAddr.kappa = kappa; omniAddr.name = name; omniAddr.full = t.addr || "";
        if (omni) omni.classList.toggle("has-addr", !!friendly);   // show the copy + reveal-address icons only when there's a name to hide a path behind
        if (o && document.activeElement !== o) o.value = friendly ? (omniAddr.revealed ? (kappa || omniAddr.full) : friendly) : (t.addr || "");
        const rv = $("#omni-reveal"); if (rv) { rv.classList.toggle("on", omniAddr.revealed); rv.title = omniAddr.revealed ? "Show the short name" : "Show the full address"; }
        const sec = $("#omni .sec"); if (sec) { sec.dataset.scheme = t.addr ? schemeOf(t.addr).k : "search"; }
        updateScope();
      };   // omnibox keeps the static Hologram mark; the per-tab scheme rides the tab favicon
      // Warm the name index once at boot so nameSync is live, then repaint the bar (the front-door
      // PLACES — Login/Home — resolve even before the catalog loads; landing-page apps light up after).
      try { window.HoloAddress && window.HoloAddress.ready && window.HoloAddress.ready().then(() => { try { reflectOmni(); } catch (e) {} }); } catch (e) {}
      // ── ONE search bar, standardised: the active holospace's name sits by ⌂, and the omnibar's plain-text
      //    search is forwarded INTO that tab's app (it prioritises its own κ-objects). Address-like input
      //    (κ · CID · URL · holo://) still navigates globally. Apps opt in via `holo:search:ready`. ──
      function dropHolo(s) { return String(s || "").replace(/\bHolo\s+/i, ""); }   // "Holo Hub" → "Hub": drop the repetitive prefix every native app shares (hoisted — used by renderTabs above)
      const cleanName = (s) => dropHolo(String(s || "").replace(/^[^\p{L}\p{N}]+/u, "")).split("  ·  ")[0].trim();
      function activeAppFrame() { try { const el = (focusedId && mounted.get(focusedId)) || world.querySelector("holo-window"); return el ? el.querySelector("iframe") : null; } catch { return null; } }
      function updateScope() {
        const t = tabs[activeTab] || {}, sc = $("#scope"), o = $("#omni-addr"); if (!sc) return;
        if (!t.home && t.title && t.title !== "New Tab") { sc.hidden = false; sc.textContent = cleanName(t.title); }
        else { sc.hidden = true; sc.textContent = ""; }
        if (o && document.activeElement !== o) o.placeholder = t.appSearch ? ("Search " + (cleanName(t.title) || "this holospace")) : "Search anything";
      }
      function isAddrLike(q) { q = (q || "").trim(); if (!q) return false; try { const pr = parseRef(q); if (pr.kind === "kappa" || pr.kind === "cid") return true; } catch {} try { const cls = classify(q, catalog); return cls.kind === "web" || cls.kind === "holo"; } catch { return false; } }
      function inTabSearch(q) { const t = tabs[activeTab]; return !!(t && t.appSearch && !isAddrLike(q)); }
      function forwardSearch(q) { const f = activeAppFrame(); if (f && f.contentWindow) { try { f.contentWindow.postMessage({ type: "holo:search", q: q }, "*"); } catch {} } }
      addEventListener("message", (e) => { const d = e.data; if (!d || d.type !== "holo:search:ready") return; const f = activeAppFrame(); if (f && e.source === f.contentWindow) { const t = tabs[activeTab]; if (t) { t.appSearch = true; t.searchLabel = d.app || cleanName(t.title); updateScope(); } } });
      function selectTab(i) { if (i === activeTab || !tabs[i]) return; exitStudio(true); tabs[activeTab].snap = snapshotWorld(); activeTab = i; restoreWorld(tabs[i].snap); applyWidgets(i); applyTabWall(tabs[i]); renderTabs(); reflectOmni(); updateNav(); scheduleSave(); try { window.__paintEmpty && window.__paintEmpty(); window.__pinQOrb && window.__pinQOrb(); } catch (e) {} }
      // ensureStartHereTab() — guarantee a pinned "Start here" tab right after Home (survives session
      // restore; never duplicated) AND always land the operator on HOME when logging in. Start here sits
      // next to Home, available but never the landing surface. Idempotent — safe to call once at boot.
      // needNewTab() — should a launch open its OWN tab? YES when the active tab is Home, the Start here
      // surface, or already holds an app (isolation: every holo app gets its own holospace tab — the only
      // way to combine apps in one tab is the user manually nesting/snapping them). NO only for a blank
      // scratch tab (a fresh "+" tab), which the launch fills in place. Robust to the serializer dropping
      // the home/startHere flags (re-stamped at boot), so a launch never overlaps Home's widgets again.
      function needNewTab() {
        const t = tabs[activeTab];
        // activeTab === 0 is the permanent Home base (never closed, never reordered before 0) — treat it as
        // Home even if the serializer stripped the flag, so a launch from Home ALWAYS opens its own tab.
        return !!(activeTab === 0 || (t && (t.home || t.startHere || t.play)) || (desktop.doc().world || []).length > 0);
      }
      function ensureStartHereTab() {
        if (!tabs.some((t) => t.home) && tabs[0]) tabs[0].home = true;   // re-stamp the `home` flag the serializer drops (else launches mount INTO Home instead of a new tab)
        // A "Start here" tab is identified by ANY of: the flag, its holo://start addr, or its title — because
        // the session serializer can DROP the non-standard `startHere` flag on reload, which otherwise made a
        // fresh one get inserted every boot (the accumulating duplicate tabs the user saw). Collapse to one.
        const isSH = (t) => !!t && (t.startHere || t.addr === "holo://start" || t.title === "Start here");
        const first = tabs.findIndex(isSH);
        if (first >= 0) {
          for (let i = tabs.length - 1; i > first; i--) { if (isSH(tabs[i])) { tabs.splice(i, 1); if (activeTab > i) activeTab--; else if (activeTab === i) activeTab = first; } }
          const t = tabs[first]; t.startHere = true; t.title = "Start here"; t.addr = "holo://start"; delete t.pinned;   // re-stamp the flag the serializer drops + normalize
        } else {
          const t = { id: "tstart" + Math.random().toString(36).slice(2, 5), title: "Start here", startHere: true, addr: "holo://start", snap: null };
          tabs.splice(1, 0, t);                                  // right after Home
          if (activeTab >= 1) activeTab++;                       // keep the restored selection pointing at the same tab (for now)
        }
        // ── pinned "Play" tab right after Start here: the streaming front door (Continue watching + Discover) ──
        const isPlay = (t) => !!t && (t.play || t.addr === "holo://play" || t.title === "Play");
        const pf = tabs.findIndex(isPlay);
        if (pf >= 0) {
          for (let i = tabs.length - 1; i > pf; i--) { if (isPlay(tabs[i])) { tabs.splice(i, 1); if (activeTab > i) activeTab--; else if (activeTab === i) activeTab = pf; } }
          const t = tabs[pf]; t.play = true; t.title = "Play"; t.addr = "holo://play"; delete t.pinned;
        } else {
          const shIdx = tabs.findIndex(isSH); const at = shIdx >= 0 ? shIdx + 1 : 2;
          tabs.splice(at, 0, { id: "tplay" + Math.random().toString(36).slice(2, 5), title: "Play", play: true, addr: "holo://play", snap: null });
          if (activeTab >= at) activeTab++;
        }
        const homeIdx = tabs.findIndex((t) => t.home);           // ALWAYS land on Home at login (the user's home base)
        if (homeIdx >= 0 && activeTab !== homeIdx) {
          try { if (tabs[activeTab]) tabs[activeTab].snap = snapshotWorld(); } catch (e) {}
          activeTab = homeIdx;
          restoreWorld(tabs[homeIdx].snap);
          try { applyTabWall(tabs[homeIdx]); } catch (e) {}   // home widgets are owned by HoloWidgets' own boot/seed — never reload (let alone wipe) them here
        }
        renderTabs(); reflectOmni(); try { window.__paintEmpty && window.__paintEmpty(); } catch (e) {}
      }
      // evacuateHomeApps() — Home is the desktop (greeting + widgets only). If a pre-fix session left an app
      // window nested INTO Home (e.g. an old Holo Control), move each app into its OWN tab so Home is never
      // overlapped by an app again. One-time self-healing migration; runs at boot while active on Home.
      function evacuateHomeApps() {
        const homeIdx = tabs.findIndex((t) => t.home);
        if (homeIdx < 0 || activeTab !== homeIdx) return;
        const apps = (desktop.doc().world || []).filter((n) => n.kind === "app");
        if (!apps.length) return;
        for (const n of apps) {
          const node = JSON.parse(JSON.stringify(n));
          node.id = nid(); node.state = "max"; node.frameless = false; node.nested = false; node.locked = false; delete node.prev;
          tabs.push({ id: "t" + tabs.length + Math.random().toString(36).slice(2, 6), title: String(node.title || "App").split("  ·  ")[0],
            addr: node.appId ? ("holo://" + node.appId) : (node.webAddr || ""), snap: { world: [node], layout: null, focusedId: node.id } });
        }
        desktop.change((d) => { d.world = (d.world || []).filter((n) => n.kind !== "app"); });   // strip apps from Home; keep folders / icons / desktop objects
        try { tabs[homeIdx].snap = snapshotWorld(); } catch (e) {}
        renderTabs(); reflectOmni();
      }
      function newTab(title) { exitStudio(true); tabs[activeTab].snap = snapshotWorld(); tabs.push({ id: "t" + tabs.length + Math.random().toString(36).slice(2, 5), title: title || "New Tab", addr: "", snap: null }); activeTab = tabs.length - 1; restoreWorld(null); applyWidgets(activeTab); applyTabWall(tabs[activeTab]); renderTabs(); reflectOmni(); updateNav(); scheduleSave(); try { window.__paintEmpty && window.__paintEmpty(); window.__pinQOrb && window.__pinQOrb(); } catch (e) {} return activeTab; }   // every newly opened tab snaps Q's orb back to its bottom-left home
      // ── DEV TAB — Create opens its build-screen preview in its OWN fresh tab (not an overlay on the
      //    originating tab). It stays a `dev` tab — a sandboxed build canvas, marked with a subtle cue —
      //    until Publish seals it to an isolated, content-addressed κ holo app (publishDevTab). Every dev
      //    tab is born on the canonical default ("Original") wallpaper, regardless of the desktop's pick. ──
      function newDevTab(title) {
        exitStudio(true); tabs[activeTab].snap = snapshotWorld();
        const t = { id: "t" + tabs.length + Math.random().toString(36).slice(2, 5), title: title || "Create", addr: "", snap: null, dev: true };
        tabs.push(t); activeTab = tabs.length - 1;
        restoreWorld(null); applyWidgets(activeTab); applyTabWall(t);
        renderTabs(); reflectOmni(); updateNav(); scheduleSave(); return activeTab;
      }
      // Publish: a dev tab graduates into a sealed κ holospace tab — drop the dev cue + its forced
      // wallpaper, adopt the κ as the tab's address. Called from the studio's Publish action.
      function publishDevTab(k) {
        const t = tabs[activeTab]; if (!t || !t.dev || !k) return;
        t.dev = false; delete t.wallK;
        t.addr = "holo://" + String(k).split(":").pop();
        renderTabs(); reflectOmni(); applyTabWall(t); scheduleSave();
      }
      function closeTab(i) {
        if (!tabs[i] || tabs[i].home || tabs.length <= 1) return;   // the Home tab is permanent
        const wasActive = i === activeTab; tabs.splice(i, 1);
        if (activeTab > i || activeTab >= tabs.length) activeTab = Math.max(0, activeTab - 1);
        if (wasActive) { restoreWorld(tabs[activeTab].snap); applyWidgets(activeTab); applyTabWall(tabs[activeTab]); }
        renderTabs(); reflectOmni(); updateNav(); scheduleSave();
      }
      const setActiveTabTitle = (t) => { if (tabs[activeTab]) { tabs[activeTab].title = String(t || "").split("  ·  ")[0].slice(0, 40); renderTabs(); scheduleSave(); } };
      const setActiveTabAddr = (a) => { const t = tabs[activeTab]; if (t) { const changed = t.addr !== (a || ""); t.addr = a || ""; if (changed && !t.home) applyWidgets(activeTab); } renderTabs(); reflectOmni(); scheduleSave(); };   // re-render so the favicon reflects the new scheme; on a NEW holospace identity, restore that holospace's saved widget board
      // ── Chrome-like new tab: "+" opens a fresh, self-contained holospace desktop tab (its own world)
      //    and drops you on the address bar — exactly the browser new-tab gesture. ──
      $("#newtab").onclick = () => { newTab(); recordNav(); $("#omni-addr").focus(); };   // "+" → fresh empty desktop holotab (its empty desktop IS this tab's origin)

      // ════ Holo Session (ADR-0106): seamless continuity for EVERY user, SOVEREIGN at rest ════
      //   ONE mechanism, REALMS (holo-session.mjs): a GUEST's work autosaves to a device-key realm and
      //   restores at boot with ZERO action; the instant they SIGN IN it is CLAIMED (re-keyed) under their
      //   vault key — Max sovereign: encrypted so no other operator on this profile can read it. A
      //   returning operator's world materializes right after they unlock. applyExperience writes the
      //   saved settings back BEFORE the subsystems read them (initWall / playground / deferred
      //   holo-widgets+voice all read localStorage AFTER this point), so everything rehydrates in ONE
      //   reflow. App-internal state rides an OPT-IN handshake (holo-session-client). Nothing leaves the device.
      let _ssReady = false, _ssSaveT = 0;
      const _appPending = new Map();   // surfaceId → state to hand a participating app when it announces readiness
      const _appCollect = new Map();   // surfaceId → resolver, while collecting app state on flush
      // Deep Resume: GENERIC per-app deep-state (scroll + drafts) captured straight from each same-origin app
      // frame — zero per-app code. Used iff an app provides no custom holo-session-client state. Lazy + fail-soft.
      let _ResumeDom = null;
      import("/_shared/holo-resume-dom.mjs").then((m) => { _ResumeDom = m; }).catch(() => {});
      // Session Roam: install the live device relay (window.HoloRelay; inert until a device pairs) so roam's
      // "devices" leg has a relay to bind. The session-manifest roamer itself is created on pairing (below).
      let _sessionRoam = null;
      import("/_shared/holo-relay-bus.mjs").catch(() => {});
      function appFrames() { const out = []; try { for (const [id, el] of mounted) { const f = el.querySelector && el.querySelector("iframe"); if (f && f.contentWindow) out.push([id, f]); } } catch (e) {} return out; }
      // collect each open app's opt-in state into its world node (best-effort, timed — a non-participating app simply never replies)
      function collectAppState(timeout) {
        const frames = appFrames(); if (!frames.length) return Promise.resolve();
        return new Promise((resolve) => {
          let pending = frames.length; const fin = () => { if (--pending <= 0) { clearTimeout(to); resolve(); } };
          const domFallback = new Map();   // Deep Resume: generic scroll+draft snapshot per surface
          const to = setTimeout(() => {
            // an app that DID reply already set its custom state + was removed from _appCollect (custom wins);
            // anything still pending got no custom state → fall back to the generic deep-state snapshot.
            for (const [id] of frames) {
              if (!_appCollect.has(id)) continue;
              _appCollect.delete(id);
              const dom = domFallback.get(id);
              if (dom) { try { patch(id, (n) => { n.appState = { __holoResumeDom: dom }; }); } catch (e) {} }
            }
            resolve();
          }, timeout || 160);
          for (const [id, f] of frames) {
            try { if (_ResumeDom) domFallback.set(id, _ResumeDom.capture(f.contentWindow)); } catch (e) {}   // direct same-origin read; null if not accessible
            _appCollect.set(id, (state) => { try { patch(id, (n) => { if (state == null) delete n.appState; else n.appState = state; }); } catch (e) {} fin(); });
            try { f.contentWindow.postMessage({ t: "holo-session:save", surfaceId: id }, "*"); } catch (e) { fin(); }
          }
        });
      }
      addEventListener("message", (e) => {
        const m = e && e.data; if (!m || typeof m !== "object") return;
        if (m.t === "holo-session:state") { const r = _appCollect.get(m.surfaceId); if (r) { _appCollect.delete(m.surfaceId); r(m.state); } }
        else if (m.t === "holo-session:ready") {   // a participating app mounted → hand it any queued restore, else resume its OWN per-app chain (Phase A: reopen → exactly as you left it)
          try { for (const [id, f] of appFrames()) {
            if (f.contentWindow !== e.source) continue;
            if (_appPending.has(id)) { f.contentWindow.postMessage({ t: "holo-session:restore", surfaceId: id, state: _appPending.get(id) }, "*"); _appPending.delete(id); }
            else { const node = desktop.doc().world.find((n) => n.id === id); HoloWB.resumeFor(node).then((st) => { if (st != null) f.contentWindow.postMessage({ t: "holo-session:restore", surfaceId: id, state: st }, "*"); }); }
          } } catch (x) {}
        }
      });
      async function flushSession() {
        if (!_ssReady) return;
        try { await collectAppState(); } catch (e) {}                 // fold each participating app's state into its world node
        try { if (tabs[activeTab]) tabs[activeTab].snap = snapshotWorld(); } catch (e) {}
        try { await HoloWB.captureWorld(desktop.doc().world); } catch (e) {}   // Phase A/C: fold each app's fresh state into its per-app chain, SCOPED to the active workspace (lazy; dedup'd)
        try { window.__holoRoam && window.__holoRoam.advertiseAll(); } catch (e) {}   // Phase E: if Roam is on, mirror the captured changes to other tabs/devices
        try { await HoloSession.saveSnapshot({ tabs, activeTab }); } catch (e) {}
        try { _sessionRoam && _sessionRoam.publish(); } catch (e) {}                  // Session Roam: advertise this manifest to paired devices (inert until paired)
      }
      function scheduleSave() { if (!_ssReady || (typeof document !== "undefined" && document.visibilityState === "hidden")) return; clearTimeout(_ssSaveT); _ssSaveT = setTimeout(flushSession, 800); }   // debounced; a hidden tab defers to its pagehide flush (cross-tab guard)
      // applyBody(manifest) — settings → localStorage, rebuild tabs, queue per-app state, repaint. ONE reflow.
      async function applyBody(_body) {
        if (!_body) return false;
        const _exp = await HoloSession.applyExperience(_body);
        if (!Array.isArray(_exp.tabs) || !_exp.tabs.length) return false;
        tabs.length = 0; for (const t of _exp.tabs) tabs.push(t);
        activeTab = Math.max(0, Math.min(_exp.activeTab | 0, tabs.length - 1));
        _appPending.clear();
        for (const t of tabs) { for (const n of ((t.snap && t.snap.world) || [])) { if (n && n.appState != null && n.id) _appPending.set(n.id, n.appState); } }
        restoreWorld(tabs[activeTab].snap);
        if (!tabs[activeTab].home) applyWidgets(activeTab);           // home board auto-loads from restored localStorage; a holospace board rides HW_SPACES
        return true;
      }
      try {   // BOOT: a CAR-resume (ADR-0105, explicit + device-agnostic) first, else THIS device's active realm
        // AUTH ⊗ RESTORE, ONE MOTION: if the lock screen just signed an operator in, it left their session
        // vault key as a consume-once handoff. Adopt it BEFORE any restore so activeRealm() resolves to the
        // operator's SOVEREIGN realm — their exact prior world is unwrapped here, no second biometric. Absent
        // (guest, or warm reveal with the key already in memory) → falls through to the device realm as before.
        try { await HoloSession.takeUnlock(); } catch (e) {}
        let _link = null;                                            // (a guest → the device-key realm, so a guest lands where they left off with NO action)
        try { _link = await resolveBootResume(); } catch (e) {}       // a shared holospace (#wks) or cloud token (?wks) opened as a URL
        let _body = null;
        try { _body = HoloSession.takeResume(); } catch (e) {}        // a staged resume (legacy reload path)
        if (!_body) _body = await HoloSession.restoreSnapshot();      // THIS device's own active realm — restore it first (the resume spine reconciles drift inside restoreSnapshot)
        try { const _c = await HoloSession.resumeContinuity(); if (_c && _c.continuity !== "ok" && _c.continuity !== "empty") console.log("[holo-strand] resume continuity:", _c.continuity, _c); } catch (e) {}
        await applyBody(_body);
        if (_link) {                                                  // then open what the link carried, as a NEW isolated tab
          if (Array.isArray(_link["@type"]) && _link["@type"].includes("holo:HolospaceShare")) applyHolospace(_link);
          else await applyBody(_link);
        }
        // the pinned "Start here" tab — present after Home on every boot; the user always lands on Home
        try { ensureStartHereTab(); } catch (e) {}
        try { evacuateHomeApps(); } catch (e) {}   // self-heal: move any app left nested in Home into its own tab (pre-fix sessions)
      } catch (e) { console.warn("holo-session: restore skipped —", e && e.message); }
      _ssReady = true;                                                // EVERY user persists now (guest → device realm · unlocked operator → vault realm)
      // Phase C: the workspace switcher — named desktop arrangements (one pill in the tab strip). Fail-soft.
      try {
        const _wsApply = async (m) => { try { await applyBody(m); renderTabs(); reflectOmni(); updateNav(); window.__paintEmpty && window.__paintEmpty(); window.__pinQOrb && window.__pinQOrb(); } catch (e) {} };
        const _wsFresh = async () => { const h = tabs.find((t) => t.home) || tabs[0]; return HoloSession.currentExperienceManifest({ tabs: [h], activeTab: 0 }); };
        HoloWSwitch.mountSwitcher(document.getElementById("tabstrip"), { getManifest: () => captureWorkspace(), applyManifest: _wsApply, freshManifest: _wsFresh })
          .then(() => { try {   // Phase E: the ⇄ Roam toggle — mirror open windows across tabs/devices (verify-before-trust)
            const _roamApply = (appKappa, state) => { try { for (const n of desktop.doc().world) { if (n.kind === "app" && HoloWB.appKappaOf(n) === appKappa) { const el = mounted.get(n.id), f = el && el.querySelector("iframe"); if (f && f.contentWindow) f.contentWindow.postMessage({ t: "holo-session:restore", surfaceId: n.id, state: state }, "*"); } } } catch (e) {} };
            const _roamApps = () => desktop.doc().world.filter((n) => n.kind === "app").map((n) => ({ appKappa: HoloWB.appKappaOf(n) })).filter((x) => x.appKappa);
            HoloRoamWan.attach({ getActiveHost: () => HoloWB.activeHost(), getOpenApps: _roamApps, applyAdopted: _roamApply });   // EMBEDDED + SEAMLESS: roam is automatic (tabs now; devices when a relay is present)
          } catch (e) {} }).catch(() => {});
      } catch (e) {}
      // ONE-TIME REPAIR: a prior build's applyWidgets(home) could persist an EMPTY board over the seeded
      // "Welcome" scene (the warm greeting over the day-progress ring), and the seed flag then blocked a
      // re-seed. If, after boot settles, the Home board is still empty, restore Welcome once — so the
      // greeting + circle come back. Fresh users (already seeded) and anyone who later clears it are untouched.
      try {
        setTimeout(() => withHW((h) => {
          try {
            const snap = (h.snapshot && h.snapshot()) || [];
            const hasWelcome = snap.some((w) => w.type === "dayring" || w.type === "greeting");   // the Welcome face = greeting over the day-progress ring
            const homeActive = tabs[activeTab] && tabs[activeTab].home;
            if (!hasWelcome && homeActive && h.setMode) h.setMode("welcome");   // logging in lands in Welcome mode: if Home is missing its greeting + day-ring (empty OR a board from dev churn), (re)seed it
          } catch (e) {}
        }), 1400);
      } catch (e) {}
      try {   // catch-all: capture EVERY axis when the tab is hidden / closing — so SIGN-OUT (→ greeter) PRESERVES the snapshot
        document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushSession(); });
        window.addEventListener("pagehide", flushSession);
      } catch (e) {}
      // onSignIn(operator, secret) — the greeter calls this the instant a secret is in hand. Derive the vault
      // key, then: a RETURNING operator's saved world is restored; a NEW operator (no prior realm) KEEPS the
      // guest work they just built (claim). Either way ONE reflow — the live desktop never blinks to empty.
      async function onSignIn(operator, secret) {
        try {
          if (!operator || !secret || !(await HoloSession.unlockOperatorKey({ operator, secret }))) return;
          let body = await HoloSession.restoreOperator();             // returning operator → their sovereign world
          if (!body) { const c = await HoloSession.claimGuestRealm(); body = c && c.body; }   // first sign-in → claim guest work
          if (body) { await applyBody(body); try { renderTabs(); reflectOmni(); } catch (e) {} }
          flushSession();
          try { bootSessionRoam(); } catch (e) {}   // operator just unlocked → activate roam for their devices
        } catch (e) { console.warn("holo-session onSignIn:", e && e.message); }
      }
      window.HoloSession = Object.assign(window.HoloSession || {}, {
        save: flushSession,
        onSignIn,
        operatorLocked: () => { try { return HoloSession.operatorLocked(); } catch (e) { return false; } },
        reset: async () => { try { await HoloSession.resetDevice(); toast("This device's saved experience was reset · reload to start fresh"); } catch (e) {} },
      });

      // SESSION ROAM — your live session follows you to a PAIRED device by κ. Pairing (holo-pair) calls
      // window.HoloSessionRoam.activate({operator, pairKey}) with the shared operator κ + E2E pair key and
      // attaches the device channel via window.HoloRelay.attach(...). Then each save tick advertises this
      // manifest; an incoming newer manifest is verify-before-trust'd + resumed (applyBody); a true divergence
      // keeps BOTH. kappaOf hashes ONLY the stable holo:experience (NOT the volatile timestamp) so an identical
      // desktop reads as in-sync; seq = the manifest's generatedAtTime (recency). Fail-soft + inert until paired.
      window.HoloSessionRoam = Object.assign(window.HoloSessionRoam || {}, {
        active: () => !!_sessionRoam,
        async activate({ operator, pairKey } = {}) {
          try {
            if (!operator || !pairKey || !window.HoloRelay) return false;
            const [{ makeSessionRoam }, { topicOf }, { jcs }] = await Promise.all([
              import("/_shared/holo-session-roam.mjs"), import("/_shared/holo-pull-rendezvous.mjs"), import("/_shared/holo-uor.mjs")]);
            const keyBytes = pairKey instanceof Uint8Array ? pairKey : new Uint8Array(pairKey);
            const cipher = HoloSession.makeCipher(keyBytes);
            const enc = new TextEncoder();
            const kappaOf = async (b) => "did:holo:sha256:" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(jcs((b && b["holo:experience"]) || b))))].map((x) => x.toString(16).padStart(2, "0")).join("");
            const getLocal = async () => { const body = await HoloSession.currentExperienceManifest({ tabs, activeTab }); return { body, seq: Date.parse(body["prov:generatedAtTime"]) || 0 }; };
            const applyRemote = async (body) => { try { await applyBody(body); renderTabs(); reflectOmni(); updateNav(); try { window.__paintEmpty && window.__paintEmpty(); } catch (e) {} } catch (e) {} };
            const onDiverged = (body) => { import("/_shared/holo-roam-choose.mjs").then((m) => m.offerRoamResume({ label: "your other device", onResume: () => applyRemote(body) })).catch(() => { try { toast("Your session from another device is ready"); } catch (e) {} }); };   // P4: one-tap chooser, never auto-clobber
            const self = (crypto.randomUUID && crypto.randomUUID()) || ("d" + (Date.parse(new Date().toISOString()) || 0));
            _sessionRoam = makeSessionRoam({ relay: window.HoloRelay, topic: topicOf(operator), cipher, kappaOf, getLocal, applyRemote, onDiverged, self });
            _sessionRoam.start(); _sessionRoam.publish();
            return true;
          } catch (e) { console.warn("session-roam activate:", e && e.message); return false; }
        },
        // fromPairing — a pairing flow hands the shared roam key (b64) + the channel + this device's role
        // (offer = the device that minted the grant · answer = the new device). Activate roam, then open the
        // WebRTC datachannel to the other device and attach it to the relay. Any authorizer/login pairing path
        // can call this directly. Cross-MACHINE liveness verifies on two real devices.
        async fromPairing({ operator, roamKey, channel, role } = {}) {
          try {
            if (!operator || !roamKey || !window.HoloRelay) return false;
            const key = roamKey instanceof Uint8Array ? roamKey : Uint8Array.from(atob(roamKey), (c) => c.charCodeAt(0));
            if (!(await window.HoloSessionRoam.activate({ operator, pairKey: key }))) return false;
            if (channel) { try { const { roamOffer, roamAnswer } = await import("/_shared/holo-roam-link.mjs"); (role === "offer" ? roamOffer : roamAnswer)(channel, (dc) => { try { window.HoloRelay.attach(dc); } catch (e) {} }).catch(() => {}); } catch (e) {} }
            return true;
          } catch (e) { return false; }
        },
      });
      // bootSessionRoam — auto-activate roam for THIS operator's own surfaces (other windows on this machine):
      // a roam key derived from the unlocked vault key (identical across the operator's windows), over a
      // same-origin BroadcastChannel attached to the device relay. Cross-DEVICE roam activates via the pairing
      // roam key (holo-pair → window.HoloSessionRoam.activate + a WebRTC datachannel on window.HoloRelay).
      // Fail-soft + idempotent; inert for guests / locked / no-relay. Function declaration → onSignIn can call it.
      async function bootSessionRoam() {
        try {
          if (_sessionRoam || !window.HoloRelay) return;                                // already roaming / relay-bus not loaded yet
          // (a) cross-DEVICE: a pairing handed us a shared roam key (consume-once) → open the datachannel + roam
          let pr = null; try { pr = JSON.parse(sessionStorage.getItem("holo.roam.pair") || "null"); } catch (e) {}
          if (pr && pr.operator && pr.roamKey) { try { sessionStorage.removeItem("holo.roam.pair"); } catch (e) {} await window.HoloSessionRoam.fromPairing(pr); return; }
          // (b) same-MACHINE: this operator's OTHER WINDOWS, via a same-origin BroadcastChannel
          const op = HoloSession.signedInOperator && HoloSession.signedInOperator(); if (!op) return;
          const rk = await HoloSession.roamKeyBytes(); if (!rk) return;                 // operator must be unlocked
          try { if (typeof BroadcastChannel !== "undefined") window.HoloRelay.attach(new BroadcastChannel("holo-roam:" + op)); } catch (e) {}
          await window.HoloSessionRoam.activate({ operator: op, pairKey: rk });
        } catch (e) {}
      }
      bootSessionRoam(); setTimeout(bootSessionRoam, 1200);   // now + once after the async relay-bus import settles

      // WARM LOCK — "lock, don't log out": gate the warm-resident shell behind a biometric on hide/idle. The
      // session stays live in memory (no navigation, no re-restore on unlock); eligible ONLY for a real
      // operator with a device biometric — a guest / no-biometric session is never locked (never stranded).
      // Pure-JS: warm-resident SW_HIDE fires visibilitychange, which the lock listens for (no native change).
      try { const { installWarmLock } = await import("/_shared/holo-lock-ui.mjs"); window.__holoLock = installWarmLock(); } catch (e) { console.warn("warm-lock install:", e && e.message); }

      renderTabs(); recordNav();   // seed the Home tab's origin (its current desktop)
      // The empty canvas (Home or a fresh tab) is intentionally clean — just the wallpaper. The
      // "New holospace" hero (mark + heading + subtitle + Create/Apps/Search) was removed; those
      // actions live in the toolbar (Create) and the omnibox (apps · search). render() still toggles
      // #empty — it just has no content now.
      (function buildNewTabPage() {
        const e = $("#empty"); if (e) e.dataset.built = "1";   // mark built so render() leaves it empty
      })();
      // ── full-screen toggle (browser-grade), to the right of Sign in ──
      (function wireFullscreen() {
        const b = $("#fullscreen-btn"); if (!b) return;
        const EXP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
        const CMP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3M16 3v3a2 2 0 0 0 2 2h3M8 21v-3a2 2 0 0 0-2-2H3M16 21v-3a2 2 0 0 1 2-2h3"/></svg>';
        const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
        const sync = () => { const on = !!fsEl(); b.innerHTML = on ? CMP : EXP; b.title = on ? "Exit full screen" : "Full screen"; b.setAttribute("aria-label", b.title); };
        b.onclick = () => { try { if (fsEl()) (document.exitFullscreen || document.webkitExitFullscreen).call(document); else { const el = document.documentElement; (el.requestFullscreen || el.webkitRequestFullscreen).call(el); } } catch (e) {} };
        document.addEventListener("fullscreenchange", sync); document.addEventListener("webkitfullscreenchange", sync); sync();
      })();
      // ── Wallet → a right-docked, isolated, capability-gated holospace that SLIDES in from the edge
      //    (a browser-extension wallet, OS-native). It RE-MOUNTS on every open (fresh sandboxed iframe)
      //    so the wallet always boots LOCKED and re-requests biometrics — value can never be reached
      //    without a fresh tap. Closing unmounts it (→ relocked). The iframe is sandboxed + gated by the
      //    same host capability seam every app passes, so it is self-verified and default-deny. ──
      (function wireWallet() {
        const b = $("#identity-btn"); if (!b) return;
        let aside = null, frame = null, busy = false;
        // The holospace squeeze + the widget/Q-orb lockstep glide are baked into createAside (reflowGlide),
        // so EVERY carriage — Wallet included — reflows the desktop identically. No bespoke nudge here.
        function ensure() {
          if (aside) return aside;
          // same right-side template as Play · Share · Notify · Create: golden scale + the » collapse chevron.
          aside = createAside({ id: "wallet", title: "Wallet", onClose: () => {
            b.classList.remove("on"); b.setAttribute("aria-expanded", "false");
            setTimeout(() => { if (aside && !aside.isOpen() && frame) frame.src = "about:blank"; }, 360);   // unmount → wallet relocked
          }});
          aside.body.insertAdjacentHTML("beforeend", '<iframe class="wallet-frame" title="Holo Wallet"></iframe>');
          frame = aside.body.querySelector("iframe");
          // The wallet carries its OWN top bar (◈ Holo Wallet · κ✓ · sites · settings · collapse), so the
          // shared carriage header would just duplicate it as a second "Wallet »" strip. Suppress it for the
          // wallet only — the iframe's bar becomes the single, full-bleed header and its » posts close-wallet.
          try { if (aside.header) aside.header.style.display = "none"; } catch (e) {}
          return aside;
        }
        async function mount() {
          // The wallet is a CORE identity surface — the sovereign vault. It is served from the OS itself
          // (/wallet.html, in usr/share/frame, sealed into the OS closure) rather than the apps catalog,
          // so it ALWAYS mounts with no apps-repo / network dependency. Its capability set is first-party
          // and fixed: storage only (its own κ-store namespace) → allow-scripts allow-same-origin. Still
          // passed through the terms gate, so the operator's standing agreement governs it like any
          // holospace (default-deny preserved, Law-aligned security).
          const def = { name: "Holo Wallet", capabilities: { storage: ["org.hologram.HoloWallet"] } };
          const { sandbox, allow } = capabilitiesToSandbox(await gateCaps(def));   // self-verified: declared ∩ agreed
          if (sandbox) frame.setAttribute("sandbox", sandbox);
          frame.setAttribute("allow", (allow ? allow + "; " : "") + "publickey-credentials-get *; publickey-credentials-create *; clipboard-write");
          frame.src = "/wallet.html?panel=1#" + Date.now();   // fresh load → locked → biometric every open
          return true;
        }
        async function toggle(next) {
          ensure();
          next = next === undefined ? !aside.isOpen() : next;
          if (next) {
            if (busy || aside.isOpen()) return; busy = true;
            const ok = await mount(); busy = false; if (!ok) return;
            aside.open(); b.classList.add("on"); b.setAttribute("aria-expanded", "true");   // open() docks + glides the desktop (reflowGlide) + closes any other carriage; onClose relocks
          } else {
            aside.close();   // onClose handles relock + button state (Esc is handled by the template)
          }
        }
        // the ONE chrome control routes clicks (guest → sign-in · signed-in → wallet); expose the wallet
        // toggle so the identity stamp can open it, and so the in-wallet "open-wallet" bridge can too.
        window.HoloWallet = { toggle: () => toggle(), open: () => toggle(true), close: () => toggle(false), isOpen: () => !!(aside && aside.isOpen()) };
      })();

      // ── Holo Identity bridge — the WALLET is now the one identity surface (its six sovereign categories:
      //    Identity · Money · Data · Intelligence · Compute · Network). The wallet iframe posts category
      //    actions up here; route each to the matching shell control. No separate identity panel. ──
      (function wireIdentityBridge() {
        addEventListener("message", (e) => {
          if (e.origin !== location.origin || !e.data || e.data.type !== "holo-identity") return;
          const a = e.data.action;
          if (a === "open-wallet") { try { window.HoloWallet && window.HoloWallet.open(); } catch (_) {} }   // Money
          else if (a === "close-wallet") { try { window.HoloWallet && window.HoloWallet.close(); } catch (_) {} }   // wallet's own » collapse (it owns the single bar)
          else if (a === "open-q") { try { window.__holoQOrb && window.__holoQOrb.open(); } catch (e) {} }      // Intelligence (Holo Q)
          else if (a === "open-network") { const s = $("#share-btn"); if (s) s.click(); }                     // Network (peer-to-peer share)
          else if (a === "signed-in" || a === "signed-out") { setTimeout(() => location.reload(), 200); }
        });
      })();

      // ── bottom status bar — Privacy (left) · session timer + self-verified OS version (right) ──
      (function wireCredit() {
        const privBtn = $("#cv-privacy"), verBtn = $("#cv-version"), timerEl = $("#cv-timer"), vlabel = $("#cv-vlabel");
        if (!privBtn || !verBtn) return;
        const REPO = "https://github.com/Hologram-Technologies/hologram-os", VERSION = "0.1.0";
        // the Hologram logo — clone the omnibar holomark (same brand mark), sized for a modal header
        const holoLogo = (sz) => { const m = $("#omni .holomark"); if (!m) return ""; const c = m.cloneNode(true); c.setAttribute("width", sz); c.setAttribute("height", sz); c.removeAttribute("class"); return c.outerHTML; };
        // ONE modal, repopulated per screen (version · privacy) — both branded, clean, jargon-free
        let modal = null;
        function ensureModal() { if (modal) return modal; modal = document.createElement("div"); modal.id = "cv-modal"; document.body.appendChild(modal); modal.addEventListener("click", (e) => { if (e.target === modal || (e.target.classList && e.target.classList.contains("cv-x"))) modal.classList.remove("on"); }); return modal; }
        function openModal(inner) { ensureModal().innerHTML = '<div class="cv-card">' + inner + "</div>"; modal.classList.add("on"); return modal; }
        // Privacy → a clean self-descriptive screen (matches the version screen); "Manage" opens the control
        privBtn.onclick = () => {
          const m = openModal(
            '<div class="cv-brand">' + holoLogo(46) + "</div>" +
            "<h2>Your privacy</h2><p class=\"cv-sub\">You decide what anyone sees</p>" +
            '<div class="cv-auth" style="color:var(--holo-accent,#4f8cff)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><path d="M12 2l8 3v6c0 5-3.4 8.5-8 11-4.6-2.5-8-6-8-11V5l8-3z"/></svg> Private by default</div>' +
            '<p class="cv-note why">Your data stays on this device. Nothing about you leaves it unless you allow it.<br><br>Apps and AI agents have to ask you approve each thing once, and everything else stays hidden.<br><br>Choose what each one may see, and take it back any time.</p>' +
            '<button class="cv-btn" id="cv-manage">Manage what’s shared</button>' +
            '<button class="cv-later cv-x">Close</button>');
          m.querySelector("#cv-manage").onclick = () => { modal.classList.remove("on"); const b = $("#holo-privacy-btn"); if (b) b.click(); else if (window.HoloPrivacy && window.HoloPrivacy.openControlCenter) window.HoloPrivacy.openControlCenter(); };
        };
        // session timer — counts from the verified session's issuedAt (else this load)
        let start = Date.now(), startSynced = false;
        const p2 = (n) => String(n).padStart(2, "0");
        (function tick() { if (!startSynced) { try { const hi = window.HoloIdentity; if (hi && hi.issuedAt) { start = new Date(hi.issuedAt).getTime(); startSynced = true; } } catch {} } const s = Math.max(0, Math.floor((Date.now() - start) / 1000)); timerEl.textContent = "◷ " + Math.floor(s / 3600) + ":" + p2(Math.floor((s % 3600) / 60)) + ":" + p2(s % 60); setTimeout(tick, 1000); })();
        // self-verified version — the OS content address (closure root κ) IS the proof
        let rootK = null, files = 0;
        fetch("/etc/os-closure.json", { cache: "no-store" }).then((r) => r.json()).then((c) => {
          rootK = c.root || c.head || null; files = Object.keys(c.closure || {}).length;
          vlabel.textContent = "v" + VERSION + (rootK ? " · " + rootK.split(":").pop().slice(0, 7) : "");
        }).catch(() => { vlabel.textContent = "v" + VERSION; });
        // version click → a clean self-descriptive screen: authenticity + update (matches the privacy screen)
        verBtn.onclick = () => {
          const m = openModal(
            '<div class="cv-brand">' + holoLogo(46) + "</div>" +
            "<h2>Hologram OS</h2><p class=\"cv-sub\">v" + VERSION + " · self-verified</p>" +
            '<div class="cv-auth"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><path d="M20 6 9 17l-5-5"/></svg> Authentic verified on this device</div>' +
            '<div class="cv-k" id="cv-k" title="fingerprint tap to copy">' + (rootK || "") + "</div>" +
            '<p class="cv-note">Every part of this system re-checks against this address when it starts. Change one byte and it won’t run.' + (files ? " " + files + " objects checked." : "") + "</p>" +
            '<div class="cv-verify" id="cv-verify"></div>' +
            '<button class="cv-btn" id="cv-rederive">Verify it myself</button>' +
            '<button class="cv-btn cv-sec" id="cv-update"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:17px;height:17px"><path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5"/></svg> Check for updates</button>' +
            '<button class="cv-later cv-x">Close</button>');
          m.querySelector("#cv-k").onclick = () => { try { navigator.clipboard.writeText(rootK || ""); toast("Fingerprint copied"); } catch {} };
          m.querySelector("#cv-update").onclick = () => window.open(REPO + "/releases", "_blank", "noopener");
          // verify it myself — re-derive every closure object's bytes to its content address, live (Law L5)
          m.querySelector("#cv-rederive").onclick = async (ev) => {
            const btn = ev.currentTarget, out = m.querySelector("#cv-verify");
            if (btn.dataset.busy) return; btn.dataset.busy = "1"; btn.disabled = true;
            out.className = "cv-verify"; out.textContent = "Re-deriving…";
            const sha = (buf) => crypto.subtle.digest("SHA-256", buf).then((d) => "did:holo:sha256:" + [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join(""));
            try {
              const cl = await fetch("/etc/os-closure.json", { cache: "no-store" }).then((r) => r.json()).then((c) => c.closure || {});
              const items = Object.entries(cl), total = items.length;
              let ok = 0, done = 0, i = 0;
              const worker = async () => { while (i < items.length) { const [path, meta] = items[i++];
                try { const buf = await fetch("/" + path, { cache: "no-store" }).then((r) => r.ok ? r.arrayBuffer() : Promise.reject()); if (await sha(buf) === meta.kappa) ok++; } catch (e) {}
                done++; if (done % 3 === 0 || done === total) out.textContent = "Re-deriving… " + done + " / " + total; } };
              await Promise.all(Array.from({ length: 8 }, worker));
              try { window.HoloJourney && window.HoloJourney.mark("first-verify"); } catch (e) {}   // Q Companion: you proved the OS to yourself (Law L5) → Q invites you to bring the web in
              if (ok === total) { out.className = "cv-verify ok"; out.textContent = "✓ All " + total + " objects re-derived to their address."; }
              else { out.className = "cv-verify bad"; out.textContent = ok + " / " + total + " re-derived · " + (total - ok) + " still sealing on this build."; }
            } catch (e) { out.className = "cv-verify bad"; out.textContent = "Couldn’t read the closure to verify."; }
            finally { btn.disabled = false; btn.dataset.busy = ""; }
          };
        };
      })();

      // ── Chrome-grade tab manipulation (in-page, serverless): drag to REARRANGE · drag DOWN to DETACH
      //    (the app pops out as a window on your Home desktop) · drag onto another tab to GROUP. Many
      //    holospaces live in ONE browser tab — no tab sprawl; native windows come later. ──────────────
      const tabEls = () => [...$("#tabstrip").querySelectorAll(".tab")];
      function groupTabs(a, b) {
        if (a === b || !tabs[a] || !tabs[b] || tabs[a].home || tabs[b].home) return;
        let g = tabs[b].group || tabs[a].group;
        if (!g || !tabGroups[g]) { g = "tg" + tgN; tabGroups[g] = { color: TAB_COLORS[tgN % TAB_COLORS.length] }; tgN++; }
        tabs[a].group = g; tabs[b].group = g; renderTabs();
        try { toast("grouped"); } catch (e) {}
      }
      const ungroupTab = (i) => { if (tabs[i]) { tabs[i].group = undefined; renderTabs(); } };
      function duplicateTab(i) {
        if (!tabs[i] || tabs[i].home) return;
        if (i === activeTab) tabs[activeTab].snap = snapshotWorld();
        const s = tabs[i]; const sw = (i === activeTab) ? (window.HoloWidgets && window.HoloWidgets.snapshot && window.HoloWidgets.snapshot()) : s.widgets;
        tabs.splice(i + 1, 0, { id: "t" + tabs.length + Math.random().toString(36).slice(2, 5), title: s.title, addr: s.addr, group: s.group, snap: s.snap ? JSON.parse(JSON.stringify(s.snap)) : null, widgets: sw ? JSON.parse(JSON.stringify(sw)) : null });
        renderTabs();
      }
      function reorderTab(from, to) {
        if (!tabs[from] || tabs[from].home) return;
        const activeObj = tabs[activeTab];
        if (to > from) to--;
        const moved = tabs.splice(from, 1)[0];
        tabs.splice(Math.max(1, Math.min(to, tabs.length)), 0, moved);
        activeTab = tabs.indexOf(activeObj); renderTabs(); reflectOmni();
      }
      function detachTab(i) {                                          // tear a tab off → its app floats onto the Home desktop
        if (!tabs[i] || tabs[i].home) return;
        const src = (i === activeTab) ? cloneWorld(desktop.doc().world) : cloneWorld(tabs[i].snap && tabs[i].snap.world);
        const apps = src.filter((n) => n.kind === "app" || n.kind === "folder");
        if (i !== activeTab) tabs[activeTab].snap = snapshotWorld();
        tabs.splice(i, 1); activeTab = 0; restoreWorld(tabs[0].snap);
        const base = desktop.doc().world.length;
        apps.forEach((n, j) => { const m = JSON.parse(JSON.stringify(n)); delete m.id; m.state = "normal"; if (m.kind === "app") m.frameless = false; m.x = 90 + (base + j) * 34; m.y = 90 + (base + j) * 34; m.w = m.w || 820; m.h = m.h || 540; addNode(m); });   // detached → an isolated, persistently-framed window
        tabs[0].snap = snapshotWorld(); renderTabs(); reflectOmni();
        try { toast("detached to your desktop ⌂"); } catch (e) {}
      }
      // NEST a tab into the holospace you're currently viewing → it becomes an isolated window there
      // (the unpin gesture). Each window is its own sandboxed holospace, so this is true nesting.
      function nestTab(i, cx, cy) {
        if (!tabs[i] || tabs[i].home) return;
        if (i === activeTab) return detachTab(i);                       // can't nest a holospace into itself → pop to the desktop
        const src = cloneWorld(tabs[i].snap && tabs[i].snap.world);
        const apps = src.filter((n) => n.kind === "app" || n.kind === "folder");
        if (!apps.length) { closeTab(i); return; }
        tabs.splice(i, 1); if (activeTab > i) activeTab--;              // stay on the holospace we're nesting INTO
        const r = worldRect(), x = (cx != null ? cx - r.x : r.W / 2), y = (cy != null ? cy - r.y : 90);
        apps.forEach((n, j) => { const m = JSON.parse(JSON.stringify(n)); delete m.id; m.state = "normal"; if (m.kind === "app") m.frameless = false; m.w = m.w || 820; m.h = m.h || 540; m.x = Math.max(0, Math.round(x - m.w / 2 + j * 30)); m.y = Math.max(0, Math.round(y - 16 + j * 30)); addNode(m); });
        recordNav(); renderTabs(); reflectOmni();
        try { toast("nested into this app ⬚"); } catch (e) {}
      }
      // POP a window back OUT to its own tab (the re-pin gesture) → tab⇄window parity, Chrome-grade.
      function popToTab(id) {
        const n = findNode(id); if (!n) return;
        const node = JSON.parse(JSON.stringify(n)); delete node.id; node.state = "max"; node.frameless = false; node.locked = false;
        removeNode(id);                                                  // remove from THIS holospace's canvas
        newTab((node.title || "holospace").split("  ·  ")[0]);          // a fresh tab (snapshots the current world without the node)
        addNode(node);                                                   // the window becomes the tab's holospace, tab-filling
        if (node.appId) setActiveTabAddr("holo://" + node.appId); else if (node.webAddr) setActiveTabAddr(node.webAddr);
        recordNav(); renderTabs(); reflectOmni();
        try { toast("popped out to a tab ⬒"); } catch (e) {}
      }
      // unified pointer drag: click = select · horizontal = reorder · onto a tab = group · downward = detach
      let tdrag = null, tghost = null, tbar = null, thint = null;
      function ensureDragEls() {
        if (!tbar) { tbar = document.createElement("div"); tbar.id = "tabdrop"; document.body.appendChild(tbar); }
        if (!thint) { thint = document.createElement("div"); thint.id = "tabdetach"; thint.textContent = "↓ Nest in this holospace"; document.body.appendChild(thint); }
      }
      function tabMode(x, y) {
        const sr = $("#tabstrip").getBoundingClientRect();
        const nb = $("#navbar"); const floor = nb ? nb.getBoundingClientRect().bottom : sr.bottom;
        if (y > floor + 14) return { mode: "nest" };   // dragged down onto the canvas → nest into the holospace you're viewing
        const els = tabEls();
        for (let j = 0; j < els.length; j++) {
          if (j === tdrag.i || tabs[j].home) continue;
          const r = els[j].getBoundingClientRect();
          if (x >= r.left && x <= r.right) { const f = (x - r.left) / r.width; return (f > 0.34 && f < 0.66) ? { mode: "group", j } : { mode: "reorder", at: f < 0.5 ? j : j + 1 }; }
        }
        return { mode: "reorder", at: tabs.length };
      }
      function makeGhost() {
        const el = tabEls()[tdrag.i]; if (!el) return;
        const r = el.getBoundingClientRect(); tghost = el.cloneNode(true); tghost.id = "tabghost";
        tghost.style.width = r.width + "px"; tghost.style.height = r.height + "px"; tdrag.ox = tdrag.sx - r.left; tdrag.oy = tdrag.sy - r.top;
        document.body.appendChild(tghost);
      }
      const clearTabFx = () => { tabEls().forEach((el) => el.classList.remove("group-target")); if (tbar) tbar.style.display = "none"; if (thint) thint.classList.remove("on"); };
      function onTabMove(e) {
        if (!tdrag) return;
        if (!tdrag.moved && Math.hypot(e.clientX - tdrag.sx, e.clientY - tdrag.sy) < 6) return;
        if (tabs[tdrag.i] && tabs[tdrag.i].home) return;              // Home is pinned — not draggable
        if (!tdrag.moved) { tdrag.moved = true; ensureDragEls(); makeGhost(); }
        if (tghost) { tghost.style.left = (e.clientX - tdrag.ox) + "px"; tghost.style.top = (e.clientY - tdrag.oy) + "px"; }
        const m = tabMode(e.clientX, e.clientY); tdrag.m = m; tdrag.lx = e.clientX; tdrag.ly = e.clientY; clearTabFx();
        if (m.mode === "nest") { thint.classList.add("on"); thint.style.left = (e.clientX + 14) + "px"; thint.style.top = (e.clientY + 16) + "px"; }
        else if (m.mode === "group") { const el = tabEls()[m.j]; if (el) el.classList.add("group-target"); }
        else { const ref = tabEls()[m.at] || $("#newtab"); const r = ref.getBoundingClientRect(); tbar.style.display = "block"; tbar.style.left = (r.left - 3) + "px"; tbar.style.top = r.top + "px"; tbar.style.height = r.height + "px"; }
      }
      function onTabUp() {
        document.removeEventListener("pointermove", onTabMove, true);
        document.removeEventListener("pointerup", onTabUp, true);
        const d = tdrag; tdrag = null; if (tghost) { tghost.remove(); tghost = null; } clearTabFx();
        if (!d) return;
        if (!d.moved) { selectTab(d.i); return; }                    // a plain click → select
        const m = d.m || {};
        if (m.mode === "nest") nestTab(d.i, d.lx, d.ly);
        else if (m.mode === "group" && m.j != null) groupTabs(d.i, m.j);
        else if (m.mode === "reorder") reorderTab(d.i, m.at);
      }
      $("#tabstrip").addEventListener("pointerdown", (e) => {
        if (e.button != null && e.button !== 0) return;
        const tabEl = e.target.closest(".tab"); if (!tabEl || e.target.closest(".t-x")) return;
        const i = tabEls().indexOf(tabEl); if (i < 0) return;
        tdrag = { i, sx: e.clientX, sy: e.clientY, moved: false };
        document.addEventListener("pointermove", onTabMove, true);
        document.addEventListener("pointerup", onTabUp, true);
      });
      // Chrome's tab context-menu actions (native to the substrate: "new window" = a window on your desktop)
      function newTabAt(idx) { exitStudio(true); tabs[activeTab].snap = snapshotWorld(); const t = { id: "t" + tabs.length + Math.random().toString(36).slice(2, 5), title: "New Tab", addr: "", snap: null }; tabs.splice(Math.max(1, Math.min(idx, tabs.length)), 0, t); activeTab = tabs.indexOf(t); restoreWorld(null); applyWidgets(activeTab); applyTabWall(t); renderTabs(); reflectOmni(); recordNav(); try { window.__paintEmpty && window.__paintEmpty(); window.__pinQOrb && window.__pinQOrb(); } catch (e) {} }
      function reflowPins() { const a = tabs[activeTab]; const home = tabs.filter((t) => t.home), pin = tabs.filter((t) => !t.home && t.pinned), rest = tabs.filter((t) => !t.home && !t.pinned); tabs.length = 0; tabs.push(...home, ...pin, ...rest); activeTab = Math.max(0, tabs.indexOf(a)); }
      function togglePin(i) { if (!tabs[i] || tabs[i].home) return; tabs[i].pinned = !tabs[i].pinned; reflowPins(); renderTabs(); reflectOmni(); }
      function closeOthers(i) { const keep = tabs[i]; if (!keep) return; tabs[activeTab].snap = snapshotWorld(); for (let j = tabs.length - 1; j >= 1; j--) if (tabs[j] !== keep && !tabs[j].home) tabs.splice(j, 1); activeTab = Math.max(0, tabs.indexOf(keep)); restoreWorld(tabs[activeTab].snap); applyWidgets(activeTab); applyTabWall(tabs[activeTab]); renderTabs(); reflectOmni(); }
      function closeRight(i) { tabs[activeTab].snap = snapshotWorld(); const wasRight = activeTab > i; for (let j = tabs.length - 1; j > i; j--) if (!tabs[j].home) tabs.splice(j, 1); if (wasRight) { activeTab = i; restoreWorld(tabs[i].snap); applyWidgets(activeTab); applyTabWall(tabs[activeTab]); } renderTabs(); reflectOmni(); }
      $("#tabstrip").addEventListener("contextmenu", (e) => {
        const tabEl = e.target.closest(".tab"); if (!tabEl) return; e.preventDefault();
        const i = tabEls().indexOf(tabEl); if (i < 0) return;
        const t = tabs[i], items = [{ label: "New tab to the right", ic: "+", act: () => newTabAt(i + 1) }, { sep: true }];
        if (!t.home) {
          if (t.group) items.push({ label: "Remove from group", ic: "⊟", act: () => ungroupTab(i) });
          items.push({ label: t.pinned ? "Unpin tab" : "Pin tab", ic: "📌", act: () => togglePin(i) });
          items.push({ label: "Nest in current holospace", ic: "⬚", act: () => nestTab(i) });
          items.push({ label: "Move tab to Home desktop", ic: "⬓", act: () => detachTab(i) });
          items.push({ label: "Duplicate", ic: "⧉", act: () => duplicateTab(i) });
          items.push({ sep: true });
          items.push({ label: "Close", ic: "✕", danger: true, act: () => closeTab(i) });
        }
        items.push({ label: "Close other tabs", ic: "⊗", act: () => closeOthers(i) });
        items.push({ label: "Close tabs to the right", ic: "⊐", act: () => closeRight(i) });
        showCtx(e.clientX, e.clientY, items);
      });
      window.__tabs = { tabs, groups: tabGroups, newTab, newTabAt, selectTab, reorderTab, detachTab, nestTab, popToTab, groupTabs, ungroupTab, duplicateTab, togglePin, closeOthers, closeRight, setAddr: setActiveTabAddr, schemeOf, render: renderTabs };   // scriptable + inspectable
      addEventListener("resize", () => render(desktop.doc()));   // keep max/snapped windows fitted
      // re-fit when the CANVAS itself changes size — viewport resize OR the Holo Dock being re-pinned /
      // folded (its --holo-dock-w/-h shift #world's box). One observer keeps every app exact, always.
      try { new ResizeObserver(() => render(desktop.doc())).observe(world); } catch (e) {}

      // window-manager intents from the chrome
      // govIdentity(n) — the host-asserted identity {did,id,name} of an app node; the privacy broker
      // trusts THIS, never the app's claim. On focus, point the Terms + Privacy shields at it.
      function govIdentity(n) { return { did: (n && n.appDid) || null, id: (n && n.appId) || null, name: ((n && n.title) || "").split("  ·  ")[0].trim() || (n && n.appId) || "app" }; }
      world.addEventListener("win-focus", (e) => { focusedId = e.detail.id; try { const n = desktop.doc().world.find((x) => x.id === focusedId); if (n && n.kind === "app" && window.HoloGov) window.HoloGov.focus(govIdentity(n)); } catch (x) {} });
      world.addEventListener("win-close", (e) => { const n = findNode(e.detail.id); if (n && n.kind === "folder" && !n.collapsed) { collapseFolder(e.detail.id); return; } removeNode(e.detail.id); });   // closing an OPEN folder collapses it back to its icon
      world.addEventListener("pointerdown", (e) => { if (e.target === world || e.target.id === "empty" || (e.target.closest && e.target.closest("#empty"))) deselectIcons(); });   // click empty desktop → clear icon selection (native)
      world.addEventListener("win-max", (e) => toggleMax(e.detail.id));
      world.addEventListener("win-state", (e) => setState(e.detail.id, e.detail.state));
      world.addEventListener("win-lock", (e) => { const n = desktop.doc().world.find((w) => w.id === e.detail.id); if (n) setLocked(e.detail.id, !n.locked); });
      world.addEventListener("win-pure", (e) => patch(e.detail.id, (n) => { n.frameless = !n.frameless; })); // bare object ⇄ framed
      world.addEventListener("win-edit", (e) => openEdit(e.detail.id));
      world.addEventListener("win-rewind", (e) => openRewind(e.detail.id));
      function openRewind(id) {   // Phase B: open the per-app rewind timeline for one window (plain time; preview is read-only)
        try {
          const node = findNode(id); if (!node) return;
          const k = (window.HoloWorkspaceBridge && window.HoloWorkspaceBridge.appKappaOf(node)) || null;
          const applyState = (state) => { try { const el = mounted.get(id), f = el && el.querySelector("iframe"); if (f && f.contentWindow) f.contentWindow.postMessage({ t: "holo-session:restore", surfaceId: id, state: state }, "*"); } catch (e) {} };
          HoloWB.activeHost().then((h) => HoloRewind.openRewind({ appKappa: k, host: h, applyState, label: (cleanName(node.title) || "this window"), onRestore: () => { try { toast("Restored"); } catch (e) {} } }));
        } catch (e) {}
      }

      // ── right-click context menu — native-desktop manipulation, with nested submenus ─────────
      // A flat OR nested item list. An item is { label, ic?, mark?, sc?, danger?, act?, sub? } or { sep:true }.
      // `sub` is a child item list → renders a chevron and opens a flyout on hover/click (native feel).
      // `mark:true/false` is a SELECTION marker (radio/checkbox) — kept on every OS. `ic` is a DECORATIVE
      // leading glyph — shown on Windows/Linux but DROPPED on macOS, whose native menus are text-only.
      const ctx = $("#ctx");
      let ctxKids = [];                                            // open submenu flyout panels (depth ≥ 1)
      const ctxEsc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
      function ctxMarker(it, mac) {                                // leading column: a selection marker, else a decorative icon (non-mac only)
        if (it.mark !== undefined) return `<span class="ic mark">${it.mark ? (mac ? "✓" : "●") : (mac ? "" : "○")}</span>`;
        if (it.ic != null && !mac) return `<span class="ic">${ctxEsc(it.ic)}</span>`;
        return "";
      }
      function clearKids(fromDepth) { for (let i = ctxKids.length - 1; i >= 0; i--) { if (ctxKids[i].depth >= fromDepth) { ctxKids[i].parent && ctxKids[i].parent.classList.remove("sub-open"); ctxKids[i].el.remove(); ctxKids.splice(i, 1); } } }
      const hideCtx = () => { ctx.classList.remove("open"); clearKids(0); };
      function renderMenu(panel, items, depth) {
        const mac = hostOS() === "mac";
        panel.innerHTML = items.map((it, i) => it.sep ? '<div class="sep"></div>'
          : `<button class="${it.danger ? "danger " : ""}${it.sub ? "has-sub " : ""}" data-i="${i}">`
            + ctxMarker(it, mac)
            + `<span class="lbl">${ctxEsc(it.label)}</span>`
            + (it.sub ? `<span class="chev">›</span>` : (it.sc ? `<span class="sc">${ctxEsc(it.sc)}</span>` : ""))
            + `</button>`).join("");
        [...panel.querySelectorAll("button[data-i]")].forEach((b) => {
          const it = items[+b.dataset.i];
          if (it.sub) {
            b.addEventListener("mouseenter", () => openKid(b, it.sub, depth + 1));
            b.addEventListener("click", (e) => { e.stopPropagation(); openKid(b, it.sub, depth + 1); });
          } else {
            b.addEventListener("mouseenter", () => clearKids(depth + 1));   // a leaf at this level closes any deeper flyout
            b.addEventListener("click", () => { hideCtx(); it.act && it.act(); });
          }
        });
      }
      function place(el, x, y) { const r = el.getBoundingClientRect(); el.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + "px"; el.style.top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + "px"; }
      function openKid(parentBtn, items, depth) {
        if (parentBtn.classList.contains("sub-open")) return;       // already open
        clearKids(depth);                                           // close siblings + anything deeper
        const el = document.createElement("div"); el.className = "ctx flyout open"; document.body.appendChild(el);
        renderMenu(el, items, depth);
        const pr = parentBtn.getBoundingClientRect(), er = el.getBoundingClientRect();
        let left = pr.right - 4; if (left + er.width > window.innerWidth - 8) left = pr.left - er.width + 4;
        let top = pr.top - 5; if (top + er.height > window.innerHeight - 8) top = window.innerHeight - er.height - 8;
        el.style.left = Math.max(8, left) + "px"; el.style.top = Math.max(8, top) + "px";
        ctxKids.push({ el, depth, parent: parentBtn }); parentBtn.classList.add("sub-open");
      }
      function showCtx(x, y, items) {
        clearKids(0);
        renderMenu(ctx, items, 0);
        ctx.style.left = "0px"; ctx.style.top = "0px"; ctx.classList.add("open");
        place(ctx, x, y);
      }
      function duplicate(id) {
        const n = desktop.doc().world.find((w) => w.id === id); if (!n) return;
        const copy = { ...n }; delete copy.id; delete copy.prev; copy.state = "normal";
        copy.x = (n.x || 80) + 28; copy.y = (n.y || 80) + 28;
        return addNode(copy);   // same content → same κ object, a second first-class instance
      }
      // hide / restore / undo — any object can be hidden (kept in the scene) and brought back; ⌘Z undoes
      // ── Undo / Redo — content-addressed history (Law L1/L2: each entry is a canonical world snapshot;
      //    Law L4: restored only THROUGH the desktop CvRDT, never a parallel store). Covers desktop
      //    structural ops (create · rename · delete · move) from the shell AND from Holo Files. ──
      let _wundo = [], _wredo = [];
      const snapWorldH = () => cloneWorld(desktop.doc().world);
      const recordUndo = () => { _wundo.push(snapWorldH()); if (_wundo.length > 80) _wundo.shift(); _wredo.length = 0; };
      function restoreWorldH(world) { desktop.change((d) => { d.world.splice(0, d.world.length); for (const n of cloneWorld(world)) d.world.push(n); }); try { bcastDesk(); } catch (e) {} }
      const undoStack = []; const pushUndo = (fn) => { undoStack.push(fn); _wredo.length = 0; if (undoStack.length > 60) undoStack.shift(); };
      const undo = () => { if (_wundo.length) { _wredo.push(snapWorldH()); restoreWorldH(_wundo.pop()); toast("undone"); return; } const fn = undoStack.pop(); if (fn) { try { fn(); } catch {} toast("undone"); } else toast("nothing to undo"); };
      const redo = () => { if (!_wredo.length) { toast("nothing to redo"); return; } _wundo.push(snapWorldH()); restoreWorldH(_wredo.pop()); toast("redone"); };
      const hideNode = (id) => { pushUndo(() => setState(id, "normal")); setState(id, "hidden"); toast("hidden · ⌘Z to undo · or the tray (bottom-left)"); };
      const hiddenCount = () => desktop.doc().world.filter((w) => w.state === "hidden").length;
      const showHidden = () => { desktop.change((d) => d.world.forEach((w) => { if (w.state === "hidden") w.state = "normal"; })); toast("restored hidden objects"); };
      addEventListener("keydown", (e) => { if (!(e.metaKey || e.ctrlKey)) return; const k = (e.key || "").toLowerCase(); const t = e.target; if (/^(INPUT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable) return;
        if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); } else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); redo(); } });

      // ── Ambient Q — summon the ONE Q surface on whatever you're looking at, from ANYWHERE (⌘/Ctrl-I).
      //    openCreate() already resolves activeHolospace() + FLIPs the focused holospace into the preview,
      //    so the door is the same in every app and arrives already aware of "this" (ADR-0091 ubiquity). ──
      addEventListener("keydown", (e) => { if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return; if ((e.key || "").toLowerCase() !== "i") return; e.preventDefault(); try { qOrbToggle(); } catch (x) {} });

      // ── folders (bundle / unbundle) — drag one object ONTO another to fuse them into a folder; a
      //    folder is a content-addressed bundle you open, drag items out of, or right-click → Unbundle. ──
      const findNode = (id) => desktop.doc().world.find((w) => w.id === id);
      function buildFolder(n) {
        const wrap = document.createElement("div"); wrap.className = "folder-body";
        const items = n.items || [];
        items.forEach((it, i) => {
          const t = document.createElement("button"); t.type = "button"; t.className = "folder-tile";
          const raw = it.title || "object"; const web = /^🌐/.test(raw); const title = raw.replace(/^🌐\s*/, "");
          const fi = document.createElement("span"); fi.className = "fi"; fi.textContent = web ? "🌐" : (it.kind === "folder" ? "📁" : "◆");
          const fn = document.createElement("span"); fn.className = "fn"; fn.textContent = title.slice(0, 22);
          t.append(fi, fn); t.title = "Take out · " + title; t.onclick = () => unbundleItem(n.id, i);
          wrap.appendChild(t);
        });
        if (!items.length) { const e = document.createElement("div"); e.className = "folder-empty"; e.textContent = "Empty drag an object onto this folder, or right-click an object → Bundle"; wrap.appendChild(e); }
        return wrap;
      }
      // ── desktop ICONS — a folder collapsed to a familiar icon; or an app launcher ──
      //   Folder ART is the vendored Material Icon Theme set (MIT, /usr/share/icons/folders, see its
      //   PROVENANCE.txt): colored folders with category emblems. A folder's `icon` field picks the
      //   category (folder-<icon>.svg); a `cover` overrides with a custom image. (Default: folder-base.)
      const FOLDER_ICON_BASE = "/usr/share/icons/folders/";
      const FOLDER_ICONS_LIST = ["base", "app", "api", "src", "components", "config", "tools", "audio", "video", "images", "docs", "download", "archive", "database", "keys", "public", "server", "temp", "test", "project", "resource", "home", "desktop", "git", "dist", "log", "font", "theme", "plugin", "pdf", "scripts", "secure", "markdown", "import", "export", "content", "client", "global"];
      const FOLDER_ICONS = new Set(FOLDER_ICONS_LIST);
      const folderIconSrc = (n) => FOLDER_ICON_BASE + "folder-" + (FOLDER_ICONS.has(n.icon) ? n.icon : "base") + ".svg";
      const _coverUrls = new Map();
      function folderCoverURL(n) {   // resolve a κ cover image → object URL (cached, applied async on render)
        if (n.cover) return n.cover;
        if (!n.coverKappa || typeof wallObjURL !== "function") return null;
        if (_coverUrls.has(n.coverKappa)) return _coverUrls.get(n.coverKappa);
        (async () => { try { const url = await wallObjURL({ k: n.coverKappa, kind: "image" }); if (!url) return; _coverUrls.set(n.coverKappa, url); render(desktop.doc()); } catch (e) {} })();   // re-render once resolved → cover paints
        return null;
      }
      function buildFolderIcon(n) {
        const wrap = document.createElement("div"); wrap.className = "folder-icon"; wrap.tabIndex = 0;
        if (n.appRef) {                                  // an app launcher icon
          const app = catalog.find((a) => a.id === n.appRef);
          const img = document.createElement("img"); img.className = "fi-img"; img.alt = "";
          img.src = app && app.landing ? app.landing.replace(/[^/]+$/, "icon.svg") : "";
          img.onerror = () => { const g = document.createElement("div"); g.className = "fi-glyph"; g.textContent = "◆"; img.replaceWith(g); };
          wrap.appendChild(img); wrap.title = "Open " + (n.title || (app && app.name) || "app");
        } else {                                         // a folder icon — Material Icon Theme art (or a custom cover)
          const box = document.createElement("div"); box.className = "fi-art";
          const cover = folderCoverURL(n);
          if (cover) { const c = document.createElement("div"); c.className = "fi-folder has-cover"; c.style.backgroundImage = 'url("' + cover + '")'; box.appendChild(c); }
          else { const img = document.createElement("img"); img.className = "fi-img"; img.alt = ""; img.draggable = false; img.src = folderIconSrc(n); img.onerror = () => { const g = document.createElement("div"); g.className = "fi-glyph"; g.textContent = "📁"; img.replaceWith(g); }; box.appendChild(img); }
          const cnt = (n.items || []).length; if (cnt) { const b = document.createElement("span"); b.className = "fi-count"; b.textContent = cnt > 99 ? "99+" : cnt; box.appendChild(b); }
          wrap.appendChild(box); wrap.title = "Open " + (n.title || "folder");
        }
        wrap.style.setProperty("--art", Math.max(40, Math.round((n.w || 96) * 0.72)) + "px");   // art scales with the resizable node
        const lbl = document.createElement("div"); lbl.className = "fi-label"; lbl.textContent = n.title || "Folder";
        lbl.addEventListener("dblclick", (e) => { e.stopPropagation(); renameFolder(n.id); });   // double-click the NAME → inline rename
        wrap.appendChild(lbl);
        const rz = document.createElement("div"); rz.className = "fi-resize"; rz.title = "Drag to resize"; wrap.appendChild(rz);
        wireResize(rz, n);                                // drag the corner → resize the icon
        if (n.id === selIcon) wrap.classList.add("selected");
        wireIcon(wrap, n);                                // native: single-click selects · double-click opens · drag anywhere
        return wrap;
      }
      // ── Windows-native icon interaction: single-click selects, double-click opens/launches, drag from
      //    ANYWHERE on the icon to move (bypasses the window titlebar), F2 rename · Del delete · Enter open ─
      let selIcon = null;
      function selectIcon(id) {
        if (selIcon && selIcon !== id) { const p = mounted.get(selIcon); const pw = p && p.querySelector(".folder-icon"); if (pw) pw.classList.remove("selected"); }
        selIcon = id; focusedId = id; const el = mounted.get(id); const w = el && el.querySelector(".folder-icon"); if (w) w.classList.add("selected");
      }
      function deselectIcons() { if (!selIcon) return; const el = mounted.get(selIcon); const w = el && el.querySelector(".folder-icon"); if (w) w.classList.remove("selected"); selIcon = null; }
      function wireIcon(wrap, n) {
        const id = n.id; let st = null, moved = false;
        const open = () => { if (n.appRef) { const a = catalog.find((x) => x.id === n.appRef); if (a) launch(a); else toast("app not available offline"); } else openFilesAt(id, n.title || "Folder"); };   // double-click a folder → Holo Files window (Windows-like)
        wrap.addEventListener("pointerdown", (e) => {
          if (e.button) return; const el = mounted.get(id); if (!el) return; selectIcon(id); moved = false;
          st = { sx: e.clientX, sy: e.clientY, ox: +el.dataset.x || 0, oy: +el.dataset.y || 0 };
          try { wrap.setPointerCapture(e.pointerId); } catch (x) {}
        });
        wrap.addEventListener("pointermove", (e) => {
          if (!st) return; const dx = e.clientX - st.sx, dy = e.clientY - st.sy;
          if (!moved && Math.hypot(dx, dy) < 4) return; moved = true;
          const el = mounted.get(id); if (!el) return; el.dataset.busy = "1";
          let nx = Math.max(0, st.ox + dx), ny = Math.max(0, st.oy + dy);
          // SHARED snap engine (window.HoloSnap): align icons to each other · widgets · windows · golden
          // anchors, with guide lines. Guarded — falls back to free drag if the engine isn't present.
          try {
            if (window.HoloSnap) {
              const po = el.offsetParent ? el.offsetParent.getBoundingClientRect() : { left: 0, top: 0 };
              const s = window.HoloSnap.snapRect({ left: po.left + nx, top: po.top + ny, width: el.offsetWidth, height: el.offsetHeight }, el);
              nx = Math.max(0, s.left - po.left); ny = Math.max(0, s.top - po.top);
              window.HoloSnap.showGuides(s.v, s.h);
            }
          } catch (x) {}
          el.dataset.x = nx; el.dataset.y = ny; el.style.transform = "translate3d(" + nx + "px," + ny + "px,0)";
        });
        const up = () => { if (!st) return; try { window.HoloSnap && window.HoloSnap.clearGuides(); } catch (x) {} const el = mounted.get(id); if (el) { el.dataset.busy = ""; if (moved) moveNode(id, +el.dataset.x || 0, +el.dataset.y || 0); } st = null; };
        wrap.addEventListener("pointerup", up); wrap.addEventListener("pointercancel", up);
        wrap.addEventListener("dblclick", (e) => { e.preventDefault(); if (!moved) open(); });
        wrap.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); open(); } else if (e.key === "F2") { e.preventDefault(); renameFolder(id); } else if (e.key === "Delete") { e.preventDefault(); removeNode(id); } });
      }
      function wireResize(rz, n) {   // drag the corner handle → resize the icon (aspect-locked to the golden cell)
        const id = n.id;
        rz.addEventListener("pointerdown", (e) => {
          if (e.button) return; e.preventDefault(); e.stopPropagation();
          const node = findNode(id) || n; const startW = node.w || 96, sx = e.clientX, sy = e.clientY; let w = startW, h = node.h || 156; const el = mounted.get(id);
          try { rz.setPointerCapture(e.pointerId); } catch (x) {}
          const mv = (ev) => { const d = Math.max(ev.clientX - sx, ev.clientY - sy); w = Math.max(64, Math.min(240, Math.round(startW + d))); h = Math.round(w * 1.625);
            if (el) { el.style.width = w + "px"; el.style.height = h + "px"; const fi = el.querySelector(".folder-icon"); if (fi) fi.style.setProperty("--art", Math.max(40, Math.round(w * 0.72)) + "px"); } };
          const up = () => { rz.removeEventListener("pointermove", mv); rz.removeEventListener("pointerup", up); rz.removeEventListener("pointercancel", up); resizeNode(id, { x: node.x, y: node.y, w, h, state: "normal" }); };
          rz.addEventListener("pointermove", mv); rz.addEventListener("pointerup", up); rz.addEventListener("pointercancel", up);
        });
      }
      // open Holo Files as a WINDOW on the current desktop, deep-linked to this folder. Frameless by
      // default — a bare object that uses the whole window for content; nav chrome appears on hover.
      async function openFilesAt(deskId, name) {
        const app = catalog.find((a) => a.id === "org.hologram.HoloFiles"); if (!app) { toast("Holo Files not available offline"); return; }
        let def = {}; try { def = await fetch(app.landing.replace(/[^/]+$/, "holospace.json")).then((r) => r.json()); } catch (e) {}
        const { sandbox, allow } = capabilitiesToSandbox(await gateCaps(def));
        addNode({ kind: "app", appId: app.id, appDid: app.did, title: "🗂 " + (name || "Files"), src: app.landing + "?go=desktop:" + deskId, sandbox, allow, state: "normal", frameless: true, w: 920, h: 600, x: 130, y: 90 });
      }
      function openFolder(id) { patch(id, (n) => { n.collapsed = false; n.frameless = true; n.state = "normal"; n.w = Math.max(360, n._ow || 0) || 360; n.h = Math.max(280, n._oh || 0) || 280; }); }
      function collapseFolder(id) { patch(id, (n) => { n._ow = n.w; n._oh = n.h; n.collapsed = true; n.frameless = true; n.state = "normal"; n.w = 96; n.h = 156; }); }
      function renameFolder(id) {
        const el = mounted.get(id), lbl = el && el.querySelector(".fi-label"); if (!lbl) return;
        lbl.contentEditable = "true"; lbl.classList.add("editing"); lbl.focus();
        try { const r = document.createRange(); r.selectNodeContents(lbl); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } catch (e) {}
        const done = () => { lbl.contentEditable = "false"; lbl.classList.remove("editing"); patch(id, (n) => { n.title = (lbl.textContent || "Folder").trim().slice(0, 40) || "Folder"; }); };
        lbl.addEventListener("blur", done, { once: true });
        lbl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); lbl.blur(); } });
      }
      function setFolderApp(id, appId) { const a = catalog.find((x) => x.id === appId); patch(id, (n) => { n.appRef = appId; n.collapsed = true; n.frameless = true; n.w = 96; n.h = 156; if (a && (!n.title || n.title === "Folder")) n.title = a.name; }); toast("icon → " + ((a && a.name) || appId)); }
      function detachFolderApp(id) { patch(id, (n) => { delete n.appRef; }); toast("app detached plain folder"); }
      function pickFolderApp(id, x, y) { const items = catalog.slice(0, 40).map((a) => ({ label: a.name, ic: "◆", act: () => setFolderApp(id, a.id) })); if (!items.length) { toast("no apps available offline"); return; } showCtx(x || 220, y || 220, items); }
      function setFolderCover(id) {
        const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*"; inp.hidden = true; document.body.appendChild(inp);
        inp.onchange = async () => { const f = inp.files && inp.files[0]; inp.remove(); if (!f) return; try { const k = await putWall(new Uint8Array(await f.arrayBuffer())); _coverUrls.delete(k); patch(id, (n) => { n.coverKappa = k; delete n.cover; }); toast("cover set ✦"); } catch (e) { toast("cover failed"); } };
        inp.click();
      }
      function setFolderIcon(id, c) { patch(id, (n) => { n.icon = c; delete n.cover; delete n.coverKappa; }); toast("icon · folder-" + c); }
      // a visual grid picker of the vendored Material folder icons (beautiful, choose by sight)
      function closeIconPicker() { const p = document.getElementById("folder-icon-picker"); if (p) { if (p._outside) document.removeEventListener("pointerdown", p._outside, true); p.remove(); } }
      function pickFolderIcon(id, x, y) {
        closeIconPicker();
        const pop = document.createElement("div"); pop.id = "folder-icon-picker"; pop.className = "fip";
        FOLDER_ICONS_LIST.forEach((c) => { const b = document.createElement("button"); b.type = "button"; b.className = "fip-tile"; b.title = c;
          b.innerHTML = '<img src="' + FOLDER_ICON_BASE + "folder-" + c + '.svg" alt="" draggable="false"><span>' + c + "</span>";
          b.onclick = () => { setFolderIcon(id, c); closeIconPicker(); }; pop.appendChild(b); });
        document.body.appendChild(pop);
        pop.style.left = Math.max(8, Math.min(x, innerWidth - 320)) + "px"; pop.style.top = Math.max(8, Math.min(y, innerHeight - 360)) + "px";
        const outside = (e) => { if (!pop.contains(e.target)) closeIconPicker(); }; pop._outside = outside;
        setTimeout(() => document.addEventListener("pointerdown", outside, true), 0);
      }
      function bundle(draggedId, targetId) {
        if (!draggedId || draggedId === targetId) return;
        const dn = findNode(draggedId), tn = findNode(targetId); if (!dn || !tn) return;
        const dSnap = JSON.parse(JSON.stringify(dn)); delete dSnap.state;
        if (tn.kind === "folder") {
          desktop.change((d) => { const f = d.world.find((w) => w.id === targetId); f.items = (f.items || []); f.items.push(dSnap); d.world = d.world.filter((w) => w.id !== draggedId); });
          if (focusedId === draggedId) focusedId = targetId; toast("added to " + (tn.title || "folder"));
        } else {
          const tSnap = JSON.parse(JSON.stringify(tn)); delete tSnap.state; const fx = tn.x, fy = tn.y;
          desktop.change((d) => { d.world = d.world.filter((w) => w.id !== draggedId && w.id !== targetId); });
          addNode({ kind: "folder", title: "Folder", items: [tSnap, dSnap], x: fx, y: fy, collapsed: true, frameless: true, w: 96, h: 156 });
          toast("bundled into a folder · drag more in, or right-click → Unbundle");
        }
      }
      function unbundleItem(folderId, idx) {
        const f = findNode(folderId); if (!f || !f.items || !f.items[idx]) return;
        const item = JSON.parse(JSON.stringify(f.items[idx])); delete item.id; const fx = f.x || 100, fy = f.y || 100;
        desktop.change((d) => { const ff = d.world.find((w) => w.id === folderId); ff.items.splice(idx, 1); });
        addNode({ ...item, x: fx + 30, y: fy + 30, state: "normal" });
        const f2 = findNode(folderId); if (f2 && (!f2.items || !f2.items.length)) removeNode(folderId);
      }
      function unbundleAll(folderId) {
        const f = findNode(folderId); if (!f) return;
        const items = (f.items || []).map((it) => JSON.parse(JSON.stringify(it))); const fx = f.x || 100, fy = f.y || 100;
        removeNode(folderId);
        items.forEach((it, i) => { delete it.id; addNode({ ...it, x: fx + i * 30, y: fy + i * 30, state: "normal" }); });
        toast("unbundled " + items.length + " object" + (items.length === 1 ? "" : "s"));
      }
      const newFolder = () => addNode({ kind: "folder", title: "Folder", items: [], collapsed: true, frameless: true, w: 96, h: 156 });
      let bundleTarget = null;
      const clearTarget = () => { if (bundleTarget) { const el = mounted.get(bundleTarget); el && el.classList.remove("bundle-target"); bundleTarget = null; } };
      // the topmost OTHER live window under the cursor — drop a window onto it to fuse them into a folder
      function bundleAt(cx, cy, selfId) {
        let best = null, bestZ = -1;
        for (const m of desktop.doc().world) {
          if (m.id === selfId || m.state === "min" || m.state === "hidden") continue;
          const el = mounted.get(m.id); if (!el || el.style.display === "none") continue;
          const r = el.getBoundingClientRect();
          if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) { const z = +el.style.zIndex || 0; if (z >= bestZ) { bestZ = z; best = m.id; } }
        }
        return best;
      }   // fuse detection + commit live in the win-draghint / win-dragend handlers below

      // ── wallpaper gallery ─────────────────────────────────────────────────────────────────────
      //   Every wallpaper is a content-addressed UOR object: its bytes are sealed into the durable κ
      //   store (holoStore.put → did:holo:sha256, Law L5) and the gallery is a persistent list of those
      //   κ. The "Original" desktop is itself sealed as a κ descriptor; the bundled "UOR" image (an 8K
      //   7680×4800 master, lanczos-sharpened for retina) and any image you add are sealed by content.
      //   Right-click the desktop → Change wallpaper… reopens the same gallery, so previously-added
      //   wallpapers persist (the "previous gallery"). Bump SEED_V to refresh the bundled defaults
      //   without dropping the user's own additions.
      // pick the wallpaper rendition for THIS display — the master is downscaled on every real screen, so a
      // 1080p/1440p device seeds the 2560 rendition (371KB) at identical crispness; only a 4K+/retina panel
      // (device px > 2560) needs the 7680px master. Right-sizes the bytes, never the apparent sharpness.
      const _wallMaxDim = (Math.max(screen.width || 0, screen.height || 0) || 1920) * (window.devicePixelRatio || 1);
      const WALL_KEY = "holo:wallpapers", WALL_SEED = "/usr/share/wallpapers/" + (_wallMaxDim <= 2560 ? "uor-2560.jpg" : "uor-8k.jpg"), WALL_DEPTH = "/usr/share/wallpapers/uor-depth.png", WALL_DIR = "/usr/share/wallpapers/", SEED_V = 13;
      // curated default collection — bundled photos sealed to κ at first boot (via Unsplash, attributed)
      const CURATED = [
        { file: "earth-nasa.jpg",    name: "Crescent Earth", by: "NASA",             byLink: "https://unsplash.com/@nasa" },
        { file: "galaxy.jpg",        name: "Galaxy",         by: "Tiago Ferreira",   byLink: "https://unsplash.com/@tiago_f_ferreira" },
        { file: "aurora.jpg",        name: "Aurora",         by: "Lightscape",       byLink: "https://unsplash.com/@lightscape" },
        { file: "lioness.jpg",       name: "Lioness",        by: "Jaliya Rasaputra", byLink: "https://unsplash.com/@jaliya" },
        { file: "mountain-lake.jpg", name: "Mountain Lake",  by: "Luca Bravo",       byLink: "https://unsplash.com/@lucabravo" },
      ];
      const ORIGINAL_DESC = JSON.stringify({ "@type": "hosc:Wallpaper", style: "original", name: "Original" });
      const DEV_DESC = JSON.stringify({ "@type": "hosc:Wallpaper", style: "developer", name: "Developer" });   // procedural grid; rendered CSS-side, identity = κ(this descriptor)
      const ASANOHA_DESC = JSON.stringify({ "@type": "hosc:Wallpaper", style: "asanoha", name: "Asanoha" });   // procedural WebGPU lattice (holo-asanoha-gpu.js), VE-styled; identity = κ(this descriptor)
      const _wallURL = new Map();   // κ → objectURL (revoke-free for the session)
      const wallRead = () => { try { const s = JSON.parse(localStorage.getItem(WALL_KEY)); if (s && Array.isArray(s.items) && s.items.length) return s; } catch {} return null; };
      const wallWrite = (s) => { try { localStorage.setItem(WALL_KEY, JSON.stringify(s)); } catch {} };
      const liveOn = () => { try { return localStorage.getItem("holo:wall-live") === "1"; } catch { return false; } };   // gallery toggle: live depth + motion (default OFF — opt in)
      const parallaxOn = () => { try { return localStorage.getItem("holo:wall-parallax") === "1"; } catch { return false; } };   // gallery toggle: pointer parallax of the wallpaper (default OFF — opt in)
      const putWall = (b) => holoStore.put(b instanceof Uint8Array ? b : new TextEncoder().encode(b));   // → "sha256:<hex>"
      // self-healing fetch: prefer the durable κ store; if its bytes are absent (fresh device, evicted
      // store, or a κ recorded without its bytes) re-fetch the bundled source and re-seal it (Law L5 —
      // same bytes → same κ), so a seeded wallpaper is NEVER "unavailable".
      async function wallBytes(item) {
        let bytes = await holoStore.get(item.k); if (bytes) return bytes;
        if (item.src) { try { const r = await fetch(item.src, { cache: "force-cache" }); if (r.ok) { bytes = new Uint8Array(await r.arrayBuffer()); await putWall(bytes); return bytes; } } catch {} }
        return null;
      }
      async function wallObjURL(item) {
        if (_wallURL.has(item.k)) return _wallURL.get(item.k);
        const bytes = await wallBytes(item); if (!bytes) return null;
        const url = URL.createObjectURL(new Blob([bytes], { type: item.mime || "image/png" })); _wallURL.set(item.k, url); return url;
      }
      // PERF (first-load): boot seeds ONLY the essentials it paints (the default UOR image + the two
      // procedural backgrounds), so the wallpaper appears without waiting on the curated photo set. The 5
      // curated photos are sealed lazily by ensureCurated() the first time the gallery is opened — they are
      // never on the boot path. force-cache lets the UOR seed reuse the <link rel=preload> fetched at parse.
      async function seedItems({ curated = true } = {}) {
        const items = [{ k: await putWall(ORIGINAL_DESC), name: "Original", kind: "gradient", seed: true }];
        try { const r = await fetch(WALL_SEED, { cache: "force-cache" });
          if (r.ok) { const buf = new Uint8Array(await r.arrayBuffer()); items.push({ k: await putWall(buf), name: "UOR", kind: "image", mime: "image/jpeg", src: WALL_SEED, depthSrc: WALL_DEPTH, seed: true }); } } catch {}
        // Developer — a procedural blueprint grid (rendered CSS-side, see #wallpaper.wp-dev). Identity is the
        // κ of its descriptor: same κ → byte-identical background (Law L5). Sharp at any DPR, zero raster.
        try { items.push({ k: await putWall(DEV_DESC), name: "Developer", kind: "grid", seed: true }); } catch {}
        // Asanoha — a native WebGPU hemp-leaf lattice (usr/lib/holo/holo-asanoha-gpu.js), styled to the
        // Vector-Equilibrium reference; analytic SDF so it is razor-sharp at any DPR with light flowing along the spokes.
        try { items.push({ k: await putWall(ASANOHA_DESC), name: "Asanoha", kind: "shader", seed: true }); } catch {}
        if (curated) for (const w of CURATED) await sealCurated(items, w);
        return items;
      }
      // seal ONE curated photo into `items` if not already present (each bundled image content-addressed).
      async function sealCurated(items, w) {
        if (items.some((i) => i.seed && i.name === w.name)) return false;
        try { const r = await fetch(WALL_DIR + w.file, { cache: "force-cache" });
          if (r.ok) { const buf = new Uint8Array(await r.arrayBuffer()); items.push({ k: await putWall(buf), name: w.name, kind: "image", mime: "image/jpeg", src: WALL_DIR + w.file, depthSrc: WALL_DIR + w.file.replace(/\.jpg$/, "-depth.png"), by: w.by, byLink: w.byLink, seed: true }); return true; } } catch {}
        return false;
      }
      // ensureCurated(s) — fold the curated set into the persisted state on demand (gallery open). Off the
      // boot path entirely; after the first open they live in the κ store + state like any other wallpaper.
      async function ensureCurated(s) {
        let added = false;
        for (const w of CURATED) { if (await sealCurated(s.items, w)) added = true; }
        if (added) { try { wallWrite(s); } catch (e) {} }
        return s;
      }
      const defaultWallK = (items) => (items.find((i) => i.seed && i.name === "UOR") || items[1] || items[0]).k;   // UOR (the blue-Earth κ) is the canonical home wallpaper
      async function seedWall() { const items = await seedItems({ curated: false }); const s = { seedV: SEED_V, current: defaultWallK(items), items }; wallWrite(s); return s; }   // PERF: essentials only on the boot path; curated seal on first gallery open
      async function ensureWall() {
        const cur = wallRead(); if (!cur) return await seedWall();
        if (cur.seedV === SEED_V) return cur;
        // bundled defaults changed → refresh them. Versioned states preserve the user's own additions +
        // selection; a legacy (pre-versioning) state has no reliable seed marks, so it cleanly reseeds.
        const fresh = await seedItems({ curated: false });   // PERF: reseed essentials only; curated re-seal on gallery open
        const seen = new Set(fresh.map((i) => i.k));   // dedup: a now-bundled photo the user imported earlier collapses to the seed
        const userItems = cur.seedV ? (cur.items || []).filter((i) => !i.seed && !seen.has(i.k)) : [];
        const items = [...fresh, ...userItems];
        // keep the user's OWN imported pick across a defaults refresh; a bundled (seed) pick resets to the new default (UOR)
        const keptOwnPick = cur.seedV && cur.current && (cur.items || []).some((i) => i.k === cur.current && !i.seed) && items.some((i) => i.k === cur.current);
        const current = keptOwnPick ? cur.current : defaultWallK(items);
        const s = { seedV: SEED_V, current, items }; wallWrite(s); return s;
      }
      // ── LIVING wallpaper — a GPU-composited scene rendered at the display's TRUE device-pixel grid
      //    (holo-gfx surface, the OS's retina-sharp surface). Way past a flat JPEG: every image becomes
      //    hyper-real — parallax depth (pointer + device tilt), a breathing bloom on the brightest point,
      //    a drifting twinkling starfield, a cinematic vignette, fine dithered grain (kills 8-bit banding),
      //    and a one-time intro reveal. Honest: detail still caps at the source master, but it is rendered
      //    pixel-exact for whatever display you have (4K · 5K · 6K · 8K · retina) — never browser-upscaled.
      let _live = null;
      function wallCanvas() {
        let c = document.getElementById("wallpaper-canvas");
        if (!c) { c = document.createElement("canvas"); c.id = "wallpaper-canvas"; c.setAttribute("aria-hidden", "true");
          Object.assign(c.style, { position: "absolute", inset: "0", width: "100%", height: "100%", zIndex: "0", pointerEvents: "none", display: "none" });
          world.insertBefore(c, world.firstChild); }
        return c;
      }
      function stopLive() { if (_live) { try { _live.stop(); } catch {} _live = null; } const c = document.getElementById("wallpaper-canvas"); if (c) c.style.display = "none"; const gc = document.getElementById("wallpaper-gl"); if (gc) gc.remove(); const ac = document.getElementById("wallpaper-asa"); if (ac) ac.remove(); }
      // a κ-aware resolver for the L5 chunk streamer: durable κ store first, then the OS source chain
      const kappaResolve = async (kappa) => { const hex = String(kappa).split(":").pop();
        try { const b = await holoStore.get("sha256:" + hex); if (b) return b; } catch {}
        try { const r = await fetch("/.holo/sha256/" + hex); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; } catch { return null; } };
      // ADR-0080 Stage 3 — the desktop is the FIRST consumer of the L6 navigable-scene surface: it mounts
      // a κ-seed universe (scene descriptor) through HoloSpace, exactly as any holospace would. The scene
      // sits behind the windows in its own layer, removed on stop. (chunks[] would stream via L5 here.)
      async function startSpace(item) {
        const wrap = document.createElement("div"); wrap.id = "wallpaper-gl"; wrap.setAttribute("aria-hidden", "true");
        Object.assign(wrap.style, { position: "absolute", inset: "0", zIndex: "0", pointerEvents: "none" });
        world.insertBefore(wrap, world.firstChild);
        const reduced = (() => { try { return root.getAttribute("data-holo-motion") === "reduced" || matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } })();
        const ctrl = HoloSpace.mount(wrap, { type: "space", seed: item.k }, { reduced: reduced || !liveOn(), resolve: kappaResolve });
        if (!ctrl) { wrap.remove(); return null; }   // no WebGL2 → caller falls back to the CSS desktop
        return { stop() { try { ctrl.stop(); } catch {} const w = document.getElementById("wallpaper-gl"); if (w) w.remove(); } };
      }
      // mount a procedural WebGPU wallpaper shader (currently the asanoha lattice) on its own canvas, the
      // same shape as startSpace. Lazy-imports the module so it costs nothing until this wallpaper is chosen;
      // returns null (→ caller falls back to the CSS desktop) if there is no WebGPU adapter.
      // resolve a CSS custom property to [r,g,b] in 0..1 (any CSS color form), or the fallback if unset.
      function tokenRGB(name, fallback) {
        try {
          const raw = getComputedStyle(root).getPropertyValue(name).trim();
          if (!raw) return fallback;
          const probe = document.createElement("span"); probe.style.color = raw; probe.style.display = "none";
          document.body.appendChild(probe);
          const m = getComputedStyle(probe).color.match(/[\d.]+/g); probe.remove();
          if (!m || m.length < 3) return fallback;
          return [m[0] / 255, m[1] / 255, m[2] / 255];
        } catch { return fallback; }
      }
      async function startShader(item) {
        const mod = await import("/usr/lib/holo/holo-asanoha-gpu.js");
        if (!(await mod.ready) || !mod.gpuAvailable()) return null;
        const c = document.createElement("canvas"); c.id = "wallpaper-asa"; c.setAttribute("aria-hidden", "true");
        Object.assign(c.style, { position: "absolute", inset: "0", width: "100%", height: "100%", zIndex: "0", pointerEvents: "none" });
        world.insertBefore(c, world.firstChild);
        const reduced = (() => { try { return root.getAttribute("data-holo-motion") === "reduced" || matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } })();
        const ctrl = mod.createBackground(c, { reduced: reduced || !liveOn() });   // pure black field, white lines (module defaults); no parallax — a calm, static lattice
        if (!ctrl) { c.remove(); return null; }   // no WebGPU context → fall back
        return { stop() { try { ctrl.stop(); } catch {} const cc = document.getElementById("wallpaper-asa"); if (cc) cc.remove(); } };
      }
      // a tiny (48px) downscaled dataURL — the blur-up placeholder. Generating it loads the full image
      // once; HoloCompute.memo caches it by the wallpaper's κ (L1→L2), so a WARM load gets the
      // placeholder INSTANTLY (no 8K decode) and paints in one frame. O(1) repeat across sessions.
      async function makeThumb(url) {
        // PERF: decode + downscale OFF the main thread via createImageBitmap(resizeWidth) — a full 8K master
        // never touches the UI thread, so building the blur-up placeholder can't jank the boot. The url is a
        // local objURL, so the fetch is instant. Falls back to the classic Image+canvas path if unsupported.
        try {
          if (typeof createImageBitmap === "function") {
            const blob = await (await fetch(url)).blob();
            const bmp = await createImageBitmap(blob, { resizeWidth: 48, resizeQuality: "low" });
            const c = document.createElement("canvas"); c.width = bmp.width; c.height = Math.max(1, bmp.height);
            c.getContext("2d").drawImage(bmp, 0, 0); if (bmp.close) bmp.close();
            return c.toDataURL("image/jpeg", 0.6);
          }
        } catch (e) {}
        return new Promise((res) => {
          const im = new Image();
          im.onload = () => { try { const w = 48, h = Math.max(1, Math.round(48 * im.height / im.width)); const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(im, 0, 0, w, h); res(c.toDataURL("image/jpeg", 0.6)); } catch (e) { res(null); } };
          im.onerror = () => res(null); im.src = url;
        });
      }
      // paint the static wallpaper on its own #wallpaper layer (behind the windows, parallax-able), with
      // a κ-streamed blur-up: an O(1) memoized placeholder paints instantly, then the full κ sharpens in.
      async function applyStatic(item, url) {
        const wp = $("#wallpaper");
        if (!wp) { world.style.backgroundImage = url ? 'url("' + url + '")' : ""; world.style.backgroundSize = "cover"; world.style.backgroundPosition = "center"; return; }
        if (!url) { wp.style.backgroundImage = ""; wp.classList.remove("loading"); return; }
        wp.classList.add("loading");                                   // blurred until the full κ decodes
        let painted = false;
        try {   // O(1) placeholder → instant paint on a warm cache; never blocks the real wallpaper
          if (item && item.k && window.HoloCompute) {
            const thumb = await window.HoloCompute.memo([item.k, "thumb48-v1"], () => makeThumb(url));
            if (thumb) { wp.style.backgroundImage = 'url("' + thumb + '")'; painted = true; }
          }
        } catch (e) {}
        if (!painted) wp.style.backgroundImage = 'url("' + url + '")';   // no placeholder → show the full (blurred)
        const img = new Image(); img.src = url;
        const swap = () => { wp.style.backgroundImage = 'url("' + url + '")'; requestAnimationFrame(() => wp.classList.remove("loading")); };
        if (img.decode) img.decode().then(swap, swap); else { img.onload = swap; img.onerror = swap; }
      }
      // pointer parallax — the wallpaper drifts opposite the cursor (depth under glass), eased + GPU-only,
      // scaled by the fidelity parallax budget, and active ONLY at full motion (mobile/low/reduced = off).
      (function wallpaperParallax() {
        let tx = 0, ty = 0, px = 0, py = 0, raf = 0;
        const step = () => { raf = 0; px += (tx - px) * 0.12; py += (ty - py) * 0.12;
          const wp = document.getElementById("wallpaper"); if (wp) wp.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0)`;
          if (Math.abs(tx - px) > 0.2 || Math.abs(ty - py) > 0.2) raf = requestAnimationFrame(step); };
        addEventListener("pointermove", (e) => {
          const f = (window.HoloFidelity && window.HoloFidelity.current()) || { motion: "full", effects: { parallax: 1 } };
          const amt = (parallaxOn() && f.motion === "full" && f.effects) ? (f.effects.parallax || 0) : 0;   // opt-in toggle ⊗ device policy
          if (amt <= 0) { tx = ty = 0; if (!raf) raf = requestAnimationFrame(step); return; }
          const range = 16 * amt, cx = innerWidth / 2, cy = innerHeight / 2;
          tx = -((e.clientX - cx) / cx) * range; ty = -((e.clientY - cy) / cy) * range;
          if (!raf) raf = requestAnimationFrame(step);
        }, { passive: true });
      })();
      async function startLive(item) {
        stopLive();
        const bytes = await wallBytes(item); if (!bytes) return false;
        let bmp; try { bmp = await createImageBitmap(new Blob([bytes], { type: item.mime || "image/jpeg" })); } catch { return false; }
        let depthBmp = null;   // AI monocular-depth map (Depth-Anything-V2) when present → physically-correct planes
        if (item.depthSrc) { try { const dr = await fetch(item.depthSrc, { cache: "force-cache" }); if (dr.ok) depthBmp = await createImageBitmap(await dr.blob()); } catch {} }
        const canvas = wallCanvas();
        // WIDE-GAMUT / HDR path — prime the context colour space BEFORE the surface grabs it (the first
        // getContext call wins) so the bloom can glow in Display-P3 and, on HDR panels, beyond SDR white.
        // NOTE: deliberately NOT desynchronized — a full-screen layer that clears+repaints every frame in
        // low-latency mode bypasses the compositor's double-buffer and tears/flickers (esp. on Windows).
        // The wallpaper is a background plane, not input-latency-sensitive, so synchronized present wins.
        const p3 = (() => { try { return matchMedia("(color-gamut: p3)").matches; } catch { return false; } })();
        const hdr = (() => { try { return matchMedia("(dynamic-range: high)").matches; } catch { return false; } })();
        try { canvas.getContext("2d", { colorSpace: (p3 || hdr) ? "display-p3" : "srgb", alpha: true }); } catch {}
        let surf; try { surf = createSurface(canvas); } catch { return false; }
        try { if (hdr && canvas.configureHighDynamicRange) canvas.configureHighDynamicRange({ mode: "extended" }); } catch {}   // real highlight headroom on HDR displays
        const wide = p3 || hdr;
        const C = (r, g, b, a) => wide ? `color(display-p3 ${r} ${g} ${b} / ${a})` : `rgba(${Math.round(Math.min(1, r) * 255)},${Math.round(Math.min(1, g) * 255)},${Math.round(Math.min(1, b) * 255)},${a})`;
        applyStatic(item, null);   // the GPU layer owns the pixels now; clear the CSS fallback
        canvas.style.display = "block";
        const ctx = surf.ctx; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
        const reduced = (() => { try { return root.getAttribute("data-holo-motion") === "reduced" || matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } })();
        // brightest point → the bloom anchor (generic for any image)
        let sun = [0.5, 0.52];
        try { const sw = 84, sh = Math.max(1, Math.round(sw * bmp.height / bmp.width)); const oc = (typeof OffscreenCanvas !== "undefined") ? new OffscreenCanvas(sw, sh) : Object.assign(document.createElement("canvas"), { width: sw, height: sh });
          const ox = oc.getContext("2d"); ox.drawImage(bmp, 0, 0, sw, sh); const d = ox.getImageData(0, 0, sw, sh).data; let best = -1, bx = sw / 2, by = sh / 2;
          for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { const i = (y * sw + x) * 4; const l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; if (l > best) { best = l; bx = x; by = y; } }
          sun = [bx / sw, by / sh]; } catch {}
        // device-pixel STAGE: cover-fit the master once at the display's real grid (×overscan for parallax)
        const stage = document.createElement("canvas"), sx = stage.getContext("2d"); let SW = 0, SH = 0; const overscan = 1.12;
        function buildStage() { const w = Math.max(2, Math.ceil(surf.w * surf.dpr * overscan)), h = Math.max(2, Math.ceil(surf.h * surf.dpr * overscan));
          if (w === SW && h === SH) return; SW = w; SH = h; stage.width = w; stage.height = h; sx.imageSmoothingEnabled = true; sx.imageSmoothingQuality = "high";
          const ir = bmp.width / bmp.height, sr = w / h; let dw, dh; if (ir > sr) { dh = h; dw = h * ir; } else { dw = w; dh = w / ir; }
          sx.clearRect(0, 0, w, h); sx.drawImage(bmp, (w - dw) / 2, (h - dh) / 2, dw, dh); }
        // ── depth → parallax PLANES (2.5-D, "out the cockpit window") ────────────────────────────
        // A generic monocular-depth prior (bottom-near + luminance relief) splits the frame into a far
        // BASE (the full image) + depth-masked MID/NEAR cutouts that parallax more than the base. Because
        // the base holds the whole image, a disocclusion gap just reveals the same pixels behind — never
        // a hole. (Real AI monocular depth — MiDaS/Depth-Anything via the ONNX stack — is the drop-in
        // upgrade to this prior; the renderer already consumes a depth map.)
        const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
        let dW = 0, dH = 0, nearMask = null, midMask = null;
        function buildDepth() {
          dW = 256; dH = Math.max(1, Math.round(dW * bmp.height / bmp.width));
          const dc = document.createElement("canvas"); dc.width = dW; dc.height = dH; const dcx = dc.getContext("2d");
          dcx.drawImage(depthBmp || bmp, 0, 0, dW, dH); const p = dcx.getImageData(0, 0, dW, dH).data;
          const dep = new Float32Array(dW * dH);
          for (let y = 0; y < dH; y++) for (let x = 0; x < dW; x++) { const i = y * dW + x, j = i * 4;
            const lum = (p[j] * 0.299 + p[j + 1] * 0.587 + p[j + 2] * 0.114) / 255, v = dH > 1 ? y / (dH - 1) : 0;
            dep[i] = depthBmp ? lum : Math.min(1, Math.max(0, 0.6 * v + 0.4 * lum)); }   // AI depth map (near=bright) · else bottom-near prior
          const tmp = new Float32Array(dW * dH), R = 2;                               // separable box blur → soft plane edges
          for (let y = 0; y < dH; y++) for (let x = 0; x < dW; x++) { let s = 0, n = 0; for (let k = -R; k <= R; k++) { const xx = x + k; if (xx >= 0 && xx < dW) { s += dep[y * dW + xx]; n++; } } tmp[y * dW + x] = s / n; }
          for (let y = 0; y < dH; y++) for (let x = 0; x < dW; x++) { let s = 0, n = 0; for (let k = -R; k <= R; k++) { const yy = y + k; if (yy >= 0 && yy < dH) { s += tmp[yy * dW + x]; n++; } } dep[y * dW + x] = s / n; }
          const mk = (lo, hi) => { const c = document.createElement("canvas"); c.width = dW; c.height = dH; const cc = c.getContext("2d"), im = cc.createImageData(dW, dH);
            for (let i = 0; i < dep.length; i++) { im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = 255; im.data[i * 4 + 3] = Math.round(ss(lo, hi, dep[i]) * 255); } cc.putImageData(im, 0, 0); return c; };
          nearMask = mk(0.60, 0.85); midMask = mk(0.36, 0.62);
        }
        let planeSig = "", nearC = null, midC = null;
        function maskedPlane(mask) { const c = document.createElement("canvas"); c.width = SW; c.height = SH; const cc = c.getContext("2d");
          cc.imageSmoothingEnabled = true; cc.imageSmoothingQuality = "high"; cc.drawImage(stage, 0, 0);
          cc.globalCompositeOperation = "destination-in"; cc.drawImage(mask, 0, 0, SW, SH); return c; }   // color ∩ depth-band alpha
        function buildPlanes() { const sig = SW + "x" + SH; if (sig === planeSig || !nearMask) return; planeSig = sig; nearC = maskedPlane(nearMask); midC = maskedPlane(midMask); }
        // parallax starfield + dithered grain tile
        let seed = 0x9e3779b9; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
        const stars = []; for (let i = 0; i < 150; i++) stars.push({ x: rnd(), y: rnd() * 0.6, r: 0.4 + rnd() * 1.5, ph: rnd() * 6.283, sp: 0.4 + rnd() * 1.3, dp: 0.5 + rnd() });
        const grain = document.createElement("canvas"); grain.width = grain.height = 96; const gx = grain.getContext("2d");
        { const id = gx.createImageData(96, 96); for (let i = 0; i < id.data.length; i += 4) { const v = 118 + ((rnd() * 137) | 0); id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; } gx.putImageData(id, 0, 0); }
        const grainPat = ctx.createPattern(grain, "repeat");
        let px = 0, py = 0, tx = 0, ty = 0, dolly = 0, dollyT = 0;   // look (px,py) + dolly = push into the scene
        const onPtr = (e) => { tx = (e.clientX / (innerWidth || 1) - 0.5) * 2; ty = (e.clientY / (innerHeight || 1) - 0.5) * 2; };
        const onTilt = (e) => { if (e.gamma != null) { tx = Math.max(-1, Math.min(1, e.gamma / 28)); ty = Math.max(-1, Math.min(1, (e.beta - 42) / 28)); } };
        const onWheel = (e) => { dollyT = Math.min(0.85, Math.max(0, dollyT - e.deltaY * 0.0009)); };   // scroll = fly forward/back
        if (!reduced) { window.addEventListener("pointermove", onPtr, { passive: true }); window.addEventListener("deviceorientation", onTilt, { passive: true }); window.addEventListener("wheel", onWheel, { passive: true }); }
        buildStage(); buildDepth();
        const onResize = () => { surf.resize(); buildStage(); };
        window.addEventListener("resize", onResize);
        let raf = 0, t0 = 0, running = true;
        function draw(now) {
          if (!running) return;
          surf.resize(); buildStage(); buildPlanes();   // self-correct to the real layout / device-pixel grid each frame
          if (!t0) t0 = now; const t = (now - t0) / 1000;
          const intro = reduced ? 1 : (1 - Math.pow(1 - Math.min(1, t / 1.4), 3));   // easeOutCubic reveal
          px += (tx - px) * 0.05; py += (ty - py) * 0.05; dolly += (dollyT - dolly) * 0.06;
          const W = surf.w, H = surf.h, ow = SW / surf.dpr, oh = SH / surf.dpr;
          surf.clear("#05070c");
          // cockpit camera = smoothed look (px,py) + gentle autonomous drift (alive even idle) + dolly push-in
          const dfx = reduced ? 0 : (Math.sin(t * 0.07) * 0.16 + Math.sin(t * 0.031) * 0.09), dfy = reduced ? 0 : (Math.cos(t * 0.053) * 0.11);
          const gx = Math.max(-1, Math.min(1, px + dfx)), gy = Math.max(-1, Math.min(1, py + dfy));
          const shift = 15, ox = -gx * shift, oy = -gy * shift, z = (1 + (reduced ? 0 : 0.015 * Math.sin(t * 0.18))) + (1 - intro) * 0.06 + dolly * 0.55;
          // DEPTH PLANES: far base (full image, fills any gap) → mid → near; nearer planes parallax + dolly more
          const plane = (cv, par, zz) => { if (cv) ctx.drawImage(cv, W / 2 - ow * zz / 2 + ox * par, H / 2 - oh * zz / 2 + oy * par, ow * zz, oh * zz); };
          ctx.save(); ctx.globalAlpha = intro;
          plane(stage, 1.0, z);
          plane(midC, 1.5, z * (1 + dolly * 0.18));
          plane(nearC, 2.1, z * (1 + dolly * 0.42));
          ctx.restore();
          // breathing bloom on the brightest point (additive)
          const sxp = W * sun[0] + ox * 1.25, syp = H * sun[1] + oy * 1.25, br = Math.min(W, H) * 0.42 * (1 + (reduced ? 0 : 0.06 * Math.sin(t * 0.8)));
          const glow = hdr ? 1.3 : 1;   // HDR panels: drive the highlight past SDR white
          ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = Math.min(1, 0.5 * glow) * intro;
          let g = ctx.createRadialGradient(sxp, syp, 0, sxp, syp, br); g.addColorStop(0, C(0.88, 0.95, 1, 0.9)); g.addColorStop(0.25, C(0.47, 0.74, 1, 0.45)); g.addColorStop(1, C(0.12, 0.43, 0.92, 0));
          ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
          const cr = br * 0.28; let g2 = ctx.createRadialGradient(sxp, syp, 0, sxp, syp, cr); g2.addColorStop(0, C(1, 1, 1, Math.min(1, 0.85 * glow))); g2.addColorStop(1, C(1, 1, 1, 0));
          ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);
          if (hdr) { const hr = cr * 0.5, g3 = ctx.createRadialGradient(sxp, syp, 0, sxp, syp, hr); g3.addColorStop(0, C(1, 1, 1, 0.95)); g3.addColorStop(1, C(1, 1, 1, 0)); ctx.fillStyle = g3; ctx.fillRect(0, 0, W, H); }   // extra hot core, HDR only
          ctx.restore();
          // drifting, twinkling starfield (parallax-deeper than the photo)
          ctx.save(); ctx.globalCompositeOperation = "lighter";
          for (const s of stars) { const stx = ((s.x + (reduced ? 0 : t * 0.004 * s.dp)) % 1) * W + ox * 1.9 * s.dp, sty = s.y * H + oy * 1.9 * s.dp;
            const tw = reduced ? 0.7 : (0.35 + 0.65 * ((Math.sin(t * s.sp + s.ph) + 1) / 2)); ctx.globalAlpha = tw * intro * 0.9; ctx.fillStyle = C(0.92, 0.96, 1, 1);
            ctx.beginPath(); ctx.arc(stx, sty, s.r, 0, 6.2832); ctx.fill(); }
          ctx.restore();
          // cinematic vignette
          ctx.save(); let vg = ctx.createRadialGradient(W / 2, H * 0.46, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.75);
          vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.5)"); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H); ctx.restore();
          // fine dithered grain — defeats 8-bit banding, the tell of a "fake" gradient
          if (grainPat) { ctx.save(); ctx.globalCompositeOperation = "overlay"; ctx.globalAlpha = 0.05 * intro;
            const jx = (reduced ? 0 : (rnd() * 96) | 0), jy = (reduced ? 0 : (rnd() * 96) | 0); ctx.translate(-jx, -jy); ctx.fillStyle = grainPat; ctx.fillRect(jx, jy, W + 96, H + 96); ctx.restore(); }
          if (reduced) { running = false; return; }   // one perfect static frame
          raf = requestAnimationFrame(draw);
        }
        const onVis = () => { if (document.hidden) { if (raf) cancelAnimationFrame(raf), raf = 0; } else if (running && !reduced && !raf) raf = requestAnimationFrame(draw); };
        document.addEventListener("visibilitychange", onVis);
        draw(typeof performance !== "undefined" && performance.now ? performance.now() : 0);   // paint frame 1 now (even if backgrounded), then animate
        _live = { stop() { running = false; if (raf) cancelAnimationFrame(raf); window.removeEventListener("pointermove", onPtr); window.removeEventListener("deviceorientation", onTilt); window.removeEventListener("wheel", onWheel); window.removeEventListener("resize", onResize); document.removeEventListener("visibilitychange", onVis); try { bmp.close(); } catch {} try { depthBmp && depthBmp.close(); } catch {} } };
        return true;
      }
      async function applyWall(item) {
        const _wp = $("#wallpaper"); if (_wp) _wp.classList.remove("wp-dev");   // clear dev grid unless re-set below
        if (item && item.kind === "grid") {
          stopLive();
          if (_wp) { _wp.classList.remove("loading"); _wp.style.backgroundImage = ""; _wp.style.transform = "translate3d(0,0,0)"; _wp.classList.add("wp-dev"); }
          else { world.style.background = "#0a0b0f"; }
          return;
        }
        if (item && item.kind === "space") {
          stopLive();
          let ctrl = null; try { ctrl = await startSpace(item); } catch (e) { try { console.warn("cosmos → fallback:", e); } catch {} }
          if (ctrl) { _live = ctrl; return; }
          applyStatic(item, null); return;   // no WebGL2 → the native CSS desktop (deep gradient)
        }
        if (item && item.kind === "shader") {
          stopLive();
          let ctrl = null; try { ctrl = await startShader(item); } catch (e) { try { console.warn("asanoha → fallback:", e); } catch {} }
          if (ctrl) { _live = ctrl; return; }
          applyStatic(item, null); return;   // no WebGPU → the native CSS desktop
        }
        if (item && item.kind === "image") {
          if (liveOn()) { let live = false; try { live = await startLive(item); } catch (e) { try { console.warn("live wallpaper → static:", e); } catch {} } if (live) return; }
          const url = await wallObjURL(item); stopLive(); applyStatic(item, url); return;   // toggle off (or no WebGL/live) → crisp static image
        }
        stopLive(); applyStatic(item, null);   // gradient / Original → the native CSS desktop
      }
      let _curWallK = null;   // κ currently painted on #wallpaper — lets applyTabWall skip redundant repaints
      async function setWall(item, s) {
        const t = tabs[activeTab];
        if (t && t.dev) { t.wallK = item.k; scheduleSave(); }   // a dev tab keeps its OWN wallpaper (per-tab), the desktop default is untouched
        else { s.current = item.k; wallWrite(s); }
        _curWallK = item.k; await applyWall(item);
      }
      // applyTabWall(t) — paint the wallpaper this tab should wear: a dev tab is pinned to the canonical
      // default ("Original") on birth, then remembers any pick of its own (t.wallK); every other tab wears
      // the desktop-wide selection. Dedup via _curWallK so a same-wallpaper tab switch never repaints.
      async function applyTabWall(t) {
        try {
          const s = await ensureWall();
          let k = t && t.wallK;
          if (!k && t && t.dev) { const o = s.items.find((i) => i.seed && i.name === "Original") || s.items[0]; if (o) { k = o.k; t.wallK = k; } }
          k = k || s.current;
          const item = s.items.find((i) => i.k === k) || s.items.find((i) => i.k === s.current) || s.items[0];
          if (!item || item.k === _curWallK) return;
          _curWallK = item.k; await applyWall(item);
        } catch (e) {}
      }
      async function initWall() { try { const s = await ensureWall(); const it = s.items.find((i) => i.k === s.current) || s.items[0]; _curWallK = it && it.k; await applyWall(it); } catch (e) { console.warn("wallpaper:", e); } }
      async function addWallFile(file, s, after) {
        if (!file || !/^image\//.test(file.type || "")) { toast("Pick an image file"); return; }
        const k = await putWall(new Uint8Array(await file.arrayBuffer()));
        if (!s.items.some((i) => i.k === k)) { s.items.push({ k, name: (file.name || "Wallpaper").replace(/\.[^.]+$/, "").slice(0, 28) || "Wallpaper", kind: "image", mime: file.type }); wallWrite(s); }
        after && after(); toast("Added wallpaper · fingerprint " + k.split(":").pop().slice(0, 10) + "…");
      }
      async function openWallpapers() {
        hideCtx();
        const s = await ensureCurated(await ensureWall());   // seal the curated set on demand (off the boot path)
        const scrim = document.createElement("div"); scrim.className = "scrim open";
        const sheet = document.createElement("div"); sheet.className = "sheet wall-sheet";
        const head = document.createElement("div"); head.className = "wall-head";
        head.innerHTML = '<span class="wall-title">Wallpaper</span><span class="wall-sub">every wallpaper is a content-addressed object · did:holo (Law L5)</span>';
        const live = document.createElement("button"); live.type = "button"; live.className = "wall-live" + (liveOn() ? " on" : ""); live.title = "Live depth & motion — animated 2.5-D parallax (off = crisp static image)";
        live.innerHTML = '<span class="sw"></span><span>Live depth</span>';
        live.onclick = async () => { const on = !liveOn(); try { localStorage.setItem("holo:wall-live", on ? "1" : "0"); } catch {} live.classList.toggle("on", on); toast(on ? "Live depth & motion on" : "Static wallpaper"); try { scheduleSave(); } catch (e) {} await applyWall(s.items.find((i) => i.k === s.current) || s.items[0]); };
        head.appendChild(live);
        const par = document.createElement("button"); par.type = "button"; par.className = "wall-live" + (parallaxOn() ? " on" : ""); par.title = "Parallax — the wallpaper drifts with your pointer for depth (off = still)";
        par.innerHTML = '<span class="sw"></span><span>Parallax</span>';
        par.onclick = () => { const on = !parallaxOn(); try { localStorage.setItem("holo:wall-parallax", on ? "1" : "0"); } catch {} par.classList.toggle("on", on); toast(on ? "Parallax on" : "Parallax off"); try { scheduleSave(); } catch (e) {} };
        head.appendChild(par);
        const x = document.createElement("button"); x.className = "wall-x"; x.textContent = "✕"; head.appendChild(x);
        const grid = document.createElement("div"); grid.className = "wall-grid";
        // ── Unsplash discovery: search → import any photo, sealed to its own κ wallpaper ──
        const srch = document.createElement("div"); srch.className = "wall-srch";
        const sIn = document.createElement("input"); sIn.type = "search"; sIn.placeholder = "Search wallpapers — nature, cities, space…"; sIn.spellcheck = false;
        const sCredit = document.createElement("span"); sCredit.className = "us"; sCredit.textContent = "free · sealed to κ";
        srch.append(sIn, sCredit);
        const note = document.createElement("div"); note.className = "wall-note"; note.style.display = "none";
        const usLabel = document.createElement("div"); usLabel.className = "wall-secq"; usLabel.style.display = "none"; usLabel.textContent = "Unsplash results";
        const usGrid = document.createElement("div"); usGrid.className = "wall-grid"; usGrid.style.display = "none";
        const mineLabel = document.createElement("div"); mineLabel.className = "wall-secq"; mineLabel.style.display = "none"; mineLabel.textContent = "Your wallpapers";
        // category chips — one tap browses beautiful Unsplash wallpapers by theme (each import seals to its own κ)
        const chips = document.createElement("div"); chips.className = "wall-chips";
        const CAT_Q = { Nature: "nature landscape", Space: "galaxy nebula space", Animals: "wildlife animal", Cities: "city skyline", Patterns: "abstract pattern texture", Minimal: "minimal gradient" };
        ["Nature", "Space", "Animals", "Cities", "Patterns", "Minimal"].forEach((cat) => {
          const b = document.createElement("button"); b.type = "button"; b.className = "wall-chip"; b.textContent = cat;
          b.onclick = () => { sIn.value = cat; runSearch(CAT_Q[cat] || cat, b); };
          chips.appendChild(b);
        });
        sheet.append(head, srch, chips, note, usLabel, usGrid, mineLabel, grid); scrim.appendChild(sheet); document.body.appendChild(scrim);
        const done = () => { scrim.remove(); document.removeEventListener("keydown", esc, true); };
        const esc = (ev) => { if (ev.key === "Escape") { ev.preventDefault(); done(); } };
        document.addEventListener("keydown", esc, true);
        scrim.addEventListener("pointerdown", (ev) => { if (ev.target === scrim) done(); });
        x.onclick = done;
        // ── Unsplash: key (one-time, serverless) · search · import → seal κ ──
        const UNS_KEY = "holo:unsplash-key";
        const uKey = () => { try { return localStorage.getItem(UNS_KEY) || ""; } catch { return ""; } };
        function askKey(prefix) {
          note.style.display = ""; note.innerHTML = (prefix || "") + 'Unsplash needs a free <b>Access Key</b> — <a href="https://unsplash.com/oauth/applications" target="_blank" rel="noopener">create an app ↗</a>, then paste it:';
          const ki = document.createElement("input"); ki.type = "text"; ki.placeholder = "Unsplash Access Key";
          const kb = document.createElement("button"); kb.textContent = "Save";
          const save = () => { const v = (ki.value || "").trim(); if (!v) return; try { localStorage.setItem(UNS_KEY, v); } catch {} note.style.display = "none"; note.innerHTML = ""; if (sIn.value.trim()) runSearch(sIn.value.trim()); };
          kb.onclick = save; ki.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });
          note.append(ki, kb); ki.focus();
        }
        async function fetchBytes(url) {
          try { const r = await fetch(url, { mode: "cors" }); if (r.ok) return new Uint8Array(await r.arrayBuffer()); } catch {}
          try { const r = await fetch("/web?url=" + encodeURIComponent(url)); if (r.ok) return new Uint8Array(await r.arrayBuffer()); } catch {}   // dev host proxy; absent on static deploys
          return null;
        }
        let searchSeq = 0, activeChip = null;
        const safe = (s) => (s || "").replace(/[<>&]/g, "");
        function setChip(el) { if (activeChip) activeChip.classList.remove("on"); activeChip = el || null; if (el) el.classList.add("on"); }
        function showSkeleton(n) { let h = ""; for (let i = 0; i < (n || 9); i++) h += '<div class="wall-tile skel"><div class="wall-prev"></div><div class="wall-meta"><span class="wall-name"></span><span class="wall-k"></span></div></div>'; usGrid.innerHTML = h; }
        // keyless, themed source — Wikimedia Commons (open API, CORS) so categories ALWAYS load, no key wall.
        // O(1) re-click: results keyed by the query's κ (L1 memory → L2 Cache API). Click Cities → Nature →
        // Cities and the 2nd visit is instant + network-free — the κ-memo IS the cache (Law L5 identity).
        async function commonsSearch(q, n) {
          const fetchPage = async () => {
            const url = "https://commons.wikimedia.org/w/api.php?origin=*&format=json&action=query&generator=search"
              + "&gsrsearch=" + encodeURIComponent(q + " filetype:bitmap") + "&gsrnamespace=6&gsrlimit=" + (n || 30)
              + "&prop=imageinfo&iiprop=url|extmetadata|size&iiurlwidth=560";
            const r = await fetch(url); if (!r.ok) throw new Error("HTTP " + r.status);
            const j = await r.json();
            const pages = (j.query && j.query.pages) ? Object.values(j.query.pages) : [];
            return pages.map((p) => {
              const ii = p.imageinfo && p.imageinfo[0]; if (!ii || !ii.thumburl) return null;
              if (ii.width && ii.height && ii.width < ii.height * 1.1) return null;           // landscape only
              const md = ii.extmetadata || {};
              const by = ((md.Artist && md.Artist.value) || "Wikimedia").replace(/<[^>]+>/g, "").trim().slice(0, 40) || "Wikimedia";
              return { src: "commons", thumb: ii.thumburl, full: ii.url, name: (p.title || "").replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, ""), by };
            }).filter(Boolean);
          };
          try { if (window.HoloCompute) return await window.HoloCompute.memo(["wall-commons-v2", q, n || 30], fetchPage); } catch (e) {}
          return fetchPage();
        }
        async function unsplashSearch(q, key) {
          const url = "https://api.unsplash.com/search/photos?per_page=24&orientation=landscape&content_filter=high&query=" + encodeURIComponent(q) + "&client_id=" + encodeURIComponent(key);
          const r = await fetch(url);
          if (r.status === 401 || r.status === 403) return "BADKEY";
          if (!r.ok) throw new Error("HTTP " + r.status);
          const data = await r.json();
          return (data.results || []).map((ph) => ({ src: "unsplash", raw: ph }));
        }
        async function runSearch(q, chipEl) {
          const seq = ++searchSeq; setChip(chipEl);
          usLabel.style.display = ""; mineLabel.style.display = ""; usGrid.style.display = "";
          usLabel.textContent = "Results · " + q; showSkeleton();
          const key = uKey();
          try {
            let items;
            if (key) {
              items = await unsplashSearch(q, key);
              if (items === "BADKEY") { askKey("That key was rejected — browsing free photos instead. "); items = null; }
              else usLabel.textContent = "Unsplash · " + q;
            }
            if (!items) { items = await commonsSearch(q); usLabel.textContent = "Results · " + q; }
            if (seq !== searchSeq) return;
            if (!items.length) { usGrid.innerHTML = '<div class="wall-busy">No photos for “' + safe(q) + '”. Try another search.</div>'; return; }
            usGrid.innerHTML = "";
            for (const it of items) usGrid.appendChild(it.src === "unsplash" ? usTile(it.raw) : genTile(it));
          } catch (e) { if (seq === searchSeq) usGrid.innerHTML = '<div class="wall-busy">Couldn’t load images — check your connection.</div>'; }
        }
        // hover-warm → seal the remote photo into the κ store BEFORE the click. The bytes become a
        // κ-addressable object (content address, Law L5): the click then applies a LOCAL κ — no network —
        // and the same bytes are deduped + shared OS-wide forever after. Gated off on slow / save-data nets.
        const _wallPrefetch = new Map();   // url → Promise<κ>
        async function sealFromUrl(url) { const bytes = await fetchBytes(url); if (!bytes) throw new Error("fetch failed"); return await putWall(bytes); }
        function prefetchWall(url) {
          if (!url) return null;
          let f; try { f = window.HoloFidelity && window.HoloFidelity.current(); } catch (e) {}
          if (f && f.prefetch === "off") return null;
          if (_wallPrefetch.has(url)) return _wallPrefetch.get(url);
          const p = sealFromUrl(url).catch(() => { _wallPrefetch.delete(url); return null; });
          _wallPrefetch.set(url, p); return p;
        }
        function genTile(it) {
          const tile = document.createElement("button"); tile.type = "button"; tile.className = "wall-tile";
          const prev = document.createElement("div"); prev.className = "wall-prev"; prev.style.backgroundImage = 'url("' + it.thumb + '")';
          const by = document.createElement("div"); by.className = "wall-by"; by.textContent = "📷 " + (it.by || "Wikimedia"); prev.appendChild(by);
          const meta = document.createElement("div"); meta.className = "wall-meta";
          const nm = document.createElement("span"); nm.className = "wall-name"; nm.textContent = (it.name || "Photo").slice(0, 28);
          const kk = document.createElement("span"); kk.className = "wall-k"; kk.textContent = "import → seal to κ";
          meta.append(nm, kk); tile.append(prev, meta);
          let hoverT = 0;                                                // hover-intent (140ms): warm a deliberate hover, not a sweep
          tile.addEventListener("pointerenter", () => { clearTimeout(hoverT); hoverT = setTimeout(() => { const p = prefetchWall(it.full); if (p) p.then((k) => { if (k && kk.textContent === "import → seal to κ") { kk.textContent = "κ ready ✓"; tile.classList.add("ready"); } }); }, 140); }, { passive: true });
          tile.addEventListener("pointerleave", () => clearTimeout(hoverT), { passive: true });
          tile.onclick = () => importGeneric(it, kk);
          return tile;
        }
        async function importGeneric(it, kk) {
          const prev0 = kk.textContent; kk.textContent = "importing…";
          const wp = $("#wallpaper");
          if (wp && it.thumb) { wp.classList.add("loading"); wp.style.backgroundImage = 'url("' + it.thumb + '")'; }   // κ-stream: instant low-res preview, full κ sharpens in
          try {
            let k = null; const pf = _wallPrefetch.get(it.full); if (pf) k = await pf;   // hover already sealed it → local, instant
            if (!k) k = await sealFromUrl(it.full);
            const name = (it.name || "Photo").slice(0, 28);
            if (!s.items.some((i) => i.k === k)) { s.items.push({ k, name, kind: "image", mime: "image/jpeg", by: it.by || null }); wallWrite(s); }
            await setWall(s.items.find((i) => i.k === k), s); draw();
            toast("Imported · fingerprint " + k.split(":").pop().slice(0, 10) + "…");
          } catch (e) { if (wp) wp.classList.remove("loading"); kk.textContent = prev0; toast("Import failed — try another"); }
        }
        function usTile(ph) {
          const tile = document.createElement("button"); tile.type = "button"; tile.className = "wall-tile";
          const prev = document.createElement("div"); prev.className = "wall-prev";
          prev.style.backgroundImage = 'url("' + (ph.urls.small || ph.urls.thumb) + '")';
          const by = document.createElement("div"); by.className = "wall-by"; by.textContent = "📷 " + ((ph.user && ph.user.name) || "Unsplash");
          prev.appendChild(by);
          const meta = document.createElement("div"); meta.className = "wall-meta";
          const nm = document.createElement("span"); nm.className = "wall-name"; nm.textContent = (ph.description || ph.alt_description || "Unsplash photo").slice(0, 28);
          const kk = document.createElement("span"); kk.className = "wall-k"; kk.textContent = "import → seal to κ";
          meta.append(nm, kk); tile.append(prev, meta);
          tile.onclick = () => importUnsplash(ph, kk);
          return tile;
        }
        async function importUnsplash(ph, kk) {
          const key = uKey(); const prev0 = kk.textContent; kk.textContent = "importing…";
          try {
            if (ph.links && ph.links.download_location) fetch(ph.links.download_location + "&client_id=" + encodeURIComponent(key)).catch(() => {});   // Unsplash API: trigger download
            const raw = ph.urls.raw || ph.urls.full || ph.urls.regular;
            const hi = raw + (raw.includes("?") ? "&" : "?") + "w=3840&q=82&fm=jpg&fit=max";
            const bytes = await fetchBytes(hi); if (!bytes) throw new Error("fetch failed");
            const k = await putWall(bytes);
            const name = (ph.description || ph.alt_description || ("Photo · " + ((ph.user && ph.user.name) || "Unsplash"))).slice(0, 28);
            if (!s.items.some((i) => i.k === k)) {
              s.items.push({ k, name, kind: "image", mime: "image/jpeg", by: (ph.user && ph.user.name) || null, byLink: (ph.user && ph.user.links && ph.user.links.html) || null, unsplashId: ph.id });
              wallWrite(s);
            }
            await setWall(s.items.find((i) => i.k === k), s); draw();
            toast("Imported · 📷 " + ((ph.user && ph.user.name) || ("κ " + k.split(":").pop().slice(0, 10) + "…")));
          } catch (e) { kk.textContent = prev0; toast("Unsplash import failed"); }
        }
        let dTimer = 0;
        sIn.addEventListener("input", () => { clearTimeout(dTimer); const q = sIn.value.trim(); if (!q) { usGrid.style.display = usLabel.style.display = mineLabel.style.display = "none"; usGrid.innerHTML = ""; return; } dTimer = setTimeout(() => runSearch(q), 450); });
        sIn.addEventListener("keydown", (e) => { if (e.key === "Enter") { clearTimeout(dTimer); const q = sIn.value.trim(); if (q) runSearch(q); } });
        async function draw() {
          grid.innerHTML = "";
          for (const item of s.items) {
            const tile = document.createElement("button"); tile.type = "button"; tile.className = "wall-tile" + (item.k === s.current ? " sel" : "");
            const prev = document.createElement("div"); prev.className = "wall-prev" + (item.kind === "gradient" ? " orig" : item.kind === "space" ? " space" : item.kind === "grid" ? " dev" : "");
            if (item.kind === "image") { const url = await wallObjURL(item); if (url) prev.style.backgroundImage = 'url("' + url + '")'; }
            else if (item.kind === "space") { prev.innerHTML = '<span class="wall-badge">✦ live · κ-seed</span>'; }
            else if (item.kind === "grid") { prev.innerHTML = '<span class="wall-badge">⌗ developer · κ-seed</span>'; }
            else if (item.kind === "shader") { prev.style.background = "radial-gradient(circle at 50% 45%, #2a2f38 0%, #1c1f24 70%)"; prev.innerHTML = '<span class="wall-badge">✦ asanoha · WebGPU · κ-seed</span>'; }
            const meta = document.createElement("div"); meta.className = "wall-meta";
            const nm = document.createElement("span"); nm.className = "wall-name"; nm.textContent = item.name;
            const kk = document.createElement("span"); kk.className = "wall-k"; kk.title = "fingerprint"; kk.textContent = "holo://" + item.k.split(":").pop().slice(0, 12) + "…";
            meta.append(nm, kk); tile.append(prev, meta);
            tile.onclick = async () => { await setWall(item, s); toast("Wallpaper set · " + item.name); done(); };   // select for THIS holospace + close the picker
            grid.appendChild(tile);
          }
          const add = document.createElement("button"); add.type = "button"; add.className = "wall-tile";
          add.innerHTML = '<div class="wall-prev add"><span>＋</span></div><div class="wall-meta"><span class="wall-name">Add image…</span><span class="wall-k">→ sealed to κ</span></div>';
          const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*"; inp.hidden = true; add.appendChild(inp);
          add.onclick = () => inp.click();
          inp.onchange = async () => { const f = inp.files && inp.files[0]; if (f) await addWallFile(f, s, draw); };
          grid.appendChild(add);
        }
        draw();
        sheet.addEventListener("dragover", (ev) => { ev.preventDefault(); sheet.classList.add("drop"); });
        sheet.addEventListener("dragleave", (ev) => { if (ev.target === sheet) sheet.classList.remove("drop"); });
        sheet.addEventListener("drop", async (ev) => { ev.preventDefault(); sheet.classList.remove("drop"); const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0]; if (f) await addWallFile(f, s, draw); });
      }
      initWall();

      world.addEventListener("contextmenu", (e) => {
        const winEl = e.target.closest && e.target.closest("holo-window");
        e.preventDefault();
        if (winEl) {
          const id = winEl.id, n = desktop.doc().world.find((w) => w.id === id); if (!n) return; focusedId = id;
          if (n.kind === "folder") {
            const items = [];
            if (n.appRef) items.push({ label: "Open app", ic: "▶", act: () => { const a = catalog.find((x) => x.id === n.appRef); if (a) launch(a); } }, { label: "Detach app → folder", ic: "⊟", act: () => detachFolderApp(id) });
            else items.push({ label: n.collapsed ? "Open" : "Collapse to icon", ic: n.collapsed ? "📂" : "📁", act: () => n.collapsed ? openFolder(id) : collapseFolder(id) });
            if (!n.appRef) items.push({ label: "Open in Files", ic: "🗂", act: () => openHolospaceApp("org.hologram.HoloFiles", "go=desktop:" + id, "Holo Files") });   // deep-link → the SAME folder in the explorer (unification)
            items.push({ label: "Rename", ic: "✎", act: () => { if (n.collapsed || n.appRef) renameFolder(id); else { collapseFolder(id); setTimeout(() => renameFolder(id), 60); } } });
            items.push({ label: "Assign to app…", ic: "◆", act: () => pickFolderApp(id, e.clientX, e.clientY) });
            if (!n.appRef) items.push({ label: "Change icon…", ic: "🎨", act: () => pickFolderIcon(id, e.clientX, e.clientY) }, { label: "Change cover…", ic: "🖼", act: () => setFolderCover(id) }, { label: "Unbundle all", ic: "📂", act: () => unbundleAll(id) });
            items.push({ sep: true }, { label: "Hide", ic: "◌", act: () => hideNode(id) });
            items.push({ label: n.appRef ? "Delete icon" : "Delete folder", ic: "🗑", danger: true, act: () => { recordUndo(); removeNode(id); focusedId = null; } });
            showCtx(e.clientX, e.clientY, items); return;
          }
          showCtx(e.clientX, e.clientY, [
            { label: pgMode ? "Exit Playground" : "Edit objects (Playground)", ic: "✦", act: () => setPlaygroundMode(!pgMode) },   // GLOBAL edit mode: right-click → edit any element in any app live
            { label: "Edit source", ic: "✎", act: () => openEdit(id) },
            { label: n.state === "max" ? "Restore" : "Maximize", ic: "▢", act: () => toggleMax(id) },   // Move: drag the title bar; Maximize/Restore arranges
            { label: "Pop out to tab", ic: "⬒", act: () => popToTab(id) },   // window → its own holospace tab
            { label: "Hide", ic: "◌", act: () => hideNode(id) },
            { label: "Delete", ic: "🗑", danger: true, sc: "Del", act: () => { recordUndo(); removeNode(id); focusedId = null; } },
            { sep: true },
            { label: "Share link", ic: "❤️", act: () => shareNode(n) },
            { label: n.contentRef ? "Fuse source ← κ" : "Split → κ object", ic: "⧈", act: async () => { try { if (n.contentRef) { const ref = n.contentRef; await fuseNode(repo, desktop, id, holoStore); toast("fused ← " + linkFor(ref)); } else { const r = splitNode(repo, desktop, id); toast("split → " + linkFor(r)); } } catch (err) { alert(err.message); } } },
            { label: "Ownership…", ic: "👤", act: () => HoloOwn.openOwnSheet(ownedOf(n), { onChange: () => refreshOwnTitle(n, mounted.get(id)) }) },
            { label: n.frameless ? "Show frame" : "Make pure", ic: "◇", act: () => patch(id, (x) => { x.frameless = !x.frameless; }) },
            { label: n.locked ? "Unlock" : "Lock", ic: n.locked ? "🔒" : "🔓", act: () => setLocked(id, !n.locked) },
            { label: "Duplicate", ic: "⧉", act: () => duplicate(id) },
          ]);
        } else {
          showCtx(e.clientX, e.clientY, deskCtxItems());
        }
      });
      // The desktop / holospace menu. Factored out so the SAME menu opens from the chrome (toolbar + tab
      // strip) — the only surfaces reachable when a full-bleed app iframe covers the canvas and swallows
      // its right-click. So "Add widget" / "Focus space" are always reachable, app or no app.
      // Which desktop the user is on — so the menu mirrors their NATIVE OS (Windows vs macOS vs Linux):
      // ordering, terminology, Title-vs-sentence case, ⌘ vs Ctrl+, and macOS's icon-less menus.
      function hostOS() {
        try {
          const p = ((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || "").toLowerCase();
          if (/mac|iphone|ipad|ipod/.test(p)) return "mac";
          if (/win/.test(p)) return "windows";
          if (/linux|x11|cros|android/.test(p)) return "linux";
        } catch (e) {}
        return "windows";
      }
      function fmtKey(sc, os) {                                    // present the shortcut the way the native OS does
        if (!sc) return "";
        if (os === "mac") return sc.replace(/ctrl|control|cmd|command|meta|super/ig, "⌘").replace(/[\s+]+/g, "");
        return sc.replace(/\s+/g, "+").replace(/\+\+/g, "+");
      }
      // Appearance — the ONE mobile-theme picker (Dark · Light · Immersive), surfaced through the
      // HoloSheet launcher-clean modal. Immersive opens the curated κ-sealed wallpaper set (attributed
      // Unsplash). Pure reuse of the engine (HoloTheme.setMode / setWallpaper); the choice persists in
      // holo.theme.v1 and pre-paints on the next boot (holo-appearance-boot.js), so it stays consistent.
      let _curatedWalls = null;
      async function curatedWalls() {
        if (_curatedWalls) return _curatedWalls;
        try {
          const j = await (await fetch("/usr/share/wallpapers/curated.receipt.jsonld")).json();
          _curatedWalls = (j["prov:hadMember"] || []).map((m) => ({
            label: m["holo:name"], sub: "by " + (m["dcterms:creator"] || "Unsplash"),
            thumb: "/usr/share/wallpapers/" + m["holo:file"], value: "/usr/share/wallpapers/" + m["holo:file"],
          }));
        } catch (e) { _curatedWalls = []; }
        return _curatedWalls;
      }
      async function chooseWallpaper() {
        const walls = await curatedWalls();
        if (!walls.length) { toast("Curated wallpapers unavailable"); return; }
        const pick = await window.HoloSheet.open({ title: "Immersive wallpaper", options: walls });
        if (pick) { try { window.HoloTheme.setMode("immersive"); window.HoloTheme.setWallpaper(pick); } catch (e) {} }
      }
      async function openAppearance() {
        if (!window.HoloSheet || !window.HoloTheme) { toast("Appearance unavailable"); return; }
        const s = window.HoloTheme.get();
        const cur = s.immersive ? "immersive" : (s.palette === "light" ? "light" : "dark");
        const here = (v) => (cur === v ? "Current" : "");
        const mode = await window.HoloSheet.open({ title: "Appearance", options: [
          { label: "Dark", sub: here("dark"), value: "dark" },
          { label: "Light", sub: here("light"), value: "light" },
          { label: "Immersive", sub: here("immersive"), value: "immersive" },
        ] });
        if (!mode) return;
        if (mode === "immersive") { try { window.HoloTheme.setMode("immersive"); } catch (e) {} await chooseWallpaper(); }
        else { try { window.HoloTheme.setMode(mode); } catch (e) {} }
      }
      // The desktop modes (Welcome · Focused · Learn · Work · Play · Clarity) as a radio group, in the
      // runtime's registration order. `mark` is the selection marker, so it renders natively on every OS
      // (● radio on Windows/Linux, ✓ check on macOS).
      function modeMenuItems() {
        const h = window.HoloWidgets; if (!h || !h.modes) return [];
        const list = h.modes(); if (!list || !list.length) return [];
        const cur = (h.mode && h.mode()) || null;
        return list.map((m) => ({ label: m.label, mark: cur === m.name, act: () => withHW((H) => H.setMode && H.setMode(m.name)) }));
      }
      // The desktop / holospace menu — built to feel exactly like the user's native OS right-click.
      // Factored out so the SAME menu opens from the canvas AND the chrome (toolbar + tab strip) — the
      // surfaces reachable when a full-bleed app iframe covers the canvas and swallows its right-click.
      function deskCtxItems() {
        const os = hostOS(), mac = os === "mac";                  // icons are dropped on macOS by the renderer (ctxMarker), so pass them freely
        const onHome = !!(tabs[activeTab] && tabs[activeTab].home);
        const modeRows = onHome ? modeMenuItems() : [];
        const L = (m, w) => mac ? m : w;                          // pick Title-case (mac) or sentence-case (win/linux) label
        const newFolder_ = () => { recordUndo(); newFolder(); };
        const newComp_ = () => $("#author").click();
        const addWidget_ = () => withHW((h) => h.openGallery ? h.openGallery() : toast("Holo Widgets unavailable"));
        const out = [];
        // ── Create (native menus lead with creation) ──
        if (mac) { out.push({ label: "New Folder", act: newFolder_ }, { label: "New Component", act: newComp_ }); }
        else { out.push({ label: "New", ic: "✦", sub: [ { label: "Folder", ic: "📁", act: newFolder_ }, { label: "Component", ic: "✎", act: newComp_ } ] }); }
        out.push({ label: L("Add Widget…", "Add widget…"), ic: "▦", act: addWidget_ });
        // ── Desktop (modes + refresh) ──
        out.push({ sep: true });
        if (modeRows.length) out.push({ label: L("Desktop Mode", "Desktop mode"), ic: "◫", sub: modeRows });
        if (!mac) out.push({ label: "Refresh", ic: "↻", act: () => { try { render(desktop.doc()); } catch (e) {} } });
        // ── Holospace (Hologram verbs) ──
        out.push({ sep: true });
        out.push({ label: L("Open Holospace…", "Open holospace"), ic: "⌕", sc: fmtKey(P.shortcuts.spotlight, os), act: openSpot });
        out.push({ label: L("Component Library", "Component library"), ic: "⊞", act: openLib });
        // Playground — ONE global edit mode: turn EVERY holospace + app into a live editor where every visual
        // component is a κ-addressed object you can right-click and edit as code. Off by default; persists.
        out.push({ label: L("Playground", "Playground"), ic: "✦", mark: pgMode, act: () => setPlaygroundMode(!pgMode) });
        // ── Personalize (native menus close with appearance) ──
        out.push({ sep: true });
        out.push({ label: L("Appearance…", "Appearance…"), ic: "◐", act: openAppearance });
        out.push({ label: L("Change Wallpaper…", "Change wallpaper…"), ic: "🖼", act: openWallpapers });
        out.push({ label: L("Browser Skin…", "Browser skin…"), ic: "🖥", act: openSkinPicker });
        if (hiddenCount()) out.push({ label: L(`Show Hidden (${hiddenCount()})`, `Show hidden (${hiddenCount()})`), ic: "◌", act: showHidden });
        // the quiet escape hatch (signed-in only): forget THIS device's saved experience and start fresh on reload
        try { out.push({ label: L("Reset Saved Experience…", "Reset saved experience…"), ic: "↺", act: async () => { try { const msg = "Forget this device's saved layout & settings for the current session? It starts fresh on reload. (Other operators + other devices are unaffected.)"; const ok = window.HoloSheet ? await window.HoloSheet.confirm(msg, { title: L("Reset saved experience?", "Reset saved experience?"), ok: L("Reset", "Reset"), cancel: L("Keep", "Keep"), danger: true }) : confirm(msg); if (ok) window.HoloSession.reset(); } catch (e) {} } }); } catch (e) {}
        return out;
      }
      // Right-click the always-visible chrome (toolbar background + empty tab-strip) → the holospace menu.
      // Skip real controls (the omnibox text field, buttons) and actual tabs (they own their own menu).
      function wireChromeMenu(sel) {
        const host = $(sel); if (!host) return;
        host.addEventListener("contextmenu", (e) => {
          if (e.target.closest("input, .tab, #omni")) return;     // let inputs + tabs keep their own context menus
          e.preventDefault(); showCtx(e.clientX, e.clientY, deskCtxItems());
        });
      }
      wireChromeMenu("#navbar"); wireChromeMenu("#tabstrip");
      addEventListener("click", (e) => { if (!ctx.contains(e.target) && !e.target.closest(".ctx.flyout")) hideCtx(); });
      addEventListener("keydown", (e) => { if (e.key === "Escape" && ctx.classList.contains("open")) hideCtx(); });
      addEventListener("scroll", hideCtx, true);
      addEventListener("resize", hideCtx);
      world.addEventListener("win-resize", (e) => resizeNode(e.detail.id, { x: e.detail.x, y: e.detail.y, w: e.detail.w, h: e.detail.h, state: "normal" }));
      // drag-to-edge snapping with a live preview
      // ── window zones (FancyZones/KWin-style) — a layout of zones + a background grid ────────
      addEventListener("keydown", (e) => { if (e.key === "Shift") shiftHeld = true; }, true);
      addEventListener("keyup", (e) => { if (e.key === "Shift") shiftHeld = false; }, true);
      const activeLayout = () => desktop.doc().layout || "halves";
      const zonePx = () => { const r = worldRect(); return zonesFor(activeLayout(), r.W, r.H, 8); };   // zones span the inset desktop card, not the full viewport
      const setLayout = (id) => { desktop.change((d) => { d.layout = id; }); toast("layout · " + (LAYOUTS[id] ? LAYOUTS[id].name : id) + "  ·  " + linkFor(repo.publishSource({ name: "layout", source: JSON.stringify(LAYOUTS[id] || id) }).id)); renderGrid(); };
      const cycleLayout = () => { const i = LAYOUT_ORDER.indexOf(activeLayout()); setLayout(LAYOUT_ORDER[(i + 1) % LAYOUT_ORDER.length]); };
      const toggleGrid = () => { gridOn = !gridOn; renderGrid(); toast(gridOn ? "grid on · drag a window onto a zone to snap" : "grid off"); };
      function setNodeZone(id, z) { patch(id, (n) => { n.x = z.left; n.y = z.top; n.w = z.width; n.h = z.height; n.state = "normal"; delete n.prev; }); }
      function renderGrid() {
        const g = $("#grid"); if (!gridOn) { g.innerHTML = ""; g.style.display = "none"; return; }
        g.style.display = "block";
        g.innerHTML = zonePx().map((z, i) => `<div class="zone" style="transform:translate3d(${z.left}px,${z.top}px,0);width:${z.width}px;height:${z.height}px"><span>${i + 1}</span></div>`).join("");
      }
      // ── Aero-snap: forgiving edges + corners (quarters), with a live, perfectly-aligned ghost ──
      const SNAP_LABEL = { max: "Maximize", left: "Tile left", right: "Tile right", top: "Tile top", bottom: "Tile bottom", tl: "Top-left", tr: "Top-right", bl: "Bottom-left", br: "Bottom-right" };
      const EDGE = 28, CORNER = 96;   // reach from a side; the corner box that triggers a quarter
      function edgeFor(cx, cy) {
        const r = worldRect(), x = cx - r.x, y = cy - r.y;        // cursor relative to the workspace
        const L = x < EDGE, R = x > r.W - EDGE, T = y < EDGE, B = y > r.H - EDGE;
        const cL = x < CORNER, cR = x > r.W - CORNER, cT = y < CORNER, cB = y > r.H - CORNER;
        if ((T && cL) || (L && cT)) return "tl";
        if ((T && cR) || (R && cT)) return "tr";
        if ((B && cL) || (L && cB)) return "bl";
        if ((B && cR) || (R && cB)) return "br";
        if (T) return "max"; if (B) return "bottom"; if (L) return "left"; if (R) return "right";
        return null;
      }
      const paintGhost = (rect, label) => { snapEl.style.left = rect.left + "px"; snapEl.style.top = rect.top + "px"; snapEl.style.width = rect.width + "px"; snapEl.style.height = rect.height + "px"; snapEl.dataset.label = label || ""; snapEl.classList.add("on"); };
      world.addEventListener("win-draghint", (e) => {
        const x = e.detail.x, y = e.detail.y, selfId = e.detail.id;
        // 0) dragged UP onto the tab strip → re-pin this window as its own tab (tab⇄window parity)
        const tsB = $("#tabstrip").getBoundingClientRect().bottom;
        if (y <= tsB) { dragZone = null; clearTarget(); const ts = $("#tabstrip").getBoundingClientRect(); paintGhost({ left: ts.left, top: ts.top, width: ts.width, height: ts.height }, "Pin as tab ↑"); return; }
        // 1) a snap target: Shift/grid → layout zone; else a forgiving edge or corner
        let zoneRect = null, zoneLabel = "";
        if (gridOn || shiftHeld) { const r = worldRect(); const z = zoneAt(zonePx(), x - r.x, y - r.y); dragZone = z; if (z) { zoneRect = { left: z.left + r.x, top: z.top + r.y, width: z.width, height: z.height }; zoneLabel = "Snap here"; } }
        else { dragZone = null; const z = edgeFor(x, y); if (z) { zoneRect = ghostScreen(z); zoneLabel = SNAP_LABEL[z]; } }
        // 2) a fuse target (drop onto another window) — only when NOT aiming at an edge/zone
        const bt = (zoneRect || dragZone) ? null : bundleAt(x, y, selfId);
        if (bt !== bundleTarget) { clearTarget(); if (bt) { const el = mounted.get(bt); el && el.classList.add("bundle-target"); bundleTarget = bt; } }
        // 3) paint — the fuse highlight wins over the snap ghost if both somehow resolve
        if (zoneRect && !bundleTarget) paintGhost(zoneRect, zoneLabel); else snapEl.classList.remove("on");
      });
      world.addEventListener("win-dragend", (e) => {
        snapEl.classList.remove("on");
        const id = e.detail.id;
        const tsB = $("#tabstrip").getBoundingClientRect().bottom;
        if (e.detail.y <= tsB) { clearTarget(); popToTab(id); return; }   // dropped onto the tab strip → pop out to a tab
        if (bundleTarget) { const t = bundleTarget; clearTarget(); if (t !== id) { bundle(id, t); return; } }   // dropped onto a window → fuse
        if ((gridOn || shiftHeld) && dragZone) { setNodeZone(id, dragZone); dragZone = null; return; }
        const z = edgeFor(e.detail.x, e.detail.y);
        if (z) { setState(id, z); return; }                                                                      // edge/corner → snap
        const n = findNode(id);
        if (n && n.state !== "normal" && n.state !== "max") { patch(id, (m) => { m.state = "normal"; m.x = e.detail.left; m.y = e.detail.top; if (m.prev) { m.w = m.prev.w; m.h = m.prev.h; delete m.prev; } }); return; }   // tear a tile loose → float it where dropped
        moveNode(id, e.detail.left, e.detail.top);
      });

      // ── multiplayer across tabs — SERVERLESS, same-origin, via BroadcastChannel ─────────
      const ME = Math.random().toString(36).slice(2, 8); const peers = new Map(); let synced = false;
      const bc = new BroadcastChannel("holo-world:scene");
      desktop._publish = (delta) => { bc.postMessage({ t: "delta", from: ME, delta }); bcastDesk(); };   // also mirror the desktop tree to Holo Files (unification)
      // ── desktop ⇄ explorer unification: broadcast the desktop world as a plain tree so Holo Files
      //    surfaces the SAME folders/apps/objects as its "Desktop" location (one model, no duplicate). ──
      const deskBC = new BroadcastChannel("holo-desk:tree");
      const projDeskNode = (n) => ({ id: n.id, name: String(n.title || n.name || "untitled").split("  ·  ")[0].trim(),
        kind: n.kind, did: n.appDid || n.kappa || n.contentRef || "", icon: n.icon || "", appRef: n.appRef || "", appId: n.appId || "",
        items: (n.kind === "folder" && Array.isArray(n.items)) ? n.items.map(projDeskNode) : undefined });
      const projDesk = () => { try { return (desktop.doc().world || []).map(projDeskNode); } catch (e) { return []; } };
      const bcastDesk = () => { try { deskBC.postMessage({ t: "tree", tree: projDesk() }); } catch (e) {} };
      // explorer → shell mutations (bidirectional unification): apply to the desktop world, re-broadcast
      // Desktop structural ops run on a PLAIN snapshot, then wholesale-replace the world — the same
      // proven idiom restoreWorld() uses on every tab switch. This sidesteps CvRDT-proxy quirks with
      // nested splice and keeps mkdir/rename/delete/move (incl. nested + every move transition) robust.
      function deskApply(fn) { desktop.change((d) => { const w = JSON.parse(JSON.stringify(d.world || [])); fn(w); d.world.splice(0, d.world.length); for (const n of w) d.world.push(n); }); }
      function plainFind(w, id) { for (const x of w || []) { if (x.id === id) return x; if (x.items) { const r = plainFind(x.items, id); if (r) return r; } } return null; }
      function plainPull(w, id) {
        const ti = w.findIndex((x) => x.id === id); if (ti >= 0) { const c = w[ti]; w.splice(ti, 1); return c; }
        let out = null; (function rec(arr) { for (const x of arr) { if (x.items) { const ix = x.items.findIndex((it) => it.id === id); if (ix >= 0) { out = x.items[ix]; x.items.splice(ix, 1); return true; } if (rec(x.items)) return true; } } return false; })(w); return out;
      }
      function plainDrop(w, nd, destId) {
        if (!destId) { nd.x = 90 + w.length * 30; nd.y = 80 + w.length * 26; nd.state = "normal"; if (nd.kind === "folder") nd.frameless = true; w.push(nd); return true; }
        const f = plainFind(w, destId); if (f && f.kind === "folder") { f.items = f.items || []; delete nd.x; delete nd.y; f.items.push(nd); return true; } return false;
      }
      function applyDeskOp(m) {
        try {
          if (m.op === "undo") { undo(); return; }
          if (m.op === "redo") { redo(); return; }
          recordUndo();   // snapshot the canonical world BEFORE the structural change (L1/L2)
          if (m.op === "mkdir") {
            if (m.parentId) deskApply((w) => { const f = plainFind(w, m.parentId); if (f && f.kind === "folder") { f.items = f.items || []; f.items.push({ id: nid(), kind: "folder", title: m.name || "untitled folder", items: [], collapsed: true }); } });
            else { const id = newFolder(); if (m.name) patch(id, (n) => { n.title = m.name; }); }
          } else if (m.op === "rename") { deskApply((w) => { const n = plainFind(w, m.id); if (n) { n.title = m.name; n.name = m.name; } }); }
          else if (m.op === "delete") { deskApply((w) => { plainPull(w, m.id); }); }
          else if (m.op === "move" && m.id !== m.parentId) { deskApply((w) => { const nd = plainPull(w, m.id); if (nd) { if (!plainDrop(w, nd, m.parentId || "")) plainDrop(w, nd, ""); } }); }
          else if (m.op === "copy" && m.id) { deskApply((w) => { const src = plainFind(w, m.id); if (src) { const c = JSON.parse(JSON.stringify(src)); (function reid(x) { x.id = nid(); if (x.items) x.items.forEach(reid); })(c); if (!plainDrop(w, c, m.parentId || "")) plainDrop(w, c, ""); } }); }
          bcastDesk();
        } catch (e) { try { console.warn("desk op:", e); } catch (x) {} }
      }
      deskBC.onmessage = (e) => { const m = e.data; if (!m) return; if (m.t === "req") bcastDesk(); else if (m.t === "op") applyDeskOp(m); };
      setTimeout(bcastDesk, 0);   // initial publish for any explorer already open
      bc.onmessage = (e) => {
        const m = e.data; if (!m || m.from === ME) return;
        if (m.t === "delta") desktop.applyDelta(m.delta);
        else if (m.t === "hello" || m.t === "beat") { peers.set(m.from, Date.now()); if (m.t === "hello") bc.postMessage({ t: "snap", from: ME, to: m.from, snap: desktop._doc.snapshot() }); updatePresence(); }
        else if (m.t === "snap" && m.to === ME && !synced) { synced = true; desktop._doc.load(m.snap); desktop._notify(); }
        else if (m.t === "bye") { peers.delete(m.from); updatePresence(); }
      };
      function updatePresence() { const n = peers.size + 1; $("#peers").textContent = n === 1 ? "just you" : n + " here"; }
      bc.postMessage({ t: "hello", from: ME });
      setInterval(() => { bc.postMessage({ t: "beat", from: ME }); for (const [id, t] of peers) if (Date.now() - t > 6000) peers.delete(id); updatePresence(); }, 2500);
      addEventListener("pagehide", () => { try { bc.postMessage({ t: "bye", from: ME }); } catch {} });
      updatePresence();

      // ── spotlight ─────────────────────────────────────────────────────────────────────
      let catalog = [];
      try { const idx = await fetch("/apps/index.jsonld", { cache: "no-store" }).then((r) => r.json());
        catalog = (idx["dcat:dataset"] || []).map((a) => ({ id: a["schema:identifier"], did: a["@id"], name: a["schema:name"], words: a["holo:words"] || null, kw: [].concat(a["schema:keywords"] || [], a["holo:categories"] || [], a["schema:applicationCategory"] || []).join(" ").toLowerCase(), landing: String(a["dcat:landingPage"] || "").replace(/^apps\//, "/apps/"), icon: String(a["schema:image"] || "").replace(/^apps\//, "/apps/") }));
        // Feed the RAW catalog doc to the destination resolver (holo-address.index reads dcat:dataset) so names
        // + three-words resolve; expose it to the native omnibox shim's offline fallback too.
        try { if (window.HoloResolve) { window.HoloResolve.setCatalog(idx); window.__holoCatalog = idx; } } catch (e) {}
      } catch {}
      const spot = $("#spot"), q = $("#q"), results = $("#results");
      let spotList = [], selIdx = 0;
      const openSpot = () => { spot.classList.add("open"); q.value = ""; renderResults(""); q.focus(); };
      const closeSpot = () => spot.classList.remove("open");
      let smartRoute = null;
      // a stable per-app hue derived from its id (κ-shaped) — same app, same colour, every render
      const appHue = (a) => { const s = String((a && (a.id || a.name)) || ""); let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; };
      // PERSONALIZED ORDER (zero-config, magical): your learned profile (window.HoloProfile, distilled from
      // your own on-device usage) floats the apps you actually care about to the TOP of the launcher. A fresh
      // user (no profile yet) keeps the plain alphabetical order — no regression. 100% local; nothing egresses.
      const profileBoost = (a) => { try { const terms = (window.HoloProfile && window.HoloProfile.terms && window.HoloProfile.terms()) || []; if (!terms.length) return 0; const hay = (String(a.name || "") + " " + String(a.id || "") + " " + String(a.kw || "")).toLowerCase(); let s = 0; for (const t of terms) { const w = String(t || "").toLowerCase(); if (w.length > 2 && hay.indexOf(w) >= 0) s++; } return s; } catch (e) { return 0; } };
      function renderResults(term) { const r = classify(term, catalog); smartRoute = (r.kind === "web" || r.kind === "holo") ? r : null; let list = matches(term, catalog); if (r.kind === "app" && r.app && !list.some((a) => a.id === r.app.id)) list = [r.app, ...list]; spotList = list.sort((a, b) => (profileBoost(b) - profileBoost(a)) || String(a.name || "").localeCompare(String(b.name || ""))).slice(0, 30); selIdx = 0; paintResults(); }
      function paintResults() {
        const smart = smartRoute ? `<div class="row sel" data-smart="1"><span class="appicon" style="--h:${smartRoute.kind === "web" ? 190 : 265};--ic:url('/apps/ipfs/icon.svg')"><i></i></span><div>Open <b>${(smartRoute.label || "").replace(/</g, "&lt;")}</b></div><div class="id">${smartRoute.kind === "web" ? "content-addressed web ↗" : "holo://κ ↗"}</div></div>` : "";
        results.innerHTML = (smart + spotList.map((a, i) => `<div class="row${(!smartRoute && i === selIdx) ? " sel" : ""}" data-i="${i}"><span class="appicon" style="--h:${appHue(a)};--ic:url('${a.landing.replace(/[^/]+$/, "icon.svg")}')"><i></i></span><div>${a.name}</div><div class="id">${a.words ? a.words : (a.did || "").split(":").pop().slice(0, 10) + "…"}</div></div>`).join(""))
          || `<div class="row" style="color:#6e7681;cursor:default">Type a holospace, a holo://κ, or a web address (CID · ipfs · .eth · url) — or ✎ author your own.</div>`;
        const sr = results.querySelector("[data-smart]"); if (sr) sr.onclick = () => openWeb(smartRoute);
        [...results.querySelectorAll(".row[data-i]")].forEach((row) => { row.onclick = () => launch(spotList[+row.dataset.i]); row.onmouseenter = () => { selIdx = +row.dataset.i; markSel(); }; });
      }
      const markSel = () => { [...results.querySelectorAll(".row[data-i]")].forEach((r, i) => r.classList.toggle("sel", i === selIdx)); const el = results.querySelector(".row.sel"); el && el.scrollIntoView({ block: "nearest" }); };
      // gateCaps(def) — the host GATE at the unified entry: spawn with the AGREED capabilities, not
      // merely declared. window.HoloTerms.gate(def) returns declared ∩ the user's standing term +
      // signed agreement (prompting for sensitive/egress), {} = bare sandbox. Fail-closed: no
      // HoloTerms ⇒ the declared set (the prior contract); any error inside gate ⇒ {} (default-deny).
      async function gateCaps(def) { return window.HoloTerms ? await window.HoloTerms.gate(def) : (def.capabilities || {}); }
      // kappaEntry(app, def) — the κ-native frame BODY for an app (Law L1/L5): resolve the entry's κ from the
      // app's content lock, fetch it BY ITS κ-route, re-derive it (refuse a mismatch), and return the projected
      // srcdoc — the document IS the κ, mounted as content, not navigated to a path. projectHtml injects ONE
      // <base> at the app's dir (a resolver hint only) so the app's relative subresources resolve, each
      // re-derived to its κ by the worker. null ⇒ caller path-loads (still worker-verified) — resilient, no stub.
      async function kappaEntry(app, def) {
        try {
          const dir = entryBase(app.landing);                                   // /apps/<id>/
          const lock = await fetch(dir + "holospace.lock.json").then((r) => r.json());
          const entry = (def && def.entry) || "index.html";
          const rel = Object.keys(lock.closure || {}).find((p) => p.endsWith("/" + entry) || p === entry);
          const hex = rel && String(lock.closure[rel].kappa || "").split(":").pop();
          if (!/^[0-9a-f]{64}$/.test(hex || "")) return null;
          const r = await fetch("/.holo/sha256/" + hex, { cache: "force-cache" });
          if (!r.ok) return null;
          const bytes = new Uint8Array(await r.arrayBuffer());
          const reHex = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
          if (reHex !== hex) return null;                                        // Law L5: re-derive before mount, or refuse
          return projectHtml(new TextDecoder().decode(bytes), dir);
        } catch (e) { return null; }
      }
      async function launch(app) {
        if (!app) return; closeSpot();
        let def = {}; try { def = await fetch(app.landing.replace(/[^/]+$/, "holospace.json")).then((r) => r.json()); } catch {}
        const { sandbox, allow } = capabilitiesToSandbox(await gateCaps(def));
        if (needNewTab()) newTab(app.name);   // the app gets its OWN tab; Home + a busy canvas stay put
        const srcdoc = await kappaEntry(app, def);   // κ-native frame body (content), or null → path-load (worker-verified)
        addNode({ kind: "app", appId: app.id, appDid: app.did, title: app.name + "  ·  " + linkFor(app.did), src: app.landing, srcdoc: srcdoc || undefined, sandbox, allow, state: "max" });
        setActiveTabTitle(app.name); setActiveTabAddr("holo://" + app.id); recordNav();   // a content-addressed κ address for this holospace · a history entry for back/home
        try { omniRemember({ addr: "holo://" + app.id, input: app.name, kind: "app", title: app.name, kappa: app.did }); } catch (e) {}   // the bar remembers this holospace
      }
      // openWeb(route) — open ANY web / content address as a holospace window: the content-addressed
      // web (CID · ipfs · ipns · ENS · DNSLink · http) resolves + re-derives in Holo IPFS (Law L5); a
      // raw holo://κ is fetched by its hash. One box, one substrate — everything is an object.
      async function openWeb(route) {
        closeSpot();
        const ipfs = catalog.find((a) => a.id === "org.hologram.HoloIpfs") || { landing: "/apps/ipfs/index.html" };
        let def = {}; try { def = await fetch(ipfs.landing.replace(/[^/]+$/, "holospace.json")).then((r) => r.json()); } catch {}
        const { sandbox, allow } = capabilitiesToSandbox(await gateCaps(def));   // gate Holo IPFS too (egress = network)
        const src = ipfs.landing + "?go=" + encodeURIComponent(route.address || ("ipfs://" + route.hex));
        const label = route.label || route.address || route.hex || "web";
        if (needNewTab()) newTab("🌐 " + label);   // the page gets its OWN tab; Home stays
        addNode({ kind: "app", title: "🌐  " + label, src, sandbox, allow, state: "max", browser: true, webAddr: (route.address || ("ipfs://" + route.hex)) });
        setActiveTabTitle("🌐 " + label); setActiveTabAddr(route.address || ("ipfs://" + route.hex) || label); recordNav();   // the tab carries its real web/ipfs/eth address · history entry
      }
      $("#open").onclick = openSpot;
      // ── Share: a clean, frictionless public link to the focused app. The recipient lands in the
      //    SHARE-TO-RUN chrome (ADR-064): the app runs INSTANTLY, FULLSCREEN, verified by its content
      //    hash (#k=), with Remix · Share · Save laid over it — a GUEST, no account, no server (the
      //    viral loop). They can Remix back into this editable shell in one tap. Identity is content
      //    (Law L1): prefer the app's did, fall back to its id, then a split object's κ; #k= carries
      //    the content address whenever we have it. The frame routes any #k= link to that landing. ──
      function shareLinkFor(n) {
        if (!n) return null;
        if (n.webAddr) return location.origin + "/?web=" + encodeURIComponent(n.webAddr);   // a web tab → re-open the page in the shell (κ-verified)
        const ref = n.appDid || n.appId || n.contentRef;
        if (!ref) return null;
        const k = n.appDid || n.contentRef || ref;
        return location.origin + "/holospace.html?app=" + encodeURIComponent(ref) + "#k=" + encodeURIComponent(k);
      }
      async function copyShareLink(link) {
        let ok = false;
        try { await navigator.clipboard.writeText(link); ok = true; } catch {}
        if (!ok) { try { const ta = document.createElement("textarea"); ta.value = link; ta.style.cssText = "position:fixed;opacity:0;pointer-events:none"; document.body.appendChild(ta); ta.select(); ok = document.execCommand("copy"); ta.remove(); } catch {} }
        toast(ok ? "Link copied — anyone can open it instantly, no sign-in ✦" : "Share link → " + link);
      }
      // each tab IS an isolated holospace; Build/Run/Share target its app node
      function activeHolospace() { const w = desktop.doc().world; return (focusedId && w.find((x) => x.id === focusedId)) || w.find((x) => x.kind === "app" && x.state === "max") || w.find((x) => x.kind === "app") || w[0] || null; }
      const _appDefCache = {};   // per-app holospace.json, memoised → re-opens skip the network (instant)
      async function appDef(app) {
        if (_appDefCache[app.id]) return _appDefCache[app.id];
        let def = {}; try { def = await fetch(app.landing.replace(/[^/]+$/, "holospace.json")).then((r) => r.json()); } catch {}
        return (_appDefCache[app.id] = def);
      }
      async function openHolospaceApp(appId, query, title) {
        const app = catalog.find((a) => a.id === appId); if (!app) { toast("not available offline"); return; }
        closeSpot();
        const name = title || app.name;
        // Open the tab IMMEDIATELY so the click feels instant; the app then streams into it once its
        // capabilities resolve. Play (Holo Hub) and every other app open as their own holospace tab,
        // the same way — low-latency and delightful, no dead time waiting on the manifest fetch.
        if (needNewTab()) newTab(name);
        const myTab = activeTab;
        setActiveTabTitle(name); setActiveTabAddr("holo://" + app.id); recordNav();
        // P3 · honest capability degradation: if this app declares a HARD requirement the visitor's browser
        // lacks (etc/app-capabilities.json: webgpu/opfs/sab/storage), mount a calm LABELED fallback instead of
        // an app that would blank or throw — "many parts dont work for me." No-op when nothing is missing.
        try {
          const shortId = String(app.landing || "").split("/")[1];
          const requires = (APPCAPS && APPCAPS[shortId]) || [];
          if (requires.length && window.HoloRequires) {
            const missing = window.HoloRequires.missingFor(requires);
            if (missing.length) {
              const present = requires.filter((r) => !missing.includes(r));
              addNode({ kind: "app", appId: app.id, title: name, srcdoc: window.HoloRequires.fallbackDoc({ appName: name, missing, present }), sandbox: "", state: "max" });
              return;
            }
          }
        } catch (e) {}
        const def = await appDef(app);
        const { sandbox, allow } = capabilitiesToSandbox(await gateCaps(def));
        if (activeTab !== myTab) { if (tabs[myTab]) selectTab(myTab); else return; }   // mount into the tab we opened
        const src = app.landing + (query ? "?" + query : "");
        // Content-mount when there's no routing query to preserve (srcdoc has no URL, so location.search is
        // empty). A query (?go= / deep-link) keeps the path-load — still κ-verified at delivery (Law L5).
        const srcdoc = query ? undefined : await kappaEntry(app, def);
        addNode({ kind: "app", appId: app.id, appDid: app.did, title: name, src, srcdoc, sandbox, allow, state: "max" });
      }
      // pre-warm the Play target (Holo Hub) at idle so the very first Play mounts with no fetch wait
      try { (window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(() => { const h = catalog.find((a) => a.id === "org.hologram.HoloHub"); if (h) appDef(h); }); } catch {}

      // ── FIRST LIGHT — holospace templates + the empty-desktop showcase ───────────────────────────
      //   A holospace template is a curated COMPOSITION: one tab that nests several apps already wired
      //   together (e.g. Web3 = Trade + Scan side by side). The unit of discovery is the composition,
      //   not the lone app — a single icon under-sells the OS; a multi-app scene tells a story AND shows
      //   the headline nesting capability. We compose by reference: every member is launched through the
      //   SAME path a normal app uses (gateCaps → capabilitiesToSandbox → addNode), never copied.
      let templates = [];
      try {
        const t = await fetch("/apps/holospaces.jsonld", { cache: "no-store" }).then((r) => r.ok ? r.json() : null);
        templates = ((t && t["dcat:dataset"]) || []).map((s) => ({
          id: String(s["schema:identifier"] || "").split(".").pop() || "space",
          name: s["schema:name"] || "Holospace",
          tagline: s["holo:tagline"] || s["schema:description"] || "",
          accent: s["holo:accent"] || "#2dd4bf",
          layout: s["holo:layout"] || "split-h",
          members: (s["holo:members"] || []).map((m) => ({ ref: m["holo:app"], root: m["holo:appRoot"] })),
        })).filter((s) => s.members.length);
      } catch (e) {}

      // Pre-warm every experience's apps at idle: fetch each member's holospace.json once (appDef memoises)
      // so the FIRST click on a card mounts its panes with NO manifest round-trip — the apps stream in
      // immediately by their single κ (the κ Service Worker then serves every subresource by content).
      try {
        (window.requestIdleCallback || ((f) => setTimeout(f, 1800)))(() => {
          const seen = new Set();
          for (const tpl of templates) for (const m of tpl.members) {
            const a = catalog.find((x) => x.id === m.ref || x.did === m.root || x.did === m.ref);
            if (a && !seen.has(a.id)) { seen.add(a.id); try { appDef(a); } catch (e) {} }
          }
        });
      } catch (e) {}

      // layoutStates(layout, n) → the snap-state per pane, reusing the shell's OWN tiling (geomFor):
      // 2 apps split left/right (or top/bottom); 3 = one primary half + a stacked rail; 4 = quarters.
      // All states reflow with the canvas, so a templated holospace stays tiled on any screen / resize.
      function layoutStates(layout, n) {
        if (n <= 1) return ["max"];
        if (n === 2) return layout === "split-v" ? ["top", "bottom"] : ["left", "right"];
        if (n === 3) return ["left", "tr", "br"];
        return ["tl", "tr", "bl", "br"].slice(0, n);
      }
      // openHolospace(tpl) — open a template as ONE fresh tab nesting all its apps, tiled. Each member is
      // resolved from the live catalog by its app id (or root κ) and mounted through the gated launcher.
      // CONCURRENT + INDEPENDENT: each pane is gated exactly as a single-app launch (governance unchanged —
      // MyTerms still proposes/agrees per app) but mounts on its OWN clock, so an app whose Terms card
      // awaits acknowledgement never blocks the apps that auto-grant. Each pane appears as its gate clears.
      async function openHolospace(tpl) {
        if (!tpl || !tpl.members || !tpl.members.length) return;
        try { closeSpot(); } catch (e) {}
        const picked = tpl.members
          .map((m) => catalog.find((a) => a.id === m.ref || a.did === m.root || a.did === m.ref))
          .filter(Boolean);
        if (!picked.length) { toast("These apps aren't available offline yet"); return; }
        newTab(tpl.name);                                   // its own tab, always (never hijack Home / a busy canvas)
        const myTab = activeTab;
        setActiveTabTitle(tpl.name); setActiveTabAddr("holo://space/" + tpl.id); recordNav();
        const states = layoutStates(tpl.layout, picked.length);
        // Forming on-ramp: paint the tiled skeleton NOW — before the def fetch + consent — so the click
        // lands on a holospace that is already assembling in its real layout, never a blank tab. render()
        // hides #empty the instant the first real pane mounts on top; we clear t.forming once they all have.
        try {
          tabs[myTab].forming = {
            accent: tpl.accent,
            tiles: picked.map((app, i) => ({
              state: states[i] || "normal",
              label: (app.name || "").replace(/^Holo\s+/i, "") || (app.name || ""),
              src: app.landing ? app.landing.replace(/[^/]+$/, "icon.svg") : "",
              ini: ((app.name ? app.name.replace(/^Holo\s+/i, "") : "?").trim()[0] || "?").toUpperCase(),
            })),
          };
          if (activeTab === myTab) paintEmpty();
        } catch (e) {}
        // ONE consent for the whole holospace: pre-fetch every member's def, then a single "Agree to all"
        // (HoloTerms.gateAll) instead of a card per app. Records written are identical to gating each
        // app alone, so governance is unchanged. Falls back to the per-app gate if gateAll isn't present.
        const defs = await Promise.all(picked.map((a) => appDef(a).catch(() => ({}))));
        let capsByApp = null;
        try { if (window.HoloTerms && window.HoloTerms.gateAll) capsByApp = await window.HoloTerms.gateAll(defs); } catch (e) { capsByApp = null; }
        async function mountMember(app, def, state) {
          let caps;
          if (capsByApp && def && Object.prototype.hasOwnProperty.call(capsByApp, def.id)) caps = capsByApp[def.id];
          else { try { caps = await gateCaps(def); } catch (e) { caps = (def && def.capabilities) || {}; } }
          const { sandbox, allow } = capabilitiesToSandbox(caps);
          if (activeTab !== myTab) { if (tabs[myTab]) selectTab(myTab); else return; }   // mount into the tab we opened
          // frameless + nested: a tiled pane reads as ONE clean surface — no border or titlebar at rest,
          // a hairline seam between siblings, and the drag/controls grip + an accent ring fade in only on
          // hover. Repositioning (drag to re-tile / float) and tear-off to a tab use the window manager's
          // EXISTING gestures unchanged (a tile drag tears loose; drag onto the tab strip → popToTab).
          const srcdoc = await kappaEntry(app, def);   // κ-native content frame for each tiled member (no query → mount by content)
          addNode({ kind: "app", appId: app.id, appDid: app.did, title: app.name, src: app.landing, srcdoc: srcdoc || undefined, sandbox, allow, state, frameless: true, nested: true });
        }
        const mounts = picked.map((app, i) => mountMember(app, defs[i], states[i] || "normal").catch(() => {}));   // fire all; consent already settled once
        Promise.allSettled(mounts).then(() => { try { if (tabs[myTab]) delete tabs[myTab].forming; } catch (e) {} });   // panes are up (or done trying) → retire the skeleton so it never re-shows if the tab later empties
        try { omniRemember({ addr: "holo://space/" + tpl.id, input: tpl.name, kind: "holospace", title: tpl.name }); } catch (e) {}
      }
      window.HoloShell = window.HoloShell || {};
      try { window.HoloShell.openHolospace = (id) => { const t = templates.find((x) => x.id === id || x.name === id); if (t) openHolospace(t); return !!t; }; } catch (e) {}

      // The empty-desktop showcase: render the templates as living preview cards into #empty (shown by
      // render() whenever the active tab's world is empty). Each card previews its nested apps' real icons
      // and opens the whole composition in one click. A quiet footer routes to all apps (⌘K) — Play stays.
      function appIconHTML(ref, root) {
        const a = catalog.find((x) => x.id === ref || x.did === root || x.did === ref);
        const ic = a && a.landing ? a.landing.replace(/[^/]+$/, "icon.svg") : "";
        const ini = ((a && a.name ? a.name.replace(/^Holo\s+/i, "") : (ref || "?")).trim()[0] || "?").toUpperCase();
        const tip = a ? (a.name || "") : ref;
        return '<span class="ic" title="' + String(tip).replace(/"/g, "&quot;") + '"><img alt="" src="' + ic + '" onerror="this.remove()"/>' + ini + '</span>';
      }
      // formingOverlayHTML(f) — the tiled skeleton for a holospace being assembled. Each tile sits in the
      // SAME slot its real pane will take, mirroring geomFor's snap-states as PERCENT rects (so it is exact
      // the instant of the click — no dependency on the canvas's pixel width mid-transition — and reflows
      // on resize for free). Inset a hair so siblings read as separate panes; wears the app's mark + name.
      // Pure presentation: no app code runs until consent settles.
      const FORM_RECT = {   // state → [left%, top%, width%, height%], matching geomFor's tiling exactly
        max: [0, 0, 100, 100],
        left: [0, 0, 50, 100], right: [50, 0, 50, 100],
        top: [0, 0, 100, 50], bottom: [0, 50, 100, 50],
        tl: [0, 0, 50, 50], tr: [50, 0, 50, 50], bl: [0, 50, 50, 50], br: [50, 50, 50, 50],
      };
      function formingOverlayHTML(f) {
        if (!f || !f.tiles || !f.tiles.length) return "";
        const g = 6;   // seam between panes
        const tiles = f.tiles.map((t, i) => {
          const r = FORM_RECT[t.state] || FORM_RECT.max;
          const css = "left:calc(" + r[0] + "% + " + g + "px);top:calc(" + r[1] + "% + " + g + "px);" +
            "width:calc(" + r[2] + "% - " + (g * 2) + "px);height:calc(" + r[3] + "% - " + (g * 2) + "px);";
          const img = t.src ? '<img alt="" src="' + esc(t.src) + '" onerror="this.remove()"/>' : "";
          return '<div class="forming-tile" style="' + css + '--d:' + (i * 60) + 'ms">' +
            '<span class="forming-ic">' + img + esc(t.ini) + '</span>' +
            '<span class="forming-nm">' + esc(t.label) + '</span>' +
            '</div>';
        }).join("");
        return '<div class="disc-forming" style="--c:' + esc(f.accent || "#2dd4bf") + '">' + tiles + '</div>';
      }
      function renderDiscover() {
        const host = $("#empty"); if (!host) return;
        if (!templates.length) { host.innerHTML = '<div style="color:#6e7681">Press <kbd>⌘K</kbd> to open an app</div>'; return; }
        const cards = templates.map((t, i) => {
          const icons = t.members.slice(0, 4).map((m) => appIconHTML(m.ref, m.root)).join("");
          const more = t.members.length > 4 ? '<span class="more">+' + (t.members.length - 4) + '</span>' : "";
          return '<button class="disc-card" data-i="' + i + '" style="--c:' + t.accent + ';--d:' + (i * 55) + 'ms">' +
            '<span class="nm">' + esc(t.name) + '</span>' +
            '<span class="tg">' + esc(t.tagline) + '</span>' +
            '<span class="apps">' + icons + more + '</span>' +
            '</button>';
        }).join("");
        host.innerHTML =
          '<div class="disc">' +
            '<div class="disc-head">' +
              '<div class="disc-hero">' +
                '<h1 class="disc-title">Welcome to your Hologram</h1>' +
                '<p class="disc-sub">Each opens several apps, arranged and ready.</p>' +
              '</div>' +
              '<button class="disc-all" id="disc-all" type="button">Browse all apps</button>' +
            '</div>' +
            '<div class="disc-grid">' + cards + '</div>' +
          '</div>';
        [...host.querySelectorAll(".disc-card")].forEach((c) => c.onclick = () => { const t = templates[+c.dataset.i]; if (t) openHolospace(t); });
        const all = host.querySelector("#disc-all"); if (all) all.onclick = () => { try { openSpot(); } catch (e) {} };
        try { const disc = host.querySelector(".disc"); if (disc) { const dr = discoverRail(); if (dr) disc.insertBefore(dr, disc.firstChild); const cr = continueRail(); if (cr) disc.insertBefore(cr, disc.firstChild); } } catch (e) {}   // Continue watching + Discover, above Browse
      }
      function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
      // paintEmpty — what the empty-canvas overlay shows for the ACTIVE tab: the full Start-here surface on
      // the "Start here" tab, a quiet pointer-to-Start-here on any other empty tab (e.g. Home). Called on
      // tab changes + after the catalog loads; render() only toggles the overlay's visibility.
      // ── Continue watching — your recent apps + spaces, ranked, as a poster rail (the streaming front door) ──
      function continueItems() {
        try { let rank = null; try { rank = HOLO_RANK; } catch (e) {}   // HOLO_RANK is declared later (TDZ) → guard
          return buildContinueModel(omniRecents({ limit: 14, kinds: ["app", "holospace"], rank }), { profileTerms: (window.HoloProfile && window.HoloProfile.terms && window.HoloProfile.terms()) || null });   // S5: ranked to you (your private interests)
        } catch (e) { return []; }
      }
      function openRecent(it) {
        try {
          if (!it || !it.addr) return;
          if (window.HoloOpen) return window.HoloOpen(it.addr);   // S2: the ONE open path
          if (it.kind === "app") { openHolospaceApp(it.addr.replace(/^holo:\/\//, ""), "", it.title); return; }   // pre-HoloOpen fallback
          if (it.kind === "holospace") { const id = it.addr.replace(/^holo:\/\/space\//, ""); const t = templates.find((x) => x.id === id || x.name === it.title); if (t) openHolospace(t); }
        } catch (e) {}
      }
      function continueRail() { try { const items = continueItems(); return items.length ? renderContinueRail({ items, onOpen: openRecent }) : null; } catch (e) { return null; } }
      function discoverRail() {   // "Because you've been exploring…": apps you haven't opened, ranked to you (× holo-rank)
        try {
          let rank = null; try { rank = HOLO_RANK; } catch (e) {}
          const terms = (window.HoloProfile && window.HoloProfile.terms && window.HoloProfile.terms()) || [];
          const recentAddrs = (omniRecents({ limit: 50 }) || []).map((r) => r.addr);
          const items = HoloRecommend.recommend(catalog, recentAddrs, { profileTerms: terms, rank, limit: 12 });
          return items.length ? renderContinueRail({ items, onOpen: openRecent, title: HoloRecommend.titleFor(terms) }) : null;
        } catch (e) { return null; }
      }
      window.HoloContinue = { items: continueItems, open: openRecent };   // S6: "just ask" continue reaches the same resume seam as the rail
      function paintEmpty() {
        const host = $("#empty"); if (!host) return;
        const t = tabs[activeTab];
        // a holospace mid-assembly: paint its tiled skeleton (survives a tab switch away and back). render()
        // hides #empty once the real panes mount, and openHolospace clears t.forming when they have.
        if (t && t.forming) { host.classList.remove("starthere"); host.innerHTML = formingOverlayHTML(t.forming); host.dataset.mode = "forming"; return; }
        // cache by mode so switching tabs is a cheap class/flag flip — never a DOM rebuild (crisp nav)
        if (t && t.startHere) { if (host.dataset.mode !== "start") { host.classList.add("starthere"); renderDiscover(); host.dataset.mode = "start"; } }
        else if (t && t.play) {   // Play tab — the streaming front door (Continue watching + Discover), off Home
          host.classList.remove("starthere");
          const rail = continueRail(), drail = discoverRail();
          host.innerHTML = "";
          if (rail || drail) { host.classList.add("cw-home"); host.style.placeContent = "start center"; host.style.paddingTop = "clamp(64px,11vh,132px)"; if (rail) host.appendChild(rail); if (drail) host.appendChild(drail); }
          else { host.classList.remove("cw-home"); host.style.placeContent = ""; host.style.paddingTop = ""; }
          host.dataset.mode = "play";
        }
        else {   // Home (and blank tabs): CLEAN — greeting + Q orb + widgets only, no rails
          host.classList.remove("starthere", "cw-home"); host.style.placeContent = ""; host.style.paddingTop = "";
          host.innerHTML = "";
          host.dataset.mode = "home";
        }
      }
      window.__paintEmpty = paintEmpty;
      paintEmpty();

      // First-boot reveal: SUPERSEDED. The operator now always lands on Home, with the pinned "Start
      // here" tab one click away (the curated welcome). We deliberately do NOT auto-open a holospace —
      // landing must always be Home — so this on-ramp is the Start here tab, not a forced tab switch.
      async function shareNode(n) {
        let link = shareLinkFor(n);
        if (!link) { toast("Nothing to share yet — open an app (⌘K) first"); return; }
        // Fold THIS holospace's widget overlay INTO the link, serverlessly: the board rides the URL
        // FRAGMENT (#…&w=), which never reaches a server, so the link stays self-contained — open it and
        // the clock/quote/tasks/… reappear over the app (ADR-064 share-to-run). Skipped if too large.
        try {
          const board = (window.HoloWidgets && window.HoloWidgets.snapshot) ? window.HoloWidgets.snapshot().filter((w) => !w.hidden) : [];
          if (board.length) {
            const enc = encodeURIComponent(JSON.stringify(board));
            if (enc.length <= 6000) link += (link.indexOf("#") >= 0 ? "&" : "#") + "w=" + enc;
            else toast("Too many widgets to embed — shared without them");
          }
        } catch (e) {}
        var qr = ""; try { const m = await import("/_shared/holo-qr.js"); qr = m.toSVG(link, { scale: 6, margin: 2, rounded: 1 }); } catch (e) {}
        const nm = String((n && n.title) || "").split("  ·  ")[0].trim() || "this holospace";
        $("#share-title").textContent = "Share " + nm;
        $("#ss-ttl").textContent = nm;   // the social-unfurl preview (how the link looks when shared)
        $("#ss-mark").textContent = schemeOf((n && (n.webAddr || (n.appId && ("holo://" + n.appId)))) || "").ic || "⬡";
        $("#share-qr").innerHTML = qr; $("#share-link").textContent = link; $("#share-card").dataset.link = link;
        $("#share-scrim").classList.add("show");
      }
      // Share → the shared right side-carriage (Holo Share, ADR-0109), mounted below; the button opens/closes it.
      // (The old centered #share-scrim modal + shareNode remain defined but unbound — no second Share surface.)
      $("#share-copy").onclick = () => copyShareLink($("#share-card").dataset.link || "");
      $("#share-open").onclick = () => { const l = $("#share-card").dataset.link; if (l) window.open(l, "_blank", "noopener"); };
      $("#share-scrim").onclick = (e) => { if (e.target === $("#share-scrim")) $("#share-scrim").classList.remove("show"); };
      // ── Create studio — a Lovable-style build surface, native to the substrate ───────────────────
      //   Clicking Create lifts the running holospace off the desktop: its live window FLIPs into a
      //   preview pane while a chat/build panel slides in beside it. The preview shows EXACTLY the screen
      //   that was in the tab (same source, content-continuous). Edits (chat → paste markup, or the Code
      //   view) re-derive the source's κ LOCALLY (repo.publishSource → O(1) content address) and stream
      //   into a double-buffered preview: identical bytes are an O(1) rebind (no repaint), changed bytes
      //   crossfade frame-over-frame at the display's native refresh — no server, no flash. (ADR-0055.)
      const CS_STARTER = '<!doctype html>\n<meta charset="utf-8">\n<style>\n  html,body{height:100%;margin:0}\n  body{display:grid;place-items:center;font:600 clamp(28px,7vw,72px)/1.1 ui-sans-serif,system-ui;\n    color:#eaf2ff;background:radial-gradient(120% 120% at 30% 0%,#1b2a4a,#0d1117 60%,#05070c);text-align:center}\n  .k{background:linear-gradient(90deg,#7c5cff,#2dd4bf);-webkit-background-clip:text;background-clip:text;color:transparent}\n  p{font-size:16px;font-weight:400;color:#9fb0c8;margin-top:14px}\n</style>\n<div>\n  Hello, <span class="k">holospace</span>\n  <p>Ask Holo to build, or open Code — the preview updates instantly. This is yours now.</p>\n</div>\n';
      let studio = null;
      // GLOBAL F12 DevTools (ADR-0095): "F12, just like Chrome" for the CURRENTLY ACTIVE tab. Points the
      // proven κ-CDP live backend at activeAppFrame() and docks the vendored Chrome devtools-frontend.
      // Defers to the Create studio's own Dev tab when it is open. Additive + fail-safe (try/catch).
      try { installGlobalDevDock({ activeFrame: activeAppFrame, activeKappa: () => { try { const t = tabs[activeTab]; return (t && (t.addr || ("holo:tab:" + t.id))) || null; } catch (e) { return null; } }, studioOpen: () => !!studio }); } catch (e) {}
      // Resolve what Create opens onto: the EXACT live source of the active holospace (so the preview
      // mirrors the tab), whether it is locally editable, and a display name. External pages mirror but
      // can't be edited; a non-app tab (home/desktop) scaffolds a fresh starter to build into.
      // csHomeDoc() — the home/desktop as a remixable holospace doc: the ACTUAL current wallpaper (a
      // content-addressed object — its real bytes, via the live `#world` background, NOT a snapshot) +
      // the real "Powered by HOLOGRAM" credit. Faithful for image/gradient wallpapers; a cosmos/parallax
      // wallpaper falls back to a deep-space gradient here (re-deriving the WebGL2 universe into the
      // preview iframe is the staged compositor work). This makes entering Create from the desktop show
      // the real home shrinking from the full screen into the preview (winEl=#world below).
      function csHomeDoc() {
        let bg = "";
        try { const cs = getComputedStyle(world); const bi = cs.backgroundImage, bc = cs.backgroundColor;
          if (bi && bi !== "none") bg = "background-color:" + (bc && bc !== "rgba(0, 0, 0, 0)" ? bc : "#02030a") + ";background-image:" + bi + ";background-size:cover;background-position:center;background-repeat:no-repeat;"; } catch (e) {}
        if (!bg) bg = "background:radial-gradient(130% 130% at 50% 0%,#0b1a3a,#060a14 55%,#02030a);";   // cosmos/gradient fallback
        // No embedded "POWERED BY HOLOGRAM" credit — the shell's status bar (#holo-credit, pinned just
        // under the holospace) is the ONE persistent signature; a tab-filling preview must not duplicate it.
        return '<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><style>html,body{height:100%;margin:0}'
          + 'body{' + bg + 'position:relative;font:var(--holo-text-sm, 0.875rem) ui-sans-serif,system-ui;color:#e8eef9}</style>';
      }
      // csCreatorDoc() — the FRESH dev tab's canvas: a calm, centred explainer of Creator mode (why → how
      // → what, woven, not labelled). No "POWERED BY HOLOGRAM" credit — the shell's status bar already
      // signs the machine, so a dev tab carries exactly one. The first build replaces this in place.
      function csCreatorDoc() {
        // Composition on φ (1.618): φ⁻¹ between eyebrow and title (label hugs title), φ between blocks
        // (vertical rhythm), φ² for the headline, φ^½ for the lead — one type unit (--u) drives it all.
        return '<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><style>'
          + 'html,body{height:100%;margin:0}html{--u:clamp(13px,1.1vw + 6px,17px)}'
          + 'body{background:radial-gradient(130% 130% at 50% 0%,#0b1a3a,#060a14 55%,#02030a);color:#e8eef9;'
          + 'font:var(--u)/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;display:grid;place-content:center;text-align:center;padding:calc(var(--u)*2.618);-webkit-font-smoothing:antialiased}'
          + '.w{max-width:32em;margin:0 auto;display:grid;gap:calc(var(--u)*1.618);justify-items:center}'
          + '.hd{display:grid;gap:calc(var(--u)*.618);justify-items:center}'
          + '.ey{font-size:calc(var(--u)*.786);letter-spacing:.34em;font-weight:700;color:#5b8cff;text-transform:uppercase}'
          + 'h1{margin:0;font-size:calc(var(--u)*2.618);font-weight:750;letter-spacing:-.01em;color:#fff;line-height:1.1}'
          + '.lead{margin:0;font-size:calc(var(--u)*1.272);color:#c4cee0;max-width:24em}'
          + '.lines{margin:0;font-size:var(--u);color:#9aa4b8;max-width:28em}'
          + '.lines b{color:#cdd6e6;font-weight:600}.k{color:#5b8cff}'
          + '.chips{margin-top:calc(var(--u)*.382);display:flex;flex-wrap:wrap;gap:calc(var(--u)*.618);justify-content:center}'
          + '.chip{display:inline-flex;align-items:center;gap:calc(var(--u)*.382);padding:calc(var(--u)*.472) calc(var(--u)*.927);border-radius:999px;color:#dbe3f2;font-size:calc(var(--u)*.82);font-weight:600;'
          + 'background:color-mix(in srgb,#5b8cff 9%,transparent);border:1px solid color-mix(in srgb,#5b8cff 30%,transparent)}'
          + '.chip i{font-style:normal;color:#5b8cff;font-size:calc(var(--u)*.85)}'
          + '</style>'
          + '<div class=w>'
          + '<div class=hd><div class=ey>✦ Creator mode</div><h1>Describe it. It builds, live.</h1></div>'
          + '<p class=lead>Your idea, a running app in seconds. No servers, nothing to deploy.</p>'
          + '<div class=chips><span class=chip><i>✦</i>Build</span><span class=chip><i>▶</i>Run</span><span class=chip><i>♥</i>Share</span><span class=chip><i>◆</i>Earn</span></div>'
          + '</div>';
      }
      function csResolve() {
        const h = activeHolospace(); const winEl = h ? mounted.get(h.id) : null;
        const nm = (s) => String(s || "").split("  ·  ")[0].trim();
        if (h && (h.editKind === "paste" || h.srcdoc) && typeof h.content === "string")
          return { node: h, winEl, editable: true, src: h.content, mirror: { srcdoc: h.srcdoc || wrapDoc(h.content) }, name: h.name || nm(h.title) || "holospace" };
        if (h && h.src)
          return { node: h, winEl, editable: false, src: null, mirror: { url: h.src }, name: nm(h.title) || "page" };
        // No active holospace → Create opens on the HOME/desktop itself: the preview shows the real
        // home (current wallpaper + credit) and the lift FLIPs from the FULL desktop (winEl = world), so
        // the home shrinks continuously into the preview (and Done reverses back onto it). Editing
        // remixes into a Home holospace κ.
        // A DEV tab opens on the Creator-mode explainer (the build canvas before the first prompt); the
        // bare desktop opens on a faithful Home clone. Either way the first build replaces it in place.
        const isDev = !!(tabs[activeTab] && tabs[activeTab].dev);
        const home = isDev ? csCreatorDoc() : csHomeDoc();
        const nm0 = isDev ? "Untitled" : "Home";
        const obj = repo.publishSource({ name: nm0, source: home });
        const id = addNode({ kind: "app", srcdoc: wrapDoc(home), sandbox: "allow-scripts allow-same-origin", content: home, editKind: "paste", name: nm0, title: nm0 + "  ·  " + linkFor(obj.id), w: 760, h: 540, state: "max" });   // born MAXIMIZED → the preview fills the entire tab, not a 760×540 floating box
        return { node: findNode(id), winEl: world, editable: true, src: home, mirror: { srcdoc: wrapDoc(home) }, name: nm0, fromDesktop: true };
      }
      function csEnsureStyle() {
        if (document.getElementById("cs-style")) return;
        const s = document.createElement("style"); s.id = "cs-style"; s.textContent = `
          /* RIGHT DOCK (the Holo Wallet gesture): the studio is a body-level aside on the right; the live
             desktop/holospace PERSISTS to its left (squeezed by --holo-aside-w) and is edited IN PLACE —
             zero mirror. Slides in from the edge; ONE column (chrome on top · code-or-chat below). */
          /* visibility is NOT gated on a transition (a backgrounded tab pauses transitions, which would
             leave an opacity-faded dock stuck invisible). The dock is opaque on mount; only the transform
             SLIDE animates — a paused slide just leaves it a harmless ~26px off, still fully visible. */
          #create-studio{position:fixed;top:0;right:0;bottom:0;left:auto;width:var(--ha-gw);z-index:60;
            display:flex;flex-direction:column;background:var(--holo-glass-acrylic-bg,rgba(15,19,27,.94));color:var(--holo-ink,#e9eef7);
            -webkit-backdrop-filter:blur(28px) saturate(1.6);backdrop-filter:blur(28px) saturate(1.6);border-left:1px solid var(--holo-glass-border,rgba(255,255,255,.14));
            font:var(--holo-text-sm, 0.875rem)/1.5 var(--win-font,ui-sans-serif,system-ui);transform:translateX(26px);
            box-shadow:-14px 0 44px rgba(0,0,0,.46);transition:transform .42s cubic-bezier(.2,.85,.25,1)}
          #create-studio.on{transform:none}
          /* the composer fills the dock; the mirror stage is GONE (the live desktop is the canvas). The
             chrome bar (Preview/Code · κ · Publish) sits on top in either mode; PREVIEW hides the code area
             (watch the live desktop), CODE hides the chat (edit source) — both apply live via liveEdit. */
          .cs-chat{order:2;flex:1 1 auto;min-height:0;width:auto;max-width:none;display:flex;flex-direction:column;background:transparent;position:relative;
            border-top:1px solid var(--holo-glass-border,rgba(255,255,255,.1))}
          #create-studio.code .cs-chat,#create-studio.dev .cs-chat{display:none}   /* Code/Dev replace the chat in the dock */
          #create-studio .cs-stage{display:none}                                    /* the mirror is gone — the live desktop is the canvas */
          #create-studio:not(.code):not(.dev) .cs-stagewrap{display:none}           /* the stage area shows only for Code or Dev */
          #create-studio.code .cs-preview,#create-studio.dev .cs-preview{flex:1 1 auto;min-height:0}
          /* DEV mode: the full F12 DevTools (ADR-0095, κ-CDP) fills the dock — same surface, deeper depth */
          .cs-devpane{position:absolute;inset:0;display:none;width:100%;height:100%;border:0;background:var(--holo-bg,#0b0d10)}
          #create-studio.dev .cs-devpane{display:block}
          #create-studio.dev .cs-codeview{display:none}
          .cs-chead{display:flex;align-items:center;gap:11px;padding:12px 14px;border-bottom:1px solid #1d1d21}
          .cs-logo{width:27px;height:27px;border-radius:8px;background:linear-gradient(135deg,#ff7eb3,#ff8a5b);flex:0 0 auto}
          .cs-brand{display:flex;flex-direction:column;line-height:1.25;min-width:0}
          .cs-brand b{font-size: var(--holo-text-sm, 0.875rem);display:flex;align-items:center;gap:5px}
          .cs-brand small{font-size: var(--holo-text-sm, 0.688rem);color:#7c7c84;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
          .cs-chead .ic{margin-left:auto;display:flex;gap:12px;color:#7c7c84;font-size:16px}
          .cs-chead .ic #cs-hist-btn:hover{color:#fff}
          /* version history dropdown — anchored under the header inside the chat column */
          .cs-history{position:absolute;left:12px;right:12px;top:58px;z-index:30;max-height:62%;overflow-y:auto;
            background:var(--holo-surface,#15161a);border:1px solid var(--holo-border,#2a2a31);border-radius:13px;
            box-shadow:0 18px 50px rgba(0,0,0,.5);padding:7px;display:flex;flex-direction:column;gap:2px}
          .cs-hist-head{font:600 var(--holo-text-sm, 0.75rem) var(--win-font,system-ui);color:#9a9aa2;padding:6px 8px 8px;display:flex;align-items:center;gap:7px}
          .cs-hist-head span{background:#26262d;border-radius:999px;padding:1px 8px;color:#cdd3df;font-size: var(--holo-text-sm, 0.688rem)}
          .cs-hist-empty{color:#8b8b92;font-size: var(--holo-text-sm, 0.813rem);padding:4px 8px 10px}
          .cs-hist-row{display:flex;align-items:center;gap:9px;width:100%;text-align:left;background:transparent;border:0;
            border-radius:9px;padding:8px 9px;cursor:pointer;color:#d2d2d8;font:var(--holo-text-sm, 0.813rem) var(--win-font,system-ui)}
          .cs-hist-row:hover{background:#202028}
          .cs-hist-row.cur{background:color-mix(in srgb,var(--accent,#5b8cff) 14%,transparent)}
          .cs-hist-n{font-weight:700;color:#cdd3df;min-width:30px}
          .cs-hist-lbl{color:#9a9aa2;text-transform:capitalize;flex:0 0 auto}
          .cs-hist-k{font-family:var(--holo-font-mono,ui-monospace,monospace);color:#7c9cff;font-size: var(--holo-text-sm, 0.719rem);margin-left:auto}
          .cs-hist-tag{font-size: var(--holo-text-sm, 0.688rem);border-radius:999px;padding:2px 8px;flex:0 0 auto}
          .cs-hist-tag.cur{background:#1f3a2a;color:#34d399}
          .cs-hist-tag.rev{background:#26262d;color:#cdd3df}
          .cs-hist-row:hover .cs-hist-tag.rev{background:var(--accent,#5b8cff);color:#fff}
          .cs-thread{flex:1;overflow-y:auto;min-height:0;padding:6px 14px 4px;display:flex;flex-direction:column}
          .cs-msg{padding:0;margin:14px 0;font-size: var(--holo-text-sm, 0.875rem);line-height:1.7;color:#d2d2d8}
          .cs-msg.assistant{font-style:italic;color:#cfcfd6}
          /* the first-run invite: a calm, spare hint in the empty thread — it dissolves on the first message */
          .cs-empty{margin:auto 0;padding:8px 2px 4px;display:flex;flex-direction:column;gap:10px}
          .cs-empty-h{font-size:16px;font-weight:650;color:#ededf2;letter-spacing:-.01em}
          .cs-empty-sub{font-size: var(--holo-text-sm, 0.813rem);line-height:1.7;color:#9a9aa2;max-width:34ch}
          .cs-starters{display:flex;flex-wrap:wrap;gap:7px;margin-top:2px}
          .cs-starter{font:var(--holo-text-sm, 0.813rem)/1 var(--win-font,system-ui);color:#cdd3df;background:#17171b;border:1px solid #2a2a31;
            border-radius:999px;padding:7px 12px;cursor:pointer;transition:background .12s,border-color .12s,color .12s}
          .cs-starter:hover{background:#202028;border-color:#3a3a44;color:#fff}
          .cs-starter:focus-visible{outline:2px solid var(--accent,#5b8cff);outline-offset:2px}
          .cs-msg .k{font-style:normal;font-family:var(--holo-font-mono,ui-monospace,monospace);color:#7c9cff;font-size: var(--holo-text-sm, 0.781rem)}
          .cs-msg.user{align-self:flex-end;font-style:normal;background:#1d1d22;border:1px solid #28282e;border-radius:13px;
            padding:9px 13px;margin:14px 0;max-width:86%}
          .cs-suggest{display:flex;align-items:center;gap:8px;margin:6px 14px 2px;font-size: var(--holo-text-sm, 0.813rem);color:#9a9aa2}
          .cs-suggest .gp{display:flex;align-items:center;gap:7px;flex:1;min-width:0}
          .cs-suggest .pill{background:#2563eb;color:#fff;border-radius:8px;padding:4px 11px;cursor:pointer;font-weight:500}
          .cs-suggest .x{cursor:pointer;color:#7c7c84}
          .cs-composer{margin:10px 14px 14px;border:1px solid #2a2a31;border-radius:16px;background:#161619;padding:12px 14px;
            transition:border-color .15s,box-shadow .15s}
          .cs-composer:focus-within{box-shadow:0 0 0 3px #2563eb22}
          /* the selection context chip — shows which element the next prompt will target */
          .cs-selchip{display:flex;align-items:center;gap:8px;margin:0 0 9px;padding:5px 6px 5px 10px;border-radius:10px;
            background:color-mix(in srgb,var(--accent,#5b8cff) 16%,#161619);border:1px solid color-mix(in srgb,var(--accent,#5b8cff) 40%,transparent)}
          .cs-selchip-tag{font:600 var(--holo-text-sm, 0.75rem) var(--holo-font-mono,ui-monospace,monospace);color:#cdd9ff;flex:0 0 auto}
          .cs-selchip-brief{font-size: var(--holo-text-sm, 0.75rem);color:#9aa6c2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1 1 auto;min-width:0}
          .cs-selchip-x{flex:0 0 auto;width:20px;height:20px;border-radius:6px;display:grid;place-items:center;cursor:pointer;color:#9aa6c2;font-size: var(--holo-text-sm, 0.75rem)}
          .cs-selchip-x:hover{background:#ffffff18;color:#fff}
          .cs-composer:focus-within{border-color:#3a3a44}
          .cs-composer textarea{width:100%;background:transparent;border:0;outline:none;color:#e7e7ea;resize:none;
            font:var(--holo-text-sm, 0.875rem)/1.5 var(--win-font,ui-sans-serif,system-ui);min-height:24px;max-height:170px;display:block}
          .cs-composer textarea::placeholder{color:#6b6b73}
          .cs-crow{display:flex;align-items:center;gap:9px;margin-top:8px}
          .cs-send{margin-left:auto;width:31px;height:31px;border-radius:50%;background:#2563eb;color:#fff;display:grid;place-items:center;
            cursor:pointer;font-size:16px;border:0}
          .cs-send:hover{background:#1d5fe0}
          /* a run is in flight: the same button is now Stop — a calm red so it reads as "you can stop this" */
          .cs-send.busy{background:#3a2230;color:#ff9aa2;font-size: var(--holo-text-sm, 0.75rem)}
          .cs-send.busy:hover{background:#4a2a3a}
          /* ── TOP of the dock: the chrome bar (Preview/Code · κ · Publish), and the Code editor when in
                CODE mode. In PREVIEW mode this is just the slim bar; the live desktop is the canvas. ── */
          .cs-preview{order:1;flex:0 0 auto;display:flex;flex-direction:column;min-width:0;position:relative}
          #create-studio.code .cs-preview{flex:1 1 auto;min-height:0}
          .cs-chrome{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:12px 14px 10px}
          .cs-seg{display:flex;background:#161619;border:1px solid #232327;border-radius:8px;padding:2px;flex:0 0 auto}
          .cs-seg button{border:0;background:transparent;color:#9a9aa2;font:600 var(--holo-text-sm, 0.75rem) var(--win-font,system-ui);
            padding:3px 11px;border-radius:6px;cursor:pointer;display:flex;align-items:center;gap:5px}
          .cs-seg button.on{background:#26262c;color:#eaf2ff}
          .cs-iconbtn{width:30px;height:30px;border-radius:8px;display:grid;place-items:center;color:#9a9aa2;cursor:pointer;font-size: var(--holo-text-sm, 0.938rem)}
          .cs-iconbtn:hover{background:#1c1c20;color:#e7e7ea}
          .cs-addr{display:flex;align-items:center;gap:8px;background:#161619;border:1px solid #232327;border-radius:8px;
            height:28px;box-sizing:border-box;padding:0 10px;color:#9a9aa2;font-size: var(--holo-text-sm, 0.75rem);flex:1 1 auto;margin:0;min-width:0}
          .cs-addr .dot{width:7px;height:7px;border-radius:50%;background:#3fb950;flex:0 0 auto;transition:transform .2s}
          .cs-addr .dot.beat{animation:csBeat .5s ease}
          @keyframes csBeat{0%{transform:scale(1)}45%{transform:scale(1.9);box-shadow:0 0 9px #3fb950}100%{transform:scale(1)}}
          .cs-addr .u{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
            font-family:var(--holo-font-mono,ui-monospace,monospace)}
          .cs-addr .ai{cursor:pointer;color:#8a8a92}.cs-addr .ai:hover{color:#e7e7ea}
          .cs-cact{display:flex;align-items:center;gap:8px;flex:0 0 auto}
          .cs-act{display:flex;align-items:center;gap:5px;height:28px;padding:0 11px;line-height:1;box-sizing:border-box;background:#161619;border:1px solid #232327;color:#c7c7cf;border-radius:8px;font:600 var(--holo-text-sm, 0.75rem) var(--win-font,system-ui);cursor:pointer}
          .cs-act:hover{background:#1d1d22;color:#fff}
          .cs-avatar{width:27px;height:27px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#8b5cf6);flex:0 0 auto}
          .cs-pub{color:#a78bfa;font-size: var(--holo-text-sm, 0.938rem);line-height:1;cursor:pointer}
          .cs-done{display:flex;align-items:center;gap:6px;background:#2563eb;color:#fff;border:0;border-radius:8px;
            height:28px;padding:0 12px;line-height:1;font:600 var(--holo-text-sm, 0.75rem) var(--win-font,system-ui);cursor:pointer;box-sizing:border-box}
          .cs-done:hover{background:#1d5fe0}
          .cs-import{display:flex;align-items:center;gap:5px;white-space:nowrap;background:#21262d;color:#c9d1d9;border:1px solid #30363d;
            border-radius:8px;height:28px;padding:0 11px;line-height:1;font:600 var(--holo-text-sm, 0.75rem) var(--win-font,system-ui);
            cursor:pointer;box-sizing:border-box}
          .cs-import:hover{background:#2d333b;border-color:#3d444d;color:#fff}
          /* Select & edit — a toggle that arms point-and-edit on the live preview (Lovable's "select to edit") */
          .cs-select{display:flex;align-items:center;gap:5px;white-space:nowrap;background:#21262d;color:#c9d1d9;border:1px solid #30363d;
            border-radius:8px;height:28px;padding:0 11px;line-height:1;font:600 var(--holo-text-sm, 0.75rem) var(--win-font,system-ui);cursor:pointer;box-sizing:border-box;transition:background .12s,border-color .12s,color .12s}
          .cs-select:hover{background:#2d333b;border-color:#3d444d;color:#fff}
          .cs-select.on{background:color-mix(in srgb,var(--accent,#5b8cff) 26%,#161619);border-color:var(--accent,#5b8cff);color:#fff;box-shadow:0 0 0 1px var(--accent,#5b8cff) inset}
          .cs-select:focus-visible{outline:2px solid var(--accent,#5b8cff);outline-offset:2px}
          /* the ONE collapse control — the same » chevron every right carriage wears */
          .cs-collapse{flex:0 0 auto;width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:#9a9aa2;
            font-size:17px;line-height:1;cursor:pointer;display:grid;place-items:center;box-sizing:border-box;transition:background .12s,color .12s,transform .12s}
          .cs-collapse:hover{background:color-mix(in srgb,var(--accent,#5b8cff) 22%,#1c1c20);color:#fff;transform:translateX(2px)}
          .cs-collapse:focus-visible{outline:2px solid var(--accent,#5b8cff);outline-offset:2px}
          /* the seamless import field — slides down under the chrome bar; paste anything, Enter */
          .cs-importbar{position:absolute;left:0;right:0;top:0;z-index:6;display:flex;gap:8px;align-items:center;
            padding:8px 12px;background:#0d1117f2;border-bottom:1px solid #21262d;backdrop-filter:blur(6px)}
          .cs-importbar input{flex:1;min-width:0;height:30px;padding:0 12px;border-radius:8px;border:1px solid #30363d;
            background:#161b22;color:#e8eef5;font:var(--holo-text-sm, 0.875rem) var(--win-font,system-ui);outline:none}
          .cs-importbar input:focus{border-color:#2563eb}
          .cs-importbar button{height:30px;padding:0 14px;border-radius:8px;border:0;background:#2563eb;color:#fff;
            font:600 var(--holo-text-sm, 0.75rem) var(--win-font,system-ui);cursor:pointer}
          .cs-importbar button:disabled{opacity:.5;cursor:default}
          .cs-importbar .st{font:var(--holo-text-sm, 0.75rem) var(--win-font,system-ui);color:#8b949e;white-space:nowrap;max-width:38ch;overflow:hidden;text-overflow:ellipsis}
          .cs-stagewrap{position:relative;flex:1;min-height:0;margin:0 12px 12px;border-radius:13px;overflow:hidden;
            background:#05070c;border:1px solid #1d1d21}
          .cs-stage{position:absolute;inset:0;transform-origin:top left;transition:transform .55s cubic-bezier(.22,.85,.2,1)}
          .cs-stage iframe{position:absolute;inset:0;width:100%;height:100%;border:0;opacity:0;transition:opacity .1s linear}
          .cs-stage iframe.on{opacity:1}
          .cs-codeview{position:absolute;inset:0;display:none;background:rgba(24,24,27,.82)}   /* translucent — readable code, a hint of frost */
          .cs-codeview.on{display:flex;flex-direction:row}
          .cs-explorer{width:200px;min-width:148px;max-width:38%;flex:0 0 auto;overflow:auto;border-right:1px solid rgba(255,255,255,.08)}
          .cs-codemain{flex:1;min-width:0;display:flex;flex-direction:column}
          .cs-tabsbar{flex:0 0 auto}
          .cs-edhost{position:relative;flex:1;min-height:0;display:flex}
          .cs-fileview{display:none;position:absolute;inset:0;margin:0;padding:12px 16px;overflow:auto;white-space:pre-wrap;word-break:break-word;color:#d4d4d4;background:#1e1e1e;font:0.78rem/1.5 ui-monospace,monospace;box-sizing:border-box}
          .cs-fileview.on{display:block}
          .cs-gutter{padding:12px 8px 12px 14px;text-align:right;color:#5a626e;background:transparent;overflow:hidden;
            font:var(--holo-text-sm, 0.813rem)/1.5 var(--holo-font-mono,ui-monospace,monospace);user-select:none;white-space:pre}
          .cs-code{position:relative;flex:1;min-width:0;overflow:hidden}
          .cs-code .cs-hl,.cs-code textarea{position:absolute;inset:0;margin:0;padding:12px 16px;border:0;
            font:var(--holo-text-sm, 0.813rem)/1.5 var(--holo-font-mono,ui-monospace,monospace);white-space:pre;tab-size:2;overflow:auto;
            box-sizing:border-box;background:transparent}
          .cs-code .cs-hl{color:#d4d4d4;pointer-events:none;overflow:hidden}
          .cs-code textarea{color:transparent;caret-color:#aeafad;resize:none;outline:none}
          .cs-code textarea::selection{background:#264f78;color:transparent}
          .cs-code .cs-hl .t-tag{color:#569cd6}.cs-code .cs-hl .t-str{color:#ce9178}
          .cs-code .cs-hl .t-com{color:#6a9955;font-style:italic}.cs-code .cs-hl .t-kw{color:#c586c0}
          .cs-edwrap{position:relative;flex:1;min-height:0;display:flex}
          .cs-cm{position:absolute;inset:0;display:none;background:#1e1e1e}
          .cs-cm.on{display:block}
          .cs-cm .cm-editor{height:100%}
          .cs-cm .cm-editor.cm-focused{outline:none}
          .cs-cm .cm-scroller{font-family:var(--holo-font-mono,ui-monospace,monospace);font-size: var(--holo-text-sm, 0.813rem);line-height:1.5}
          .cs-status{height:24px;flex:0 0 auto;display:flex;align-items:center;gap:16px;padding:0 12px;
            background:#1f6feb;color:#fff;font:var(--holo-text-sm, 0.688rem)/1 var(--holo-font-mono,ui-monospace,monospace);letter-spacing:.02em;user-select:none}
          .cs-status .grow{flex:1}
          .cs-status .seg{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
          .cs-status .seg.k{cursor:pointer}
          .cs-status .seg.k:hover{text-decoration:underline}
          .cs-status .dotk{width:6px;height:6px;border-radius:50%;background:#7ee787;display:inline-block}
          .cs-roview{position:absolute;inset:0;display:grid;place-items:center;text-align:center;color:#7c7c84;padding:30px;font-size: var(--holo-text-sm, 0.813rem)}
          [data-holo-motion="reduced"] #create-studio,[data-holo-motion="reduced"] #create-studio *{transition:none!important;animation:none!important}
        `; document.head.appendChild(s);
      }
      const csEsc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
      // single-pass tokenizer over ESCAPED text → no span/attribute corruption (each char consumed once)
      const CS_HL = /(&lt;!--[\s\S]*?--&gt;)|(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|(&lt;\/?[\w:-]+|\/?&gt;)|("[^"\n]*"|'[^'\n]*')|\b(const|let|var|function|return|if|else|for|while|await|async|class|new|import|export|from|of|true|false|null|this|=&gt;)\b/g;
      function csHighlight(src) {
        return csEsc(src).replace(CS_HL, (m, com, jsc, tag, str, kw) =>
          (com || jsc) ? '<span class="t-com">' + (com || jsc) + "</span>"
          : tag ? '<span class="t-tag">' + tag + "</span>"
          : str ? '<span class="t-str">' + str + "</span>"
          : kw ? '<span class="t-kw">' + kw + "</span>" : m);
      }
      function openCreate() {
        if (studio) return;
        try { dispatchEvent(new CustomEvent("holo-journey", { detail: { kind: "cue", cue: "create-open" } })); } catch (e) {}   // Q Companion: the build moment (Stage 2 invite, once)
        // Create always builds in its OWN fresh dev tab (never an overlay on the originating tab) — an
        // isolated, default-wallpaper canvas that stays `dev` until Publish seals it to a κ holo app.
        newDevTab("Create");
        csEnsureStyle();
        const r = csResolve(); const node = r.node; const name = r.name;
        // The preview IS this holospace, rendered in its OWN tab window: maximize the target so every edit
        // streams into the ENTIRE current tab beside the carriage (not a floating sub-window). This is the
        // heart of the vision — edit any running holo app with real-time, full-window preview, the κ
        // streaming live into the tab. (Editable surfaces only; an external page is left exactly as it sits.)
        if (r.editable && node) { try { const _tn = findNode(node.id); if (_tn && _tn.state !== "max") setState(node.id, "max"); } catch (e) {} }
        const k0 = r.editable ? repo.publishSource({ name: node.name || "app", source: r.src }).id : (node.appDid || node.kappa || "");
        const kShort = "holo://" + String(k0).split(":").pop().slice(0, 12) + (k0 ? "…" : "");
        const addr = r.mirror.url || kShort;
        closeAllAsides();   // one carriage at a time — opening Create closes Play / Share (ADR-0109)
        const ov = document.createElement("div"); ov.id = "create-studio"; ov.className = "holo-aside";   // the SHARED carriage frame (golden scale · slide · » collapse), same as Play · Share · Notify · Wallet
        ov.innerHTML =
          '<div class="cs-chat">' +
            '<div class="cs-chead"><div class="cs-logo"></div><div class="cs-brand"><b>' + csEsc(name) + ' <span style="color:#7c7c84">⌄</span></b>' +
              '<small>Previewing live</small></div><div class="ic"><span id="cs-hist-btn" title="Version history — revert to any past edit" role="button" tabindex="0">⟲</span><span title="Panel">▥</span></div></div>' +
            '<div class="cs-thread" id="cs-thread">' + (r.editable   // a calm first-run invite — dissolves on the first real message (addMsg removes #cs-empty)
              ? '<div class="cs-empty" id="cs-empty"><div class="cs-empty-h">Your studio</div>' +
                '<div class="cs-empty-sub">Describe it and it builds, live. Paste a repo or drop in HTML. Publish when it\'s yours.</div>' +
                '<div class="cs-starters"><button class="cs-starter" type="button">a calm pomodoro timer</button><button class="cs-starter" type="button">a personal landing page</button><button class="cs-starter" type="button">a markdown notes app</button></div></div>'
              : '<div class="cs-empty" id="cs-empty"><div class="cs-empty-h">A page from elsewhere</div>' +
                '<div class="cs-empty-sub">This holospace mirrors an external source there is nothing to edit locally. Open it with ↗, or start fresh from Home.</div></div>') +
            '</div>' +   // the thread fills as you build; the invite is removed on the first message
            '<div class="cs-suggest" id="cs-suggest" style="display:none"><div class="gp"><span>⌕</span><span>Review your holospace</span><span title="info">ⓘ</span></div>' +
              '<span class="pill" id="cs-sug-go">Review</span><span class="x" id="cs-sug-x">✕</span></div>' +
            '<div class="cs-composer"><textarea id="cs-ask" rows="1" placeholder="Ask Holo to build…" spellcheck="false"></textarea>' +
              '<div class="cs-crow"><button class="cs-send" id="cs-send" title="Send">↑</button></div></div>' +
          '</div>' +
          '<div class="cs-preview">' +
            '<div class="cs-chrome"><div class="cs-seg"><button class="on" id="cs-tab-pv">Build</button>' +
              (r.editable ? '<button id="cs-tab-code" title="Code — edit the source; every keystroke is a new version">Code</button>' : '') +   // the Code room, surfaced (was only reachable as a side-effect of import); shown only when there IS local source to edit
              '<button id="cs-tab-dev" title="DevTools — full F12 (Elements · Console · Sources · Network)">Dev</button></div>' +
              '<div class="cs-addr"><span class="dot" id="cs-dot"></span><span class="u" id="cs-url">' + csEsc(addr) + '</span>' +
                '<span class="ai" id="cs-ext" title="Open in new tab">↗</span><span class="ai" id="cs-refresh" title="Refresh">⟳</span></div>' +
              '<div class="cs-cact">' +
                (r.editable ? '<button class="cs-select" id="cs-select" type="button" aria-pressed="false" title="Select & edit — click any element in the live preview to change it">⊹ Select</button>' : '') +   // point-and-edit: arm Playground on the preview surface
                '<button class="cs-import" id="cs-import" title="Import any holo app, object or GitHub repo — paste a link, it just works">↓ Import</button><button class="cs-done" id="cs-done">Publish</button>' +
                '<button class="cs-collapse" id="cs-collapse" type="button" title="Collapse" aria-label="Collapse panel">»</button></div></div>' +
            '<div class="cs-stagewrap">' +
              '<div class="cs-stage" id="cs-stage"><iframe id="cs-fa" sandbox="allow-scripts allow-same-origin"></iframe>' +
                '<iframe id="cs-fb" sandbox="allow-scripts allow-same-origin"></iframe></div>' +
              '<div class="cs-codeview" id="cs-codeview">' +
                (r.editable
                  ? '<aside class="cs-explorer" id="cs-explorer"></aside><div class="cs-codemain"><div class="cs-tabsbar" id="cs-tabsbar"></div><div class="cs-edhost">' +
                    '<div class="cs-edwrap" id="cs-edwrap"><div class="cs-gutter" id="cs-gutter">1</div><div class="cs-code"><pre class="cs-hl"><code id="cs-hl"></code></pre>' +
                    '<textarea id="cs-ta" spellcheck="false" autocomplete="off" autocapitalize="off"></textarea></div><div class="cs-cm" id="cs-cm"></div></div>' +
                    '<pre class="cs-fileview" id="cs-fileview"></pre></div>' +
                    '<div class="cs-status" id="cs-status"><span class="seg"><span class="dotk"></span><span id="cs-st-lang">HTML</span></span>' +
                    '<span class="seg" id="cs-st-pos">Ln 1, Col 1</span><span class="grow"></span>' +
                    '<span class="seg k" id="cs-st-k" title="Fingerprint of this app — click to copy">holo://…</span>' +
                    '<span class="seg">UTF-8</span><span class="seg">✦ Hologram</span></div></div>'
                  : '<div class="cs-roview">This holospace is an external page there is no local source to edit.<br>Use ↗ to open it, or start fresh from Home → Create.</div>') +
              '</div>' +
              '<iframe class="cs-devpane" id="cs-dev" title="Holo DevTools" allow="clipboard-write"></iframe>' +   // DEV mode: the κ-CDP-backed Chrome DevTools (ADR-0095), lazily mounted
            '</div>' +
          '</div>';
        // Same template as every other right carriage (Play · Share · Notify · Wallet): golden scale
        // (--ha-gw), slide-in, and the ONE » collapse chevron. No drag-resize — the width is ratio-locked.
        document.body.appendChild(ov);   // a BODY-LEVEL right dock (like Wallet) — the desktop persists beside it
        document.body.classList.add("cs-active");   // Create mode → hide the desktop Privacy shield
        void ov.offsetWidth;   // flush the translateX/visibility start state so the slide-in transition fires
        ov.classList.add("on"); syncDockWidth();   // REVEAL directly (rAF is throttled when the tab is backgrounded); mirror width into --holo-aside-w
        (function reflow() { let n = 0; const t = setInterval(function () { try { dispatchEvent(new Event("resize")); } catch (e) {} if (++n >= 8) clearInterval(t); }, 45); })();
        { const cl = ov.querySelector("#cs-collapse"); if (cl) cl.addEventListener("click", function () { closeCreate(true); }); }
        const $$ = (id) => ov.querySelector("#" + id);
        const fa = $$("cs-fa"), fb = $$("cs-fb"), stage = $$("cs-stage"), dot = $$("cs-dot"), urlEl = $$("cs-url");
        const ta = $$("cs-ta"), hl = $$("cs-hl"), gutter = $$("cs-gutter"), thread = $$("cs-thread"), ask = $$("cs-ask");
        studio = { ov, node, ta, stage, winEl: r.winEl, editable: r.editable, lastK: null, ema: 16, raf: 0, lastSavedK: k0 };
        // ── live preview: double-buffered crossfade, content-addressed ──
        function setUrl(k) { if (!r.mirror.url) urlEl.textContent = "holo://" + String(k).split(":").pop().slice(0, 12) + "…"; var sk = $$("cs-st-k"); if (sk) sk.textContent = urlEl.textContent; }
        function render(src) {
          const obj = repo.publishSource({ name: node.name || "app", source: src }); studio.lastSavedK = obj.id; setUrl(obj.id);
          if (obj.id === studio.lastK) return;   // identical bytes → O(1) rebind, no repaint
          studio.lastK = obj.id;
          const t0 = (performance && performance.now) ? performance.now() : 0;
          const back = fa.classList.contains("on") ? fb : fa, front = back === fa ? fb : fa;
          back.onload = () => { studio.ema = studio.ema * 0.8 + (((performance && performance.now) ? performance.now() : 0) - t0) * 0.2;
            back.classList.add("on"); front.classList.remove("on"); dot.classList.remove("beat"); void dot.offsetWidth; dot.classList.add("beat"); };
          back.srcdoc = wrapDoc(src);
        }
        // ── version history (free, from the substrate): every edit is already a content-addressed κ, so the
        //    lineage costs nothing. We keep an ordered out-of-band log (κ + its source) at meaningful commits
        //    — a build, a point-and-edit, a save, an import — and let you revert to any past version. This is
        //    Lovable's version history; Holo gets it for nothing. Revert re-renders a past source; editing on
        //    from there continues the κ chain (a branch is implicit, no fork bookkeeping needed). ──
        studio.history = [];
        function recordVersion(k, src, label) {
          if (!k || src == null) return;
          const h = studio.history;
          if (h.length && h[h.length - 1].k === k) { h[h.length - 1].label = label || h[h.length - 1].label; return; }   // same κ → just relabel
          h.push({ k: k, src: src, ts: Date.now(), label: label || "edit" });
          if (h.length > 80) h.shift();   // bound the log
        }
        function toggleHistory() {
          const existing = ov.querySelector("#cs-history"); if (existing) { existing.remove(); return; }
          const p = document.createElement("div"); p.id = "cs-history"; p.className = "cs-history";
          const h = studio.history;
          if (!h.length) { p.innerHTML = '<div class="cs-hist-head">Versions</div><div class="cs-hist-empty">No versions yet your edits land here.</div>'; }
          else {
            p.innerHTML = '<div class="cs-hist-head">Versions <span>' + h.length + '</span></div>' +
              h.slice().reverse().map(function (e, i) { const idx = h.length - i; const cur = e.k === studio.lastSavedK;
                return '<button class="cs-hist-row' + (cur ? " cur" : "") + '" data-k="' + csEsc(e.k) + '">' +
                  '<span class="cs-hist-n">v' + idx + '</span><span class="cs-hist-lbl">' + csEsc(e.label || "edit") + '</span>' +
                  '<span class="cs-hist-k">holo://' + String(e.k).split(":").pop().slice(0, 7) + '…</span>' +
                  (cur ? '<span class="cs-hist-tag cur">current</span>' : '<span class="cs-hist-tag rev">revert</span>') + '</button>'; }).join("");
          }
          ov.querySelector(".cs-chat").appendChild(p);
          p.querySelectorAll(".cs-hist-row").forEach(function (row) { row.addEventListener("click", function () {
            const k = row.dataset.k, e = studio.history.filter(function (x) { return x.k === k; })[0];
            if (e && studio.applyLive) { studio.applyLive(e.src); recordVersion(studio.lastSavedK, e.src, "revert");
              addMsg("assistant", 'Reverted to <span class="k">holo://' + String(k).split(":").pop().slice(0, 7) + '…</span> edit on to branch from here. ✦'); }
            p.remove(); }); });
        }
        // liveEditNow — drive the REAL mounted holospace through the liveEdit primitive (zero mirror): the
        // edit re-renders the live iframe in place + advances its κ, exactly as an agent's edit would. For an
        // app holospace this updates the actual running app; the Home/desktop case is the staged compositor.
        function liveEditNow(src) { try { if (window.HoloLiveEdit && studio && studio.node) window.HoloLiveEdit.edit(studio.node.id, src); } catch (e) {} }
        // initial mirror — EXACTLY the screen that was in the tab
        if (r.mirror.url) { fa.src = r.mirror.url; fa.classList.add("on"); }
        else { studio.lastK = repo.publishSource({ name: node.name || "app", source: r.src }).id; fa.srcdoc = r.mirror.srcdoc; fa.classList.add("on"); }
        if (r.editable && r.src != null) recordVersion(studio.lastSavedK, r.src, "start");   // seed the version log with the opening source
        { const hb = $$("cs-hist-btn"); if (hb) { hb.style.cursor = "pointer"; hb.addEventListener("click", toggleHistory);
            hb.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleHistory(); } }); } }
        // ── code view (when editable) ──
        if (r.editable) {
          var paint = function () { hl.innerHTML = csHighlight(ta.value);
            const n = ta.value.split("\n").length; let g = ""; for (let i = 1; i <= n; i++) g += i + (i < n ? "\n" : ""); gutter.textContent = g;
            hl.parentElement.scrollTop = ta.scrollTop; hl.parentElement.scrollLeft = ta.scrollLeft; gutter.scrollTop = ta.scrollTop; };
          var queue = function () { if (studio.raf) cancelAnimationFrame(studio.raf); studio.raf = requestAnimationFrame(function () { render(ta.value); }); };
          ta.value = r.src; paint();
          ta.addEventListener("input", function () { paint(); queue(); });
          ta.addEventListener("scroll", function () { hl.parentElement.scrollTop = ta.scrollTop; hl.parentElement.scrollLeft = ta.scrollLeft; gutter.scrollTop = ta.scrollTop; });
          ta.addEventListener("keydown", function (e) {
            if (e.key === "Tab") { e.preventDefault(); const a = ta.selectionStart, b = ta.selectionEnd; ta.value = ta.value.slice(0, a) + "  " + ta.value.slice(b); ta.selectionStart = ta.selectionEnd = a + 2; paint(); queue(); }
            else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); render(ta.value); recordVersion(studio.lastSavedK, ta.value, "save"); toast("✦ saved · " + urlEl.textContent); } });
          studio.applyLive = function (src) { ta.value = src; paint(); render(src); liveEditNow(src); };
          // syncFromSurface(src) — a point-and-edit (Playground) already rendered on the live surface; MIRROR
          // it into the editor + κ tracking so Publish captures it and Code stays true. Does NOT re-render or
          // liveEdit (the surface already shows it; re-deriving the same source is an O(1) κ no-op anyway).
          studio.syncFromSurface = function (src) {
            try { if (studio.setCode) studio.setCode(src); else { ta.value = src; paint(); } } catch (e) {}
            studio.curSrc = src;
            try { studio.lastSavedK = repo.publishSource({ name: (node && node.name) || "app", source: src }).id; setUrl(studio.lastSavedK); } catch (e) {}
            recordVersion(studio.lastSavedK, src, "select-edit");
          };
          // -- reveal the hologram-native VS Code editor: the vendored, K-sealed CodeMirror 6 engine
          //    from Holo Notepad++ (one-dark = VS Code dark, real syntax/fold/bracket/search), loaded by
          //    content address, cached, mounted over the instant fallback. The doc IS the holospace K --
          //    every keystroke derives a new K (O(1) memo), shown live in the status bar. --
          (function () {
            const cmHost = $$("cs-cm"), codeEl = ta.parentElement, gut = gutter;
            const stPos = $$("cs-st-pos"), stLang = $$("cs-st-lang"), stK = $$("cs-st-k");
            if (stK) stK.onclick = function () { try { navigator.clipboard.writeText(linkFor(studio.lastSavedK)); toast("Fingerprint copied ✦"); } catch (e) {} };
            const g = (typeof window !== "undefined") ? window : globalThis;
            g.__holoCM = g.__holoCM || import("/apps/notepadpp/codemirror/codemirror.bundle.mjs");
            g.__holoCM.then(function (CM) {
              const isHtml = /^\s*<|<\/?[a-z!]/i.test(ta.value || "");
              const langId = isHtml ? "html" : "javascript";
              if (stLang) stLang.textContent = isHtml ? "HTML" : "JavaScript";
              const vstheme = CM.EditorView.theme({
                "&": { backgroundColor: "#1e1e1e", height: "100%", fontSize: "13px" },
                ".cm-gutters": { backgroundColor: "#1e1e1e", color: "#5a626e", border: "0", borderRight: "1px solid #2a2a31" },
                ".cm-activeLineGutter": { backgroundColor: "#1e1e1e", color: "#c9d1d9" },
                ".cm-activeLine": { backgroundColor: "rgba(255,255,255,.03)" },
                ".cm-content": { caretColor: "#aeafad" },
                ".cm-scroller": { fontFamily: "var(--holo-font-mono,ui-monospace,monospace)" },
              }, { dark: true });
              const make = CM.LANGUAGES[langId] || CM.LANGUAGES.html;
              let syncing = false;
              const state = CM.EditorState.create({
                doc: ta.value,
                extensions: [
                  CM.keymap.of([{ key: "Mod-s", preventDefault: true, run: function (v) { const s = v.state.doc.toString(); render(s); recordVersion(studio.lastSavedK, s, "save"); toast("✦ saved · " + urlEl.textContent); return true; } }]),
                  CM.lineNumbers(), CM.highlightActiveLineGutter(), CM.highlightSpecialChars(),
                  CM.history(), CM.foldGutter(), CM.drawSelection(), CM.dropCursor(),
                  CM.EditorState.allowMultipleSelections.of(true), CM.indentOnInput(),
                  CM.syntaxHighlighting(CM.defaultHighlightStyle, { fallback: true }),
                  CM.bracketMatching(), CM.closeBrackets(), CM.autocompletion(),
                  CM.rectangularSelection(), CM.crosshairCursor(),
                  CM.highlightActiveLine(), CM.highlightSelectionMatches(), CM.search({ top: true }),
                  CM.keymap.of([].concat(CM.closeBracketsKeymap, CM.defaultKeymap, CM.searchKeymap,
                    CM.historyKeymap, CM.foldKeymap, CM.completionKeymap, [CM.indentWithTab])),
                  CM.oneDark, vstheme, (make ? make() : []),
                  CM.EditorView.updateListener.of(function (u) {
                    if (u.selectionSet || u.docChanged) {
                      const st = u.state, head = st.selection.main.head, line = st.doc.lineAt(head);
                      if (stPos) stPos.textContent = "Ln " + line.number + ", Col " + (head - line.from + 1);
                    }
                    if (u.docChanged && !syncing) { ta.value = u.state.doc.toString(); queue(); }
                  }),
                ],
              });
              const editor = new CM.EditorView({ state: state, parent: cmHost });
              codeEl.style.display = "none"; if (gut) gut.style.display = "none"; cmHost.classList.add("on");
              studio.cm = editor;
              studio.setCode = function (src) { syncing = true; editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: src } }); syncing = false; ta.value = src; };
              studio.applyLive = function (src) { studio.setCode(src); render(src); liveEditNow(src); };
              studio.focusCode = function () { editor.focus(); };
              if (cv && cv.classList.contains("on")) editor.focus();
            }).catch(function (e) { console.warn("holo: CM6 editor load failed - fallback editor stays", e); });
          })();
        }
        // ── VS Code chrome: the explorer sidebar (file tree = the κ-object tree) + tabs, around CM6 (purely additive) ──
        if (r.editable) (async function mountCodeExplorer() {
          try {
            const [M, D] = await Promise.all([import("/_shared/q/holo-code-explorer-ui.mjs"), import("/_shared/q/holo-code-diff.mjs")]);
            if (!document.getElementById("hx-css")) { const st = document.createElement("style"); st.id = "hx-css"; st.textContent = M.EXPLORER_CSS + D.DIFF_CSS; document.head.appendChild(st); }
            const elx = $$("cs-explorer"), tabs = $$("cs-tabsbar"), fv = $$("cs-fileview"); if (!elx) return;
            const buildFor = function () { const a = window.__holoApp; return (a && (a.app || a.compiled)) ? a : { source: (ta && ta.value) || r.src || "" }; };
            const storeOf = function () { const a = window.__holoApp; return (a && a.sealed && a.sealed.store) || {}; };
            function showDiff() { const h = studio.history || []; fv.innerHTML = h.length < 2 ? '<div class="hd-wrap"><div class="hd-stat">no previous version yet — your edits land here</div></div>' : D.renderDiffHTML(D.lineDiff(h[h.length - 2].src, (ta && ta.value) || "")); fv.classList.add("on"); }
            function srcTab(file) { tabs.innerHTML = M.renderTabsHTML([{ id: file.id, name: file.name, lang: file.lang, kappa: file.kappa }], { activeId: file.id }); if ((studio.history || []).length > 1) { const row = tabs.querySelector(".hx-tabs") || tabs; const b = document.createElement("button"); b.textContent = "⇄ Diff"; b.title = "diff vs the previous version"; b.style.cssText = "margin-left:auto;align-self:center;background:transparent;border:1px solid var(--holo-line,#2a2f37);color:var(--holo-ink-2,#aab6c6);border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer"; b.onclick = showDiff; row.appendChild(b); } }
            function refresh(activeId) {
              try { M.mountExplorer(elx, buildFor(), { store: storeOf(), activeId: activeId || null, onOpen: function (file, opened, err) {
                if (file.name === "index.html" || file.group === "projection") { srcTab(file); fv.classList.remove("on"); if (studio.focusCode) studio.focusCode(); return; }
                tabs.innerHTML = M.renderTabsHTML([{ id: file.id, name: file.name, lang: file.lang, kappa: file.kappa }], { activeId: file.id });
                fv.textContent = err ? ("⚠ " + err + "  (refused — does not re-derive to its κ)") : opened.content;
                fv.classList.add("on");
              } }); } catch (e) {}
            }
            refresh(); window.__holoCodeExplorer = { refresh };
          } catch (e) { /* the explorer is additive — never break Code */ }
        })();
        // ── view toggle ──
        const cv = $$("cs-codeview"), tabPv = $$("cs-tab-pv"), tabCode = $$("cs-tab-code"), tabDev = $$("cs-tab-dev"), devFrame = $$("cs-dev");
        // BUILD (default) ⇄ CODE ⇄ DEV — one dock, three depths. DEV lazily mounts the κ-CDP-backed Chrome
        // DevTools (ADR-0095) and governs the frame so its CDP rides the holo-gov bus; all three edit the
        // SAME live holospace (chat→liveEdit; the DevTools mutate path → window.HoloLiveEdit). Simple first.
        function mountDev() {
          try { window.HoloDevToolsTarget = studio && studio.node && studio.node.id; } catch (e) {}   // DevTools edits → THIS holospace (liveEdit, ADR-0093)
          // Point the CDP backend at THIS holospace. PURE-WEB Tier 1 (real F12, no app/extension): install the
          // LIVE backend over the focused preview iframe — a SAME-ORIGIN doc, so Elements shows its REAL DOM,
          // Styles the REAL CSSOM, Console evaluates in the REAL page. Every edit re-seals → new κ via liveEdit,
          // so every object in the holospace stays κ-addressed AND editable (the operator's demand). Falls back
          // to the κ-scene backend for a non-editable (external) holospace that has no reachable live document.
          try {
            if (r.editable && window.HoloDevTools && window.HoloDevTools.installLive) {
              window.HoloDevToolsServe = window.HoloDevTools.installLive({
                target: function () {
                  const f = fa.classList.contains("on") ? fa : fb;   // the visible double-buffer = the live holospace
                  let d = null, w = null; try { d = f.contentDocument; w = f.contentWindow; } catch (e) {}
                  return { doc: d, win: w, kappa: (studio && (studio.lastSavedK || (studio.node && studio.node.id))) || null };
                },
                edit: function (kappa, source) { try { return (window.HoloLiveEdit && window.HoloLiveEdit.edit) ? window.HoloLiveEdit.edit((studio && studio.node && studio.node.id) || kappa, source) : null; } catch (e) { return null; } },
                conscience: window.HoloConscience || null,
              });
            } else if (window.HoloDevTools && window.HoloDevTools.install) {
              const src = (ta && typeof ta.value === "string" && ta.value) ? ta.value : r.src;
              const pub = repo.publishSource({ name: (node && node.name) || name || "app", source: src });
              window.HoloDevToolsServe = window.HoloDevTools.install({ objects: [pub], placements: [{ k: pub.id, x: 0, y: 0, w: 1280, h: 800 }], conscience: window.HoloConscience || null });
            }
          } catch (e) {}
          if (!devFrame || devFrame.dataset.mounted) return; devFrame.dataset.mounted = "1";
          // mount the DevTools holospace. NATIVE host (Tauri/WebView2 = Chromium): get the REAL Chrome
          // DevTools Protocol endpoint for THIS page and mount devtools-frontend over a real WebSocket →
          // genuine F12 of the live tab (ADR-0095 native door). PURE WEB: the κ-CDP backend over the bus.
          const mountWith = function (src, real) {
            devFrame.src = src;
            if (!real) devFrame.addEventListener("load", function () {   // κ path rides the governed bus; real-CDP needs no HoloGov routing
              try { if (window.HoloGov && devFrame.contentWindow) window.HoloGov.register(devFrame.contentWindow, { did: "did:holo:app:holo-devtools", id: "org.hologram.HoloDevTools", name: "Holo DevTools" }); } catch (e) {}
            }, { once: true });
          };
          // pure-web: mount with ?ws=holo-bridge so devtools-frontend uses its WebSocketConnection (the proven
          // render path), bridged to the κ live backend over the bus — the Elements tree actually paints.
          const kappaSrc = function () { return "/_shared/devtools/holo-devtools.html?ws=holo-bridge#" + Date.now(); };
          const T = window.__TAURI__, invoke = T && ((T.core && T.core.invoke) || T.invoke || (T.tauri && T.tauri.invoke));
          if (invoke) {
            Promise.resolve().then(function () { return invoke("holo_devtools_targets"); }).then(function (raw) {
              let ws = null;
              try {
                const list = JSON.parse(raw), here = location.href.replace(/#.*$/, "");
                const pick = list.find(function (t) { return t.type === "page" && t.url === here; })
                  || list.find(function (t) { return t.type === "page" && t.url && here.indexOf(t.url) === 0; })
                  || list.find(function (t) { return t.type === "page" && t.url && t.url.indexOf(location.origin) === 0; })
                  || list.find(function (t) { return t.type === "page"; });
                ws = pick && pick.webSocketDebuggerUrl;
              } catch (e) {}
              if (ws) mountWith("/_shared/devtools/holo-devtools.html?ws=" + ws.replace(/^wss?:\/\//, "") + "#" + Date.now(), true);
              else mountWith(kappaSrc(), false);   // no real target found → honest κ fallback
            }).catch(function () { mountWith(kappaSrc(), false); });
          } else {
            mountWith(kappaSrc(), false);   // pure web → κ-CDP backend
          }
        }
        function view(v) {
          const code = v === "code", dev = v === "dev";
          ov.classList.toggle("code", code); ov.classList.toggle("dev", dev);
          cv.classList.toggle("on", code);
          if (tabCode) tabCode.classList.toggle("on", code); if (tabDev) tabDev.classList.toggle("on", dev); tabPv.classList.toggle("on", !code && !dev);
          if (dev) mountDev();
          if (code) setTimeout(function () { if (studio.focusCode) studio.focusCode(); else if (ta) ta.focus(); }, 0);
        }
        tabPv.onclick = function () { view("pv"); }; if (tabCode) tabCode.onclick = function () { view("code"); }; if (tabDev) tabDev.onclick = function () { view("dev"); };
        // ── chat: post messages; markup is rendered live (a real, local build) ──
        function addMsg(role, html) { const e = thread.querySelector("#cs-empty"); if (e) e.remove();   // the conversation has begun → retire the first-run invite
          const m = document.createElement("div"); m.className = "cs-msg " + role; m.innerHTML = html; thread.appendChild(m); thread.scrollTop = thread.scrollHeight; return m; }
        // first-run starters: a tap pre-fills the composer with a concrete example and focuses it (the cheapest "show me how to begin")
        ov.querySelectorAll(".cs-starter").forEach(function (b) { b.addEventListener("click", function () { if (studio.busy) return; ask.value = b.textContent; ask.focus(); ask.dispatchEvent(new Event("input")); }); });
        // ── Build: a natural-language prompt → the OS-wide trinity GENERATES a holospace (ADR-0087),
        //    κ-memoized (O(1) on a repeat prompt), rendered through the studio's content-addressed
        //    double-buffered preview (instant, serverless, anchored in κ). A deterministic local builder
        //    stands in for the on-device generative specialist (the same provider seam it plugs into). ──
        function csTitle(p) {   // a concise, COMPLETE hero title: drop filler so we never clip mid-phrase (e.g. "…Name And" losing "email") and the accent word is meaningful
          var STOP = { a: 1, an: 1, the: 1, to: 1, of: 1, for: 1, and: 1, or: 1, with: 1, in: 1, on: 1, at: 1, my: 1, your: 1, app: 1, that: 1, simple: 1 };
          var words = String(p).replace(/[^a-z0-9 ]/gi, " ").trim().split(/\s+/).filter(Boolean);
          var content = words.filter(function (w) { return !STOP[w.toLowerCase()]; });
          return ((content.length ? content : words).slice(0, 5).map(function (w) { return w[0].toUpperCase() + w.slice(1); }).join(" ") || "Holospace");
        }
        function csAccent(p) { const k = { blue: "#5b8cff", green: "#34d399", teal: "#2dd4bf", purple: "#7c5cff", pink: "#f472b6", gold: "#fbbf24", red: "#f87171" }; const m = Object.keys(k).find(function (x) { return String(p).toLowerCase().includes(x); }); if (m) return k[m]; const C = Object.values(k); let h = 0; for (const c of String(p)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return C[h % C.length]; }
        function buildHolospaceHTML(p) {
          const t = csTitle(p), a = csAccent(p), parts = t.split(" "), head = parts.slice(0, -1).join(" ") || t, tail = parts.length > 1 ? parts.slice(-1)[0] : "";
          return '<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><style>'
            + '*{box-sizing:border-box}html,body{height:100%;margin:0}'
            + 'body{font:16px/1.6 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;color:#e8eef9;background:radial-gradient(120% 120% at 30% 0%,#16203a,#0a0e17 60%,#05070c);display:grid;place-items:center;padding:6vw}'
            + '.wrap{max-width:760px;text-align:center}.tag{font-size: var(--holo-text-sm, 0.75rem);letter-spacing:3px;text-transform:uppercase;color:' + a + ';font-weight:700}'
            + 'h1{font-size:clamp(34px,7vw,72px);line-height:1.05;margin:14px 0 10px;font-weight:800}h1 .k{background:linear-gradient(90deg,' + a + ',#a78bfa);-webkit-background-clip:text;background-clip:text;color:transparent}'
            + 'p.lead{font-size:clamp(16px,2.4vw,20px);color:#9fb0c8;margin:0 auto 28px;max-width:560px}.cta{display:inline-flex;gap:12px}.btn{padding:13px 22px;border-radius:12px;font-weight:600;text-decoration:none;cursor:pointer}'
            + '.btn.p{background:' + a + ';color:#08101e}.btn.s{border:1px solid #2a3550;color:#cdd7ea}.row{display:flex;gap:14px;justify-content:center;margin-top:40px;flex-wrap:wrap}'
            + '.card{background:#0e1626;border:1px solid #1c2740;border-radius:16px;padding:18px 20px;min-width:170px;text-align:left}.card b{color:#fff}.card span{color:#7f90ad;font-size: var(--holo-text-sm, 0.875rem)}</style>'
            + '<div class=wrap><div class=tag>Holospace · on-device</div><h1>' + csEsc(head) + (tail ? ' <span class=k>' + csEsc(tail) + '</span>' : '') + '</h1>'
            + '<p class=lead>' + csEsc(p) + '</p><div class=cta><a class="btn p">Get started</a><a class="btn s">Learn more</a></div>'
            + '<div class=row><div class=card><b>Instant</b><br><span>Renders the moment you ask.</span></div>'
            + '<div class=card><b>Private</b><br><span>Runs on your device, content-addressed.</span></div>'
            + '<div class=card><b>Yours</b><br><span>One κ share it, no sign-in.</span></div></div></div>';
        }
        // the HYBRID generative seam (ADR-0087): lazily bind boost (frontier·opt-in) + the on-device
        // model (Qwen2.5 via Holo Voice LLM). Created cheaply; the heavy model load happens on first gen.
        let _cg = null, _cgReady = false, _cgLoading = false, _deviceDead = false, _codeBadge = null, _lastActiveCode = null, _codeDevice = null;
        const _csTplMsg = function (p) { return 'Built <b style="font-style:normal">' + csEsc(p) + '</b> <span class="k">' + urlEl.textContent + '</span> · <span style="color:#7f90ad">template</span> ✦'; };
        // ── Q.fuse (ADR-0098): the moment a warm on-device brain is available, wire the COMPOUND verb with
        //    the DEFAULT PANEL (PERSONA mode — one brain, diverse reasoning lenses; ADR-0096). One-time; the
        //    same sampler the build uses becomes the fusion panel. Until then Q.fuse returns its honest
        //    notice (never fakes). Lazy import so it costs nothing on a device that never builds. ──
        function wireFuse(device) {
          if (!device || window.__holoFuseWired || !window.Q || typeof window.Q.configureFuse !== "function") return;
          window.__holoFuseWired = true;
          import("/_shared/q/holo-q-fuse-panel.js").then(function (fp) {
            var cdf = fp.configureDefaultFuse || (fp.default && fp.default.configureDefaultFuse);
            try { if (cdf) cdf(window.Q, { sampler: device }); } catch (e) { window.__holoFuseWired = false; }
          }).catch(function () { window.__holoFuseWired = false; });
        }
        // ── Holo Recall (ADR-0099): wire Q.recall onto a PRIVATE corpus of the holospaces YOU build. The
        //    corpus is BM25 + the zero-LLM auto-link κ-graph (no embedder → deterministic, instant, no model
        //    load on a build); the optional synthesize step rides the same fuse the door already holds. The
        //    INDEX-ON-BUILD hook indexes each built holospace's PROMPT keyed by its κ, so "recall what I made
        //    about X" finds it even when a filename search can't (the find.html omnibar reaches this same
        //    corpus via window.parent.Q.recall when embedded). One-time, lazy, never blocks. ──
        // ── the ONE shared search embedder (ADR-0084): bind the canonical search faculty (session-search +
        //    skills-hub) on the shell's mux via holo-q-search, so EVERY semantic search in this frame (Recall,
        //    skill search, omni) shares one vector space — no surface ships its own embedder. Lazy + memoized +
        //    never-throws: returns the bound embedder, or null when none loads (the caller stays lexical). ──
        let _sharedEmbedderP = null;
        function ensureSharedEmbedder() {
          if (_sharedEmbedderP) return _sharedEmbedderP;
          _sharedEmbedderP = (async function () {
            try {
              const [srch, mx, emb] = await Promise.all([
                import("/_shared/q/holo-q-search.mjs"),
                import("/_shared/q/holo-q-mux.js"),
                import("/_shared/q/holo-q-embed.js"),
              ]);
              const mux = mx.default || mx;
              await srch.ensureSearchEmbedder(mux, { autowire: emb.autowire });   // binds session-search + skills-hub to ONE embedder
              const r = srch.resolveSearch(mux, { faculty: "session-search" });
              return r.embedder || null;
            } catch (e) { return null; }
          })();
          return _sharedEmbedderP;
        }
        function wireRecall() {
          if (window.__holoRecallWired || !window.Q || typeof window.Q.configureRecall !== "function") return;
          window.__holoRecallWired = true;
          import("/_shared/q/holo-q-corpus.js").then(function (cm) {
            var createCorpus = cm.createCorpus || (cm.default && cm.default.createCorpus);
            if (!createCorpus) { window.__holoRecallWired = false; return; }
            // SEMANTIC recall via the ONE shared embedder; honest BM25 + graph floor when none loads.
            ensureSharedEmbedder().then(function (embedder) { wireRecallCorpus(createCorpus, embedder); });
          }).catch(function () { window.__holoRecallWired = false; });
        }
        function wireRecallCorpus(createCorpus, embedder) {
            var corpus = createCorpus(embedder ? { embedder: embedder } : {});   // shared embedder → semantic; else BM25 + graph (deterministic)
            window.__holoRecallCorpus = corpus;
            window.Q.configureRecall({ corpus: corpus });                 // synth defaults to the configured fuse inside the door
            if (!window.__holoRecallHook) {                               // index-on-build: every build you make becomes recall-able
              window.__holoRecallHook = true;
              var origCreate = window.Q.create.bind(window.Q);
              window.Q.create = function (intent, opts) {
                opts = opts || {};
                return Promise.resolve(origCreate(intent, opts)).then(function (r) {
                  try {
                    var txt = typeof intent === "string" ? intent : (intent && (intent.text || intent.prompt || intent.input)) || "";
                    var isBuild = (!opts.task || opts.task === "create") && !opts.editing && !(opts.context && opts.context.source);
                    if (r && r.kappa && txt && isBuild) corpus.index({ id: r.kappa, text: txt, meta: { kind: "holospace" } });
                  } catch (e) {}
                  return r;
                });
              };
            }
        }
        // Create mode's generative seam, CANONICALLY wired (ADR-0084/0096): the on-device tier is no longer a
        // private voice-LLM — it is the mux's `code` faculty (qwen-coder), routed through holo-q-active with an
        // honest fallback to the `respond` TEXT brain while the coder loads, and a silent upgrade the moment it
        // is ready. mountCoreBrains binds the OS's own brains (text always; the coder only on WebGPU → "text
        // model only" otherwise) and background-loads them; facultySampler RE-RESOLVES per build so the right
        // brain always answers. ONE brain per task, shared with every other surface that routes `code`/`respond`.
        async function ensureCodegen(onProgress) {
          if (_cgReady) return _cg; if (_cgLoading) return null; _cgLoading = true;
          try {
            const [mod, act, mx, cb, casc] = await Promise.all([
              import("/_shared/q/holo-q-codegen.js"),
              import("/_shared/q/holo-q-active.mjs"),
              import("/_shared/q/holo-q-mux.js"),
              import("/_shared/q/holo-q-corebrains.mjs"),
              import("/_shared/q/holo-q-codegen-cascade.mjs").catch(function () { return null; }),
            ]);
            const mux = mx.default || mx;
            if (!window.__holoCoreBrains) {                                // once per shell: bind + background-load the core brains (lazy → no boot cost)
              const hasGPU = !!(typeof navigator !== "undefined" && navigator.gpu);
              const makeText = async () => { const v = await import("/_shared/voice/holo-voice-llm.mjs"); return (v.createLLM || v.default)({
                preferWebGPU: false,                                       // WASM floor: any-browser, no-GPU (κ-host headless safe)
                wasm: { model: "onnx-community/Qwen2.5-0.5B-Instruct", dtype: "q8" },
                wasmFallback: { model: "onnx-community/Qwen2.5-0.5B-Instruct", dtype: "q8" },
                // κ-RELEASE delivery: the 0.5B ONNX rides in a content-addressed .holo (per-block L5 + OPFS),
                // NOT the closure — served from path(dev)→Release(prod), every block re-derived to its κ so an
                // untrusted release host can't tamper. Mirrors the live ASR floor (holo-voice.js).
                knativeServe: { module: "/apps/q/forge/gpu/holo-onnx-kserve.mjs", holoUrl: "/apps/q/forge/.models/qwen2.5-0.5b-onnx.holo", modelId: "onnx-community/Qwen2.5-0.5B-Instruct", kappa: "5749d3ba24593454eeeb5c32d20a08d03813a7cf288c45b2a574a0822708356a", release: "https://github.com/Hologram-Technologies/hologram-apps/releases/download/models-v1/qwen2.5-0.5b-onnx.holo" }
              }); };
              const makeCode = async () => { const g = await import("/_shared/voice/holo-voice-gpu-brain.mjs"); return (g.createGpuBrain || g.default)({}); };
              window.__holoCoreBrains = cb.mountCoreBrains(mux, { makeText: makeText, makeCode: makeCode, hasGPU: hasGPU, onProgress: onProgress });
            }
            // the device sampler. CASCADE (holo-q-codegen-cascade): while the coder's κ-disk is still streaming
            // in, the fast `respond` brain LEADS the build (real output in ~seconds, not a 1.5GB wait) and the
            // `code` coder takes over via {replace} the moment it lands (blurry→sharp, within the SAME build).
            // When the coder is already warm, or unavailable (no WebGPU), this is the plain single sampler —
            // identical to before. Best-effort: any issue falls back to the canonical sampler. [verify in a real shell.]
            let device = null;
            try {
              const cores = window.__holoCoreBrains || {};
              const coderLoading = cores.code && cores.code.isReady && !cores.code.isReady();
              if (coderLoading && casc && casc.createCascadeSampler) {
                device = casc.createCascadeSampler({ tiers: [
                  { name: "draft", sampler: act.facultySampler(mux, "respond", { chain: ["respond"] }), whenReady: cores.text ? function () { return cores.text.kick(); } : null },
                  { name: "coder", sampler: act.facultySampler(mux, "code", { chain: ["code"], onResolve: function (r) { _lastActiveCode = r; } }), whenReady: function () { return cores.code.kick(); } },
                ] });
              }
            } catch (e) { device = null; }
            if (!device) device = act.facultySampler(mux, "code", { chain: ["code", "respond"], onResolve: function (r) { _lastActiveCode = r; } });
            _codeBadge = function () { try { return act.describeActive(mux, "code", { chain: ["code", "respond"] }); } catch (e) { return null; } };
            const boost = (typeof window !== "undefined" && typeof window.HoloBoost === "function") ? function (m, o) { return window.HoloBoost(m, o); } : null;
            _cg = mod.createCodegen({ device: device, boost: boost }); _cgReady = true; _codeDevice = device;   // expose the raw (messages,opts) sampler for spec-mode (full-stack build)
            wireFuse(device);                                             // the device sampler is always present now → Q.fuse rides the same brain
            wireRecall();                                                 // and Q.recall over your built-holospace corpus (ADR-0099)
            // FULL-STACK CREATE: expose the holo-app engine in the Create context (additive, never-throws). A
            // build can be sealed to a conformant holo-app via window.HoloCreateApp.sealBuiltApp(source) →
            // { manifestK, share:"holo://sha256/…", api(REST+MCP descriptor), sealed }; buildFullStackApp(intent)
            // runs the full A–H pipeline (UI+data+auth+REST/MCP) when the coder emits a typed spec.
            import("/_shared/q/holo-q-create-fullstack.mjs").then(function (m) { window.HoloCreateApp = m; }).catch(function () {});
          } catch (e) { _cg = null; } finally { _cgLoading = false; }
          return _cg;
        }
        // the honest "which model is building this" label for the Create status line (Task 4 — the user always
        // knows). Reflects the live fallback/loading state: the coder when ready, "<text> · coder loading…" while
        // the coder streams its κ-disk, the plain text model when that is all this device runs.
        function codeTierLabel() {
          const b = _codeBadge && _codeBadge();
          if (!b) return "on-device";
          if (b.onFloor) return "on-device (starting up)";
          if (b.isFallback) return "on-device " + b.label + " · coder loading…";
          return "on-device " + b.label;
        }
        // ── the "create" SPECIALIST: codegen folded into the Mixture-of-Specialists, bound to the
        //    `create` task (Law L4). The tiers (template floor → device → boost) become a routing detail
        //    INSIDE this provider, not surface if/else; it streams {replace} blocks the fabric seals to a
        //    κ. Bound on the shared mux module → window.HoloTrinity.create routes the build here. ──
        const _createSpecialist = {
          id: "holo-create",
          generate: async function* (prompt, opts) {
            opts = opts || {};
            const editing = !!opts.editing, current = opts.current || null;
            const floor = buildHolospaceHTML(prompt);
            yield { replace: editing && current ? current : floor };      // instant, sealed baseline
            const wantBoost = !!(typeof window !== "undefined" && window.HoloBoost);   // boost = the opt-in frontier gateway the user installs (window.HoloBoost)
            if (studio) studio._lastTier = "template";
            if (_deviceDead && !wantBoost) return;                        // a prior load was slow → floor stands
            const cg = await ensureCodegen();
            if (!cg || (!cg.has("device") && !wantBoost)) return;         // no real model → template-only build
            // SPEC-MODE (full-stack · default): the coder emits a TYPED SPEC → compiles to a beautiful UI + data/
            // auth + REST/MCP, self-tested + sealed to a κ (exposed as window.__holoApp). One-shot: the instant
            // template snaps to the full app. A garbled model can't break it (the agent falls back to a valid
            // app). Any failure falls THROUGH to streaming-HTML below — no regression.
            if (!wantBoost && typeof window !== "undefined" && window.HoloCreateApp && window.HoloCreateApp.buildFromIntent && _codeDevice) {
              try {
                const fs = await window.HoloCreateApp.buildFromIntent(prompt, { generate: _codeDevice });
                if (fs && fs.projectionHtml && fs.test && fs.test.ok) {
                  window.__holoApp = fs; try { window.__holoCodeExplorer && window.__holoCodeExplorer.refresh(); } catch (e) {}
                  try { if (window.HoloLens) window.HoloLens.expose(fs); } catch (e) {}   // κ-lens ready (A6) — DevTools/Console can inspect every κ-object

                  if (studio) studio._lastTier = "full-stack" + (fs.app && fs.app.collections && fs.app.collections.length ? " · " + fs.app.collections.length + " data" : "");
                  yield { replace: fs.projectionHtml };
                  return;
                }
              } catch (e) {}
            }
            const queue = []; let done = false, result = null, wake = null, slow = false;
            const bump = function () { if (wake) { const w = wake; wake = null; w(); } };
            const TIMEOUT = wantBoost ? 60000 : 18000;
            const to = setTimeout(function () { slow = true; done = true; bump(); }, TIMEOUT);
            cg.generate({ prompt: prompt, current: editing ? current : null, boost: wantBoost,
                onToken: function (src) { queue.push(src); bump(); } })
              .then(function (r) { result = r; done = true; bump(); })
              .catch(function () { done = true; bump(); });
            for (;;) {
              if (queue.length) { const src = queue.shift(); if (/<\/(section|main|body|html)>/i.test(src)) yield { replace: src }; continue; }
              if (done) break;
              await new Promise(function (res) { wake = res; });
            }
            clearTimeout(to);
            if (result && result.source) { if (studio) studio._lastTier = result.mode === "boost" ? "boosted model" : codeTierLabel(); yield { replace: result.source }; }
            else if (slow) { _deviceDead = true; if (studio) studio._lastTier = "template (on-device slow)"; }
          },
        };
        import("/_shared/q/holo-q-mux.js").then(function (mx) { const b = mx.bindSpecialist || (mx.default && mx.default.bindSpecialist); if (b) b("create", _createSpecialist); }).catch(function () {});

        // ── HOLO IMPORT (ADR-0092): paste a GitHub URL → a running, content-addressed Holo app. Binds the
        //    DETERMINISTIC "import" specialist onto the SAME mux/Q spine the build rides (so a repeat URL is
        //    O(1)), with a REAL GitHub ingest (the boundary, hit once) + the repo's OWN seal hash (κ-parity:
        //    the imported app addresses identically to a studio-built one). Faithful, never generative. ──
        let _importApi = null, _lastImport = null, _lastFetchFiles = null, _gov = null, _importReady = null;   // _importReady: an awaitable that resolves once the import engine is bound (so a repo paste never silently falls through to Build)
        // GOVERNED INGEST (Law L4): every outbound import fetch (GitHub bytes, a CDN dep) passes the
        // conscience BEFORE it happens (PII red-line / ungranted host → refused) and mints an ingest
        // receipt. allowUngoverned:true = the host is trusted (a user-initiated import), but the conscience
        // STILL gates when present. _gov is set once holo-import loads; gfetch falls back pre-load.
        async function gfetch(url, purpose) {
          if (_gov) { const r = await _gov(url, { purpose: purpose }); if (!r.ok) throw new Error("ingest refused " + (r.reason || "governed (Law L4)")); return r.response; }
          return fetch(url);
        }
        async function ghFetchRepo(spec) {                    // the GOVERNED INGEST BOUNDARY (conscience-gated → raw.github)
          const owner = spec.owner, rp = spec.repo, api = "https://api.github.com/repos/" + owner + "/" + rp;
          let branch = spec.ref;
          if (!branch) { const r = await gfetch(api, "repo"); if (!r.ok) throw new Error("repo not found"); branch = (await r.json()).default_branch; }
          const cr = await gfetch(api + "/commits/" + encodeURIComponent(branch), "repo"); if (!cr.ok) throw new Error("ref not found");
          const commit = (await cr.json()).sha;
          const tr = await gfetch(api + "/git/trees/" + commit + "?recursive=1", "repo"); const tree = ((await tr.json()).tree) || [];
          const paths = tree.filter(function (t) { return t.type === "blob"; }).map(function (t) { return t.path; });
          const files = new Map(); paths.forEach(function (p) { files.set(p, {}); });   // all paths visible to classify
          const want = paths.filter(function (p) { return /(^|\/)package\.json$/.test(p) || /\.(html|css|js|mjs)$/i.test(p); }).slice(0, 60);
          await Promise.all(want.map(async function (p) {
            try { const raw = await gfetch("https://raw.githubusercontent.com/" + owner + "/" + rp + "/" + commit + "/" + p, "repo"); if (raw.ok) files.set(p, { text: await raw.text() }); } catch (e) {}
          }));
          _lastFetchFiles = { key: owner + "/" + rp, files: files };   // retained so the DECLARED surface (OpenAPI/exports) projects live
          return { commit: commit, files: files };
        }
        // FORGE class (ADR-0093): a lazily-loaded esbuild-wasm bundler turns a client-bundle repo (Vite/React/
        // webpack — esbuild-compatible) into ONE self-contained app. esbuild-wasm + bare deps load from a CDN
        // at BUILD time (the ingest boundary); the result is 0-network at runtime (serverless). Best-effort:
        // a repo that doesn't bundle cleanly degrades to the honest "not runnable" notice — never a fake app.
        let _esbuild = null, _esbuildInit = null;
        async function ensureEsbuild() {
          if (_esbuild) return _esbuild;
          if (!_esbuildInit) _esbuildInit = (async function () {
            const local = "/_shared/holo-forge/vendor/esbuild-wasm/";
            let eb = null, wasmModule = null, wasmURL = null;
            // LOCAL-FIRST: the vendored, content-addressed toolchain (run tools/vendor-esbuild-wasm.mjs).
            // The wasm is fetched same-origin and VERIFIED against the committed κ pin before use (Law L5) —
            // the build tool is then trusted by content, not by a CDN's authority.
            try {
              const pin = await (await fetch(local + "esbuild-wasm.pin.json", { cache: "force-cache" })).json();
              await new Promise(function (res, rej) { const s = document.createElement("script"); s.src = local + "browser.min.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
              eb = (typeof self !== "undefined" && self.esbuild) || window.esbuild;
              const bytes = await (await fetch(local + "esbuild.wasm", { cache: "force-cache" })).arrayBuffer();
              const hex = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
              if (pin.files["esbuild.wasm"] !== "did:holo:sha256:" + hex) throw new Error("esbuild.wasm κ mismatch refused (L5)");
              wasmModule = await WebAssembly.compile(bytes);
            } catch (e) { eb = null; }
            if (!eb) {   // FAIL CLOSED (G3 / Law L5): no cross-origin code in the boot/shell path.
              // The old fallback dynamic-imported esbuild-wasm from a CDN (esm.sh) — an unverified
              // foreign module that bypassed the κ-gate entirely. We refuse it. Run tools/vendor-esbuild-wasm.mjs
              // to vendor the κ-pinned toolchain locally; until then the forge degrades honestly to the
              // "not runnable" notice (caller catches), never a fake app and never unverified code.
              throw new Error("esbuild toolchain not vendored — run tools/vendor-esbuild-wasm.mjs (G3: no cross-origin code load)");
            }
            await eb.initialize(wasmModule ? { wasmModule } : { wasmURL });
            _esbuild = eb; return eb;
          })();
          return _esbuildInit;
        }
        const _resolveBare = async function (spec) { try { const r = await gfetch("https://esm.sh/" + spec + "?bundle&target=es2020", "dependency"); if (r.ok) return { contents: await r.text() }; } catch (e) {} return null; };
        async function holoBundle(args) {
          const eb = await ensureEsbuild();
          const fb = await import("/_shared/holo-forge-bundle.mjs");
          const repoMod = await import("/_shared/holo-blocks-repo.mjs");
          return fb.makeBundler({ esbuild: eb, resolveBare: _resolveBare, hash: repoMod.sha256hex })(args);
        }
        _importReady = import("/_shared/holo-import.mjs").then(async function (mod) {
          const repoMod = await import("/_shared/holo-blocks-repo.mjs");
          const mx = (await import("/_shared/q/holo-q-mux.js")).default;
          // the GOVERNED INGEST gate (Law L4): the conscience vets every outbound import fetch; the host is
          // trusted (user-initiated) but the gate still hard-blocks PII / ungranted hosts when present.
          _gov = mod.makeGovernedFetch({ conscience: function () { return (typeof window !== "undefined") ? window.HoloConscience : null; },
            fetch: function (u, i) { return fetch(u, i); }, allowUngoverned: true, hash: repoMod.sha256hex, caller: "holo-import", now: function () { return Date.now(); } });
          mod.bindImporter(mx, { fetchRepo: ghFetchRepo, hash: repoMod.sha256hex, bundle: holoBundle, onResult: function (r) { _lastImport = r; } });
          _importApi = mod; return mod;
        }).catch(function () { return null; });
        function isRepoRef(v) { v = (v || "").trim(); return !!_importApi && !!_importApi.parseRepoRef(v) && (/github\.com/i.test(v) || /^[\w.-]+\/[\w.-]+$/.test(v)); }
        // repoRefShape — a SYNTACTIC "this is a GitHub URL" check, independent of whether the engine has
        // loaded yet. Routing on this (not isRepoRef) means a pasted repo URL ALWAYS heads to import; the
        // import path then awaits _importReady, so it never silently falls through to a Build. (Bare
        // owner/repo stays engine-gated via isRepoRef — too ambiguous to route on shape alone.)
        function repoRefShape(v) { return /\bgithub\.com\/[\w.-]+\/[\w.-]+/i.test((v || "").trim()); }
        // ── holoImportAny — ONE seamless import for any input: a GitHub repo, a holo:// / did:holo κ app,
        //    or any κ-addressed object. Auto-detects, runs the SAME governed pipeline as the omnibar/Q
        //    (Law L4 ingest gate), returns { ok, html, name, kappa }. Exposed as window.HoloImportAny so the
        //    Import button, Q, and external agents all share one door (ADR-0091/0092/0093). It just works.
        async function holoImportAny(input) {
          const v = String(input || "").trim();
          if (!v) return { ok: false, reason: "paste a GitHub URL, a holo:// κ, or a did:holo app id" };
          // 1 · GITHUB REPO → fetch (governed) → classify → encode/bundle → seal → register the agent doors
          if (isRepoRef(v)) {
            if (!_importApi) return { ok: false, reason: "import engine still loading try again in a moment" };
            const sha256hex = (await import("/_shared/holo-blocks-repo.mjs")).sha256hex;
            const r = await _importApi.importRepo({ input: v, fetchRepo: ghFetchRepo, hash: sha256hex, bundle: holoBundle });
            if (!r.ok) return { ok: false, reason: r.reason || "couldn't read that repo" };
            if (!r.runnable) return { ok: false, reason: "imported, but not runnable serverless in v1 " + (r.classification ? r.classification.class + " · " : "") + (r.reason || "") };
            try { await registerLiveAgent(r); } catch (e) {}   // wire MCP + /~<id>/api doors (no reload)
            return { ok: true, html: r.html, name: (r.repo && r.repo.repo) || "app", kappa: r.app && r.app.id, receipt: r.receipt };
          }
          // 2 · κ-ADDRESSED HOLO APP / OBJECT (holo://… or did:holo:sha256:… or a bare 64-hex) → resolve (L5)
          const m = v.match(/([0-9a-f]{64})/i);
          if (/^holo:\/\//i.test(v) || /^did:holo:/i.test(v) || (m && (v.length <= 80))) {
            const hex = (m && m[1]) || "";
            if (!hex) return { ok: false, reason: "that doesn't look like a κ (need a did:holo:sha256 / holo:// address)" };
            const did = "did:holo:sha256:" + hex;
            let obj = null; try { obj = await resolveByKappa(did); } catch (e) {}
            if (obj == null) return { ok: false, reason: "couldn't resolve κ " + hex.slice(0, 12) + "… on this substrate" };
            // a string → it IS the source/bytes; an app/source object → its schema:text; any other object → a
            // self-verifying JSON view (so an OBJECT, not just an app, can be imported + inspected).
            let html, name;
            if (typeof obj === "string") { html = obj; name = "κ " + hex.slice(0, 8); }
            else if (typeof obj["schema:text"] === "string") { html = obj["schema:text"]; name = obj["schema:name"] || ("κ " + hex.slice(0, 8)); }
            else { name = (obj["schema:name"]) || ("object κ " + hex.slice(0, 8));
              html = '<!doctype html><meta charset="utf-8"><body style="margin:0;font:var(--holo-text-sm, 0.875rem)/1.6 ui-monospace,monospace;background:#0b0d12;color:#cfe3ff;padding:1.2rem;white-space:pre-wrap">' +
                JSON.stringify(obj, null, 2).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])) + "</body>"; }
            return { ok: true, html, name, kappa: did };
          }
          return { ok: false, reason: "unrecognized paste a GitHub URL (github.com/owner/repo), a holo:// κ, or a did:holo app id" };
        }
        if (typeof window !== "undefined") window.HoloImportAny = holoImportAny;   // one door for the button · Q · agents
        // LIVE AUTO-REGISTRATION (ADR-0093): build the in-page, serverless agent fabric for imported apps
        // ONCE (the node-free MCP engine + the isomorphic REST core, factories injected), expose it as
        // window.HoloImports. register(li) wires an imported app into MCP + /~<id>/api with NO reload.
        let _liveAgents = null, _liveAgentsLoading = null;
        async function ensureLiveAgents() {
          if (_liveAgents) return _liveAgents;
          if (!_liveAgentsLoading) _liveAgentsLoading = (async function () {
            const agent = await import("/_shared/holo-import-agent.mjs");
            const core = await import("/_shared/mcp/holo-mcp-core.mjs");
            const api = await import("/_shared/api/holo-api-core.mjs");
            const repoMod = await import("/_shared/holo-blocks-repo.mjs");
            const impMod = await import("/_shared/holo-import.mjs");
            const conscMod = await import("/_shared/holo-conscience.js").catch(function () { return null; });
            // GOVERNED-EGRESS authority (ADR-0093): a declared API tool is CALLABLE only through this gate.
            // DEFAULT-DENY per host — an imported app's egress is EXPOSED but not authorized until the user
            // grants the host (window.HoloImportGrants, empty by default) — exposure ≠ authorization. A
            // red-line PII request is hard-blocked regardless (the real conscience patterns).
            if (typeof window !== "undefined" && !window.HoloImportGrants) window.HoloImportGrants = new Set();
            const egressGov = impMod.makeGovernedFetch({
              conscience: function () { return { evaluateText: function (text, o) {
                if (conscMod && conscMod.scanPii && conscMod.scanPii(text).length) return { outcome: "block", blocked: ["P5"], reason: "PII red-line" };
                const host = (o && o.decision && o.decision.host) || "";
                return (window.HoloImportGrants && window.HoloImportGrants.has(host)) ? { outcome: "accept" } : { outcome: "block", blocked: ["P4"], reason: "egress to " + host + " not granted (window.HoloImportGrants)" };
              } }; },
              fetch: function (u, i) { return fetch(u, i); }, allowUngoverned: false, hash: repoMod.sha256hex, caller: "holo-import-egress", now: function () { return Date.now(); },
            });
            _liveAgents = agent.createLiveRegistry({ makeServer: core.makeServer, makeApiServer: api.makeApiServer, hash: repoMod.sha256hex, governedFetch: egressGov });
            if (typeof window !== "undefined") window.HoloImports = _liveAgents;
            return _liveAgents;
          })();
          return _liveAgentsLoading;
        }
        async function registerLiveAgent(li) {
          try {
            const key = li && li.repo ? (li.repo.owner + "/" + li.repo.repo) : null;   // project the DECLARED surface from the just-fetched files
            const files = (_lastFetchFiles && _lastFetchFiles.key === key) ? _lastFetchFiles.files : null;
            const surf = (await ensureLiveAgents()).register(li, files);
            if (surf) await publishImportToSW(surf);   // ← make it reachable by an EXTERNAL agent over /~<id>/mcp + /~<id>/api (serverless, via the SW)
            return surf;
          } catch (e) { return null; }
        }
        // publishAgent() — make THIS published holospace instantly reachable by agents (MCP /~<id>/mcp) and
        // by other apps (the unified REST API /~<id>/api — gated, metered, monetizable by the creator via the
        // HTTP 402 + spend-ledger in holo-api-core). Lives on the studio so closeCreate (a separate scope) can
        // fire it on Publish; reuses the SAME bridge imports ride (ADR-0093). Synthetic import record →
        // baseline surface (resolve · verify · describe + the app's own κ); declared OpenAPI tools project in
        // when the source carries a spec. Serverless, no reload.
        { const _st = studio;   // capture THIS studio — closeCreate nulls the module `studio` var before firing this
          _st.publishAgent = function () {
            if (!_st.lastSavedK || !_st.ta) return Promise.resolve(null);
            const k = _st.lastSavedK, nm = (_st.node && _st.node.name) || "app";
            const li = { runnable: true, app: { id: k }, html: _st.ta.value,
              repo: { repo: String(nm), owner: "you", url: "holo://" + String(k).split(":").pop() } };
            return registerLiveAgent(li);   // in scope here (inside openCreate); files:null ⇒ baseline surface
          }; }
        // publish the imported app's manifest + self-verifying κ-objects into the SW imports cache, so the
        // Service Worker answers /~<id>/mcp + /~<id>/api for it with NO origin server (ADR-0093 transport bridge).
        async function publishImportToSW(surf) {
          try {
            if (typeof caches === "undefined" || typeof navigator === "undefined" || !navigator.serviceWorker) return false;
            const reg = await navigator.serviceWorker.ready; if (!reg) return false;
            const base = new URL(reg.scope).pathname;
            const agent = await import("/_shared/holo-import-agent.mjs");
            const c = await caches.open(agent.SW_IMPORTS_CACHE);
            await Promise.all(agent.swCacheEntries(surf, { base }).map(function (e) {
              return c.put(e.url, new Response(e.body, { headers: { "content-type": e.contentType, "access-control-allow-origin": "*" } }));
            }));
            return true;
          } catch (e) { return false; }
        }
        async function holoImport(input, m) {
          const myGen = ++studio.gen; setBusy(true); const stale = function () { return myGen !== studio.gen; };   // busy-locked + cancelable, same spine as holoBuild
          if (!_importApi && _importReady) { if (m) m.innerHTML = 'Preparing the import engine…'; try { await _importReady; } catch (e) {} }   // never build-by-accident: wait for the engine, with an honest line
          if (stale()) return;
          if (!_importApi) { if (m) m.innerHTML = 'The import engine could not load — try again in a moment, or use the <b style="font-style:normal">↓ Import</b> button.'; setBusy(false); return; }
          const ref = _importApi && _importApi.parseRepoRef(input); const label = ref ? (ref.owner + "/" + ref.repo) : input;
          if (m) m.innerHTML = 'Importing <b style="font-style:normal">' + csEsc(label) + '</b> from GitHub…';
          const Q = (typeof window !== "undefined") ? window.Q : null;
          if (!Q || typeof Q.create !== "function") { if (m) m.innerHTML = 'Import needs the Q surface not available here.'; setBusy(false); return; }
          _lastImport = null;
          const _onPartial = function (partial) { if (!stale() && partial && studio.applyLive) studio.applyLive(partial); };
          try {
            const res = await Q.create(input, { id: "import:" + label, task: "import", onPartial: _onPartial });
            if (stale()) return;                                          // canceled or superseded → drop it
            if (!res || !res.value) { if (m) m.innerHTML = 'Nothing came back for <b style="font-style:normal">' + csEsc(label) + '</b>.'; return; }
            (studio.applyLive ? studio.applyLive(res.value) : render(res.value)); studio.curSrc = res.value; studio.iterations = (studio.iterations || 0) + 1;
            recordVersion(studio.lastSavedK, res.value, "import");
            try { window.HoloJourney && window.HoloJourney.mark("first-import"); } catch (e) {}   // Q Companion: the web became yours, on your terms
            const li = _lastImport;
            if (li && li.runnable) {
              const obj = repo.publishSource({ name: (ref && ref.repo) || "app", source: res.value }); studio.lastSavedK = obj.id; setUrl(obj.id);
              const surf = await registerLiveAgent(li);   // ← LIVE: now answerable over MCP + /~<id>/api, no reload (ADR-0093)
              const o1 = res.cached && res.cached !== false;
              const tag = o1 ? (res.cached + " · O(1) κ-memo") : (li.classification.class + (li.selfContained ? "" : ' · <span style="color:#f59e0b">' + li.externalRefs.length + ' external ref' + (li.externalRefs.length === 1 ? '' : 's') + '</span>'));
              const nTools = surf && surf.declared && surf.declared.tools ? surf.declared.tools.length : 0;
              const agentTag = surf ? ' · <span style="color:#7c5cff" title="Live for agents over MCP + /~' + csEsc(surf.appId) + '/api' + (nTools ? ' · ' + nTools + ' declared ' + surf.declared.kind + ' tool' + (nTools === 1 ? '' : 's') : '') + '">⚡ agent-ready' + (nTools ? ' · ' + nTools + ' API tool' + (nTools === 1 ? '' : 's') : '') + '</span>' : '';
              if (m) m.innerHTML = 'Imported <b style="font-style:normal">' + csEsc(label) + '</b> <span class="k">' + urlEl.textContent + '</span> · <span style="color:#34d399">' + tag + '</span>' + agentTag + ' · ' + res.ms + 'ms ✦';
            } else if (li) {
              if (m) m.innerHTML = 'Imported <b style="font-style:normal">' + csEsc(label) + '</b>, but <span style="color:#f59e0b">not runnable serverless in v1</span> ' + csEsc(li.classification.class) + '. ' + csEsc(String(li.reason || "").split("")[0].trim());
            } else if (m) m.innerHTML = 'Imported <b style="font-style:normal">' + csEsc(label) + '</b> ✦';
          } catch (e) { if (!stale() && m) m.innerHTML = 'Couldn\'t import that — ' + csEsc(String((e && e.message) || e)) + '. <span style="color:#8b8b92">Check the link, or try the ↓ Import button.</span>'; }
          finally { if (!stale()) setBusy(false); }
        }

        // holoBuild(prompt, m) — the ONE verb: route the build through window.HoloTrinity.create (ADR-0087).
        // It rides the κ-memo (a repeat prompt is O(1), no re-generation), streams partials into the live
        // preview, and auto-perceives both faces with a real rebuild thunk (so the self-improvement loop can
        // heal it). The instant template floor paints first so the screen is never blank.
        async function holoBuild(prompt, m) {
          const myGen = ++studio.gen; setBusy(true); const stale = function () { return myGen !== studio.gen; };   // this run owns the studio until it ends or is superseded
          const floor = buildHolospaceHTML(prompt);
          (studio.applyLive ? studio.applyLive(floor) : render(floor)); studio.curSrc = floor;
          if (m) m.innerHTML = _csTplMsg(prompt);
          { const _sg = $$("cs-suggest"); if (_sg) _sg.style.display = "flex"; }
          // the ONE door: window.Q (the unified surface, ADR-0091) when present, the trinity as the floor.
          const Q = (typeof window !== "undefined") ? (window.Q || window.HoloTrinity) : null;
          if (!Q || typeof Q.create !== "function") { setBusy(false); return; }   // no Q surface → the polished template stands
          const editing = (studio.iterations || 0) > 0;
          const _id = "create:" + ((node && node.id) || "app");
          const _params = { editing: editing, current: editing ? studio.curSrc : null };
          // iterate-with-memory (M2): on a REFINE, ground the change in this build's own context via Q.recall.
          // Best-effort + honest: any miss falls straight through, so the working path is never broken.
          if (editing && Q && typeof Q.recall === "function") {
            try { const rc = await Q.recall(prompt, { synthesize: false }); if (rc && rc.ok && (rc.answer || (rc.chunks && rc.chunks.length))) _params.recall = { answer: rc.answer || null, cited: (rc.chunks || []).length }; } catch (e) {}
            if (stale()) return;
          }
          let deltas = 0;
          const _onPartial = function (partial, e) {
            if (stale() || !partial) return; deltas++;
            if (deltas >= 2 && e && e.cached === false && m) m.innerHTML = 'Generating with <span style="color:#7c5cff">' + (studio._lastTier && /boost/i.test(studio._lastTier) ? 'boosted model' : csEsc(codeTierLabel())) + '</span>… <span style="color:#8b8b92">press ■ to stop</span>';
            (studio.applyLive ? studio.applyLive(partial) : render(partial));
          };
          if (m && !editing) m.innerHTML = _csTplMsg(prompt) + ' <span style="color:#8b8b92">· waking the on-device model (first build loads it once)</span>';   // honest warm-up: the instant template is on screen, never a dead wait
          try {
            let res = null;
            // prefer the COMPOUND model on a refine (Q.fuse, ADR-0098) — higher quality where it matters most.
            // Honest + safe: an unready panel returns a notice (no value) → we fall straight back to Q.create.
            if (editing && Q && typeof Q.fuse === "function") {
              try { const f = await Q.fuse(prompt, { id: _id, params: _params, onPartial: _onPartial });
                if (!stale() && f && f.value) { res = f; studio._lastTier = "compound · fuse"; } } catch (e) {}
              if (stale()) return;
            }
            if (!res) res = window.Q
              ? await window.Q.create(prompt, { id: _id, params: _params, onPartial: _onPartial })
              : await Q.create({ id: _id, task: "create", input: prompt, render: false, params: _params, onPartial: _onPartial });
            if (stale()) return;                                          // canceled or superseded → drop the result, keep what is on screen
            if (res && res.value) {
              (studio.applyLive ? studio.applyLive(res.value) : render(res.value)); studio.curSrc = res.value; studio.iterations = (studio.iterations || 0) + 1;
              recordVersion(studio.lastSavedK, res.value, editing ? "refine" : "build");
              try { window.HoloJourney && window.HoloJourney.mark("first-creation"); } catch (e) {}   // Q Companion: you authored something → Q invites you to verify it
              const o1 = res.cached && res.cached !== false;
              const tier = o1 ? (res.cached + " · O(1) κ-memo") : (studio._lastTier || "template");
              if (m) m.innerHTML = (editing ? 'Refined' : 'Built') + ' <b style="font-style:normal">' + csEsc(prompt) + '</b> <span class="k">' + urlEl.textContent + '</span> · <span style="color:#34d399">' + tier + '</span> · ' + res.ms + 'ms ✦';
            }
          } catch (e) { if (!stale() && m) m.innerHTML = _csTplMsg(prompt); }   // any failure → the instant template floor stands
          finally { if (!stale()) setBusy(false); }                          // release the lock only if we are still the current run
        }
        // ── responsiveness spine: the heavy compute already runs off the main thread (the model's ORT and
        //    esbuild each in a Web Worker), but a build/import still needs to be BUSY-LOCKED (never stack two
        //    runs — that is what OOM'd a constrained tab), CANCELABLE, and honest about model warm-up. A
        //    generation token does this without touching the brain: a Stop (or a newer run) bumps `studio.gen`,
        //    so the in-flight run's partials/result are dropped and the studio frees instantly. ──
        studio.gen = 0; studio.busy = false;
        function setBusy(on) {
          studio.busy = !!on;
          const btn = $$("cs-send"); if (btn) { btn.classList.toggle("busy", !!on); btn.textContent = on ? "■" : "↑"; btn.title = on ? "Stop" : "Send"; btn.setAttribute("aria-label", on ? "Stop" : "Send"); }
          if (ask) ask.setAttribute("aria-busy", on ? "true" : "false");
        }
        function cancelJob() {
          if (!studio.busy) return;
          studio.gen++;                                   // invalidate the in-flight run → its output is ignored
          setBusy(false);
          addMsg("assistant", 'Stopped. <span style="color:#8b8b92">Kept what is on screen the studio is yours again.</span>');   // every shown state is a real sealed κ, so it is safe to keep
        }
        // ── element chat-context (M1 stretch): "✦ Ask AI" on an element (in Select mode) pipes it up here.
        //    We show a context chip on the composer and scope the NEXT natural-language prompt to that exact
        //    element — "make this blue" targets it. The change round-trips through the agent (replace-element),
        //    which swaps the live node + reseals, so it stays in sync and Publish captures it. ──
        studio.selection = null;
        studio.setSelection = function (sel) { studio.selection = sel; renderSelChip(); try { ask.focus(); } catch (e) {} };
        function renderSelChip() {
          let chip = ov.querySelector("#cs-selchip");
          if (!studio.selection) { if (chip) chip.remove(); return; }
          const s = studio.selection;
          if (!chip) { chip = document.createElement("div"); chip.id = "cs-selchip"; chip.className = "cs-selchip";
            const comp = ov.querySelector(".cs-composer"); comp.insertBefore(chip, comp.firstChild); }
          chip.innerHTML = '<span class="cs-selchip-tag">✦ &lt;' + csEsc(s.tag) + '&gt;</span>' +
            (s.brief ? '<span class="cs-selchip-brief">' + csEsc(s.brief) + '</span>' : '') +
            '<span class="cs-selchip-x" title="Clear selection">✕</span>';
          chip.querySelector(".cs-selchip-x").onclick = function () { studio.selection = null; renderSelChip(); };
        }
        async function holoElementEdit(instruction, sel, m) {
          const myGen = ++studio.gen; setBusy(true); const stale = function () { return myGen !== studio.gen; };
          try {
            const Q = (typeof window !== "undefined") ? (window.Q || window.HoloTrinity) : null;
            if (!Q || typeof Q.create !== "function") { if (m) m.innerHTML = "Element edit needs the Q surface."; return; }
            const prompt = 'Rewrite ONLY this HTML element to apply the change: "' + instruction + '".\nElement:\n' + sel.html + '\nReturn ONLY the modified element HTML — no markdown fences, no explanation, no surrounding document.';
            const res = await Q.create(prompt, { id: "el:" + ((node && node.id) || "app"), params: { elementEdit: true, element: sel.html, instruction: instruction } });
            if (stale()) return;
            let out = res && res.value ? String(res.value).trim() : "";
            out = out.replace(/^```[a-z]*\s*/i, "").replace(/\s*```\s*$/i, "").trim();   // strip a code fence if the model added one
            if (!out) { if (m) m.innerHTML = 'Nothing came back. <span style="color:#8b8b92">Try rephrasing.</span>'; return; }
            const el = mounted.get(node.id); const f = el && el.querySelector("iframe");   // hand the new element DOWN → agent swaps it + reseals → syncFromSurface mirrors it back
            if (f && f.contentWindow) f.contentWindow.postMessage({ t: "holo-live-edit", op: "replace-element", surfaceId: node.id, html: out }, "*");
            studio.selection = null; renderSelChip();
            if (m) m.innerHTML = 'Changed the <b style="font-style:normal">&lt;' + csEsc(sel.tag) + '&gt;</b> ✦';
          } catch (e) { if (!stale() && m) m.innerHTML = "Edit error: " + csEsc(String((e && e.message) || e)); }
          finally { if (!stale()) setBusy(false); }
        }
        function send() {
          if (studio.busy) return;                        // a run is in flight — the ■ Stop control is the only action until it ends
          const v = ask.value.trim(); if (!v) return; ask.value = ""; ask.style.height = "auto"; addMsg("user", csEsc(v));
          if (studio.editable && /<\/?[a-z!][\s\S]*>/i.test(v)) { studio.applyLive(v); recordVersion(studio.lastSavedK, v, "paste"); view("pv"); setTimeout(function () { addMsg("assistant", 'Rendered your changes ✓ <span class="k">' + urlEl.textContent + "</span>"); }, 60); }
          else if (studio.editable && (repoRefShape(v) || isRepoRef(v))) {   // a GitHub URL → IMPORT the repo as a Holo app (ADR-0092); route on shape so a paste never silently builds
            view("pv");
            const m = addMsg("assistant", 'Importing <b style="font-style:normal">' + csEsc(v) + '</b>…');
            holoImport(v, m).catch(function (e) { m.innerHTML = 'Couldn\'t import that — ' + csEsc(String((e && e.message) || e)) + '. <span style="color:#8b8b92">Check the link, or try the ↓ Import button.</span>'; });
          }
          else if (studio.editable && studio.selection) {   // a selection is active → scope the change to THAT element ("make this blue")
            view("pv");
            const sel = studio.selection;
            const m = addMsg("assistant", 'Changing the <b style="font-style:normal">&lt;' + csEsc(sel.tag) + '&gt;</b> — ' + csEsc(v) + '…');
            holoElementEdit(v, sel, m).catch(function (e) { m.innerHTML = 'Edit error: ' + csEsc(String((e && e.message) || e)); });
          }
          else if (studio.editable) {   // a natural-language prompt → build/refine a holospace in real time
            view("pv");
            const m = addMsg("assistant", 'Building <b style="font-style:normal">' + csEsc(v) + '</b>…');
            holoBuild(v, m).catch(function (e) { m.innerHTML = 'Build error: ' + csEsc(String((e && e.message) || e)); });
          }
          else if (studio.editable) setTimeout(function () { addMsg("assistant", 'I render any HTML/CSS/JS you send instantly paste a snippet and watch it go live, or switch to <b style="font-style:normal">Dev</b> to inspect. Each change is content-addressed.'); }, 120);
          else setTimeout(function () { addMsg("assistant", "This page is mirrored from an external source there's nothing to edit locally. Open it with ↗, or create a fresh holospace from Home."); }, 120);
        }
        $$("cs-send").onclick = function () { if (studio.busy) cancelJob(); else send(); };   // the one composer button: Send when idle, Stop while a run is in flight
        ask.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!studio.busy) send(); } });
        ask.addEventListener("input", function () { ask.style.height = "auto"; ask.style.height = Math.min(170, ask.scrollHeight) + "px"; });
        // ── chrome actions ──
        $$("cs-refresh").onclick = function () { const f = fa.classList.contains("on") ? fa : fb; if (r.mirror.url) f.src = f.src; else { studio.lastK = null; render(studio.applyLive ? ta.value : r.src); } toast("↻ reloaded"); };
        $$("cs-ext").onclick = function () { const u = r.mirror.url || linkFor(studio.lastSavedK); if (u) window.open(u, "_blank", "noopener"); };
        $$("cs-done").onclick = function () { closeCreate(true, true); };   // Publish → seal the dev tab to its κ holo app
        // ── Import (left of Publish): paste a GitHub URL · holo:// κ · did:holo app/object id → it loads
        //    LIVE into the studio (preview + editable source), ready to remix or Publish. Seamless: one
        //    field, Enter, done — auto-detects + runs the governed pipeline via window.HoloImportAny. ──
        function csImport() {
          const host = ov.querySelector(".cs-preview"); if (!host || host.querySelector(".cs-importbar")) { const ex = host && host.querySelector("#cs-imp-in"); if (ex) ex.focus(); return; }
          const bar = document.createElement("div"); bar.className = "cs-importbar";
          bar.innerHTML = '<input id="cs-imp-in" autocomplete="off" spellcheck="false" placeholder="Paste a GitHub or holo link - Enter to import" />' +
            '<button id="cs-imp-go">Import</button><span class="st" id="cs-imp-st"></span>';
          host.appendChild(bar);
          const inp = bar.querySelector("#cs-imp-in"), go = bar.querySelector("#cs-imp-go"), st = bar.querySelector("#cs-imp-st");
          inp.focus();
          const close = function () { try { bar.remove(); } catch (e) {} };
          // seed from the clipboard if it already holds a link/κ (zero-friction "it just works")
          try { navigator.clipboard && navigator.clipboard.readText && navigator.clipboard.readText().then(function (t) { t = (t || "").trim(); if (!inp.value && (/github\.com|^holo:\/\/|^did:holo:|^[\w.-]+\/[\w.-]+$/i.test(t))) { inp.value = t; inp.select(); } }).catch(function () {}); } catch (e) {}
          const run = async function () {
            const v = (inp.value || "").trim(); if (!v) return;
            st.textContent = "importing…"; go.disabled = true; inp.disabled = true;
            try {
              const out = await window.HoloImportAny(v);
              if (!out || !out.ok) { st.textContent = (out && out.reason) || "couldn't import"; go.disabled = false; inp.disabled = false; return; }
              if (studio.applyLive) studio.applyLive(out.html); else if (studio.setCode) { studio.setCode(out.html); render(out.html); } else render(out.html);
              if (studio.node && out.name) { studio.node.name = out.name; }
              view("code");   // reveal the imported source (editable) — remix-ready
              toast("✦ imported · " + (out.name || "app") + (out.kappa ? "  ·  " + linkFor(out.kappa) : ""));
              if (typeof addMsg === "function") addMsg("assistant", "Imported <b>" + esc(out.name || "app") + "</b> as one self-verifying, serverless holospace" + (out.kappa ? " <code>" + esc(linkFor(out.kappa)) + "</code>" : "") + ". Edit it here, then Publish to seal your remix. ✦");
              close();
            } catch (e) { st.textContent = "couldn't import — " + ((e && e.message) || e); go.disabled = false; inp.disabled = false; }
          };
          go.onclick = run;
          inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); run(); } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } });   // Esc dismisses ONLY the import bar — stop it bubbling to the studio-level Esc (which would close all of Create)
        }
        $$("cs-import").onclick = csImport;
        // ── Select & edit (point-and-edit): arm Holo Playground on the PREVIEW SURFACE ONLY (a targeted
        //    message, not the global desktop mode), so clicking any element in the full-tab preview lets you
        //    edit it live — by its right-click menu (edit source/text · duplicate · hide · delete). Each edit
        //    re-renders the surface AND mirrors back into the studio (syncFromSurface) so Publish captures it. ──
        function armSelect(on) {
          try { const el = mounted.get(node.id); const f = el && el.querySelector("iframe");
            if (f && f.contentWindow) f.contentWindow.postMessage({ t: "holo-live-edit", op: "playground-mode", surfaceId: node.id, on: !!on }, "*"); } catch (e) {}
        }
        { const selBtn = $$("cs-select");
          if (selBtn) selBtn.addEventListener("click", function () {
            studio.selectMode = !studio.selectMode;
            selBtn.classList.toggle("on", studio.selectMode); selBtn.setAttribute("aria-pressed", studio.selectMode ? "true" : "false");
            armSelect(studio.selectMode);
            toast(studio.selectMode ? "⊹ Select on — click any element in the preview to edit it" : "Select off");
          }); }
        $$("cs-sug-x").onclick = function () { $$("cs-suggest").remove(); };
        $$("cs-sug-go").onclick = async function () {
          // REAL review through the one Q door (window.Q.ask), grounded on THIS holospace's source — not a
          // canned line. Mirrors the Q.ask pattern used by the Q chat panel. Falls back to the static line
          // ONLY when no Q surface is present (honest degradation, never a fabricated "review").
          const m = addMsg("assistant", "Reviewing your holospace…");
          const Q = (typeof window !== "undefined") ? window.Q : null;
          const src = (studio && (studio.curSrc || studio.lastSrc)) || "";
          const FALLBACK = "Your holospace is one self-contained, content-addressed object (holo://…) it loads instantly, runs serverless, and any guest can open it with no sign-in. Solid foundation. ✦";
          if (Q && typeof Q.ask === "function") {
            let ans = null;
            try { ans = await Q.ask("Review this holospace and suggest one concrete improvement. Be brief and specific.", { context: { source: String(src).slice(0, 4000) } }); } catch (e) {}
            m.innerHTML = (ans && String(ans).trim()) ? (csEsc(String(ans).trim()) + " ✦") : FALLBACK;
          } else { m.innerHTML = FALLBACK; }
        };
        ov.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); closeCreate(true); } });
        // ── the lift: FLIP the live window into the preview pane (content-continuous) ──
        const fromRect = r.winEl ? r.winEl.getBoundingClientRect() : null;
        if (fromRect) { const pr = stage.getBoundingClientRect();
          const sx = Math.max(.04, fromRect.width / pr.width), sy = Math.max(.04, fromRect.height / pr.height);
          stage.style.transform = "translate(" + (fromRect.left - pr.left) + "px," + (fromRect.top - pr.top) + "px) scale(" + sx + "," + sy + ")"; }
        // content-continuous: begin the lift only once the preview has PAINTED the source (no blank
        // flash) — the holospace visibly morphs into the preview pane, one seamless motion. Capped so a
        // heavy/cross-origin mirror never stalls the transition. (Done's reverse is its exact inverse.)
        let _lift = false;
        const go = function () { if (_lift) return; _lift = true; ov.classList.add("on"); stage.style.transform = ""; };
        const front = fa.classList.contains("on") ? fa : fb;
        let painted = false; try { painted = !!(front.contentDocument && front.contentDocument.readyState === "complete"); } catch (e) {}
        if (painted) requestAnimationFrame(function () { requestAnimationFrame(go); });
        else { try { front.addEventListener("load", function () { requestAnimationFrame(go); }, { once: true }); } catch (e) {} }
        setTimeout(go, 240);   // fallback + cap for an already-painted or heavy mirror
        setTimeout(function () { ask.focus(); }, 360);
      }
      function closeCreate(apply, publish) {
        if (!studio) return; const s = studio; studio = null;
        document.body.classList.remove("cs-active");   // leaving Create mode → desktop Privacy shield may return
        // disarm point-and-edit on the surface so the preview never lingers in Select mode after Create closes
        try { if (s.selectMode && s.node) { const el = mounted.get(s.node.id); const f = el && el.querySelector("iframe");
          f && f.contentWindow && f.contentWindow.postMessage({ t: "holo-live-edit", op: "playground-mode", surfaceId: s.node.id, on: false }, "*"); } } catch (e) {}
        (function reflow() { let n = 0; const t = setInterval(function () { try { dispatchEvent(new Event("resize")); } catch (e) {} if (++n >= 8) clearInterval(t); }, 45); })();
        try { if (apply && s.editable && s.node && s.ta) applyEdit(s.node.id, s.ta.value); } catch (e) { console.warn("create: apply", e); }
        // reverse lift — settle the preview back onto its desktop window
        const to = s.winEl ? s.winEl.getBoundingClientRect() : null;
        if (to && s.stage) { const pr = s.stage.getBoundingClientRect();
          const sx = Math.max(.04, to.width / pr.width), sy = Math.max(.04, to.height / pr.height);
          s.stage.style.transform = "translate(" + (to.left - pr.left) + "px," + (to.top - pr.top) + "px) scale(" + sx + "," + sy + ")"; }
        s.ov.classList.remove("on"); syncDockWidth();   // release the dock squeeze → the desktop reflows back to full width
        setTimeout(function () { try { s.ov.remove(); } catch (e) {} }, 520);
        if (apply && s.editable && s.lastSavedK) {
          if (publish) publishDevTab(s.lastSavedK);   // Publish seals the dev tab → an isolated κ holo app (drops the dev cue + forced wallpaper, adopts the κ address)
          toast((publish ? "✦ published · holo://" : "✦ saved · holo://") + String(s.lastSavedK).split(":").pop().slice(0, 12) + "…");
          // every published app auto-joins the agent fabric: MCP for agents + the unified REST API for
          // gated, metered, monetizable cross-app calls (ADR-0093). The action lives on the studio (where
          // registerLiveAgent is in scope). Non-blocking — the κ is already committed.
          try { if (s.publishAgent) s.publishAgent()
            .then(function (surf) { if (surf && surf.appId) toast("⚡ agent-ready · MCP + REST API live at /~" + surf.appId + "/"); })
            .catch(function () {}); } catch (e) {}
          // FULL-STACK SEAL (additive · never-throws): also seal the build as a conformant holo-apps app — a
          // manifest κ over the reducer + projection, with a capability-derived REST/MCP descriptor (Stages
          // A–G). The existing κ + agent fabric above are untouched. Exposes window.__holoApp and surfaces the
          // app's holo:// κ; a SPEC-emitting coder upgrades this to a full UI+data+auth app via buildFullStackApp.
          try {
            if (publish && s.ta) {
              // seal + surface the holo-app κ. The full-stack module is lazy-loaded (4477); if Publish fires
              // before that import resolves, load it ON DEMAND here so the "✦ holo-app · holo://…" link ALWAYS
              // appears (the bug was: a quick Publish skipped this whole block when HoloCreateApp wasn't ready).
              var __seal = function (M) {
                try {
                  var __fs = M.sealBuiltApp(s.ta.value, { name: (s.node && s.node.name) || "app" });
                  window.__holoApp = __fs; try { window.__holoCodeExplorer && window.__holoCodeExplorer.refresh(); } catch (e) {}
                  // κ-LENS ready (ADR-0095 A6): expose the build's κ-object tree so DevTools (the κ panel / the
                  // Console / the Claude extension) can inspect+govern every κ-object with zero manual setup. Set
                  // it shell-side AND on the built app's same-origin frame, so inspectedWindow.eval(__holoLens())
                  // reaches it whether Dev inspects the holospace or the shell. Never throws into publish.
                  try { if (window.HoloLens) {
                    window.HoloLens.expose(__fs);
                    var __el = s.node && mounted.get(s.node.id), __f = __el && __el.querySelector("iframe");
                    if (__f && __f.contentWindow) { try { __f.contentWindow.__holoLens = function () { return window.HoloLens.of(__fs); }; } catch (e) {} }
                  } } catch (e) {}
                  toast("✦ holo-app · " + __fs.share);
                } catch (e) {}
              };
              if (window.HoloCreateApp) __seal(window.HoloCreateApp);
              else import("/_shared/q/holo-q-create-fullstack.mjs").then(function (M) { window.HoloCreateApp = M; __seal(M); }).catch(function () {});
            }
          } catch (e) {}
        }
      }
      $("#verb-build").onclick = function () { if (studio) closeCreate(true); else openCreate(); };   // the verb toggles the carriage (consistent with Play / Share)
      try { registerAsideCloser(function () { if (studio) closeCreate(true); }); } catch (e) {}   // Play/Share opening closes Create (one carriage at a time)
      // Play → an immersive BROWSE RAIL in the SHARED right side-carriage (ADR-0109): category chips + a
      // golden-ratio list of holospaces (thumbnail · title · concise description). Picking one launches it
      // LIVE in the main holospace to the left, while the rail stays open to browse on. Same carriage as
      // Create · Share; the rail reads the served app catalogue itself.
      // lazyVerb — keep a carriage's bundle off the boot path. Prewarm on hover/focus so the click is
      // instant; a click before the warm completes mounts-then-opens (re-dispatch). Idempotent; fail-soft.
      const lazyVerb = (btn, load) => {
        if (!btn) return;
        let mounted = false, p = null;
        const ensure = () => (p = p || Promise.resolve(load()).then(() => { mounted = true; }).catch((e) => { p = null; console.warn("holo-verb lazy:", e); }));
        btn.addEventListener("pointerenter", ensure, { passive: true });
        btn.addEventListener("focus", ensure);
        // a click before the bundle has MOUNTED (cold tap, or a tap that beat the hover-prewarm) mounts then
        // re-dispatches so the carriage opens; once mounted, the verb's own handler owns the click.
        btn.addEventListener("click", () => { if (mounted) return; ensure().then(() => { if (mounted) btn.click(); }); });
      };
      // ── Play → a two-pane browse studio (like Create): the honeycomb fills a fresh tab on the LEFT, a
      //    golden rail on the RIGHT drives it (categories · search · voice) and inspects the touched app.
      //    Widgets hidden (cs-active). One carriage at a time. The rail owns the controls; the map stays clean.
      var playRail = null, playFrame = null;
      var plEsc = function (x) { return String(x == null ? "" : x).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); };
      function playHoneyMap() { try { if (!playFrame || !playFrame.isConnected) { var fr = [].slice.call(document.querySelectorAll("#world iframe")).filter(function (f) { return /apps\/spaces/.test(f.getAttribute("src") || f.src || ""); }); playFrame = fr[fr.length - 1] || null; } return playFrame && playFrame.contentWindow && playFrame.contentWindow.HoloSpacesMap; } catch (e) { return null; } }
      // ── LIVE preview: the cover becomes a real WINDOW INTO THE RUNNING APP — the very κ-projection the
      //    hex-dive mounts (/holospace.html?app=κ), at full device-pixel resolution, so an app that streams
      //    charts · changing data · video renders LIVE and HD inside the rail. Lazy (a short dwell so arrowing
      //    through doesn't thrash) · one instance at a time · view-only (clicks fall through to Open). Heavy
      //    apps (VMs · emulators · miners) keep the static cover — we don't boot a machine just to peek.
      var playLive = { token: 0, frame: null };
      function clearLivePreview() { playLive.token++; if (playLive.frame) { try { playLive.frame.remove(); } catch (e) {} playLive.frame = null; } }
      function heavyPreview(m) { var s = ((m && m.appId || "") + " " + (m && m.name || "")).toLowerCase(); return /v86|qemu|x86|linux|\bvm\b|miner|emulator/.test(s); }
      function mountLivePreview(vis, m) {
        if (!vis || !m || !m.kappa || heavyPreview(m)) return;
        var my = ++playLive.token;
        setTimeout(function () {
          if (my !== playLive.token || !vis.isConnected) return;     // selection moved on → abort this mount
          var f = document.createElement("iframe"); f.className = "pl-live"; f.setAttribute("tabindex", "-1"); f.setAttribute("aria-hidden", "true"); f.setAttribute("scrolling", "no");
          f.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-forms allow-modals allow-pointer-lock allow-downloads");
          f.setAttribute("allow", "fullscreen; clipboard-write");
          f.src = "/holospace.html?app=" + m.kappa + "&bare=1";   // the same projection the dive mounts → the real, running app (WebGPU where the app uses it)
          f.addEventListener("load", function () { if (my === playLive.token) { f.classList.add("on"); vis.classList.add("live"); } });
          vis.appendChild(f); playLive.frame = f;
        }, 360);
      }
      function playRailHTML() {
        return '<div class="pl-rail">' +
          '<div class="pl-head"><div class="pl-title">Play</div><button class="pl-collapse" id="pl-collapse" title="Close" aria-label="Close">»</button></div>' +
          '<div class="pl-srow"><input id="pl-search" placeholder="Search apps…" autocomplete="off" spellcheck="false"><button id="pl-mic" class="pl-mic" title="Voice">🎙</button></div>' +
          '<div class="pl-cats" id="pl-cats"></div>' +
          '<div class="pl-card" id="pl-card"></div>' +
        '</div>';
      }
      function renderPlayCard(m) {
        if (!playRail) return; var card = playRail.querySelector("#pl-card"); if (!card) return;
        clearLivePreview();   // tear down any prior live window before re-rendering the card
        if (!m) { card.innerHTML = '<div class="pl-empty"><div class="pl-empty-i">⬡</div><div>Touch a hexagon to preview it.</div></div>'; return; }
        var hue = (m.hue == null ? 200 : m.hue);
        try { playRail.style.setProperty("--h", hue); } catch (e) {}   // bloom the rail glass in the selected app's hue
        card.innerHTML =
          '<div class="pl-vis" style="--h:' + hue + '">' + (m.icon ? '<img src="' + plEsc(m.icon) + '" alt="">' : "") + '<span class="pl-badge">LIVE</span></div>' +
          '<div class="pl-name">' + plEsc(m.name || "App") + '</div>' +
          '<div class="pl-cat">' + plEsc(m.cat || "App") + '</div>' +
          (m.desc ? '<div class="pl-desc">' + plEsc(m.desc) + '</div>' : "") +
          '<button class="pl-open" id="pl-open">Open</button>' +
          '<div class="pl-meta"><span>by Hologram</span><span class="pl-k" id="pl-k" title="Copy link">holo://' + plEsc(String(m.kappa || "").split(":").pop().slice(0, 8)) + '…</span></div>' +
          '<div class="pl-rev"><div class="pl-rev-h">Reviews</div><div class="pl-rev-e">No reviews yet.</div></div>';
        var ob = card.querySelector("#pl-open"); if (ob) ob.onclick = function () { if (m.appId) openHolospaceApp(m.appId, "", m.name); };
        var kb = card.querySelector("#pl-k"); if (kb) kb.onclick = function () { try { navigator.clipboard.writeText(m.kappa || ""); toast("κ copied"); } catch (e) {} };
        var vis = card.querySelector(".pl-vis"); if (vis) { vis.onclick = function () { if (m.appId) openHolospaceApp(m.appId, "", m.name); }; }   // the live window → tap to enter
        mountLivePreview(vis, m);   // boot the real running app into the cover (lazy, view-only)
      }
      function wirePlayRail() {
        var tries = 0;
        (function bind() {
          var map = playHoneyMap();
          if (map) {
            map.onSelect = renderPlayCard; map.onOpen = function (info) { try { if (info && info.appId) openHolospaceApp(info.appId, "", info.name); } catch (e) {} };
            try { if (playFrame && playFrame.contentWindow) playFrame.contentWindow.focus(); } catch (e) {}   // give the map keyboard focus so arrows work at once
            var chips = playRail && playRail.querySelector("#pl-cats");
            if (chips) {
              chips.innerHTML = '<button class="pl-chip on" data-c="">All</button>' + (map.categories || []).map(function (c) { return '<button class="pl-chip" data-c="' + plEsc(c) + '">' + plEsc(c) + "</button>"; }).join("");
              chips.querySelectorAll(".pl-chip").forEach(function (b) { b.onclick = function () { chips.querySelectorAll(".pl-chip").forEach(function (x) { x.classList.toggle("on", x === b); }); var q = b.getAttribute("data-c") || ""; var sb = playRail.querySelector("#pl-search"); if (sb) sb.value = q; var mm = playHoneyMap(); if (mm) mm.filter(q); }; });
            }
            return;
          }
          if (++tries < 100) setTimeout(bind, 80);
        })();
      }
      function openPlay() {
        if (playRail) { closePlay(); return; }
        try { if (studio) closeCreate(true); } catch (e) {}
        try { closeAllAsides(); } catch (e) {}
        newTab("▶ Play");
        addNode({ kind: "app", title: "▶ Play", src: "/apps/spaces/index.html?embed=play", sandbox: "allow-scripts allow-same-origin allow-popups allow-forms allow-modals allow-pointer-lock allow-downloads", allow: "fullscreen; clipboard-write; microphone", state: "max" });
        try { setActiveTabTitle("Play"); } catch (e) {}
        playFrame = null;
        var ov = document.createElement("div"); ov.id = "play-studio"; ov.className = "holo-aside"; ov.innerHTML = playRailHTML();
        document.body.appendChild(ov); document.body.classList.add("cs-active"); void ov.offsetWidth; ov.classList.add("on"); syncDockWidth();
        playRail = ov;
        var cl = ov.querySelector("#pl-collapse"); if (cl) cl.addEventListener("click", function () { closePlay(); });
        var sb = ov.querySelector("#pl-search"); if (sb) { var t = 0; sb.addEventListener("input", function () { clearTimeout(t); var v = sb.value; t = setTimeout(function () { var m = playHoneyMap(); if (m) m.filter(v); }, 150); }); }
        var mic = ov.querySelector("#pl-mic"); if (mic) mic.addEventListener("click", async function () { try { var hv = window.HoloVoice; if (hv && hv.dictate) { mic.classList.add("on"); var txt = await hv.dictate(); mic.classList.remove("on"); if (txt) { var s2 = ov.querySelector("#pl-search"); if (s2) s2.value = txt; var m = playHoneyMap(); if (m) m.filter(txt); } } else { toast("Voice unavailable"); } } catch (e) { mic.classList.remove("on"); } });
        renderPlayCard(null); wirePlayRail();
        var b = $("#verb-run"); if (b) { b.classList.add("on"); b.setAttribute("aria-expanded", "true"); }
      }
      function closePlay() {
        if (!playRail) return; var ov = playRail; playRail = null; playFrame = null;
        clearLivePreview();   // stop the live app window when the rail closes
        document.body.classList.remove("cs-active");
        ov.classList.remove("on"); syncDockWidth(); setTimeout(function () { try { ov.remove(); } catch (e) {} }, 520);
        var b = $("#verb-run"); if (b) { b.classList.remove("on"); b.setAttribute("aria-expanded", "false"); }
      }
      playInjectStyle();
      $("#verb-run").onclick = function () { if (playRail) closePlay(); else openPlay(); };
      try { registerAsideCloser(function () { if (playRail) closePlay(); }); } catch (e) {}
      function playInjectStyle() {
        if (document.getElementById("play-studio-styles")) return;
        var st = document.createElement("style"); st.id = "play-studio-styles";
        // Glass carriage: tint the Play aside translucent + blurred (scoped to #play-studio so the other
        // carriages stay opaque), then let the SELECTED app's hue (--h on the rail) bloom through it.
        st.textContent = "#play-studio.holo-aside{background:linear-gradient(155deg,rgba(20,16,42,.74),rgba(9,7,20,.82))!important;backdrop-filter:blur(26px) saturate(1.5);-webkit-backdrop-filter:blur(26px) saturate(1.5);border-left:1px solid rgba(255,255,255,.08)!important}"
          + "#play-studio .pl-rail{--phi:1.618;--s1:8px;--s2:13px;--s3:21px;--s4:34px;position:relative;display:flex;flex-direction:column;gap:var(--s2);height:100%;min-height:0;padding:var(--s3);color:var(--holo-ink,#e9e9ee);font:18px/1.5 var(--win-font,ui-sans-serif,system-ui);overflow:hidden}"
          // an ambient hue glow from the selected app, bleeding down from the top — the 'magical' tint
          + "#play-studio .pl-rail::before{content:'';position:absolute;inset:0 0 auto 0;height:46%;pointer-events:none;background:radial-gradient(120% 90% at 50% -10%,hsla(var(--h,200),85%,60%,.22),transparent 70%);transition:background .35s ease;z-index:0}"
          + "#play-studio .pl-rail>*{position:relative;z-index:1}"
          + "#play-studio .pl-head{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between}"
          + "#play-studio .pl-title{font-size:28px;font-weight:800;letter-spacing:-.01em}"
          + "#play-studio .pl-collapse{width:36px;height:36px;border-radius:11px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:inherit;cursor:pointer;font-size:18px;backdrop-filter:blur(8px)}"
          + "#play-studio .pl-collapse:hover{background:rgba(255,255,255,.12)}"
          // search + categories grouped in one glass header band, framing the cover below
          + "#play-studio .pl-srow{flex:0 0 auto;display:flex;gap:var(--s1);align-items:center}"
          + "#play-studio #pl-search{flex:1;min-width:0;padding:12px 18px;font:inherit;color:inherit;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:999px;backdrop-filter:blur(8px);transition:border-color .2s,box-shadow .2s}"
          + "#play-studio #pl-search::placeholder{color:#9a9ab0}"
          + "#play-studio #pl-search:focus{outline:none;border-color:hsla(var(--h,200),80%,65%,.6);box-shadow:0 0 0 3px hsla(var(--h,200),80%,60%,.16)}"
          + "#play-studio .pl-mic{flex:0 0 auto;width:44px;height:44px;border-radius:50%;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:inherit;cursor:pointer;font-size:18px;backdrop-filter:blur(8px)}"
          + "#play-studio .pl-mic.on{color:hsl(var(--h,200) 85% 70%);border-color:hsl(var(--h,200) 85% 65%)}"
          + "#play-studio .pl-cats{flex:0 0 auto;display:flex;gap:var(--s1);overflow-x:auto;overflow-y:hidden;padding-bottom:2px;scrollbar-width:none;-webkit-mask:linear-gradient(90deg,#000 calc(100% - 30px),transparent);mask:linear-gradient(90deg,#000 calc(100% - 30px),transparent)}"
          + "#play-studio .pl-cats::-webkit-scrollbar{display:none}"
          + "#play-studio .pl-chip{flex:0 0 auto;padding:9px 16px;font-size:15px;border-radius:999px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#cdcdd8;cursor:pointer;white-space:nowrap;backdrop-filter:blur(8px);transition:.18s}"
          + "#play-studio .pl-chip:hover{color:#fff;border-color:hsla(var(--h,200),80%,65%,.55)}"
          + "#play-studio .pl-chip.on{color:#0a0a0b;background:#f4f4f6;border-color:#f4f4f6}"
          + "#play-studio .pl-card{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:var(--s2);overflow:hidden}"
          + "#play-studio .pl-empty{margin:auto;text-align:center;color:#85858f;font-size:18px;display:flex;flex-direction:column;gap:var(--s2)}"
          + "#play-studio .pl-empty-i{font-size:52px;opacity:.5}"
          // the COVER: a cinematic, hue-lit hero with depth, vignette, a top sheen and a slow shimmer
          + "#play-studio .pl-vis{position:relative;flex:1 1 auto;min-height:0;border-radius:20px;display:grid;place-items:center;overflow:hidden;background:radial-gradient(135% 130% at 32% 14%,hsl(var(--h,200) 82% 60%),hsl(var(--h,200) 72% 26%) 58%,#08070f 100%);box-shadow:inset 0 1px 0 rgba(255,255,255,.18),inset 0 0 0 1px rgba(255,255,255,.08),0 18px 50px rgba(0,0,0,.45),0 0 60px hsla(var(--h,200),80%,50%,.18)}"
          + "#play-studio .pl-vis::before{content:'';position:absolute;inset:0;background:radial-gradient(80% 60% at 50% 120%,rgba(0,0,0,.55),transparent 60%),linear-gradient(180deg,rgba(255,255,255,.14),transparent 28%);pointer-events:none}"
          + "#play-studio .pl-vis::after{content:'';position:absolute;top:-60%;left:-30%;width:80%;height:220%;transform:rotate(18deg);background:linear-gradient(90deg,transparent,rgba(255,255,255,.10),transparent);pointer-events:none;animation:plsheen 6.5s ease-in-out infinite}"
          + "@keyframes plsheen{0%,70%{transform:translateX(-30%) rotate(18deg)}100%{transform:translateX(360%) rotate(18deg)}}"
          + "@media (prefers-reduced-motion:reduce){#play-studio .pl-vis::after{animation:none;opacity:0}}"
          + "#play-studio .pl-vis img{position:relative;width:44%;height:44%;max-width:184px;max-height:184px;object-fit:contain;filter:drop-shadow(0 8px 22px rgba(0,0,0,.55));transition:opacity .4s ease}"
          // the LIVE window: the real running app, full-DPR, fades in over the cover; view-only (clicks → Open)
          + "#play-studio .pl-vis{cursor:pointer}"
          + "#play-studio .pl-vis .pl-live{position:absolute;inset:0;width:100%;height:100%;border:0;background:#0a0a10;opacity:0;transition:opacity .55s ease;pointer-events:none}"
          + "#play-studio .pl-vis .pl-live.on{opacity:1}"
          + "#play-studio .pl-vis.live img{opacity:0}"
          + "#play-studio .pl-vis .pl-badge{position:absolute;top:11px;left:11px;z-index:3;display:none;align-items:center;gap:7px;padding:4px 11px;border-radius:999px;font-size:12px;font-weight:800;letter-spacing:.06em;color:#fff;background:rgba(0,0,0,.42);backdrop-filter:blur(8px)}"
          + "#play-studio .pl-vis.live .pl-badge{display:inline-flex}"
          + "#play-studio .pl-vis .pl-badge::before{content:'';width:7px;height:7px;border-radius:50%;background:#34d399;box-shadow:0 0 9px #34d399;animation:plpulse 1.5s ease-in-out infinite}"
          + "@keyframes plpulse{0%,100%{opacity:1}50%{opacity:.35}}"
          + "#play-studio .pl-name{flex:0 0 auto;font-size:27px;font-weight:800;line-height:1.05;letter-spacing:-.01em}"
          + "#play-studio .pl-cat{flex:0 0 auto;align-self:flex-start;padding:5px 13px;border-radius:999px;font-size:13px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.1);color:#e2e2ee}"
          + "#play-studio .pl-desc{flex:0 0 auto;font-size:16px;line-height:1.45;color:#c2c2cc;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}"
          + "#play-studio .pl-open{flex:0 0 auto;padding:15px;border:0;border-radius:14px;font:700 18px var(--win-font,system-ui);color:#fff;cursor:pointer;background:linear-gradient(135deg,hsl(var(--h,200) 78% 58%),hsl(var(--h,200) 70% 46%));box-shadow:0 10px 26px hsla(var(--h,200),75%,45%,.4)}"
          + "#play-studio .pl-open:hover{filter:brightness(1.08)}"
          + "#play-studio .pl-open:active{transform:translateY(1px)}"
          + "#play-studio .pl-meta{flex:0 0 auto;display:flex;justify-content:space-between;font-size:13px;color:#85858f}"
          + "#play-studio .pl-k{cursor:pointer;font-family:ui-monospace,monospace}"
          + "#play-studio .pl-k:hover{color:hsl(var(--h,200) 80% 70%)}"
          + "#play-studio .pl-rev{flex:0 0 auto}"
          + "#play-studio .pl-rev-h{font-size:15px;font-weight:700;margin-top:4px}"
          + "#play-studio .pl-rev-e{font-size:14px;color:#85858f}";
        document.head.appendChild(st);
      }
      // ── omnibox: one box runs a holospace OR opens the web (κ-verified), each into its own tab ──
      // A content address (κ · did:holo · ipfs:// · CID) resolves THROUGH the discovery path
      // (sbin/holo-omni + Delegated Routing V1): the bar locates the bytes ANYWHERE, re-derives every
      // block (Law L5), ASSEMBLES the UnixFS DAG, and renders the file/directory INLINE in its own tab —
      // no app, no origin. CORS-clean (gateways + routing mandate CORS), so it needs no dev proxy. Only
      // an assembly miss (a DAG shape we don't walk) falls back to the Holo IPFS app.
      const _inlineBlobs = [];
      // track an object-URL and bound the set: revoke the oldest beyond a cap so opened objects don't leak
      // for the whole session (the freshest ~32 tabs keep working; only a very old object tab won't reload).
      const pushBlob = (url) => { _inlineBlobs.push(url); while (_inlineBlobs.length > 32) { try { URL.revokeObjectURL(_inlineBlobs.shift()); } catch { } } return url; };
      const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
      const shortAddr = (a) => { a = String(a); return a.length > 42 ? a.slice(0, 22) + "…" + a.slice(-12) : a; };
      function sniffType(bytes, addr) {
        const ext = (String(addr).split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i) || [])[1];
        const byExt = { html: "text/html", htm: "text/html", txt: "text/plain", md: "text/markdown", json: "application/json", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", pdf: "application/pdf" };
        if (ext && byExt[ext.toLowerCase()]) return byExt[ext.toLowerCase()];
        const b = bytes.subarray(0, 12);
        if (b[0] === 0x89 && b[1] === 0x50) return "image/png";
        if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
        if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
        if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
        if (b[0] === 0x3c) return "text/html";
        let p = 0; const n = Math.min(256, bytes.length); for (let i = 0; i < n; i++) { const c = bytes[i]; if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127)) p++; }
        return n && p > n * 0.85 ? "text/plain" : "application/octet-stream";
      }
      function dirListingHtml(addr, out, entries) {
        const rows = entries.map((e) => `<li><span class=n>${escHtml(e.name || "(unnamed)")}</span><span class=c>${escHtml(e.cid)}</span></li>`).join("");
        return `<!doctype html><meta charset=utf-8><style>body{margin:0;background:#0a0e17;color:#e8eef9;font:var(--holo-text-sm, 0.875rem) system-ui;padding:26px}h1{font-size: var(--holo-text-sm, 0.938rem);margin:0 0 3px}.s{color:#6b7a99;font:var(--holo-text-sm, 0.75rem) ui-monospace,monospace;margin:0 0 18px;word-break:break-all}ul{list-style:none;margin:0;padding:0}li{display:flex;gap:14px;padding:9px 10px;border-bottom:1px solid #161f30;align-items:center}li:hover{background:#0e1726;border-radius:8px}.n{flex:1;color:#cdd7ea}.c{color:#566c8a;font:var(--holo-text-sm, 0.688rem) ui-monospace,monospace}li::before{content:"›";color:#3b82f6}</style><h1>⬡ ${escHtml(shortAddr(addr))}</h1><p class=s>${escHtml(out.kappa || "")} · ${entries.length} entries · verified by re-derivation (Law L5)</p><ul>${rows}</ul>`;
      }
      // openContentAddress(input) → true if it located + rendered the object inline; false to fall back.
      // appByKappa(input) → the catalog app whose CONTENT ROOT is this κ, or null. Every app is addressed
      // by the did:holo of its content (Law L1), so a single shared κ link IS the whole app. Matches the
      // sha256 in any form (holo://<hex> · did:holo:sha256:<hex> · a bare 64-hex).
      function appByKappa(input) {
        const m = String(input || "").match(/[0-9a-f]{64}/i);
        if (!m) return null;
        const hex = m[0].toLowerCase();
        return catalog.find((a) => String(a.did || "").toLowerCase().endsWith(hex)) || null;
      }
      async function openContentAddress(input) {
        let pr; try { pr = parseRef(input); } catch { return false; }
        if (pr.kind !== "kappa" && pr.kind !== "cid") return false;            // web url / .eth / app name → not a content address
        // a κ that is an app's own content root → boot the WHOLE app (its own gated, κ-addressed tab),
        // never a raw object viewer. One shared address opens the complete, running app experience.
        { const app = appByKappa(input); if (app) { await launch(app); return true; } }
        if (pr.kind === "kappa" && pr.axis && pr.axis !== "sha256") { toast(`${pr.axis} objects resolve on the substrate · mesh, not the open web not reachable here`); return true; }   // e.g. did:holo:blake3 → stop cleanly, don't fall into a confusing IPFS-app attempt
        toast("⌕ searching everything…");
        let out; try { out = await resolveAny(input, { discover: true, assemble: true, timeoutMs: 15000 }); } catch { out = null; }
        if (!out || !out.ok) {
          if (pr.kind === "cid") { toast("located ✓ opening in Holo IPFS to assemble"); return false; }   // a CID can still be tried by the IPFS app's gateways/assembly
          toast(`couldn't locate this object on any source · ${shortAddr(input)}`); return true;              // a sha256 κ we genuinely can't find → clean stop, no opaque fallback
        }
        const via = out.via === "ipfs:discovered" ? "Delegated Routing V1" : out.via === "ipfs" ? "trustless gateway" : out.via;
        const c = out.content;
        if (!c || c.type === "error") { toast("located ✓ opening in Holo IPFS to assemble"); return false; }
        const label = shortAddr(input), tabAddr = out.cid ? "ipfs://" + out.cid : (out.kappa || input);
        let doc, type;
        if (c.type === "directory") { doc = dirListingHtml(input, out, c.entries); type = "text/html"; }
        else { type = sniffType(c.bytes, input); doc = objectViewerDoc(c.bytes, label, (out.kappa || "").split(":").pop() || "", type); }   // readable solid-bg viewer for text/json/image; HTML renders as itself
        const blob = doc != null ? new Blob([doc], { type: "text/html" }) : new Blob([c.bytes], { type });
        const url = pushBlob(URL.createObjectURL(blob));
        if (needNewTab()) newTab("⬡ " + label);
        addNode({ kind: "app", title: "⬡  " + label, src: url, sandbox: "", allow: "", state: "max", browser: true, webAddr: tabAddr });
        setActiveTabTitle("⬡ " + label); setActiveTabAddr(tabAddr);
        const detail = c.type === "directory" ? `${c.entries.length} entries` : `${c.bytes.length.toLocaleString()} B`;
        toast(`✓ verified · ${detail} · via ${via} · ${out.ms} ms`);
        return true;
      }
      // ipfsTargetFromInput(input) → { cid, path } | null — pull the CID + sub-path out of a bare CID,
      // an ipfs://cid/path, or a /ipfs/cid/path. The CID is normalized via parseRef so it's a real CID.
      function ipfsTargetFromInput(input) {
        let s = String(input || "").trim().replace(/^ipfs:\/\//i, "").replace(/^\/?ipfs\//i, "");
        const slash = s.indexOf("/");
        const cidPart = slash >= 0 ? s.slice(0, slash) : s;
        const path = slash >= 0 ? s.slice(slash + 1) : "";
        let cid = null; try { const pr = parseRef("ipfs://" + cidPart); if (pr.kind === "cid") cid = pr.cidStr; } catch {}
        return cid ? { cid, path } : null;
      }
      // openIpfsSite(input) → true if it opened the object natively. An IPFS CID (and everything under it)
      // browses like a website: the tab loads /ipfs/<cid>/<path>, the κ Service Worker resolves it through
      // the UnixFS DAG re-deriving every block (Law L5), and the page's own relative links + assets resolve
      // back through that same verified gateway. A directory serves its index.html, else a native listing.
      function openIpfsSite(input) {
        const t = ipfsTargetFromInput(input);
        if (!t) return false;
        if (typeof closeSpot === "function") closeSpot();
        const src = "/ipfs/" + t.cid + "/" + (t.path || "");
        const addr = "ipfs://" + t.cid + (t.path ? "/" + t.path : "");
        const label = shortAddr(addr);
        if (needNewTab()) newTab("⬡ " + label);
        addNode({ kind: "app", title: "⬡  " + label, src, sandbox: "allow-scripts allow-same-origin allow-forms allow-popups allow-modals", allow: "", state: "max", browser: true, webAddr: addr });
        setActiveTabTitle("⬡ " + label); setActiveTabAddr(addr); recordNav();
        try { omniRemember({ addr, input: t.cid, kind: "cid", title: label }); } catch (e) {}   // the bar remembers this IPFS object
        toast("⬡ browsing IPFS · every block verified");
        return true;
      }
      // ── Holo Browser (browser-sw.js) — the live-web loading seam: "Chromium's URLLoaderFactory over the
      // κ-store". /webview/w/<b64url> → fetch through the /web proxy → mint κ (blake3) → re-derive (L5) →
      // inject <base>, rewrite links in-scope, proxy + mint every subresource → serve same-origin. We register
      // it LAZILY at scope /webview/ (a deeper scope than its script path, allowed by Service-Worker-Allowed),
      // alongside the OS worker at "/". A live page renders in a real Chromium iframe with working navigation.
      let _holoBrowserReg = null, _holoBrowserSwReg = null;
      function ensureHoloBrowser() {
        if (_holoBrowserReg) return _holoBrowserReg;
        _holoBrowserReg = (async () => { try { _holoBrowserSwReg = await navigator.serviceWorker.register("/browser-sw.js", { type: "module", scope: "/webview/" }); await navigator.serviceWorker.ready; postOnionTransport(); return true; } catch (e) { console.warn("Holo Browser seam:", e); return false; } })();
        return _holoBrowserReg;
      }
      const b64url = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      // ── Tor transport config (ADR-0104) — the user's pick of HOW onion bytes leave the tab. Stored locally,
      // default NONE; a .onion never fetches directly. We push the choice to browser-sw (which appends it to
      // the /web proxy URL for .onion hosts) AND it reaches holo-serve's onion proxy as a per-request override.
      function getOnionTransport() { try { const t = JSON.parse(localStorage.getItem("holo.onion.transport") || "null"); return (t && t.kind && t.endpoint) ? t : null; } catch { return null; } }
      function setOnionTransport(t) { try { if (t && t.kind && t.endpoint) localStorage.setItem("holo.onion.transport", JSON.stringify({ kind: t.kind, endpoint: t.endpoint })); else localStorage.removeItem("holo.onion.transport"); } catch {} postOnionTransport(); }
      function onionTpB64() { const t = getOnionTransport(); return t ? b64url(JSON.stringify(t)) : ""; }
      function postOnionTransport() { try { const w = _holoBrowserSwReg && (_holoBrowserSwReg.active || _holoBrowserSwReg.installing || _holoBrowserSwReg.waiting); if (w) w.postMessage({ type: "setonion", transport: onionTpB64() }); } catch {} }
      // pickOnionTransport() → resolve a transport, prompting once if none is set. Presets keep it one tap:
      // a public onion HTTP gateway (zero setup, weakest privacy) or a local Tor SOCKS5 proxy (real Tor).
      function pickOnionTransport() {
        const have = getOnionTransport(); if (have) return have;
        const pick = prompt("Browse Tor .onion — choose a transport:\n\n  1  Onion HTTP gateway (zero setup; the gateway sees your request + IP — weakest privacy)\n  2  Local Tor SOCKS5 proxy (real Tor anonymity; needs Tor/Arti running)\n\nEnter 1 or 2:", "1");
        if (pick === "1") { const ep = prompt("Onion gateway domain (suffix style, e.g. onion.ws) or a {host}/{path} template:", "onion.ws"); if (!ep) return null; setOnionTransport({ kind: "gateway", endpoint: ep.trim() }); return getOnionTransport(); }
        if (pick === "2") { const ep = prompt("Tor SOCKS5 proxy address (host:port):", "127.0.0.1:9050"); if (!ep) return null; setOnionTransport({ kind: "socks5", endpoint: ep.trim() }); return getOnionTransport(); }
        return null;
      }
      // openOnionSite(input) → true if it handled a .onion. Validates the v3 address cryptographically (Law
      // L5 — corrupt/fabricated/v2 are refused, not browsed), then opens it in the Holo Browser seam —
      // PASTE-AND-GO, as seamless as a URL or IPFS CID. NO mandatory prompt: the proxy auto-detects a local
      // Tor (9050/9150) and routes there; an explicit transport (gateway / custom SOCKS) overrides if set. If
      // nothing is reachable, the SERVED page itself explains how to start Tor (honest, never a fake render).
      async function openOnionSite(input) {
        await ensureOmniLegs();
        if (!parseOnionRef(input)) return false;
        if (typeof closeSpot === "function") closeSpot();
        const p = parseOnionRef(input);
        const v = validateOnion(p.addr);
        if (!v.ok) { toast(`✗ not a valid onion · ${v.reason}`); return true; }
        const tp = getOnionTransport();                       // explicit user pick, if any (else proxy auto-Tor)
        await ensureHoloBrowser(); postOnionTransport();
        const real = "http://" + p.host + p.path;
        const src = "/webview/w/" + b64url(real);
        const label = p.host.replace(/\.onion$/, "…onion");
        if (needNewTab()) newTab("🧅 " + label);
        addNode({ kind: "app", title: "🧅  " + label, src, sandbox: "allow-scripts allow-same-origin allow-forms allow-popups allow-modals", allow: "", state: "max", browser: true, webAddr: "onion://" + p.host + p.path });
        setActiveTabTitle("🧅 " + label); setActiveTabAddr("onion://" + p.host + p.path); recordNav();
        toast(`🧅 Tor onion · via ${tp ? tp.kind : "local Tor"} · captured and verified · not direct Tor`);
        return true;
      }
      // openOnionSearch(query) → discover the onion web. Queries a clearnet onion index (Ahmia) THROUGH the
      // /web proxy (no CORS, κ-minted), lists v3 .onion results; clicking one re-enters the omnibar → opens it
      // via the validated onion path (every byte re-derived, L5). Onion services aren't in DNS, so this is the
      // "find, then browse" half — same spirit as Holo Find, scoped to Tor.
      async function openOnionSearch(query) {
        await ensureOmniLegs();
        const q = String(query || "").trim(); if (!q) return false;
        if (typeof closeSpot === "function") closeSpot();
        toast("🧅 searching the onion web…");
        const proxied = (u) => "/web?url=" + encodeURIComponent(u);
        let out; try { out = await searchOnionWeb(q, { fetchImpl: (u, o) => fetch(proxied(u), o) }); } catch (e) { out = { ok: false, reason: (e && e.message) || String(e), results: [] }; }
        const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
        const rows = (out.results || []).map((r) => `<a class="row" href="#" data-url="${esc(r.url)}"><div class="t">${esc(r.title)}</div><div class="u">${esc(r.host)}</div>${r.snippet ? `<div class="s">${esc(r.snippet)}</div>` : ""}</a>`).join("");
        const body = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>onion · ${esc(q)}</title>
<style>:root{--bg:#05070d;--ink:#e8eef9;--dim:#7d8aa6;--accent:#a78bfa;--line:#1d2840;--mono:ui-monospace,Consolas,monospace}*{box-sizing:border-box}body{margin:0;background:radial-gradient(1000px 540px at 50% -10%,#160d22,var(--bg) 60%);color:var(--ink);font:var(--holo-text-sm, 0.938rem)/1.5 system-ui,Segoe UI,Roboto,sans-serif;min-height:100vh;padding:30px 20px 70px}.wrap{max-width:780px;margin:0 auto}.hd{display:flex;align-items:center;gap:11px;margin-bottom:4px}.glyph{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;background:#2a2150;color:#cbb8ff;font-size:16px}h1{font-size:16px;margin:0;font-weight:650}.sub{color:var(--dim);font:var(--holo-text-sm, 0.719rem) var(--mono);margin:2px 0 20px}.row{display:block;padding:13px 15px;border:1px solid var(--line);border-radius:12px;margin-bottom:10px;text-decoration:none;color:var(--ink);background:#0c111b;transition:.1s}.row:hover{background:#0e1726;border-color:#2a3a5c}.t{font-weight:600;color:#cbb8ff}.u{color:var(--dim);font:var(--holo-text-sm, 0.688rem) var(--mono);word-break:break-all;margin:3px 0}.s{color:#9fb0cc;font-size: var(--holo-text-sm, 0.813rem);margin-top:4px}.empty{color:var(--dim);text-align:center;padding:40px}</style></head>
<body><div class="wrap"><div class="hd"><div class="glyph">🧅</div><h1>Onion web · ${esc(q)}</h1></div><div class="sub">${out.ok ? (out.results.length + " results · via " + esc(out.via) + " · open any to browse through Tor, re-derived (L5)") : "couldn't reach the index · " + esc(out.reason || "")}</div>${rows || '<div class="empty">no onion services found</div>'}</div>
<script>document.addEventListener("click",function(e){var a=e.target&&e.target.closest&&e.target.closest("a[data-url]");if(a){e.preventDefault();parent.postMessage({type:"holo-omni:go",value:a.getAttribute("data-url")},"*");}});<\/script></body></html>`;
        const url = pushBlob(URL.createObjectURL(new Blob([body], { type: "text/html" })));
        if (needNewTab()) newTab("🧅 " + q);
        addNode({ kind: "app", title: "🧅  " + q, src: url, sandbox: "allow-scripts", allow: "", state: "max", webAddr: "onion-search:" + q });
        setActiveTabTitle("🧅 " + q); setActiveTabAddr("onion:" + q);
        toast(out.ok ? `🧅 ${out.results.length} onion result(s)` : `couldn't reach the onion index`);
        return true;
      }
      // openHoloBrowser(input) → open a live http(s) URL in the Holo Browser seam (a /webview/w/ tab).
      // URL→snapshot map (localStorage) — auto-seal records it; a re-visit serves the sealed snapshot from your
      // LOCAL commons (zero egress) instead of re-fetching the origin. Transparent: the address bar keeps the
      // original URL; only the bytes change (content-addressed, re-derived).
      const snapGet = (u) => { try { return (JSON.parse(localStorage.getItem("holo:snap") || "{}"))[u] || null; } catch { return null; } };
      const snapSet = (u, cid) => { try { const m = JSON.parse(localStorage.getItem("holo:snap") || "{}"); m[u] = cid; localStorage.setItem("holo:snap", JSON.stringify(m)); } catch {} };
      // openCommonsSnapshot(url, cid) — serve url's sealed snapshot from /ipfs/<cid>/ (the gateway resolves it
      // from the local κ-store, NO origin); the address bar still shows `url`. The invisible zero-egress re-visit.
      function openCommonsSnapshot(url, cid) {
        if (typeof closeSpot === "function") closeSpot();
        const src = "/ipfs/" + cid + "/";
        const label = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
        if (needNewTab()) newTab("↺ " + label);
        addNode({ kind: "app", title: "↺  " + label, src, sandbox: "allow-scripts allow-same-origin allow-forms allow-popups allow-modals", allow: "", state: "max", browser: true, webAddr: url, commonsCid: cid });
        setActiveTabTitle("↺ " + label); setActiveTabAddr(url); recordNav();
        toast("↺ served from your commons · 0 egress · hit reload for live");
        return true;
      }
      async function openHoloBrowser(input, { live = false } = {}) {
        const url = /^https?:\/\//i.test(input) ? input : "https://" + String(input).replace(/^\/+/, "");
        const snap = !live && snapGet(url); if (snap) return openCommonsSnapshot(url, snap);   // re-visit → your commons, zero egress (live:true forces a fresh fetch + re-seal)
        if (typeof closeSpot === "function") closeSpot();
        await ensureHoloBrowser();
        const src = "/webview/w/" + b64url(url);
        const label = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
        if (needNewTab()) newTab("🌐 " + label);
        addNode({ kind: "app", title: "🌐  " + label, src, sandbox: "allow-scripts allow-same-origin allow-forms allow-popups allow-modals", allow: "", state: "max", browser: true, webAddr: url });
        setActiveTabTitle("🌐 " + label); setActiveTabAddr(url); recordNav();
        try { omniRemember({ addr: url, input: url, kind: "web", title: label }); } catch (e) {}   // the bar remembers this page
        setTabLoading(true);   // load-START edge → the skin throbber spins (the SW "committed" message stops it)
        toast("🌐 Holo Browser · live web captured and verified");
        return true;
      }
      // openFind(query) — free text → Holo Find: a corroborated, self-verifying answer over the open web's
      // object universe (holo-find federates Wikipedia/Wikidata/DOI/… and holo-answer reconciles the facts,
      // no AI). It opens as its own tab, like any other holospace — search IS a content-addressed surface.
      function openFind(query) {
        if (typeof closeSpot === "function") closeSpot();
        const src = "/find.html?q=" + encodeURIComponent(query);
        if (needNewTab()) newTab("⌕ " + query);
        addNode({ kind: "app", title: "⌕  " + query, src, sandbox: "allow-scripts allow-same-origin allow-forms allow-popups", allow: "", state: "max", browser: true, webAddr: "find:" + query });
        setActiveTabTitle("⌕ " + query); setActiveTabAddr(query);
      }
      // recallDoc(q, results) — a self-contained panel listing YOUR private matches for a question. Each row
      // throws the object's address back into the one omnibar (holo-omni:go) so it re-opens through the same
      // verified path your own typing does — the recall surface is itself just another door into the commons.
      function recallDoc(q, results) {
        const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
        const ICON = { web: "🌐", cid: "⬡", web3: "◈", app: "◆", kappa: "◆" };
        const rows = results.map((r) => `<a class="row" href="#" data-go="${esc(r.input || r.addr)}"><span class="ic">${ICON[r.kind] || "↻"}</span><span class="bd"><b>${esc(r.title || r.addr)}</b><span class="snip">${esc((r.text || "").slice(0, 180))}</span><span class="meta">${esc(r.kind || "object")} · via ${esc(r.via || "bm25")}</span></span></a>`).join("");
        return `<!doctype html><meta charset=utf8><style>:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;font:var(--holo-text-sm, 0.938rem)/1.5 system-ui,-apple-system,Segoe UI,sans-serif;background:#0b0d12;color:#e8eaf0}.hd{padding:24px 28px 10px}.hd h1{font-size:17px;margin:0 0 3px;font-weight:600}.hd p{margin:0;color:#8a90a2;font-size: var(--holo-text-sm, 0.813rem)}.list{padding:8px 16px 28px;max-width:880px}.row{display:flex;gap:14px;align-items:flex-start;padding:13px 14px;border-radius:12px;text-decoration:none;color:inherit}.row:hover{background:#161a24}.ic{font-size:20px;width:24px;text-align:center}.bd{display:flex;flex-direction:column;gap:2px;min-width:0}.bd b{font-weight:600}.snip{color:#aeb4c6;font-size: var(--holo-text-sm, 0.813rem);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:780px}.meta{color:#6b7180;font-size: var(--holo-text-sm, 0.719rem);text-transform:uppercase;letter-spacing:.04em}.empty{padding:22px 28px;color:#8a90a2}</style><div class=hd><h1>Your context · &ldquo;${esc(q)}&rdquo;</h1><p>Recalled on-device from everything you've opened — model-free, zero network (Q.recall).</p></div><div class=list>${rows || '<div class=empty>Nothing in your context matches yet.</div>'}</div><script>document.querySelectorAll("[data-go]").forEach(function(a){a.addEventListener("click",function(e){e.preventDefault();parent.postMessage({type:"holo-omni:go",value:a.getAttribute("data-go")},"*");});});<\/script>`;
      }
      // openPrivateRecall(q) — the studio's brain in the ONE door: Q.recall over YOUR private corpus, opened as
      // its own surface. Empty? Fall through to Holo Find over the open web — ask your own stuff first, then the
      // world. Both are content-addressed surfaces; the only difference is whose universe you're searching.
      async function openPrivateRecall(q) {
        toast("✦ recalling your context…");
        let r; try { r = await omniAsk(q, { k: 8 }); } catch { r = { results: [] }; }
        if (!r.results || !r.results.length) { openFind(q); return; }
        const doc = recallDoc(q, r.results);
        const url = pushBlob(URL.createObjectURL(new Blob([doc], { type: "text/html" })));
        if (needNewTab()) newTab("✦ " + q);
        addNode({ kind: "app", title: "✦  " + q, src: url, sandbox: "allow-scripts", allow: "", state: "max", webAddr: "recall:" + q });
        setActiveTabTitle("✦ " + q); setActiveTabAddr(q);
        toast(`✓ ${r.results.length} from your context${r.ms != null ? " · " + r.ms + " ms" : ""}${r.receipt ? " · sealed" : ""}`);
      }
      // openMedia(input, opts) — the MEDIA lane: open a κ-anchored streaming player on a media address. Direct
      // media (a κ-route / IPFS path / plain media URL) plays NOW, seekable via the κ-store's Range/206 support.
      // A platform URL (YouTube/Vimeo/…) has no in-tab extractor yet, so we DON'T fake a stream — we open the
      // real page faithfully in the Holo Browser (honest, Law L5). The yt-dlp seam lives in resolveMediaSource.
      async function openMedia(input, opts = {}) {
        await ensureOmniLegs();
        let r; try { r = await resolveMediaSource(input, opts); } catch { r = null; }
        if (!r || !r.playable) {
          if (r && r.fallback === "browser") { toast(`▶ ${r.platform || "media"} · no in-tab extractor yet — opening the page`); return openHoloBrowser(input); }
          toast("couldn't play this media · " + shortAddr(input)); return false;
        }
        const title = r.title || (String(input).split(/[?#]/)[0].split("/").pop()) || "media";
        const qs = "?src=" + encodeURIComponent(r.src) + (r.mime ? "&mime=" + encodeURIComponent(r.mime) : "") + (r.media ? "&media=" + r.media : "") + "&title=" + encodeURIComponent(title) + (opts.kappa ? "&kappa=" + encodeURIComponent(opts.kappa) : "");
        if (needNewTab()) newTab("▶ " + title);
        addNode({ kind: "app", title: "▶  " + title, src: "/usr/share/frame/media-player.html" + qs, sandbox: "allow-scripts allow-same-origin", allow: "autoplay; fullscreen", state: "max", webAddr: input });
        setActiveTabTitle("▶ " + title); setActiveTabAddr(input);
        try { omniRemember({ addr: input, input, kind: (r.media === "audio" ? "audio" : "video"), title, kappa: opts.kappa || null }); } catch (e) {}
        try { omniIndexObject({ addr: input, input, kind: (r.media === "audio" ? "audio" : "video"), title, text: title + " " + (r.mime || "") + " media" }); } catch (e) {}
        toast(`▶ ${title}${r.verified ? " · ✓ verified · seekable" : " · streamed"}`);
        return true;
      }
      // bestLocalFile(q) — a CONFIDENT local-file match from the substrate index: the typed string equals an
      // object's filename or path (case-insensitive). Used by omniGo so Enter on a filename OPENS the verified
      // local file rather than falling through to a web search. Ambiguous/partial text is left to suggestions.
      function bestLocalFile(q) {
        if (!SUBSTRATE) return null;
        const s = String(q || "").trim().toLowerCase(); if (s.length < 3 || /\s/.test(s)) return null;
        let exact = null, tail = null;
        for (const o of SUBSTRATE) {
          if (o.nl === s || o.pl === s) { exact = o; break; }
          if (!tail && (o.pl.endsWith("/" + s) || o.nl === s.split("/").pop())) tail = o;
        }
        return exact || tail || null;
      }
      // web3Label(out) — a short tab label for a resolved web3 card.
      function web3Label(out) {
        const c = out.card || {};
        if (c["@type"] === "holo:Name") return c["holo:name"];
        if (c["@type"] === "holo:Asset") return c["holo:symbol"] || c["holo:name"] || "token";
        if (c["@type"] === "holo:Transaction") return (out.card["holo:chain"] || "") + " tx";
        if (c["@type"] === "holo:Chain") return c["holo:chain"];
        return shortAddr(c["holo:address"] || "");
      }
      // openWeb3(input) → true if it resolved + rendered a web3 κ-card inline; false to fall back. The web3
      // leg of the one omnibar: an ENS name, a 0x account/token, a tx hash, a Solana address or a CAIP id
      // resolves into one sealed, content-addressed card — read-only, governed, receipted (Law L4/L5).
      async function openWeb3(input) {
        await ensureOmniLegs();
        if (!parseWeb3Ref(input)) return false;
        toast("⌕ resolving across web3…");
        let out; try { out = await resolveWeb3(input, { timeoutMs: 20000 }); } catch { out = null; }
        if (!out || !out.ok) { toast(`couldn't resolve · ${shortAddr(input)}${out && out.reason ? " · " + out.reason : ""}`); return true; }
        const doc = web3CardDoc(out);
        const url = pushBlob(URL.createObjectURL(new Blob([doc], { type: "text/html" })));
        const label = web3Label(out);
        if (needNewTab()) newTab("◈ " + label);
        addNode({ kind: "app", title: "◈  " + label, src: url, sandbox: "allow-scripts", allow: "", state: "max", webAddr: input });
        setActiveTabTitle("◈ " + label); setActiveTabAddr(input);
        try { omniRemember({ addr: input, input, kind: "web3", title: label, kappa: out.kappa }); } catch (e) {}   // the bar remembers this web3 object (κ-sealed)
        try { omniIndexObject({ addr: input, input, kind: "web3", title: label, text: JSON.stringify(out.card || {}) }); } catch (e) {}   // index the card's CONTENT → Q.recall finds it by meaning, not just title
        toast(`✓ ${out.subkind} · sealed${out.receipt ? " · receipt " + shortAddr(out.receipt.id) : ""} · ${out.ms} ms`);
        return true;
      }
      // The κ-cards (and any holospace) can throw a value BACK into the one omnibar: resolve another address
      // (the ENS→account hop, a token's contract, a tx's from/to), or ask Q. The shell owns the authority —
      // the frame only suggests; both routes go through the same verified path the user's own typing does.
      window.addEventListener("message", (e) => {
        const d = e && e.data; if (!d || typeof d !== "object") return;
        if (d.type === "holo-omni:go" && typeof d.value === "string") omniGo(d.value);
        else if (d.type === "holo-omni:find" && typeof d.value === "string") openFind(d.value);
        else if (d.type === "holo-ipfs:nav" && typeof d.url === "string") {   // an IPFS page navigated → track the journey in the omnibox
          try { const u = new URL(d.url, location.href); const mm = u.pathname.match(/\/ipfs\/(.+)$/); if (mm) {
            const ipfsAddr = "ipfs://" + decodeURIComponent(mm[1]).replace(/\/$/, ""); setActiveTabAddr(ipfsAddr);
            try { if (d.text || d.title) omniIndexObject({ addr: ipfsAddr, input: ipfsAddr, kind: "cid", title: d.title || ipfsAddr, text: d.text || "" }); } catch (e) {}   // index each browsed IPFS page by its BODY → recall-able by what it says, re-opens through the path gateway
          } } catch {}
        }
        else if (d.type === "holo-sealed" && typeof d.addr === "string") {   // commons leg: a browsed page sealed into a κ-snapshot, zero-egress re-serve
          try { const n = (tabs[activeTab] && tabs[activeTab]); if (n) n.sealedAddr = d.addr; } catch {}
          try { if (d.source) snapSet(d.source, d.addr.replace(/^ipfs:\/\//, "").replace(/\/$/, "")); } catch {}   // remember url→snapshot → next visit is zero-egress
          try { if (d.source && (d.text || d.title)) omniIndexObject({ addr: d.source, input: d.source, kind: "web", title: d.title || d.source, text: d.text || "" }); } catch (e) {}   // index the page's BODY TEXT → Q.recall can find this browsed page by what it actually says
          toast("✓ sealed to your commons · " + (d.assets || 0) + " assets · re-opens with zero egress");
        }
      });
      async function omniGo(input) {
        const v = String(input || "").trim(); if (!v) return;
        // A κ that IS an app's content root → boot the whole app from that ONE address, in any form
        // (holo://<hex> · did:holo:sha256:<hex> · bare 64-hex). Checked first so a shared app link always
        // opens the running app, never a search or a raw object viewer.
        { const app = appByKappa(v); if (app) return launch(app); }
        // THE ADDRESS IS A NAME: a typed clean name (login · home · find · any app's schema:name) → its
        // canonical location, then routed normally. resolveSync passes canonical input straight through, so
        // the loc !== v guard prevents any loop; an unknown name returns null and falls to the legs below.
        try { const ra = window.HoloAddress && window.HoloAddress.resolveSync && window.HoloAddress.resolveSync(v); if (ra && ra.loc && ra.loc !== v) return omniGo(ra.loc); } catch (e) {}
        // A NAVIGABLE chrome-bar κ (holo://bar/<κ>) → resolve its items off the verified bar history; preview + adopt.
        if (/^holo:\/\/bar\/[0-9a-f]{64}$/i.test(v) && window.HoloBars) { if (await window.HoloBars.open(v)) return; }
        // HOLO NAMES (holo-zone / holo-root) — an owned, mutable name. A fully-qualified holo://zone/<owner>/<label>
        // or, via a pinned anchor, a bare name → resolve to its content κ and open THAT (verify-before-trust, L5).
        // Additive + fail-soft: only fires when HoloRoot is wired; a miss falls through to the legs below.
        if (window.HoloRoot && (/^holo:\/\/zone\//i.test(v) || (window.HoloRoot.anchors && window.HoloRoot.anchors().length && /^[a-z0-9][a-z0-9.-]*$/i.test(v) && !appByKappa(v)))) {
          try { const rr = await window.HoloRoot.resolveName(v); if (rr && rr.ok && rr.kappa) return omniGo(rr.kappa); } catch (e) {}
        }
        // THREE WORDS (brass.junior.quiz) — a κ's speakable address. Resolve to its app HERE, before the
        // web3/onion/media legs, which would otherwise claim a dotted name. classify matches the app's
        // precomputed three-word address in the catalog (derived from the app's κ at build, Law L1/L5).
        if (/^[a-z]+\.[a-z]+\.[a-z]+$/i.test(v)) { const cw = classify(v, catalog); if (cw.kind === "app" && cw.app) return launch(cw.app); }
        await ensureOmniLegs();                               // web3/onion/media legs are lazy — ensure ready before dispatch (idempotent; usually already warm from focus)
        let pr; try { pr = parseRef(v); } catch { }
        if (pr && pr.kind === "kappa" && pr.axis && pr.axis !== "sha256") { toast(`${pr.axis} objects resolve on the substrate · mesh, not the open web not reachable here`); return; }   // e.g. did:holo:blake3 → a clean message, not a confusing search/app attempt
        if (pr && pr.kind === "kappa") { if (await openContentAddress(v)) return; }   // sha256 κ → verified inline (handles its own clean "couldn't locate" message)
        if (pr && pr.kind === "cid") { if (openIpfsSite(v)) return; }   // IPFS CID → native verified browsing through the /ipfs path gateway (relative links + assets resolve back through it)
        if (parseOnionRef(v)) { if (await openOnionSite(v)) return; }   // Tor v3 .onion → validated κ-card, browsed via the chosen transport (gateway · SOCKS5), every byte re-derived (L5), never direct Tor
        { const om = v.match(/^onion[:\s]+(.+)$/i); if (om) { if (await openOnionSearch(om[1])) return; } }   // "onion <terms>" → discover the onion web (Ahmia index), each result opens through the validated onion path
        if (await openWeb3(v)) return;   // web3: ENS · 0x account/token/tx · Solana · CAIP → one sealed κ-card
        if (classifyMedia(v).kind === "file") return void openMedia(v);   // a direct media address (.mp4/.mp3/… URL · κ-route · IPFS path) → κ-anchored streaming player, seekable, BEFORE the web→browser guess
        const r = classify(v, catalog);
        if (r.kind === "app" && r.app) return launch(r.app);   // THREE WORDS (brass.junior.quiz) or a κ that is an app → open the holospace
        if (r.kind === "web") return projectOpen(r.address || r.url || v);   // live web → PROJECTED κ tab by default (native; projectOpen falls back to the plain Holo Browser web view)
        if (r.kind === "holo") { if (await openContentAddress(v)) return; return openWeb(r); }   // holo://κ content address → inline verified render
        const a = matches(v, catalog)[0];                                // else prefer a holospace app match
        if (a) return launch(a);
        await loadSubstrate(); const lf = bestLocalFile(v); if (lf) return void openObjectByKappa(lf);   // a typed local filename/path (exact substrate match) → OPEN the verified local file (ensure the lazy index is ready first), not a web search
        openFind(v);                                                     // free text → Holo Find: a corroborated, self-verifying answer over the open web (no AI)
      }
      // S2 — "press play": the ONE open path. Any surface or agent opens anything through window.HoloOpen(ref):
      // the named app/space forms route to the canonical openers; every other shape (κ · words · cid · onion ·
      // web3 · web · media · text) delegates to omniGo, the omnibar's full resolver. classifyOpen(ref) lets an
      // agent ask "is this openable, and how?" with no side effects, first.
      // ── Default web-open = PROJECTION (a streamed-κ tab). A http(s) page opens as an in-OS holospace NODE
      //    whose iframe is the SEALED lens (?target=<url>). The lens self-triggers the off-screen producer,
      //    which renders the real page and streams κ tiles/screencast into THIS tab — so an ordinary web tab IS
      //    a projection: same chrome, address bar, tabstrip, but the pixels are content-addressed and re-derived
      //    before they paint. Needs the native producer (cefQuery); the web/dev build OR the off-switch
      //    (window.__holoProjectDefault === false) falls back to the plain in-OS web view (openHoloBrowser).
      async function projectOpen(input) {
        const url = /^https?:\/\//i.test(input) ? input : "https://" + String(input).replace(/^\/+/, "");
        if (!window.cefQuery || window.__holoProjectDefault === false) return openHoloBrowser(url);
        if (typeof closeSpot === "function") closeSpot();
        const src = "/usr/lib/holo/holo-osr-projector.html?target=" + encodeURIComponent(url);   // SEALED lens, per-tab target
        const label = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
        if (needNewTab()) newTab("🌐 " + label);
        addNode({ kind: "app", title: "🌐  " + label, src, sandbox: "allow-scripts allow-same-origin allow-forms allow-popups allow-modals", allow: "", state: "max", browser: true, webAddr: url, projected: true });
        setActiveTabTitle("🌐 " + label); setActiveTabAddr(url); recordNav();
        try { omniRemember({ addr: url, input: url, kind: "web", title: label }); } catch (e) {}
        setTabLoading(true);
        toast("✦ Projected · streamed κ");
        return true;
      }
      // PHASE C — if a projected lens reports no first frame in time (DRM/Widevine can't be captured, a dead
      // page, or a producer error) it postMessages us; swap that node for the plain in-OS web view. Projection
      // is the default; a working page is the floor. Matched by the url the lens carries — only from a holo://
      // frame (the lens), never a web page in a sandboxed /webview node.
      window.addEventListener("message", (e) => {
        if (e.origin && e.origin !== location.origin) return;
        const d = e && e.data; if (!d || d.type !== "holo-project:noframe" || typeof d.url !== "string") return;
        try { const dead = desktop.doc().world.find((w) => w.projected && w.webAddr === d.url); if (dead) removeNode(dead.id); } catch (err) {}
        try { toast("↩ couldn't project this page · opening the live view"); } catch (e2) {}
        openHoloBrowser(d.url);
      });
      window.HoloOpen = makeHoloOpen({
        space: (id) => { const t = templates.find((x) => x.id === id || x.name === id); return t ? openHolospace(t) : omniGo("holo://space/" + id); },
        app: (id) => openHolospaceApp(id, "", ""),
        web: (ref) => projectOpen(ref),                  // a live web page → a projected κ tab (native), else the web view
        fallback: (ref) => omniGo(ref),
      });
      window.HoloClassifyOpen = classifyHoloOpen;
      // ── κ-Roots: owned, mutable names native to the substrate (holo-zone) + a pluralistic root (holo-root).
      //    No registrar, no DNS root, no KSK. A name is a signed binding on the operator's ONE source chain;
      //    resolution re-derives (Law L5). HoloZone self-wires off HoloStrand; here we build HoloRoot over it
      //    and bind the unlocked operator as the zone owner (writable) when identity arrives. Additive + fail-soft.
      (async () => {
        try {
          await import("/_shared/holo-zone.mjs");                          // self-wires window.HoloZone off HoloStrand
          await import("/_shared/holo-zone-net.mjs");                      // registers window.HoloZoneNet (BroadcastChannel transport)
          const { makeRoot } = await import("/sbin/holo-root.mjs");        // sbin resolver (FHS path; dist serves /sbin/* by κ)
          // openZone(ownerHex): the operator's OWN zone is local; ANY other owner's zone is fetched over the
          // zone-net (BroadcastChannel today, WebRTC/IPFS same seam), verify-before-adopt — so a name owned by
          // anyone resolves through the one door, and a lying peer is refused (the answer is the math).
          const openLocal = async (hex) => { try { const z = window.HoloZone; return (z && z.ownerKappa && z.ownerKappa.split(":").pop() === hex) ? z : null; } catch (e) { return null; } };
          let openZone = openLocal;
          try { if (window.HoloZoneNet) { const net = window.HoloZoneNet.attach(openLocal); openZone = net.openZone; window.__holoZoneNet = net; } } catch (e) {}
          window.HoloRoot = makeRoot({ anchors: [], openZone });
          // ISP block-fallback faculty: the native host (handler.cc OnResourceRedirect) delegates a filter-blocked
          // page with no peer-held κ to window.__holoBlockResolve, which resolves the host NAMELESS over HoloRoot
          // (κ-roots, off the ISP DNS) and answers the host over cefQuery. Additive; fail-soft if it can't load.
          import("/_shared/holo-block-fallback.mjs").catch(function () {});
          // bind the unlocked operator as the zone owner so names become writable (signing rides the live key).
          const bindOwner = async () => { try { const op = (window.HoloSession && window.HoloSession.activePrincipal) ? await window.HoloSession.activePrincipal() : null; if (op && window.HoloZone && window.HoloZone.setOwner) { window.HoloZone.setOwner(op); window.HoloRoot.pin(window.HoloZone); } } catch (e) {} };
          window.addEventListener("holo-identity", bindOwner);
          if (window.HoloIdentity) bindOwner();
        } catch (e) { /* κ-Roots stays dormant; the shell never breaks */ }
      })();
      // ── κ-addressable chrome bars — bookmarks (under the address bar) + an icon-only action rail (right of
      //    the omnibox). Each bar is a κ-list (holo-bar.mjs); an item is a κ-reference; opening routes through
      //    the ONE open path (window.HoloOpen). Ordering persists and the bar has its own κ. Additive: any
      //    failure is swallowed so the shell never breaks. See holo-bar-witness.
      (async () => {
        try {
          const [BAR, STORE] = await Promise.all([import("/_shared/holo-bar.mjs"), import("/_shared/holo-bar-store.mjs")]);
          const { buildBarModel, renderBar } = BAR; const { loadBar, defaultBookmarks } = STORE; const _saveBar = STORE.saveBar;
          const digest = async (str) => { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str)); return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join(""); };
          // E4 — every bar edit also appends to a holo-strand, so the bar gains a NAVIGABLE κ (holo://bar/<κ>),
          // an attested edit history (head κ over the whole sequence, Law L5) + cross-device roam
          // (holo-bar-strand.mjs). Uses the operator's live source chain when unlocked, else a session-local
          // strand. Fail-soft: a strand failure NEVER blocks the durable localStorage save.
          let barStrand = null;
          try { const ST = await import("/_shared/holo-bar-strand.mjs"); const o = { digest }; if (window.HoloStrand) o.strand = window.HoloStrand; barStrand = ST.makeBarStrand(o); } catch (e) { barStrand = null; }
          const saveBar = async (kind, items, opt) => { const r = await _saveBar(kind, items, opt || { digest }); try { if (barStrand) await barStrand.commit(kind, items); } catch (e) {} return r; };
          const bmEl = document.getElementById("bookmarkbar"), railEl = document.getElementById("rail");
          const setH = () => document.documentElement.style.setProperty("--bookmark-h", (bmEl && bmEl.children.length) ? "34px" : "0px");
          const openRow = (row) => { try {
            // A pinned EXTENSION (kind "ext"): the native Chromium toolbar is suppressed, so the rail icon IS
            // the extension's button. Proxy to its real action through the host (holo:extaction → popup overlay
            // / action click). Same cefQuery transport as holo:installext; web build falls back to a hint.
            if (row.kind === "ext" && /^[a-p]{32}$/.test(String(row.ref))) {
              // open the extension's popup page (from the manifest at pin time → row.open), else the MV3
              // default popup.html. The host validates the URL and opens it; the Chrome runtime renders it.
              const tgt = /^chrome-extension:\/\//.test(String(row.open || "")) ? row.open : ("chrome-extension://" + row.ref + "/popup.html");
              if (window.cefQuery) window.cefQuery({ request: "holo:extaction:" + tgt, persistent: false, onSuccess: function () {}, onFailure: function () { toast("Extension action unavailable"); } });
              else toast((row.label || "Extension") + " — available in the native browser");
              return;
            }
            window.HoloOpen ? window.HoloOpen(row.open || row.ref) : omniGo(row.open || row.ref);
          } catch (e) {} };
          // HTML5 drag-to-reorder shared by both bars; on drop, commit() persists the new κ.
          const wireDrag = (el, list, commit) => { if (!el) return; let from = -1; [...el.querySelectorAll(".holo-bar-item")].forEach((b, i) => { b.draggable = true;
            b.addEventListener("dragstart", () => { from = i; b.classList.add("dragging"); });
            b.addEventListener("dragend", () => b.classList.remove("dragging"));
            b.addEventListener("dragover", (ev) => ev.preventDefault());
            b.addEventListener("drop", (ev) => { ev.preventDefault(); if (from < 0 || from === i) return; const next = list.slice(); const [m] = next.splice(from, 1); next.splice(i, 0, m); commit(next); }); }); };

          // bookmarks — seed from the catalog (a curated set if present, else the first apps).
          const PICK = ["Hologram Meet", "Holo Messenger", "Holo Q", "Holo Tube", "Holo Music", "Holo Files", "Holo Hub", "Holo Atlas", "Holo Browser", "Holo Code"];
          const bm = await loadBar("bookmarks", { digest, seed: () => defaultBookmarks(catalog, { pick: PICK, topUp: 10 }) });
          let bmItems = bm.items;
          const drawBm = () => { renderBar(buildBarModel(bmItems, { catalog }), bmEl, { onOpen: openRow, onContext: (row, e) => showCtx(e.clientX, e.clientY, [{ label: "Remove from bookmarks", ic: "✕", danger: true, act: async () => { bmItems = bmItems.filter((x) => x.ref !== row.ref); await saveBar("bookmarks", bmItems, { digest }); drawBm(); } }, { label: "Share these bookmarks", ic: "♥", act: () => window.HoloBookmarks.shareLink() }]) }); wireDrag(bmEl, bmItems, async (next) => { bmItems = next; await saveBar("bookmarks", bmItems, { digest }); drawBm(); }); setH(); try { if (window.cefQuery) window.cefQuery({ request: "holo:bar:push:" + JSON.stringify(bmItems), persistent: false, onSuccess: function () {}, onFailure: function () {} }); } catch (e) {} };
          drawBm();
          window.HoloBookmarks = { add: async (ref, opt = {}) => { ref = String(ref || ""); if (!ref || bmItems.some((x) => x.ref === ref)) return false; bmItems = bmItems.concat([{ ref, kind: opt.kind || "", label: opt.label || "", words: opt.words || "", icon: opt.icon || "", open: opt.open || "" }]); await saveBar("bookmarks", bmItems, { digest }); drawBm(); return true; }, items: () => bmItems.slice() };
          // share these bookmarks as a self-verifying link (the κ proves the carried items; no server).
          window.HoloBookmarks.shareLink = async () => { try { const t = await BAR.barShareToken(bmItems, digest); const url = location.origin + "/shell.html?bar=" + t; try { await navigator.clipboard.writeText(url); toast("Bookmarks link copied"); } catch (e) { toast("Bookmarks link ready"); } return url; } catch (e) { return null; } };
          // a shared bar arrived via ?bar=<token> — verify BEFORE trust (Law L5), then ask to adopt.
          try {
            const tok = new URLSearchParams(location.search).get("bar");
            if (tok) {
              history.replaceState(null, "", location.pathname + location.search.replace(/[?&]bar=[^&]*/, "").replace(/^&/, "?") + location.hash);
              const v = await BAR.verifyBarToken(tok, digest);
              if (v.ok && v.items.length) {
                showCtx(Math.round(innerWidth / 2) - 120, 120, [
                  { label: "Adopt " + v.items.length + " shared bookmarks", ic: "♥", act: async () => { const have = new Set(bmItems.map((x) => x.ref)); bmItems = v.items.concat(bmItems.filter((x) => !v.items.some((y) => y.ref === x.ref))); await saveBar("bookmarks", bmItems, { digest }); drawBm(); toast("Bookmarks adopted"); } },
                  { label: "Keep mine", ic: "✕", act: () => {} },
                ]);
              } else { toast("Couldn't verify shared bookmarks"); }
            }
          } catch (e) {}

          // rail — icon-only quick actions to the right of the omnibox (a κ-bar, kind "rail"). Empty by default
          // (zero width); pin apps via window.HoloRail.add. Same mechanism, icon-only.
          const rl = await loadBar("rail", { digest, seed: () => [] });
          let rlItems = rl.items;
          const drawRail = () => { renderBar(buildBarModel(rlItems, { catalog }), railEl, { onOpen: openRow, onContext: (row, e) => showCtx(e.clientX, e.clientY, [{ label: "Unpin", ic: "✕", danger: true, act: async () => { rlItems = rlItems.filter((x) => x.ref !== row.ref); await saveBar("rail", rlItems, { digest }); drawRail(); } }]) }); wireDrag(railEl, rlItems, async (next) => { rlItems = next; await saveBar("rail", rlItems, { digest }); drawRail(); }); };
          drawRail();
          // P2 — the persistent Extensions affordance opens the manager (pin/discovery path). Always present
          // even with an empty rail, so the "icons to the right of the address bar" region never vanishes.
          try { const xb = document.getElementById("rail-ext"); if (xb && !xb.__wired) { xb.__wired = 1; xb.addEventListener("click", () => { try { if (typeof needNewTab !== "function" || needNewTab()) newTab("Extensions"); addNode({ kind: "app", title: "Extensions", src: "/usr/share/frame/extensions.html", sandbox: "allow-scripts allow-same-origin", allow: "", state: "max" }); } catch (e) { try { (window.HoloOpen || omniGo)("holo://os/usr/share/frame/extensions.html"); } catch (x) {} } }); } } catch (e) {}
          window.HoloRail = { add: async (ref, opt = {}) => { ref = String(ref || ""); if (!ref || rlItems.some((x) => x.ref === ref)) return false; rlItems = rlItems.concat([{ ref, kind: opt.kind || "", label: opt.label || "", words: opt.words || "", icon: opt.icon || "", open: opt.open || "" }]); await saveBar("rail", rlItems, { digest }); drawRail(); return true; }, items: () => rlItems.slice() };
          // E3 — a pinned extension arriving from the Extensions manager iframe (cross-frame, possibly sandboxed):
          // accept holo:rail:pin ONLY from one of our own app iframes, then add it to the rail.
          addEventListener("message", (e) => { try { const d = e.data; if (!d || d.type !== "holo:rail:pin" || !d.ref) return; if (![...document.querySelectorAll("iframe")].some((fr) => fr.contentWindow === e.source)) return; window.HoloRail && window.HoloRail.add(String(d.ref), d.opt || {}); } catch (x) {} });
          // E4 — the bar as a navigable, roaming κ-object. address()/current() expose the live bar κ; open()
          // resolves holo://bar/<κ> off the VERIFIED history and offers to adopt (verify-before-trust, L5).
          window.HoloBars = {
            address: async () => { try { const c = barStrand ? await barStrand.current("bookmarks") : null; return c ? c.address : ""; } catch (e) { return ""; } },
            current: (kind = "bookmarks") => (barStrand ? barStrand.current(kind) : Promise.resolve({ items: [], kappa: null, address: "" })),
            resolve: (addr, kind) => (barStrand ? barStrand.resolve(addr, kind) : Promise.resolve(null)),
            bundle: () => (barStrand ? barStrand.bundle() : { head: null, entries: [] }),
            roam: (b) => (barStrand ? barStrand.roam(b) : Promise.resolve({ outcome: "in-sync" })),
            open: async (addr) => {
              try {
                if (!barStrand) return false;
                const hit = (await barStrand.resolve(addr, "bookmarks")) || (await barStrand.resolve(addr, "rail"));
                if (!hit) { toast("Couldn't locate that bar"); return true; }
                showCtx(Math.round(innerWidth / 2) - 120, 120, [
                  { label: "Adopt " + hit.items.length + " from this bar", ic: "♥", act: async () => { bmItems = hit.items.concat(bmItems.filter((x) => !hit.items.some((y) => y.ref === x.ref))); await saveBar("bookmarks", bmItems, { digest }); drawBm(); toast("Bar adopted"); } },
                  { label: "Keep mine", ic: "✕", act: () => {} },
                ]);
                return true;
              } catch (e) { return false; }
            },
          };
        } catch (e) { /* bars are additive — never break the shell */ }
      })();
      // ── omnibox suggestions — Chrome-style. As you type, ONE ranked list fuses every corpus:
      //    an address (κ · ipfs · ENS · url) → "Open, verified"; holospace/app name matches → launch;
      //    free text → "Search" via Holo Find. Arrows move, Enter takes the highlighted row (default the
      //    top), and EVERY row opens through the same verified path (openContentAddress / launch / Find).
      const sug = { el: document.createElement("div"), items: [], sel: 0, open: false };
      sug.el.id = "omni-sug"; sug.el.className = "omni-sug"; sug.el.setAttribute("role", "listbox"); document.body.appendChild(sug.el);
      // expose the single-open seam so non-module right carriages (the Q assistant panel) join the rule:
      // Q opening closes the verb carriages (closeAll), and any verb carriage opening closes Q (registerCloser).
      try { window.HoloAside = { closeAll: closeAllAsides, registerCloser: registerAsideCloser }; } catch (e) {}
      try { registerAsideCloser(function () { try { if (window.HoloVoice && window.HoloVoice.closePanel) window.HoloVoice.closePanel(); } catch (x) {} }); } catch (e) {}
      try { mountEgressConnect(document.getElementById("omni")); } catch (e) { console.warn("egress-connect:", e); }   // "Connect the web" icon beside the omnibar
      // A PROJECTED WEB TAB shares as a LIVE κ co-view — the SAME gesture as sharing an app. Start the OSR share
      // on its lens (over the same transport the app uses) and open the ONE viewer (view.html). One Share, any surface.
      async function shareProjectedTab(n) {
        const el = mounted.get(n.id); const f = el && el.querySelector("iframe"); const w = f && f.contentWindow;
        if (!w || typeof w.__holoShareOsr !== "function") { toast("Projection not ready to share yet"); return; }
        const key = await w.__holoShareOsr("tab");
        newTab("👁 Co-view"); addNode({ kind: "app", title: "👁 Co-view · " + (cleanName(n.title) || "web"), src: "/apps/holo-import/view.html?osr=" + encodeURIComponent(key), sandbox: "allow-scripts allow-same-origin", allow: "", state: "max" });
        toast("✦ Co-viewing this page · streamed κ");
      }
      lazyVerb(document.getElementById("share-btn"), async () => {   // ❤️ Share → the shared right side-carriage (ADR-0109), lazy on first engage (QR/social-card sealer off the boot path)
        try { const pn = activeHolospace(); if (pn && pn.projected && pn.browser) { await shareProjectedTab(pn); return; } } catch (e) {}
        const { mountShare } = await import("/_shared/holo-share-ui.mjs");
        // getApp → the UNIFIED finest grain: share the focused app as a SHARE-TO-RUN link (#k=). The guest
        // lands in that app RUNNING, fullscreen, with the viral chrome (ADR-064) — one Share surface, three
        // κ-granularities (this app · this holospace · everything). Null when nothing shareable is focused.
        const getApp = () => { try { const n = activeHolospace(); const link = shareLinkFor(n); if (!link) return null; return { link, name: cleanName(n.title) || n.appId || "App", kappa: n.appDid || n.contentRef || n.appId || "", appKappa: (window.HoloWorkspaceBridge && window.HoloWorkspaceBridge.appKappaOf(n)) || null }; } catch (e) { return null; } };
        mountShare(document.getElementById("share-btn"), { getHolospace: captureHolospace, getWorkspace: captureWorkspace, getApp, onImport: onImportShared, requireEverythingAuth: everythingAuthGate, onLinkDevice: () => { try { newTab("Link a device"); addNode({ kind: "app", title: "🔗 Link a device", src: "/pair.html", sandbox: "allow-scripts allow-same-origin allow-forms", allow: "camera", state: "max" }); } catch (e) { try { window.open(location.origin + "/pair.html", "_blank", "noopener"); } catch (x) {} } } });
      });
      // Holo Notify → the bell opens the persistent Notification Center (the shared right carriage). Every
      // toast files itself here; per-operator history. A deep-link routes through the omnibox / Q orb.
      try {
        mountNotifications(document.getElementById("notif-btn"), {
          getOperator: () => { try { const hi = window.HoloIdentity; return (hi && hi.operator && !hi.guest) ? hi.operator : null; } catch (e) { return null; } },
          onDeepLink: (link) => {
            try {
              if (!link) return;
              if (typeof link === "string") { omniGo(link); return; }
              if (link.kind === "address" && link.value) omniGo(link.value);
              else if (link.kind === "run" && link.value) { try { km.run(link.value); } catch (e) {} }
              else if (link.kind === "backup" && link.value) { try { window.HoloBackup && window.HoloBackup.reveal(link.value); } catch (e) {} }
              // a coherence concern Q raised (recovery, a red row …) opens Q — the one who flagged it can act on it
              else if (link.kind === "q" || link.kind === "coherence") { try { (window.__holoQOrb && window.__holoQOrb.open) ? window.__holoQOrb.open() : (window.Q && window.Q.summon && window.Q.summon()); } catch (e) {} }
            } catch (e) {}
          },
        });
      } catch (e) { console.warn("holo-notify:", e); }
      const SUG_SUB = { kappa: "content address · verified", ipfs: "IPFS · verified", eth: "ENS name → content", web: "open web · mint κ", local: "holospace" };
      const DIR_SUB = { ens: "ENS name → content", dnslink: "on IPFS · DNSLink", ipfs: "IPFS · verified", ipns: "IPNS · verified", web: "open web", demo: "demo · verified" };
      const DIR_IC = { ens: "◈", dnslink: "🌐", ipfs: "⬡", ipns: "⬡", web: "🌐", demo: "✦" };
      // ── the substrate object universe — every content-addressed object (etc/substrate-index.json),
      //    lazily loaded so your OWN universe is searchable INSTANTLY + OFFLINE. Each hit opens by its
      //    identity (did:holo:sha256) through the canonical κ-route, RE-DERIVED on receipt (Law L1/L5).
      let SUBSTRATE = null, _substrateP = null;
      const SUB_SKIP = /\.(gz|whl|tar|m4s|wsz|map|metadata|woff2?|ttf|wasm|bin|lock|sig|br|zip|pack|ico)$/i;
      // PERF: the 4.5MB substrate object index is warmed on first omnibar FOCUS, not at boot — it ONLY powers
      // omnibar object suggestions, so it no longer sits on the shell's boot path. Promise-memoized so a resolve
      // can await it (bestLocalFile); searchSubstrate/bestLocalFile already no-op gracefully until it resolves.
      function loadSubstrate() {
        if (SUBSTRATE) return Promise.resolve(SUBSTRATE);
        if (_substrateP) return _substrateP;
        _substrateP = (async () => {
          try {
            const si = await (await fetch("/etc/substrate-index.json", { cache: "force-cache" })).json();
            const out = [];
            for (const [path, v] of Object.entries(si.objects || {})) {
              if (SUB_SKIP.test(path)) continue;
              const hex = String((v && (v.sha256 || v.did)) || "").split(":").pop();
              if (!/^[0-9a-f]{64}$/.test(hex || "")) continue;
              const segs = path.split("/"); const name = segs[segs.length - 1];
              out.push({ path, name, hex, ext: (name.match(/\.[a-z0-9]+$/i) || [""])[0], dir: segs.slice(Math.max(0, segs.length - 3), segs.length - 1).join("/"), nl: name.toLowerCase(), pl: path.toLowerCase() });
            }
            SUBSTRATE = out;
          } catch { /* offline / not served → substrate rows simply absent */ }
          return SUBSTRATE;
        })();
        return _substrateP;
      }
      function searchSubstrate(q, limit = 4) {
        if (!SUBSTRATE) return [];
        const terms = q.toLowerCase().split(/\s+/).filter(Boolean); if (!terms.length) return [];
        const scored = [];
        for (const o of SUBSTRATE) {
          let s = 0, ok = true;
          for (const t of terms) {
            if (o.nl === t) s += 12; else if (o.nl.startsWith(t)) s += 7; else if (o.nl.includes(t)) s += 4;
            else if (o.pl.includes(t)) s += 2; else { ok = false; break; }
          }
          if (!ok) continue;
          if (/\.(md|jsonld|json|html?|mjs|js)$/i.test(o.name)) s += 2;     // boost human-/machine-readable semantic objects
          s -= Math.min(3, o.path.split("/").length / 6);                   // prefer shallower (the canonical, not a deep dupe)
          scored.push({ o, s });
        }
        return scored.sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.o);
      }
      // openObjectByKappa — dereference a substrate object by its content hash via the canonical κ-route,
      // RE-DERIVE the bytes client-side (Law L5), and render it inline, verified — no app, no origin (L1).
      // a clean, SOLID-background viewer for an opened κ-object — so JSON/code/text are readable (not
      // bleeding over the desktop) and pretty, with a verified did:holo header. HTML renders as its own
      // page; images are centered on a dark canvas; everything else is pretty-printed monospace.
      const _b64 = (u8) => { let s = ""; const C = 0x8000; for (let i = 0; i < u8.length; i += C) s += String.fromCharCode.apply(null, u8.subarray(i, i + C)); return btoa(s); };
      function objectViewerDoc(bytes, name, hex, type) {
        if (type === "text/html") return null;                 // an HTML object renders as its own document
        const head = `<div class="hd"><b>✓</b>&nbsp;${escHtml(name)} · ${bytes.length.toLocaleString()} B · verified did:holo:sha256:${escHtml(hex.slice(0, 18))}…</div>`;
        const css = `<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="dark light"><style>html,body{margin:0;min-height:100%;background:#0b0e14;color:#cdd7ea}body{font:var(--holo-text-sm, 0.813rem)/1.65 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.hd{position:sticky;top:0;background:#0b0e14;border-bottom:1px solid #1b2435;color:#7d8aa6;padding:13px 22px;font-size: var(--holo-text-sm, 0.75rem)}.hd b{color:#6ee7b7}.bd{padding:20px 22px}pre{margin:0;white-space:pre-wrap;word-break:break-word}img{max-width:100%;display:block;margin:0 auto;border-radius:8px}a{color:#8ab4f8}</style>`;
        let inner;
        if (type.startsWith("image/")) inner = `<img src="data:${type};base64,${_b64(bytes)}" alt="${escHtml(name)}">`;   // SVG too → rendered AS AN IMAGE (browser disables scripting), never inlined as live markup
        else { let t = new TextDecoder().decode(bytes); if (/json/.test(type) || /\.json(ld)?$/i.test(name)) { try { t = JSON.stringify(JSON.parse(t), null, 2); } catch {} } inner = `<pre>${escHtml(t)}</pre>`; }
        return `${css}${head}<div class="bd">${inner}</div>`;
      }
      async function openObjectByKappa(o) {
        await ensureOmniLegs();
        if (mediaMime(o.name)) {   // a local media file → stream it through the κ-anchored player (re-derived on the wire, seekable via Range/206), not the static object viewer
          return void openMedia("/.holo/sha256/" + o.hex + (o.ext || ""), { title: o.name, mime: mediaMime(o.name), kappa: "did:holo:sha256:" + o.hex });
        }
        toast("⌕ resolving " + o.name + "…");
        try {
          const r = await fetch("/.holo/sha256/" + o.hex + (o.ext || ""), { cache: "no-store" });
          if (!r.ok) { toast("Couldn't find that object: " + o.name); return; }
          const bytes = new Uint8Array(await r.arrayBuffer());
          const dig = await crypto.subtle.digest("SHA-256", bytes);
          const got = [...new Uint8Array(dig)].map((b) => b.toString(16).padStart(2, "0")).join("");
          if (got !== o.hex) { toast("✗ refused — this didn't match its fingerprint"); return; }   // a tampered byte loses
          const type = sniffType(bytes, o.name);
          const doc = objectViewerDoc(bytes, o.name, o.hex, type);
          const blob = doc != null ? new Blob([doc], { type: "text/html" }) : new Blob([bytes], { type });
          const url = pushBlob(URL.createObjectURL(blob));
          if (needNewTab()) newTab("◆ " + o.name);
          addNode({ kind: "app", title: "◆  " + o.name, src: url, sandbox: "", allow: "", state: "max", webAddr: "did:holo:sha256:" + o.hex });
          setActiveTabTitle("◆ " + o.name); setActiveTabAddr("did:holo:sha256:" + o.hex.slice(0, 16) + "…");
          try { omniRemember({ addr: "did:holo:sha256:" + o.hex, input: o.path || o.name, kind: "file", title: o.name, kappa: "did:holo:sha256:" + o.hex }); } catch (e) {}   // the bar remembers this local file (κ-keyed)
          try { const isText = /^(text\/|application\/json)/.test(type); omniIndexObject({ addr: "did:holo:sha256:" + o.hex, input: o.path || o.name, kind: "file", title: o.name, text: (o.path || "") + (isText ? "\n\n" + new TextDecoder().decode(bytes.subarray(0, 6000)) : "") }); } catch (e) {}   // index it → Q.recall finds your local files by name + (for text) body
          toast(`✓ verified · ${o.name} · ${bytes.length.toLocaleString()} B`);
        } catch { toast("failed to resolve " + o.name); }
      }
      // (substrate index is warmed on first omnibar focus — see the focus/input handlers — not at boot)
      // holo-rank — personal PageRank authority over κ (trust eigenvector × relation-weight × decay). Loaded once
      // (same source as find.html); the omnibar's memory uses it so canonical/high-authority objects rank above
      // dupes in your "recent" rows. On-device, private; absent file → graceful {} (no boost).
      let HOLO_RANK = {};
      fetch("/etc/holo-rank.json").then((r) => r.json()).then((j) => { HOLO_RANK = j.ranks || {}; }).catch(() => {});
      // app-capabilities — per-app HARD requirements (webgpu/opfs/sab/storage). openHolospaceApp consults this
      // to render a labeled fallback when the visitor's browser lacks a capability the app needs (P3). Absent
      // file → graceful {} (no app gated), so this can only ADD honest degradation, never block a launch.
      let APPCAPS = {};
      fetch("/etc/app-capabilities.json").then((r) => r.json()).then((j) => { APPCAPS = j.requires || {}; }).catch(() => {});
      function buildSuggestions(q) {
        q = (q || "").trim(); if (!q) return [];
        const items = [], seen = new Set();
        const add = (it, key) => { if (key) { if (seen.has(key)) return; seen.add(key); } items.push(it); };
        let pr = { kind: "unknown" }; try { pr = parseRef(q); } catch {}
        let w3 = null; try { w3 = parseWeb3Ref && parseWeb3Ref(q); } catch {}   // null until the lazy web3 leg loads (preloaded on omnibar focus)
        const cls = classify(q, catalog);
        const isAddr = pr.kind === "kappa" || pr.kind === "cid" || cls.kind === "web" || cls.kind === "holo" || !!w3;
        if (w3) {                                                         // a web3 address → "Open, verified" at the top, ahead of the open-web guess
          const W3_IC = { "ens-name": "◈", "evm-account": "⬗", "evm-tx": "⇄", "sol-account": "◎", "sol-tx": "⇄", "caip-account": "⬗", "caip-chain": "⛓" };
          const W3_SUB = { "ens-name": "ENS · resolve → κ-card", "evm-account": "EVM account · sealed", "evm-tx": "EVM tx · sealed", "sol-account": "Solana account · sealed", "sol-tx": "Solana tx · sealed", "caip-account": "CAIP account · sealed", "caip-chain": "CAIP chain · sealed" };
          add({ icon: W3_IC[w3.kind] || "◈", title: "Open  " + q, sub: W3_SUB[w3.kind] || "web3 · sealed", run: () => openWeb3(q) }, "w3:" + q);
        } else if (isAddr) {                                              // an explicit address → "Open, verified" at the top (Chrome's "what you typed")
          const k = pr.kind === "kappa" ? "kappa" : pr.kind === "cid" ? "ipfs" : cls.kind === "holo" ? "kappa" : /(^|\.)eth(\/|$)/i.test(q) ? "eth" : "web";
          const ic = { kappa: "◆", ipfs: "⬡", eth: "◈", web: "🌐" }[k] || "○";
          add({ icon: ic, title: "Open  " + q, sub: SUG_SUB[k] || "open", run: () => omniGo(q) });
        }
        const cm = (classifyMedia ? classifyMedia(q) : { isMedia: false });   // media leg is lazy (preloaded on omnibar focus) → no media row until it's warm
        if (cm.isMedia) add({ icon: cm.media === "audio" ? "♪" : "▶",
          title: (cm.kind === "platform" ? "Open  " : "Play  ") + q,
          sub: cm.kind === "platform" ? cm.platform + " · opens the page faithfully (no in-tab extractor yet)" : cm.label + " · κ-anchored player · seekable",
          run: () => cm.kind === "file" ? openMedia(q) : omniGo(q) }, "media:" + q);
        for (const r of omniRecent(q, { limit: 4, rank: HOLO_RANK }))     // YOUR memory — things you've opened, ranked by match × recency × frequency × holo-rank authority (private, instant)
          add({ icon: ({ web: "🌐", cid: "⬡", web3: "◈", app: "◆", kappa: "◆" })[r.kind] || "↻", title: r.title, sub: "recent · " + (r.kind || "visited"), run: () => omniGo(r.input || r.addr) }, "rec:" + r.addr);
        if (/^(holo ?)?(wallet|vault|money|sovereign|identity|seed)/i.test(q))   // the wallet is core OS chrome, not a catalog app → its own built-in tile, opening the docked sovereign vault
          add({ icon: "🛡", title: "Holo Wallet", sub: "sovereign vault · identity · money", run: () => { try { window.HoloWallet && window.HoloWallet.open(); } catch (_) {} } }, "core:wallet");
        if (cls.kind === "app" && cls.app)                                // THREE WORDS (brass.junior.quiz) → the app it addresses, surfaced at the top
          add({ iconUrl: (cls.app.landing || "").replace(/[^/]+$/, "icon.svg"), title: cls.app.name, sub: "holospace · " + q, run: () => launch(cls.app) }, "app:" + cls.app.id);
        for (const a of matches(q, catalog).slice(0, 5))                  // installed holospaces (this device's app catalog)
          add({ iconUrl: (a.landing || "").replace(/[^/]+$/, "icon.svg"), title: a.name, sub: "holospace", run: () => launch(a) }, "app:" + a.id);
        for (const o of searchSubstrate(q, 4))                            // YOUR universe — every content-addressed object, opened by κ (re-derived)
          add({ icon: "◆", title: o.name, sub: o.dir || "object · verified", run: () => openObjectByKappa(o) }, "obj:" + o.hex);
        for (const e of (searchDirectory ? searchDirectory(q) : []).slice(0, 6)) {                 // the federated directory: knowledge · ENS · dapps · apps (one object graph; lazy — empty until warm)
          const isApp = e.section === "Apps" || e.kind === "app";
          add({ icon: isApp ? "◆" : (DIR_IC[e.kind] || "🌐"), title: e.name, sub: isApp ? "holospace" : (DIR_SUB[e.kind] || e.kind),
            run: () => { const app = catalog.find((a) => a.id === e.id); if (app) return launch(app); omniGo(e.target || e.name); } }, e.id ? "app:" + e.id : e.kind + ":" + e.target);
        }
        const core = items.slice(0, 6);                                  // leave room for the two answer rows
        if (!isAddr) {
          core.push({ icon: "✦", title: "Ask your context  “" + q + "”", sub: "Q.recall · YOUR stuff, on-device, model-free", run: () => openPrivateRecall(q) });   // private corpus first
          core.push({ icon: "⌕", title: "Search  “" + q + "”", sub: "Holo Find · corroborated answer", run: () => openFind(q) });   // then the open web
        }
        return core.slice(0, 8);
      }
      function paintSel() { [...sug.el.children].forEach((r, i) => r.classList.toggle("sel", i === sug.sel)); }
      function showSug() { const r = $("#omni").getBoundingClientRect(); sug.el.style.left = r.left + "px"; sug.el.style.width = r.width + "px"; sug.el.style.top = (r.bottom + 8) + "px"; sug.el.classList.add("open"); sug.open = true; }
      function hideSug() { sug.el.classList.remove("open"); sug.open = false; }
      function runSug(i) { const it = sug.items[i]; if (!it) return; hideSug(); const o = $("#omni-addr"); o.value = ""; o.blur(); it.run(); }
      function renderSug() {
        if (!sug.items.length) { hideSug(); return; }
        sug.el.innerHTML = sug.items.map((it, i) => `<div class="sug-row${i === sug.sel ? " sel" : ""}" data-i="${i}" role="option"><span class="sug-ic">${it.iconUrl ? `<img src="${it.iconUrl}" onerror="this.style.visibility='hidden'">` : (it.icon || "○")}</span><span class="sug-tt">${escHtml(it.title)}</span><span class="sug-sub">${escHtml(it.sub || "")}</span></div>`).join("");
        [...sug.el.children].forEach((r) => { r.onmousedown = (e) => { e.preventDefault(); runSug(+r.dataset.i); }; });
        showSug();
      }
      let sugT;
      $("#omni-addr").addEventListener("input", (e) => { ensureOmniLegs(); loadSubstrate(); const q = e.target.value; clearTimeout(sugT);
        if (inTabSearch(q)) { forwardSearch(q); hideSug(); return; }   // plain text → filter the app you're in
        sugT = setTimeout(() => { sug.items = buildSuggestions(q); sug.sel = 0; renderSug(); }, 100); });
      $("#omni-addr").addEventListener("focus", (e) => { ensureOmniLegs(); loadSubstrate();   // preload the heavy resolver legs + the substrate object index the moment the bar is focused — warm before you finish typing
        if (e.target.value.trim() && !inTabSearch(e.target.value)) { sug.items = buildSuggestions(e.target.value); sug.sel = 0; renderSug(); } });
      $("#omni-addr").addEventListener("blur", () => setTimeout(hideSug, 160));
      $("#omni-addr").addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown" && sug.open) { e.preventDefault(); sug.sel = Math.min(sug.sel + 1, sug.items.length - 1); paintSel(); }
        else if (e.key === "ArrowUp" && sug.open) { e.preventDefault(); sug.sel = Math.max(sug.sel - 1, 0); paintSel(); }
        else if (e.key === "Escape") { hideSug(); }
        else if (e.key === "Enter") {
          if (sug.open && sug.items[sug.sel]) { e.preventDefault(); runSug(sug.sel); }
          else if (inTabSearch(e.target.value)) { e.preventDefault(); forwardSearch(e.target.value); }   // stay in-tab
          else { omniGo(e.target.value); e.target.value = ""; e.target.blur(); }
        }
      });
      $("#omni-go").onclick = () => { const v = $("#omni-addr").value; hideSug(); if (inTabSearch(v)) { forwardSearch(v); return; } $("#omni-addr").value = ""; omniGo(v); };
      $("#omni-copy").onclick = async () => { const v = (omniAddr.revealed ? omniAddr.kappa : omniAddr.words) || $("#omni-addr").value; if (!v) return; try { await navigator.clipboard.writeText(v); } catch (e) { try { const i = $("#omni-addr"); i.focus(); i.select(); document.execCommand("copy"); } catch (_) {} } const b = $("#omni-copy"); b.classList.add("copied"); toast("Copied  " + v); setTimeout(() => b.classList.remove("copied"), 1100); };
      $("#omni-reveal").onclick = () => { omniAddr.revealed = !omniAddr.revealed; reflectOmni(); const o = $("#omni-addr"); if (o && document.activeElement === o && omniAddr.words) o.value = omniAddr.revealed ? omniAddr.kappa : omniAddr.words; };
      addEventListener("resize", () => { if (sug.open) showSug(); });
      // toolbar nav: reload the active tab's content; home opens a fresh tab. (Back/fwd reserved for web history.)
      // ── per-holotab navigation: Back · Forward · Reload · Home (the tab's original view) ──
      $("#nav-back").onclick = () => goNav(-1);
      $("#nav-fwd").onclick = () => goNav(1);
      $("#nav-reload").onclick = () => {
        // on a commons SNAPSHOT, reload means "get fresh": bypass the snapshot, fetch live, and re-seal (which
        // updates url→snapshot) — so the frozen-cache tradeoff is safe, the gesture is the familiar reload.
        const node = (typeof findNode === "function") ? findNode(focusedId) : null;
        if (node && node.commonsCid && node.webAddr) { toast("↻ fetching live + re-sealing…"); openHoloBrowser(node.webAddr, { live: true }); return; }
        const el = (focusedId && mounted.get(focusedId)) || world.querySelector("holo-window"); const f = el && el.querySelector("iframe"); if (f) { try { if (f.srcdoc) { const s = f.srcdoc; f.srcdoc = ""; f.srcdoc = s; } else { f.src = f.src; } } catch {} } else { render(desktop.doc()); } toast("↻ reloaded");
      };
      $("#nav-home").onclick = goHome;   // ⌂ → this holotab's original view (app · page · desktop), not a new tab
      updateNav();
      // ── Holo Files — the native explorer, a CORE part of the shell. The dock button + a host-native
      //    shortcut (⌘/Ctrl⇧E) open it as a window; Files posts `holo-open` to launch any holospace it
      //    surfaces (the explorer IS the substrate's file system — one window onto every κ-object). ──
      const filesApp = () => catalog.find((a) => a.id === "org.hologram.HoloFiles");
      function openFiles() { try { window.HoloJourney && window.HoloJourney.mark("first-space"); } catch (e) {} const f = filesApp(); if (f) launch(f); else toast("Holo Files not installed yet"); }   // first Files open → "I see my world" (Q Companion journey)
      $("#files").onclick = openFiles;
      addEventListener("keydown", (e) => { if (modDown(e) && e.shiftKey && e.key.toLowerCase() === "e") { e.preventDefault(); openFiles(); } }, true);
      // Q Companion: follow the thread when the user taps one of Q's invitations (q-companion-journey.md).
      // Q owns the words (holo-voice.js); the shell owns the navigation. "verify" → the self-verify pill ·
      // "import" → Create's import field · "create" → the build studio. Q invites; the tap is the user's.
      addEventListener("holo-journey-go", (e) => { const go = e && e.detail && e.detail.go; try {
        if (go === "verify") { const b = $("#cv-version"); if (b) b.click(); }
        else if (go === "create") { openCreate(); }
        else if (go === "import") { openCreate(); setTimeout(() => { const i = document.getElementById("cs-import"); if (i) i.click(); }, 80); }
      } catch (e2) {} });
      window.addEventListener("message", (e) => {
        const d = e.data; if (!d || d.type !== "holo-open") return;
        // unified search (find.html, embedded in a tab) → open the hit as a VERIFIED holospace tab, not a browser tab
        if (d.object && /^[0-9a-f]{64}$/i.test(d.object.hex || "")) return openObjectByKappa({ hex: String(d.object.hex).toLowerCase(), ext: d.object.ext || "", name: d.object.name || (String(d.object.hex).slice(0, 10) + "…") });
        if (d.address) return omniGo(String(d.address));   // url · holo://κ · ipfs · ens · app name → the one verified-open path
        if (!d.id) return;
        const want = String(d.id); const tail = want.split(/[:/]/).pop();
        const app = catalog.find((a) => a.id === want || a.did === want || a.id.toLowerCase().endsWith(tail.toLowerCase()) || (a.landing || "").includes("/" + tail + "/"));
        if (app) launch(app);
      });
      // ── Holo Files SERVICE — a CORE OS capability every holo-native app can call. The shell BROKERS
      //    file access so apps never touch raw storage (Law L4: everything through the substrate); bytes
      //    round-trip as content-addressed objects (Law L1/L2: identity re-derived from bytes · L3: the κ
      //    store IS the memory). Apps use the SDK helpers (saveFile · readFile · revealFile · pickFile),
      //    which postMessage `{type:"holo-files", op, …}` here and await `holo-files-result`. ───────────
      let _filesMod = null; const filesMod = async () => _filesMod || (_filesMod = await import("/_shared/holo-files.js"));
      const hexOfRef = (r) => { const m = /([0-9a-f]{64})/i.exec(String(r || "")); return m ? m[1].toLowerCase() : null; };
      // identify the calling app (the holo-window iframe the message came from) for capability gating.
      function appKeyFor(win) { try { for (const n of desktop.doc().world) { if (n.kind !== "app") continue; const el = mounted.get(n.id), f = el && el.querySelector("iframe"); if (f && f.contentWindow === win) return String(n.title || "").split("  ·  ")[0].trim() || n.appId || "an app"; } } catch (e) {} return "an app"; }
      // ── capability gate (least authority) — κ-reads need NO grant (you already hold the hash, no ambient
      //    authority); AMBIENT ops (save to the device, read a Home path) ask ONCE per app, remembered for
      //    the session; pick is consent-by-action (the user chooses). ─────────────────────────────────────
      const _fileGrants = new Map();
      function fileConsent(appKey, what) { if (_fileGrants.get(appKey + "·" + what)) return true; let ok = false; try { ok = confirm("“" + appKey + "” wants to " + what + ".\n\nAllow for this session?"); } catch (e) { ok = false; } if (ok) _fileGrants.set(appKey + "·" + what, true); return ok; }
      const _picks = new Map();   // a pending pickFile() request → resolve when the user chooses in Holo Files
      async function openFilesPicker(reqId) {
        const app = catalog.find((a) => a.id === "org.hologram.HoloFiles"); if (!app) return null;
        let def = {}; try { def = await fetch(app.landing.replace(/[^/]+$/, "holospace.json")).then((r) => r.json()); } catch (e) {}
        const { sandbox, allow } = capabilitiesToSandbox(await gateCaps(def));
        return addNode({ kind: "app", appId: app.id, appDid: app.did, title: "🗂 Choose a file", src: app.landing + "?pick=" + encodeURIComponent(reqId), sandbox, allow, state: "normal", frameless: false, w: 880, h: 580, x: 150, y: 80 });
      }
      // the SAME governed picker, for in-shell callers (e.g. the Create studio) → resolves with the chosen object (or null).
      function shellPick() { return new Promise(async (resolve) => { const reqId = "shellpick-" + Math.random().toString(36).slice(2, 8); const nodeId = await openFilesPicker(reqId); if (!nodeId) return resolve(null); _picks.set(reqId, { resolve, reqId, nodeId }); }); }
      window.addEventListener("message", async (e) => {
        const d = e.data; if (!d || d.type !== "holo-files" || !d.op) return;
        const reply = (ok, result, error) => { try { e.source && e.source.postMessage({ type: "holo-files-result", id: d.id, ok, result, error }, "*"); } catch (x) {} };
        const appKey = appKeyFor(e.source);
        try {
          if (d.op === "save") {                                  // bytes → a content-addressed object (κ); the store is the memory
            if (!fileConsent(appKey, "save files to this device")) return reply(false, null, "permission denied");
            const u8 = d.bytes instanceof Uint8Array ? d.bytes : (d.bytes ? new Uint8Array(d.bytes) : new TextEncoder().encode(String(d.text || "")));
            const k = await holoStore.put(u8); const hex = k.split(":").pop();
            reply(true, { kappa: "holo://" + hex, hex, size: u8.length, name: d.name || (hex.slice(0, 10) + ".bin") });
          } else if (d.op === "read") {                           // resolve by κ (store, else the source chain) or a Home path
            const hex = hexOfRef(d.ref);
            if (hex) { let b = await holoStore.get("sha256:" + hex); if (!b) b = await _kSource(hex); if (!b) return reply(false, null, "not resolvable by κ (Law L5)"); reply(true, { bytes: b, kappa: "holo://" + hex, hex, size: b.length }); }   // κ-read: no grant needed (capability IS the hash)
            else if (String(d.ref || "").startsWith("/home/")) { if (!fileConsent(appKey, "read your Home files")) return reply(false, null, "permission denied use pickFile() to let the user choose"); const M = await filesMod(); const name = String(d.ref).split("/").pop(); const r = await M.read({ source: "opfs", path: d.ref, name, mime: M.mimeOf(name) }); reply(true, { bytes: r.bytes, mime: r.mime, size: r.size, name }); }
            else reply(false, null, "unsupported ref pass a holo://κ or a /home/ path");
          } else if (d.op === "reveal") {                         // surface it in the explorer / open the object
            const hex = hexOfRef(d.ref); if (hex) omniGo("holo://" + hex); else openFiles(); reply(true, {});
          } else if (d.op === "pick") {                           // governed picker: open Holo Files modal, resolve on the user's choice
            const nodeId = await openFilesPicker(d.id); if (!nodeId) return reply(false, null, "Holo Files not available");
            _picks.set(d.id, { win: e.source, reqId: d.id, nodeId });
          } else reply(false, null, "unknown op: " + d.op);
        } catch (err) { reply(false, null, (err && err.message) || String(err)); }
      });
      // the picker's choice (or cancel) comes back from the Holo Files window → resolve the app's request, close the modal.
      window.addEventListener("message", async (e) => {
        const d = e.data; if (!d || d.type !== "holo-files-pick" || !d.reqId) return;
        const p = _picks.get(d.reqId); if (!p) return; _picks.delete(d.reqId);
        try { removeNode(p.nodeId); } catch (x) {}
        const send = (ok, result, error) => { if (p.resolve) { p.resolve(ok ? result : null); return; } try { p.win && p.win.postMessage({ type: "holo-files-result", id: p.reqId, ok, result, error }, "*"); } catch (x) {} };   // in-shell callback OR cross-frame reply
        if (d.cancel || !d.bytes) return send(false, null, "cancelled");
        try { const u8 = d.bytes instanceof Uint8Array ? d.bytes : new Uint8Array(d.bytes); const k = await holoStore.put(u8); const hex = k.split(":").pop();
          send(true, { kappa: "holo://" + hex, hex, name: d.name, mime: d.mime, bytes: u8, size: u8.length }); } catch (err) { send(false, null, (err && err.message) || String(err)); }
      });
      // ── cross-frame notifications: let ANY app raise an item in the OS Inbox (Holo Notify — the one
      //    surface) or a quiet toast. The app holds nothing; the shell owns the surface. Fire-and-forget,
      //    sanitized + length-capped (Holo Notify renders text only — no markup crosses), deepLink kind
      //    restricted to the routes onDeepLink actually handles so a notification can never be a dead end. ──
      window.addEventListener("message", (e) => {
        const d = e.data; if (!d || d.type !== "holo-notify") return;
        try {
          if (!window.HoloNotify) return;
          const cap = (s, n) => String(s == null ? "" : s).slice(0, n);
          if (d.op === "toast") { window.HoloNotify.toast(cap(d.message, 200)); return; }
          const x = d.note || {};
          const note = { title: cap(x.title, 120), body: cap(x.body, 400), sender: cap(x.sender || "App", 40), icon: cap(x.icon, 8),
            severity: ["info", "ok", "warn", "danger"].includes(x.severity) ? x.severity : "info" };
          const OK_KINDS = ["address", "run", "backup", "q", "coherence"];           // the routes shell onDeepLink handles
          if (x.deepLink && typeof x.deepLink === "object" && OK_KINDS.includes(x.deepLink.kind))
            note.deepLink = { kind: x.deepLink.kind, value: cap(x.deepLink.value, 256) };
          window.HoloNotify.notify(note);
        } catch (x) {}
      });
      q.addEventListener("input", () => renderResults(q.value));
      q.addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { e.preventDefault(); selIdx = Math.min(selIdx + 1, spotList.length - 1); markSel(); } else if (e.key === "ArrowUp") { e.preventDefault(); selIdx = Math.max(selIdx - 1, 0); markSel(); } else if (e.key === "Enter") { e.preventDefault(); spotList[selIdx] && launch(spotList[selIdx]); } });

      // ── deep-link: a single link opens the world straight to an app (the unified entry, routed
      //    from holospace.html). ?open=<id | did:holo | holo://hex> → auto-launch it as an editable
      //    holospace window. Identity is content (Law L1), so the link resolves wherever it boots.
      {
        const sp = new URLSearchParams(location.search);
        const web = sp.get("web");
        if (web) openWeb({ kind: "web", address: web, label: web });   // a shared web tab → re-open it (κ-verified)
        const want = sp.get("open") || sp.get("app");
        if (want) {
          const tail = String(want).split(/[:/]/).pop();
          const app = catalog.find((a) => a.id === want || a.did === want || (a.did || "").endsWith(tail)
            || a.id.toLowerCase().endsWith(String(want).toLowerCase()) || (a.landing || "").includes("/" + tail + "/"));   // also resolve a folder-id / short ref (what holospace.html forwards)
          if (app) launch(app);
        }
      }

      // ── authoring ───────────────────────────────────────────────────────────────────────
      const auth = $("#auth"), asrc = $("#asrc"), aname = $("#aname");
      const SAMPLE = `<div class="card"><b data-text="title"></b><p>Clicked <span data-text="n"></span> times.</p><button data-on:click="n++">＋ one</button></div>
<script type="module">export default { title: "My Component", n: 0 }<\/script>
<style>.card{padding:20px;color:#c9d1d9;font:var(--holo-text-sm, 1rem) system-ui;height:100%}.card button{margin-top:8px;cursor:pointer;background:var(--accent,#1f6feb);color:#fff;border:0;border-radius: var(--holo-radius-sm, 8px);padding:6px 12px}</style>`;
      let authorN = 0, editingId = null; const acreate = $("#acreate");
      $("#author").onclick = () => { editingId = null; aname.disabled = false; acreate.textContent = "Create component → κ"; aname.value = "my-card"; asrc.value = SAMPLE; auth.classList.add("open"); aname.focus(); };
      $("#acancel").onclick = () => { auth.classList.remove("open"); editingId = null; aname.disabled = false; acreate.textContent = "Create component → κ"; };
      async function author(name, src) { const base = (name || "component").replace(/[^a-z0-9-]/gi, "-").toLowerCase(); const tag = `user-${base}-${++authorN}`; await defineBlockFromSource(tag, src); const obj = repo.publishSource({ name: tag, source: src }); addNode({ kind: "block", tag, content: src, editKind: "native", name: base, title: base + "  ·  " + linkFor(obj.id) }); return { tag, did: obj.id }; }
      // open the editor on an existing object — editing derives a NEW κ (a κ is immutable).
      function openEdit(id) { const n = desktop.doc().world.find((w) => w.id === id); if (!n || !n.content) return; editingId = id; aname.value = n.name || "object"; aname.disabled = true; acreate.textContent = "Apply edit → new κ"; asrc.value = n.content; auth.classList.add("open"); asrc.focus(); }
      function rebuild(id) { const el = mounted.get(id); if (el) { el.remove(); mounted.delete(id); } render(desktop.doc()); }
      function applyEdit(id, text) {
        const n = desktop.doc().world.find((w) => w.id === id); if (!n) return;
        const obj = repo.publishSource({ name: n.name || "object", source: text });
        if (n.editKind === "manim") { let sc; try { sc = JSON.parse(text); } catch { return alert("Invalid scene JSON"); } patch(id, (x) => { x.scene = sc; x.content = text; x.title = (x.name || "object") + "  ·  Manim  ·  " + linkFor(obj.id); }); }
        else if (n.editKind === "pure") { let d; try { d = JSON.parse(text); } catch { return alert("Invalid recipe JSON"); } patch(id, (x) => { x.pure = d; x.tag = d.tag; x.content = text; x.title = (x.name || "object") + "  ·  " + linkFor(obj.id); }); }
        else if (n.editKind === "paste") { patch(id, (x) => { x.srcdoc = wrapDoc(text); x.content = text; x.title = (x.name || "object") + "  ·  " + linkFor(obj.id); }); }
        else { try { defineBlockFromSource(n.tag, text); } catch (e) { return alert("Edit failed: " + e.message); } patch(id, (x) => { x.content = text; x.title = (x.name || "object") + "  ·  " + linkFor(obj.id); }); }
        rebuild(id);
      }
      acreate.onclick = async () => {
        if (editingId) { const id = editingId; editingId = null; aname.disabled = false; acreate.textContent = "Create component → κ"; auth.classList.remove("open"); applyEdit(id, asrc.value); return; }
        try { await author(aname.value.trim(), asrc.value); auth.classList.remove("open"); } catch (e) { alert("Component failed to define: " + e.message); }
      };

      // ── component library — the internet as a content-addressed, importable object library ─
      // Browse curated components with LIVE previews + concise meta; one click imports one as a
      // window — and the import re-derives the SAME κ the catalog published (Law L5), so a picked
      // component IS a verifiable, shareable object (holo://κ). "From source / URL" content-addresses
      // ANY pasted/fetched component and runs it ISOLATED in a sandbox — the whole web, same κ-space.
      const lib = $("#lib"), libgrid = $("#libgrid"), libq = $("#libq");
      let libItems = [], libDefs = new Set();
      async function openLib() {
        lib.classList.add("open");
        if (!libItems.length) {
          try {
            const cat = await fetch("components.jsonld", { cache: "no-store" }).then((r) => r.json());
            libItems = (cat["dcat:dataset"] || []).map((d) => ({ did: d["@id"], name: d["schema:name"], summary: d["schema:description"], cat: d["schema:applicationCategory"], license: d["schema:license"], accent: d["hosc:accent"], slug: d["dcterms:identifier"], text: d["schema:text"], tag: "lib-" + d["dcterms:identifier"], library: d["hosc:library"] || "Hologram", kind: d["hosc:kind"] || "native", sourceUrl: d["schema:isBasedOn"] || "" }));
          } catch {}
          // define NATIVE components as in-shell custom elements; PURE (OSS) ones load on demand.
          for (const it of libItems) if (it.kind !== "pure" && !libDefs.has(it.tag)) { try { await defineBlockFromSource(it.tag, it.text); libDefs.add(it.tag); } catch {} }
        }
        paintLib(""); libq.value = ""; libq.focus();
      }
      const closeLib = () => lib.classList.remove("open");
      function paintLib(term) {
        const list = libItems.filter((it) => (it.name + it.cat + it.summary + it.library).toLowerCase().includes((term || "").toLowerCase()));
        libgrid.innerHTML = list.map((it) => `<div class="libcard" data-slug="${it.slug}" style="--ca:${it.accent}">${
          (it.kind === "pure" || it.kind === "manim")
            ? `<div class="prev iso" data-slug="${it.slug}"><div class="ph"><div class="ph-lib">${it.library}</div><div class="ph-hint">▶ hover to preview</div></div></div>`
            : `<div class="prev"><${it.tag}></${it.tag}></div>`
        }<div class="meta"><div class="nm">${it.name}<span class="lic">${it.library} · ${it.license}</span></div><div class="sm">${it.summary}</div><div class="kk">holo://${it.did.split(":").pop().slice(0, 12)}…${it.sourceUrl ? ` · <a href="${it.sourceUrl}" target="_blank" rel="noopener">source ↗</a>` : ""}</div></div></div>`).join("")
          || `<div style="padding:20px;color:#6e7681">No components match. Try “From source / URL”.</div>`;
        [...libgrid.querySelectorAll(".libcard")].forEach((c) => c.onclick = () => importLib(c.dataset.slug));
        // OSS previews build the REAL element IN-SHELL on hover (no iframe) — instant open, offline-safe
        [...libgrid.querySelectorAll(".prev.iso")].forEach((pv) => pv.addEventListener("mouseenter", () => {
          if (pv.dataset.loaded) return; pv.dataset.loaded = "1";
          const it = libItems.find((x) => x.slug === pv.dataset.slug); if (!it) return;
          try { pv.innerHTML = ""; pv.appendChild(it.kind === "manim" ? holoManimScene(JSON.parse(it.text)) : buildPure(JSON.parse(it.text))); } catch (e) {}
        }));
      }
      function importLib(slug) {
        const it = libItems.find((x) => x.slug === slug); if (!it) return;
        const obj = repo.publishSource({ name: it.name, source: it.text }); // re-derives → catalog κ (Law L5)
        closeLib();
        if (it.kind === "manim") { addNode({ kind: "manim", scene: JSON.parse(it.text), content: it.text, editKind: "manim", name: it.name, title: it.name + "  ·  Manim  ·  " + linkFor(obj.id) }); }
        else if (it.kind === "pure") { const d = JSON.parse(it.text); addNode({ kind: "element", pure: d, tag: d.tag, content: it.text, editKind: "pure", name: it.name, frameless: true, title: it.name + "  ·  " + it.library + "  ·  " + linkFor(obj.id) }); }
        else addNode({ kind: "block", tag: it.tag, content: it.text, editKind: "native", name: it.name, title: it.name + "  ·  " + linkFor(obj.id) });
        return obj;
      }
      // "From source / URL" — content-address ANY component and run it isolated (capability tier).
      const srcTa = $("#libsrc-ta"), srcK = $("#libsrc-k");
      const wrapDoc = (s) => /<html|<!doctype/i.test(s) ? s : `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0d1117;color:#c9d1d9;font:var(--holo-text-sm, 1rem) system-ui">${s}</body>`;
      // ── liveEdit (the ONE primitive): edit any holospace/app IN PLACE — seal source → a NEW κ, re-render
      //    the LIVE mounted iframe (zero mirror), O(1) no-op on identical bytes. The Create chat sidecar
      //    (human), Holo DevTools (ADR-0095), and AI agents (window.HoloLiveEdit.agentEdit, conscience-gated)
      //    all edit through THIS — one act, one κ, one live surface. Resolves a mounted window on demand. ──
      window.HoloLiveEdit = createLiveEditor({
        seal: (name, source) => repo.publishSource({ name: name || "app", source }),
        resolve: (id) => {
          const el = mounted.get(id); if (!el) return null; const n = findNode(id);
          return { name: (n && n.name) || "app", render: (src) => {   // re-render the LIVE iframe in place
            const f = el.querySelector("iframe"); if (!f) return;
            try { desktop.change((d) => { const w = d.world.find((x) => x.id === id); if (w) { w.content = src; w.srcdoc = wrapDoc(src); } }); } catch (e) {}
            // Playground mutate-in-place: when the edit ORIGINATED inside the frame, the live DOM ALREADY reflects it —
            // reseal the κ + model only, skip the srcdoc reload (avoids resetting in-frame JS state). DevTools/chat edits reload normally.
            if (el.__holoPgInPlace) { el.__holoPgInPlace = false; return; }
            f.srcdoc = wrapDoc(src);   // the actual in-place re-render (the mounted surface IS the edited κ-object)
          } };
        },
        gate: () => (typeof window !== "undefined" ? window.HoloConscience : null),
        now: () => Date.now(),
      });
      // ── Holo Playground host: an in-app element edit arrives as a postMessage from the app frame; route it to
      //    the ONE primitive above. Identity is verified by event.source (a srcdoc frame's origin is "null", so we
      //    check the live frame handle, not an origin string). beforeEdit flags mutate-in-place; lineage is recorded
      //    as an out-of-band prov edge (NEVER folded into the κ — that would break content-addressing + the κ-memo). ──
      const _pgHost = createPlaygroundHost({
        editor: window.HoloLiveEdit,
        frameFor: (id) => { const el = mounted.get(id); const f = el && el.querySelector("iframe"); return (f && f.contentWindow) || null; },
        beforeEdit: (id) => { const el = mounted.get(id); if (el) el.__holoPgInPlace = true; },
        onLineage: (edge) => { try { window.HoloProv && window.HoloProv.derive && window.HoloProv.derive(edge); } catch (e) {} },
        replyTo: (id, msg) => { const el = mounted.get(id); const f = el && el.querySelector("iframe"); try { f && f.contentWindow && f.contentWindow.postMessage(msg, "*"); } catch (e) {} },
      });
      window.addEventListener("message", (ev) => {
        try {
          const m = ev && ev.data;
          // an in-frame "Exit Playground" (menu · Esc · badge) asks the shell to turn the GLOBAL mode off for all apps
          if (m && m.t === "holo-live-edit" && m.op === "playground-request") {
            const el = mounted.get(m.surfaceId); const f = el && el.querySelector("iframe");
            if (f && ev.source === f.contentWindow) setPlaygroundMode(!!m.on);
            return;
          }
          // M1 stretch: "✦ Ask AI" on an element → pipe it into the open studio's composer as chat context.
          if (m && m.t === "holo-live-edit" && m.op === "chat-select" && studio && studio.node && studio.node.id === m.surfaceId && studio.setSelection) {
            const el = mounted.get(m.surfaceId); const f = el && el.querySelector("iframe");
            if (f && ev.source === f.contentWindow) { studio.setSelection({ tag: m.tag, brief: m.brief, html: m.html }); return; }   // unforgeable sender
          }
          _pgHost.handle(ev);
          // M1 point-and-edit: a Playground edit that landed on the CREATE preview surface → mirror it into
          // the open studio (verified sender) so the editor + Publish capture the change, not stale source.
          if (m && m.t === "holo-live-edit" && m.op === "reseal" && typeof m.source === "string"
              && studio && studio.node && studio.node.id === m.surfaceId && studio.syncFromSurface) {
            const el = mounted.get(m.surfaceId); const f = el && el.querySelector("iframe");
            if (f && ev.source === f.contentWindow) studio.syncFromSurface(m.source);   // unforgeable: only the surface's own frame
          }
        } catch (e) {}
      });
      // Playground is OPT-IN and OFF BY DEFAULT, and it ALWAYS boots OFF: an editing/play mode (right-click edit,
      // drag, forces, games) must never auto-resume and ambush you at startup. So Playground does NOT survive a
      // boot — it is armed only by the desktop-menu toggle within a session, broadcast to every mounted app frame
      // and to new mounts via the injector. We clear any persisted/restored on-state (the session faithfully
      // round-trips the localStorage flag, but the shell declines to re-arm the mode on boot) so it can't linger.
      let pgMode = false;
      try { localStorage.setItem("holo.playground", "0"); } catch (e) {}                       // reset the flag the session restored
      try { document.documentElement.removeAttribute("data-holo-playground"); } catch (e) {}   // never boot with the edit-mode chrome on
      const pgActive = () => pgMode;            // the injector reads this to arm a freshly-mounted frame
      function broadcastPlayground(on) {
        for (const [id, el] of mounted) { const f = el.querySelector && el.querySelector("iframe"); try { f && f.contentWindow && f.contentWindow.postMessage({ t: "holo-live-edit", op: "playground-mode", surfaceId: id, on: !!on }, "*"); } catch (e) {} }
      }
      function setPlaygroundMode(on) {
        pgMode = !!on;
        try { localStorage.setItem("holo.playground", pgMode ? "1" : "0"); } catch (e) {}
        try { document.documentElement.toggleAttribute("data-holo-playground", pgMode); } catch (e) {}   // shell chrome can reflect edit mode
        broadcastPlayground(pgMode);                                   // app frames (iframes)
        try { _pgShell.setActive(pgMode); } catch (e) {}              // IN-SHELL surfaces (pure components, manim, κ-objects, native blocks)
        try { toast(pgMode ? "✦ Playground on — right-click any object in any app to edit it as code" : "Playground off"); } catch (e) {}
        try { scheduleSave(); } catch (e) {}                          // persist the armed flag into the session snapshot
      }
      // ── IN-SHELL Playground: non-iframe surfaces render directly in the shell document, so a host-mode agent
      //    (same module, same UI/serialiser) makes their elements right-click-editable too — every visual component
      //    a κ-object editable as code. No cross-frame boundary, so it commits DIRECTLY through the ONE primitive. ──
      const pgFirstContent = (winEl) => { for (const c of winEl.children) { if (c.nodeType === 1 && !c.hasAttribute("data-holo-ephemeral") && c.tagName !== "STYLE") return c; } return null; };
      function pgResolveSurface(elTarget) {
        try {
          const winEl = elTarget && elTarget.closest && elTarget.closest("holo-window"); if (!winEl) return null;
          const id = winEl.id, n = findNode(id); if (!n) return null;
          if (n.kind === "app" || n.kind === "folder") return null;     // apps = iframes (in-frame agent); folders aren't content
          const wrap = winEl.querySelector(":scope > .holo-play-html");
          const root = wrap ? wrap.firstElementChild : pgFirstContent(winEl);
          if (!root || !root.contains(elTarget)) return null;           // chrome / titlebar → fall through to the window menu
          return { surfaceId: id, root };
        } catch (e) { return null; }
      }
      function pgCommitInShell(id, source) {                            // the ONE primitive: reseal in-shell source → new κ
        try {
          if (!window.HoloLiveEdit.has(id)) window.HoloLiveEdit.register(id, { name: (findNode(id) || {}).name || "object", render: (src) => {
            try { desktop.change((d) => { const w = d.world.find((x) => x.id === id); if (w) { w.htmlOverride = src; w.content = src; } }); } catch (e) {}   // persist; mutate-in-place ⇒ no rebuild now
          } });
          return window.HoloLiveEdit.edit(id, String(source || ""));
        } catch (e) { return {}; }
      }
      const _pgShell = createPlaygroundAgent({ doc: document, win: window, badge: false, resolveSurface: pgResolveSurface, commit: pgCommitInShell,
        postUp: (msg) => { try { if (msg && msg.op === "playground-request") setPlaygroundMode(false); } catch (e) {} } });   // Esc / element-menu exit → turn the GLOBAL mode off
      try { _pgShell.mount(); if (pgMode) _pgShell.setActive(true); } catch (e) {}   // pgMode is false on boot — Playground starts dormant; the desktop toggle arms it
      function srcKappa() { const s = srcTa.value; if (!s.trim()) { srcK.textContent = ""; return null; } const obj = repo.publishSource({ name: "pasted", source: s }); srcK.textContent = "holo://" + obj.id.split(":").pop().slice(0, 16) + "…"; return obj; }
      // ════ Ambient Q — a light, NON-BLOCKING copilot holospace (no bottom-left orb; the only visible Q
      //      is the bottom-right voice orb). Same one door (window.Q), context-bound to what you're looking
      //      at; it answers / assists / builds WITHOUT taking over the screen. (⌘/Ctrl-I to open.) ════
      function qOrbToggle() { try { window.__holoQOrb && window.__holoQOrb.toggle(); } catch (e) {} }
      (function installHoloOrb() {
        if (typeof document === "undefined" || document.getElementById("holo-qpanel")) return;
        const css = document.createElement("style"); css.textContent = `
          #holo-qpanel{position:fixed;left:18px;bottom:calc(18px + env(safe-area-inset-bottom,0px));width:min(380px,calc(100vw - 36px));height:min(540px,calc(100dvh - 120px));z-index:9001;
            display:flex;flex-direction:column;border-radius:18px;overflow:hidden;transform-origin:bottom left;
            background:linear-gradient(180deg,rgba(20,22,34,.86),rgba(12,14,22,.93));backdrop-filter:blur(22px) saturate(1.3);
            border:1px solid rgba(255,255,255,.1);box-shadow:0 24px 70px -20px rgba(0,0,0,.7),0 0 0 1px rgba(124,92,255,.18);
            opacity:0;transform:scale(.4) translateY(20px);pointer-events:none;transition:opacity .26s ease,transform .3s cubic-bezier(.22,.9,.2,1)}
          #holo-qpanel.on{opacity:1;transform:none;pointer-events:auto}
          #holo-qpanel .qhead{display:flex;align-items:center;gap:9px;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.07)}
          #holo-qpanel .qmark{width:24px;height:24px;border-radius:50%;flex:0 0 auto;background:radial-gradient(120% 120% at 30% 25%,#2b6fff,#7c5cff 60%,#11132a)}
          #holo-qpanel .qtitle{font-weight:700;color:#eaf0ff;font-size: var(--holo-text-sm, 0.875rem)}
          #holo-qpanel .qctx{margin-left:auto;font-size: var(--holo-text-sm, 0.688rem);color:#8b94b8;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
          #holo-qpanel .qclose{cursor:pointer;color:#8b94b8;font-size:18px;line-height:1;padding:2px 6px;border-radius:6px}
          #holo-qpanel .qclose:hover{background:rgba(255,255,255,.08);color:#fff}
          #holo-qthread{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}
          #holo-qthread .qm{max-width:88%;padding:9px 12px;border-radius:13px;font-size: var(--holo-text-sm, 0.813rem);line-height:1.5;white-space:pre-wrap;word-break:break-word}
          #holo-qthread .qm.user{align-self:flex-end;background:#2b6fff;color:#fff;border-bottom-right-radius:4px}
          #holo-qthread .qm.asst{align-self:flex-start;background:rgba(255,255,255,.06);color:#dde4f5;border-bottom-left-radius:4px}
          #holo-qthread .qm.asst a{color:#8ab4ff}
          #holo-qcomposer{display:flex;gap:8px;align-items:flex-end;padding:10px 12px;border-top:1px solid rgba(255,255,255,.07)}
          #holo-qinput{flex:1;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:12px;color:#eaf0ff;
            font:var(--holo-text-sm, 0.813rem)/1.4 system-ui;padding:9px 11px;resize:none;max-height:120px;outline:none}
          #holo-qinput:focus{border-color:rgba(124,92,255,.5)}
          #holo-qsend{flex:0 0 auto;width:34px;height:34px;border:0;border-radius:10px;background:#2b6fff;color:#fff;cursor:pointer;font-size: var(--holo-text-sm, 0.938rem)}
          #holo-qsend:hover{background:#1d5fe0}
          #holo-qfoot{display:flex;gap:8px;padding:0 12px 11px}
          #holo-qfoot button{flex:1;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#bcc6e6;border-radius:10px;padding:7px;font-size: var(--holo-text-sm, 0.75rem);cursor:pointer}
          #holo-qfoot button:hover{background:rgba(255,255,255,.1);color:#fff}
          .qchips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
          .qchip{display:inline-block;padding:4px 10px;border-radius:999px;background:rgba(124,92,255,.16);border:1px solid rgba(124,92,255,.34);color:#cdbcff;font-size: var(--holo-text-sm, 0.75rem);cursor:pointer;transition:background .15s,color .15s}
          .qchip:hover{background:rgba(124,92,255,.32);color:#fff}
          .qcap{margin-top:10px}.qcap b{display:block;color:#eaf0ff;font-weight:600;font-size: var(--holo-text-sm, 0.781rem)}
          [data-holo-motion="reduced"] #holo-qpanel{transition:none}
        `; document.head.appendChild(css);

        // The bottom-left desktop "Ask Q" orb was REMOVED — Q's single visible surface is the bottom-right
        // voice orb (holo-voice.js). This copilot panel stays, reachable via ⌘/Ctrl-I, the omnibar
        // (⌘/Ctrl+Enter), voice routing, and the open-q action — all of which call window.__holoQOrb.
        const panel = document.createElement("div"); panel.id = "holo-qpanel";
        panel.innerHTML =
          '<div class="qhead"><span class="qmark"></span><span class="qtitle">Q</span><span class="qctx" id="holo-qctx"></span><span class="qclose" id="holo-qx" title="Collapse">×</span></div>' +
          '<div id="holo-qthread"></div>' +
          '<div id="holo-qcomposer"><textarea id="holo-qinput" rows="1" placeholder="Ask about this, or build anything…"></textarea><button id="holo-qsend" title="Send">↑</button></div>' +
          '<div id="holo-qfoot"><button id="holo-qcreate">Open in Create ↗</button></div>';
        document.body.appendChild(panel);

        const thread = panel.querySelector("#holo-qthread"), input = panel.querySelector("#holo-qinput"), ctxEl = panel.querySelector("#holo-qctx");
        let greeted = false, busy = false;
        const esc = (x) => String(x).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
        function addMsg(role, html) { const m = document.createElement("div"); m.className = "qm " + role; m.innerHTML = html; thread.appendChild(m); thread.scrollTop = thread.scrollHeight; return m; }

        function focusedContext() {
          let h = null; try { h = activeHolospace(); } catch (e) {}
          if (!h) return { name: "your desktop", source: null, kappa: null };
          const source = h.content || h.src || null;
          const name = String(h.title || h.name || "this holospace").replace(/\s+·.*$/, "").replace(/^🌐\s*/, "").trim() || "this holospace";
          let kappa = h.appDid || h.kappa || null;
          if (!kappa && source) { try { kappa = repo.publishSource({ name: name, source: source }).id; } catch (e) {} }
          return { name: name, source: source, kappa: kappa };
        }
        function osScope() { try { return (window.Q && window.Q.scope) ? window.Q.scope(desktop.doc().world, (typeof focusedId !== "undefined" ? focusedId : null)) : { count: 0, open: [], summary: "" }; } catch (e) { return { count: 0, open: [], summary: "" }; } }
        try { window.__holoScope = osScope; } catch (e) {}   // the autonomy spine reads this for app context (Q watching WITH you)
        function setCtx() { const c = focusedContext(); const os = osScope(); ctxEl.textContent = c.name + "  ·  " + os.count + " open"; ctxEl.title = os.summary + (c.kappa ? "\n" + c.kappa : ""); return c; }

        const isQuestion = (x) => /\?\s*$/.test(x) || /^\s*(what|why|how|who|when|where|which|is|are|does|do|can|could|should|explain|describe|tell me|summari[sz]e)\b/i.test(x);
        function factualAnswer(c, os) {
          os = os || osScope();
          const head = os.count > 1
            ? "You have " + os.count + " holospaces open: " + os.open.map((i) => i.name).join(", ") + ". You're focused on " + c.name + "."
            : "You're looking at " + c.name + (c.kappa ? " (holo://" + String(c.kappa).split(":").pop().slice(0, 10) + "…)" : "") + ".";
          return head + " Each is a content-addressed holospace running serverless on your device I can build or change any of them, or answer about them. " +
            (window.HoloBoost ? "" : "Enable a boost model for free-form answers; otherwise I keep to what I can verify.");
        }

        // OMNIPOTENT execution — Q acts on the OS via the SAME primitives the omnibar/dock use.
        async function qOpen(target) {
          const tg = String(target || "").trim();
          if (!tg) { addMsg("asst", "Open what? Name an app or paste a link."); return; }
          const m = addMsg("asst", "Opening <b>" + esc(tg) + "</b>…");
          try { const hits = (typeof matches === "function" ? (matches(tg, catalog) || []) : []); if (hits[0]) {
            const appKey = "app:" + hits[0].id;
            let ex = null; try { ex = desktop.doc().world.find(function (n) { return n.appId === hits[0].id; }); } catch (e) {}
            if (ex) { try { setState(ex.id, "max"); } catch (e) {} focusedId = ex.id; try { window.__holoSurf && window.__holoSurf.track(appKey, ex.id, 3); } catch (e) {} m.innerHTML = "Focused <b>" + esc(hits[0].name) + "</b> ✦  ·  warm · O(1), no reload"; close(); return; }   // warm app surface (incl. re-opening a warm-closed app)
            try { await openHolospaceApp(hits[0].id, "", hits[0].name); } catch (e) {}
            try { const nn = desktop.doc().world.find(function (n) { return n.appId === hits[0].id; }); if (nn && window.__holoSurf) window.__holoSurf.track(appKey, nn.id, 3); } catch (e) {}
            m.innerHTML = "Opened <b>" + esc(hits[0].name) + "</b> ✦"; close(); return; } } catch (e) {}
          try { const r = (typeof classify === "function") ? classify(tg, catalog) : null; if (r && (r.kind === "web" || r.kind === "holo")) { openWeb(r); m.innerHTML = "Opening <b>" + esc(tg) + "</b> ↗"; close(); return; } } catch (e) {}
          m.innerHTML = "I couldn't find <b>" + esc(tg) + "</b> to open try an app name or a URL.";
        }
        function qWindowOp(op) {
          let h = null; try { h = activeHolospace(); } catch (e) {}
          if (!h) { addMsg("asst", "There's nothing focused to " + op + "."); return; }
          const nm = String(h.title || h.name || "this").replace(/\s+·.*$/, "").replace(/^🌐\s*/, "").trim() || "this";
          try {
            if (op === "close") { const warmed = (window.__holoSurf && window.__holoSurf.close) ? window.__holoSurf.close(h.id) : false; addMsg("asst", "Closed <b>" + esc(nm) + "</b> ✦" + (warmed ? "  ·  kept warm (re-ask to reopen instantly)" : "")); if (!warmed) { try { removeNode(h.id); } catch (e) {} } close(); }
            else if (op === "minimize") { hideNode(h.id); addMsg("asst", "Minimized <b>" + esc(nm) + "</b> ✦"); close(); }
            else if (op === "maximize") { setState(h.id, "max"); addMsg("asst", "Maximized <b>" + esc(nm) + "</b> ✦"); close(); }
          } catch (e) { addMsg("asst", "Couldn't " + op + " it: " + esc(String(e && e.message || e))); }
        }
        // whole-desktop arrangement — tile · cascade · focus mode (omnipotence over the layout)
        function qArrange(mode) {
          let wins = []; try { wins = desktop.doc().world.filter(function (n) { return n.kind === "app" && n.state !== "hidden"; }); } catch (e) {}
          if (!wins.length) { addMsg("asst", "No open windows to arrange."); return; }
          let R; try { R = worldRect(); } catch (e) { R = { W: innerWidth, H: innerHeight }; }
          const W = R.W || innerWidth, H = R.H || innerHeight, gap = 12;
          const nameOf = function (n) { return String(n.title || n.name || "this holospace").replace(/\s+·.*$/, "").replace(/^🌐\s*/, "").trim() || "this holospace"; };
          if (mode === "focus") {
            let h = null; try { h = activeHolospace(); } catch (e) {} h = h || wins[0];
            wins.forEach(function (n) { try { n.id === h.id ? setState(n.id, "max") : hideNode(n.id); } catch (e) {} });
            focusedId = h.id; addMsg("asst", "Focus mode <b>" + esc(nameOf(h)) + "</b> front and centre, the rest tucked away ✦"); close(); return;
          }
          if (mode === "cascade") {
            wins.forEach(function (n, i) { const o = 30 * i; try { patch(n.id, function (x) { x.state = "normal"; delete x.prev; x.x = 40 + o; x.y = 30 + o; x.w = Math.min(820, W - 100); x.h = Math.min(560, H - 100); }); } catch (e) {} });
            if (wins[wins.length - 1]) focusedId = wins[wins.length - 1].id;
            addMsg("asst", "Cascaded " + wins.length + " window" + (wins.length === 1 ? "" : "s") + " ✦"); close(); return;
          }
          const cols = Math.ceil(Math.sqrt(wins.length)), rows = Math.ceil(wins.length / cols);
          const cw = Math.floor((W - gap * (cols + 1)) / cols), ch = Math.floor((H - gap * (rows + 1)) / rows);
          wins.forEach(function (n, i) { const col = i % cols, row = Math.floor(i / cols); try { patch(n.id, function (x) { x.state = "normal"; delete x.prev; x.x = gap + col * (cw + gap); x.y = gap + row * (ch + gap); x.w = cw; x.h = ch; }); } catch (e) {} });
          addMsg("asst", "Tiled " + wins.length + " window" + (wins.length === 1 ? "" : "s") + " into a " + cols + "×" + rows + " grid ✦"); close();
        }
        function chipRow(examples) { return '<div class="qchips">' + (examples || []).map(function (e) { return '<span class="qchip" data-ex="' + esc(e) + '">' + esc(e) + '</span>'; }).join("") + '</div>'; }
        function wireChips(el) { if (!el) return; el.querySelectorAll(".qchip").forEach(function (ch) { ch.onclick = function () { const ex = ch.getAttribute("data-ex"); if (ex) { input.value = ex; fire(); } }; }); }
        function qHelp() {
          const caps = (window.Q && window.Q.capabilities) ? window.Q.capabilities() : [];
          const rows = caps.map(function (c) { return '<div class="qcap"><b>' + esc(c.what) + '</b>' + chipRow(c.examples) + '</div>'; }).join("");
          const m = addMsg("asst", "Here's what I can do tap an example:" + rows);
          wireChips(m);
        }
        async function handle(text, suppliedCtx) {
          if (busy) return; busy = true;
          addMsg("user", esc(text));
          let c = setCtx();
          if (suppliedCtx && (suppliedCtx.source || suppliedCtx.name)) c = { name: suppliedCtx.name || c.name, source: suppliedCtx.source || c.source, kappa: suppliedCtx.kappa || c.kappa };
          // ONE FRONT DOOR (Fork 1): decide via the canonical resolver (nav lane + the one Q.intent) so the Q
          // surface shares EXACTLY the decision voice and the omnibar use; fall back to Q.intent if it's absent.
          const decided = (window.HoloResolve && typeof window.HoloResolve.decide === "function") ? window.HoloResolve.decide(text) : null;
          const it = decided ? { kind: decided.kind, target: decided.target } : ((window.Q && window.Q.intent) ? window.Q.intent(text) : { kind: isQuestion(text) ? "ask" : "build" });
          // PROFILE GROUNDING for EVERY Q path (ask · build · converse): one preface from your learned profile
          // (window.HoloProfile — derived from your encrypted local memory), folded into the context Q sees, so
          // what Q ANSWERS and what it BUILDS both tailor to you. Guarded + fail-soft (no profile → no preface).
          let youPreface = ""; try { const pt = (window.HoloProfile && window.HoloProfile.terms && window.HoloProfile.terms()) || []; if (pt.length) youPreface = "About the user (their interests, to tailor this): " + pt.slice(0, 12).join(", ") + ".\n\n"; } catch (e) {}
          const groundedCtx = (base) => youPreface ? Object.assign({}, base || {}, { source: youPreface + (((base || {}).source) || "") }) : base;
          // PROVE intent: "prove <X> [to/with <Y>]" → share a κ-PROOF of attribute X with audience Y, revealing
          // NOTHING else. A consent card NAMES exactly what's shared; clicking Share is the per-action consent
          // (best-effort step-up underneath); window.HoloProof assembles the proof + a self-contained link the
          // recipient verifies. Plain language; no crypto jargon. (Profile-/self-asserted attribute tier.)
          if (window.HoloProof && window.HoloProof.share && /^\s*prove\b/i.test(text)) {
            const pm = text.match(/^\s*prove\b\s+(?:that\s+)?(?:i(?:['’]m| am)?\s+|i\s+)?(.+?)(?:\s+(?:to|with)\s+(.+?))?\s*$/i);
            if (pm) {
              const phrase = (pm[1] || "").trim().replace(/[.!?]+$/, ""), audience = (pm[2] || "this app").trim();
              const interests = (window.HoloProfile && window.HoloProfile.profile && (window.HoloProfile.profile()["holo:interests"] || [])) || [];
              const claims = {}; interests.forEach((t) => { claims["interest_" + t] = true; });
              const low = phrase.toLowerCase(); let key, label = phrase;
              const hit = interests.find((t) => low.indexOf(String(t).toLowerCase()) >= 0);
              if (hit) { key = "interest_" + hit; label = "you’re into " + hit; }
              else if (/develop|engineer|coder|programmer/.test(low)) { claims.role = "developer"; key = "role"; label = "you’re a developer"; }
              else if (/over\s*18|adult|of age|18\+/.test(low)) { claims.adult = true; key = "adult"; label = "you’re over 18"; }
              else { key = "interest_" + (low.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "fact"); claims[key] = true; label = phrase; }
              const m = addMsg("asst", "✦ Share a proof that <b>" + esc(label) + "</b> with <b>" + esc(audience) + "</b>? Nothing else is revealed. <button class=\"qchip\" data-proof=\"go\">Share proof</button>");
              const btn = m.querySelector("[data-proof]");
              if (btn) btn.onclick = async () => { btn.disabled = true; btn.textContent = "…"; try {
                const r = await window.HoloProof.share({ claims, attributes: [key], audience, gate: async () => ({ ok: true }) });
                if (r && r.ok) { const url = location.origin + location.pathname + r.link; try { navigator.clipboard && navigator.clipboard.writeText(url); } catch (e) {} m.innerHTML = "✦ Proof ready — <b>" + esc(label) + "</b>, shared with <b>" + esc(audience) + "</b>; nothing else revealed. Link copied."; }
                else { m.innerHTML = "✦ " + esc((r && r.reason) || "couldn’t share that"); }
              } catch (e) { btn.textContent = "failed"; } };
              busy = false; thread.scrollTop = thread.scrollHeight; return;
            }
          }
          // TOOL-USE: an ask/build turn may map to a registered app tool (Files/Control/Inbox/Wallet…). Try it
          // BEFORE conversing — a READ runs ambiently + grounds the answer; a WRITE/DESTRUCTIVE surfaces a
          // step-up Approve (never auto-runs); no match falls through to normal converse/build (no regression).
          if ((it.kind === "ask" || it.kind === "build") && window.HoloAgents && window.HoloAgents.routeToTool) {
            try {
              const tr = await window.HoloAgents.routeToTool(text, { ctx: window.HoloAgents.qContext() });
              if (tr && tr.tool && tr.ran && tr.result) {
                const r = tr.result;
                addMsg("asst", "✦ " + esc(tr.tool) + (r.ok ? "" : " — " + esc(r.reason || "unavailable")) + (r.ok && r.result ? "<pre>" + esc(JSON.stringify(r.result, null, 2)).slice(0, 600) + "</pre>" : ""));
                busy = false; thread.scrollTop = thread.scrollHeight; return;
              }
              if (tr && tr.tool && !tr.ran && tr.proposal) {
                const m = addMsg("asst", "✦ " + esc(tr.proposal.humanSummary || ("Proposes " + tr.tool)) + ' <button class="qchip" data-approve="' + esc(tr.tool) + '">Approve</button>');
                const btn = m.querySelector("[data-approve]");
                if (btn) btn.onclick = async function () { btn.disabled = true; btn.textContent = "…"; try { const done = await window.HoloAgents.invoke(tr.tool, {}, window.HoloAgents.qContext({ userApproved: true })); btn.parentElement.innerHTML = "✦ " + esc(tr.tool) + (done && done.ok ? " — done" : " — " + esc((done && done.reason) || "needs approval")); } catch (e) { btn.textContent = "failed"; } };
                busy = false; thread.scrollTop = thread.scrollHeight; return;
              }
            } catch (e) {}
          }
          try {
            if (it.kind === "nav") { try { omniGo(it.target || text); } catch (e) {} close(); }   // a URL/κ/search typed at Q → navigate, don't "build"
            else if (it.kind === "open") { await qOpen(it.target); }
            else if (it.kind === "close" || it.kind === "minimize" || it.kind === "maximize") { qWindowOp(it.kind); }
            else if (it.kind === "arrange") { qArrange(it.target); }
            else if (it.kind === "help") { qHelp(); }
            else if (it.kind === "ask") {
              const m = addMsg("asst", "…");
              const os = osScope();
              // PROFILE GROUNDING (zero-config): Q answers AWARE of your interests — your learned profile
              // (window.HoloProfile, distilled from your own encrypted local memory) prefaces the grounding so
              // answers tailor to you. 100% local; nothing egresses. Guarded + fail-soft (no profile → no preface).
              const askCtx = { name: c.name, kappa: c.kappa, source: youPreface + (os.summary ? "OS overview: " + os.summary + "\n\n" : "") + (c.source || "") };
              let ans = null; try { ans = await window.Q.ask(text, { context: askCtx }); } catch (e) {}
              const _reply = (ans && String(ans).trim()) ? String(ans).trim() : factualAnswer(c, os);
              m.innerHTML = esc(_reply);
              // REPLY-CAPTURE: a quiet 👍 — tapping it stores THIS (prompt, reply) as a liked example so Q
              // learns from it (reply-SFT). One tap, no jargon; private (your encrypted memory), never shared.
              try { if (window.HoloLearning && window.HoloLearning.captureUpvote) { const up = document.createElement("button"); up.className = "qchip"; up.title = "Good answer — Q learns from this"; up.textContent = "👍"; up.style.cssText = "margin-left:8px;opacity:.5"; up.onclick = async () => { up.disabled = true; up.style.opacity = "1"; up.textContent = "👍 learned"; try { await window.HoloLearning.captureUpvote(text, _reply); } catch (e) {} }; m.appendChild(up); } } catch (e) {}
              thread.scrollTop = thread.scrollHeight;
            } else if (window.__holoSurf && c.source == null) {
              // WARM-κ: a fresh build registers as a surface; re-asking the SAME prompt reopens it O(1)
              // (the SAME warm window, no rebuild). Closing it keeps it warm in place.
              const m = addMsg("asst", "Building <b>" + esc(text) + "</b>…");
              const nm = text.replace(/[^a-z0-9 ]/gi, " ").trim().split(/\s+/).slice(0, 4).join(" ") || "Holospace";
              const buildKey = "build:" + text.toLowerCase().trim();
              const r = await window.__holoSurf.open(buildKey, orbFloor(text), nm);
              const nodeId = r.handle;
              if (r.reused) { m.innerHTML = "Reopened <b>" + esc(nm) + "</b> warm surface · O(1), no rebuild ✦"; close(); }
              else {
                window.Q.create(text, { context: groundedCtx(c), onPartial: function (pp) { if (pp && nodeId != null) try { applyEdit(nodeId, pp); } catch (e) {} } }).then(function (res) { if (res && res.value && nodeId != null) try { applyEdit(nodeId, res.value); } catch (e) {} }).catch(function () {});
                m.innerHTML = "Built <b>" + esc(nm) + "</b> streaming onto your desktop ✦  ·  close &amp; re-ask to reopen warm"; close();
              }
            } else {
              const m = addMsg("asst", "Building <b>" + esc(text) + "</b>…");
              const nm = text.replace(/[^a-z0-9 ]/gi, " ").trim().split(/\s+/).slice(0, 4).join(" ") || "Holospace";
              // κ-STREAMED render: the instant template floor lands on the desktop on the FIRST κ-partial,
              // then the model's result re-renders the SAME window when it arrives (no blank 18s wait).
              let nodeId = null, firstHtml = null;
              const paint = function (html, isFinal) {
                if (!html) return;
                if (nodeId == null) { firstHtml = html; try { nodeId = addNode({ kind: "app", srcdoc: wrapDoc(html), sandbox: "allow-scripts allow-same-origin", content: html, editKind: "paste", name: nm, title: nm, w: 760, h: 540 }); } catch (e) {} }
                else if (isFinal && html !== firstHtml) { try { applyEdit(nodeId, html); } catch (e) {} }
              };
              const res = await window.Q.create(text, { context: groundedCtx(c), onPartial: function (partial) { if (nodeId == null) paint(partial, false); } });
              if (res && res.value) {
                paint(res.value, true);
                let link = ""; try { link = repo.publishSource({ name: nm, source: res.value }).id; } catch (e) {}
                m.innerHTML = (c.source ? "Reworked " : "Built ") + "<b>" + esc(nm) + "</b> streamed onto your desktop ✦" + (link ? "  ·  holo://" + String(link).split(":").pop().slice(0, 8) + "…" : "") + (res.cached && res.cached !== false ? "  · O(1)" : "");
              } else m.innerHTML = "I couldn't build that try rephrasing.";
            }
          } catch (e) { addMsg("asst", "Something went wrong: " + esc(String(e && e.message || e))); }
          busy = false;
        }

        function open() { setCtx(); if (!greeted) { greeted = true; const c = focusedContext(); const os = osScope(); const g = addMsg("asst", "I'm Q here, aware of your whole desktop (" + os.count + " holospace" + (os.count === 1 ? "" : "s") + " open) and focused on <b>" + esc(c.name) + "</b>. Tell me what to build, ask about any of it, or:" + chipRow(["open files", "tile", "what's open?", "help"])); wireChips(g); }
          panel.classList.add("on"); setTimeout(() => { try { input.focus(); } catch (e) {} }, 120); }
        function close() { panel.classList.remove("on"); }
        function toggle() { panel.classList.contains("on") ? close() : open(); }

        // The bottom-left orb (and its pin/drag positioning) was removed; __pinQOrb is now a no-op so the
        // guarded callers in newTab()/boot stay valid without a button to place.
        window.__pinQOrb = function () {};
        panel.querySelector("#holo-qx").onclick = close;
        const fire = () => { const v = input.value.trim(); if (v) { input.value = ""; input.style.height = "auto"; handle(v); } };
        panel.querySelector("#holo-qsend").onclick = fire;
        panel.querySelector("#holo-qcreate").onclick = () => { close(); try { openCreate(); } catch (e) {} };
        input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(120, input.scrollHeight) + "px"; });
        input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); fire(); } else if (e.key === "Escape") { close(); } });

        // bind the ANSWER specialist (text, context-aware) to the `ask` task — boost when installed, else
        // the panel shows a verifiable factual answer (no faked free-form AI).
        const _askSpecialist = { id: "holo-ask", generate: async function* (prompt, opts) {
          opts = opts || {}; const boost = (typeof window !== "undefined" && typeof window.HoloBoost === "function") ? window.HoloBoost : null;
          if (!boost) return;
          const ctx = opts.current ? String(opts.current).slice(0, 4000) : "";
          const messages = [
            { role: "system", content: "You are Q, the assistant inside Hologram OS. Answer in concise plain text no code blocks, no markdown headings. If the HTML of the holospace the user is looking at is given as context, answer about it specifically and honestly." },
            { role: "user", content: (ctx ? "The holospace I'm looking at (HTML):\n" + ctx + "\n\n" : "") + "Question: " + prompt } ];
          for await (const d of boost(messages, { maxTokens: 512, signal: opts.signal })) yield (d && d.delta != null ? d.delta : d);
        } };
        import("/_shared/q/holo-q-mux.js").then((mx) => { const b = mx.bindSpecialist || (mx.default && mx.default.bindSpecialist); if (b) b("ask", _askSpecialist); }).catch(() => {});

        // bind a self-contained CREATE specialist at boot so the orb can BUILD without opening the studio
        // first (the studio binds a richer one on open; this is the always-available floor + tier). ──
        const orbFloor = function (pp) { const t = esc(String(pp || "Holospace")); return '<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:radial-gradient(120% 120% at 30% 0%,#16203a,#0a0e17 60%,#05070c);color:#e8eef9;font:16px/1.6 ui-sans-serif,system-ui;text-align:center;padding:6vw}.tag{font-size: var(--holo-text-sm, 0.75rem);letter-spacing:3px;text-transform:uppercase;color:#5b8cff;font-weight:700}h1{font-size:clamp(30px,6vw,60px);line-height:1.05;margin:12px 0 10px;font-weight:800}p{color:#9fb0c8;max-width:560px;margin:0 auto}' + '</style><body><div><div class=tag>Holospace · on-device</div><h1>' + t + '</h1><p>' + t + '</p></div>'; };
        let _orbCg = null, _orbCgTried = false, _orbDead = false;
        async function ensureOrbCg() { if (_orbCg || _orbCgTried) return _orbCg; _orbCgTried = true; try { const mod = await import("/_shared/q/holo-q-codegen.js"); let device = null; try { device = await mod.bindVoiceModel({}); } catch (e) {} const boost = (typeof window.HoloBoost === "function") ? function (mm, oo) { return window.HoloBoost(mm, oo); } : null; _orbCg = mod.createCodegen({ device: device, boost: boost }); if (device) wireFuse(device); wireRecall(); } catch (e) { _orbCg = null; } return _orbCg; }
        const _orbCreateSpec = { id: "holo-create", generate: async function* (prompt, opts) {
          opts = opts || {}; const editing = !!opts.editing, current = opts.current || null;
          yield { replace: editing && current ? current : orbFloor(prompt) };          // instant, sealed floor
          const wantBoost = !!(typeof window.HoloBoost === "function");
          if (_orbDead && !wantBoost) return;
          const cg = await ensureOrbCg();
          if (!cg || (!cg.has("device") && !wantBoost)) return;                          // no model → floor stands
          try { const TIMEOUT = wantBoost ? 60000 : 18000;
            const r = await Promise.race([ cg.generate({ prompt: prompt, current: editing ? current : null, boost: wantBoost }), new Promise(function (res) { setTimeout(function () { res({ __slow: true }); }, TIMEOUT); }) ]);
            if (r && r.__slow) { _orbDead = true; return; }
            if (r && r.source) yield { replace: r.source };
          } catch (e) {}
        } };
        import("/_shared/q/holo-q-mux.js").then((mx) => { try { const b = mx.bindSpecialist || (mx.default && mx.default.bindSpecialist); const rt = mx.routeTask || (mx.default && mx.default.routeTask); if (b && !(rt && rt("create") && rt("create").generate)) b("create", _orbCreateSpec); } catch (e) {} }).catch(() => {});

        function run(text, ctx) { open(); const t = String(text || "").trim(); if (t) handle(t, ctx); }
        window.__holoQOrb = { toggle: toggle, open: open, close: close, run: run };
        // host authority: apps (sandboxed iframes) reach this ONE Q over the governed holo-gov channel
        // (ADR-0091 cross-frame). q.create rides Q.agent (fail-closed + receipted); the app holds nothing.
        (function installServe() { if (typeof window === "undefined") return; if (!window.Q) { setTimeout(installServe, 200); return; }
          // bind the OS action executors so Q.act (the orb, an app, or an agent) can OPEN/CLOSE/etc. — governed for non-human callers.
          try { window.Q.configureActions({ open: qOpen, close: () => qWindowOp("close"), minimize: () => qWindowOp("minimize"), maximize: () => qWindowOp("maximize"), arrange: qArrange }); } catch (e) {}
          // ONE FRONT DOOR (Fork 1): register the shell's executors on HoloResolve so EVERY surface (voice, "+",
          // any caller) dispatches a decided intent through the same table — nav navigates, open/close act, and
          // ask/build go to the Q orb (the full streaming experience). The Q orb itself uses HoloResolve.decide.
          (function bindResolve() {
            try {
              if (!window.HoloResolve) { document.documentElement.addEventListener("holo-resolve-ready", bindResolve, { once: true }); return; }
              if (window.HoloResolve.__shellBound) return; window.HoloResolve.__shellBound = true;
              window.HoloResolve.register("nav",   (t) => { try { omniGo(t); } catch (e) {} });
              window.HoloResolve.register("open",  (t) => qOpen(t));
              window.HoloResolve.register("close", () => qWindowOp("close"));
              window.HoloResolve.register("ask",   (t) => run(t));      // spoken/dropped "ask" → the Q orb
              window.HoloResolve.register("build", (t) => run(t));      // spoken/dropped "build" → the Q orb
            } catch (e) {}
          })();
          // Q ↔ Notify seam: Q posts a note into the Center (read like Messages). This only DELIVERS a note
          // it is handed — it never generates text, so a cold/un-warmed brain can post honest notes and
          // nothing is fabricated (Law L5). window.Q.note(text|{title,body,deepLink,severity}).
          try { if (!window.Q.note) window.Q.note = (text, o = {}) => { try { return window.HoloNotify ? window.HoloNotify.q(typeof text === "string" ? { title: text, ...o } : { ...text, ...o }) : null; } catch (e) { return null; } }; } catch (e) {}
          import("/_shared/q/holo-q-app.js").then((m) => { try { window.HoloQServe = m.createQServe({ Q: window.Q, summon: (t, c) => { t ? run(t, c) : open(); } }); } catch (e) {} }).catch(() => {});
          // AGENT TOOL SURFACES: load the unified registry (Files/Control/Inbox/Wallet) + the tool-use router,
          // and expose them so the Q orb can route a turn to a tool BEFORE conversing (read → run + ground; a
          // write/destructive → step-up proposal). Floor works model-free today; the brain is the silent upgrade.
          import("/_shared/holo-agent-registry.mjs").then(async (reg) => {
            try { await reg.browserRegistry(); try { const sm = await import("/_shared/holo-stream-agent.mjs"); reg.register("stream", await sm.browserStreamAgent()); } catch (e) {}   /* S6: the streaming spine (open/continue/share) as Q tools */ const rt = await import("/_shared/holo-agent-router.mjs"); const surf = await import("/_shared/holo-agent-surface.mjs");
              window.HoloAgents = { routeToTool: rt.routeToTool, invoke: reg.invoke, toolMenu: reg.toolMenu, qContext: surf.qContext, surfaces: reg.surfaces }; } catch (e) {}
          }).catch(() => {}); })();
      })();
      // ── Ambient Q alternate invokes: the omnibar (⌘/Ctrl+Enter sends your line to Q) and VOICE (an
      //    unhandled spoken turn routes to Q). The orb stays the ONE surface; these just open it. ──
      try { const _oa = document.getElementById("omni-addr"); if (_oa) _oa.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation(); const v = e.target.value.trim(); if (v && window.__holoQOrb) { window.__holoQOrb.run(v); e.target.value = ""; } } }, true); } catch (e) {}
      try { addEventListener("holo-voice", (e) => { const d = e && e.detail; if (d && d.text && d.acted === false && window.__holoQOrb) window.__holoQOrb.run(d.text); }); } catch (e) {}
      // ── surface-cache DOM wiring (ADR-0091): keep desktop surfaces WARM IN-PLACE (hidden, NEVER
      //    reparented → no reload), so re-opening is O(1) and live state survives. LRU-bounded. The
      //    witnessed warm-κ policy (holo-q-surface.js) driving the REAL compositor primitives. Additive —
      //    nothing else changes unless a caller routes opens/closes through window.__holoSurf. ──
      (function installHoloSurf() {
        const keyToId = new Map(), idToKey = new Map(), warm = new Set();
        import("/_shared/q/holo-q-surface.js").then(function (m) {
          const mem = (typeof navigator !== "undefined" && navigator.deviceMemory) || 4;   // GB (≈4 if unknown)
          const hotMax = m.recommendHotMax(mem);
          const cache = m.createSurfaceCache({ hotMax: hotMax, maxWeight: hotMax * 3, onEvict: function (key) { const id = keyToId.get(key); if (id != null) { try { removeNode(id); } catch (e) {} idToKey.delete(id); } keyToId.delete(key); warm.delete(key); } });
          // open(key, html, name) — mounts a srcdoc surface; a warm/live key is reused O(1) (SAME window, no remount/reload).
          async function open(key, html, name) {
            if (keyToId.has(key)) { const id = keyToId.get(key), wasWarm = warm.has(key);
              if (wasWarm) { warm.delete(key); await cache.acquire(key, async function () { return { handle: id }; }); try { setState(id, "normal"); } catch (e) {} }
              focusedId = id; return { handle: id, reused: true, wasWarm: wasWarm }; }
            const r = await cache.acquire(key, async function () { let id = null; try { id = addNode({ kind: "app", srcdoc: wrapDoc(html), sandbox: "allow-scripts allow-same-origin", content: html, editKind: "paste", name: name || "Surface", title: name || "Surface", w: 620, h: 420 }); } catch (e) {} if (id != null) { keyToId.set(key, id); idToKey.set(id, key); } return { handle: id }; }, { weight: 1 });
            return { handle: r.handle, reused: false, wasWarm: false };
          }
          // close(id|key) — WARM-keep (hide in place, don't destroy); LRU-evict (removeNode) beyond hotMax.
          function track(key, id, weight) { if (id == null) return false; if (warm.has(key)) warm.delete(key); keyToId.set(key, id); idToKey.set(id, key); try { cache.acquire(key, async function () { return { handle: id }; }, { weight: weight || 1 }); } catch (e) {} return true; }
          function close(idOrKey) { const key = idToKey.has(idOrKey) ? idToKey.get(idOrKey) : (keyToId.has(idOrKey) ? idOrKey : null); if (key == null) return false; const id = keyToId.get(key); try { hideNode(id); } catch (e) {} warm.add(key); cache.release(key); return true; }
          window.__holoSurf = { open: open, track: track, close: close, has: function (k) { return keyToId.has(k); }, isWarm: function (k) { return warm.has(k); }, idOf: function (k) { return keyToId.get(k); }, stats: function () { return cache.stats(); }, hotMax: hotMax, mem: mem };
        }).catch(function () {});
      })();
      function importSource(src) {
        const s = (src != null ? src : srcTa.value); if (!s.trim()) return null;
        const obj = repo.publishSource({ name: "pasted", source: s }); closeLib();
        addNode({ kind: "app", srcdoc: wrapDoc(s), sandbox: "allow-scripts", content: s, editKind: "paste", name: "imported", title: "imported  ·  " + linkFor(obj.id) });
        return obj;
      }
      // Holo SDK — scaffold a brand-new holospace and drop it on the canvas as a LIVE, content-addressed,
      // editable object (double-click → new κ → instant re-render, via the existing applyEdit/rebuild path).
      // The AI-coding-agent surface is one call: await __world.scaffold({ name, category }) → { id, kappa,
      // name }; then __world.applyEdit(id, newSource). The scaffolder is lazy-imported (off the boot path).
      async function scaffoldApp(opts = {}) {
        const { scaffold } = await import("/_shared/holo-scaffold.js");
        const s = scaffold(opts || {});
        const src = s.files["index.html"];
        const obj = repo.publishSource({ name: s.identifier, source: src });   // source → κ (Law L5)
        const id = addNode({ kind: "app", srcdoc: wrapDoc(src), sandbox: "allow-scripts allow-same-origin", content: src, editKind: "paste", name: s.name, title: s.name + "  ·  " + linkFor(obj.id), w: 720, h: 520 });
        // Surface the FOUNDATION at the moment of creation (Holo Product, ADR-0065): a companion card
        // shows the balanced faculties + the hybrid method (all met by construction) + the generated
        // DECISION.md — so the method is visible as you build, not buried in a file you never open.
        try {
          const card = await buildDecisionCard(s);
          addNode({ kind: "app", srcdoc: card, sandbox: "allow-scripts", content: card, editKind: "paste",
            frameless: false, name: "Holo Product", title: "Holo Product · " + s.name + " the foundation it's built on", w: 420, h: 560 });
        } catch (e) { /* foundation card is additive — never block the scaffold */ }
        toast("✦ scaffolded " + s.name + "  ·  " + linkFor(obj.id) + " built on Holo Product · double-click to edit");
        return { id, kappa: obj.id, name: s.name };
      }

      // buildDecisionCard(s) → a self-contained, token-driven card (no hardcoded colour — it links the
      // canonical holo-theme.css and rides --holo-*; signal over noise). It reads the foundation LIVE
      // from holo-product.mjs (the same source the SDK's product() exposes), so the two hemispheres and
      // the six method phases are the real doctrine, not a restatement.
      async function buildDecisionCard(s) {
        const P = await import("/_shared/holo-product.mjs").catch(() => null);
        const F = (P && P.FACULTIES) || [], M = (P && P.METHOD) || [];
        const ux = F.filter((f) => f.hemisphere === "ux"), ui = F.filter((f) => f.hemisphere === "ui");
        const balanced = ux.length === ui.length;
        const E = (t) => String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
        // each method phase is met BY CONSTRUCTION for a freshly scaffolded product — say how.
        const MET = { discover: "value stated in the manifest", define: "this DECISION.md", design: "Holo UI ⊕ UX inherited",
          build: "content-addressed κ (Law L5)", verify: "the gate app rows (#app-ui-* · #app-ux-*)", "deliver-iterate": "shared as holo://κ" };
        const col = (title, items) => `<div class="col"><div class="h">${E(title)}</div>${items.map((f) => `<div class="fac">${E(f.label)}</div>`).join("")}</div>`;
        const phase = (m) => `<li><span class="ok">✓</span> <b>${E(m.label)}</b> ${E(MET[m.id] || "")}</li>`;
        const md = (s.files["DECISION.md"] || "").split("\n").map((l) => {
          const e = (x) => E(x).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`(.+?)`/g, "<code>$1</code>");
          if (/^### /.test(l)) return `<h4>${e(l.slice(4))}</h4>`;
          if (/^## /.test(l)) return `<h3>${e(l.slice(3))}</h3>`;
          if (/^# /.test(l)) return `<h2>${e(l.slice(2))}</h2>`;
          if (/^> /.test(l)) return `<blockquote>${e(l.slice(2))}</blockquote>`;
          if (/^- /.test(l)) return `<div class="li">• ${e(l.slice(2))}</div>`;
          return l.trim() ? `<p>${e(l)}</p>` : "";
        }).join("");
        return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/_shared/holo-theme.css">
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; background: var(--holo-bg, #0d1117); color: var(--holo-ink, #c9d1d9);
    font: var(--holo-text-sm, 1rem)/1.5 var(--holo-font-sans, ui-sans-serif, system-ui); padding: 1.1rem 1.2rem; }
  .badge { display: inline-flex; align-items: center; gap: .4rem; font-weight: 600; }
  .dot { width: .55rem; height: .55rem; border-radius: 50%; background: var(--holo-ok, #3fb950); }
  .sub { color: var(--holo-ink-dim, #8b949e); margin: .15rem 0 1rem; }
  .brain { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem; margin-bottom: 1rem; }
  .col { border: 1px solid var(--holo-border, #30363d); border-radius: var(--holo-radius-sm, 8px); padding: .55rem .65rem; background: var(--holo-surface, #161b22); }
  .col .h { font-size: .82em; text-transform: uppercase; letter-spacing: .06em; color: var(--holo-ink-dim, #8b949e); margin-bottom: .35rem; }
  .fac { padding: .1rem 0; }
  h3.m { font-size: .82em; text-transform: uppercase; letter-spacing: .06em; color: var(--holo-ink-dim, #8b949e); margin: 0 0 .35rem; }
  ul { list-style: none; margin: 0 0 1rem; padding: 0; } li { padding: .12rem 0; }
  .ok { color: var(--holo-ok, #3fb950); font-weight: 700; }
  .doc { border-top: 1px solid var(--holo-border, #30363d); padding-top: .7rem; }
  .doc h2 { font-size: 1.05em; margin: .2rem 0 .5rem; } .doc h3 { font-size: .92em; margin: .8rem 0 .25rem; }
  .doc h4 { font-size: .86em; margin: .6rem 0 .2rem; color: var(--holo-ink-dim, #8b949e); }
  .doc p, .doc .li { margin: .2rem 0; } .doc blockquote { margin: .2rem 0; padding-left: .7rem; border-left: 2px solid var(--holo-accent, #5b8cff); color: var(--holo-ink-dim, #8b949e); }
  code { font-family: var(--holo-font-mono, ui-monospace, monospace); background: var(--holo-surface-2, #1b2128); padding: 0 .25em; border-radius: var(--holo-radius, 4px); }
</style></head>
<body>
  <div class="badge"><span class="dot"></span>Holo Product</div>
  <div class="sub">${ux.length} UX ⊕ ${ui.length} UI faculties · ${balanced ? "balanced" : "imbalanced"} the foundation this product is built on</div>
  <div class="brain">${col("UX · experience", ux)}${col("UI · look", ui)}</div>
  <h3 class="m">Method met by construction</h3>
  <ul>${M.map(phase).join("")}</ul>
  <div class="doc">${md}</div>
</body></html>`;
      }
      function promptScaffold() { const name = (typeof prompt === "function") ? prompt("Name your new holospace:", "My App") : "My App"; if (name && String(name).trim()) scaffoldApp({ name: String(name).trim() }); }
      $("#library").onclick = openLib;
      $("#libsrc-btn").onclick = () => { $("#libsrc").hidden = !$("#libsrc").hidden; };
      libq.addEventListener("input", () => paintLib(libq.value));
      srcTa.addEventListener("input", srcKappa);
      $("#libsrc-fetch").onclick = async () => { const u = $("#libsrc-url").value.trim(); if (!u) return; try { srcTa.value = await fetch(u).then((r) => r.text()); srcKappa(); } catch (e) { alert("Fetch failed (the source may block cross-origin reads): " + e.message); } };
      $("#libsrc-import").onclick = () => importSource();

      // ── keyboard layer — the NATIVE engine (holo-keys): feature-complete shortcuts, a command
      //    palette, a cheat sheet and a virtual keyboard — every action a content-addressed
      //    command, O(1) resolution, the whole keymap a shareable did:holo ────────────────────
      const km = createKeymap({ apple: P.apple, seqMs: 900 });
      const focused = () => focusedId && desktop.doc().world.find((w) => w.id === focusedId);
      const closeAll = () => { closeSpot(); closeLib(); closePalette(); closeCheat(); hideCtx(); auth.classList.remove("open"); };
      km.bind("mod+k", () => openSpot(), { id: "open-holospace", title: "Open holospace", group: "Go", hint: "Search" });
      km.bind("mod+shift+p", () => openPalette(), { id: "command-palette", title: "Command palette", group: "Go" });
      km.bind("mod+shift+n", () => promptScaffold(), { id: "sdk-scaffold", title: "New holospace · Holo SDK scaffold", group: "Create" });
      km.bind(["mod+shift+l", "g l"], () => openLib(), { id: "library", title: "Component library", group: "Go" });
      km.bind(["mod+shift+e", "g n"], () => $("#author").click(), { id: "new-component", title: "New component", group: "Create" });
      km.bind("mod+shift+arrowleft", () => focused() && setState(focusedId, "left"), { id: "snap-left", title: "Snap left", group: "Window" });
      km.bind("mod+shift+arrowright", () => focused() && setState(focusedId, "right"), { id: "snap-right", title: "Snap right", group: "Window" });
      km.bind("mod+shift+arrowup", () => focused() && setState(focusedId, "max"), { id: "snap-max", title: "Maximize", group: "Window" });
      km.bind("mod+shift+arrowdown", () => { const n = focused(); if (n) setState(focusedId, n.state === "normal" ? "min" : "normal"); }, { id: "min-restore", title: "Minimize / restore", group: "Window" });
      km.bind("mod+shift+f", () => focused() && patch(focusedId, (x) => { x.frameless = !x.frameless; }), { id: "pure", title: "Toggle frameless (pure)", group: "Window" });
      km.bind("mod+shift+d", () => focused() && duplicate(focusedId), { id: "duplicate", title: "Duplicate", group: "Window" });
      km.bind("mod+e", () => focused() && openEdit(focusedId), { id: "edit", title: "Edit source → new κ", group: "Window" });
      km.bind("del", () => { if (focused()) { removeNode(focusedId); focusedId = null; } }, { id: "delete", title: "Delete object", group: "Window" });
      km.bind("mod+shift+g", () => toggleGrid(), { id: "grid", title: "Toggle window grid / zones", group: "Window" });
      km.bind("g g", () => cycleLayout(), { id: "layout", title: "Cycle zone layout (Halves · Columns · 2×2 · 3×3 · Golden · KWin)", group: "Window" });
      km.bind("mod+shift+k", () => toggleVK(), { id: "keyboard", title: "Toggle virtual keyboard", group: "View" });
      km.bind("?", () => openCheat(), { id: "help", title: "Keyboard shortcuts", group: "Help", hint: "Shortcuts" });
      km.bind("esc", () => closeAll(), { id: "escape", title: "Close / dismiss", group: "Help", global: true });

      // ── mouse automation (holo-auto) — a visible cursor drives the OS; macros are content-addressed ─
      const auto = createAutomation({ run: (id) => km.run(id) });
      let lastMacro = null, lastMacroDid = "";
      // toast → the transient FACE of the unified notification surface (Holo Notify). A bare toast is pure
      // status (shown, not filed, so history stays meaningful); richer events call window.HoloNotify.notify
      // directly. Falls back to the legacy #toast element if Notify hasn't mounted yet.
      function toast(m) { try { if (window.HoloNotify) { window.HoloNotify.toast(m); return; } } catch (e) {} const t = $("#toast"); if (!t) return; t.textContent = m; t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 3800); }
      function toggleRecord() {
        if (auto.isRecording()) { lastMacro = auto.stop() || []; lastMacroDid = repo.publishSource({ name: "macro", source: auto.canonical(lastMacro) }).id; toast("● recorded " + lastMacro.length + " steps → " + lastMacroDid.replace("did:holo:sha256:", "holo://").slice(0, 24) + "… · share to replay anywhere"); }
        else { auto.record(); toast("● recording click around the desktop, then run Record again to stop"); }
      }
      function playLast() { (lastMacro && lastMacro.length) ? auto.play(lastMacro) : toast("no macro yet Record one first (⇧ + the Record shortcut)"); }
      const TOUR = [ { t: "wait", ms: 400 }, { t: "clickEl", sel: "#library" }, { t: "wait", ms: 750 }, { t: "clickEl", sel: '.libcard[data-slug="clock"]' }, { t: "wait", ms: 600 }, { t: "cmd", id: "snap-left" }, { t: "wait", ms: 600 }, { t: "clickEl", sel: "#library" }, { t: "wait", ms: 750 }, { t: "clickEl", sel: '.libcard[data-slug="calculator"]' }, { t: "wait", ms: 600 }, { t: "cmd", id: "snap-right" }, { t: "wait", ms: 400 } ];
      function runTour() { closeAll(); auto.play(TOUR); toast("▶ guided tour the OS is driving itself, serverless"); }
      km.bind("mod+shift+r", () => toggleRecord(), { id: "record", title: "Record / stop macro", group: "Automation" });
      km.bind("mod+shift+y", () => playLast(), { id: "play-macro", title: "Play last macro", group: "Automation" });
      km.bind("g t", () => runTour(), { id: "tour", title: "Guided tour (self-driving)", group: "Automation" });

      km.attach(window);

      // ── tab cycling — the OS modifier (Ctrl on Win/Linux, ⌘ on Mac), so it reads the SAME as
      //    Ctrl K / every other shortcut. Ctrl+]/Ctrl+[ are free in a hosted browser tab AND reach
      //    the page (so preventDefault sticks), unlike Ctrl+Tab which the browser chrome grabs.
      //    holo-keys collapses ctrl/cmd→"mod", so mod+]/mod+[ adapts per-OS with one binding.
      //    When standalone/native the browser's own Ctrl+Tab is free too, so we ALSO honour the
      //    literal Ctrl+Tab via a tiny listener (km can't express a non-mod Ctrl). Wraps tabs[]. ──
      const standalone = (() => { try { return matchMedia("(display-mode: standalone)").matches || !!window.__TAURI__ || navigator.standalone === true; } catch { return false; } })();
      const cycleTab = (dir) => { const n = tabs.length; if (n < 2) return; const i = ((activeTab + dir) % n + n) % n; selectTab(i); };
      km.bind("mod+]", () => cycleTab(1),  { id: "tab-next", title: "Next tab", group: "Tabs", hint: "Tabs" });
      km.bind("mod+[", () => cycleTab(-1), { id: "tab-prev", title: "Previous tab", group: "Tabs" });
      if (standalone) addEventListener("keydown", (e) => { if (e.ctrlKey && (e.key === "Tab")) { e.preventDefault(); cycleTab(e.shiftKey ? -1 : 1); } }, true);

      // ── the Home-tab which-key bloom — a single ambient point of light. Idle = one breathing dot.
      //    Holding the OS modifier blooms a legend that is a LIVE PROJECTION of the keymap (every
      //    command flagged `hint`), so new shortcuts appear automatically — no hardcoded list. The
      //    bloom is bound straight to the modifier's keydown/keyup, so it lands in the SAME frame as
      //    the press (just a className toggle — no timer, no layout). renderTabs() calls __syncHints
      //    to keep it Home-only; click the dot for the full cheat sheet. ──
      (function mountHintBar() {
        const dot = $("#hint-dot"); if (!dot) return;
        const legend = dot.querySelector(".hk-legend"), core = dot.querySelector(".hk-core"), tag = dot.querySelector(".hk-tag");
        // Build the chips ONCE — the registry is fully populated by now, and pre-rendering keeps the
        // key path free of layout (bloom only touches opacity/transform). km.label() is OS-adapted.
        legend.innerHTML = km.registry.filter((c) => c.hint).map((c) =>
          `<button class="hk-chip" type="button" tabindex="-1" data-run="${c.id}" title="${c.title}"><kbd>${km.label(c.spec)}</kbd><span>${c.hint}</span></button>`).join("");
        if (core) core.title = "Shortcuts — hold " + P.modSymbol;
        if (tag) tag.innerHTML = `<kbd>${P.modSymbol}</kbd> for shortcuts`;   // self-describing label beside the idle dot (OS-adapted: Ctrl / ⌘)

        // Hiding is a persisted preference — an ambient dot should be banishable, but never lose the
        // shortcuts: `?` opens the cheat sheet regardless, and its footer offers the dot back.
        const DKEY = "holo.hints.dismissed.v1";
        const hidden = () => { try { return localStorage.getItem(DKEY) === "1"; } catch { return false; } };
        const onHome = () => { try { return !!(tabs[activeTab] && tabs[activeTab].home); } catch { return false; } };
        const sync = () => dot.classList.toggle("show", onHome() && !hidden());
        const setHidden = (on) => { try { localStorage.setItem(DKEY, on ? "1" : "0"); } catch (x) {} sync(); };

        // Bloom on the bare modifier. Additive + never preventDefault → literal Ctrl / Ctrl+Tab intact.
        const isMod = (e) => (km.apple ? e.key === "Meta" : e.key === "Control");
        let bloomed = false;
        const bloom = (on) => { if (on === bloomed) return; bloomed = on; dot.classList.toggle("bloom", on); };
        addEventListener("keydown", (e) => { if (!e.repeat && isMod(e) && dot.classList.contains("show")) bloom(true); }, true);
        addEventListener("keyup", (e) => { if (isMod(e)) bloom(false); }, true);
        addEventListener("blur", () => bloom(false));                                  // window lost focus mid-hold → keyup may never arrive
        document.addEventListener("visibilitychange", () => { if (document.hidden) bloom(false); });

        // Long-press the dot to banish it — the core "arms" (a slow absorb) and at ~600ms folds away.
        // A short tap falls through to the click handler (cheat sheet); the long-press suppresses that click.
        let pressT = null, didLong = false;
        const disarm = () => { clearTimeout(pressT); pressT = null; if (core) core.classList.remove("arming"); };
        if (core) {
          core.addEventListener("pointerdown", (e) => {
            if (e.button) return; didLong = false; core.classList.add("arming");
            pressT = setTimeout(() => { didLong = true; disarm(); bloom(false); setHidden(true); try { toast("Hint hidden — press ? for shortcuts to bring it back"); } catch (x) {} }, 600);
          });
          ["pointerup", "pointerleave", "pointercancel"].forEach((t) => core.addEventListener(t, disarm));
        }

        dot.addEventListener("click", (e) => {
          if (didLong) { didLong = false; e.preventDefault(); e.stopPropagation(); return; }   // the long-press already acted
          const chip = e.target.closest(".hk-chip");
          if (chip) { try { km.run(chip.dataset.run); } catch (x) {} return; }
          try { openCheat(); } catch (x) {}                                            // tap the dot (or no keyboard) → full cheat sheet
        });

        window.__syncHints = sync;
        window.__hintsHidden = hidden;        // the cheat sheet reads/flips the dot via these
        window.__hintsSetHidden = setHidden;
        sync();
      })();

      const keymapDid = repo.publishSource({ name: "keymap", source: km.canonical() }).id; // shareable, re-derivable

      // ── command palette — search every content-addressed command, run by Enter ──────────────
      const pal = $("#pal"), palq = $("#palq"), palr = $("#palr"); let palList = [], palSel = 0;
      function openPalette() { pal.classList.add("open"); palq.value = ""; renderPalette(""); palq.focus(); }
      const closePalette = () => pal.classList.remove("open");
      function renderPalette(term) { palList = km.registry.filter((c) => c.title && (c.title + c.group).toLowerCase().includes(term.toLowerCase())); palSel = 0; paintPalette(); }
      function paintPalette() {
        palr.innerHTML = palList.map((c, i) => `<div class="row${i === palSel ? " sel" : ""}" data-i="${i}"><span>${c.title}</span><span class="id">${km.label(c.spec)}</span></div>`).join("") || `<div class="row" style="color:#6e7681;cursor:default">No commands</div>`;
        [...palr.querySelectorAll(".row[data-i]")].forEach((r) => { r.onclick = () => { const c = palList[+r.dataset.i]; closePalette(); c && c.run(); }; r.onmouseenter = () => { palSel = +r.dataset.i; markPal(); }; });
      }
      const markPal = () => [...palr.querySelectorAll(".row[data-i]")].forEach((r, i) => r.classList.toggle("sel", i === palSel));
      palq.addEventListener("input", () => renderPalette(palq.value));
      palq.addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { e.preventDefault(); palSel = Math.min(palSel + 1, palList.length - 1); markPal(); } else if (e.key === "ArrowUp") { e.preventDefault(); palSel = Math.max(palSel - 1, 0); markPal(); } else if (e.key === "Enter") { e.preventDefault(); const c = palList[palSel]; closePalette(); c && c.run(); } });

      // ── shortcuts cheat sheet (press ?), OS-adapted, with the keymap's content address ──────
      const cheat = $("#cheat");
      const closeCheat = () => cheat.classList.remove("open");
      function openCheat() {
        const groups = {}; for (const c of km.registry) { if (!c.title) continue; (groups[c.group] = groups[c.group] || []).push(c); }
        const dotHidden = (() => { try { return !!(window.__hintsHidden && window.__hintsHidden()); } catch (x) { return false; } })();
        cheat.querySelector(".sheet").innerHTML = `<div class="cheat-h">Keyboard shortcuts <span class="muted">· ${P.label}</span></div><div class="cheat-grid">`
          + Object.entries(groups).map(([g, cs]) => `<div class="cheat-col"><h4>${g}</h4>` + cs.map((c) => `<div class="cheat-row"><span>${c.title}</span><kbd>${km.label(c.spec)}</kbd></div>`).join("") + `</div>`).join("")
          + `</div><div class="cheat-f">your keymap is content-addressed <span class="k">${keymapDid.replace("did:holo:sha256:", "holo://").slice(0, 30)}…</span> · share the link to sync your shortcuts`
          + ` · <button type="button" class="cheat-link" data-hint-toggle>${dotHidden ? "show the hint dot" : "hide the hint dot"}</button></div>`;
        cheat.classList.add("open");
      }
      cheat.addEventListener("click", (e) => {       // footer toggle: banish or restore the ambient dot, then refresh the label
        if (!e.target.closest("[data-hint-toggle]")) return;
        try { const h = window.__hintsHidden && window.__hintsHidden(); window.__hintsSetHidden && window.__hintsSetHidden(!h); } catch (x) {}
        openCheat();
      });

      // ── virtual keyboard — mirrors physical typing; clicks type, or fire commands with modifiers ─
      const vkPanel = $("#vk"); let vkEl = null;
      function vkType(key) { const el = document.activeElement; if (!el || !/^(INPUT|TEXTAREA)$/.test(el.tagName)) return; if (key === "backspace") el.value = el.value.slice(0, -1); else if (key === "space") el.value += " "; else if (key === "enter") el.value += "\n"; else if (key.length === 1) el.value += key; el.dispatchEvent(new Event("input", { bubbles: true })); }
      function toggleVK() { if (!vkEl) { vkEl = renderKeyboard(km, { onType: vkType }); vkPanel.appendChild(vkEl); } vkPanel.classList.toggle("open"); }
      $("#keyboard-btn").onclick = toggleVK;
      [spot, auth, lib, pal, cheat].forEach((s) => s.addEventListener("click", (e) => { if (e.target === s) s.classList.remove("open"); }));

      // ── test surface (the browser witness drives this) ──────────────────────────────────
      window.__world = { repo, desktop, profile: P,
        // ── surfaced for the universal Holo Dock (ADR-0059): launch an app by id, open the spotlight ──
        launch, launchById: (id) => { const a = catalog.find((x) => x.id === id); if (a) launch(a); }, openSpot, openFiles,
        scaffold: scaffoldApp, promptScaffold, addNode, moveNode, resizeNode, setState, toggleMax, setLocked, removeNode, capabilitiesToSandbox, linkFor, SAMPLE, author, geomFor,
        newFolder, openFolder, collapseFolder, renameFolder, setFolderApp, detachFolderApp, setFolderCover, pickFolderApp, setFolderIcon, pickFolderIcon, FOLDER_ICONS_LIST,
        deriveSource: (name, src, prev) => repo.publishSource({ name, source: src, derivedFrom: prev }),
        holoStore, splitNode: (id) => splitNode(repo, desktop, id), fuseNode: (id) => fuseNode(repo, desktop, id, holoStore),
        own: { ownedOf: (id) => ownedOf(desktop.doc().world.find((w) => w.id === id)),
          state: (id) => HoloOwn.ownState(ownedOf(desktop.doc().world.find((w) => w.id === id))),
          claim: async (id) => { const n = desktop.doc().world.find((w) => w.id === id); const r = await HoloOwn.claim(ownedOf(n)); refreshOwnTitle(n, mounted.get(id)); return r; },
          transfer: async (id, to) => { const n = desktop.doc().world.find((w) => w.id === id); const r = await HoloOwn.transferTo(ownedOf(n), to); refreshOwnTitle(n, mounted.get(id)); return r; },
          anchor: (id, chain) => HoloOwn.anchorIt(ownedOf(desktop.doc().world.find((w) => w.id === id)), chain),
          sheet: (id) => HoloOwn.openOwnSheet(ownedOf(desktop.doc().world.find((w) => w.id === id))),
          setOperator: HoloOwn.setOperator },
        openLib, closeLib, importLib, importSource, buildPure, openEdit, applyEdit, duplicate, showCtx, hideCtx, togglePure: (id) => patch(id, (n) => { n.frameless = !n.frameless; }),
        km, openPalette, openCheat, toggleVK, get keymapDid() { return keymapDid; },
        auto, runTour, toggleRecord, playLast, closeAll, get lastMacroDid() { return lastMacroDid; }, gpuInfo,
        toggleGrid, cycleLayout, setLayout, activeLayout, zonePx, snapToZone: (id, x, y) => { const z = zoneAt(zonePx(), x, y); if (z) setNodeZone(id, z); return z; }, get gridOn() { return gridOn; },
        get libItems() { return libItems; }, get focusedId() { return focusedId; } };
      window.__worldReady = true;
      // The shell ITSELF becomes a remixable composition: tag each chrome region as a self-verifying
      // κ-object (κ = stash of its own markup) so right-click → Inspect · Edit (fork) · Share works on the
      // dock, tabs, omnibar and verbs — a self-editable playground, no rewrite. data-holo-chrome marks
      // these wired regions so an Edit FORKS a shareable κ without replacing the running shell. (Fully
      // re-rendering every chrome element FROM the Holo UI library is the staged next pass.)
      (function holoTagChrome() {
        var tries = 0, t = setInterval(function () {
          if (!(window.HoloRender && window.HoloRender.stash)) { if (++tries > 120) clearInterval(t); return; }
          clearInterval(t);
          ["dock", "tabstrip", "omni", "verbs"].forEach(function (id) {
            var el = document.getElementById(id); if (!el || el.getAttribute("data-holo-kappa")) return;
            el.setAttribute("data-holo-managed", "1"); el.setAttribute("data-holo-chrome", "1");
            window.HoloRender.stash(el.outerHTML).then(function (k) { el.setAttribute("data-holo-kappa", k); }).catch(function () {});
          });
          // Render the Build·Run·Share verbs FROM the Holo UI library: each becomes a live shadcn Button
          // κ-object (rendered fast in TS from its κ), the wired original kept hidden + its click delegated
          // (the facade). Now right-click a verb → it IS a Holo UI Button object you can Inspect/Edit/Share.
          var BTN = "holo://sha256:1d581b4f9914ca22003e777f3a0405c6eb123bd2d7941a3a1b56bca50770a285";
          [["verb-build", "✦ Create", "default"], ["verb-run", "▶ Play", "secondary"], ["share-btn", "♥ Share", "ghost"]].forEach(function (v) {
            var orig = document.getElementById(v[0]); if (!orig || orig.dataset.holoFacade) return; orig.dataset.holoFacade = "1";
            var slot = document.createElement("span"); slot.style.display = "inline-flex"; orig.style.display = "none"; orig.after(slot);
            window.HoloRender.render(slot, BTN, { props: { variant: v[2], type: "button", onClick: function (e) { if (e && e.preventDefault) e.preventDefault(); orig.click(); } }, children: v[1] }).catch(function () { orig.style.display = ""; slot.remove(); });
          });
          // The omnibar INPUT stays the native wired control: the app both reads AND writes it per tab
          // (reflectOmni), and it's the shell's primary action — a React facade desync'd + risked it, so
          // simplicity wins (it remains a κ-object, right-click → Inspect/Edit/Share). The "go" key likewise
          // stays native: it's a bespoke holographic spectrum gem (CSS) on-theme with the omnibox ring — a
          // generic shadcn facade would flatten that to plain text, so we keep the jewelled button.
        }, 100);
      })();
