// Holo Money — the neobank surface of Hologram OS.
// One responsive column: the SAME app is the phone screen, the desktop right carriage
// (?panel=1, mounted by the shell like Holo Wallet), and a full-page holospace.
// Every number is real: balances/history/prices/quotes ride the sovereign wallet gate
// (/_shared/holo-wallet-bridge.js — keys never come here); money moves as Holo Pay
// κ-links or gated sends; cards are κ-objects with faces derived from their κ (cards.mjs).
// When the wallet is not reachable the UI says so — nothing is simulated.
// Verified grammar per HOLO-REVOLUT-PARITY-MATRIX.md: Move = Exchange (§2.2), send is
// recipient-first (§4.1), disposable cards re-mint their κ after every use (§3.2).

import { mintCard, renderFace, EDITIONS } from "./cards.mjs";
import { createKeypad, readout } from "./keypad.mjs";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ── environment: panel (desktop carriage) · mobile · full page ───── */
const params = new URLSearchParams(location.search);
const PANEL = params.get("panel") === "1";
const KIND = params.get("kind") || "open";
const isMobile = matchMedia("(max-width: 560px)").matches;
document.body.classList.add(PANEL ? "panel" : isMobile ? "mobile" : "page");

/* ── optional substrate modules (each degrades honestly if absent) ── */
const wallet = await import("../../_shared/holo-wallet-bridge.js").catch(() => null);
const pay = await import("../holo-messenger/holo-pay.mjs").catch(() => null);
const identity = await import("../self/holo-identity.mjs").catch(() => null);
const tee = await import("../holo-linux/holo-linux-tee.mjs").catch(() => null);
const words = await import("../../_shared/holo-words.mjs").catch(() => null);

const CHAINS = ["ethereum", "arbitrum", "solana", "bitcoin"];
const SYM = { ethereum: "ETH", arbitrum: "ETH", solana: "SOL", bitcoin: "BTC" };
const ASSETS = ["ETH", "SOL", "BTC", "USDC"];

/* ── local store — one namespace ──────────────────────────────────── */
const store = {
  key: "holo-money.v1",
  read() { try { return JSON.parse(localStorage.getItem(this.key)) || {}; } catch { return {}; } },
  write(patch) { const s = { ...this.read(), ...patch }; localStorage.setItem(this.key, JSON.stringify(s)); return s; },
};

const saved = store.read();
const state = {
  walletLive: false,
  accounts: [],                        // [{chain, amount, usd}]
  totalUsd: null,
  focus: null,                         // null = all accounts · "ethereum" = focused (§2.6)
  txs: [],
  cards: saved.cards || [],
  cardArchive: saved.cardArchive || [],// retired disposable faces (§3.2)
  links: saved.links || [],
  recipients: saved.recipients || [],  // [{id, name, kind: identity|address, value, chain?}]
  holder: saved.holder || "",
  sovereign: false,
  prices: {},                          // chain → usd (live)
  insights: [],                        // Q observations (computed, real)
  qDismissed: saved.qDismissed || {},
  splitMode: false,
  splitSel: new Set(),
};

/* ── wallet probe + reads (bounded — the bridge itself waits 30s) ─── */
const bounded = (p, ms = 3500) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
const num = (v) => { const n = typeof v === "object" && v ? (v.balance ?? v.value ?? v.amount ?? v.usd ?? v.price) : v; const f = parseFloat(n); return Number.isFinite(f) ? f : null; };

async function readWallet() {
  if (!wallet) return;
  try { await bounded(wallet.requestAddresses(), 3500); state.walletLive = true; } catch { state.walletLive = false; }
  if (!state.walletLive) { renderHome(); renderQLine(); return; }

  let prices = {};
  try { const p = await bounded(wallet.requestPrice(CHAINS), 6000); if (p && typeof p === "object") prices = p; } catch {}
  const px = (chain) => num(prices[chain]) ?? num(prices[SYM[chain]]);
  for (const c of CHAINS) { const v = px(c); if (v !== null) state.prices[c] = v; }

  state.accounts = [];
  await Promise.all(CHAINS.map(async (chain) => {
    try {
      const amount = num(await bounded(wallet.requestBalance(chain), 8000));
      if (amount === null) return;
      const p = px(chain);
      state.accounts.push({ chain, amount, usd: p !== null ? amount * p : null });
    } catch {}
  }));
  state.accounts.sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0));
  const usable = state.accounts.filter((a) => a.usd !== null);
  state.totalUsd = usable.length ? usable.reduce((s, a) => s + a.usd, 0) : null;
  renderHome();

  const txs = [];
  await Promise.all(CHAINS.map(async (chain) => {
    try {
      const h = await bounded(wallet.requestHistory(chain, 12), 9000);
      for (const t of Array.isArray(h) ? h : h?.items || h?.txs || []) {
        txs.push({
          chain,
          hash: t.hash || t.txid || t.signature || "",
          peer: t.to || t.from || t.counterparty || "",
          out: t.direction ? t.direction === "out" : !!t.to,
          amount: num(t.amount ?? t.value),
          ts: +new Date(t.ts ?? t.time ?? t.timestamp ?? t.blockTime ?? Date.now()),
        });
      }
    } catch {}
  }));
  state.txs = txs.sort((a, b) => b.ts - a.ts).slice(0, 60);
  checkDisposables();
  computeInsights();
  renderTxs(); renderStats(); renderQLine();
}

/* ── formatting ───────────────────────────────────────────────────── */
const fmtUsd = (v) => v === null ? "—" : "$" + v.toLocaleString("en-US", { maximumFractionDigits: v >= 100 ? 0 : 2 });
const fmtAmt = (v, chain) => v === null ? "—" : `${v.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${SYM[chain] || chain || ""}`;
const fmtTime = (ts) => new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
const short = (s, n = 10) => s && s.length > n ? s.slice(0, 6) + "…" + s.slice(-4) : s || "";
const dayKey = (ts) => new Date(ts).toDateString();
const dayLabel = (ts) => {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
};

