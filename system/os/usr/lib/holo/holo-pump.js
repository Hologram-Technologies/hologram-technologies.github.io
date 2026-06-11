// holo-pump.js — the creator-coin engine for Holo Stream (pump.fun, hologram-native).
//
// Drop-in classic script: <script src="_shared/holo-pump.js"></script> → window.HoloPump
// (also self-exposes in Node, so the pure curve math + ledger replay are witnessed for real).
//
// pump.fun lets a creator launch a coin in one click; viewers trade it on a BONDING CURVE
// (price rises as it is bought), and the CREATOR EARNS A FEE ON EVERY TRADE — so a streamer
// earns from their broadcast through their affiliated coin. At a market-cap threshold the curve
// "graduates". This is faithful to pump.fun's MODEL, realized UOR-native (the user's choice):
//   • identities are real ed25519 + base58 (Solana-native, like _shared/holo-solana.js) —
//     every trade is SIGNED and verified by re-derivation (Law 5);
//   • the curve is a deterministic constant-product virtual-reserves AMM (pump.fun's curve);
//   • the LEDGER is a content-addressed, hash-linked log of signed trade events that REPLAYS
//     to balances + reserves + creator earnings — so the whole market re-derives from content
//     (no chain, no server). Settlement is on the UOR substrate, not real SOL (stated honestly).
//
// No DOM is touched at import; the curve math + ledger replay are pure (run in the witness).

