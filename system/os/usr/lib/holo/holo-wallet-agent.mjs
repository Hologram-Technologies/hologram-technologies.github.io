// holo-wallet-agent.mjs — the wallet's typed, self-describing AGENT tool surface: Hologram's native
// equivalent of Tether WDK's MCP Toolkit (wallet · pricing · indexer · swap · bridge · lending · fiat),
// but routed through the ONE existing chokepoint — the Holo Wallet human-approval gate. Keys never
// leave the wallet; this module holds none. It is the seam that makes the wallet "accessible to humans
// and AI agents alike" WITHOUT widening the trust boundary (holospaces SEC-2: authority only attenuates).
//
// First principles (holospaces Laws + Product-Security):
//   • One door (SEC-2 / default-deny). Every value-moving call goes through holo-wallet-bridge →
//     the wallet's biometric + conscience gate. An agent can ASK; only the human's key SIGNS.
//   • Q rule (Authority): Q must request user permission before ANY wallet activity — reads included.
//     Reads default to ASK; the human may grant a standing, revocable read-consent, never a spend one.
//   • Proactive but never autonomous: prepare() returns a non-executing PROPOSAL (zero side effects);
//     invoke() is the only path that can touch the seam, and only after consent is satisfied.
//   • Attenuation (SEC-2): an agent's delegation must already hold the capability a tool needs; a
//     wallet:read grant can never reach a wallet:spend tool. authorizeRequest is the single source of truth.
//   • Honest surface (L5): tools WDK ships but Holo hasn't wired yet are advertised as status:"planned"
//     with their target WDK module — they REFUSE rather than fake. No "it would work."
//
// Pure + isomorphic: the catalog, classification, and governance are Node-testable; the live seam is
// injected (browser = holo-wallet-bridge over BroadcastChannel; witness = an in-memory stub).

import { sha256 } from "./wdk-crypto/wdk-crypto.bundle.mjs";

const te = new TextEncoder();
const HEXC = Array.from({ length: 256 }, (_, b) => b.toString(16).padStart(2, "0"));
const hex = (u) => { let s = ""; for (let i = 0; i < u.length; i++) s += HEXC[u[i]]; return s; };
const canon = (v) => Array.isArray(v) ? "[" + v.map(canon).join(",") + "]"
  : v && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}"
  : JSON.stringify(v);
const kappaOf = (obj) => "did:holo:sha256:" + hex(sha256(te.encode(canon(obj))));

// ── risk → capability (faithful to holo-delegate.CAP_FOR_KIND). read < sign < spend. ──────────────
const CAP = { read: "wallet:read", sign: "wallet:sign", spend: "wallet:spend" };

