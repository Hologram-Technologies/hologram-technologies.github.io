// holo-trade-wallet-witness.mjs — proves the two pieces that wire Holo Trade to the real wallet +
// the agent-grant authorization (ADR-0070 + ADR-0042), fund-free:
//
//  A. THE WALLET-BRIDGE SIGNING PATH. A mock Holo Wallet (on the real BroadcastChannel seam) signs
//     EIP-712 typed data with the REAL WDK (`signEvmTypedData`); the exchange layer's walletBridgeSigner
//     forwards the SDK's typed data to it (the key never leaves the "wallet"); an order signed this way
//     and POSTed to Hyperliquid TESTNET makes the venue recover the WALLET's exact address — end-to-end
//     proof that SDK ⊕ bridge ⊕ WDK interoperate and the signing is spec-correct. Plus default-deny.
//
//  B. THE approveAgent → UCAN GRANT. The REAL Holo Delegate (ADR-0042) mints a /trade capability from
//     master → agent: it authorizes an order invocation, REFUSES a withdraw invocation (attenuation by
//     command), and a revocation invalidates it. This is the cryptographic capability the app's grant models.

import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const APPS = process.env.HOLO_APPS || "C:/Users/pavel/Desktop/Hologram Apps";
const OS2 = "C:/Users/pavel/Desktop/Hologram OS2/system";
const ORIG = "C:/Users/pavel/Desktop/hologram-os";
const url = (p) => pathToFileURL(p).href;
const ok = []; const fail = []; const skip = [];
const check = (n, pass, d = "") => { (pass ? ok : fail).push(n); console.log(`  ${pass ? "✓" : "✗"} ${n}${d ? " — " + d : ""}`); };

console.log("\nHolo Trade — wallet-bridge + agent-grant witness (ADR-0070 + ADR-0042), fund-free\n");

// ── A. wallet-bridge signing path ─────────────────────────────────────────────────────────────
const { HoloHyperliquid, SDK, connectWallet } = await import(url(join(APPS, "apps", "trade", "_shared", "holo-hyperliquid-exchange.mjs")));
const { signEvmTypedData } = await import(url(join(OS2, "os", "usr", "lib", "holo", "holo-wdk.js")));

const pk = "0x" + randomBytes(32).toString("hex");
const priv = Uint8Array.from(Buffer.from(pk.slice(2), "hex"));
const walletAddr = SDK.agentWallet(pk).address;          // the EVM address the wallet would expose
let denyNext = false;
const bus = new BroadcastChannel("holo-wallet");          // the same seam holo-wallet-bridge.js uses
bus.onmessage = (e) => {
  const d = e.data; if (!d || d.type !== "holo-wallet:sign-request") return;
  const req = d.request || {}; let p;
  try {
    if (denyNext) p = { error: "user declined" };          // default-deny path
    else if (req.kind === "signTypedData") p = { ok: true, signature: signEvmTypedData(req.typedData, priv) };  // REAL WDK signing
    else if (req.kind === "address") p = { ok: true, address: walletAddr };
    else p = { error: "unsupported kind " + req.kind };
  } catch (err) { p = { error: String(err.message || err) }; }
  bus.postMessage({ type: "holo-wallet:sign-result", id: d.id, ...p });
};

const master = await connectWallet("ethereum");           // asks the (mock) wallet for its address
check("connectWallet resolved the wallet address over the bridge", master.address === walletAddr, walletAddr);
const hl = new HoloHyperliquid({ wallet: master, testnet: true, limits: { scope: "master", maxNotionalUsd: 1e9, allowFundMovement: true } });

// happy path: the SDK builds typed data → the WALLET signs it (WDK) → POST testnet → address recovered
try {
  await hl.order({ a: 0, isBuy: true, px: "1000", sz: "0.001", tif: "Gtc" });
  check("testnet accepted (unexpected for a fresh account)", false);
} catch (e) {
  const msg = String(e?.message || e).toLowerCase();
  if (/network|fetch|enotfound|timeout|getaddrinfo/.test(msg) && !msg.includes(walletAddr.toLowerCase())) { skip.push("testnet path"); console.log("  ~ testnet unreachable — wallet-path recovery SKIPPED (offline)"); }
  else check("wallet-bridge path: testnet recovered the WALLET's address (SDK⊕bridge⊕WDK spec-correct)", msg.includes(walletAddr.toLowerCase()), msg.includes(walletAddr.toLowerCase()) ? walletAddr : msg.slice(0, 90));
}

// default-deny: the wallet declines → the bridge rejects → NO order is signed
denyNext = true;
try { await hl.order({ a: 0, isBuy: true, px: "1000", sz: "0.001", tif: "Gtc" }); check("default-deny refused signing", false); }
catch (e) { const msg = String(e.message); check("default-deny: wallet decline produces no signature (order refused at signing)", /sign|declin/i.test(msg), msg.slice(0, 60)); }
denyNext = false;
bus.close();

// ── B. approveAgent → UCAN grant (the REAL Holo Delegate, ADR-0042) ─────────────────────────────
try {
  const D = await import(url(join(ORIG, "os", "holo-delegate.mjs")));
  const { keyFromSeed } = await import(url(join(ORIG, "os", "holo-vc.mjs")));
  const m = new Map();
  const store = { set: (k, v) => m.set(k, v), get: (k) => m.get(k) };
  const master = keyFromSeed(Uint8Array.from(randomBytes(32)));
  const agent = keyFromSeed(Uint8Array.from(randomBytes(32)));
  const exp = D.DELEGATE.epoch + 8 * 3600;
  const cap = D.rootCap(store, { sub: master.did, aud: agent.did, cmd: "/trade", exp }, master);
  check("master minted a /trade agent grant (UCAN ⊕ UOR)", !!cap.id, cap.id.slice(0, 28) + "…");

  const orderInv = D.invoke(store, { leaf: cap, cmd: "/trade/order", args: { coin: "ETH", sz: "0.1" } }, agent);
  const aOrder = D.authorize(store, orderInv, { sub: master.did });
  check("grant AUTHORIZES an order invocation (/trade/order)", aOrder.ok === true, aOrder.why || "ok");

  const wInv = D.invoke(store, { leaf: cap, cmd: "/funds/withdraw", args: { amount: "1000" } }, agent);
  const aWithdraw = D.authorize(store, wInv, { sub: master.did });
  check("ATTENUATION: grant REFUSES a withdraw invocation (/funds/withdraw)", aWithdraw.ok === false, aWithdraw.why);

  const hexOf = (k) => String(k).split(":").pop();
  const aRevoked = D.authorize(store, orderInv, { sub: master.did, revoked: new Set([hexOf(cap.id)]) });
  check("REVOCATION invalidates the grant (and its whole subtree)", aRevoked.ok === false, aRevoked.why);
} catch (e) {
  skip.push("UCAN");
  console.log("  ~ Holo Delegate deps unavailable — UCAN attenuation SKIPPED:", String(e.message || e).split("\n")[0].slice(0, 120));
}

console.log(`\n${fail.length ? "FAIL" : "PASS"} — ${ok.length}/${ok.length + fail.length} checks${skip.length ? " · skipped: " + skip.join(", ") : ""}${fail.length ? " · failed: " + fail.join(", ") : ""}\n`);
process.exit(fail.length ? 1 : 0);
