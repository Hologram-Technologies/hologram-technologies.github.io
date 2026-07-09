// Persistence witness — the κ-store is content-addressed, verify-once, cross-session:
//   • cold get → transport miss + persisted; warm get (same κ) → 0 transport, served from the store
//   • a tampered persisted body is REFUSED (L5) and re-fetched — the cache never serves a wrong byte
//   • end-to-end over the REAL qwen .holo: first pass = all misses+writes; second pass on the SAME
//     store = all opfsHits, 0 misses → "instant on second tap, offline" (O(1) across sessions)
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { makeKappaStore } from "./gpu/holo-kappa-store.mjs";
import { openGgufHoloStream } from "./gguf-forge-kstream.mjs";

const sha256 = async (b) => createHash("sha256").update(b).digest("hex");
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { console.log(`  ok  ${m}`); pass++; } else { console.log(`  XX  ${m}`); fail++; } };

// in-memory stand-in for OPFS (same get/put/clear contract the browser backend implements)
const mockBackend = () => { const m = new Map(); return { m, get: async (k) => m.get(k) || null, put: async (k, b) => (m.set(k, b), true), clear: async () => (m.clear(), true) }; };

// ── 1. cold→warm + tamper-refuse on the bare store ──
{
  const be = mockBackend(), store = makeKappaStore({ backend: be, sha256 });
  const body = new Uint8Array([1, 2, 3, 4, 5]); const hex = await sha256(body);
  let fetches = 0; const fetchMiss = async () => { fetches++; return body; };
  const a = await store.get(hex, fetchMiss);
  ok(fetches === 1 && store.stats.misses === 1 && store.stats.opfsWrites === 1 && a[0] === 1, "cold get: one transport miss, persisted to store");
  const b = await store.get(hex, fetchMiss);
  ok(fetches === 1 && store.stats.opfsHits === 1, "warm get (same κ): 0 transport, served from persistent store");
  be.m.set(hex, new Uint8Array([9, 9, 9])); // corrupt the persisted body
  const c = await store.get(hex, fetchMiss);
  ok(fetches === 2 && store.stats.refuses === 1 && c[0] === 1, "tampered persisted body REFUSED (L5) + re-fetched — never serves a wrong byte");
}

// ── 2. end-to-end over the real .holo: cold pass then warm pass on the SAME store ──
{
  const HOLO = "./.models/qwen2.5-0.5b-instruct.holo";
  const bytes = new Uint8Array(readFileSync(HOLO));
  const rangeReader = async (off, len) => bytes.subarray(off, off + len);   // file as a range source (transport stand-in)
  const be = mockBackend(), persist = makeKappaStore({ backend: be, sha256 });

  const cold = await openGgufHoloStream(rangeReader, { persist });
  for (const t of cold.plan.tensors) await cold.store.get(t.kappa.split(":").pop());
  const nT = cold.plan.tensors.length;
  ok(persist.stats.misses === nT && persist.stats.opfsWrites === nT, `cold pass: ${nT}/${nT} bodies fetched+persisted (${(persist.stats.bytesFetched / 1e6 | 0)}MB)`);

  const hitsBefore = persist.stats.opfsHits, missBefore = persist.stats.misses;
  const warm = await openGgufHoloStream(rangeReader, { persist });          // a fresh "session" on the same persistent store
  for (const t of warm.plan.tensors) await warm.store.get(t.kappa.split(":").pop());
  const warmHits = persist.stats.opfsHits - hitsBefore, warmMiss = persist.stats.misses - missBefore;
  ok(warmHits === nT && warmMiss === 0, `warm pass (2nd session): ${warmHits}/${nT} from store, ${warmMiss} transport — 0-network, offline-capable`);
  ok(be.m.size === nT, `persistent store holds exactly ${nT} content-addressed bodies (cross-model dedup by κ)`);
}

console.log(`\n${pass}/${pass + fail} green${fail ? " — FAIL" : " — WITNESSED: persistent + verify-once + 0-network warm"}`);
process.exit(fail ? 1 : 0);