/* balance roll-up — the Revolut number feel */
function rollBalance(el, to) {
  if (to === null) { el.textContent = "—"; return; }
  const from = parseFloat(el.dataset.v || "0") || 0;
  el.dataset.v = to;
  const t0 = performance.now(), dur = 700;
  (function tick(t) {
    const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmtUsd(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(tick);
  })(t0);
}

/* ── HOME (focus-aware: §2.6 one-tap account switching) ───────────── */
function focused() { return state.focus ? state.accounts.find((a) => a.chain === state.focus) : null; }

function renderHome() {
  const f = focused();
  $("#acct-lbl").innerHTML = f
    ? `${esc(f.chain[0].toUpperCase() + f.chain.slice(1))} · ${esc(SYM[f.chain])}`
    : `Personal · <span id="fiat-unit">USD</span>`;
  const bal = $("#balance");
  if (f) { bal.dataset.v = ""; bal.textContent = f.usd !== null ? fmtUsd(f.usd) : fmtAmt(f.amount, f.chain); }
  else rollBalance(bal, state.totalUsd ?? (state.walletLive ? null : 0));

  const ws = $("#wallet-state");
  if (!wallet) { ws.hidden = false; ws.innerHTML = "<b>Wallet bridge unavailable</b> — running outside the OS."; }
  else if (!state.walletLive) { ws.hidden = false; ws.innerHTML = "<b>Wallet locked or closed</b> — open Holo Wallet to see live balances."; }
  else ws.hidden = true;

  const acc = $("#accounts");
  const rows = [`
    <button class="acct-row ${state.focus === null ? "sel" : ""}" data-acct="">
      <span class="a-ic">Σ</span><span class="a-nm">All accounts</span>
      <span class="a-amt">${esc(fmtUsd(state.totalUsd))}</span>
    </button>`];
  for (const a of state.accounts) rows.push(`
    <button class="acct-row ${state.focus === a.chain ? "sel" : ""}" data-acct="${esc(a.chain)}">
      <span class="a-ic">${esc(SYM[a.chain])}</span>
      <span class="a-nm">${esc(a.chain)}</span>
      <span class="a-amt">${esc(fmtAmt(a.amount, a.chain))}<span class="a-fiat">${esc(fmtUsd(a.usd))}</span></span>
    </button>`);
  if (!state.accounts.length) rows.push(`<div class="acct-row" style="cursor:default"><span class="a-nm">${state.walletLive ? "No balances yet" : "Wallet offline"}</span></div>`);
  acc.innerHTML = rows.join("");
  $$("[data-acct]", acc).forEach((b) => b.onclick = () => {
    state.focus = b.dataset.acct || null;
    renderHome(); renderTxs(); publishContext("home");
  });

  const av = $("#avatar");
  av.textContent = ((state.holder || "").trim()[0] || "O").toUpperCase();
  av.title = state.holder || "Operator";
}

/* day-grouped, focus-filtered transactions (§2.7) */
function renderTxs() {
  const list = $("#tx-list");
  const txs = state.focus ? state.txs.filter((t) => t.chain === state.focus) : state.txs;
  if (!txs.length) {
    list.innerHTML = `<div class="empty">${state.walletLive ? "No activity yet — add money to begin." : "Activity appears when the wallet is open."}</div>`;
    $("#tx-all").hidden = true; return;
  }
  const hue = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const row = (t) => `
    <button class="tx" data-hash="${esc(t.hash)}">
      <span class="t-av" style="background:hsl(${hue(t.peer || t.hash)},45%,38%)">${esc((t.peer || "?").replace(/^0x/, "").slice(0, 2).toUpperCase())}</span>
      <span class="t-body"><span class="t-nm">${esc(short(t.peer) || "Transaction")}</span>
      <span class="t-sub">${esc(t.chain)} · ${esc(fmtTime(t.ts))}</span></span>
      <span class="t-amt ${t.out ? "" : "in"}">${t.out ? "−" : "+"}${esc(fmtAmt(t.amount, t.chain))}</span>
    </button>`;
  const grouped = (set) => {
    let out = "", lastDay = "";
    for (const t of set) {
      const k = dayKey(t.ts);
      if (k !== lastDay) { out += `<div class="tx-day">${esc(dayLabel(t.ts))}</div>`; lastDay = k; }
      out += row(t);
    }
    return out;
  };
  list.innerHTML = grouped(txs.slice(0, 6));
  const all = $("#tx-all");
  all.hidden = txs.length <= 6;
  all.onclick = () => { list.innerHTML = grouped(txs); all.hidden = true; wireTxRows(); };
  wireTxRows();
  function wireTxRows() {
    $$(".tx", list).forEach((b) => b.onclick = () => {
      const t = state.txs.find((x) => x.hash === b.dataset.hash); if (t) txSheet(t);
    });
  }
}

/* ── EXCHANGE (Move — §2.2, §5.1–5.4) ─────────────────────────────── */
const ex = { from: "ethereum", to: "solana", quote: null, seq: 0 };
let exPad = null;

function exBack() { showScreen(exReturn); }
let exReturn = "home";

function openExchange(from) {
  if (from) ex.from = from;
  if (ex.to === ex.from) ex.to = CHAINS.find((c) => c !== ex.from) || "solana";
  exReturn = "home";
  showScreen("exchange");
  if (!exPad) {
    exPad = createKeypad({ onChange: onExAmount });
    $("#ex-keypad").appendChild(exPad.el);
  }
  exPad.reset();
  renderExchange();
}

function renderExchange() {
  $("#ex-from-cur").textContent = SYM[ex.from] || ex.from;
  $("#ex-to-cur").textContent = SYM[ex.to] || ex.to;
  const bal = (chain) => {
    const a = state.accounts.find((x) => x.chain === chain);
    return a ? `Balance ${fmtAmt(a.amount, chain)}` : state.walletLive ? "No balance" : "";
  };
  $("#ex-from-bal").textContent = bal(ex.from);
  $("#ex-to-bal").textContent = bal(ex.to);
  const rate = $("#ex-rate");
  if (!wallet) rate.textContent = "Wallet bridge unavailable.";
  else if (!state.walletLive) { rate.className = "ex-rate bad"; rate.textContent = "Open Holo Wallet to see balances and trade."; }
  else { rate.className = "ex-rate"; rate.textContent = exPad?.number() ? rate.textContent : "Enter an amount to see the live rate"; }
  const go = $("#ex-go");
  go.textContent = `Sell ${SYM[ex.from]} for ${SYM[ex.to]}`;   // §5.4 sell grammar
  go.disabled = !(state.walletLive && exPad?.number() && ex.quote);
  onExAmount(exPad ? exPad.value() : "");
}

function onExAmount(v) {
  const amtEl = $("#ex-amt");
  amtEl.textContent = readout(v);
  amtEl.classList.toggle("zero", !v);
  const n = parseFloat(v);
  ex.quote = null; $("#ex-go").disabled = true;
  if (!Number.isFinite(n) || n <= 0 || !state.walletLive) { if (state.walletLive) $("#ex-rate").textContent = "Enter an amount to see the live rate"; return; }
  const seq = ++ex.seq;
  $("#ex-rate").className = "ex-rate"; $("#ex-rate").textContent = "…";
  clearTimeout(onExAmount._t);
  onExAmount._t = setTimeout(async () => {
    try {
      const q = await bounded(wallet.requestSwapQuote({ inputMint: ex.from, outputMint: ex.to, amount: n }), 12000);
      if (seq !== ex.seq) return;                        // stale — a newer keystroke owns the screen
      const outAmt = num(q?.outAmount ?? q?.out ?? q?.amount ?? q);
      if (outAmt === null) throw new Error("no quote");
      ex.quote = { in: n, out: outAmt };
      $("#ex-rate").textContent = `1 ${SYM[ex.from]} ≈ ${(outAmt / n).toLocaleString("en-US", { maximumFractionDigits: 6 })} ${SYM[ex.to]} · you get ${fmtAmt(outAmt, ex.to)}`;
      $("#ex-go").disabled = false;
    } catch {
      if (seq !== ex.seq) return;
      $("#ex-rate").className = "ex-rate bad";
      $("#ex-rate").textContent = "No live quote for this pair right now.";  // never invent a rate
    }
  }, 400);
}

function exConfirm() {
  if (!ex.quote) return;
  const guard = frozenGuard(ex.from); if (guard) return openSheet((el) => { el.innerHTML = guard; });
  openSheet((el) => {
    el.innerHTML = `<div class="grab"></div><h2>Review order</h2>
      <div class="cf-row"><span class="k">Sell</span><span class="v">${esc(fmtAmt(ex.quote.in, ex.from))}</span></div>
      <div class="cf-row"><span class="k">Buy (quoted)</span><span class="v">${esc(fmtAmt(ex.quote.out, ex.to))}</span></div>
      <div class="cf-row"><span class="k">Rate</span><span class="v">1 ${esc(SYM[ex.from])} ≈ ${esc((ex.quote.out / ex.quote.in).toLocaleString("en-US", { maximumFractionDigits: 6 }))} ${esc(SYM[ex.to])}</span></div>
      <div class="cf-row"><span class="k">Network fee</span><span class="v">shown in wallet approval</span></div>
      <p class="sheet-note">Holo Wallet gates this trade — approve with biometrics there. Keys never touch Holo Money.</p>
      <button class="cta" id="ex-do">Sell ${esc(SYM[ex.from])} for ${esc(SYM[ex.to])}</button>`;
    $("#ex-do").onclick = async () => {
      const btn = $("#ex-do"); btn.disabled = true; btn.textContent = "Waiting for wallet approval…";
      try {
        const fn = ex.from === "solana" || ex.to === "solana" ? "requestSwap" : "requestSwapEvm";
        const r = await (wallet[fn] || wallet.requestSwap)({ inputMint: ex.from, outputMint: ex.to, amount: ex.quote.in });
        el.innerHTML = `<div class="grab"></div><h2>Order placed ✓</h2><div class="addr">${esc(r?.hash || r?.signature || "submitted")}</div>`;
        exPad.reset(); readWallet();
      } catch (e) { btn.disabled = false; btn.textContent = `Sell ${SYM[ex.from]} for ${SYM[ex.to]}`; el.insertAdjacentHTML("beforeend", `<p class="sheet-note test">${esc(e.message)}</p>`); }
    };
  });
}

function exPickRow(side) {
  openSheet((el) => {
    el.innerHTML = `<div class="grab"></div><h2>${side === "from" ? "Sell from" : "Buy"}</h2>` +
      CHAINS.map((c) => {
        const a = state.accounts.find((x) => x.chain === c);
        return `<button class="acct-row" data-c="${c}" style="border-radius:12px">
          <span class="a-ic">${esc(SYM[c])}</span><span class="a-nm">${esc(c)}</span>
          <span class="a-amt">${a ? esc(fmtAmt(a.amount, c)) : ""}</span></button>`;
      }).join("");
    $$("[data-c]", el).forEach((b) => b.onclick = () => {
      const c = b.dataset.c;
      if (side === "from") { ex.from = c; if (ex.to === c) ex.to = CHAINS.find((x) => x !== c); }
      else { ex.to = c; if (ex.from === c) ex.from = CHAINS.find((x) => x !== c); }
      closeSheet(); renderExchange();
    });
  });
}

/* ── CARDS (§3.1–3.3) ─────────────────────────────────────────────── */
let cardIdx = 0;
function renderCards() {
  const rail = $("#card-rail");
  if (!state.cards.length) {
    rail.innerHTML = `<div class="empty" style="flex:1">No cards yet — mint your first. Each card is a κ-object; its face is derived from its κ.</div>`;
    $("#card-meta").innerHTML = ""; return;
  }
  rail.innerHTML = "";
  state.cards.forEach((card, i) => {
    const d = document.createElement("div");
    d.className = "card-face" + (card.frozen ? " frozen" : "");
    const cv = document.createElement("canvas");
    d.appendChild(cv);
    if (card.disposable) d.insertAdjacentHTML("beforeend", '<span class="cf-tag">DISPOSABLE</span>');
    rail.appendChild(d);
    renderFace(cv, card);
    d.onclick = () => { cardIdx = i; renderCardMeta(); d.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" }); };
    d.onpointermove = (e) => {
      const r = d.getBoundingClientRect();
      const rx = ((e.clientY - r.top) / r.height - 0.5) * -8, ry = ((e.clientX - r.left) / r.width - 0.5) * 10;
      d.style.transform = `perspective(700px) rotateX(${rx}deg) rotateY(${ry}deg)`;
    };
    d.onpointerleave = () => { d.style.transform = ""; };
  });
  renderCardMeta();
}

function renderCardMeta() {
  const card = state.cards[cardIdx]; const meta = $("#card-meta");
  if (!card) { meta.innerHTML = ""; return; }
  const archived = state.cardArchive.filter((a) => a.line === (card.line || card.kappa)).slice(-4).reverse();
  meta.innerHTML = `
    <div class="cm-row"><span class="k">Name</span><span class="v">${esc(card.label)}</span></div>
    <div class="cm-row"><span class="k">Type</span><span class="v">${card.disposable ? "Disposable — new key after every use" : "Virtual"}</span></div>
    <div class="cm-row"><span class="k">Edition</span><span class="v">${esc(EDITIONS[card.edition]?.name || card.edition)}</span></div>
    <div class="cm-row"><span class="k">Chain</span><span class="v">${esc(card.chain)}</span></div>
    <div class="cm-row"><span class="k">Address</span><span class="v">${esc(card.address || "unbound (wallet was offline at mint)")}</span></div>
    <div class="cm-row"><span class="k">κ</span><span class="v">${esc(card.kappa)}</span></div>
    <div class="cm-actions">
      <button class="ghost" id="cm-freeze">${card.frozen ? "Unfreeze" : "Freeze"}</button>
      <button class="ghost" id="cm-copy">Copy address</button>
    </div>
    ${card.frozen ? '<p class="cm-note">Frozen in Holo Money — sends and trades from this account are refused here. Vault-level freeze coming.</p>' : ""}
    ${archived.length ? `<div class="cm-archive"><h3>Spent faces</h3>${archived.map((a) => `
      <div class="arch-row"><canvas data-k="${esc(a.kappa)}" data-ed="${esc(a.edition)}"></canvas><span>κ ${esc(a.kappa.slice(0, 16))}… · retired ${esc(new Date(a.retiredAt).toLocaleDateString())}</span></div>`).join("")}</div>` : ""}`;
  // archived mini-faces re-derive from their κ — same math, same face, forever
  $$(".cm-archive canvas", meta).forEach((cv) => renderFace(cv, { kappa: cv.dataset.k, edition: cv.dataset.ed, label: "retired", holder: state.holder }));
  $("#cm-freeze").onclick = () => { card.frozen = !card.frozen; store.write({ cards: state.cards }); renderCards(); };
  $("#cm-copy").onclick = async (e) => {
    try { await navigator.clipboard.writeText(card.address || card.kappa); e.target.textContent = "Copied ✓"; setTimeout(() => (e.target.textContent = "Copy address"), 1200); } catch {}
  };
}

async function mintFlow(sheetEl, { holder, onDone }) {
  let edition = "standard", type = "virtual";
  const editionsHtml = Object.entries(EDITIONS).map(([id, ed]) => `
    <div class="ed ${id === edition ? "sel" : ""} ${ed.locked && !state.sovereign ? "locked" : ""}" data-ed="${id}">
      <canvas></canvas><span class="ed-nm">${esc(ed.name)}</span>${ed.locked && !state.sovereign ? '<span class="ed-lock">🔒 TEE</span>' : ""}
    </div>`).join("");
  sheetEl.innerHTML = `
    <div class="grab"></div><h2>Get card</h2>
    <label>Type</label>
    <div class="type-row">
      <button class="type-opt sel" data-type="virtual"><b>Virtual</b><span>A named spend/receive handle, yours until you retire it.</span></button>
      <button class="type-opt" data-type="disposable"><b>Disposable</b><span>New details after every use — it's a new key each time.</span></button>
    </div>
    <label>Card name</label><input id="mint-nm" placeholder="Everyday" maxlength="24" />
    <label>Edition</label><div class="editions">${editionsHtml}</div>
    <label>Chain</label><select id="mint-ch">${CHAINS.map((c) => `<option>${c}</option>`).join("")}</select>
    <p class="sheet-note">A card is a receive/spend handle bound to a wallet address. Spending is always gated by Holo Wallet — biometric on every send.</p>
    <button class="cta" id="mint-go">Mint card</button>`;
  $$(".type-opt", sheetEl).forEach((b) => b.onclick = () => {
    type = b.dataset.type;
    $$(".type-opt", sheetEl).forEach((x) => x.classList.toggle("sel", x === b));
  });
  for (const el of $$(".ed", sheetEl)) {
    const prev = await mintCard({ edition: el.dataset.ed, label: "Preview", holder: holder || "You", address: "" });
    renderFace($("canvas", el), prev);
    el.onclick = () => {
      if (el.classList.contains("locked")) return;
      edition = el.dataset.ed;
      $$(".ed", sheetEl).forEach((x) => x.classList.toggle("sel", x === el));
    };
  }
  $("#mint-go").onclick = async () => {
    const btn = $("#mint-go"); btn.disabled = true; btn.textContent = "Minting…";
    const chain = $("#mint-ch").value;
    let address = "";
    if (state.walletLive) { try { const a = await bounded(wallet.requestAddress(chain), 8000); address = a?.address || (typeof a === "string" ? a : ""); } catch {} }
    const card = await mintCard({ chain, address, label: $("#mint-nm").value.trim() || (type === "disposable" ? "Disposable" : "Everyday"), edition, holder: holder || state.holder || "Operator" });
    if (type === "disposable") { card.disposable = true; card.line = card.kappa; card.mintedAt = Date.now(); card.uses = 0; }
    state.cards.push(card); store.write({ cards: state.cards });
    cardIdx = state.cards.length - 1;
    onDone(card);
  };
}

/* disposable κ-remint (§3.2): after a spend on its chain, or after 24h, the card
   retires its κ (archived) and mints a fresh one — new key, new face, same line. */
async function checkDisposables() {
  let changed = false;
  for (let i = 0; i < state.cards.length; i++) {
    const card = state.cards[i];
    if (!card.disposable) continue;
    const born = card.remintedAt || card.mintedAt || card.created;
    const spent = state.txs.some((t) => t.out && t.chain === card.chain && t.ts > born);
    const stale = Date.now() - born > 24 * 3600 * 1000;
    if (!spent && !stale) continue;
    state.cardArchive.push({ line: card.line || card.kappa, kappa: card.kappa, edition: card.edition, retiredAt: Date.now(), reason: spent ? "used" : "24h" });
    const fresh = await mintCard({ chain: card.chain, address: card.address, label: card.label, edition: card.edition, holder: card.holder });
    Object.assign(fresh, { disposable: true, line: card.line || card.kappa, mintedAt: card.mintedAt, remintedAt: Date.now(), uses: (card.uses || 0) + (spent ? 1 : 0), frozen: card.frozen });
    state.cards[i] = fresh;
    changed = true;
  }
  if (changed) {
    state.cardArchive = state.cardArchive.slice(-40);
    store.write({ cards: state.cards, cardArchive: state.cardArchive });
    if ($("#scr-cards").classList.contains("on")) renderCards();
  }
}

/* freeze guard (§3.3, honest tier): a frozen card bound to this chain blocks
   Money-side origination. Enforcement is local — say exactly that. */
function frozenGuard(chain) {
  const f = state.cards.find((c) => c.frozen && c.chain === chain);
  if (!f) return null;
  return `<div class="grab"></div><h2>Card frozen</h2>
    <p class="sheet-note">“${esc(f.label)}” is frozen, and it's bound to your ${esc(chain)} account — sends and trades from it are refused in Holo Money. Unfreeze it on the Cards screen to continue.</p>
    <p class="sheet-note">Frozen in Holo Money — vault-level freeze coming.</p>`;
}

/* ── PAYMENTS — recipient-first (§4.1–4.6) ────────────────────────── */
function classifyRecipient(input) {
  const v = input.trim();
  if (!v) return null;
  if (/^[0-9a-f]{64}$/i.test(v)) return { kind: "identity", value: v, hint: "κ ✓" };
  if (/^0x[0-9a-fA-F]{40}$/.test(v)) return { kind: "address", value: v, chain: "ethereum", hint: "address ✓" };
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) return { kind: "address", value: v, chain: "solana", hint: "address ✓" };
  if (/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(v)) return { kind: "address", value: v, chain: "bitcoin", hint: "address ✓" };
  if (/^[a-z]+\.[a-z]+\.[a-z]+$/.test(v)) return { kind: "identity", value: v, hint: "three words ✓" };
  return null;
}

async function loadRoster() {
  // messenger roster — identities you already talk to (real, not imagined)
  try {
    if (!identity?.roster) return [];
    const r = await bounded(identity.roster(), 3000);
    return (r || []).map((p) => ({ id: "id:" + p.kappa, name: p.label || "Operator", kind: "identity", value: p.kappa }));
  } catch { return []; }
}
let roster = [];

function renderPayments() {
  const list = $("#rcp-list");
  const q = ($("#rcp-filter").value || "").toLowerCase();
  const match = (r) => !q || r.name.toLowerCase().includes(q) || String(r.value).toLowerCase().includes(q);
  const hue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const row = (r) => `
    <button class="rcp ${state.splitSel.has(r.id) ? "checked" : ""}" data-id="${esc(r.id)}">
      <span class="r-av" style="background:hsl(${hue(r.value)},45%,42%)">${esc((r.name || "?")[0].toUpperCase())}</span>
      <span class="r-body"><span class="r-nm">${esc(r.name)}</span><span class="r-sub">${esc(r.kind === "identity" ? "κ " + short(r.value) : (r.chain || "") + " " + short(r.value))}</span></span>
    </button>`;
  const savedR = state.recipients.filter(match);
  const rosterR = roster.filter((r) => match(r) && !state.recipients.some((s) => s.value === r.value));
  let html = "";
  // a pasted destination IS a recipient — one tap to money (§4.5); rendered HERE so
  // any re-render (e.g. the async roster load) keeps it alive
  const det = classifyRecipient($("#rcp-filter").value || "");
  $("#rcp-hint").textContent = det ? det.hint : "";
  if (det && !state.splitMode) html += `<div class="rcp-sec">Detected</div>
    <button class="rcp" id="rcp-direct">
      <span class="r-av" style="background:var(--hm-accent)">→</span>
      <span class="r-body"><span class="r-nm">Send to this ${det.kind === "identity" ? "identity" : "address"}</span><span class="r-sub">${esc(short(det.value, 20))}</span></span>
    </button>`;
  if (state.splitMode) html += `<div class="rcp-sec">Pick people to split with — ${state.splitSel.size} selected</div>`;
  if (savedR.length) html += `<div class="rcp-sec">Saved</div>` + savedR.map(row).join("");
  if (rosterR.length) html += `<div class="rcp-sec">From Messenger</div>` + rosterR.map(row).join("");
  if (!savedR.length && !rosterR.length) html += `<div class="empty">${q ? "No one matches — paste a κ, three words, or an address above." : "No recipients yet. Add one with ＋, or paste any address above."}</div>`;
  list.innerHTML = html;
  $("#split-btn").textContent = state.splitMode ? (state.splitSel.size ? `Split with ${state.splitSel.size} →` : "Cancel split") : "Split a bill";
  if (det && !state.splitMode) $("#rcp-direct").onclick = () => sendFlow({ id: "direct", name: short(det.value), ...det });
  $$("[data-id]", list).forEach((b) => b.onclick = () => {
    const r = [...state.recipients, ...roster].find((x) => x.id === b.dataset.id);
    if (!r) return;
    if (state.splitMode) {
      state.splitSel.has(r.id) ? state.splitSel.delete(r.id) : state.splitSel.add(r.id);
      renderPayments();   // the header button becomes "Split with N →" — the sheet opens on demand, not mid-selection
    } else sendFlow(r);
  });
  renderLinks();
}

function rcpFilterInput() { renderPayments(); }

function addRecipientSheet() {
  openSheet((el) => {
    el.innerHTML = `<div class="grab"></div><h2>New recipient</h2>
      <label>Name</label><input id="nr-nm" placeholder="Who is this?" maxlength="32" />
      <label>Destination — κ, three words, or address</label><input id="nr-v" placeholder="κ / word.word.word / 0x…" autocomplete="off" />
      <p class="sheet-note" id="nr-hint"></p>
      <button class="cta" id="nr-go" disabled>Save recipient</button>`;
    const check = () => {
      const c = classifyRecipient($("#nr-v").value);
      $("#nr-hint").textContent = c ? `Recognized: ${c.hint}` : ($("#nr-v").value.trim() ? "Not a κ, three-words name, or known address format." : "");
      $("#nr-go").disabled = !c;
    };
    $("#nr-v").oninput = check;
    $("#nr-go").onclick = () => {
      const c = classifyRecipient($("#nr-v").value);
      if (!c) return;
      const name = $("#nr-nm").value.trim() || short(c.value);
      state.recipients.push({ id: "r:" + c.value, name, ...c });
      store.write({ recipients: state.recipients });
      closeSheet(); renderPayments();
    };
  });
}

/* recipient → keypad → confirm (§4.1–4.4) */
function sendFlow(r, { verb = "send" } = {}) {
  openSheet((el) => {
    let asset = r.chain ? SYM[r.chain] : "USDC";
    const pad = createKeypad({ onChange: (v) => {
      const a = $(".sheet-amt", el); a.textContent = readout(v); a.classList.toggle("zero", !v);
      $("#sf-next", el).disabled = !(parseFloat(v) > 0);
    }});
    el.innerHTML = `<div class="grab"></div><h2>${verb === "send" ? "Send to" : "Request from"} ${esc(r.name)}</h2>
      <div class="sheet-amt zero">0</div>
      <div class="sheet-sub"><select id="sf-asset" style="width:auto;min-height:32px;padding:2px 10px;border-radius:999px">${ASSETS.map((a) => `<option ${a === asset ? "selected" : ""}>${a}</option>`).join("")}</select></div>
      <div id="sf-pad"></div>
      <button class="cta" id="sf-next" disabled>Continue</button>`;
    $("#sf-pad", el).appendChild(pad.el);
    $("#sf-asset", el).onchange = (e) => { asset = e.target.value; };
    $("#sf-next", el).onclick = () => confirmSend(r, pad.number(), asset, verb, el);
  });
}

function confirmSend(r, amount, asset, verb, el) {
  if (!amount) return;
  const direct = verb === "send" && r.kind === "address" && state.walletLive && r.chain;
  if (direct) { const g = frozenGuard(r.chain); if (g) { el.innerHTML = g; return; } }
  el.innerHTML = `<div class="grab"></div><h2>${verb === "send" ? "Send" : "Request"} ${esc(amount)} ${esc(asset)}</h2>
    <div class="cf-row"><span class="k">To</span><span class="v">${esc(r.name)} · ${esc(short(r.value, 16))}</span></div>
    <div class="cf-row"><span class="k">Fee</span><span class="v">${direct ? "network fee shown in wallet approval" : "No fee. It's your key."}</span></div>
    <div class="cf-row"><span class="k">Arrives</span><span class="v">${direct ? "when the network confirms" : "when they claim the link"}</span></div>
    <label>Note</label><input id="cf-memo" placeholder="What's it for?" maxlength="80" />
    ${direct ? '<p class="sheet-note">Holo Wallet gates this send — approve with biometrics there.</p>'
             : '<p class="sheet-note">This mints a signed κ-link — the link IS the ' + (verb === "send" ? "payment" : "request") + '. It lands in your links list and on your clipboard; paste it anywhere. <span class="test">Settlement is testnet escrow unless the wallet funds an HTLC.</span></p>'}
    <button class="cta" id="cf-go">${direct ? "Send via wallet" : "Create κ-link"}</button>`;
  $("#cf-go").onclick = async () => {
    const btn = $("#cf-go"); btn.disabled = true; btn.textContent = direct ? "Waiting for wallet approval…" : "Sealing…";
    try {
      if (direct) {
        const res = await wallet.requestSend(r.chain, r.value, amount);
        el.innerHTML = `<div class="grab"></div><h2>Sent ✓</h2><div class="addr">${esc(res?.hash || "submitted")}</div>`;
        readWallet();
      } else {
        const intent = await pay.createPayment({
          kind: verb === "send" ? "send" : "request", amount, asset,
          toName: r.name, memo: $("#cf-memo").value.trim(),
          fromName: state.holder || "Operator", signer: await paySigner(),
        });
        const url = pay.buildLink(intent, { origin: location.origin }).https;
        state.links.push({ kind: intent.kind, amount, asset, memo: intent.memo, toName: r.name, created: Date.now(), expires: intent.expires || null, url, kappa: intent.kappa });
        store.write({ links: state.links });
        try { await navigator.clipboard.writeText(url); } catch {}
        el.innerHTML = `<div class="grab"></div><h2>Link sealed ✓</h2>
          <div class="addr">${esc(url)}</div>
          <p class="sheet-note">Copied to clipboard. Anyone with this link can ${intent.kind === "send" ? "claim it" : "pay it"} — in any browser.</p>`;
        renderPayments(); computeInsights(); renderQLine();
      }
    } catch (e) { btn.disabled = false; btn.textContent = direct ? "Send via wallet" : "Create κ-link"; el.insertAdjacentHTML("beforeend", `<p class="sheet-note test">${esc(e.message)}</p>`); }
  };
}

/* split bill (§4.6): N request-links from one sheet; one κ-batch = the bill */
function splitFooter() {
  const sel = [...state.splitSel].map((id) => [...state.recipients, ...roster].find((r) => r.id === id)).filter(Boolean);
  if (!sel.length) return;
  openSheet((el) => {
    const pad = createKeypad({ onChange: (v) => {
      const a = $(".sheet-amt", el); a.textContent = readout(v); a.classList.toggle("zero", !v);
      const n = parseFloat(v);
      $(".sheet-sub", el).textContent = n > 0 ? `${sel.length} people · ${(n / sel.length).toLocaleString("en-US", { maximumFractionDigits: 2 })} each` : "";
      $("#sp-go", el).disabled = !(n > 0);
    }});
    el.innerHTML = `<div class="grab"></div><h2>Split a bill</h2>
      <div class="sheet-amt zero">0</div><div class="sheet-sub"></div>
      <div id="sp-pad"></div>
      <label>What for</label><input id="sp-memo" placeholder="Dinner" maxlength="60" />
      <button class="cta" id="sp-go" disabled>Create ${sel.length} request links</button>`;
    $("#sp-pad", el).appendChild(pad.el);
    $("#sp-go").onclick = async () => {
      const total = pad.number(); if (!total) return;
      const each = Math.round((total / sel.length) * 100) / 100;
      const memo = $("#sp-memo").value.trim() || "Split bill";
      const btn = $("#sp-go"); btn.disabled = true; btn.textContent = "Sealing…";
      try {
        const made = [];
        for (const r of sel) {
          const intent = await pay.createPayment({
            kind: "request", amount: each, asset: "USDC", toName: r.name,
            memo: `${memo} — your share of ${total}`, fromName: state.holder || "Operator", signer: await paySigner(),
          });
          const url = pay.buildLink(intent, { origin: location.origin }).https;
          made.push({ r, url, kappa: intent.kappa });
          state.links.push({ kind: "request", amount: each, asset: "USDC", memo, toName: r.name, created: Date.now(), expires: intent.expires || null, url, kappa: intent.kappa, bill: memo });
        }
        store.write({ links: state.links });
        el.innerHTML = `<div class="grab"></div><h2>${made.length} links sealed ✓</h2>` + made.map((m) => `
          <div class="cf-row"><span class="k">${esc(m.r.name)}</span><button class="cta-sm" data-url="${esc(m.url)}">Copy link</button></div>`).join("") +
          `<p class="sheet-note">Each link is a signed request for ${esc(each)} USDC. They claim in any browser — no Hologram needed.</p>`;
        $$("[data-url]", el).forEach((b) => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.url); b.textContent = "Copied ✓"; } catch {} });
        state.splitMode = false; state.splitSel.clear();
        renderPayments(); computeInsights(); renderQLine();
      } catch (e) { btn.disabled = false; btn.textContent = `Create ${sel.length} request links`; el.insertAdjacentHTML("beforeend", `<p class="sheet-note test">${esc(e.message)}</p>`); }
    };
  });
}

