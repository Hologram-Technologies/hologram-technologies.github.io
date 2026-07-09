// holo-wallet-resident.mjs — the OS-wide signing seam's ANSWERING side, extracted from wallet.html
// into a resident, window-free module (HOLO-WALLET-AMBIENT A1). The wallet stops being a window:
// this responder attaches to the ONE BroadcastChannel("holo-wallet") seam at operator sign-in and
// answers whether or not any wallet surface is open. wallet.html becomes a projection of the same
// capability — it defers to a resident when one is alive (claim protocol below), so a request is
// answered exactly once.
//
// First principles (holospaces Laws + Product-Security):
//   • One door (L4/SEC-2). This module MOVES the seam's answerer; it does not add a second signing
//     path. The payload-bound biometric step-up stays where it always was — inside HoloWallet's
//     value/sign methods (the injected gate) — so resident and window yield the SAME one-biometric-
//     per-act guarantee. Nothing here touches key material.
//   • Display-split preserved (SEC-4). The shell never holds the seed. `resolveWallet` is LAZY: the
//     vault opens on first credential use (session stash + broker biometric), not at attach time.
//     Until an operator's vault can open, the responder fail-closes with the honest locked error.
//   • Default-deny + honest surface (L5). A blocked origin is refused BEFORE the gate; an un-wired
//     capability refuses plainly ("not wired in this host") — it never fakes; a declined gate is
//     "declined by you", verbatim the wallet.html contract.
//   • Agent rule unchanged: a delegated request must be AUTHORIZED to even ask (holo-delegate,
//     hybrid-verified, unexpired, unrevoked, capability-scoped) — and the human still approves.
//
// Pure + isomorphic: no DOM, no localStorage, no fetch — every effect is injected (wallet resolver,
// gate, sites storage, price/history/swap providers, delegate + HTLC modules, the channel itself).
// The browser hosts inject the real modules; the Node witness injects in-memory fakes and proves the
// seam answers with NO WINDOW AT ALL.

// ── connected-sites registry — the thin local log over the seam (who · when · what; block-first) ──
// storage: { get(key)→string|null, set(key,value) } — localStorage in the shell, a Map in the witness.
export function makeSites(storage, key = "hw:sites") {
  const all = () => { try { return JSON.parse(storage.get(key) || "{}"); } catch { return {}; } };
  const save = (m) => storage.set(key, JSON.stringify(m));
  return {
    all, save,
    touch(origin, kind) { const m = all(); const k = origin || "this device (same-origin)"; const e = m[k] || { origin: k, count: 0, blocked: false, kinds: {} }; e.count++; e.last = Date.now(); e.kinds[kind] = (e.kinds[kind] || 0) + 1; m[k] = e; save(m); },
    setBlocked(origin, b) { const m = all(); if (m[origin]) { m[origin].blocked = b; save(m); } },
    isBlocked(origin) { return !!all()[origin || "this device (same-origin)"]?.blocked; },
  };
}

// htlcToken — pure helper ported verbatim from wallet.html (asset symbol → {addr, decimals} on a chain).
const htlcToken = (asset, chain, art, CHAINS) => { const t = art?.tokens?.[chain]?.[asset]; if (t) return { addr: t.addr, decimals: t.decimals }; if (!asset || asset === CHAINS[chain]?.symbol) return { addr: null, decimals: CHAINS[chain]?.decimals || 18 }; return { addr: null, decimals: 6 }; };

