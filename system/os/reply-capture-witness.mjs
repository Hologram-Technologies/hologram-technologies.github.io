// Reply-capture witness: a 👍 (captureUpvote) stores the (prompt, REPLY) pair in memory, and sftFromMemory
// then yields a REPLY-MASKED SFT sample (source "reply") — upgrading the trainer's data from "style" (the
// user's phrasing) to true reply-SFT (train the liked answer). 100% local; Node-witnessed with stub deps.
const recorded = [];
globalThis.window = { HoloMemory: { remember: async (sig) => { recorded.push({ "holmem:kind": sig.kind, "holmem:text": sig.text, "holmem:vote": sig.vote, "holmem:meta": sig.meta }); }, forget: async () => { recorded.length = 0; } } };

const { captureUpvote } = await import("./usr/lib/holo/holo-learning.mjs");
const { sftFromMemory } = await import("../../../holo-apps/apps/q/forge/holo-lora-train-loop.mjs");

let pass = 0, fail = 0; const ok = (c, m) => { console.log((c ? "  ok  " : "  XX  ") + m); c ? pass++ : fail++; };

// the user asks, Q replies, the user 👍s it → capture the PAIR
const wrote = await captureUpvote("what is a good jazz chord?", "Try a Cmaj7 voicing — warm and classic.");
ok(wrote === true && recorded.length === 1, "captureUpvote wrote a record");
const rec = recorded[0];
ok(rec["holmem:kind"] === "feedback" && rec["holmem:vote"] === "up", "record is an UP-VOTE (feedback)");
ok(rec["holmem:meta"] && rec["holmem:meta"].reply === "Try a Cmaj7 voicing — warm and classic.", "record carries the REPLY (meta.reply) — the new data");

// now the trainer's data builder turns it into a REPLY-MASKED SFT sample (not just "style")
const tok = (t) => String(t || "").toLowerCase().split(/\s+/).filter(Boolean).map((w) => (w.length * 7 + w.charCodeAt(0)) % 97 + 1);
const samples = sftFromMemory(recorded, tok, { eos: 0 });
ok(samples.length === 1 && samples[0].source === "reply", "sftFromMemory → a REPLY sample (source=reply), not style");
const s = samples[0];
ok(s.mask.some((m) => m === 0) && s.mask.some((m) => m === 1), "reply-MASKED: prompt positions 0, reply positions 1 (train the liked answer, not the prompt)");

console.log(`\n${pass}/${pass + fail}${fail ? " FAIL" : " — WITNESSED: 👍 captures (prompt, reply) → reply-masked SFT. The model now learns from the answers you LIKE, not just your phrasing."}`);
process.exit(fail ? 1 : 0);
