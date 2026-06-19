#!/usr/bin/env node
// holo-forge-pipeline-witness.mjs — ADR-0114: prove the FULL pipeline COMPOSES, not just each stage in isolation.
// One flow through the REAL built modules: ingest (S1) → forgeToHolo/sealHolo (S0) → authorize (S2) → acquireSpecialist
// (S3), and the produced .holo is validated by the REAL production reader (readHolo/openHoloStream). Only `fetch` and
// the GGUF tensor-split are mocked (forgeGguf is already witnessed by gguf-forge.test.mjs); everything load-bearing —
// range ingestion, the one sealer, the signed-manifest gate, the pinned-κ guard, the orchestration — is the real code.
//
// Checks (all must hold):
//   1  pipelineBindsListedModel   — Q acquires a signed+listed model end-to-end: ingest→forge→seal→authorize→bind, tier "pinned".
//   2  producedHoloRoundTrips      — the .holo the pipeline forged reads back through the REAL reader: arch + per-block L5.
//   3  refusesUnsignedNoIngest     — unsigned manifest → refused with the network NEVER touched (fetch count 0, forge 0, bind 0).
//   4  pinnedSourceKappaMismatch   — manifest pins the WRONG source κ → pinGuard refuses AFTER download, before bind (bind 0).
//   5  warmReloadNetworkFree       — 2nd acquire of the same skill is warm: ingest/fetch happen ONCE total.
//
// Authority (external): holospaces Laws L1/L3/L5 · ADR-0114 · ADR-0084 · ADR-0033 · ADR-0111 · HTTP Range/206.
// Usage: node tools/holo-forge-pipeline-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { ingest } from "../os/usr/lib/holo/q/holo-hf-ingest.mjs";
import { forgeToHolo } from "../../../holo-apps/apps/q/forge/holo-forge-seal.mjs";
import { readHolo, openHoloStream } from "../../../holo-apps/apps/q/forge/holo-archive.mjs";
import { authorize, verifyManifest, pinGuard, jcs } from "../os/usr/lib/holo/q/holo-q-authz.mjs";
import { acquireSpecialist } from "../os/usr/lib/holo/q/holo-q-acquire.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const write = (r) => writeFileSync(join(here, "holo-forge-pipeline-witness.result.json"), JSON.stringify(r, null, 2) + "\n");
const sha256hex = (b) => createHash("sha256").update(typeof b === "string" ? Buffer.from(b, "utf8") : Buffer.from(b)).digest("hex");
const bytesToHex = (b) => Buffer.from(b).toString("hex");
const fromHex = (h) => new Uint8Array(Buffer.from(String(h), "hex"));
const signWith = (k, m) => sha256hex(k.toLowerCase() + ":" + bytesToHex(m));
const verify = (sig, msg, pk) => bytesToHex(sig) === signWith(bytesToHex(pk), msg);
const crypto = { sha256hex, verify, fromHex };
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// ── a synthetic GGUF the mock HF serves ────────────────────────────────────────────────────────────────
const REPO = "onnx-community/Qwen2.5-Coder-0.5B-Instruct-GGUF";
const FILE = "qwen2.5-coder-0.5b-instruct-q8_0.gguf";
const FSIZE = 800;
const SRC = new Uint8Array(FSIZE); SRC.set([0x47, 0x47, 0x55, 0x46], 0); for (let i = 4; i < FSIZE; i++) SRC[i] = (i * 31 + 7) & 0xff;
const SRC_KAPPA = "did:holo:sha256:" + sha256hex(SRC);
const INFO = { id: REPO, gated: false, siblings: [{ rfilename: FILE, size: FSIZE }, { rfilename: "tokenizer.json", size: 50 }] };

