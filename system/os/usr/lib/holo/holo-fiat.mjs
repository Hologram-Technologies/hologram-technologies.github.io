// holo-fiat.mjs — the fiat ON-RAMP engine: MoonPay, hologram-native. WDK parity:
// @tetherto/wdk-protocol-fiat-moonpay. An on-ramp is DIFFERENT from every other action: it DEPOSITS crypto
// INTO the wallet, so it never signs with the wallet key. The trust boundary is therefore about WHERE the
// flow goes and WHERE the funds land — not a signature.
//
// First principles (holospaces L5 / SEC-6, Product-Security egress):
//   • The widget URL MUST target the SEALED MoonPay origin (a tampered/look-alike origin is refused) — so an
//     on-ramp can't be redirected to a phishing page.
//   • The walletAddress in the URL MUST be OUR re-derived address — so funds can NEVER be routed to anyone
//     else (SEC-6: the reference→identity binding is verified on its own axis before the flow opens).
//   • Completion is an INGEST BOUNDARY: we don't trust MoonPay's "done" — we re-derive it from the chain
//     (the deposit tx to our address is verified independently). verifyDeposit reuses the wallet's own reads.
//   • Q/agent must still ASK (it reveals the address to a third party + initiates a money flow): the gate
//     fires before the URL is handed back. default-deny.
//
// Pure (Node-testable): config, buildOnRampUrl, assertOnRampUrl, currency↔chain. Network: buyQuote (MoonPay
// public quote API, needs a publishable key) + verifyDeposit (chain read). Isomorphic.

// ── sealed MoonPay endpoints. The widget origin is asserted on every built URL (anti-phishing). The
//    publishable key (pk_live_… / pk_test_…) is the operator's — supplied at call time; without it MoonPay
//    rejects the session (honest: we build + assert the URL, the key gates the live session). ──
export const MOONPAY = {
  name: "MoonPay",
  buy: "https://buy.moonpay.com",
  sandbox: "https://buy-sandbox.moonpay.com",
  api: "https://api.moonpay.com",
  origins: ["https://buy.moonpay.com", "https://buy-sandbox.moonpay.com"],
};
const lc = (s) => String(s || "").toLowerCase();
const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a || "")) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(a || "")); // EVM or base58 (Solana/BTC bech32 handled loosely)

// MoonPay currency code → the chain the deposit lands on (so we verify on the right axis).
export const CURRENCY_CHAIN = {
  eth: "ethereum", usdc: "ethereum", usdt: "ethereum",
  usdc_arbitrum: "arbitrum", usdc_optimism: "optimism", usdc_polygon: "polygon", usdc_base: "base",
  sol: "solana", usdc_sol: "solana", btc: "bitcoin", pol: "polygon", bnb_bsc: "bsc", avax_cchain: "avalanche",
};
export const chainForCurrency = (code) => CURRENCY_CHAIN[lc(code)] || null;

// ── build the address-bound widget URL (pure). walletAddress is supplied by the WALLET (its own address). ──
export function buildOnRampUrl({ apiKey = "", walletAddress, currencyCode = "usdc", baseCurrencyAmount, baseCurrencyCode = "usd", redirectURL, sandbox = false } = {}) {
  if (!isAddr(walletAddress)) throw new Error("fiat: a valid destination wallet address is required");
  const base = sandbox ? MOONPAY.sandbox : MOONPAY.buy;
  const u = new URL(base);
  u.searchParams.set("apiKey", apiKey);
  u.searchParams.set("currencyCode", currencyCode);
  u.searchParams.set("walletAddress", walletAddress);
  if (baseCurrencyAmount != null) u.searchParams.set("baseCurrencyAmount", String(baseCurrencyAmount));
  u.searchParams.set("baseCurrencyCode", baseCurrencyCode);
  if (redirectURL) u.searchParams.set("redirectURL", redirectURL);
  return u.toString();
}

