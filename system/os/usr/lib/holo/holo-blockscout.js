// holo-blockscout.js — a typed client for the Blockscout REST API v2.
//
// Blockscout (github.com/blockscout/blockscout) is the open-source block explorer; its
// API v2 is the INDEXER that makes an Etherscan-identical experience possible in the
// browser — complete paginated history, token holdings, NFTs, holders, verified
// contract source + ABI, internal txns, stats, charts, instant search, and human-readable
// transaction action summaries — all real on-chain data, no simulation, CORS-enabled,
// no API key. Holo Etherscan pairs this with _shared/holo-eth.js, which independently
// RE-DERIVES every block/tx hash from raw consensus bytes (keccak256/RLP, Law L5) so the
// indexer's JSON is content-verified, not merely trusted (the ✓ κ badge).
//
// Every method returns parsed JSON; list endpoints return { items, next_page_params }
// (cursor pagination — pass next_page_params straight back to fetch the next page).

// Real Blockscout instances (multi-chain, all live). api = REST v2 base; rpc = a public
// node for κ re-derivation + live tip. Ethereum mainnet is the default.
// `ws` is an OPEN, key-less public-node WebSocket for the real-time push layer
// (newHeads + full newPendingTransactions); publicnode is a public good (Allnodes).
// `wss` (optional) is a LIST of open nodes raced for first-arrival (lowest tail latency).
export const CHAINS = {
  1:     { name: "Ethereum",  short: "ETH",  sym: "ETH",  api: "https://eth.blockscout.com/api/v2",       rpc: "https://ethereum-rpc.publicnode.com",      ws: "wss://ethereum-rpc.publicnode.com",      wss: ["wss://ethereum-rpc.publicnode.com", "wss://eth.drpc.org"],      kappa: true },
  8453:  { name: "Base",      short: "BASE", sym: "ETH",  api: "https://base.blockscout.com/api/v2",       rpc: "https://base-rpc.publicnode.com",          ws: "wss://base-rpc.publicnode.com",          kappa: false },
  10:    { name: "Optimism",  short: "OP",   sym: "ETH",  api: "https://optimism.blockscout.com/api/v2",   rpc: "https://optimism-rpc.publicnode.com",      ws: "wss://optimism-rpc.publicnode.com",      kappa: false },
  42161: { name: "Arbitrum",  short: "ARB",  sym: "ETH",  api: "https://arbitrum.blockscout.com/api/v2",   rpc: "https://arbitrum-one-rpc.publicnode.com",  ws: "wss://arbitrum-one-rpc.publicnode.com",  kappa: false },
  100:   { name: "Gnosis",    short: "GNO",  sym: "xDAI", api: "https://gnosis.blockscout.com/api/v2",     rpc: "https://gnosis-rpc.publicnode.com",        ws: "wss://gnosis-rpc.publicnode.com",        kappa: true },
  137:   { name: "Polygon",   short: "POL",  sym: "POL",  api: "https://polygon.blockscout.com/api/v2",    rpc: "https://polygon-bor-rpc.publicnode.com",   ws: "wss://polygon-bor-rpc.publicnode.com",   kappa: true },
  // ── more EVM chains — each verified as a real public Blockscout v2 instance (CORS, no
  //    key) + an open RPC; `ws` set where an open WebSocket is confirmed (else live
  //    streaming is gracefully disabled, the rest of the explorer still works).
  324:      { name: "zkSync Era",       short: "ZK",   sym: "ETH",        api: "https://zksync.blockscout.com/api/v2",                     rpc: "https://mainnet.era.zksync.io",        ws: "wss://mainnet.era.zksync.io/ws",       kappa: false },
  534352:   { name: "Scroll",           short: "SCRL", sym: "ETH",        api: "https://blockscout.scroll.io/api/v2",                      rpc: "https://scroll-rpc.publicnode.com",    ws: "wss://scroll-rpc.publicnode.com",      kappa: false },
  42220:    { name: "Celo",             short: "CELO", sym: "CELO",       api: "https://celo.blockscout.com/api/v2",                       rpc: "https://celo-rpc.publicnode.com",      ws: "wss://celo-rpc.publicnode.com",        kappa: false },
  130:      { name: "Unichain",         short: "UNI",  sym: "ETH",        api: "https://unichain.blockscout.com/api/v2",                   rpc: "https://unichain-rpc.publicnode.com",  ws: "wss://unichain-rpc.publicnode.com",    kappa: false },
  42793:    { name: "Etherlink",        short: "XTZ",  sym: "XTZ",        api: "https://explorer.etherlink.com/api/v2",                    rpc: "https://node.mainnet.etherlink.com",   ws: "wss://node.mainnet.etherlink.com",     kappa: false },
  57073:    { name: "Ink",              short: "INK",  sym: "ETH",        api: "https://explorer.inkonchain.com/api/v2",                   rpc: "https://rpc-gel.inkonchain.com",                                                   kappa: false },
  480:      { name: "World Chain",      short: "WLD",  sym: "ETH",        api: "https://worldchain-mainnet.explorer.alchemy.com/api/v2",   rpc: "https://worldchain-mainnet.gateway.tenderly.co",                                   kappa: false },
  34443:    { name: "Mode",             short: "MODE", sym: "ETH",        api: "https://explorer.mode.network/api/v2",                     rpc: "https://mainnet.mode.network",                                                     kappa: false },
  42:       { name: "LUKSO",            short: "LYX",  sym: "LYX",        api: "https://explorer.execution.mainnet.lukso.network/api/v2",  rpc: "https://rpc.mainnet.lukso.network",                                                kappa: false },
  30:       { name: "Rootstock",        short: "RBTC", sym: "RBTC",       api: "https://rootstock.blockscout.com/api/v2",                  rpc: "https://public-node.rsk.co",                                                       kappa: false },
  999:      { name: "Hyperliquid · HyperEVM", short: "HYPE", sym: "HYPE",   api: "https://www.hyperscan.com/api/v2",                         rpc: "https://rpc.hyperliquid.xyz/evm",                                                  kappa: false },
  11155111: { name: "Sepolia (testnet)", short: "SEP", sym: "SepoliaETH", api: "https://eth-sepolia.blockscout.com/api/v2",                rpc: "https://ethereum-sepolia-rpc.publicnode.com", ws: "wss://ethereum-sepolia-rpc.publicnode.com", kappa: true },

  // ── Etherscan-FAMILY chains (no public Blockscout) — indexed via the Etherscan API:
  //    `routescan` = Etherscan-compatible, NO KEY; `etherscanV2` = unified API, free key.
  //    Live blocks + mempool + κ work over the chain's RPC/WSS even without a key.
  //    `kappa` = block headers re-derive; `kappaTx` = only transactions re-derive.
  43114: { name: "Avalanche",        short: "AVAX", sym: "AVAX", indexer: "etherscan", esMode: "routescan",   esBase: "https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api", coingecko: "avalanche-2",  rpc: "https://avalanche-c-chain-rpc.publicnode.com", ws: "wss://avalanche-c-chain-rpc.publicnode.com", kappa: false, kappaTx: true },
  80094: { name: "Berachain",        short: "BERA", sym: "BERA", indexer: "etherscan", esMode: "routescan",   esBase: "https://api.routescan.io/v2/network/mainnet/evm/80094/etherscan/api", coingecko: "berachain-bera", rpc: "https://berachain-rpc.publicnode.com",        ws: "wss://berachain-rpc.publicnode.com",        kappa: false, kappaTx: true },
  81457: { name: "Blast",            short: "BLST", sym: "ETH",  indexer: "etherscan", esMode: "routescan",   esBase: "https://api.routescan.io/v2/network/mainnet/evm/81457/etherscan/api", coingecko: "ethereum",     rpc: "https://blast-rpc.publicnode.com",            ws: "wss://blast-rpc.publicnode.com",            kappa: true },
  5000:  { name: "Mantle",           short: "MNT",  sym: "MNT",  indexer: "etherscan", esMode: "routescan",   esBase: "https://api.routescan.io/v2/network/mainnet/evm/5000/etherscan/api",  coingecko: "mantle",       rpc: "https://mantle-rpc.publicnode.com",           ws: "wss://mantle-rpc.publicnode.com",           kappa: true },
  56:    { name: "BNB Smart Chain",  short: "BNB",  sym: "BNB",  indexer: "etherscan", esMode: "etherscanV2", coingecko: "binancecoin",  rpc: "https://bsc-rpc.publicnode.com",       ws: "wss://bsc-rpc.publicnode.com",       kappa: true },
  59144: { name: "Linea",            short: "LINEA",sym: "ETH",  indexer: "etherscan", esMode: "etherscanV2", coingecko: "ethereum",     rpc: "https://linea-rpc.publicnode.com",     ws: "wss://linea-rpc.publicnode.com",     kappa: false, kappaTx: true },
  250:   { name: "Fantom",           short: "FTM",  sym: "FTM",  indexer: "etherscan", esMode: "etherscanV2", coingecko: "fantom",       rpc: "https://fantom-rpc.publicnode.com",    ws: "wss://fantom-rpc.publicnode.com",    kappa: false, kappaTx: true },

  // ── non-EVM: Solana (family:"solana") — its own source/stream/renderers; κ = ed25519
  //    signature verification (not keccak/RLP), addresses are base58, blocks are slots,
  //    history is native (getSignaturesForAddress), the "mempool" is the live tx firehose.
  101:   { name: "Solana",           short: "SOL",  sym: "SOL",  family: "solana", rpc: "https://solana-rpc.publicnode.com", ws: "wss://solana-rpc.publicnode.com", coingecko: "solana" },
  // ── non-EVM: Hyperliquid HyperCore (the perps L1 — a markets terminal, not a block
  //    explorer): live order books, the trade firehose, funding/OI, per-account positions.
  1000000: { name: "Hyperliquid · HyperCore", short: "HC", sym: "USD", family: "hypercore", info: "https://api.hyperliquid.xyz/info", ws: "wss://api.hyperliquid.xyz/ws" },
};