// ── the responder: the wallet.html router, verbatim in behaviour, with every effect injected ──────
// makeSignResponder({
//   resolveWallet : async () → HoloWallet|null  — LAZY; null/locked ⇒ honest locked refusal (display-split).
//   gate          : async (req) → boolean       — the SAME human gate the wallet instance holds (HTLC branches call it directly, as wallet.html did).
//   sites         : makeSites(...)              — block-before-gate + touch log.
//   CHAINS        : chain table (holo-wdk)      — names/symbols/decimals/rpc.
//   deps          : { priceUsd?, history?, jupQuote?, intent? }   — read/quote providers; absent ⇒ honest refusal.
//                     intent: async (req, {wallet, gate}) → reply payload — the A2 router (holo-intent-router
//                     handleIntent, closed over the host's portfolio/quotes/approvals); absent ⇒ honest refusal.
//   loadDelegate  : async () → { authorizeRequest, attestationOf } — agent (NPC) authorization module.
//   loadHtlc      : async () → holo-htlc module  — Holo Pay settlement; absent ⇒ honest refusal.
//   htlcArt       : async () → artifact          — deployed HTLC addresses/tokens (fetch in browser, stub in witness).
//   revokedOf     : (ownerKappa) → string[]      — revoked delegation κs (localStorage in shell).
//   ownerKappa    : () → string|null             — the signed-in operator (delegation issuer fallback).
//   onAgent       : (agentCtx|null) → void       — lets the host's gate display who is asking.
//   nowIso        : () → ISO string              — injectable clock (witness determinism).
// }) → respond(d, reply, origin)
export function makeSignResponder({ resolveWallet, gate, sites, CHAINS = {}, deps = {}, loadDelegate, loadHtlc, htlcArt, revokedOf = () => [], ownerKappa = () => null, onAgent = () => {}, nowIso = () => new Date().toISOString() }) {
  const missing = (what) => ({ error: what + " isn't wired in this host yet" });   // honest refusal, never a mock
  return async function respond(d, reply, origin) {
    if (!d || d.type !== "holo-wallet:sign-request") return;
    const wallet = await Promise.resolve(resolveWallet()).catch(() => null);
    if (!wallet || !wallet.unlocked) return reply({ error: "wallet locked open Holo Wallet and unlock" });
    const req = d.request || {};
    // ── AGENT (NPC) DELEGATION — the agent must be authorised to even ASK (Law L5 re-derived,
    //    unexpired, unrevoked, capability-scoped). The human still approves at the gate.
    let agentCtx = null; onAgent(null);
    if (req.delegation) {
      try {
        if (!loadDelegate) return reply({ error: "agent: delegation isn't wired in this host yet" });
        const { authorizeRequest, attestationOf } = await loadDelegate();
        const owner = ownerKappa() || req.delegation.issuer;
        const auth = authorizeRequest(req.delegation, { kind: req.kind, revoked: revokedOf(owner), nowIso: nowIso() });
        if (!auth.ok) return reply({ error: "agent: " + auth.reason });
        agentCtx = auth.agent;
        try { if (attestationOf) agentCtx.attest = await attestationOf(req.delegation); } catch {}
        onAgent(agentCtx);
      } catch (e) { return reply({ error: "agent delegation error: " + (e && e.message) }); }
    }
    // reads (address) never gate; the connected-sites block + log applies to everything else. The
    // payload-bound biometric step-up is NOT here — it lives inside the wallet's own methods (the
    // injected gate), so bridge and in-wallet UI both get exactly one biometric over the exact action.
    if (req.kind !== "address") {
      if (sites.isBlocked(origin)) return reply({ error: "blocked by you in Connected sites" });
      sites.touch(agentCtx ? ("agent · " + (agentCtx.label || agentCtx.subject)) : origin, req.kind || "send");
    }
    try {
      // ── A2 · intents — derive is a free read (SEC-2); realize is ONE biometric over the whole route ──
      if (req.kind === "intent" || req.kind === "intent-realize") { if (!deps.intent) return reply(missing("intent routing")); return reply(await deps.intent(req, { wallet, gate })); }
      if (req.kind === "sign") reply({ ok: true, signature: await wallet.signMessage({ chain: req.chain, message: req.message }) });
      else if (req.kind === "signTypedData") reply({ ok: true, signature: await wallet.signTypedData({ chain: req.chain || "ethereum", typedData: req.typedData }) });
      else if (req.kind === "address") reply({ ok: true, address: await wallet.address(req.chain || "ethereum") });
      // ── reads — value never moves; answered from the wallet's own keys/live RPC, no signature ──
      else if (req.kind === "addresses") reply({ ok: true, addresses: await wallet.addresses() });
      else if (req.kind === "balance") reply({ ok: true, chain: req.chain, balance: String(await wallet.balance(req.chain)) });
      else if (req.kind === "tokenBalance") { const acc = await wallet.account(req.chain); reply({ ok: true, chain: req.chain, token: req.token, balance: String(await acc.getTokenBalance(req.token)) }); }
      else if (req.kind === "price") { if (!deps.priceUsd) return reply(missing("price")); reply({ ok: true, price: await deps.priceUsd(req.chains || Object.keys(CHAINS)) }); }
      else if (req.kind === "history") { if (!deps.history) return reply(missing("history")); reply({ ok: true, history: await deps.history(req.chain, await wallet.address(req.chain), { limit: req.limit || 25 }) }); }
      else if (req.kind === "swapQuote") { if (!deps.jupQuote) return reply(missing("swap quotes")); const q = await deps.jupQuote({ inputMint: req.inputMint, outputMint: req.outputMint, amount: req.amount }); reply({ ok: true, quote: q }); }
      else if (req.kind === "swapQuoteEvm") reply({ ok: true, quote: await wallet.quoteEvm({ chain: req.chain || "ethereum", srcToken: req.srcToken, destToken: req.destToken, amount: req.amount, srcDecimals: req.srcDecimals, destDecimals: req.destDecimals }) });
      else if (req.kind === "swap") { if (!deps.jupQuote) return reply(missing("swap")); const r = await wallet.swap({ inputMint: req.inputMint, outputMint: req.outputMint, amount: req.amount, slippageBps: req.slippageBps, inputDecimals: req.inputDecimals }); reply({ ok: true, txid: r.txid, hash: r.txid }); }
      else if (req.kind === "swapEvm") { const r = await wallet.swapEvm({ chain: req.chain || "ethereum", srcToken: req.srcToken, destToken: req.destToken, amount: req.amount, slippageBps: req.slippageBps, srcDecimals: req.srcDecimals, destDecimals: req.destDecimals }); reply({ ok: true, ...r }); }
      else if (req.kind === "bridgeQuote") reply({ ok: true, quote: await wallet.quoteBridge({ srcChain: req.srcChain, dstChain: req.dstChain, to: req.to, amount: req.amount }) });
      else if (req.kind === "bridge") { const r = await wallet.bridgeUsdt0({ srcChain: req.srcChain, dstChain: req.dstChain, to: req.to, amount: req.amount, slippageBps: req.slippageBps }); reply({ ok: true, ...r }); }
      else if (req.kind === "lendingPositions") reply({ ok: true, positions: await wallet.lendingPositions({ chain: req.chain || "arbitrum" }) });
      else if (req.kind === "lending") { const r = await wallet.lendingAct({ chain: req.chain || "arbitrum", action: req.action, asset: req.asset, amount: req.amount, decimals: req.decimals, rateMode: req.rateMode }); reply({ ok: true, ...r }); }
      else if (req.kind === "fiatQuote") reply({ ok: true, quote: await wallet.fiatQuote({ currencyCode: req.currencyCode, baseCurrencyAmount: req.baseCurrencyAmount, baseCurrencyCode: req.baseCurrencyCode }) });
      else if (req.kind === "fiat") { const r = await wallet.fiatBuy({ currencyCode: req.currencyCode, baseCurrencyAmount: req.baseCurrencyAmount, baseCurrencyCode: req.baseCurrencyCode }); reply({ ok: true, ...r }); }
      else if (req.kind === "aaAddress") reply({ ok: true, address: await wallet.aaAddress({ chain: req.chain || "ethereum", salt: req.salt }) }); // read: counterfactual smart-account address
      else if (req.kind === "aaSend") { const r = await wallet.aaSend({ chain: req.chain || "ethereum", to: req.to, value: req.value, data: req.data, salt: req.salt, deploy: req.deploy }); reply({ ok: true, ...r }); } // gated: signs the userOpHash
      else if (req.kind === "aa7702") { const r = await wallet.aa7702({ chain: req.chain || "ethereum", implAddress: req.implAddress }); reply({ ok: true, ...r }); } // gated: signs the EIP-7702 authorization
      // ── Holo Pay HTLC settlement ──
      else if (req.kind === "htlcConfigured") { if (!loadHtlc || !htlcArt) return reply(missing("Holo Pay")); const art = await htlcArt(); const { htlcAddressFor } = await loadHtlc(); reply({ ok: true, configured: !!htlcAddressFor(req.chain, art) }); }   // read
      else if (req.kind === "htlcSwapExists") {   // read: is a live swap on-chain for this hashlock? (recipient auto-discovery)
        if (!loadHtlc || !htlcArt) return reply(missing("Holo Pay"));
        const art = await htlcArt(); const { htlcAddressFor, readSwap } = await loadHtlc();
        const chains = req.chain ? [req.chain] : Object.keys(art.addresses || {}).filter((k) => htlcAddressFor(k, art));
        let found = null;
        for (const ch of chains) { const h = htlcAddressFor(ch, art); if (!h) continue; if ((await readSwap({ rpcUrl: CHAINS[ch]?.rpc, htlc: h, hashlock: req.hashlock })).found) { found = ch; break; } }
        reply({ ok: true, found: !!found, chain: found });
      }
      else if (req.kind === "htlcFund" || req.kind === "htlcClaim" || req.kind === "htlcRefund") {   // gated: value moves
        if (!loadHtlc || !htlcArt) return reply(missing("Holo Pay"));
        const art = await htlcArt(); const chain = req.chain || "base"; const { htlcAddressFor, htlcFund, htlcClaim, htlcRefund } = await loadHtlc();
        const htlcAddress = htlcAddressFor(chain, art);
        if (!htlcAddress) return reply({ error: "Holo Pay isn't live on " + (CHAINS[chain]?.name || chain) + " yet" });
        const acc = await wallet.account(chain); const from = await acc.getAddress();
        if (req.kind === "htlcFund") {
          const { addr: token, decimals } = htlcToken(req.token, chain, art, CHAINS);
          if (!(await gate({ type: "send", chain, amount: req.amount, to: htlcAddress, address: from, _who: `Holo Pay — lock ${req.amount} ${req.token || CHAINS[chain]?.symbol} in on-chain escrow. Only revealing the claim link releases it.` }))) return reply({ error: "declined by you" });
          const r = await htlcFund(acc, { htlc: htlcAddress, hashlock: req.hashlock, timeout: Math.floor(Number(req.timeout) / 1000), token, amount: BigInt(Math.round(Number(req.amount) * 10 ** decimals)) });
          reply({ ok: true, tx: r.tx, swapId: r.swapId });
        } else if (req.kind === "htlcClaim") {
          if (!(await gate({ type: "send", chain, address: from, _who: "Holo Pay — claim escrowed funds to your wallet (reveals the secret on-chain)." }))) return reply({ error: "declined by you" });
          const r = await htlcClaim(acc, { htlc: htlcAddress, hashlock: req.hashlock, preimage: req.preimage });
          reply({ ok: true, tx: r.tx });
        } else {
          if (!(await gate({ type: "send", chain, address: from, _who: "Holo Pay — refund your expired escrow back to this wallet." }))) return reply({ error: "declined by you" });
          const r = await htlcRefund(acc, { htlc: htlcAddress, hashlock: req.hashlock });
          reply({ ok: true, tx: r.tx });
        }
      }
      else { const r = await wallet.send({ chain: req.chain, to: req.to, amount: req.amount, token: req.token }); reply({ ok: true, hash: r.hash }); }
    } catch (err) { reply({ error: err.message }); }
  };
}

