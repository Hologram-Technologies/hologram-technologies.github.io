// messenger-shadcn-ui.mjs — DROP-IN mount(el, model) rendering the Holo Messenger UX from STREAMING
// shadcn κ-components, faithful to the real app (network app-rail · Q sidebar · triage · rich rows ·
// Q chat pane · earth wallpaper · real SVG line icons), same contract as the chatscope bundle.
//
// ADDITIVE + SAFE: only takes over window.HoloMessengerUI.mount on opt-in (?ui=shadcn or
// localStorage["holo.ui.shadcn"]="1"). Default boot stays the untouched chatscope UI.
//
// PERF: memoized rows · composer owns its draft · windowed thread (≤WINDOW rows in DOM; 1M chat stays tiny).
// PASS 1 = faithful shell. Rich message content + action surface are Pass 2/3.

const WANT = (() => {
  try { const u = new URL(location.href);
    if (u.searchParams.get("ui") === "shadcn") return true;
    if (u.searchParams.get("ui") === "chatscope") return false;
    return localStorage.getItem("holo.ui.shadcn") === "1";
  } catch { return false; }
})();

const WINDOW = 80;
const BRANDS = "/usr/share/brands/";
const WP = "/apps/holo-messenger/_vendor/wallpaper-default.jpg";   // the earth photo (default)
const NET_SLUG = { whatsapp: "whatsapp", telegram: "telegram", signal: "signal", imessage: "imessage", instagram: "instagram", messenger: "messenger", discord: "discord", slack: "slack", gmessages: "googlemessages", googlemessages: "googlemessages", x: "x", twitter: "x", linkedin: "linkedin", gmail: "gmail", email: "gmail", internal: null };

