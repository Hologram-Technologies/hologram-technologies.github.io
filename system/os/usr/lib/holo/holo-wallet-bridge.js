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
export const requestSend = (chain, to, amount, opts = {}) => requestSignature({ kind: "send", chain, to, amount, token: opts.token });
export const requestSignMessage = (chain, message) => requestSignature({ kind: "sign", chain, message });
