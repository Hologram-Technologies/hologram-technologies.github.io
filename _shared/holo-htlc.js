// holo-htlc.js — the ON-CHAIN settlement leg for Holo Pay. A "send" LOCKS funds in the HoloHTLC contract against
// the payment's hashlock; the recipient WITHDRAWS by revealing the bearer claimSecret (funds go to THEIR address);
// the funder REFUNDS after timeout. This is what makes escrow mode "live" (a real, verifiable on-chain tx) instead
// of the custodial-by-κ ledger. Keys never leave the wallet — every call rides `acc.sendTransaction`, which the
// wallet gates with its own payload-bound biometric.
//
// Swaps are keyed by the hashlock itself (Holo Pay's `intent.hashlock` is random per payment), so no swapId is
// derived. Calldata is built with the WDK's minimal ABI encoder (encodeCall) — every arg is one static word, which
// is why the contract takes `bytes32 preimage` (the 32-char claimSecret fits exactly) rather than dynamic bytes.
import { encodeCall } from "./holo-eth.js";

const ZERO = "0x0000000000000000000000000000000000000000";
const GAS = "0x493e0";   // 300000 — contract calls need well above the 21000 the WDK defaults to for plain transfers
const _0x = (h) => (String(h || "").startsWith("0x") ? String(h) : "0x" + String(h));
const _hexValue = (n) => "0x" + BigInt(n).toString(16);   // EIP-1559 value field (hex, no leading zeros)
// the bearer claimSecret STRING → its raw bytes as a bytes32 word (Holo Pay secrets are 32 ASCII chars = 32 bytes)
function preimageWord(claimSecret) {
  const bytes = new TextEncoder().encode(String(claimSecret));
  if (bytes.length > 32) throw new Error("claimSecret too long for bytes32");
  let hex = ""; for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return "0x" + hex.padEnd(64, "0");   // right-pad so a <32-byte secret still lands in the high bytes (sha256 must match how the hashlock was formed)
}

// FUND: lock `amount` (base units, BigInt/number) against `hashlock`, refundable at `timeout` (unix seconds).
// ERC-20 → approve(htlc, amount) then newSwap; native (token null/zero) → newSwap with value. Returns {tx, swapId, live}.
export async function htlcFund(acc, { htlc, hashlock, timeout, token = null, amount }) {
  if (!htlc) throw new Error("no HTLC contract for this chain");
  const hl = _0x(hashlock);
  const amt = BigInt(amount);
  const isNative = !token || token === ZERO;
  if (!isNative) {
    await acc.sendTransaction({ to: token, value: "0x0", gas: GAS, data: _0x(encodeCall("approve(address,uint256)", [htlc, amt])) });   // let the HTLC pull the tokens
    const r = await acc.sendTransaction({ to: htlc, value: "0x0", gas: GAS, data: _0x(encodeCall("newSwap(bytes32,uint256,address,uint256)", [hl, BigInt(timeout), token, amt])) });
    return { tx: r.hash, swapId: hl, live: true };
  }
  const r = await acc.sendTransaction({ to: htlc, value: _hexValue(amt), gas: GAS, data: _0x(encodeCall("newSwap(bytes32,uint256,address,uint256)", [hl, BigInt(timeout), ZERO, amt])) });
  return { tx: r.hash, swapId: hl, live: true };
}

// CLAIM: reveal the preimage → funds settle to the claimer's (acc's) address on-chain. Returns {tx}.
export async function htlcClaim(acc, { htlc, hashlock, preimage }) {
  if (!htlc) throw new Error("no HTLC contract for this chain");
  const r = await acc.sendTransaction({ to: htlc, value: "0x0", gas: GAS, data: _0x(encodeCall("withdraw(bytes32,bytes32)", [_0x(hashlock), preimageWord(preimage)])) });
  return { tx: r.hash };
}

// REFUND: funder reclaims after timeout. Returns {tx}.
export async function htlcRefund(acc, { htlc, hashlock }) {
  if (!htlc) throw new Error("no HTLC contract for this chain");
  const r = await acc.sendTransaction({ to: htlc, value: "0x0", gas: GAS, data: _0x(encodeCall("refund(bytes32)", [_0x(hashlock)])) });
  return { tx: r.hash };
}

// The deployed HoloHTLC address for a chain, from the artifact (empty string → not deployed → stay custodial).
export function htlcAddressFor(chain, artifact) { const a = artifact && artifact.addresses && artifact.addresses[chain]; return a && /^0x[0-9a-fA-F]{40}$/.test(a) ? a : null; }

// READ (no gate, no key): does a swap exist for this hashlock? Reveals live vs custodial to the recipient by reading
// the chain itself (tamper-proof), so the link needn't carry a "live" hint. Plain JSON-RPC eth_call so it runs in a
// bare browser too. Returns { found:boolean }. swaps(bytes32) → (funder,token,amount,timeout,withdrawn,refunded);
// funder == 0 ⇒ no swap.
export async function readSwap({ rpcUrl, htlc, hashlock, fetchImpl = null }) {
  if (!rpcUrl || !htlc) return { found: false };
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null); if (!f) return { found: false };
  const data = _0x(encodeCall("swaps(bytes32)", [_0x(hashlock)]));
  try {
    const res = await f(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: htlc, data }, "latest"] }) });
    const j = await res.json(); const out = j && j.result;
    if (!out || out === "0x") return { found: false };
    const funderWord = String(out).replace(/^0x/, "").slice(0, 64);   // first return word = funder (left-padded address)
    return { found: /[1-9a-f]/.test(funderWord) };
  } catch { return { found: false }; }
}
