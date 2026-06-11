// holo-scan-tools.js — the verified multi-chain substrate, exposed as AGENT TOOLS.
//
// THE THESIS (web2/web3/AI interop, made concrete): an AI agent today asks a blockchain
// question and gets back JSON from a trusted RPC/explorer it can't check — then it
// hallucinates around it. Holo Scan flips that: every tool answer carries a re-derivable
// CONTENT ADDRESS (κ) and the raw bytes it came from, so the agent (or anyone) can verify
// the answer instead of trusting the server. The agent trusts re-derivation, not an API.
//
// This is ONE tool layer, isomorphic: the MCP server (holo-scan-mcp.mjs, Node/stdio)
// exposes it to any agent, and Holo Scan's in-page #/agent console demos the exact same
// envelopes in the browser. Same substrate, two faces.
//
// Honest by construction: hashed objects (blocks, txns, the omnichain snapshot) are
// κ-verifiable by re-derivation; mutable STATE (an account balance) is not a content-
// addressed object, so its envelope says so plainly (a light client is the roadmap).

const caOf = (hash) => "holo://" + String(hash || "").replace(/^0x/, "");
const numOf = (q) => { try { return Number(BigInt(q)); } catch { return Number(q) || 0; } };
const DISCLAIMER = "Holo Scan exposes real on-chain data (indexers + public nodes). κ proves data INTEGRITY/AUTHENTICITY by re-derivation from raw bytes, not consensus finality — full trustlessness (an in-browser light client) is the roadmap.";

