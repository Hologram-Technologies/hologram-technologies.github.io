// holo-hypercore.js — Hyperliquid HyperCore (the perps L1) source.
//
// HyperCore is not a block explorer — it's a high-performance on-chain order-book
// exchange. So its "explorer" is a markets terminal: perp/spot markets with mark price,
// funding, open interest and 24h volume; per-market order books + the live trade
// firehose; and per-account positions + fills. Addresses are Ethereum-style (0x), so
// they content-address the same way; trades/fills carry tx hashes (holo://0x…). Data is
// the official Info API (api.hyperliquid.xyz/info), CORS-enabled, key-less.
// (HyperEVM — Hyperliquid's EVM chain, id 999 — is already integrated separately.)

export class HyperCore {
  constructor(info = "https://api.hyperliquid.xyz/info") { this.url = info; this.api = info; }
  async post(body, { signal } = {}) {
    const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 15000); const onAb = () => ac.abort(); if (signal) signal.addEventListener("abort", onAb, { once: true });
    try { const r = await fetch(this.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ac.signal }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.json(); }
    catch (e) { if (e.name === "AbortError") throw new Error("request timed out"); throw e; } finally { clearTimeout(to); if (signal) signal.removeEventListener("abort", onAb); }
  }
  // perp markets: universe (names) zipped with asset contexts (prices/funding/OI/volume)
  async markets(o) {
    const r = await this.post({ type: "metaAndAssetCtxs" }, o); const meta = r[0], ctx = r[1];
    return meta.universe.map((u, i) => { const c = ctx[i] || {}; const mark = +c.markPx || 0, prev = +c.prevDayPx || 0;
      return { coin: u.name, maxLeverage: u.maxLeverage, szDecimals: u.szDecimals, markPx: mark, midPx: +c.midPx || mark, oraclePx: +c.oraclePx || 0,
        prevDayPx: prev, change24h: prev ? (mark - prev) / prev * 100 : 0, funding: +c.funding || 0, openInterest: +c.openInterest || 0, dayNtlVlm: +c.dayNtlVlm || 0, premium: +c.premium || 0 };
    }).sort((a, b) => b.dayNtlVlm - a.dayNtlVlm);
  }
  allMids(o) { return this.post({ type: "allMids" }, o); }
  l2Book(coin, o) { return this.post({ type: "l2Book", coin }, o); }
  recentTrades(coin, o) { return this.post({ type: "recentTrades", coin }, o); }
  userState(addr, o) { return this.post({ type: "clearinghouseState", user: addr }, o); }
  userFills(addr, o) { return this.post({ type: "userFills", user: addr }, o); }
  async marketCtx(coin, o) { const ms = await this.markets(o); return ms.find((m) => m.coin.toLowerCase() === coin.toLowerCase()); }
}