// ── the claim protocol — a request is answered exactly ONCE, resident preferred ──────────────────
// The resident announces itself (hello) and answers presence pings (ping→pong). A wallet WINDOW
// attaches only as a fallback: it pings first, defers if a resident is alive, and detaches the
// moment a resident's hello arrives later. No election, no lock — announcement + deference.
const MSG = { req: "holo-wallet:sign-request", res: "holo-wallet:sign-result", hello: "holo-wallet:resident-hello", ping: "holo-wallet:resident-ping", pong: "holo-wallet:resident-pong" };

// attachResidentSeam({respond, bus}) → detach. `bus` = BroadcastChannel("holo-wallet") (or a mock).
export function attachResidentSeam({ respond, bus }) {
  const onMsg = (e) => {
    const d = e.data || {};
    if (d.type === MSG.ping) { bus.postMessage({ type: MSG.pong }); return; }
    respond(d, (p) => bus.postMessage({ type: MSG.res, id: d?.id, ...p }), "this device (same-origin)");
  };
  bus.addEventListener("message", onMsg);
  bus.postMessage({ type: MSG.hello });                       // late-boot: windows already attached defer now
  return () => bus.removeEventListener("message", onMsg);
}

// residentPresent({bus, timeoutMs}) → Promise<boolean> — one ping, first pong wins.
export function residentPresent({ bus, timeoutMs = 300 }) {
  return new Promise((resolve) => {
    const done = (v) => { bus.removeEventListener("message", onMsg); clearTimeout(t); resolve(v); };
    const onMsg = (e) => { if (e.data && e.data.type === MSG.pong) done(true); };
    const t = setTimeout(() => done(false), timeoutMs);
    bus.addEventListener("message", onMsg);
    bus.postMessage({ type: MSG.ping });
  });
}

// attachWindowSeam({respond, bus}) → detach — the wallet WINDOW's deferential attach: answer only
// while no resident lives; stand down (forever) on the first resident hello/pong seen.
export function attachWindowSeam({ respond, bus }) {
  let deferred = false;
  const onMsg = (e) => {
    const d = e.data || {};
    if (d.type === MSG.hello || d.type === MSG.pong) { deferred = true; return; }
    if (deferred || d.type === MSG.ping) return;
    respond(d, (p) => bus.postMessage({ type: MSG.res, id: d?.id, ...p }), "this device (same-origin)");
  };
  bus.addEventListener("message", onMsg);
  residentPresent({ bus }).then((alive) => { if (alive) deferred = true; });
  return () => bus.removeEventListener("message", onMsg);
}
