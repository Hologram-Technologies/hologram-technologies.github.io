// holo-x402.mjs — instant USD₮ payments over HTTP (the x402 protocol), Hologram-native. The agent-economy
// capstone of the wallet's agent surface: an agent (or a human) pays for an HTTP resource by SIGNING a
// stablecoin transfer authorization — no gas, no custodian — and the SAME human-gated door governs it.
//
// First principles (x402 "exact-evm" scheme + holospaces laws):
//   • A payment IS a signature. For an EIP-3009 token (USD₮0 / USDC), paying = an EIP-712
//     `TransferWithAuthorization` signed off-chain. So the payer path is just the wallet's signTypedData
//     seam (capability wallet:spend) — default-deny, biometric-gated, attenuated for agents. No new key path.
//   • Verify by re-derivation, fail closed (L5 / SEC-1): the facilitator/seller NEVER trusts the X-PAYMENT.
//     It RECOVERS the signer from the signature over the exact digest and asserts payTo/amount/asset/window
//     match the 402 requirements, on their own axis, before settling. A forged/altered payload settles nothing.
//   • Replay-safe (SEC-1): the EIP-3009 `nonce` is single-use; verify refuses a seen nonce.
//   • Honest boundary: on-chain settle needs a funded relayer + an EIP-3009 token on a live net — this module
//     builds + verifies + produces the settle calldata, but does NOT fake a broadcast.
//
// Pure + isomorphic: building, signing-shape, recovery, and verification are Node-testable; the only effect
// is the injected `sign` (the wallet gate) and, for settle, an injected sender.

import { hashTypedData, keccak256, toChecksumAddress, bytesToHex, hexToBytes, encodeCall } from "./holo-eth.js";
import { secp256k1 } from "./wdk-crypto/wdk-crypto.bundle.mjs";

const X402_VERSION = 1;
const b64 = (s) => (typeof btoa !== "undefined" ? btoa(s) : Buffer.from(s, "utf8").toString("base64"));
const unb64 = (s) => (typeof atob !== "undefined" ? atob(s) : Buffer.from(s, "base64").toString("utf8"));

// EIP-3009 TransferWithAuthorization — the canonical x402 "exact" payload on EVM.
export const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

// ── seller: a 402 "accepts" requirement. `asset` is the token contract; `name`/`version` are its EIP-712
//    domain (needed so payer and verifier derive the SAME digest). `maxAmountRequired` is base units (string). ──
export function makeRequirements({ scheme = "exact", network, chainId, asset, payTo, maxAmountRequired, resource, description = "", mimeType = "application/json", maxTimeoutSeconds = 60, name, version = "1" }) {
  if (!asset || !payTo || maxAmountRequired == null || !chainId) throw new Error("x402: requirements need asset, payTo, maxAmountRequired, chainId");
  return { scheme, network: network || ("eip155:" + chainId), chainId, asset, payTo, maxAmountRequired: String(maxAmountRequired), resource: resource || null, description, mimeType, maxTimeoutSeconds, extra: { name: name || "USD₮", version } };
}

// ── payer: the typed data to sign (pure, no key). nonce is single-use; pass a fixed one for determinism. ──
export function buildAuthorization(req, { from, validAfter = 0, validBefore, nonce }) {
  if (!from || !nonce) throw new Error("x402: buildAuthorization needs from + nonce");
  if (validBefore == null) throw new Error("x402: validBefore (unix seconds) is required");
  return {
    domain: { name: req.extra.name, version: req.extra.version, chainId: req.chainId, verifyingContract: req.asset },
    types: EIP3009_TYPES,
    primaryType: "TransferWithAuthorization",
    message: { from, to: req.payTo, value: String(req.maxAmountRequired), validAfter: String(validAfter), validBefore: String(validBefore), nonce },
  };
}

// ── the X-PAYMENT header value (base64 JSON) the payer attaches on the retry. ──
export function encodePayment(req, authorization, signature) {
  const payload = { x402Version: X402_VERSION, scheme: req.scheme, network: req.network, payload: { signature, authorization } };
  return { header: b64(JSON.stringify(payload)), payload };
}
export const decodePayment = (header) => JSON.parse(unb64(header));

