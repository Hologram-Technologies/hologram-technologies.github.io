// holo-bank.mjs — the ONE thing Holo Wallet imports to get banks. It collapses five proven modules
// (holo-openbank · -roam · -q · -prove) behind a single facade so the wallet sees one surface, not five:
//
//   import { mountBankCenter } from "./holo-bank.mjs";
//   mountBankCenter(document.getElementById("pane-banks"), { operator: currentOp.kappa, credentialId, notify });
//
// That single call: connects banks (one bank-side SCA), roams them E2E to your other devices (no re-auth),
// reads balances on-device, collapses the 90-day reconfirm into one pill + one biometric, and mints
// "balance ≥ £X" proof links. The complexity lives here; the wallet stays simple.
//
// Two layers, cleanly split so the logic is Node-witnessable without a DOM:
//   • createBankCenter(deps) — the CONTROLLER. Pure composition of the four modules; all I/O injected
//     (store · relay · cipher · gate · stepUp · aggregator). This is what the witness drives.
//   • mountBankPanel(el, center) / mountBankCenter(el, deps) — the VIEW + browser wiring (the real
//     holo-stepup gate, the session relay/cipher, a localStorage-sealed store). Browser-only.

import { makeOpenBank } from "./holo-openbank.mjs";
import { makeBankRoam, bankRoamOnChange } from "./holo-openbank-roam.mjs";
import { reconfirmDigest, toNotification, runBatchReconfirm, prettyBank } from "./holo-openbank-q.mjs";
import { mintBalanceProof, encodeProofLink } from "./holo-openbank-prove.mjs";

// ── CONTROLLER ───────────────────────────────────────────────────────────────────────────────────────
export function createBankCenter({ store, relay, cipher, gate, stepUp, operator, aggregator, self, now = () => Date.now() } = {}) {
  if (!operator) throw new Error("holo-bank: operator κ required");
  if (!aggregator) throw new Error("holo-bank: an aggregator adapter is required");
  // `self` is the DEVICE id, NOT the operator: a user's paired devices share one operator κ, so roam must
  // tell them apart by device to skip its own echoes (else a device ignores its sibling as "itself").
  const roam = makeBankRoam({ store, relay, cipher, self: self || ("device:" + operator) });
  const ob = makeOpenBank({ aggregator, store, gate, operator, now, onChange: bankRoamOnChange(roam) });

  const center = {
    roam, ob, operator,
    start() { try { roam.start && roam.start(); } catch {} return center; },
    stop() { try { roam.stop && roam.stop(); } catch {} },

    // the single snapshot the view renders: every linked account with its live balance, plus the due digest.
    async model() {
      const a = await ob.listAccounts();
      const accounts = [];
      for (const acc of (a.accounts || [])) {
        let balance = null;
        try { const b = await ob.getBalance(acc.accountId, { consent: acc.consent }); balance = b.ok ? b.balance : null; } catch {}
        accounts.push({ ...acc, bankName: prettyBank(acc.bankId), balance });
      }
      return { accounts, due: await reconfirmDigest(ob) };
    },

    beginAdd: (bankId) => ob.beginConnect(bankId),                                  // → { scaUrl, pendingRef }
    completeAdd: (pendingRef, params, bankId) => ob.completeConnect(pendingRef, params, { bankId }),
    revoke: (id) => ob.revoke(id),
    // the real bank list from the aggregator (GoCardless), or null → the view falls back to its static demo set.
    async institutions() { try { return aggregator.institutions ? await aggregator.institutions("gb") : null; } catch { return null; } },

    // the quarterly one-tap: reconfirm every due consent. One biometric clears them all (gate trust window).
    async reconfirmDue() { const d = await reconfirmDigest(ob); return d ? runBatchReconfirm(ob, d.ids) : { ok: true, reconfirmed: [] }; },

    // prove "balance ≥ threshold" as a shareable link, revealing nothing else.
    async prove({ accountId, consent, ccy, threshold, validForMs, attest, attestor }) {
      const m = await mintBalanceProof(ob, { accountId, consent, ccy, threshold, validForMs, stepUp, attest, attestor, now: now() });
      return m.ok ? { ok: true, holds: m.holds, link: encodeProofLink(m.proof), proof: m.proof } : m;
    },

    // the one pill Q surfaces when reconfirms fall due (null when nothing is due).
    async digestNotification() { return toNotification(await reconfirmDigest(ob)); },
  };
  return center;
}

// ── VIEW (browser) ───────────────────────────────────────────────────────────────────────────────────
const h = (tag, attrs = {}, kids = []) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === "class") e.className = v; else if (k === "html") e.innerHTML = v; else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v); else if (v != null) e.setAttribute(k, v); }
  for (const k of [].concat(kids)) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};