(function () {
  "use strict";

  // ── pump.fun bonding curve (canonical virtual-reserves constant product) ────────────
  // Token amounts in whole tokens; SOL amounts in SOL. k = vSol·vToken is invariant across
  // a trade; price = vSol/vToken; the real-token reserve caps supply sold before graduation.
  const CURVE = {
    TOTAL_SUPPLY: 1_000_000_000,        // 1B tokens
    VIRT_TOKEN0: 1_073_000_000,         // initial virtual token reserve
    VIRT_SOL0: 30,                      // initial virtual SOL reserve
    REAL_TOKEN0: 793_100_000,           // real tokens available on the curve
    GRADUATE_SOL: 85,                   // curve completes (~$69k mcap) → graduate
    GRADUATE_BONUS: 0.5,                // SOL paid to the creator on graduation (pump.fun)
    FEE_BPS: 100,                       // 1% trade fee
    CREATOR_BPS: 100,                   // …all of which goes to the creator (earn from streaming)
  };
  const K = CURVE.VIRT_SOL0 * CURVE.VIRT_TOKEN0;

  function freshState() {
    return { vSol: CURVE.VIRT_SOL0, vToken: CURVE.VIRT_TOKEN0, realTokenLeft: CURVE.REAL_TOKEN0,
      solRaised: 0, soldTokens: 0, graduated: false };
  }
  const price = (s) => s.vSol / s.vToken;                          // SOL per token
  const marketCap = (s) => price(s) * CURVE.TOTAL_SUPPLY;          // SOL
  const progress = (s) => Math.min(1, s.solRaised / CURVE.GRADUATE_SOL);
  const feeOf = (sol) => sol * (CURVE.FEE_BPS / 10000);
  const creatorCut = (fee) => fee * (CURVE.CREATOR_BPS / 10000);

  // buy: spend `solIn` SOL → tokens out (after fee). Pure: returns the delta + the next state.
  function buyQuote(state, solIn) {
    const s = { ...state }; solIn = Math.max(0, +solIn || 0);
    const fee = feeOf(solIn), tradeSol = solIn - fee;
    const newVSol = s.vSol + tradeSol, newVToken = K / newVSol;
    let tokensOut = s.vToken - newVToken;
    let graduates = false;
    if (tokensOut >= s.realTokenLeft) { tokensOut = s.realTokenLeft; graduates = true; }
    s.vSol = s.vToken === 0 ? newVSol : s.vSol + tradeSol;
    s.vToken = s.vToken - tokensOut;
    s.realTokenLeft -= tokensOut; s.soldTokens += tokensOut; s.solRaised += tradeSol;
    if (graduates || s.solRaised >= CURVE.GRADUATE_SOL || s.realTokenLeft <= 1e-9) s.graduated = true;
    return { tokensOut, solIn, fee, creatorFee: creatorCut(fee), state: s, graduated: s.graduated };
  }
  // sell: return `tokensIn` tokens → SOL out (after fee).
  function sellQuote(state, tokensIn) {
    const s = { ...state }; tokensIn = Math.max(0, +tokensIn || 0);
    const newVToken = s.vToken + tokensIn, newVSol = K / newVToken;
    const grossSol = s.vSol - newVSol, fee = feeOf(grossSol), solOut = grossSol - fee;
    s.vToken = newVToken; s.vSol = newVSol;
    s.realTokenLeft += tokensIn; s.soldTokens -= tokensIn; s.solRaised = Math.max(0, s.solRaised - grossSol);
    return { tokensIn, solOut, grossSol, fee, creatorFee: creatorCut(fee), state: s };
  }

  // ── base58 (Solana address encoding — matches _shared/holo-solana.js bs58enc) ────────
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  function bs58enc(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let zeros = 0; while (zeros < u8.length && u8[zeros] === 0) zeros++;
    const digits = [0];
    for (let i = zeros; i < u8.length; i++) { let c = u8[i];
      for (let j = 0; j < digits.length; j++) { c += digits[j] << 8; digits[j] = c % 58; c = (c / 58) | 0; }
      while (c) { digits.push(c % 58); c = (c / 58) | 0; } }
    let out = ""; for (let i = 0; i < zeros; i++) out += "1";
    for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
    return out;
  }

  // ── ed25519 identities (WebCrypto Ed25519 — the Solana primitive; works browser + Node 22) ──
  const subtle = () => (globalThis.crypto && globalThis.crypto.subtle) || null;
  async function keypair() {
    const kp = await subtle().generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const pub = new Uint8Array(await subtle().exportKey("raw", kp.publicKey));
    return { priv: kp.privateKey, pub, address: bs58enc(pub) };
  }
  async function importPub(pub) { return subtle().importKey("raw", pub instanceof Uint8Array ? pub : new Uint8Array(pub), { name: "Ed25519" }, false, ["verify"]); }
  const utf8 = (s) => (typeof TextEncoder !== "undefined" ? new TextEncoder().encode(s) : Uint8Array.from(Buffer.from(s, "utf8")));
  async function sign(priv, msg) { const sig = new Uint8Array(await subtle().sign({ name: "Ed25519" }, priv, msg instanceof Uint8Array ? msg : utf8(msg))); return sig; }
  async function verify(pub, sig, msg) { try { const key = await importPub(pub); return await subtle().verify({ name: "Ed25519" }, key, sig instanceof Uint8Array ? sig : new Uint8Array(sig), msg instanceof Uint8Array ? msg : utf8(msg)); } catch { return false; } }
  const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
  async function kappa(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const sub = subtle(); if (sub) return "sha256:" + hex(new Uint8Array(await sub.digest("SHA-256", u8)));
    const { createHash } = require("crypto"); return "sha256:" + createHash("sha256").update(Buffer.from(u8)).digest("hex");
  }

  // canonical bytes for a trade (what the trader SIGNS — order-independent, stable)
  function tradeMessage(ev) { return utf8(stable({ v: 1, coin: ev.coin, type: ev.type, trader: ev.trader, sol: round9(ev.sol), tokens: round9(ev.tokens), seq: ev.seq, prev: ev.prev || "" })); }
  const round9 = (n) => Math.round((+n || 0) * 1e9) / 1e9;
  function stable(x) { if (x === null || typeof x !== "object") return JSON.stringify(x); if (Array.isArray(x)) return "[" + x.map(stable).join(",") + "]"; const k = Object.keys(x).sort(); return "{" + k.map((kk) => JSON.stringify(kk) + ":" + stable(x[kk])).join(",") + "}"; }

  // ── the coin + its content-addressed, hash-linked, signed-trade LEDGER (CvRDT-friendly) ──
  // A coin's market state is a pure function of its ORDERED signed events, so it re-derives
  // from content (Law 2/5). Events arrive over the relay (holo-collab) and replay here.
  class Coin {
    constructor(meta) {
      this.meta = meta || {};               // {name, ticker, image(κ), description, creator, channel, createdAt}
      this.id = meta && meta.id || "";       // content address of the coin metadata
      this.events = [];                      // ordered signed trade events
      this._seen = new Set();
      this.reset();
    }
    reset() { this.state = freshState(); this.balances = new Map(); this.creatorEarnings = 0; this.lastKappa = ""; }
    quoteBuy(solIn) { return buyQuote(this.state, solIn); }
    quoteSell(tokensIn) { return sellQuote(this.state, tokensIn); }

    // create a SIGNED trade event from a keypair (does not mutate until added/replayed)
    async makeTrade(kp, type, amount) {
      const seq = this.events.length;
      const q = type === "buy" ? buyQuote(this.state, amount) : sellQuote(this.state, amount);
      const ev = { v: 1, coin: this.id, type, trader: kp.address, _pub: Array.from(kp.pub),
        sol: type === "buy" ? q.solIn : q.solOut, tokens: type === "buy" ? q.tokensOut : q.tokensIn,
        seq, prev: this.lastKappa, ts: Date.now() };
      const sig = await sign(kp.priv, tradeMessage(ev)); ev.sig = bs58enc(sig);
      ev.kappa = await kappa(tradeMessage(ev));
      return ev;
    }

    // add an event (local or from a peer); verifies signature + curve consistency, then replays it.
    async add(ev) {
      if (!ev || this._seen.has(ev.kappa)) return false;
      const ok = await this._verifyEvent(ev); if (!ok) return false;
      this._seen.add(ev.kappa); this.events.push(ev); this._applyOne(ev); return true;
    }
    async _verifyEvent(ev) {
      try {
        if (ev.type !== "buy" && ev.type !== "sell") return false;
        const pub = ev._pub ? new Uint8Array(ev._pub) : null; if (!pub) return false;
        if (bs58enc(pub) !== ev.trader) return false;                       // address binds to pubkey
        const goodSig = await verify(pub, bs58decToBytes(ev.sig), tradeMessage(ev)); // ed25519 (Law 5)
        if (!goodSig) return false;
        // curve consistency: the signed amounts must match the quote at this point in the log
        const q = ev.type === "buy" ? buyQuote(this.state, ev.sol) : sellQuote(this.state, ev.tokens);
        const want = ev.type === "buy" ? q.tokensOut : q.solOut;
        const got = ev.type === "buy" ? ev.tokens : ev.sol;
        return Math.abs(want - got) <= Math.max(1e-6, Math.abs(want) * 1e-6);
      } catch { return false; }
    }
    _applyOne(ev) {
      const q = ev.type === "buy" ? buyQuote(this.state, ev.sol) : sellQuote(this.state, ev.tokens);
      this.state = q.state; this.creatorEarnings += q.creatorFee;
      const bal = this.balances.get(ev.trader) || 0;
      this.balances.set(ev.trader, bal + (ev.type === "buy" ? ev.tokens : -ev.tokens));
      if (this.state.graduated && !this._gradPaid) { this.creatorEarnings += CURVE.GRADUATE_BONUS; this._gradPaid = true; }
      this.lastKappa = ev.kappa;
    }
    // full re-derivation (Law 5): replay the WHOLE signed log from scratch; tamper ⇒ rejected.
    async rederive() {
      const evs = this.events.slice(); this.events = []; this._seen.clear(); this._gradPaid = false; this.reset();
      let added = 0; for (const ev of evs) { if (await this.add(ev)) added++; }
      return { events: added, total: evs.length, state: this.state, earnings: this.creatorEarnings };
    }
    balanceOf(addr) { return this.balances.get(addr) || 0; }
    holders() { return [...this.balances.entries()].filter(([, v]) => v > 1e-9).map(([address, tokens]) => ({ address, tokens })).sort((a, b) => b.tokens - a.tokens); }
    price() { return price(this.state); } marketCap() { return marketCap(this.state); } progress() { return progress(this.state); }
  }
  function bs58decToBytes(str) {
    const d = [0]; for (const ch of String(str)) { const v = B58.indexOf(ch); if (v < 0) return new Uint8Array(); let c = v; for (let i = 0; i < d.length; i++) { c += d[i] * 58; d[i] = c & 0xff; c >>= 8; } while (c) { d.push(c & 0xff); c >>= 8; } }
    let zeros = 0; for (const ch of String(str)) { if (ch === "1") zeros++; else break; }
    return new Uint8Array([...new Array(zeros).fill(0), ...d.reverse()]);
  }

  async function createCoin(meta) {
    const m = { v: 1, name: meta.name || "Coin", ticker: (meta.ticker || "COIN").toUpperCase().slice(0, 8),
      image: meta.image || "", description: meta.description || "", creator: meta.creator || "", channel: meta.channel || "", createdAt: meta.createdAt || Date.now() };
    m.id = await kappa(utf8(stable(m)));                              // coin id = content address
    return new Coin(m);
  }

  const HoloPump = {
    CURVE, K, freshState, price, marketCap, progress, buyQuote, sellQuote, feeOf, creatorCut,
    keypair, sign, verify, bs58enc, bs58dec: bs58decToBytes, kappa, tradeMessage, stable,
    Coin, createCoin, version: 1,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = HoloPump;
  if (typeof self !== "undefined") self.HoloPump = HoloPump;
  if (typeof window !== "undefined") window.HoloPump = HoloPump;
})();