let _signer = null;
async function paySigner() { if (!_signer && pay) _signer = await pay.createSigner(); return _signer; }

function renderLinks() {
  const box = $("#pay-links");
  if (!state.links.length) { box.innerHTML = ""; return; }
  box.innerHTML = `<div class="rcp-sec">Your links</div>` + state.links.slice(-8).reverse().map((l) => `
    <div class="pl-row">
      <span class="t-body"><span class="t-nm">${l.kind === "send" ? "Send" : "Request"} · ${esc(l.amount)} ${esc(l.asset)}${l.toName ? " · " + esc(l.toName) : ""}</span>
      <span class="t-sub">${esc(l.memo || "")}</span></span>
      <button class="cta-sm" data-url="${esc(l.url)}">Copy</button>
    </div>`).join("");
  $$("[data-url]", box).forEach((b) => b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.url); b.textContent = "Copied ✓"; setTimeout(() => (b.textContent = "Copy"), 1200); } catch {}
  });
}

/* ── quick-action sheets ──────────────────────────────────────────── */
function addMoneySheet() {
  openSheet(async (el) => {
    el.innerHTML = `<div class="grab"></div><h2>Add money</h2>
      <label>Chain</label><select id="add-ch">${CHAINS.map((c) => `<option ${state.focus === c ? "selected" : ""}>${c}</option>`).join("")}</select>
      <label>Your address</label><div class="addr" id="add-addr">${state.walletLive ? "…" : "Wallet offline — open Holo Wallet first."}</div>
      <button class="cta" id="add-copy" ${state.walletLive ? "" : "disabled"}>Copy address</button>
      <p class="sheet-note">Send to this address from any wallet or exchange. It lands in YOUR vault — Holo Money never holds funds.</p>`;
    const load = async () => {
      if (!state.walletLive) return;
      $("#add-addr").textContent = "…";
      try { const a = await bounded(wallet.requestAddress($("#add-ch").value), 8000); $("#add-addr").textContent = a?.address || (typeof a === "string" ? a : "unavailable"); }
      catch { $("#add-addr").textContent = "unavailable (wallet closed?)"; }
    };
    $("#add-ch").onchange = load; load();
    $("#add-copy").onclick = async (e) => { try { await navigator.clipboard.writeText($("#add-addr").textContent); e.target.textContent = "Copied ✓"; } catch {} };
  });
}

