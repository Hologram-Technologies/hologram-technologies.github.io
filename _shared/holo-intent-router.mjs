// holo-intent-router.mjs — A2 of HOLO-WALLET-AMBIENT: chains disappear.
// The operator names WHAT (who gets how much); this module derives HOW (funding chain, bridge and
// send legs, fees folded into one total) and emits ONE κ-stamped proposal: outcome · total · time.
//
//   Value = realize(approve(derive(intent)))
//
// This is a DERIVER, not a signer (Law L4): it never touches keys. Execution is the existing engine
// methods (send · bridgeUsdt0) behind the existing seam and the ONE payload-bound biometric. The
// approved proposal's κ binds the exact route (Law L5): before each leg signs, the leg is re-derived
// from the approved proposal and anything else is REFUSED — the card the human saw is what runs.
//
// Honesty is structural: only WIRED legs route — direct sends, the pinned USD₮0 bridge lanes
// (holo-bridge USDT0 table), Velora-quotable fee estimates. An intent that needs anything else gets
// a plain-words refusal PROPOSAL, never a silent fallback and never a fake quote.
//
// Everything is injected ({ portfolio, quotes }) so the whole module is pure and witness-testable
// with zero network. EVM-first: v1 routes USD value (USD₮) across the EVM family; other assets ride
// single-leg direct sends where funds already sit, and refuse otherwise.

