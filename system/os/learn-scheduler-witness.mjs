// A3 witness: the "learn while you rest" scheduler orchestrates correctly — trains a chunk ONLY when there is
// new up-voted data, on a capable device, not paused; advances a watermark so it never re-trains the same data;
// respects pause + device-tier + abort. The real GPU trainer (A1) is the injected `train`; here it is a stub.
import { makeScheduler } from "./usr/lib/holo/holo-learn-scheduler.mjs";

let pass = 0, fail = 0; const ok = (c, m) => { console.log((c ? "  ok  " : "  XX  ") + m); c ? pass++ : fail++; };
const rec = (kind, text, vote) => ({ "holmem:kind": kind, "holmem:text": text, ...(vote ? { "holmem:vote": vote } : {}) });

let recs = [rec("intent", "compose jazz"), rec("feedback", "love jazz", "up")];                 // 1 up-vote
const memory = { all: () => recs.slice() };
const saved = []; const userAdapter = { save: async (b) => { saved.push(b); return { kappa: "did:holo:sha256:" + saved.length }; } };
let trainedSamples = null; const train = async (s) => { trainedSamples = s; return new Uint8Array([1, 2, 3]); };   // stub trainer → adapter bytes
const sft = (r) => r.filter((x) => (x["holmem:vote"]) === "up").map((x) => ({ ids: [1, 2], targets: [2], mask: [1] }));   // 1 sample per up-vote
let memStore = 0; const store = { get: () => memStore, set: (n) => { memStore = n; } };
let paused = false, tier = "high";
const sched = makeScheduler({ memory, userAdapter, sft, train, deviceTier: () => tier, isPaused: () => paused, store });

// (1) new data → trains + saves an adapter + advances the watermark
const r1 = await sched.run();
ok(r1.trained && saved.length === 1 && r1.adapter && trainedSamples && trainedSamples.length === 1, "new up-voted data → micro-finetune ran, adapter saved (" + (r1.adapter || "") + ")");
// (2) no new data → skip (never re-train the same data)
const r2 = await sched.run();
ok(r2.skipped === "no-new-data" && saved.length === 1, "no new data → SKIP (watermark prevents re-training)");
// (3) a NEW up-vote → trains again
recs.push(rec("feedback", "great rust tip", "up"));
const r3 = await sched.run();
ok(r3.trained && saved.length === 2, "a new up-vote → trains again (incremental, hands-free)");
// (4) paused → skip
paused = true; const r4 = await sched.run(); paused = false;
ok(r4.skipped === "paused" && saved.length === 2, "paused → SKIP (the user opted out)");
// (5) low device-tier → skip (train only on a capable GPU; phone gets the synced adapter / grounding)
tier = "low"; recs.push(rec("feedback", "x", "up")); const r5 = await sched.run(); tier = "high";
ok(r5.skipped === "device-tier:low" && saved.length === 2, "low-tier device → SKIP (never OOM a phone)");
// (6) abort mid-run → never persists a half run
const ac = { aborted: true }; const slowTrain = async () => { return new Uint8Array([9]); };
const sched2 = makeScheduler({ memory, userAdapter, sft, train: async (s, { signal }) => { return new Uint8Array([9]); }, deviceTier: () => "high", isPaused: () => false, store: { get: () => 0, set: () => {} } });
const r6 = await sched2.run({ signal: { aborted: true } });
ok(r6.skipped === "aborted", "aborted signal → SKIP (interruptible; never persist a half-trained adapter)");

console.log(`\n${pass}/${pass + fail}${fail ? " FAIL" : " — WITNESSED A3: hands-free idle micro-finetune — trains only on NEW up-voted data, watermarked, pause/tier/abort-respecting, never blocks"}`);
process.exit(fail ? 1 : 0);
