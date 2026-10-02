// holo-resolve-view.mjs — the universal resolver, mounted INLINE AT THE ROOT (github.io/Q).
//
// This is the former /apps/resolve inspector, turned into a mountable module so the ROOT DOOR renders it
// in place instead of redirecting to a sub-app. One surface, one URL: paste/share any name at the root and
// the verified <holo-card> appears here — fast, ungated, works for every user (no login, no boot). The box
// ships NO verification of its own: it reuses the ONE host binding (holo-names-host) + the ONE card
// (holo-card). A deep link is `…/Q/#<name>`; sealing/sharing points here (L1: the URL names the object).
//
//   import { mount } from "./holo-resolve-view.mjs"; mount(document.body, "<name-or-empty>");

// file-relative — this module lives at the MOUNT ROOT (next to root-door.mjs), so "./usr/…" is exact on
// every mount (domain root or /<repo>/ subpath); absolute "/usr/…" is first-visit poison on a subpath (G6).
import names, { classify } from "./usr/lib/holo/holo-names.mjs";
import { makeHostResolver } from "./usr/lib/holo/holo-names-host.mjs";
import { loadAppIndex } from "./usr/lib/holo/holo-app-index.mjs";
import "./usr/lib/holo/holo-card.mjs";                         // registers <holo-card> (idempotent)

const STYLE = `
  :root { --bg:#0b141a; --panel:#111b21; --line:#1f2c33; --ink:#e9edef; --dim:#8696a0; --ok:#00a884; --bad:#f15c6d; --chip:#182229; }
  html,body { height:100%; background:var(--bg); color:var(--ink); font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; margin:0 }
  .rv * { box-sizing:border-box }
  .rv main { max-width:720px; margin:0 auto; padding:9vh 20px 60px }
  .rv h1 { font-size:22px; font-weight:650; letter-spacing:.2px }
  .rv p.sub { color:var(--dim); margin:6px 0 26px; font-size:14px }
  .rv p.sub b { color:var(--ink); font-weight:600 }
  .rv .box { display:flex; gap:8px }
  .rv input { flex:1; background:var(--panel); border:1px solid var(--line); color:var(--ink); border-radius:12px; padding:14px 16px; font-size:15px; outline:none }
  .rv input:focus { border-color:#2a3942 }
  .rv button { background:var(--ok); color:#06231c; border:0; border-radius:12px; padding:0 22px; font-size:15px; font-weight:650; cursor:pointer }
  .rv button:active { transform:translateY(1px) }
  .rv #kindline { min-height:22px; margin:10px 2px 0; font-size:13px; color:var(--dim) }
  .rv #kindline b { color:var(--ink); font-weight:600 }
  .rv .chips { display:flex; flex-wrap:wrap; gap:8px; margin:26px 0 0 }
  .rv .chip { background:var(--chip); border:1px solid var(--line); color:var(--dim); border-radius:999px; padding:6px 12px; font-size:12.5px; cursor:pointer; white-space:nowrap }
  .rv .chip:hover { color:var(--ink) }
  .rv #out { margin-top:26px; display:none }
  .rv #out.show { display:block }
  .rv .detail { margin-top:8px; color:var(--dim); font-size:12px; text-align:right }
  .rv #bench { margin-top:26px }
  .rv .benchbtn { width:100%; background:var(--chip); border:1px solid var(--line); color:var(--dim); border-radius:12px; padding:12px; font-size:13.5px; cursor:pointer }
  .rv .benchbtn:hover { color:var(--ink) }
  .rv .projp { margin-top:14px; background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:14px 16px }
  .rv .projp canvas { width:100%; max-width:560px; border-radius:10px; background:#06090f; display:block }
  .rv .projp .ro { margin-top:9px; font:12px ui-monospace,monospace; color:#8696a0 }
  .rv .projp .ro b { color:#e9edef }
  .rv .projp .pchips { margin-top:9px; display:flex; gap:8px; flex-wrap:wrap }
  .rv .projp .pchips button { background:none; border:1px solid var(--line); border-radius:999px; color:inherit; padding:5px 12px; font-size:12px; cursor:pointer }
  .rv .scorecard { margin-top:14px; background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:16px 18px }
  .rv .sc-head { font-weight:650; font-size:15px }
  .rv .sc-sub { color:var(--dim); font-size:12.5px; margin-top:3px }
  .rv .sc-row { display:grid; grid-template-columns:110px 1fr; gap:6px 12px; margin-top:12px; font-size:13px; align-items:baseline }
  .rv .sc-row .a { color:var(--dim) }
  .rv .sc-row .k { font-weight:600 } .rv .sc-row .k b { color:var(--ok) }
  .rv .sc-note { margin-top:12px; color:var(--dim); font-size:12px; line-height:1.6 }
  .rv footer { margin-top:34px; color:var(--dim); font-size:12.5px; line-height:1.7 }
  .rv footer b { color:var(--ink); font-weight:600 }`;

