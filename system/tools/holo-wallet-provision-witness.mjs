// Witness: every user's omni-chain wallet is AUTOMATICALLY provisioned from the one seed — deterministic,
// public-only (no secret leaks), curated chains surfaced, guest walletless. (vv: also asserts refusals.)
import { provisionWallet, isPresentationSafe, DEFAULT_CHAINS } from "../os/usr/lib/holo/holo-wallet-provision.mjs";
import { principalFromSeed } from "../os/usr/lib/holo/holo-login.mjs";
import { generateMnemonic, seedFromMnemonic, deriveAddress } from "../os/usr/lib/holo/holo-wdk.js";

async function main() {
  const r = {};
  const mnemonic = generateMnemonic();
  const seed = seedFromMnemonic(mnemonic);
  const principal = await principalFromSeed(seed, "operator");

  // 1) a wallet is provisioned for an authenticated operator, with the curated chains
  const w = provisionWallet(principal);
  r.provisioned = w.provisioned === true;
  r.curatedChains = DEFAULT_CHAINS.every((c) => w.chains.includes(c)) && w.chains.length === DEFAULT_CHAINS.length;
  r.hasAllChains = Array.isArray(w.allChains) && w.allChains.length >= DEFAULT_CHAINS.length;

  // 2) addresses match an INDEPENDENT re-derivation from the seed (Law L5) — for every curated chain
  r.addressesReDerive = DEFAULT_CHAINS.every((c) => w.addresses[c] === deriveAddress(c, seed, 0));

  // 3) deterministic: same seed → identical record (a re-derived principal yields the same wallet)
  const principal2 = await principalFromSeed(seed, "operator");
  const w2 = provisionWallet(principal2);
  r.deterministic = JSON.stringify(w.addresses) === JSON.stringify(w2.addresses) && w.did === w2.did;

  // 4) a DIFFERENT seed → different wallet (no collision)
  const other = provisionWallet(await principalFromSeed(seedFromMnemonic(generateMnemonic())));
  r.distinctPerSeed = other.addresses.ethereum && other.addresses.ethereum !== w.addresses.ethereum;

  // 5) PRESENTATION-SAFE: the record carries NO seed / mnemonic / private key (display-split)
  r.presentationSafe = isPresentationSafe(w) === true;
  r.noSeedInOutput = !JSON.stringify(w).toLowerCase().includes(mnemonic.split(" ")[0]); // no mnemonic word leaks

  // ── REFUSALS (vv) ──
  // 6) a GUEST / walletless principal (no seed-derived addresses) → NOT provisioned, no addresses
  r.guestWalletless = (() => { const g = provisionWallet({ kappa: "did:holo:sha256:" + "00".repeat(32) }); return g.provisioned === false && Object.keys(g.addresses).length === 0; })();
  // 7) null principal → fail-closed
  r.nullFailClosed = provisionWallet(null).provisioned === false;
  // 8) a record that DID carry a secret would be flagged unsafe (the guard actually works)
  r.guardCatchesLeak = isPresentationSafe({ addresses: {}, mnemonic: "leak here" }) === false;

  r.ok = Object.entries(r).every(([k, v]) => k === "ok" || v === true);
  console.log("holo-wallet-provision witness:", JSON.stringify(r, null, 2));
  if (!r.ok) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(2); });
