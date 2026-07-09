// Witness the κ-route heal in holo-whisper-stream: when the .holo PATH is absent (static/IPFS deploy),
// the stream must fall back to /.holo/sha256/<κ> (SW heals from IPFS) and still parse + L5-verify.
// Deterministic via a stubbed fetch (path → 404, κ-route → the real bytes) — no IPFS needed.
import { readFileSync } from "node:fs";
import { streamHolo } from "./holo-whisper-stream.mjs";

const HOLO = new URL("../.models/whisper-base.holo", import.meta.url);
const KAPPA = "9637ae57babfe22b1e08d013423856b44b060be7cf20204532b90250fbf04ea3";
const raw = new Uint8Array(readFileSync(HOLO));            // the real .holo bytes (served only via the κ-route)

let pathHits = 0, kHits = 0;
globalThis.fetch = async (u) => {
  const url = String(u);
  if (url.includes("/.holo/sha256/" + KAPPA)) {            // healed route → whole body, 200 (no Range)
    kHits++;
    return { ok: true, status: 200, arrayBuffer: async () => raw.buffer };
  }
  if (url.includes("whisper-base.holo")) { pathHits++; return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }; }
  return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
};

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ok  " + m); } else { fail++; console.log("FAIL  " + m); } };

const H = await streamHolo("/apps/q/forge/.models/whisper-base.holo", { useOpfs: false, kappa: KAPPA });
ok(H.stats.kappaRoute === true, "fell back to the κ-route after the path 404'd");
ok(pathHits >= 1 && kHits >= 1, `tried path (${pathHits}) then healed by κ (${kHits})`);
ok(H.meta && H.meta.hparams && H.meta.hparams.n_audio_state > 0, "parsed meta from the κ-healed bytes");

// L5 still enforced on the healed bytes: fetch one tensor (re-derives its SHA-256 before accepting).
const name = H.meta.order[0].name;
const t = await H.getF32(name);
ok(t && t.length > 0 && Number.isFinite(t[0]), `getF32("${name}") L5-verifies from healed bytes (${t.length} f32)`);

// header (vocab) reachable too — needed for detok
ok(H.headerBytes && H.headerBytes.length > 0, "vocab header present from healed bytes");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
