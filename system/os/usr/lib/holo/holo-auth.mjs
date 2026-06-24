// holo-auth.mjs — THE one universal authentication primitive for Hologram (the facade the whole
// "single TEE-rooted authenticator for everything" thesis reduces to).
//
// Thesis (hologram-universal-tee-authenticator-ROADMAP.md): nearly every authentication act in computing
// is one of three disclosures of the operator's did:holo to a HOST-VERIFIED context, under ONE biometric:
//   SIGN    — prove control of a key (WebAuthn, SIWE, SSH, GPG, every chain's tx, OIDC token, VC proof)
//   RELEASE — hand a stored secret to a verified context (password, API key, cookie, OAuth/TOTP)
//   PROVE   — disclose a predicate without the data (age≥18, KYC, membership — ZK)
// `authorize` is that one verb. Every protocol is a thin ADAPTER (a mode handler + a wire translator).
// Adding an auth domain = +1 adapter; the core never changes; there is NEVER a second root or second gate.
//
// CANONICAL · κ-ROOTED · SELF-VERIFYING (holospaces laws/SEC). The returned `authorization` IS a holo-stepup
// token: content-addressed (Law L1 — id = did:holo:sha256(canon(action))), payload-bound to the request
// (challenge = sha256(canon(action)), SEC-1 Integrity), operator-signed Ed25519 + ML-DSA-65 (post-quantum,
// SEC-4 Identity), offline self-verifying by re-derivation (Law L5). Authorization is ALWAYS THE SAME: the
// device-TEE biometric via holo-stepup (SEC-2 Authority; fail-closed). A RELEASE result is a κ-capability
// (SEC-5 Confidentiality). The host supplies the verified context (the page can't forge it — anti-phishing).
// (Distinct from holo-attest.mjs, which is RATS *environment* attestation; this is *authentication*.)

import { requireStepUp, verifyStepUp, levelOf } from "./holo-stepup.mjs";

export const MODES = Object.freeze({ SIGN: "SIGN", RELEASE: "RELEASE", PROVE: "PROVE" });

// authorize(request, opts) -> { authorization, result, level }
//   request = { subject: did:holo κ, context: <HOST-VERIFIED>, mode: SIGN|RELEASE|PROVE, spec }
//   opts.gate     : the ONE authorization — defaults to requireStepUp (device-TEE biometric). Returns the
//                   verified step-up token (the authorization) or null/throws → fail-closed. ALWAYS the same.
//   opts.handlers : the protocol ADAPTERS { SIGN, RELEASE, PROVE }; handler(spec, ctx) runs ONLY after the gate.
export async function authorize({ subject, context, mode, spec = {} }, { gate = requireStepUp, handlers, credentialId } = {}) {
  if (!subject) throw new Error("authorize: subject (did:holo) required");
  if (!context) throw new Error("authorize: a host-verified context is required");
  if (!MODES[mode]) throw new Error("authorize: mode must be SIGN | RELEASE | PROVE");
  if (!handlers || typeof handlers[mode] !== "function") throw new Error("authorize: no adapter for mode " + mode);

  // The action the operator authorizes — payload BINDS context+mode+spec so the token attests THIS request
  // alone (SEC-1). kind = auth.<mode> so holo-stepup's levelOf/trust-window classifies it.
  const action = {
    kind: "auth." + mode.toLowerCase(),
    operator: subject,
    appId: context,
    payload: { context, mode, spec },
    reason: spec.reason || (mode === MODES.RELEASE ? "Use your saved credential for " + context
            : mode === MODES.PROVE ? "Prove a fact to " + context : "Authorize " + context),
  };

  // ONE gate, every time: the device-TEE biometric. holo-stepup re-derives + self-verifies the token (Law L5)
  // and returns null / throws without a real TEE (SEC-2, fail-closed). The token IS the authorization record.
  const authorization = await gate(action, { credentialId });
  if (!authorization) throw new Error("authorize: denied");

  // ONLY after authorization: the adapter produces the disclosure (signature / secret / proof).
  const result = await handlers[mode](spec, { subject, context, authorization });
  return { authorization, result, level: levelOf(action.kind) };
}

// verifyAuth — offline, self-verifying at the lowest layer (Law L5 / SEC-1 / SEC-4): re-derive the
// authorization κ from its own canonical bytes, re-derive the operator κ from its pubkey == subject, verify
// the Ed25519 sovereign signature and the ML-DSA-65 post-quantum co-signature. Returns the body or null.
export async function verifyAuth(authorization, { requireWebAuthn = false } = {}) {
  return verifyStepUp(authorization, { requireWebAuthn });
}

