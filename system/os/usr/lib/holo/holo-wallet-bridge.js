// holo-wallet-bridge.js — let ANY holospace ask the running Holo Wallet to sign or send,
// behind its human-approval gate. This is the OS-wide signing seam's CALLER side.
//
// All holospaces share one origin, so a BroadcastChannel("holo-wallet") is the seam: the bridge
// posts a request keyed by a nonce; the Holo Wallet app gates it (the human approves in the same
// consent dialog a person sees) and replies on the channel. Default-deny: if no wallet is open or
// the user declines, the request errors — a holospace can never move value on its own.
//
// Usage (from any app):
//   import { requestSend, requestSignMessage } from "/_shared/holo-wallet-bridge.js";
//   const { hash } = await requestSend("ethereum", "0x…", "0.01");
//   const { signature } = await requestSignMessage("ethereum", "Sign in to dapp");

const CHANNEL = "holo-wallet";

export function requestSignature(request, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const id = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random());
    const bus = new BroadcastChannel(CHANNEL);
    const timer = setTimeout(() => { cleanup(); reject(new Error("Holo Wallet did not respond — is it open and unlocked?")); }, timeoutMs);
    function onMsg(e) { const d = e.data; if (!d || d.type !== "holo-wallet:sign-result" || d.id !== id) return; cleanup(); d.error ? reject(new Error(d.error)) : resolve(d); }
    function cleanup() { clearTimeout(timer); bus.removeEventListener("message", onMsg); bus.close(); }
    bus.addEventListener("message", onMsg);
    bus.postMessage({ type: "holo-wallet:sign-request", id, request });
  });
}

// Convenience wrappers. amount is a human decimal string in the chain's native unit.
// An AGENT (NPC) may pass its capability grant as opts.delegation — the wallet verifies it (must be
// valid, unrevoked, and grant the needed capability) before the human ever sees the consent gate (ADR-0094).
export const requestSend = (chain, to, amount, opts = {}) => requestSignature({ kind: "send", chain, to, amount, token: opts.token, delegation: opts.delegation });
export const requestSignMessage = (chain, message, opts = {}) => requestSignature({ kind: "sign", chain, message, delegation: opts.delegation });

// EIP-712 typed-data signing — the seam Holo Trade signs Hyperliquid actions through: the SDK
// builds the typed data, the WALLET hashes + signs it (the key never leaves the wallet), default-deny.
// Returns { signature } — a 0x{r}{s}{v} hex string the caller hands straight to the SDK.
export const requestSignTypedData = (chain, typedData, opts = {}) => requestSignature({ kind: "signTypedData", chain, typedData, delegation: opts.delegation });

// Solana spot SWAP via Jupiter — the OS-wide spot-liquidity seam. Any app (Holo Trade, an agent,
// a holospace) asks the wallet to swap; the wallet re-derives the min-out floor, asserts the sealed
// Jupiter program, simulates, then gates the human and signs. The key never leaves the wallet.
//   const { txid } = await requestSwap({ inputMint: MINTS.SOL, outputMint: MINTS.USDC, amount: "0.5" });
// `amount` is human decimal in the input token's units; pass inputDecimals for non-SOL inputs.
export const requestSwap = ({ inputMint, outputMint, amount, slippageBps = 50, inputDecimals } = {}, opts = {}) =>
  requestSignature({ kind: "swap", chain: "solana", inputMint, outputMint, amount, slippageBps, inputDecimals, delegation: opts.delegation }, { timeoutMs: opts.timeoutMs ?? 180000 });

// the wallet's address for a chain (so a caller can name the signer without holding the key)
export const requestAddress = (chain) => requestSignature({ kind: "address", chain }, { timeoutMs: 30000 });

// ── READ kinds — value never moves, so these are quick (30s) and never trigger biometric step-up; the
//    wallet still block-checks the requester and (for an agent) verifies a wallet:read grant. They make
//    the wallet legible to a human OR an agent without ever exposing a key (holospaces SEC-2: reads attenuate). ──
export const requestAddresses = (opts = {}) => requestSignature({ kind: "addresses", delegation: opts.delegation }, { timeoutMs: 30000 });
export const requestBalance = (chain, opts = {}) => requestSignature({ kind: "balance", chain, delegation: opts.delegation }, { timeoutMs: 30000 });
export const requestTokenBalance = (chain, token, opts = {}) => requestSignature({ kind: "tokenBalance", chain, token, delegation: opts.delegation }, { timeoutMs: 30000 });
export const requestPrice = (chains, opts = {}) => requestSignature({ kind: "price", chains, delegation: opts.delegation }, { timeoutMs: 30000 });
export const requestHistory = (chain, limit, opts = {}) => requestSignature({ kind: "history", chain, limit, delegation: opts.delegation }, { timeoutMs: 30000 });
export const requestSwapQuote = ({ inputMint, outputMint, amount } = {}, opts = {}) => requestSignature({ kind: "swapQuote", inputMint, outputMint, amount, delegation: opts.delegation }, { timeoutMs: 45000 });

