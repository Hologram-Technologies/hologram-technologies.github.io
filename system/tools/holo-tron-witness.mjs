// holo-tron-witness.mjs — proves the Tron wallet: base58check (validated against the on-chain USDT-TRC20
// contract address), secp256k1→0x41→base58 derivation, address codecs, and the verify-before-sign guard
// (a node-built tx whose recipient/amount/txID don't match intent is REFUSED before the key signs). Plus
// holo-wdk integration (deriveAddress + makeWDK register tron). Network-free.
//
//   node system/tools/holo-tron-witness.mjs

import { base58check, base58checkDecode, addrToHex20, addrToHex41, tronAddress, verifyBuiltTx, send } from "../os/usr/lib/holo/holo-tron.mjs";
import { deriveAddress, makeWDK, generateMnemonic, seedFromMnemonic } from "../os/usr/lib/holo/holo-wdk.js";
import { sha256, secp256k1 } from "../os/usr/lib/holo/wdk-crypto/wdk-crypto.bundle.mjs";
import { hexToBytes, bytesToHex } from "../os/usr/lib/holo/holo-eth.js";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { (c ? pass++ : fail++); console.log(`  ${c ? "✓" : "✗"} ${n}${d ? " — " + d : ""}`); };

console.log("Holo Tron — secp256k1 wallet, base58check, verify-before-sign\n");

// 1) base58check validated against a KNOWN on-chain vector (the USDT-TRC20 contract).
ok("base58check matches the known USDT-TRC20 contract address",
  base58check(hexToBytes("0x41a614f803b6fd780986a42c78ec9c7f77e6ded13c")) === "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t");
ok("addrToHex41/20 decode the address back", addrToHex41("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t") === "41a614f803b6fd780986a42c78ec9c7f77e6ded13c" && addrToHex20("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t") === "a614f803b6fd780986a42c78ec9c7f77e6ded13c");

// 2) derivation produces a valid T-address; same secp256k1 key as EVM (different encoding only).
const priv = secp256k1.utils.randomSecretKey();
const addr = tronAddress(priv);
ok("tronAddress derives a well-formed T-address", /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr), addr);

// 3) holo-wdk integration: deriveAddress("tron") + makeWDK registers a tron manager.
const seed = seedFromMnemonic(generateMnemonic(12));
const tAddr = deriveAddress("tron", seed, 0);
ok("holo-wdk deriveAddress('tron') yields a T-address (BIP-44 m/44'/195')", /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(tAddr), tAddr);
const wdk = makeWDK(seed, { chains: ["tron"] });
const acc = await wdk.getAccount("tron", 0);
ok("makeWDK registers the tron wallet manager", (await acc.getAddress()) === tAddr);

// 4) verify-before-sign: build a consistent fixture, then prove each tamper is refused.
const TO = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE", FROM = tAddr;
const rawHex = "0a02abcd2208deadbeefdeadbeef40c8d8";   // arbitrary raw_data bytes
const txID = bytesToHex(sha256(hexToBytes("0x" + rawHex))).slice(2);
const goodTx = { txID, raw_data_hex: rawHex, raw_data: { contract: [{ parameter: { value: { to_address: TO, amount: 1000000, owner_address: FROM } } }] } };
ok("a built tx that matches intent passes verify", verifyBuiltTx(goodTx, { toAddr: TO, amountSun: 1000000 }) === true);
const refuse = (mut, label) => { let t = false; try { verifyBuiltTx(mut, { toAddr: TO, amountSun: 1000000 }); } catch { t = true; } ok(label, t); };
refuse({ ...goodTx, raw_data: { contract: [{ parameter: { value: { to_address: "TXXdifferentRecipientXXXXXXXXXXXXXXX", amount: 1000000 } } }] } }, "a tx paying a DIFFERENT recipient is refused");
refuse({ ...goodTx, raw_data: { contract: [{ parameter: { value: { to_address: TO, amount: 9999999 } } }] } }, "a tx with a DIFFERENT amount is refused");
refuse({ ...goodTx, txID: "deadbeef".repeat(8) }, "a tx whose txID ≠ sha256(raw_data) is refused");

// 5) send(): createtransaction → verify → sign → broadcast (happy path); and refuse a mismatched node tx.
{
  let broadcasted = null;
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    if (url.includes("/createtransaction")) return { json: async () => goodTx };
    if (url.includes("/broadcasttransaction")) { broadcasted = body; return { json: async () => ({ result: true }) }; }
    return { json: async () => ({}) };
  };
  const r = await send({ priv, fromAddr: FROM, toAddr: TO, amountSun: 1000000, apis: ["http://x"], fetchImpl });
  ok("send signs + broadcasts a verified tx", r.txid === txID && broadcasted && Array.isArray(broadcasted.signature) && /^[0-9a-f]{130}$/.test(broadcasted.signature[0]));
}
{
  let broadcasted = false;
  const evilTx = { ...goodTx, raw_data: { contract: [{ parameter: { value: { to_address: "TEVILdrainerXXXXXXXXXXXXXXXXXXXXXXX", amount: 1000000 } } }] } };
  const fetchImpl = async (url) => { if (url.includes("/createtransaction")) return { json: async () => evilTx }; broadcasted = true; return { json: async () => ({ result: true }) }; };
  let threw = false; try { await send({ priv, fromAddr: FROM, toAddr: TO, amountSun: 1000000, apis: ["http://x"], fetchImpl }); } catch { threw = true; }
  ok("a node that builds a DIFFERENT recipient never gets signed/broadcast", threw && broadcasted === false);
}

console.log(`\n${fail ? "WITNESS FAILED" : "WITNESSED ✓"}  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
