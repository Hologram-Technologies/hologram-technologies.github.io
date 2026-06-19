#!/usr/bin/env node
// holo-forge-authz-witness.mjs — ADR-0114 S2: prove the model-acquisition AUTHORIZATION gate (holo-q-authz.mjs).
//
// L5 proves INTEGRITY, never PROVENANCE — so before Q forges+runs a model it acquired itself, authorize() must
// accept the acquisition. This witness drives the gate through every admission path and proves it FAILS CLOSED.
//
// What is REAL here: the gate logic — signed-manifest M-of-N verification, commitment-over-canonical-body,
// per-key dedup + threshold, hard param/byte/license caps, the signed allowlist (pinned vs repo tier), the
// off-manifest deny/consent policy, the fail-closed conscience, and the pinned-κ downstream guard. The conscience
// is a FAITHFUL local mirror of holo-conscience.js:117 (sealed flag · WORLD_VARS · redLine P9 · sat()) — the real
// edit to that SEALED file is the deferred reseal step (the ADR-0113 pinned-file pattern). The signature primitive
// is a deterministic test stand-in for secp256k1.verify, which holo-anchor ALREADY witnesses (ADR-0111) — exactly
// as the dial witness simulates the already-proven RTCPeerConnection leg. The gate is verify-fn-agnostic.
//
// Checks (all must hold):
//   1  allowsListedModelPinned   — a manifest-listed repo with a pinned κ, within caps → accept, tier "pinned".
//   2  refusesUnlistedModel      — off-manifest + policy.offManifest="deny" → refuse (caller falls back to main).
//   3  refusesUnsignedManifest   — signatures stripped → manifest unverified → refuse, nothing acquires.
//   4  refusesTamperedManifest   — one flipped allow-entry byte → commitment mismatch → refuse.
//   5  refusesOversizedModel     — a LISTED repo whose live detail exceeds the param cap → refuse (caps beat the list).
//   6  refusesBadLicense         — a LISTED repo with a non-allowlisted license → refuse.
//   7  consentGrantsOffManifest  — off-manifest + policy="consent" + consent granted + sealed conscience → accept "consent".
//   8  deniedConsentBlocks       — same path, consent DENIED → P9 red-line blocks → refuse.
//   9  failsClosedWhenUnsealed   — off-manifest, consent granted, but conscience UNSEALED → block regardless.
//   10 pinnedTierBindsExactKappa — the pinned acquisition's κ guards downstream: matching κ ok, substituted κ refused.
//
// Authority (external): holospaces Laws L1/L5 · ADR-0114 Holo Forge Unified · ADR-0033 Holo Constitution
// (conscience) · ADR-0111 Holo Boot Root (secp256k1 M-of-N) · RFC 8785 JCS. Usage: node tools/holo-forge-authz-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { authorize, verifyManifest, jcs, pinGuard, numParams } from "../os/usr/lib/holo/q/holo-q-authz.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const write = (r) => writeFileSync(join(here, "holo-forge-authz-witness.result.json"), JSON.stringify(r, null, 2) + "\n");

// ── crypto deps (injected) ────────────────────────────────────────────────────────────────────────────
const sha256hex = (s) => createHash("sha256").update(typeof s === "string" ? Buffer.from(s, "utf8") : Buffer.from(s)).digest("hex");
const bytesToHex = (b) => Buffer.from(b).toString("hex");
const fromHex = (h) => new Uint8Array(Buffer.from(String(h), "hex"));
// Test signature scheme (stand-in for secp256k1.verify, already witnessed at ADR-0111): a "signature" by key K
// over message M is sha256hex(K + ":" + hex(M)); verify recomputes. This exercises the gate's threshold/dedup/
// commitment/tamper logic — NOT the crypto primitive (which is injected and proven elsewhere).
const signWith = (keyHex, msgBytes) => sha256hex(keyHex.toLowerCase() + ":" + bytesToHex(msgBytes));
const verify = (sigBytes, msgBytes, pubKeyBytes) => bytesToHex(sigBytes) === signWith(bytesToHex(pubKeyBytes), msgBytes);
const crypto = { sha256hex, verify, fromHex };

