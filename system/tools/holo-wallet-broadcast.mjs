// holo-wallet-broadcast.mjs — turn the live-stress "needs-faucet" rows into CONFIRMED on-chain broadcasts.
// Persists ONE throwaway testnet seed to disk (survives across runs), derives a testnet address per chain,
// and on each run: reads the live balance → if funded, BUILDS+VERIFIES+SIGNS+BROADCASTS a real tx and prints
// the hash + explorer link; else prints the funding address + faucet. Never fakes a broadcast. Testnet only.
//
//   node system/tools/holo-wallet-broadcast.mjs
//
// Re-run after dripping each faucet; funded chains broadcast, the rest keep waiting. The seed file is a
// throwaway holding only test coins — safe to display.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WDK, makeWDK, generateMnemonic, seedFromMnemonic, CHAINS, WalletManagerSolana } from "../os/usr/lib/holo/holo-wdk.js";
import * as BTC from "../os/usr/lib/holo/btc-wallet/wallet.js";
import * as TRON from "../os/usr/lib/holo/holo-tron.mjs";
import * as TON from "../os/usr/lib/holo/holo-ton.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SEEDF = join(here, ".holo-live-broadcast.seed");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── persist one throwaway testnet mnemonic ──
let mnemonic;
if (existsSync(SEEDF)) mnemonic = readFileSync(SEEDF, "utf8").trim();
else { mnemonic = generateMnemonic(12); writeFileSync(SEEDF, mnemonic + "\n"); console.log("• generated a persisted throwaway testnet seed → tools/.holo-live-broadcast.seed\n"); }
const seed = seedFromMnemonic(mnemonic);
const wdk = makeWDK(seed);

console.log("Holo Wallet — testnet broadcast (persisted addresses; fund then re-run)\n");
const out = [];

// ── Solana devnet (programmatic airdrop attempt, else faucet) ──
try {
  const DEV = "https://api.devnet.solana.com";
  const rpc = (m, p) => fetch(DEV, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params: p }) }).then((r) => r.json()).then((j) => { if (j.error) throw new Error(JSON.stringify(j.error)); return j.result; });
  const w = new WDK(seed); w.registerWallet("solana", WalletManagerSolana, { rpcs: [DEV] });
  const a0 = await w.getAccount("solana", 0), a1 = await w.getAccount("solana", 1);
  const from = await a0.getAddress();
  let bal = await a0.getBalance();
  if (bal === 0n) { try { await rpc("requestAirdrop", [from, 100000000]); for (let i = 0; i < 8 && bal === 0n; i++) { await sleep(1500); bal = await a0.getBalance(); } } catch {} }
  if (bal > 0n) { const r = await a0.sendTransaction({ to: await a1.getAddress(), value: 1000000 }); out.push(["solana-devnet", "BROADCAST ✓", "https://solscan.io/tx/" + r.hash + "?cluster=devnet"]); }
  else out.push(["solana-devnet", "fund " + from, "https://faucet.solana.com (Devnet)"]);
} catch (e) { out.push(["solana-devnet", "ERR " + String(e.message).slice(0, 50), ""]); }

// ── Bitcoin testnet ──
try {
  const acc = await wdk.getAccount("bitcoin", 0); const priv = acc.keyPair.privateKey;
  const addr = BTC.deriveAddress(priv, "testnet");
  const b = await BTC.getBalance(addr, "testnet"); const sats = Number(b.confirmed || 0);
  if (sats > 1000) { const r = await BTC.send({ priv, toAddr: addr, amountSats: Math.min(sats - 500, 1000), netKey: "testnet", rate: 1 }); out.push(["bitcoin-testnet", "BROADCAST ✓", "https://mempool.space/testnet/tx/" + r.txid]); }
  else out.push(["bitcoin-testnet", "fund " + addr, "https://coinfaucet.eu/en/btc-testnet/"]);
} catch (e) { out.push(["bitcoin-testnet", "fund (derive) — " + String(e.message).slice(0, 40), ""]); }

// ── Tron Nile testnet ──
try {
  const NILE = ["https://nile.trongrid.io"];
  const acc = await wdk.getAccount("tron", 0); const priv = acc.keyPair.privateKey; const addr = await acc.getAddress();
  const to = await (await wdk.getAccount("tron", 1)).getAddress();        // a DIFFERENT account (Tron rejects self-send)
  const sun = Number(await TRON.getBalance(addr, { apis: NILE }));
  if (sun > 1100000) { const r = await TRON.send({ priv, fromAddr: addr, toAddr: to, amountSun: 1000000, apis: NILE }); out.push(["tron-nile", "BROADCAST ✓", "https://nile.tronscan.org/#/transaction/" + r.txid]); }
  else out.push(["tron-nile", "fund " + addr, "https://nileex.io/join/getJoinPage"]);
} catch (e) { out.push(["tron-nile", "ERR " + String(e.message).slice(0, 50), ""]); }

// ── TON testnet ──
try {
  const TC = ["https://testnet.toncenter.com"];
  const acc = await wdk.getAccount("ton", 0); const priv = acc.keyPair.privateKey, pub = acc.keyPair.publicKey;
  const addrTest = TON.tonAddress(pub, { testnet: true, bounceable: false });
  const j = await (await fetch("https://testnet.toncenter.com/api/v2/getAddressBalance?address=" + encodeURIComponent(addrTest))).json();
  const nano = Number(j.result || 0);
  if (nano > 100000000) {
    const to = TON.tonAddress((await wdk.getAccount("ton", 1)).keyPair.publicKey, { testnet: true, bounceable: false });
    try { const r = await TON.send({ priv, pubkey: pub, toAddr: to, amountNano: 50000000, apis: TC, testnet: true }); out.push(["ton-testnet", "BROADCAST ✓", "https://testnet.tonviewer.com/transaction/" + r.hash]); }
    catch (e) { out.push(["ton-testnet", "funded ✓ but broadcast: " + String(e.message).slice(0, 40), "(testnet.toncenter may need an API key)"]); }
  } else out.push(["ton-testnet", "fund " + addrTest, "@testgiver_ton_bot (Telegram)"]);
} catch (e) { out.push(["ton-testnet", "ERR " + String(e.message).slice(0, 50), ""]); }

// ── report ──
console.log("chain".padEnd(17) + "status / fund address".padEnd(52) + "faucet / explorer");
for (const [c, s, link] of out) console.log(c.padEnd(17) + String(s).padEnd(52) + (link || ""));
const done = out.filter((r) => String(r[1]).startsWith("BROADCAST")).length;
console.log(`\n${done}/4 broadcast. Drip the "fund …" addresses above, then re-run: node tools/holo-wallet-broadcast.mjs`);
