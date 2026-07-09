// holo-pay.mjs - Holo Pay core: a payment as a universal κ-link. THE LINK IS THE MONEY.
//
// Design (PAY-A + PAY-E): the payment intent travels INSIDE the link (base64url JSON in the URL fragment), so a
// plain browser with NO Hologram, NO wallet, NO app can open it, read "X sent you $Y", and claim. The κ is the
// SHA-256 of the canonical public fields (integrity + dedup); SHA-256 (not BLAKE3) because the claim page must run
// anywhere, off Hologram, with only standard WebCrypto. The claimSecret is a bearer token that travels in the link
// (whoever holds the link may claim - that IS the design) and is NOT part of the κ. Actual money movement is behind
// a thin adapter: on a Hologram device it's HoloWallet + a TEE biometric; off-device/testnet it's an escrow stub so
// the whole UX round-trips without real funds. Framework-free: this same module powers the app AND the claim page.

export const PAY_VERSION = 1;

// ── base64url (unicode-safe) ──
function _b64urlEncode(obj) {
  const json = JSON.stringify(obj);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function _b64urlDecode(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const json = decodeURIComponent(escape(atob(b64)));
  return JSON.parse(json);
}

// ── compact positional codec ──────────────────────────────────────────────────────────────────────────────────
// The intent travels INSIDE the link, so any plain browser reads it with NO Hologram. To keep that link short and
// money-like - not a wall of base64 - we ship a POSITIONAL array (no repeated JSON keys) in a frozen field order.
// κ stays in the payload so the claim page can prove the public fields still match their seal. Order is append-only.
// κ and hashlock are NOT transmitted - both are derived by the verifier (κ = H(canon); hashlock = H(claimSecret),
// and claimSecret already rides the link). Transmitting only the irreducible fields keeps the signed link as short
// as authenticity allows. Legacy object-form links that DID carry kappa still parse (their kappa is read + compared).
const _ORDER = ["v", "kind", "amount", "asset", "fiat", "to", "toName", "from", "fromName", "memo", "created", "expires", "claimSecret", "pub", "sig"];
function _packPayload(intent) {
  return _b64urlEncode(_ORDER.map((k) => (intent[k] == null ? null : intent[k])));
}
function _unpackPayload(payload) {
  const v = _b64urlDecode(payload);                       // array = compact (current); object = legacy links
  if (!Array.isArray(v)) return v;
  const o = {}; _ORDER.forEach((k, i) => { if (v[i] != null) o[k] = v[i]; });
  if (o.memo == null) o.memo = "";
  return o;
}

async function _sha256hex(str) {
  const bytes = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
export const sha256hex = _sha256hex;   // re-exported so the escrow engine shares ONE hash (κ, hashlock, preimage)

// ── sender-signed seal (ECDSA P-256) ──────────────────────────────────────────────────────────────────────────
// The κ proves the public fields are internally CONSISTENT; a signature proves they're AUTHENTIC - that THIS sender
// authored exactly this amount/recipient/memo and nobody altered them. P-256 because the claim page must verify with
// bare WebCrypto off Hologram. The signing key lives in the vault in production; here a persistent local identity.
function _bytesToB64url(bytes) {
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function _b64urlToBytes(str) {
  const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
// A signer = { pub (base64url SPKI), sign(msg)->base64url sig }. In production this is brokered to the vault so the
// key never leaves it; createSigner() is the local/testnet identity used when no vault signer is injected.
export async function createSigner() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));   // raw EC point (65B) - far shorter than SPKI
  return {
    pub: _bytesToB64url(raw),
    sign: async (msg) => _bytesToB64url(new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, new TextEncoder().encode(msg)))),
  };
}
let _localSigner = null;
async function _defaultSigner() {
  if (_localSigner) return _localSigner;
  // browser: reuse ONE stable identity so refunds return to the same sender; testnet/Node: ephemeral per process.
  _localSigner = await createSigner();
  return _localSigner;
}
async function _verifySig(pubB64, sigB64, msg) {
  try {
    const key = await crypto.subtle.importKey("raw", _b64urlToBytes(pubB64), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, _b64urlToBytes(sigB64), new TextEncoder().encode(msg));
  } catch { return false; }
}
export const verifySig = _verifySig;   // generic { pub, sig, msg } verifier - the κ-ledger signs/verifies transitions with it
// True only when the intent carries a signature that verifies against its public key over its own canonical fields.
export async function verifyIntent(intent) {
  if (!intent || !intent.pub || !intent.sig) return false;
  return _verifySig(intent.pub, intent.sig, _canon(intent));
}