/* More → add to your money (§2.3, honest set) */
function addProductsSheet() {
  const held = new Set(state.accounts.map((a) => a.chain));
  const addable = CHAINS.filter((c) => !held.has(c));
  openSheet((el) => {
    el.innerHTML = `<div class="grab"></div><h2>Add to your money</h2>
      ${addable.length ? `<div class="rcp-sec">Accounts</div>` + addable.map((c) => `
        <button class="acct-row" data-add-acct="${c}" style="border-radius:12px"><span class="a-ic">${esc(SYM[c])}</span><span class="a-nm">${esc(c)} account</span><span class="a-amt">→</span></button>`).join("") : ""}
      <div class="rcp-sec">Cards</div>
      <button class="acct-row" id="ap-card" style="border-radius:12px"><span class="a-ic">▭</span><span class="a-nm">New card</span><span class="a-amt">→</span></button>
      <div class="rcp-sec">Banks</div>
      <div class="empty" style="padding:14px">Connecting bank accounts (open banking) isn't wired yet — it will appear here when it's real.</div>`;
    $$("[data-add-acct]", el).forEach((b) => b.onclick = () => { closeSheet(); addMoneySheet(); setTimeout(() => { const s = $("#add-ch"); if (s) { s.value = b.dataset.addAcct; s.dispatchEvent(new Event("change")); } }, 60); });
    $("#ap-card").onclick = () => { closeSheet(); showScreen("cards"); openSheet((e2) => mintFlow(e2, { holder: state.holder, onDone: () => { closeSheet(); renderCards(); } })); };
  });
}

