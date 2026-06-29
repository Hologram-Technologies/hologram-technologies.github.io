// holo-wallet-provision.mjs — provision + surface the operator's omni-chain wallet on first TEE auth.
//
// The wallet is NOT a separate thing to create: identity, vault, and wallet all PROJECT from the ONE
// BIP-39 seed (holo-login/holo-wdk). `principalFromSeed` already exposes `.addresses()` — every chain's
// address is a deterministic, PUBLIC projection of the seed (Law L1/L5). So "auto-create a wallet for
// every user" = surface those public addresses the instant the operator authenticates, with NO second
// unlock and NO secret leaving the seed-bearing context. The mnemonic/seed/private keys are NEVER part
// of the provisioned record — only public addresses + the operator's did.
//
// Display-split safe: the output is presentation-only (public). It can ride the session presentation to
// the shell without violating the no-secret-on-session invariant. A guest (ephemeral, walletless) yields
// `provisioned:false` — fail-closed, no addresses.

// Curated front-door chains (the rest derive on demand in the wallet app). Keep small for first-run clarity.
export const DEFAULT_CHAINS = ["ethereum", "bitcoin", "solana"];

// provisionWallet(principal, {chains, index}) → a PUBLIC, idempotent wallet presentation record.
// Deterministic: same seed (same principal) → identical record, every time. No secret material.
export function provisionWallet(principal, { chains = DEFAULT_CHAINS, index = 0 } = {}) {
  // A walletless principal (guest / no seed-derived addresses) gets nothing — fail-closed.
  if (!principal || typeof principal.addresses !== "function") {
    return { provisioned: false, addresses: {}, chains: [], allChains: [] };
  }
  let all;
  try { all = principal.addresses(index) || {}; } catch { return { provisioned: false, addresses: {}, chains: [], allChains: [] }; }
  const addresses = {};
  for (const c of chains) if (all[c]) addresses[c] = all[c];      // curated subset, surfaced first
  return {
    provisioned: true,
    did: principal.did || principal.kappa || null,               // public identity, not a secret
    addresses,                                                   // {chain: publicAddress} — PUBLIC only
    chains: Object.keys(addresses),
    allChains: Object.keys(all),                                 // the full set is available on demand
    index,
  };
}

// A defensive guard the caller can assert: the record must carry NO secret material before it is
// surfaced/persisted (presentation only). Returns true iff the record is safe to expose.
export function isPresentationSafe(record) {
  const s = JSON.stringify(record || {});
  // Match only a FULLY-QUOTED secret key (so "did" never trips the EC private-key field "d").
  return !/"(seed|mnemonic|priv|privateKey|secret|pkcs8|d)"\s*:/i.test(s);
}