// canonical string for the κ - stable field order, PUBLIC fields only (claimSecret excluded so κ is the shareable id).
// hashlock + pub are appended ONLY when present, so legacy (unsigned) links keep their original κ and still verify.
function _canon(i) {
  const base = [i.v, i.kind, i.amount, i.asset, i.fiat || "", i.to || "", i.toName || "", i.from || "", i.fromName || "", i.memo || "", i.created || "", i.expires || ""];
  if (i.hashlock || i.pub) base.push(i.hashlock || "", i.pub || "");   // sealed for signed (escrow-grade) intents
  return base.join("|");
}

function _randHex(n) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// ── create a payment intent ──
// kind: "send" (you're paying them - they CLAIM) | "request" (you're asking - they PAY)
// amount in the asset's display units; fiat (e.g. "USD") optional for a fiat-clear quote; to/toName = recipient.
export async function createPayment({ kind = "send", amount, asset = "USDC", fiat = null, to = null, toName = null, from = null, fromName = null, memo = "", ttlSeconds = 7 * 24 * 3600, nowMs = null, signer = null } = {}) {
  const amt = Number(amount);
  if (!(amt > 0)) throw new Error("Holo Pay: amount must be greater than 0");
  if (kind !== "send" && kind !== "request") throw new Error("Holo Pay: kind must be 'send' or 'request'");
  const now = nowMs || Date.now();
  const intent = {
    v: PAY_VERSION, kind, amount: amt, asset, fiat,
    to, toName, from, fromName, memo: String(memo || "").slice(0, 140),
    created: now, expires: now + ttlSeconds * 1000,
    claimSecret: _randHex(16),
  };
  // the bearer claimSecret IS a hashlock preimage: the escrow commits to H(claimSecret); revealing it claims.
  intent.hashlock = await _sha256hex(intent.claimSecret);
  const sgn = signer || (await _defaultSigner());                  // vault signer in production; local identity otherwise
  if (sgn && sgn.pub) intent.pub = sgn.pub;
  intent.kappa = await _sha256hex(_canon(intent));                 // κ now also seals hashlock + pub
  if (sgn && sgn.sign) intent.sig = await sgn.sign(_canon(intent));// authenticity: signed over the sealed canonical fields
  return intent;
}

// ── build the three openings of one link ──
export function buildLink(intent, { origin = null, claimPath = "/apps/holo-messenger/pay-claim.html" } = {}) {
  const payload = _packPayload(intent);
  const org = origin || (typeof location !== "undefined" ? location.origin : "");
  return {
    kappa: intent.kappa,
    payload,
    https: `${org}${claimPath}#${payload}`,        // PAY-E: opens in ANY browser, no Hologram needed
    holo: `holo://pay/${intent.kappa}#${payload}`, // PAY-A: opens the in-app full-bleed loader
  };
}

// ── parse a link / fragment / payload back to an intent, with integrity + expiry checks ──
export async function parsePayment(input) {
  let payload = String(input || "");
  if (payload.includes("#")) payload = payload.split("#").pop();
  if (payload.includes("/")) payload = payload.split("/").pop();   // tolerate a bare holo://pay/<κ> with no fragment → no payload
  let intent;
  try { intent = _unpackPayload(payload); } catch { return { ok: false, error: "unreadable link" }; }
  if (!intent || intent.v !== PAY_VERSION || !(Number(intent.amount) > 0)) return { ok: false, error: "not a valid payment link" };
  // recompute the two derived fields the wire omits, so canon (and thus κ + the signature) reconstruct exactly.
  if (intent.claimSecret && !intent.hashlock) intent.hashlock = await _sha256hex(intent.claimSecret);
  const transmittedKappa = intent.kappa;                          // legacy links carried it; new links derive it
  const expectKappa = await _sha256hex(_canon(intent));
  intent.kappa = expectKappa;                                     // the canonical id every downstream consumer uses
  const integrity = transmittedKappa ? expectKappa === transmittedKappa : true;   // legacy tamper check; new links → derived
  const signed = await verifyIntent(intent);                      // fields AUTHENTIC - signed by the sender, unaltered
  const expired = !!(intent.expires && Date.now() > intent.expires);
  return { ok: true, intent, integrity, signed, expired };
}