// ── pay(): the agent/human-callable entry. Builds the authorization, routes it through the INJECTED gate
//    (`sign` = the wallet's gated signTypedData — default-deny, biometric, attenuated), returns X-PAYMENT.
//    The key never leaves the wallet; this module only assembles bytes around the signature. ──
export async function pay(req, { from, sign, validBefore, validAfter = 0, nonce }) {
  const td = buildAuthorization(req, { from, validAfter, validBefore, nonce });
  const signature = await sign(td);                 // ← the human-gated door; throws/denies ⇒ no payment
  if (!signature) throw new Error("x402: payment not authorized");
  const { header, payload } = encodePayment(req, td.message, signature);
  return { xPayment: header, payload, typedData: td, signature };
}

// ── recover the signer from an EIP-712 signature over the typed data (facilitator side, no key). ──
export function recoverSigner(typedData, signature) {
  const digest = hashTypedData(typedData);                          // 32-byte keccak digest (signed directly)
  const h = signature.startsWith("0x") ? signature.slice(2) : signature;
  const rs = hexToBytes("0x" + h.slice(0, 128));                    // r(32) ‖ s(32), compact form
  const v = parseInt(h.slice(128, 130), 16);
  const point = secp256k1.Signature.fromBytes(rs, "compact").addRecoveryBit(v >= 27 ? v - 27 : v).recoverPublicKey(digest);
  const raw = point.toBytes(false).subarray(1);                     // 65-byte uncompressed → drop 0x04 prefix
  return toChecksumAddress(bytesToHex(keccak256(raw)).slice(-40));
}

// ── verify(): the facilitator/seller gate. Re-derives the digest, recovers the signer, and asserts EVERY
//    field against the requirements + the time window + replay. Fail closed. Returns { ok, payer, reason }. ──
export function verify(headerOrPayload, req, { nowSec, seenNonces } = {}) {
  try {
    const p = typeof headerOrPayload === "string" ? decodePayment(headerOrPayload) : headerOrPayload;
    if (p.x402Version !== X402_VERSION) return { ok: false, reason: "unsupported x402 version" };
    if (p.scheme !== req.scheme) return { ok: false, reason: "scheme mismatch" };
    if (p.network !== req.network) return { ok: false, reason: "network mismatch" };
    const a = p.payload.authorization;
    const td = { domain: { name: req.extra.name, version: req.extra.version, chainId: req.chainId, verifyingContract: req.asset }, types: EIP3009_TYPES, primaryType: "TransferWithAuthorization", message: a };
    const payer = recoverSigner(td, p.payload.signature);
    if (payer.toLowerCase() !== String(a.from).toLowerCase()) return { ok: false, reason: "signature does not recover to `from`" };
    if (String(a.to).toLowerCase() !== String(req.payTo).toLowerCase()) return { ok: false, reason: "pays the wrong recipient" };
    if (BigInt(a.value) < BigInt(req.maxAmountRequired)) return { ok: false, reason: "underpaid" };
    const now = nowSec == null ? Math.floor((typeof Date !== "undefined" ? Date.now() : 0) / 1000) : nowSec;
    if (now < Number(a.validAfter)) return { ok: false, reason: "not yet valid" };
    if (now > Number(a.validBefore)) return { ok: false, reason: "authorization expired" };
    if (seenNonces && seenNonces.has(a.nonce)) return { ok: false, reason: "replayed nonce (already settled)" };
    return { ok: true, payer, amount: a.value, asset: req.asset, nonce: a.nonce };
  } catch (e) { return { ok: false, reason: "malformed payment: " + (e && e.message) }; }
}

// ── settle calldata: the on-chain transferWithAuthorization(...) call a relayer broadcasts. Pure builder;
//    broadcasting needs a funded relayer + an EIP-3009 token on a live net (the honest out-of-band step). ──
export function settleCalldata(req, payment) {
  const p = payment && payment.payload && payment.payload.authorization ? payment.payload : payment; // accept the X-PAYMENT envelope OR the inner {signature, authorization}
  const a = p.authorization, h = p.signature.startsWith("0x") ? p.signature.slice(2) : p.signature;
  const r = "0x" + h.slice(0, 64), s = "0x" + h.slice(64, 128), v = parseInt(h.slice(128, 130), 16);
  const data = encodeCall(
    "transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)",
    [a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce, v, r, s]
  );
  return { to: req.asset, data };
}

// random single-use nonce (bytes32 hex) — browser/Node.
export function randomNonce() {
  const u = new Uint8Array(32);
  (typeof crypto !== "undefined" ? crypto : globalThis.crypto).getRandomValues(u);
  return bytesToHex(u);
}

export default { makeRequirements, buildAuthorization, pay, verify, recoverSigner, encodePayment, decodePayment, settleCalldata, randomNonce, EIP3009_TYPES };
