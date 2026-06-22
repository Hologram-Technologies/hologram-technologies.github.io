// holo-own-ui.js — the AMBIENT ownership surface (ADR-053, layer 2). ONE import gives ANY holospace
// a live owner badge + a Claim · Transfer · Anchor · Sell sheet over the real Own engine
// (holo-own + holo-own-rail), persisted in a content-addressed title registry. This is what makes
// web3 feel ubiquitous: every object shows who owns it and can change hands, self-verifying, through
// the wallet's human-approval gate — no per-app code. Framework-free; controller is node-testable,
// the badge/sheet render only where there is a DOM.

import * as own from "./holo-own.mjs";
import { walletRail, mockRail, settleVia } from "./holo-own-rail.js";
import { kappaBlake3 } from "./holo-blake3.mjs";

const te = new TextEncoder();
const railFor = () => (typeof BroadcastChannel !== "undefined" ? walletRail() : mockRail());
// a stable owned-κ for any thing the host wants to make ownable (content, src, or a descriptor).
export const ownedKappaOf = (descriptor) => kappaBlake3(te.encode(typeof descriptor === "string" ? descriptor : JSON.stringify(descriptor)));

// ── operator (the signer) — set by the host once unlocked; ownership WRITES need it, reads don't ──
let _op = null, _unlock = null;
export function setOperator(p) { _op = p; return _op; }
export function operator() { return _op; }
export function onUnlock(fn) { _unlock = fn; }                       // host provides: async () => principal
async function signer() { if (_op) return _op; if (_unlock) _op = await _unlock(); if (!_op) throw new Error("locked — unlock your identity to sign"); return _op; }

// ── title registry: owned-κ → its Title chain (IndexedDB in the browser; in-memory under node) ──
const hasIDB = typeof indexedDB !== "undefined";
const mem = new Map();
const DB = "holo-own", STORE = "titles";
function openDB() { return new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "owned" }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function idb(mode, fn) { const db = await openDB(); return new Promise((res, rej) => { const rq = fn(db.transaction(STORE, mode).objectStore(STORE)); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); }); }
export async function loadChain(ownedK) { const rec = hasIDB ? await idb("readonly", (s) => s.get(ownedK)) : mem.get(ownedK); return (rec && rec.chain) || []; }
async function saveChain(ownedK, chain) { const rec = { owned: ownedK, chain }; if (hasIDB) await idb("readwrite", (s) => s.put(rec)); else mem.set(ownedK, rec); return chain; }

// ── state + actions (the controller — pure of DOM, node-testable) ──
export async function ownState(ownedK) {
  const chain = await loadChain(ownedK);
  if (!chain.length) return { owned: ownedK, unowned: true };
  const v = await own.verifyChain(chain);
  return { owned: ownedK, unowned: false, owner: v.owner, ownerDid: v.ownerDid, ok: v.ok, head: chain[chain.length - 1], chain };
}
export async function claim(ownedK, rights = {}) { const by = await signer(); const t = await own.mint({ owned: ownedK, rights }, by); await saveChain(ownedK, [t]); return t; }
// claimAsset: ORIGINATE a new issuer-bound asset — its κ commits to your key, so no one else can mint
// a competing genesis to the same asset. Returns the Title; its owned κ keys the registered chain.
export async function claimAsset(asset, rights = {}) { const by = await signer(); const t = await own.mint({ asset, rights }, by); await saveChain(t.owned, [t]); return t; }
export async function transferTo(ownedK, to, opts = {}) { const by = await signer(); const chain = await loadChain(ownedK); if (!chain.length) throw new Error("nothing to transfer — claim it first"); const t = await own.transfer({ title: chain[chain.length - 1], to }, by, opts); await saveChain(ownedK, [...chain, t]); return t; }
export async function anchorIt(ownedK, chainName = "ethereum", rail) { const chain = await loadChain(ownedK); if (!chain.length) throw new Error("claim it first"); return own.anchor(chain[chain.length - 1]["@id"], chainName, rail || railFor()); }
export async function sellTo(ownedK, to, amount, chainName = "ethereum", rail) {
  const by = await signer(); const chain = await loadChain(ownedK); if (!chain.length) throw new Error("claim it first");
  const next = await own.transfer({ title: chain[chain.length - 1], to }, by); const full = [...chain, next]; await saveChain(ownedK, full);
  const buyer = (typeof to === "string" ? to : to.kappa).replace(/^did:holo:/, "");
  const order = { subject: next["@id"], amount: { value: amount, currency: chainName }, buyer };
  const settled = await settleVia(own, { order, chain: { titles: full } }, rail || railFor());
  return { title: next, voucher: settled, txid: settled && settled.txid };
}

