// holo-indexer.mjs — the wallet's transaction-history INDEXER: Hologram's native equivalent of WDK's
// dedicated Indexer module. Read-only; value never moves; no key, no custodian. It answers "what happened
// to this address" across chains from PUBLIC, sovereign-friendly sources, normalised to one shape.
//
// First principles:
//   • Sovereign-first (no custodian, no API key). EVM history comes from Blockscout — an OPEN-SOURCE
//     indexer anyone can self-host — not a key-gated explorer. BTC from Esplora (mempool.space). Solana
//     from the chain's own JSON-RPC. Every source is failover-listed; the first to answer wins.
//   • Honest degrade (no fabrication): a chain with no working public indexer returns [] (and says so via
//     `sources`), never invented rows. This REPLACES holo-wdk's old EVM path, which silently degraded to []
//     because it leaned on key-gated etherscan-family txlist (proven live: 0 rows for an active address).
//   • Isomorphic + witnessable: the ONLY I/O is `fetch`, injectable as `fetchImpl`, so the whole dispatch +
//     normalisation is Node-testable with canned responses — no network in the witness.
//
// A history row is normalised to: { hash, time(unix s|null), direction("in"|"out"|null), counterparty,
// value(base-unit string|null), explorer(url) } — identical to what holo-wdk.history() always returned.

// ── Blockscout instances (key-free, CORS-enabled) keyed by EVM chainId. Verified live 2026-06-21:
//    ethereum · gnosis · base · arbitrum · polygon return real data; optimism's instance was unreachable
//    (kept here — it FAILS OVER to the etherscan-family path below, never fabricates). Chains absent from
//    this map have no sovereign indexer wired yet and degrade to the fallback (honest []). ──
export const BLOCKSCOUT = {
  1: "https://eth.blockscout.com",
  100: "https://gnosis.blockscout.com",
  8453: "https://base.blockscout.com",
  42161: "https://arbitrum.blockscout.com",
  137: "https://polygon.blockscout.com",
  10: "https://optimism.blockscout.com",
};

const pickFetch = (fetchImpl) => fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
const lower = (s) => String(s || "").toLowerCase();
const txLink = (explorer, h) => `${explorer}/tx/${h}`;

// ── EVM: Blockscout v2 first (sovereign), then the etherscan-family txlist (best-effort, may be key-gated). ──
async function evmHistory(chain, address, { limit, fetchImpl }) {
  const f = pickFetch(fetchImpl); if (!f) throw new Error("no fetch");
  const addr = lower(address);
  const base = BLOCKSCOUT[chain.chainId];
  if (base) {
    try {
      const r = await f(`${base}/api/v2/addresses/${address}/transactions`, { headers: { accept: "application/json" } });
      if (r.ok) {
        const j = await r.json();
        const items = Array.isArray(j.items) ? j.items : [];
        if (items.length || r.status === 200) {
          return { source: "blockscout", rows: items.slice(0, limit).map((t) => {
            const from = lower(t.from?.hash), to = lower(t.to?.hash);
            const dir = from === addr ? "out" : to === addr ? "in" : null;
            return { hash: t.hash, time: t.timestamp ? Math.floor(Date.parse(t.timestamp) / 1000) : null, direction: dir, counterparty: dir === "out" ? (t.to?.hash || null) : (t.from?.hash || null), value: t.value ?? null, explorer: txLink(chain.explorer, t.hash) };
          }) };
        }
      }
    } catch { /* fall through to the etherscan-family path */ }
  }
  // fallback: the public account txlist API (Etherscan/Blockscout-compatible). Often key-gated → [].
  try {
    const api = chain.explorer.replace("//", "//api.").replace("api.optimistic", "api-optimistic");
    const url = `${api}/api?module=account&action=txlist&address=${address}&sort=desc&page=1&offset=${limit}`;
    const j = await (await f(url)).json();
    if (!Array.isArray(j.result)) return { source: base ? "blockscout-empty" : "txlist-empty", rows: [] };
    return { source: "txlist", rows: j.result.slice(0, limit).map((t) => ({ hash: t.hash, time: t.timeStamp ? Number(t.timeStamp) : null, direction: lower(t.from) === addr ? "out" : "in", counterparty: lower(t.from) === addr ? t.to : t.from, value: t.value ?? null, explorer: txLink(chain.explorer, t.hash) })) };
  } catch { return { source: "none", rows: [] }; }
}

// ── BTC: Esplora (mempool.space) — key-free. ──
async function btcHistory(chain, address, { limit, fetchImpl }) {
  const f = pickFetch(fetchImpl); if (!f) throw new Error("no fetch");
  const txs = await (await f(`${chain.explorer}/api/address/${address}/txs`)).json();
  return { source: "esplora", rows: (txs || []).slice(0, limit).map((t) => ({ hash: t.txid, time: t.status?.block_time || null, direction: null, counterparty: null, value: null, explorer: txLink(chain.explorer, t.txid) })) };
}

// ── Solana: the chain's own JSON-RPC (getSignaturesForAddress) — key-free, failover list. ──
async function solHistory(chain, address, { limit, fetchImpl }) {
  const f = pickFetch(fetchImpl); if (!f) throw new Error("no fetch");
  const urls = (chain.rpcs || [chain.rpc]).filter(Boolean);
  let err;
  for (const u of urls) {
    try {
      const r = await f(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSignaturesForAddress", params: [address, { limit }] }) });
      const j = await r.json();
      const res = j.result || [];
      return { source: "solana-rpc", rows: res.map((s) => ({ hash: s.signature, time: s.blockTime || null, direction: null, counterparty: null, value: null, explorer: txLink(chain.explorer, s.signature) })) };
    } catch (e) { err = e; }
  }
  throw err || new Error("all Solana RPC endpoints failed");
}

// ── txHistory — the one entry point. `chain` is a CHAINS entry ({ kind, chainId, explorer, rpcs, rpc }).
//    Returns the normalised rows array (back-compat with holo-wdk.history). `withSource` returns
//    { source, rows } so the caller/witness can see WHICH indexer answered (honest provenance). ──
export async function txHistoryDetailed(chain, address, { limit = 25, fetchImpl } = {}) {
  if (!chain) throw new Error("unknown chain");
  const opts = { limit, fetchImpl };
  if (chain.kind === "btc") return btcHistory(chain, address, opts);
  if (chain.kind === "sol") return solHistory(chain, address, opts);
  return evmHistory(chain, address, opts);
}
export async function txHistory(chain, address, opts = {}) {
  return (await txHistoryDetailed(chain, address, opts)).rows;
}

export default txHistory;
