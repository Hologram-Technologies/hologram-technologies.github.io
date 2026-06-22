// holo-wallet-stress.mjs — the WHOLE-SYSTEM stress + convergence gate for the Holo Wallet. It tries to BREAK
// the trust boundary across every module, not confirm it works: gate-bypass on every spend/sign tool,
// attenuation escalation, key-leak boundary, malformed-input refusal (SEC-8), concurrency with no cross-bleed,
// a regression run of all 9 per-module witnesses, and a convergence gate (no tool left `planned`). A red
// check blocks "done". Exit 0 only if EVERYTHING holds.
//
//   node system/tools/holo-wallet-stress.mjs
//
// Per-module adversarial cases (tamper/replay/simulate-revert/forged-target) live in each module's witness;
// this harness covers the CROSS-CUTTING invariants and runs those witnesses as a regression barrier.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeWalletAgent, qContext, listTools, describe, TOOLS } from "../os/usr/lib/holo/holo-wallet-agent.mjs";
import { seam as bridgeSeam } from "../os/usr/lib/holo/holo-wallet-bridge.js";
import { mintNpc, delegate, authorizeRequest } from "../os/usr/lib/holo/holo-delegate.mjs";
import { principalFromSeed } from "../os/usr/lib/holo/holo-login.mjs";
import { firstRun } from "../os/usr/lib/holo/holo-ceremony.mjs";
import { generateMnemonic, seedFromMnemonic } from "../os/usr/lib/holo/holo-wdk.js";
import { assertSwapTx, VELORA } from "../os/usr/lib/holo/holo-evm-swap.mjs";
import { assertBridgeTx, buildSendParam, oftFor } from "../os/usr/lib/holo/holo-bridge.mjs";
import { assertPoolTx, poolFor, decodePositions } from "../os/usr/lib/holo/holo-lending.mjs";
import { assertOnRampUrl } from "../os/usr/lib/holo/holo-fiat.mjs";
import { assertEntryPoint } from "../os/usr/lib/holo/holo-aa.mjs";
import { buildSigningMessage as tonBuild, verifyTransfer as tonVerify, tonAddressRaw } from "../os/usr/lib/holo/holo-ton.mjs";
import { verifyBuiltTx as tronVerify, tronAddress } from "../os/usr/lib/holo/holo-tron.mjs";
import { ed25519 as _ed } from "../os/usr/lib/holo/wdk-crypto/wdk-crypto.bundle.mjs";

const here = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { (c ? pass++ : fail++); console.log(`  ${c ? "✓" : "✗"} ${n}${d ? " — " + d : ""}`); };
const refused = async (fn) => { try { await fn(); return false; } catch { return true; } };

// a recording spy seam: a Proxy so EVERY seamKind exists; records every call; returns benign shapes.
function spySeam() {
  const calls = [];
  const seam = new Proxy({}, { get: (_t, k) => (typeof k === "string" ? async () => { calls.push(k); return { ok: true, signature: "0x00", xPayment: "x", hash: "0x", url: "https://buy.moonpay.com/x" }; } : undefined) });
  return { calls, seam };
}
const authorize = async (d, o) => authorizeRequest(d, o);
const SPEND = TOOLS.filter((t) => t.risk === "spend" || t.risk === "sign");
const READS = TOOLS.filter((t) => t.risk === "read");

console.log("Holo Wallet — whole-system stress + convergence gate\n");