function txSheet(t) {
  openSheet((el) => {
    el.innerHTML = `<div class="grab"></div><h2>${t.out ? "Sent" : "Received"} ${esc(fmtAmt(t.amount, t.chain))}</h2>
      <div class="cm-row"><span class="k">Chain</span><span class="v">${esc(t.chain)}</span></div>
      <div class="cm-row"><span class="k">Counterparty</span><span class="v">${esc(t.peer || "—")}</span></div>
      <div class="cm-row"><span class="k">When</span><span class="v">${esc(dayLabel(t.ts))} ${esc(fmtTime(t.ts))}</span></div>
      <div class="cm-row"><span class="k">Hash</span><span class="v">${esc(t.hash || "—")}</span></div>`;
  });
}

function detailsSheet() {
  openSheet((el) => {
    el.innerHTML = `<div class="grab"></div><h2>Details</h2>
      <div class="cm-row"><span class="k">Operator</span><span class="v">${esc(state.holder || "Operator")}</span></div>
      <div class="cm-row"><span class="k">Wallet</span><span class="v">${state.walletLive ? "live" : "offline"}</span></div>
      <div class="cm-row"><span class="k">TEE sovereign</span><span class="v">${state.sovereign ? "yes" : "no"}</span></div>
      <div class="cm-row"><span class="k">Cards</span><span class="v">${state.cards.length}</span></div>
      <div class="cm-row"><span class="k">Recipients</span><span class="v">${state.recipients.length}</span></div>
      <div class="cm-row"><span class="k">Surface</span><span class="v">${PANEL ? "desktop carriage" : isMobile ? "mobile" : "page"}</span></div>
      <button class="ghost" id="dt-wallet" style="width:100%;margin-top:14px">Open Holo Wallet</button>`;
    $("#dt-wallet").onclick = () => { try { parent.postMessage({ type: "holo-identity", action: "open-wallet" }, location.origin); } catch {} };
  });
}

