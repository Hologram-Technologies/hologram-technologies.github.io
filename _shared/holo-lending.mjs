// holo-lending.mjs — the DeFi LENDING engine: Aave V3, hologram-native. WDK parity:
// @tetherto/wdk-protocol-lending-aave-evm. Read positions (collateral/debt/health), and supply / borrow /
// withdraw / repay behind the SAME default-deny human gate. (Morpho is a second provider — a later add;
// this module is structured so a `provider` slots in beside Aave.)
//
// First principles (holospaces L5 / SEC-1):
//   • The Pool per chain is PINNED (sealed). Every value-moving tx MUST target that exact Pool — a
//     look-alike `to` (a drainer) is refused (assertPoolTx, structural anti-phishing).
//   • positions() is RE-DERIVED from the chain (getUserAccountData) — the human/agent sees real
//     collateral, debt, available-borrow, and HEALTH FACTOR before any action.
//   • verify-before-act: a borrow with no capacity is refused locally; and every action is eth_call
//     SIMULATED — Aave reverts an over-borrow / unhealthy action, so it never reaches the gate.
//   • default-deny SIGNING (the key stays in Holo Wallet).
//
// Pure (Node-testable): config, decodePositions, the calldata builders, assertPoolTx. Network: positions,
// allowanceOf, and the execute() orchestrator. Isomorphic.

import { encodeCall, decodeWord, bytesToHex, keccak256 } from "./holo-eth.js";

// ── sealed Aave V3 Pool per chain. Ethereum has its own deploy; the L2/sidechain deploys share the
//    canonical 0x794a… address. (eth + arbitrum verified live 2026-06-21 via getUserAccountData.) ──
export const AAVE_POOL = {
  ethereum: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
  arbitrum: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  optimism: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  polygon:  "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  avalanche:"0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  gnosis:   "0xb50201558B00496A145fE76f7424749556E326D8",
};
export const poolFor = (chain) => AAVE_POOL[chain] || null;
const lc = (s) => String(s || "").toLowerCase();

// Aave V3 base currency = USD with 8 decimals; healthFactor is 1e18-scaled; ltv/threshold in basis points.
export function decodePositions(ret) {
  const u = (i) => decodeWord(ret, "uint256", i);
  const hf = BigInt(u(5));
  return {
    totalCollateralBase: u(0).toString(), totalDebtBase: u(1).toString(), availableBorrowsBase: u(2).toString(),
    currentLiquidationThreshold: u(3).toString(), ltv: u(4).toString(), healthFactor: hf.toString(),
    // human-friendly
    collateralUsd: Number(u(0)) / 1e8, debtUsd: Number(u(1)) / 1e8, availableBorrowsUsd: Number(u(2)) / 1e8,
    healthFactorNum: hf >= (1n << 255n) ? Infinity : Number(hf) / 1e18,
  };
}
export async function positions({ rpc, chain, user }) {
  const pool = poolFor(chain); if (!pool) throw new Error("lending: no sealed Aave Pool on " + chain);
  const ret = await rpc.call("eth_call", [{ to: pool, data: encodeCall("getUserAccountData(address)", [user]) }, "latest"]);
  return decodePositions(ret);
}

// ── calldata builders (the Aave V3 Pool ABI). rateMode 2 = variable (the default). ──
export const buildSupply  = (asset, amount, onBehalfOf) => encodeCall("supply(address,uint256,address,uint16)", [asset, amount, onBehalfOf, 0]);
export const buildWithdraw = (asset, amount, to)        => encodeCall("withdraw(address,uint256,address)", [asset, amount, to]);
export const buildBorrow  = (asset, amount, onBehalfOf, rateMode = 2) => encodeCall("borrow(address,uint256,uint256,uint16,address)", [asset, amount, rateMode, 0, onBehalfOf]);
export const buildRepay   = (asset, amount, onBehalfOf, rateMode = 2) => encodeCall("repay(address,uint256,uint256,address)", [asset, amount, rateMode, onBehalfOf]);
const NEEDS_APPROVE = new Set(["supply", "repay"]);   // these pull the asset → the Pool needs an allowance

export function assertPoolTx(tx, { pool }) {
  if (!tx || !tx.to || !tx.data) throw new Error("lending: no tx");
  if (lc(tx.to) !== lc(pool)) throw new Error(`lending: target ${tx.to} ≠ sealed Aave Pool ${pool} — refusing`);
  return tx;
}

export async function allowanceOf({ rpc, token, owner, spender }) {
  return decodeWord(await rpc.call("eth_call", [{ to: token, data: encodeCall("allowance(address,address)", [owner, spender]) }, "latest"]), "uint256");
}
export const approveCalldata = (spender) => encodeCall("approve(address,uint256)", [spender, "0x" + (2n ** 256n - 1n).toString(16)]);

// ── execute() — one orchestrated action: build → ASSERT pool → (allowance) → re-derive capacity → SIMULATE
//    → APPROVE(gate) → SEND. `action` ∈ supply|withdraw|borrow|repay. `amount` is base units (string). ──
export async function execute({ chain, action, asset, amount, userAddress, rateMode = 2 }, { rpc, send, approve = async () => true } = {}) {
  if (!rpc) throw new Error("lending needs an rpc source (.call)");
  if (!send) throw new Error("lending needs a gated send(tx) callback");
  const pool = poolFor(chain); if (!pool) throw new Error("lending: no sealed Aave Pool on " + chain);
  const data = action === "supply" ? buildSupply(asset, amount, userAddress)
    : action === "withdraw" ? buildWithdraw(asset, amount, userAddress)
    : action === "borrow" ? buildBorrow(asset, amount, userAddress, rateMode)
    : action === "repay" ? buildRepay(asset, amount, userAddress, rateMode)
    : (() => { throw new Error("lending: unknown action " + action); })();
  // supply/repay pull the asset → the Pool must be allowed to spend it (refuse-with-instruction).
  if (NEEDS_APPROVE.has(action)) {
    const al = await allowanceOf({ rpc, token: asset, owner: userAddress, spender: pool });
    if (BigInt(al) < BigInt(amount)) return { needsApproval: true, token: asset, spender: pool, reason: "asset allowance to the Aave Pool is insufficient — approve first" };
  }
  // verify-before-act: a borrow needs capacity (Aave's own sim is the final judge for the exact amount).
  if (action === "borrow") {
    const p = await positions({ rpc, chain, user: userAddress });
    if (BigInt(p.availableBorrowsBase) === 0n) return { refused: true, reason: "no available borrow capacity (supply collateral first)" };
  }
  const tx = { to: pool, value: "0x0", data };
  assertPoolTx(tx, { pool });
  try { await rpc.call("eth_call", [{ from: userAddress, to: tx.to, data: tx.data }, "latest"]); }
  catch (e) { throw new Error("lending simulation reverted — refusing before the gate: " + (e && e.message)); }
  const p = await positions({ rpc, chain, user: userAddress }).catch(() => null);
  const info = { action, chain, asset, amount: String(amount), pool, healthFactor: p ? p.healthFactorNum : null, collateralUsd: p ? p.collateralUsd : null, debtUsd: p ? p.debtUsd : null };
  if (!(await approve(info))) throw new Error("Lending request denied");
  const hash = await send(tx);
  return { hash: hash && hash.hash ? hash.hash : hash, ...info };
}

export default { AAVE_POOL, poolFor, positions, decodePositions, buildSupply, buildWithdraw, buildBorrow, buildRepay, assertPoolTx, allowanceOf, approveCalldata, execute };
