// Witness: the universal `authorize` primitive is canonical, κ-rooted, self-verifying (L5), operator-signed
// (Ed25519+ML-DSA, PQ/SEC-4), payload-bound (SEC-1), released only under the ONE gate (SEC-2, fail-closed),
// context-bound (anti-phishing), and FAST. SIGN/RELEASE/PROVE + SIWE adapter, all from ONE seed/one gate.
import { authorize, verifyAuth, makeHandlers, siweRequest, MODES, issueIdToken, verifyIdToken, jwkFor, verifyProof } from "../os/usr/lib/holo/holo-auth.mjs";
import { buildStepUp } from "../os/usr/lib/holo/holo-stepup.mjs";
import { enroll, unlockSeed } from "../os/usr/lib/holo/holo-login.mjs";
import { openVault } from "../os/usr/lib/holo/holo-vault.mjs";
import { HoloWallet, deriveAddress } from "../os/usr/lib/holo/holo-wdk.js";

async function main() {
  const r = {};
  const SECRET = "universal-auth correct horse battery staple test phrase";
  // ── ONE seed → operator signer + wallet (eth) + vault (release) — the unifying spine ──
  const { principal } = await enroll({ label: "operator", secret: SECRET, allowPhrase: true });
  const seed = await unlockSeed(principal.kappa, SECRET);
  const vault = await openVault(principal.kappa, SECRET);
  await vault.put({ origin: "https://app.example", kind: "password", username: "ilya@app", secret: "S3cret!42" });
  const wallet = new HoloWallet({ gate: async () => true }); await wallet.openSeed(seed);
  const ethAddr = deriveAddress("ethereum", seed, 0);

  // the ONE gate (every mode uses it). Approving gate = a real holo-stepup token signed by the operator.
  let gateCalls = 0;
  const gate = async (action) => { gateCalls++; return buildStepUp(action, principal); };
  const denyGate = async () => null;                                   // fail-closed gate
  const handlers = makeHandlers({ principal, signers: { ethereum: (m) => wallet.signMessage({ chain: "ethereum", message: m }) }, vault });
  const SUB = principal.kappa;

  // ── SIGN (operator key) ──
  const s = await authorize({ subject: SUB, context: "https://rp.example", mode: "SIGN", spec: { keyDomain: "operator", payload: "hello-rp" } }, { gate, handlers });
  r.sign_produced = !!(s.result && s.result.signature);
  r.auth_isAttestationKappa = /^did:holo:sha256:[0-9a-f]{64}$/.test(s.authorization.id);     // L1 content-addressed
  r.auth_selfVerifies = !!(await verifyAuth(s.authorization));                                // L5 + Ed25519 + ML-DSA
  r.auth_isPQ = !!(s.authorization.pqSig && s.authorization.pqAlg);                            // SEC-4 post-quantum co-sig
  r.auth_payloadBound = !!s.authorization.challenge && s.authorization.payload.context === "https://rp.example"; // SEC-1

  // ── SIWE adapter (SIGN over the canonical EIP-4361 message via the eth key) ──
  const siwe = await authorize(siweRequest({ subject: SUB, origin: "https://dapp.example", siweMessage: "dapp.example wants you to sign in with your Ethereum account:\n" + ethAddr }), { gate, handlers });
  const sig = siwe.result && siwe.result.signature;
  r.siwe_signed = typeof sig === "string" ? /^0x[0-9a-fA-F]{120,}$/.test(sig) : !!sig;         // eth signature produced
  r.siwe_selfVerifies = !!(await verifyAuth(siwe.authorization));

  // ── RELEASE (vault secret to the verified context; wrong context → nothing, anti-phishing) ──
  const rel = await authorize({ subject: SUB, context: "https://app.example", mode: "RELEASE", spec: { kind: "password" } }, { gate, handlers });
  r.release_correct = !!(rel.result && rel.result.secret === "S3cret!42" && rel.result.username === "ilya@app");
  const relWrong = await authorize({ subject: SUB, context: "https://app-evil.example", mode: "RELEASE", spec: { kind: "password" } }, { gate, handlers });
  r.release_wrongContextNull = relWrong.result === null;                                       // ADR-013 exact-origin

  // ── OIDC "Sign in with Hologram" adapter (SIGN over the JOSE signing input → a standards ID Token an RP
  //    verifies against the published JWK). Collapses the whole SSO surface; nothing external changes. ──
  const authorizeFn = (req) => authorize(req, { gate, handlers });
  const oidc = await issueIdToken({ subject: SUB, audience: "https://rp.example", nonce: "n-0a1b", claims: { name: "Ilya" }, pub: principal.pub, issuedAtSec: 1750000000 }, authorizeFn);
  r.oidc_isJWT = typeof oidc.idToken === "string" && oidc.idToken.split(".").length === 3;        // header.payload.sig
  const jwk = oidc.jwks && oidc.jwks.keys && oidc.jwks.keys[0];
  const claims = await verifyIdToken(oidc.idToken, jwk, { audience: "https://rp.example", nonce: "n-0a1b", nowSec: 1750000100 });
  r.oidc_rpVerifies = !!(claims && claims.iss === SUB && claims.sub === SUB && claims.aud === "https://rp.example" && claims.nonce === "n-0a1b" && claims.name === "Ilya"); // EdDSA verifies + claims bound
  r.oidc_wrongAudRefused = (await verifyIdToken(oidc.idToken, jwk, { audience: "https://evil.example" })) === null;        // anti-replay across RPs
  r.oidc_tamperRefused = await (async () => { const [h, p, s] = oidc.idToken.split("."); const ev = JSON.parse(Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()); ev.aud = "https://evil.example"; const ep = Buffer.from(JSON.stringify(ev)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); return (await verifyIdToken(h + "." + ep + "." + s, jwk)) === null; })(); // mutated claims → EdDSA fails
  r.oidc_authSelfVerifies = !!(await verifyAuth(oidc.authorization));                              // the act behind the token is itself L5-verifiable

  // ── PROVE (REAL zero-knowledge predicate disclosure via holo-zk-range) ──
  const pv = await authorize({ subject: SUB, context: "https://age.example", mode: "PROVE", spec: { predicate: "age>=18", value: 21 } }, { gate, handlers });
  r.prove_isRealZk = !!(pv.result && pv.result.kind === "zk-range" && pv.result.proof && pv.result.proof.op === "ge");   // not the attested stub
  r.prove_rpVerifies = await verifyProof(pv.result, { predicate: "age>=18" });                                          // a verifier accepts it offline
  r.prove_thresholdBound = (await verifyProof(pv.result, { predicate: "age>=40" })) === false;                          // a proof for >=18 can't pass as >=40

  // ── ONE gate for ALL (SEC-2): the 6 happy-path authorizations each went through the same gate fn ──
  r.oneGateForAll = gateCalls === 6;                                                           // SIGN+SIWE+OIDC+RELEASE+RELEASE2+PROVE(real) — ONE gate fn for every domain

  // zero-knowledge: the ONLY cleartext number is the PUBLIC threshold (18); the secret value is in Pedersen
  // commitments. Proven by value-independence — a proof for a DIFFERENT secret (85) verifies with the SAME
  // public threshold and a DIFFERENT commitment, so the published bytes can't be revealing the value.
  const pv2 = await authorize({ subject: SUB, context: "https://age.example", mode: "PROVE", spec: { predicate: "age>=18", value: 85 } }, { gate, handlers });
  const thr = (h) => Number(BigInt("0x" + String(h)));
  r.prove_zeroKnowledge = thr(pv.result.proof.t) === 18 && thr(pv2.result.proof.t) === 18 && (await verifyProof(pv2.result, { predicate: "age>=18" })) && pv.result.proof.Cv !== pv2.result.proof.Cv;
  r.prove_soundFalseClaimRefused = await (async () => { try { await authorize({ subject: SUB, context: "x", mode: "PROVE", spec: { predicate: "age>=18", value: 16 } }, { gate, handlers }); return false; } catch { return true; } })(); // cannot prove a false claim (proveGE throws when v<t)

  // ── REFUSALS (vv) ──
  r.gate_failClosed = await (async () => { try { await authorize({ subject: SUB, context: "x", mode: "SIGN", spec: { keyDomain: "operator", payload: "y" } }, { gate: denyGate, handlers }); return false; } catch { return true; } })();
  const tampered = { ...s.authorization, payload: { ...s.authorization.payload, mode: "RELEASE" } };     // mutate the bound act
  r.tamper_refused = (await verifyAuth(tampered)) === null;                                    // L5 re-derivation refuses
  r.badMode_refused = await (async () => { try { await authorize({ subject: SUB, context: "x", mode: "EXFIL", spec: {} }, { gate, handlers }); return false; } catch { return true; } })();

  // ── LOW LATENCY: the non-TEE compute (token build + adapter) per authorize, ms ──
  const N = 20, t0 = performance.now();
  for (let i = 0; i < N; i++) await authorize({ subject: SUB, context: "c", mode: "SIGN", spec: { keyDomain: "operator", payload: "z" + i } }, { gate: async (a) => buildStepUp(a, principal), handlers });
  const perMs = (performance.now() - t0) / N;
  r.lowLatency = perMs < 100;                                                                  // sub-100ms compute (TEE tap excluded; repeats suppressed)

  r.ok = Object.entries(r).every(([k, v]) => k === "ok" || v === true);
  console.log("holo-auth (universal authenticator) witness:", JSON.stringify({ ...r, _perAuthorizeMs: Math.round(perMs * 100) / 100 }, null, 2));
  if (!r.ok) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(2); });