// ── conscience: a faithful mirror of holo-conscience.js:117 (the SEALED edit is the deferred reseal step) ──
const WORLD_VARS = ["acquiresUnauthorizedModel", "authorizedAcquire"];
const PRINCIPLES = [{ id: "P9", title: "Model acquisition", redLine: true, governs: "acquiresUnauthorizedModel", relaxedBy: ["authorizedAcquire"] }];
const sat = (p, d) => !d[p.governs] || (p.relaxedBy || []).some((v) => d[v]);
const makeConscience = (sealed = true) => ({
  evaluate(decision = {}, { posture = "answer-then-caveat", principles = PRINCIPLES } = {}) {
    if (sealed !== true) return { outcome: "block", blocked: ["*"], caveats: [], verdicts: [], sealed: false, reason: "unsealed — failed closed" };
    const d = {}; for (const v of WORLD_VARS) d[v] = !!decision[v];
    const verdicts = principles.map((p) => sat(p, d)
      ? { id: p.id, verdict: "accept", redLine: !!p.redLine }
      : { id: p.id, verdict: (posture === "strict" || p.redLine) ? "block" : "caveat", redLine: !!p.redLine });
    const blocked = verdicts.filter((v) => v.verdict === "block").map((v) => v.id);
    const caveats = verdicts.filter((v) => v.verdict === "caveat").map((v) => v.id);
    return { outcome: blocked.length ? "block" : caveats.length ? "caveat" : "accept", blocked, caveats, verdicts, sealed: true };
  },
});

// ── a signed manifest fixture ─────────────────────────────────────────────────────────────────────────
const KEYS = ["02" + "a".repeat(64), "02" + "b".repeat(64), "02" + "c".repeat(64)]; // 3 mock 33B compressed pubkeys
const PINNED_KAPPA = "did:holo:sha256:" + "1".repeat(64);
const baseManifest = (offManifest) => ({
  "@type": ["schema:DataCatalog", "hosc:SkillModelManifest"], algo: "sha256", v: 1,
  policy: { maxParams: "1.5B", maxBytes: 1.2e9, licenses: ["apache-2.0", "mit", "qwen"], offManifest },
  skills: [{ skill: "code", pipeline: "text-generation", tags: ["code"], maxParams: "1.5B",
    allow: [{ repo: "onnx-community/Qwen2.5-Coder-0.5B-Instruct", kappa: PINNED_KAPPA }] }],
  authority: { threshold: 2, keys: KEYS },
});
function signManifest(m, signerKeys = KEYS.slice(0, 2)) {
  const body = { ...m }; delete body.signatures; delete body.commitment; delete body.id;
  const commitment = sha256hex(jcs(body));
  const msg = fromHex(commitment);
  return { ...body, commitment, signatures: signerKeys.map((k) => ({ key: k, sig: signWith(k, msg) })), id: "did:holo:sha256:" + commitment };
}

const LISTED = "onnx-community/Qwen2.5-Coder-0.5B-Instruct";
const planFor = (id) => ({ task: "code", specialist: { id, score: 9, runnable: true, pipeline: "text-generation" }, alternatives: [], fallback: null });
const detailMap = (over = {}) => async (id) => ({ params: 0.5e9, bytes: 5e8, license: "apache-2.0", ...(over[id] || {}) });

const manifestDeny = signManifest(baseManifest("deny"));
const manifestConsent = signManifest(baseManifest("consent"));
const sealed = makeConscience(true);
const unsealed = makeConscience(false);

const checks = {};

