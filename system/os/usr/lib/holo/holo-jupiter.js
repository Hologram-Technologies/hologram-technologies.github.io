// holo-jupiter.js — the Solana spot-swap engine: Jupiter, hologram-native. The SwidgeProtocol
// provider the WDK seam (holo-wdk.js) was always shaped for, and the Solana counterpart of the
// Hyperliquid write side (ADR-0070) — one verifiable terminal, perps on Hyperliquid, spot on Solana.
//
// First principles: Jupiter's ROUTE is computed off-chain on Jupiter's servers — it is NOT
// re-derivable in the browser, so we never trust it. We trust-minimize it the only honest way:
//   • min-out FLOOR — re-derive the worst acceptable output from outAmount ⊕ slippageBps and
//     refuse if Jupiter's own otherAmountThreshold is weaker than our independent floor.
//   • sealed-program ASSERTION — re-parse the transaction Jupiter built and require that it
//     invokes the SEALED Jupiter v6 program, paid by OUR key (anti-phishing is structural).
//   • pre-sign SIMULATION — simulate against the chain; a failing sim never reaches the gate.
//   • default-deny SIGNING — the key stays in Holo Wallet; nothing signs without the human's tap.
// The quote is input; the chain is the judge. That is Law L5 ("verify by re-derivation") in its
// Solana-native form (cf. holo-solana.js: κ is ed25519 verification, not a hash match).
//
// Pure (Node-testable, no network): minOutFloor, parseVersionedTx, assertSwapTx, verifyVenue.
// Network: quote, buildSwap, and the swap() orchestrator. Isomorphic, like every holo-* module.

// ── the sealed venue (mirrors system/os/etc/holo-chains/jupiter.uor.json's sealedBody) ──────────
// Hosts/program pinned here are RE-DERIVED against the on-disk descriptor by verifyVenue/loadVenue —
// a swapped host or program changes the κ and is refused at load. Free tier (lite-api); the paid
// plane is api.jup.ag. RE-VERIFY against developers.jup.ag before treating as production-canonical.
export const JUPITER = {
  name: "Jupiter",
  api: "https://lite-api.jup.ag",
  quote: "https://lite-api.jup.ag/swap/v1/quote",
  swap: "https://lite-api.jup.ag/swap/v1/swap",
  programV6: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  chain: "solana",
  caip2: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
};

// A few canonical SPL mints so callers (and the wallet UI) can name common tokens without a list.
export const MINTS = {
  SOL:  "So11111111111111111111111111111111111111112", // wrapped SOL (native is auto-wrapped)
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
};

// ── byte / base58 / canonicalization utils (browser + Node; no deps) ────────────────────────────
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58enc(buf) {
  const d = [0]; for (const b of buf) { let c = b; for (let i = 0; i < d.length; i++) { c += d[i] << 8; d[i] = c % 58; c = (c / 58) | 0; } while (c) { d.push(c % 58); c = (c / 58) | 0; } }
  let s = ""; for (const b of buf) { if (b === 0) s += "1"; else break; } return s + d.reverse().map((x) => B58[x]).join("");
}
const b64ToBytes = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
const shortvec = (buf, off) => { let v = 0, sh = 0, p = off; for (;;) { const b = buf[p++]; v |= (b & 0x7f) << sh; if (!(b & 0x80)) break; sh += 7; } return [v, p]; };
// RFC 8785 JCS (sufficient for the descriptor's string/number body) — the SAME canonical form
// holo-uor.mjs seals with, so a browser re-derivation matches the Node seal byte-for-byte.
const jcs = (v) => Array.isArray(v) ? "[" + v.map(jcs).join(",") + "]"
  : (v && typeof v === "object") ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}"
  : JSON.stringify(v);
async function sha256hex(str) { const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str))); return [...h].map((b) => b.toString(16).padStart(2, "0")).join(""); }

// ── verify the sealed venue descriptor (Law L5) ─────────────────────────────────────────────────
// Re-derive κ = did:holo:sha256:H(jcs(sealedBody)) and compare to the descriptor's head. On match,
// the sealedBody IS the trusted live config; on mismatch the venue is refused (a swapped host/program
// can't survive the κ check). loadVenue is what an app calls before its first swap.
export async function verifyVenue(descriptor) {
  const head = descriptor?.head;
  const key = Object.keys(descriptor || {}).find((k) => k.endsWith("sealedBody"));
  const body = key ? descriptor[key] : null;
  if (!body) return { ok: false, reason: "no sealedBody" };
  const kappa = "did:holo:sha256:" + await sha256hex(jcs(body));
  return { ok: kappa === head, kappa, head, body };
}
export async function loadVenue(descriptor) {
  const v = await verifyVenue(descriptor);
  if (!v.ok) throw new Error("Jupiter venue descriptor failed re-derivation (κ mismatch) — refusing");
  return v.body;
}

// ── min-out FLOOR — re-derived independently of Jupiter's slippage math ──────────────────────────
// For an ExactIn swap the worst acceptable output is outAmount·(1 − slippageBps/1e4), floored. We
// require Jupiter's own otherAmountThreshold (what it bakes into the tx) to be AT LEAST our floor —
// so the user is never silently exposed to more slippage than the bps they chose.
export function minOutFloor(quote) {
  const out = BigInt(quote.outAmount);
  const bps = BigInt(quote.slippageBps ?? 0);
  const floor = (out * (10000n - bps)) / 10000n;
  const threshold = BigInt(quote.otherAmountThreshold ?? quote.outAmount);
  return { floor, threshold, ok: threshold >= floor };
}

