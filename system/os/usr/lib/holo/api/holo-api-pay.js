// holo-api-pay.js — the SEAMLESS payer seam: it turns an HTTP 402 from any holospace's κ-stream API
// into one tap in Holo Wallet, and unlocks the stream. The app/agent never touches keys, chains, or
// settlement — it just calls fetchPaid(url) and gets the data; the human approves the payment once in
// the wallet's own default-deny dialog. The complexity (chains, tokens, signatures, replay) is hidden.
//
//   WHY  — paying for a κ-object should feel like opening it: no setup, no SDK, no copied addresses.
//   HOW  — on a 402, read the standardized challenge, ask Holo Wallet to make the exact payment it names
//          (a real stablecoin/token transfer on Plasma — gas-abstracted), and retry with the proof.
//   WHAT — payFor402(challenge) builds the Authorization proof; fetchPaid(url) does the whole loop.
//
// The wallet seam (requestSend/requestAddress) and the network (fetch) are INJECTABLE, so this is fully
// testable with no real wallet and no chain, and the same code runs live in the browser over the bridge.

import { PLASMA } from "./holo-api-core.mjs";

// payFor402(challenge, opts) → { proof } — the Authorization value to present (Authorization: Holo <jcs(proof)>).
// opts.wallet defaults to the Holo Wallet bridge (requestSend · requestAddress). Plasma is the default rail:
// a single gas-abstracted stablecoin (USD₮0) or any token transfer, settled by the wallet (human-approved).
export async function payFor402(challenge, opts = {}) {
  const wallet = opts.wallet || (await loadBridge());
  if (!wallet) throw new Error("no Holo Wallet available — open the wallet to pay");
  const pay = challenge && challenge.pay;
  if (pay && pay.rail === "plasma") {
    const amount = humanAmount(pay.amountMinor, pay.decimals ?? PLASMA.decimals);
    const payer = await safe(() => wallet.requestAddress(pay.chain || PLASMA.chain));
    const sent = await wallet.requestSend(pay.chain || PLASMA.chain, pay.to, amount, { token: pay.token || PLASMA.token });
    const txHash = sent && (sent.hash || sent.txHash);
    if (!txHash) throw new Error("wallet did not return a transaction");
    return { proof: { "@type": "holo:PlasmaSettlement", chainId: pay.chainId || PLASMA.chainId, token: pay.token || PLASMA.token,
      to: pay.to, amountMinor: pay.amountMinor, currency: pay.currency || PLASMA.currency, resource: pay.resource || (challenge && challenge.resource) || "*",
      txHash, payer: (payer && (payer.address || payer)) || null } };
  }
  if (opts.signPermit && challenge && challenge.permit) {                 // gasless signed-permit rail (no on-chain value)
    return { proof: await opts.signPermit({ ...challenge.permit, nonce: challenge.permit.nonce && challenge.permit.nonce !== "<unique>" ? challenge.permit.nonce : nonce() }) };
  }
  throw new Error("no payable rail in the 402 challenge");
}

// fetchPaid(url, init, opts) → Response. The magic one-liner: fetch; if it's a 402, pay the challenge
// through Holo Wallet and retry once with the proof. Returns the unlocked response (or the original 402
// if the user declines). opts.transport defaults to global fetch; opts.wallet defaults to the bridge.
export async function fetchPaid(url, init = {}, opts = {}) {
  const transport = opts.transport || (typeof fetch !== "undefined" ? fetch : null);
  if (!transport) throw new Error("no fetch transport");
  let res = await transport(url, init);
  if (res.status !== 402) return res;
  let challenge; try { challenge = await res.clone().json(); } catch { return res; }
  const { proof } = await payFor402(challenge, opts);
  const headers = { ...(init.headers || {}), Authorization: "Holo " + JSON.stringify(proof) };
  return await transport(url, { ...init, headers });
}

// helpers — amount math + lazy bridge load (the bridge lives beside the runtime; absent in tests/Node).
const humanAmount = (minor, decimals) => { const d = Number(decimals) || 0; const s = String(Math.trunc(Number(minor) || 0)).padStart(d + 1, "0"); return d ? (s.slice(0, -d) + "." + s.slice(-d)).replace(/\.?0+$/, "") || "0" : s; };
const nonce = () => "n" + (globalThis.crypto && globalThis.crypto.getRandomValues ? hexId() : String(performance && performance.now ? performance.now() : 0));
const hexId = () => { const a = new Uint8Array(12); globalThis.crypto.getRandomValues(a); return [...a].map((b) => b.toString(16).padStart(2, "0")).join(""); };
const safe = async (fn) => { try { return await fn(); } catch { return null; } };
async function loadBridge() { try { const m = await import("../holo-wallet-bridge.js"); return { requestSend: m.requestSend, requestAddress: m.requestAddress, requestSignMessage: m.requestSignMessage }; } catch { return null; } }