const CSS = `
  .wa{height:100dvh;display:grid;grid-template-columns:64px minmax(300px,.46fr) minmax(0,1fr);background:#0b141a;color:#e9edef;
    font:14.5px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
  .wa *{box-sizing:border-box}
  .wa svg{display:block}
  .rail{background:#111b21;border-right:1px solid #0a1015;display:flex;flex-direction:column;align-items:center;gap:7px;padding:12px 0}
  .rb{position:relative;width:46px;height:46px;border-radius:15px;display:grid;place-items:center;cursor:pointer;color:#aebac1;transition:background .12s,color .12s;background:transparent;border:0}
  .rb:hover{background:#202c33;color:#e9edef}.rb.on{background:#2a3942;color:#00a884}
  .rb img{width:28px;height:28px;border-radius:8px;object-fit:cover}
  .rb .dot{position:absolute;right:5px;bottom:5px;width:10px;height:10px;border-radius:50%;background:#00d95f;border:2px solid #111b21}
  .rb .bdg{position:absolute;top:-3px;right:-3px;min-width:19px;height:19px;border-radius:10px;background:#00a884;color:#0b141a;font-size:11px;font-weight:700;display:grid;place-items:center;padding:0 4px;border:2px solid #111b21}
  .rsep{width:28px;height:1px;background:#22303a;margin:3px 0}
  .rgrow{flex:1 1 auto}
  .rav{width:40px;height:40px;border-radius:50%;overflow:hidden;cursor:pointer;background:radial-gradient(circle at 35% 30%,#7cf0c8,#2b9e7a 60%,#0b3b2e);margin-top:2px}
  .side{background:#111b21;border-right:1px solid #222d34;display:flex;flex-direction:column;min-width:0}
  .stitle{display:flex;align-items:center;gap:6px;padding:15px 14px 10px}
  .stitle .t{font-size:23px;font-weight:600;letter-spacing:-.4px;flex:1 1 auto}
  .search{padding:4px 12px 8px;position:relative}
  .search .si{position:absolute;left:26px;top:50%;transform:translateY(-50%);color:#8696a0;pointer-events:none;z-index:1;display:grid}
  .filt{display:flex;align-items:center;gap:8px;padding:2px 14px 8px}
  .chip{display:inline-flex;align-items:center;gap:6px;background:#202c33;color:#8696a0;border:0;border-radius:999px;padding:5px 14px;font-size:13px;cursor:pointer}
  .chip.on{background:#0b3b2e;color:#00d95f}
  .caret{background:#202c33;color:#8696a0;border:0;border-radius:999px;width:30px;height:28px;display:grid;place-items:center;cursor:pointer;font-size:11px}
  .triage{margin:2px 12px 8px;display:flex;align-items:center;gap:9px;background:linear-gradient(90deg,#0e2a24,#122a1e);color:#7cf0c8;border:1px solid #123c30;border-radius:14px;padding:9px 14px;font-size:13.5px;cursor:pointer}
  .triage .sk{color:#00d95f;display:grid;flex:0 0 auto}
  .chats{flex:1 1 auto;overflow-y:auto;overflow-x:hidden}
  .chats::-webkit-scrollbar{width:6px}.chats::-webkit-scrollbar-thumb{background:#374248;border-radius:6px}
  .row{display:flex;gap:13px;align-items:center;padding:9px 14px;cursor:pointer;position:relative}
  .row:after{content:"";position:absolute;left:78px;right:0;bottom:0;height:1px;background:#1c262d}
  .row:hover{background:#202c33}.row.on{background:#2a3942}.row.on:after{background:transparent}
  .av{position:relative;flex:0 0 auto;border-radius:50%;overflow:hidden}
  .av img{width:100%;height:100%;object-fit:cover;display:block}
  .row .b{min-width:0;flex:1 1 auto}
  .row .n{color:#e9edef;font-size:16px;font-weight:400;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:6px}
  .row .p{color:#8696a0;font-size:13.5px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:3px}
  .row .rc{color:#53bdeb}
  .row .m{margin-left:auto;text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex:0 0 auto}
  .row .t{color:#8696a0;font-size:12px}.row.unread .t{color:#00d95f;font-weight:500}
  .row .pin{color:#f15c6d;font-size:13px;transform:rotate(45deg)}
  .netdot{width:16px;height:16px;border-radius:4px;object-fit:cover;flex:0 0 auto}
  .main{position:relative;display:flex;flex-direction:column;min-width:0;background:#0b141a}
  .wp{position:absolute;inset:0;background:#0b141a center/cover no-repeat;z-index:0}
  .wp:after{content:"";position:absolute;inset:0;background:linear-gradient(rgba(11,20,26,.35),rgba(11,20,26,.5))}
  .mh,.thread,.composer,.e2ewrap{position:relative;z-index:1}
  .mh{height:60px;flex:0 0 auto;background:#202c33;display:flex;align-items:center;gap:14px;padding:0 16px}
  .mh .who .n{font-size:16px;color:#e9edef;font-weight:500}
  .mh .who .s{font-size:13px;color:#00a884;margin-top:1px}
  .mh .sp{margin-left:auto}.mh .icons{display:flex;gap:2px}
  .ico{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;color:#aebac1;cursor:pointer;transition:background .12s;background:transparent;border:0}
  .ico:hover{background:#ffffff14;color:#e9edef}
  .ico.sk{color:#00d95f}
  .e2ewrap{display:flex;justify-content:center;padding:14px 0 2px}
  .e2e{background:#182229;color:#ffd279;font-size:12.5px;padding:6px 14px;border-radius:8px;box-shadow:0 1px .5px #0003}
  .thread{flex:1 1 auto;overflow-y:auto;overflow-x:hidden;padding:10px 8% 14px;display:flex;flex-direction:column;gap:3px}
  .thread::-webkit-scrollbar{width:6px}.thread::-webkit-scrollbar-thumb{background:#374248cc;border-radius:6px}
  .more{align-self:center;color:#8696a0;font-size:12px;padding:8px;opacity:.85}
  .day{align-self:center;background:#182229;color:#8696a0;font-size:12.5px;padding:5px 12px;border-radius:8px;margin:8px 0 6px;box-shadow:0 1px .5px #0003}
  .bub{max-width:65%;padding:6px 9px 8px 10px;border-radius:8px;font-size:14.2px;line-height:1.42;box-shadow:0 1px .5px #0003;word-wrap:break-word;white-space:pre-wrap}
  .in{align-self:flex-start;background:#202c33;border-top-left-radius:0}
  .out{align-self:flex-end;background:#005c4b;border-top-right-radius:0}
  .grp{margin-top:8px}
  .bub .tt{font-size:11px;color:#ffffff8a;float:right;margin:6px 0 -3px 12px;position:relative;top:4px}
  .bub .tt .rc{color:#53bdeb}
  .empty{margin:auto;color:#8696a0;text-align:center;background:#182229;padding:8px 16px;border-radius:8px}
  .composer{flex:0 0 auto;background:#202c33;display:flex;align-items:center;gap:6px;padding:8px 14px}
  .composer .grow{flex:1 1 auto}
  .send{width:44px;height:44px;border-radius:50%;background:#00a884;color:#0b141a;border:0;display:grid;place-items:center;cursor:pointer;flex:0 0 auto}
  /* media */
  .m-img{display:block;max-width:320px;max-height:340px;border-radius:6px;cursor:pointer;object-fit:cover}
  .m-vid{position:relative;max-width:320px;border-radius:6px;overflow:hidden;cursor:pointer}
  .m-vid img{display:block;width:100%;border-radius:6px}
  .m-play{position:absolute;inset:0;display:grid;place-items:center}
  .m-play span{width:48px;height:48px;border-radius:50%;background:#0009;color:#fff;display:grid;place-items:center;font-size:20px}
  .m-file{display:flex;align-items:center;gap:10px;background:#ffffff0f;border-radius:8px;padding:9px 11px;min-width:200px;cursor:pointer}
  .m-file .fi{width:38px;height:38px;border-radius:8px;background:#00a88433;color:#7cf0c8;display:grid;place-items:center;font-size:16px;flex:0 0 auto}
  .m-file .fn{font-size:13.5px;color:#e9edef;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .m-file .fs{font-size:12px;color:#8696a0;margin-top:2px}
  .m-aud{display:flex;align-items:center;gap:10px;min-width:220px;padding:2px 0}
  .m-aud audio{height:34px}
  .lb{position:fixed;inset:0;background:#000c;z-index:60;display:grid;place-items:center;cursor:zoom-out}
  .lb img,.lb video{max-width:90vw;max-height:90vh;border-radius:8px}
  .lb .x{position:absolute;top:18px;right:22px;color:#fff;font-size:28px;cursor:pointer;background:0;border:0}
  /* attach tray + pay sheet */
  .tray{position:absolute;bottom:66px;left:14px;background:#233138;border-radius:12px;box-shadow:0 10px 34px #0009;padding:6px;z-index:6;min-width:236px}
  .tray button{display:flex;align-items:center;gap:11px;width:100%;background:0;border:0;color:#e9edef;font-size:14.5px;padding:10px 12px;border-radius:8px;cursor:pointer;text-align:left}
  .tray button:hover{background:#2a3942}.tray button:disabled{opacity:.5}
  .tray .sep{height:1px;background:#2a3942;margin:4px 6px}
  .paywrap{position:fixed;inset:0;background:#000a;z-index:60;display:grid;place-items:center}
  .pay{background:#111b21;border-radius:14px;padding:20px;width:346px;max-width:90vw;box-shadow:0 20px 60px #000a}
  .pay h3{margin:0 0 4px;font-size:17px}.pay .psub{color:#8696a0;font-size:13px;margin-bottom:14px}
  .pay .seg{display:flex;background:#202c33;border-radius:10px;padding:3px;margin-bottom:14px}
  .pay .seg button{flex:1;background:0;border:0;color:#8696a0;padding:8px;border-radius:8px;cursor:pointer;font-size:14px}
  .pay .seg button.on{background:#00a884;color:#0b141a;font-weight:600}
  .pay .amt{width:100%;background:#202c33;border:0;border-radius:10px;color:#e9edef;font-size:26px;text-align:center;padding:12px;margin-bottom:10px;outline:0}
  .pay .chips{display:flex;gap:8px;margin-bottom:12px}
  .pay .chips button{flex:1;background:#202c33;border:0;color:#e9edef;border-radius:8px;padding:9px;cursor:pointer}
  .pay .chips button.on{background:#0b3b2e;color:#00d95f}
  .pay .memo{width:100%;background:#202c33;border:0;border-radius:10px;color:#e9edef;padding:10px 12px;margin-bottom:12px;font-size:14px;outline:0}
  .pay .err{color:#f15c6d;font-size:13px;margin-bottom:8px;text-align:center}
  .pay .go{width:100%;background:#00a884;color:#0b141a;border:0;border-radius:10px;padding:12px;font-weight:600;cursor:pointer;font-size:15px}
  .pay .go:disabled{opacity:.5;cursor:default}
  .pay .cancel{width:100%;background:0;color:#8696a0;border:0;padding:10px;margin-top:6px;cursor:pointer}
`;

