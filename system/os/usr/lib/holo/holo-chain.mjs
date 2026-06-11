// holo-chain.mjs — the Chain Abstraction Layer (CAL): unify the fragmented blockchain ecosystem
// UNDER the κ content-addressable substrate. NOT a bridge BETWEEN chains (the fragile, most-hacked
// layer) — each chain is a verifiable PROJECTION of, and an ANCHOR for, the ONE κ object universe.
//   • CAIP (Chain Agnostic Improvement Proposals) names every chain/account/asset uniformly.
//   • resolve(caip) → a SELF-VERIFYING κ object, so every on-chain thing joins the one graph (inward).
//   • did:pkh (CASA) makes a chain wallet a holospace PRINCIPAL — your MetaMask/Phantom IS your
//     identity, no new key — so it can hold an Own Title natively.
//   • anchor()/pay() route an INTENT to the right chain via the one default-deny wallet seam (outward).
// The holospace speaks κ + intents, never a chain. Mint nothing — CAIP + did:pkh are open standards.
// Dual-env (browser + Node): ids are sealed via holo-identity's Web-Crypto addressOf, not node-only deps.

import { canon, addressOf } from "./holo-identity.mjs";

const te = new TextEncoder();
const sealObj = async (content) => ({ ...content, id: await addressOf(te.encode(canon(content))) });
export async function verify(obj) { if (!obj || !obj.id) return false; const { id, ...c } = obj; return (await addressOf(te.encode(canon(c)))) === id; }

// CAIP namespace + chain-id → the Holo Wallet's chain name (the seam's `chain` param). The 7 chains
// the kit speaks today; eip155 routes by chain-id (mainnet · base · arbitrum · optimism · polygon).
const EVM = { "1": "ethereum", "8453": "base", "42161": "arbitrum", "10": "optimism", "137": "polygon" };
export function walletChainOf(caip) {
  const c = parseCaip(caip);
  if (c.namespace === "eip155") return EVM[c.reference] || "ethereum";
  if (c.namespace === "solana") return "solana";
  if (c.namespace === "bip122") return "bitcoin";
  return c.namespace;
}

// ── CAIP parse (CAIP-2 chainId · CAIP-10 account · CAIP-19 asset) ──
//   eip155:1 · eip155:1:0xab16… · eip155:1/erc721:0xBC4C…/771769 · solana:5eyk…:7v91… · bip122:000…:1A1z…
export function parseCaip(id) {
  const s = String(id).trim();
  if (s.includes("/")) {                                              // CAIP-19 asset
    const chain = s.slice(0, s.indexOf("/")), rest = s.slice(s.indexOf("/") + 1);
    const c = parseCaip(chain);
    const [assetNs, tail] = rest.split(":");
    const [assetRef, tokenId] = (tail || "").split("/");
    return { kind: "asset", chainId: chain, namespace: c.namespace, reference: c.reference, assetNamespace: assetNs, assetReference: assetRef, tokenId: tokenId || null };
  }
  const p = s.split(":");
  if (p.length === 2 && p[0] && p[1]) return { kind: "chain", namespace: p[0], reference: p[1], chainId: s };
  if (p.length === 3 && p[0] && p[1] && p[2]) return { kind: "account", namespace: p[0], reference: p[1], address: p[2], chainId: p[0] + ":" + p[1] };
  throw new Error("not a CAIP identifier: " + s);
}
export const isCaip = (id) => { try { parseCaip(id); return true; } catch { return false; } };

// ── did:pkh — a chain account IS a principal (CASA did:pkh). did:pkh:<ns>:<ref>:<address>
export function didPkh(caip10) { const c = parseCaip(caip10); if (c.kind !== "account") throw new Error("did:pkh needs a CAIP-10 account"); return `did:pkh:${c.namespace}:${c.reference}:${c.address}`; }

// ── resolve: any CAIP identifier → a SELF-VERIFYING κ object in the one graph (unification INWARD).
//    Deterministic projection (the chain thing AS a κ object, re-derive its id to verify, Law L5);
//    live on-chain state is enrichment layered on via `data` (the network/RPC tier).
export async function resolve(caip, data = null) {
  const c = parseCaip(caip);
  const type = c.kind === "asset" ? ["chain:Asset", "schema:Product", "prov:Entity"]
    : c.kind === "account" ? ["chain:Account", "schema:Person", "prov:Entity"]
    : ["chain:Chain", "schema:Thing", "prov:Entity"];
  return sealObj({
    "@context": "https://hologram.os/ns/chain#", "@type": type,
    "schema:identifier": caip, "chain:caip": caip, "chain:namespace": c.namespace, "chain:reference": c.reference,
    ...(c.address ? { "chain:address": c.address, "chain:did": didPkh(caip) } : {}),
    ...(c.kind === "asset" ? { "chain:assetNamespace": c.assetNamespace, "chain:assetReference": c.assetReference, "chain:tokenId": c.tokenId } : {}),
    ...(data ? { "chain:state": data } : {}),
  });
}

// ── principal(caip10[, wallet]) → an Own-compatible principal whose owner-ref κ is derived from the
//    did:pkh, so a chain wallet HOLDS an Own Title with no new holo-identity key. If a wallet signer
//    is supplied, sign() routes to the chain wallet (wdk signEvm/Sol, or the wallet-bridge seam).
export async function principal(caip10, wallet = null) {
  const c = parseCaip(caip10);
  const did = didPkh(caip10);
  const refObj = await sealObj({ "@type": "chain:Account", "chain:did": did, "chain:caip": caip10 });
  return {
    kappa: refObj.id.replace(/^did:holo:/, ""),                       // the σ-axis owner-ref (sha256:<hex>)
    did, alg: "pkh", caip: caip10, address: c.address, namespace: c.namespace,
    async sign(msg) { if (wallet && wallet.sign) return wallet.sign(msg); throw new Error("principal: connect a wallet to sign (a did:pkh principal signs with its chain wallet)"); },
  };
}

// ── intent routing: the holospace says WHAT (anchor / pay) over a κ / a CAIP owner; the CAL routes to
//    WHICH chain via the one default-deny wallet seam. The holospace never names a chain.
export async function anchorTo(headKappa, caipChain, rail) {
  if (!rail) throw new Error("anchorTo needs a rail (walletRail in the browser, mockRail offline)");
  return rail.commit(headKappa, walletChainOf(caipChain));            // "anchor wins" on the named chain
}
export async function payTo(caip10Recipient, amount, rail) {
  if (!rail) throw new Error("payTo needs a rail");
  const c = parseCaip(caip10Recipient);
  return rail.pay(walletChainOf(caip10Recipient), c.address, amount);
}

if (typeof window !== "undefined") window.HoloChain = { parseCaip, isCaip, didPkh, walletChainOf, resolve, principal, anchorTo, payTo, verify };