// ── badge: a live owner chip (click → the sheet). DOM only. ──
const short = (k) => k ? k.split(":").pop().slice(0, 8) : "";
export function badgeFor(ownedK, { onOpen } = {}) {
  if (typeof document === "undefined") return null;
  const el = document.createElement("button");
  el.className = "holo-own-badge"; el.type = "button";
  el.style.cssText = "all:unset;cursor:pointer;font:600 var(--holo-text-sm, 1rem) system-ui;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--accent,#6cf) 18%,transparent);color:var(--fg,#dfe);display:inline-flex;gap:5px;align-items:center";
  const paint = async () => { const s = await ownState(ownedK); el.textContent = s.unowned ? "◇ unowned" : (s.ok ? "👤 " + short(s.owner) : "⚠ unverified"); el.title = s.unowned ? "Claim ownership" : "Owner did:holo:" + (s.owner || ""); };
  el.addEventListener("click", (e) => { e.stopPropagation(); (onOpen || openOwnSheet)(ownedK, { onChange: paint }); });
  el.refresh = paint; paint();
  return el;
}

// ── sheet: the Claim · Transfer · Anchor · Sell dialog. DOM only. ──
export async function openOwnSheet(ownedK, { onChange, chain = "ethereum" } = {}) {
  if (typeof document === "undefined") return;
  const s = await ownState(ownedK);
  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;inset:0;z-index:99999;display:grid;place-items:center;background:rgba(0,0,0,.45)";
  const card = document.createElement("div");
  card.style.cssText = "min-width:320px;max-width:90vw;background:var(--bg,#14171c);color:var(--fg,#dfe);border:1px solid color-mix(in srgb,var(--accent,#6cf) 30%,transparent);border-radius:14px;padding:18px;font:var(--holo-text-sm, 1rem) system-ui;box-shadow:0 20px 60px rgba(0,0,0,.5)";
  const close = () => ov.remove();
  const row = (html) => { const d = document.createElement("div"); d.style.cssText = "margin:8px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap"; d.innerHTML = html; return d; };
  const btn = (t) => { const b = document.createElement("button"); b.textContent = t; b.style.cssText = "all:unset;cursor:pointer;padding:7px 12px;border-radius:8px;background:var(--accent,#6cf);color:#04121c;font-weight:600"; return b; };
  const inp = (ph) => { const i = document.createElement("input"); i.placeholder = ph; i.style.cssText = "flex:1;min-width:120px;padding:7px 9px;border-radius:8px;border:1px solid #345;background:#0c0f13;color:inherit;font:var(--holo-text-sm, 1rem) ui-monospace"; return i; };
  const refresh = async () => { try { onChange && (await onChange()); } catch {} };
  const toast = (m) => { const t = card.querySelector(".msg"); if (t) t.textContent = m; };

  card.innerHTML = `<div style="font-weight:700;font-size:var(--holo-text-sm,1rem);margin-bottom:4px">Ownership</div>
    <div style="opacity:.7;font:var(--holo-text-sm, 1rem) ui-monospace;word-break:break-all">holo://${short(ownedK)}…</div>
    <div style="margin:10px 0;font-weight:600">${s.unowned ? "◇ Unowned" : (s.ok ? "👤 Owner did:holo:" + short(s.owner) + "…" : "⚠ Unverified")}</div>
    <div class="msg" style="opacity:.7;font-size:var(--holo-text-sm,1rem);min-height:16px"></div>`;
  const slot = document.createElement("div"); card.appendChild(slot);

  if (s.unowned) {
    const b = btn("Claim ownership → mint Title");
    b.onclick = async () => { try { await claim(ownedK); toast("claimed ✓"); await refresh(); close(); openOwnSheet(ownedK, { onChange, chain }); } catch (e) { toast(e.message); } };
    slot.appendChild(row("")).appendChild(b);
  } else {
    const to = inp("recipient did:holo / sha256:κ"); const tb = btn("Transfer");
    tb.onclick = async () => { try { await transferTo(ownedK, to.value.trim().replace(/^did:holo:/, "")); toast("transferred ✓"); await refresh(); close(); } catch (e) { toast(e.message); } };
    const tr = row(""); tr.append(to, tb); slot.appendChild(tr);

    const amt = inp("amount"); const sb = btn("Sell");
    sb.onclick = async () => { try { const r = await sellTo(ownedK, to.value.trim().replace(/^did:holo:/, ""), amt.value.trim(), chain); toast("sold ✓ tx " + (r.txid || "—")); await refresh(); close(); } catch (e) { toast(e.message); } };
    const sr = row(""); sr.append(amt, sb); slot.appendChild(sr);

    const ab = btn("Anchor → " + chain);
    ab.onclick = async () => { try { const a = await anchorIt(ownedK, chain); toast("anchored ✓ " + (a.txid || "")); } catch (e) { toast(e.message); } };
    slot.appendChild(row("")).appendChild(ab);
  }
  const x = btn("Close"); x.style.background = "#334"; x.style.color = "inherit"; x.onclick = close;
  slot.appendChild(row("")).appendChild(x);
  ov.appendChild(card); ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
  document.body.appendChild(ov);
}

if (typeof window !== "undefined") window.HoloOwnUI = { ownedKappaOf, setOperator, operator, onUnlock, ownState, loadChain, claim, claimAsset, transferTo, anchorIt, sellTo, badgeFor, openOwnSheet };
