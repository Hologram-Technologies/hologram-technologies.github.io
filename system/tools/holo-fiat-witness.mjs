// holo-fiat-witness.mjs — proves the MoonPay on-ramp is safe: the widget URL is bound to the SEALED origin
// and OUR re-derived address (a tampered origin or a foreign address is REFUSED before opening — funds can
// never be redirected), the gate consents before the URL is handed back (default-deny), completion is an
// ingest boundary (verify the on-chain deposit, not the provider), and the agent surface routes fiat_buy
// through the gate (Q asks; attenuation holds). Network-free.
//
//   node system/tools/holo-fiat-witness.mjs

import { MOONPAY, chainForCurrency, buildOnRampUrl, assertOnRampUrl, onRamp, depositConfirmed } from "../os/usr/lib/holo/holo-fiat.mjs";
import { makeWalletAgent, qContext } from "../os/usr/lib/holo/holo-wallet-agent.mjs";
import { mintNpc, delegate, authorizeRequest } from "../os/usr/lib/holo/holo-delegate.mjs";
import { principalFromSeed } from "../os/usr/lib/holo/holo-login.mjs";
import { firstRun } from "../os/usr/lib/holo/holo-ceremony.mjs";
import { generateMnemonic, seedFromMnemonic } from "../os/usr/lib/holo/holo-wdk.js";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { (c ? pass++ : fail++); console.log(`  ${c ? "✓" : "✗"} ${n}${d ? " — " + d : ""}`); };

console.log("Holo Fiat — MoonPay on-ramp, address-bound + sealed-origin, behind the gate\n");

const ME = "0x1111111111111111111111111111111111111111";
const THIEF = "0x00000000000000000000000000000000DeaDBeeF";

// 1) URL build is address-bound to the sealed origin.
const url = buildOnRampUrl({ apiKey: "pk_test_x", walletAddress: ME, currencyCode: "usdc", baseCurrencyAmount: 100 });
ok("on-ramp URL targets the sealed MoonPay origin", new URL(url).origin === MOONPAY.buy);
ok("on-ramp URL carries OUR wallet address", new URL(url).searchParams.get("walletAddress") === ME);

// 2) assert refuses a tampered origin (phishing) and a foreign address (redirected funds).
ok("the asserted URL passes for our address", assertOnRampUrl(url, { expectedAddress: ME }).walletAddress === ME);
let threw = false; try { assertOnRampUrl(url.replace("buy.moonpay.com", "buy.m00npay.com"), { expectedAddress: ME }); } catch { threw = true; }
ok("a look-alike origin is REFUSED (anti-phishing)", threw);
threw = false; try { const u = new URL(url); u.searchParams.set("walletAddress", THIEF); assertOnRampUrl(u.toString(), { expectedAddress: ME }); } catch { threw = true; }
ok("a URL paying a FOREIGN address is REFUSED (funds can't be redirected)", threw);

// 3) a missing destination address is refused at build.
threw = false; try { buildOnRampUrl({ apiKey: "pk", walletAddress: "not-an-address" }); } catch { threw = true; }
ok("building without a valid destination address is refused", threw);

// 4) currency → chain mapping (so we verify the deposit on the right axis).
ok("currencyCode maps to the deposit chain", chainForCurrency("usdc_arbitrum") === "arbitrum" && chainForCurrency("sol") === "solana");

// 5) onRamp() gates BEFORE returning the URL; default-deny yields nothing.
{
  let seen = null;
  const r = await onRamp({ apiKey: "pk_test_x", walletAddress: ME, currencyCode: "usdc", baseCurrencyAmount: 50 }, { approve: async (info) => { seen = info; return true; } });
  ok("approved on-ramp returns the asserted URL + info", r.url.startsWith(MOONPAY.buy) && r.destChain === "ethereum" && seen.walletAddress === ME);
  let denied = false; try { await onRamp({ apiKey: "pk", walletAddress: ME, currencyCode: "usdc", baseCurrencyAmount: 50 }, { approve: async () => false }); } catch { denied = true; }
  ok("a denied gate returns no URL (default-deny)", denied);
}
// 6) no key → onRamp still builds+asserts but flags needsKey (honest; the key gates the live session).
{
  const r = await onRamp({ apiKey: "", walletAddress: ME, currencyCode: "usdc" }, { approve: async () => true });
  ok("missing MoonPay key is flagged honestly (needsKey), not faked", r.needsKey === true);
}
// 7) completion is an INGEST BOUNDARY: confirmed only when the on-chain balance actually increased.
ok("deposit confirmed only when balance increased (verify, don't trust)", depositConfirmed({ before: "100", after: "150" }) === true && depositConfirmed({ before: "100", after: "100" }) === false);

// 8) AGENT surface — fiat_buy rides the gate (spend-class); fiat_get_quote is read; attenuation holds.
const spy = { calls: 0, fiat: async () => { spy.calls++; return { url: "https://buy.moonpay.com/?x=1" }; }, fiatQuote: async () => ({ quoteCurrencyAmount: 99 }) };
const agent = makeWalletAgent({ seam: spy, authorize: async (d, o) => authorizeRequest(d, o) });
ok("Q fiat_buy with no approval is REFUSED (must ask)", (await agent.invoke("fiat_buy", { currencyCode: "usdc", baseCurrencyAmount: 100 }, qContext())).refused === true && spy.calls === 0);
ok("Q fiat_buy WITH approval routes to seam.fiat", (await agent.invoke("fiat_buy", { currencyCode: "usdc", baseCurrencyAmount: 100 }, qContext({ userApproved: true }))).ok === true && spy.calls === 1);
const pc = await principalFromSeed(seedFromMnemonic(generateMnemonic(12)), "Ada");
await firstRun(pc, {});
const readOnly = (await delegate(pc, mintNpc("Scout"), { capabilities: ["wallet:read"], notAfter: "2999-01-01T00:00:00Z" })).credential;
ok("agent with only wallet:read may quote but NOT buy (attenuation)",
  (await agent.invoke("fiat_get_quote", { currencyCode: "usdc" }, { caller: { kind: "agent" }, delegation: readOnly })).ok === true &&
  (await agent.invoke("fiat_buy", { currencyCode: "usdc", baseCurrencyAmount: 100 }, { caller: { kind: "agent" }, delegation: readOnly })).ok === false);

console.log(`\n${fail ? "WITNESS FAILED" : "WITNESSED ✓"}  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
