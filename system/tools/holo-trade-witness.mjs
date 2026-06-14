// holo-trade-witness.mjs — the write-side proof of ADR-0070 (Holo Trade).
//
// Proves, with the REAL vendored SDK and the REAL Hologram exchange layer, that the signed write
// side is correct and UOR-native — WITHOUT moving a cent of real money:
//   1. the sealed SDK + venue descriptors re-derive (Law L5; a tampered byte is refused)
//   2. signing is deterministic (same action+nonce+key → same signature)
//   3. tamper-binding (change one field → a different signature)
//   4. the conscience gate BLOCKS an over-limit order BEFORE any signature exists (ADR-0033)
//   5. ATTENUATION: an agent-scoped wallet is refused any fund-moving action (defence in depth)
//   6. the PROV-O trade receipt re-derives (Law L5)
//   7. SPEC-CORRECTNESS, fund-free: a signed order POSTed to Hyperliquid TESTNET makes the venue
//      recover OUR EXACT address (it echoes it in "… does not exist") — end-to-end proof that the
//      msgpack → phantom-agent EIP-712 → secp256k1 chain matches the venue's own implementation.
//
// No mainnet, no funds, no real orders. Network check (7) is best-effort and SKIPs offline.

import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { jcs, sha256hex, didHolo } from "../os/usr/lib/holo/holo-uor.mjs";

const APPS = process.env.HOLO_APPS || "C:/Users/pavel/Desktop/Hologram Apps";
const VEND = join(APPS, "apps", "trade", "_shared", "vendor");
const SHARED = join(APPS, "apps", "trade", "_shared");
const url = (p) => pathToFileURL(p).href;

const { HoloHyperliquid, SDK } = await import(url(join(SHARED, "holo-hyperliquid-exchange.mjs")));
const { screen } = await import(url(join(SHARED, "holo-hl-conscience.mjs")));
const sealκ = (body) => didHolo("sha256", sha256hex(jcs(body)));

const ok = []; const fail = [];
const check = (n, pass, d = "") => { (pass ? ok : fail).push(n); console.log(`  ${pass ? "✓" : "✗"} ${n}${d ? " — " + d : ""}`); };

console.log("\nHolo Trade — write-side witness (ADR-0070): signed exchange, UOR-native, fund-free\n");

// 1. sealed descriptors re-derive
const sdkDesc = JSON.parse(readFileSync(join(VEND, "hyperliquid-sdk.uor.json"), "utf8"));
const bundleSha = sha256hex(readFileSync(join(VEND, "hyperliquid-sdk.mjs")));
check("vendored SDK bundle re-derives to its sealed κ", bundleSha === sdkDesc["hostrade:sealedBody"].bundleSha256 && sealκ(sdkDesc["hostrade:sealedBody"]) === sdkDesc.head, sdkDesc.head.slice(0, 28) + "…");
const venueDesc = JSON.parse(readFileSync(join("C:/Users/pavel/Desktop/Hologram OS2/system/os/etc/holo-chains/hyperliquid.uor.json"), "utf8"));
check("venue descriptor re-derives to its sealed κ", sealκ(venueDesc["hostrade:sealedBody"]) === venueDesc.head, venueDesc.head.slice(0, 28) + "…");

// a throwaway agent wallet (NO funds, NO account) — used only to produce/verify signatures
const wallet = SDK.agentWallet("0x" + randomBytes(32).toString("hex"));
const limits = { scope: "agent", maxNotionalUsd: 10000, maxLeverage: 20 };
const hl = new HoloHyperliquid({ wallet, testnet: true, limits });
const smallOrder = { a: 0, isBuy: true, px: "1000", sz: "0.001", tif: "Gtc" };          // $1 notional — within limits

// 2. deterministic signing
const p1 = await hl.previewOrder(smallOrder, "na", 1700000000000);
const p2 = await hl.previewOrder(smallOrder, "na", 1700000000000);
check("signing is deterministic", JSON.stringify(p1.intent.signature) === JSON.stringify(p2.intent.signature));

// 3. tamper-binding
const p3 = await hl.previewOrder({ ...smallOrder, sz: "0.002" }, "na", 1700000000000);
check("tamper-binding: a changed field → a different signature", JSON.stringify(p3.intent.signature) !== JSON.stringify(p1.intent.signature));

// 4. conscience blocks an over-limit order BEFORE signing
let blocked = false, signedAnyway = false;
try { await hl.previewOrder({ a: 0, isBuy: true, px: "5000", sz: "10", tif: "Gtc" }); signedAnyway = true; }   // $50k > $10k cap
catch (e) { blocked = /conscience gate/.test(e.message); }
check("conscience gate blocks an over-limit order (no signature produced)", blocked && !signedAnyway);

// 5. attenuation — agent scope may not move funds
const wd = screen({ type: "withdraw3", destination: "0x0", amount: "1" }, { scope: "agent" });
check("attenuation: agent wallet is refused fund movement (withdraw3)", wd.allow === false);
const wdMaster = screen({ type: "withdraw3", destination: "0x0", amount: "1" }, { scope: "master", allowFundMovement: true });
check("attenuation is scoped: a master wallet may withdraw", wdMaster.allow === true);

// 6. the trade receipt re-derives (PROV-O, Law L5)
const { id, ...body } = p1.receipt;
const reκ = "did:holo:sha256:" + sha256hex(jcs(body));
check("PROV-O trade receipt re-derives", reκ === id, id.slice(0, 28) + "…");

// 7. fund-free SPEC-CORRECTNESS against Hyperliquid testnet (best-effort; SKIPs offline)
try {
  await hl.order(smallOrder);                                    // signs + POSTs to testnet
  check("testnet accepted a fresh-key order (unexpected)", false, "expected an account-level rejection");
} catch (e) {
  const msg = String(e?.message || e).toLowerCase();
  const mine = wallet.address.toLowerCase();
  const recovered = msg.includes(mine);
  const reachable = /does not exist|insufficient|margin|multi-sig|builder|minimum/.test(msg);
  if (!reachable && /network|fetch|enotfound|timeout|getaddrinfo/.test(msg)) console.log("  ~ testnet unreachable — spec-correctness check SKIPPED (offline)");
  else check("testnet recovered OUR address from the signature (spec-correct, fund-free)", recovered, recovered ? wallet.address : msg.slice(0, 80));
}

console.log(`\n${fail.length ? "FAIL" : "PASS"} — ${ok.length}/${ok.length + fail.length} checks${fail.length ? " · failed: " + fail.join(", ") : ""}\n`);
process.exit(fail.length ? 1 : 0);
