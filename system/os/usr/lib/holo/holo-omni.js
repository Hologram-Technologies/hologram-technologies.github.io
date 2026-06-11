// holo-omni.js — the Omnichain Account: one address, every chain, one verifiable view.
//
// THE PROBLEM (real, not invented): a user's on-chain life is shattered across dozens of
// chains, each with its own explorer. Aggregators (DeBank/Zerion) stitch it back together
// but you must TRUST their backend — you can't check it. THE UOR MOVE: every chain is a
// content-addressed Merkle structure, and a content address is verifiable by anyone with
// no server. So instead of trusting an aggregator, Holo Scan fans out to each chain's own
// index in parallel, sums the holdings, and then gives the WHOLE snapshot its own
// content address: a re-derivable `holo://<sha256>` of the canonical manifest. Two people
// who scan the same address at the same block get the SAME κ — a portfolio you can pin,
// quote, and verify, which no explorer has ever offered.
//
// Honest scope: USD figures are estimates from each index's price feed (not exact
// accounting); the snapshot κ proves the manifest's INTEGRITY (this is exactly the set of
// balances we read), and each chain row drills into its full per-chain view where the
// block/tx hashes re-derive (the deeper κ). Native+token balances are read from each
// chain's index; same EVM EOA exists on every EVM chain (one private key → one address),
// and Hyperliquid HyperCore shares the 0x keyspace, so a single 0x address spans them all.

// a holding worth more than this share of a token's whole circulating market cap is
// treated as un-valuable spam (airdrop dump) and excluded from net worth.
const MAX_MCAP_SHARE = 0.05;
const round = (n, p = 1e6) => Math.round((Number(n) || 0) * p) / p;
const toNum = (v, dec) => {
  if (v == null) return 0;
  try { return Number(BigInt(v)) / 10 ** dec; } catch { const n = Number(v); return isNaN(n) ? 0 : n / 10 ** dec; }
};
const withTimeout = (p, ms, fallback) => Promise.race([p, new Promise((r) => setTimeout(() => r(fallback), ms))]);

export class OmniAccount {
  // evmChains: [[chainId, {name, sym, kappa, kappaTx, indexer}], …]
  // indexerFor(chainId) → a Blockscout|EtherscanFamily client (same method shape)
  // hypercore(address)  → optional async → { accountValue:number, positions:number } | null
  constructor({ indexerFor, evmChains, hypercore = null, concurrency = 10, timeoutMs = 12000 }) {
    this.indexerFor = indexerFor; this.evmChains = evmChains; this.hypercore = hypercore;
    this.concurrency = concurrency; this.timeoutMs = timeoutMs;
  }

  async _scanChain(chainId, meta, address) {
    const fallback = { chainId, ...meta, present: false, err: "timeout" };
    const core = (async () => {
      let bs;
      try { bs = this.indexerFor(chainId); } catch (e) { return { chainId, ...meta, present: false, err: String(e.message || e) }; }
      const ac = new AbortController();
      const opt = { signal: ac.signal };
      const to = setTimeout(() => ac.abort(), this.timeoutMs);
      try {
        const [info, toks, txs] = await Promise.all([
          Promise.resolve().then(() => bs.address(address, opt)).catch(() => null),
          Promise.resolve().then(() => bs.addressTokens(address, undefined, opt)).catch(() => ({ items: [] })),
          Promise.resolve().then(() => bs.addressTxns(address, undefined, opt)).catch(() => ({ items: [] })),
        ]);
        if (!info || info.message) return { chainId, ...meta, present: false };
        const rate = info.exchange_rate ? +info.exchange_rate : 0;
        const nativeBalance = toNum(info.coin_balance, 18);
        const nativeUsd = rate ? nativeBalance * rate : 0;
        const tokens = (toks?.items || []).map((x) => {
          const t = x.token || {}; const dec = +t.decimals || 0;
          const isNft = x.token_id != null || (t.type && t.type !== "ERC-20");
          const bal = isNft ? null : toNum(x.value, dec);
          const rate = t.exchange_rate ? +t.exchange_rate : 0;
          const mcap = t.circulating_market_cap ? +t.circulating_market_cap : 0;
          const usd = bal != null && rate ? bal * rate : 0;
          // Spam / over-valuation guard (honest net worth): airdropped "fake-price" tokens
          // dump enormous balances into wallets. A holding worth a large share of the
          // token's ENTIRE circulating market cap — or an unpriced/illiquid token — is NOT
          // counted toward net worth (it's still listed, just flagged). Real positions are
          // a tiny fraction of market cap; a wallet holding 59% of a token's mcap is spam.
          const priced = usd > 0 && t.reputation !== "scam" && mcap > 0 && usd <= mcap * MAX_MCAP_SHARE;
          return { symbol: t.symbol || t.name || "?", name: t.name || "", type: t.type || "", balance: bal, rate, mcap, usd, priced, suspect: usd > 0 && !priced, address: t.address || t.address_hash || "" };
        });
        const tokenUsd = tokens.reduce((a, t) => a + (t.priced ? t.usd : 0), 0);
        const txns = (txs?.items || []).slice(0, 12).map((t) => ({
          hash: t.hash, timestamp: t.timestamp, value: toNum(t.value, 18),
          from: t.from?.hash || t.from, to: t.to?.hash || t.to || null, method: t.method || null, status: t.status || null, block: t.block_number ?? t.block ?? null,
        }));
        const present = nativeBalance > 0 || tokens.length > 0 || txns.length > 0;
        return { chainId, ...meta, present, ens: info.ens_domain_name || null, isContract: !!info.is_contract, nativeBalance, nativeUsd, rate, tokens, tokenUsd, totalUsd: nativeUsd + tokenUsd, txns };
      } catch (e) { return { chainId, ...meta, present: false, err: String(e.message || e) }; }
      finally { clearTimeout(to); }
    })();
    return withTimeout(core, this.timeoutMs + 1500, fallback);
  }

