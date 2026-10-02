// holo-direct-mount.mjs — Holo Direct in the LIVE messenger: the native holospace↔holospace sealed chat,
// mounted the app's own way (self-mounting, fail-soft, additive — the q-summon / power-session idiom).
// ONE rail button (🔐) → a small sheet: your Direct code (copy) · paste a peer's code · Start — which opens
// the finished sealed-conversation panel (holo-direct-ui) wired to the dual-path engine (holo-direct):
// warm P2P when the peer is up (~30 ms sealed words over WebRtcLink), the blind mailbox when not, TOFU +
// key-change + safety number exactly as the engine enforces them. LAZY: the 3 MB spine wasm loads on FIRST
// use — cold boot and TTFW pay nothing (D5). Manual code exchange is the honest N4 door; N5 replaces it
// with the joinable κ link/QR. window.HoloDirect = { open(peerPub,{name}), code(), state } for harnesses.

const DOC = typeof document !== "undefined" ? document : null;
const $ = (s, r) => (r || DOC).querySelector(s);

let direct = null, spine = null, bootP = null;
const panels = new Map();            // contactId → panel handle (the store, not a queue, holds unseen messages)

// ── the human LABEL (WhatsApp-seamless): the raw key-derived id (`direct:<hex>`) is NEVER shown to a
// human. Priority: your local alias (you renamed them) → the name they travel under (their chosen
// displayName becomes the contactId, so a non-raw id IS their name) → a clean, stable "Sealed contact ·
// <code>" fallback. The alias is pure presentation keyed by the immutable contactId, so renaming can
// never fork a sealed thread. This is the one thing that made the live list read as jargon, not people.
const _isRawId = (cid) => /^direct:/.test(String(cid || ""));
const _shortCode = (cid) => (String(cid || "").replace(/^direct:/, "").replace(/[^A-Za-z0-9]/g, "").slice(0, 4).toUpperCase() || "····");
function _alias(cid) { try { return (localStorage.getItem("holo.direct.alias." + cid) || "").trim() || null; } catch { return null; } }
function _setAlias(cid, nm) { try { nm = String(nm || "").trim(); if (nm) localStorage.setItem("holo.direct.alias." + cid, nm); else localStorage.removeItem("holo.direct.alias." + cid); } catch {} }
function _label(cid) { return _alias(cid) || (!_isRawId(cid) ? String(cid) : "~" + _shortCode(cid)); }
// names + previews are peer-controlled → escape before they touch innerHTML (a link's name is untrusted).
const _htm = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function _boot() {
  if (direct) return direct;
  if (bootP) return bootP;
  bootP = (async () => {
    const { makeDirect } = await import("./holo-direct.mjs?v=aim1sk");   // aim1: presence + away (A1/A3)
    const { getIdentity } = await import("./holo-direct-id.mjs");
    // the operator namespace: the signed-in identity's stable id when the gate resolved one, else "guest"
    // (ONE stable identity per device+origin — never per session). 3 s race: Direct must not hang on auth.
    let ns = "guest";
    try {
      const auth = await Promise.race([window.__holoAuthP, new Promise((r) => setTimeout(() => r(null), 3000))]);
      const stable = auth && (auth.principal && (auth.principal.id || auth.principal) || auth.operator);
      if (stable) ns = String(stable).slice(0, 64);
    } catch {}
    const { identity } = await getIdentity({ ns });               // same operator tomorrow → same keys (K1)
    // the conversation survives (N6): contacts + messages in the vault-encrypted store, same ns rule
    let store = null;
    try {
      const { getVaultKey } = await import("./holo-direct-id.mjs");
      const { openStore } = await import("./holo-direct-store.mjs");
      store = await openStore({ ns, vaultKey: await getVaultKey({ ns }) });
    } catch (e) { console.warn("[direct] store unavailable — session-only conversations:", String(e)); }
    // THE SPINE IS OPTIONAL (the engine's own contract: no spine = mailbox/relay-only, everything still
    // works — rooms, ratchet, media offline-path). The p2p wasm lives in an EVICTED tree served by the
    // root SW's rescue; on a first visit racing SW install (or any SW-less context) its import 404s —
    // that must DEGRADE the fast path, never kill the boot (the door was dying exactly here, live).
    spine = null;
    try { const { makeSpine } = await import("./holo-net.mjs"); spine = await makeSpine(); }   // ← the 3 MB spine loads HERE, first use only
    catch (e) { console.warn("[direct] p2p spine unavailable — relay-only (words still cross):", String(e && e.message || e)); }
    const displayName = (localStorage.getItem("holo.direct.name") || "").trim() || null;   // rides sealed payloads (N8 two-way door)
    // R5 — the audited Olm/Megolm ratchet is now the DEFAULT seal (forward secrecy + PCS). Opt-OUT with
    // ?e2e=off (or localStorage holo.e2e=off). Interop is automatic: a peer with no ratchet just never sends a
    // `voz-bundle`, so we fall back to holo-seal with them (untagged envelopes ARE holo-seal) — no dead ends.
    // We load the vodozemac wasm (the spine's way, lazy) + a vault-persisted pickleKey + build a seal2 waist
    // keyed to the SAME operator ns → sessions + identity survive every reload (persistence for returning
    // users). Fail-soft: ANY hiccup (wasm, store) → olm=null → exactly the holo-seal door, never a broken one.
    let olm = null;
    try {
      const voznOn = (() => { try { const q = new URLSearchParams(location.search).get("e2e"); return !(q === "off" || localStorage.getItem("holo.e2e") === "off"); } catch { return true; } })();
      if (voznOn && store && store.getMeta) {
        const vbase = new URL("./_vendor/vodozemac/", import.meta.url);
        // CONTENT-ADDRESSED filenames (.v2 = the Megolm build): a new path can never be served stale by a SW
        // that cached the pre-Megolm glue/wasm at the old names (the M4 rooms deploy trap — the old glue lacks
        // HoloGroupSession, so groupCreate threw live). The 1:1 door works on either build; rooms need .v2.
        const voz = await import(new URL("holo_vodozemac.v2.js", vbase));
        await voz.default({ module_or_path: new URL("holo_vodozemac_bg.v2.wasm", vbase) });
        let pickleKey = await store.getMeta("voz:pk").catch(() => null);
        if (!pickleKey) { const a = new Uint8Array(32); crypto.getRandomValues(a); pickleKey = btoa(String.fromCharCode(...a)); await store.setMeta("voz:pk", pickleKey); }
        const { makeSeal2 } = await import("./holo-seal2.mjs");
        olm = makeSeal2({ voz, pickleKey, getState: (k) => store.getMeta("voz:" + k).catch(() => null), putState: (k, v) => store.setMeta("voz:" + k, v).catch(() => {}) });
      }
    } catch (e) { console.warn("[direct] Olm ratchet unavailable — holo-seal default:", String(e)); olm = null; }
    direct = await makeDirect({ identity, spine, store, displayName, olm });   // drop-box: origin /mbox, or relays on a static origin (holo-dm gate)
    // 🗝 KEYS: hand the engine to holo-key so BOTH invoke (holder) and the instant-revoke push (issuer) reach the
    // wire — without waiting for a first invoke to lazily set it. One shared handle, fail-soft if the module isn't loaded.
    try { const Keys = await import("./holo-key.mjs?v=k1"); Keys.attachDirect(direct); } catch {}
    direct.on("message", (m) => {
      const p = panels.get(m.contactId);
      if (p) p.addMessage({ from: m.from, text: m.text, verified: m.verified, kappa: m.kappa });
      else { _badge(true); _unseen(m.contactId); _notify(m.contactId, m.text); }   // main list shows it (unread badge)
      _renderSection();
    });
    // media (N7): pending → an honest placeholder bubble; fetched → the bytes become an image/file chip.
    direct.on("media", (m) => {
      const p = panels.get(m.contactId);
      if (!p) {                                              // store + vault already hold it; hydration renders it
        _badge(true);
        if (m.status === "pending-bytes") { _unseen(m.contactId); _notify(m.contactId, "📎 " + (m.media && m.media.name || "file")); _renderSection(); }
        return;
      }
      if (m.status === "fetched" && m.bytes) {
        const url = URL.createObjectURL(new Blob([m.bytes], { type: m.media.mime }));
        p.setMedia(m.kappa, { from: "them", name: m.media.name, mime: m.media.mime, size: m.media.size, url });
      } else if (m.status === "pending-bytes") {
        p.addMedia({ from: "them", name: m.media.name, mime: m.media.mime, size: m.media.size, kappa: m.kappa, url: null });
      }
    });
    direct.on("tick", (t) => { const p = panels.get(t.contactId); if (p) p.setTick(t.kappa, t.status); });
    direct.on("typing", (t) => { const p = panels.get(t.contactId); if (p) p.setTyping(true); });
    direct.on("keychange", (k) => { const p = panels.get(k.contactId); if (p) p.showKeyChange(true); });
    // the mailbox needs draining: messages AND acks that fall to the drop-box (peer offline, link not yet
    // warm) arrive ONLY on poll. A steady background poll makes offline delivery real and ✓✓ reliable;
    // exactly-once (κ-dedup + durable store) makes redundant polls free. Poll once now, then every 4 s.
    const _poll = () => direct.poll().catch(() => {});
    _poll(); setInterval(_poll, 4000);
    // live push (N8/GL3): on the relay transport a landing blob triggers an IMMEDIATE poll — WhatsApp
    // immediacy instead of the 4 s cadence. No-op on the HTTP transport (returns null). κ-dedup makes
    // the extra poll free.
    import("./holo-dm.mjs?v=n8").then((DM) => DM.mailboxLive(direct.myPub.box, _poll)).catch(() => {});
    // AIM presence (A1): announce my state (away survived the reload inside the engine), then keep it
    // honest — 10 min without input → idle, input returns online. Away only changes by hand.
    try {
      direct.setPresence(direct.myPresence()).catch(() => {});
      const IDLE_MS = 10 * 60 * 1000;
      let idleT = null, lastArm = 0;
      const arm = () => { clearTimeout(idleT); idleT = setTimeout(() => { if (direct.myPresence().state === "online") direct.setPresence({ state: "idle" }).catch(() => {}); }, IDLE_MS); };
      const wake = () => { if (direct.myPresence().state === "idle") direct.setPresence({ state: "online" }).catch(() => {}); const n = Date.now(); if (n - lastArm > 5000) { lastArm = n; arm(); } };
      for (const ev of ["pointerdown", "keydown", "pointermove"]) window.addEventListener(ev, wake, { passive: true });
      arm();
    } catch {}
    return direct;
  })();
  return bootP;
}

