#!/usr/bin/env node
// holo-chain-witness.mjs — PROVE the Chain Abstraction Layer (the omnichain keystone): fragmented
// blockchains are unified UNDER the κ substrate, not bridged between each other. CAIP names every
// chain/account/asset; resolve() turns ANY chain identifier into a self-verifying κ object (one graph,
// inward); did:pkh makes a chain wallet a holospace PRINCIPAL that holds an Own Title (no new key);
// anchor/pay route an INTENT to the right chain by CAIP namespace via the one default-deny wallet seam
// (outward). Two different chains' accounts land as distinct, self-verifying κ objects in the SAME
// graph — the unification. Pure Node; the wallet rail mocked offline. Mint nothing (CAIP + did:pkh).
//
//   node tools/holo-chain-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const L = (p) => new URL("../os/usr/lib/holo/" + p, import.meta.url);
const CH = await import(L("holo-chain.mjs"));
const { enroll } = await import(L("holo-identity.mjs"));
const own = await import(L("holo-own.mjs"));
const { mockRail, declineRail } = await import(L("holo-own-rail.js"));
const { kappaBlake3 } = await import(L("holo-blake3.mjs"));

const checks = {}; let passed = 0, failed = 0;
const rec = (n, c, d = "") => { checks[n] = !!c; c ? passed++ : failed++; console.log(`${c ? "PASS" : "FAIL"} — ${n}${d ? "  (" + d + ")" : ""}`); };

const ACC_ETH = "eip155:1:0xab16a96D359eC26a11e2C2b3d8f8B8942d5Bfcdb";
const ACC_SOL = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:7v91N7iZ9mNicL8WfG6cgSCKyRXydQjLh6UYBWwm6y1Q";

// 1 · CAIP-2 / CAIP-10 / CAIP-19 parse uniformly
rec("CAIP-2 chainId parses (eip155:8453)", (() => { const c = CH.parseCaip("eip155:8453"); return c.kind === "chain" && c.namespace === "eip155" && c.reference === "8453"; })());
rec("CAIP-10 account parses (namespace · reference · address)", (() => { const c = CH.parseCaip(ACC_ETH); return c.kind === "account" && c.address === "0xab16a96D359eC26a11e2C2b3d8f8B8942d5Bfcdb"; })());
rec("CAIP-19 asset parses (an NFT: erc721 + tokenId)", (() => { const c = CH.parseCaip("eip155:1/erc721:0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D/771769"); return c.kind === "asset" && c.assetNamespace === "erc721" && c.tokenId === "771769"; })());

// 2 · resolve: every chain identifier → a SELF-VERIFYING κ object (re-derive, Law L5) + deterministic
const oEth = await CH.resolve(ACC_ETH);
rec("resolve(CAIP) → a self-verifying κ object that commits to the CAIP id (Law L5)", (await CH.verify(oEth)) && oEth["chain:caip"] === ACC_ETH && oEth.id.startsWith("did:holo:"));
rec("resolve is deterministic (same id → same κ)", (await CH.resolve(ACC_ETH)).id === oEth.id);

// 3 · UNIFICATION: two different chains' accounts land as distinct, self-verifying κ objects in ONE graph
const oSol = await CH.resolve(ACC_SOL);
rec("a Solana account + an Ethereum account are BOTH κ objects in the one graph (distinct, both verify)", (await CH.verify(oSol)) && oSol.id !== oEth.id && oSol["chain:namespace"] === "solana");

// 4 · did:pkh — a chain wallet IS a principal
rec("did:pkh derives from a CAIP-10 account (CASA standard)", CH.didPkh(ACC_ETH) === "did:pkh:eip155:1:0xab16a96D359eC26a11e2C2b3d8f8B8942d5Bfcdb");

// 5 · a chain wallet HOLDS an Own Title — a holo-identity owner transfers a holospace to a did:pkh principal
const maya = await enroll({ label: "maya", passphrase: "m" });        // a holo-identity human (can sign)
const chainBob = await CH.principal(ACC_ETH);                         // a chain wallet as an Own principal
rec("principal(account) → an Own owner-ref κ + did:pkh", chainBob.kappa.startsWith("sha256:") && chainBob.did === "did:pkh:eip155:1:0xab16a96D359eC26a11e2C2b3d8f8B8942d5Bfcdb");
const holospace = kappaBlake3(new TextEncoder().encode("org.hologram.StudioWorld"));
const g = await own.mint({ owned: holospace }, maya);
const t1 = await own.transfer({ title: g, to: chainBob }, maya);     // hand the holospace to the chain wallet
const v = await own.verifyChain([g, t1]);
rec("a holospace Title can be OWNED by a chain wallet (did:pkh principal), chain re-derives", v.ok && v.owner === chainBob.kappa);

// 6 · intent routing: the holospace names a κ / a CAIP owner; the CAL routes to the right chain
const anc = await CH.anchorTo(t1["@id"], "eip155:8453", mockRail());
rec("anchor INTENT routes to the right chain by CAIP (eip155:8453 → base)", anc.chain === "base" && anc.headKappa === t1["@id"]);
const pay = await CH.payTo(ACC_ETH, 25, mockRail());
rec("pay INTENT routes to the chain + address (eip155:1 → ethereum)", pay.chain === "ethereum" && pay.to.startsWith("0xab16"));
let declined = false; try { await CH.anchorTo(t1["@id"], "eip155:1", declineRail()); } catch (e) { declined = /declin/i.test(e.message); }
rec("a declining wallet refuses the intent (default-deny — value never moves alone)", declined);

// 7 · the 7 chains the kit speaks all map through one CAIP function
const map = { "eip155:1": "ethereum", "eip155:8453": "base", "eip155:42161": "arbitrum", "eip155:10": "optimism", "eip155:137": "polygon", "solana:x": "solana", "bip122:x": "bitcoin" };
rec("CAIP → wallet-chain mapping covers all 7 chains the kit speaks", Object.entries(map).every(([k, want]) => CH.walletChainOf(k) === want));

const witnessed = failed === 0;
writeFileSync(join(here, "holo-chain-witness.result.json"), JSON.stringify({
  spec: "The Chain Abstraction Layer (ADR-053 omnichain keystone): fragmented blockchains are unified UNDER the κ substrate — CAIP names every chain/account/asset, resolve() turns any chain identifier into a self-verifying κ object (one graph), did:pkh makes a chain wallet a holospace principal that holds an Own Title with no new key, and anchor/pay route an intent to the right chain via the one default-deny wallet seam. Not a bridge between chains — each chain is a verifiable projection of, and anchor for, the one κ universe",
  authority: "CAIP-2/10/19 (Chain Agnostic Improvement Proposals) · W3C/CASA did:pkh · W3C DID Core · UOR-ADDR (κ = H(canonical_form)) · holospaces Laws L1/L4/L5 · the chain kit (prism-btc · holo-eth/evm · holo-solana · wdk) by reference",
  witnessed,
  covers: ["omnichain", "chain-abstraction", "caip", "did-pkh", "resolve-to-kappa", "one-graph", "intent-routing", "law-l5"],
  checks, passed, failed,
}, null, 2) + "\n");
console.log(`\nholo-chain-witness: ${passed} passed, ${failed} failed`);
process.exit(witnessed ? 0 : 1);
