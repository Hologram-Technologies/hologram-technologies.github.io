// Witness: the seed first-responder wires in FAIL-SOFT. Proves (1) seed present → seed-handoff speaks the seed opener
// then the full brain continues; (2) seed load failure → null → brain-only; (3) seed throwing mid-turn → brain-only,
// no crash. Pure mocks (no holo:// runtime, no ORT) — runs in Node.
import { loadFirstResponder, adaptBrain, makeVoiceResponder } from "./holo-voice-first-responder.mjs";

const ok = (c, m) => { if (!c) { console.log("FAIL:", m); process.exit(1); } else console.log("  ok:", m); };
const seedRunner = { respond: async function* () { for (const t of ["Sure!", "let", "me"]) yield t; } };
// full brain: load() takes a tick so the seed gets to speak first; generate() is the "real" answer.
const llm = { load: async () => { await new Promise((r) => setTimeout(r, 8)); }, generate: async function* () { for (const t of ["Sure!", "here", "is", "the", "answer"]) yield t; } };
const H = [{ role: "user", content: "play some music" }];

(async () => {
  // 1) seed present → seed-handoff
  const sp1 = []; const r1 = makeVoiceResponder({ seed: seedRunner, full: adaptBrain(llm), speak: (t) => sp1.push(t) });
  ok(r1.mode === "seed-handoff", "mode=seed-handoff when seed present");
  const out1 = await r1.turn(H);
  ok(sp1[0] === "Sure!", `seed speaks first ("${sp1[0]}")`);
  ok(/answer/.test(out1), "full brain continued to the real answer");

  // 2) seed load fails → null → brain-only
  const seedNull = await loadFirstResponder({ tokenizer: {}, createRunner: async () => { throw new Error("boom"); } });
  ok(seedNull === null, "loadFirstResponder returns null on load failure (fail-soft)");
  const sp2 = []; const r2 = makeVoiceResponder({ seed: seedNull, full: adaptBrain(llm), speak: (t) => sp2.push(t) });
  ok(r2.mode === "brain-only", "mode=brain-only when no seed");
  const out2 = await r2.turn(H);
  ok(/answer/.test(out2) && sp2.length > 0, "brain-only still answers");

  // 3) seed throws mid-turn → fail-soft to brain-only, no crash
  const badSeed = { respond: async function* () { yield "Sure!"; throw new Error("mid-stream boom"); } };
  let seedErr = false; const sp3 = [];
  const r3 = makeVoiceResponder({ seed: badSeed, full: adaptBrain(llm), speak: (t) => sp3.push(t), onEvent: (e) => { if (e === "seed-error") seedErr = true; } });
  const out3 = await r3.turn(H);   // must NOT throw
  ok(seedErr, "seed mid-turn error caught (seed-error event)");
  ok(/answer/.test(out3), "recovered to the full answer after seed error");

  // 4) runner shape guard: a runner without respond() → treated as no seed
  const r4 = makeVoiceResponder({ seed: {}, full: adaptBrain(llm), speak: () => {} });
  ok(r4.mode === "brain-only", "malformed runner (no respond) → brain-only");

  console.log("\nWITNESS GREEN — seed first-responder wires in fail-soft (seed-handoff | brain-only).");
})();
