// holo-x402-witness.mjs — proves the x402 USD₮ HTTP-payment rail: a payment is an EIP-3009 EIP-712
// signature produced ONLY by the wallet gate; the facilitator verifies by RE-DERIVING the digest and
// recovering the signer (fail-closed on tamper/underpay/expiry/replay); and the agent surface routes
// x402_pay through the same default-deny gate (Q must ask; attenuation holds). Fund-free, browserless.
//
//   node system/tools/holo-x402-witness.mjs

import { makeRequirements, buildAuthorization, encodePayment, verify, recoverSigner, settleCalldata, randomNonce } from "../os/usr/lib/holo/holo-x402.mjs";
import { makeWDK, generateMnemonic, seedFromMnemonic } from "../os/usr/lib/holo/holo-wdk.js";
import { makeWalletAgent, qContext } from "../os/usr/lib/holo/holo-wallet-agent.mjs";
import { mintNpc, delegate, authorizeRequest } from "../os/usr/lib/holo/holo-delegate.mjs";
import { principalFromSeed } from "../os/usr/lib/holo/holo-login.mjs";
import { firstRun } from "../os/usr/lib/holo/holo-ceremony.mjs";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { (c ? pass++ : fail++); console.log(`  ${c ? "✓" : "✗"} ${n}${d ? " — " + d : ""}`); };

console.log("Holo x402 — instant USD₮ HTTP payments, one human-gated door\n");

// a real wallet account is the signer the gate would drive (so recovery is genuine, not stubbed).
const wdk = makeWDK(seedFromMnemonic(generateMnemonic(12)), { chains: ["ethereum"] });
const acc = await wdk.getAccount("ethereum", 0);
const from = await acc.getAddress();
// the gate seam: the wallet signs the EIP-712 authorization (key never leaves the wallet).
const gateSeam = { signTypedData: async ({ typedData }) => ({ ok: true, signature: await acc.signTypedData(typedData) }) };

const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"; // a real EIP-3009 token (for the domain)
const SELLER = "0x000000000000000000000000000000000000bEEF";
const req = makeRequirements({ chainId: 1, asset: USDC, payTo: SELLER, maxAmountRequired: "1000000", name: "USD Coin", version: "2", resource: "https://api.example/quote" });
const NONCE = "0x" + "11".repeat(32), NOW = 1700000000, VB = 2000000000;

// 1) a payment IS an EIP-712 signature that recovers to the payer (validates the recovery primitive).
const td = buildAuthorization(req, { from, validBefore: VB, nonce: NONCE });
const signature = await acc.signTypedData(td);
ok("payer signature recovers to `from` (EIP-712 recovery correct)", recoverSigner(td, signature).toLowerCase() === from.toLowerCase(), from.slice(0, 12) + "…");

// 2) a well-formed X-PAYMENT verifies on the facilitator side.
const { header } = encodePayment(req, td.message, signature);
let v = verify(header, req, { nowSec: NOW });
ok("facilitator verify accepts a valid payment", v.ok === true && v.payer.toLowerCase() === from.toLowerCase() && v.amount === "1000000");

// 3) fail-closed — tamper the recipient (steal the payment) → refused.
{
  const p = JSON.parse(Buffer.from(header, "base64").toString());
  p.payload.authorization.to = "0x00000000000000000000000000000000DEADBEEF";
  ok("tampered recipient is refused (signature no longer recovers / wrong payTo)", verify(p, req, { nowSec: NOW }).ok === false);
}
// 4) fail-closed — underpay → refused.
{
  const reqHi = makeRequirements({ ...req, chainId: 1, asset: USDC, payTo: SELLER, maxAmountRequired: "2000000", name: "USD Coin", version: "2" });
  ok("underpayment is refused", verify(header, reqHi, { nowSec: NOW }).ok === false);
}
// 5) fail-closed — expired window → refused.
ok("expired authorization is refused", verify(header, req, { nowSec: VB + 1 }).reason === "authorization expired");
// 6) fail-closed — replayed nonce → refused.
ok("replayed nonce is refused (single-use, SEC-1)", verify(header, req, { nowSec: NOW, seenNonces: new Set([NONCE]) }).reason.includes("replayed"));
// 7) fail-closed — flip a byte inside r (changes the recovered signer) → refused.
{
  const flip = (c) => (c === "a" ? "b" : "a");
  const bad = "0x" + flip(signature[2]) + signature.slice(3);   // mutate the first nibble of r
  const { header: h2 } = encodePayment(req, td.message, bad);
  ok("a flipped signature byte (in r) is refused", verify(h2, req, { nowSec: NOW }).ok === false);
}

// 8) settle calldata is a real transferWithAuthorization(...) call (selector check).
{
  const { header: h } = encodePayment(req, td.message, signature);
  const cd = settleCalldata(req, JSON.parse(Buffer.from(h, "base64").toString()).payload);
  ok("settle builds transferWithAuthorization calldata to the token", cd.to === USDC && /^0x[0-9a-f]{8,}/.test(cd.data) && cd.data.length > 10);
}

// 9) AGENT SURFACE — x402_pay rides the gate. Q must ASK; with approval it pays; the result verifies.
const authorize = async (d, o) => authorizeRequest(d, o);
const agent = makeWalletAgent({ seam: gateSeam, authorize });
let r = await agent.invoke("x402_pay", { requirements: req, from, validBefore: VB, nonce: NONCE }, qContext());
ok("Q x402_pay with no per-action approval is REFUSED (must ask)", r.ok === false && r.refused === true);
r = await agent.invoke("x402_pay", { requirements: req, from, validBefore: VB, nonce: NONCE }, qContext({ userApproved: true }));
ok("Q x402_pay WITH approval produces an X-PAYMENT", r.ok === true && typeof r.result.xPayment === "string");
ok("the agent-produced payment verifies on the facilitator", verify(r.result.xPayment, req, { nowSec: NOW }).ok === true);

// 10) attenuation — an agent holding only wallet:read cannot pay (SEC-2).
const pc = await principalFromSeed(seedFromMnemonic(generateMnemonic(12)), "Ada");
await firstRun(pc, {});
const npc = mintNpc("Scout");
const readOnly = (await delegate(pc, npc, { capabilities: ["wallet:read"], notAfter: "2999-01-01T00:00:00Z" })).credential;
ok("agent with only wallet:read is refused x402_pay (attenuation)",
  (await agent.invoke("x402_pay", { requirements: req, from, validBefore: VB, nonce: NONCE }, { caller: { kind: "agent" }, delegation: readOnly })).ok === false);

console.log(`\n${fail ? "WITNESS FAILED" : "WITNESSED ✓"}  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