// ── seam — the object the typed agent surface (holo-wallet-agent.mjs) routes through. Every method maps
//    one agent tool's args → one gated bridge request. This module holds NO key; the wallet app signs. The
//    method names match holo-wallet-agent's `seamKind` so makeWalletAgent({ seam }) is a drop-in. ──
export const seam = {
  address: (a = {}, o = {}) => requestSignature({ kind: "address", chain: a.chain || "ethereum", delegation: o.delegation }, { timeoutMs: 30000 }),
  addresses: (a = {}, o = {}) => requestAddresses({ delegation: o.delegation }),
  balance: (a = {}, o = {}) => requestBalance(a.chain, { delegation: o.delegation }),
  tokenBalance: (a = {}, o = {}) => requestTokenBalance(a.chain, a.token, { delegation: o.delegation }),
  price: (a = {}, o = {}) => requestPrice(a.chains, { delegation: o.delegation }),
  history: (a = {}, o = {}) => requestHistory(a.chain, a.limit, { delegation: o.delegation }),
  swapQuote: (a = {}, o = {}) => requestSwapQuote(a, { delegation: o.delegation }),
  swapQuoteEvm: (a = {}, o = {}) => requestSignature({ kind: "swapQuoteEvm", chain: a.chain || "ethereum", srcToken: a.srcToken, destToken: a.destToken, amount: a.amount, srcDecimals: a.srcDecimals, destDecimals: a.destDecimals, delegation: o.delegation }, { timeoutMs: 45000 }),
  swapEvm: (a = {}, o = {}) => requestSignature({ kind: "swapEvm", chain: a.chain || "ethereum", srcToken: a.srcToken, destToken: a.destToken, amount: a.amount, slippageBps: a.slippageBps, srcDecimals: a.srcDecimals, destDecimals: a.destDecimals, delegation: o.delegation }, { timeoutMs: 180000 }),
  bridgeQuote: (a = {}, o = {}) => requestSignature({ kind: "bridgeQuote", srcChain: a.srcChain, dstChain: a.dstChain, to: a.to, amount: a.amount, delegation: o.delegation }, { timeoutMs: 45000 }),
  bridge: (a = {}, o = {}) => requestSignature({ kind: "bridge", srcChain: a.srcChain, dstChain: a.dstChain, to: a.to, amount: a.amount, slippageBps: a.slippageBps, delegation: o.delegation }, { timeoutMs: 180000 }),
  lendingPositions: (a = {}, o = {}) => requestSignature({ kind: "lendingPositions", chain: a.chain || "arbitrum", delegation: o.delegation }, { timeoutMs: 45000 }),
  lending: (a = {}, o = {}) => requestSignature({ kind: "lending", chain: a.chain || "arbitrum", action: a.action, asset: a.asset, amount: a.amount, decimals: a.decimals, rateMode: a.rateMode, delegation: o.delegation }, { timeoutMs: 180000 }),
  fiatQuote: (a = {}, o = {}) => requestSignature({ kind: "fiatQuote", currencyCode: a.currencyCode, baseCurrencyAmount: a.baseCurrencyAmount, baseCurrencyCode: a.baseCurrencyCode, delegation: o.delegation }, { timeoutMs: 45000 }),
  fiat: (a = {}, o = {}) => requestSignature({ kind: "fiat", currencyCode: a.currencyCode, baseCurrencyAmount: a.baseCurrencyAmount, baseCurrencyCode: a.baseCurrencyCode, delegation: o.delegation }, { timeoutMs: 120000 }),
  aaAddress: (a = {}, o = {}) => requestSignature({ kind: "aaAddress", chain: a.chain || "ethereum", salt: a.salt, delegation: o.delegation }, { timeoutMs: 45000 }),
  aaSend: (a = {}, o = {}) => requestSignature({ kind: "aaSend", chain: a.chain || "ethereum", to: a.to, value: a.value, data: a.data, salt: a.salt, deploy: a.deploy, delegation: o.delegation }, { timeoutMs: 180000 }),
  aa7702: (a = {}, o = {}) => requestSignature({ kind: "aa7702", chain: a.chain || "ethereum", implAddress: a.implAddress, delegation: o.delegation }, { timeoutMs: 180000 }),
  sign: (a = {}, o = {}) => requestSignMessage(a.chain, a.message, { delegation: o.delegation }),
  signTypedData: (a = {}, o = {}) => requestSignTypedData(a.chain, a.typedData, { delegation: o.delegation }),
  send: (a = {}, o = {}) => requestSend(a.chain, a.to, a.amount, { token: a.token, delegation: o.delegation }),
  swap: (a = {}, o = {}) => requestSwap({ inputMint: a.inputMint, outputMint: a.outputMint, amount: a.amount, slippageBps: a.slippageBps, inputDecimals: a.inputDecimals }, { delegation: o.delegation }),
};
