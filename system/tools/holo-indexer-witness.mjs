// holo-indexer-witness.mjs — proves the sovereign tx-history indexer: it dispatches by chain kind,
// normalises every source to one shape, prefers Blockscout (key-free) for EVM and FAILS OVER to the
// etherscan-family txlist, and degrades HONESTLY to [] (never fabricates rows). Network-free: the only
// I/O is `fetch`, injected here as canned responses.
//
//   node system/tools/holo-indexer-witness.mjs

import { txHistory, txHistoryDetailed, BLOCKSCOUT } from "../os/usr/lib/holo/holo-indexer.mjs";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { (c ? pass++ : fail++); console.log(`  ${c ? "✓" : "✗"} ${n}${d ? " — " + d : ""}`); };

console.log("Holo Indexer — sovereign, key-free tx history (WDK-Indexer parity)\n");

// a fake fetch: match by URL substring / method → { ok, status, json() }
const reply = (body, { ok = true, status = 200 } = {}) => ({ ok, status, json: async () => body });
function mkFetch(routes) {
  return async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    for (const r of routes) { if (url.includes(r.match) && (r.method || "GET") === method) { if (r.throw) throw new Error("network down"); return reply(r.body, r.opts); } }
    return reply({}, { ok: false, status: 404 });
  };
}
const ETH = { kind: "evm", chainId: 1, explorer: "https://etherscan.io", rpcs: [] };
const A = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

// 1) EVM via Blockscout — normalised shape, direction, counterparty, explorer link, unix time.
{
  const f = mkFetch([{ match: "eth.blockscout.com/api/v2/addresses", body: { items: [
    { hash: "0xAAA", timestamp: "2026-06-19T13:24:11.000000Z", from: { hash: A }, to: { hash: "0xBBB" }, value: "1000" },
    { hash: "0xCCC", timestamp: "2026-06-18T10:00:00.000000Z", from: { hash: "0xDDD" }, to: { hash: A }, value: "42" },
  ] } }]);
  const d = await txHistoryDetailed(ETH, A, { limit: 25, fetchImpl: f });
  ok("EVM history comes from Blockscout (sovereign source)", d.source === "blockscout", d.source);
  const r0 = d.rows[0];
  ok("row normalised: hash/time/direction/counterparty/value/explorer", r0.hash === "0xAAA" && r0.time === Math.floor(Date.parse("2026-06-19T13:24:11.000000Z") / 1000) && r0.direction === "out" && r0.counterparty === "0xBBB" && r0.value === "1000" && r0.explorer === "https://etherscan.io/tx/0xAAA");
  ok("direction 'in' when the address is the recipient", d.rows[1].direction === "in" && d.rows[1].counterparty === "0xDDD");
}

// 2) Blockscout DOWN → fails over to the etherscan-family txlist (no fabrication, real fallback).
{
  const f = mkFetch([
    { match: "eth.blockscout.com", throw: true },
    { match: "api.etherscan.io", body: { result: [{ hash: "0xEEE", timeStamp: "1718800000", from: A, to: "0xFFF", value: "9" }] } },
  ]);
  const d = await txHistoryDetailed(ETH, A, { limit: 25, fetchImpl: f });
  ok("EVM falls over to txlist when Blockscout is unreachable", d.source === "txlist" && d.rows[0].hash === "0xEEE" && d.rows[0].direction === "out", d.source);
}

// 3) honest degrade — no indexer answers → [] (never invented rows).
{
  const f = mkFetch([{ match: "eth.blockscout.com", throw: true }, { match: "api.etherscan.io", body: { result: "Max rate limit reached" } }]);
  const rows = await txHistory(ETH, A, { fetchImpl: f });
  ok("degrades to [] when every source is key-gated/down (no fabrication)", Array.isArray(rows) && rows.length === 0);
}

// 4) a chain with NO sovereign indexer wired uses the fallback path (chainId absent from BLOCKSCOUT).
{
  const SCROLL = { kind: "evm", chainId: 534352, explorer: "https://scrollscan.com" };
  ok("scroll (no Blockscout instance) is not in the sovereign map", !BLOCKSCOUT[534352]);
  const f = mkFetch([{ match: "api.scrollscan.com", body: { result: [{ hash: "0x111", timeStamp: "1700000000", from: "0xZZZ", to: A, value: "5" }] } }]);
  const d = await txHistoryDetailed(SCROLL, A, { fetchImpl: f });
  ok("unmapped EVM chain still reads via txlist fallback", d.source === "txlist" && d.rows[0].direction === "in");
}

// 5) BTC via Esplora.
{
  const BTC = { kind: "btc", explorer: "https://mempool.space" };
  const f = mkFetch([{ match: "mempool.space/api/address", body: [{ txid: "btc1", status: { block_time: 1718000000 } }] }]);
  const d = await txHistoryDetailed(BTC, "bc1qx", { fetchImpl: f });
  ok("BTC history via Esplora (key-free)", d.source === "esplora" && d.rows[0].hash === "btc1" && d.rows[0].explorer === "https://mempool.space/tx/btc1");
}

// 6) Solana via JSON-RPC (POST getSignaturesForAddress).
{
  const SOL = { kind: "sol", rpcs: ["https://api.mainnet-beta.solana.com"], explorer: "https://solscan.io" };
  const f = mkFetch([{ match: "mainnet-beta.solana.com", method: "POST", body: { result: [{ signature: "sig1", blockTime: 1718111111 }] } }]);
  const d = await txHistoryDetailed(SOL, "EunV", { fetchImpl: f });
  ok("Solana history via the chain's own RPC", d.source === "solana-rpc" && d.rows[0].hash === "sig1" && d.rows[0].time === 1718111111);
}

// 7) the verified sovereign instances are present.
ok("Blockscout map covers the verified-live chains", [1, 100, 8453, 42161, 137].every((id) => /^https:\/\/[a-z]+\.blockscout\.com$/.test(BLOCKSCOUT[id] || "")), Object.keys(BLOCKSCOUT).join(","));

console.log(`\n${fail ? "WITNESS FAILED" : "WITNESSED ✓"}  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
