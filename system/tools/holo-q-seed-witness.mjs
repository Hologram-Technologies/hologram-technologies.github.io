// holo-q-seed-witness.mjs — proves Q's cold-start instant answers (responsiveness for first-time users). The
// seed κ-memo answers predictable first questions O(1) with NO model, and makeQResponder uses it ONLY while the
// brain is cold (warm users get the full brain). Node, fake brain (records if it was invoked) + real seal/verify.

import { seedLookup, seedKappa } from "../os/usr/lib/holo/q/holo-q-seed.mjs";
import { makeQResponder } from "../os/usr/lib/holo/q/holo-q-contact.mjs";
import { seal, verify } from "../os/usr/lib/holo/holo-object.mjs";
import { messageObject } from "../os/usr/lib/holo/holo-pluck.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "  ok  " : "  XX  ") + m); c ? pass++ : fail++; };

function fakeThread() {
  const events = [], notes = [];
  return {
    view: () => events.map((e, i) => ({ text: e.text, sender: e.sender, seq: i })),
    ingest: async (input) => { const o = seal(messageObject(input)); if (!verify(o)) throw new Error("unverifiable"); events.push({ ...input, kappa: o.id }); return { kappa: o.id, seq: events.length - 1 }; },
    appendNote: async (k, p) => { notes.push({ k, p }); return { k }; }, _events: events,
  };
}
function fakeBrain(ready) { const st = { gen: 0 }; return { st, info: () => ({ ready }), setSkill: async () => {}, generate: async function* () { st.gen++; for (const w of "from the brain".split(" ")) yield " " + w; } }; }

// (1) seed κ-memo lookups
ok(/^Hello\. I'm Q/.test(seedLookup("hi")) && /^Hello\. I'm Q/.test(seedLookup("hey Q")) && /^Hello\. I'm Q/.test(seedLookup("  Hello!  ")), "greetings → instant canonical greeting");
ok(/mind of this OS/.test(seedLookup("who are you")), "“who are you” → identity answer");
ok(/Private by default/.test(seedLookup("is this private")), "“is this private” → privacy answer");
ok(seedLookup("integrate the quarterly revenue model") === null, "a novel question MISSES (falls through to the brain)");
ok(seedKappa("x") === seedKappa("x") && /^seed:/.test(seedKappa("x")), "seedKappa is deterministic provenance");

// (2) COLD brain + seedable prompt → instant seed answer, brain NOT invoked
{
  const thread = fakeThread(), brain = fakeBrain(false);   // cold
  const q = makeQResponder({ thread, brain, now: () => "t", seed: seedLookup, brainReady: () => false });
  let painted = "";
  const r = await q.respond("hi", { onDelta: (d, full) => { painted = full; } });
  ok(r.seed === true && /^Hello\. I'm Q/.test(r.text), "COLD: a greeting is answered instantly from the seed");
  ok(brain.st.gen === 0, "COLD: the full brain was NOT invoked (zero model, zero wait)");
  ok(r.kappa && /sha256/.test(String(r.kappa)) && thread._events.length === 1, "the instant answer still finalizes to ONE verified κ");
  ok(painted === r.text, "the instant answer streamed to the bubble");
}

// (3) WARM brain → the full brain answers even a seedable prompt (quality once loaded)
{
  const thread = fakeThread(), brain = fakeBrain(true);   // warm
  const q = makeQResponder({ thread, brain, now: () => "t", seed: seedLookup, brainReady: () => true });
  const r = await q.respond("hi", {});
  ok(brain.st.gen === 1 && !r.seed, "WARM: the full brain answers (seed bypassed once weights are streamed in)");
}

// (4) COLD brain + novel prompt → seed misses → brain is used (honest fallthrough)
{
  const thread = fakeThread(), brain = fakeBrain(false);
  const q = makeQResponder({ thread, brain, now: () => "t", seed: seedLookup, brainReady: () => false });
  const r = await q.respond("explain the revenue model", {});
  ok(brain.st.gen === 1 && !r.seed, "COLD + novel: seed misses → the brain answers (no canned fabrication)");
}

// (5) COLD + novel + ONNX seed available → instant seed draft, full brain NOT invoked
{
  const thread = fakeThread(), brain = fakeBrain(false);
  const onnxSeed = { respond: async function* () { for (const w of "a quick draft".split(" ")) yield " " + w; } };
  const q = makeQResponder({ thread, brain, now: () => "t", seed: seedLookup, onnxSeed, brainReady: () => false });
  const r = await q.respond("explain the revenue model", {});
  ok(r.seedOnnx === true && r.text === "a quick draft" && brain.st.gen === 0, "COLD + novel: the ~7MB ONNX seed drafts instantly (full brain not yet invoked)");
  ok(r.kappa && /sha256/.test(String(r.kappa)), "the ONNX-seed draft finalizes to ONE verified κ");
}

// (6) COLD + novel + ONNX seed yields nothing (missing deps) → fail-soft to the brain
{
  const thread = fakeThread(), brain = fakeBrain(false);
  const onnxSeed = { respond: async function* () { /* empty: deps unavailable */ } };
  const q = makeQResponder({ thread, brain, now: () => "t", seed: seedLookup, onnxSeed, brainReady: () => false });
  const r = await q.respond("explain the revenue model", {});
  ok(brain.st.gen === 1 && !r.seedOnnx, "COLD + novel + empty ONNX seed → fail-soft to the full brain (no regression)");
}

console.log(`\n${pass}/${pass + fail}${fail ? " FAIL" : " — WITNESSED: Q answers predictable first questions INSTANTLY from a sealed κ-memo, drafts UNscripted first questions from the ~7MB ONNX seed, and uses the full brain once its κ-shards stream in — every tier fail-soft, never a canned fabrication."}`);
process.exit(fail ? 1 : 0);
