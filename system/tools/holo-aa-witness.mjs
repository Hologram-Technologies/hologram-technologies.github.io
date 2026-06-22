// holo-aa-witness.mjs — proves EVM account abstraction (ERC-4337 + EIP-7702) is trust-minimized behind the
// gate: the EntryPoint is sealed (a forged one refused), the userOpHash is re-derived deterministically and
// its EIP-191 signature recovers to the owner, the EIP-7702 authorization round-trips (sign→recover==owner),
// and the orchestrators gate (default-deny) before the EOA key signs. Plus the agent surface routes aa_send
// through the gate (Q asks; attenuation holds). Network stubbed; signing is real.
//
//   node system/tools/holo-aa-witness.mjs

import { ENTRYPOINT_V07, SIMPLE_ACCOUNT_FACTORY_V07, assertEntryPoint, executeCalldata, packAndHash, signUserOpHash, buildUserOp, authHash, signAuthorization, recoverAuthority, authorize7702 } from "../os/usr/lib/holo/holo-aa.mjs";
import { keccak256, bytesToHex, hexToBytes, concatBytes, toChecksumAddress } from "../os/usr/lib/holo/holo-eth.js";
import { secp256k1 } from "../os/usr/lib/holo/wdk-crypto/wdk-crypto.bundle.mjs";
import { makeWDK, generateMnemonic, seedFromMnemonic } from "../os/usr/lib/holo/holo-wdk.js";
import { makeWalletAgent, qContext } from "../os/usr/lib/holo/holo-wallet-agent.mjs";
import { mintNpc, delegate, authorizeRequest } from "../os/usr/lib/holo/holo-delegate.mjs";
import { principalFromSeed } from "../os/usr/lib/holo/holo-login.mjs";
import { firstRun } from "../os/usr/lib/holo/holo-ceremony.mjs";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { (c ? pass++ : fail++); console.log(`  ${c ? "✓" : "✗"} ${n}${d ? " — " + d : ""}`); };
const te = new TextEncoder();

console.log("Holo AA — ERC-4337 + EIP-7702, one EOA key behind the gate\n");

// a real key to sign with
const wdk = makeWDK(seedFromMnemonic(generateMnemonic(12)), { chains: ["ethereum"] });
const acc = await wdk.getAccount("ethereum", 0);
const owner = await acc.getAddress();
const priv = acc.keyPair.privateKey;

// recover an EIP-191 personal_sign over a 32-byte hash → signer (to check the userOp signature)
function recover191(hash32hex, sig) {
  const digest = keccak256(concatBytes(te.encode("\x19Ethereum Signed Message:\n32"), hexToBytes(hash32hex)));
  const h = sig.replace(/^0x/, ""); const rs = hexToBytes("0x" + h.slice(0, 128)); const v = parseInt(h.slice(128, 130), 16);
  const pub = secp256k1.Signature.fromBytes(rs, "compact").addRecoveryBit(v >= 27 ? v - 27 : v).recoverPublicKey(digest).toBytes(false).subarray(1);
  return toChecksumAddress(bytesToHex(keccak256(pub)).slice(-40));
}

// 1) sealed EntryPoint assertion.
ok("the canonical EntryPoint v0.7 asserts", assertEntryPoint(ENTRYPOINT_V07));
let threw = false; try { assertEntryPoint("0x00000000000000000000000000000000DeaDBeeF"); } catch { threw = true; }
ok("a forged EntryPoint is refused", threw);

// 2) executeCalldata structure (SimpleAccount execute(address,uint256,bytes)).
const cd = executeCalldata("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", 1000000000000000000n, "0x");
ok("executeCalldata uses the execute(address,uint256,bytes) selector", cd.startsWith("0xb61d27f6"), cd.slice(0, 10));

// 3) userOpHash is deterministic + re-derivable (same op → same hash).
const op = { sender: owner, nonce: "0x0", callData: cd, factory: "0x", factoryData: "0x", callGasLimit: 200000, verificationGasLimit: 150000, preVerificationGas: 60000, maxFeePerGas: 1000000000, maxPriorityFeePerGas: 1000000000, paymasterAndData: "0x" };
const h1 = packAndHash(op, { chainId: 1 }).userOpHash;
const h2 = packAndHash(op, { chainId: 1 }).userOpHash;
ok("userOpHash is deterministic (re-derivable, Law L5)", h1 === h2 && /^0x[0-9a-f]{64}$/.test(h1), h1.slice(0, 18) + "…");
ok("userOpHash changes with chainId (binds the chain)", packAndHash(op, { chainId: 42161 }).userOpHash !== h1);