const fmtMoney = (b) => b ? new Intl.NumberFormat(undefined, { style: "currency", currency: b.ccy || "GBP" }).format(Number(b.amount)) : "—";
const UK_BANKS = [["uk-monzo", "Monzo"], ["uk-barclays", "Barclays"], ["uk-natwest", "NatWest"], ["uk-lloyds", "Lloyds"], ["uk-hsbc", "HSBC"], ["uk-revolut", "Revolut"], ["uk-starling", "Starling"]];

export function mountBankPanel(el, center, { notify, demo = false, toast = (m) => {} } = {}) {
  if (!el) return;
  const paint = async () => {
    const { accounts, due } = await center.model();
    el.replaceChildren();

    if (due && notify) try { notify(await center.digestNotification()); } catch {}

    if (due) {
      el.append(h("div", { class: "card", style: "border-color:var(--acc); display:flex; gap:.6rem; align-items:center; padding:.7rem 1rem; margin-bottom:.7rem" }, [
        h("div", { style: "flex:1; min-width:0" }, [
          h("b", {}, `Reconfirm ${due.count} bank ${due.count === 1 ? "connection" : "connections"}`),
          h("div", { class: "muted", style: "font-size:.85rem" }, `One quick check — no bank login needed.`),
        ]),
        h("button", { class: "btn", onclick: async () => { const r = await center.reconfirmDue(); toast(r.ok ? "Reconfirmed" : "Some reconfirms failed"); paint(); } }, due.count === 1 ? "Reconfirm" : "Reconfirm all"),
      ]));
    }

    if (!accounts.length) {
      el.append(h("div", { class: "card center", style: "padding:1.4rem; text-align:center" }, [
        h("div", { class: "muted", style: "margin-bottom:.8rem" }, "All your bank accounts, beside your crypto. Connect one — it'll roam to your other devices with no second sign-in."),
        h("button", { class: "btn", onclick: () => addFlow() }, "Connect a bank"),
      ]));
    } else {
      const list = h("div", { class: "card", style: "padding:.2rem 1rem" });
      for (const a of accounts) {
        list.append(h("div", { class: "row spread", style: "padding:.7rem 0; border-bottom:1px solid var(--line)" }, [
          h("div", { style: "min-width:0" }, [h("b", {}, a.bankName), h("div", { class: "muted", style: "font-size:.8rem" }, a.name || a.type || "Account")]),
          h("div", { class: "row", style: "gap:.5rem; align-items:center" }, [
            h("b", { class: "mono" }, fmtMoney(a.balance)),
            h("button", { class: "iconbtn", title: "Prove a balance threshold", onclick: () => proveFlow(a) }, "✦"),
            h("button", { class: "iconbtn", title: "Disconnect", onclick: async () => { await center.revoke(a.consent); toast("Disconnected"); paint(); } }, "✕"),
          ]),
        ]));
      }
      el.append(list);
      el.append(h("button", { class: "btn ghost wide", style: "margin-top:.7rem", onclick: () => addFlow() }, "＋ Connect another bank"));
    }
    if (demo) el.append(h("div", { class: "muted", style: "text-align:center; margin-top:.6rem; font-size:.78rem" }, "Demo data — live bank connections arrive with the aggregator adapter."));
  };

  const addFlow = async () => {
    let banks = null; try { banks = await center.institutions(); } catch {}
    if (!banks || !banks.length) banks = UK_BANKS.map(([id, name]) => ({ id, name }));   // demo fallback
    const pick = h("div", { class: "card", style: "padding:.8rem 1rem; margin-bottom:.7rem; max-height:22rem; overflow:auto" }, [h("div", { class: "muted", style: "margin-bottom:.5rem" }, "Choose your bank")]);
    for (const bk of banks) pick.append(h("button", { class: "btn ghost wide", style: "margin-bottom:.35rem; justify-content:flex-start", onclick: async () => {
      try {
        const { scaUrl, pendingRef } = await center.beginAdd(bk.id);
        if (demo) { const r = await center.completeAdd(pendingRef, { demo: true }, bk.id); if (!r.ok) toast(r.reason || "Could not connect"); paint(); }
        else { try { window.open(scaUrl, "_blank", "noopener"); } catch {} finishStep(bk, pendingRef); }   // real: SCA at the bank, then confirm
      } catch (e) { toast("Could not start: " + ((e && e.message) || e)); }
    } }, bk.name));
    el.replaceChildren(pick, h("button", { class: "btn ghost wide", onclick: () => paint() }, "Cancel"));
  };

  // real-connect step 2: the bank's SCA opened in a new tab; let the user confirm so we pull the account.
  const finishStep = (bk, pendingRef) => {
    el.replaceChildren(h("div", { class: "card", style: "padding:1rem" }, [
      h("b", {}, `Finish signing in to ${bk.name}`),
      h("div", { class: "muted", style: "margin:.4rem 0 .9rem; font-size:.85rem" }, "A tab opened at your bank. Approve access there, then come back and tap below."),
      h("div", { class: "row", style: "gap:.5rem" }, [
        h("button", { class: "btn", onclick: async () => {
          try { const r = await center.completeAdd(pendingRef, {}, bk.id); if (r && r.ok) { toast(`${bk.name} connected`); paint(); } else toast((r && r.reason) || "Not linked yet"); }
          catch (e) { toast(e && e.pending ? "Not linked yet — finish at your bank, then retry" : "Couldn't link: " + ((e && e.message) || e)); }
        } }, "I've connected — load my account"),
        h("button", { class: "btn ghost", onclick: () => paint() }, "Cancel"),
      ]),
    ]));
  };

  const proveFlow = async (a) => {
    const amt = h("input", { inputmode: "decimal", placeholder: "e.g. 2000", class: "mono", style: "margin:.4rem 0" });
    const out = h("div", { class: "muted", style: "font-size:.82rem; word-break:break-all; margin-top:.5rem" });
    const card = h("div", { class: "card", style: "padding:.9rem 1rem" }, [
      h("b", {}, `Prove ${a.bankName} balance is at least…`),
      amt,
      h("div", { class: "row", style: "gap:.5rem" }, [
        h("button", { class: "btn", onclick: async () => {
          const t = Number(amt.value); if (!(t > 0)) return toast("Enter an amount");
          const r = await center.prove({ accountId: a.accountId, consent: a.consent, ccy: (a.balance && a.balance.ccy) || "GBP", threshold: t });
          if (!r.ok) return out.textContent = r.reason || "Could not create proof";
          if (!r.holds) return out.textContent = "Your balance does not meet that threshold — no proof issued.";
          try { await navigator.clipboard.writeText(r.link); toast("Proof link copied"); } catch {}
          out.replaceChildren(h("div", {}, "Shareable proof link (reveals only the threshold, nothing else):"), h("a", { href: r.link, target: "_blank", class: "mono" }, r.link));
        } }, "Create link"),
        h("button", { class: "btn ghost", onclick: () => paint() }, "Done"),
      ]),
      out,
    ]);
    el.replaceChildren(card);
  };

  paint();
  return { refresh: paint };
}

