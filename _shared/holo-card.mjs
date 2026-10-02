// holo-card.mjs — THE ONE VERIFIED CARD, everywhere (A1+A2 of resolve-ambient). A `<holo-card name="…">`
// custom element (shadow DOM = pixel-identical in every host — messenger chat, a streamed holo app, the
// inspector) that resolves the name through the ONE host resolver, VERIFIES before it paints, and shows:
// the seal, the κ, a one-tap launch when the name is a holo app, and a preview (image/video/text from the
// VERIFIED bytes only — nothing unverified ever renders). The SEAL IS THE DOOR: tap it → the inspector
// (/apps/resolve/#<name>). A refusal shows one honest sentence, never a fake card.
//
// Embed the resolver into ANY holo app streamed in the messenger with ONE line:
//     import "/usr/lib/holo/holo-card.mjs";  then  <holo-card name="sha256:…"></holo-card>
// or imperatively:  HoloCard.mount(el, name).  Lean: shadow-scoped CSS, blob previews revoked on
// disconnect, one shared resolver + one app-index load across every card on the page.

import { makeHostResolver } from "./holo-names-host.mjs";
import { loadAppIndex, findApp } from "./holo-app-index.mjs";

// bundle root from THIS module location (works at the OS root or a /Q/ subpath)
const BASE = new URL("../../../", import.meta.url);       // /usr/lib/holo/holo-card.mjs -> bundle root
const INSPECTOR = new URL("apps/resolve/", BASE).href;
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

// ── pure core (Node-witnessable): sniff media, build the render MODEL from a resolver result ──────────
export function sniff(b) {
  if (!b || b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return "image/webp";
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return "video/mp4";
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf) return "video/webm";
  if (b[0] === 0x3c && (b[1] === 0x73 || b[1] === 0x3f || b[1] === 0x21)) return "image/svg+xml";
  return null;
}
const isPrintable = (h) => h.every((x) => x === 9 || x === 10 || x === 13 || (x >= 32 && x < 240));

export function cardModel(res, name, appIdx) {
  const url = INSPECTOR + "#" + encodeURIComponent(name);
  if (!res || !res.ok) return { ok: false, url, headline: res && res.kind === "refused" ? "refused" : "not verifiable here", msg: (res && (res.explain || res.why)) || "" };
  const app = appIdx ? findApp(appIdx, res.kappa) : null;
  const size = res.size != null ? res.size : (res.bytes ? res.bytes.length : 0);
  const model = { ok: true, url, kappa: res.kappa, size, kind: app ? "holo app · " + app.dir : res.kind, app: app ? { title: app.title, desc: app.desc, url: app.url } : null };
  if (!app && res.bytes) {
    const type = sniff(res.bytes);
    if (type) model.media = { type };
    else { const head = res.bytes.subarray(0, 600); if (isPrintable(head)) { try { model.preview = new TextDecoder().decode(head) + (size > 600 ? "\n…" : ""); } catch {} } }
  }
  return model;
}

// ── the custom element (browser) ──────────────────────────────────────────────────────────────────────
const TAG = "holo-card";
const STYLE = `
:host{display:block;font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#e9edef;max-width:420px}
.card{background:#111b21;border:1px solid #1f2c33;border-radius:14px;padding:13px 15px}
a{color:inherit;text-decoration:none}
.seal{display:flex;align-items:center;gap:9px;font-weight:650}
.dot{width:9px;height:9px;border-radius:50%;background:#00a884;box-shadow:0 0 10px #00a884;flex:0 0 auto}
.seal.bad .dot{background:#f15c6d;box-shadow:0 0 10px #f15c6d}
.go{margin-left:auto;font-size:12px;color:#8696a0;font-weight:500}
.app{margin-top:11px;background:#0d1f1a;border:1px solid #17493b;border-radius:11px;padding:11px 13px}
.app-h{display:flex;align-items:center;justify-content:space-between;gap:12px}
.app-title{font-size:16px;font-weight:650}
.open{background:#00a884;color:#06231c;border-radius:10px;padding:7px 14px;font-size:13px;font-weight:650;white-space:nowrap}
.kv{margin-top:10px;display:grid;grid-template-columns:56px 1fr;gap:4px 12px;font-size:12px}
.kv .k{color:#8696a0}.kv .v{word-break:break-all;font-family:ui-monospace,Consolas,monospace;font-size:11px}
.msg{margin-top:7px;color:#8696a0;font-size:13px}
img,video{max-width:100%;border-radius:10px;margin-top:11px;display:block}
pre{margin-top:11px;background:#0d161c;border:1px solid #1f2c33;border-radius:9px;padding:10px;font-size:11px;color:#cfd8dc;max-height:180px;overflow:auto;white-space:pre-wrap;word-break:break-all}
@media(prefers-color-scheme:light){:host{color:#0b141a}.card{background:#fff;border-color:#e3e8eb}.kv .k,.go,.msg{color:#667781}pre{background:#f6f8f9;border-color:#e3e8eb;color:#3b4a54}}`;

