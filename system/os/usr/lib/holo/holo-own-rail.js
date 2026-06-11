// holo-own-rail.js — wire Holo Own (ADR-053) to the REAL chain kit, behind the Holo Wallet's
// default-deny, human-approval gate. This is the "real web3" layer: ADR-053 proved the ownership
// SEMANTICS with a mocked rail; this feeds them the actual wallet so anchoring + settlement hit a
// live chain — all EXISTING stack (holo-wallet-bridge → prism-btc · holo-eth/evm · holo-solana ·
// wdk), no new chain, no parallel ledger (Law L4). A holospace can never move value on its own:
// every commit/pay is a human-approved request to the running wallet, or it errors.
//
// A "rail" is the seam holo-own.anchor(headκ, chain, rail) and settleVia(...) consume:
//   rail.commit(headκ, chain) → a signed on-chain attestation of the head (anchor; "anchor wins").
//   rail.pay(chain, to, amount) → a real transfer; its tx hash is the settlement txid.

const ANCHOR = "https://hologram.os/ns/own#Anchor";

// walletRail(): the real rail. commit signs the head κ as a message (a verifiable, human-approved
// commitment); pay sends value — both through holo-wallet-bridge (the OS-wide signing seam).
export function walletRail({ chain = "ethereum" } = {}) {
  return {
    chain,
    async commit(headKappa, c = chain) {
      const { requestSignMessage } = await import("./holo-wallet-bridge.js");
      const { signature } = await requestSignMessage(c, "holo:anchor:" + headKappa);
      return { "@type": ANCHOR, chain: c, headKappa, txid: signature, attestation: signature };
    },
    async pay(c, to, amount) {
      const { requestSend } = await import("./holo-wallet-bridge.js");
      const { hash } = await requestSend(c, to, String(amount));
      return { chain: c, to, amount, txid: hash };
    },
  };
}

// mockRail(): the same shape, offline + deterministic — never touches a chain (Node/CI/witness).
export function mockRail() {
  return {
    chain: "mock",
    async commit(headKappa, c = "mock") { const t = "mock:sig:" + String(headKappa).slice(-16); return { "@type": ANCHOR, chain: c, headKappa, txid: t, attestation: t }; },
    async pay(c, to, amount) { return { chain: c, to, amount, txid: "mock:tx:" + String(to).slice(-8) + ":" + amount }; },
  };
}

// declineRail(): a wallet that refuses (none open, or the human declined) — proves default-deny.
export function declineRail() {
  return { chain: "decline", async commit() { throw new Error("Holo Wallet declined"); }, async pay() { throw new Error("Holo Wallet declined"); } };
}

// settleVia(own, { order, chain }, rail): release a settlement voucher against a PROVEN Title
// (ADR-048 — verifyChain inside settle), then move real value via the rail; bind the tx to the
// voucher. A tampered/unproven Title settles nothing AND pays nothing (no value leaves on bad proof).
export async function settleVia(own, { order, chain }, rail, payTo) {
  const voucher = await own.settle({ order, chain });
  if (!voucher) return null;                                          // unproven ⇒ nothing released, nothing paid
  const cur = (order.amount && order.amount.currency) || rail.chain || "ethereum";
  const payment = await rail.pay(cur, payTo || voucher.payee, order.amount && order.amount.value);
  return { ...voucher, payment, txid: payment.txid };
}