function makeFetch() {
  const seen = { calls: 0 };
  const fetch = async (url, { headers = {} } = {}) => {
    seen.calls++;
    if (String(url).includes("/api/models/")) return { status: 200, json: async () => INFO, arrayBuffer: async () => new ArrayBuffer(0) };
    const m = /bytes=(\d+)-(\d+)/.exec(headers.Range || "");
    const start = m ? +m[1] : 0, end = m ? Math.min(+m[2], FSIZE - 1) : FSIZE - 1;
    return { status: m ? 206 : 200, arrayBuffer: async () => SRC.slice(start, end + 1).buffer };
  };
  return { fetch, seen };
}

// a ModelFrontEnd that splits the downloaded bytes into 2 tensors (stands in for forgeGguf, already witnessed)
const FRONT = {
  name: "gguf",
  detect: (h) => h[0] === 0x47 && h[1] === 0x47 && h[2] === 0x55 && h[3] === 0x46,
  forge: (bytes) => {
    const a = bytes.slice(0, 64), b = bytes.slice(64);
    const blocks = new Map([[sha256hex(a), a], [sha256hex(b), b]]);
    return { arch: "qwen2", sourceRoot: "did:holo:sha256:" + sha256hex(bytes), blocks, ext: { key: "gguf.header", bytes: bytes.slice(0, 8) },
      tensors: [{ name: "t0", kappa: "did:holo:sha256:" + sha256hex(a), nbytes: a.length }, { name: "t1", kappa: "did:holo:sha256:" + sha256hex(b), nbytes: b.length }] };
  },
};

// signed manifest pinning the SOURCE-file κ (provenance verified post-download, pre-bind)
function signManifest(pinKappa) {
  const KEYS = ["02" + "a".repeat(64), "02" + "b".repeat(64), "02" + "c".repeat(64)];
  const body = { "@type": ["hosc:SkillModelManifest"], algo: "sha256", v: 1,
    policy: { maxParams: "1.5B", maxBytes: 1.2e9, licenses: ["apache-2.0"], offManifest: "deny" },
    skills: [{ skill: "code", pipeline: "text-generation", maxParams: "1.5B", allow: [{ repo: REPO, kappa: pinKappa }] }],
    authority: { threshold: 2, keys: KEYS } };
  const commitment = sha256hex(jcs(body));
  return { ...body, commitment, signatures: KEYS.slice(0, 2).map((k) => ({ key: k, sig: signWith(k, fromHex(commitment)) })) };
}
const sealedConscience = { evaluate: () => ({ outcome: "accept", blocked: [] }) };
const detail = async () => ({ params: 0.5e9, bytes: FSIZE, license: "apache-2.0" });
const planOf = () => async () => ({ task: "code", specialist: { id: REPO, runnable: true, pipeline: "text-generation" }, fallback: null });

// the acquire context = the REAL S1→S0 forge composition (this is the Step-2 wiring, exercised)
function rig({ manifest, cache = null } = {}) {
  const { fetch, seen } = makeFetch();
  const store = new Map(); const calls = { forge: 0, bind: 0 }; let lastHolo = null;
  const ctx = {
    pickSpecialist: planOf(),
    authCtx: { manifest, conscience: sealedConscience, detail, crypto },
    cache,
    async forge(model, { pinKappa } = {}) {
      calls.forge++;
      const man = await ingest(model.id, { fetch, sha256hex, chunkSize: 128, kput: async (k, b) => store.set(k.split(":").pop(), new Uint8Array(b)) });
      if (pinKappa) pinGuard(pinKappa, man.kappa);                          // provenance: downloaded bytes == pinned source κ
      const bytes = store.get(man.kappa.split(":").pop());
      const sealed = await forgeToHolo(bytes, [FRONT]);                     // S0: one sealer
      lastHolo = sealed.holo;
      return { kappa: sealed.rootHolo, bytes: sealed.holo, sourceKappa: man.kappa };
    },
    makeProvider: async (holo) => ({ id: REPO, holoBytes: holo.bytes, generate: async function* () { yield "ok"; } }),
    bindSpecialist: (taskId, provider) => { calls.bind++; return { task: taskId, provider: provider.id }; },
  };
  return { ctx, seen, calls, store, getHolo: () => lastHolo };
}

const checks = {};