let _R = null, _idxP = null;
const resolver = () => (_R ||= makeHostResolver({ base: BASE.href, wasmGlue: new URL("apps/q/pkg/holospaces_web.js", BASE).href }));
const appIndex = () => (_idxP ||= loadAppIndex({ base: BASE.href }).catch(() => null));

const HoloCardEl = typeof HTMLElement !== "undefined" ? class extends HTMLElement {
  static get observedAttributes() { return ["name"]; }
  connectedCallback() { this._root ||= this.attachShadow({ mode: "open" }); this._render(); }
  disconnectedCallback() { if (this._blob) { URL.revokeObjectURL(this._blob); this._blob = null; } }
  attributeChangedCallback() { if (this._root) this._render(); }
  set result(r) { this._pre = r; if (this._root) this._render(); }
  async _render() {
    const name = this.getAttribute("name") || (this._pre && this._pre.name) || "";
    const root = this._root;
    root.innerHTML = `<style>${STYLE}</style><div class="card"><div class="seal"><span class="dot" style="background:#8696a0;box-shadow:none"></span>verifying…</div></div>`;
    let res = this._pre && this._pre.ok !== undefined ? this._pre : null;
    if (!res) { try { res = await resolver().resolveOrExplain(name); } catch (e) { res = { ok: false, why: String(e && e.message || e) }; } }
    if (!this.isConnected) return;
    const m = cardModel(res, name, await appIndex());
    const card = document.createElement("div"); card.className = "card";
    if (!m.ok) { card.innerHTML = `<a class="seal bad" href="${m.url}" target="_blank" rel="noopener"><span class="dot"></span>${esc(m.headline)}<span class="go">what is this? ↗</span></a>${m.msg ? `<div class="msg">${esc(m.msg)}</div>` : ""}`; }
    else {
      let h = `<a class="seal" href="${m.url}" target="_blank" rel="noopener"><span class="dot"></span>verified<span class="go">details ↗</span></a>`;
      if (m.app) h += `<div class="app"><div class="app-h"><span class="app-title">${esc(m.app.title)}</span><a class="open" href="${esc(m.app.url)}">Open →</a></div>${m.app.desc ? `<div class="msg" style="margin-top:6px">${esc(m.app.desc)}</div>` : ""}</div>`;
      h += `<div class="kv"><div class="k">κ</div><div class="v">${esc(m.kappa)}</div><div class="k">kind</div><div class="v">${esc(m.kind)}</div><div class="k">size</div><div class="v">${m.size.toLocaleString()} bytes</div></div>`;
      if (m.preview) h += `<pre>${esc(m.preview)}</pre>`;
      card.innerHTML = h;
      if (m.media && res.bytes) {
        try { this._blob = URL.createObjectURL(new Blob([res.bytes], { type: m.media.type })); const n = document.createElement(m.media.type.startsWith("video") ? "video" : "img"); n.src = this._blob; if (n.tagName === "VIDEO") { n.controls = true; n.playsInline = true; } card.appendChild(n); } catch {}
      }
    }
    root.querySelector(".card").replaceWith(card);
  }
} : null;

export function define() { try { if (HoloCardEl && typeof customElements !== "undefined" && !customElements.get(TAG)) customElements.define(TAG, HoloCardEl); } catch {} }
export function mount(el, name) { const c = document.createElement(TAG); c.setAttribute("name", String(name)); el.appendChild(c); return c; }
define();