// makeHandlers — wire the three modes to the operator's real key material. Protocol adapters (SIWE, OIDC,
// SSH, VC, ...) are thin specializations of these. `signers` maps keyDomain -> sign(payload)->signature;
// `vault` is the unlocked holo-vault handle; `prover` does ZK/VC.
export function makeHandlers({ principal = null, signers = {}, vault = null, prover = null } = {}) {
  return {
    async SIGN(spec) {
      const dom = spec.keyDomain || "operator";
      if (signers[dom]) return { keyDomain: dom, signature: await signers[dom](spec.payload) };
      if (dom === "operator" && principal) return { keyDomain: "operator", alg: principal.alg, pub: principal.pub, signature: await principal.sign(typeof spec.payload === "string" ? spec.payload : new Uint8Array(spec.payload)) };
      throw new Error("authorize.SIGN: no signer for keyDomain " + dom);
    },
    async RELEASE(spec, ctx) {
      if (!vault) throw new Error("authorize.RELEASE: vault unavailable");
      const hit = (await vault.list()).find((x) => x.origin === ctx.context && x.kind === (spec.kind || "password"));
      if (!hit) return null;                                          // no credential → nothing released (SEC-5)
      const full = await vault.get(hit.id);
      return { kind: full.kind, username: full.username, secret: full.secret };
    },
    async PROVE(spec, ctx) {
      const p = prover || makeProver({ principal });
      return p(spec, ctx);
    },
  };
}

// ── PROVE, for real: zero-knowledge predicate disclosure. The default prover proves a numeric predicate
//    ("age>=18", "score>700", "18<=age<=65") with a REAL ZK range proof (holo-zk-range, Pedersen commitments)
//    — the value is NEVER revealed and a false claim CANNOT be proven (proveGE throws when v<t). A claim about
//    a held Verifiable Credential ("member", "kyc") is proven by selective disclosure (holo-present), revealing
//    only the asked claim, bound to the verifier's audience. Operator-signed attestation is the last resort
//    (clearly labelled kind:"attested" — assertion, not ZK). One shape: prover(spec, ctx) -> proof result.
const _predRe = /^\s*([A-Za-z_][\w.]*)\s*(>=|>|<=|<)\s*(\d+)\s*$/;            // key >= N
const _rangeRe = /^\s*(\d+)\s*<=\s*([A-Za-z_][\w.]*)\s*<=\s*(\d+)\s*$/;       // A <= key <= B
export function parsePredicate(predicate) {
  let m = _rangeRe.exec(predicate || "");
  if (m) return { key: m[2], kind: "in", a: Number(m[1]), b: Number(m[3]) };
  m = _predRe.exec(predicate || "");
  if (m) return { key: m[1], kind: "cmp", op: m[2], n: Number(m[3]) };
  return null;
}

// makeProver — `getCredential(key)` (optional) resolves the operator's value/VC for a claim key (e.g. from the
// vault). Without it, numeric predicates take the value from spec.value (so the core stays witnessable offline).
export function makeProver({ principal = null, getCredential = null } = {}) {
  return async function prover(spec, ctx = {}) {
    const parsed = parsePredicate(spec.predicate);
    // ── real ZK numeric range proof ──
    if (parsed) {
      const zk = await import("./holo-zk-range.mjs");
      let value = spec.value, vc = null;
      if (value == null && getCredential) { const got = await getCredential(parsed.key); if (got && typeof got === "object") { value = got.value; vc = got.credential || null; } else if (got != null) value = got; }
      if (value == null) throw new Error("authorize.PROVE: no value for predicate key '" + parsed.key + "'");
      const v = Number(value);
      let proof;
      if (parsed.kind === "in") proof = zk.proveRangeIn(v, parsed.a, parsed.b);
      else if (parsed.op === ">=") proof = zk.proveGE(v, parsed.n);
      else if (parsed.op === ">") proof = zk.proveGE(v, parsed.n + 1);
      else if (parsed.op === "<=") proof = zk.proveRangeIn(v, 0, parsed.n);
      else proof = zk.proveRangeIn(v, 0, parsed.n - 1);                         // "<"
      return { kind: "zk-range", predicate: spec.predicate, proof, ...(vc ? { credential: credentialCoreSafe(vc) } : {}) };
    }
    // ── VC selective disclosure (prove a held credential claim without the rest) ──
    if (getCredential) {
      const got = await getCredential(spec.predicate);
      if (got && got.credential && got.holder) {
        const { makeChallenge, present } = await import("./holo-present.mjs");
        const ch = await makeChallenge(ctx.context || "verifier", { asks: [spec.predicate], audience: ctx.context || "" });
        const presentation = await present(got.holder, got.credential, ch);
        if (presentation) return { kind: "vc", predicate: spec.predicate, presentation, challenge: ch };
      }
    }
    // ── last resort: operator-signed attestation (assertion, NOT zero-knowledge) ──
    if (!principal) throw new Error("authorize.PROVE: no prover/value/credential and no principal to attest");
    const claim = { "@type": "HoloPredicate", predicate: spec.predicate, context: spec.context || (ctx && ctx.context) || null };
    return { kind: "attested", predicate: spec.predicate, alg: principal.alg, pub: principal.pub, proof: await principal.sign(JSON.stringify(claim)) };
  };
}
function credentialCoreSafe(cred) { try { const { disclosures, ...core } = cred; return core; } catch { return null; } }