// ── κ — a content address over the JCS-canonical JSON of the object (SubtleCrypto, isomorphic) ────
const jcs = (v) => {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(jcs).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}";
};
export async function kappaOf(obj) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(jcs(obj)));
  return "holo://" + [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// ── R0 · THE CANON — one intent shape; identical meaning ⇒ identical κ (Law L2) ──────────────────
// raw: { verb, asset, amount, to, toChain? }  →  { intent, kappa }
//   verb   : send (v1; swap|fund|request reserved)
//   asset  : "USD" (≡ USD₮ value) or a native symbol ("ETH","SOL",…)
//   amount : human number/string → normalized decimal string (no trailing zeros, no exponent)
//   to     : 0x… (lowercased) · bc1/base58 (verbatim) · a resolvable name (via opts.resolveName)
//   toChain: optional landing network the RECIPIENT needs (a dApp's chain); absent = router's choice
export async function intentOf(raw, opts = {}) {
  const verb = String(raw.verb || "send").toLowerCase();
  const assetIn = String(raw.asset || "USD").toUpperCase();
  const asset = assetIn === "USDT" || assetIn === "USD₮" || assetIn === "USD" ? "USD" : assetIn;
  const n = Number(String(raw.amount).replace(/[$,\s]/g, ""));
  if (!(n > 0)) throw new Error("intent: amount must be a positive number");
  const amount = n.toFixed(9).replace(/\.?0+$/, "");            // canonical decimal spelling
  let to = String(raw.to || "").trim();
  if (opts.resolveName && to && !/^(0x|bc1|[1-9A-HJ-NP-Za-km-z]{32,})/.test(to)) to = await opts.resolveName(to);
  if (!to) throw new Error("intent: no recipient");
  if (/^0x[0-9a-fA-F]{40}$/.test(to)) to = to.toLowerCase();    // EVM addresses are case-free content
  const intent = { "@type": "holo:Intent", verb, asset, amount, to, ...(raw.toChain ? { toChain: String(raw.toChain).toLowerCase() } : {}) };
  return { intent, kappa: await kappaOf(intent) };
}

// ── the wired leg set — routes exist ONLY over what the engine already proves ─────────────────────
// lanes(USDT0): any src→dst pair present in holo-bridge's pinned table. Callers inject the table so
// this module stays pure; wallet.html passes the real import, the witness passes a fixture.
export const laneWired = (usdt0, src, dst) => !!(usdt0 && usdt0[src] && usdt0[dst]);

// ── R1 · THE DERIVER — intent + portfolio + quotes → ONE proposal (or a plain-words refusal) ─────
// portfolio: { balances: { "usdt:<chain>"|"<chain>": baseUnitsString }, addresses: {chain:addr}, prices }
// quotes:    { usdt0,                            — the pinned USDT0 lane table (or fixture)
//              bridgeFeeUsd({srcChain,dstChain,amount}) → number,   — real: quoteBridge → native fee → USD
//              sendFeeUsd({chain,token}) → number,                  — gas estimate in USD for one transfer
//              usdtOn(chain) → {addr,decimals}|null }               — the pinned USD₮ contract per chain
// Deterministic: same inputs ⇒ same proposal ⇒ same κ.
export async function derive(intentObj, { portfolio, quotes, etaSeconds = { send: 15, bridge: 90 } }) {
  const { intent, kappa: intentKappa } = intentObj.intent ? intentObj : { intent: intentObj, kappa: await kappaOf(intentObj) };
  const refuse = async (reason) => {
    const p = { "@type": "holo:Proposal", intent: intentKappa, refused: true, reason };
    return { ...p, kappa: await kappaOf(p) };
  };
  if (intent.verb !== "send") return refuse("Only sending is routed so far. " + intent.verb + " arrives with a later slice.");
  const amt = Number(intent.amount);

  // USD value rides USD₮ across the EVM family (EVM-first). Anything else: single-leg direct send only.
  if (intent.asset !== "USD") {
    const chain = Object.keys(portfolio.balances || {}).find((k) => !k.startsWith("usdt:") && (quotes.symbolOf ? quotes.symbolOf(k) : k.toUpperCase()) === intent.asset && Number(portfolio.balances[k]) > 0);
    if (!chain) return refuse("You do not hold " + intent.asset + " anywhere this router can send from.");
    const fee = await quotes.sendFeeUsd({ chain, token: null });
    if (fee == null) return refuse("The network fee on " + chain + " cannot be verified right now. Try again shortly.");
    const legs = [{ op: "send", call: { kind: "send", chain, to: intent.to, amount: intent.amount, token: null } }];
    return seal({ intentKappa, intent, legs, outcomeUsd: null, outcomeText: intent.amount + " " + intent.asset, feesUsd: fee, etaSeconds: etaSeconds.send });
  }

  // where do the dollars live? richest USD₮ pocket first (fewest legs, deterministic tiebreak by name)
  const pockets = Object.entries(portfolio.balances || {})
    .filter(([k]) => k.startsWith("usdt:"))
    .map(([k, v]) => ({ chain: k.slice(5), usd: Number(v) / 10 ** ((quotes.usdtOn(k.slice(5)) || { decimals: 6 }).decimals) }))
    .filter((p) => p.usd > 0)
    .sort((a, b) => b.usd - a.usd || (a.chain < b.chain ? -1 : 1));
  if (!pockets.length) return refuse("You hold no digital dollars yet. Buy or receive USD₮ first.");

  const dst = intent.toChain || null;
  // 1 · a pocket already on the landing chain (or no landing constraint) → ONE send leg
  const local = dst ? pockets.find((p) => p.chain === dst && p.usd >= amt) : pockets.find((p) => p.usd >= amt);
  if (local) {
    const t = quotes.usdtOn(local.chain);
    if (!t) return refuse("No verified USD₮ contract is pinned for " + local.chain + " in this host.");
    const fee = await quotes.sendFeeUsd({ chain: local.chain, token: t.addr });
    if (fee == null) return refuse("The network fee on " + local.chain + " cannot be verified right now. Try again shortly.");
    const legs = [{ op: "send", call: { kind: "send", chain: local.chain, to: intent.to, amount: intent.amount, token: t.addr } }];
    return seal({ intentKappa, intent, legs, outcomeUsd: amt, feesUsd: fee, etaSeconds: etaSeconds.send });
  }
  // 2 · funds elsewhere + a landing chain → bridge lane + send, both from the PINNED table
  if (dst) {
    const src = pockets.find((p) => p.usd >= amt && laneWired(quotes.usdt0, p.chain, dst));
    if (!src) return refuse("Your dollars sit where no verified lane reaches " + dst + " yet. Wired lanes: " + Object.keys(quotes.usdt0 || {}).join(", ") + ".");
    const t = quotes.usdtOn(dst);
    if (!t) return refuse("No verified USD₮ contract is pinned for " + dst + " in this host.");
    const bridgeFee = await quotes.bridgeFeeUsd({ srcChain: src.chain, dstChain: dst, amount: intent.amount });
    const sendFee = await quotes.sendFeeUsd({ chain: dst, token: t.addr });
    if (bridgeFee == null || sendFee == null) return refuse("The route fee cannot be verified right now. Try again shortly.");
    const legs = [
      { op: "bridge", call: { kind: "bridge", srcChain: src.chain, dstChain: dst, amount: intent.amount } },
      { op: "send", call: { kind: "send", chain: dst, to: intent.to, amount: intent.amount, token: t.addr } },
    ];
    return seal({ intentKappa, intent, legs, outcomeUsd: amt, feesUsd: bridgeFee + sendFee, etaSeconds: etaSeconds.bridge + etaSeconds.send });
  }
  return refuse("No single pocket covers $" + amt.toFixed(2) + " yet. Combining pockets arrives with a later slice.");

  // R2 · the fold — ONE total; the card never names a gas token (fees are derivable detail, one tap deeper)
  async function seal({ intentKappa, intent, legs, outcomeUsd, outcomeText, feesUsd, etaSeconds }) {
    const totalUsd = outcomeUsd == null ? null : +(outcomeUsd + feesUsd).toFixed(2);
    const core = { "@type": "holo:Proposal", intent: intentKappa, legs: legs.map((l) => l.call), outcomeUsd, feesUsd: +feesUsd.toFixed(2), totalUsd, etaSeconds };
    const kappa = await kappaOf(core);
    const who = intent.to.length > 14 ? intent.to.slice(0, 6) + "…" + intent.to.slice(-4) : intent.to;
    const sentence = outcomeUsd == null
      ? `${who} gets ${outcomeText}. Costs you about $${feesUsd.toFixed(2)} in fees, about ${etaSeconds} seconds.`
      : `${who} gets $${outcomeUsd.toFixed(2)}. Costs you $${totalUsd.toFixed(2)} total, about ${etaSeconds} seconds.`;
    return { ...core, legs, kappa, card: { outcome: outcomeUsd == null ? outcomeText : "$" + outcomeUsd.toFixed(2), total: totalUsd == null ? "$" + feesUsd.toFixed(2) + " fees" : "$" + totalUsd.toFixed(2), etaSeconds, sentence } };
  }
}

// ── R4 · THE BINDING (Law L5) — the approved κ authorizes EXACTLY its legs, each once ─────────────
// makeApprovals() → arm(proposal) after ONE biometric · match(req) consumes a leg iff it re-derives
// from the armed proposal · disarm() on completion/failure. Anything unmatched falls to the human gate.
const legEq = (call, req) => Object.entries(call).every(([k, v]) => String(req[k] ?? null) === String(v ?? null)) && (req.kind || "send") === call.kind;
export function makeApprovals() {
  let armed = null;   // { proposal, used:Set<int> }
  return {
    arm(proposal) { armed = { proposal, used: new Set() }; },
    disarm() { armed = null; },
    active() { return armed && armed.proposal.kappa; },
    match(req) {
      if (!armed) return false;
      const legs = armed.proposal.legs.map((l) => l.call || l);
      const i = legs.findIndex((c, ix) => !armed.used.has(ix) && legEq(c, req));
      if (i < 0) return false;
      armed.used.add(i); return true;
    },
  };
}

// ── R3 · THE SEAM — two kinds, mounted by any responder (wallet.html + makeSignResponder deps) ────
// handleIntent(req, ctx) → reply payload | null (not an intent kind).
//   ctx: { wallet, gate, approvals, portfolio(), quotes, resolveName? }
// "intent"          : READ — derive a proposal; never gates (SEC-2: every surface may derive).
// "intent-realize"  : re-derive against the CURRENT portfolio/quotes; the κ must equal what the
//                     caller approved-for (drift ⇒ refused + fresh proposal back); ONE gate whose
//                     reason is the card sentence verbatim; legs execute through the engine, each
//                     auto-approved once via the armed binding; the receipt is a κ object.
export async function handleIntent(req, ctx) {
  if (req.kind !== "intent" && req.kind !== "intent-realize") return null;
  const intentObj = await intentOf(req.intent || {}, { resolveName: ctx.resolveName });
  const proposal = await derive(intentObj, { portfolio: await ctx.portfolio(), quotes: ctx.quotes });
  if (req.kind === "intent") return { ok: true, proposal: publicView(proposal) };
  if (proposal.refused) return { ok: false, proposal: publicView(proposal), error: proposal.reason };
  if (req.proposalKappa && req.proposalKappa !== proposal.kappa)
    return { ok: false, drift: true, proposal: publicView(proposal), error: "The route changed since you saw it. Review the fresh card." };
  const approved = await ctx.gate({ type: "intent", chain: proposal.legs[0].call.chain || proposal.legs[0].call.srcChain, amount: intentObj.intent.amount, to: intentObj.intent.to, _who: "One approval covers the whole route.", _plain: proposal.card.sentence, _card: proposal.card, outcomeUsd: proposal.outcomeUsd, totalUsd: proposal.totalUsd, feesUsd: proposal.feesUsd, etaSeconds: proposal.etaSeconds, kappaBound: proposal.kappa });
  if (!approved) return { error: "declined by you" };
  ctx.approvals.arm(proposal);
  const done = [];
  try {
    for (const leg of proposal.legs) {
      const c = leg.call;
      if (c.kind === "send") done.push({ leg: c, hash: (await ctx.wallet.send({ chain: c.chain, to: c.to, amount: c.amount, token: c.token || undefined })).hash });
      else if (c.kind === "bridge") done.push({ leg: c, hash: (await ctx.wallet.bridgeUsdt0({ srcChain: c.srcChain, dstChain: c.dstChain, amount: c.amount })).hash });
      else throw new Error("unroutable leg " + c.kind);
    }
    const receipt = { "@type": "holo:Receipt", proposal: proposal.kappa, legs: done, totalUsd: proposal.totalUsd };
    return { ok: true, receipt: { ...receipt, kappa: await kappaOf(receipt) } };
  } catch (e) {
    // partial failure: report the completed prefix honestly — never improvise a new route (L5)
    return { error: "stopped after " + done.length + " of " + proposal.legs.length + " steps: " + (e && e.message), completed: done, proposal: publicView(proposal) };
  } finally { ctx.approvals.disarm(); }
}
const publicView = (p) => ({ kappa: p.kappa, refused: !!p.refused, reason: p.reason, card: p.card, legs: (p.legs || []).map((l) => l.call || l), totalUsd: p.totalUsd, feesUsd: p.feesUsd, outcomeUsd: p.outcomeUsd, etaSeconds: p.etaSeconds, intent: p.intent });