// ── the one-link door (K2): the link is a FRAGMENT — public keys never appear in a request line, a log,
// or the drop-box. Opening it = introduction (TOFU) + warm + panel, one motion. Format:
//   <origin><app-path>#direct=v1.<base64url(JSON{ sign, box, name? })>
const _b64u = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const _ub64u = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));
async function myLink() {
  await _boot();
  const name = (localStorage.getItem("holo.direct.name") || "").trim() || undefined;
  const payload = { sign: direct.myPub.sign, box: direct.myPub.box, name };
  return location.origin + location.pathname + "#direct=v1." + _b64u(JSON.stringify(payload));
}
function _parseFragment() {
  const m = /[#&]direct=v1\.([A-Za-z0-9_-]+)/.exec(location.hash || "");
  if (!m) return null;
  // SCRUB FIRST — the keys must not linger in the address bar, history, or anything that reads location
  try { history.replaceState(null, "", location.pathname + location.search); } catch {}
  try { const p = JSON.parse(_ub64u(m[1])); return p && p.sign && p.box ? p : null; } catch { return null; }
}

async function _refreshSafety(cid, panel) {
  const sn = await direct.safetyNumber(cid); if (!sn) return;
  const st = direct.verifyStatus(cid);
  panel.setSafety({ emojis: direct.safetyEmojis(sn), digits: direct.safetyDigits(sn),
                    status: st.status === "same" && st.verified ? "same-verified" : st.status });
}

export async function open(peerPub, { name = null } = {}) {
  await _boot();
  const cid = name || "direct:" + (peerPub.sign || "").slice(0, 12);
  if (peerPub && peerPub.box) direct.addContact(cid, peerPub);    // a stub contact (inbound-only) has no pub to add
  direct.warm(cid);                                               // the cold dial happens while the human reads (D2)
  const { openDirectChat } = await import("./holo-direct-ui.mjs?v=n9k");
  const panel = openDirectChat({
    name: _label(cid),
    myPub: direct.myPub,   // 🗝 KEYS: mint on MY identity → the 🗝 composer button + live key cards go native here

    onSend: (t) => direct.send(cid, t).then((r) => { if (r.ok) panel.addMessage({ from: "me", text: t, kappa: r.kappa, status: "sent" }); else if (r.keychange) panel.showKeyChange(true); }),
    onVerify: () => { direct.markVerified(cid); _refreshSafety(cid, panel); },
    onRename: (nm) => { _setAlias(cid, nm); _renderSection(); },   // WhatsApp: tap the name → set who it is (local label)
    onTyping: () => direct.sendTyping(cid),
    onClose: () => panels.delete(cid),
    // 📎 (N7): seal + κ-ship the file; my bubble renders from the local bytes immediately. A refusal
    // (over 25 MB, no spine) surfaces as the engine's own plain sentence — never a silent drop.
    onAttach: (file) => direct.sendMedia(cid, file).then((r) => {
      if (r.ok) panel.addMedia({ from: "me", name: file.name, mime: file.type, size: file.size, url: URL.createObjectURL(file), kappa: r.kappa, status: "sent" });
      else if (r.keychange) panel.showKeyChange(true);
      else panel.notice(r.error || "the file could not be sent");
    }),
  });
  panels.set(cid, panel);
  // TRUTHFUL lock (R5): reflect whether THIS thread is on the Olm ratchet. Poll vozReady until it establishes
  // (the handshake completes after the first word or two), then stop; a holo-seal-only peer simply stays
  // "end-to-end encrypted" (no forward-secret claim). Cheap, self-ending, never blocks the open.
  try {
    panel.setSeal && panel.setSeal(await direct.vozReady(cid).catch(() => false));
    const _sealT = setInterval(async () => {
      if (!panels.has(cid)) { clearInterval(_sealT); return; }
      if (await direct.vozReady(cid).catch(() => false)) { panel.setSeal && panel.setSeal(true); clearInterval(_sealT); }
    }, 3000);
  } catch {}
  unread.delete(cid); _renderSection();                           // opening the thread clears its badge
  // HYDRATE from the sealed store BEFORE the network warms (C6): history renders instantly, offline-capable.
  for (const m of await direct.history(cid).catch(() => [])) {
    if (m.media) {
      const held = await direct.mediaBytes(m.media.kappa).catch(() => null);
      panel.addMedia({ from: m.dir === "out" ? "me" : "them", name: m.media.name, mime: m.media.mime, size: m.media.size,
                       url: held ? URL.createObjectURL(new Blob([held.bytes], { type: held.mime })) : null, kappa: m.kappa, status: m.status });
    } else panel.addMessage({ from: m.dir === "out" ? "me" : "them", text: m.text, verified: true, kappa: m.kappa, status: m.status });
  }
  _refreshSafety(cid, panel);
  return panel;
}

// ── the MAIN-LIST section (N8/S3): Direct threads live where every thread lives — the left pane, above
// the app's own list. WhatsApp anatomy: avatar · name · last-word preview · time · green unread badge;
// tap → the sealed panel. Foreign DOM inside a React container gets wiped on re-render — the interval
// re-attach below (the same idiom as the rail button) heals it within 2 s. Styled by the wa-skin vars.
const unread = new Map();            // contactId → count (cleared when the panel opens)
function _unseen(cid) { unread.set(cid, (unread.get(cid) || 0) + 1); }
function _notify(cid, text) {
  // never prompt from here — only speak if the operator already granted it and is looking away
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted" || !DOC.hidden) return;
    new Notification(_label(cid), { body: String(text).slice(0, 90), tag: "holo-direct-" + cid, silent: false });
  } catch {}
}
const _fmtT = (ts) => { if (!ts) return ""; const d = new Date(ts), now = new Date(); return d.toDateString() === now.toDateString() ? d.toTimeString().slice(0, 5) : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); };
let _secBusy = false;
async function _renderSection() {
  if (_secBusy || !direct || !DOC) return;
  _secBusy = true;
  try {
    const wrap = $(".holo-convlist-wrap"); if (!wrap) return;
    let convs = await direct.conversations().catch(() => []);
    // ONE ROOM hygiene: joining a room binds each member as a pairwise TRANSPORT contact — but a member
    // you've never messaged 1:1 is not a conversation. Hide room-only contacts (no words yet + they sit in
    // a room roster) so the group row is the ONE surface for them; the moment a 1:1 word crosses, they appear.
    try {
      const roomSigns = new Set();
      for (const r of (direct.rooms() || [])) for (const m of (r.members || [])) roomSigns.add(m.sign);
      convs = convs.filter((c) => c.last || !(c.pub && roomSigns.has(c.pub.sign)));
    } catch {}
    let sec = wrap.querySelector(".holo-direct-section");
    if (!convs.length) { if (sec) sec.remove(); return; }
    if (!sec) {
      sec = DOC.createElement("div"); sec.className = "holo-direct-section";
      sec.style.cssText = "display:flex;flex-direction:column;padding:2px 0 4px;border-bottom:1px solid var(--wa-border,rgba(255,255,255,.08))";
      wrap.prepend(sec);
    }
    sec.innerHTML = "";
    for (const c of convs.slice(0, 12)) {
      const cid = c.name || c.contactId;
      const label = _label(cid);                                  // human name — never the raw direct:<key>
      const n = unread.get(cid) || 0;
      const row = DOC.createElement("button");
      row.type = "button"; row.className = "holo-direct-row";
      row.style.cssText = "display:flex;align-items:center;gap:11px;background:transparent;border:0;padding:8px 14px;cursor:pointer;text-align:left;color:var(--wa-text,#e9f1f5);width:100%";
      row.onmouseenter = () => { row.style.background = "rgba(255,255,255,.05)"; };
      row.onmouseleave = () => { row.style.background = "transparent"; };
      const preview = c.last ? ((c.last.dir === "out" ? "You: " : "") + (c.last.text || "")) : "";
      row.innerHTML = `<div style="width:40px;height:40px;border-radius:50%;display:grid;place-items:center;font-weight:700;color:#04110d;background:linear-gradient(135deg,#00d09c,#27e3b3);flex:0 0 auto">${(label.trim()[0] || "·").toUpperCase()}</div>
        <div style="min-width:0;flex:1"><div style="display:flex;justify-content:space-between;gap:8px"><span style="font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_htm(label)}</span><span style="font-size:11px;color:var(--wa-dim,#8aa0ad);flex:0 0 auto">${_fmtT(c.last && c.last.ts)}</span></div>
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><span style="font-size:12.5px;color:var(--wa-dim,#8aa0ad);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_htm(preview)}</span>${n ? `<span class="holo-direct-unread" style="background:#00d09c;color:#04110d;font-size:11px;font-weight:700;border-radius:10px;padding:1px 6px;flex:0 0 auto">${n}</span>` : ""}</div></div>`;
      row.onclick = () => { if (c.pub && c.pub.box) open(c.pub, { name: cid }); };
      sec.append(row);
    }
  } finally { _secBusy = false; }
}