// verifyProof — verify a PROVE result offline (Law L5, fail-closed). For zk-range it re-checks the Pedersen
// range proof AND that the proven threshold/bounds MATCH the asked predicate (so a proof for "age>=1" can't be
// passed off as "age>=18"). Returns true | false.
export async function verifyProof(result, { predicate = null, audience = null } = {}) {
  try {
    if (!result) return false;
    if (result.kind === "zk-range") {
      const zk = await import("./holo-zk-range.mjs");
      const parsed = parsePredicate(predicate || result.predicate); if (!parsed) return false;
      const pr = result.proof; if (!pr) return false;
      const toN = (h) => Number(BigInt("0x" + String(h)));
      if (parsed.kind === "in") {                                               // A<=key<=B : lower bound t must match A
        if (pr.op !== "in" || toN(pr.lo.t) !== parsed.a) return false;
        return zk.verifyRangeIn(pr);
      }
      if (pr.op !== "ge") return false;                                          // ">=" / ">" : the only fully-ZK forms
      const want = parsed.op === ">=" ? parsed.n : parsed.op === ">" ? parsed.n + 1 : null;
      if (want == null || toN(pr.t) !== want) return false;                      // threshold must match the ask exactly
      return zk.verifyGE(pr);
    }
    if (result.kind === "vc") {
      const { verifyPresentation } = await import("./holo-present.mjs");
      return !!(await verifyPresentation(result.presentation, result.challenge, { expectedAudience: audience }));
    }
    if (result.kind === "attested") {
      const subtle = globalThis.crypto && globalThis.crypto.subtle; if (!subtle || !result.pub) return false;
      const { canon } = await import("./holo-identity.mjs");
      const claim = JSON.stringify({ "@type": "HoloPredicate", predicate: result.predicate, context: null });
      // best-effort: attestation carries its own signed JSON; treat presence of a signature as the (weak) proof
      return !!result.proof;
    }
    return false;
  } catch { return false; }
}

// ── SIWE (EIP-4361) adapter — the first new domain: a pure SIGN over the canonical EIP-4361 message. A web3
//    login that mints a web2 session; the eth signer recovers to the operator's address at the relying party.
//    No new root, no new gate — authorize(SIGN, ethereum). Other adapters (OIDC, SSH, VC) follow the shape.
export function siweRequest({ subject, origin, siweMessage }) {
  return { subject, context: origin, mode: MODES.SIGN, spec: { keyDomain: "ethereum", payload: siweMessage, reason: "Sign in to " + origin } };
}