// ── BROWSER CONVENIENCE: one call wires the real gate, step-up, store, relay/cipher, and renders. ───────
export async function mountBankCenter(el, { operator, credentialId, notify, aggregator, relay, cipher, store, now } = {}) {
  if (!operator) throw new Error("holo-bank: operator κ required");
  const demo = !aggregator;
  aggregator = aggregator || devAggregator();
  store = store || localStorageStore("holo.bank." + operator + ".");

  // the REAL biometric gate for grant/reconfirm/revoke (authority-class; batch reconfirms share one motion).
  const gate = async (a) => {
    const { enforce } = await import("./holo-stepup-gate.mjs");
    return enforce({ kind: a.kind, payload: a.payload, operator, reason: a.reason }, { credentialId });
  };
  // the REAL biometric for a disclosure — a fresh, verified step-up token bound to the predicate.
  const stepUp = async (a) => {
    const { requireStepUp } = await import("./holo-stepup.mjs");
    return requireStepUp({ kind: a.kind, payload: a.payload, operator, reason: a.reason }, { credentialId });
  };
  // roam transport: prefer the session's real E2E relay/cipher; fall back to same-origin for one-device dev.
  if (!relay || !cipher) { const t = await roamTransport(operator); relay = relay || t.relay; cipher = cipher || t.cipher; }
  const self = deviceSelf();

  const center = createBankCenter({ store, relay, cipher, gate, stepUp, operator, aggregator, self, now }).start();
  try { if (typeof window !== "undefined") window.HoloBank = center; } catch {}   // so the shell can route the reconfirm deep-link
  const view = mountBankPanel(el, center, { notify, demo, toast: (m) => { try { window.HoloNotify ? window.HoloNotify.toast(m) : 0; } catch {} } });
  return { center, view };
}

// a STABLE per-device id so roam can skip its own echoes (a user's devices share one operator κ).
function deviceSelf() {
  try { let id = localStorage.getItem("holo.bank.device"); if (!id) { id = "dev:" + b64uRandom(9); localStorage.setItem("holo.bank.device", id); } return id; } catch { return "dev:" + b64uRandom(9); }
}
function b64uRandom(n) { const u = crypto.getRandomValues(new Uint8Array(n)); return btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }

// a localStorage-backed store with the openbank key shape. (The access token is sensitive; in the shipped
// wallet this should be the same sealed store keys live in — swap this for that store when wiring real banks.)
export function localStorageStore(prefix) {
  const k = (s) => prefix + s;
  return {
    async keys() { const out = []; for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key && key.startsWith(prefix)) out.push(key.slice(prefix.length)); } return out; },
    async get(key) { const v = localStorage.getItem(k(key)); return v == null ? undefined : JSON.parse(v); },
    async set(key, val) { localStorage.setItem(k(key), JSON.stringify(val)); },
    async del(key) { localStorage.removeItem(k(key)); },
  };
}

