// holo-etherscan-api.js — the Etherscan-FAMILY indexer adapter.
//
// Many major chains (Avalanche, BNB, Linea, Blast, Mantle, Berachain…) do NOT run a
// public Blockscout; they index on the Etherscan API shape (Snowtrace, BscScan…). This
// adapter exposes the EXACT SAME method surface as the Blockscout client (so the UI is
// unchanged) but speaks the Etherscan API and NORMALIZES every response back into the
// Blockscout v2 shape. Two backends, no UI change:
//   • Routescan  — Etherscan-compatible, NO KEY (Avalanche, Blast, Mantle, Berachain…)
//   • Etherscan V2 — the unified multichain API (one free key → 60+ chains incl. BNB)
//
// The block/transaction/mempool/κ surfaces work over the chain's own RPC/WSS (no index
// needed), so even a key-less Etherscan-V2 chain still shows live blocks + mempool +
// κ-verified detail; the KEY only unlocks the indexed history/source. One holospace,
// every chain — content-addressed all the way down (each block/tx hash IS its κ).

import * as E from "./holo-eth.js";

const isoFromUnix = (s) => new Date(Number(s) * 1000).toISOString();
const hx = (h) => (h == null ? 0 : parseInt(h, 16));
const dec = (h) => { try { return BigInt(h == null ? 0 : h).toString(); } catch { return "0"; } };
const normAddr = (hash, extra = {}) => (hash ? { hash, ens_domain_name: null, name: null, is_contract: undefined, is_verified: false, is_scam: false, public_tags: [], metadata: null, proxy_type: null, ...extra } : null);
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export class EtherscanFamily {
  constructor({ chainId, mode = "routescan", esBase = "", apiKey = "", rpc, coingecko = null, timeoutMs = 18000 }) {
    this.chainId = chainId; this.mode = mode; this.esBase = esBase; this.apiKey = apiKey;
    this.rpc = new E.Rpc(rpc); this.coingecko = coingecko; this.timeoutMs = timeoutMs;
    this.api = mode === "routescan" ? esBase : `https://api.etherscan.io/v2 (chainid ${chainId})`;
    this._cache = new Map(); this._price = undefined; this._meta = new Map();
  }
  needsKey() { return this.mode === "etherscanV2" && !this.apiKey; }
  setApi() {}                                              // (parity with Blockscout.setApi)
  setKey(k) { this.apiKey = k || ""; }

  _url(params) {
    const qs = new URLSearchParams(params).toString();
    return this.mode === "routescan" ? `${this.esBase}?${qs}` : `https://api.etherscan.io/v2/api?chainid=${this.chainId}&${qs}&apikey=${encodeURIComponent(this.apiKey)}`;
  }
  async _call(params, { signal } = {}) {
    if (this.needsKey()) { const e = new Error("API key required"); e.needsKey = true; throw e; }
    const ac = new AbortController(); const to = setTimeout(() => ac.abort(), this.timeoutMs);
    const onAb = () => ac.abort(); if (signal) signal.addEventListener("abort", onAb, { once: true });
    try { const r = await fetch(this._url(params), { headers: { accept: "application/json" }, signal: ac.signal }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.json(); }
    catch (e) { if (e.name === "AbortError") throw new Error("request timed out"); throw e; }
    finally { clearTimeout(to); if (signal) signal.removeEventListener("abort", onAb); }
  }
  async _list(params, o) {
    const j = await this._call(params, o);
    if (Array.isArray(j.result)) return j.result;
    if (String(j.status) === "0") { if (/no transactions|no records|not found/i.test(j.message || "")) return []; throw new Error(typeof j.result === "string" && j.result ? j.result : j.message || "indexer error"); }
    return j.result || [];
  }
  async _one(params, o) { const j = await this._call(params, o); return j.result; }
  async price() {
    if (this._price !== undefined) return this._price;
    // primary: the indexer's own native-coin price (works for every Etherscan-family chain)
    try { const r = await this._one({ module: "stats", action: "ethprice" }); if (r && r.ethusd) return (this._price = { usd: +r.ethusd }); } catch {}
    // fallback: CoinGecko (no key) for chains without a price endpoint
    if (this.coingecko) { try { const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${this.coingecko}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`, { headers: { accept: "application/json" } }); const j = await r.json(); if (j[this.coingecko]) return (this._price = j[this.coingecko]); } catch {} }
    return (this._price = null);
  }

  // ── RPC-backed normalizers (work even without a key) ──────────────────────────────────
  _normBlock(b) {
    const used = hx(b.gasUsed), lim = hx(b.gasLimit);
    return { height: hx(b.number), hash: b.hash, parent_hash: b.parentHash, nonce: b.nonce, type: 0, rewards: [],
      timestamp: isoFromUnix(hx(b.timestamp)), miner: normAddr(b.miner), size: hx(b.size),
      gas_used: String(used), gas_limit: String(lim), gas_used_percentage: lim ? used / lim * 100 : 0,
      base_fee_per_gas: b.baseFeePerGas != null ? dec(b.baseFeePerGas) : null,
      burnt_fees: b.baseFeePerGas != null ? (BigInt(b.baseFeePerGas) * BigInt(b.gasUsed)).toString() : null, burnt_fees_percentage: null,
      transactions_count: Array.isArray(b.transactions) ? b.transactions.length : 0, withdrawals_count: (b.withdrawals || []).length,
      blob_gas_used: b.blobGasUsed != null ? dec(b.blobGasUsed) : null, _txs: Array.isArray(b.transactions) && typeof b.transactions[0] === "object" ? b.transactions : null };
  }
  _methodLabel(input) { return input && input.length >= 10 && input !== "0x" ? input.slice(0, 10) : null; }
  _normTxRpc(t, receipt, ts, confirmations) {
    const gp = t.gasPrice != null ? dec(t.gasPrice) : null;
    return { hash: t.hash, from: normAddr(t.from), to: t.to ? normAddr(t.to) : null, value: dec(t.value),
      nonce: hx(t.nonce), position: t.transactionIndex != null ? hx(t.transactionIndex) : null, type: t.type != null ? hx(t.type) : 0,
      gas_limit: String(hx(t.gas)), gas_price: gp, base_fee_per_gas: null,
      max_fee_per_gas: t.maxFeePerGas != null ? dec(t.maxFeePerGas) : null, max_priority_fee_per_gas: t.maxPriorityFeePerGas != null ? dec(t.maxPriorityFeePerGas) : null,
      block_number: t.blockNumber != null ? hx(t.blockNumber) : null, timestamp: ts || null, confirmations: confirmations ?? null,
      raw_input: t.input, decoded_input: null, method: this._methodLabel(t.input), transaction_types: receipt && receipt.logs && receipt.logs.length ? ["contract_call"] : [],
      status: receipt ? (hx(receipt.status) === 1 ? "ok" : "error") : null, result: receipt ? (hx(receipt.status) === 1 ? "success" : "error") : null,
      gas_used: receipt ? String(hx(receipt.gasUsed)) : null,
      fee: receipt ? { type: "actual", value: (BigInt(hx(receipt.gasUsed)) * BigInt(hx(receipt.effectiveGasPrice || t.gasPrice || 0))).toString() } : null,
      created_contract: receipt && receipt.contractAddress ? normAddr(receipt.contractAddress) : null, revert_reason: null,
      token_transfers: null, token_transfers_overflow: false, exchange_rate: this._price?.usd ?? null };
  }
  _normTxEs(it) {
    return { hash: it.hash, from: normAddr(it.from), to: it.to ? normAddr(it.to) : null, value: it.value,
      block_number: Number(it.blockNumber), timestamp: isoFromUnix(it.timeStamp), nonce: Number(it.nonce),
      gas_limit: it.gas, gas_used: it.gasUsed, gas_price: it.gasPrice, type: 0,
      fee: { type: "actual", value: (BigInt(it.gasUsed || 0) * BigInt(it.gasPrice || 0)).toString() },
      status: it.txreceipt_status === "1" ? "ok" : (it.isError === "1" ? "error" : "ok"),
      method: it.functionName ? String(it.functionName).split("(")[0] : (it.methodId && it.methodId !== "0x" ? it.methodId : null),
      created_contract: it.contractAddress ? normAddr(it.contractAddress) : null, raw_input: it.input };
  }
  _normTt(it) {
    return { transaction_hash: it.hash, block_number: Number(it.blockNumber), timestamp: isoFromUnix(it.timeStamp),
      from: normAddr(it.from), to: normAddr(it.to), token_type: it.tokenDecimal ? "ERC-20" : "ERC-721",
      token: { address_hash: it.contractAddress, name: it.tokenName, symbol: it.tokenSymbol, decimals: it.tokenDecimal, type: it.tokenDecimal ? "ERC-20" : "ERC-721", icon_url: null, exchange_rate: null },
      total: it.tokenDecimal ? { value: it.value, decimals: it.tokenDecimal } : { token_id: it.tokenID }, type: "token_transfer", method: null };
  }
  _normInt(it) { return { transaction_hash: it.hash, block_number: Number(it.blockNumber), timestamp: isoFromUnix(it.timeStamp), from: normAddr(it.from), to: it.to ? normAddr(it.to) : null, value: it.value, type: it.type || "call", created_contract: it.contractAddress ? normAddr(it.contractAddress) : null, gas_limit: it.gas }; }

  // ── home / network ────────────────────────────────────────────────────────────────────
  async stats(o) {
    const [gas, bn, price] = await Promise.all([this._one({ module: "gastracker", action: "gasoracle" }, o).catch(() => null), this.rpc.call("eth_blockNumber", []).catch(() => null), this.price()]);
    const g = gas && typeof gas === "object" ? gas : null;
    // gas prices: Etherscan returns Gwei (small); Routescan returns wei (large) → normalize
    const gw = (v) => { const n = +v; return isNaN(n) ? 0 : (n > 5000 ? +(n / 1e9).toFixed(3) : n); };
    return { coin_price: price?.usd ?? null, coin_price_change_percentage: price?.usd_24h_change ?? null, market_cap: price?.usd_market_cap ?? null,
      gas_prices: g ? { slow: { price: gw(g.SafeGasPrice) }, average: { price: gw(g.ProposeGasPrice) }, fast: { price: gw(g.FastGasPrice) } } : {},
      total_blocks: bn ? hx(bn) : null, total_transactions: null, total_addresses: null, transactions_today: null, average_block_time: null, network_utilization_percentage: null, tvl: null,
      gas_used_today: null, total_gas_used: null };
  }
  async statsChart() { return { chart_data: [] }; }        // no no-key chart endpoint → home hides it
  async mainBlocks(o) {
    const bn = hx(await this.rpc.call("eth_blockNumber", []));
    const raws = await this.rpc.batch(Array.from({ length: 6 }, (_, i) => ({ method: "eth_getBlockByNumber", params: ["0x" + (bn - i).toString(16), false] })));
    return raws.filter(Boolean).map((b) => this._normBlock(b));
  }
  async mainTxs(o) {
    const bn = await this.rpc.call("eth_blockNumber", []);
    const b = await this.rpc.call("eth_getBlockByNumber", [bn, true]);
    return (b.transactions || []).slice(0, 6).map((t) => this._normTxRpc(t, null, isoFromUnix(hx(b.timestamp))));
  }
  async blocks(params, o) {
    const from = params?.block_number != null ? params.block_number : hx(await this.rpc.call("eth_blockNumber", []));
    const lo = Math.max(0, from - 24);
    const raws = await this.rpc.batch(Array.from({ length: from - lo + 1 }, (_, i) => ({ method: "eth_getBlockByNumber", params: ["0x" + (from - i).toString(16), false] })));
    const items = raws.filter(Boolean).map((b) => this._normBlock(b));
    return { items, next_page_params: lo > 0 ? { block_number: lo - 1 } : null };
  }
  async block(id, o) {
    const ck = "blk" + id; if (this._cache.has(ck)) return this._cache.get(ck);
    const param = /^0x[0-9a-fA-F]{64}$/.test(String(id)) ? ["eth_getBlockByHash", String(id)] : ["eth_getBlockByNumber", "0x" + Number(id).toString(16)];
    const b = await this.rpc.call(param[0], [param[1], true]); if (!b) return null;
    const n = this._normBlock(b); this._cache.set(ck, n); return n;
  }
  async blockTxns(id, params, o) {
    const b = await this.block(id); const txs = (b && b._txs) || [];
    const page = params?.page || 1, off = 50, slice = txs.slice((page - 1) * off, page * off);
    return { items: slice.map((t) => this._normTxRpc(t, null, b.timestamp)), next_page_params: txs.length > page * off ? { page: page + 1 } : null };
  }
  async blockWithdrawals(id, params, o) { return { items: [], next_page_params: null }; }

  // ── transactions ──────────────────────────────────────────────────────────────────────
  async txns(params, o) {
    const bn = hx(await this.rpc.call("eth_blockNumber", []));
    const raws = await this.rpc.batch([0, 1, 2].map((i) => ({ method: "eth_getBlockByNumber", params: ["0x" + (bn - i).toString(16), true] })));
    const items = []; for (const b of raws.filter(Boolean)) for (const t of (b.transactions || [])) items.push(this._normTxRpc(t, null, isoFromUnix(hx(b.timestamp))));
    return { items: items.slice(0, 50), next_page_params: null };
  }
  async tx(h, o) {
    const [t, r, bn] = await Promise.all([this.rpc.call("eth_getTransactionByHash", [h]), this.rpc.call("eth_getTransactionReceipt", [h]).catch(() => null), this.rpc.call("eth_blockNumber", []).catch(() => null)]);
    if (!t) return null;
    let ts = null;
    if (t.blockNumber) { try { const blk = await this.rpc.call("eth_getBlockByNumber", [t.blockNumber, false]); if (blk) ts = isoFromUnix(hx(blk.timestamp)); } catch {} }
    const conf = bn && t.blockNumber ? hx(bn) - hx(t.blockNumber) : null;
    const tx = this._normTxRpc(t, r, ts, conf);
    if (r) tx.token_transfers = this._decodeTransfers(r.logs, h).slice(0, 10);
    return tx;
  }
  _decodeTransfers(logs, h) {
    return (logs || []).filter((l) => (l.topics || [])[0]?.toLowerCase() === TRANSFER && l.topics.length === 3).map((l) => ({
      transaction_hash: h, from: normAddr("0x" + l.topics[1].slice(26)), to: normAddr("0x" + l.topics[2].slice(26)), token_type: "ERC-20",
      token: { address_hash: l.address, symbol: this._meta.get(l.address.toLowerCase())?.symbol || "?", decimals: this._meta.get(l.address.toLowerCase())?.dec ?? 18, type: "ERC-20", icon_url: null },
      total: { value: BigInt(l.data === "0x" ? 0 : l.data).toString(), decimals: this._meta.get(l.address.toLowerCase())?.dec ?? 18 }, type: "token_transfer" }));
  }
  async txTokenTransfers(h, params, o) {
    const r = await this.rpc.call("eth_getTransactionReceipt", [h]).catch(() => null); if (!r) return { items: [] };
    const addrs = [...new Set((r.logs || []).filter((l) => (l.topics || [])[0]?.toLowerCase() === TRANSFER).map((l) => l.address.toLowerCase()))];
    await Promise.all(addrs.map((a) => this._tokenMeta(a)));
    return { items: this._decodeTransfers(r.logs, h), next_page_params: null };
  }
  async _tokenMeta(addr) {
    const k = addr.toLowerCase(); if (this._meta.has(k)) return this._meta.get(k);
    const call = (d) => this.rpc.call("eth_call", [{ to: addr, data: d }, "latest"]);
    try { const [s, d] = await Promise.all([call(E.selector("symbol()")).then(E.decodeString).catch(() => "?"), call(E.selector("decimals()")).then((x) => Number(E.decodeWord(x, "uint8"))).catch(() => 18)]); const m = { symbol: s || "?", dec: d || 18 }; this._meta.set(k, m); return m; }
    catch { const m = { symbol: "?", dec: 18 }; this._meta.set(k, m); return m; }
  }
  async txInternal(h, params, o) { const r = await this._list({ module: "account", action: "txlistinternal", txhash: h }, o).catch(() => []); return { items: r.map((x) => this._normInt(x)), next_page_params: null }; }
  async txLogs(h, params, o) {
    const r = await this.rpc.call("eth_getTransactionReceipt", [h]).catch(() => null);
    return { items: (r?.logs || []).map((l) => ({ address: normAddr(l.address), topics: l.topics, data: l.data, index: hx(l.logIndex), decoded: null })), next_page_params: null };
  }
  async txStateChanges(h, params, o) { return { items: [] }; }
  async txRawTrace(h, o) { return []; }
  async txSummary(h, o) { return null; }

  // ── address ─────────────────────────────────────────────────────────────────────────
  async address(a, o) {
    const [bal, code, price] = await Promise.all([this.rpc.call("eth_getBalance", [a, "latest"]).catch(() => "0x0"), this.rpc.call("eth_getCode", [a, "latest"]).catch(() => "0x"), this.price()]);
    const isC = code && code !== "0x";
    return { hash: a, coin_balance: dec(bal), exchange_rate: price?.usd ?? null, is_contract: isC, ens_domain_name: null, name: null, is_verified: false, is_scam: false,
      public_tags: [], private_tags: [], metadata: null, proxy_type: null, creator_address_hash: null, creation_transaction_hash: null,
      has_tokens: true, has_token_transfers: true, has_logs: true, token: null, watchlist_names: [] };
  }
  async addressCounters(a, o) { return { transactions_count: null, token_transfers_count: null, gas_usage_count: null, validations_count: null }; }
  async addressTxns(a, params, o) {
    const page = params?.page || 1, off = 50;
    const r = await this._list({ module: "account", action: "txlist", address: a, startblock: 0, endblock: 99999999, page, offset: off, sort: "desc" }, o);
    return { items: r.map((x) => this._normTxEs(x)), next_page_params: r.length === off ? { page: page + 1 } : null };
  }
  async addressTokenTransfers(a, params, o) {
    const page = params?.page || 1, off = 50;
    const r = await this._list({ module: "account", action: "tokentx", address: a, page, offset: off, sort: "desc" }, o);
    return { items: r.map((x) => this._normTt(x)), next_page_params: r.length === off ? { page: page + 1 } : null };
  }
  async addressInternal(a, params, o) {
    const page = params?.page || 1, off = 50;
    const r = await this._list({ module: "account", action: "txlistinternal", address: a, page, offset: off, sort: "desc" }, o);
    return { items: r.map((x) => this._normInt(x)), next_page_params: r.length === off ? { page: page + 1 } : null };
  }
  async addressTokens(a, o) { return { items: [] }; }       // holdings need a pro endpoint → graceful empty
  async addressNfts(a, params, o) { return { items: [] }; }
  async addressNftCollections(a, params, o) { return { items: [] }; }
  async addressCoinHistoryByDay(a, o) { return null; }
  async addressLogs(a, params, o) { return { items: [] }; }

  // ── smart contract ────────────────────────────────────────────────────────────────────
  async smartContract(a, o) {
    const r = await this._one({ module: "contract", action: "getsourcecode", address: a }, o).catch(() => null);
    const c = Array.isArray(r) ? r[0] : r; if (!c) return null;
    const verified = c.SourceCode && c.SourceCode !== "" && c.ABI !== "Contract source code not verified";
    let source = c.SourceCode || "", additional = [];
    if (source.startsWith("{{") || source.startsWith("{\n")) { try { const parsed = JSON.parse(source.startsWith("{{") ? source.slice(1, -1) : source); const srcs = parsed.sources || {}; const entries = Object.entries(srcs); if (entries.length) { source = entries[0][1].content || ""; additional = entries.slice(1).map(([p, v]) => ({ file_path: p, source_code: v.content || "" })); } } catch {} }
    let abi = null; try { if (c.ABI && c.ABI !== "Contract source code not verified") abi = JSON.parse(c.ABI); } catch {}
    return { is_verified: !!verified, is_fully_verified: !!verified, name: c.ContractName || null, compiler_version: c.CompilerVersion || null, language: "solidity",
      evm_version: c.EVMVersion || null, optimization_enabled: c.OptimizationUsed === "1", optimization_runs: Number(c.Runs) || null,
      source_code: source, additional_sources: additional, file_path: (c.ContractName || "Contract") + ".sol", abi, license_type: c.LicenseType || null,
      verified_at: null, constructor_args: c.ConstructorArguments || null, proxy_type: c.Proxy === "1" ? "unknown" : null, implementations: c.Implementation ? [{ address: c.Implementation }] : [] };
  }

  // ── tokens ──────────────────────────────────────────────────────────────────────────
  async token(a, o) {
    const code = await this.rpc.call("eth_getCode", [a, "latest"]).catch(() => "0x"); if (!code || code === "0x") return { message: "not a contract" };
    const call = (d) => this.rpc.call("eth_call", [{ to: a, data: d }, "latest"]);
    const [name, symbol, decimals, supply] = await Promise.all([
      call(E.selector("name()")).then(E.decodeString).catch(() => ""), call(E.selector("symbol()")).then(E.decodeString).catch(() => ""),
      call(E.selector("decimals()")).then((d) => Number(E.decodeWord(d, "uint8"))).catch(() => 18), call(E.selector("totalSupply()")).then((s) => E.decodeWord(s, "uint256")).catch(() => null)]);
    return { address_hash: a, name: name || null, symbol: symbol || null, decimals: decimals != null ? String(decimals) : "18", total_supply: supply != null ? supply.toString() : null,
      type: "ERC-20", holders_count: null, exchange_rate: null, circulating_market_cap: null, volume_24h: null, icon_url: null };
  }
  async tokenTransfers(a, params, o) {
    const page = params?.page || 1, off = 50;
    const r = await this._list({ module: "account", action: "tokentx", contractaddress: a, page, offset: off, sort: "desc" }, o).catch(() => []);
    return { items: r.map((x) => this._normTt(x)), next_page_params: r.length === off ? { page: page + 1 } : null };
  }
  async tokenHolders(a, params, o) { try { const r = await this._list({ module: "token", action: "topholders", contractaddress: a, page: 1, offset: 50 }, o); return { items: r.map((h) => ({ address: normAddr(h.TokenHolderAddress || h.address), value: h.TokenHolderQuantity || h.value, token_id: null })), next_page_params: null }; } catch { return { items: [] }; } }
  async tokenCounters(a, o) { return { transfers_count: null, token_holders_count: null }; }
  async tokenInstances(a, params, o) { return { items: [] }; }

  // ── search ──────────────────────────────────────────────────────────────────────────
  async search(q, o) {
    q = String(q || "").trim(); const items = [];
    if (/^\d+$/.test(q)) items.push({ type: "block", block_number: Number(q) });
    else if (/^0x[0-9a-fA-F]{64}$/.test(q)) items.push({ type: "transaction", transaction_hash: q });
    else if (/^0x[0-9a-fA-F]{40}$/.test(q)) { try { const code = await this.rpc.call("eth_getCode", [q, "latest"]); items.push({ type: code && code !== "0x" ? "contract" : "address", address_hash: q, is_smart_contract_address: code !== "0x" }); } catch { items.push({ type: "address", address_hash: q }); } }
    return { items };
  }
}

// ── normalization self-test (hermetic, used by etherscan-witness.mjs) ─────────────────
// Feed canonical Etherscan-shaped payloads and assert they normalize to the Blockscout
// shape the UI renders — proving the adapter unifies the fragmented APIs.
export function _normSelfTest() {
  const f = Object.create(EtherscanFamily.prototype); f._meta = new Map(); f._price = { usd: 30 };
  const r = []; const chk = (n, c) => r.push({ name: n, ok: !!c });
  const tx = f._normTxEs({ blockNumber: "20", timeStamp: "1700000000", hash: "0xabc", nonce: "5", from: "0xfrom", to: "0xto", value: "1000000000000000000", gas: "21000", gasPrice: "1000000000", gasUsed: "21000", isError: "0", txreceipt_status: "1", input: "0xa9059cbb", methodId: "0xa9059cbb", functionName: "transfer(address,uint256)", contractAddress: "" });
  chk("txlist→block_number", tx.block_number === 20);
  chk("txlist→from chip", tx.from && tx.from.hash === "0xfrom");
  chk("txlist→ISO timestamp", tx.timestamp === new Date(1700000000000).toISOString());
  chk("txlist→status ok", tx.status === "ok");
  chk("txlist→method", tx.method === "transfer");
  chk("txlist→fee", tx.fee.value === "21000000000000");
  const tt = f._normTt({ blockNumber: "21", timeStamp: "1700000001", hash: "0xdef", from: "0xa", to: "0xb", value: "5000000", tokenName: "USD Coin", tokenSymbol: "USDC", tokenDecimal: "6", contractAddress: "0xusdc" });
  chk("tokentx→token symbol", tt.token.symbol === "USDC" && tt.token.decimals === "6");
  chk("tokentx→total", tt.total.value === "5000000");
  const blk = f._normBlock({ number: "0x14", hash: "0xb", parentHash: "0xp", miner: "0xm", timestamp: "0x6553f100", size: "0x100", gasUsed: "0x5208", gasLimit: "0xa410", baseFeePerGas: "0x3b9aca00", nonce: "0x0", transactions: ["0x1", "0x2"] });
  chk("block→height", blk.height === 20);
  chk("block→gas%", Math.abs(blk.gas_used_percentage - (0x5208 / 0xa410 * 100)) < 0.01);
  chk("block→ISO timestamp + miner chip", blk.miner.hash === "0xm" && /T.*Z$/.test(blk.timestamp));
  chk("block→tx count", blk.transactions_count === 2);
  return { ok: r.every((x) => x.ok), results: r };
}