/* ── STATS ────────────────────────────────────────────────────────── */
function renderStats() {
  const body = $("#stats-body");
  const out = state.txs.filter((t) => t.out && t.amount !== null);
  if (!out.length) { body.innerHTML = `<div class="empty">No outgoing activity yet — spending analytics build from your real on-chain history.</div>`; return; }
  const byMonth = new Map();
  for (const t of out) {
    const k = new Date(t.ts).toLocaleDateString(undefined, { month: "short" });
    byMonth.set(k, (byMonth.get(k) || 0) + (t.amount || 0));
  }
  const max = Math.max(...byMonth.values());
  body.innerHTML = `<div class="bars">${[...byMonth].map(([m, v]) =>
    `<div class="bar"><i style="height:${Math.max(6, (v / max) * 100)}%"></i><span>${esc(m)}</span></div>`).join("")}</div>
    <p class="stat-note">Native units summed per month across chains — an honest first cut. Fiat-weighted categories arrive with price history.</p>`;
}

/* ── Q — three real observations, one quiet line (WS6) ────────────── */
function computeInsights() {
  const ins = [];
  const now = Date.now();
  // 1 · open / expiring links (real: our own sealed intents)
  const open = state.links.filter((l) => l.kind === "send" || l.kind === "request");
  const expiring = open.filter((l) => l.expires && l.expires - now < 24 * 3600 * 1000 && l.expires > now);
  if (open.length) ins.push({
    id: "links:" + open.length + ":" + expiring.length,
    text: `${open.length} payment link${open.length > 1 ? "s" : ""} still open${expiring.length ? ` — ${expiring.length} expire${expiring.length > 1 ? "" : "s"} within a day` : ""}.`,
    door: "payments",
  });
  // 2 · price move ≥5% vs last seen (real: wallet prices, persisted baseline)
  const lastPrices = store.read().lastPrices || {};
  for (const [chain, p] of Object.entries(state.prices)) {
    const prev = lastPrices[chain];
    if (prev && prev > 0) {
      const delta = ((p - prev) / prev) * 100;
      if (Math.abs(delta) >= 5) ins.push({
        id: `rate:${chain}:${delta > 0 ? "up" : "dn"}:${Math.round(Math.abs(delta))}`,
        text: `${SYM[chain]} moved ${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}% since you last looked.`,
        door: "exchange",
      });
    }
  }
  if (Object.keys(state.prices).length) store.write({ lastPrices: { ...lastPrices, ...state.prices } });
  // 3 · recurring counterparty (real: ≥3 outgoing to same peer in 30 days, not saved yet)
  const cutoff = now - 30 * 24 * 3600 * 1000;
  const byPeer = new Map();
  for (const t of state.txs) if (t.out && t.peer && t.ts > cutoff) byPeer.set(t.peer, (byPeer.get(t.peer) || 0) + 1);
  for (const [peer, n] of byPeer) {
    if (n >= 3 && !state.recipients.some((r) => r.value === peer)) {
      ins.push({ id: "recur:" + peer, text: `${n} sends to ${short(peer)} this month — save them as a recipient?`, door: "payments", prefill: peer });
      break;   // one is enough; Q is quiet
    }
  }
  state.insights = ins.filter((i) => !state.qDismissed[i.id]);
  // share with Q's cadence letter (messenger reads the same store, same origin)
  store.write({ insights: state.insights.map(({ id, text, door }) => ({ id, text, door, ts: now })) });
}