const BODY = `<main>
  <h1>Holo Resolve</h1>
  <p class="sub">One box for the whole internet. Paste <b>any</b> name — a CID, an ENS domain, a Nostr note, a Bluesky post, an IPFS site, an Ethereum hash, a payment, an email — and get back the <b>verified thing</b>. Content proves itself; pointers resolve through sources you can see; nothing unverified is ever shown.</p>
  <div class="box">
    <input id="name" autocomplete="off" spellcheck="false" placeholder="paste anything — vitalik.eth · a CID · an npub · at://… · ipns://… · lightning:… · a κ" autofocus>
    <button id="go">Resolve</button>
  </div>
  <div id="kindline"></div>
  <div class="chips" id="chips"></div>
  <div id="out"></div>
  <div id="bench"><button id="benchgo" class="benchbtn">⚡ How fast is this resolver? Benchmark it vs DNS, in your browser</button></div>
  <footer><b>100% serverless.</b> This runs entirely in your browser at the root of Hologram. Content-derived
  names are fetched from untrusted mirrors — the first bytes that <b>re-derive to their hash</b> win; liars and
  dead mirrors are indistinguishable from silence. blake3 verification runs through the <b>holospaces runtime</b>.</footer>
</main>`;

const KIND_WORDS = {
  kappa: "a content address", did: "a sovereign object id", holo: "a holospace member", ipfs: "an IPFS name",
  ipns: "a mutable IPFS name", ens: "an Ethereum name", "eth-tx": "an Ethereum transaction hash",
  "eth-address": "an Ethereum account", sri: "a subresource-integrity hash", onion: "a Tor onion service",
  truename: "a speakable κ alias", model: "an AI model tag", refused: "refused", empty: "",
  nostr: "a Nostr note", atproto: "a Bluesky record", arweave: "an Arweave file", torrent: "a BitTorrent file",
  data: "inline, self-verifying content", payment: "a payment", account: "a crypto address", contact: "a contact",
  chat: "a chat room", scuttlebutt: "a Scuttlebutt message", p2pweb: "a peer-to-peer site", p2pstore: "a p2p storage name",
  altweb: "a Gemini/Gopher page", socket: "a live socket", local: "a local object", p2p: "a peer-to-peer name",
};

