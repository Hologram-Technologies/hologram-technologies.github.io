// Head-persistence witness — the WHOLE .holo (head region + every body) is 0-transport on warm.
//   • cold open: head region fetched once, content-addressed (headκ) + persisted, url pointer written
//   • warm open (2nd session, same store): a counting range source proves ZERO bytes read — head AND
//     bodies all served from the persistent store. "works on a plane" is literally true.
//   • a tampered cached head is REFUSED (L5) and re-fetched — never serves an unverified header.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { makeKappaStore } from "./gpu/holo-kappa-store.mjs";
import { openGgufHoloStream } from "./gguf-forge-kstream.mjs";

const sha256 = async (b) => createHash("sha256").update(b).digest("hex");
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { console.log(`  ok  ${m}`); pass++; } else { console.log(`  XX  ${m}`); fail++; } };
const mockBackend = () => { const m = new Map(); return { m, get: async (k) => m.get(k) || null, put: async (k, b) => (m.set(k, b), true), clear: async () => (m.clear(), true) }; };

const HOLO = "./.models/qwen2.5-0.5b-instruct.holo";
const URL = "https://example.test/qwen2.5-0.5b-instruct.holo";   // stand-in identity for the url hint
const bytes = new Uint8Array(readFileSync(HOLO));
// a counting range source: every byte it serves is a "wire" byte (transport). Warm must read 0.
let wire = 0; const range = async (off, len) => { wire += len; return bytes.subarray(off, off + len); };

const be = mockBackend(), persist = makeKappaStore({ backend: be, sha256 });

// ── cold open: pull head + all bodies through the range source, persist everything ──
wire = 0;
const cold = await openGgufHoloStream(range, { persist, urlHint: URL });
for (const t of cold.plan.tensors) await cold.store.get(t.kappa.split(":").pop());
const nT = cold.plan.tensors.length, coldWire = wire;
ok(cold.headWarm === false && coldWire >= bytes.length - 32, `cold: head region + ${nT} bodies fetched once (${(coldWire / 1e6 | 0)}MB off the wire)`);
ok(persist.stats.headWrites === 1, "cold: head region persisted as ONE content-addressed blob (headκ)");

// ── warm open: a brand-new "session" on the same persistent store ──
wire = 0;
const warm = await openGgufHoloStream(range, { persist, urlHint: URL });
for (const t of warm.plan.tensors) await warm.store.get(t.kappa.split(":").pop());
ok(warm.headWarm === true && warm.plan.arch === cold.plan.arch && warm.plan.tensors.length === nT, "warm: same arch + tensors, head served WARM");
ok(wire === 0, `warm: ZERO bytes off the wire for the ENTIRE archive (head + ${nT} bodies) — offline-complete`);
ok(persist.stats.headHits >= 1 && persist.stats.opfsHits === nT, `warm: head + all ${nT} bodies from the persistent store`);

// ── tamper the cached head blob → REFUSED + re-fetched ──
const headK = await persist.getHint("url_" + (await persist.hash(new TextEncoder().encode(URL))));
be.m.set(headK, new Uint8Array(be.m.get(headK).length).fill(7));   // corrupt the persisted head
wire = 0;
const repaired = await openGgufHoloStream(range, { persist, urlHint: URL });
ok(persist.stats.headRefuses >= 1 && repaired.headWarm === false && wire > 0, "tampered cached head REFUSED (L5) + re-fetched — never serves an unverified header");
ok(repaired.plan.arch === "qwen2", "re-fetched head re-derives a valid plan (arch=qwen2)");

console.log(`\n${pass}/${pass + fail} green${fail ? " — FAIL" : " — WITNESSED: head + bodies both 0-transport on warm, tamper-safe"}`);
process.exit(fail ? 1 : 0);