async function ensureImportmap() {
  if (document.querySelector('script[type="importmap"][data-holo-ui]')) return;
  const map = await (await fetch("/apps/ui/vendor/importmap.json")).json();
  const imports = {}; for (const [k, v] of Object.entries(map.imports || map)) imports[k] = typeof v === "string" ? v.replace(/^\.\//, "/apps/ui/") : v;
  const s = document.createElement("script"); s.type = "importmap"; s.setAttribute("data-holo-ui", "1"); s.textContent = JSON.stringify({ imports }); document.head.appendChild(s);
}
let _deps = null;
async function deps() {
  if (_deps) return _deps;
  await ensureImportmap();
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const reg = await (await fetch("/apps/ui/registry/index.json")).json();
  const K = Object.fromEntries(reg.components.map((c) => [c.name, c.holo]));
  const [button, badge, avatar, input] = await Promise.all(["button", "badge", "avatar", "input"].map((n) => import(K[n])));
  return (_deps = { React, createRoot, C: { button, badge, avatar, input } });
}
if (!document.getElementById("wa-shadcn-css")) { const st = document.createElement("style"); st.id = "wa-shadcn-css"; st.textContent = CSS; document.head.appendChild(st); }

const initials = (s) => (String(s || "?").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2) || "?").toUpperCase();
const hue = (s) => { let h = 0; s = String(s || ""); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return `hsl(${h % 360} 40% 46%)`; };
const isOut = (m) => !!(m && (m.mine || m.out || m.fromMe || m.dir === "out" || m.from === "me" || m.self));
const threadOf = (model, id) => { try { if (id && model.thread) return model.thread(id) || []; } catch {} return (model.threads && model.threads[id]) || []; };
const rcMark = (m) => m.status === "read" || m.status === "delivered" ? "✓✓" : m.status === "sent" ? "✓" : "";
const slugOf = (net) => { const k = String(net || "").toLowerCase(); return NET_SLUG[k] === undefined ? k : NET_SLUG[k]; };
const mimeKind = (mime, kind) => { const k = String(kind || "").toLowerCase(); if (["image", "video", "audio", "voice"].includes(k)) return k === "voice" ? "audio" : k; const t = String(mime || "").split("/")[0]; if (t === "image" || t === "video" || t === "audio") return t; return "file"; };
const humanSize = (n) => { n = +n || 0; if (!n) return ""; const u = ["B", "KB", "MB", "GB"]; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return (n < 10 && i ? n.toFixed(1) : Math.round(n)) + " " + u[i]; };
const fileGlyph = (mime, name) => { const m = String(mime || ""), e = String(name || "").split(".").pop().toLowerCase(); if (m.includes("pdf") || e === "pdf") return "📕"; if (["zip", "rar", "7z"].includes(e)) return "🗜"; if (["doc", "docx"].includes(e)) return "📘"; if (["xls", "xlsx", "csv"].includes(e)) return "📗"; return "📄"; };