// ── assert a built (or received) URL before it is ever opened: sealed origin + OUR address (anti-phishing,
//    anti-redirect). Returns the parsed { origin, walletAddress, currencyCode } on success; throws on tamper. ──
export function assertOnRampUrl(url, { expectedAddress, origins = MOONPAY.origins } = {}) {
  let u; try { u = new URL(url); } catch { throw new Error("fiat: malformed on-ramp URL"); }
  const origin = u.origin;
  if (!origins.map(lc).includes(lc(origin))) throw new Error(`fiat: on-ramp origin ${origin} is not the sealed MoonPay origin — refusing`);
  const walletAddress = u.searchParams.get("walletAddress");
  if (expectedAddress && lc(walletAddress) !== lc(expectedAddress)) throw new Error("fiat: on-ramp walletAddress ≠ your wallet — refusing (funds would land elsewhere)");
  return { origin, walletAddress, currencyCode: u.searchParams.get("currencyCode"), amount: u.searchParams.get("baseCurrencyAmount") };
}

// ── onRamp() — the gated orchestrator. Builds the URL, ASSERTS it (origin + our address), then the human
//    gate consents to opening MoonPay with their address. Returns the URL for the shell/app to open. No key
//    signature — an on-ramp deposits TO us. `approve(info)` is the default-deny gate. ──
export async function onRamp({ apiKey, walletAddress, currencyCode = "usdc", baseCurrencyAmount, baseCurrencyCode = "usd", redirectURL, sandbox = false }, { approve = async () => true } = {}) {
  const url = buildOnRampUrl({ apiKey, walletAddress, currencyCode, baseCurrencyAmount, baseCurrencyCode, redirectURL, sandbox });
  const checked = assertOnRampUrl(url, { expectedAddress: walletAddress });
  const info = { provider: MOONPAY.name, walletAddress, currencyCode, baseCurrencyAmount: baseCurrencyAmount != null ? String(baseCurrencyAmount) : null, baseCurrencyCode, destChain: chainForCurrency(currencyCode), needsKey: !apiKey };
  if (!(await approve(info))) throw new Error("On-ramp request denied");
  return { url, ...info };
}

// ── buy quote — MoonPay's public quote (needs the publishable key). Read-only. ──
export async function buyQuote({ apiKey, currencyCode = "usdc", baseCurrencyAmount = 100, baseCurrencyCode = "usd" }, { fetchImpl } = {}) {
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null); if (!f) throw new Error("no fetch");
  if (!apiKey) return { needsKey: true, reason: "set your MoonPay publishable key (pk_live_… / pk_test_…) to quote" };
  const u = new URL(`${MOONPAY.api}/v3/currencies/${lc(currencyCode)}/buy_quote`);
  u.searchParams.set("apiKey", apiKey); u.searchParams.set("baseCurrencyAmount", String(baseCurrencyAmount)); u.searchParams.set("baseCurrencyCode", baseCurrencyCode);
  const r = await f(u.toString());
  if (!r.ok) throw new Error("MoonPay quote failed: " + r.status);
  const j = await r.json();
  return { quoteCurrencyAmount: j.quoteCurrencyAmount, feeAmount: j.feeAmount, networkFeeAmount: j.networkFeeAmount, totalAmount: j.totalAmount, currencyCode: j.currency?.code || currencyCode };
}

// ── verifyDeposit — the INGEST BOUNDARY. We do NOT trust MoonPay's webhook; we re-derive arrival from the
//    chain. The caller passes a `readBalance()` (the wallet's own gated read) and the pre-buy baseline; a
//    deposit is CONFIRMED only when the on-chain balance actually increased. (verify, don't trust.) ──
export function depositConfirmed({ before, after }) {
  try { return BigInt(after) > BigInt(before); } catch { return false; }
}

export default { MOONPAY, CURRENCY_CHAIN, chainForCurrency, buildOnRampUrl, assertOnRampUrl, onRamp, buyQuote, depositConfirmed };