// build the toolset over injected, environment-agnostic capabilities:
//   E          — the holo-eth engine (keccak/RLP verifyBlock/verifyTx, selfTest, isHash32…)
//   CHAINS     — the network registry
//   indexerFor(chainId) → Blockscout|EtherscanFamily client
//   rpcFor(chainId)     → E.Rpc for raw consensus bytes (κ re-derivation)
//   omni       — an OmniAccount instance (cross-chain) — optional
export function makeTools({ E, CHAINS, indexerFor, rpcFor, omni = null }) {
  const env = (o) => ({ ok: true, disclaimer: DISCLAIMER, ...o });
  const fail = (tool, msg) => ({ ok: false, tool, error: String(msg), disclaimer: DISCLAIMER });
  const nameOf = (cid) => (CHAINS[cid]?.name || ("chain " + cid));

  const handlers = {
    async engine_selftest() {
      const r = E.selfTest();
      return env({ tool: "engine_selftest", summary: `κ engine self-test: ${r.ok ? "PASS" : "FAIL"} (${r.pass}/${r.total})`,
        data: r, verification: { scheme: "known-answer tests (keccak/RLP/EIP-55/genesis/per-type tx)", verified: !!r.ok },
        honest: "Verifies the verifier itself: the keccak256/RLP engine against fixed known-answer vectors." });
    },

    async list_chains() {
      const chains = Object.entries(CHAINS).map(([id, c]) => ({ chainId: +id, name: c.name, family: c.family || "evm", symbol: c.sym, kappa_block: !!c.kappa, kappa_tx: !c.family }));
      return env({ tool: "list_chains", summary: `${chains.length} supported networks`, data: { chains }, verification: { scheme: "none" }, honest: "Static registry of supported networks (25 EVM + Solana + Hyperliquid HyperCore)." });
    },

    async get_block({ chain = 1, block = "latest" } = {}) {
      const cid = +chain; if (!CHAINS[cid] || CHAINS[cid].family) return fail("get_block", "unknown or non-EVM chain " + chain);
      const rpc = rpcFor(cid);
      const raw = E.isHash32(block)
        ? await rpc.call("eth_getBlockByHash", [block, false])
        : await rpc.call("eth_getBlockByNumber", [block === "latest" ? "latest" : "0x" + BigInt(block).toString(16), false]);
      if (!raw) return fail("get_block", "block not found");
      const capable = !!CHAINS[cid].kappa;
      const v = capable ? E.verifyBlock(raw) : { ok: null };
      return env({ tool: "get_block", summary: `Block #${numOf(raw.number)} on ${nameOf(cid)} — ${(raw.transactions || []).length} txns`,
        data: { chainId: cid, number: numOf(raw.number), hash: raw.hash, parentHash: raw.parentHash, timestamp: numOf(raw.timestamp), miner: raw.miner, gasUsed: numOf(raw.gasUsed), gasLimit: numOf(raw.gasLimit), txCount: (raw.transactions || []).length, raw },
        content_address: caOf(raw.hash),
        verification: { scheme: "keccak256(RLP(header))", verified: v.ok, derived: v.derived || null, claimed: raw.hash, reproducible: true, how: "blockHash = keccak256(RLP(headerFields(raw))); recompute from data.raw to check." },
        honest: v.ok === true ? "Block hash independently re-derived from raw consensus bytes (Law L5)." : v.ok === null ? "This chain's L2 header format isn't re-derivable here; data is from a public node (κ —)." : "WARNING: claimed hash does NOT match re-derivation." });
    },

    async get_transaction({ chain = 1, hash } = {}) {
      const cid = +chain; if (!CHAINS[cid] || CHAINS[cid].family) return fail("get_transaction", "unknown or non-EVM chain " + chain);
      if (!E.isHash32(hash)) return fail("get_transaction", "expected a 0x 32-byte tx hash");
      const rpc = rpcFor(cid);
      const raw = await rpc.call("eth_getTransactionByHash", [hash]);
      if (!raw) return fail("get_transaction", "transaction not found");
      const v = E.verifyTx(raw);
      return env({ tool: "get_transaction", summary: `Tx ${hash.slice(0, 12)}… on ${nameOf(cid)} — ${v.ok === true ? "κ-verified" : v.ok === null ? "κ n/a" : "κ MISMATCH"}`,
        data: { chainId: cid, hash: raw.hash, from: raw.from, to: raw.to, value: raw.value, nonce: numOf(raw.nonce), type: raw.type ? numOf(raw.type) : 0, blockNumber: raw.blockNumber ? numOf(raw.blockNumber) : null, raw },
        content_address: caOf(raw.hash),
        verification: { scheme: "keccak256(typeByte ‖ RLP(fields))", verified: v.ok, derived: v.derived || null, claimed: raw.hash, reproducible: true, how: "txHash = keccak256(txRaw(raw)); recompute from data.raw to check." },
        honest: v.ok === true ? "Transaction hash independently re-derived from raw consensus bytes (Law L5)." : v.ok === null ? "Non-standard tx type (e.g. OP-stack deposit) — not re-derivable here (κ —)." : "WARNING: claimed hash does NOT match re-derivation." });
    },

    async verify_hash({ chain = 1, type = "tx", id } = {}) {
      const r = type === "block" ? await handlers.get_block({ chain, block: id }) : await handlers.get_transaction({ chain, hash: id });
      if (!r.ok) return r;
      return env({ tool: "verify_hash", summary: r.summary, content_address: r.content_address, verification: r.verification, honest: r.honest });
    },

    async get_address({ chain = 1, address } = {}) {
      const cid = +chain; if (!CHAINS[cid]) return fail("get_address", "unknown chain " + chain);
      if (!E.isAddress(address)) return fail("get_address", "expected a 0x 20-byte address");
      const ix = indexerFor(cid); const info = await ix.address(address).catch(() => null);
      if (!info || info.message) return fail("get_address", "address not found");
      const bal = info.coin_balance, rate = info.exchange_rate ? +info.exchange_rate : 0;
      const balNum = bal ? Number(BigInt(bal)) / 1e18 : 0;
      return env({ tool: "get_address", summary: `${E.toChecksumAddress(address)} on ${nameOf(cid)} — ${balNum.toFixed(4)} ${CHAINS[cid].sym}`,
        data: { chainId: cid, address: E.toChecksumAddress(address), ens: info.ens_domain_name || null, isContract: !!info.is_contract, balance: balNum, balanceUsd: rate ? balNum * rate : null, symbol: CHAINS[cid].sym },
        identity: E.toChecksumAddress(address),
        verification: { scheme: "none", verified: null, note: "An account balance is mutable STATE, not a content-addressed object. Trustless verification needs a light client (roadmap). The address itself is EIP-55 checksummed (a self-check)." },
        honest: "Balance is read from the chain's index/node; it is not κ-re-derivable like a block or tx." });
    },

    async omni_account({ address } = {}) {
      if (!omni) return fail("omni_account", "omnichain scanning not available in this context");
      if (!E.isAddress(address)) return fail("omni_account", "expected a 0x 20-byte address");
      const r = await omni.scan(address);
      const ca = await omni.contentAddress(r);
      const manifest = omni.manifest(r);
      const present = r.chains.filter((c) => c.present).map((c) => ({ chainId: c.chainId, name: c.name, nativeBalance: c.nativeBalance, totalUsd: c.totalUsd, tokens: (c.tokens || []).filter((t) => t.priced).length }));
      present.sort((a, b) => (b.totalUsd || 0) - (a.totalUsd || 0));
      return env({ tool: "omni_account", summary: `Omnichain net worth ${"$" + Math.round(r.totalUsd).toLocaleString()} across ${r.activeCount} networks`,
        data: { address: E.toChecksumAddress(address), totalUsd: r.totalUsd, activeNetworks: r.activeCount, chains: present, hyperUsd: r.hyper?.accountValue || 0, recentActivity: r.timeline.length },
        content_address: ca,
        verification: { scheme: "sha256(canonical manifest)", verified: true, reproducible: true, manifest, how: "content_address = 'holo://' + sha256(manifest); recompute over data.manifest to check. Deterministic: same on-chain state → same κ." },
        honest: "Net worth EXCLUDES spam/over-valued tokens (a holding worth >5% of the token's entire market cap, or unpriced/illiquid) — these are flagged, never summed. USD = index price estimates. The snapshot κ proves the manifest's integrity." });
    },

    async resolve({ chain = 1, query } = {}) {
      const cid = +chain; if (!CHAINS[cid]) return fail("resolve", "unknown chain " + chain);
      const ix = indexerFor(cid);
      const r = await ix.search(query).catch(() => null);
      const hits = (r?.items || []).slice(0, 8).map((x) => ({ type: x.type, name: x.name || x.ens_info?.name || null, address: x.address_hash || x.address || null, symbol: x.symbol || null, block: x.block_number || null, tx: x.tx_hash || null }));
      return env({ tool: "resolve", summary: `${hits.length} result(s) for “${query}” on ${nameOf(cid)}`, data: { query, hits }, verification: { scheme: "none" }, honest: "Search/resolution is served by the chain's indexer; resolved objects can then be κ-verified via get_block / get_transaction." });
    },
  };

  // MCP tool manifest (JSON-Schema inputs). Descriptions are written for an LLM caller.
  const manifest = [
    { name: "engine_selftest", description: "Verify Holo Scan's own keccak256/RLP κ-engine against known-answer vectors. Call this to confirm the verifier is sound before trusting other answers.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "list_chains", description: "List all supported networks (25 EVM chains + Solana + Hyperliquid HyperCore) with chainId, symbol, and whether block/tx hashes are κ-re-derivable.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "get_block", description: "Fetch a block AND independently re-derive its hash from raw consensus bytes (keccak256(RLP(header))). Returns the block, a holo:// content address, and a verification proof. block = 'latest' | number | 0x-hash.", inputSchema: { type: "object", properties: { chain: { type: "integer", description: "EVM chainId (default 1 = Ethereum)" }, block: { type: "string", description: "'latest', a block number, or a 0x block hash" } }, additionalProperties: false } },
    { name: "get_transaction", description: "Fetch a transaction AND independently re-derive its hash from raw consensus bytes (keccak256(typeByte‖RLP(fields))). Returns the tx, a holo:// content address, and a verification proof the caller can recompute.", inputSchema: { type: "object", properties: { chain: { type: "integer", description: "EVM chainId (default 1)" }, hash: { type: "string", description: "0x 32-byte transaction hash" } }, required: ["hash"], additionalProperties: false } },
    { name: "verify_hash", description: "Proof-only: re-derive a block or transaction hash from raw bytes and return just the verification (verified / derived / claimed).", inputSchema: { type: "object", properties: { chain: { type: "integer" }, type: { type: "string", enum: ["block", "tx"] }, id: { type: "string", description: "block number/hash or tx hash" } }, required: ["type", "id"], additionalProperties: false } },
    { name: "get_address", description: "Get an account's native balance + USD + ENS + EOA/contract flag on one chain. NOTE: balance is mutable state, not κ-re-derivable (the envelope says so).", inputSchema: { type: "object", properties: { chain: { type: "integer" }, address: { type: "string", description: "0x 20-byte address" } }, required: ["address"], additionalProperties: false } },
    { name: "omni_account", description: "The omnichain view: one 0x address scanned across EVERY EVM chain + Hyperliquid at once → total net worth, per-chain breakdown, and a re-derivable holo:// content address for the whole snapshot (sha256 of the canonical manifest). Spam/over-valued tokens are excluded.", inputSchema: { type: "object", properties: { address: { type: "string", description: "0x 20-byte address" } }, required: ["address"], additionalProperties: false } },
    { name: "resolve", description: "Resolve a query (address, ENS, token name/symbol, block, tx) to typed on-chain objects via the indexer. Resolved objects can then be κ-verified with get_block / get_transaction.", inputSchema: { type: "object", properties: { chain: { type: "integer" }, query: { type: "string" } }, required: ["query"], additionalProperties: false } },
  ];

  async function call(name, args = {}) {
    const h = handlers[name];
    if (!h) return fail(name, "unknown tool");
    try { return await h(args || {}); } catch (e) { return fail(name, e && e.message || e); }
  }

  return { manifest, call, handlers, names: manifest.map((t) => t.name) };
}

export default makeTools;