// ── fiat-clear formatting (abstract the asset; show money) ──
const _FIAT_SYM = { USD: "$", EUR: "€", GBP: "£" };
export function formatMoney(intent) {
  const a = Number(intent.amount);
  if (intent.fiat) { const sym = _FIAT_SYM[intent.fiat] || ""; return `${sym}${a.toFixed(2)}`; }
  return `${a % 1 === 0 ? a : a.toFixed(4).replace(/0+$/, "")} ${intent.asset}`;
}
// SYNC detection of a pay link inside a message body → { intent, url } for rendering the money-card bubble. Display
// only (no integrity check here - that happens on the claim page, where money actually moves). null if not a pay link.
const _PAY_RE = /(https?:\/\/\S*pay-claim\.html#([A-Za-z0-9_-]+))|(holo:\/\/pay\/\S*#([A-Za-z0-9_-]+))/;
export function payLinkInText(text) {
  const m = String(text || "").match(_PAY_RE); if (!m) return null;
  const payload = m[2] || m[4]; const url = m[0];
  try { const intent = _unpackPayload(payload); if (intent && intent.v === PAY_VERSION && Number(intent.amount) > 0) return { intent, url, payload }; } catch {}
  return null;
}

// ── the money-framed message the link rides inside ────────────────────────────────────────────────────────────
// On ANY platform (Telegram, WhatsApp, SMS, email) the recipient reads THIS before the link - so a stranger with zero
// knowledge of Hologram learns in one glance: who sent it, how much, what for, that it's verified, and what to do.
// Plain text → it survives every network that strips link previews; the link underneath claims anywhere, no install.
export function payMessageText(intent, httpsLink) {
  const money = formatMoney(intent);
  const who = (intent.fromName || "Someone").trim();
  const memo = intent.memo ? `\n“${intent.memo}”` : "";
  if (intent.kind === "request") {
    return `💰 ${who} is requesting ${money}${memo}\nPay securely, no app or account needed. Sealed and verified by Holo Pay 🔒\n${httpsLink}`;
  }
  return `💸 ${who} sent you ${money}${memo}\nClaim it in seconds, no app or account needed. Sealed and verified by Holo Pay 🔒\n${httpsLink}`;
}
// the human, sub-line: what they actually receive (when fiat + asset both known)
export function settlementLine(intent) {
  if (intent.fiat && intent.asset && _FIAT_SYM[intent.fiat]) return `${formatMoney(intent)} in ${intent.asset}`;
  return formatMoney(intent);
}

// ── wallet adapter seam ─────────────────────────────────────────────────────────────────────────────────────────
// Real movement is on-device: a TEE biometric (HoloStepUp.teeAssert) then HoloWallet.send. Off-device / testnet,
// `escrowStub` models escrow-by-link so the claim UX is fully exercisable without real value. The SPEND side is
// always gated by a fresh biometric; the CLAIM side is deliberately light (PAY-E onboarding) - but never exposes
// the sender's keys/balances. Callers inject {wallet, stepup}; absent → stub (returns a simulated tx/claim).
// Brokered wallet discovery - the trusted shell exposes `window.HoloWallet` (keys stay in the vault; the app passes
// intent, the vault shows the consent/biometric gate). We capability-detect the payment surface and degrade gracefully:
//   • full   → address()/balance() + pay()|send()  (gated send; the vault's own biometric)
//   • address→ accounts()/address()                (can target/receive, but spend falls back)
//   • none   → testnet escrow stub                 (UX still round-trips, no real value)
// PAY - wallet BROKER over the EXISTING Holo Wallet seam. The messenger is a sandboxed first-party app; the wallet is
// a separate trusted frame holding the seed. The wallet already listens on a same-origin `BroadcastChannel("holo-wallet")`
// (its `seamBus`) and answers sign/read requests - `{kind:"send"|"address"|"balance", id, chain, to, amount, token}` -
// gated by ITS OWN payload-bound biometric (the "Confirm" ceremony), replying `{type:"holo-wallet:sign-result", id, ok,
// hash/address/balance, error}`. So we speak that protocol: keys NEVER enter the app, consent is shown by the wallet,
// and the SHELL needs no money code. The wallet only listens while OPEN, so a spend first asks the shell to open it
// (`holo-identity:open-wallet`). No BroadcastChannel / not same-origin (standalone/preview) → no shim → testnet stub.
let _hwId = 0;
// Install a real HoloWallet handle over the OS-wide signing seam (BroadcastChannel "holo-wallet").
// This speaks the CANONICAL wire the wallet frame honours: request  {type:"holo-wallet:sign-request", id, request:{kind,…}}
// → result {type:"holo-wallet:sign-result", id, …}. (The old inline broker posted a FLAT {kind,id} the wallet's
// handleSignRequest silently dropped — so it always timed out and money fell to the stub. Fixed here to match
// holo-wallet-bridge.js exactly, kept inline so the bare-browser claim page never has to import it.)
//
// TOPOLOGY: works whether the wallet is a SIBLING under an OS shell (messenger inside the shell) OR a same-origin
// CHILD iframe of THIS document (the messenger app, which mounts wallet.html in its "You" drawer). The seam is
// origin-wide, so parent/child doesn't matter for messaging; only "does a wallet frame exist at all" matters.
// Caller declares that with `present` (default: infer from being inside/holding a frame). No frame → return false
// → caller keeps the honest testnet stub (never a 2-minute hang, never a fake "sent").
//
// A spend (send / sign-as-gate) first REVEALS the wallet so the human sees + taps its own payload-bound Confirm:
// `reveal()` if the caller supplied one, else post {type:"holo-identity", action:"open-wallet"} (the messenger's
// drawer bridge, or the shell, opens the wallet). Reads (address / balance) never gate and never reveal; they only
// need the frame MOUNTED, so they retry briefly to ride out a just-mounted seam (BroadcastChannel drops to a frame
// that isn't listening yet).
export function installWalletBroker({ present = null, reveal = null } = {}) {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return false;
  if (window.HoloWallet && (window.HoloWallet.pay || window.HoloWallet.send)) return true;   // a real wallet handle is already here
  const hasFrame = present != null ? !!present : (window.parent !== window);   // explicit declaration wins; else the legacy sibling heuristic
  if (!hasFrame) return false;   // genuinely no wallet frame (standalone/preview) → honest stub, no seam
  let bus; try { bus = new BroadcastChannel("holo-wallet"); } catch { return false; }
  const pending = new Map();
  bus.addEventListener("message", (e) => {
    const d = e.data; if (!d || d.type !== "holo-wallet:sign-result") return;
    const p = pending.get(d.id); if (!p) return; pending.delete(d.id);
    d.error ? p.reject(new Error(d.error)) : p.resolve(d);
  });
  const post = (id, request) => { try { bus.postMessage({ type: "holo-wallet:sign-request", id, request }); return true; } catch { return false; } };
  const call = (request, timeoutMs = 120000) => new Promise((resolve, reject) => {
    const id = (crypto.randomUUID && crypto.randomUUID()) || ("hp" + (++_hwId)); pending.set(id, { resolve, reject });
    if (!post(id, request)) { pending.delete(id); return reject(new Error("wallet seam unavailable")); }
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error("wallet not responding — open your Holo Wallet and retry")); } }, timeoutMs);
  });
  // READ over a maybe-just-mounted / still-unlocking frame: retry the whole call (fresh id each attempt) on ANY
  // failure — a dropped post to a seam that isn't listening yet, OR a transient "wallet locked" during boot — until
  // it answers or the window elapses. Reads are idempotent + ungated, so retries are harmless (no double-Confirm).
  const readCall = async (request, { timeoutMs = 30000, everyMs = 800 } = {}) => {
    const started = Date.now(); let lastErr;
    while (Date.now() - started < timeoutMs) {
      try { return await call(request, Math.min(4000, everyMs * 5)); }
      catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, everyMs)); }
    }
    throw lastErr || new Error("wallet not responding");
  };
  const wakeWallet = async () => {
    try { if (typeof reveal === "function") { await reveal(); return; } } catch {}
    try { const host = (window.parent && window.parent !== window) ? window.parent : window; host.postMessage({ type: "holo-identity", action: "open-wallet" }, location.origin); } catch {}
  };
  window.HoloWallet = Object.assign(window.HoloWallet || {}, {
    brokered: true,
    address: (chain) => readCall({ kind: "address", chain: chain || "base" }).then((r) => r.address),
    balance: (chain) => readCall({ kind: "balance", chain: chain || "base" }).then((r) => r.balance),
    sign: async (args) => { await wakeWallet(); return call({ kind: "sign", chain: args.chain || "base", message: args.message }).then((r) => r.signature); },   // payload-bound biometric Confirm (used as the send gate)
    pay: async (args) => { await wakeWallet(); return call({ kind: "send", chain: args.chain || "base", to: args.to, amount: args.amount, token: args.token }).then((r) => ({ tx: r.hash })); },   // gated by the wallet's biometric
    // ── A2 INTENT RAIL — chains disappear. You name WHAT (asset·amount·to); the router derives HOW (funding
    //    chain, gas folded, bridge legs) and returns ONE proposal card. `intent()` is a free READ (derive, never
    //    gates); `realizeIntent()` runs the whole route behind the ONE biometric bound to the proposal κ. No chain
    //    is ever named here — that is the whole point. Refusals come back honestly ({ok:false, proposal.refused}).
    intent: (i) => readCall({ kind: "intent", intent: { verb: i.verb || "send", asset: i.asset || "USD", amount: i.amount, to: i.to, ...(i.toChain ? { toChain: i.toChain } : {}) } }, { timeoutMs: 12000 }),
    realizeIntent: async (proposalKappa, i) => { await wakeWallet(); return call({ kind: "intent-realize", proposalKappa, intent: { verb: i.verb || "send", asset: i.asset || "USD", amount: i.amount, to: i.to, ...(i.toChain ? { toChain: i.toChain } : {}) } }); },   // ONE face over the whole route
    // ── on-chain HTLC settlement (Holo Pay live mode). fund/claim/refund MOVE value → they reveal + gate; the two
    //    reads (configured?, does a swap exist?) never gate. The wallet maps asset→token, converts decimals, and
    //    resolves the HoloHTLC address for the chain (holo-htlc.js). Absent config → htlcConfigured false → custodial.
    htlcConfigured: (chain) => readCall({ kind: "htlcConfigured", chain: chain || "base" }, { timeoutMs: 6000 }).then((r) => !!r.configured).catch(() => false),
    htlcSwapExists: (args) => readCall({ kind: "htlcSwapExists", hashlock: args.hashlock, chain: args.chain }, { timeoutMs: 8000 }).then((r) => (r && r.found ? { chain: r.chain } : null)).catch(() => null),
    htlcFund: async (args) => { await wakeWallet(); return call({ kind: "htlcFund", chain: args.chain || "base", amount: args.amount, token: args.token, hashlock: args.hashlock, timeout: args.timeout }).then((r) => ({ tx: r.tx || r.hash, swapId: r.swapId })); },
    htlcClaim: async (args) => { await wakeWallet(); return call({ kind: "htlcClaim", chain: args.chain, hashlock: args.hashlock, preimage: args.preimage }).then((r) => ({ tx: r.tx || r.hash })); },
    htlcRefund: async (args) => { await wakeWallet(); return call({ kind: "htlcRefund", chain: args.chain, hashlock: args.hashlock }).then((r) => ({ tx: r.tx || r.hash })); },
  });
  return true;
}