// ── the TOOL CATALOG — 7 WDK categories, mapped onto Hologram's seam. ───────────────────────────────
// `seamKind` = the holo-wallet-bridge request this routes to (null ⇒ no live seam path yet).
// `status`: "wired"     — the current bridge already serves it (live today);
//           "needs-seam" — logic exists in holo-wdk, but the bridge needs a read kind to expose it to agents;
//           "planned"    — needs a net-new WDK module (named in `maps_to`); refuses, never fakes.
const TOOLS = [
  // wallet
  { name: "wallet_get_address",     category: "wallet",  risk: "read",  seamKind: "address",       status: "wired", input: { chain: "string" }, desc: "Return the wallet's address for a chain. No value moves." },
  { name: "wallet_list_accounts",   category: "wallet",  risk: "read",  seamKind: "addresses",     status: "wired", input: {}, desc: "List derived accounts/addresses across chains (read-only)." },
  { name: "wallet_get_balance",     category: "wallet",  risk: "read",  seamKind: "balance",       status: "wired", input: { chain: "string" }, desc: "Native-asset balance for a chain (read-only, live RPC)." },
  { name: "wallet_get_token_balance", category: "wallet", risk: "read", seamKind: "tokenBalance",  status: "wired", input: { chain: "string", token: "string" }, desc: "ERC-20 / SPL token balance (read-only, live RPC)." },
  { name: "wallet_sign_message",    category: "wallet",  risk: "sign",  seamKind: "sign",          status: "wired", input: { chain: "string", message: "string" }, desc: "Sign a plain message (EIP-191). Human-gated." },
  { name: "wallet_sign_typed_data", category: "wallet",  risk: "sign",  seamKind: "signTypedData", status: "wired", input: { chain: "string", typedData: "object" }, desc: "Sign EIP-712 typed data. Human-gated." },
  { name: "wallet_send",            category: "wallet",  risk: "spend", seamKind: "send",          status: "wired", input: { chain: "string", to: "string", amount: "string", token: "string?" }, desc: "Send native or token value. Human-gated, irreversible." },
  // pricing
  { name: "pricing_get_price",      category: "pricing", risk: "read",  seamKind: "price",         status: "wired", input: { chains: "string[]" }, desc: "USD spot price per asset (CoinGecko, read-only)." },
  // indexer
  { name: "indexer_get_history",    category: "indexer", risk: "read",  seamKind: "history",       status: "wired", input: { chain: "string", limit: "number?" }, desc: "Recent transaction history for the account (read-only, public explorer)." },
  // swap
  { name: "swap_get_quote",         category: "swap",    risk: "read",  seamKind: "swapQuote",     status: "wired",
    input: { chain: "string?", inputMint: "string?", outputMint: "string?", srcToken: "string?", destToken: "string?", amount: "string" },
    desc: "Quote a spot swap — Solana (Jupiter) by inputMint/outputMint, or EVM (Velora/ParaSwap) by chain+srcToken/destToken. Read-only.",
    handler: async ({ seam, args }) => ((args.chain && args.chain !== "solana") ? seam.swapQuoteEvm(args) : seam.swapQuote(args)) },
  { name: "swap_execute",           category: "swap",    risk: "spend", seamKind: "swap",          status: "wired",
    input: { chain: "string?", inputMint: "string?", outputMint: "string?", srcToken: "string?", destToken: "string?", amount: "string", slippageBps: "number?" },
    desc: "Execute a spot swap — Solana (Jupiter) or EVM (Velora/ParaSwap, by chain). The route is untrusted: a min-out floor is re-derived, the sealed router/program asserted, and the tx simulated BEFORE the human gate. Human-gated (wallet:spend); key never leaves the wallet.",
    handler: async ({ seam, args, ctx }) => ((args.chain && args.chain !== "solana") ? seam.swapEvm(args, { delegation: ctx.delegation }) : seam.swap(args, { delegation: ctx.delegation })) },
  // bridge — WDK ships USDT0 cross-chain; Holo has a base class only.
  { name: "bridge_get_quote",       category: "bridge",  risk: "read",  seamKind: "bridgeQuote", status: "wired",
    input: { srcChain: "string", dstChain: "string", to: "string?", amount: "string" },
    desc: "Quote a USD₮0 LayerZero cross-chain bridge — the native messaging fee + min received. Read-only.",
    handler: async ({ seam, args }) => seam.bridgeQuote(args) },
  { name: "bridge_execute",         category: "bridge",  risk: "spend", seamKind: "bridge",      status: "wired",
    input: { srcChain: "string", dstChain: "string", to: "string?", amount: "string", slippageBps: "number?" },
    desc: "Bridge USD₮0 across chains via LayerZero OFT. The destination (dstEid) is re-derived from a pinned table, the sealed OFT asserted, the fee quoted, and the tx simulated BEFORE the human gate. Human-gated (wallet:spend); key never leaves the wallet.",
    handler: async ({ seam, args, ctx }) => seam.bridge(args, { delegation: ctx.delegation }) },
  // lending — WDK ships Aave + Morpho; Holo has a base class only.
  { name: "lending_positions",      category: "lending", risk: "read",  seamKind: "lendingPositions", status: "wired",
    input: { chain: "string?" },
    desc: "Read Aave V3 positions: collateral, debt, available-borrow, and HEALTH FACTOR. Read-only.",
    handler: async ({ seam, args }) => seam.lendingPositions(args) },
  { name: "lending_supply",         category: "lending", risk: "spend", seamKind: "lending",          status: "wired",
    input: { chain: "string?", asset: "string", amount: "string", decimals: "number?" },
    desc: "Supply an asset as collateral to Aave V3. The sealed Pool is asserted and the tx simulated BEFORE the human gate. Human-gated (wallet:spend); key never leaves the wallet.",
    handler: async ({ seam, args, ctx }) => seam.lending({ ...args, action: "supply" }, { delegation: ctx.delegation }) },
  { name: "lending_borrow",         category: "lending", risk: "spend", seamKind: "lending",          status: "wired",
    input: { chain: "string?", asset: "string", amount: "string", decimals: "number?", rateMode: "number?" },
    desc: "Borrow an asset against Aave V3 collateral. Capacity is re-derived and the tx simulated (Aave reverts an unsafe borrow) BEFORE the human gate. Human-gated (wallet:spend); key never leaves the wallet.",
    handler: async ({ seam, args, ctx }) => seam.lending({ ...args, action: "borrow" }, { delegation: ctx.delegation }) },
  // fiat — WDK ships MoonPay; Holo has a base class + a "Buy" button only.
  { name: "fiat_get_quote",         category: "fiat",    risk: "read",  seamKind: "fiatQuote", status: "wired",
    input: { currencyCode: "string?", baseCurrencyAmount: "number?", baseCurrencyCode: "string?" },
    desc: "Quote a MoonPay fiat on-ramp purchase (needs the operator's publishable key). Read-only.",
    handler: async ({ seam, args }) => seam.fiatQuote(args) },
  { name: "fiat_buy",               category: "fiat",    risk: "spend", seamKind: "fiat",      status: "wired",
    input: { currencyCode: "string?", baseCurrencyAmount: "number?", baseCurrencyCode: "string?" },
    desc: "Buy crypto with fiat via MoonPay (an on-ramp DEPOSITS to the wallet — no key signature). The widget URL is bound to the SEALED MoonPay origin and YOUR re-derived address (funds can't be redirected), then the human gate consents to opening it. Spend-class consent: agent needs wallet:spend; Q needs explicit per-action approval.",
    handler: async ({ seam, args, ctx }) => seam.fiat(args, { delegation: ctx.delegation }) },
  // x402 — instant USD₮ HTTP payments (the agent-economy rail). A payment IS an EIP-3009 EIP-712 signature,
  // so it rides the SAME signTypedData gate (wallet:spend) — default-deny, biometric, attenuated for agents.
  { name: "x402_pay",               category: "x402",    risk: "spend", seamKind: "signTypedData", status: "wired",
    input: { requirements: "object", from: "string", chain: "string?", validBefore: "number?", nonce: "string?" },
    desc: "Pay an x402 HTTP 402 challenge by signing an EIP-3009 USD₮ transfer authorization. Human-gated (wallet:spend); key never leaves the wallet.",
    handler: async ({ seam, args, ctx }) => {
      const x402 = await import("./holo-x402.mjs");
      const req = args.requirements;
      const nonce = args.nonce || x402.randomNonce();
      const validBefore = args.validBefore || (Math.floor(Date.now() / 1000) + (req?.maxTimeoutSeconds || 60));
      const td = x402.buildAuthorization(req, { from: args.from, validBefore, nonce });
      const r = await seam.signTypedData({ chain: args.chain || "ethereum", typedData: td }, { delegation: ctx.delegation });
      const signature = (r && r.signature) || r;          // bridge returns { ok, signature }
      if (!signature || typeof signature !== "string") throw new Error("x402: gate returned no signature");
      const { header, payload } = x402.encodePayment(req, td.message, signature);
      return { xPayment: header, payload };
    } },
  // account abstraction (ERC-4337 + EIP-7702) — one EOA key, smart-account powers.
  { name: "aa_account_address",     category: "aa",      risk: "read",  seamKind: "aaAddress", status: "wired",
    input: { chain: "string?", salt: "number?" },
    desc: "Return the wallet's counterfactual ERC-4337 smart-account address (SimpleAccount v0.7), re-derived from the sealed factory. Read-only.",
    handler: async ({ seam, args }) => seam.aaAddress(args) },
  { name: "aa_send",                category: "aa",      risk: "spend", seamKind: "aaSend",    status: "wired",
    input: { chain: "string?", to: "string", value: "string?", data: "string?", salt: "number?", deploy: "boolean?" },
    desc: "Build + sign an ERC-4337 UserOperation (execute to→value→data) from the smart account. The sealed EntryPoint is asserted and the userOpHash re-derived BEFORE the human gate; the EOA key signs only after consent. Returns the signed UserOp for a bundler to submit (submission is out-of-band — needs a bundler endpoint). Human-gated (wallet:spend); key never leaves the wallet.",
    handler: async ({ seam, args, ctx }) => seam.aaSend(args, { delegation: ctx.delegation }) },
  { name: "aa_authorize_7702",      category: "aa",      risk: "spend", seamKind: "aa7702",    status: "wired",
    input: { chain: "string?", implAddress: "string" },
    desc: "Sign an EIP-7702 authorization delegating this EOA to a smart-contract implementation (the 'gasless' account upgrade). The authHash is re-derived and the signature self-checked to recover to the owner BEFORE return. Human-gated (wallet:spend); the type-4 tx is submitted by a relayer/sponsor (out-of-band).",
    handler: async ({ seam, args, ctx }) => seam.aa7702(args, { delegation: ctx.delegation }) },
];
const byName = (n) => TOOLS.find((t) => t.name === n) || null;