// 1 · listed + pinned κ within caps → accept, tier "pinned"
{
  const r = await authorize(planFor(LISTED), { manifest: manifestDeny, detail: detailMap(), crypto, conscience: sealed });
  checks.allowsListedModelPinned = r.accept === true && r.tier === "pinned" && r.model.kappa === PINNED_KAPPA;
}
// 2 · off-manifest + policy=deny → refuse
{
  const r = await authorize(planFor("evil/unknown-0.3B"), { manifest: manifestDeny, detail: detailMap(), crypto, conscience: sealed });
  checks.refusesUnlistedModel = r.accept === false && /policy=deny/.test(r.reason);
}
// 3 · signatures stripped → unverified → refuse
{
  const stripped = { ...manifestDeny, signatures: [] };
  const r = await authorize(planFor(LISTED), { manifest: stripped, detail: detailMap(), crypto, conscience: sealed });
  checks.refusesUnsignedManifest = r.accept === false && /manifest unverified/.test(r.reason);
}
// 4 · tampered allow-entry → commitment mismatch → refuse
{
  const tampered = JSON.parse(JSON.stringify(manifestDeny));
  tampered.skills[0].allow[0].repo = "attacker/swapped-model"; // body changed, commitment no longer matches
  const r = await authorize(planFor("attacker/swapped-model"), { manifest: tampered, detail: detailMap(), crypto, conscience: sealed });
  const mv = await verifyManifest(tampered, crypto);
  checks.refusesTamperedManifest = r.accept === false && mv.ok === false && mv.reason === "commitment mismatch";
}
// 5 · listed repo but live params over cap → refuse (caps beat the list)
{
  const r = await authorize(planFor(LISTED), { manifest: manifestDeny, detail: detailMap({ [LISTED]: { params: 8e9, bytes: 5e8, license: "apache-2.0" } }), crypto, conscience: sealed });
  checks.refusesOversizedModel = r.accept === false && /over param cap/.test(r.reason);
}
// 6 · listed repo but non-allowlisted license → refuse
{
  const r = await authorize(planFor(LISTED), { manifest: manifestDeny, detail: detailMap({ [LISTED]: { params: 0.5e9, bytes: 5e8, license: "cc-by-nc-4.0" } }), crypto, conscience: sealed });
  checks.refusesBadLicense = r.accept === false && /license cc-by-nc-4\.0 not allowed/.test(r.reason);
}
// 7 · off-manifest + consent granted + sealed conscience → accept "consent"
{
  const r = await authorize(planFor("community/some-open-0.3B"), { manifest: manifestConsent, detail: detailMap(), crypto, conscience: sealed, consent: async () => true });
  checks.consentGrantsOffManifest = r.accept === true && r.tier === "consent";
}
// 8 · off-manifest + consent denied → P9 red-line blocks → refuse
{
  const r = await authorize(planFor("community/some-open-0.3B"), { manifest: manifestConsent, detail: detailMap(), crypto, conscience: sealed, consent: async () => false });
  checks.deniedConsentBlocks = r.accept === false && /consent denied/.test(r.reason);
}
// 9 · off-manifest, consent granted, but conscience UNSEALED → block regardless (fail closed)
{
  const r = await authorize(planFor("community/some-open-0.3B"), { manifest: manifestConsent, detail: detailMap(), crypto, conscience: unsealed, consent: async () => true });
  checks.failsClosedWhenUnsealed = r.accept === false && /conscience blocked: \*/.test(r.reason);
}
// 10 · pinned acquisition's κ guards downstream: matching κ ok, substituted κ refused
{
  const r = await authorize(planFor(LISTED), { manifest: manifestDeny, detail: detailMap(), crypto, conscience: sealed });
  let okMatch = false, refusedMismatch = false;
  try { okMatch = pinGuard(r.model.kappa, PINNED_KAPPA); } catch { okMatch = false; }
  try { pinGuard(r.model.kappa, "did:holo:sha256:" + "9".repeat(64)); } catch { refusedMismatch = true; }
  checks.pinnedTierBindsExactKappa = okMatch === true && refusedMismatch === true;
}

// sanity: the param parser the caps rely on
checks._numParams = numParams("1.5B") === 1.5e9 && numParams("0.5B") === 0.5e9;

const witnessed = Object.values(checks).every(Boolean);
write({
  spec: "Holo Forge Unified (ADR-0114) S2 — the model-acquisition authorization gate (holo-q-authz.mjs): Q may auto-acquire a HuggingFace model only on a SIGNED, κ-addressed skill→model manifest within hard caps, or off-manifest only behind the fail-closed conscience + explicit consent; L5 proves integrity, this proves provenance+bounds. Refuses unsigned/tampered/oversized/bad-license/off-manifest-without-consent, and fails closed when the conscience is unsealed.",
  authority: "holospaces Laws L1/L5 · ADR-0114 Holo Forge Unified · ADR-0033 Holo Constitution · ADR-0111 Holo Boot Root (secp256k1 M-of-N) · RFC 8785 JCS",
  note: "Gate logic is REAL + Node-proven. The conscience is a faithful local mirror of holo-conscience.js (the sealed-file edit is the deferred reseal step); the signature primitive is a deterministic stand-in for the already-witnessed secp256k1.verify (ADR-0111). The #forge-acquire-authz row registration in conformance.jsonld + the live conscience edit are the remaining pinned/reseal steps.",
  witnessed,
  covers: witnessed ? ["acquire-authz", "signed-manifest-m-of-n", "hard-caps", "signed-allowlist", "off-manifest-consent", "fail-closed-conscience", "pinned-kappa-guard", "law-l5-vs-provenance"] : [],
  checks,
});

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ the authorization gate admits only signed/within-bounds models, takes explicit consent off-manifest, and fails closed" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
