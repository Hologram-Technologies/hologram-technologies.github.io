#!/usr/bin/env node
// holo-q-acquire-witness.mjs — ADR-0114 S3: prove the END-TO-END self-acquisition loop (holo-q-acquire.mjs),
// with the S2 authorization gate (the REAL holo-q-authz.authorize) STRUCTURALLY on the critical path.
//
// The magic: Q detects a skill gap → discovers a specialist → AUTHORIZES → forges to .holo → binds it. This
// witness drives that loop with spies and proves: a listed model acquires + binds; an UNSIGNED model is refused
// and forge is NEVER reached (the gate cannot be bypassed); off-manifest without consent is refused; a pinned
// model whose streamed κ doesn't match is refused before bind (provenance end-to-end); no specialist → fall back
// to main (never fakes); and a warm κ-cache rebinds with ZERO download/forge (the instant-on-warm magic).
//
// Real here: the full orchestration + the REAL authorize() + pinGuard(). Injected (already-proven or S1-pending):
// pickSpecialist (network discovery, ADR-0084), forge/HF-download (S1), makeProvider (openHoloStream→engine), the
// conscience (faithful mirror of holo-conscience.js — sealed edit deferred), and the signature primitive (test
// stand-in for the already-witnessed secp256k1.verify, ADR-0111).
//
// Checks (all must hold):
//   1  acquiresListedModel      — listed+pinned plan → accept → forge×1 → bind×1 → bound, tier "pinned".
//   2  gateBeforeForge_order    — the call order is authorize → forge → bind (the gate precedes any download).
//   3  refusesUnsigned_noForge  — unsigned manifest → refused → forge NEVER called, bind NEVER called, fallback main.
//   4  refusesOffManifestNoConsent — policy=deny off-manifest → refused → forge not called.
//   5  pinnedKappaGuardRefuses  — forge streams a WRONG κ for a pinned model → refused before bind (bind×0).
//   6  fallbackWhenNoSpecialist — discovery finds none → bound:false, fallback "main", forge not called.
//   7  warmReloadNetworkFree    — acquire the same skill twice → 2nd is warm, forge called only ONCE total.
//
// Authority (external): holospaces Laws L1/L5 · ADR-0114 · ADR-0084 Holo Q Mux · ADR-0033 Constitution ·
// ADR-0111 (secp256k1 M-of-N) · RFC 8785 JCS. Usage: node tools/holo-q-acquire-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { acquireSpecialist } from "../os/usr/lib/holo/q/holo-q-acquire.mjs";
import { authorize, verifyManifest, jcs, pinGuard } from "../os/usr/lib/holo/q/holo-q-authz.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const write = (r) => writeFileSync(join(here, "holo-q-acquire-witness.result.json"), JSON.stringify(r, null, 2) + "\n");

// ── crypto + signed manifest fixture (mirrors the authz witness) ────────────────────────────────────────
const sha256hex = (s) => createHash("sha256").update(typeof s === "string" ? Buffer.from(s, "utf8") : Buffer.from(s)).digest("hex");
const bytesToHex = (b) => Buffer.from(b).toString("hex");
const fromHex = (h) => new Uint8Array(Buffer.from(String(h), "hex"));
const signWith = (k, m) => sha256hex(k.toLowerCase() + ":" + bytesToHex(m));
const verify = (sig, msg, pk) => bytesToHex(sig) === signWith(bytesToHex(pk), msg);
const crypto = { sha256hex, verify, fromHex };

const KEYS = ["02" + "a".repeat(64), "02" + "b".repeat(64), "02" + "c".repeat(64)];
const LISTED = "onnx-community/Qwen2.5-Coder-0.5B-Instruct";
const PINNED_KAPPA = "did:holo:sha256:" + "1".repeat(64);
function signManifest(offManifest) {
  const body = {
    "@type": ["schema:DataCatalog", "hosc:SkillModelManifest"], algo: "sha256", v: 1,
    policy: { maxParams: "1.5B", maxBytes: 1.2e9, licenses: ["apache-2.0", "mit", "qwen"], offManifest },
    skills: [{ skill: "code", pipeline: "text-generation", maxParams: "1.5B", allow: [{ repo: LISTED, kappa: PINNED_KAPPA }] }],
    authority: { threshold: 2, keys: KEYS },
  };
  const commitment = sha256hex(jcs(body));
  return { ...body, commitment, signatures: KEYS.slice(0, 2).map((k) => ({ key: k, sig: signWith(k, fromHex(commitment)) })), id: "did:holo:sha256:" + commitment };
}
const manifestDeny = signManifest("deny");

// faithful conscience mirror (sealed)
const sealed = { evaluate: (d = {}) => ((!d.acquiresUnauthorizedModel || d.authorizedAcquire) ? { outcome: "accept", blocked: [] } : { outcome: "block", blocked: ["P9"] }) };
const detail = async () => ({ params: 0.5e9, bytes: 5e8, license: "apache-2.0" });