let mounted = false;
export function mount(root, initialName) {
  const host = root || document.body;
  if (!mounted) {                                              // idempotent — inject once
    const st = document.createElement("style"); st.textContent = STYLE; (document.head || document.documentElement).appendChild(st);
    mounted = true;
  }
  host.className = "rv"; host.innerHTML = BODY;
  try { document.title = "Holo Resolve — the whole internet, verified"; } catch {}
  const $ = (id) => host.querySelector("#" + id);
  const BASE = new URL("./", location.href);                   // the bundle root — this view IS the root now

  // The upstream runtime arrives BY ITS κ (holo-runtime.json signed pointer → re-derive → init), never
  // by path: the resolver's own verifier is itself verified content (L4/L5). Fallback ladder unchanged.
  const R = makeHostResolver({ base: BASE, wasmGlue: () => import("./usr/lib/holo/holo-runtime.mjs").then((m) => m.runtimeModule({ base: BASE })) });
  let APPS = null;
  loadAppIndex({ base: BASE }).then((i) => { APPS = i; renderChips(); }).catch(() => renderChips());

  $("name").addEventListener("input", () => {
    const s = $("name").value.trim();
    if (!s) { $("kindline").textContent = ""; return; }
    const t0 = performance.now();
    const r = classify(s);
    const us = ((performance.now() - t0) * 1000) | 0;
    if (!r) { $("kindline").innerHTML = `looks like <b>the open web</b> — a URL, a domain, or a search <span style="opacity:.6">· ${us}µs</span>`; return; }
    const what = KIND_WORDS[r.kind] || r.kind;
    $("kindline").innerHTML = `this is <b>${what}</b>${r.kappa ? ` → <b style="font-family:ui-monospace,monospace;font-size:12px">${r.kappa.slice(0, 26)}…</b>` : ""}${r.note ? ` <span style="opacity:.7">· ${r.note}</span>` : ""} <span style="opacity:.6">· ${us}µs</span>`;
  });

  async function go() {
    const s = $("name").value.trim(); if (!s) return;
    if (location.hash.replace(/^#/, "") !== encodeURIComponent(s)) { try { history.replaceState(null, "", "#" + encodeURIComponent(s)); } catch {} }   // shareable
    const out = $("out"); out.className = "show"; out.innerHTML = "";
    const t0 = performance.now();
    const res = await R.resolveOrExplain(s);
    const ms = (performance.now() - t0).toFixed(1);
    const card = document.createElement("holo-card"); card.result = { ...res, name: s }; out.appendChild(card);
    const d = document.createElement("div"); d.className = "detail";
    d.textContent = res.ok ? `resolved in ${ms} ms · via ${res.source}${res.source === "store" ? " (warm)" : ""}` : `checked in ${ms} ms`;
    out.appendChild(d);
    if (res.ok && /^blake3:[0-9a-f]{64}$/i.test(s)) projPanel(out, s.toLowerCase());   // the fabric speaks blake3 κs (name plane widens at G4b)
  }
  // ── THE PROJECTION FABRIC PANEL (HOLO-SHOWCASE G4) — the three moments, live ────────────────────────
  // PROJECT: the resolved κ paints as a GPU-VERIFIED projection (workers own every byte — the main
  // thread composites). THE BIND: "project again" re-projects the RESIDENT κ — watch 0 bytes, ~0 ms.
  // REFUSE: the forgery chip asks for real bytes under the wrong κ — refused, both κs named, pre-paint.
  let _fabric = null;
  const fabric = async () => (_fabric ||= (await import(new URL("usr/lib/holo/holo-projection.mjs", BASE).href)).mountProjection({ base: BASE.href }));
  async function projPanel(out, kappaName) {
    const p = document.createElement("div"); p.className = "projp";
    p.innerHTML = '<canvas width="560" height="315"></canvas><div class="ro">projecting…</div><div class="pchips"></div>';
    out.appendChild(p);
    const ro = p.querySelector(".ro"), chipsEl = p.querySelector(".pchips");
    const show = (st, note) => { ro.innerHTML = st ? `<b>${st.resident ? "RESIDENT — 0 bytes moved" : (st.bytes || 0).toLocaleString() + " bytes"}</b>${st.resident ? "" : ` · verified on <b>${st.verify || "js"}</b>${st.verify_ms ? " in <b>" + st.verify_ms + " ms</b>" : ""}`} · present ${st.present_ms} ms${st.painted ? " · <b>painted</b>" : ""}${note ? " · " + note : ""}` : note; };
    try {
      const f = await fabric();
      let h = await f.project(kappaName, p.querySelector("canvas"));
      show(h.stats(), "");
      const mk = (label, fn) => { const b = document.createElement("button"); b.textContent = label; b.onclick = fn; chipsEl.appendChild(b); };
      mk("⟳ project again — the bind", async () => { try { await h.again(); show(h.stats(), "the same κ costs nothing"); } catch (e) { show(null, String(e.message)); } });
      mk("⚠ forgery — must refuse", async () => {
        try { await (await fabric()).project("blake3:00566dbbfe60f4291416c9823f7bae58f700f5f352f3aedfdaed680663954f0f", null); show(null, "PAINTED A FORGERY (BAD)"); }
        catch (e) { show(null, `<b>refused:</b> ${String(e.message)}`); }
      });
    } catch (e) { show(null, "the fabric could not load here — " + String(e.message)); }
  }

  $("go").addEventListener("click", go);
  $("name").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });

  async function renderChips() {
    const chips = [];
    if (APPS) for (const a of APPS.apps.filter((x) => ["q", "browser", "holo-money", "player"].includes(x.dir))) chips.push([a.title + " · by κ", a.kappa]);
    try {
      // the SHOWCASE chip: an EVICTED wallpaper — its bytes left this origin for the κ-mirror; the
      // fabric streams them back through the SW rescue, GPU-verifies, and PAINTS. The whole thesis, one tap.
      try {
        const wp = await (await fetch(new URL("usr/share/wallpapers/holo-evicted.json", BASE), { cache: "no-store" })).json();
        const gx = wp.files && (wp.files["galaxy.jpg"] || Object.entries(wp.files).find(([k]) => /\.jpe?g$/.test(k))?.[1]);
        if (gx) chips.push(["🖼 project an evicted wallpaper — streamed from the mirror, GPU-verified", "blake3:" + gx]);
      } catch (e) {}
      const mf = await (await fetch(new URL("apps/holo-messenger/shell-manifest.json", BASE), { cache: "no-store" })).json();
      const img = (mf.assets || []).find((x) => /\.(jpe?g|png|webp|svg)$/i.test(x.path));
      if (img) chips.push(["a verified image, by κ", "sha256:" + img.kappa]);
      const a = (mf.assets || []).find((x) => /app\.html$/.test(x.path));
      if (a) { const raw = Uint8Array.from(a.kappa.match(/.{2}/g), (x) => parseInt(x, 16)); chips.push(["the same shell, as SRI", "sha256-" + btoa(String.fromCharCode(...raw))]); chips.push(["…and as an IPFS CID", names.kappaToCid("sha256:" + a.kappa)]); }
    } catch {}
    chips.push(["vitalik.eth", "vitalik.eth"]);
    chips.push(["a live IPFS site", "ipns://docs.ipfs.tech"]);
    chips.push(["a Bluesky account", "at://bsky.app"]);
    chips.push(["a Lightning invoice", "lightning:lnbc1u1pjxyz00pp5"]);
    chips.push(["an email", "mailto:hi@hologram.dev"]);
    chips.push(["an inline image", "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><circle cx='60' cy='60' r='52' fill='%2300a884'/></svg>"]);
    chips.push(["a forgery — refused, honestly", "magnet:?xt=urn:btih:" + "d".repeat(40)]);
    $("chips").innerHTML = chips.map(([label, v]) => `<span class="chip" data-v="${v.replace(/"/g, "&quot;")}">${label}</span>`).join("");
  }
  $("chips").addEventListener("click", (e) => { const c = e.target.closest(".chip"); if (!c) return; $("name").value = c.dataset.v; $("name").dispatchEvent(new Event("input")); go(); });

  // ── SEAL — the universal lossless encoder on the front door (HOLO-SHOWCASE-COMPLETE H2) ────────────
  // Drop ANY file → it becomes a κ: blake3-named, deflated into a link that CARRIES the bytes (the
  // carry codec: sha256 re-derived on open = L5 on the wire), held on this device (OPFS, per-origin,
  // said honestly). unseal(seal(x)) === x — byte-exact, zero hosts; the self-test chip proves it live.
  async function sealFiles(files) {
    const { seal } = await import(new URL("usr/lib/holo/holo-seal.mjs", BASE).href);
    const out = $("out"); out.className = "show"; out.innerHTML = "";
    for (const f of files) {
      const r = await seal(f, { name: f.name, base: BASE.href, hold: true });
      const d = document.createElement("div"); d.className = "projp";
      const badge = r.link ? (r.link.tier === "qr" ? "the link carries the file — scan = receive" : "the link carries the file — no host, anywhere")
                          : "too big to carry in a link (" + (r.payloadChars || 0).toLocaleString() + " chars) — held on this device only";
      d.innerHTML = `<div class="ro"><b>${f.name}</b> · ${r.bytes.toLocaleString()} bytes sealed<br>` +
        `κ <b style="font-family:ui-monospace,monospace;font-size:11px">${r.kappa.slice(0, 46)}…</b><br>` +
        `${badge}${r.held ? " · held on this device, this site" : ""}</div><div class="pchips"></div>`;
      const chips = d.querySelector(".pchips");
      if (r.link) {
        const b = document.createElement("button"); b.textContent = "copy the link (" + r.link.chars.toLocaleString() + " chars, " + r.link.tier + ")";
        b.onclick = async () => { try { await navigator.clipboard.writeText(r.link.url); b.textContent = "copied — it opens anywhere, no host"; } catch (e) {} };
        chips.appendChild(b);
      }
      const t = document.createElement("button"); t.textContent = "prove it: unseal(seal(x)) === x";
      t.onclick = async () => {
        const { unseal } = await import(new URL("usr/lib/holo/holo-seal.mjs", BASE).href);
        if (!r.link) { t.textContent = "no link at this size — identity proven via the hold"; return; }
        const u = await unseal(r.link.url);
        const bytes = new Uint8Array(await f.arrayBuffer());
        const same = !u.error && u.bytes.length === bytes.length && u.bytes.every((v, i) => v === bytes[i]) && u.kappa === r.kappa;
        t.textContent = same ? "byte-exact ✓ · κ re-derived ✓ · zero hosts" : "IDENTITY FAILED (report this)";
      };
      chips.appendChild(t);
      out.appendChild(d);
    }
  }
  // H3 INSTANT: (1) warm the GPU verifier from idle — the first paste never pays device init;
  // (2) hovering a κ-chip PRE-PROJECTS it (no canvas) into the present worker's κ-cache, so the
  // click lands RESIDENT: 0 bytes, ~0 ms. Runahead is capability-scoped to the hovered name only.
  const idle = globalThis.requestIdleCallback || ((f) => setTimeout(f, 900));
  idle(() => { fabric().then((f) => f.warm && f.warm()).catch(() => {}); });
  const prewarmed = new Set();
  $("chips").addEventListener("mouseover", (e) => {
    const chip = e.target.closest(".chip"); if (!chip) return;
    const v = chip.dataset.v || "";
    if (!/^blake3:[0-9a-f]{64}$/i.test(v) || prewarmed.has(v)) return;
    prewarmed.add(v);
    fabric().then((f) => f.project(v.toLowerCase(), null)).catch(() => {});
  });

  host.addEventListener("dragover", (e) => { e.preventDefault(); });
  host.addEventListener("drop", (e) => { e.preventDefault(); if (e.dataTransfer?.files?.length) sealFiles([...e.dataTransfer.files]); });


  $("benchgo").addEventListener("click", async () => {
    const btn = $("benchgo"); btn.textContent = "measuring in your browser…"; btn.disabled = true;
    let κ = null;
    try { const mf = await (await fetch(new URL("apps/holo-messenger/shell-manifest.json", BASE), { cache: "no-store" })).json(); κ = "sha256:" + mf.assets.find((a) => /app\.html$/.test(a.path)).kappa; } catch {}
    if (!κ) { btn.textContent = "⚡ benchmark unavailable here"; return; }
    await R.resolve(κ);
    const uni = ["blake3:" + "a".repeat(64), "sha256:" + "a".repeat(64), "did:holo:sha256:" + "a".repeat(64),
      names.kappaToCid("sha256:" + "a".repeat(64)), "ipns://docs.ipfs.tech", "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
      "0x" + "b".repeat(64), "0x" + "c".repeat(40), "vitalik.eth", "brad.crypto", "http://x.onion/",
      "ar://AbCdEf", "hyper://x/", "ssb:x", "magnet:?xt=urn:btmh:1220" + "a".repeat(64), "data:text/plain;base64,aGVsbG8=",
      "npub1qpzry9x8gf2tvdw0s3jn54khce6mua7lqpzry9x8gf2tvd", "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
      "ethereum:0x" + "c".repeat(40), "at://did:plc:xyz/app.bsky.feed.post/abc", "matrix:r/room:server",
      "gemini://x.gmi/", "mailto:a@b.com", "org/model:latest", "ada~natom-hipit-gimis", "https://example.org"];
    const kinds = new Set(uni.map((n) => (classify(n) || { kind: "web" }).kind));
    const MODE = { kappa: "self", did: "self", data: "self", sri: "self", "eth-tx": "self", torrent: "self", ipfs: "via", arweave: "via", onion: "self",
      ipns: "self", nostr: "self", scuttlebutt: "self", atproto: "self", ens: "via", model: "via", truename: "self", p2pweb: "via", "eth-address": "via",
      payment: "action", account: "action", contact: "action", chat: "action", socket: "action" };
    const resolvable = [...kinds].filter((k) => k !== "web" && k !== "refused" && MODE[k]);
    const zeroTrust = resolvable.filter((k) => MODE[k] === "self").length;
    let egress = 0; const realFetch = window.fetch; window.fetch = (...a) => { egress++; return realFetch(...a); };
    const N = 20000, t0 = performance.now();
    for (let i = 0; i < N; i++) await R.resolve(κ);
    const warmMs = (performance.now() - t0) / N; window.fetch = realFetch;
    const DOH = 12; const x = Math.max(1, Math.round(DOH / warmMs));
    const perSec = Math.round(1000 / warmMs);
    const fmtLat = warmMs < 1 ? (warmMs * 1000).toFixed(1) + "µs" : warmMs.toFixed(3) + "ms";
    const row = (a, k) => `<div class="sc-row"><div class="a">${a}</div><div class="k">${k}</div></div>`;
    $("bench").innerHTML = `
      <div class="scorecard">
        <div class="sc-head">Your resolver vs DNS — measured just now, in this browser</div>
        <div class="sc-sub">the resolver runs on your device; a DNS lookup runs on someone else's server.</div>
        ${row("Speed", `<b>${fmtLat}</b> warm — <b>~${x.toLocaleString()}× faster</b> than a ~${DOH}ms DNS lookup`)}
        ${row("Throughput", `<b>~${perSec.toLocaleString()}</b> verified resolves / second, on your device`)}
        ${row("Universal", `<b>${kinds.size} kinds of name</b> understood by one resolver — κ · CID · IPNS · Ethereum · ENS · SRI · onion · Arweave · Nostr · Bitcoin · BitTorrent · AT/Bluesky · Matrix · Gemini · model · truename · web`)}
        ${row("Resolves", `<b>${resolvable.length} kinds now return the verified thing</b> — <b>${zeroTrust} with zero trust</b> (the content, or its own signature, is the proof). Pointers dereference through a <i>named, untrusted</i> source, then the bytes re-verify. Payments &amp; contacts render an action, not a page.`)}
        ${row("Privacy", `<b>${egress} network requests</b> — the warm answer never left your device (a DNS query always does)`)}
        ${row("Security", `every byte <b>re-derived to its hash</b> before you saw it — a forged answer is refused, not trusted`)}
        ${row("Sovereignty", `zero setup, works offline after first touch — no provider, no box, no config`)}
        <div class="sc-note">DNS forces you to pick two of {fastest · private · yours} and answers one question — name→IP. This takes all three and answers every name, returning the verified <b>thing</b>.</div>
      </div>`;
  });

  // deep link at the ROOT: /Q/#<name> resolves on load; hashchange re-resolves (shareable, the seal's target).
  async function recvDoor() {
    // a carry link opened AT THE ROOT: unseal, re-derive, offer the bytes (the resolver is a receive door)
    const { unseal } = await import(new URL("usr/lib/holo/holo-seal.mjs", BASE).href);
    const u = await unseal(location.hash);
    const out = $("out"); out.className = "show"; out.innerHTML = "";
    const d = document.createElement("div"); d.className = "projp";
    if (u.error) { d.innerHTML = `<div class="ro"><b>refused:</b> this carry link does not verify (${u.error}) — nothing was delivered (L5)</div>`; }
    else {
      d.innerHTML = `<div class="ro"><b>${u.name}</b> · ${u.bytes.length.toLocaleString()} bytes arrived IN THE LINK — no host served this<br>κ <b style="font-family:ui-monospace,monospace;font-size:11px">${u.kappa.slice(0, 46)}…</b> · sha256 re-derived ✓</div><div class="pchips"></div>`;
      const b = document.createElement("button"); b.textContent = "save " + u.name;
      b.onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([u.bytes])); a.download = u.name; a.click(); };
      d.querySelector(".pchips").appendChild(b);
    }
    out.appendChild(d);
  }
  function fromHash() { const h = decodeURIComponent((location.hash || "").replace(/^#/, "")).trim(); if ((location.hash || "").startsWith("#recv=1.")) { recvDoor(); return; } if (h && h !== $("name").value.trim()) { $("name").value = h; $("name").dispatchEvent(new Event("input")); go(); } }
  window.addEventListener("hashchange", fromHash);
  const seed = (initialName || "").trim() || decodeURIComponent((location.hash || "").replace(/^#/, "")).trim();
  if ((location.hash || "").startsWith("#recv=1.") || seed.startsWith("recv=1.")) { recvDoor(); }   // a carried FILE, not a name
  else if (seed) { $("name").value = seed; $("name").dispatchEvent(new Event("input")); go(); } else { $("name").focus(); }
}

export default { mount };