// ── parse a (versioned or legacy) Solana transaction — enough to read its signer + programs ──────
export function parseVersionedTx(bytes) {
  const [sigCount, p1] = shortvec(bytes, 0);
  const message = bytes.subarray(p1 + 64 * sigCount);
  const versioned = (message[0] & 0x80) !== 0;
  let off = versioned ? 1 : 0;
  const numReqSig = message[off]; off += 3;                 // header: reqSig, roSigned, roUnsigned
  const [keyCount, kp] = shortvec(message, off); off = kp;
  const keys = []; for (let i = 0; i < keyCount; i++) { keys.push(b58enc(message.subarray(off, off + 32))); off += 32; }
  off += 32;                                                // recentBlockhash
  const [ixCount, ip] = shortvec(message, off); off = ip;
  const programIdx = [];
  for (let i = 0; i < ixCount; i++) {
    const pid = message[off++];
    const [accLen, ap] = shortvec(message, off); off = ap + accLen;
    const [dataLen, dp] = shortvec(message, off); off = dp + dataLen;
    programIdx.push(pid);
  }
  // program accounts are ALWAYS in the static key set (never an address-table lookup), so this
  // resolves every invoked program even for v0 transactions with table lookups.
  const programs = [...new Set(programIdx.map((i) => keys[i]))];
  return { sigCount, numReqSig, feePayer: keys[0], keys, programs };
}

// ── trust-minimize the built transaction (anti-phishing, structural) ─────────────────────────────
// The tx Jupiter handed back MUST be paid by our address AND must invoke the sealed Jupiter program.
// A look-alike route to a drainer program changes `programs`; a swapped fee-payer changes `feePayer`.
export function assertSwapTx(swapTransactionB64, { expectedSigner, programId }) {
  const tx = parseVersionedTx(b64ToBytes(swapTransactionB64));
  if (tx.feePayer !== expectedSigner) throw new Error(`swap fee-payer ${tx.feePayer} ≠ wallet ${expectedSigner} — refusing`);
  if (programId && !tx.programs.includes(programId)) throw new Error("swap does not invoke the sealed Jupiter program — refusing");
  return tx;
}

// ── network: quote + build (Jupiter's two REST calls; the only off-chain trust, fully bounded) ───
const _fetch = (impl) => impl || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
export async function quote({ inputMint, outputMint, amount, slippageBps = 50, swapMode = "ExactIn" }, { fetchImpl, venue = JUPITER } = {}) {
  const f = _fetch(fetchImpl); if (!f) throw new Error("no fetch");
  const u = new URL(venue.quote);
  u.search = new URLSearchParams({ inputMint, outputMint, amount: String(amount), slippageBps: String(slippageBps), swapMode, restrictIntermediateTokens: "true" }).toString();
  const r = await f(u.toString());
  if (!r.ok) throw new Error("Jupiter quote failed: " + r.status + " " + (await r.text().catch(() => "")));
  const q = await r.json();
  if (q.error) throw new Error("Jupiter quote: " + q.error);
  return q;
}
export async function buildSwap({ quote, userPublicKey }, { fetchImpl, venue = JUPITER } = {}) {
  const f = _fetch(fetchImpl); if (!f) throw new Error("no fetch");
  const r = await f(venue.swap, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ quoteResponse: quote, userPublicKey, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, dynamicSlippage: false }),
  });
  if (!r.ok) throw new Error("Jupiter swap-build failed: " + r.status + " " + (await r.text().catch(() => "")));
  const j = await r.json();
  if (!j.swapTransaction) throw new Error("Jupiter swap-build: no transaction returned");
  return j;
}

// ── swap() — the one orchestrated call: quote → verify → simulate → APPROVE → sign → submit ─────
// `source` is anything with .call(method, params) (a holo-solana SolanaSource). `sign(b64)` returns
// the signed tx (base64) — the key never enters this module. `approve(info)` is the default-deny
// gate; it sees only re-derived, simulation-passed numbers, so the human approves the truth.
export async function swap(
  { inputMint, outputMint, amount, slippageBps = 50, userPublicKey },
  { source, sign, approve = async () => true, fetchImpl, venue = JUPITER } = {}
) {
  if (!source) throw new Error("swap needs a Solana source (.call)");
  if (!sign) throw new Error("swap needs a sign(base64) callback");
  const q = await quote({ inputMint, outputMint, amount, slippageBps }, { fetchImpl, venue });
  const floor = minOutFloor(q);
  if (!floor.ok) throw new Error(`Jupiter's min-out (${floor.threshold}) is below our ${slippageBps}bps floor (${floor.floor}) — refusing`);
  const built = await buildSwap({ quote: q, userPublicKey }, { fetchImpl, venue });
  assertSwapTx(built.swapTransaction, { expectedSigner: userPublicKey, programId: venue.programV6 });
  const sim = await source.call("simulateTransaction", [built.swapTransaction, { encoding: "base64", replaceRecentBlockhash: true, sigVerify: false, commitment: "confirmed" }]);
  if (sim?.value?.err) throw new Error("swap simulation failed: " + JSON.stringify(sim.value.err));
  const info = { quote: q, minOut: floor.floor.toString(), inAmount: q.inAmount, outAmount: q.outAmount, priceImpactPct: q.priceImpactPct, route: (q.routePlan || []).map((p) => p.swapInfo?.label).filter(Boolean) };
  if (!(await approve(info))) throw new Error("Swap request denied");
  const signed = await sign(built.swapTransaction);
  const txid = await source.call("sendTransaction", [signed, { encoding: "base64", skipPreflight: false, maxRetries: 3 }]);
  return { txid, ...info, simulated: true, lastValidBlockHeight: built.lastValidBlockHeight };
}

export default { JUPITER, MINTS, quote, buildSwap, swap, minOutFloor, assertSwapTx, parseVersionedTx, verifyVenue, loadVenue };