function buildApp({ React, C }) {
  const { createElement: h, memo, useState, useRef, useEffect, useCallback, useLayoutEffect } = React;
  const Avatar = C.avatar.Avatar, AvatarImage = C.avatar.AvatarImage, AvatarFallback = C.avatar.AvatarFallback;
  const Button = C.button.Button, Input = C.input.Input, Badge = C.badge.Badge;

  // exact SVG line icons (from the real app's IC set)
  const svg = (kids, s = 22, w = 1.8) => h("svg", { viewBox: "0 0 24 24", width: s, height: s, fill: "none", stroke: "currentColor", strokeWidth: w, strokeLinecap: "round", strokeLinejoin: "round" }, ...kids);
  const P = (d, e) => h("path", { d, ...e });
  const CIR = (cx, cy, r, e) => h("circle", { cx, cy, r, ...e });
  const RC = (x, y, width, height, rx, e) => h("rect", { x, y, width, height, rx, ...e });
  const fillC = { fill: "currentColor", stroke: "none" };
  const IC = {
    chats: () => svg([P("M20 11.4A7.6 7.6 0 0 1 8.9 18.2L4.5 19.4l1.2-4.2A7.6 7.6 0 1 1 20 11.4Z")]),
    search: (s) => svg([CIR(11, 11, 7), P("m20 20-3.6-3.6")], s || 19),
    phone: () => svg([P("M6.6 4H4.5A1.5 1.5 0 0 0 3 5.6 16 16 0 0 0 18.4 21a1.5 1.5 0 0 0 1.6-1.5v-2.1a1.5 1.5 0 0 0-1.2-1.45l-2.2-.45a1.5 1.5 0 0 0-1.5.6l-.5.7a12 12 0 0 1-5.1-5.1l.7-.5a1.5 1.5 0 0 0 .6-1.5l-.45-2.2A1.5 1.5 0 0 0 6.6 4Z")]),
    video: () => svg([RC(3, 6.5, 12, 11, 2.5), P("m15 10.5 5.5-3v9l-5.5-3Z")]),
    menu: () => svg([CIR(12, 5, 1.35, fillC), CIR(12, 12, 1.35, fillC), CIR(12, 19, 1.35, fillC)]),
    newchat: () => svg([P("M13.5 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.5"), P("M18.4 3.6a2 2 0 0 1 2.8 2.8L13 14.6l-3.4.9.9-3.4 7.9-8.5Z")]),
    emoji: () => svg([CIR(12, 12, 8.5), P("M8.8 14.2a4.2 4.2 0 0 0 6.4 0"), CIR(9, 10, 1, fillC), CIR(15, 10, 1, fillC)]),
    plus: () => svg([P("M12 5.5v13M5.5 12h13")]),
    mic: () => svg([RC(9, 3, 6, 11, 3), P("M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7")]),
    send: () => svg([P("M4.5 12 20.5 4.5 13 20.5l-2.8-6.4L4.5 12Z")]),
    spark: (s) => svg([P("M12 3.2l1.7 4.6 4.6 1.7-4.6 1.7L12 15.8l-1.7-4.6L5.7 9.5l4.6-1.7L12 3.2Z"), P("M5.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z")], s || 20),
    sun: () => svg([CIR(12, 12, 4), P("M12 2v2M12 20v2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M18.4 5.6l1.4-1.4M4.2 19.8l1.4-1.4")]),
    plusThin: () => svg([P("M12 5.5v13M5.5 12h13")], 26, 1.6),
  };

  const Av = (name, size, bg, src) => h("div", { className: "av", style: { height: size + "px", width: size + "px" } },
    h(Avatar, { style: { height: "100%", width: "100%", background: bg || hue(name), display: "grid", placeItems: "center" } },
      src ? h(AvatarImage, { src, alt: "", style: { height: "100%", width: "100%", objectFit: "cover" } }) : null,
      h(AvatarFallback, { style: { background: bg || hue(name), color: "#fff", fontSize: (size * 0.36) + "px", fontWeight: 500, height: "100%", width: "100%", display: "grid", placeItems: "center" } }, initials(name))));
  const Ico = (icon, onClick, title, cls) => h("button", { className: "ico" + (cls ? " " + cls : ""), onClick, title }, icon);
  const netLogo = (net) => { const s = slugOf(net); return s ? h("img", { className: "netdot", src: BRANDS + s + ".svg", alt: "", onError: (e) => { e.currentTarget.style.display = "none"; } }) : null; };

  // rich media in a bubble — image/video/audio/file, with lazy bridge-media resolution
  function MediaView({ media, model, onMedia }) {
    const [url, setUrl] = useState(media.url || media.thumb || "");
    const bucket = mimeKind(media.mime, media.kind);
    useEffect(() => { let alive = true;
      if (!media.url && (media.lazy || media.pending || media.ref) && model.resolveBridgeMedia) {
        Promise.resolve(model.resolveBridgeMedia(media)).then((u) => { if (alive && u) setUrl(typeof u === "string" ? u : (u.url || u.src || "")); }).catch(() => {});
      } return () => { alive = false; }; }, []);
    if (bucket === "image") return url ? h("img", { className: "m-img", src: url, alt: "", loading: "lazy", onClick: () => onMedia({ kind: "image", url }) }) : h("div", { className: "m-file" }, "🖼 Photo");
    if (bucket === "video") return h("div", { className: "m-vid", onClick: () => onMedia({ kind: "video", url }) }, h("img", { src: media.thumb || url, alt: "" }), h("div", { className: "m-play" }, h("span", {}, "▶")));
    if (bucket === "audio") return h("div", { className: "m-aud" }, url ? h("audio", { controls: true, src: url }) : h("span", {}, "🎤 Voice message"));
    return h("div", { className: "m-file", onClick: () => url && window.open(url, "_blank") }, h("div", { className: "fi" }, fileGlyph(media.mime, media.filename)), h("div", { style: { minWidth: 0 } }, h("div", { className: "fn" }, media.filename || "File"), media.size ? h("div", { className: "fs" }, humanSize(media.size)) : null));
  }

  const Rail = memo(function Rail({ nets, active, totalUnread, onPick }) {
    return h("nav", { className: "rail" },
      h("button", { className: "rb" + (active === "All" ? " on" : ""), title: "All chats", onClick: () => onPick("All") }, IC.chats(), totalUnread ? h("span", { className: "bdg" }, totalUnread > 99 ? "99+" : totalUnread) : null),
      nets.length ? h("div", { className: "rsep" }) : null,
      nets.map((n) => h("button", { key: n.id, className: "rb" + (active === n.id ? " on" : ""), title: n.label, onClick: () => onPick(n.id) },
        (() => { const s = slugOf(n.id); return s ? h("img", { src: BRANDS + s + ".svg", alt: n.label, onError: (e) => { const t = document.createTextNode((n.label || "?")[0].toUpperCase()); try { e.currentTarget.replaceWith(t); } catch {} } }) : (n.label || "?")[0].toUpperCase(); })(),
        h("span", { className: "dot" }), n.unread ? h("span", { className: "bdg" }, n.unread > 99 ? "99+" : n.unread) : null)),
      h("button", { className: "rb", title: "Add network", onClick: () => onPick("+") }, IC.plusThin()),
      h("div", { className: "rgrow" }),
      h("div", { className: "rav" }));
  });

  const Row = memo(function Row({ c, on, preview, receipt, onSelect }) {
    return h("div", { className: "row" + (on ? " on" : "") + (c.unread ? " unread" : ""), onClick: () => onSelect(c.id) },
      Av(c.name, 49, c.isQ ? "#12b886" : hue(c.name), c.avatar),
      h("div", { className: "b" },
        h("div", { className: "n" }, c.name || c.id || "Chat", c.network ? netLogo(c.network) : null),
        h("div", { className: "p" }, receipt ? h("span", { className: "rc" }, receipt + " ") : null, preview)),
      h("div", { className: "m" },
        h("div", { className: "t" }, c.time || c.ts || ""),
        c.pinned ? h("span", { className: "pin" }, "📌") : null,
        c.unread ? h(Badge, { style: { background: "#00a884", color: "#0b141a", borderRadius: "999px", height: "20px", minWidth: "20px", justifyContent: "center", padding: "0 6px", fontSize: "12px", fontWeight: 600 } }, String(c.unread)) : null));
  });

  function Thread({ model, activeId, onMedia }) {
    const all = threadOf(model, activeId);
    const [limit, setLimit] = useState(WINDOW);
    const ref = useRef(null), prevId = useRef(activeId), anchorH = useRef(0), pin = useRef(true);
    const toBottom = (el) => { el.scrollTop = el.scrollHeight; };
    useEffect(() => { setLimit(WINDOW); }, [activeId]);
    // Runs after every render (no deps): a fresh chat, or new messages arriving, both flow through here.
    // While "pinned" we stay glued to the newest message — exactly like WhatsApp.
    useLayoutEffect(() => { const el = ref.current; if (!el) return;
      if (prevId.current !== activeId) { prevId.current = activeId; pin.current = true; anchorH.current = 0; toBottom(el); return; }
      if (anchorH.current) { el.scrollTop = el.scrollHeight - anchorH.current; anchorH.current = 0; return; }
      if (pin.current) toBottom(el); });
    // Media resolves async (placeholder first, <img> swapped in later) and reflows the thread AFTER layout.
    // A ResizeObserver on the scroll container won't catch it (its own box size never changes), and per-image
    // listeners miss images added later — so listen for `load` in the CAPTURE phase on the container, which
    // fires for ANY descendant image whenever it appears/loads. Keeps us glued to the newest message.
    useEffect(() => { const el = ref.current; if (!el) return; pin.current = true; toBottom(el);
      requestAnimationFrame(() => { if (pin.current && ref.current) toBottom(ref.current); });
      const stick = () => { if (pin.current && ref.current) toBottom(ref.current); };
      el.addEventListener("load", stick, true); el.addEventListener("error", stick, true);
      return () => { el.removeEventListener("load", stick, true); el.removeEventListener("error", stick, true); };
    }, [activeId]);
    // Detach when the user scrolls up; re-attach ("jump to latest") once they're back near the bottom.
    const onScroll = useCallback((e) => { const el = e.currentTarget;
      pin.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      if (el.scrollTop < 120 && limit < all.length) { anchorH.current = el.scrollHeight; setLimit((l) => Math.min(all.length, l + WINDOW)); } }, [limit, all.length]);
    const start = Math.max(0, all.length - limit), shown = all.slice(start);
    if (!all.length) return h("div", { className: "thread", ref }, h("div", { className: "empty" }, "No messages yet. Say hello 👋"));
    const rows = [h("div", { className: "e2ewrap", key: "e2e" }, h("div", { className: "e2e" }, "🔒 Messages are end-to-end encrypted")), h("div", { className: "day", key: "day" }, "Today")];
    if (start > 0) rows.push(h("div", { className: "more", key: "more" }, `↑ ${start.toLocaleString()} earlier — scroll up`));
    let lastOut = null;
    shown.forEach((m, i) => { const out = isOut(m); const hasMedia = m.media && (m.media.url || m.media.thumb || m.media.ref || m.media.lazy || m.media.kind);
      rows.push(h("div", { key: start + i, className: "bub " + (out ? "out" : "in") + (out !== lastOut ? " grp" : ""), style: hasMedia ? { maxWidth: "min(360px,72%)" } : null },
        hasMedia ? h(MediaView, { media: m.media, model, onMedia }) : null,
        m.text ? h("div", { style: hasMedia ? { marginTop: "5px" } : null }, m.text) : null,
        h("span", { className: "tt" }, (m.time || m.ts || ""), out ? h("span", { className: "rc" }, " " + rcMark(m)) : null)));
      lastOut = out; });
    return h("div", { className: "thread", ref, onScroll }, rows);
  }

  const Composer = memo(function Composer({ activeId, onSend, onPlus }) {
    const [draft, setDraft] = useState("");
    const send = () => { const t = draft.trim(); if (!t) return; onSend(activeId, t); setDraft(""); };
    return h("div", { className: "composer" },
      Ico(IC.plus(), onPlus, "Attach"),
      h("div", { className: "grow" }, h(Input, { placeholder: "Type a message", value: draft, autoFocus: true,
        onChange: (e) => setDraft(e.target.value), onKeyDown: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } },
        style: { background: "#2a3942", border: "0", borderRadius: "10px", height: "44px", color: "#e9edef", paddingLeft: "16px" } })),
      h("button", { className: "send", onClick: send, "aria-label": "Send" }, draft.trim() ? IC.send() : IC.mic()));
  });

  const TrayBtn = (glyph, label, onClick, disabled) => h("button", { onClick, disabled }, h("span", { style: { fontSize: "17px" } }, glyph), label);

  function PaySheet({ model, activeId, conv, sheet, setSheet }) {
    const set = (patch) => setSheet((s) => ({ ...s, ...patch, err: null }));
    const amt = parseFloat(sheet.amount);
    const go = async () => { set({ busy: true }); let r;
      try { r = await model.holoPay(sheet.genesis || activeId, { kind: sheet.kind, amount: amt, memo: (sheet.memo || "").trim() }); } catch (e) { r = { ok: false, error: String(e && e.message || e) }; }
      if (r && r.ok) setSheet(null); else setSheet((s) => ({ ...s, busy: false, err: (r && r.error) || "Couldn't create the payment" })); };
    return h("div", { className: "paywrap", onClick: () => setSheet(null) },
      h("div", { className: "pay", onClick: (e) => e.stopPropagation() },
        h("h3", {}, sheet.kind === "send" ? "Send money" : "Request money"), h("div", { className: "psub" }, (sheet.kind === "send" ? "To " : "From ") + (conv.name || "this chat")),
        h("div", { className: "seg" }, h("button", { className: sheet.kind === "send" ? "on" : "", onClick: () => set({ kind: "send" }) }, "Send"), h("button", { className: sheet.kind === "request" ? "on" : "", onClick: () => set({ kind: "request" }) }, "Request")),
        h("input", { className: "amt", inputMode: "decimal", placeholder: "$0", value: sheet.amount, onChange: (e) => set({ amount: e.target.value.replace(/[^0-9.]/g, "") }), autoFocus: true }),
        h("div", { className: "chips" }, [10, 20, 50, 100].map((a) => h("button", { key: a, className: amt === a ? "on" : "", onClick: () => set({ amount: String(a) }) }, "$" + a))),
        h("input", { className: "memo", placeholder: "What's it for? (optional)", maxLength: 120, value: sheet.memo || "", onChange: (e) => set({ memo: e.target.value }) }),
        sheet.err ? h("div", { className: "err" }, sheet.err) : null,
        h("button", { className: "go", disabled: sheet.busy || !(amt > 0), onClick: go }, sheet.busy ? (sheet.kind === "send" ? "Confirm in your wallet…" : "Creating…") : ((sheet.kind === "send" ? "Send" : "Request") + (amt > 0 ? " $" + sheet.amount : " money"))),
        h("button", { className: "cancel", onClick: () => setSheet(null) }, "Cancel")));
  }

  const previewOf = (model, c) => { if (c.preview) return c.preview; const t = threadOf(model, c.id); const last = t.length ? t[t.length - 1] : null; return (last && (last.text || (last.media ? "📎 media" : ""))) || ""; };

  return function App({ model }) {
    const convs = Array.isArray(model.conversations) ? model.conversations : [];
    const [activeId, setActiveId] = useState(null);
    const [filter, setFilter] = useState("All");
    const [q, setQ] = useState("");
    const [lb, setLb] = useState(null);
    const [attachOpen, setAttachOpen] = useState(false);
    const [paySheet, setPaySheet] = useState(null);
    const fileRef = useRef(null);
    const onSelect = useCallback((id) => { setActiveId(id); setAttachOpen(false); }, []);
    const active = (activeId && convs.some((c) => c.id === activeId)) ? activeId : ((convs.find((c) => c.active) || convs[0] || {}).id || null);
    const conv = convs.find((c) => c.id === active) || {};
    const onSend = useCallback((id, text) => { try { model.onSend && model.onSend(id, text); } catch (e) { console.error("[shadcn-ui] onSend", e); } }, [model]);
    const call = useCallback((video) => { try { model.startCall && model.startCall(active, { video }); } catch (e) { console.error("[shadcn-ui] startCall", e); } }, [model, active]);
    const pickFile = (accept) => { if (fileRef.current) { fileRef.current.accept = accept; fileRef.current.click(); } setAttachOpen(false); };
    const onFile = (e) => { const f = e.target.files && e.target.files[0]; if (f) { try { model.onAttach && model.onAttach(active, f); } catch (er) { console.error("[shadcn-ui] onAttach", er); } } e.target.value = ""; };
    const tryM = (fn, ...a) => { setAttachOpen(false); try { const r = model[fn] && model[fn](...a); if (r && r.catch) r.catch(() => {}); } catch (e) { console.error("[shadcn-ui] " + fn, e); } };
    const nets = Array.isArray(model.networks) && model.networks.length ? model.networks
      : Object.values(convs.reduce((a, c) => { const id = (c.network || c.platform); if (id && !a[id]) a[id] = { id, label: id[0].toUpperCase() + id.slice(1), unread: 0 }; if (id) a[id].unread += (c.unread || 0); return a; }, {}));
    const totalUnread = convs.reduce((n, c) => n + (c.unread || 0), 0);
    const signalUnread = model.signalUnread != null ? model.signalUnread : convs.filter((c) => c.unread).length;
    const qs = q.trim().toLowerCase();
    const shown = convs.filter((c) => (filter === "All" || (c.network || c.platform) === filter) && (!qs || (c.name || "").toLowerCase().includes(qs) || (previewOf(model, c) || "").toLowerCase().includes(qs)));
    const sub = conv.presence || (conv.isQ ? "online · on your device" : (conv.status || conv.network || conv.platform || ""));
    const runSearch = () => { const t = q.trim(); if (!t) return; try { if (model.qCommand) model.qCommand(t); else if (model.onNewChat) model.onNewChat(t); } catch {} };

    return h("div", { className: "wa" },
      h(Rail, { nets, active: filter, totalUnread, onPick: (id) => { if (id === "+") { try { model.openNetworks && model.openNetworks(); } catch {} } else setFilter(id); } }),
      h("div", { className: "side" },
        h("div", { className: "stitle" }, h("span", { className: "t" }, "Messenger"),
          model.askQ ? Ico(IC.spark(), () => { try { model.askQ(); } catch {} }, "Ask Q", "sk") : null, Ico(IC.newchat(), () => { try { model.onNewChat && model.onNewChat(""); } catch {} }, "New chat")),
        h("div", { className: "search" }, h("span", { className: "si" }, IC.search()),
          h(Input, { placeholder: "Search, ask Q, or start a chat…", value: q, onChange: (e) => setQ(e.target.value), onKeyDown: (e) => { if (e.key === "Enter") runSearch(); },
            style: { background: "#202c33", border: "0", borderRadius: "10px", height: "42px", color: "#e9edef", paddingLeft: "40px", fontSize: "14.5px" } })),
        signalUnread ? h("div", { className: "triage" }, h("span", { className: "sk" }, IC.spark(18)), `${signalUnread} need you · ~${Math.max(1, Math.round(signalUnread * 0.4))} min`) : null,
        h("div", { className: "chats" }, shown.map((c) => h(Row, { key: c.id, c, on: c.id === active, preview: previewOf(model, c), receipt: c.receipt || "", onSelect })))),
      h("div", { className: "main" },
        h("div", { className: "wp", style: { backgroundImage: `url(${WP})` } }),
        h("div", { className: "mh" }, Av(conv.name, 40, conv.isQ ? "#12b886" : hue(conv.name), conv.avatar),
          h("div", { className: "who" }, h("div", { className: "n" }, conv.name || ""), sub ? h("div", { className: "s" }, sub) : null),
          h("div", { className: "sp" }), h("div", { className: "icons" }, Ico(IC.video(), () => call(true), "Video call"), Ico(IC.phone(), () => call(false), "Voice call"), Ico(IC.menu(), () => { try { model.onFavourite && model.onFavourite(active); } catch {} }, "Menu"))),
        h(Thread, { model, activeId: active, onMedia: setLb }),
        h("input", { ref: fileRef, type: "file", style: { display: "none" }, onChange: onFile }),
        attachOpen ? h("div", { className: "tray" },
          TrayBtn("🖼", "Photos & videos", () => pickFile("image/*,video/*")),
          TrayBtn("📄", "Document", () => pickFile("*/*")),
          (conv.network && !conv.isQ && model.holoPay) ? TrayBtn("💸", "Send money", () => { setAttachOpen(false); setPaySheet({ kind: "send", amount: "", memo: "", busy: false, err: null }); }) : null,
          h("div", { className: "sep" }),
          model.startMeet ? TrayBtn("👥", "Start a meeting", () => tryM("startMeet", active, { video: true })) : null,
          model.startTogether ? TrayBtn("🖥", "Share my screen", () => tryM("startTogether", active, { kind: "tab", title: "" })) : null,
          model.startTogether ? TrayBtn("📝", "Co-edit a doc", () => tryM("startTogether", active, { kind: "doc", title: "" })) : null,
          (conv.network && !conv.isQ && model.qDraft) ? [h("div", { className: "sep", key: "s" }), TrayBtn("✨", "Draft a reply with Q", () => tryM("qDraft", active))] : null) : null,
        h(Composer, { key: active, activeId: active, onSend, onPlus: () => setAttachOpen((v) => !v) })),
      lb ? h("div", { className: "lb", onClick: () => setLb(null) }, h("button", { className: "x", "aria-label": "Close" }, "✕"),
        lb.kind === "video" ? h("video", { src: lb.url, controls: true, autoPlay: true, onClick: (e) => e.stopPropagation() }) : h("img", { src: lb.url, alt: "", onClick: (e) => e.stopPropagation() })) : null,
      paySheet ? h(PaySheet, { model, activeId: active, conv, sheet: paySheet, setSheet: setPaySheet }) : null);
  };
}

async function mount(el, model) {
  const d = await deps();
  const App = buildApp(d);
  let cur = model;
  const root = d.createRoot(el);
  const render = (mdl) => { cur = mdl || cur; root.render(d.React.createElement(App, { model: cur })); };
  render(model);
  console.log("[shadcn-ui] Holo Messenger (Pass 1) mounted from κ-components ·", (model.conversations || []).length, "chats");
  return { update: render, unmount: () => { try { root.unmount(); } catch {} } };
}

if (WANT && typeof window !== "undefined") {
  const prev = window.HoloMessengerUI;
  window.HoloMessengerUI = { mount, version: ((prev && prev.version) || "m1") + "+shadcn", _chatscope: prev };
  console.log("[shadcn-ui] streaming-κ shadcn UI ACTIVE (opt out: ?ui=chatscope)");
}

export { mount };
