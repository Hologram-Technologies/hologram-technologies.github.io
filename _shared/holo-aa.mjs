// holo-aa.mjs — EVM ACCOUNT ABSTRACTION, hologram-native. WDK parity: @tetherto/wdk-wallet-evm-erc4337
// and @tetherto/wdk-wallet-evm-7702-gasless. Two standards, one EOA key (the wallet's secp256k1 key):
//   • ERC-4337 — a smart account (counterfactual, deployed by a factory) acts via UserOperations submitted
//     to a Bundler → the canonical EntryPoint. The OWNER signs the userOpHash; the key never leaves the wallet.
//   • EIP-7702 — an EOA temporarily adopts contract code via a signed authorization tuple (chainId, impl,
//     nonce). The "gasless" variant has a relayer/sponsor submit the type-4 tx.
//
// First principles (holospaces L5 / SEC-1):
//   • The EntryPoint + factory are PINNED (canonical eth-infinitism v0.7). The smart-account address is
//     re-derived from the SEALED factory (a different EntryPoint/factory is refused).
//   • userOpHash and the 7702 authHash are RE-DERIVED here, exactly as the on-chain verifier computes them —
//     so the human signs a value the wallet itself derived, not a number a bundler handed it.
//   • default-deny SIGNING. Submission (bundler eth_sendUserOperation / relayer type-4 tx) is the honest
//     out-of-band step — it needs a bundler key / sponsor; this module builds + asserts + signs.
//
// Pure (Node-testable): pins, packUserOp, userOpHash, executeCalldata, authHash, sign/recover. Network:
// accountAddress, accountNonce, the orchestrators. Isomorphic.

import { keccak256, bytesToHex, hexToBytes, concatBytes, rlpEncode, bytesFromQuantity, toChecksumAddress, encodeCall, decodeWord } from "./holo-eth.js";
import { secp256k1 } from "./wdk-crypto/wdk-crypto.bundle.mjs";

const te = new TextEncoder();
const lc = (s) => String(s || "").toLowerCase();
const word = (n) => { let v = BigInt(n); if (v < 0n) v += 1n << 256n; return v.toString(16).padStart(64, "0"); };
const addrWord = (a) => lc(a).replace(/^0x/, "").padStart(64, "0");
const stripHex = (h) => String(h || "0x").replace(/^0x/, "");
const keccakHexInput = (h) => keccak256(hexToBytes("0x" + stripHex(h)));

// ── canonical, PINNED (same address on every chain; eth-infinitism v0.7). Validated live 2026-06-21. ──
export const ENTRYPOINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
export const SIMPLE_ACCOUNT_FACTORY_V07 = "0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985";
export function assertEntryPoint(addr) { if (lc(addr) !== lc(ENTRYPOINT_V07)) throw new Error(`aa: EntryPoint ${addr} ≠ sealed canonical v0.7 — refusing`); return true; }

// pack two 128-bit values into one bytes32 (hi<<128 | lo) — accountGasLimits / gasFees layout.
const pack2 = (hi, lo) => ((BigInt(hi) << 128n) | BigInt(lo)).toString(16).padStart(64, "0");

// ── SimpleAccount execute(dest,value,func) calldata (manual ABI: address, uint256, dynamic bytes). ──
export function executeCalldata(to, value, data = "0x") {
  const sel = bytesToHex(keccak256(te.encode("execute(address,uint256,bytes)"))).slice(2, 10);
  const d = stripHex(data); const len = d.length / 2;
  const offset = word(96);                                          // 3 head words → bytes payload at 0x60
  const padded = d + "0".repeat((64 - (d.length % 64 || 64)) % 64);
  return "0x" + sel + addrWord(to) + word(value || 0) + offset + word(len) + padded;
}

// ── UserOp v0.7 packing + userOpHash (exactly as EntryPoint v0.7 computes it). ──
export function packAndHash(op, { entryPoint = ENTRYPOINT_V07, chainId }) {
  const initCode = (op.factory && op.factory !== "0x") ? (op.factory + stripHex(op.factoryData)) : "0x";
  const paymasterAndData = op.paymasterAndData && op.paymasterAndData !== "0x" ? op.paymasterAndData : "0x";
  const accountGasLimits = pack2(op.verificationGasLimit, op.callGasLimit);
  const gasFees = pack2(op.maxPriorityFeePerGas, op.maxFeePerGas);
  const packed = keccak256(hexToBytes("0x" +
    addrWord(op.sender) + word(op.nonce) + bytesToHex(keccakHexInput(initCode)).slice(2) + bytesToHex(keccakHexInput(op.callData)).slice(2) +
    accountGasLimits + word(op.preVerificationGas) + gasFees + bytesToHex(keccakHexInput(paymasterAndData)).slice(2)));
  const userOpHash = keccak256(concatBytes(packed, hexToBytes("0x" + addrWord(entryPoint)), hexToBytes("0x" + word(chainId))));
  return { userOpHash: bytesToHex(userOpHash), packedHash: bytesToHex(packed) };
}

// ── sign the userOpHash the way SimpleAccount validates it: ECDSA over the EIP-191 personal-sign digest. ──
function secpSign(hash32, priv) { const sig = secp256k1.sign(hash32, priv, { format: "recovered", lowS: true, prehash: false }); return { yParity: sig[0], r: bytesToHex(sig.subarray(1, 33)).slice(2), s: bytesToHex(sig.subarray(33, 65)).slice(2) }; }
export function signUserOpHash(userOpHash, priv) {
  const h = hexToBytes(userOpHash);
  const digest = keccak256(concatBytes(te.encode("\x19Ethereum Signed Message:\n32"), h));
  const { yParity, r, s } = secpSign(digest, priv);
  return "0x" + r + s + (27 + yParity).toString(16).padStart(2, "0");
}