// 4) the userOp signature recovers to the owner (the SimpleAccount validation path).
const uoSig = signUserOpHash(h1, priv);
ok("the userOp signature recovers to the owner (EIP-191)", recover191(h1, uoSig).toLowerCase() === owner.toLowerCase());

// 5) EIP-7702 authorization round-trips: sign → recover == owner.
const auth = signAuthorization(priv, { chainId: 1, implAddress: "0x1111111111111111111111111111111111111111", nonce: 7 });
ok("authHash is deterministic", authHash({ chainId: 1, implAddress: "0x1111111111111111111111111111111111111111", nonce: 7 }) === authHash({ chainId: 1, implAddress: "0x1111111111111111111111111111111111111111", nonce: 7 }));
ok("the 7702 authorization recovers to the owner (sign→recover round-trip)", recoverAuthority(auth).toLowerCase() === owner.toLowerCase());
ok("a tampered 7702 nonce no longer recovers to the owner", recoverAuthority({ ...auth, nonce: 8 }).toLowerCase() !== owner.toLowerCase());

// 6) buildUserOp orchestrator — asserts EntryPoint, gates (sees the userOpHash), signs only after approve.
const ownerWord = "0x" + "0".repeat(24) + owner.slice(2).toLowerCase();
const rpc = { call: async (m, p) => {
  const to = (p[0].to || "").toLowerCase();
  if (to === SIMPLE_ACCOUNT_FACTORY_V07.toLowerCase()) return ownerWord;   // factory.getAddress → owner (stub)
  return "0x" + "0".repeat(64);                                            // entryPoint.getNonce / default → 0
} };
{
  let seen = null;
  const res = await buildUserOp({ rpc, owner, priv, chainId: 1, to: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", value: 0 }, { approve: async (info) => { seen = info; return true; } });
  ok("buildUserOp gates with the re-derived userOpHash then signs", seen && seen.userOpHash === res.userOpHash && typeof res.userOp.signature === "string" && res.standard === "erc-4337");
  ok("the signed UserOp recovers to the owner", recover191(res.userOpHash, res.userOp.signature).toLowerCase() === owner.toLowerCase());
}
// 7) default-deny: gate says no → no signature.
{
  let err = null; try { await buildUserOp({ rpc, owner, priv, chainId: 1, to: owner, value: 0 }, { approve: async () => false }); } catch (e) { err = e; }
  ok("a denied gate produces no UserOp (default-deny)", !!err && /denied/.test(err.message));
}
// 8) authorize7702 orchestrator self-checks recovery + default-deny.
{
  const r = await authorize7702({ rpc: { call: async () => "0x" + "0".repeat(64) }, priv, chainId: 1, implAddress: "0x1111111111111111111111111111111111111111", owner }, { approve: async () => true });
  ok("authorize7702 returns an authorization that recovers to the owner", recoverAuthority(r.authorization).toLowerCase() === owner.toLowerCase());
  let err = null; try { await authorize7702({ rpc: { call: async () => "0x" + "0".repeat(64) }, priv, chainId: 1, implAddress: "0x1111111111111111111111111111111111111111", owner }, { approve: async () => false }); } catch (e) { err = e; }
  ok("a denied gate produces no 7702 authorization (default-deny)", !!err && /denied/.test(err.message));
}

// 9) AGENT surface — aa_send rides the gate; aa_account_address is a read; attenuation holds.
const spy = { calls: 0, aaSend: async () => { spy.calls++; return { userOpHash: "0x" }; }, aaAddress: async () => "0xacc", aa7702: async () => ({}) };
const agent = makeWalletAgent({ seam: spy, authorize: async (d, o) => authorizeRequest(d, o) });
ok("Q aa_send with no approval is REFUSED (must ask)", (await agent.invoke("aa_send", { to: owner }, qContext())).refused === true && spy.calls === 0);
ok("Q aa_send WITH approval routes to seam.aaSend", (await agent.invoke("aa_send", { to: owner }, qContext({ userApproved: true }))).ok === true && spy.calls === 1);
const pc = await principalFromSeed(seedFromMnemonic(generateMnemonic(12)), "Ada");
await firstRun(pc, {});
const readOnly = (await delegate(pc, mintNpc("Scout"), { capabilities: ["wallet:read"], notAfter: "2999-01-01T00:00:00Z" })).credential;
ok("agent with only wallet:read may read aa address but NOT aa_send (attenuation)",
  (await agent.invoke("aa_account_address", {}, { caller: { kind: "agent" }, delegation: readOnly })).ok === true &&
  (await agent.invoke("aa_send", { to: owner }, { caller: { kind: "agent" }, delegation: readOnly })).ok === false);

console.log(`\n${fail ? "WITNESS FAILED" : "WITNESSED ✓"}  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
