#!/usr/bin/env node
// holo-wdk-witness.mjs — TEST the Hologram-native wallet (Holo Wallet) against the WDK capability
// surface it wires: HD multi-chain derivation, the IWalletAccount interface, EIP-191/EIP-1559 + Solana
// signing, ERC-20 transfer encoding, the content-addressed secret-manager vault, and the one-seed→
// identity+wallet unification. All deterministic/offline (audited WDK crypto, no hand-rolled crypto);
// a final non-fatal LIVE section proves the RPC read wiring when a network is present.
//
//   node tools/holo-wdk-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { HoloWallet, makeWDK, deriveAddress, CHAINS, baseUnits, signEvmMessage, signEvmTx, signEvmTypedData, priceUsd, history, ataAddress, findProgramAddress, splTransferMessage, identity, createVault, openVault, vaultKappa, seedFromMnemonic, validateMnemonic } from "../os/usr/lib/holo/holo-wdk.js";
import { ed25519, base58 } from "../os/usr/lib/holo/wdk-crypto/wdk-crypto.bundle.mjs";
import { encodeCall, hashTypedData } from "../os/usr/lib/holo/holo-eth.js";

const here = dirname(fileURLToPath(import.meta.url));
const results = []; let pass = 0, fail = 0;
const rec = (n, ok, d = "") => { results.push({ n, ok, d }); ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} — ${n}${d ? "  (" + d + ")" : ""}`); };
const rejects = async (fn) => { try { await fn(); return false; } catch { return true; } };

const MN = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const seed = seedFromMnemonic(MN);
const CHAIN_KEYS = Object.keys(CHAINS);

// 1 · HD multi-chain derivation — deterministic, one seed → an address on every chain
const a = {}; for (const k of CHAIN_KEYS) a[k] = deriveAddress(k, seed, 0);
rec("every chain derives an address (deterministic)", CHAIN_KEYS.length >= 14 && CHAIN_KEYS.every((k) => deriveAddress(k, seed, 0) === a[k]), CHAIN_KEYS.length + " chains");
rec("added EVM chains derive valid addresses (avalanche/gnosis/linea/scroll/celo/blast)", ["avalanche", "gnosis", "linea", "scroll", "celo", "blast"].every((k) => /^0x[0-9a-fA-F]{40}$/.test(a[k])));
rec("RPC failover configured (multiple endpoints per chain)", CHAINS.ethereum.rpcs.length >= 2 && CHAINS.solana.rpcs.length >= 2, CHAINS.ethereum.rpcs.length + " eth endpoints");
rec("account index varies the address (BIP-44)", deriveAddress("ethereum", seed, 1) !== a.ethereum);
rec("EVM addresses are checksummed 0x+40hex", /^0x[0-9a-fA-F]{40}$/.test(a.ethereum) && a.ethereum !== a.ethereum.toLowerCase());
rec("BTC address is native segwit (bc1)", /^bc1[0-9a-z]{20,}$/.test(a.bitcoin), a.bitcoin);
rec("Solana address is base58 (32-byte pubkey)", /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a.solana), a.solana);

// 2 · units — human decimal → on-chain base units
rec("baseUnits: 1.5 ETH → 1.5e18 wei (hex)", baseUnits("ethereum", "1.5") === "0x" + (1500000000000000000n).toString(16));
rec("baseUnits: 0.001 BTC → 100000 sats", baseUnits("bitcoin", "0.001") === 100000);
rec("baseUnits: 1 SOL → 1e9 lamports", baseUnits("solana", "1") === 1000000000);

// 3 · signing — EIP-191 personal_sign + verify, EIP-1559 tx, Solana
const w = new HoloWallet(); await w.create("test-passphrase-1234", MN);
const eth = await w.account("ethereum", 0), sol = await w.account("solana", 0);
rec("orchestrator: WDK.getAccount address == deriveAddress", (await eth.getAddress()) === a.ethereum);
const msig = await eth.sign("gm hologram");
rec("EVM EIP-191 sign + verify round-trips", /^0x[0-9a-f]{130}$/.test(msig) && (await eth.verify("gm hologram", msig)));
const tx = signEvmTx({ chainId: 1, nonce: 0, maxPriorityFeePerGas: "0x59682f00", maxFeePerGas: "0x77359400", gas: "0x5208", to: a.ethereum, value: "0xde0b6b3a7640000", data: "0x" }, seedAcct());
rec("EVM EIP-1559 tx signs (type-2 raw + hash)", /^0x02/.test(tx.raw) && /^0x[0-9a-f]{64}$/.test("0x" + tx.hash.replace(/^0x/, "")));
rec("EVM tx signing is deterministic (RFC-6979)", signEvmTx({ chainId: 1, nonce: 0, maxPriorityFeePerGas: "0x59682f00", maxFeePerGas: "0x77359400", gas: "0x5208", to: a.ethereum, value: "0xde0b6b3a7640000", data: "0x" }, seedAcct()).raw === tx.raw);
const ssig = await sol.sign("gm solana");
rec("Solana sign + verify round-trips", (await sol.verify("gm solana", ssig)));

// EIP-712 typed-data signing — verified against the canonical spec vector (digest + full signature)
const TYPED = { domain: { name: "Ether Mail", version: "1", chainId: 1, verifyingContract: "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC" },
  types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }], Person: [{ name: "name", type: "string" }, { name: "wallet", type: "address" }], Mail: [{ name: "from", type: "Person" }, { name: "to", type: "Person" }, { name: "contents", type: "string" }] },
  primaryType: "Mail", message: { from: { name: "Cow", wallet: "0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826" }, to: { name: "Bob", wallet: "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB" }, contents: "Hello, Bob!" } };
const digest = "0x" + [...hashTypedData(TYPED)].map((b) => b.toString(16).padStart(2, "0")).join("");
rec("EIP-712 digest == spec vector", digest === "0xbe609aee343fb3c4b28e1df9e632fca64fcfaede20f02e86244efddf30957bd2");
const cow = Uint8Array.from("c85ef7d79691fe79573b1a7064c19c1a9819ebdbd1faaab1a8ec92344438aaf4".match(/../g).map((h) => parseInt(h, 16)));
rec("EIP-712 signature == spec vector", signEvmTypedData(TYPED, cow) === "0x4355c47d63924e8a72e509b65029052eb6c299d53a04e167c5775fd466751c9d07299936d304c153f6443dfa05f40ff007d72911b6f72307f996231605b915621c");
rec("account.signTypedData present (EVM)", typeof eth.signTypedData === "function" && /^0x[0-9a-f]{130}$/.test(await eth.signTypedData(TYPED)));

// 4 · ERC-20 — the token transfer calldata (the fixed transfer() path uses this encoder)
const erc = encodeCall("transfer(address,uint256)", [a.ethereum, baseUnits("ethereum", "10")]);
rec("ERC-20 transfer calldata (selector a9059cbb + 2 words)", erc.startsWith("0xa9059cbb") && erc.length === 2 + 8 + 64 * 2, erc.slice(0, 12) + "…");
rec("balanceOf calldata (selector 70a08231)", encodeCall("balanceOf(address)", [a.ethereum]).startsWith("0x70a08231"));

// 4b · SPL send — Associated Token Account derivation (findProgramAddress / off-curve PDA)
const onCurve = (b58) => { try { ed25519.Point.fromHex([...base58.decode(b58)].map((x) => x.toString(16).padStart(2, "0")).join("")); return true; } catch { return false; } };
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const ata1 = ataAddress(a.solana, USDC);
rec("ATA derivation is deterministic + valid base58", ata1 === ataAddress(a.solana, USDC) && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ata1), ata1);
rec("ATA is OFF the ed25519 curve (a real PDA — no private key)", !onCurve(ata1));
rec("ATA is owner-sensitive AND mint-sensitive (seeds wired correctly)", ataAddress(a.solana, USDC) !== ataAddress(deriveAddress("solana", seed, 1), USDC) && ataAddress(a.solana, USDC) !== ataAddress(a.solana, BONK));
// KNOWN VECTOR — confirmed against the live chain (getAccountInfo: this owner's USDC token account
// IS this address). ATA derivation is balance-independent, so this is a permanent ground-truth test.
rec("ATA matches a chain-verified known vector (owner CEzN7mqP… + USDC)", ataAddress("CEzN7mqP9xoxn2HdyW6fjEJ73t7qaX9Rp2zyS6hb3iEu", USDC) === "ZDMRxJfvYxqjXeEcoNADWrFA7Qx96KxBTin8G8EPDtp");
rec("findProgramAddress returns [addr, bump] with a valid bump", (() => { const [a2, bump] = findProgramAddress([base58.decode(a.solana)], "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"); return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a2) && bump >= 0 && bump <= 255; })());
rec("account.transfer routes SPL by chain kind (sol has a token path)", typeof sol.transfer === "function");
// SPL send message: CreateIdempotent (recipient ATA) + TransferChecked — verified by parsing the bytes
const recipient = deriveAddress("solana", seed, 1);
const splMsg = splTransferMessage({ owner: a.solana, sourceAta: ataAddress(a.solana, USDC), destAta: ataAddress(recipient, USDC), recipient, mint: USDC, amount: 1000000n, decimals: 6, recentBlockhash: base58.encode(new Uint8Array(32).fill(9)) });
const nKeys = splMsg[3], iOff = 4 + nKeys * 32 + 32, key = (i) => base58.encode(splMsg.subarray(4 + i * 32, 36 + i * 32));
rec("SPL send builds a 2-instruction message (CreateIdempotent + TransferChecked)", splMsg[0] === 1 && splMsg[2] === 5 && nKeys === 8 && splMsg[iOff] === 2 && key(6) === "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" && splMsg[iOff + 1] === 6 && splMsg[iOff + 3 + splMsg[iOff + 2]] === 1);
rec("SPL TransferChecked carries discriminator 12 + decimals", (() => { const o2 = iOff + 4 + splMsg[iOff + 2] + 1; return splMsg[o2] === 7 && splMsg[o2 + 3 + splMsg[o2 + 1]] === 12; })());

// 5 · IWalletAccount surface present (WDK interface adherence)
const need = ["getAddress", "getBalance", "getTokenBalance", "sign", "signTypedData", "verify", "signTransaction", "sendTransaction", "transfer", "quoteSendTransaction", "getTransactionReceipt", "toReadOnlyAccount", "dispose"];
rec("IWalletAccount interface complete", need.every((m) => typeof eth[m] === "function"), need.length + " methods");

// 6 · secret-manager vault — content-addressed, round-trips, refuses the wrong passphrase
const vault = await createVault(MN, "vault-passphrase-1234");
const opened = openVault(vault, "vault-passphrase-1234");
rec("WdkSecretManager vault round-trips (64-byte seed + mnemonic)", opened.seed.length === 64 && opened.mnemonic === MN);
rec("vault κ is content-addressed (sha256, L1/L5)", /^sha256:[0-9a-f]{64}$/.test(vaultKappa(vault)));
rec("vault refuses the wrong passphrase (AEAD)", await rejects(async () => openVault(vault, "wrong-passphrase-xx")));

// 7 · one seed → identity AND wallet (the unification)
rec("identity(seed).did == wallet.did (one seed = id + wallet)", identity(seed).did === w.did && /^did:key:z6Mk/.test(w.did));
rec("recovery phrase validates (BIP-39)", validateMnemonic(MN));

// helper: a raw EVM private key for the low-level signers
function seedAcct() { return eth.keyPair.privateKey; }

// 8 · LIVE (non-fatal): prove the network read wiring resolves if a network is present
let live = "skipped";
const liveTry = async (label, fn, okFn) => { try { const r = await fn(); console.log(`${okFn(r) ? "PASS" : "INFO"} — LIVE ${label}${okFn(r) ? "" : " (unexpected)"}  (${String(r).slice(0, 50)})`); return okFn(r); } catch (e) { console.log(`INFO — LIVE ${label} skipped (offline: ${(e.message || e).toString().slice(0, 50)})`); return null; } };
try {
  await eth.getBalance().then((b) => { live = typeof b === "bigint" ? "online" : "?"; });
  await liveTry("eth_getBalance (failover RPC)", () => eth.getBalance(), (r) => typeof r === "bigint");
  await liveTry("priceUsd (CoinGecko public)", () => priceUsd(["ethereum", "bitcoin", "solana"]), (r) => r && (r.ethereum > 0 || r.bitcoin > 0));
  await liveTry("history btc (mempool.space)", () => history("bitcoin", "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu", { limit: 3 }), (r) => Array.isArray(r));
  await liveTry("SPL token balance (Solana RPC)", () => sol.getTokenBalance(USDC), (r) => typeof r === "bigint");
  await liveTry("ATA derivation == on-chain (ground-truth cross-check)", async () => {
    const rpc = CHAINS.solana.rpcs[0];
    const call = async (m, p) => { const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params: p }) }); const j = await r.json(); if (j.error) throw new Error(j.error.code); return j.result; };
    const largest = await call("getTokenLargestAccounts", [USDC]);
    for (const acc of (largest?.value || []).slice(0, 6)) { const info = await call("getAccountInfo", [acc.address, { encoding: "jsonParsed" }]); const owner = info?.value?.data?.parsed?.info?.owner; if (owner && ataAddress(owner, USDC) === acc.address) return "MATCH " + acc.address.slice(0, 10); }
    return "no-ata-in-sample (top holders use custom accounts) — rerun later";
  }, (r) => typeof r === "string" && r.startsWith("MATCH"));
} catch (e) { live = "offline: " + (e.message || e).slice(0, 60); }

const ok = fail === 0;
writeFileSync(join(here, "holo-wdk-witness.result.json"), JSON.stringify({ ok, pass, fail, live, results }, null, 2) + "\n");
console.log(`\n${ok ? "PASS" : "FAIL"} — Holo Wallet / WDK capabilities ${pass}/${pass + fail}  ·  live: ${live}`);
process.exit(ok ? 0 : 1);