function renderQLine() {
  const el = $("#q-line");
  const i = state.insights[0];
  if (!i) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<span class="q-orb"></span><span class="q-txt">${esc(i.text)}</span><button class="q-x" aria-label="Dismiss">✕</button>`;
  $(".q-txt", el).onclick = () => {
    if (i.door === "exchange") openExchange();
    else showScreen(i.door);
    if (i.prefill) setTimeout(() => { const f = $("#rcp-filter"); if (f) { f.value = i.prefill; rcpFilterInput(); } }, 80);
  };
  $(".q-x", el).onclick = () => {
    state.qDismissed[i.id] = Date.now();
    store.write({ qDismissed: state.qDismissed });
    state.insights.shift(); renderQLine();
  };
}

/* ── sheet + navigation plumbing ──────────────────────────────────── */
function openSheet(fill) {
  const sheet = $("#sheet"), card = $("#sheet-card");
  sheet.hidden = false; fill(card);
  sheet.onclick = (e) => { if (e.target === sheet) closeSheet(); };
}
function closeSheet() { $("#sheet").hidden = true; $("#sheet-card").innerHTML = ""; }

function showScreen(name) {
  $$(".screen").forEach((s) => s.classList.toggle("on", s.id === "scr-" + name));
  $$("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.scr === name));
  if (name === "cards") renderCards();
  if (name === "payments") { renderPayments(); if (!roster.length) loadRoster().then((r) => { roster = r; renderPayments(); }); }
  if (name === "stats") renderStats();
  if (name === "exchange") renderExchange();
  publishContext(name);
}

/* ── Q context — expose live state so Q can see what you see ──────── */
function publishContext(screen = "home") {
  const ctx = {
    app: "holo-money", screen,
    walletLive: state.walletLive, totalUsd: state.totalUsd, focus: state.focus,
    accounts: state.accounts.length, cards: state.cards.length,
    pendingLinks: state.links.length,
    insights: state.insights.length,
  };
  if (screen === "exchange") Object.assign(ctx, { from: ex.from, to: ex.to, rate: ex.quote ? ex.quote.out / ex.quote.in : null });
  if (screen === "payments") Object.assign(ctx, { recipients: state.recipients.length + roster.length, expiringSoon: state.links.filter((l) => l.expires && l.expires - Date.now() < 24 * 3600 * 1000).length });
  if (screen === "cards") Object.assign(ctx, { frozen: state.cards.filter((c) => c.frozen).length, disposableActive: state.cards.filter((c) => c.disposable).length });
  try { if (window.HoloQ) window.HoloQ.qFocusContext = ctx; } catch {}
  try { parent.postMessage({ type: "holo-money", action: "context", ctx }, location.origin); } catch {}
}

/* ── onboarding — the TEE IS the KYC; every step demos a feature ──── */
async function maybeOnboard() {
  if (store.read().onboarded || params.get("guest") === "1") return;
  const ob = $("#onboard"); ob.hidden = false;

  let rosterLabel = "";
  try { const r = identity ? await identity.roster() : []; rosterLabel = r?.[0]?.label || ""; } catch {}
  try { state.sovereign = !!(tee && await tee.teeAvailable()); } catch {}

  const step = (html) => new Promise((done) => {
    ob.innerHTML = html;
    ob.querySelector("[data-next]")?.addEventListener("click", () => done("next"));
    ob.querySelector("[data-skip]")?.addEventListener("click", () => done("skip"));
    ob._done = done;
  });

  const r1 = await step(`<div class="ob"><h1>Ready to change the way you money?</h1>
    <p>Real balances. Money as links. Cards that are math, not plastic.</p></div>
    <div class="ob-foot"><button class="cta" data-next>Begin</button>
    <button class="ob-skip" data-skip>Skip for now</button></div>`);
  if (r1 === "skip") return finish();

  await step(`<div class="ob"><h1>You are the bank.</h1>
    <p>No account number — your identity is a key you hold. ${rosterLabel ? "Welcome back," : "Name your operator."}</p>
    <div class="ob-badges">
      <span class="badge ${rosterLabel ? "ok" : ""}">${rosterLabel ? "Identity: " + esc(rosterLabel) : "New operator"}</span>
      <span class="badge ${state.sovereign ? "ok" : ""}">${state.sovereign ? "TEE: sovereign device" : "TEE: not detected"}</span>
      <span class="badge ${state.walletLive ? "ok" : ""}">${state.walletLive ? "Wallet: live" : "Wallet: closed"}</span>
    </div>
    <input id="ob-nm" placeholder="Your name" value="${esc(rosterLabel)}" maxlength="24" /></div>
    <div class="ob-foot"><button class="cta" data-next>Continue</button></div>`);
  state.holder = ($("#ob-nm")?.value || rosterLabel || "Operator").trim() || "Operator";
  store.write({ holder: state.holder });

  ob.innerHTML = `<div class="ob"><h1>Pick your first card.</h1>
    <p>The face is derived from the card's κ — yours is one of a kind.</p>
    <div class="editions"></div><div class="ob-kappa"></div></div>
    <div class="ob-foot"><button class="cta" id="ob-mint">Mint it</button>
    <button class="ob-skip" data-skip>Later</button></div>`;
  let chosen = "standard";
  const edBox = $(".editions", ob);
  for (const [id, ed] of Object.entries(EDITIONS)) {
    if (ed.locked && !state.sovereign) continue;
    const d = document.createElement("div");
    d.className = "ed" + (id === chosen ? " sel" : ""); d.dataset.ed = id;
    d.innerHTML = `<canvas></canvas><span class="ed-nm">${esc(ed.name)}</span>`;
    edBox.appendChild(d);
    const prev = await mintCard({ edition: id, label: "First card", holder: state.holder });
    renderFace($("canvas", d), prev);
    $(".ob-kappa", ob).textContent = "κ " + prev.kappa;
    d.onclick = () => { chosen = id; $$(".ed", edBox).forEach((x) => x.classList.toggle("sel", x === d)); };
  }
  await new Promise((done) => {
    ob.querySelector("[data-skip]").onclick = () => done();
    $("#ob-mint").onclick = async () => {
      let address = "";
      if (state.walletLive) { try { const a = await bounded(wallet.requestAddress("ethereum"), 8000); address = a?.address || (typeof a === "string" ? a : ""); } catch {} }
      const card = await mintCard({ chain: "ethereum", address, label: "First card", edition: chosen, holder: state.holder });
      state.cards.push(card); store.write({ cards: state.cards });
      done();
    };
  });
  finish();

  function finish() {
    store.write({ onboarded: true }); ob.hidden = true; ob.innerHTML = "";
    renderHome();
    // §10.4 — land like Revolut lands
    const lbl = $("#acct-lbl");
    if (lbl && !focused()) { lbl.textContent = "Your money's new home"; setTimeout(() => renderHome(), 2600); }
  }
}

/* ── wire + boot ──────────────────────────────────────────────────── */
$$("#tabs button").forEach((b) => (b.onclick = () => showScreen(b.dataset.scr)));
$("#stats-ic").onclick = () => showScreen("stats");
$("#cards-ic").onclick = () => showScreen("cards");           // §2.5
$("#accounts-pill").onclick = (e) => {
  const acc = $("#accounts"); acc.hidden = !acc.hidden;
  e.target.setAttribute("aria-expanded", String(!acc.hidden));
};
$("#avatar").onclick = detailsSheet;
$$(".quick button").forEach((b) => (b.onclick = () => {
  ({ add: addMoneySheet,
     move: () => openExchange(state.focus || undefined),      // §2.2 Move = Exchange
     details: detailsSheet,
     more: addProductsSheet })[b.dataset.act]?.();            // §2.3
}));
$("#card-add").onclick = () => openSheet((el) => mintFlow(el, { holder: state.holder, onDone: () => { closeSheet(); renderCards(); } }));
$("[data-back]").onclick = exBack;
$("#ex-swap").onclick = () => { [ex.from, ex.to] = [ex.to, ex.from]; ex.quote = null; renderExchange(); };
$("#ex-from").onclick = () => exPickRow("from");
$("#ex-to").onclick = () => exPickRow("to");
$("#ex-go").onclick = exConfirm;
$("#rcp-filter").oninput = rcpFilterInput;
$("#rcp-add").onclick = addRecipientSheet;
$("#split-btn").onclick = () => {
  if (state.splitMode && state.splitSel.size) return splitFooter();   // "Split with N →"
  state.splitMode = !state.splitMode;
  if (!state.splitMode) state.splitSel.clear();
  renderPayments();
};
addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

renderHome(); renderTxs();
if (KIND === "pay" || KIND === "request") showScreen("payments");
if (KIND === "card") showScreen("cards");
if (KIND === "exchange") openExchange();
maybeOnboard();
readWallet();
computeInsights(); renderQLine();
publishContext();
$("#app").removeAttribute("aria-busy");