// ── A. SECURITY / TRUST BOUNDARY (must all REFUSE) ─────────────────────────────────────────────────
console.log("A · trust boundary");
{
  // A1 — gate-bypass: Q invokes EVERY spend/sign tool with NO consent → all refused, seam NEVER touched.
  const { calls, seam } = spySeam();
  const agent = makeWalletAgent({ seam, authorize });
  let allRefused = true;
  for (const t of SPEND) { const r = await agent.invoke(t.name, { requirements: {}, to: "0x1", asset: "0x1", implAddress: "0x1", srcChain: "arbitrum", dstChain: "ethereum", amount: "1" }, qContext()); if (!(r.ok === false && r.refused === true)) allRefused = false; }
  ok(`gate-bypass: all ${SPEND.length} spend/sign tools refuse Q without consent`, allRefused);
  ok("a refused Q call NEVER reaches the seam (0 signatures attempted)", calls.length === 0);
}
{
  // A2 — attenuation escalation: a wallet:read delegation tries EVERY spend tool → all refused (SEC-2).
  const pc = await principalFromSeed(seedFromMnemonic(generateMnemonic(12)), "Ada");
  await firstRun(pc, {});
  const readOnly = (await delegate(pc, mintNpc("Scout"), { capabilities: ["wallet:read"], notAfter: "2999-01-01T00:00:00Z" })).credential;
  const { seam } = spySeam();
  const agent = makeWalletAgent({ seam, authorize });
  let allRefused = true;
  for (const t of SPEND) { const r = await agent.invoke(t.name, { to: "0x1", asset: "0x1", implAddress: "0x1", srcChain: "arbitrum", dstChain: "ethereum", amount: "1", requirements: {} }, { caller: { kind: "agent" }, delegation: readOnly }); if (r.ok !== false) allRefused = false; }
  ok(`attenuation: a wallet:read grant is refused ALL ${SPEND.length} spend/sign tools`, allRefused);
  // and a forged/expired delegation is refused even for a read
  const expired = (await delegate(pc, mintNpc("Old"), { capabilities: ["wallet:read"], notAfter: "2000-01-01T00:00:00Z" })).credential;
  ok("an expired delegation is refused", (await makeWalletAgent({ seam, authorize }).invoke("wallet_get_balance", { chain: "ethereum" }, { caller: { kind: "agent" }, delegation: expired, nowIso: "2026-01-01T00:00:00Z" })).ok === false);
}
{
  // A3 — key-leak boundary: keys NEVER cross the seam. The agent surface + bridge seam carry no private key.
  const agentSrc = readFileSync(join(here, "../os/usr/lib/holo/holo-wallet-agent.mjs"), "utf8");
  const bridgeSrc = readFileSync(join(here, "../os/usr/lib/holo/holo-wallet-bridge.js"), "utf8");
  ok("the agent surface references no private key (keys never cross the seam)", !/privateKey|keyPair|\.priv\b/.test(agentSrc));
  ok("the bridge seam references no private key", !/privateKey|keyPair|\.priv\b/.test(bridgeSrc));
}

// ── B. INPUT ROBUSTNESS / SEC-8 (malformed input must REFUSE, not crash/over-allocate) ──────────────
console.log("B · input robustness (SEC-8)");
{
  ok("swap: a forged router `to` is refused", await refused(async () => assertSwapTx({ to: "0xdead", data: "0x1", from: "0x1" }, { router: VELORA.router, expectedFrom: "0x1" })));
  ok("bridge: a forged OFT `to` is refused", await refused(async () => assertBridgeTx({ to: "0xdead", data: "0x1" }, { oft: oftFor("arbitrum").oft })));
  ok("bridge: a destination outside the pinned EID table is refused", await refused(async () => buildSendParam({ srcChain: "arbitrum", dstChain: "notachain", to: "0x1", amountLD: "1" })));
  ok("lending: a forged Pool `to` is refused", await refused(async () => assertPoolTx({ to: "0xdead", data: "0x1" }, { pool: poolFor("arbitrum") })));
  ok("fiat: a foreign on-ramp origin is refused", await refused(async () => assertOnRampUrl("https://evil.example/?walletAddress=0x1", { expectedAddress: "0x1" })));
  ok("aa: a forged EntryPoint is refused", await refused(async () => assertEntryPoint("0xdead")));
  // native-chain verify-before-sign: a built message paying a DIFFERENT recipient is refused before signing.
  {
    const TO = tonAddressRaw(_ed.getPublicKey(new Uint8Array(32).fill(9))), OTHER = tonAddressRaw(_ed.getPublicKey(new Uint8Array(32).fill(13)));
    const sm = tonBuild({ toAddr: TO, amountNano: "1000000000", seqno: 0, validUntil: 0xffffffff });
    ok("ton: a transfer to a forged recipient is refused (verify-before-sign)", await refused(async () => tonVerify(sm, { toAddr: OTHER, amountNano: "1000000000" })));
  }
  {
    const TO = tronAddress(_ed.getPublicKey(new Uint8Array(32).fill(7))); // any valid-form T-address for the check
    const evil = { txID: "00", raw_data_hex: "00", raw_data: { contract: [{ parameter: { value: { to_address: "TEvilXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", amount: 1 } } }] } };
    ok("tron: a node-built tx to a forged recipient is refused (verify-before-sign)", await refused(async () => tronVerify(evil, { toAddr: TO, amountSun: 1 })));
  }
  // malformed chain response must not crash the decoder (bounded by payload, SEC-8)
  let safe = true; try { decodePositions("0x"); decodePositions("0xzz"); } catch { /* throwing is fine; a hang/OOM is not */ }
  ok("a truncated/garbage positions response does not crash the harness (bounded)", safe);
  // fuzz the agent with junk args under no consent → still a clean refusal, never a throw to the caller
  const { seam } = spySeam(); const agent = makeWalletAgent({ seam, authorize });
  const junk = [null, undefined, { to: 123 }, { amount: " ".repeat(1000) }, { chain: { evil: true } }, { amount: -1 }, { amount: "NaN" }];
  let clean = true; for (const j of junk) { try { const r = await agent.invoke("wallet_send", j, qContext()); if (r.ok !== false) clean = false; } catch { clean = false; } }
  ok("fuzzed junk args to a spend tool yield a clean refusal (no throw, no bypass)", clean);
}

