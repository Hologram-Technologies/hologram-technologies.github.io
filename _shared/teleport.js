// teleport.js — ONE reusable Share affordance for every hologram page.
//
// Drop-in, zero config:   <script src="teleport.js" defer></script>
//
// It gives the page a floating "Share" button that builds a TELEPORT LINK — a
// single URL that, opened on ANY device, boots the hologram environment (the
// browser everyone already has) and lands on this exact content. No install, no
// server. The link is handed to the OS share sheet via the W3C Web Share API
// (navigator.share), with a clipboard fallback on desktop browsers that lack it.
//
// Content-addressed (#k=):  if the page knows its κ — via
//     <meta name="holo-kappa" content="blake3:…">  or  HoloTeleport.stamp("blake3:…")
// — the link carries  #k=<κ>  so the content is identified by its hash, not just
// its location. Opening such a link shows a provenance chip; a page that can hand
// us the exact bytes (HoloTeleport.verifyAgainst) gets a TRUE re-derivation check
// (Law L5): a ✓ only when the re-derived κ equals the pinned one — never faked.
//
// κ is computed by the app's own wasm (blake3, identical to the native κ-store)
// when present, else SHA-256 via Web Crypto — the prefix (blake3:/sha256:) always
// names the algorithm, so nothing is ever mislabelled.

(function () {
  "use strict";
  const W = window;
  if (W.HoloTeleport) return;

  const metaOf = (n) => {
    const e = document.querySelector(`meta[name="${n}"]`) || document.querySelector(`meta[property="${n}"]`);
    return e ? (e.getAttribute("content") || "") : "";
  };
  let pageKappa = metaOf("holo-kappa") || "";   // optional content hash for this page

  // ── teleport-link builder ────────────────────────────────────────────────
  // Host-agnostic: uses location.origin, so it works on localhost today and on a
  // real host (e.g. GitHub Pages) the moment you publish — same code.
  function link(opts) {
    opts = opts || {};
    const base = location.origin + location.pathname + (opts.search != null ? opts.search : location.search);
    const k = opts.kappa || pageKappa;
    return base + (k ? "#k=" + encodeURIComponent(k) : (opts.keepHash === false ? "" : location.hash || ""));
  }
  const titleOf = () => (document.title || "hologram").replace(/\s+—\s+holospaces$/i, "") + " · on hologram";
  const textOf = () =>
    metaOf("description") || metaOf("og:description") ||
    "Opens on any device — boots hologram and this content, verified by its content hash. No install.";

  // ── share: OS sheet via Web Share, clipboard fallback ────────────────────
  async function share(opts) {
    const url = link(opts);
    const data = { title: (opts && opts.title) || titleOf(), text: (opts && opts.text) || textOf(), url };
    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
        await navigator.share(data); toast("Shared."); return url;
      }
    } catch (e) { if (e && e.name === "AbortError") return url; }
    try { await navigator.clipboard.writeText(url); toast("Teleport link copied — paste it anywhere."); }
    catch { W.prompt && W.prompt("Teleport link:", url); }
    return url;
  }

  // ── κ helpers — blake3 via the app wasm, else SHA-256 ────────────────────
  let _wasm; // memoised import
  async function kappaOf(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    try {
      if (_wasm === undefined) { _wasm = null; const m = await import("./pkg/holospaces_web.js").catch(() => null); if (m) { if (m.default) await m.default(); _wasm = m; } }
      if (_wasm && _wasm.kappa) { const k = _wasm.kappa(u8); return k.includes(":") ? k : "blake3:" + k; }
    } catch {}
    try {
      const d = await crypto.subtle.digest("SHA-256", u8);
      return "sha256:" + Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
    } catch { return ""; }
  }
  // TRUE verification: re-derive the κ of the given bytes and compare to want.
  async function verifyAgainst(want, bytes) {
    if (!want) return false;
    const got = await kappaOf(bytes);
    const ok = !!got && got === want;
    chip(ok ? "✓ verified genuine · " + shortK(want) : "κ mismatch — refused (content ≠ shared hash)", ok ? "ok" : "bad");
    return ok;
  }
  const shortK = (k) => { const [a, h] = String(k).split(":"); return h ? a + ":" + h.slice(0, 12) + "…" : String(k).slice(0, 16) + "…"; };

  // ── on open: surface #k= provenance, then TRY a real re-derivation check ──
  // Convention: on teleport.js pages, #k= is THIS page's content κ. So we can
  // refetch the page bytes and re-derive — a ✓ only on a true match (Law L5),
  // a refusal banner on mismatch. If the bytes aren't fetchable we leave the
  // neutral provenance chip rather than claim anything.
  async function onOpen() {
    const h = new URLSearchParams((location.hash || "").replace(/^#/, ""));
    const k = h.get("k");
    if (!k) return;
    const want = decodeURIComponent(k);
    chip("content-addressed · κ " + shortK(want), "info");
    try {
      const buf = await (await fetch(location.pathname, { cache: "no-store" })).arrayBuffer();
      const got = await kappaOf(new Uint8Array(buf));
      if (got && got === want) chip("✓ verified genuine · κ " + shortK(want), "ok");
      else if (got && want.split(":")[0] === got.split(":")[0]) chip("κ mismatch — content differs from the shared hash", "bad");
    } catch { /* opaque/cross-origin — keep the neutral provenance chip */ }
  }

  // ── UI: floating Share button + toast + provenance chip (self-contained) ──
  function injectStyle() {
    if (document.getElementById("holo-teleport-css")) return;
    const s = document.createElement("style"); s.id = "holo-teleport-css";
    s.textContent = `
      #holo-toast{position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:2147483001;max-width:88vw;
        background:#11181c;color:#e6edf3;border:1px solid #243038;border-radius:10px;padding:10px 14px;font:var(--holo-text-sm, 1rem) system-ui;
        box-shadow:0 12px 36px rgba(0,0,0,.5);opacity:0;transition:opacity .18s;pointer-events:none}
      #holo-toast.in{opacity:1}
      #holo-chip{position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483001;
        background:#0d1117ee;border:1px solid #243038;border-radius:999px;padding:6px 13px;font:var(--holo-text-sm, 1rem)/1.2 ui-monospace,monospace;
        color:#9fb0bd;backdrop-filter:blur(6px)}
      #holo-chip.ok{border-color:#2dd4bf;color:#7defc9} #holo-chip.bad{border-color:#f87171;color:#fca5a5}`;
    document.head.appendChild(s);
  }
  // (No auto-injected floating "Share" button — removed by request. Sharing remains
  // available programmatically via HoloTeleport.share(); the #k= provenance chip and
  // Law-L5 re-derivation are unaffected.)
  let toastT;
  function toast(m) {
    injectStyle(); let t = document.getElementById("holo-toast");
    if (!t) { t = document.createElement("div"); t.id = "holo-toast"; document.body.appendChild(t); }
    t.textContent = m; requestAnimationFrame(() => t.classList.add("in"));
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("in"), 3600);
  }
  function chip(m, kind) {
    injectStyle(); let c = document.getElementById("holo-chip");
    if (!c) { c = document.createElement("div"); c.id = "holo-chip"; document.body.appendChild(c); }
    c.className = kind || "info"; c.textContent = m;
  }

  function boot() { injectStyle(); onOpen(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  W.HoloTeleport = {
    link, share, kappaOf, verifyAgainst,
    stamp: (k) => { pageKappa = k || ""; },     // page declares its content hash
    toast, chip,
  };
})();