// ── the rail affordance (React-reconciliation-proof, the power-session idiom) ─────────────────────────────
let railBtn = null;
function _badge(on) { if (railBtn) railBtn.style.boxShadow = on ? "0 0 0 2px #00d09c" : ""; }
function _sheet() {
  const el = (t, css, html) => { const n = DOC.createElement(t); if (css) n.style.cssText = css; if (html != null) n.innerHTML = html; return n; };
  const ov = el("div", "position:fixed;inset:0;z-index:2147483400;background:rgba(4,7,11,.7);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:18px;font:14px/1.5 system-ui,sans-serif");
  const card = el("div", "width:min(380px,94vw);background:#0e1620;border:1px solid #1f2c35;border-radius:18px;padding:18px;color:#e9f1f5;display:flex;flex-direction:column;gap:10px");
  card.append(el("div", "font-weight:700;font-size:15px", "New chat"));
  // the conversation list: who you've talked to + the last word, newest first. Tap to reopen (history
  // hydrates from the sealed store). Populated async; hidden until there's at least one conversation.
  const convWrap = el("div", "display:none;flex-direction:column;gap:2px;max-height:180px;overflow:auto;margin:-2px 0 2px");
  card.append(convWrap);
  _boot().then(() => direct.conversations()).then((convs) => {
    if (!convs || !convs.length) return;
    convWrap.style.display = "flex";
    convWrap.append(el("div", "font-size:11px;color:#8aa0ad;letter-spacing:.04em;text-transform:uppercase;margin-bottom:2px", "Conversations"));
    for (const c of convs) {
      const row = el("button", "display:flex;align-items:center;gap:9px;background:transparent;border:0;border-radius:10px;padding:7px 8px;cursor:pointer;text-align:left;color:#e9f1f5");
      row.onmouseenter = () => { row.style.background = "rgba(255,255,255,.05)"; };
      row.onmouseleave = () => { row.style.background = "transparent"; };
      const label = _label(c.name || c.contactId);
      const av = (label.trim()[0] || "·").toUpperCase();
      row.innerHTML = `<div style="width:32px;height:32px;border-radius:50%;display:grid;place-items:center;font-weight:700;color:#04110d;background:linear-gradient(135deg,#00d09c,#27e3b3);flex:0 0 auto">${av}</div>
        <div style="min-width:0;flex:1"><div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_htm(label)}</div>
        <div style="font-size:11.5px;color:#8aa0ad;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.last ? (c.last.dir === "out" ? "You: " : "") + _htm(c.last.text) : "…"}</div></div>`;
      row.onclick = () => { ov.remove(); if (c.pub && c.pub.box) open(c.pub, { name: c.name || c.contactId }); };
      convWrap.append(row);
    }
  }).catch(() => {});
  const me = el("input", "background:#0a1119;border:1px solid #1f2c35;border-radius:10px;color:#e9f1f5;padding:8px;font-size:13px");
  me.placeholder = "Your name"; me.value = localStorage.getItem("holo.direct.name") || "";
  me.onchange = () => { localStorage.setItem("holo.direct.name", me.value.trim()); mine.value = "…"; myLink().then((l) => { mine.value = l; }); };
  card.append(me);
  card.append(el("div", "font-size:12px;color:#8aa0ad", "Your invite link — share it so people can message you. Every chat is end-to-end encrypted:"));
  const mine = el("textarea", "background:#0a1119;border:1px solid #1f2c35;border-radius:10px;color:#9fd;padding:8px;font:11px ui-monospace,monospace;height:64px;resize:none");
  mine.readOnly = true; mine.className = "holo-direct-mylink"; mine.value = "…";
  myLink().then((l) => { mine.value = l; });
  const btnRow = el("div", "display:flex;gap:8px;align-self:flex-start");
  const copy = el("button", "background:rgba(255,255,255,.06);border:1px solid #1f2c35;border-radius:9px;color:#e9f1f5;padding:6px 10px;font-size:12px;cursor:pointer", "Copy link");
  copy.onclick = () => { try { navigator.clipboard.writeText(mine.value); copy.textContent = "Copied ✓"; } catch {} };
  // S1 — the personal invite is scannable too (the WhatsApp "my code" pattern): the SAME premium sheet the
  // group invite shows, through the one shared primitive. Fail-soft while the link is still minting.
  const qr = el("button", "background:rgba(124,58,237,.14);border:1px solid rgba(124,58,237,.35);border-radius:9px;color:#c4b5fd;padding:6px 10px;font-size:12px;cursor:pointer", "Show QR");
  qr.onclick = () => { const l = mine.value; if (l && l !== "…" && window.HoloShare) window.HoloShare.present(l); };
  btnRow.append(copy, qr);
  card.append(mine, btnRow);
  card.append(el("div", "font-size:12px;color:#8aa0ad;margin-top:4px", "Have someone's invite link? Paste it here:"));
  const theirs = el("textarea", "background:#0a1119;border:1px solid #1f2c35;border-radius:10px;color:#e9f1f5;padding:8px;font:11px ui-monospace,monospace;height:48px;resize:none");
  const start = el("button", "background:linear-gradient(90deg,#00d09c,#1fd6ac);color:#04110d;border:0;border-radius:11px;padding:10px;font-weight:700;cursor:pointer", "Start chat");
  const err = el("div", "display:none;color:#ffb0b0;font-size:12px");
  start.onclick = async () => {
    try {
      const m = /[#&]direct=v1\.([A-Za-z0-9_-]+)/.exec(theirs.value.trim());
      if (!m) throw new Error("That's not a valid invite link");
      const pub = JSON.parse(_ub64u(m[1]));
      if (!pub.sign || !pub.box) throw new Error("the link is missing its keys");
      ov.remove(); await open(pub, { name: pub.name || null });
    } catch (e) { err.style.display = "block"; err.textContent = "Invalid link — " + (e.message || e); }
  };
  const close = el("button", "background:transparent;border:0;color:#8aa0ad;cursor:pointer", "Close");
  close.onclick = () => ov.remove();
  card.append(theirs, start, err, close); ov.append(card); DOC.body.append(ov);
}
// ── v2 compact room invite — b64url( room(12B) ∥ sign(65B raw P-256) ∥ box(65B) ∥ name-utf8 ). Decoded back
// to the exact payload shape v1 carried (keys re-encoded with btoa = holo-seal's own _b64, padding included),
// so joinRoom and the roster maps never know which wire the invite rode.
function _roomV2(b64u) {
  const s = atob(b64u.replace(/-/g, "+").replace(/_/g, "/"));
  if (s.length < 142 || s.charCodeAt(12) !== 4 || s.charCodeAt(77) !== 4) throw new Error("bad v2 invite");
  const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255;
  const hex = Array.from(u.subarray(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
  const b64 = (a) => btoa(Array.from(a, (b) => String.fromCharCode(b)).join(""));
  return { v: 2, room: "room:" + hex, name: new TextDecoder().decode(u.subarray(142)) || null, creator: b64(u.subarray(12, 77)), creatorBox: b64(u.subarray(77, 142)) };
}
// ── the invite QR sheet — every minted room link is instantly scannable. Paints over the OS's OWN encoder
// (_shared/holo-qr-encode.mjs, self-contained ISO QR — no library, no network) as rounded-module SVG on a
// white card, Claude-desk framing (#1f1f1e, 11% hairlines). Fail-soft: no encoder → no sheet, link still flows.
// _qrSVG — the rounded-module branded QR as an SVG string, painted over the OS's OWN encoder
// (_shared/holo-qr-encode.mjs, self-contained ISO QR — no library, no network). The ONE QR renderer the
// whole messenger shares; returns "" if the encoder can't be reached (fail-soft — the link still flows).
async function _qrSVG(link) {
  let enc; try { enc = await import(new URL("../../_shared/holo-qr-encode.mjs", import.meta.url).href); } catch { return ""; }
  let q; try { q = enc.encode(String(link), { ecc: "M" }); } catch { return ""; }
  const m = 3, dim = q.size + m * 2, r = 0.32;   // quiet zone 3 modules; corner radius as a fraction of a module
  let d = "";
  for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.modules[y][x]) {
    const px = x + m, py = y + m;
    d += `M${px + r},${py} h${1 - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${1 - 2 * r} a${r},${r} 0 0 1 -${r},${r} h-${1 - 2 * r} a${r},${r} 0 0 1 -${r},-${r} v-${1 - 2 * r} a${r},${r} 0 0 1 ${r},-${r} z`;
  }
  return `<svg viewBox="0 0 ${dim} ${dim}" xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision"><rect width="${dim}" height="${dim}" fill="#fff" rx="${m}"/><path d="${d}" fill="#141413"/></svg>`;
}
async function _inviteQRSheet(link, roomName) {
  const svg = await _qrSVG(link); if (!svg) return;
  // OWN safe maker — module scope has no `el` (the sheet helpers are function-scoped; an implicit dependency
  // here died as a silent ReferenceError), and text lands via textContent: roomName is peer-controlled.
  const mk = (tag, style, text) => { const n = DOC.createElement(tag); if (style) n.style.cssText = style; if (text != null) n.textContent = text; return n; };
  const old = DOC.querySelector(".holo-invite-qr-sheet"); if (old) old.remove();
  const ov = mk("div", "position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;background:rgba(10,10,10,.55);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)");
  ov.className = "holo-invite-qr-sheet";
  const card = mk("div", "background:#1f1f1e;border:1px solid rgba(255,255,255,.11);border-radius:14px;padding:24px 22px 18px;width:min(340px,92vw);display:flex;flex-direction:column;align-items:center;gap:12px;box-shadow:0 24px 80px rgba(0,0,0,.5);font-family:inherit");
  card.append(mk("div", "font-weight:600;font-size:16px;color:#ececea;letter-spacing:-.1px", roomName ? "Invite to " + roomName : "Invite link"));
  card.append(mk("div", "font-size:12.5px;color:#9c9a94;margin-top:-6px", "Scan to join · end-to-end encrypted"));
  const qr = mk("div", "width:216px;height:216px;border-radius:12px;overflow:hidden;box-shadow:0 1px 0 rgba(255,255,255,.06)"); qr.innerHTML = svg; card.append(qr);   // svg = OUR bytes, never peer input
  const lk = mk("div", "max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:11px ui-monospace,monospace;color:#8a8880", String(link)); card.append(lk);
  // WhatsApp-clean: the sheet OWNS the share — QR to scan, Copy to paste anywhere, Share for the OS/social share
  // sheet. One surface, no pre-copy assumption, no separate step. (Replaces the old static "copied" chip.)
  const row = mk("div", "display:flex;gap:8px;width:100%;margin-top:4px");
  const actBtn = (label, primary) => mk("button", "flex:1;padding:10px 8px;border-radius:10px;border:1px solid rgba(255,255,255,.11);background:" + (primary ? "#7c3aed" : "rgba(255,255,255,.06)") + ";color:" + (primary ? "#fff" : "#ececea") + ";font-family:inherit;font-size:13px;font-weight:600;cursor:pointer", label);
  const bCopy = actBtn("Copy link", false);
  bCopy.onclick = async () => { try { await navigator.clipboard.writeText(String(link)); } catch {} bCopy.textContent = "✓ Copied"; setTimeout(() => { bCopy.textContent = "Copy link"; }, 1600); };
  row.append(bCopy);
  try { if (typeof navigator !== "undefined" && navigator.share) { const bShare = actBtn("Share", true); bShare.onclick = async () => { try { await navigator.share({ title: roomName ? ("Join " + roomName + " on Hologram") : "Join me on Hologram", text: "Open this link to join the group — message and video call, no app needed.", url: String(link) }); } catch {} }; row.append(bShare); } } catch {}
  card.append(row);
  const close = mk("button", "margin-top:2px;background:transparent;border:0;color:#9c9a94;font-size:13px;cursor:pointer;padding:6px 10px", "Close");
  close.onclick = () => ov.remove(); card.append(close);
  ov.addEventListener("click", (e) => { if (e.target === ov) ov.remove(); });
  DOC.addEventListener("keydown", function esc(e) { if (e.key === "Escape") { ov.remove(); DOC.removeEventListener("keydown", esc); } });
  card.addEventListener("click", (e) => e.stopPropagation());
  ov.append(card); DOC.body.append(ov);
}
// ── HoloShare (S0) — the ONE share primitive every messenger surface calls. A link in, and { qrSVG, present }
// out: the identical premium sheet (QR + Copy + native Share), same brand, everywhere. `mint()` returns the
// object shape the cross-app contract promises; today messenger links are minted by their own paths (roomLink
// / myLink), so mint wraps a ready link — S2 (named doors) + S4 (a shared module for ALL apps) back this next.
if (typeof window !== "undefined") window.HoloShare = {
  qrSVG: (link) => _qrSVG(link),                                   // → Promise<svg string> ("" if no encoder)
  present: (link, opts = {}) => _inviteQRSheet(link, (opts && opts.title) || null),   // → the share sheet
  mint: (link, opts = {}) => ({ link, qrSVG: _qrSVG(link), card: null, present: () => _inviteQRSheet(link, (opts && opts.title) || null) }),
};
function _attach() {
  // Holo Direct rail icon removed by request. The 🔐 left-rail button is no longer mounted;
  // Direct stays fully reachable via the main-list "Holo Direct · sealed" section and the
  // one-link door. Any stale button from a cached DOM is swept so the rail reads clean.
  try { const b = DOC && $(".holo-direct-btn"); if (b) { b.remove(); railBtn = null; } } catch {}
  return true;
}

function start() {
  if (!DOC || typeof window === "undefined") return;
  if (window.__holoDirectMount) return; window.__holoDirectMount = true;
  window.HoloDirect = { open, boot: _boot, link: myLink, code: async () => { await _boot(); return JSON.stringify(direct.myPub); }, state: (cid) => (direct ? direct.linkState(cid) : "off"),
    vozReady: async (cid) => (direct ? direct.vozReady(cid) : false), sealStats: () => (direct ? direct.sealStats() : null),
    // ── ROOMS (M4) — the sealed team room over the SAME serverless door. Behind ?rooms=1 until the UI lands;
    //   these are the callable primitives a witness (and the room UI, T6) drives. Each awaits the boot so a
    //   fresh page can create/join without a manual boot() first.
    createRoom: async (name) => { await _boot(); return direct.createRoom(name); },
    joinRoom: async (payload) => { await _boot(); return direct.joinRoom(payload); },
    roomLink: async (id) => { await _boot(); const l = direct.roomLink(id); try { if (l) _inviteQRSheet(l, ((direct.roomView && direct.roomView(id)) || {}).name); } catch {} return l; },
    roomSend: async (id, text) => { await _boot(); return direct.roomSend(id, text); },
    roomKick: async (id, memberSign) => { await _boot(); return direct.roomKick(id, memberSign); },
    rooms: async () => { await _boot(); return direct.rooms(); },
    roomMembers: async (id) => { await _boot(); return direct.roomMembers(id); },
    roomView: async (id) => { await _boot(); return direct.roomView(id); },
    roomHistory: async (id) => { await _boot(); return direct.history(id); },   // the sealed vault's room thread (records carry {text,dir,ts,name})
    roomLive: async (id, info) => { await _boot(); return direct.roomLive(id, info); },   // ephemeral "I'm inside <holospace>" presence
    roomCo: async (id, url, data) => { await _boot(); return direct.roomCo(id, url, data); },   // together-frames (cursors / playback sync) for a shared pane
    onRoom: (cb) => { _boot().then(() => direct.on("room", cb)); },
    onRoomEvent: (cb) => { _boot().then(() => direct.on("roomevent", cb)); },
    // ── PRESENCE (AIM A1/A3) — buddy state over the same sealed door; TTL-honest, contacts only.
    setPresence: async (o) => { await _boot(); return direct.setPresence(o); },
    myPresence: () => (direct ? direct.myPresence() : { state: "offline", msg: null, profile: null }),
    presenceOf: (cid) => (direct ? direct.presenceOf(cid) : { state: "offline", msg: null, profile: null, ts: 0 }),
    presences: async () => { await _boot(); return direct.presences(); },
    onPresence: (cb) => { _boot().then(() => direct.on("presence", cb)); },
    verifyStatus: (cid) => (direct ? direct.verifyStatus(cid) : { status: "unknown" }),
    onMessage: (cb) => { _boot().then(() => direct.on("message", cb)); },
    // ── STATUS (WhatsApp Status): the story rail — fan a story/revoke to every contact, ack back to the
    //   author, subscribe the engine (holo-status.mjs owns shelf/TTL/receipts; this door only carries).
    postStory: async (st) => { await _boot(); return direct.postStory(st); },
    storyFan: async (fr) => { await _boot(); return direct.storyFan(fr); },
    storyCtl: async (cid, fr) => { await _boot(); return direct.storyCtl(cid, fr); },
    onStory: (cb) => { _boot().then(() => direct.on("story", cb)); },
    mySign: async () => { await _boot(); return (direct.myPub && direct.myPub.sign) || null; },
    conversations: async () => { await _boot(); return direct.conversations(); },
    getMeta: async (k) => { await _boot(); return direct.getMeta(k); },
    setMeta: async (k, v) => { await _boot(); return direct.setMeta(k, v); },
    // if opened from a #room invite, auto-join once booted (fail-soft). Returns the parsed room or null.
    joinFromFragment: async () => { await _boot(); const m = /[#&]room=v([12])\.([A-Za-z0-9_-]+)/.exec(location.hash || ""); if (!m) return null;
      try { const p = m[1] === "2" ? _roomV2(m[2]) : JSON.parse(decodeURIComponent(escape(atob(m[2].replace(/-/g, "+").replace(/_/g, "/"))))); const r = await direct.joinRoom(p); return { ...r, invite: p }; } catch { return null; } } };
  // auto-join a room invite the moment Direct is up (mirrors the #direct auto-open). Gated so it never fires
  // on a normal boot; the fragment is scrubbed by the room parse path the same way #direct is.
  try { if (/[#&]room=v[12]\./.test(location.hash || "")) { window.HoloDirect.joinFromFragment().catch(() => {}); } } catch {}
  setInterval(() => { _attach(); _renderSection(); }, 2000); _attach();
  // returning operator: if the sealed store already exists, boot in the background so the Direct threads
  // are VISIBLE in the main list without any click (the 3 MB spine cost is deferred past first paint;
  // a first-time visitor has no store and pays nothing).
  setTimeout(async () => {
    try {
      if (direct || bootP || !("databases" in indexedDB)) return;
      const dbs = await indexedDB.databases();
      if ((dbs || []).some((d) => d && d.name === "holo-direct-store")) { await _boot(); _renderSection(); }
    } catch {}
  }, 2500);
  // the one-link door: arrived via someone's Direct link → scrubbed already by _parseFragment, then
  // introduction (TOFU) + warm + panel, one motion. The 3 MB spine loads here because this IS first use.
  const invite = _parseFragment();
  if (invite) open({ sign: invite.sign, box: invite.box }, { name: invite.name || null }).catch((e) => console.warn("[direct] link open failed:", String(e)));
}
start();