const qs = (params) => {
  if (!params || !Object.keys(params).length) return "";
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null) u.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  return "?" + u.toString();
};

export class Blockscout {
  constructor(api, timeoutMs = 18000) { this.api = api; this.timeoutMs = timeoutMs; this.cache = new Map(); }
  setApi(api) { this.api = api; this.cache.clear(); }

  async get(path, { signal, cache = false } = {}) {
    if (cache && this.cache.has(path)) return this.cache.get(path);
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), this.timeoutMs);
    const onAbort = () => ac.abort();
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    try {
      const res = await fetch(this.api + path, { headers: { accept: "application/json" }, signal: ac.signal });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Blockscout HTTP " + res.status);
      const j = await res.json();
      if (cache) this.cache.set(path, j);
      return j;
    } catch (e) { if (e.name === "AbortError") throw new Error("request timed out"); throw e; }
    finally { clearTimeout(to); if (signal) signal.removeEventListener("abort", onAbort); }
  }

  // ── home / network ────────────────────────────────────────────────────────────────
  stats(o) { return this.get("/stats", o); }
  statsChart(kind, o) { return this.get(`/stats/charts/${kind}`, o); }   // 'transactions' | 'market'
  mainBlocks(o) { return this.get("/main-page/blocks", o); }
  mainTxs(o) { return this.get("/main-page/transactions", o); }

  // ── blocks ──────────────────────────────────────────────────────────────────────────
  blocks(p, o) { return this.get("/blocks" + qs(p), o); }
  block(id, o) { return this.get(`/blocks/${id}`, { cache: true, ...o }); }
  blockTxns(id, p, o) { return this.get(`/blocks/${id}/transactions` + qs(p), o); }
  blockWithdrawals(id, p, o) { return this.get(`/blocks/${id}/withdrawals` + qs(p), o); }

  // ── transactions ──────────────────────────────────────────────────────────────────────
  txns(p, o) { return this.get("/transactions" + qs(p), o); }
  tx(h, o) { return this.get(`/transactions/${h}`, { cache: true, ...o }); }
  txTokenTransfers(h, p, o) { return this.get(`/transactions/${h}/token-transfers` + qs(p), o); }
  txInternal(h, p, o) { return this.get(`/transactions/${h}/internal-transactions` + qs(p), o); }
  txLogs(h, p, o) { return this.get(`/transactions/${h}/logs` + qs(p), o); }
  txStateChanges(h, p, o) { return this.get(`/transactions/${h}/state-changes` + qs(p), o); }
  txRawTrace(h, o) { return this.get(`/transactions/${h}/raw-trace`, o); }
  txSummary(h, o) { return this.get(`/transactions/${h}/summary`, o); }

  // ── address ─────────────────────────────────────────────────────────────────────────
  address(a, o) { return this.get(`/addresses/${a}`, o); }
  addressCounters(a, o) { return this.get(`/addresses/${a}/counters`, o); }
  addressTxns(a, p, o) { return this.get(`/addresses/${a}/transactions` + qs(p), o); }
  addressTokenTransfers(a, p, o) { return this.get(`/addresses/${a}/token-transfers` + qs(p), o); }
  addressInternal(a, p, o) { return this.get(`/addresses/${a}/internal-transactions` + qs(p), o); }
  addressLogs(a, p, o) { return this.get(`/addresses/${a}/logs` + qs(p), o); }
  addressTokens(a, p, o) { return this.get(`/addresses/${a}/tokens` + qs(p), o); }
  addressNfts(a, p, o) { return this.get(`/addresses/${a}/nft` + qs({ type: "ERC-721,ERC-1155,ERC-404", ...p }), o); }
  addressNftCollections(a, p, o) { return this.get(`/addresses/${a}/nft/collections` + qs({ type: "ERC-721,ERC-1155,ERC-404", ...p }), o); }
  addressCoinHistoryByDay(a, o) { return this.get(`/addresses/${a}/coin-balance-history-by-day`, o); }

  // ── smart contract ────────────────────────────────────────────────────────────────────
  smartContract(a, o) { return this.get(`/smart-contracts/${a}`, { cache: true, ...o }); }

  // ── tokens ──────────────────────────────────────────────────────────────────────────
  token(a, o) { return this.get(`/tokens/${a}`, { cache: true, ...o }); }
  tokenTransfers(a, p, o) { return this.get(`/tokens/${a}/transfers` + qs(p), o); }
  tokenHolders(a, p, o) { return this.get(`/tokens/${a}/holders` + qs(p), o); }
  tokenCounters(a, o) { return this.get(`/tokens/${a}/counters`, o); }
  tokenInstances(a, p, o) { return this.get(`/tokens/${a}/instances` + qs(p), o); }
  tokenInstance(a, id, o) { return this.get(`/tokens/${a}/instances/${id}`, o); }

  // ── search ──────────────────────────────────────────────────────────────────────────
  search(q, o) { return this.get("/search" + qs({ q }), o); }
}