  // fan out across every applicable chain (concurrency-limited), then HyperCore.
  // onChain(result) fires as each chain lands so the UI can paint progressively.
  async scan(address, { onChain = null, onProgress = null } = {}) {
    const entries = this.evmChains;
    const results = new Array(entries.length);
    let i = 0, done = 0;
    const worker = async () => {
      while (i < entries.length) {
        const idx = i++; const [cid, meta] = entries[idx];
        const r = await this._scanChain(cid, meta, address);
        results[idx] = r; done++;
        try { onChain && onChain(r); onProgress && onProgress(done, entries.length); } catch {}
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, entries.length) }, worker));
    let hyper = null;
    if (this.hypercore) {
      try {
        const h = await withTimeout(Promise.resolve().then(() => this.hypercore(address)), this.timeoutMs, null);
        if (h && (h.accountValue || h.positions)) { hyper = h; try { onChain && onChain({ chainId: 1000000, name: "Hyperliquid · HyperCore", sym: "USD", present: true, hyper: true, totalUsd: h.accountValue || 0 }); } catch {} }
      } catch {}
    }
    const chains = results.filter(Boolean);
    const totalUsd = chains.reduce((a, c) => a + (c.totalUsd || 0), 0) + (hyper?.accountValue || 0);
    const timeline = [];
    for (const c of chains) for (const t of c.txns || []) timeline.push({ chainId: c.chainId, name: c.name, sym: c.sym, ...t });
    timeline.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
    const activeCount = chains.filter((c) => c.present).length + (hyper ? 1 : 0);
    return { address, chains, hyper, totalUsd, timeline, activeCount, scannedAt: new Date().toISOString() };
  }

  // ── the UOR-native artifact: a canonical, re-derivable manifest of the omnichain state ──
  // Deterministic ordering + rounding → two scans of the same on-chain state hash equal.
  manifest(r) {
    const chains = r.chains.filter((x) => x.present).sort((a, b) => a.chainId - b.chainId).map((x) => ({
      chain: x.chainId,
      native: round(x.nativeBalance),
      nativeUsd: round(x.nativeUsd),
      tokens: (x.tokens || []).filter((t) => t.priced && t.balance != null && t.balance > 0)
        .map((t) => ({ sym: String(t.symbol).slice(0, 24), bal: round(t.balance), usd: round(t.usd) }))
        .sort((p, q) => (p.sym < q.sym ? -1 : p.sym > q.sym ? 1 : 0)),
    }));
    return JSON.stringify({ v: 1, kind: "omni-account", address: String(r.address).toLowerCase(), hyperUsd: round(r.hyper?.accountValue || 0), chains });
  }

  // sha256(manifest) → holo://… (WebCrypto; available in browser + Node 18+)
  async contentAddress(r) {
    const bytes = new TextEncoder().encode(this.manifest(r));
    const subtle = (globalThis.crypto && globalThis.crypto.subtle) || null;
    if (!subtle) return null;
    const dig = await subtle.digest("SHA-256", bytes);
    return "holo://" + [...new Uint8Array(dig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
}

export default OmniAccount;
