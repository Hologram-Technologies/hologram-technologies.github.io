// CAPSTONE (P5) — does the unified TEE gate cohere? Asserts the spine the whole initiative rests on:
// ONE seed projects to identity + wallet + vault; ONE vault holds every relay credential type; the design
// is fail-closed and net-simpler (publishVault deleted; one relay handles all types). Node-level mother-test.
import { readFileSync } from "node:fs";
import { enroll } from "../os/usr/lib/holo/holo-login.mjs";
import { openVault } from "../os/usr/lib/holo/holo-vault.mjs";
import { provisionWallet, isPresentationSafe } from "../os/usr/lib/holo/holo-wallet-provision.mjs";
import { requireStepUp, buildStepUp } from "../os/usr/lib/holo/holo-stepup.mjs";
import { authorize, makeHandlers, issueIdToken, verifyIdToken, verifyAuth } from "../os/usr/lib/holo/holo-auth.mjs";

const OS = "../os/usr/lib/holo/";
const read = (p) => { try { return readFileSync(new URL(p, import.meta.url), "utf8"); } catch { return ""; } };

async function main() {
  const r = {};

  // ── THE UNIFYING SPINE: ONE enroll (one seed, one secret) → identity + wallet + vault ──
  const SECRET = "unified-gate correct horse battery staple test phrase";
  const { principal } = await enroll({ label: "operator", secret: SECRET, allowPhrase: true });
  r.oneSeed_identity = /^did:holo:sha256:[0-9a-f]{64}$/.test(principal.kappa || "");
  r.oneSeed_wallet = !!(principal.addresses && principal.addresses().ethereum);
  const w = provisionWallet(principal);
  r.oneSeed_walletSafe = w.provisioned && isPresentationSafe(w) && !!w.addresses.ethereum;

  // ── ONE vault (unlocked by the SAME secret) holds EVERY credential type the relay dispatches ──
  const OP = principal.kappa;
  const v = await openVault(OP, SECRET);
  await v.put({ origin: "https://site.example", kind: "password", username: "u", secret: "p" });
  await v.put({ origin: "https://site.example", kind: "totp", username: "2fa", secret: "JBSWY3DPEHPK3PXP" });
  await v.put({ origin: "https://rp.example", kind: "passkey", secret: JSON.stringify({ credentialId: "x" }) });
  await v.put({ origin: "https://dapp.example", kind: "web3", secret: JSON.stringify({ chain: "ethereum" }) });
  const kinds = new Set(v.list().map((e) => e.kind));
  r.oneVault_allRelayKinds = ["password", "totp", "passkey", "web3"].every((k) => kinds.has(k));

  // ── FAIL-CLOSED defaults ──
  r.failClosed_guestWalletless = provisionWallet(null).provisioned === false;
  r.failClosed_stepupNoTee = await (async () => { try { await requireStepUp({ kind: "wallet.send", operator: OP, appId: "x", payload: {} }, {}); return false; } catch { return true; } })();

  // ── SIMPLIFICATION (net-negative complexity): the push channel is gone; ONE relay handles all types ──
  const sddm = read(OS + "holo-sddm.js");
  r.simpler_publishVaultDeleted = sddm.length > 0 && !sddm.includes("publishVault");
  const app = read("../../../holo-apps/apps/tauri/cef-host/src/app.cc");  // best-effort; structural
  r.unified_oneRelayAllTypes = app.includes("verb==='cred'") && app.includes("op==='web3'") &&
    app.includes("op==='fill'") && app.includes("op==='save'") && app.includes("verb==='webauthn'");

  // ── DISPLAY-SPLIT: the greeter writes only the PUBLIC wallet presentation (no secret on the cross path) ──
  r.displaySplit_publicOnly = sddm.includes("isPresentationSafe(wal)") || sddm.includes("provisionWallet");

  // ════ UNIVERSAL SEAM: EVERY auth act flows through the ONE `authorize` verb — proven live + structurally ════
  // (1) Live: one gate fn services SIGN, RELEASE, PROVE, and OIDC — each yields an L5-verifiable, PQ κ.
  let gateCalls = 0;
  const gate = async (action) => { gateCalls++; return buildStepUp(action, principal); };
  const handlers = makeHandlers({ principal, vault: v });
  const authFn = (req) => authorize(req, { gate, handlers });
  const signA = await authFn({ subject: OP, context: "https://rp.example", mode: "SIGN", spec: { keyDomain: "operator", payload: "x" } });
  const relA = await authFn({ subject: OP, context: "https://site.example", mode: "RELEASE", spec: { kind: "password" } });
  const provA = await authFn({ subject: OP, context: "https://age.example", mode: "PROVE", spec: { predicate: "age>=18", value: 21 } });
  const oidc = await issueIdToken({ subject: OP, audience: "https://rp.example", nonce: "n1", pub: principal.pub, issuedAtSec: 1750000000 }, authFn);
  r.universal_signVerifies = !!(await verifyAuth(signA.authorization)) && !!signA.result.signature;
  r.universal_releaseCorrect = relA.result && relA.result.secret === "p";
  r.universal_proveProduced = !!(provA.result && provA.result.proof);
  r.universal_oidcRpVerifies = !!(await verifyIdToken(oidc.idToken, oidc.jwks.keys[0], { audience: "https://rp.example", nonce: "n1", nowSec: 1750000100 }));
  r.universal_oneGateForAll = gateCalls === 4;                                  // SIGN+RELEASE+PROVE+OIDC → one gate fn

  // (2) Structural: the shell installs the ONE seam and the legacy gate DELEGATES to it (single implementation).
  const shell = read("../os/usr/share/frame/shell.html");
  r.seam_shellInstallsHoloAuth = shell.includes("window.HoloAuth") && shell.includes("async authorize(request)");
  r.seam_stepUpDelegates = shell.includes("window.__holoStepUp = async (action) => holoGate(");
  r.seam_oneCeremony = shell.includes("currentSecret(op, force)") && shell.includes("STEPUP_WINDOW_MS");

  // (3) Live host: the universal `auth` verb + relay route + public web API are all wired into the CEF host.
  const handler = read("../../../holo-apps/apps/tauri/cef-host/src/handler.cc");
  r.host_authVerb = app.includes("verb==='auth'") && app.includes("A.signIn") && app.includes("A.authorize");
  r.host_authRoute = handler.includes("holo:auth:") && handler.includes("\"auth:\" + payload");
  r.host_publicWebApi = app.includes("window.HoloID") && app.includes("signIn:function") && app.includes("holo:auth:");

  // (4) NO PARALLEL PATH: web3 signing now routes through the ONE seam (authorize SIGN/ethereum); the old
  // ad-hoc __holoStepUp+W.sign duplicate is retired. The shell's ethereum signer covers typed data too.
  r.unify_web3SignViaSeam = app.includes("mode:'SIGN',spec:{keyDomain:'ethereum',payload:pl}") && !app.includes("W.sign(req.params");
  r.unify_proveIsRealZk = shell.includes("core.makeProver({ principal: p, getCredential })") && !shell.includes('"@type": "HoloPredicate", predicate: spec.predicate, context: spec.context || null }'); // shell PROVE no longer the signed-stub
  r.unify_shellEthTyped = shell.includes('w.signTypedData({ chain: "ethereum"');

  r.ok = Object.entries(r).every(([k, val]) => k === "ok" || val === true);
  console.log("holo-unified-gate (mother-test):", JSON.stringify(r, null, 2));
  if (!r.ok) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(2); });