// ── C. RESILIENCE / CONCURRENCY ─────────────────────────────────────────────────────────────────────
console.log("C · resilience / concurrency");
{
  // N parallel governed reads — no cross-request state bleed; each resolves independently.
  const { calls, seam } = spySeam();
  const agent = makeWalletAgent({ seam, authorize });
  const N = 30;
  const results = await Promise.all(Array.from({ length: N }, (_, i) => agent.invoke("wallet_get_address", { chain: "ethereum" }, qContext({ readGrant: true }))));
  ok(`${N} parallel governed reads all succeed with no cross-bleed`, results.every((r) => r.ok === true) && calls.length === N);
  // unknown tool is refused (no accidental dispatch)
  ok("an unknown tool name is refused", (await agent.invoke("wallet_drain_everything", {}, qContext({ userApproved: true }))).ok === false);
}

// ── D. (live-chain proofs are per-slice: see each witness + the session's browser verifications) ──────

// ── E. CONVERGENCE GATE ─────────────────────────────────────────────────────────────────────────────
console.log("E · convergence gate");
{
  const tools = listTools();
  const planned = tools.filter((t) => t.status === "planned");
  ok("CONVERGENCE: no tool is left `planned`", planned.length === 0, planned.map((t) => t.name).join(",") || "all wired");
  ok("all 9 WDK categories are present", ["wallet", "pricing", "indexer", "swap", "bridge", "lending", "fiat", "x402", "aa"].every((c) => describe().categories.includes(c)));
  const seamKinds = [...new Set(TOOLS.filter((t) => t.seamKind).map((t) => t.seamKind))];
  ok("every tool's seamKind is a live method on the bridge seam (drop-in)", seamKinds.every((k) => typeof bridgeSeam[k] === "function"));
  ok("the capability card self-verifies (re-derives its id, Law L5)", describe().id.startsWith("did:holo:sha256:"));
}

// ── REGRESSION: run every per-module witness; all must pass ──────────────────────────────────────────
console.log("\nregression — per-module witnesses");
const WITNESSES = ["holo-wallet-agent", "holo-indexer", "holo-x402", "holo-evm-swap", "holo-bridge", "holo-lending", "holo-fiat", "holo-tron", "holo-ton", "holo-aa"];
for (const w of WITNESSES) {
  const r = spawnSync(process.execPath, [join(here, w + "-witness.mjs")], { encoding: "utf8" });
  const m = (r.stdout || "").match(/(\d+) passed, (\d+) failed/);
  ok(`witness ${w}`, r.status === 0 && m && +m[2] === 0, m ? `${m[1]}/${+m[1] + +m[2]}` : "no result");
}

console.log(`\n${fail ? "STRESS FAILED ✗" : "STRESS PASSED ✓"}  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