// ── the self-verifying capability card (the agent's introspection entry point; L5: re-derive its id). ──
export function describe() {
  const card = {
    "@context": "https://hologram.os/ns/wallet-agent", "@type": "WalletAgentSurface",
    title: "Holo Wallet — agent tools", model: "Tether-WDK-parity", door: "holo-wallet-bridge (human-gated, default-deny)",
    categories: [...new Set(TOOLS.map((t) => t.category))],
    tools: TOOLS.map((t) => ({ name: t.name, category: t.category, risk: t.risk, capability: CAP[t.risk], status: t.status, maps_to: t.maps_to || null, desc: t.desc, input: t.input })),
    policy: { q: "ask before ANY activity; reads grantable as standing/revocable; spend/sign never standing", agent: "delegation must hold the capability (SEC-2 attenuation); human still signs" },
  };
  return { ...card, id: kappaOf(card) };
}
export const listTools = () => describe().tools;

// ── governance — the single decision: may THIS caller invoke THIS tool right now? default-deny. ──────
// ctx = { caller:{kind:"human"|"agent"|"q", label?}, delegation?, revoked?, nowIso?, readGrant?, userApproved? }
// authorize: pluggable (default = holo-delegate.authorizeRequest) so the witness/Node stays light.
async function govern(tool, ctx, authorize) {
  const kind = ctx?.caller?.kind || "human";
  const need = CAP[tool.risk];
  // 1) a human at the wallet UI: the seam's own biometric/conscience gate is the consent — allow to proceed.
  if (kind === "human") return { ok: true, via: "human-gate" };
  // 2) an external agent: its delegation must ALREADY hold the needed capability (SEC-2). The human still signs after.
  if (kind === "agent") {
    const seamKindForCap = tool.risk === "read" ? "address" : tool.risk === "sign" ? "sign" : "send";
    const auth = await authorize(ctx.delegation, { kind: seamKindForCap, revoked: ctx.revoked || [], nowIso: ctx.nowIso || null });
    if (!auth.ok) return { ok: false, reason: "agent: " + auth.reason };
    if (!ctx.delegation) return { ok: false, reason: "agent: no delegation presented (default-deny)" };
    return { ok: true, via: "delegation+human-gate", agent: auth.agent };
  }
  // 3) Q (the OS assistant): must request user permission for EVERYTHING.
  //    read  → allowed ONLY with an explicit, revocable standing read-grant; else ASK.
  //    sign/spend → NEVER standing; requires a fresh per-action human approval (userApproved flag the
  //    caller only sets after the gate fired). Proactive Q uses prepare(), which never reaches here.
  if (kind === "q") {
    if (tool.risk === "read") {
      if (ctx.readGrant === true) return { ok: true, via: "q-standing-read-grant" };
      return { ok: false, reason: "Q must ask: no standing read-consent for wallet reads", needsConsent: "read" };
    }
    if (ctx.userApproved === true) return { ok: true, via: "q-per-action-approval" };
    return { ok: false, reason: "Q must ask: " + need + " requires explicit per-action user approval", needsConsent: tool.risk };
  }
  return { ok: false, reason: "unknown caller kind" };
}