// builders for the injected pieces, with spies
const planOf = (id) => async () => (id ? { task: "code", specialist: { id, runnable: true, pipeline: "text-generation" }, fallback: null } : { task: "code", specialist: null, fallback: "main", reason: "no specialist" });
function rig({ specialistId = LISTED, manifest = manifestDeny, badForgeKappa = null, cache = null } = {}) {
  const calls = { forge: 0, bind: 0 }, order = [];
  const authCtx = { manifest, conscience: sealed, detail, crypto };
  return {
    calls, order,
    ctx: {
      pickSpecialist: planOf(specialistId),
      authorize: async (p, c) => { order.push("authorize"); return authorize(p, c); },
      authCtx,
      forge: async (model, { pinKappa } = {}) => {
        calls.forge++; order.push("forge");
        const streamedKappa = badForgeKappa || PINNED_KAPPA;
        if (pinKappa) pinGuard(pinKappa, streamedKappa); // pinned → exact-κ guard (throws on mismatch)
        return { kappa: streamedKappa, model: model.id };
      },
      makeProvider: async (holo, model) => ({ id: model.id, generate: async function* () { yield "ok"; } }),
      bindSpecialist: (taskId, provider) => { calls.bind++; order.push("bind"); return { task: taskId, provider: provider.id }; },
      cache,
    },
  };
}

const checks = {};

// 1 · listed + pinned → acquires + binds
{
  const r = rig(); const out = await acquireSpecialist("code", r.ctx);
  checks.acquiresListedModel = out.bound === true && out.tier === "pinned" && r.calls.forge === 1 && r.calls.bind === 1 && out.kappa === PINNED_KAPPA;
  // 2 · order: authorize → forge → bind
  checks.gateBeforeForge_order = JSON.stringify(r.order) === JSON.stringify(["authorize", "forge", "bind"]);
}
// 3 · unsigned manifest → refused, forge + bind NEVER called
{
  const r = rig({ manifest: { ...manifestDeny, signatures: [] } }); const out = await acquireSpecialist("code", r.ctx);
  checks.refusesUnsigned_noForge = out.bound === false && out.fallback === "main" && r.calls.forge === 0 && r.calls.bind === 0;
}
// 4 · off-manifest + policy=deny → refused, forge not called
{
  const r = rig({ specialistId: "evil/unknown-0.3B" }); const out = await acquireSpecialist("code", r.ctx);
  checks.refusesOffManifestNoConsent = out.bound === false && /policy=deny/.test(out.reason) && r.calls.forge === 0;
}
// 5 · pinned model, forge streams the WRONG κ → refused before bind
{
  const r = rig({ badForgeKappa: "did:holo:sha256:" + "9".repeat(64) }); const out = await acquireSpecialist("code", r.ctx);
  checks.pinnedKappaGuardRefuses = out.bound === false && /pinned κ mismatch|forge refused/.test(out.reason) && r.calls.bind === 0;
}
// 6 · no specialist discovered → fall back to main (never fakes), forge not called
{
  const r = rig({ specialistId: null }); const out = await acquireSpecialist("code", r.ctx);
  checks.fallbackWhenNoSpecialist = out.bound === false && out.fallback === "main" && r.calls.forge === 0;
}
// 7 · warm κ-cache → 2nd acquire rebinds with ZERO forge (instant-on-warm)
{
  const cache = new Map(); const r = rig({ cache });
  const a = await acquireSpecialist("code", r.ctx);
  const b = await acquireSpecialist("code", r.ctx);
  checks.warmReloadNetworkFree = a.bound === true && a.warm === false && b.bound === true && b.warm === true && r.calls.forge === 1;
}

const witnessed = Object.values(checks).every(Boolean);
write({
  spec: "Holo Forge Unified (ADR-0114) S3 — the end-to-end self-acquisition loop (holo-q-acquire.mjs) with the S2 authorization gate STRUCTURALLY on the critical path: discover → authorize → forge → bind. A listed model acquires; an unsigned/off-manifest model is refused with forge NEVER reached (the gate cannot be bypassed); a pinned model's streamed κ is guarded before bind; no specialist falls back to main (never fakes); a warm κ-cache rebinds with zero forge.",
  authority: "holospaces Laws L1/L5 · ADR-0114 · ADR-0084 Holo Q Mux · ADR-0033 Constitution · ADR-0111 (secp256k1 M-of-N) · RFC 8785 JCS",
  note: "Orchestration + the REAL authorize()/pinGuard() are Node-proven. Injected (already-witnessed or S1-pending): pickSpecialist (network discovery), forge/HF-download (S1), makeProvider (openHoloStream→engine), the conscience (faithful mirror; sealed edit deferred), and the signature primitive (test stand-in for secp256k1.verify). The #q-acquire row depends on #forge-acquire-authz; both register in conformance.jsonld in the reseal step.",
  witnessed,
  covers: witnessed ? ["q-self-acquire", "gate-on-critical-path", "refuses-unsigned", "off-manifest-consent", "pinned-kappa-guard", "fallback-never-fakes", "warm-reload-network-free"] : [],
  checks,
});

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ Q self-acquires a skill end-to-end with the authorization gate unbypassable, pinned-κ guarded, honest fallback, and warm reload free" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