// ── network reads ──
export async function accountAddress({ rpc, owner, salt = 0, factory = SIMPLE_ACCOUNT_FACTORY_V07 }) {
  const ret = await rpc.call("eth_call", [{ to: factory, data: encodeCall("getAddress(address,uint256)", [owner, salt]) }, "latest"]);
  return toChecksumAddress(ret.slice(-40));
}
export async function accountNonce({ rpc, sender, entryPoint = ENTRYPOINT_V07 }) {
  return BigInt(decodeWord(await rpc.call("eth_call", [{ to: entryPoint, data: encodeCall("getNonce(address,uint192)", [sender, 0]) }, "latest"]), "uint256"));
}

// ── buildUserOp() — assemble a v0.7 UserOp for `execute(to,value,data)`, derive the hash, ASSERT the
//    EntryPoint, gate, sign. Returns the signed UserOp + hash for a Bundler to submit (out-of-band). ──
export async function buildUserOp({ rpc, owner, priv, chainId, to, value = 0, data = "0x", salt = 0, factory = SIMPLE_ACCOUNT_FACTORY_V07, entryPoint = ENTRYPOINT_V07, deploy = false, gas = {} }, { approve = async () => true } = {}) {
  assertEntryPoint(entryPoint);
  const sender = await accountAddress({ rpc, owner, salt, factory });
  const nonce = await accountNonce({ rpc, sender, entryPoint });
  const op = {
    sender, nonce: "0x" + nonce.toString(16), callData: executeCalldata(to, value, data),
    factory: deploy ? factory : "0x", factoryData: deploy ? encodeCall("createAccount(address,uint256)", [owner, salt]) : "0x",
    callGasLimit: gas.callGasLimit ?? 200000, verificationGasLimit: gas.verificationGasLimit ?? 150000, preVerificationGas: gas.preVerificationGas ?? 60000,
    maxFeePerGas: gas.maxFeePerGas ?? 1000000000, maxPriorityFeePerGas: gas.maxPriorityFeePerGas ?? 1000000000, paymasterAndData: "0x",
  };
  const { userOpHash } = packAndHash(op, { entryPoint, chainId });
  const info = { standard: "erc-4337", sender, to, value: String(value), nonce: nonce.toString(), userOpHash, entryPoint };
  if (!(await approve(info))) throw new Error("UserOp request denied");
  op.signature = signUserOpHash(userOpHash, priv);
  return { userOp: op, userOpHash, ...info, submit: "bundler eth_sendUserOperation (out-of-band: needs a bundler endpoint)" };
}

// ── EIP-7702 authorization tuple: sign over keccak256(0x05 ‖ rlp([chainId, address, nonce])). ──
export function authHash({ chainId, implAddress, nonce }) {
  const body = rlpEncode([bytesFromQuantity(chainId), hexToBytes(implAddress), bytesFromQuantity(nonce)]);
  return bytesToHex(keccak256(concatBytes(Uint8Array.of(0x05), body)));
}
export function signAuthorization(priv, { chainId, implAddress, nonce }) {
  const { yParity, r, s } = secpSign(hexToBytes(authHash({ chainId, implAddress, nonce })), priv);
  return { chainId, address: implAddress, nonce, yParity, r: "0x" + r, s: "0x" + s };
}
export function recoverAuthority(auth) {
  const h = hexToBytes(authHash({ chainId: auth.chainId, implAddress: auth.address, nonce: auth.nonce }));
  const rs = hexToBytes("0x" + stripHex(auth.r).padStart(64, "0") + stripHex(auth.s).padStart(64, "0"));
  const pub = secp256k1.Signature.fromBytes(rs, "compact").addRecoveryBit(auth.yParity).recoverPublicKey(h).toBytes(false).subarray(1);
  return toChecksumAddress(bytesToHex(keccak256(pub)).slice(-40));
}
export async function authorize7702({ rpc, priv, chainId, implAddress, owner }, { approve = async () => true } = {}) {
  // nonce = the EOA's current account nonce (the authorization commits to it)
  const nonce = rpc ? Number(BigInt(await rpc.call("eth_getTransactionCount", [owner, "pending"]))) : 0;
  const info = { standard: "eip-7702", owner, implAddress, chainId, nonce, authHash: authHash({ chainId, implAddress, nonce }) };
  if (!(await approve(info))) throw new Error("7702 authorization denied");
  const authorization = signAuthorization(priv, { chainId, implAddress, nonce });
  // self-check: the authorization must recover to the owner (fail closed)
  if (lc(recoverAuthority(authorization)) !== lc(owner)) throw new Error("aa: 7702 authorization did not recover to owner — refusing");
  return { authorization, ...info, submit: "type-4 tx via a relayer/sponsor (out-of-band: gasless needs a sponsor)" };
}

export default { ENTRYPOINT_V07, SIMPLE_ACCOUNT_FACTORY_V07, assertEntryPoint, executeCalldata, packAndHash, signUserOpHash, accountAddress, accountNonce, buildUserOp, authHash, signAuthorization, recoverAuthority, authorize7702 };