export function getWallet() {
  const w = (typeof window !== "undefined") && window.HoloWallet;
  if (!w) return { mode: "stub", w: null };
  const canPay = typeof w.pay === "function" || typeof w.send === "function";
  const canAddr = typeof w.address === "function" || typeof w.accounts === "function";
  return { mode: canPay ? "full" : (canAddr ? "address" : "stub"), w };
}
export async function walletStatus() {
  const { mode, w } = getWallet();
  let address = null;
  try {
    if (w && w.address) address = await w.address();
    else if (w && w.accounts) { const a = await w.accounts(); address = a && a[0] && a[0].address; }
  } catch {}
  return { connected: mode !== "stub", mode, address };
}
// the user's own receiving address (for REQUEST links so a payer can actually pay)
export async function myReceivingAddress(chain = "base") {
  const { w } = getWallet();
  try {
    if (w && w.address) return await w.address(chain);
    if (w && w.accounts) { const a = await w.accounts(); return a && a[0] && a[0].address; }
  } catch {}
  return null;
}

// Authorize a SEND by LOCKING it into a κ-bound hashlocked escrow (the recipient is unknown until they Claim - so we
// can't pay an address; we lock to H(claimSecret) and whoever reveals the preimage claims). Gated by the vault's
// biometric (default-deny) via an optional `stepup` ceremony. A real chain-HTLC wallet (exposing `htlcFund`) settles
// on-chain; absent → the custodial-by-κ ledger (testnet) - labeled honestly, never pretending real funds moved.
export async function authorizeSend(intent, { stepup = null, chain = "base", store = null } = {}) {
  const { w } = getWallet();
  // LIVE only when the wallet can fund on-chain AND an HTLC contract is configured for this chain. The on-chain
  // newSwap tx carries its OWN payload-bound biometric inside the wallet, so we do NOT run a separate stepup (no
  // double prompt). If nothing is configured, htlcConfigured is false → fall through to the honest custodial path.
  let canLive = false;
  try { canLive = !!(w && typeof w.htlcFund === "function" && typeof w.htlcConfigured === "function" && await w.htlcConfigured(chain)); } catch { canLive = false; }
  const { fund } = await import("./holo-escrow.mjs");
  if (canLive) {
    const r = await fund(intent, { store, wallet: w, chain });   // on-chain lock (gated by the wallet's own Confirm)
    return r.ok ? { ok: true, tx: r.tx || ("escrow:" + intent.kappa.slice(0, 16)), live: !!r.live, mode: r.mode, swapId: r.swapId } : r;
  }
  // CUSTODIAL: the ONLY human gate is the payload-bound stepup biometric (default-deny; cancel → nothing funded).
  if (stepup && stepup.requireStepUp) {
    try { await stepup.requireStepUp({ kind: "wallet.send", reason: `Send ${formatMoney(intent)}${intent.toName ? " to " + intent.toName : ""}`, payload: { kappa: intent.kappa, amount: intent.amount, asset: intent.asset, hashlock: intent.hashlock } }); }
    catch (e) { return { ok: false, error: "declined" }; }   // throws on cancel
  }
  const r = await fund(intent, { store, wallet: null, chain });   // no wallet → custodial-by-κ ledger (labelled live:false)
  return r.ok ? { ok: true, tx: r.tx || ("escrow:" + intent.kappa.slice(0, 16)), live: !!r.live, mode: r.mode } : r;
}
// Claim by revealing the preimage. The escrow verifies authenticity (sender-signed), freshness (not expired), the
// hashlock (H(claimSecret) === hashlock), and atomically marks the κ claimed - so a link can be claimed AT MOST ONCE.
export async function claim(intent, { claimSecret = null, claimerPub = null, store = null, wallet = null } = {}) {
  const { claimEscrow } = await import("./holo-escrow.mjs");
  const w = wallet || getWallet().w || null;   // present on a Hologram device → on-chain withdraw when the swap is live
  return claimEscrow(intent, { claimSecret: claimSecret || intent.claimSecret, claimerPub, store, wallet: w });
}
// Reclaim an unclaimed, EXPIRED send back to the sender. Refund-after-claim and refund-before-expiry are refused.
export async function refundExpired(intent, { store = null, wallet = null } = {}) {
  const { refund } = await import("./holo-escrow.mjs");
  return refund(intent, { store, wallet: wallet || getWallet().w || null });
}
// Current escrow state for a κ (open | claimed | refunded | none) - for honest status on the card and claim page.
export async function escrowStatus(kappaOrIntent, { store = null } = {}) {
  const { status } = await import("./holo-escrow.mjs");
  return status(kappaOrIntent, { store });
}