// roam transport: real session relay + E2E pair cipher when available, else a same-origin BroadcastChannel
// shim + an operator-derived cipher (one-device dev only — NOT cross-device E2E; clearly the fallback).
async function roamTransport(operator) {
  let relay = (typeof window !== "undefined" && window.HoloRelay) || null;
  if (!relay) { const bc = new BroadcastChannel("holo-bank-roam"); relay = { publish: (t, m) => bc.postMessage({ t, m }), subscribe: (t, cb) => { const f = (e) => e.data && e.data.t === t && cb(e.data.m); bc.addEventListener("message", f); return () => bc.removeEventListener("message", f); } }; }
  let cipher = null;
  try { const s = await import("./holo-session.mjs"); if (s.makeCipher && s.pairKey) cipher = s.makeCipher(await s.pairKey()); } catch {}
  if (!cipher) {
    const SUB = crypto.subtle, te = new TextEncoder();
    const raw = (await SUB.digest("SHA-256", te.encode("holo-bank-roam:" + operator)));
    const key = await SUB.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    cipher = {
      seal: async (u8) => { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await SUB.encrypt({ name: "AES-GCM", iv }, key, u8)); const o = new Uint8Array(12 + ct.length); o.set(iv); o.set(ct, 12); return o; },
      open: async (u8) => { try { return new Uint8Array(await SUB.decrypt({ name: "AES-GCM", iv: u8.slice(0, 12) }, key, u8.slice(12))); } catch { return null; } },
    };
  }
  return { relay, cipher };
}

// a clearly-labelled DEV aggregator so the panel is alive before the real Yapily/TrueLayer adapter lands.
export function devAggregator() {
  let n = 0; const bal = {};
  return {
    id: "dev",
    beginConnect: async (bankId) => ({ scaUrl: "about:blank", pendingRef: bankId + ":" + (++n) }),
    completeConnect: async (pendingRef) => { const bankId = String(pendingRef).split(":")[0]; bal[bankId] = (1000 + Math.floor((n * 997) % 9000)); return { consentRef: "dev-" + (++n), token: "dev-tok-" + bankId }; },
    listAccounts: async (token) => { const bankId = String(token).replace("dev-tok-", ""); return [{ accountId: bankId + "-acc", name: "Current account", type: "CACC", ccy: "GBP" }]; },
    getBalance: async (token) => { const bankId = String(token).replace("dev-tok-", ""); return { amount: String(bal[bankId] || 1234), ccy: "GBP", asOf: new Date().toISOString() }; },
    getTransactions: async () => [],
    reconfirm: async () => ({ token: "dev-tok-re" }),
    revoke: async () => ({ ok: true }),
  };
}

// proxyAggregator(base) — the BROWSER side of a real connection. It implements the aggregator contract by
// calling holo-openbank-proxy (which holds the GoCardless secret server-side). The secret NEVER reaches here.
export function proxyAggregator(base) {
  const j = async (path, opts) => {
    const r = await fetch(base + path, { cache: "no-store", ...opts, headers: { "content-type": "application/json", ...(opts && opts.headers) } });
    let b = {}; try { b = await r.json(); } catch {}
    if (b && b.pending) { const e = new Error(b.error || "not linked yet"); e.pending = true; throw e; }
    if (!r.ok || (b && b.error)) { const e = new Error((b && b.error) || ("proxy " + r.status)); throw e; }
    return b;
  };
  return {
    id: "gocardless",
    institutions: (country = "gb") => j("/institutions?country=" + encodeURIComponent(country)),
    beginConnect: (institutionId) => j("/begin", { method: "POST", body: JSON.stringify({ institutionId }) }),
    completeConnect: (pendingRef) => j("/complete?ref=" + encodeURIComponent(pendingRef)),
    listAccounts: (token) => j("/accounts?token=" + encodeURIComponent(token)),
    getBalance: (token, accountId) => j("/balance?token=" + encodeURIComponent(token) + "&accountId=" + encodeURIComponent(accountId)),
    getTransactions: (token, accountId, o = {}) => j("/transactions?token=" + encodeURIComponent(token) + "&accountId=" + encodeURIComponent(accountId) + "&limit=" + (o.limit || 50)),
    reconfirm: () => { throw new Error("reconnect required (GoCardless free tier)"); },
    revoke: (consentRef, token) => j("/revoke", { method: "POST", body: JSON.stringify({ token: token || consentRef }) }),
  };
}

export default { createBankCenter, mountBankPanel, mountBankCenter, proxyAggregator };
