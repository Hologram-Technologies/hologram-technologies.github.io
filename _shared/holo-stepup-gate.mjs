// holo-stepup-gate.mjs — THE single step-up enforcement seam.
//
// Every security-sensitive surface (wallet send/sign, key reveal, delegation issuance, the "Everything"
// gate, future membership/epoch authoring) routes its consent through ONE function here, instead of each
// app inventing its own "are you sure?" The seam decides — via the shared classifier (holo-stepup
// needsStepUp/levelOf) — whether THIS action escalates authority, and if so runs a payload-bound biometric
// step-up and verifies the returned consent artifact HOST-SIDE before the caller is allowed to proceed.
//
// Two invariants make it trustworthy:
//   • FAIL-CLOSED — any throw (no TEE, cancelled biometric, wrong device, unverifiable token) ⇒ { ok:false }.
//     The caller MUST NOT sign / send / reveal unless it sees { ok:true }.
//   • UNFORGEABLE FROM AN APP FRAME — an app may REQUEST step-up, but the HOST computes the action κ and
//     runs requireStepUp against the OPERATOR's own credential. The app never produces the assertion and
//     cannot fabricate a success (serveRequest below; the host asserts `operator`/payload, not the app).
//
// Stateful only for the trust window (recent same-kind authority step-ups are suppressed — effortless,
// never for value/reveal). All crypto/IO is the witnessed holo-stepup primitive; deps are injectable so
// the orchestration (classify → require → verify → window) is provable under Node without a real TEE.

import { needsStepUp, requireStepUp, verifyStepUp } from "./holo-stepup.mjs";

const _last = new Map();                       // kind -> atMs of last successful step-up (the trust window)
export function __resetWindows() { _last.clear(); }   // witness hook only

// enforce(action, opts) -> { ok, token?, suppressed?, reason? }
//   action: { kind, payload, appId, operator, reason }  (the human-readable `reason` is shown + signed).
//   opts.credentialId: the operator's WebAuthn credential. opts.{require,verify,now,windowMs}: injectable.
export async function enforce(action, { credentialId, windowMs = 120000,
    now = () => Date.now(), require = requireStepUp, verify = verifyStepUp } = {}) {
  if (!action || !action.kind || !action.operator) return { ok: false, reason: "step-up: malformed action" };
  const nowMs = now();
  const last = _last.has(action.kind) ? { kind: action.kind, atMs: _last.get(action.kind) } : null;
  if (!needsStepUp(action.kind, { last, nowMs, windowMs })) return { ok: true, suppressed: true };
  try {
    const token = await require(action, { credentialId });        // ONE biometric, bound to this payload
    const body = await verify(token);                             // re-verify host-side — never trust the caller
    if (!body) return { ok: false, reason: "step-up did not verify" };
    if (body.operator !== action.operator) return { ok: false, reason: "step-up operator mismatch" };
    _last.set(action.kind, nowMs);                                // open the trust window for this kind
    return { ok: true, token };
  } catch (e) { return { ok: false, reason: (e && e.message) || "step-up denied" }; }   // fail-closed
}

// serveRequest(appReq, ctx) — the host-side bridge handler. An app frame posts a request; the HOST builds
// the action from its own trusted view (ctx.computeAction) and enforces against the OPERATOR's credential,
// so a malicious frame cannot forge either the payload or the success. Returns the same {ok,...} shape.
export async function serveRequest(appReq, { operator, credentialId, computeAction, ...opts } = {}) {
  if (typeof computeAction !== "function" || !operator) return { ok: false, reason: "step-up: no host context" };
  const action = computeAction(appReq);                           // host-asserted action — app cannot forge it
  if (!action || action.operator !== operator) return { ok: false, reason: "step-up: action not bound to operator" };
  return enforce(action, { credentialId, ...opts });
}