// ── prepare() — the PROACTIVE path. Returns a non-executing proposal. ZERO side effects: the seam is
//    never touched. This is how Q surfaces a suggestion ("want me to send 5 USDT to Ada?") without acting. ──
export function prepare(name, args = {}) {
  const tool = byName(name);
  if (!tool) return { ok: false, reason: "unknown tool: " + name };
  return {
    ok: true, proposal: true, tool: tool.name, category: tool.category, risk: tool.risk, args,
    willRequireConsent: true,
    consentKind: tool.risk === "read" ? "read" : "per-action",
    status: tool.status,
    humanSummary: tool.risk === "spend"
      ? `Proposes to ${tool.name} — this MOVES VALUE and is irreversible. You will be asked to confirm with biometrics.`
      : tool.risk === "sign" ? `Proposes to ${tool.name} — signs with your key. You will be asked to confirm.`
      : `Proposes to ${tool.name} — read-only. You will be asked before Q reads your wallet.`,
  };
}

// ── invoke() — the ONLY path that can touch the seam. Governs first (default-deny), then routes the
//    request through the injected seam (which, in the browser, is the human-gated holo-wallet-bridge). ──
export function makeWalletAgent({ seam, authorize } = {}) {
  if (!seam) throw new Error("holo-wallet-agent: a seam (holo-wallet-bridge) is required");
  const auth = authorize || (async (d, o) => (await import("./holo-delegate.mjs")).authorizeRequest(d, o));
  return {
    describe, listTools, prepare,
    async invoke(name, args = {}, ctx = {}) {
      const tool = byName(name);
      if (!tool) return { ok: false, reason: "unknown tool: " + name };
      if (tool.status === "planned") return { ok: false, status: "planned", reason: `not wired — maps to ${tool.maps_to}`, maps_to: tool.maps_to };
      const g = await govern(tool, ctx, auth);
      if (!g.ok) return { ok: false, refused: true, ...g };
      if (tool.status === "needs-seam" && !seam[tool.seamKind]) {
        return { ok: false, status: "needs-seam", reason: `seam does not expose '${tool.seamKind}' yet (add a read kind to holo-wallet-bridge)` };
      }
      // a tool with a handler does multi-step work but STILL only touches the seam through the gated kind
      // (e.g. x402_pay builds an EIP-3009 authorization, then signs it via seam.signTypedData). Governance
      // already passed above, so the gate is the only thing that signs.
      if (tool.handler) {
        const out = await tool.handler({ seam, args, ctx });
        return { ok: true, via: g.via, tool: tool.name, result: out };
      }
      // route through the human-gated seam. The seam — not this module — produces the signature.
      const out = await seam[tool.seamKind](args, { delegation: ctx.delegation });
      return { ok: true, via: g.via, tool: tool.name, result: out };
    },
  };
}

// ── browser default: the live agent over the human-gated holo-wallet-bridge seam. ──────────────────
export async function browserWalletAgent(opts = {}) {
  const { seam } = await import("./holo-wallet-bridge.js");
  return makeWalletAgent({ seam, ...opts });
}

// ── Q context — the assistant's caller frame. Reads the user's standing, revocable read-consent toggle.
//    Spend/sign ALWAYS need ctx.userApproved (set only AFTER Q shows a confirm card and the user accepts).
//    The user flips the read grant in the wallet's Connected-sites UI; default OFF = Q asks for reads too. ──
export const Q_READ_GRANT_KEY = "holo.q.wallet.readGrant.v1";
export function qContext(extra = {}) {
  let readGrant = false;
  try { readGrant = (typeof localStorage !== "undefined") && localStorage.getItem(Q_READ_GRANT_KEY) === "1"; } catch {}
  return { caller: { kind: "q", label: "Q" }, readGrant, ...extra };
}

export { TOOLS, CAP, kappaOf };
export default makeWalletAgent;