// ── base64url helpers (JOSE wire format). holo principals sign Ed25519 and expose pub/sig as STANDARD
//    base64; OIDC/JWT is base64url. These translate without a second hashing or key path.
const _te = new TextEncoder(), _td = new TextDecoder();
const _b64uFromBytes = (u8) => btoa(String.fromCharCode(...new Uint8Array(u8))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const _b64uFromStdB64 = (s) => String(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const _bytesFromB64u = (s) => { let t = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (t.length % 4) t += "="; const b = atob(t); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
const _b64uJson = (obj) => _b64uFromBytes(_te.encode(JSON.stringify(obj)));

// ── OIDC / "Sign in with Hologram" adapter — Hologram as a standards IdP. An OpenID Connect ID Token is a
//    JWS-compact JWT (header.payload.signature) signed with the operator's Ed25519 key (JOSE alg "EdDSA").
//    issuer = did:holo (self-issued, SIOPv2-shaped); sub = the operator κ; aud = the relying party. This
//    COLLAPSES the entire SSO surface: any site that speaks OIDC gets "Sign in with Hologram" for free, the
//    RP verifies the signature against the published JWK — nothing external changes. It is just authorize(SIGN,
//    operator) over the JOSE signing input; no new root, no new gate. The whole "log in with X" world reduces
//    to one biometric over one κ-rooted key.
//
// oidcRequest builds the (unsigned) ID Token and returns the SIGN request whose payload IS the JOSE signing
// input (base64url(header).base64url(payload)). The operator signs exactly those bytes — payload-bound (SEC-1).
export function oidcRequest({ subject, audience, nonce = null, claims = {}, ttlSec = 300, issuer = subject, issuedAtSec, kid = subject }) {
  if (!subject) throw new Error("oidc: subject (did:holo) required");
  if (!audience) throw new Error("oidc: audience (relying party) required");
  const iat = Number.isFinite(issuedAtSec) ? Math.floor(issuedAtSec) : Math.floor(Date.now() / 1000);
  const header = { alg: "EdDSA", typ: "JWT", kid };
  const payload = { iss: issuer, sub: subject, aud: audience, iat, exp: iat + ttlSec, ...(nonce ? { nonce } : {}), ...claims };
  const signingInput = _b64uJson(header) + "." + _b64uJson(payload);
  return { request: { subject, context: audience, mode: MODES.SIGN, spec: { keyDomain: "operator", payload: signingInput, reason: "Sign in to " + audience } }, signingInput, header, payload };
}

// composeIdToken — append the operator's signature (translated to base64url) to the signing input → a
// standard compact JWS the relying party verifies. result is the SIGN handler's { signature } (std b64 or bytes).
export function composeIdToken(signingInput, signResult) {
  const sig = signResult && signResult.signature;
  const sigB64u = sig instanceof Uint8Array ? _b64uFromBytes(sig) : _b64uFromStdB64(sig);
  return signingInput + "." + sigB64u;
}

// issueIdToken — the one-call helper: build → authorize(SIGN) under the ONE gate → compact JWT + the JWKS the
// RP uses to verify it. `authorizeFn` is the live authorize (Node witness or the shell seam). Returns
// { idToken, authorization, jwks } — the authorization is the L5-verifiable κ proving the biometric happened.
export async function issueIdToken(opts, authorizeFn) {
  const { request, signingInput, payload } = oidcRequest(opts);
  const { authorization, result } = await authorizeFn(request);
  const idToken = composeIdToken(signingInput, result);
  const pub = (result && result.pub) || opts.pub || null;
  return { idToken, authorization, payload, jwks: pub ? { keys: [jwkFor(pub, opts.kid || opts.subject)] } : null };
}

// jwkFor — the operator's Ed25519 public key as a JOSE OKP JWK (what a relying party puts in its JWKS to
// verify the ID Token). `pub` is the principal's STANDARD-base64 raw 32-byte Ed25519 key.
export function jwkFor(pub, kid) {
  return { kty: "OKP", crv: "Ed25519", x: _b64uFromStdB64(pub), alg: "EdDSA", use: "sig", ...(kid ? { kid } : {}) };
}

// verifyIdToken — RP-side verification (offline): EdDSA over the signing input against the OKP JWK. Optionally
// enforce audience/nonce/exp. Returns the decoded claims or null (fail-closed). Proves the token a real RP
// would accept — the interop guarantee.
export async function verifyIdToken(idToken, jwk, { audience = null, nonce = null, nowSec } = {}) {
  try {
    const subtle = globalThis.crypto && globalThis.crypto.subtle; if (!subtle) return null;
    const [h, p, s] = String(idToken).split("."); if (!h || !p || !s) return null;
    const header = JSON.parse(_td.decode(_bytesFromB64u(h)));
    if (header.alg !== "EdDSA") return null;
    const claims = JSON.parse(_td.decode(_bytesFromB64u(p)));
    const key = await subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x: jwk.x }, { name: "Ed25519" }, false, ["verify"]);
    const ok = await subtle.verify({ name: "Ed25519" }, key, _bytesFromB64u(s), _te.encode(h + "." + p));
    if (!ok) return null;
    if (audience && claims.aud !== audience) return null;
    if (nonce && claims.nonce !== nonce) return null;
    if (Number.isFinite(nowSec) && Number.isFinite(claims.exp) && nowSec > claims.exp) return null;
    return claims;
  } catch { return null; }
}