// 1 · full pipeline binds a signed, listed model
{
  const r = rig({ manifest: signManifest(SRC_KAPPA) });
  const out = await acquireSpecialist("code", r.ctx);
  checks.pipelineBindsListedModel = out.bound === true && out.tier === "pinned" && r.calls.forge === 1 && r.calls.bind === 1 && r.seen.calls >= 2;
}
// 2 · the produced .holo round-trips through the REAL reader
{
  const r = rig({ manifest: signManifest(SRC_KAPPA) });
  await acquireSpecialist("code", r.ctx);
  const holo = r.getHolo();
  const meta = readHolo(holo).meta;
  const h = await openHoloStream(async (off, len) => holo.subarray(off, off + len));
  let bodiesOk = true; for (const [hex] of h.dir) { const b = await h.getBody(hex); if (sha256hex(b) !== hex) bodiesOk = false; }
  checks.producedHoloRoundTrips = meta.arch === "qwen2" && meta.format === "holo/2" && meta.order.length === 2 && bodiesOk;
}
// 3 · unsigned manifest → refused, network NEVER touched
{
  const m = signManifest(SRC_KAPPA); m.signatures = [];
  const r = rig({ manifest: m });
  const out = await acquireSpecialist("code", r.ctx);
  checks.refusesUnsignedNoIngest = out.bound === false && out.fallback === "main" && r.calls.forge === 0 && r.calls.bind === 0 && r.seen.calls === 0;
}
// 4 · manifest pins the WRONG source κ → pinGuard refuses after download, before bind
{
  const r = rig({ manifest: signManifest("did:holo:sha256:" + "9".repeat(64)) });
  const out = await acquireSpecialist("code", r.ctx);
  checks.pinnedSourceKappaMismatch = out.bound === false && /pinned κ mismatch|forge refused/.test(out.reason) && r.calls.bind === 0 && r.seen.calls >= 1;
}
// 5 · warm reload: 2nd acquire hits the cache, ingest/fetch happen ONCE total
{
  const cache = new Map(); const r = rig({ manifest: signManifest(SRC_KAPPA), cache });
  const a = await acquireSpecialist("code", r.ctx);
  const callsAfter1 = r.seen.calls;
  const b = await acquireSpecialist("code", r.ctx);
  checks.warmReloadNetworkFree = a.bound && b.bound && b.warm === true && r.calls.forge === 1 && r.seen.calls === callsAfter1;
}

const witnessed = Object.values(checks).every(Boolean);
write({
  spec: "Holo Forge Unified (ADR-0114) — FULL PIPELINE composition: ingest (S1) → forgeToHolo/sealHolo (S0) → authorize (S2) → acquireSpecialist (S3) run as ONE flow through the real built modules, and the produced .holo validates through the REAL production reader. A signed+listed model binds end-to-end with tier 'pinned'; an unsigned manifest is refused with the network never touched; a wrong pinned source κ is refused after download and before bind; a warm reload is network-free.",
  authority: "holospaces Laws L1/L3/L5 · ADR-0114 · ADR-0084 · ADR-0033 · ADR-0111 · HTTP Range/206 (RFC 7233)",
  note: "Load-bearing code is REAL: S1 ingest, S0 forgeToHolo/sealHolo, the production readHolo/openHoloStream reader, S2 authorize/verifyManifest/pinGuard, S3 acquireSpecialist. Mocked: fetch (HF) and the GGUF tensor-split (forgeGguf is witnessed separately by gguf-forge.test.mjs). This proves the STAGES COMPOSE; the live HF CORS check + reseal cut-over remain the browser-session steps (holo-forge-unified-cutover.md).",
  witnessed,
  covers: witnessed ? ["full-pipeline-compose", "ingest-forge-seal-authorize-acquire", "real-reader-validates-output", "gate-before-network", "pinned-source-kappa", "warm-network-free"] : [],
  checks,
});

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ the stages compose end-to-end — Q acquires a signed model through ingest→forge→seal→authorize→bind, the .holo validates in the real reader, and the gate precedes the network" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