// ── MONEY CARD (A2·R5) — the ONE renderer for a payment κ-object, in its three states. Pure core is
//    node-witnessable. A payment MATURES request → proposal → receipt in the SAME card. It shows outcome ·
//    total · time and NEVER a chain, gas, or venue word (A2's fold, re-asserted at the render layer). Feeds
//    from the intent router's proposal.card, from holo-pay.parsePayment, or from an intent-realize receipt. ──
const _FIATSYM = { USD: "$", EUR: "€", GBP: "£" };
export function moneyFmt(amount, asset, fiat) {   // fiat-clear formatting: abstract the asset, show money
  const a = Number(amount);
  if (fiat && _FIATSYM[fiat]) return _FIATSYM[fiat] + a.toFixed(2);
  return (a % 1 === 0 ? a : a.toFixed(4).replace(/0+$/, "")) + " " + (asset || "");
}
const _NOCHAIN = /\b(chain|gas|gwei|wei|network|bridge|route|rpc|erc-?20|evm|mainnet|l2|base|arbitrum|optimism|polygon|ethereum|solana|avalanche|bsc|plasma|hyperliquid)\b/i;
export function moneyModel(m) {
  const o = m || {};
  // 1 · intent-router PROPOSAL (or refusal) — carries .card {outcome,total,etaSeconds,sentence}
  if (o.card && (o.card.sentence || o.card.outcome != null)) {
    if (o.refused) return { ok: false, state: "proposal", headline: "Can't route this yet", msg: o.reason || "" };
    return { ok: true, state: "proposal", headline: o.card.outcome != null ? ("They get " + o.card.outcome) : o.card.sentence,
      lines: [["Total", o.card.total], ["Time", o.card.etaSeconds != null ? ("about " + o.card.etaSeconds + "s") : ""]].filter((x) => x[1]),
      sentence: o.card.sentence, kappa: o.kappa, action: "Confirm" };
  }
  // 2 · holo-pay INTENT — {kind:"send"|"request", amount, asset, fiat, toName, fromName, memo, kappa}
  if (o.kind === "send" || o.kind === "request") {
    const money = moneyFmt(o.amount, o.asset, o.fiat);
    if (o.kind === "request") return { ok: true, state: "request", headline: (o.fromName || "Someone") + " requests " + money, sub: o.memo ? ("“" + o.memo + "”") : "", kappa: o.kappa, action: "Pay" };
    return { ok: true, state: "proposal", headline: "Send " + money + (o.toName ? (" to " + o.toName) : ""), sub: o.memo ? ("“" + o.memo + "”") : "", kappa: o.kappa, action: "Send" };
  }
  // 3 · RECEIPT — {state:"receipt"|receipt:{kappa}|kappa, amount?, asset?, fiat?, toName?}
  if (o.state === "receipt" || o.receipt) {
    const money = o.amount != null ? moneyFmt(o.amount, o.asset, o.fiat) : "";
    const k = (o.receipt && (o.receipt.kappa || o.receipt)) || o.kappa;
    return { ok: true, state: "receipt", headline: "Sent" + (money ? " " + money : "") + (o.toName ? (" to " + o.toName) : ""), sub: o.memo ? ("“" + o.memo + "”") : "", kappa: k, action: "View" };
  }
  return { ok: false, state: "unknown", headline: "Not a payment", msg: "" };
}
// true iff NO chain/gas/venue word leaked into any human-facing field (A2's fold, render-layer guard).
export function moneyClean(model) {
  const fields = [model.headline, model.sub, model.msg, model.sentence, ...(model.lines || []).flat()].filter(Boolean).join(" ");
  return !_NOCHAIN.test(fields);
}
// imperative renderer — the ONE money card in any host (React bubble, standalone). onAction(model) fires the
// state's verb (Pay/Send/Confirm/View). Refusals render one honest line, never a fake card.
const MONEY_STYLE = `
.mcard{background:#111b21;border:1px solid #1f2c33;border-radius:14px;padding:13px 15px;max-width:420px;font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#e9edef}
.mcard .top{display:flex;align-items:center;gap:9px;font-weight:650}
.mcard .dot{width:9px;height:9px;border-radius:50%;background:#00a884;box-shadow:0 0 10px #00a884;flex:0 0 auto}
.mcard.bad .dot{background:#f15c6d;box-shadow:0 0 10px #f15c6d}
.mcard .sub{margin-top:5px;color:#8696a0;font-size:13px}
.mcard .lines{margin-top:9px;display:grid;grid-template-columns:auto 1fr;gap:3px 12px;font-size:13px}
.mcard .lines .k{color:#8696a0}.mcard .lines .v{text-align:right;font-weight:600}
.mcard .act{margin-top:12px;width:100%;background:#00a884;color:#06231c;border:0;border-radius:10px;padding:9px 14px;font-size:14px;font-weight:650;cursor:pointer}
.mcard .foot{margin-top:9px;color:#8696a0;font-size:11px;letter-spacing:.02em}
@media(prefers-color-scheme:light){.mcard{background:#fff;border-color:#e3e8eb;color:#0b141a}.mcard .sub,.mcard .lines .k,.mcard .foot{color:#667781}}`;
export function mountMoney(el, model, { onAction = null } = {}) {
  if (typeof document === "undefined" || !el) return null;
  const m = model && model.state ? model : moneyModel(model);
  const wrap = document.createElement("div");
  const label = m.state === "receipt" ? "Holo Pay · receipt" : m.state === "request" ? "Holo Pay · request" : "Holo Pay";
  let h = `<style>${MONEY_STYLE}</style><div class="mcard${m.ok ? "" : " bad"}"><div class="top"><span class="dot"></span>${esc(m.headline)}</div>`;
  if (m.sub) h += `<div class="sub">${esc(m.sub)}</div>`;
  if (m.msg) h += `<div class="sub">${esc(m.msg)}</div>`;
  if (m.lines && m.lines.length) h += `<div class="lines">${m.lines.map(([k, v]) => `<span class="k">${esc(k)}</span><span class="v">${esc(v)}</span>`).join("")}</div>`;
  if (m.ok && m.action) h += `<button class="act" type="button">${esc(m.action)}</button>`;
  h += `<div class="foot">${esc(label)} · verified on this device</div></div>`;
  wrap.innerHTML = h;
  const btn = wrap.querySelector(".act");
  if (btn && onAction) btn.onclick = () => onAction(m);
  el.appendChild(wrap);
  return wrap;
}

try { if (typeof window !== "undefined") window.HoloCard = Object.assign(window.HoloCard || {}, { define, mount, TAG, moneyModel, moneyClean, mountMoney, moneyFmt }); } catch {}

export default { define, mount, cardModel, sniff, TAG, moneyModel, moneyClean, mountMoney, moneyFmt };