// selftest (node): orchestration only — classify → require → verify → trust-window → fail-closed,
// with an INJECTED require that mints a real, verifiable token via the witnessed holo-stepup primitive.
export async function selftest() {
  const { buildStepUp } = await import("./holo-stepup.mjs");
  const SUB = globalThis.crypto.subtle; const te = new TextEncoder();
  const b64 = (u) => Buffer.from(u).toString("base64");
  const { addressOf } = await import("./holo-identity.mjs");
  // a synthetic operator + signer (sovereign axis), mirroring the holo-login principal shape
  const kp = await SUB.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const pub = new Uint8Array(await SUB.exportKey("raw", kp.publicKey));
  const operator = await addressOf(pub);
  const signer = { kappa: operator, alg: "Ed25519", pub: b64(pub), async sign(s) { return b64(await SUB.sign({ name: "Ed25519" }, kp.privateKey, typeof s === "string" ? te.encode(s) : s)); } };
  let calls = 0;
  const require = async (action) => { calls++; return buildStepUp({ "@type": "HoloStepUp", kind: action.kind, appId: action.appId || "", operator, reason: action.reason || "", payload: action.payload ?? null, issuedAt: "2026-06-21T00:00:00.000Z", nonce: "00ff00ff00ff00ff" }, signer); };
  const requireThrows = async () => { calls++; throw new Error("biometric cancelled"); };
  const requireForges = async () => { calls++; const t = await require({ kind: "wallet.send", operator }); return { ...t, payload: { to: "0xEVIL" } }; }; // tampered after signing
  const A = (kind, extra = {}) => ({ kind, operator, appId: "test", reason: kind, payload: { amount: "1" }, ...extra });

  const r = {};
  __resetWindows(); calls = 0;
  let res = await enforce(A("wallet.send"), { require, now: () => 1000 });
  r.valueAsks = res.ok === true && !res.suppressed && calls === 1;
  res = await enforce(A("wallet.send"), { require, now: () => 1001 });            // immediately again
  r.valueNeverSuppressed = res.ok === true && !res.suppressed && calls === 2;     // money always asks
  __resetWindows(); calls = 0;
  await enforce(A("delegation.issue"), { require, now: () => 1000, windowMs: 120000 });
  res = await enforce(A("delegation.issue"), { require, now: () => 5000, windowMs: 120000 }); // within window
  r.authoritySuppressedInWindow = res.ok === true && res.suppressed === true && calls === 1;
  res = await enforce(A("delegation.issue"), { require, now: () => 200000, windowMs: 120000 }); // stale
  r.authorityReasksWhenStale = res.ok === true && !res.suppressed && calls === 2;
  calls = 0;
  res = await enforce(A("app.open"), { require, now: () => 0 });
  r.lowNeverAsks = res.ok === true && res.suppressed === true && calls === 0;     // never even calls the TEE
  res = await enforce(A("wallet.send"), { require: requireThrows, now: () => 0 });
  r.failClosedOnThrow = res.ok === false && /cancelled/.test(res.reason);         // cancelled biometric ⇒ denied
  res = await enforce(A("wallet.send"), { require: requireForges, now: () => 0 });
  r.rejectsTamperedToken = res.ok === false;                                      // post-sign tamper ⇒ verify fails ⇒ denied
  res = await enforce({ kind: "wallet.send" }, { require, now: () => 0 });        // no operator
  r.rejectsMalformed = res.ok === false;
  // bridge: a forged app request whose operator ≠ host operator is refused before any biometric
  res = await serveRequest({ to: "0x" }, { operator, credentialId: "c", computeAction: () => ({ kind: "wallet.send", operator: "did:holo:sha256:" + "0".repeat(64), payload: {} }), require });
  r.bridgeRefusesUnboundOperator = res.ok === false;
  r.ok = Object.values(r).every(Boolean);
  return r;
}

if (typeof process !== "undefined" && process.argv && /holo-stepup-gate\.mjs$/.test(process.argv[1] || "")) {
  selftest().then((r) => { console.log("holo-stepup-gate selftest:", r); process.exit(r.ok ? 0 : 1); });
}
